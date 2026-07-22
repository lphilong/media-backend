import assert from "node:assert/strict";
import test from "node:test";
import type { ClientSession, Db, Document } from "mongodb";
import type { AuditGuard } from "@core/audit/audit.guard";
import {
  AuthoritativeMutationControls,
  AuthoritativeSystemMutationBridge,
  AuthoritativeSystemMutationBridgeParams,
} from "@core/application/authoritative-admin-mutation.bridge";
import {
  assertAuthoritativeSystemMutationBoundary,
  issueAccessDeadlineWorkerInvocationForRegistrar,
} from "@core/application/authoritative-system-mutation.policy";
import { bindTraceId } from "@core/trace/trace.context";
import {
  getCurrentDomainEventCollector,
  runWithDomainEventCollector,
} from "@system/event-bridge/domain-event.types";
import {
  ACCESS_REVIEW_DEFAULT_GRACE_MS,
  evaluateRoleAssignmentEffectiveness,
} from "../domain/role-assignment-lifecycle";
import { AccessDeadlineWorkerService } from "./admin.access-deadline-worker.service";
import { buildCurrentRoleAssignmentPolicy } from "../domain/sensitive-access-policy";
import { NativeMongoAccessLifecycleRepository } from "@infra/mongo/role/access-lifecycle.repository";

type Doc = Record<string, any> & { _id: string };

class Cursor<T extends Doc> {
  constructor(private values: T[]) {}
  sort(): this {
    return this;
  }
  limit(limit: number): this {
    this.values = this.values.slice(0, limit);
    return this;
  }
  async toArray(): Promise<T[]> {
    return structuredClone(this.values);
  }
}

class Collection<T extends Doc = Doc> {
  records = new Map<string, T>();
  failNextInsert = false;
  lastAggregatePipeline: readonly Document[] | null = null;
  seed(...records: T[]): void {
    for (const record of records)
      this.records.set(record._id, structuredClone(record));
  }
  find(query: Record<string, unknown> = {}): Cursor<T> {
    return new Cursor(
      [...this.records.values()].filter((record) => matches(record, query)),
    );
  }
  async findOne(query: Record<string, unknown>): Promise<T | null> {
    const value = [...this.records.values()].find((record) =>
      matches(record, query),
    );
    return value ? structuredClone(value) : null;
  }
  async findOneAndUpdate(
    query: Record<string, unknown>,
    update: Record<string, any>,
  ): Promise<T | null> {
    const current = [...this.records.values()].find((record) =>
      matches(record, query),
    );
    if (!current) return null;
    applySet(current, update.$set ?? {});
    this.records.set(current._id, current);
    return structuredClone(current);
  }
  async insertOne(record: T): Promise<{ insertedId: string }> {
    if (this.failNextInsert) {
      this.failNextInsert = false;
      throw new Error("INJECTED_EVIDENCE_FAILURE");
    }
    if (this.records.has(record._id))
      throw Object.assign(new Error("duplicate"), { code: 11000 });
    this.records.set(record._id, structuredClone(record));
    return { insertedId: record._id };
  }
  async updateOne(
    query: Record<string, unknown>,
    update: Record<string, any>,
  ): Promise<{ modifiedCount: number }> {
    const current = [...this.records.values()].find((record) =>
      matches(record, query),
    );
    if (!current) return { modifiedCount: 0 };
    applySet(current, update.$set ?? {});
    if (update.$pull) {
      for (const [path, value] of Object.entries(update.$pull)) {
        setPath(
          current,
          path,
          (getPath(current, path) ?? []).filter(
            (item: unknown) => item !== value,
          ),
        );
      }
    }
    this.records.set(current._id, current);
    return { modifiedCount: 1 };
  }
  async updateMany(): Promise<{ modifiedCount: number }> {
    return { modifiedCount: 0 };
  }
  async countDocuments(query: Record<string, unknown>): Promise<number> {
    return [...this.records.values()].filter((record) => matches(record, query))
      .length;
  }
  aggregate<TOutput extends Document>(
    pipeline: readonly Document[],
  ): {
    toArray(): Promise<TOutput[]>;
  } {
    this.lastAggregatePipeline = structuredClone(pipeline);
    return { toArray: async () => [] };
  }
}

class FakeDb {
  collections = new Map<string, Collection>();
  collection<T extends Doc = Doc>(name: string): Collection<T> {
    let value = this.collections.get(name);
    if (!value) {
      value = new Collection();
      this.collections.set(name, value);
    }
    return value as Collection<T>;
  }
  snapshot(): Map<string, Doc[]> {
    return new Map(
      [...this.collections].map(([name, collection]) => [
        name,
        structuredClone([...collection.records.values()]),
      ]),
    );
  }
  restore(snapshot: Map<string, Doc[]>): void {
    for (const [name, values] of snapshot) {
      this.collection(name).records = new Map(
        values.map((value) => [value._id, structuredClone(value)]),
      );
    }
  }
  asDb(): Db {
    return this as unknown as Db;
  }
}

class AuditCapture {
  records: Array<{
    actorId: string;
    actorType: string;
    metadata?: Record<string, unknown>;
  }> = [];
  fail = false;
  async record(
    actor: any,
    _permission: unknown,
    _resourceId?: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    if (this.fail) throw new Error("INJECTED_AUDIT_FAILURE");
    this.records.push({
      actorId: actor.id,
      actorType: actor.type,
      metadata: structuredClone(metadata),
    });
  }
  asGuard(): AuditGuard {
    return this as unknown as AuditGuard;
  }
}

