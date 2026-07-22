import assert from "node:assert/strict";
import test from "node:test";
import { Actor } from "@core/actor/actor";
import {
  AuthoritativeAdminMutationBridge,
  AuthoritativeMutationControls,
} from "@core/application/authoritative-admin-mutation.bridge";
import type { AuditGuard } from "@core/audit/audit.guard";
import type { ClientSession, Db } from "mongodb";
import { runWithDomainEventCollector } from "@system/event-bridge/domain-event.types";
import { bindTraceId } from "@core/trace/trace.context";
import { Permission } from "@core/permission/permission.enum";
import { AccessLifecycleP2AdminService } from "./admin/admin.access-lifecycle-p2.service";
import { AccessBreakGlassAdminService } from "./admin/admin.break-glass.service";
import { GovernancePrincipalAdminService } from "./admin/admin.governance-principal.service";
import { getRoleTemplate } from "./domain/role-template.catalog";
import { buildAuthoritySlotIdentity } from "./domain/authority-slot";
import {
  buildAccessRiskSnapshot,
  buildCurrentRoleAssignmentPolicy,
} from "./domain/sensitive-access-policy";
import { evaluateRoleAssignmentEffectiveness } from "./domain/role-assignment-lifecycle";
import { isBreakGlassActivationEffective } from "./domain/break-glass";

type Doc = Record<string, any> & { _id: string };

class FakeCursor<T extends Doc> {
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

class FakeCollection<T extends Doc = Doc> {
  records = new Map<string, T>();
  readCount = 0;
  failNextUpdate = false;
  failNextInsert = false;

  seed(...records: T[]): void {
    for (const record of records)
      this.records.set(record._id, structuredClone(record));
  }

  find(query: Record<string, unknown> = {}): FakeCursor<T> {
    this.readCount += 1;
    return new FakeCursor(
      [...this.records.values()].filter((record) => matches(record, query)),
    );
  }

  async findOne(query: Record<string, unknown>): Promise<T | null> {
    this.readCount += 1;
    const value = [...this.records.values()].find((record) =>
      matches(record, query),
    );
    return value ? structuredClone(value) : null;
  }

  async insertOne(record: T): Promise<{ insertedId: string }> {
    if (this.failNextInsert) {
      this.failNextInsert = false;
      throw new Error("INJECTED_INSERT_FAILURE");
    }
    if (this.records.has(record._id)) {
      throw Object.assign(new Error("duplicate key"), { code: 11000 });
    }
    this.records.set(record._id, structuredClone(record));
    return { insertedId: record._id };
  }

  async updateOne(
    query: Record<string, unknown>,
    update: Record<string, any>,
  ): Promise<{ matchedCount: number; modifiedCount: number }> {
    if (this.failNextUpdate) {
      this.failNextUpdate = false;
      return { matchedCount: 0, modifiedCount: 0 };
    }
    const current = [...this.records.values()].find((record) =>
      matches(record, query),
    );
    if (!current) return { matchedCount: 0, modifiedCount: 0 };
    applyUpdate(current, update);
    this.records.set(current._id, current);
    return { matchedCount: 1, modifiedCount: 1 };
  }

  async updateMany(
    query: Record<string, unknown>,
    update: Record<string, any>,
  ): Promise<{ matchedCount: number; modifiedCount: number }> {
    let count = 0;
    for (const current of this.records.values()) {
      if (!matches(current, query)) continue;
      applyUpdate(current, update);
      count += 1;
    }
    return { matchedCount: count, modifiedCount: count };
  }

  async findOneAndUpdate(
    query: Record<string, unknown>,
    update: Record<string, any>,
  ): Promise<T | null> {
    const result = await this.updateOne(query, update);
    if (result.modifiedCount !== 1) return null;
    return this.findOne(queryByIdFrom(query));
  }

