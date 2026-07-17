import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import type { Db, MongoClientOptions, ReadPreference } from "mongodb";
import { getRoleTemplate } from "@modules/role/domain/role-template.catalog";
import { buildRoleAssignmentScopeFingerprint } from "@modules/role/domain/role-assignment-scope";
import { KPI_COARSE_SCOPE_COMPATIBILITY_INVENTORY } from "@core/permission/permission.guard";
import {
  evaluateKpiPersistedRecord,
  KPI_PERSISTED_CONTRACT_MATRICES,
  type KpiPersistedFamily,
} from "@modules/kpi/domain/kpi-persisted-contract";
import {
  loadAllRisk001PlannerInputs,
  loadAccountContextPlannerRecords,
  loadBundleConsistencyPlannerRecords,
  loadLegacyRolePlannerRecords,
  loadRoleDriftPlannerRecords,
  loadScopeFingerprintPlannerRecords,
  loadStaleKpiPlannerRecords,
  loadTalentIdentityPlannerRecords,
  scanCollection,
} from "./risk-001-data-loaders";
import {
  assertReadOnlyAggregatePipeline,
  NativeReadOnlyMongoGateway,
  normalizeReadOnlyAggregateMaxTimeMS,
  ReadOnlyAggregateOptions,
  ReadOnlyDocument,
  ReadOnlyFilter,
  ReadOnlyFindOptions,
  ReadOnlyMongoGateway,
  ReadOnlyProjection,
  sanitizeSensitiveText,
  withReadOnlyMongoGateway,
} from "./read-only-mongo.gateway";
import {
  buildRisk001DryRunManifest,
  fingerprintRisk001CompletedRun,
  prepareRisk001CompletedArtifacts,
  renderRisk001Summary,
  validateRisk001RunCompletion,
} from "./risk-001-output";
import {
  acquireRisk001OutputDirectory,
  loadRisk001RuntimeConfig,
  parseRisk001CliArgs,
  preflightRisk001OutputDirectory,
  prepareRisk001DryRunCli,
  runRisk001DryRunCli,
  writeExactlyTwoOutputsAtomically,
} from "./risk-001-dry-run";
import {
  RISK001_ENTERPRISE_CONTRACT_VERSION,
  RISK001_QUERY_GRAMMAR_VERSION,
  RISK001_REQUIRED_ASSESSMENT_AREA_IDS,
  RISK001_SOURCE_PROJECTION_CONTRACT_VERSION,
  RISK001_NESTED_NONEXISTENT_OUTPUT_POLICY,
} from "./risk-001-completed-run-contract";
import {
  normalizeRisk001QueryValue,
  stableSerializeRisk001QueryValue,
} from "./risk-001-query-value-contract";
import {
  legacyRolePlanner,
  roleDriftPlanner,
  scopeFingerprintPlanner,
  talentIdentityPlanner,
} from "./risk-001-planners";

class FakeReadOnlyGateway implements ReadOnlyMongoGateway {
  private readonly calls = new Map<string, number>();
  constructor(
    private readonly collections: Readonly<Record<string, readonly ReadOnlyDocument[]>>,
    private readonly onRead?: (method: string, collection: string, call: number) => void,
  ) {}

  async ping(): Promise<void> {}

  async findOne<T extends ReadOnlyDocument>(
    collectionName: string,
    filter: ReadOnlyFilter,
    _projection: ReadOnlyProjection,
  ): Promise<T | null> {
    this.observe("findOne", collectionName);
    return (this.rows(collectionName).find((row) => matches(row, filter)) as T | undefined) ?? null;
  }

  async find<T extends ReadOnlyDocument>(
    collectionName: string,
    filter: ReadOnlyFilter,
    options: ReadOnlyFindOptions,
  ): Promise<readonly T[]> {
    this.observe("find", collectionName);
    return this.rows(collectionName)
      .filter((row) => matches(row, filter))
      .sort((left, right) => readId(left).localeCompare(readId(right)))
      .slice(0, options.limit) as unknown as readonly T[];
  }

  async countDocuments(collectionName: string, filter: ReadOnlyFilter): Promise<number> {
    this.observe("count", collectionName);
    return this.rows(collectionName).filter((row) => matches(row, filter)).length;
  }

  async distinct<T>(collectionName: string, field: string, filter: ReadOnlyFilter): Promise<readonly T[]> {
    return [...new Set(this.rows(collectionName).filter((row) => matches(row, filter)).map((row) => (row as Record<string, unknown>)[field]))] as T[];
  }

  async aggregate<T extends ReadOnlyDocument>(
    _collectionName: string,
    pipeline: readonly ReadOnlyDocument[],
    _options?: ReadOnlyAggregateOptions,
  ): Promise<readonly T[]> {
    assertReadOnlyAggregatePipeline(pipeline);
    return [];
  }

  private rows(name: string): ReadOnlyDocument[] {
    return [...(this.collections[name] ?? [])];
  }

  private observe(method: string, collection: string): void {
    const key = `${method}:${collection}`;
    const call = (this.calls.get(key) ?? 0) + 1;
    this.calls.set(key, call);
    this.onRead?.(method, collection, call);
  }
}

test("domain KPI persisted contract exposes seven finite matrices and fail-closed critical cells", () => {
  assert.deepEqual(Object.keys(KPI_PERSISTED_CONTRACT_MATRICES).sort(), ["ACTUAL", "ALLOCATION", "ALLOCATION_OPERATION", "CORRECTION", "METRIC", "PLAN", "SLOT_EXCUSE"]);
  const cases = [
    ["PLAN", { status: "DRAFT", lifecycleStatus: "DRAFT", planCode: "p", subjectType: "TALENT_GROUP", subjectId: "g", currencyCode: "VND", periodMonth: "2026-07", periodStartAt: 1, periodEndAt: 2, timezone: "Asia/Saigon", createdAt: 1, createdByActorId: null, updatedAt: 2, updatedByActorId: "a" }, "createdByActorId"],
    ["ALLOCATION", { allocationStatus: "APPROVED", lifecycleStatus: "DRAFT" }, "STATUS_LIFECYCLE_PAIR_INVALID"],
    ["ACTUAL", { lifecycleStatus: "DRAFT", kpiPlanId: "p", allocationId: "a", metricCode: "REVENUE_VND", actualDate: "2026-07-01", actualValue: 1, effectiveValue: 1, entryVersion: 1, captureMode: "GROUP_ENTRY", aggregationMethod: "SUM", reviewMode: "NONE", evidenceMode: "NONE", policyVersion: "v", createdAt: 1, createdByActorId: "a", updatedAt: 1, updatedByActorId: "a" }, null],
    ["ALLOCATION_OPERATION", { actorId: "a", operation: "PUBLISH", idempotencyKey: "k", payloadFingerprint: "f", createdAt: 1 }, "kpiPlanId"],
  ] as const;
  for (const [family, record, expected] of cases) {
    const first = evaluateKpiPersistedRecord(family, record, { parentReferencesValid: family !== "ALLOCATION_OPERATION" });
    const second = evaluateKpiPersistedRecord(family, record, { parentReferencesValid: family !== "ALLOCATION_OPERATION" });
    assert.deepEqual(first, second);
    if (family === "ACTUAL") assert.equal(first.recommendedClassification, "CURRENT_CANONICAL");
    else assert.notEqual(first.recommendedClassification, "CURRENT_CANONICAL");
    if (expected === "STATUS_LIFECYCLE_PAIR_INVALID") assert.equal(first.statusLifecyclePairValidity, false);
    else if (expected) assert.equal([...first.missingAlwaysRequiredFields, ...first.missingStateRequiredFields].includes(expected), true);
  }
});

test("KPI persisted matrices directly cover every declared enum, pair, and required field", () => {
  const contextFor = (family: KpiPersistedFamily) => ({
    parentReferencesValid: true,
    predecessorExists: true,
    successorExists: true,
    latestCorrectionExists: true,
    planPolicyVersion: "v",
    metricPolicy: family === "ACTUAL" ? {
      captureMode: "GROUP_ENTRY",
      aggregationMethod: "SUM",
      reviewMode: "NONE",
      evidenceMode: "NONE",
      policyVersion: "v",
    } : null,
  });
  const assess = (family: KpiPersistedFamily, record: Record<string, unknown>) =>
    evaluateKpiPersistedRecord(family, record, contextFor(family));

  for (const family of Object.keys(KPI_PERSISTED_CONTRACT_MATRICES) as KpiPersistedFamily[]) {
    const matrix = KPI_PERSISTED_CONTRACT_MATRICES[family];
    const base = canonicalKpiPersistedFixture(family);

    for (const value of matrix.supportedStatusValues) {
      const record = family === "ALLOCATION_OPERATION"
        ? { ...base, ...(value === "COMPLETED" ? { completedAt: 3, result: {} } : {}) }
        : { ...base, ...(family === "ALLOCATION" ? { allocationStatus: value } : { status: value }) };
      assert.equal(assess(family, record).enumValidity, true, `${family} declares status ${value}`);
    }
    for (const value of matrix.supportedLifecycleValues) {
      const record = { ...base, lifecycleStatus: value };
      assert.equal(assess(family, record).enumValidity, true, `${family} declares lifecycle ${value}`);
    }
    for (const pair of matrix.allowedStatusLifecyclePairs) {
      const [status, lifecycleStatus] = pair.split(":");
      const state = family === "PLAN" ? status : lifecycleStatus;
      const record = canonicalKpiPersistedFixture(family, {
        ...stateFixtureOverride(family, state),
        ...(family === "ALLOCATION" ? { allocationStatus: status } : { status }),
        lifecycleStatus,
      });
      const result = assess(family, record);
      assert.equal(result.statusLifecyclePairValidity, true, `${family} allows ${pair}`);
      assert.equal(result.recommendedClassification, "CURRENT_CANONICAL", `${family} canonical ${pair}`);
    }
    for (const field of matrix.alwaysRequiredFields) {
      const record = canonicalKpiPersistedFixture(family);
      delete record[field];
      const result = assess(family, record);
      assert.equal(result.recommendedClassification === "CURRENT_CANONICAL", false, `${family} requires ${field}`);
      assert.equal(result.missingAlwaysRequiredFields.includes(field), true, `${family} reports ${field}`);
    }
    for (const [state, fields] of Object.entries(matrix.stateRequiredFields)) {
      const record = canonicalKpiPersistedFixture(family, stateFixtureOverride(family, state));
      for (const field of fields) {
        if (family === "SLOT_EXCUSE" && state === "DELETED" && field === "deletedAt") {
          continue; // Absence is the separately valid active-slot state; deletion lineage is tested by its actor.
        }
        const incomplete = { ...record };
        delete incomplete[field];
        const result = assess(family, incomplete);
        assert.equal(result.recommendedClassification === "CURRENT_CANONICAL", false, `${family} ${state} requires ${field}`);
        assert.equal(
          result.missingStateRequiredFields.includes(field) || result.contradictoryFields.length > 0,
          true,
          `${family} ${state} reports ${field} as missing or contradictory`,
        );
      }
    }
    if (matrix.supportedStatusValues.length > 0 && family !== "ALLOCATION_OPERATION") {
      const unsupported = family === "ALLOCATION" ? { allocationStatus: "UNSUPPORTED" } : { status: "UNSUPPORTED" };
      assert.equal(assess(family, { ...base, ...unsupported }).recommendedClassification, "MANUAL_REVIEW_REQUIRED", `${family} rejects an unsupported status`);
    } else if (matrix.supportedLifecycleValues.length > 0) {
      assert.equal(assess(family, { ...base, lifecycleStatus: "UNSUPPORTED" }).recommendedClassification, "MANUAL_REVIEW_REQUIRED", `${family} rejects an unsupported lifecycle`);
    } else if (family === "METRIC") {
      assert.equal(assess(family, { ...base, metricCode: "UNSUPPORTED" }).recommendedClassification, "MANUAL_REVIEW_REQUIRED", "METRIC rejects an unsupported metric enum");
    }
  }

  const dependent = assess("ACTUAL", { ...canonicalKpiPersistedFixture("ACTUAL"), lifecycleStatus: "NOT_A_LIFECYCLE" });
  const preserved = evaluateKpiPersistedRecord("ACTUAL", { ...canonicalKpiPersistedFixture("ACTUAL"), lifecycleStatus: "NOT_A_LIFECYCLE" }, {
    ...contextFor("ACTUAL"), dependencyEvidence: ["KPI_ALLOCATION"],
  });
  assert.equal(dependent.recommendedClassification, "MANUAL_REVIEW_REQUIRED");
  assert.equal(preserved.recommendedClassification, "PRESERVE_DUE_TO_DEPENDENCY");
  assert.equal(preserved.family, "ACTUAL");
  assert.equal(JSON.stringify(preserved).includes("REVENUE"), false);
});

test("actual read-only gateway instance has zero reflectable raw handles or write capability", async () => {
  const cursor = {
    sort() { return this; },
    limit() { return this; },
    async toArray() { return [{ _id: "one", value: 1 }]; },
  };
  const rawCollection = {
    async findOne() { return { _id: "one", value: 1 }; },
    find() { return cursor; },
    async countDocuments() { return 1; },
    async distinct() { return ["one"]; },
    aggregate() { return cursor; },
    async insertOne() { throw new Error("must never be invoked"); },
    async updateOne() { throw new Error("must never be invoked"); },
    async deleteOne() { throw new Error("must never be invoked"); },
  };
  const rawDb = {
    async command() { return { ok: 1 }; },
    collection() { return rawCollection; },
  } as unknown as Db;
  const gateway = new NativeReadOnlyMongoGateway(rawDb);
  assert.deepEqual(Object.keys(gateway), []);
  assert.deepEqual(Object.getOwnPropertyNames(gateway), []);
  assert.deepEqual(Object.getOwnPropertySymbols(gateway), []);
  assert.deepEqual(Reflect.ownKeys(gateway), []);
  assert.deepEqual(Object.getOwnPropertyDescriptors(gateway), {});
  const methods = Object.getOwnPropertyNames(NativeReadOnlyMongoGateway.prototype)
    .filter((name) => name !== "constructor")
    .sort();
  assert.deepEqual(methods, ["aggregate", "countDocuments", "distinct", "find", "findOne", "ping"]);
  for (const prohibited of [
    "insertOne",
    "updateOne",
    "replaceOne",
    "deleteOne",
    "findOneAndUpdate",
    "bulkWrite",
    "save",
  ]) {
    assert.equal(methods.includes(prohibited), false);
  }
  let current: object | null = gateway;
  const reachableOwnValues: unknown[] = [];
  while (current && current !== Object.prototype) {
    for (const key of Reflect.ownKeys(current)) {
      if (key === "constructor") continue;
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor && "value" in descriptor) reachableOwnValues.push(descriptor.value);
      assert.equal(typeof descriptor?.get, "undefined");
    }
    current = Object.getPrototypeOf(current) as object | null;
  }
  assert.equal(reachableOwnValues.includes(rawDb), false);
  assert.equal(reachableOwnValues.includes(rawCollection), false);
  assert.equal(reachableOwnValues.some((value) => value && typeof value === "object" && "insertOne" in value), false);
  await gateway.ping();
  assert.deepEqual(await gateway.findOne("records", {}, { _id: 1 }), { _id: "one", value: 1 });
  assert.deepEqual(await gateway.find("records", {}, { projection: { _id: 1 }, sort: { _id: 1 }, limit: 1 }), [{ _id: "one", value: 1 }]);
  assert.equal(await gateway.countDocuments("records", {}), 1);
  assert.deepEqual(await gateway.distinct("records", "_id", {}), ["one"]);
  assert.deepEqual(await gateway.aggregate("records", [{ $limit: 1 }]), [{ _id: "one", value: 1 }]);
});