class SystemBridgeCapture implements AuthoritativeSystemMutationBridge {
  executions = 0;
  securityVersionChanges = 0;
  outboxEvents = 0;
  failSecurityVersionChange = false;
  beforeMutate?: () => void;
  constructor(
    private db: FakeDb,
    private audit: AuditCapture,
  ) {}
  async executeSystem<T>(
    params: AuthoritativeSystemMutationBridgeParams,
    mutate: (
      session: ClientSession,
      controls: AuthoritativeMutationControls,
      auditPermission: ReturnType<
        typeof assertAuthoritativeSystemMutationBoundary
      >,
    ) => Promise<T>,
  ): Promise<T> {
    this.executions += 1;
    const permission = assertAuthoritativeSystemMutationBoundary(params);
    this.beforeMutate?.();
    this.beforeMutate = undefined;
    const snapshot = this.db.snapshot();
    const auditLength = this.audit.records.length;
    const securityBefore = this.securityVersionChanges;
    const outboxBefore = this.outboxEvents;
    let securityChanged = false;
    let noOp = false;
    try {
      return await runWithDomainEventCollector(async () => {
        const result = await mutate(
          {} as ClientSession,
          {
            markAuthSecurityTruthChanged: () => {
              securityChanged = true;
            },
            markExplicitNoOpSuccess: () => {
              noOp = true;
            },
          },
          permission,
        );
        const events = getCurrentDomainEventCollector().drain();
        if (noOp && (securityChanged || events.length > 0))
          throw new Error("INVALID_NOOP_EFFECTS");
        if (securityChanged && this.failSecurityVersionChange) {
          throw new Error("INJECTED_SECURITY_VERSION_FAILURE");
        }
        if (securityChanged) this.securityVersionChanges += 1;
        this.outboxEvents += events.length;
        return result;
      });
    } catch (error) {
      this.db.restore(snapshot);
      this.audit.records.splice(auditLength);
      this.securityVersionChanges = securityBefore;
      this.outboxEvents = outboxBefore;
      throw error;
    }
  }
}

test("deadline worker materializes high-risk, lower-risk grace, and break-glass transitions exactly once", async () => {
  const now = 2_000_000_000_000;
  const db = new FakeDb();
  seedAssignmentRole(db);
  db.collection("role_assignments").seed(
    assignment("high", "HIGH", now - 1),
    assignment("low", "LOW", now - ACCESS_REVIEW_DEFAULT_GRACE_MS),
  );
  db.collection("break_glass_activations").seed(
    activation("activation-1", now - 1),
  );
  const audit = new AuditCapture();
  const bridge = new SystemBridgeCapture(db, audit);
  const worker = deadlineWorker(db, audit, bridge);
  const invocation =
    issueAccessDeadlineWorkerInvocationForRegistrar("deadline-job-1");

  const first = await traced(() =>
    worker.materializeDueTransitions(invocation, { now }),
  );
  assert.equal(first.assignmentSuspensions, 2);
  assert.equal(first.activationExpiries, 1);
  assert.equal(
    (await db.collection("role_assignments").findOne({ _id: "high" }))?.state,
    "SUSPENDED",
  );
  assert.equal(
    (await db.collection("role_assignments").findOne({ _id: "low" }))?.state,
    "SUSPENDED",
  );
  assert.equal(
    (
      await db
        .collection("break_glass_activations")
        .findOne({ _id: "activation-1" })
    )?.status,
    "EXPIRED",
  );
  assert.equal(audit.records.length, 3);
  assert.equal(bridge.securityVersionChanges, 3);
  assert.equal(bridge.outboxEvents, 3);
  assert.ok(audit.records.every((record) => record.actorType === "system"));
  assert.ok(
    audit.records.every(
      (record) => record.actorId === "SYSTEM_ACCESS_DEADLINE_WORKER",
    ),
  );

  const second = await traced(() =>
    worker.materializeDueTransitions(invocation, { now }),
  );
  assert.equal(second.assignmentSuspensions, 0);
  assert.equal(second.activationExpiries, 0);
  assert.equal(audit.records.length, 3);
  assert.equal(bridge.securityVersionChanges, 3);
  assert.equal(bridge.outboxEvents, 3);
});

test("renewed assignment is a deterministic stale no-op and is not suspended", async () => {
  const now = 2_000_000_000_000;
  const db = new FakeDb();
  seedAssignmentRole(db);
  db.collection("role_assignments").seed(
    assignment("renewed", "HIGH", now - 1),
  );
  const audit = new AuditCapture();
  const bridge = new SystemBridgeCapture(db, audit);
  bridge.beforeMutate = () => {
    const current = db.collection("role_assignments").records.get("renewed")!;
    current.lifecycle.cycleId = "cycle-renewed";
    current.lifecycle.reviewDeadline = now + 100_000;
    current.reviewAt = now + 100_000;
  };
  const worker = deadlineWorker(db, audit, bridge);
  const result = await traced(() =>
    worker.materializeDueTransitions(
      issueAccessDeadlineWorkerInvocationForRegistrar("deadline-job-stale"),
      { now },
    ),
  );
  assert.equal(result.assignmentSuspensions, 0);
  assert.equal(
    (await db.collection("role_assignments").findOne({ _id: "renewed" }))
      ?.state,
    "ACTIVE",
  );
  assert.equal(audit.records.length, 0);
  assert.equal(bridge.securityVersionChanges, 0);
  assert.equal(bridge.outboxEvents, 0);
});

