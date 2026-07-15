import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import type { Db, MongoClientOptions, ReadPreference } from "mongodb";
import { getRoleTemplate } from "@modules/role/domain/role-template.catalog";
import {
  loadAllRisk001PlannerInputs,
  scanCollection,
} from "./risk-001-data-loaders";
import {
  assertReadOnlyAggregatePipeline,
  NativeReadOnlyMongoGateway,
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
  renderRisk001Summary,
} from "./risk-001-output";
import {
  loadRisk001RuntimeConfig,
  parseRisk001CliArgs,
  runRisk001DryRunCli,
} from "./risk-001-dry-run";

class FakeReadOnlyGateway implements ReadOnlyMongoGateway {
  constructor(
    private readonly collections: Readonly<Record<string, readonly ReadOnlyDocument[]>>,
  ) {}

  async ping(): Promise<void> {}

  async findOne<T extends ReadOnlyDocument>(
    collectionName: string,
    filter: ReadOnlyFilter,
    _projection: ReadOnlyProjection,
  ): Promise<T | null> {
    return (this.rows(collectionName).find((row) => matches(row, filter)) as T | undefined) ?? null;
  }

  async find<T extends ReadOnlyDocument>(
    collectionName: string,
    filter: ReadOnlyFilter,
    options: ReadOnlyFindOptions,
  ): Promise<readonly T[]> {
    return this.rows(collectionName)
      .filter((row) => matches(row, filter))
      .sort((left, right) => readId(left).localeCompare(readId(right)))
      .slice(0, options.limit) as unknown as readonly T[];
  }

  async countDocuments(collectionName: string, filter: ReadOnlyFilter): Promise<number> {
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
}

test("read-only gateway exposes only the approved DB capability names", () => {
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
  assert.equal(Object.values(first.inputs).every((records) => Array.isArray(records) && records.length === 0), true);
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
  const stale = loaded.inputs.RISK001_STALE_KPI_DATA as readonly { readonly historicalTruthKnown: boolean; readonly dependencyCount: number }[];
  assert.equal(stale.some((item) => item.historicalTruthKnown && item.dependencyCount > 0), true);
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
  const first = buildRisk001DryRunManifest({ loaded, source, databaseName: "media_test", observedAt: 123, maxSamples: 1 });
  const second = buildRisk001DryRunManifest({ loaded, source, databaseName: "media_test", observedAt: 999, maxSamples: 1 });
  assert.equal(first.planFingerprint, second.planFingerprint);
  assert.equal(JSON.stringify(first).includes("private-role-id"), false);
  assert.equal(first.databaseWriteCapability, "STRUCTURALLY_ABSENT");
  assert.equal(Object.values(first.sanitizedSamples).every((samples) => samples.length <= 1), true);
  const summary = renderRisk001Summary(first);
  assert.equal(summary.includes("No database write occurred."), true);
  assert.equal(summary.includes("Owner manifest review."), true);
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
});

test("importing CLI exposes functions but performs no env load, DB call, or output creation", () => {
  assert.equal(typeof runRisk001DryRunCli, "function");
  assert.equal(typeof loadRisk001RuntimeConfig, "function");
  assert.equal(fs.existsSync(path.resolve("D:/media/.tmp-risk-output")), false);
  const packageJson = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8")) as { scripts: Record<string, string> };
  assert.equal(packageJson.scripts["risk:001:dry-run"], "ts-node -r tsconfig-paths/register src/tools/migration/risk-001-dry-run.ts");
});

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
    return record[key] === expected;
  });
}

function readId(row: ReadOnlyDocument): string {
  return String((row as { readonly _id: unknown })._id);
}