test("read-only aggregate validator rejects prohibited and unknown stages", () => {
  assert.doesNotThrow(() =>
    assertReadOnlyAggregatePipeline([
      { $match: { state: "ACTIVE" } },
      { $limit: 10 },
    ]),
  );
  assert.throws(() => assertReadOnlyAggregatePipeline([{ $match: {} }]), /requires a bounded/u);
  assert.throws(
    () => assertReadOnlyAggregatePipeline([{ $limit: 1 }, { $project: { id: 1 } }]),
    /bounded final/u,
  );
  assert.throws(
    () =>
      assertReadOnlyAggregatePipeline([
        { $facet: { unsafe: [{ $merge: "other" }] } },
        { $limit: 1 },
      ]),
    /not allowed/u,
  );
  assert.throws(() => assertReadOnlyAggregatePipeline([{ $out: "other" }, { $limit: 1 }]), /not allowed/u);
  assert.throws(() => assertReadOnlyAggregatePipeline([{ $merge: "other" }, { $limit: 1 }]), /not allowed/u);
  assert.throws(() => assertReadOnlyAggregatePipeline([{ $unknown: {} }, { $limit: 1 }]), /not allowed/u);
  for (const pipeline of [
    [{ $lookup: { from: "roles", pipeline: [{ $unknown: {} }] } }, { $limit: 1 }],
    [{ $facet: { unsafe: [{ $unknown: {} }] } }, { $limit: 1 }],
    [{ $unionWith: { coll: "roles", pipeline: [{ $unknown: {} }] } }, { $limit: 1 }],
    [{ $lookup: { from: "roles", pipeline: [{ $out: "other" }] } }, { $limit: 1 }],
    [{ $facet: { unsafe: [{ $merge: "other" }] } }, { $limit: 1 }],
  ] as const) {
    assert.throws(() => assertReadOnlyAggregatePipeline(pipeline), /not allowed/u);
  }
  assert.throws(() => assertReadOnlyAggregatePipeline([{ $facet: { malformed: {} } }, { $limit: 1 }]), /must be an array/u);
  assert.throws(() => assertReadOnlyAggregatePipeline([{ $unionWith: [] }, { $limit: 1 }]), /unionWith/u);
  assert.throws(() => assertReadOnlyAggregatePipeline([{ $match: {}, $limit: 1 }, { $limit: 1 }]), /exactly one/u);
  assert.throws(() => assertReadOnlyAggregatePipeline([{ $limit: 10_001 }]), /1 through 10000/u);
});

test("aggregate maxTimeMS is always finite, integral, positive, and bounded", () => {
  assert.equal(normalizeReadOnlyAggregateMaxTimeMS(), 30_000);
  assert.equal(normalizeReadOnlyAggregateMaxTimeMS(1), 1);
  assert.equal(normalizeReadOnlyAggregateMaxTimeMS(120_000), 120_000);
  for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5, 120_001, "30000"] as readonly unknown[]) {
    assert.throws(() => normalizeReadOnlyAggregateMaxTimeMS(value as number), /maxTimeMS/u);
  }
});

test("driver and URI errors are sanitized without leaking credentials or ObjectIds", () => {
  const raw = "MONGO_URI=mongodb+srv://admin:secret@example.test/db id=507f1f77bcf86cd799439011";
  const sanitized = sanitizeSensitiveText(raw);
  assert.equal(sanitized.includes("secret"), false);
  assert.equal(sanitized.includes("507f1f77bcf86cd799439011"), false);
  assert.equal(sanitized.includes("mongodb+srv://"), false);
});

test("Mongo client closes after success, callback failure, and connect failure without a database connection", async () => {
  for (const mode of ["success", "callback-failure", "connect-failure"] as const) {
    let closed = 0;
    const fakeDb = {
      command: async () => ({ ok: 1 }),
    } as unknown as Db;
    const factory = (_uri: string, _options: MongoClientOptions) => ({
      connect: async () => {
        if (mode === "connect-failure") throw new Error("connect failed");
      },
      db: (_name: string, _options: { readonly readPreference: ReadPreference }) => fakeDb,
      close: async () => {
        closed += 1;
      },
    });
    if (mode !== "success") {
      await assert.rejects(
        withReadOnlyMongoGateway(
          { mongoUri: "mongodb://redacted.invalid/test", mongoDbName: "test", clientFactory: factory },
          async () => {
            if (mode === "callback-failure") throw new Error("read failed");
            return "unreachable";
          },
        ),
      );
    } else {
      await withReadOnlyMongoGateway(
        { mongoUri: "mongodb://redacted.invalid/test", mongoDbName: "test", clientFactory: factory },
        async () => "ok",
      );
    }
    assert.equal(closed, 1);
  }
});

test("bounded pagination is deterministic across pages and blocks at the safety ceiling", async () => {
  const gateway = new FakeReadOnlyGateway({
    rows: [
      { _id: "a", value: 1 },
      { _id: "b", value: 2 },
      { _id: "c", value: 3 },
      { _id: "d", value: 4 },
      { _id: "e", value: 5 },
    ],
  });
  const first = await scanCollection(gateway, "rows", {}, { _id: 1, value: 1 }, { observedAt: 1, pageSize: 2, safetyCeiling: 5 });
  const second = await scanCollection(gateway, "rows", {}, { _id: 1, value: 1 }, { observedAt: 1, pageSize: 2, safetyCeiling: 5 });
  assert.deepEqual(first, second);
  assert.equal(first.records.length, 5);
  await assert.rejects(
    scanCollection(gateway, "rows", {}, { _id: 1 }, { observedAt: 1, pageSize: 2, safetyCeiling: 4 }),
    /MANUAL_SCOPE_ESCALATION_REQUIRED/u,
  );
});

test("query identity binds normalized filters, projections, bounds, rows, and verification without exposing filter values", async () => {
  const gateway = new FakeReadOnlyGateway({ rows: [{ _id: "a", state: "ACTIVE", region: "X", value: 1 }] });
  const options = { observedAt: 1, pageSize: 1, safetyCeiling: 5 };
  const base = await scanCollection(gateway, "rows", { state: "ACTIVE" }, { _id: 1, value: 1 }, options);
  const differentFilterSameRows = await scanCollection(gateway, "rows", { state: "ACTIVE", region: "X" }, { _id: 1, value: 1 }, options);
  assert.notEqual(base.evidence[0]?.queryIdentityFingerprint, differentFilterSameRows.evidence[0]?.queryIdentityFingerprint);
  assert.notEqual(base.evidence[0]?.sourceStateFingerprint, differentFilterSameRows.evidence[0]?.sourceStateFingerprint);

  const reorderedFilter = await scanCollection(gateway, "rows", { region: "X", state: "ACTIVE" }, { value: 1, _id: 1 }, options);
  assert.equal(differentFilterSameRows.evidence[0]?.queryIdentityFingerprint, reorderedFilter.evidence[0]?.queryIdentityFingerprint);
  assert.equal(differentFilterSameRows.evidence[0]?.sourceStateFingerprint, reorderedFilter.evidence[0]?.sourceStateFingerprint);

  const differentProjection = await scanCollection(gateway, "rows", { state: "ACTIVE" }, { _id: 1 }, options);
  assert.notEqual(base.evidence[0]?.projectionFingerprint, differentProjection.evidence[0]?.projectionFingerprint);
  assert.notEqual(base.evidence[0]?.queryIdentityFingerprint, differentProjection.evidence[0]?.queryIdentityFingerprint);

  const operatorFilter = await scanCollection(gateway, "rows", { state: { $eq: "ACTIVE" } }, { _id: 1, value: 1 }, options);
  assert.notEqual(base.evidence[0]?.filterFingerprint, operatorFilter.evidence[0]?.filterFingerprint);
  assert.equal(new Set([base.evidence[0]?.queryIdentityFingerprint, differentFilterSameRows.evidence[0]?.queryIdentityFingerprint]).size, 2);

  const pii = await scanCollection(new FakeReadOnlyGateway({ rows: [] }), "rows", { email: "alice.private@example.test" }, { _id: 1 }, options);
  assert.equal(JSON.stringify(pii.evidence).includes("alice.private@example.test"), false);
  await assert.rejects(
    scanCollection(gateway, "rows", { unsupported: Symbol("secret") }, { _id: 1 }, options),
    /Unsupported query value grammar/u,
  );

  const countedFilters: ReadOnlyFilter[] = [];
  const recordingGateway: ReadOnlyMongoGateway = {
    ...gateway,
    ping: async () => undefined,
    findOne: gateway.findOne.bind(gateway),
    find: gateway.find.bind(gateway),
    countDocuments: async (collection, filter) => {
      countedFilters.push(filter);
      return gateway.countDocuments(collection, filter);
    },
    distinct: gateway.distinct.bind(gateway),
    aggregate: gateway.aggregate.bind(gateway),
  };
  const originalFilter = { region: "X", state: "ACTIVE" };
  await scanCollection(recordingGateway, "rows", originalFilter, { _id: 1 }, options);
  assert.equal(countedFilters.length, 4);
  assert.equal(countedFilters.every((filter) => JSON.stringify(filter) === JSON.stringify(originalFilter)), true);
});

test("closed query grammar rejects descriptor, prototype, wrapper, and cyclic bypasses without invoking getters", () => {
  assert.equal(stableSerializeRisk001QueryValue({ z: -0, a: [true, null, "x"] }), "{\"a\":[true,null,\"x\"],\"z\":0}");
  const getter = Object.create(null) as Record<string, unknown>;
  let getterRead = false;
  Object.defineProperty(getter, "unsafe", { enumerable: true, get: () => { getterRead = true; return "secret"; } });
  const inherited = Object.create({ inherited: "no" }) as Record<string, unknown>;
  inherited.own = "yes";
  const nonEnumerable = { safe: "yes" } as Record<string, unknown>;
  Object.defineProperty(nonEnumerable, "hidden", { enumerable: false, value: "no" });
  const sparse: unknown[] = [];
  sparse[1] = "hole";
  const extraArray = ["value"] as unknown[] & Record<string, unknown>;
  extraArray.extra = "no";
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  for (const value of [
    undefined, Number.NaN, Infinity, 1n, Symbol("x"), () => undefined,
    sparse, extraArray, getter, inherited, nonEnumerable, new Date(), /x/u,
    new Map(), new Set(), cyclic,
  ]) assert.throws(() => normalizeRisk001QueryValue(value), /Unsupported query value grammar/u);
  assert.equal(getterRead, false);
  const withSymbol = { safe: "yes" } as Record<string | symbol, unknown>;
  withSymbol[Symbol("x")] = "no";
  assert.throws(() => normalizeRisk001QueryValue(withSymbol), /Unsupported query value grammar/u);
  const normalized = normalizeRisk001QueryValue(Object.assign(Object.create(null), { b: 2, a: 1 }));
  assert.deepEqual(normalized, { a: 1, b: 2 });
  assert.equal(Object.isFrozen(normalized), true);
});

test("fingerprinted verification fails closed for insert, delete, equal-count replacement, and projected changes", async () => {
  const mutations: readonly ((rows: ReadOnlyDocument[]) => void)[] = [
    (rows) => rows.unshift({ _id: "0", value: 0 }),
    (rows) => rows.push({ _id: "z", value: 9 }),
    (rows) => { rows.splice(0, 1); },
    (rows) => { rows.splice(0, 1, { _id: "c", value: 3 }); },
    (rows) => { rows[0] = { _id: "a", value: 99 }; },
  ];
  for (const mutate of mutations) {
    const rows: ReadOnlyDocument[] = [{ _id: "a", value: 1 }, { _id: "b", value: 2 }];
    const gateway = new FakeReadOnlyGateway({ rows }, (method, collection, call) => {
      if (method === "count" && collection === "rows" && call === 3) mutate(rows);
    });
    await assert.rejects(
      scanCollection(gateway, "rows", {}, { _id: 1, value: 1 }, { observedAt: 1, pageSize: 1, safetyCeiling: 5 }),
      /SOURCE_STATE_CHANGED_DURING_DRY_RUN/u,
    );
  }
});

test("fingerprinted scans reject repeated or non-monotonic identities and never silently truncate", async () => {
  await assert.rejects(
    scanCollection(
      new FakeReadOnlyGateway({ rows: [{ _id: "a" }, { _id: "a" }] }),
      "rows", {}, { _id: 1 }, { observedAt: 1, pageSize: 2, safetyCeiling: 3 },
    ),
    /Non-deterministic pagination/u,
  );
  const nonMonotonic: ReadOnlyMongoGateway = {
    ...new FakeReadOnlyGateway({}),
    ping: async () => undefined,
    findOne: async () => null,
    find: async <T extends ReadOnlyDocument>() => [{ _id: "b" }, { _id: "a" }] as unknown as readonly T[],
    countDocuments: async () => 2,
    distinct: async <T>() => [] as T[],
    aggregate: async <T extends ReadOnlyDocument>() => [] as T[],
  };
  await assert.rejects(
    scanCollection(nonMonotonic, "rows", {}, { _id: 1 }, { observedAt: 1, pageSize: 2, safetyCeiling: 3 }),
    /Non-deterministic pagination/u,
  );
});

test("all loader families share one captured read set and cross-loader source drift fails closed", async () => {
  for (const target of ["roles", "employment_profiles"] as const) {
    const collections: Record<string, ReadOnlyDocument[]> = {
      roles: [{ _id: "role", code: "STAFF_CONSOLE_USER", state: "ACTIVE", permissions: [] }],
      role_assignments: [], users: [], employment_profiles: [{ _id: "profile", employmentStatus: "ACTIVE" }],
      talents: [], talent_group_members: [], talent_groups: [], bundle_assignments: [],
    };
    const gateway = new FakeReadOnlyGateway(collections, (method, collection, call) => {
      if (method === "count" && collection === target && call === 3) {
        collections[target][0] = { ...collections[target][0], changedProjectedValue: true, ...(target === "roles" ? { code: "CHANGED" } : { employmentStatus: "TERMINATED" }) };
      }
    });
    await assert.rejects(
      loadAllRisk001PlannerInputs(gateway, { observedAt: 1, pageSize: 2, safetyCeiling: 10 }),
      /SOURCE_STATE_CHANGED_DURING_DRY_RUN/u,
    );
  }
});

test("all eight loaders handle an empty database deterministically", async () => {
  const gateway = new FakeReadOnlyGateway({});
  const first = await loadAllRisk001PlannerInputs(gateway, { observedAt: 100, pageSize: 2, safetyCeiling: 10 });
  const second = await loadAllRisk001PlannerInputs(gateway, { observedAt: 100, pageSize: 2, safetyCeiling: 10 });
  assert.deepEqual(first, second);
  assert.deepEqual(Object.keys(first.inputs).sort(), [
    "RISK001_ACCOUNT_CONTEXT_READINESS",
    "RISK001_BUNDLE_CONSISTENCY",
    "RISK001_COARSE_KPI_SCOPE",
    "RISK001_LEGACY_ROLE_RETIREMENT",
    "RISK001_ROLE_DRIFT",
    "RISK001_SCOPE_FINGERPRINT",
    "RISK001_STALE_KPI_DATA",
    "RISK001_TALENT_IDENTITY_READINESS",
  ]);
  assert.equal(Object.values(first.inputs).every((records) => Array.isArray(records)), true);
  const roleDrift = first.inputs.RISK001_ROLE_DRIFT as readonly { readonly sourceKind?: string; readonly reconciliationIssues?: readonly string[] }[];
  assert.equal(roleDrift.length > 0, true);
  assert.equal(roleDrift.every((record) => record.sourceKind === "CATALOG_ONLY" && record.reconciliationIssues?.includes("CANONICAL_ROLE_MISSING_FROM_PERSISTENCE")), true);
  assert.equal(Object.entries(first.inputs).filter(([id]) => id !== "RISK001_ROLE_DRIFT").every(([, records]) => (records as readonly unknown[]).length === 0), true);
});