test("due-aware selection filters before limit and cannot be starved by non-due rows", async () => {
  const now = 2_000_000_000_000;
  const db = new FakeDb();
  seedAssignmentRole(db);
  for (let index = 0; index < 5; index += 1) {
    db.collection("role_assignments").seed(
      assignment(`a-non-due-${index}`, "HIGH", now + 100_000 + index),
    );
  }
  db.collection("role_assignments").seed(assignment("z-due", "HIGH", now - 1));
  const audit = new AuditCapture();
  const bridge = new SystemBridgeCapture(db, audit);
  const worker = deadlineWorker(db, audit, bridge);

  const result = await traced(() =>
    worker.materializeDueTransitions(
      issueAccessDeadlineWorkerInvocationForRegistrar(
        "deadline-job-due-before-limit",
      ),
      { now, limit: 1 },
    ),
  );

  assert.equal(result.assignmentCandidates, 1);
  assert.equal(result.assignmentSuspensions, 1);
  assert.equal(
    (await db.collection("role_assignments").findOne({ _id: "z-due" }))?.state,
    "SUSPENDED",
  );
  assert.equal(
    (await db.collection("role_assignments").findOne({ _id: "a-non-due-0" }))
      ?.state,
    "ACTIVE",
  );
});

test("Mongo due pipeline excludes superseded ACTIVE and SCHEDULED rows before sort and limit", async () => {
  const now = 2_000_000_000_000;
  const limit = 100;
  const db = new FakeDb();
  const repository = new NativeMongoAccessLifecycleRepository(db.asDb());
  await repository.listDueLifecycleTransitionCandidates({ now, limit });
  const pipeline = db.collection("role_assignments").lastAggregatePipeline;
  assert.ok(pipeline);
  const dueMatchIndex = pipeline.findIndex(
    (stage) =>
      "$match" in stage &&
      JSON.stringify(stage).includes("candidateDeadline") &&
      JSON.stringify(stage).includes("successorAssignmentId"),
  );
  const sortIndex = pipeline.findIndex((stage) => "$sort" in stage);
  const limitIndex = pipeline.findIndex((stage) => "$limit" in stage);
  assert.ok(dueMatchIndex >= 0);
  assert.ok(sortIndex > dueMatchIndex);
  assert.ok(limitIndex > sortIndex);
  assert.equal((pipeline[limitIndex] as { $limit: number }).$limit, limit);
  const dueExpression = (
    pipeline[dueMatchIndex] as {
      $match: { $expr: unknown };
    }
  ).$match.$expr;

  for (const state of ["ACTIVE", "SCHEDULED"] as const) {
    const superseded = Array.from({ length: limit + 1 }, (_, index) => ({
      _id: `${state.toLowerCase()}-superseded-${String(index).padStart(3, "0")}`,
      state,
      effectiveAt: now - 10_000,
      currentRole: { _id: "role-1" },
      candidateDeadline: now - 1_000 - index,
      lifecycle: {
        successorAssignmentId: `successor-${index}`,
        successorEffectiveAt: now,
      },
      successorPair: "VALID_SUCCESSOR",
    }));
    const currentDue = {
      _id: `z-current-${state.toLowerCase()}`,
      state,
      effectiveAt: now - 10_000,
      currentRole: { _id: "role-1" },
      candidateDeadline: now - 1,
      lifecycle: { successorAssignmentId: null, successorEffectiveAt: null },
      successorPair: "NO_SUCCESSOR",
    };
    const selected = [...superseded, currentDue]
      .filter((document) =>
        Boolean(evaluateMongoTestExpression(dueExpression, document)),
      )
      .sort(
        (left, right) =>
          left.candidateDeadline - right.candidateDeadline ||
          left._id.localeCompare(right._id),
      )
      .slice(0, limit);
    assert.deepEqual(
      selected.map((document) => document._id),
      [currentDue._id],
    );
  }

  const base = {
    state: "SCHEDULED",
    effectiveAt: now - 1,
    currentRole: { _id: "role-1" },
    candidateDeadline: now,
    lifecycle: { successorAssignmentId: "successor" },
    successorPair: "MALFORMED_SUCCESSOR",
  };
  assert.equal(Boolean(evaluateMongoTestExpression(dueExpression, base)), true);
  assert.equal(
    Boolean(
      evaluateMongoTestExpression(dueExpression, {
        ...base,
        lifecycle: { ...base.lifecycle, successorEffectiveAt: "malformed" },
        successorPair: "MALFORMED_SUCCESSOR",
      }),
    ),
    true,
  );
  assert.equal(
    Boolean(
      evaluateMongoTestExpression(dueExpression, {
        ...base,
        lifecycle: { ...base.lifecycle, successorEffectiveAt: now + 1 },
        successorPair: "VALID_SUCCESSOR",
      }),
    ),
    true,
  );
  assert.equal(
    Boolean(
      evaluateMongoTestExpression(dueExpression, {
        ...base,
        effectiveAt: now + 1,
        lifecycle: { successorAssignmentId: null, successorEffectiveAt: null },
        successorPair: "NO_SUCCESSOR",
      }),
    ),
    false,
  );
});