  async countDocuments(query: Record<string, unknown>): Promise<number> {
    return [...this.records.values()].filter((record) => matches(record, query))
      .length;
  }
}

class FakeDb {
  private collections = new Map<string, FakeCollection>();
  collection<T extends Doc = Doc>(name: string): FakeCollection<T> {
    let value = this.collections.get(name);
    if (!value) {
      value = new FakeCollection();
      this.collections.set(name, value);
    }
    return value as FakeCollection<T>;
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
    for (const [name, records] of snapshot) {
      const collection = this.collection(name);
      collection.records = new Map(
        records.map((record) => [record._id, structuredClone(record)]),
      );
    }
  }
  asDb(): Db {
    return this as unknown as Db;
  }
}

class AuditCapture {
  records: Array<{ actor: Actor; metadata?: Record<string, unknown> }> = [];
  fail = false;
  async record(
    actor: Actor,
    _permission: unknown,
    _resourceId?: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    if (this.fail) throw new Error("INJECTED_AUDIT_FAILURE");
    this.records.push({ actor, metadata: structuredClone(metadata) });
  }
  asGuard(): AuditGuard {
    return this as unknown as AuditGuard;
  }
}

class SnapshotMutationBridge implements AuthoritativeAdminMutationBridge {
  executions = 0;
  securityVersionChanges = 0;
  outboxEvents = 0;
  failSecurityVersion = false;
  beforeMutate?: () => void;
  constructor(
    private readonly db: FakeDb,
    private readonly audit: AuditCapture,
  ) {}
  async execute<T>(
    _params: Parameters<AuthoritativeAdminMutationBridge["execute"]>[0],
    mutate: (
      session: ClientSession,
      controls: AuthoritativeMutationControls,
    ) => Promise<T>,
  ): Promise<T> {
    this.executions += 1;
    this.beforeMutate?.();
    this.beforeMutate = undefined;
    const snapshot = this.db.snapshot();
    const auditSize = this.audit.records.length;
    let securityChanged = false;
    let explicitNoOp = false;
    const controls: AuthoritativeMutationControls = {
      markAuthSecurityTruthChanged: () => {
        securityChanged = true;
      },
      markExplicitNoOpSuccess: () => {
        explicitNoOp = true;
      },
    };
    try {
      const result = await runWithDomainEventCollector(() =>
        mutate({} as ClientSession, controls),
      );
      if (explicitNoOp && securityChanged)
        throw new Error("INVALID_NOOP_SECURITY_CHANGE");
      if (securityChanged) {
        if (this.failSecurityVersion) {
          throw new Error("INJECTED_SECURITY_VERSION_FAILURE");
        }
        this.securityVersionChanges += 1;
        this.outboxEvents += 1;
      }
      return result;
    } catch (error) {
      this.db.restore(snapshot);
      this.audit.records.splice(auditSize);
      throw error;
    }
  }
}

const cache = {
  invalidateAll: async () => undefined,
} as any;
const exactAuthority = authorityMock(() => true);

function authorityMock(predicate: (input: any) => boolean): any {
  return {
    hasAuthority: async (input: any) => predicate(input),
    createSnapshot: async (userId: string, capturedAt: number) => ({
      userId,
      capturedAt,
      hasAuthority: (permission: string, scope: unknown) =>
        predicate({ userId, permission, scope }),
      listAuthorizedScopeGrants: () => [],
    }),
  };
}

test("malformed external decisions, urgency, and review result fail before bridge entry", async () => {
  const db = new FakeDb();
  const audit = new AuditCapture();
  const bridge = new SnapshotMutationBridge(db, audit);
  const lifecycle = new AccessLifecycleP2AdminService(
    db.asDb(),
    audit.asGuard(),
    bridge,
    cache,
    exactAuthority,
  );
  const breakGlass = new AccessBreakGlassAdminService(
    db.asDb(),
    audit.asGuard(),
    bridge,
    cache,
    undefined,
    undefined,
    exactAuthority,
  );
  const governance = new GovernancePrincipalAdminService(
    db.asDb(),
    audit.asGuard(),
    bridge,
    cache,
  );

  await assert.rejects(
    traced(() =>
      lifecycle.decideReview(admin("reviewer"), {
        cycleId: "cycle",
        decision: "approved",
        reason: "reason",
        nextReviewAt: Date.now() + 10_000,
      }),
    ),
    /must be exactly one of/u,
  );
  await assert.rejects(
    traced(() =>
      breakGlass.createRequest(admin("requester"), {
        targetUserId: "target",
        permissions: ["role:view"],
        structuredScopeGrants: [],
        urgency: "URGENT ",
        incidentReferenceId: "INC",
        reason: "reason",
        idempotencyKey: "malformed-urgency",
      }),
    ),
    /must be exactly one of/u,
  );
  await assert.rejects(
    traced(() =>
      breakGlass.reviewActivation(admin("reviewer"), {
        activationId: "activation",
        result: "SAFE",
        reason: "reason",
      }),
    ),
    /must be exactly one of/u,
  );
  await assert.rejects(
    traced(() =>
      governance.decideSuccessor(admin("reviewer"), {
        principalId: "principal",
        decision: undefined,
        reason: "reason",
        idempotencyKey: "malformed-decision",
      }),
    ),
    /must be exactly one of/u,
  );
  assert.equal(bridge.executions, 0);
  assert.equal(audit.records.length, 0);
});

test("governance queues require a valid structured-authority snapshot before any data read", async () => {
  const db = lifecycleFixture();
  db.collection("break_glass_requests").seed(breakGlassRequest());
  db.collection("break_glass_activations").seed(
    breakGlassActivation("EXPIRED"),
  );
  const audit = new AuditCapture();
  const bridge = new SnapshotMutationBridge(db, audit);
  const missingSnapshot = { hasAuthority: async () => true } as any;
  const lifecycle = new AccessLifecycleP2AdminService(
    db.asDb(),
    audit.asGuard(),
    bridge,
    cache,
    missingSnapshot,
  );
  const breakGlass = new AccessBreakGlassAdminService(
    db.asDb(),
    audit.asGuard(),
    bridge,
    cache,
    undefined,
    undefined,
    missingSnapshot,
  );

  await assert.rejects(
    lifecycle.listForActor(admin("reviewer")),
    /STRUCTURED_AUTHORITY_SNAPSHOT_REQUIRED/u,
  );
  await assert.rejects(
    breakGlass.listForActor(admin("reviewer")),
    /STRUCTURED_AUTHORITY_SNAPSHOT_REQUIRED/u,
  );
  for (const collectionName of [
    "assignment_review_cycles",
    "assignment_grace_exceptions",
    "assignment_successor_requests",
    "role_assignments",
    "break_glass_requests",
    "break_glass_activations",
  ]) {
    assert.equal(db.collection(collectionName).readCount, 0, collectionName);
  }
});

test("lifecycle status exposes backend-derived queue and successor action eligibility without mutation", async () => {
  const db = lifecycleFixture();
  db.collection("roles").seed({
    _id: "role-1",
    code: "STAFF_CONSOLE_USER",
    templateCode: "STAFF_CONSOLE_USER",
    state: "ACTIVE",
    permissions: [],
  });
  db.collection("assignment_grace_exceptions").seed({
    _id: "grace-1",
    cycleId: "cycle-1",
    targetUserId: "target",
    requestedBy: "requester",
    requestedAt: Date.now(),
    requestedExpiresAt: Date.now() + 4 * 24 * 60 * 60 * 1000,
    approvedBy: null,
    approvedAt: null,
    approvedExpiresAt: null,
    state: "PENDING",
    reason: "bounded grace",
  });
  db.collection("assignment_successor_requests").seed({
    _id: "successor-1",
    action: "RENEWAL",
    predecessorAssignmentId: "assignment-1",
    targetUserId: "target",
    requestedBy: "requester",
    requestedAt: Date.now(),
    reason: "renew",
    idempotencyKey: "renew-1",
    payloadFingerprint: "payload-1",
    state: "PENDING",
    approvals: [],
    successor: {
      roleId: "role-1",
      structuredScopeGrants: [{ scopeType: "global" }],
      scopeFingerprint: "scope:v1:global",
      effectiveAt: Date.now(),
      expiresAt: null,
      reviewAt: Date.now() + 60_000,
      riskTier: "LOW",
      riskReasons: [],
      riskAssessedAt: Date.now(),
      permissionFingerprint: "permission:v1:test",
      sourceRoleId: "role-1",
      sourceRoleCode: "ACCESS_ADMIN",
      sourceRoleTemplateCode: "ACCESS_ADMIN",
      riskPolicyVersion: "access-risk-policy/v1",
    },
    successorAssignmentId: null,
    appliedAt: null,
  });
  const audit = new AuditCapture();
  const bridge = new SnapshotMutationBridge(db, audit);
  const service = new AccessLifecycleP2AdminService(
    db.asDb(),
    audit.asGuard(),
    bridge,
    cache,
    exactAuthority,
  );
  const result = await service.listForActor(
    adminWithPermissions("reviewer", [
      Permission.ROLE_ASSIGNMENT_REVIEW,
      Permission.ROLE_ASSIGNMENT_GRACE_APPROVE,
      Permission.ROLE_ASSIGNMENT_RENEW,
      Permission.ROLE_ASSIGNMENT_REPLACE,
    ]),
    "target",
  );

  assert.equal(getPath(result, "reviewCycles.0.canApprove"), true);
  assert.equal(getPath(result, "reviewCycles.0.canRequestGrace"), true);
  assert.equal(getPath(result, "graceExceptions.0.canReject"), true);
  assert.equal(getPath(result, "successorRequests.0.canApprove"), true);
  assert.equal(getPath(result, "requestableAssignments.0.canRenew"), true);
  assert.equal(getPath(result, "requestableAssignments.0.canReplace"), true);
  assert.equal(bridge.executions, 0);
  assert.equal(audit.records.length, 0);
});

test("lifecycle queues omit assignments outside exact structured scope", async () => {
  const db = lifecycleFixture();
  const baseAssignment = await db
    .collection("role_assignments")
    .findOne({ _id: "assignment-1" });
  const baseCycle = await db
    .collection("assignment_review_cycles")
    .findOne({ _id: "cycle-1" });
  assert.ok(baseAssignment && baseCycle);
  db.collection("role_assignments").seed(
    {
      ...baseAssignment,
      _id: "assignment-1",
      structuredScopeGrants: [
        { scopeType: "contractPortfolio", targetKey: "portfolio-a" },
      ],
    },
    {
      ...baseAssignment,
      _id: "assignment-2",
      userId: "target",
      structuredScopeGrants: [
        { scopeType: "contractPortfolio", targetKey: "portfolio-b" },
      ],
      lifecycle: { ...baseAssignment.lifecycle, cycleId: "cycle-2" },
    },
  );
  db.collection("assignment_review_cycles").seed({
    ...baseCycle,
    _id: "cycle-2",
    assignmentId: "assignment-2",
    targetUserId: "other-target",
    requestedBy: "other-requester",
  });
  const scopedAuthority = authorityMock(
    ({ scope }: any) => scope.targetKey === "portfolio-a",
  );
  const audit = new AuditCapture();
  const bridge = new SnapshotMutationBridge(db, audit);
  const service = new AccessLifecycleP2AdminService(
    db.asDb(),
    audit.asGuard(),
    bridge,
    cache,
    scopedAuthority,
  );

  const result = await service.listForActor(
    adminWithPermissions("reviewer", [
      Permission.ROLE_ASSIGNMENT_REVIEW,
      Permission.ROLE_ASSIGNMENT_RENEW,
    ]),
    "target",
  );
  assert.deepEqual(
    (result.reviewCycles as Array<{ cycleId: string }>).map(
      (item) => item.cycleId,
    ),
    ["cycle-1"],
  );
  assert.deepEqual(
    (result.requestableAssignments as Array<{ assignmentId: string }>).map(
      (item) => item.assignmentId,
    ),
    ["assignment-1"],
  );
  assert.equal(bridge.executions, 0);
});

test("grace request revalidates exact scope inside the mutation callback", async () => {
  const deniedDb = lifecycleFixture();
  const deniedAudit = new AuditCapture();
  const deniedBridge = new SnapshotMutationBridge(deniedDb, deniedAudit);
  const deniedService = new AccessLifecycleP2AdminService(
    deniedDb.asDb(),
    deniedAudit.asGuard(),
    deniedBridge,
    cache,
    authorityMock(() => false),
  );
  const deniedCycle = await deniedDb
    .collection("assignment_review_cycles")
    .findOne({ _id: "cycle-1" });
  assert.ok(deniedCycle);
  const denied = await traced(() =>
    deniedService.requestGraceException(
      adminWithPermissions("reviewer", [Permission.ROLE_ASSIGNMENT_REVIEW]),
      {
        cycleId: "cycle-1",
        requestedExpiresAt:
          deniedCycle.reviewDeadline + 4 * 24 * 60 * 60 * 1000,
        reason: "wrong scope must fail before mutation",
      },
    ),
  );
  assert.deepEqual(denied.blockers, ["EXACT_LIFECYCLE_SCOPE_REQUIRED"]);
  assert.equal(deniedBridge.executions, 0);
  assert.equal(deniedAudit.records.length, 0);

  const db = lifecycleFixture();
  const audit = new AuditCapture();
  const bridge = new SnapshotMutationBridge(db, audit);
  let exactChecks = 0;
  const changingAuthority = {
    hasAuthority: async () => {
      exactChecks += 1;
      return exactChecks === 1;
    },
  } as any;
  const service = new AccessLifecycleP2AdminService(
    db.asDb(),
    audit.asGuard(),
    bridge,
    cache,
    changingAuthority,
  );
  const cycle = await db
    .collection("assignment_review_cycles")
    .findOne({ _id: "cycle-1" });
  assert.ok(cycle);

  const result = await traced(() =>
    service.requestGraceException(
      adminWithPermissions("reviewer", [Permission.ROLE_ASSIGNMENT_REVIEW]),
      {
        cycleId: "cycle-1",
        requestedExpiresAt: cycle.reviewDeadline + 4 * 24 * 60 * 60 * 1000,
        reason: "bounded operational continuity",
      },
    ),
  );
  assert.deepEqual(result.blockers, ["EXACT_LIFECYCLE_SCOPE_REQUIRED"]);
  assert.equal(bridge.executions, 1);
  assert.equal(
    await db.collection("assignment_grace_exceptions").countDocuments({}),
    0,
  );
  assert.equal(audit.records.length, 0);
});

test("review eligibility follows operational SCHEDULED timing and current HIGH thresholds", async () => {
  const effectiveDb = lifecycleFixture();
  await effectiveDb
    .collection("role_assignments")
    .updateOne(
      { _id: "assignment-1" },
      { $set: { state: "SCHEDULED", effectiveAt: Date.now() - 1 } },
    );
  const effectiveService = new AccessLifecycleP2AdminService(
    effectiveDb.asDb(),
    new AuditCapture().asGuard(),
    new SnapshotMutationBridge(effectiveDb, new AuditCapture()),
    cache,
    exactAuthority,
  );
  const effective = await effectiveService.listForActor(
    adminWithPermissions("reviewer", [Permission.ROLE_ASSIGNMENT_REVIEW]),
  );
  assert.equal(getPath(effective, "reviewCycles.0.canApprove"), true);

  const futureDb = lifecycleFixture();
  await futureDb
    .collection("role_assignments")
    .updateOne(
      { _id: "assignment-1" },
      { $set: { state: "SCHEDULED", effectiveAt: Date.now() + 60_000 } },
    );
  const futureAudit = new AuditCapture();
  const future = await new AccessLifecycleP2AdminService(
    futureDb.asDb(),
    futureAudit.asGuard(),
    new SnapshotMutationBridge(futureDb, futureAudit),
    cache,
    exactAuthority,
  ).listForActor(
    adminWithPermissions("reviewer", [Permission.ROLE_ASSIGNMENT_REVIEW]),
  );
  assert.equal(getPath(future, "reviewCycles.0.canApprove"), false);
  assert.equal(
    getPath(future, "reviewCycles.0.ineligibilityReason"),
    "STALE_ASSIGNMENT_REVIEW_CYCLE",
  );

  const highDb = lifecycleFixture();
  await highDb
    .collection("roles")
    .updateOne(
      { _id: "role-1" },
      { $set: { code: "ACCESS_ADMIN", templateCode: "ACCESS_ADMIN" } },
    );
  await highDb.collection("assignment_review_cycles").updateOne(
    { _id: "cycle-1" },
    {
      $set: {
        approvals: [
          {
            approverUserId: "reviewer-one",
            decidedAt: Date.now() - 1,
            decision: "APPROVED",
            reason: "historical low approval",
          },
        ],
      },
    },
  );
  const highAudit = new AuditCapture();
  const highService = new AccessLifecycleP2AdminService(
    highDb.asDb(),
    highAudit.asGuard(),
    new SnapshotMutationBridge(highDb, highAudit),
    cache,
    exactAuthority,
  );
  const high = await highService.listForActor(
    adminWithPermissions("reviewer-two", [
      Permission.ROLE_ASSIGNMENT_REVIEW,
      Permission.ROLE_ASSIGNMENT_GRACE_APPROVE,
    ]),
  );
  assert.equal(getPath(high, "reviewCycles.0.riskTier"), "HIGH");
  assert.equal(getPath(high, "reviewCycles.0.requiredApprovals"), 2);
  assert.equal(getPath(high, "reviewCycles.0.completedApprovals"), 1);
  assert.equal(getPath(high, "reviewCycles.0.canRequestGrace"), false);
  const cycle = await highDb.collection("assignment_review_cycles").findOne({
    _id: "cycle-1",
  });
  assert.ok(cycle);
  const blockedGrace = await traced(() =>
    highService.requestGraceException(
      adminWithPermissions("reviewer-two", [Permission.ROLE_ASSIGNMENT_REVIEW]),
      {
        cycleId: "cycle-1",
        requestedExpiresAt: cycle.reviewDeadline + 4 * 24 * 60 * 60 * 1000,
        reason: "historical LOW must not grant current HIGH grace",
      },
    ),
  );
  assert.equal(
    (blockedGrace.blockers as string[]).includes("HIGH_RISK_HAS_NO_GRACE"),
    true,
  );
  assert.equal(highAudit.records.length, 0);
});

test("outer LOW to inner HIGH grace drift is a zero-effect deterministic no-op", async () => {
  const db = lifecycleFixture();
  const audit = new AuditCapture();
  const bridge = new SnapshotMutationBridge(db, audit);
  bridge.beforeMutate = () => {
    void db.collection("roles").updateOne(
      { _id: "role-1" },
      {
        $set: {
          code: "ACCESS_ADMIN",
          templateCode: "ACCESS_ADMIN",
          permissions: [Permission.ROLE_ASSIGN_TO_USER],
        },
      },
    );
  };
  const service = new AccessLifecycleP2AdminService(
    db.asDb(),
    audit.asGuard(),
    bridge,
    cache,
    exactAuthority,
  );
  const cycle = await db.collection("assignment_review_cycles").findOne({
    _id: "cycle-1",
  });
  assert.ok(cycle);
  const result = await traced(() =>
    service.requestGraceException(
      adminWithPermissions("reviewer", [Permission.ROLE_ASSIGNMENT_REVIEW]),
      {
        cycleId: "cycle-1",
        requestedExpiresAt: cycle.reviewDeadline + 4 * 24 * 60 * 60 * 1000,
        reason: "current risk must be revalidated",
      },
    ),
  );
  assert.equal(
    (result.blockers as string[]).includes("HIGH_RISK_HAS_NO_GRACE"),
    true,
  );
  assert.equal(
    await db.collection("assignment_grace_exceptions").countDocuments({}),
    0,
  );
  assert.equal(audit.records.length, 0);
  assert.equal(bridge.securityVersionChanges, 0);
  assert.equal(bridge.outboxEvents, 0);
});

test("review expiry boundary drift uses one callback time and has zero effects", async () => {
  const boundary = 2_000_000_100_000;
  const db = lifecycleFixture();
  await setLifecycleTiming(db, {
    effectiveAt: boundary - 10_000,
    expiresAt: boundary,
    reviewDeadline: boundary + 60_000,
  });
  const audit = new AuditCapture();
  const bridge = new SnapshotMutationBridge(db, audit);
  const clock = sequenceClock(boundary - 1, boundary);
  const service = lifecycleService(db, audit, bridge, clock.now);

  const result = await traced(() =>
    service.decideReview(admin("reviewer"), {
      cycleId: "cycle-1",
      decision: "REJECTED",
      reason: "expiry boundary",
    }),
  );

  assert.ok(
    (result.blockers as string[]).includes("STALE_ASSIGNMENT_REVIEW_CYCLE"),
  );
  assert.equal(clock.calls(), 2);
  await assertNoLifecycleEffects(db, audit, bridge);
});

test("review chained-cutover boundary drift blocks an effective SCHEDULED predecessor", async () => {
  const boundary = 2_000_000_200_000;
  const db = lifecycleFixture();
  await setLifecycleTiming(db, {
    state: "SCHEDULED",
    effectiveAt: boundary - 10_000,
    expiresAt: boundary + 60_000,
    reviewDeadline: boundary + 30_000,
    successorAssignmentId: "assignment-successor",
    successorEffectiveAt: boundary,
  });
  const audit = new AuditCapture();
  const bridge = new SnapshotMutationBridge(db, audit);
  const clock = sequenceClock(boundary - 1, boundary);
  const service = lifecycleService(db, audit, bridge, clock.now);

  const result = await traced(() =>
    service.decideReview(admin("reviewer"), {
      cycleId: "cycle-1",
      decision: "APPROVED",
      reason: "cutover boundary",
      nextReviewAt: boundary + 120_000,
    }),
  );

  assert.ok(
    (result.blockers as string[]).includes("STALE_ASSIGNMENT_REVIEW_CYCLE"),
  );
  assert.equal(clock.calls(), 2);
  await assertNoLifecycleEffects(db, audit, bridge, "SCHEDULED");
});

test("grace request expiry boundary drift is a single-time zero-effect no-op", async () => {
  const boundary = 2_000_000_300_000;
  const reviewDeadline = boundary - 1_000;
  const db = lifecycleFixture();
  await setLifecycleTiming(db, {
    effectiveAt: boundary - 10_000,
    expiresAt: boundary,
    reviewDeadline,
  });
  const audit = new AuditCapture();
  const bridge = new SnapshotMutationBridge(db, audit);
  const clock = sequenceClock(boundary - 1, boundary);
  const service = lifecycleService(db, audit, bridge, clock.now);

  const result = await traced(() =>
    service.requestGraceException(
      adminWithPermissions("reviewer", [Permission.ROLE_ASSIGNMENT_REVIEW]),
      {
        cycleId: "cycle-1",
        requestedExpiresAt: reviewDeadline + 4 * 24 * 60 * 60 * 1_000,
        reason: "expiry boundary grace",
      },
    ),
  );

  assert.ok(
    (result.blockers as string[]).includes("STALE_ASSIGNMENT_REVIEW_CYCLE"),
  );
  assert.equal(clock.calls(), 2);
  assert.equal(
    await db.collection("assignment_grace_exceptions").countDocuments({}),
    0,
  );
  assert.equal(audit.records.length, 0);
  assert.equal(bridge.securityVersionChanges, 0);
  assert.equal(bridge.outboxEvents, 0);
});

test("grace decision chained-cutover drift blocks rejection before any evidence change", async () => {
  const boundary = 2_000_000_400_000;
  const reviewDeadline = boundary - 1_000;
  const db = lifecycleFixture();
  await setLifecycleTiming(db, {
    state: "SCHEDULED",
    effectiveAt: boundary - 10_000,
    expiresAt: boundary + 60_000,
    reviewDeadline,
    successorAssignmentId: "assignment-successor",
    successorEffectiveAt: boundary,
  });
  seedGraceException(db, reviewDeadline);
  const audit = new AuditCapture();
  const bridge = new SnapshotMutationBridge(db, audit);
  const clock = sequenceClock(boundary - 1, boundary);
  const service = lifecycleService(db, audit, bridge, clock.now);

  const result = await traced(() =>
    service.decideGraceException(
      adminWithPermissions("grace-reviewer", [
        Permission.ROLE_ASSIGNMENT_GRACE_APPROVE,
      ]),
      {
        exceptionId: "grace-boundary",
        decision: "REJECTED",
        reason: "cutover",
      },
    ),
  );

  assert.ok(
    (result.blockers as string[]).includes("STALE_ASSIGNMENT_REVIEW_CYCLE"),
  );
  assert.equal(clock.calls(), 2);
  assert.equal(
    (
      await db.collection("assignment_grace_exceptions").findOne({
        _id: "grace-boundary",
      })
    )?.state,
    "PENDING",
  );
  assert.equal(audit.records.length, 0);
  assert.equal(bridge.securityVersionChanges, 0);
  assert.equal(bridge.outboxEvents, 0);
});

test("callback current Role loss blocks review with zero effects", async () => {
  const stableNow = Date.now();
  const db = lifecycleFixture();
  await setLifecycleTiming(db, {
    effectiveAt: stableNow - 10_000,
    expiresAt: stableNow + 60_000,
    reviewDeadline: stableNow + 30_000,
  });
  const audit = new AuditCapture();
  const bridge = new SnapshotMutationBridge(db, audit);
  bridge.beforeMutate = () => {
    void db
      .collection("roles")
      .updateOne({ _id: "role-1" }, { $set: { state: "INACTIVE" } });
  };
  const clock = sequenceClock(stableNow, stableNow);
  const service = lifecycleService(db, audit, bridge, clock.now);

  const result = await traced(() =>
    service.decideReview(admin("reviewer"), {
      cycleId: "cycle-1",
      decision: "REJECTED",
      reason: "role disappeared",
    }),
  );

  assert.ok(
    (result.blockers as string[]).includes("STALE_ASSIGNMENT_REVIEW_CYCLE"),
  );
  assert.equal(clock.calls(), 2);
  await assertNoLifecycleEffects(db, audit, bridge);
});

test("stable review and LOW grace each use exactly requestNow plus transactionNow", async () => {
  const stableNow = Date.now();
  const reviewDb = lifecycleFixture();
  await setLifecycleTiming(reviewDb, {
    effectiveAt: stableNow - 10_000,
    expiresAt: stableNow + 24 * 60 * 60 * 1_000,
    reviewDeadline: stableNow + 60_000,
  });
  const reviewAudit = new AuditCapture();
  const reviewBridge = new SnapshotMutationBridge(reviewDb, reviewAudit);
  const reviewClock = sequenceClock(stableNow, stableNow);
  const reviewed = await traced(() =>
    lifecycleService(
      reviewDb,
      reviewAudit,
      reviewBridge,
      reviewClock.now,
    ).decideReview(admin("reviewer"), {
      cycleId: "cycle-1",
      decision: "APPROVED",
      reason: "stable review",
      nextReviewAt: stableNow + 120_000,
    }),
  );
  assert.equal(reviewed.applied, true);
  assert.equal(reviewClock.calls(), 2);
  assert.equal(reviewAudit.records.length, 1);
  assert.equal(
    (
      await reviewDb.collection("role_assignments").findOne({
        _id: "assignment-1",
      })
    )?.lifecycle.riskAssessedAt,
    stableNow,
  );

  const graceDb = lifecycleFixture();
  const reviewDeadline = stableNow + 60_000;
  await setLifecycleTiming(graceDb, {
    effectiveAt: stableNow - 10_000,
    expiresAt: stableNow + 24 * 60 * 60 * 1_000,
    reviewDeadline,
  });
  const graceAudit = new AuditCapture();
  const graceBridge = new SnapshotMutationBridge(graceDb, graceAudit);
  const graceClock = sequenceClock(stableNow, stableNow);
  const grace = await traced(() =>
    lifecycleService(
      graceDb,
      graceAudit,
      graceBridge,
      graceClock.now,
    ).requestGraceException(
      adminWithPermissions("reviewer", [Permission.ROLE_ASSIGNMENT_REVIEW]),
      {
        cycleId: "cycle-1",
        requestedExpiresAt: reviewDeadline + 4 * 24 * 60 * 60 * 1_000,
        reason: "stable bounded grace",
      },
    ),
  );
  assert.equal(grace.applied, true);
  assert.equal(graceClock.calls(), 2);
  const graceRecord = await graceDb
    .collection("assignment_grace_exceptions")
    .findOne({
      _id: grace.exceptionId,
    });
  assert.equal(graceRecord?.requestedAt, stableNow);
  assert.equal(
    graceRecord?.requestedExpiresAt,
    reviewDeadline + 4 * 24 * 60 * 60 * 1_000,
  );
});

test("accepted recurring HIGH review cycles replace the original effectiveAt deadline", async () => {
  const day = 24 * 60 * 60 * 1_000;
  const effectiveAt = 2_000_100_000_000;
  const day30 = effectiveAt + 30 * day;
  const day60 = effectiveAt + 60 * day;
  const decisionAt = day30 - day;
  const db = lifecycleFixture();
  await db.collection("roles").updateOne(
    { _id: "role-1" },
    {
      $set: {
        code: "ACCESS_ADMIN",
        templateCode: "ACCESS_ADMIN",
        permissions: [Permission.ROLE_ASSIGNMENT_REVIEW],
      },
    },
  );
  await setLifecycleTiming(db, {
    effectiveAt,
    expiresAt: effectiveAt + 365 * day,
    reviewDeadline: day30,
  });
  const assignmentBefore = await db.collection("role_assignments").findOne({
    _id: "assignment-1",
  });
  assert.ok(assignmentBefore);
  await db.collection("role_assignments").updateOne(
    { _id: "assignment-1" },
    {
      $set: {
        lifecycle: {
          ...assignmentBefore.lifecycle,
          riskTier: "HIGH",
          reviewDeadline: day30,
        },
      },
    },
  );
  await db.collection("assignment_review_cycles").updateOne(
    { _id: "cycle-1" },
    {
      $set: {
        riskSnapshot: {
          tier: "HIGH",
          reasons: ["ACCESS_ADMIN"],
          assessedAt: effectiveAt,
          permissionFingerprint: "permission:v1:role.assignment.review",
          scopeFingerprint: "scope:v1:self",
        },
        approvals: [
          {
            approverUserId: "reviewer-one",
            decidedAt: decisionAt - 1,
            decision: "APPROVED",
            reason: "first independent approval",
          },
        ],
      },
    },
  );
  const audit = new AuditCapture();
  const bridge = new SnapshotMutationBridge(db, audit);
  const clock = sequenceClock(decisionAt, decisionAt);
  const service = lifecycleService(db, audit, bridge, clock.now);

  const result = await traced(() =>
    service.decideReview(admin("reviewer-two"), {
      cycleId: "cycle-1",
      decision: "APPROVED",
      reason: "accept next bounded cycle",
      nextReviewAt: day60,
    }),
  );

  assert.equal(result.applied, true);
  const assignment = await db.collection("role_assignments").findOne({
    _id: "assignment-1",
  });
  assert.ok(assignment);
  assert.equal(assignment.lifecycle.reviewDeadline, day60);
  assert.equal(assignment.reviewAt, day60);
  const policy = buildCurrentRoleAssignmentPolicy({
    roleCode: "ACCESS_ADMIN",
    roleTemplateCode: "ACCESS_ADMIN",
    permissions: [Permission.ROLE_ASSIGNMENT_REVIEW],
    structuredScopeGrants: assignment.structuredScopeGrants,
    effectiveAt: assignment.effectiveAt,
    durableReviewDeadline: assignment.lifecycle.reviewDeadline,
    durableRiskTier: assignment.lifecycle.riskTier,
    storedPermissionFingerprint: assignment.lifecycle.permissionFingerprint,
    assessedAt: day30 + 1,
    scopeFingerprint: assignment.scopeFingerprint,
  });
  assert.equal(policy.reviewDeadline, day60);
  assert.equal(
    evaluateRoleAssignmentEffectiveness(
      assignment as unknown as Parameters<
        typeof evaluateRoleAssignmentEffectiveness
      >[0],
      day30 + 1,
      policy,
    ).effective,
    true,
  );
  assert.equal(
    evaluateRoleAssignmentEffectiveness(
      assignment as unknown as Parameters<
        typeof evaluateRoleAssignmentEffectiveness
      >[0],
      day60,
      policy,
    ).reason,
    "REVIEW_OVERDUE",
  );
  assert.equal(audit.records.length, 1);
  assert.equal(bridge.securityVersionChanges, 1);
  assert.equal(bridge.outboxEvents, 1);

  const day90 = effectiveAt + 90 * day;
  const secondDecisionAt = day60 - day;
  const secondCycleId = assignment.lifecycle.cycleId as string;
  await db.collection("assignment_review_cycles").updateOne(
    { _id: secondCycleId },
    {
      $set: {
        approvals: [
          {
            approverUserId: "reviewer-three",
            decidedAt: secondDecisionAt - 1,
            decision: "APPROVED",
            reason: "first approval for second cycle",
          },
        ],
      },
    },
  );
  const secondResult = await traced(() =>
    lifecycleService(
      db,
      audit,
      bridge,
      sequenceClock(secondDecisionAt, secondDecisionAt).now,
    ).decideReview(admin("reviewer-four"), {
      cycleId: secondCycleId,
      decision: "APPROVED",
      reason: "accept second bounded cycle",
      nextReviewAt: day90,
    }),
  );
  assert.equal(secondResult.applied, true);
  const assignmentAfterSecondCycle = await db
    .collection("role_assignments")
    .findOne({ _id: "assignment-1" });
  assert.ok(assignmentAfterSecondCycle);
  assert.equal(assignmentAfterSecondCycle.lifecycle.reviewDeadline, day90);
  const secondPolicy = buildCurrentRoleAssignmentPolicy({
    roleCode: "ACCESS_ADMIN",
    roleTemplateCode: "ACCESS_ADMIN",
    permissions: [Permission.ROLE_ASSIGNMENT_REVIEW],
    structuredScopeGrants: assignmentAfterSecondCycle.structuredScopeGrants,
    effectiveAt: assignmentAfterSecondCycle.effectiveAt,
    durableReviewDeadline: assignmentAfterSecondCycle.lifecycle.reviewDeadline,
    durableRiskTier: assignmentAfterSecondCycle.lifecycle.riskTier,
    storedPermissionFingerprint:
      assignmentAfterSecondCycle.lifecycle.permissionFingerprint,
    assessedAt: day60 + 1,
    scopeFingerprint: assignmentAfterSecondCycle.scopeFingerprint,
  });
  assert.equal(secondPolicy.reviewDeadline, day90);
  assert.equal(
    evaluateRoleAssignmentEffectiveness(
      assignmentAfterSecondCycle as unknown as Parameters<
        typeof evaluateRoleAssignmentEffectiveness
      >[0],
      day60 + 1,
      secondPolicy,
    ).effective,
    true,
  );
  assert.equal(
    evaluateRoleAssignmentEffectiveness(
      assignmentAfterSecondCycle as unknown as Parameters<
        typeof evaluateRoleAssignmentEffectiveness
      >[0],
      day90,
      secondPolicy,
    ).reason,
    "REVIEW_OVERDUE",
  );
  assert.equal(audit.records.length, 2);
  assert.equal(bridge.securityVersionChanges, 2);
  assert.equal(bridge.outboxEvents, 2);
});

test("recurring review rejects a deadline beyond policy, expiry, or successor bounds with zero effects", async () => {
  const day = 24 * 60 * 60 * 1_000;
  const effectiveAt = 2_000_200_000_000;
  const day30 = effectiveAt + 30 * day;
  const decisionAt = day30 - day;

  for (const scenario of [
    {
      name: "policy maximum",
      expiresAt: effectiveAt + 365 * day,
      successorEffectiveAt: null,
      nextReviewAt: effectiveAt + 60 * day + 1,
      error: "NEXT_REVIEW_EXCEEDS_CURRENT_POLICY_MAXIMUM",
    },
    {
      name: "assignment expiry",
      expiresAt: effectiveAt + 45 * day,
      successorEffectiveAt: null,
      nextReviewAt: effectiveAt + 50 * day,
      error: "NEXT_REVIEW_AFTER_ASSIGNMENT_EXPIRY",
    },
    {
      name: "successor cutover",
      expiresAt: effectiveAt + 365 * day,
      successorEffectiveAt: effectiveAt + 45 * day,
      nextReviewAt: effectiveAt + 50 * day,
      error: "NEXT_REVIEW_AFTER_SUCCESSOR_CUTOVER",
    },
  ]) {
    const db = lifecycleFixture();
    await db.collection("roles").updateOne(
      { _id: "role-1" },
      {
        $set: {
          code: "ACCESS_ADMIN",
          templateCode: "ACCESS_ADMIN",
          permissions: [Permission.ROLE_ASSIGNMENT_REVIEW],
        },
      },
    );
    await setLifecycleTiming(db, {
      effectiveAt,
      expiresAt: scenario.expiresAt,
      reviewDeadline: day30,
      successorAssignmentId: scenario.successorEffectiveAt
        ? "assignment-successor"
        : null,
      successorEffectiveAt: scenario.successorEffectiveAt,
    });
    const assignment = await db.collection("role_assignments").findOne({
      _id: "assignment-1",
    });
    assert.ok(assignment, scenario.name);
    await db.collection("role_assignments").updateOne(
      { _id: "assignment-1" },
      {
        $set: {
          lifecycle: {
            ...assignment.lifecycle,
            riskTier: "HIGH",
            reviewDeadline: day30,
          },
        },
      },
    );
    await db.collection("assignment_review_cycles").updateOne(
      { _id: "cycle-1" },
      {
        $set: {
          approvals: [
            {
              approverUserId: "reviewer-one",
              decidedAt: decisionAt - 1,
              decision: "APPROVED",
              reason: "first independent approval",
            },
          ],
        },
      },
    );
    const audit = new AuditCapture();
    const bridge = new SnapshotMutationBridge(db, audit);
    const service = lifecycleService(
      db,
      audit,
      bridge,
      sequenceClock(decisionAt, decisionAt).now,
    );

    await assert.rejects(
      traced(() =>
        service.decideReview(admin("reviewer-two"), {
          cycleId: "cycle-1",
          decision: "APPROVED",
          reason: scenario.name,
          nextReviewAt: scenario.nextReviewAt,
        }),
      ),
      new RegExp(scenario.error, "u"),
    );
    await assertNoLifecycleEffects(db, audit, bridge);
  }
});

test("lifecycle read exposes versioned defaults and replacement requires role or scope change", async () => {
  const db = lifecycleFixture();
  const accessAdminTemplate = getRoleTemplate("ACCESS_ADMIN");
  assert.ok(accessAdminTemplate);
  db.collection("roles").seed(
    {
      _id: "role-1",
      code: "ACCESS_ADMIN",
      templateCode: "ACCESS_ADMIN",
      templateVersion: accessAdminTemplate.version,
      state: "ACTIVE",
      delegationBand: "LIMITED",
      permissions: [...accessAdminTemplate.permissions],
    },
    {
      _id: "role-delegator",
      code: "ROLE_DELEGATOR",
      state: "ACTIVE",
      maxDelegatableBand: "LIMITED",
      permissions: [],
    },
  );
  db.collection("role_assignments").seed({
    _id: "assignment-requester",
    roleId: "role-delegator",
    userId: "requester",
    state: "ACTIVE",
    effectiveAt: Date.now() - 1_000,
    expiresAt: null,
    structuredScopeGrants: [{ scopeType: "global" }],
  });
  db.collection("users").seed({
    _id: "target",
    accountStatus: "ACTIVE",
    accountContexts: ["ADMIN_CONSOLE"],
    disabledAt: null,
    archivedAt: null,
  });
  db.collection("employment_profiles").seed({
    _id: "profile-target",
    linkedUserId: "target",
    employmentStatus: "ACTIVE",
    displayName: "Target user",
  });
  const audit = new AuditCapture();
  const bridge = new SnapshotMutationBridge(db, audit);
  const service = new AccessLifecycleP2AdminService(
    db.asDb(),
    audit.asGuard(),
    bridge,
    cache,
    exactAuthority,
  );
  const actor = adminWithPermissions("requester", [
    Permission.ROLE_ASSIGNMENT_REPLACE,
  ]);
  const listed = await service.listForActor(actor, "target");
  assert.equal(
    getPath(listed, "policy.version"),
    "access-lifecycle-command-policy/v2",
  );
  assert.equal(
    getPath(listed, "policy.grace.automaticExtensionMs"),
    72 * 60 * 60 * 1000,
  );
  assert.equal(
    getPath(
      listed,
      "requestableAssignments.0.structuredScopeGrants.0.scopeType",
    ),
    "self",
  );

  const command = {
    action: "REPLACEMENT",
    predecessorAssignmentId: "assignment-1",
    roleId: "role-1",
    structuredScopeGrants: [{ scopeType: "self" }],
    effectiveAt: Date.now() + 30_000,
    expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
    reviewAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    reason: "replace access shape",
    idempotencyKey: "replacement-same-1",
  } as const;
  const same = await traced(() => service.requestSuccessor(actor, command));
  assert.deepEqual(same.blockers, ["REPLACEMENT_MUST_CHANGE_ROLE_OR_SCOPE"]);
  assert.equal(bridge.executions, 0);

  bridge.beforeMutate = () => {
    void db.collection("role_assignments").updateOne(
      { _id: "assignment-1" },
      {
        $set: {
          structuredScopeGrants: [
            { scopeType: "contractPortfolio", targetKey: "portfolio-b" },
          ],
        },
      },
    );
  };
  const stale = await traced(() =>
    service.requestSuccessor(actor, {
      ...command,
      structuredScopeGrants: [
        { scopeType: "contractPortfolio", targetKey: "portfolio-b" },
      ],
      idempotencyKey: "replacement-stale-1",
    }),
  );
  assert.deepEqual(stale.blockers, ["REPLACEMENT_MUST_CHANGE_ROLE_OR_SCOPE"]);
  assert.equal(bridge.executions, 1);
  assert.equal(
    await db.collection("assignment_successor_requests").countDocuments({}),
    0,
  );
  assert.equal(audit.records.length, 0);
});

test("successor approval revalidates exact scope and outer action inside the callback", async () => {
  const makeDb = () => {
    const db = lifecycleFixture();
    db.collection("roles").seed({
      _id: "role-1",
      code: "ACCESS_ADMIN",
      templateCode: "ACCESS_ADMIN",
      state: "ACTIVE",
      permissions: [Permission.ROLE_VIEW],
    });
    db.collection("assignment_successor_requests").seed({
      _id: "successor-1",
      action: "RENEWAL",
      predecessorAssignmentId: "assignment-1",
      targetUserId: "target",
      requestedBy: "requester",
      requestedAt: Date.now(),
      reason: "renew",
      idempotencyKey: "successor-approval",
      payloadFingerprint: "payload",
      state: "PENDING",
      approvals: [],
      successorAssignmentId: null,
      appliedAt: null,
      successor: {
        roleId: "role-1",
        structuredScopeGrants: [{ scopeType: "global" }],
        scopeFingerprint: "scope:v1:global",
        effectiveAt: Date.now() + 60_000,
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
        reviewAt: Date.now() + 120_000,
        riskTier: "LOW",
        riskReasons: [],
        riskAssessedAt: Date.now(),
        permissionFingerprint: "permission:v1:test",
        sourceRoleId: "role-1",
        sourceRoleCode: "ACCESS_ADMIN",
        sourceRoleTemplateCode: "ACCESS_ADMIN",
        riskPolicyVersion: "access-risk-policy/v1",
      },
    });
    return db;
  };
  const actor = adminWithPermissions("reviewer", [
    Permission.ROLE_ASSIGNMENT_RENEW,
  ]);

  const scopeDb = makeDb();
  const scopeAudit = new AuditCapture();
  const scopeBridge = new SnapshotMutationBridge(scopeDb, scopeAudit);
  let checks = 0;
  const scopeService = new AccessLifecycleP2AdminService(
    scopeDb.asDb(),
    scopeAudit.asGuard(),
    scopeBridge,
    cache,
    { hasAuthority: async () => ++checks === 1 } as any,
  );
  const lostScope = await traced(() =>
    scopeService.approveSuccessor(actor, {
      requestId: "successor-1",
      decision: "APPROVED",
      reason: "review",
    }),
  );
  assert.deepEqual(lostScope.blockers, ["EXACT_LIFECYCLE_SCOPE_REQUIRED"]);
  assert.equal(scopeBridge.executions, 1);
  assert.equal(scopeAudit.records.length, 0);

  const actionDb = makeDb();
  const actionAudit = new AuditCapture();
  const actionBridge = new SnapshotMutationBridge(actionDb, actionAudit);
  actionBridge.beforeMutate = () => {
    void actionDb
      .collection("assignment_successor_requests")
      .updateOne({ _id: "successor-1" }, { $set: { action: "REPLACEMENT" } });
  };
  const actionService = new AccessLifecycleP2AdminService(
    actionDb.asDb(),
    actionAudit.asGuard(),
    actionBridge,
    cache,
    exactAuthority,
  );
  const drift = await traced(() =>
    actionService.approveSuccessor(actor, {
      requestId: "successor-1",
      decision: "APPROVED",
      reason: "review",
    }),
  );
  assert.deepEqual(drift.blockers, ["SUCCESSOR_ACTION_DRIFT"]);
  assert.equal(actionBridge.executions, 1);
  assert.equal(actionAudit.records.length, 0);
});

test("successor actions fail closed for wrong source state and renewal without source expiry", async () => {
  const cases = [
    {
      action: "RENEWAL",
      state: "SUSPENDED",
      blocker: "RENEWAL_SOURCE_MUST_BE_ACTIVE",
    },
    {
      action: "REPLACEMENT",
      state: "SUSPENDED",
      blocker: "REPLACEMENT_SOURCE_MUST_BE_ACTIVE",
    },
    {
      action: "RESTORATION",
      state: "ACTIVE",
      blocker: "RESTORATION_SOURCE_MUST_BE_SUSPENDED",
    },
    {
      action: "RENEWAL",
      state: "REVOKED",
      blocker: "RENEWAL_SOURCE_MUST_BE_ACTIVE",
    },
    {
      action: "REPLACEMENT",
      state: "SUPERSEDED",
      blocker: "REPLACEMENT_SOURCE_MUST_BE_ACTIVE",
    },
  ] as const;
  for (const item of cases) {
    const db = lifecycleFixture();
    await db
      .collection("role_assignments")
      .updateOne({ _id: "assignment-1" }, { $set: { state: item.state } });
    const audit = new AuditCapture();
    const bridge = new SnapshotMutationBridge(db, audit);
    const service = new AccessLifecycleP2AdminService(
      db.asDb(),
      audit.asGuard(),
      bridge,
      cache,
      exactAuthority,
    );
    const result = await traced(() =>
      service.requestSuccessor(
        adminWithPermissions("reviewer", [
          item.action === "REPLACEMENT"
            ? Permission.ROLE_ASSIGNMENT_REPLACE
            : Permission.ROLE_ASSIGNMENT_RENEW,
        ]),
        {
          action: item.action,
          predecessorAssignmentId: "assignment-1",
          ...(item.action === "REPLACEMENT"
            ? {
                roleId: "role-2",
                structuredScopeGrants: [{ scopeType: "global" }],
              }
            : {}),
          expiresAt: Date.now() + 60_000,
          reason: "state contract",
          idempotencyKey: `state-${item.action}-${item.state}`,
        },
      ),
    );
    assert.ok((result.blockers as string[]).includes(item.blocker));
    assert.equal(bridge.executions, 0);
    assert.equal(audit.records.length, 0);
  }

  const db = lifecycleFixture();
  await db
    .collection("role_assignments")
    .updateOne({ _id: "assignment-1" }, { $set: { expiresAt: null } });
  const audit = new AuditCapture();
  const bridge = new SnapshotMutationBridge(db, audit);
  const service = new AccessLifecycleP2AdminService(
    db.asDb(),
    audit.asGuard(),
    bridge,
    cache,
    exactAuthority,
  );
  const noExpiry = await traced(() =>
    service.requestSuccessor(
      adminWithPermissions("reviewer", [Permission.ROLE_ASSIGNMENT_RENEW]),
      {
        action: "RENEWAL",
        predecessorAssignmentId: "assignment-1",
        expiresAt: Date.now() + 60_000,
        reason: "no source expiry",
        idempotencyKey: "renewal-no-source-expiry",
      },
    ),
  );
  assert.ok(
    (noExpiry.blockers as string[]).includes(
      "RENEWAL_SOURCE_REQUIRES_EXPLICIT_EXPIRY",
    ),
  );
  assert.equal(bridge.executions, 0);
});

test("replacement effectiveAt is bounded by the predecessor canonical authority end", async () => {
  const now = Date.now();
  const cases = [
    {
      name: "after expiry",
      predecessorExpiresAt: now + 10_000,
      successorEffectiveAt: now + 15_000,
      accepted: false,
    },
    {
      name: "exact expiry boundary",
      predecessorExpiresAt: now + 10_000,
      successorEffectiveAt: now + 10_000,
      accepted: true,
    },
    {
      name: "before expiry",
      predecessorExpiresAt: now + 15_000,
      successorEffectiveAt: now + 10_000,
      accepted: true,
    },
    {
      name: "no finite predecessor end",
      predecessorExpiresAt: null,
      successorEffectiveAt: now + 15_000,
      accepted: true,
    },
  ] as const;
  for (const item of cases) {
    const fixture = replacementTimingFixture({
      now,
      predecessorExpiresAt: item.predecessorExpiresAt,
    });
    const result = await traced(() =>
      fixture.service.requestSuccessor(
        fixture.actor,
        replacementCommand(
          now,
          item.successorEffectiveAt,
          `boundary-${item.name}`,
        ),
      ),
    );
    if (item.accepted) {
      assert.equal(result.applied, true, item.name);
      assert.equal(fixture.bridge.executions, 1, item.name);
    } else {
      assert.deepEqual(
        result.blockers,
        ["SUCCESSOR_EFFECTIVE_AT_EXCEEDS_PREDECESSOR_AUTHORITY_END"],
        item.name,
      );
      assert.equal(fixture.bridge.executions, 0, item.name);
    }
  }
  const inactiveRole = replacementTimingFixture({
    now,
    predecessorExpiresAt: now + 20_000,
  });
  await inactiveRole.db
    .collection("roles")
    .updateOne({ _id: "role-1" }, { $set: { state: "INACTIVE" } });
  const inactiveResult = await traced(() =>
    inactiveRole.service.requestSuccessor(
      inactiveRole.actor,
      replacementCommand(now, now + 10_000, "inactive-predecessor-role"),
    ),
  );
  assert.deepEqual(inactiveResult.blockers, ["PREDECESSOR_ROLE_NOT_ACTIVE"]);
  assert.equal(inactiveRole.bridge.executions, 0);
});

test("restoration timing remains exempt from active predecessor continuity", async () => {
  const now = Date.now();
  const fixture = replacementTimingFixture({
    now,
    predecessorExpiresAt: now + 10_000,
    predecessorRoleCode: "ACCESS_ADMIN",
    durableReviewDeadline: now + 90 * 24 * 60 * 60 * 1_000,
  });
  await fixture.db
    .collection("role_assignments")
    .updateOne({ _id: "assignment-1" }, { $set: { state: "SUSPENDED" } });
  const result = await traced(() =>
    fixture.service.requestSuccessor(
      adminWithPermissions("requester", [Permission.ROLE_ASSIGNMENT_RENEW]),
      {
        action: "RESTORATION",
        predecessorAssignmentId: "assignment-1",
        effectiveAt: now + 15_000,
        expiresAt: now + 200 * 24 * 60 * 60 * 1_000,
        reviewAt: now + 30 * 24 * 60 * 60 * 1_000,
        reason: "restore suspended authority",
        idempotencyKey: "restoration-continuity-exempt",
      },
    ),
  );
  assert.equal(result.applied, true);
});

test("restoration read eligibility is mutation-equivalent for Role, expiry, and successor state", async () => {
  const now = Date.now();
  const actor = adminWithPermissions("requester", [
    Permission.ROLE_ASSIGNMENT_RENEW,
  ]);
  const read = async (input: {
    readonly roleState?: "ACTIVE" | "INACTIVE" | "MISSING";
    readonly expiresAt?: number;
    readonly successorAssignmentId?: string | null;
    readonly successorEffectiveAt?: number | null;
  }) => {
    const db = lifecycleFixture();
    await db.collection("role_assignments").updateOne(
      { _id: "assignment-1" },
      {
        $set: {
          state: "SUSPENDED",
          expiresAt: input.expiresAt ?? now + 60_000,
          "lifecycle.successorAssignmentId":
            input.successorAssignmentId ?? null,
          "lifecycle.successorEffectiveAt": input.successorEffectiveAt ?? null,
        },
      },
    );
    if (input.roleState === "MISSING") {
      db.collection("roles").records.clear();
    } else if (input.roleState === "INACTIVE") {
      await db
        .collection("roles")
        .updateOne({ _id: "role-1" }, { $set: { state: "INACTIVE" } });
    }
    const audit = new AuditCapture();
    const service = new AccessLifecycleP2AdminService(
      db.asDb(),
      audit.asGuard(),
      new SnapshotMutationBridge(db, audit),
      cache,
      exactAuthority,
      undefined,
      () => now,
    );
    const result = await service.listForActor(actor, "target");
    return (result.requestableAssignments as Array<any>)[0];
  };

  assert.equal((await read({})).canRestore, true);
  assert.equal(
    (await read({ expiresAt: now })).ineligibilityReasons.restoration,
    "SOURCE_ASSIGNMENT_EXPIRED",
  );
  assert.equal(
    (
      await read({
        successorAssignmentId: "successor",
        successorEffectiveAt: now + 1_000,
      })
    ).ineligibilityReasons.restoration,
    "SUCCESSOR_ALREADY_SCHEDULED",
  );
  assert.equal(
    (await read({ roleState: "MISSING" })).ineligibilityReasons.restoration,
    "PREDECESSOR_ROLE_NOT_ACTIVE",
  );
  assert.equal(
    (await read({ roleState: "INACTIVE" })).ineligibilityReasons.restoration,
    "PREDECESSOR_ROLE_NOT_ACTIVE",
  );
});

test("expired suspended restoration is blocked with zero durable effects", async () => {
  const now = Date.now();
  const fixture = replacementTimingFixture({
    now,
    predecessorExpiresAt: now - 1,
  });
  await fixture.db
    .collection("role_assignments")
    .updateOne({ _id: "assignment-1" }, { $set: { state: "SUSPENDED" } });
  const slotsBefore = await fixture.db
    .collection("role_assignment_authority_slots")
    .countDocuments({});
  const result = await traced(() =>
    fixture.service.requestSuccessor(
      adminWithPermissions("requester", [Permission.ROLE_ASSIGNMENT_RENEW]),
      {
        action: "RESTORATION",
        predecessorAssignmentId: "assignment-1",
        effectiveAt: now + 1_000,
        expiresAt: now + 100_000,
        reviewAt: now + 50_000,
        reason: "must not restore expired authority",
        idempotencyKey: "expired-restoration-blocked",
      },
    ),
  );
  assert.equal(
    (result.blockers as string[]).includes("SOURCE_ASSIGNMENT_EXPIRED"),
    true,
  );
  assert.equal(fixture.bridge.executions, 0);
  assert.equal(
    await fixture.db
      .collection("assignment_successor_requests")
      .countDocuments({}),
    0,
  );
  assert.equal(
    await fixture.db
      .collection("role_assignment_authority_slots")
      .countDocuments({}),
    slotsBefore,
  );
  assert.equal(fixture.audit.records.length, 0);
  assert.equal(fixture.bridge.securityVersionChanges, 0);
  assert.equal(fixture.bridge.outboxEvents, 0);
});

test("current review policy bounds replacement while LOW grace preserves its actual handoff window", async () => {
  const now = Date.now();
  const high = replacementTimingFixture({
    now,
    predecessorExpiresAt: now + 200 * 24 * 60 * 60 * 1_000,
    predecessorRoleCode: "ACCESS_ADMIN",
    predecessorEffectiveAt: now - 30 * 24 * 60 * 60 * 1_000 + 10_000,
    durableReviewDeadline: now + 90 * 24 * 60 * 60 * 1_000,
  });
  const highResult = await traced(() =>
    high.service.requestSuccessor(
      high.actor,
      replacementCommand(now, now + 15_000, "current-high-boundary"),
    ),
  );
  assert.deepEqual(highResult.blockers, [
    "SUCCESSOR_EFFECTIVE_AT_EXCEEDS_PREDECESSOR_AUTHORITY_END",
  ]);

  const low = replacementTimingFixture({
    now,
    predecessorExpiresAt: now + 200 * 24 * 60 * 60 * 1_000,
    durableReviewDeadline: now - 1_000,
    graceExceptionExpiresAt: now + 60_000,
  });
  const lowResult = await traced(() =>
    low.service.requestSuccessor(
      low.actor,
      replacementCommand(now, now + 30_000, "current-low-grace"),
    ),
  );
  assert.equal(lowResult.applied, true);
});

test("inner predecessor drift blocks deterministically without successor side effects", async () => {
  const now = Date.now();
  const fixture = replacementTimingFixture({
    now,
    predecessorExpiresAt: now + 20_000,
  });
  fixture.bridge.beforeMutate = () => {
    void fixture.db
      .collection("role_assignments")
      .updateOne(
        { _id: "assignment-1" },
        { $set: { expiresAt: now + 10_000 } },
      );
  };
  const command = replacementCommand(now, now + 15_000, "inner-expiry-drift");
  const first = await traced(() =>
    fixture.service.requestSuccessor(fixture.actor, command),
  );
  assert.deepEqual(first.blockers, [
    "SUCCESSOR_EFFECTIVE_AT_EXCEEDS_PREDECESSOR_AUTHORITY_END",
  ]);
  assert.equal(
    await fixture.db
      .collection("assignment_successor_requests")
      .countDocuments({}),
    0,
  );
  assert.equal(fixture.audit.records.length, 0);
  assert.equal(fixture.bridge.securityVersionChanges, 0);
  const retry = await traced(() =>
    fixture.service.requestSuccessor(fixture.actor, command),
  );
  assert.deepEqual(retry.blockers, first.blockers);
  assert.equal(
    await fixture.db
      .collection("role_assignment_authority_slots")
      .countDocuments({}),
    0,
  );
});

test("inner current Role risk drift applies the earlier canonical predecessor deadline", async () => {
  const now = Date.now();
  const fixture = replacementTimingFixture({
    now,
    predecessorExpiresAt: now + 200 * 24 * 60 * 60 * 1_000,
    predecessorEffectiveAt: now - 30 * 24 * 60 * 60 * 1_000 + 10_000,
  });
  const accessAdmin = getRoleTemplate("ACCESS_ADMIN");
  assert.ok(accessAdmin);
  fixture.bridge.beforeMutate = () => {
    void fixture.db.collection("roles").updateOne(
      { _id: "role-1" },
      {
        $set: {
          code: "ACCESS_ADMIN",
          templateCode: "ACCESS_ADMIN",
          templateVersion: accessAdmin.version,
          permissions: [...accessAdmin.permissions],
        },
      },
    );
  };
  const result = await traced(() =>
    fixture.service.requestSuccessor(
      fixture.actor,
      replacementCommand(now, now + 15_000, "inner-risk-drift"),
    ),
  );
  assert.deepEqual(result.blockers, [
    "SUCCESSOR_EFFECTIVE_AT_EXCEEDS_PREDECESSOR_AUTHORITY_END",
  ]);
  assert.equal(
    await fixture.db
      .collection("assignment_successor_requests")
      .countDocuments({}),
    0,
  );
  assert.equal(fixture.audit.records.length, 0);
});

test("approval revalidates predecessor end and exact-boundary different-slot handoff has no slot gap", async () => {
  const now = Date.now();
  const exact = replacementTimingFixture({
    now,
    predecessorExpiresAt: now + 10_000,
    durableReviewDeadline: now + 180 * 24 * 60 * 60 * 1_000,
  });
  seedPendingReplacement(exact, now + 10_000, "approval-exact");
  const exactResult = await traced(() =>
    exact.service.approveSuccessor(
      adminWithPermissions("reviewer", [Permission.ROLE_ASSIGNMENT_REPLACE]),
      {
        requestId: "request-approval-exact",
        decision: "APPROVED",
        reason: "exact handoff",
      },
    ),
  );
  assert.equal(exactResult.applied, true);
  assert.equal(exactResult.state, "APPLIED");
  const predecessorSlotId = buildAuthoritySlotIdentity({
    userId: "target",
    roleId: "role-1",
    structuredScopeGrants: [{ scopeType: "self" }],
  }).id;
  const oldSlot = await exact.db
    .collection("role_assignment_authority_slots")
    .findOne({
      _id: predecessorSlotId,
    });
  assert.equal(oldSlot?.releaseAt, now + 10_000);
  assert.equal(
    await exact.db
      .collection("role_assignment_authority_slots")
      .countDocuments({}),
    2,
  );
  assert.equal(exact.audit.records.length, 1);
  assert.equal(exact.bridge.securityVersionChanges, 1);
  assert.equal(exact.bridge.outboxEvents, 1);

  const drift = replacementTimingFixture({
    now,
    predecessorExpiresAt: now + 20_000,
    durableReviewDeadline: now + 180 * 24 * 60 * 60 * 1_000,
  });
  seedPendingReplacement(drift, now + 15_000, "approval-drift");
  drift.bridge.beforeMutate = () => {
    void drift.db
      .collection("role_assignments")
      .updateOne(
        { _id: "assignment-1" },
        { $set: { expiresAt: now + 10_000 } },
      );
  };
  const blockedApproval = await traced(() =>
    drift.service.approveSuccessor(
      adminWithPermissions("reviewer", [Permission.ROLE_ASSIGNMENT_REPLACE]),
      {
        requestId: "request-approval-drift",
        decision: "APPROVED",
        reason: "drifted handoff",
      },
    ),
  );
  assert.deepEqual(blockedApproval.blockers, [
    "SUCCESSOR_EFFECTIVE_AT_EXCEEDS_PREDECESSOR_AUTHORITY_END",
  ]);
  assert.equal(
    await drift.db
      .collection("role_assignment_authority_slots")
      .countDocuments({}),
    1,
  );
  assert.equal(
    (
      await drift.db.collection("assignment_successor_requests").findOne({
        _id: "request-approval-drift",
      })
    )?.approvals.length,
    0,
  );
  assert.equal(drift.audit.records.length, 0);
  assert.equal(drift.bridge.securityVersionChanges, 0);
  assert.equal(drift.bridge.outboxEvents, 0);

  const rollback = replacementTimingFixture({
    now,
    predecessorExpiresAt: now + 10_000,
    durableReviewDeadline: now + 180 * 24 * 60 * 60 * 1_000,
  });
  seedPendingReplacement(rollback, now + 10_000, "approval-rollback");
  const rollbackOldSlot = rollback.db.collection(
    "role_assignment_authority_slots",
  );
  await rollbackOldSlot.updateOne(
    { _id: predecessorSlotId },
    { $set: { currentAssignmentId: "unexpected-holder" } },
  );
  await assert.rejects(
    traced(() =>
      rollback.service.approveSuccessor(
        adminWithPermissions("reviewer", [Permission.ROLE_ASSIGNMENT_REPLACE]),
        {
          requestId: "request-approval-rollback",
          decision: "APPROVED",
          reason: "rollback handoff",
        },
      ),
    ),
    /AUTHORITY_SLOT_CURRENT_ASSIGNMENT_MISMATCH/u,
  );
  assert.equal(
    await rollback.db
      .collection("role_assignment_authority_slots")
      .countDocuments({}),
    1,
  );
  assert.equal(
    await rollback.db.collection("role_assignments").countDocuments({}),
    3,
  );
  assert.equal(rollback.audit.records.length, 0);
  assert.equal(rollback.bridge.securityVersionChanges, 0);
  assert.equal(rollback.bridge.outboxEvents, 0);
});

test("review rejection rollback restores the pending cycle when suspension fails", async () => {
  const db = lifecycleFixture();
  const audit = new AuditCapture();
  const bridge = new SnapshotMutationBridge(db, audit);
  db.collection("role_assignments").failNextUpdate = true;
  const service = new AccessLifecycleP2AdminService(
    db.asDb(),
    audit.asGuard(),
    bridge,
    cache,
    exactAuthority,
  );

  await assert.rejects(
    traced(() =>
      service.decideReview(admin("reviewer"), {
        cycleId: "cycle-1",
        decision: "REJECTED",
        reason: "risk rejected",
      }),
    ),
    /STALE_ASSIGNMENT_STATE/u,
  );
  assert.equal(
    (
      await db
        .collection("assignment_review_cycles")
        .findOne({ _id: "cycle-1" })
    )?.state,
    "PENDING",
  );
  assert.equal(
    (await db.collection("role_assignments").findOne({ _id: "assignment-1" }))
      ?.state,
    "ACTIVE",
  );
  assert.equal(audit.records.length, 0);
});

test("break-glass rejection is persisted with an audit decision and active review is denied", async () => {
  const db = new FakeDb();
  db.collection("break_glass_requests").seed(breakGlassRequest());
  db.collection("break_glass_activations").seed(breakGlassActivation("ACTIVE"));
  const audit = new AuditCapture();
  const bridge = new SnapshotMutationBridge(db, audit);
  const service = new AccessBreakGlassAdminService(
    db.asDb(),
    audit.asGuard(),
    bridge,
    cache,
    { evaluate: async () => ({ supported: false, state: "NOT_SUPPORTED" }) },
    undefined,
    exactAuthority,
  );

  const activeReview = await traced(() =>
    service.reviewActivation(
      adminWithPermissions("reviewer", [Permission.BREAK_GLASS_REVIEW]),
      {
        activationId: "activation-1",
        result: "APPROVED_USE",
        reason: "review",
      },
    ),
  );
  assert.deepEqual(activeReview.blockers, [
    "POST_USE_REVIEW_REQUIRES_EXPIRED_ACTIVATION",
  ]);
  assert.equal(bridge.executions, 0);

  const rejected = await traced(() =>
    service.approveRequest(
      adminWithPermissions("approver", [Permission.BREAK_GLASS_APPROVE]),
      {
        requestId: "request-1",
        decision: "REJECTED",
        reason: "not justified",
      },
    ),
  );
  assert.equal(rejected.status, "REJECTED");
  assert.equal(audit.records.length, 1);
  assert.equal(audit.records[0]?.metadata?.decision, "REJECTED");
});

test("break-glass queues and actions use the same exact structured-scope evaluator", async () => {
  const db = new FakeDb();
  const base = breakGlassRequest();
  db.collection("break_glass_requests").seed(
    {
      ...base,
      _id: "request-a",
      idempotencyKey: "key-a",
      structuredScopeGrants: [
        { scopeType: "contractPortfolio", targetKey: "portfolio-a" },
      ],
    },
    {
      ...base,
      _id: "request-b",
      idempotencyKey: "key-b",
      targetUserId: "target-b",
      requesterUserId: "requester-b",
      structuredScopeGrants: [
        { scopeType: "contractPortfolio", targetKey: "portfolio-b" },
      ],
    },
  );
  db.collection("break_glass_activations").seed({
    ...breakGlassActivation("EXPIRED"),
    structuredScopeGrants: [
      { scopeType: "contractPortfolio", targetKey: "portfolio-b" },
    ],
  });
  let allowPortfolioA = true;
  const scopedAuthority = authorityMock(
    ({ scope }: any) => allowPortfolioA && scope.targetKey === "portfolio-a",
  );
  const audit = new AuditCapture();
  const bridge = new SnapshotMutationBridge(db, audit);
  const service = new AccessBreakGlassAdminService(
    db.asDb(),
    audit.asGuard(),
    bridge,
    cache,
    undefined,
    undefined,
    scopedAuthority,
  );
  const approver = adminWithPermissions("scoped-approver", [
    Permission.BREAK_GLASS_APPROVE,
  ]);

  const listed = await service.listForActor(approver);
  assert.deepEqual(
    (listed.requests as Array<{ requestId: string }>).map(
      (item) => item.requestId,
    ),
    ["request-a"],
  );
  allowPortfolioA = false;
  const denied = await traced(() =>
    service.approveRequest(approver, {
      requestId: "request-a",
      decision: "APPROVED",
      reason: "independent approval",
    }),
  );
  assert.deepEqual(denied.blockers, ["EXACT_APPROVER_SCOPE_REQUIRED"]);
  const reviewDenied = await traced(() =>
    service.reviewActivation(
      adminWithPermissions("scoped-reviewer", [Permission.BREAK_GLASS_REVIEW]),
      {
        activationId: "activation-1",
        result: "APPROVED_USE",
        reason: "wrong scope review",
      },
    ),
  );
  assert.deepEqual(reviewDenied.blockers, ["EXACT_REVIEWER_SCOPE_REQUIRED"]);
  assert.equal(bridge.executions, 0);
  assert.equal(audit.records.length, 0);
});

test("break-glass request retries replay one durable result and reject key collisions", async () => {
  const db = new FakeDb();
  const audit = new AuditCapture();
  const bridge = new SnapshotMutationBridge(db, audit);
  const service = new AccessBreakGlassAdminService(
    db.asDb(),
    audit.asGuard(),
    bridge,
    cache,
    undefined,
    undefined,
    exactAuthority,
  );
  const requester = adminWithPermissions("requester", [
    Permission.BREAK_GLASS_REQUEST,
  ]);
  const command = {
    targetUserId: "target",
    permissions: [Permission.ROLE_VIEW],
    structuredScopeGrants: [{ scopeType: "global" }],
    urgency: "NON_URGENT",
    incidentReferenceId: "INC-REPLAY-1",
    reason: "incident response",
    durationMs: 60_000,
    idempotencyKey: "break-glass-replay-1",
  } as const;

  const first = await traced(() => service.createRequest(requester, command));
  const replay = await traced(() => service.createRequest(requester, command));
  assert.equal(first.applied, true);
  assert.equal(replay.applied, false);
  assert.equal(replay.replay, true);
  assert.equal(
    (first.request as any).requestId,
    (replay.request as any).requestId,
  );
  assert.equal(bridge.executions, 1);
  assert.equal(audit.records.length, 1);
  assert.equal(
    await db.collection("break_glass_requests").countDocuments({}),
    1,
  );

  await assert.rejects(
    traced(() =>
      service.createRequest(requester, {
        ...command,
        reason: "different payload",
      }),
    ),
    /IDEMPOTENCY_KEY_CONFLICT/u,
  );
  assert.equal(bridge.executions, 1);
  assert.equal(audit.records.length, 1);
});

test("break-glass idempotency race resolves the unique-index winner without duplicate effects", async () => {
  const db = new FakeDb();
  const audit = new AuditCapture();
  const bridge = new SnapshotMutationBridge(db, audit);
  let lookups = 0;
  let concurrentWinner: any = null;
  const racingRepository = {
    findRequestByIdempotencyKey: async () => {
      lookups += 1;
      return lookups <= 2 ? null : concurrentWinner;
    },
    insertRequest: async (record: any) => {
      concurrentWinner = structuredClone(record);
      throw Object.assign(new Error("duplicate idempotency key"), {
        code: 11000,
      });
    },
    findActivationByRequestId: async () => null,
  } as any;
  const service = new AccessBreakGlassAdminService(
    db.asDb(),
    audit.asGuard(),
    bridge,
    cache,
    undefined,
    undefined,
    exactAuthority,
    racingRepository,
  );
  const requester = adminWithPermissions("requester", [
    Permission.BREAK_GLASS_REQUEST,
  ]);

  const result = await traced(() =>
    service.createRequest(requester, {
      targetUserId: "target",
      permissions: [Permission.ROLE_VIEW],
      structuredScopeGrants: [{ scopeType: "global" }],
      urgency: "NON_URGENT",
      incidentReferenceId: "INC-RACE-1",
      reason: "concurrent response-loss retry",
      durationMs: 60_000,
      idempotencyKey: "break-glass-race-1",
    }),
  );
  assert.equal(result.applied, false);
  assert.equal(result.replay, true);
  assert.equal((result.request as any).requestId, concurrentWinner.requestId);
  assert.equal(bridge.executions, 1);
  assert.equal(audit.records.length, 0);
  assert.equal(bridge.securityVersionChanges, 0);
});

test("break-glass read and audit derive overdue independent-review state on the backend", async () => {
  const db = new FakeDb();
  const projectionNow = Date.now();
  const dueAt = projectionNow;
  db.collection("break_glass_activations").seed(
    {
      ...breakGlassActivation("EXPIRED"),
      independentReviewDeadline: {
        dueAt,
        calendarVersion: "vn-2026-v2",
        timeZone: "Asia/Ho_Chi_Minh",
      },
    },
    {
      ...breakGlassActivation("EXPIRED"),
      _id: "activation-pending",
      requestId: "request-pending",
      independentReviewDeadline: {
        dueAt: projectionNow + 1,
        calendarVersion: "vn-2026-v2",
        timeZone: "Asia/Ho_Chi_Minh",
      },
    },
  );
  const audit = new AuditCapture();
  const bridge = new SnapshotMutationBridge(db, audit);
  const service = new AccessBreakGlassAdminService(
    db.asDb(),
    audit.asGuard(),
    bridge,
    cache,
    undefined,
    undefined,
    exactAuthority,
    undefined,
    () => projectionNow,
  );
  const reviewer = adminWithPermissions("reviewer", [
    Permission.BREAK_GLASS_REVIEW,
  ]);

  const listed = await service.listForActor(reviewer);
  assert.equal(getPath(listed, "policy.defaultDurationMs"), 60 * 60 * 1000);
  const projections = new Map(
    (listed.activations as Array<any>).map((item) => [item.activationId, item]),
  );
  assert.equal(
    projections.get("activation-1")?.independentReviewState,
    "OVERDUE",
  );
  assert.equal(projections.get("activation-1")?.overdueSince, dueAt);
  assert.equal(
    projections.get("activation-pending")?.independentReviewState,
    "PENDING",
  );
  const reviewed = await traced(() =>
    service.reviewActivation(reviewer, {
      activationId: "activation-1",
      result: "APPROVED_USE",
      reason: "late review completed",
    }),
  );
  assert.equal(reviewed.status, "REVIEWED");
  assert.equal(audit.records[0]?.metadata?.independentReviewDueAt, dueAt);
  assert.equal(audit.records[0]?.metadata?.independentReviewWasOverdue, true);
  assert.equal(
    typeof audit.records[0]?.metadata?.independentReviewCompletedAt,
    "number",
  );
  const completed = await service.listForActor(reviewer);
  assert.equal(
    getPath(completed, "activations.0.independentReviewState"),
    "COMPLETED",
  );
  assert.equal(getPath(completed, "activations.0.wasOverdue"), true);
});

test("manual break-glass beneficiary end is an exact, idempotent authority reduction", async () => {
  const requestNow = 1_000_000;
  const transactionNow = requestNow + 5;
  let clockCalls = 0;
  const originalExpiresAt = requestNow + 4 * 60 * 60 * 1_000;
  const reviewDueAt = originalExpiresAt + 60_000;
  const db = new FakeDb();
  db.collection("users").seed(eligibleUser("target"));
  db.collection("break_glass_activations").seed({
    ...breakGlassActivation("ACTIVE"),
    activatedAt: requestNow - 5 * 60 * 1_000,
    expiresAt: originalExpiresAt,
    endedAt: null,
    endedByUserId: null,
    endReason: null,
    independentReviewDeadline: {
      dueAt: reviewDueAt,
      calendarVersion: "v1",
      timeZone: "Asia/Ho_Chi_Minh",
      resolution: "CALENDAR",
    },
  });
  const audit = new AuditCapture();
  const bridge = new SnapshotMutationBridge(db, audit);
  let invalidations = 0;
  const service = new AccessBreakGlassAdminService(
    db.asDb(),
    audit.asGuard(),
    bridge,
    {
      invalidateAll: async () => {
        invalidations += 1;
      },
    } as any,
    undefined,
    undefined,
    exactAuthority,
    undefined,
    () => (clockCalls++ === 0 ? requestNow : transactionNow),
  );
  const beneficiary = adminWithPermissions("target", [
    Permission.BREAK_GLASS_END,
  ]);

  const ended = await traced(() =>
    service.endActivation(beneficiary, {
      activationId: "activation-1",
      reason: "incident resolved",
    }),
  );
  assert.equal(ended.applied, true);
  assert.equal(ended.endedAt, transactionNow);
  assert.equal(ended.originalExpiresAt, originalExpiresAt);
  assert.equal(ended.postUseReviewRequired, true);
  const persisted = await db.collection("break_glass_activations").findOne({
    _id: "activation-1",
  });
  assert.equal(persisted?.status, "EXPIRED");
  assert.equal(persisted?.endedAt, transactionNow);
  assert.equal(persisted?.endedByUserId, "target");
  assert.equal(persisted?.endReason, "incident resolved");
  assert.equal(persisted?.expiresAt, originalExpiresAt);
  assert.equal(persisted?.independentReviewDeadline.dueAt, reviewDueAt);
  assert.equal(
    isBreakGlassActivationEffective(
      { ...persisted, activationId: "activation-1" } as never,
      transactionNow,
    ),
    false,
  );
  assert.equal(audit.records.length, 1);
  assert.equal(audit.records[0]?.metadata?.endMode, "BENEFICIARY_SELF");
  assert.equal(audit.records[0]?.metadata?.endedAt, transactionNow);
  assert.equal(bridge.securityVersionChanges, 1);
  assert.equal(bridge.outboxEvents, 1);
  assert.equal(invalidations, 1);

  const replay = await traced(() =>
    service.endActivation(beneficiary, {
      activationId: "activation-1",
      reason: "incident resolved",
    }),
  );
  assert.equal(replay.applied, false);
  assert.equal(replay.replay, true);
  assert.equal(replay.endedAt, transactionNow);
  assert.equal(bridge.executions, 1);
  assert.equal(audit.records.length, 1);
  assert.equal(bridge.securityVersionChanges, 1);
  assert.equal(bridge.outboxEvents, 1);
  assert.equal(invalidations, 1);
});

test("manual break-glass end permits exact Primary Owner and denies all other actors", async () => {
  const now = Date.now();
  const db = governanceFixture();
  db.collection("break_glass_activations").seed({
    ...breakGlassActivation("ACTIVE"),
    activatedAt: now - 1_000,
    expiresAt: now + 60_000,
    endedAt: null,
  });
  const audit = new AuditCapture();
  const bridge = new SnapshotMutationBridge(db, audit);
  const service = new AccessBreakGlassAdminService(
    db.asDb(),
    audit.asGuard(),
    bridge,
    cache,
    undefined,
    undefined,
    exactAuthority,
    undefined,
    () => now,
  );
  const unauthorized = await service.endActivation(
    adminWithPermissions("other", [Permission.BREAK_GLASS_END]),
    { activationId: "activation-1", reason: "not authorized" },
  );
  assert.deepEqual(unauthorized.blockers, ["ACTIVE_PRIMARY_OWNER_REQUIRED"]);
  assert.equal(bridge.executions, 0);

  const ended = await traced(() =>
    service.endActivation(
      adminWithPermissions("owner", [
        Permission.BREAK_GLASS_END,
        Permission.BREAK_GLASS_ACTIVATE,
      ]),
      { activationId: "activation-1", reason: "owner terminated access" },
    ),
  );
  assert.equal(ended.applied, true);
  assert.equal(audit.records[0]?.metadata?.endMode, "PRIMARY_OWNER");
  assert.equal(bridge.securityVersionChanges, 1);
});

test("manual break-glass end after natural expiry is a zero-effect typed denial", async () => {
  const now = 3_000_000;
  const db = new FakeDb();
  db.collection("users").seed(eligibleUser("target"));
  db.collection("break_glass_activations").seed({
    ...breakGlassActivation("ACTIVE"),
    activatedAt: now - 10_000,
    expiresAt: now,
    endedAt: null,
  });
  const audit = new AuditCapture();
  const bridge = new SnapshotMutationBridge(db, audit);
  const service = new AccessBreakGlassAdminService(
    db.asDb(),
    audit.asGuard(),
    bridge,
    cache,
    undefined,
    undefined,
    exactAuthority,
    undefined,
    () => now,
  );
  const result = await service.endActivation(
    adminWithPermissions("target", [Permission.BREAK_GLASS_END]),
    { activationId: "activation-1", reason: "already over" },
  );
  assert.deepEqual(result.blockers, ["BREAK_GLASS_NOT_CURRENTLY_ACTIVE"]);
  assert.equal(bridge.executions, 0);
  assert.equal(audit.records.length, 0);
  assert.equal(bridge.securityVersionChanges, 0);
  assert.equal(bridge.outboxEvents, 0);
});

test("manual break-glass security-version failure rolls back end, audit, and outbox", async () => {
  const now = 4_000_000;
  const db = new FakeDb();
  db.collection("users").seed(eligibleUser("target"));
  db.collection("break_glass_activations").seed({
    ...breakGlassActivation("ACTIVE"),
    activatedAt: now - 1_000,
    expiresAt: now + 60_000,
    endedAt: null,
  });
  const audit = new AuditCapture();
  const bridge = new SnapshotMutationBridge(db, audit);
  bridge.failSecurityVersion = true;
  const service = new AccessBreakGlassAdminService(
    db.asDb(),
    audit.asGuard(),
    bridge,
    cache,
    undefined,
    undefined,
    exactAuthority,
    undefined,
    () => now,
  );

  await assert.rejects(
    traced(() =>
      service.endActivation(
        adminWithPermissions("target", [Permission.BREAK_GLASS_END]),
        { activationId: "activation-1", reason: "rollback proof" },
      ),
    ),
    /INJECTED_SECURITY_VERSION_FAILURE/u,
  );
  const persisted = await db.collection("break_glass_activations").findOne({
    _id: "activation-1",
  });
  assert.equal(persisted?.status, "ACTIVE");
  assert.equal(persisted?.endedAt, null);
  assert.equal(audit.records.length, 0);
  assert.equal(bridge.securityVersionChanges, 0);
  assert.equal(bridge.outboxEvents, 0);
});

test("authoritative audit failure rolls back expired post-use review", async () => {
  const db = new FakeDb();
  db.collection("break_glass_activations").seed(
    breakGlassActivation("EXPIRED"),
  );
  const audit = new AuditCapture();
  audit.fail = true;
  const bridge = new SnapshotMutationBridge(db, audit);
  const service = new AccessBreakGlassAdminService(
    db.asDb(),
    audit.asGuard(),
    bridge,
    cache,
    undefined,
    undefined,
    exactAuthority,
  );
  await assert.rejects(
    traced(() =>
      service.reviewActivation(
        adminWithPermissions("reviewer", [Permission.BREAK_GLASS_REVIEW]),
        {
          activationId: "activation-1",
          result: "MISUSE_FOUND",
          reason: "misuse",
        },
      ),
    ),
    /INJECTED_AUDIT_FAILURE/u,
  );
  assert.equal(
    (
      await db
        .collection("break_glass_activations")
        .findOne({ _id: "activation-1" })
    )?.status,
    "EXPIRED",
  );
});

test("non-urgent second approval fails closed when fresh inner step-up expires", async () => {
  const db = new FakeDb();
  db.collection("break_glass_requests").seed({
    ...breakGlassRequest(),
    approvals: [
      {
        approverUserId: "reviewer-1",
        decision: "APPROVED",
        reason: "first independent approval",
        decidedAt: Date.now() - 1_000,
      },
    ],
  });
  const evidence = [
    {
      supported: true,
      state: "SATISFIED" as const,
      evidence: { version: "v1", evaluatedAt: 1 },
    },
    {
      supported: true,
      state: "NOT_SATISFIED" as const,
      evidence: { version: "v2", evaluatedAt: 2 },
    },
  ];
  const audit = new AuditCapture();
  const bridge = new SnapshotMutationBridge(db, audit);
  const service = new AccessBreakGlassAdminService(
    db.asDb(),
    audit.asGuard(),
    bridge,
    cache,
    {
      evaluate: async () =>
        evidence.shift() ?? { supported: true, state: "NOT_SATISFIED" },
    },
    undefined,
    exactAuthority,
  );

  const result = await traced(() =>
    service.approveRequest(
      adminWithPermissions("reviewer-2", [Permission.BREAK_GLASS_APPROVE]),
      {
        requestId: "request-1",
        decision: "APPROVED",
        reason: "second approval",
      },
    ),
  );

  assert.deepEqual(result.blockers, ["STEP_UP_REQUIRED"]);
  assert.equal(bridge.executions, 1);
  assert.equal(
    await db.collection("break_glass_activations").countDocuments({}),
    0,
  );
  assert.equal(
    (await db.collection("break_glass_requests").findOne({ _id: "request-1" }))
      ?.status,
    "PENDING_APPROVAL",
  );
  assert.equal(audit.records.length, 0);
});

test("OD-P2-05 enforces active-owner proposal and independent eligible approval/activation", async () => {
  const db = governanceFixture();
  const audit = new AuditCapture();
  const bridge = new SnapshotMutationBridge(db, audit);
  const now = Date.now();
  const service = new GovernancePrincipalAdminService(
    db.asDb(),
    audit.asGuard(),
    bridge,
    cache,
    undefined,
    () => now,
  );
  const proposed = await traced(() =>
    service.proposeSuccessor(admin("owner"), {
      targetUserId: "target",
      effectiveAt: now + 1_000,
      expiresAt: now + 60_000,
      reason: "continuity",
      idempotencyKey: "proposal-1",
    }),
  );
  const principalId = (proposed.principal as any).principalId as string;

  const proposerDenied = await traced(() =>
    service.decideSuccessor(admin("owner"), {
      principalId,
      decision: "APPROVED",
      reason: "self approval",
      idempotencyKey: "decision-self",
    }),
  );
  assert.deepEqual(proposerDenied.blockers, ["REQUESTER_CANNOT_APPROVE"]);
  const targetDenied = await traced(() =>
    service.decideSuccessor(admin("target"), {
      principalId,
      decision: "APPROVED",
      reason: "target approval",
      idempotencyKey: "decision-target",
    }),
  );
  assert.deepEqual(targetDenied.blockers, ["TARGET_CANNOT_APPROVE"]);

  const approved = await traced(() =>
    service.decideSuccessor(admin("reviewer"), {
      principalId,
      decision: "APPROVED",
      reason: "independent approval",
      idempotencyKey: "decision-reviewer",
    }),
  );
  assert.equal((approved.principal as any).status, "ACTIVE");
  const effectiveService = new GovernancePrincipalAdminService(
    db.asDb(),
    audit.asGuard(),
    bridge,
    cache,
    undefined,
    () => now + 2_000,
  );
  const activated = await traced(() =>
    effectiveService.activateSuccessor(admin("reviewer"), {
      principalId,
      reason: "effective window reached",
      idempotencyKey: "activation-1",
    }),
  );
  assert.equal((activated.primaryOwner as any).principalType, "PRIMARY_OWNER");
  assert.equal(audit.records.length, 3);
  assert.equal(bridge.securityVersionChanges, 1);
});

test("successor activation is limited to the approved reviewer and exact current predecessor", async () => {
  const db = governanceFixture();
  const audit = new AuditCapture();
  const bridge = new SnapshotMutationBridge(db, audit);
  const now = Date.now();
  const service = new GovernancePrincipalAdminService(
    db.asDb(),
    audit.asGuard(),
    bridge,
    cache,
    undefined,
    () => now,
  );
  const proposed = await traced(() =>
    service.proposeSuccessor(admin("owner"), {
      targetUserId: "target",
      effectiveAt: now + 1_000,
      expiresAt: now + 60_000,
      reason: "lineage continuity",
      idempotencyKey: "proposal-2",
    }),
  );
  const principalId = (proposed.principal as any).principalId as string;
  await traced(() =>
    service.decideSuccessor(admin("reviewer"), {
      principalId,
      decision: "APPROVED",
      reason: "approved reviewer",
      idempotencyKey: "decision-2",
    }),
  );

  const effectiveService = new GovernancePrincipalAdminService(
    db.asDb(),
    audit.asGuard(),
    bridge,
    cache,
    undefined,
    () => now + 2_000,
  );

  const reviewerStatus = await effectiveService.status(
    adminWithPermissions("reviewer", [Permission.OWNER_SUCCESSION_MANAGE]),
  );
  const otherStatus = await effectiveService.status(
    adminWithPermissions("other", [Permission.OWNER_SUCCESSION_MANAGE]),
  );
  assert.equal(
    getPath(reviewerStatus, "successors.0.canActivateSuccessor"),
    true,
  );
  assert.equal(
    getPath(otherStatus, "successors.0.canActivateSuccessor"),
    false,
  );
  const wrongActivator = await traced(() =>
    effectiveService.activateSuccessor(admin("other"), {
      principalId,
      reason: "wrong actor",
      idempotencyKey: "activation-wrong",
    }),
  );
  assert.deepEqual(wrongActivator.blockers, [
    "APPROVED_REVIEWER_MUST_ACTIVATE",
  ]);

  await db
    .collection("governance_principals")
    .updateOne({ _id: "primary" }, { $set: { status: "SUPERSEDED" } });
  db.collection("governance_principals").seed({
    _id: "replacement-primary",
    userId: "other",
    principalType: "PRIMARY_OWNER",
    status: "ACTIVE",
    effectiveAt: now - 10_000,
    expiresAt: null,
    predecessorPrincipalId: "primary",
    successorPrincipalId: null,
    createdBy: "maker",
    approvedBy: "checker",
    reason: "replacement",
    createdAt: now - 10_000,
    approvedAt: now - 9_000,
  });
  const staleLineage = await traced(() =>
    effectiveService.activateSuccessor(admin("reviewer"), {
      principalId,
      reason: "stale predecessor",
      idempotencyKey: "activation-stale",
    }),
  );
  assert.deepEqual(staleLineage.blockers, [
    "SUCCESSOR_PREDECESSOR_NOT_CURRENT_PRIMARY",
  ]);
  assert.equal(bridge.securityVersionChanges, 0);
});

test("successor effective window is re-evaluated with fresh transaction time", async () => {
  const db = governanceFixture();
  const audit = new AuditCapture();
  const setupBridge = new SnapshotMutationBridge(db, audit);
  const baseNow = Date.now();
  const setupService = new GovernancePrincipalAdminService(
    db.asDb(),
    audit.asGuard(),
    setupBridge,
    cache,
    undefined,
    () => baseNow,
  );
  const proposed = await traced(() =>
    setupService.proposeSuccessor(admin("owner"), {
      targetUserId: "target",
      effectiveAt: baseNow + 1_000,
      expiresAt: baseNow + 10_000,
      reason: "short window",
      idempotencyKey: "proposal-3",
    }),
  );
  const principalId = (proposed.principal as any).principalId as string;
  await traced(() =>
    setupService.decideSuccessor(admin("reviewer"), {
      principalId,
      decision: "APPROVED",
      reason: "approved reviewer",
      idempotencyKey: "decision-3",
    }),
  );

  const activationBridge = new SnapshotMutationBridge(db, audit);
  const times = [baseNow + 2_000, baseNow + 20_000];
  const service = new GovernancePrincipalAdminService(
    db.asDb(),
    audit.asGuard(),
    activationBridge,
    cache,
    undefined,
    () => times.shift() ?? baseNow + 20_000,
  );
  const result = await traced(() =>
    service.activateSuccessor(admin("reviewer"), {
      principalId,
      reason: "window crossed before transaction",
      idempotencyKey: "activation-3",
    }),
  );
  assert.deepEqual(result.blockers, ["STALE_SUCCESSION_STATE"]);
  assert.equal(
    (await db.collection("governance_principals").findOne({ _id: "primary" }))
      ?.status,
    "ACTIVE",
  );
  assert.equal(activationBridge.securityVersionChanges, 0);
});

test("Owner proposal, decision, and activation replay without duplicate effects", async () => {
  const db = governanceFixture();
  const audit = new AuditCapture();
  const bridge = new SnapshotMutationBridge(db, audit);
  const now = Date.now();
  const setup = new GovernancePrincipalAdminService(
    db.asDb(),
    audit.asGuard(),
    bridge,
    cache,
    undefined,
    () => now,
  );
  const proposal = {
    targetUserId: "target",
    effectiveAt: now + 1_000,
    expiresAt: now + 60_000,
    reason: "deterministic continuity",
    idempotencyKey: "owner-proposal-replay",
  };
  const created = await traced(() =>
    setup.proposeSuccessor(admin("owner"), proposal),
  );
  const replayedProposal = await traced(() =>
    setup.proposeSuccessor(admin("owner"), proposal),
  );
  assert.equal(replayedProposal.replay, true);
  await assert.rejects(
    traced(() =>
      setup.proposeSuccessor(admin("owner"), {
        ...proposal,
        reason: "different payload",
      }),
    ),
    /IDEMPOTENCY_KEY_CONFLICT/u,
  );
  const principalId = (created.principal as any).principalId as string;
  const decision = {
    principalId,
    decision: "APPROVED" as const,
    reason: "independent approval",
    idempotencyKey: "owner-decision-replay",
  };
  await traced(() => setup.decideSuccessor(admin("reviewer"), decision));
  const replayedDecision = await traced(() =>
    setup.decideSuccessor(admin("reviewer"), decision),
  );
  assert.equal(replayedDecision.replay, true);

  const activationService = new GovernancePrincipalAdminService(
    db.asDb(),
    audit.asGuard(),
    bridge,
    cache,
    undefined,
    () => now + 2_000,
  );
  const activation = {
    principalId,
    reason: "activate exactly once",
    idempotencyKey: "owner-activation-replay",
  };
  await traced(() =>
    activationService.activateSuccessor(admin("reviewer"), activation),
  );
  const replayedActivation = await traced(() =>
    activationService.activateSuccessor(admin("reviewer"), activation),
  );
  assert.equal(replayedActivation.replay, true);
  assert.equal(
    await db.collection("governance_principals").countDocuments({}),
    2,
  );
  assert.equal(audit.records.length, 3);
  assert.equal(bridge.securityVersionChanges, 1);
});

function admin(id: string): Actor {
  return new Actor({
    id,
    type: "admin",
    context: "ADMIN",
    roles: [],
    permissions: [],
    accountContexts: ["ADMIN_CONSOLE"],
    isActive: true,
  });
}

function adminWithPermissions(
  id: string,
  permissions: readonly Permission[],
): Actor {
  return new Actor({
    id,
    type: "admin",
    context: "ADMIN",
    roles: [],
    permissions: [...permissions],
    accountContexts: ["ADMIN_CONSOLE"],
    isActive: true,
  });
}

function traced<T>(run: () => Promise<T>): Promise<T> {
  return bindTraceId("trace-p2-service-test", run);
}

function replacementTimingFixture(options: {
  readonly now: number;
  readonly predecessorExpiresAt: number | null;
  readonly predecessorEffectiveAt?: number;
  readonly predecessorRoleCode?: string;
  readonly durableReviewDeadline?: number;
  readonly graceExceptionExpiresAt?: number;
}) {
  const db = new FakeDb();
  const predecessorRoleCode = options.predecessorRoleCode ?? "CUSTOM_LOW";
  const predecessorTemplate = getRoleTemplate(predecessorRoleCode);
  const successorTemplate = getRoleTemplate("VIEWER_AUDITOR");
  assert.ok(successorTemplate);
  db.collection("roles").seed(
    {
      _id: "role-1",
      code: predecessorRoleCode,
      ...(predecessorTemplate
        ? {
            templateCode: predecessorTemplate.code,
            templateVersion: predecessorTemplate.version,
            permissions: [...predecessorTemplate.permissions],
          }
        : { permissions: [] }),
      state: "ACTIVE",
      delegationBand: "LIMITED",
    },
    {
      _id: "role-2",
      code: successorTemplate.code,
      templateCode: successorTemplate.code,
      templateVersion: successorTemplate.version,
      state: "ACTIVE",
      permissions: [...successorTemplate.permissions],
      delegationBand: "LIMITED",
    },
    {
      _id: "role-delegator",
      code: "ROLE_DELEGATOR",
      state: "ACTIVE",
      permissions: [],
      maxDelegatableBand: "LIMITED",
    },
  );
  db.collection("role_assignments").seed(
    {
      _id: "assignment-1",
      roleId: "role-1",
      userId: "target",
      state: "ACTIVE",
      effectiveAt: options.predecessorEffectiveAt ?? options.now - 10_000,
      expiresAt: options.predecessorExpiresAt,
      reviewAt: options.durableReviewDeadline ?? null,
      lifecycle:
        options.durableReviewDeadline === undefined
          ? null
          : {
              cycleId: "cycle-predecessor",
              riskTier: "LOW",
              riskReasons: [],
              riskAssessedAt: options.now,
              reviewDeadline: options.durableReviewDeadline,
              graceExceptionExpiresAt: options.graceExceptionExpiresAt ?? null,
              permissionFingerprint: null,
              suspendedAt: null,
              suspensionCause: null,
              predecessorAssignmentId: null,
              successorAssignmentId: null,
              lineageAction: null,
            },
      structuredScopeGrants: [{ scopeType: "self" }],
      scopeFingerprint: "scope:v1:self",
      bundleOrigin: null,
    },
    {
      _id: "assignment-requester",
      roleId: "role-delegator",
      userId: "requester",
      state: "ACTIVE",
      effectiveAt: options.now - 10_000,
      expiresAt: null,
      structuredScopeGrants: [{ scopeType: "global" }],
      scopeFingerprint: "scope:v1:global",
    },
    {
      _id: "assignment-reviewer",
      roleId: "role-delegator",
      userId: "reviewer",
      state: "ACTIVE",
      effectiveAt: options.now - 10_000,
      expiresAt: null,
      structuredScopeGrants: [{ scopeType: "global" }],
      scopeFingerprint: "scope:v1:global",
    },
  );
  db.collection("users").seed({
    _id: "target",
    accountStatus: "ACTIVE",
    accountContexts: ["ADMIN_CONSOLE", "STAFF_CONSOLE"],
    disabledAt: null,
    archivedAt: null,
  });
  db.collection("employment_profiles").seed({
    _id: "profile-target",
    linkedUserId: "target",
    employmentStatus: "ACTIVE",
    displayName: "Target user",
  });
  const audit = new AuditCapture();
  const bridge = new SnapshotMutationBridge(db, audit);
  const service = new AccessLifecycleP2AdminService(
    db.asDb(),
    audit.asGuard(),
    bridge,
    cache,
    exactAuthority,
    undefined,
    () => options.now,
  );
  return {
    db,
    audit,
    bridge,
    service,
    actor: adminWithPermissions("requester", [
      Permission.ROLE_ASSIGNMENT_REPLACE,
    ]),
  };
}

function replacementCommand(
  now: number,
  effectiveAt: number,
  idempotencyKey: string,
) {
  return {
    action: "REPLACEMENT" as const,
    predecessorAssignmentId: "assignment-1",
    roleId: "role-2",
    structuredScopeGrants: [{ scopeType: "self" as const }],
    effectiveAt,
    expiresAt: now + 200 * 24 * 60 * 60 * 1_000,
    reviewAt: effectiveAt + 30 * 24 * 60 * 60 * 1_000,
    reason: "bounded replacement",
    idempotencyKey,
  };
}

function seedPendingReplacement(
  fixture: ReturnType<typeof replacementTimingFixture>,
  effectiveAt: number,
  key: string,
): void {
  const successorTemplate = getRoleTemplate("VIEWER_AUDITOR");
  assert.ok(successorTemplate);
  const risk = buildAccessRiskSnapshot({
    assignments: [
      {
        roleCode: successorTemplate.code,
        roleTemplateCode: successorTemplate.code,
        permissions: successorTemplate.permissions,
        structuredScopeGrants: [{ scopeType: "self" }],
      },
    ],
    assessedAt: effectiveAt - 1,
    scopeFingerprint: "scope:v1:self",
  });
  fixture.db.collection("assignment_successor_requests").seed({
    _id: `request-${key}`,
    action: "REPLACEMENT",
    predecessorAssignmentId: "assignment-1",
    targetUserId: "target",
    requestedBy: "requester",
    requestedAt: effectiveAt - 1,
    reason: "bounded replacement",
    idempotencyKey: key,
    payloadFingerprint: `payload-${key}`,
    state: "PENDING",
    approvals: [],
    successorAssignmentId: null,
    appliedAt: null,
    successor: {
      roleId: "role-2",
      structuredScopeGrants: [{ scopeType: "self" }],
      scopeFingerprint: "scope:v1:self",
      effectiveAt,
      expiresAt: effectiveAt + 200 * 24 * 60 * 60 * 1_000,
      reviewAt: effectiveAt + 30 * 24 * 60 * 60 * 1_000,
      riskTier: risk.tier,
      riskReasons: risk.reasons,
      riskAssessedAt: effectiveAt - 1,
      permissionFingerprint: risk.permissionFingerprint,
      sourceRoleId: "role-2",
      sourceRoleCode: successorTemplate.code,
      sourceRoleTemplateCode: successorTemplate.code,
      riskPolicyVersion: "access-risk-policy/v1",
    },
  });
  const slot = buildAuthoritySlotIdentity({
    userId: "target",
    roleId: "role-1",
    structuredScopeGrants: [{ scopeType: "self" }],
  });
  fixture.db.collection("role_assignment_authority_slots").seed({
    _id: slot.id,
    userId: slot.userId,
    roleId: slot.roleId,
    scopeFingerprint: slot.scopeFingerprint,
    schemaVersion: 1,
    status: "RESERVED",
    lineageId: "assignment-1",
    currentAssignmentId: "assignment-1",
    scheduledSuccessorAssignmentId: null,
    successorEffectiveAt: null,
    releaseAt: effectiveAt,
    predecessorReleaseAt: null,
    transitionIdentity: "assign:assignment-1",
    version: 1,
    createdAt: effectiveAt - 10_000,
    updatedAt: effectiveAt - 10_000,
  });
}

function lifecycleService(
  db: FakeDb,
  audit: AuditCapture,
  bridge: SnapshotMutationBridge,
  nowProvider: () => number,
): AccessLifecycleP2AdminService {
  return new AccessLifecycleP2AdminService(
    db.asDb(),
    audit.asGuard(),
    bridge,
    cache,
    exactAuthority,
    undefined,
    nowProvider,
  );
}

function sequenceClock(
  requestNow: number,
  transactionNow: number,
): {
  readonly now: () => number;
  readonly calls: () => number;
} {
  let invocationCount = 0;
  return {
    now: () => {
      const value = invocationCount === 0 ? requestNow : transactionNow;
      invocationCount += 1;
      return value;
    },
    calls: () => invocationCount,
  };
}

async function setLifecycleTiming(
  db: FakeDb,
  input: {
    readonly state?: "ACTIVE" | "SCHEDULED";
    readonly effectiveAt: number;
    readonly expiresAt: number;
    readonly reviewDeadline: number;
    readonly successorAssignmentId?: string | null;
    readonly successorEffectiveAt?: number | null;
  },
): Promise<void> {
  const assignment = await db.collection("role_assignments").findOne({
    _id: "assignment-1",
  });
  assert.ok(assignment);
  await db.collection("role_assignments").updateOne(
    { _id: "assignment-1" },
    {
      $set: {
        state: input.state ?? "ACTIVE",
        effectiveAt: input.effectiveAt,
        expiresAt: input.expiresAt,
        reviewAt: input.reviewDeadline,
        lifecycle: {
          ...assignment.lifecycle,
          reviewDeadline: input.reviewDeadline,
          successorAssignmentId: input.successorAssignmentId ?? null,
          successorEffectiveAt: input.successorEffectiveAt ?? null,
        },
      },
    },
  );
  await db
    .collection("assignment_review_cycles")
    .updateOne(
      { _id: "cycle-1" },
      { $set: { reviewDeadline: input.reviewDeadline } },
    );
}

function seedGraceException(db: FakeDb, reviewDeadline: number): void {
  db.collection("assignment_grace_exceptions").seed({
    _id: "grace-boundary",
    cycleId: "cycle-1",
    targetUserId: "target",
    requestedBy: "requester",
    requestedAt: reviewDeadline,
    requestedExpiresAt: reviewDeadline + 4 * 24 * 60 * 60 * 1_000,
    approvedBy: null,
    approvedAt: null,
    approvedExpiresAt: null,
    state: "PENDING",
    reason: "bounded grace",
  });
}

async function assertNoLifecycleEffects(
  db: FakeDb,
  audit: AuditCapture,
  bridge: SnapshotMutationBridge,
  expectedAssignmentState: "ACTIVE" | "SCHEDULED" = "ACTIVE",
): Promise<void> {
  assert.equal(
    (
      await db.collection("assignment_review_cycles").findOne({
        _id: "cycle-1",
      })
    )?.state,
    "PENDING",
  );
  assert.equal(
    (
      await db.collection("role_assignments").findOne({
        _id: "assignment-1",
      })
    )?.state,
    expectedAssignmentState,
  );
  assert.equal(
    await db.collection("assignment_suspensions").countDocuments({}),
    0,
  );
  assert.equal(audit.records.length, 0);
  assert.equal(bridge.securityVersionChanges, 0);
  assert.equal(bridge.outboxEvents, 0);
}

function lifecycleFixture(): FakeDb {
  const db = new FakeDb();
  const fixtureNow = Date.now();
  db.collection("roles").seed({
    _id: "role-1",
    code: "STAFF_CONSOLE_USER",
    templateCode: "STAFF_CONSOLE_USER",
    state: "ACTIVE",
    permissions: [],
  });
  db.collection("role_assignments").seed({
    _id: "assignment-1",
    roleId: "role-1",
    userId: "target",
    state: "ACTIVE",
    effectiveAt: fixtureNow - 10_000,
    expiresAt: fixtureNow + 24 * 60 * 60 * 1000,
    reviewAt: fixtureNow + 60_000,
    lifecycle: {
      cycleId: "cycle-1",
      riskTier: "LOW",
      riskReasons: [],
      riskAssessedAt: fixtureNow,
      reviewDeadline: fixtureNow + 60_000,
      graceExceptionExpiresAt: null,
      suspendedAt: null,
      suspensionCause: null,
      predecessorAssignmentId: null,
      successorAssignmentId: null,
      lineageAction: null,
    },
    structuredScopeGrants: [{ scopeType: "self" }],
    scopeFingerprint: "scope:v1:self",
    bundleOrigin: null,
  });
  db.collection("assignment_review_cycles").seed({
    _id: "cycle-1",
    assignmentId: "assignment-1",
    targetUserId: "target",
    requestedBy: "requester",
    requestedAt: fixtureNow,
    riskSnapshot: {
      tier: "LOW",
      reasons: [],
      assessedAt: fixtureNow,
      permissionFingerprint: "permission:v1:test",
      scopeFingerprint: "scope:v1:self",
    },
    reviewDeadline: fixtureNow + 60_000,
    state: "PENDING",
    approvals: [],
    decidedAt: null,
    nextReviewDeadline: null,
    reason: "review",
    createdAt: fixtureNow,
  });
  return db;
}

function breakGlassRequest(): Doc {
  return {
    _id: "request-1",
    targetUserId: "target",
    permissions: ["role.view"],
    idempotencyKey: "request-key-1",
    payloadFingerprint: "payload-1",
    structuredScopeGrants: [{ scopeType: "global" }],
    scopeFingerprint: "scope:v1:global",
    urgency: "NON_URGENT",
    incidentReferenceId: "INC-1",
    reason: "incident",
    requesterUserId: "requester",
    requestedAt: Date.now(),
    requestedDurationMs: 60_000,
    approvals: [],
    status: "PENDING_APPROVAL",
  };
}

function breakGlassActivation(status: "ACTIVE" | "EXPIRED"): Doc {
  return {
    _id: "activation-1",
    requestId: "request-1",
    targetUserId: "target",
    permissions: ["role.view"],
    structuredScopeGrants: [{ scopeType: "global" }],
    scopeFingerprint: "scope:v1:global",
    incidentReferenceId: "INC-1",
    reason: "incident",
    activatorUserId: "activator",
    activatedAt: Date.now() - 120_000,
    expiresAt: Date.now() - 60_000,
    status,
    stepUpState: "NOT_SUPPORTED",
    independentReviewDeadline: {
      dueAt: Date.now(),
      calendarVersion: "v1",
      timeZone: "Asia/Ho_Chi_Minh",
      resolution: "CALENDAR",
    },
    reviewerUserId: null,
    reviewResult: null,
    reviewedAt: null,
    auditCorrelationId: "trace",
  };
}

function governanceFixture(): FakeDb {
  const db = new FakeDb();
  db.collection("users").seed(
    eligibleUser("owner"),
    eligibleUser("target"),
    eligibleUser("reviewer"),
    eligibleUser("other"),
  );
  db.collection("governance_principals").seed({
    _id: "primary",
    userId: "owner",
    principalType: "PRIMARY_OWNER",
    status: "ACTIVE",
    effectiveAt: Date.now() - 100_000,
    expiresAt: null,
    predecessorPrincipalId: null,
    successorPrincipalId: null,
    createdBy: "maker",
    approvedBy: "checker",
    reason: "owner",
    createdAt: Date.now() - 100_000,
    approvedAt: Date.now() - 90_000,
  });
  return db;
}

function eligibleUser(id: string): Doc {
  return {
    _id: id,
    accountStatus: "ACTIVE",
    disabledAt: null,
    archivedAt: null,
    authLinkage: { status: "LINKED", subject: `auth0|${id}` },
  };
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
      const operators = expected as Record<string, any>;
      if ("$in" in operators) return operators.$in.includes(actual);
      if ("$ne" in operators) {
        if (Array.isArray(actual)) return !actual.includes(operators.$ne);
        return actual !== operators.$ne;
      }
      if ("$lte" in operators) return actual <= operators.$lte;
    }
    if (Array.isArray(actual)) return actual.includes(expected);
    return actual === expected;
  });
}

function applyUpdate(record: Doc, update: Record<string, any>): void {
  for (const [path, value] of Object.entries(update.$set ?? {}))
    setPath(record, path, structuredClone(value));
  for (const [path, value] of Object.entries(update.$addToSet ?? {})) {
    const current = getPath(record, path) ?? [];
    if (!current.includes(value)) setPath(record, path, [...current, value]);
  }
  for (const [path, value] of Object.entries(update.$pull ?? {})) {
    const current = getPath(record, path) ?? [];
    setPath(
      record,
      path,
      current.filter((item: unknown) => item !== value),
    );
  }
}

function setPath(record: Doc, path: string, value: unknown): void {
  const parts = path.split(".");
  let current: any = record;
  for (const part of parts.slice(0, -1)) current = current[part] ??= {};
  current[parts[parts.length - 1]!] = value;
}

function queryByIdFrom(
  query: Record<string, unknown>,
): Record<string, unknown> {
  return { _id: query._id };
}