test("all eight loaders map canonical, stale, legacy, missing-subject, and identity fixtures", async () => {
  const template = getRoleTemplate("STAFF_CONSOLE_USER");
  assert.ok(template);
  const now = 1_000;
  const gateway = new FakeReadOnlyGateway({
    roles: [
      { _id: "role-canonical", code: template.code, state: "ACTIVE", permissions: template.permissions, templateCode: template.code, templateVersion: template.version },
      { _id: "role-legacy", code: "ADMIN_FULL", state: "ACTIVE", permissions: ["legacy.permission"] },
    ],
    role_assignments: [
      { _id: "assignment-canonical", roleId: "role-canonical", userId: "user-1", state: "ACTIVE", effectiveAt: 0, expiresAt: null, revokedAt: null, scopeGrants: { kpi: ["self"] }, structuredScopeGrants: [{ scopeType: "self" }], scopeFingerprint: "wrong", origin: "BUNDLE", bundleOrigin: { bundleAssignmentId: "bundle-1", bundleCode: "STAFF_CONSOLE_BUNDLE", bundleVersion: "2026-06-26" } },
      { _id: "assignment-legacy", roleId: "role-legacy", userId: "user-1", state: "ACTIVE", effectiveAt: 0, expiresAt: null, revokedAt: null, origin: "LEGACY" },
      { _id: "assignment-missing-subject", roleId: "role-canonical", userId: "user-1", state: "ACTIVE", effectiveAt: 0, expiresAt: null, revokedAt: null, structuredScopeGrants: [{ scopeType: "managedTalentGroup", targetId: "missing-group" }], scopeFingerprint: "wrong" },
    ],
    bundle_assignments: [
      { _id: "bundle-1", targetUserId: "user-1", bundleCode: "STAFF_CONSOLE_BUNDLE", bundleVersion: "2026-06-26", status: "ACTIVE", effectiveAt: 0, expiresAt: null, childRoleAssignmentIds: ["assignment-canonical"], sourceTrace: { source: "access-assignment.apply" } },
    ],
    users: [{ _id: "user-1", accountStatus: "ACTIVE", actorKind: "STAFF", accountContexts: ["STAFF_CONSOLE"] }],
    employment_profiles: [{ _id: "profile-1", linkedUserId: "user-1", employmentStatus: "ACTIVE" }],
    talents: [
      { _id: "talent-linked", talentOrigin: "INTERNAL", operationalStatus: "ACTIVE", linkedEmploymentProfileId: "profile-1" },
      { _id: "talent-external", talentOrigin: "EXTERNAL", operationalStatus: "ACTIVE", linkedEmploymentProfileId: null },
    ],
    talent_group_members: [{ _id: "member-1", groupId: "group-1", talentId: "talent-linked", membershipStatus: "ACTIVE" }],
    talent_groups: [{ _id: "group-1", status: "ACTIVE" }],
    kpi_plans: [{ _id: "plan-1", subjectType: "TALENT_GROUP", subjectId: "group-1", status: "PUBLISHED", createdByActorId: "actor", updatedByActorId: "actor" }],
    kpi_target_metrics: [{ _id: "metric-1", kpiPlanId: "plan-1" }],
    kpi_allocations: [{ _id: "allocation-1", kpiPlanId: "plan-1", subjectId: "group-1", memberTalentId: "talent-linked", createdByActorId: "actor", updatedByActorId: "actor" }],
    kpi_actual_entries: [{ _id: "actual-1", kpiPlanId: "plan-1", allocationId: "allocation-1", memberTalentId: "talent-linked", createdByActorId: "actor", updatedByActorId: "actor" }],
    kpi_actual_corrections: [{ _id: "correction-1", actualEntryId: "actual-1", kpiPlanId: "plan-1", allocationId: "allocation-1", correctedByActorId: "actor" }],
    kpi_allocation_operations: [{ _id: "operation-1", kpiPlanId: "plan-1", actorId: "actor", operation: "PUBLISH", idempotencyKey: "key", payloadFingerprint: "fingerprint", completedAt: now }],
    kpi_actual_slot_excuses: [{ _id: "excuse-1", kpiPlanId: "plan-1", allocationId: "allocation-1", createdByActorId: "actor", updatedByActorId: "actor" }],
  });
  const loaded = await loadAllRisk001PlannerInputs(gateway, { observedAt: now, pageSize: 2, safetyCeiling: 20 });
  for (const records of Object.values(loaded.inputs)) assert.equal((records as readonly unknown[]).length > 0, true);
  const scope = loaded.inputs.RISK001_SCOPE_FINGERPRINT as readonly { readonly assignmentId: string; readonly subjectsExist: boolean }[];
  assert.equal(scope.find((item) => item.assignmentId === "assignment-missing-subject")?.subjectsExist, false);
  const talents = loaded.inputs.RISK001_TALENT_IDENTITY_READINESS as readonly { readonly talentId: string; readonly externalOnly: boolean; readonly evidenceUnambiguous: boolean }[];
  assert.equal(talents.find((item) => item.talentId === "talent-linked")?.evidenceUnambiguous, true);
  assert.equal(talents.find((item) => item.talentId === "talent-external")?.externalOnly, true);
  const stale = loaded.inputs.RISK001_STALE_KPI_DATA as readonly { readonly sourceClassification: string; readonly dependencyCount: number }[];
  assert.equal(stale.some((item) => item.sourceClassification === "PRESERVE_DUE_TO_DEPENDENCY" && item.dependencyCount > 0), true);
  assert.deepEqual(
    [...new Set((loaded.inputs.RISK001_STALE_KPI_DATA as readonly { readonly kind: string }[]).map((item) => item.kind))].sort(),
    ["ACTUAL", "ALLOCATION", "ALLOCATION_OPERATION", "CORRECTION", "METRIC", "PLAN", "SLOT_EXCUSE"],
  );
  const bundle = (loaded.inputs.RISK001_BUNDLE_CONSISTENCY as readonly { readonly classifications: readonly string[] }[])[0];
  assert.deepEqual(bundle?.classifications, ["MATCHED"]);
  const coarse = (loaded.inputs.RISK001_COARSE_KPI_SCOPE as readonly { readonly productionCallerCount: number; readonly consumerIds: readonly string[]; readonly compatibilityVersion: string }[])[0];
  assert.equal(coarse?.productionCallerCount, coarse?.consumerIds.length);
  assert.equal(coarse?.productionCallerCount, KPI_COARSE_SCOPE_COMPATIBILITY_INVENTORY.consumers.length);
  assert.equal(coarse?.compatibilityVersion, KPI_COARSE_SCOPE_COMPATIBILITY_INVENTORY.version);
});

test("Talent readiness uses canonical lifecycle, link, group, and external-origin evidence", async () => {
  const gateway = new FakeReadOnlyGateway({
    employment_profiles: [
      { _id: "p-active", employmentStatus: "ACTIVE" },
      { _id: "p-leave", employmentStatus: "ON_LEAVE" },
      { _id: "p-suspended", employmentStatus: "SUSPENDED" },
      { _id: "p-shared", employmentStatus: "ACTIVE" },
      { _id: "p-inactive", employmentStatus: "ACTIVE" },
      { _id: "p-external", employmentStatus: "ACTIVE" },
    ],
    talents: [
      { _id: "valid", talentOrigin: "INTERNAL", operationalStatus: "ACTIVE", linkedEmploymentProfileId: "p-active" },
      { _id: "leave", talentOrigin: "INTERNAL", operationalStatus: "ACTIVE", linkedEmploymentProfileId: "p-leave" },
      { _id: "suspended-profile", talentOrigin: "INTERNAL", operationalStatus: "ACTIVE", linkedEmploymentProfileId: "p-suspended" },
      { _id: "inactive", talentOrigin: "INTERNAL", operationalStatus: "INACTIVE", linkedEmploymentProfileId: "p-inactive" },
      { _id: "missing", talentOrigin: "INTERNAL", operationalStatus: "ACTIVE", linkedEmploymentProfileId: null },
      { _id: "external", talentOrigin: "EXTERNAL", operationalStatus: "ACTIVE", linkedEmploymentProfileId: null },
      { _id: "external-linked", talentOrigin: "EXTERNAL", operationalStatus: "ACTIVE", linkedEmploymentProfileId: "p-external" },
      { _id: "shared-1", talentOrigin: "INTERNAL", operationalStatus: "ACTIVE", linkedEmploymentProfileId: "p-shared" },
      { _id: "shared-2", talentOrigin: "INTERNAL", operationalStatus: "ACTIVE", linkedEmploymentProfileId: "p-shared" },
    ],
    talent_groups: [{ _id: "active-group", status: "ACTIVE" }, { _id: "inactive-group", status: "INACTIVE" }],
    talent_group_members: [
      { _id: "m-valid", groupId: "active-group", talentId: "valid", membershipStatus: "ACTIVE" },
      { _id: "m-invalid", groupId: "inactive-group", talentId: "leave", membershipStatus: "ACTIVE" },
    ],
  });
  const loaded = await loadTalentIdentityPlannerRecords(gateway, { observedAt: 1, pageSize: 3, safetyCeiling: 20 });
  const byId = new Map(loaded.records.map((record) => [record.talentId, record.readinessClassification]));
  assert.equal(byId.get("valid"), "VALID_OPERATIONAL_IDENTITY");
  assert.equal(byId.get("leave"), "INACTIVE_OR_INVALID_GROUP");
  assert.equal(byId.get("suspended-profile"), "INELIGIBLE_EMPLOYMENT_PROFILE");
  assert.equal(byId.get("inactive"), "INACTIVE_TALENT");
  assert.equal(byId.get("missing"), "MISSING_EMPLOYMENT_PROFILE");
  assert.equal(byId.get("external"), "EXTERNAL_ONLY_TALENT");
  assert.equal(byId.get("external-linked"), "FORBIDDEN_EXTERNAL_PROFILE_LINK");
  assert.equal(byId.get("shared-1"), "AMBIGUOUS_MULTIPLE_LINKS");
});

test("Batch B role drift reconciles catalog and persistence in both directions through the loader and planner", async () => {
  const template = getRoleTemplate("STAFF_CONSOLE_USER");
  assert.ok(template);
  const loaded = await loadRoleDriftPlannerRecords(new FakeReadOnlyGateway({
    roles: [
      { _id: "exact", code: template.code, state: "ACTIVE", templateCode: template.code, templateVersion: template.version, permissions: template.permissions },
      { _id: "inactive", code: template.code, state: "INACTIVE", templateCode: template.code, templateVersion: template.version, permissions: template.permissions },
      { _id: "unknown", code: "UNKNOWN", state: "ACTIVE", permissions: [] },
    ], role_assignments: [],
  }), { observedAt: 1, pageSize: 10, safetyCeiling: 50 });
  const actions = roleDriftPlanner.plan(loaded.records);
  assert.equal(actions.some((action) => action.reasonCode === "CANONICAL_ROLE_MISSING_FROM_PERSISTENCE"), true);
  assert.equal(actions.some((action) => action.reasonCode === "PERSISTED_CANONICAL_ROLE_INACTIVE"), true);
  assert.equal(actions.some((action) => action.reasonCode === "DUPLICATE_PERSISTED_CANONICAL_IDENTITY"), true);
  assert.equal(actions.some((action) => action.reasonCode === "UNKNOWN_ORPHAN"), true);
  const exactOnly = await loadRoleDriftPlannerRecords(new FakeReadOnlyGateway({
    roles: [{ _id: "exact-only", code: template.code, state: "ACTIVE", templateCode: template.code, templateVersion: template.version, permissions: template.permissions }], role_assignments: [],
  }), { observedAt: 1, pageSize: 10, safetyCeiling: 50 });
  assert.equal(roleDriftPlanner.plan(exactOnly.records).find((action) => action.reasonCode === "MATCHED")?.proposedAction, "NONE");
});

test("Batch B scope loader validates assignment identity before accepting an exact structured fingerprint", async () => {
  const grant = { scopeType: "self" as const };
  const fingerprint = buildRoleAssignmentScopeFingerprint([grant]);
  const loaded = await loadScopeFingerprintPlannerRecords(new FakeReadOnlyGateway({
    role_assignments: [
      { _id: "zero", roleId: "role", userId: "user", state: "ACTIVE", scopeGrants: { kpi: ["self"] } },
      { _id: "exact", roleId: "role", userId: "user", state: "ACTIVE", structuredScopeGrants: [grant], scopeFingerprint: fingerprint },
      { _id: "missing-role", userId: "user", state: "ACTIVE", structuredScopeGrants: [grant], scopeFingerprint: fingerprint },
      { _id: "missing-user", roleId: "role", state: "ACTIVE", structuredScopeGrants: [grant], scopeFingerprint: fingerprint },
      { _id: "blank-identities", roleId: " ", userId: "", state: "ACTIVE", structuredScopeGrants: [grant], scopeFingerprint: fingerprint },
      { _id: "malformed-multiple", roleId: "", userId: "user", state: "ACTIVE", structuredScopeGrants: [grant, { scopeType: "global" }], scopeFingerprint: fingerprint },
    ],
  }), { observedAt: 1, pageSize: 10, safetyCeiling: 50 });
  assert.equal(loaded.records.length, 6);
  assert.equal(loaded.records.find((record) => record.assignmentId === "zero")?.sourceClassification, "COARSE_SCOPE_ONLY");
  const exact = scopeFingerprintPlanner.plan(loaded.records.filter((record) => record.assignmentId === "exact"));
  assert.equal(exact[0]?.proposedAction, "NONE");
  assert.equal(exact[0]?.classification, "NO_MIGRATION_REQUIRED");
  const malformed = loaded.records.filter((record) => record.assignmentId !== "zero" && record.assignmentId !== "exact");
  assert.equal(malformed.every((record) => record.sourceClassification === "INVALID_ASSIGNMENT_SOURCE"), true);
  assert.equal(malformed.every((record) => record.reasonCodes?.some((reason) => reason.includes("ASSIGNMENT_"))), true);
  const malformedActions = scopeFingerprintPlanner.plan(malformed);
  assert.equal(malformedActions.every((action) => action.proposedAction === "MANUAL_REVIEW_NO_SCOPE_GRANT_MUTATION"), true);
  assert.equal(malformedActions.every((action) => action.classification === "AMBIGUOUS_MANUAL_REVIEW"), true);
});