test("worker materializes unresolved HIGH timing and malformed successor reductions once", async () => {
  const now = 2_000_000_000_000;
  const db = new FakeDb();
  seedAssignmentRole(db);
  db.collection("role_assignments").seed(
    {
      ...assignment("unresolved-high", "HIGH", now + 100_000),
      effectiveAt: null,
      reviewAt: null,
      lifecycle: {
        ...assignment("unused-high", "HIGH", now + 100_000).lifecycle,
        reviewDeadline: null,
      },
    },
    {
      ...assignment("malformed-successor", "HIGH", now + 100_000),
      lifecycle: {
        ...assignment("unused-lineage", "HIGH", now + 100_000).lifecycle,
        successorAssignmentId: null,
        successorEffectiveAt: now + 50_000,
      },
    },
  );
  const audit = new AuditCapture();
  const bridge = new SystemBridgeCapture(db, audit);
  const worker = deadlineWorker(db, audit, bridge);
  const invocation = issueAccessDeadlineWorkerInvocationForRegistrar(
    "deadline-job-malformed-authority",
  );

  const first = await traced(() =>
    worker.materializeDueTransitions(invocation, { now, limit: 2 }),
  );
  assert.equal(first.assignmentCandidates, 2);
  assert.equal(first.assignmentSuspensions, 2);
  assert.deepEqual(
    audit.records.map((record) => record.metadata?.reasonCode).sort(),
    ["MALFORMED_SUCCESSOR", "REVIEW_DEADLINE_UNRESOLVABLE"],
  );
  assert.equal(bridge.securityVersionChanges, 2);
  assert.equal(bridge.outboxEvents, 2);

  const second = await traced(() =>
    worker.materializeDueTransitions(invocation, { now, limit: 2 }),
  );
  assert.equal(second.assignmentSuspensions, 0);
  assert.equal(audit.records.length, 2);
  assert.equal(bridge.securityVersionChanges, 2);
  assert.equal(bridge.outboxEvents, 2);
});

test("fresh callback revalidation does not suspend repaired successor lineage", async () => {
  const now = 2_000_000_000_000;
  const db = new FakeDb();
  seedAssignmentRole(db);
  db.collection("role_assignments").seed({
    ...assignment("repaired-lineage", "HIGH", now + 100_000),
    lifecycle: {
      ...assignment("unused-repair", "HIGH", now + 100_000).lifecycle,
      successorAssignmentId: null,
      successorEffectiveAt: now + 50_000,
    },
  });
  const audit = new AuditCapture();
  const bridge = new SystemBridgeCapture(db, audit);
  bridge.beforeMutate = () => {
    const stored = db
      .collection("role_assignments")
      .records.get("repaired-lineage");
    if (stored) {
      stored.lifecycle.successorAssignmentId = null;
      stored.lifecycle.successorEffectiveAt = null;
    }
  };
  const worker = deadlineWorker(db, audit, bridge);

  const result = await traced(() =>
    worker.materializeDueTransitions(
      issueAccessDeadlineWorkerInvocationForRegistrar(
        "deadline-job-repaired-lineage",
      ),
      { now, limit: 1 },
    ),
  );
  assert.equal(result.assignmentCandidates, 1);
  assert.equal(result.assignmentSuspensions, 0);
  assert.equal(
    (
      await db
        .collection("role_assignments")
        .findOne({ _id: "repaired-lineage" })
    )?.state,
    "ACTIVE",
  );
  assert.equal(audit.records.length, 0);
  assert.equal(bridge.securityVersionChanges, 0);
  assert.equal(bridge.outboxEvents, 0);
});

test("security-version failure rolls back malformed successor suspension and evidence", async () => {
  const now = 2_000_000_000_000;
  const db = new FakeDb();
  seedAssignmentRole(db);
  db.collection("role_assignments").seed({
    ...assignment("malformed-rollback", "HIGH", now + 100_000),
    lifecycle: {
      ...assignment("unused-rollback", "HIGH", now + 100_000).lifecycle,
      successorAssignmentId: "successor",
      successorEffectiveAt: null,
    },
  });
  db.collection("assignment_suspensions");
  const audit = new AuditCapture();
  const bridge = new SystemBridgeCapture(db, audit);
  bridge.failSecurityVersionChange = true;
  const worker = deadlineWorker(db, audit, bridge);

  await assert.rejects(
    traced(() =>
      worker.materializeDueTransitions(
        issueAccessDeadlineWorkerInvocationForRegistrar(
          "deadline-job-malformed-rollback",
        ),
        { now, limit: 1 },
      ),
    ),
    /INJECTED_SECURITY_VERSION_FAILURE/u,
  );
  assert.equal(
    (
      await db
        .collection("role_assignments")
        .findOne({ _id: "malformed-rollback" })
    )?.state,
    "ACTIVE",
  );
  assert.equal(db.collection("assignment_suspensions").records.size, 0);
  assert.equal(audit.records.length, 0);
  assert.equal(bridge.securityVersionChanges, 0);
  assert.equal(bridge.outboxEvents, 0);
});