test("Batch B talent readiness fails closed for malformed relevant memberships while preserving clean cardinality", async () => {
  const loaded = await loadTalentIdentityPlannerRecords(new FakeReadOnlyGateway({
    employment_profiles: [{ _id: "profile-0", employmentStatus: "ACTIVE" }, { _id: "profile-1", employmentStatus: "ACTIVE" }, { _id: "profile-2", employmentStatus: "ACTIVE" }, { _id: "profile-malformed", employmentStatus: "ACTIVE" }, { _id: "profile-unknown", employmentStatus: "ACTIVE" }, { _id: "profile-group", employmentStatus: "ACTIVE" }, { _id: "profile-inactive", employmentStatus: "ACTIVE" }, { _id: "profile-expired", employmentStatus: "ACTIVE" }, { _id: "profile-duplicate", employmentStatus: "ACTIVE" }],
    talents: [
      { _id: "zero", talentOrigin: "INTERNAL", operationalStatus: "ACTIVE", linkedEmploymentProfileId: "profile-0" },
      { _id: "one", talentOrigin: "INTERNAL", operationalStatus: "ACTIVE", linkedEmploymentProfileId: "profile-1" },
      { _id: "many", talentOrigin: "INTERNAL", operationalStatus: "ACTIVE", linkedEmploymentProfileId: "profile-2" },
      { _id: "malformed", talentOrigin: "INTERNAL", operationalStatus: "ACTIVE", linkedEmploymentProfileId: "profile-malformed" },
      { _id: "unknown", talentOrigin: "INTERNAL", operationalStatus: "ACTIVE", linkedEmploymentProfileId: "profile-unknown" },
      { _id: "missing-group", talentOrigin: "INTERNAL", operationalStatus: "ACTIVE", linkedEmploymentProfileId: "profile-group" },
      { _id: "inactive-plus-valid", talentOrigin: "INTERNAL", operationalStatus: "ACTIVE", linkedEmploymentProfileId: "profile-inactive" },
      { _id: "expired-plus-valid", talentOrigin: "INTERNAL", operationalStatus: "ACTIVE", linkedEmploymentProfileId: "profile-expired" },
      { _id: "duplicate", talentOrigin: "INTERNAL", operationalStatus: "ACTIVE", linkedEmploymentProfileId: "profile-duplicate" },
    ],
    talent_groups: [{ _id: "group-a", status: "ACTIVE" }, { _id: "group-b", status: "ACTIVE" }],
    talent_group_members: [
      { _id: "one-a", groupId: "group-a", talentId: "one", membershipStatus: "ACTIVE" },
      { _id: "many-a", groupId: "group-a", talentId: "many", membershipStatus: "ACTIVE" },
      { _id: "many-b", groupId: "group-b", talentId: "many", membershipStatus: "ACTIVE" },
      { _id: "malformed-valid", groupId: "group-a", talentId: "malformed", membershipStatus: "ACTIVE" },
      { _id: "malformed-missing-status", groupId: "group-a", talentId: "malformed" },
      { _id: "malformed-missing-status-2", groupId: "group-b", talentId: "malformed" },
      { _id: "unknown-valid", groupId: "group-a", talentId: "unknown", membershipStatus: "ACTIVE" },
      { _id: "unknown-status", groupId: "group-a", talentId: "unknown", membershipStatus: "UNKNOWN" },
      { _id: "missing-group-valid", groupId: "group-a", talentId: "missing-group", membershipStatus: "ACTIVE" },
      { _id: "missing-group", talentId: "missing-group", membershipStatus: "ACTIVE" },
      { _id: "inactive", groupId: "group-b", talentId: "inactive-plus-valid", membershipStatus: "INACTIVE" },
      { _id: "inactive-valid", groupId: "group-a", talentId: "inactive-plus-valid", membershipStatus: "ACTIVE" },
      { _id: "expired", groupId: "group-b", talentId: "expired-plus-valid", membershipStatus: "ACTIVE", joinedAt: 0, leftAt: 1 },
      { _id: "expired-valid", groupId: "group-a", talentId: "expired-plus-valid", membershipStatus: "ACTIVE" },
      { _id: "duplicate-a", groupId: "group-a", talentId: "duplicate", membershipStatus: "ACTIVE" },
      { _id: "duplicate-b", groupId: "group-a", talentId: "duplicate", membershipStatus: "ACTIVE" },
    ],
  }), { observedAt: 2, pageSize: 10, safetyCeiling: 50 });
  const byId = new Map(loaded.records.map((record) => [record.talentId, record]));
  assert.equal(byId.get("zero")?.readinessClassification, "NO_ACTIVE_VALID_GROUP_MEMBERSHIP");
  assert.equal(byId.get("one")?.readinessClassification, "VALID_OPERATIONAL_IDENTITY");
  assert.equal(byId.get("many")?.readinessClassification, "AMBIGUOUS_MULTIPLE_ACTIVE_VALID_GROUP_MEMBERSHIPS");
  assert.equal(byId.get("malformed")?.readinessClassification, "MALFORMED_RELEVANT_MEMBERSHIP");
  assert.equal(byId.get("unknown")?.readinessClassification, "MALFORMED_RELEVANT_MEMBERSHIP");
  assert.equal(byId.get("missing-group")?.readinessClassification, "MALFORMED_RELEVANT_MEMBERSHIP");
  assert.equal(byId.get("inactive-plus-valid")?.readinessClassification, "VALID_OPERATIONAL_IDENTITY");
  assert.equal(byId.get("expired-plus-valid")?.readinessClassification, "VALID_OPERATIONAL_IDENTITY");
  assert.equal(byId.get("duplicate")?.readinessClassification, "MALFORMED_RELEVANT_MEMBERSHIP");
  assert.equal(byId.get("malformed")?.malformedMembershipCount, 2);
  assert.equal(byId.get("malformed")?.operationalMembershipCount, 1);
  const actions = talentIdentityPlanner.plan(loaded.records);
  assert.equal(actions.find((action) => action.reasonCode === "VALID_OPERATIONAL_IDENTITY")?.proposedAction, "NONE");
  assert.equal(actions.filter((action) => action.reasonCode === "MALFORMED_RELEVANT_MEMBERSHIP").every((action) => action.classification !== "NO_MIGRATION_REQUIRED"), true);
});

test("malformed Scope and Talent source classifications survive the canonical completed-run path deterministically", async () => {
  const grant = { scopeType: "self" as const };
  const fingerprint = buildRoleAssignmentScopeFingerprint([grant]);
  const collections: Readonly<Record<string, readonly ReadOnlyDocument[]>> = {
    role_assignments: [
      { _id: "scope-exact", roleId: "role", userId: "user", state: "ACTIVE", structuredScopeGrants: [grant], scopeFingerprint: fingerprint },
      { _id: "scope-malformed", userId: "user", state: "ACTIVE", structuredScopeGrants: [grant], scopeFingerprint: fingerprint },
    ],
    employment_profiles: [{ _id: "profile", employmentStatus: "ACTIVE" }],
    talents: [{ _id: "talent", talentOrigin: "INTERNAL", operationalStatus: "ACTIVE", linkedEmploymentProfileId: "profile" }],
    talent_groups: [{ _id: "group", status: "ACTIVE" }],
    talent_group_members: [
      { _id: "membership-valid", groupId: "group", talentId: "talent", membershipStatus: "ACTIVE" },
      { _id: "membership-malformed", groupId: "group", talentId: "talent" },
    ],
  };
  const options = { observedAt: 123, pageSize: 10, safetyCeiling: 50 };
  const source = { gitCommit: "a".repeat(40), workingTreeFingerprint: "b".repeat(64), workingTreeDirty: false };
  const first = await loadAllRisk001PlannerInputs(new FakeReadOnlyGateway(collections), options);
  const reordered = await loadAllRisk001PlannerInputs(new FakeReadOnlyGateway({
    ...collections,
    role_assignments: [...collections.role_assignments].reverse(),
    talent_group_members: [...collections.talent_group_members].reverse(),
  }), options);
  const firstManifest = buildRisk001DryRunManifest({ loaded: first, source, databaseName: "media_test", observedAt: 123 });
  const reorderedManifest = buildRisk001DryRunManifest({ loaded: reordered, source, databaseName: "media_test", observedAt: 123 });
  assert.equal(firstManifest.planFingerprint, reorderedManifest.planFingerprint);
  assert.equal(firstManifest.plannerClassifications.some((action) => action.reasonCode === "INVALID_ASSIGNMENT_SOURCE" && action.proposedAction === "MANUAL_REVIEW_NO_SCOPE_GRANT_MUTATION"), true);
  assert.equal(firstManifest.plannerClassifications.some((action) => action.reasonCode === "MALFORMED_RELEVANT_MEMBERSHIP" && action.proposedAction === "MANUAL_REVIEW_NO_LINK_OR_PROFILE_FABRICATION"), true);
  assert.equal(firstManifest.plannerClassifications.some((action) => action.reasonCode === "EXACT_STRUCTURED_MATCH" && action.proposedAction === "NONE"), true);
  assert.equal(firstManifest.plannerClassifications.filter((action) => action.proposedAction !== "NONE").every((action) => action.classification !== "DETERMINISTIC_AUTO_MIGRATION"), true);
  const changed = await loadAllRisk001PlannerInputs(new FakeReadOnlyGateway({
    ...collections,
    talent_group_members: collections.talent_group_members.filter((membership) => (membership as { readonly _id: string })._id !== "membership-malformed"),
  }), options);
  const changedManifest = buildRisk001DryRunManifest({ loaded: changed, source, databaseName: "media_test", observedAt: 123 });
  assert.notEqual(firstManifest.planFingerprint, changedManifest.planFingerprint);
});

test("Batch B legacy readiness exposes every dependency dimension and blocks unresolved replacements", async () => {
  const loaded = await loadLegacyRolePlannerRecords(new FakeReadOnlyGateway({
    roles: [{ _id: "legacy", code: "ADMIN_FULL", state: "ACTIVE", permissions: ["legacy"] }],
    role_assignments: [], bundle_assignments: [], users: [], employment_profiles: [], responsibility_assignments: [],
  }), { observedAt: 1, pageSize: 10, safetyCeiling: 50 });
  const record = loaded.records[0];
  assert.equal(record?.dependencyDimensions?.length, 10);
  const action = legacyRolePlanner.plan(loaded.records)[0];
  assert.equal(action?.reasonCode, "LEGACY_ROLE_UNRESOLVED_DEPENDENCY");
  assert.equal(action?.proposedAction, "PRESERVE_LEGACY_ROLE_FOR_MANUAL_REVIEW");
});

test("Account Context readiness rejects suspended and terminated operational profiles", async () => {
  for (const employmentStatus of ["SUSPENDED", "TERMINATED", "ARCHIVED"]) {
    const loaded = await loadAccountContextPlannerRecords(new FakeReadOnlyGateway({
      roles: [{ _id: "role", code: "STAFF_CONSOLE_USER", state: "ACTIVE", templateCode: "STAFF_CONSOLE_USER" }],
      role_assignments: [{ _id: "assignment", roleId: "role", userId: "user", state: "ACTIVE" }],
      users: [{ _id: "user", accountStatus: "ACTIVE", actorKind: "STAFF", accountContexts: ["STAFF_CONSOLE"] }],
      employment_profiles: [{ _id: "profile", linkedUserId: "user", employmentStatus }],
    }), { observedAt: 1, pageSize: 2, safetyCeiling: 10 });
    assert.equal(loaded.records[0]?.eligibilityProven, false);
  }
});

test("Account Context readiness rejects conflicting profiles, empty policy sets, and unknown Roles without vacuous truth", async () => {
  const load = async (profiles: readonly ReadOnlyDocument[], role: ReadOnlyDocument = { _id: "role", code: "STAFF_CONSOLE_USER", state: "ACTIVE", templateCode: "STAFF_CONSOLE_USER" }) =>
    loadAccountContextPlannerRecords(new FakeReadOnlyGateway({
      roles: [role],
      role_assignments: [{ _id: "assignment", roleId: "role", userId: "user", state: "ACTIVE" }],
      users: [{ _id: "user", accountStatus: "ACTIVE", actorKind: "STAFF", accountContexts: ["STAFF_CONSOLE"] }],
      employment_profiles: profiles,
    }), { observedAt: 1, pageSize: 2, safetyCeiling: 10 });

  const exact = (await load([{ _id: "active", linkedUserId: "user", employmentStatus: "ACTIVE" }])).records[0];
  assert.equal(exact?.eligibilityProven, true);
  const onLeave = (await load([{ _id: "leave", linkedUserId: "user", employmentStatus: "ON_LEAVE" }])).records[0];
  assert.equal(onLeave?.eligibilityProven, true);
  for (const profiles of [
    [{ _id: "active", linkedUserId: "user", employmentStatus: "ACTIVE" }, { _id: "suspended", linkedUserId: "user", employmentStatus: "SUSPENDED" }],
    [{ _id: "a", linkedUserId: "user", employmentStatus: "ACTIVE" }, { _id: "b", linkedUserId: "user", employmentStatus: "ACTIVE" }],
    [{ _id: "active", linkedUserId: "user", employmentStatus: "ACTIVE" }, { _id: "terminated", linkedUserId: "user", employmentStatus: "TERMINATED" }],
    [],
  ] as readonly (readonly ReadOnlyDocument[])[]) {
    const record = (await load(profiles)).records[0];
    assert.equal(record?.eligibilityProven, false);
    assert.equal((record?.ambiguityReasons.length ?? 0) > 0, true);
  }
  const unknown = (await load([], { _id: "role", code: "MANUAL_UNKNOWN", state: "ACTIVE" })).records[0];
  assert.equal(unknown?.policyOwnerKnown, false);
  assert.equal(unknown?.recommendedContexts.length, 0);
  assert.equal(unknown?.eligibilityProven, false);
});

test("bundle reconciliation distinguishes matched, lifecycle, catalog, duplicate, origin, and orphan states", async () => {
  const classify = async (params: {
    readonly parent?: ReadOnlyDocument;
    readonly assignments?: readonly ReadOnlyDocument[];
    readonly roles?: readonly ReadOnlyDocument[];
  }) => (await loadBundleConsistencyPlannerRecords(new FakeReadOnlyGateway({
    bundle_assignments: [params.parent ?? { _id: "bundle", targetUserId: "user", bundleCode: "STAFF_CONSOLE_BUNDLE", bundleVersion: "2026-06-26", status: "ACTIVE", effectiveAt: 0, expiresAt: null, childRoleAssignmentIds: ["child"], sourceTrace: { owner: "apply" } }],
    role_assignments: params.assignments ?? [{ _id: "child", roleId: "role", userId: "user", state: "ACTIVE", effectiveAt: 0, expiresAt: null, origin: "BUNDLE", bundleOrigin: { bundleAssignmentId: "bundle", bundleCode: "STAFF_CONSOLE_BUNDLE", bundleVersion: "2026-06-26" } }],
    roles: params.roles ?? [{ _id: "role", code: "STAFF_CONSOLE_USER", state: "ACTIVE" }],
  }), { observedAt: 100, pageSize: 2, safetyCeiling: 10 })).records[0]?.classifications ?? [];

  assert.deepEqual(await classify({}), ["MATCHED"]);
  assert.equal((await classify({ parent: { _id: "bundle", targetUserId: "user", bundleCode: "STAFF_CONSOLE_BUNDLE", bundleVersion: "2026-06-26", status: "ACTIVE", childRoleAssignmentIds: [], sourceTrace: {} }, assignments: [] })).includes("MISSING_EXPECTED_CHILD"), true);
  assert.equal((await classify({ assignments: [
    { _id: "child", roleId: "role", userId: "user", state: "ACTIVE", origin: "BUNDLE", bundleOrigin: { bundleAssignmentId: "bundle", bundleCode: "STAFF_CONSOLE_BUNDLE", bundleVersion: "2026-06-26" } },
    { _id: "child-2", roleId: "role", userId: "user", state: "ACTIVE", origin: "BUNDLE", bundleOrigin: { bundleAssignmentId: "bundle", bundleCode: "STAFF_CONSOLE_BUNDLE", bundleVersion: "2026-06-26" } },
  ] })).includes("DUPLICATE_CHILD_ROLE"), true);
  assert.equal((await classify({ assignments: [{ _id: "child", roleId: "role", userId: "user", state: "REVOKED", origin: "BUNDLE", bundleOrigin: { bundleAssignmentId: "bundle", bundleCode: "STAFF_CONSOLE_BUNDLE", bundleVersion: "2026-06-26" } }] })).includes("REVOKED_OR_INEFFECTIVE_CHILD"), true);
  assert.equal((await classify({ parent: { _id: "bundle", targetUserId: "user", bundleCode: "STAFF_CONSOLE_BUNDLE", bundleVersion: "2026-06-26", status: "EXPIRED", childRoleAssignmentIds: ["child"], sourceTrace: {} } })).includes("PARENT_INACTIVE_OR_EXPIRED"), true);
  assert.equal((await classify({ parent: { _id: "bundle", targetUserId: "user", bundleCode: "STAFF_CONSOLE_BUNDLE", bundleVersion: "old", status: "ACTIVE", childRoleAssignmentIds: ["child"], sourceTrace: {} } })).includes("CATALOG_VERSION_MISMATCH"), true);
  assert.equal((await classify({ assignments: [{ _id: "child", roleId: "role", userId: "user", state: "ACTIVE", origin: "BUNDLE", bundleOrigin: { bundleAssignmentId: "other", bundleCode: "STAFF_CONSOLE_BUNDLE", bundleVersion: "2026-06-26" } }] })).includes("ORIGIN_MISMATCH"), true);
  assert.equal((await classify({ parent: { _id: "bundle", targetUserId: "user", bundleCode: "STAFF_CONSOLE_BUNDLE", bundleVersion: "2026-06-26", status: "ACTIVE", childRoleAssignmentIds: [], sourceTrace: {} } })).includes("ORPHAN_CHILD_LINK"), true);
  assert.equal((await classify({ roles: [{ _id: "role", code: "WRONG_ROLE", state: "ACTIVE" }] })).includes("EXTRA_CHILD"), true);
  assert.equal((await classify({ assignments: [{ _id: "child", roleId: "role", userId: "different-user", state: "ACTIVE", origin: "BUNDLE", bundleOrigin: { bundleAssignmentId: "bundle", bundleCode: "STAFF_CONSOLE_BUNDLE", bundleVersion: "2026-06-26" } }] })).includes("TARGET_USER_MISMATCH"), true);
  assert.equal((await classify({ roles: [{ _id: "role", code: "STAFF_CONSOLE_USER", state: "INACTIVE" }] })).includes("ROLE_MISSING_OR_INACTIVE"), true);
  assert.equal((await classify({ roles: [] })).includes("ROLE_MISSING_OR_INACTIVE"), true);
  for (const child of [
    { _id: "omitted", roleId: "role", userId: "user", state: "ACTIVE", origin: "BUNDLE", bundleOrigin: { bundleAssignmentId: "bundle", bundleCode: "WRONG", bundleVersion: "2026-06-26" } },
    { _id: "omitted", roleId: "role", userId: "user", state: "ACTIVE", origin: "BUNDLE", bundleOrigin: { bundleAssignmentId: "bundle", bundleCode: "STAFF_CONSOLE_BUNDLE", bundleVersion: "wrong" } },
    { _id: "omitted", roleId: "role", userId: "different-user", state: "ACTIVE", origin: "BUNDLE", bundleOrigin: { bundleAssignmentId: "bundle", bundleCode: "STAFF_CONSOLE_BUNDLE", bundleVersion: "2026-06-26" } },
  ]) {
    const classifications = await classify({ assignments: [
      { _id: "child", roleId: "role", userId: "user", state: "ACTIVE", origin: "BUNDLE", bundleOrigin: { bundleAssignmentId: "bundle", bundleCode: "STAFF_CONSOLE_BUNDLE", bundleVersion: "2026-06-26" } },
      child,
    ] });
    assert.equal(classifications.includes("ORPHAN_CHILD_LINK"), true);
    assert.equal(classifications.includes(child.userId === "user" ? "ORIGIN_MISMATCH" : "TARGET_USER_MISMATCH"), true);
  }
  assert.equal((await classify({ assignments: [
    { _id: "child", roleId: "role", userId: "user", state: "ACTIVE", origin: "BUNDLE", bundleOrigin: { bundleAssignmentId: "bundle", bundleCode: "STAFF_CONSOLE_BUNDLE", bundleVersion: "2026-06-26" } },
    { _id: "revoked-duplicate", roleId: "role", userId: "user", state: "REVOKED", origin: "BUNDLE", bundleOrigin: { bundleAssignmentId: "bundle", bundleCode: "STAFF_CONSOLE_BUNDLE", bundleVersion: "2026-06-26" } },
  ] })).includes("DUPLICATE_CHILD_ROLE"), true);
});