test("candidate crossing successor cutover before callback is a fresh-time zero-effect no-op", async () => {
  const selectionNow = 2_000_000_000_000;
  const cutover = selectionNow + 1;
  const db = new FakeDb();
  seedAssignmentRole(db);
  db.collection("role_assignments").seed({
    ...assignment("crossing-cutover", "HIGH", selectionNow - 1),
    lifecycle: {
      ...assignment("unused", "HIGH", selectionNow - 1).lifecycle,
      cycleId: "cycle-crossing-cutover",
      successorAssignmentId: "successor-crossing-cutover",
      successorEffectiveAt: cutover,
    },
  });
  const audit = new AuditCapture();
  const bridge = new SystemBridgeCapture(db, audit);
  const worker = deadlineWorker(db, audit, bridge, () => cutover);

  const result = await traced(() =>
    worker.materializeDueTransitions(
      issueAccessDeadlineWorkerInvocationForRegistrar(
        "deadline-job-crossing-cutover",
      ),
      { now: selectionNow, limit: 1 },
    ),
  );

  assert.equal(result.assignmentCandidates, 1);
  assert.equal(result.assignmentSuspensions, 0);
  assert.equal(
    (
      await db.collection("role_assignments").findOne({
        _id: "crossing-cutover",
      })
    )?.state,
    "ACTIVE",
  );
  assert.equal(
    await db.collection("assignment_suspensions").countDocuments({}),
    0,
  );
  assert.equal(audit.records.length, 0);
  assert.equal(bridge.securityVersionChanges, 0);
  assert.equal(bridge.outboxEvents, 0);
});

test("assignment expiry is selected as the earliest reduction boundary", async () => {
  const now = 2_000_000_000_000;
  const db = new FakeDb();
  seedAssignmentRole(db);
  db.collection("role_assignments").seed({
    ...assignment("expired-assignment", "LOW", now + 100_000),
    expiresAt: now - 1,
  });
  const audit = new AuditCapture();
  const bridge = new SystemBridgeCapture(db, audit);
  const worker = deadlineWorker(db, audit, bridge);

  const result = await traced(() =>
    worker.materializeDueTransitions(
      issueAccessDeadlineWorkerInvocationForRegistrar(
        "deadline-job-expiry-boundary",
      ),
      { now, limit: 1 },
    ),
  );

  assert.equal(result.assignmentSuspensions, 1);
  const stored = await db.collection("role_assignments").findOne({
    _id: "expired-assignment",
  });
  assert.equal(stored?.state, "SUSPENDED");
  assert.equal(stored?.lifecycle.suspensionCause, "EXPIRED");
  assert.equal(audit.records[0]?.metadata?.reasonCode, "EXPIRED");
});

test("current HIGH policy with no durable review deadline is selected when due", async () => {
  const now = 2_000_000_000_000;
  const db = new FakeDb();
  seedAssignmentRole(db);
  db.collection("role_assignments").seed({
    _id: "current-policy-only",
    roleId: "role-1",
    userId: "user-current-policy-only",
    state: "ACTIVE",
    effectiveAt: now - 31 * 24 * 60 * 60 * 1_000,
    expiresAt: null,
    reviewAt: null,
    lifecycle: null,
    structuredScopeGrants: [{ scopeType: "global" }],
    scopeFingerprint: "scope:v1:global",
    bundleOrigin: null,
  });
  const audit = new AuditCapture();
  const bridge = new SystemBridgeCapture(db, audit);
  const worker = deadlineWorker(db, audit, bridge);

  const result = await traced(() =>
    worker.materializeDueTransitions(
      issueAccessDeadlineWorkerInvocationForRegistrar(
        "deadline-job-current-policy",
      ),
      { now, limit: 1 },
    ),
  );

  assert.equal(result.assignmentSuspensions, 1);
  assert.equal(
    (
      await db.collection("role_assignments").findOne({
        _id: "current-policy-only",
      })
    )?.state,
    "SUSPENDED",
  );
  assert.equal(audit.records[0]?.metadata?.currentRiskTier, "HIGH");
});

test("audit failure rolls back expiry state, evidence, outbox, and security version", async () => {
  const now = 2_000_000_000_000;
  const db = new FakeDb();
  db.collection("break_glass_activations").seed(
    activation("activation-fail", now - 1),
  );
  const audit = new AuditCapture();
  audit.fail = true;
  const bridge = new SystemBridgeCapture(db, audit);
  const worker = deadlineWorker(db, audit, bridge);
  assert.equal(
    evaluateRoleAssignmentEffectiveness(
      {
        state: "ACTIVE",
        effectiveAt: now - 100_000,
        expiresAt: null,
        reviewAt: now - 1,
        lifecycle: {
          riskTier: "HIGH",
          reviewDeadline: now - 1,
          graceExceptionExpiresAt: null,
        },
      },
      now,
    ).effective,
    false,
  );
  await assert.rejects(
    traced(() =>
      worker.materializeDueTransitions(
        issueAccessDeadlineWorkerInvocationForRegistrar("deadline-job-fail"),
        { now },
      ),
    ),
    /INJECTED_AUDIT_FAILURE/u,
  );
  assert.equal(
    (
      await db
        .collection("break_glass_activations")
        .findOne({ _id: "activation-fail" })
    )?.status,
    "ACTIVE",
  );
  assert.equal(db.collection("break_glass_expiry_evidence").records.size, 0);
  assert.equal(bridge.securityVersionChanges, 0);
  assert.equal(bridge.outboxEvents, 0);
});

test("evidence failure rolls back assignment state, audit, outbox, and security version", async () => {
  const now = 2_000_000_000_000;
  const db = new FakeDb();
  seedAssignmentRole(db);
  db.collection("role_assignments").seed(
    assignment("evidence-fail", "HIGH", now - 1),
  );
  db.collection("assignment_suspensions").failNextInsert = true;
  const audit = new AuditCapture();
  const bridge = new SystemBridgeCapture(db, audit);
  const worker = deadlineWorker(db, audit, bridge);

  await assert.rejects(
    traced(() =>
      worker.materializeDueTransitions(
        issueAccessDeadlineWorkerInvocationForRegistrar(
          "deadline-job-evidence-fail",
        ),
        { now },
      ),
    ),
    /INJECTED_EVIDENCE_FAILURE/u,
  );

  assert.equal(
    (await db.collection("role_assignments").findOne({ _id: "evidence-fail" }))
      ?.state,
    "ACTIVE",
  );
  assert.equal(db.collection("assignment_suspensions").records.size, 0);
  assert.equal(audit.records.length, 0);
  assert.equal(bridge.securityVersionChanges, 0);
  assert.equal(bridge.outboxEvents, 0);
});

test("security-version failure rolls back expiry state, evidence, audit, and outbox", async () => {
  const now = 2_000_000_000_000;
  const db = new FakeDb();
  db.collection("break_glass_activations").seed(
    activation("security-fail", now - 1),
  );
  const audit = new AuditCapture();
  const bridge = new SystemBridgeCapture(db, audit);
  bridge.failSecurityVersionChange = true;
  const worker = deadlineWorker(db, audit, bridge);

  await assert.rejects(
    traced(() =>
      worker.materializeDueTransitions(
        issueAccessDeadlineWorkerInvocationForRegistrar(
          "deadline-job-security-fail",
        ),
        { now },
      ),
    ),
    /INJECTED_SECURITY_VERSION_FAILURE/u,
  );

  assert.equal(
    (
      await db
        .collection("break_glass_activations")
        .findOne({ _id: "security-fail" })
    )?.status,
    "ACTIVE",
  );
  assert.equal(db.collection("break_glass_expiry_evidence").records.size, 0);
  assert.equal(audit.records.length, 0);
  assert.equal(bridge.securityVersionChanges, 0);
  assert.equal(bridge.outboxEvents, 0);
});

test("already suspended assignment is a deterministic no-op", async () => {
  const now = 2_000_000_000_000;
  const db = new FakeDb();
  seedAssignmentRole(db);
  const suspended = assignment("already-suspended", "HIGH", now - 1);
  suspended.state = "SUSPENDED";
  db.collection("role_assignments").seed(suspended);
  const audit = new AuditCapture();
  const bridge = new SystemBridgeCapture(db, audit);
  const worker = deadlineWorker(db, audit, bridge);

  const result = await traced(() =>
    worker.materializeDueTransitions(
      issueAccessDeadlineWorkerInvocationForRegistrar(
        "deadline-job-suspended-noop",
      ),
      { now },
    ),
  );

  assert.equal(result.assignmentSuspensions, 0);
  assert.equal(bridge.executions, 0);
  assert.equal(audit.records.length, 0);
  assert.equal(bridge.securityVersionChanges, 0);
  assert.equal(bridge.outboxEvents, 0);
});

test("already expired break-glass activation is a deterministic no-op", async () => {
  const now = 2_000_000_000_000;
  const db = new FakeDb();
  const expired = activation("already-expired", now - 1);
  expired.status = "EXPIRED";
  db.collection("break_glass_activations").seed(expired);
  const audit = new AuditCapture();
  const bridge = new SystemBridgeCapture(db, audit);
  const worker = deadlineWorker(db, audit, bridge);

  const result = await traced(() =>
    worker.materializeDueTransitions(
      issueAccessDeadlineWorkerInvocationForRegistrar(
        "deadline-job-expired-noop",
      ),
      { now },
    ),
  );

  assert.equal(result.activationExpiries, 0);
  assert.equal(bridge.executions, 0);
  assert.equal(audit.records.length, 0);
  assert.equal(bridge.securityVersionChanges, 0);
  assert.equal(bridge.outboxEvents, 0);
});

function assignment(
  id: string,
  riskTier: "HIGH" | "LOW",
  reviewDeadline: number,
): Doc {
  return {
    _id: id,
    roleId: "role-1",
    userId: `user-${id}`,
    state: "ACTIVE",
    effectiveAt: reviewDeadline - 100_000,
    expiresAt: null,
    reviewAt: reviewDeadline,
    lifecycle: {
      cycleId: `cycle-${id}`,
      riskTier,
      riskReasons: [],
      riskAssessedAt: reviewDeadline - 100_000,
      reviewDeadline,
      graceExceptionExpiresAt: null,
      suspendedAt: null,
      suspensionCause: null,
      predecessorAssignmentId: null,
      successorAssignmentId: null,
      lineageAction: null,
    },
    structuredScopeGrants: [{ scopeType: "global" }],
    bundleOrigin: null,
  };
}