test("legacy Role bundle dependencies require exact active parent, child, user, Role, and origin ownership", async () => {
  const load = async (status: string, listed: boolean, childUser = "user", roleState = "ACTIVE") => loadLegacyRolePlannerRecords(new FakeReadOnlyGateway({
    roles: [{ _id: "legacy", code: "ADMIN_FULL", state: roleState, permissions: [] }],
    role_assignments: [{ _id: "child", roleId: "legacy", userId: childUser, state: "ACTIVE", origin: "BUNDLE", bundleOrigin: { bundleAssignmentId: "parent", bundleCode: "STAFF_CONSOLE_BUNDLE", bundleVersion: "2026-06-26" } }],
    bundle_assignments: [{ _id: "parent", targetUserId: "user", bundleCode: "STAFF_CONSOLE_BUNDLE", bundleVersion: "2026-06-26", status, childRoleAssignmentIds: listed ? ["child"] : [] }],
    users: [],
  }), { observedAt: 1, pageSize: 2, safetyCeiling: 10 });
  assert.equal((await load("ACTIVE", true)).records[0]?.bundleParentCount, 1);
  assert.equal((await load("EXPIRED", true)).records[0]?.bundleParentCount, 0);
  assert.equal((await load("ACTIVE", false)).records[0]?.bundleParentCount, 0);
  assert.equal((await load("ACTIVE", true, "different-user")).records[0]?.bundleParentCount, 0);
  assert.equal((await load("ACTIVE", true, "user", "INACTIVE")).records[0]?.bundleParentCount, 0);
});

test("all persisted KPI families are classified conservatively with no unsafe delete", async () => {
  const loaded = await loadStaleKpiPlannerRecords(new FakeReadOnlyGateway({
    kpi_plans: [
      { _id: "historical", subjectType: "TALENT_GROUP", subjectId: "g", status: "PUBLISHED" },
      { _id: "archive", status: "ARCHIVED", archivedAt: 1 },
    ],
    kpi_target_metrics: [{ _id: "metric", kpiPlanId: "historical" }],
    kpi_allocations: [{ _id: "allocation", kpiPlanId: "historical" }],
    kpi_actual_entries: [{ _id: "actual", kpiPlanId: "historical", allocationId: "allocation" }],
    kpi_actual_corrections: [{ _id: "correction", actualEntryId: "actual", kpiPlanId: "historical", allocationId: "allocation" }],
    kpi_allocation_operations: [{ _id: "operation", kpiPlanId: "historical", actorId: "actor", operation: "PUBLISH", idempotencyKey: "key", payloadFingerprint: "fp", result: null, createdAt: 1, completedAt: 2 }],
    kpi_actual_slot_excuses: [{ _id: "excuse", kpiPlanId: "historical", allocationId: "allocation" }],
  }), { observedAt: 1, pageSize: 2, safetyCeiling: 20 });
  const byId = new Map(loaded.records.map((record) => [record.id, record]));
  assert.equal(byId.get("operation")?.sourceClassification, "PRESERVE_DUE_TO_DEPENDENCY");
  assert.equal(byId.get("archive")?.sourceClassification, "MANUAL_REVIEW_REQUIRED");
  assert.equal(byId.get("actual")?.sourceClassification, "PRESERVE_DUE_TO_DEPENDENCY");
  assert.equal(loaded.records.some((record) => record.sourceClassification === "CURRENT_CANONICAL" && record.materialSummary.contractVersion === undefined), false);
  assert.deepEqual([...new Set(loaded.records.map((record) => record.kind))].sort(), ["ACTUAL", "ALLOCATION", "ALLOCATION_OPERATION", "CORRECTION", "METRIC", "PLAN", "SLOT_EXCUSE"]);
});

test("complete current KPI contracts classify every persisted family as canonical", async () => {
  const loaded = await loadStaleKpiPlannerRecords(new FakeReadOnlyGateway({
    kpi_plans: [{ _id: "plan", planCode: "P", subjectType: "TALENT_GROUP", subjectId: "g", status: "PUBLISHED", lifecycleStatus: "ACTIVE", currencyCode: "VND", periodMonth: "2026-07", periodStartAt: 1, periodEndAt: 2, timezone: "Asia/Saigon", actualPolicySnapshot: { timezone: "Asia/Ho_Chi_Minh", entryOpenLocalTime: "00:00", entryLockLocalTime: "12:00", maxDirectEditsPerEntry: 2, correctionAllowedUntil: "PLAN_FINALIZED", policyVersion: "v", policySource: "DEFAULT", snapshottedAt: 1 }, publishedAt: 2, publishedByActorId: "a", finalizedAt: null, finalizedByActorId: null, finalResult: null, archivedAt: null, archivedByActorId: null, createdAt: 1, createdByActorId: "a", updatedAt: 2, updatedByActorId: "a" }],
    kpi_target_metrics: [{ _id: "metric", kpiPlanId: "plan", metricCode: "REVENUE_VND", targetValue: 1, targetValueExact: "1", allocationMode: "GROUP_ONLY", allocationScale: 0, groupRemainderExact: "1", unit: "VND", rollupMethod: "SUM", actualSource: "MANUAL", actualCaptureMode: "GROUP_ENTRY", actualReviewMode: "NONE", actualEvidenceMode: "NONE", actualPolicyVersion: "v", createdAt: 1, updatedAt: 2 }],
    kpi_allocations: [{ _id: "allocation", kpiPlanId: "plan", subjectType: "TALENT_GROUP", subjectId: "g", groupId: "g", memberEmploymentProfileId: null, memberTalentId: null, membershipId: null, allocationStatus: "PUBLISHED", lifecycleStatus: "PUBLISHED", allocationMode: "GROUP_ONLY", sourcePlanVersion: 1, allocationVersion: 1, membershipSnapshotVersion: "snapshot", eligibleMemberSnapshot: {}, idempotencyKey: "k", idempotencyFingerprint: "f", correlationId: "c", supersedesAllocationId: null, correctsAllocationId: null, allocationStartDate: "2026-07-01", allocationEndDate: null, targetMetrics: [], snapshotMemberDisplayName: null, note: null, createdAt: 1, createdByActorId: "a", updatedAt: 2, updatedByActorId: "a", submittedAt: 2, submittedByActorId: "a", approvedAt: 3, approvedByActorId: "b", approvalNote: null, rejectedAt: null, rejectedByActorId: null, rejectionReason: null, publishedAt: 4, publishedByActorId: "a", closedAt: null }],
    kpi_actual_entries: [{ _id: "actual", kpiPlanId: "plan", allocationId: "allocation", memberEmploymentProfileId: null, memberTalentId: null, metricCode: "REVENUE_VND", actualDate: "2026-07-01", actualValue: 1, effectiveValue: 1, acceptedValue: 1, acceptedVersion: 1, editCount: 0, correctionCount: 1, latestCorrectionId: "correction", lifecycleStatus: "ACCEPTED", entryVersion: 1, captureMode: "GROUP_ENTRY", aggregationMethod: "SUM", reviewMode: "NONE", evidenceMode: "NONE", policyVersion: "v", sourceFingerprint: null, acceptedInputVersions: [], derivationVersion: null, createdAt: 1, createdByActorId: "a", updatedAt: 2, updatedByActorId: "a", lastEditedAt: null, lastEditedByActorId: null }],
    kpi_actual_corrections: [{ _id: "correction", actualEntryId: "actual", kpiPlanId: "plan", allocationId: "allocation", metricCode: "REVENUE_VND", actualDate: "2026-07-01", previousValue: 0, correctedValue: 1, previousEntryVersion: 0, replacementEntryVersion: 1, replacementLifecycleStatus: "CORRECTED", requiresReview: false, idempotencyKey: "k", payloadFingerprint: "f", reason: "fix", correctedByActorId: "a", correctedAt: 2, createdAt: 2 }],
    kpi_allocation_operations: [{ _id: "operation", kpiPlanId: "plan", actorId: "a", operation: "PUBLISH", idempotencyKey: "k", payloadFingerprint: "f", result: {}, createdAt: 1, completedAt: 2 }],
    kpi_actual_slot_excuses: [{ _id: "excuse", kpiPlanId: "plan", allocationId: "allocation", metricCode: "REVENUE_VND", actualDate: "2026-07-01", status: "EXCUSED", reasonCode: "OTHER", reasonText: "reason", createdAt: 1, createdByActorId: "a", updatedAt: 2, updatedByActorId: "a", deletedAt: null, deletedByActorId: null }],
  }), { observedAt: 1, pageSize: 2, safetyCeiling: 20 });
  assert.equal(loaded.records.length, 7);
  assert.equal(loaded.records.every((record) => record.sourceClassification === "CURRENT_CANONICAL"), true);
  const allocation = loaded.records.find((record) => record.kind === "ALLOCATION");
  assert.equal(allocation?.materialSummary.contractVersion, "RISK001-KPI-PERSISTED-CONTRACT-2026-07-V1");
});

test("incomplete KPI lineage and lifecycle evidence never classify current canonical", async () => {
  const plan = { _id: "plan", actualPolicySnapshot: { policyVersion: "v" } };
  const metric = { _id: "metric", kpiPlanId: "plan", metricCode: "REVENUE_VND", actualCaptureMode: "DERIVED", actualReviewMode: "NONE", actualEvidenceMode: "NONE", actualPolicyVersion: "v", rollupMethod: "SUM" };
  const allocationBase = {
    _id: "allocation", kpiPlanId: "plan", subjectType: "TALENT_GROUP", subjectId: "g", groupId: "g",
    memberEmploymentProfileId: null, memberTalentId: null, membershipId: null, allocationStatus: "APPROVED",
    lifecycleStatus: "APPROVED", allocationMode: "GROUP_ONLY", sourcePlanVersion: 1, allocationVersion: 1,
    membershipSnapshotVersion: "snapshot", eligibleMemberSnapshot: {}, idempotencyKey: "k", idempotencyFingerprint: "f",
    correlationId: "c", supersedesAllocationId: null, correctsAllocationId: null, allocationStartDate: "2026-07-01",
    allocationEndDate: null, targetMetrics: [], snapshotMemberDisplayName: null, createdAt: 1, createdByActorId: "a",
    updatedAt: 2, updatedByActorId: "a", submittedAt: 2, submittedByActorId: "a", approvedAt: null,
    approvedByActorId: null, rejectedAt: null, rejectedByActorId: null, rejectionReason: null, publishedAt: null,
    publishedByActorId: null, closedAt: null,
  };
  const actualWithoutLineage = {
    _id: "actual", kpiPlanId: "plan", allocationId: "allocation", memberEmploymentProfileId: null, memberTalentId: null,
    metricCode: "REVENUE_VND", actualDate: "2026-07-01", actualValue: 1, effectiveValue: 1, acceptedValue: 1,
    acceptedVersion: 1, editCount: 0, correctionCount: 0, latestCorrectionId: null, lifecycleStatus: "ACCEPTED",
    entryVersion: 1, captureMode: "DERIVED", aggregationMethod: "SUM", reviewMode: "NONE", evidenceMode: "NONE",
    policyVersion: "v", createdAt: 1, createdByActorId: "a", updatedAt: 2, updatedByActorId: "a",
    lastEditedAt: null, lastEditedByActorId: null,
  };
  const loaded = await loadStaleKpiPlannerRecords(new FakeReadOnlyGateway({
    kpi_plans: [plan],
    kpi_target_metrics: [metric],
    kpi_allocations: [allocationBase],
    kpi_actual_entries: [actualWithoutLineage],
  }), { observedAt: 1, pageSize: 2, safetyCeiling: 20 });
  const actual = loaded.records.find((record) => record.id === "actual");
  assert.notEqual(actual?.sourceClassification, "CURRENT_CANONICAL");
  assert.equal(actual?.missingMaterialFields.includes("sourceFingerprint"), true);
  assert.equal(actual?.missingMaterialFields.includes("acceptedInputVersions"), true);
  assert.equal(actual?.missingMaterialFields.includes("derivationVersion"), true);
  const allocation = loaded.records.find((record) => record.id === "allocation");
  assert.notEqual(allocation?.sourceClassification, "CURRENT_CANONICAL");
  assert.equal(allocation?.missingMaterialFields.includes("approvedByActorId"), true);
  assert.equal(allocation?.missingMaterialFields.includes("approvedAt"), true);
  assert.equal(loaded.records.some((record) => record.sourceClassification === "CURRENT_CANONICAL" && record.materialSummary.contractVersion === undefined), false);
});

test("KPI family evaluators enforce state-conditional evidence while permitting absent inapplicable fields", async () => {
  const base: Record<string, ReadOnlyDocument[]> = {
    kpi_plans: [{ _id: "plan", planCode: "P", subjectType: "TALENT_GROUP", subjectId: "g", status: "DRAFT", lifecycleStatus: "DRAFT", currencyCode: "VND", periodMonth: "2026-07", periodStartAt: 1, periodEndAt: 2, timezone: "Asia/Saigon", actualPolicySnapshot: null, createdAt: 1, createdByActorId: "a", updatedAt: 2, updatedByActorId: "a" }],
    kpi_target_metrics: [{ _id: "metric", kpiPlanId: "plan", metricCode: "REVENUE_VND", targetValue: 1, targetValueExact: "1", allocationMode: "GROUP_ONLY", allocationScale: 0, groupRemainderExact: "1", unit: "VND", rollupMethod: "SUM", actualSource: "MANUAL", actualCaptureMode: "GROUP_ENTRY", actualReviewMode: "NONE", actualEvidenceMode: "NONE", actualPolicyVersion: "v", createdAt: 1, updatedAt: 2 }],
    kpi_allocations: [{ _id: "allocation", kpiPlanId: "plan", subjectType: "TALENT_GROUP", subjectId: "g", groupId: "g", memberEmploymentProfileId: null, memberTalentId: null, membershipId: null, allocationStatus: "DRAFT", lifecycleStatus: "DRAFT", allocationMode: "GROUP_ONLY", sourcePlanVersion: 1, allocationVersion: 1, membershipSnapshotVersion: "snapshot", eligibleMemberSnapshot: {}, idempotencyKey: "k", idempotencyFingerprint: "f", correlationId: "c", supersedesAllocationId: null, correctsAllocationId: null, allocationStartDate: "2026-07-01", allocationEndDate: null, targetMetrics: [], snapshotMemberDisplayName: null, createdAt: 1, createdByActorId: "a", updatedAt: 2, updatedByActorId: "a" }],
    kpi_actual_entries: [{ _id: "actual", kpiPlanId: "plan", allocationId: "allocation", memberEmploymentProfileId: null, memberTalentId: null, metricCode: "REVENUE_VND", actualDate: "2026-07-01", actualValue: 1, effectiveValue: 0, editCount: 0, correctionCount: 0, latestCorrectionId: null, lifecycleStatus: "DRAFT", entryVersion: 1, captureMode: "GROUP_ENTRY", aggregationMethod: "SUM", reviewMode: "NONE", evidenceMode: "NONE", policyVersion: "v", sourceFingerprint: null, acceptedInputVersions: [], derivationVersion: null, createdAt: 1, createdByActorId: "a", updatedAt: 2, updatedByActorId: "a", lastEditedAt: null, lastEditedByActorId: null }],
    kpi_actual_corrections: [{ _id: "correction", actualEntryId: "actual", kpiPlanId: "plan", allocationId: "allocation", metricCode: "REVENUE_VND", actualDate: "2026-07-01", previousValue: 0, correctedValue: 1, previousEntryVersion: 1, replacementEntryVersion: 2, replacementLifecycleStatus: "CORRECTED", requiresReview: false, idempotencyKey: "k", payloadFingerprint: "f", reason: "fix", correctedByActorId: "a", correctedAt: 2, createdAt: 2 }],
    kpi_allocation_operations: [{ _id: "operation", kpiPlanId: "plan", actorId: "a", operation: "DRAFT", idempotencyKey: "k", payloadFingerprint: "f", result: null, createdAt: 1, completedAt: null }],
    kpi_actual_slot_excuses: [{ _id: "excuse", kpiPlanId: "plan", allocationId: "allocation", metricCode: "REVENUE_VND", actualDate: "2026-07-01", status: "EXCUSED", reasonCode: "OTHER", reasonText: "reason", createdAt: 1, createdByActorId: "a", updatedAt: 2, updatedByActorId: "a" }],
  };
  const recordsFor = async (collections: Readonly<Record<string, readonly ReadOnlyDocument[]>>) =>
    (await loadStaleKpiPlannerRecords(new FakeReadOnlyGateway(collections), { observedAt: 1, pageSize: 2, safetyCeiling: 20 })).records;
  assert.equal((await recordsFor(base)).every((record) => record.sourceClassification === "CURRENT_CANONICAL"), true);

  const cases: readonly { readonly id: string; readonly mutate: (collections: Record<string, ReadOnlyDocument[]>) => void }[] = [
    { id: "plan", mutate: (c) => { c.kpi_plans![0] = { ...c.kpi_plans![0], status: "PUBLISHED", lifecycleStatus: "ACTIVE" }; } },
    { id: "metric", mutate: (c) => { const { actualReviewMode: _removed, ...metric } = c.kpi_target_metrics![0] as Record<string, unknown>; c.kpi_target_metrics![0] = metric; } },
    { id: "allocation", mutate: (c) => { c.kpi_allocations![0] = { ...c.kpi_allocations![0], allocationStatus: "PENDING_APPROVAL", lifecycleStatus: "SUBMITTED" }; } },
    { id: "allocation", mutate: (c) => { c.kpi_allocations![0] = { ...c.kpi_allocations![0], allocationStatus: "APPROVED", lifecycleStatus: "APPROVED", submittedAt: 2, submittedByActorId: "a" }; } },
    { id: "allocation", mutate: (c) => { c.kpi_allocations![0] = { ...c.kpi_allocations![0], allocationStatus: "REJECTED", lifecycleStatus: "CHANGES_REQUESTED", submittedAt: 2, submittedByActorId: "a" }; } },
    { id: "allocation", mutate: (c) => { c.kpi_allocations![0] = { ...c.kpi_allocations![0], allocationStatus: "PUBLISHED", lifecycleStatus: "PUBLISHED", submittedAt: 2, submittedByActorId: "a", approvedAt: 3, approvedByActorId: "b" }; } },
    { id: "actual", mutate: (c) => { const { sourceFingerprint: _source, acceptedInputVersions: _inputs, derivationVersion: _derivation, ...actual } = c.kpi_actual_entries![0] as Record<string, unknown>; c.kpi_actual_entries![0] = { ...actual, captureMode: "DERIVED" }; } },
    { id: "actual", mutate: (c) => { c.kpi_actual_entries![0] = { ...c.kpi_actual_entries![0], lifecycleStatus: "ACCEPTED" }; } },
    { id: "actual", mutate: (c) => { c.kpi_actual_entries![0] = { ...c.kpi_actual_entries![0], editCount: 1 }; } },
    { id: "correction", mutate: (c) => { c.kpi_actual_corrections![0] = { ...c.kpi_actual_corrections![0], requiresReview: true, replacementLifecycleStatus: "CORRECTED" }; } },
    { id: "correction", mutate: (c) => { const { reason: _removed, ...correction } = c.kpi_actual_corrections![0] as Record<string, unknown>; c.kpi_actual_corrections![0] = correction; } },
    { id: "operation", mutate: (c) => { c.kpi_allocation_operations![0] = { ...c.kpi_allocation_operations![0], completedAt: 2 }; } },
    { id: "operation", mutate: (c) => { const { idempotencyKey: _removed, ...operation } = c.kpi_allocation_operations![0] as Record<string, unknown>; c.kpi_allocation_operations![0] = operation; } },
    { id: "excuse", mutate: (c) => { c.kpi_actual_slot_excuses![0] = { ...c.kpi_actual_slot_excuses![0], deletedAt: 2 }; } },
    { id: "excuse", mutate: (c) => { const { reasonCode: _removed, ...excuse } = c.kpi_actual_slot_excuses![0] as Record<string, unknown>; c.kpi_actual_slot_excuses![0] = excuse; } },
  ];
  for (const fixture of cases) {
    const collections = structuredClone(base);
    fixture.mutate(collections);
    const record = (await recordsFor(collections)).find((item) => item.id === fixture.id);
    assert.notEqual(record?.sourceClassification, "CURRENT_CANONICAL", `${fixture.id} fixture must fail closed`);
  }
});

test("manifest and summary are deterministic, sanitized, bounded, and explicitly no-write", async () => {
  const template = getRoleTemplate("STAFF_CONSOLE_USER");
  assert.ok(template);
  const loaded = await loadAllRisk001PlannerInputs(
    new FakeReadOnlyGateway({
      roles: [{ _id: "private-role-id", code: template.code, state: "ACTIVE", permissions: template.permissions.slice(1), templateCode: template.code, templateVersion: template.version }],
      role_assignments: [],
    }),
    { observedAt: 123, pageSize: 2, safetyCeiling: 10 },
  );
  const source = { gitCommit: "a".repeat(40), workingTreeFingerprint: "b".repeat(64), workingTreeDirty: true };
  const first = buildRisk001DryRunManifest({ loaded, source, databaseName: "media_test", observedAt: 123, maxSamples: 1, runLabel: "first" });
  const second = buildRisk001DryRunManifest({ loaded, source, databaseName: "media_test", observedAt: 999, maxSamples: 10, runLabel: "second" });
  assert.equal(first.planFingerprint, second.planFingerprint);
  const changedSource = buildRisk001DryRunManifest({ loaded, source: { ...source, workingTreeFingerprint: "c".repeat(64) }, databaseName: "media_test", observedAt: 123 });
  assert.notEqual(first.planFingerprint, changedSource.planFingerprint);
  const changedReadSet = buildRisk001DryRunManifest({
    loaded: {
      ...loaded,
      evidence: loaded.evidence.map((item, index) => index === 0 ? { ...item, sourceStateFingerprint: "d".repeat(64) } : item),
      loaderOutcomes: loaded.loaderOutcomes.map((outcome) => ({
        ...outcome,
        sourceStateFingerprints: outcome.sourceStateFingerprints.map((fingerprint) =>
          fingerprint === loaded.evidence[0]?.sourceStateFingerprint ? "d".repeat(64) : fingerprint),
      })),
    },
    source,
    databaseName: "media_test",
    observedAt: 123,
  });
  assert.notEqual(first.planFingerprint, changedReadSet.planFingerprint);
  assert.equal(JSON.stringify(first).includes("private-role-id"), false);
  assert.equal(first.databaseWriteCapability, "STRUCTURALLY_ABSENT");
  assert.equal(Object.values(first.sanitizedSamples).every((samples) => samples.length <= 1), true);
  assert.equal(first.enterpriseContractVersion, RISK001_ENTERPRISE_CONTRACT_VERSION);
  assert.equal(first.queryGrammarVersion, RISK001_QUERY_GRAMMAR_VERSION);
  assert.equal(first.sourceProjectionContractVersion, RISK001_SOURCE_PROJECTION_CONTRACT_VERSION);
  assert.equal(first.loaderOutcomes.length, 8);
  assert.equal(first.assessmentOutcomes.length, 8);
  assert.equal(first.runCompletionState.status, "ASSESSMENT_COMPLETE");
  assert.equal(first.publicationState.protocol, "SUMMARY_THEN_MANIFEST_LAST");
  assert.equal(first.sanitizationState.status, "SANITIZED");
  for (const changedFamily of [
    { ...first, enterpriseContractVersion: "contract-next" },
    { ...first, queryGrammarVersion: "query-next" },
    { ...first, sourceProjectionContractVersion: "projection-next" },
  ]) {
    assert.notEqual(fingerprintRisk001CompletedRun(changedFamily), first.planFingerprint);
  }
  assert.throws(() => fingerprintRisk001CompletedRun({ ...first, loaderOutcomes: first.loaderOutcomes.slice(1) }), /LOADER_OUTCOMES_INCOMPLETE/u);
  assert.throws(() => fingerprintRisk001CompletedRun({ ...first, publicationState: { ...first.publicationState, protocol: "changed" } }), /COMPLETED_RUN_PUBLICATION_STATE_INVALID/u);
  assert.throws(() => fingerprintRisk001CompletedRun({ ...first, sanitizationState: { ...first.sanitizationState, status: "changed" } }), /COMPLETED_RUN_SANITIZATION_STATE_INVALID/u);
  const summary = renderRisk001Summary(first);
  assert.equal(summary.includes("No database write occurred."), true);
  assert.equal(summary.includes("Owner manifest review."), true);
  for (const required of [
    RISK001_ENTERPRISE_CONTRACT_VERSION,
    RISK001_QUERY_GRAMMAR_VERSION,
    RISK001_SOURCE_PROJECTION_CONTRACT_VERSION,
    "ASSESSMENT_RUN_STATUS: ASSESSMENT_COMPLETE",
    "PUBLICATION_PROTOCOL: SUMMARY_THEN_MANIFEST_LAST",
    "SANITIZATION_STATUS: SANITIZED",
  ]) assert.equal(summary.includes(required), true, `summary reconciles ${required}`);
  for (const areaId of RISK001_REQUIRED_ASSESSMENT_AREA_IDS) {
    assert.equal(summary.includes(`${areaId}: status=COMPLETED`), true);
  }
});

test("completed-run fingerprint canonicalizes semantic sets and rejects incomplete or contradictory snapshots", async () => {
  const template = getRoleTemplate("STAFF_CONSOLE_USER");
  assert.ok(template);
  const loaded = await loadAllRisk001PlannerInputs(new FakeReadOnlyGateway({
    roles: [{ _id: "role", code: template.code, state: "ACTIVE", permissions: template.permissions.slice(1), templateCode: template.code, templateVersion: template.version }],
  }), { observedAt: 1, pageSize: 2, safetyCeiling: 10 });
  const manifest = buildRisk001DryRunManifest({
    loaded,
    source: { gitCommit: "a".repeat(40), workingTreeFingerprint: "b".repeat(64), workingTreeDirty: false },
    databaseName: "media_test",
    observedAt: 1,
  });
  const semanticSets = {
    ...manifest,
    plannerClassifications: manifest.plannerClassifications.map((action, index) => index === 0 ? {
      ...action,
      dependencyChecks: ["dependency-b", "dependency-a"],
      preconditions: ["precondition-b", "precondition-a"],
      plannedAfter: { ...action.plannedAfter, candidates: ["candidate-b", "candidate-a"], blockers: ["blocker-b", "blocker-a"] },
    } : action),
  };
  const reorderedSets = {
    ...semanticSets,
    loaderOutcomes: [...semanticSets.loaderOutcomes].reverse(),
    assessmentOutcomes: [...semanticSets.assessmentOutcomes].reverse(),
    plannerClassifications: semanticSets.plannerClassifications.map((action, index) => index === 0 ? {
      ...action,
      dependencyChecks: [...action.dependencyChecks].reverse(),
      preconditions: [...action.preconditions].reverse(),
      plannedAfter: {
        ...action.plannedAfter,
        candidates: [...(action.plannedAfter.candidates as string[])].reverse(),
        blockers: [...(action.plannedAfter.blockers as string[])].reverse(),
      },
    } : action).reverse(),
  };
  assert.equal(fingerprintRisk001CompletedRun(semanticSets), fingerprintRisk001CompletedRun(reorderedSets));
  assert.notEqual(fingerprintRisk001CompletedRun(manifest), fingerprintRisk001CompletedRun({
    ...manifest,
    source: { ...manifest.source, workingTreeFingerprint: "c".repeat(64) },
  }));
  assert.equal(fingerprintRisk001CompletedRun({ ...manifest, observedAt: "2026-01-01T00:00:00.000Z", runLabel: "display-only" }), manifest.planFingerprint);
  assert.throws(() => fingerprintRisk001CompletedRun({ ...manifest, publicationState: undefined }), /COMPLETED_RUN_MISSING:publicationState/u);
  assert.throws(() => fingerprintRisk001CompletedRun({ ...manifest, sanitizationState: undefined }), /COMPLETED_RUN_MISSING:sanitizationState/u);
  assert.throws(() => fingerprintRisk001CompletedRun({ ...manifest, loaderOutcomes: manifest.loaderOutcomes.slice(1) }), /LOADER_OUTCOMES_INCOMPLETE/u);
  assert.throws(() => fingerprintRisk001CompletedRun({ ...manifest, loaderOutcomes: [...manifest.loaderOutcomes, manifest.loaderOutcomes[0]!] }), /COMPLETED_RUN_DUPLICATE:loaderOutcomes/u);
  assert.throws(() => fingerprintRisk001CompletedRun({
    ...manifest,
    assessmentOutcomes: [{ ...manifest.assessmentOutcomes[0]!, areaId: "UNKNOWN" }, ...manifest.assessmentOutcomes.slice(1)],
  }), /ASSESSMENT_OUTCOMES_INCOMPLETE/u);

  const rawPlannerContradiction = {
    ...manifest,
    plannerClassifications: manifest.plannerClassifications.map((action, index) => index === 0 ? { ...action, expectedEffect: "contradictory raw planner display" } : action),
  };
  assert.equal(renderRisk001Summary(rawPlannerContradiction), renderRisk001Summary(manifest));
  assert.throws(() => renderRisk001Summary({
    ...manifest,
    assessmentOutcomes: manifest.assessmentOutcomes.map((outcome, index) => index === 0 ? { ...outcome, actionCount: outcome.actionCount + 1 } : outcome),
  }), /COMPLETED_RUN_TOTAL_MISMATCH/u);
});