function deadlineWorker(
  db: FakeDb,
  audit: AuditCapture,
  bridge: SystemBridgeCapture,
  nowProvider: () => number = () => 2_000_000_000_000,
): AccessDeadlineWorkerService {
  const lifecycle = {
    async listDueLifecycleTransitionCandidates(input: {
      readonly now: number;
      readonly limit: number;
    }) {
      const candidates: Array<{
        assignmentId: string;
        cycleId: string;
        candidateDeadline: number;
        currentRiskTier: "HIGH" | "LOW";
        roleId: string;
        transitionReason:
          | "ASSIGNMENT_EXPIRY"
          | "REVIEW_DEADLINE_UNRESOLVABLE"
          | "REVIEW_AUTHORITY_END"
          | "MALFORMED_SUCCESSOR";
        cycleMatchRequired: boolean;
      }> = [];
      for (const assignmentRecord of db
        .collection("role_assignments")
        .records.values()) {
        if (!["ACTIVE", "SCHEDULED"].includes(assignmentRecord.state)) continue;
        const role = await db.collection("roles").findOne({
          _id: assignmentRecord.roleId,
          state: "ACTIVE",
        });
        if (!role) continue;
        const policy = buildCurrentRoleAssignmentPolicy({
          roleCode: role.code,
          roleTemplateCode: role.templateCode ?? role.code,
          permissions: role.permissions,
          structuredScopeGrants: assignmentRecord.structuredScopeGrants,
          effectiveAt: assignmentRecord.effectiveAt,
          durableReviewDeadline:
            assignmentRecord.lifecycle?.reviewDeadline ??
            assignmentRecord.reviewAt,
          durableRiskTier: assignmentRecord.lifecycle?.riskTier ?? null,
          storedPermissionFingerprint:
            assignmentRecord.lifecycle?.permissionFingerprint ?? null,
          assessedAt: input.now,
          scopeFingerprint:
            assignmentRecord.scopeFingerprint ?? "scope:v1:global",
        });
        const evaluation = evaluateRoleAssignmentEffectiveness(
          assignmentRecord as any,
          input.now,
          policy,
        );
        const expiryDue =
          evaluation.reason === "EXPIRED" &&
          typeof assignmentRecord.expiresAt === "number";
        const reviewDue =
          (evaluation.reason === "REVIEW_DEADLINE_UNRESOLVABLE" ||
            evaluation.reason === "REVIEW_OVERDUE" ||
            evaluation.reason === "GRACE_EXPIRED") &&
          typeof evaluation.authorityEndsAt === "number";
        const malformedSuccessor = evaluation.reason === "MALFORMED_SUCCESSOR";
        if (!expiryDue && !reviewDue && !malformedSuccessor) continue;
        candidates.push({
          assignmentId: assignmentRecord._id,
          cycleId: malformedSuccessor
            ? `malformed-successor:${assignmentRecord._id}`
            : evaluation.reason === "REVIEW_DEADLINE_UNRESOLVABLE"
              ? `unresolved-review:${assignmentRecord._id}`
              : expiryDue
                ? `assignment-expiry:${assignmentRecord._id}`
                : typeof assignmentRecord.lifecycle?.cycleId === "string"
                  ? assignmentRecord.lifecycle.cycleId
                  : `current-policy:${assignmentRecord._id}:${evaluation.authorityEndsAt}`,
          candidateDeadline:
            malformedSuccessor ||
            evaluation.reason === "REVIEW_DEADLINE_UNRESOLVABLE"
              ? input.now
              : expiryDue
                ? assignmentRecord.expiresAt
                : evaluation.authorityEndsAt,
          currentRiskTier: policy.riskTier,
          roleId: assignmentRecord.roleId,
          transitionReason: malformedSuccessor
            ? "MALFORMED_SUCCESSOR"
            : evaluation.reason === "REVIEW_DEADLINE_UNRESOLVABLE"
              ? "REVIEW_DEADLINE_UNRESOLVABLE"
              : expiryDue
                ? "ASSIGNMENT_EXPIRY"
                : "REVIEW_AUTHORITY_END",
          cycleMatchRequired:
            !malformedSuccessor &&
            evaluation.reason !== "REVIEW_DEADLINE_UNRESOLVABLE" &&
            !expiryDue &&
            typeof assignmentRecord.lifecycle?.cycleId === "string",
        });
      }
      return candidates
        .sort(
          (left, right) =>
            left.candidateDeadline - right.candidateDeadline ||
            left.assignmentId.localeCompare(right.assignmentId),
        )
        .slice(0, input.limit);
    },
    async insertSuspension(record: Record<string, unknown>) {
      await db.collection("assignment_suspensions").insertOne({
        ...record,
        _id: String(record.suspensionId),
      } as Doc);
      return record;
    },
  } as any;
  return new AccessDeadlineWorkerService(
    db.asDb(),
    audit.asGuard(),
    bridge,
    { lifecycle },
    nowProvider,
  );
}