test("completion gate reconciles all eight areas, allows findings, and rejects every incomplete state", async () => {
  const loaded = await loadAllRisk001PlannerInputs(
    new FakeReadOnlyGateway({}),
    { observedAt: 123, pageSize: 2, safetyCeiling: 10 },
  );
  const source = { gitCommit: "a".repeat(40), workingTreeFingerprint: "b".repeat(64), workingTreeDirty: false };
  const params = { loaded, source, databaseName: "media_test", observedAt: 123 };
  const complete = buildRisk001DryRunManifest(params);
  assert.equal(complete.runCompletionState.completionGate, "PASSED");
  assert.equal(complete.loaderOutcomes.length, 8);
  assert.equal(complete.assessmentOutcomes.length, 8);

  const findingInputs: Readonly<Record<string, unknown>> = {
    ...loaded.inputs,
    RISK001_LEGACY_ROLE_RETIREMENT: [{
      id: "legacy",
      code: "LEGACY_ADMIN",
      activeAssignmentCount: 1,
      bundleParentCount: 0,
      bundleChildCount: 0,
      accountContextDependencyCount: 0,
      effectivePermissions: [],
      replacementRoleCodes: [],
    }],
    RISK001_SCOPE_FINGERPRINT: [{
      assignmentId: "ambiguous",
      grants: [],
      subjectsExist: false,
    }],
  };
  const withFindings = {
    ...loaded,
    inputs: findingInputs,
    loaderOutcomes: loaded.loaderOutcomes.map((outcome) => ({
      ...outcome,
      recordCount: Array.isArray(findingInputs[outcome.areaId])
        ? (findingInputs[outcome.areaId] as readonly unknown[]).length
        : 0,
    })),
  };
  const findingsManifest = buildRisk001DryRunManifest({ ...params, loaded: withFindings });
  assert.equal(findingsManifest.runCompletionState.status, "ASSESSMENT_COMPLETE");
  assert.equal(findingsManifest.aggregateTotals.blockingClassificationCount > 0, true);
  assert.equal(findingsManifest.aggregateTotals.candidateCount > 0, true);
  assert.equal(renderRisk001Summary(findingsManifest).includes("OWNER_REVIEW_REQUIRED"), true);

  const loaderFailure = {
    ...loaded,
    exceptions: ["CAPTURED_LOADER_FAILURE"],
    loaderOutcomes: loaded.loaderOutcomes.map((outcome, index) => index === 0
      ? { ...outcome, status: "INCOMPLETE" as const, exceptionCount: 1 }
      : outcome),
  };
  assert.throws(() => buildRisk001DryRunManifest({ ...params, loaded: loaderFailure }), /incomplete/u);
  assert.throws(() => buildRisk001DryRunManifest({ ...params, loaded: { ...loaded, loaderOutcomes: loaded.loaderOutcomes.slice(1) } }), /incomplete/u);
  assert.throws(() => buildRisk001DryRunManifest({
    ...params,
    loaded: { ...loaded, readState: { ...loaded.readState, capturedReadVerification: "FAILED" as const } },
  }), /incomplete/u);
  assert.throws(() => buildRisk001DryRunManifest({
    ...params,
    loaded: { ...loaded, readState: { ...loaded.readState, paginationConsistency: "FAILED" as const } },
  }), /incomplete/u);

  const malformedInputs = {
    ...loaded.inputs,
    RISK001_SCOPE_FINGERPRINT: [{ assignmentId: "broken", grants: null, subjectsExist: true }],
  };
  const malformedLoaded = {
    ...loaded,
    inputs: malformedInputs,
    loaderOutcomes: loaded.loaderOutcomes.map((outcome) => outcome.areaId === "RISK001_SCOPE_FINGERPRINT"
      ? { ...outcome, recordCount: 1 }
      : outcome),
  };
  assert.throws(() => buildRisk001DryRunManifest({ ...params, loaded: malformedLoaded }));

  const { RISK001_STALE_KPI_DATA: _missingInput, ...missingInputs } = loaded.inputs;
  assert.throws(() => buildRisk001DryRunManifest({ ...params, loaded: { ...loaded, inputs: missingInputs } }), /incomplete/u);
  assert.equal(validateRisk001RunCompletion({ loaded, assessmentOutcomes: complete.assessmentOutcomes.slice(1) }).eligible, false);
  assert.equal(validateRisk001RunCompletion({ loaded, assessmentOutcomes: [] }).eligible, false);

  let rendererInvoked = false;
  assert.throws(() => prepareRisk001CompletedArtifacts(params, false, {
    buildManifest: () => { throw new Error("manifest builder failure"); },
    renderSummary: () => { rendererInvoked = true; return "unreachable"; },
  }), /manifest builder failure/u);
  assert.equal(rendererInvoked, false);
  assert.throws(() => prepareRisk001CompletedArtifacts(params, false, {
    buildManifest: buildRisk001DryRunManifest,
    renderSummary: () => { throw new Error("summary renderer failure"); },
  }), /summary renderer failure/u);
});

test("CLI parsing requires an external absolute directory and rejects mutation-like or unknown arguments", () => {
  const backendRoot = path.resolve("D:/media/backend");
  const valid = parseRisk001CliArgs(["--output-dir", path.resolve("D:/media/.tmp-risk-output"), "--max-samples", "3", "--pretty", "--run-label", "audit_1"], backendRoot);
  assert.equal(valid.maxSamples, 3);
  assert.throws(() => parseRisk001CliArgs([], backendRoot), /required/u);
  assert.throws(() => parseRisk001CliArgs(["--output-dir", "relative"], backendRoot), /absolute/u);
  assert.throws(() => parseRisk001CliArgs(["--output-dir", path.join(backendRoot, "output")], backendRoot), /outside/u);
  for (const flag of ["--write", "--apply", "--execute", "--repair", "--sync", "--cleanup", "--seed"]) {
    assert.throws(() => parseRisk001CliArgs([flag, "--output-dir", path.resolve("D:/media/.tmp-risk-output")], backendRoot), /prohibited/u);
  }
  assert.throws(() => parseRisk001CliArgs(["--unknown"], backendRoot), /Unknown/u);
  for (const duplicate of [
    ["--output-dir", "D:\\media\\one", "--output-dir", "D:\\media\\two"],
    ["--max-samples", "1", "--output-dir", "D:\\media\\one", "--max-samples", "2"],
    ["--pretty", "--output-dir", "D:\\media\\one", "--pretty"],
    ["--run-label", "one", "--output-dir", "D:\\media\\one", "--run-label", "two"],
  ]) assert.throws(() => parseRisk001CliArgs(duplicate, backendRoot), /Repeated option/u);
  for (const unsafe of [
    "D:folder",
    "\\\\server\\share\\output",
    "D:\\media\\backend.\\output",
    "D:\\media\\backend \\output",
    "D:\\media\\CON\\output",
    "D:\\media\\safe\\..\\output",
  ]) assert.throws(() => parseRisk001CliArgs(["--output-dir", unsafe], backendRoot));
});

test("output preflight is non-mutating, accepts only safe states, and detects changed identity", async () => {
  const backendRoot = path.resolve("D:/media/backend");
  assert.equal(RISK001_NESTED_NONEXISTENT_OUTPUT_POLICY, "REJECT_WHEN_ANY_INTERMEDIATE_PARENT_IS_MISSING");
  const root = fs.mkdtempSync(path.resolve("D:/media/.risk001-preflight-"));
  try {
    const missing = path.join(root, "missing-output");
    const token = await preflightRisk001OutputDirectory(missing, backendRoot);
    assert.equal(fs.existsSync(missing), false);
    const ownership = await acquireRisk001OutputDirectory(token);
    assert.equal(fs.existsSync(missing), true);
    assert.equal(ownership.createdForRun, true);

    const empty = path.join(root, "empty");
    fs.mkdirSync(empty);
    const existingToken = await preflightRisk001OutputDirectory(empty, backendRoot);
    const existingOwnership = await acquireRisk001OutputDirectory(existingToken);
    assert.equal(existingOwnership.createdForRun, false);

    const occupiedFixtures = [
      ["summary-only", [["SUMMARY.md", "old"]]],
      ["manifest-only", [["manifest.json", "old"]]],
      ["owned-pair", [["SUMMARY.md", "old"], ["manifest.json", "old"]]],
      ["foreign-file", [["unexpected.txt", "foreign"]]],
      ["owned-temp", [[".manifest.json.00000000-0000-4000-8000-000000000000.tmp", "stale"]]],
    ] as const;
    for (const [name, files] of occupiedFixtures) {
      const occupied = path.join(root, name);
      fs.mkdirSync(occupied);
      for (const [fileName, contents] of files) fs.writeFileSync(path.join(occupied, fileName), contents, "utf8");
      await assert.rejects(preflightRisk001OutputDirectory(occupied, backendRoot), /empty|unoccupied/u);
      for (const [fileName, contents] of files) {
        assert.equal(fs.readFileSync(path.join(occupied, fileName), "utf8"), contents);
      }
    }
    const foreignDirectory = path.join(root, "foreign-directory");
    fs.mkdirSync(path.join(foreignDirectory, "nested"), { recursive: true });
    await assert.rejects(preflightRisk001OutputDirectory(foreignDirectory, backendRoot), /empty|unoccupied/u);

    const file = path.join(root, "existing-file");
    fs.writeFileSync(file, "no", "utf8");
    await assert.rejects(preflightRisk001OutputDirectory(file, backendRoot), /existing file/u);

    for (const protectedRoot of [
      "D:/media/backend",
      "D:/media/.codex-contract",
      "D:/media/.codex-repair",
      "D:/media/.codex-audit",
    ]) {
      await assert.rejects(preflightRisk001OutputDirectory(protectedRoot, backendRoot), /protected/u);
      await assert.rejects(preflightRisk001OutputDirectory(path.join(protectedRoot, "risk001-output"), backendRoot), /protected/u);
    }
    await assert.rejects(
      preflightRisk001OutputDirectory("d:\\MEDIA\\.CODEX-AUDIT\\risk001-output", backendRoot),
      /protected/u,
    );

    const junctionTarget = path.join(root, "junction-target");
    const junctionOutside = path.join(root, "junction-outside");
    fs.mkdirSync(junctionTarget);
    fs.symlinkSync(junctionTarget, junctionOutside, "junction");
    await assert.rejects(preflightRisk001OutputDirectory(path.join(junctionOutside, "output"), backendRoot), /reparse|alias/iu);
    const junctionBackend = path.join(root, "junction-backend");
    fs.symlinkSync(backendRoot, junctionBackend, "junction");
    await assert.rejects(preflightRisk001OutputDirectory(path.join(junctionBackend, "output"), backendRoot), /reparse|alias|backend/iu);

    const moved = path.join(root, "moved-output");
    fs.renameSync(missing, moved);
    fs.mkdirSync(missing);
    await assert.rejects(writeExactlyTwoOutputsAtomically(ownership, "{}\n", "summary\n"), /identity changed/u);

    await assert.rejects(
      preflightRisk001OutputDirectory(path.join(root, "missing-parent", "output"), backendRoot),
      /parent directory/u,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("output ownership rejection and acquisition occur before configuration loading", async () => {
  const backendRoot = path.resolve("D:/media/backend");
  const root = fs.mkdtempSync(path.resolve("D:/media/.risk001-config-boundary-"));
  let configLoads = 0;
  const configLoader = () => {
    configLoads += 1;
    return { mongoUri: "mongodb://not-used.invalid/test", mongoDbName: "test_db" };
  };
  try {
    await assert.rejects(
      prepareRisk001DryRunCli(
        { args: ["--output-dir", "D:/media/.codex-audit/risk001-output"], backendRoot },
        configLoader,
      ),
      /protected/u,
    );
    assert.equal(configLoads, 0);

    const occupied = path.join(root, "occupied");
    fs.mkdirSync(occupied);
    fs.writeFileSync(path.join(occupied, "SUMMARY.md"), "foreign", "utf8");
    await assert.rejects(
      prepareRisk001DryRunCli({ args: ["--output-dir", occupied], backendRoot }, configLoader),
      /empty|unoccupied/u,
    );
    assert.equal(configLoads, 0);
    assert.equal(fs.readFileSync(path.join(occupied, "SUMMARY.md"), "utf8"), "foreign");

    const configFailureOutput = path.join(root, "config-failure-output");
    await assert.rejects(
      prepareRisk001DryRunCli(
        { args: ["--output-dir", configFailureOutput], backendRoot },
        () => {
          configLoads += 1;
          throw new Error("configuration sentinel failure");
        },
      ),
      /configuration sentinel failure/u,
    );
    assert.equal(configLoads, 1);
    assert.equal(fs.existsSync(configFailureOutput), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("output publication records successful summary then manifest rename completion", async () => {
  const backendRoot = path.resolve("D:/media/backend");
  const root = fs.mkdtempSync(path.resolve("D:/media/.risk001-publication-success-"));
  const outputDir = path.join(root, "evidence");
  const completedPublications: string[] = [];
  try {
    const token = await preflightRisk001OutputDirectory(outputDir, backendRoot);
    await writeExactlyTwoOutputsAtomically(token, "{\"ok\":true}\n", "summary\n", {
      rename: async (source, destination) => {
        await fs.promises.rename(source, destination);
        completedPublications.push(path.basename(destination.toString()));
      },
    });
    assert.deepEqual(completedPublications, ["SUMMARY.md", "manifest.json"]);
    assert.equal(completedPublications.indexOf("SUMMARY.md"), 0);
    assert.equal(completedPublications.indexOf("manifest.json"), 1);
    assert.equal(fs.readFileSync(path.join(outputDir, "SUMMARY.md"), "utf8"), "summary\n");
    assert.equal(fs.readFileSync(path.join(outputDir, "manifest.json"), "utf8"), "{\"ok\":true}\n");
    const entries = fs.readdirSync(outputDir).sort();
    assert.deepEqual(entries, ["SUMMARY.md", "manifest.json"]);
    assert.equal(entries.some((name) => name.endsWith(".tmp")), false);
    for (let run = 1; run < 20; run += 1) {
      const repeatedOutput = path.join(root, `evidence-${run}`);
      const repeatedPublications: string[] = [];
      const repeatedToken = await preflightRisk001OutputDirectory(repeatedOutput, backendRoot);
      await writeExactlyTwoOutputsAtomically(repeatedToken, "{\"ok\":true}\n", "summary\n", {
        rename: async (source, destination) => {
          await fs.promises.rename(source, destination);
          repeatedPublications.push(path.basename(destination.toString()));
        },
      });
      assert.deepEqual(repeatedPublications, ["SUMMARY.md", "manifest.json"]);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  assert.equal(fs.existsSync(root), false);
});

test("summary publication failure prevents manifest rename completion and preserves cleanup", async () => {
  const backendRoot = path.resolve("D:/media/backend");
  const root = fs.mkdtempSync(path.resolve("D:/media/.risk001-publication-summary-failure-"));
  const outputDir = path.join(root, "evidence");
  const attemptedPublications: string[] = [];
  const completedPublications: string[] = [];
  try {
    const token = await preflightRisk001OutputDirectory(outputDir, backendRoot);
    await assert.rejects(
      () => writeExactlyTwoOutputsAtomically(token, "{\"ok\":true}\n", "summary\n", {
        rename: async (source, destination) => {
          const publication = path.basename(destination.toString());
          attemptedPublications.push(publication);
          if (publication === "SUMMARY.md") throw new Error("summary publication failure");
          await fs.promises.rename(source, destination);
          completedPublications.push(publication);
        },
      }),
      (error: unknown) => {
        assert.equal(error instanceof Error, true);
        assert.equal((error as Error).name, "Risk001SanitizedError");
        assert.equal((error as { readonly category: string }).category, "OUTPUT_FAILED");
        assert.equal((error as Error).message, "summary publication failure");
        return true;
      },
    );
    assert.deepEqual(attemptedPublications, ["SUMMARY.md"]);
    assert.deepEqual(completedPublications, []);
    assert.deepEqual(fs.readdirSync(outputDir), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  assert.equal(fs.existsSync(root), false);
});

test("manifest publication failure retains completed summary and removes temporary outputs", async () => {
  const backendRoot = path.resolve("D:/media/backend");
  const root = fs.mkdtempSync(path.resolve("D:/media/.risk001-publication-manifest-failure-"));
  const outputDir = path.join(root, "evidence");
  const attemptedPublications: string[] = [];
  const completedPublications: string[] = [];
  try {
    const token = await preflightRisk001OutputDirectory(outputDir, backendRoot);
    await assert.rejects(
      () => writeExactlyTwoOutputsAtomically(token, "{\"ok\":true}\n", "summary\n", {
        rename: async (source, destination) => {
          const publication = path.basename(destination.toString());
          attemptedPublications.push(publication);
          if (publication === "manifest.json") throw new Error("manifest publication failure");
          await fs.promises.rename(source, destination);
          completedPublications.push(publication);
        },
      }),
      (error: unknown) => {
        assert.equal(error instanceof Error, true);
        assert.equal((error as Error).name, "Risk001SanitizedError");
        assert.equal((error as { readonly category: string }).category, "OUTPUT_FAILED");
        assert.equal((error as Error).message, "manifest publication failure");
        return true;
      },
    );
    assert.deepEqual(attemptedPublications, ["SUMMARY.md", "manifest.json"]);
    assert.deepEqual(completedPublications, ["SUMMARY.md"]);
    assert.deepEqual(fs.readdirSync(outputDir), ["SUMMARY.md"]);
    assert.equal(fs.readFileSync(path.join(outputDir, "SUMMARY.md"), "utf8"), "summary\n");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  assert.equal(fs.existsSync(root), false);
});

test("importing CLI exposes functions but performs no env load, DB call, or output creation", () => {
  assert.equal(typeof runRisk001DryRunCli, "function");
  assert.equal(typeof loadRisk001RuntimeConfig, "function");
  assert.equal(fs.existsSync(path.resolve("D:/media/.tmp-risk-output")), false);
  const packageJson = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8")) as { scripts: Record<string, string> };
  assert.equal(packageJson.scripts["risk:001:dry-run"], "ts-node -r tsconfig-paths/register src/tools/migration/risk-001-dry-run.ts");
});

test("Batch C raw fake-gateway production seam preserves all seven record bindings through completed-run output", async () => {
  const loaded = await loadAllRisk001PlannerInputs(
    new FakeReadOnlyGateway(rawBatchCDependencyCollections()),
    { observedAt: 1_000, pageSize: 2, safetyCeiling: 100 },
  );
  const manifest = buildRisk001DryRunManifest({
    loaded,
    source: { gitCommit: "fixture", workingTreeFingerprint: "fixture", workingTreeDirty: true },
    databaseName: "risk001_fixture",
    observedAt: 1_000,
  });
  const dependency = manifest.dependencyResolution;
  assert.deepEqual([...new Set(dependency.propagatedBlockers.map((item) => item.edgeId))].sort(), [
    "R001-EDGE-01", "R001-EDGE-02", "R001-EDGE-03", "R001-EDGE-04",
    "R001-EDGE-05", "R001-EDGE-06", "R001-EDGE-08",
  ]);
  assert.equal(dependency.propagatedBlockers.length, 7);
  assert.equal(dependency.propagatedBlockers.some((item) => item.edgeId === "R001-EDGE-07"), false);
  assert.equal(dependency.relatedAreaAdvisories.every((item) => item.edgeId === "R001-EDGE-07" && item.downstreamBinding === "NONE_AVAILABLE"), true);
  assert.equal(dependency.assessmentStates.every((item) => item.executable === false), true);
  assert.equal(new Set(dependency.assessmentStates.map((item) => `${item.areaId}|${item.recordId}`)).size, dependency.assessmentStates.length);
  assert.match(renderRisk001Summary(manifest), /Propagated blockers: 7/u);
});

for (const edge of [
  "R001-EDGE-01", "R001-EDGE-02", "R001-EDGE-03", "R001-EDGE-04",
  "R001-EDGE-05", "R001-EDGE-06", "R001-EDGE-08",
] as const) {
  test(`Batch C raw fake-gateway ${edge} independently reaches the completed-run dependency stage`, async () => {
    const loaded = await loadAllRisk001PlannerInputs(
      new FakeReadOnlyGateway(rawBatchCDependencyCollections()),
      { observedAt: 1_000, pageSize: 2, safetyCeiling: 100 },
    );
    const manifest = buildRisk001DryRunManifest({
      loaded,
      source: { gitCommit: "fixture", workingTreeFingerprint: "fixture", workingTreeDirty: true },
      databaseName: "risk001_fixture",
      observedAt: 1_000,
    });
    const blocker = manifest.dependencyResolution.propagatedBlockers.find((item) => item.edgeId === edge);
    assert.ok(blocker);
    assert.equal(blocker.directOrTransitive, "DIRECT");
    assert.equal(blocker.propagationPath.length, 1);
    const downstream = manifest.dependencyResolution.assessmentStates.find((item) =>
      item.areaId === blocker.downstreamArea && item.recordId === blocker.downstreamRecordId,
    );
    assert.ok(downstream);
    assert.equal(downstream.propagatedBlockers.some((item) => item.edgeId === edge), true);
    assert.equal(downstream.effectiveReadiness, "BLOCKED");
    assert.equal(downstream.manualReview, "REQUIRED");
    assert.equal(downstream.executable, false);
  });
}

function rawBatchCDependencyCollections(): Record<string, ReadOnlyDocument[]> {
  return {
    roles: [{ _id: "role-legacy", code: "ADMIN_FULL", state: "ACTIVE", permissions: ["legacy.permission"] }],
    role_assignments: [{
      _id: "assignment-legacy", roleId: "role-legacy", userId: "user-1", state: "ACTIVE", effectiveAt: 0, expiresAt: null, revokedAt: null,
      scopeGrants: { kpi: ["self"] }, scopeFingerprint: "not-exact", origin: "BUNDLE",
      bundleOrigin: { bundleAssignmentId: "bundle-1", bundleCode: "STAFF_CONSOLE_BUNDLE", bundleVersion: "2026-06-26" },
    }],
    bundle_assignments: [{
      _id: "bundle-1", targetUserId: "user-1", bundleCode: "STAFF_CONSOLE_BUNDLE", bundleVersion: "2026-06-26", status: "ACTIVE", effectiveAt: 0, expiresAt: null,
      childRoleAssignmentIds: ["assignment-legacy"], sourceTrace: { source: "fixture" },
    }],
    users: [{ _id: "user-1", accountStatus: "ACTIVE", actorKind: "STAFF", accountContexts: [] }],
    employment_profiles: [{ _id: "profile-1", linkedUserId: "user-1", employmentStatus: "ACTIVE" }],
    talents: [{ _id: "talent-1", talentOrigin: "INTERNAL", operationalStatus: "ACTIVE", linkedEmploymentProfileId: "profile-1" }],
    talent_group_members: [{ _id: "member-1", groupId: "group-1", talentId: "talent-1", membershipStatus: "ACTIVE" }],
    talent_groups: [{ _id: "group-1", status: "INACTIVE" }],
    responsibility_assignments: [],
    kpi_plans: [{ _id: "plan-1", subjectType: "TALENT_GROUP", subjectId: "group-1", status: "DRAFT", lifecycleStatus: "DRAFT", planCode: "P", currencyCode: "VND", periodMonth: "2026-07", periodStartAt: 1, periodEndAt: 2, timezone: "Asia/Saigon", createdAt: 1, createdByActorId: "actor", updatedAt: 1, updatedByActorId: "actor" }],
    kpi_target_metrics: [],
    kpi_allocations: [{ _id: "allocation-1", kpiPlanId: "plan-1", subjectType: "TALENT", subjectId: "talent-1", memberTalentId: "talent-1", allocationStatus: "DRAFT", lifecycleStatus: "DRAFT", allocationMode: "GROUP_ONLY", sourcePlanVersion: 1, allocationVersion: 1, membershipSnapshotVersion: "fixture", eligibleMemberSnapshot: {}, idempotencyKey: "fixture", idempotencyFingerprint: "fixture", correlationId: "fixture", allocationStartDate: "2026-07-01", targetMetrics: [], createdAt: 1, createdByActorId: "actor", updatedAt: 1, updatedByActorId: "actor" }],
    kpi_actual_entries: [],
    kpi_actual_corrections: [],
    kpi_allocation_operations: [],
    kpi_actual_slot_excuses: [],
  };
}

function matches(row: ReadOnlyDocument, filter: ReadOnlyFilter): boolean {
  const record = row as Record<string, unknown>;
  if (Array.isArray(filter.$and)) {
    return filter.$and.every((part) => matches(row, part as ReadOnlyFilter));
  }
  return Object.entries(filter).every(([key, expected]) => {
    if (key === "$and") return true;
    if (expected && typeof expected === "object" && "$gt" in expected) {
      return typeof record[key] === "string" && record[key] > String((expected as { $gt: unknown }).$gt);
    }
    if (expected && typeof expected === "object" && "$eq" in expected) {
      return record[key] === (expected as { $eq: unknown }).$eq;
    }
    return record[key] === expected;
  });
}

function readId(row: ReadOnlyDocument): string {
  return String((row as { readonly _id: unknown })._id);
}

function canonicalKpiPersistedFixture(
  family: KpiPersistedFamily,
  override: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  const common = { createdAt: 1, updatedAt: 2 };
  const fixtures: Record<KpiPersistedFamily, Record<string, unknown>> = {
    PLAN: {
      ...common, planCode: "P", subjectType: "TALENT_GROUP", subjectId: "group",
      status: "DRAFT", lifecycleStatus: "DRAFT", currencyCode: "VND", periodMonth: "2026-07",
      periodStartAt: 1, periodEndAt: 2, timezone: "Asia/Saigon", createdByActorId: "maker", updatedByActorId: "updater",
    },
    METRIC: {
      ...common, kpiPlanId: "plan", metricCode: "REVENUE_VND", targetValue: 1, targetValueExact: "1",
      allocationMode: "GROUP_ONLY", allocationScale: 0, groupRemainderExact: "1", unit: "VND", rollupMethod: "SUM",
      actualSource: "MANUAL", actualCaptureMode: "GROUP_ENTRY", actualReviewMode: "NONE", actualEvidenceMode: "NONE", actualPolicyVersion: "v",
    },
    ALLOCATION: {
      ...common, kpiPlanId: "plan", subjectType: "TALENT_GROUP", subjectId: "group", allocationStatus: "DRAFT", lifecycleStatus: "DRAFT",
      allocationMode: "GROUP_ONLY", sourcePlanVersion: 1, allocationVersion: 1, membershipSnapshotVersion: "snapshot", eligibleMemberSnapshot: {},
      idempotencyKey: "key", idempotencyFingerprint: "fingerprint", correlationId: "correlation", allocationStartDate: "2026-07-01", targetMetrics: [],
      createdByActorId: "maker", updatedByActorId: "updater",
    },
    ACTUAL: {
      ...common, kpiPlanId: "plan", allocationId: "allocation", metricCode: "REVENUE_VND", actualDate: "2026-07-01",
      actualValue: 1, effectiveValue: 1, entryVersion: 1, captureMode: "GROUP_ENTRY", aggregationMethod: "SUM", reviewMode: "NONE",
      evidenceMode: "NONE", policyVersion: "v", createdByActorId: "maker", updatedByActorId: "updater", lifecycleStatus: "DRAFT",
    },
    CORRECTION: {
      ...common, actualEntryId: "actual", kpiPlanId: "plan", allocationId: "allocation", metricCode: "REVENUE_VND", actualDate: "2026-07-01",
      previousValue: 1, correctedValue: 2, previousEntryVersion: 1, replacementEntryVersion: 2, replacementLifecycleStatus: "CORRECTED",
      requiresReview: false, idempotencyKey: "key", payloadFingerprint: "fingerprint", reason: "present", correctedByActorId: "actor", correctedAt: 2,
    },
    ALLOCATION_OPERATION: {
      ...common, kpiPlanId: "plan", actorId: "actor", operation: "PUBLISH", idempotencyKey: "key", payloadFingerprint: "fingerprint",
    },
    SLOT_EXCUSE: {
      ...common, kpiPlanId: "plan", allocationId: "allocation", metricCode: "REVENUE_VND", actualDate: "2026-07-01",
      status: "EXCUSED", reasonCode: "OTHER", reasonText: "present", createdByActorId: "maker", updatedByActorId: "updater",
    },
  };
  return { ...fixtures[family], ...override };
}

function stateFixtureOverride(
  family: KpiPersistedFamily,
  state: string,
): Record<string, unknown> {
  const evidence = {
    publishedAt: 3, publishedByActorId: "publisher", actualPolicySnapshot: { policyVersion: "v" },
    finalizedAt: 4, finalizedByActorId: "finalizer", finalResult: {}, archivedAt: 5, archivedByActorId: "archiver",
    submittedAt: 3, submittedByActorId: "submitter", approvedAt: 4, approvedByActorId: "approver",
    rejectedAt: 4, rejectedByActorId: "reviewer", rejectionReason: "present", closedAt: 5,
    supersedesAllocationId: "prior", correctsAllocationId: "prior", note: "present",
    acceptedValue: 1, acceptedVersion: 1,
  };
  if (family === "PLAN") {
    const planEvidence = state === "PUBLISHED"
      ? { publishedAt: evidence.publishedAt, publishedByActorId: evidence.publishedByActorId, actualPolicySnapshot: evidence.actualPolicySnapshot }
      : state === "FINALIZED"
        ? { publishedAt: evidence.publishedAt, publishedByActorId: evidence.publishedByActorId, actualPolicySnapshot: evidence.actualPolicySnapshot, finalizedAt: evidence.finalizedAt, finalizedByActorId: evidence.finalizedByActorId, finalResult: evidence.finalResult }
        : state === "ARCHIVED"
          ? { archivedAt: evidence.archivedAt, archivedByActorId: evidence.archivedByActorId }
          : {};
    return { status: state, lifecycleStatus: state === "PUBLISHED" ? "ACTIVE" : state, ...planEvidence };
  }
  if (family === "ALLOCATION") {
    const pair: Record<string, readonly [string, string]> = {
      SUBMITTED: ["PENDING_APPROVAL", "SUBMITTED"], CHANGES_REQUESTED: ["PENDING_APPROVAL", "CHANGES_REQUESTED"],
      APPROVED: ["APPROVED", "APPROVED"], PUBLISHED: ["PUBLISHED", "PUBLISHED"],
      SUPERSEDED: ["CLOSED", "SUPERSEDED"], CORRECTED: ["DRAFT", "CORRECTED"],
    };
    const [allocationStatus, lifecycleStatus] = pair[state] ?? ["DRAFT", "DRAFT"];
    const allocationEvidence = state === "SUBMITTED"
      ? { submittedAt: evidence.submittedAt, submittedByActorId: evidence.submittedByActorId }
      : state === "CHANGES_REQUESTED"
        ? { submittedAt: evidence.submittedAt, submittedByActorId: evidence.submittedByActorId, rejectedAt: evidence.rejectedAt, rejectedByActorId: evidence.rejectedByActorId, rejectionReason: evidence.rejectionReason }
        : state === "APPROVED"
          ? { submittedAt: evidence.submittedAt, submittedByActorId: evidence.submittedByActorId, approvedAt: evidence.approvedAt, approvedByActorId: evidence.approvedByActorId }
          : state === "PUBLISHED"
            ? { submittedAt: evidence.submittedAt, submittedByActorId: evidence.submittedByActorId, approvedAt: evidence.approvedAt, approvedByActorId: evidence.approvedByActorId, publishedAt: evidence.publishedAt, publishedByActorId: evidence.publishedByActorId }
            : state === "SUPERSEDED"
              ? { closedAt: evidence.closedAt }
              : state === "CORRECTED"
                ? { supersedesAllocationId: evidence.supersedesAllocationId, correctsAllocationId: evidence.correctsAllocationId, note: evidence.note }
                : {};
    return { allocationStatus, lifecycleStatus, ...allocationEvidence };
  }
  if (family === "ACTUAL") return { lifecycleStatus: state, ...evidence };
  if (family === "ALLOCATION_OPERATION" && state === "COMPLETED") return { completedAt: 3, result: {} };
  if (family === "SLOT_EXCUSE" && state === "DELETED") return { deletedAt: 3, deletedByActorId: "deleter" };
  return {};
}