function evaluateMongoTestExpression(
  expression: unknown,
  document: Record<string, unknown>,
  variables: Record<string, unknown> = {},
): unknown {
  if (typeof expression === "string" && expression.startsWith("$")) {
    const fromVariables = expression.startsWith("$$");
    return expression
      .slice(fromVariables ? 2 : 1)
      .split(".")
      .reduce<unknown>(
        (value, part) =>
          value && typeof value === "object"
            ? (value as Record<string, unknown>)[part]
            : undefined,
        fromVariables ? variables : document,
      );
  }
  if (expression === null || typeof expression !== "object") return expression;
  if (Array.isArray(expression)) {
    return expression.map((item) =>
      evaluateMongoTestExpression(item, document, variables),
    );
  }
  const object = expression as Record<string, unknown>;
  const operands = (operator: string): readonly unknown[] =>
    object[operator] as readonly unknown[];
  if ("$ifNull" in object) {
    const [value, fallback] = operands("$ifNull");
    return (
      evaluateMongoTestExpression(value, document, variables) ??
      evaluateMongoTestExpression(fallback, document, variables)
    );
  }
  if ("$isNumber" in object) {
    const value = evaluateMongoTestExpression(
      object.$isNumber,
      document,
      variables,
    );
    return typeof value === "number" && Number.isFinite(value);
  }
  if ("$type" in object) {
    const value = evaluateMongoTestExpression(
      object.$type,
      document,
      variables,
    );
    if (value === undefined) return "missing";
    if (value === null) return "null";
    if (typeof value === "string") return "string";
    if (typeof value === "number") return "double";
    return typeof value;
  }
  if ("$trim" in object) {
    const value = evaluateMongoTestExpression(
      (object.$trim as { input: unknown }).input,
      document,
      variables,
    );
    return typeof value === "string" ? value.trim() : value;
  }
  if ("$strLenCP" in object) {
    const value = evaluateMongoTestExpression(
      object.$strLenCP,
      document,
      variables,
    );
    return typeof value === "string" ? [...value].length : 0;
  }
  if ("$let" in object) {
    const value = object.$let as {
      vars: Record<string, unknown>;
      in: unknown;
    };
    const local = Object.fromEntries(
      Object.entries(value.vars).map(([name, item]) => [
        name,
        evaluateMongoTestExpression(item, document, variables),
      ]),
    );
    return evaluateMongoTestExpression(value.in, document, {
      ...variables,
      ...local,
    });
  }
  if ("$cond" in object) {
    const [condition, truthy, falsy] = operands("$cond");
    return evaluateMongoTestExpression(
      evaluateMongoTestExpression(condition, document, variables)
        ? truthy
        : falsy,
      document,
      variables,
    );
  }
  if ("$and" in object) {
    return operands("$and").every((item) =>
      Boolean(evaluateMongoTestExpression(item, document, variables)),
    );
  }
  if ("$or" in object) {
    return operands("$or").some((item) =>
      Boolean(evaluateMongoTestExpression(item, document, variables)),
    );
  }
  for (const [operator, predicate] of [
    ["$eq", (left: unknown, right: unknown) => left === right],
    ["$ne", (left: unknown, right: unknown) => left !== right],
    [
      "$gt",
      (left: unknown, right: unknown) =>
        typeof left === "number" && typeof right === "number" && left > right,
    ],
    [
      "$gte",
      (left: unknown, right: unknown) =>
        typeof left === "number" && typeof right === "number" && left >= right,
    ],
    [
      "$lt",
      (left: unknown, right: unknown) =>
        typeof left === "number" && typeof right === "number" && left < right,
    ],
    [
      "$lte",
      (left: unknown, right: unknown) =>
        typeof left === "number" && typeof right === "number" && left <= right,
    ],
  ] as const) {
    if (operator in object) {
      const [left, right] = operands(operator).map((item) =>
        evaluateMongoTestExpression(item, document, variables),
      );
      return predicate(left, right);
    }
  }
  throw new Error(
    `Unsupported Mongo test expression: ${JSON.stringify(object)}`,
  );
}

function seedAssignmentRole(db: FakeDb): void {
  db.collection("roles").seed({
    _id: "role-1",
    code: "ACCESS_ADMIN",
    templateCode: "ACCESS_ADMIN",
    state: "ACTIVE",
    permissions: [],
  });
}

function activation(id: string, expiresAt: number): Doc {
  return {
    _id: id,
    requestId: `request-${id}`,
    targetUserId: `user-${id}`,
    permissions: ["role:view"],
    structuredScopeGrants: [{ scopeType: "global" }],
    scopeFingerprint: "scope:v1:global",
    incidentReferenceId: "INC-1",
    reason: "incident",
    activatorUserId: "activator",
    activatedAt: expiresAt - 60_000,
    expiresAt,
    status: "ACTIVE",
    stepUpState: "NOT_SUPPORTED",
    independentReviewDeadline: {
      dueAt: expiresAt + 60_000,
      calendarVersion: "v1",
    },
    reviewerUserId: null,
    reviewResult: null,
    reviewedAt: null,
    auditCorrelationId: "trace",
  };
}

function traced<T>(run: () => Promise<T>): Promise<T> {
  return bindTraceId("trace-deadline-worker-test", run);
}

function getPath(value: any, path: string): any {
  return path.split(".").reduce((current, key) => current?.[key], value);
}

function matches(record: Doc, query: Record<string, unknown>): boolean {
  return Object.entries(query).every(([key, expected]) => {
    if (key === "$or")
      return (expected as Record<string, unknown>[]).some((part) =>
        matches(record, part),
      );
    const actual = getPath(record, key);
    if (
      typeof expected === "object" &&
      expected !== null &&
      !Array.isArray(expected)
    ) {
      const operator = expected as Record<string, any>;
      if ("$lte" in operator) return actual <= operator.$lte;
      if ("$in" in operator) return operator.$in.includes(actual);
    }
    return actual === expected;
  });
}

function applySet(record: Doc, values: Record<string, unknown>): void {
  for (const [path, value] of Object.entries(values))
    setPath(record, path, structuredClone(value));
}

function setPath(record: Doc, path: string, value: unknown): void {
  const parts = path.split(".");
  let current: any = record;
  for (const part of parts.slice(0, -1)) current = current[part] ??= {};
  current[parts[parts.length - 1]!] = value;
}
