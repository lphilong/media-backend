import assert from "node:assert/strict";
import test from "node:test";
import type { ClientSession, Db } from "mongodb";
import {
  evaluateRoleAssignmentRestorationEligibility,
  resolveRoleAssignmentOperationalState,
} from "./domain/role-assignment-operational-state";
import {
  buildAuthoritySlotIdentity,
  planAuthoritySlotRelease,
  planAuthoritySlotReservation,
  planAuthoritySlotScheduledRelease,
  resolveAuthoritySlotEffectiveHolder,
} from "./domain/authority-slot";
import { NativeMongoAuthoritySlotRepository } from "@infra/mongo/role/authority-slot.repository";
import {
  buildCurrentRoleAssignmentPolicy,
  PRIVILEGED_ACCESS_REVIEW_WINDOW_DAYS,
} from "./domain/sensitive-access-policy";

const cutover = 10_000;

test("operational state preserves the exact OD-P2-07 cutover and makes effective SCHEDULED manageable", () => {
  const predecessor = {
    state: "ACTIVE",
    effectiveAt: 1,
    lifecycle: {
      riskTier: "LOW",
      reviewDeadline: 100_000,
      successorAssignmentId: "successor",
      successorEffectiveAt: cutover,
    },
  };
  const successor = {
    state: "SCHEDULED",
    effectiveAt: cutover,
    lifecycle: { riskTier: "LOW", reviewDeadline: 100_000 },
  };

  assert.equal(
    resolveRoleAssignmentOperationalState(predecessor, cutover - 1).state,
    "OPERATIONALLY_ACTIVE",
  );
  assert.equal(
    resolveRoleAssignmentOperationalState(successor, cutover - 1).state,
    "FUTURE_SCHEDULED",
  );
  assert.equal(
    resolveRoleAssignmentOperationalState(predecessor, cutover).state,
    "OPERATIONALLY_SUPERSEDED",
  );
  const atCutover = resolveRoleAssignmentOperationalState(successor, cutover);
  assert.equal(atCutover.state, "OPERATIONALLY_ACTIVE");
  assert.equal(atCutover.manageable, true);
});

test("suspension retains restoration eligibility only before exact expiry", () => {
  const assignment = {
    state: "SUSPENDED",
    effectiveAt: 1,
    expiresAt: 20_000,
    lifecycle: { riskTier: "LOW", reviewDeadline: 10_000 },
  };

  const beforeExpiry = resolveRoleAssignmentOperationalState(
    assignment,
    assignment.expiresAt - 1,
  );
  assert.equal(beforeExpiry.state, "OPERATIONALLY_SUSPENDED");
  assert.equal(beforeExpiry.retainsAuthoritySlot, true);

  for (const now of [assignment.expiresAt, assignment.expiresAt + 1]) {
    const expired = resolveRoleAssignmentOperationalState(assignment, now);
    assert.equal(expired.state, "OPERATIONALLY_EXPIRED");
    assert.equal(expired.retainsAuthoritySlot, false);
  }
});

test("restoration eligibility requires the same active Role and operational source as mutation", () => {
  const base = {
    state: "SUSPENDED",
    effectiveAt: 1,
    expiresAt: 20_000,
    lifecycle: {
      riskTier: "LOW",
      reviewDeadline: 10_000,
      successorAssignmentId: null,
      successorEffectiveAt: null,
    },
  };
  assert.equal(
    evaluateRoleAssignmentRestorationEligibility({
      assignment: base,
      currentRoleState: "ACTIVE",
      now: 5_000,
    }).eligible,
    true,
  );
  assert.equal(
    evaluateRoleAssignmentRestorationEligibility({
      assignment: base,
      currentRoleState: null,
      now: 5_000,
    }).reason,
    "PREDECESSOR_ROLE_NOT_ACTIVE",
  );
  assert.equal(
    evaluateRoleAssignmentRestorationEligibility({
      assignment: base,
      currentRoleState: "INACTIVE",
      now: 5_000,
    }).reason,
    "PREDECESSOR_ROLE_NOT_ACTIVE",
  );
  assert.equal(
    evaluateRoleAssignmentRestorationEligibility({
      assignment: base,
      currentRoleState: "ACTIVE",
      now: 20_000,
    }).reason,
    "SOURCE_ASSIGNMENT_EXPIRED",
  );
  assert.equal(
    evaluateRoleAssignmentRestorationEligibility({
      assignment: {
        ...base,
        lifecycle: {
          ...base.lifecycle,
          successorAssignmentId: "successor",
          successorEffectiveAt: 15_000,
        },
      },
      currentRoleState: "ACTIVE",
      now: 5_000,
    }).reason,
    "SUCCESSOR_ALREADY_SCHEDULED",
  );
});

test("malformed successor lineage is invalid and never advertises restoration", () => {
  for (const lifecycle of [
    { successorAssignmentId: "successor", successorEffectiveAt: null },
    { successorAssignmentId: null, successorEffectiveAt: 15_000 },
    { successorAssignmentId: "   ", successorEffectiveAt: 15_000 },
  ]) {
    const assignment = {
      state: "SUSPENDED",
      effectiveAt: 1,
      expiresAt: 20_000,
      lifecycle: {
        riskTier: "LOW",
        reviewDeadline: 10_000,
        ...lifecycle,
      },
    };
    const operational = resolveRoleAssignmentOperationalState(
      assignment,
      5_000,
    );
    assert.equal(operational.state, "OPERATIONALLY_SUSPENDED");
    assert.equal(operational.effectiveness.reason, "INVALID_STATE");
    assert.equal(
      evaluateRoleAssignmentRestorationEligibility({
        assignment,
        currentRoleState: "ACTIVE",
        now: 5_000,
      }).reason,
      "SUCCESSOR_ALREADY_SCHEDULED",
    );
  }
});

test("current HIGH risk and the earliest current deadline remove stored LOW grace", () => {
  const assignment = {
    state: "ACTIVE",
    effectiveAt: 1,
    lifecycle: {
      riskTier: "LOW",
      reviewDeadline: 50_000,
      graceExceptionExpiresAt: 90_000,
    },
  };
  assert.equal(
    resolveRoleAssignmentOperationalState(assignment, 40_001, {
      riskTier: "HIGH",
      reviewDeadline: 40_000,
    }).state,
    "OPERATIONALLY_REVIEW_BLOCKED",
  );
});

test("current HIGH risk creates its canonical deadline when durable LOW evidence had none", () => {
  const effectiveAt = 1_000;
  const policy = buildCurrentRoleAssignmentPolicy({
    roleCode: "ACCESS_ADMIN",
    roleTemplateCode: "ACCESS_ADMIN",
    permissions: [],
    structuredScopeGrants: [{ scopeType: "self" }],
    effectiveAt,
    durableReviewDeadline: null,
    storedPermissionFingerprint: null,
    assessedAt: effectiveAt,
    scopeFingerprint: "scope:v1:self",
  });
  assert.equal(policy.riskTier, "HIGH");
  assert.equal(
    policy.reviewDeadline,
    effectiveAt + PRIVILEGED_ACCESS_REVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1_000,
  );
});

test("authority slot identity rejects supplied fingerprint drift", () => {
  assert.throws(
    () =>
      buildAuthoritySlotIdentity({
        userId: "user",
        roleId: "role",
        structuredScopeGrants: [{ scopeType: "self" }],
        scopeFingerprint: "scope:v1:global",
      }),
    /AUTHORITY_SLOT_SCOPE_FINGERPRINT_MISMATCH/u,
  );
});

test("same lineage attaches a scheduled successor while an unrelated lineage is rejected", () => {
  const identity = buildAuthoritySlotIdentity({
    userId: "user",
    roleId: "role",
    structuredScopeGrants: [{ scopeType: "self" }],
  });
  const inserted = planAuthoritySlotReservation(null, {
    ...identity,
    lineageId: "assignment-a",
    assignmentId: "assignment-a",
    transitionIdentity: "assign:a",
    now: 1,
  });
  assert.equal(inserted.kind, "INSERT");
  const current = inserted.record;
  const successor = planAuthoritySlotReservation(current, {
    ...identity,
    lineageId: "assignment-a",
    assignmentId: "assignment-b",
    predecessorAssignmentId: "assignment-a",
    successorEffectiveAt: 10,
    transitionIdentity: "successor:b",
    now: 2,
  });
  assert.equal(successor.kind, "CAS");
  assert.equal(successor.record.scheduledSuccessorAssignmentId, "assignment-b");
  assert.throws(
    () =>
      planAuthoritySlotReservation(successor.record, {
        ...identity,
        lineageId: "unrelated",
        assignmentId: "assignment-c",
        transitionIdentity: "assign:c",
        now: 3,
      }),
    /AUTHORITY_SLOT_ALREADY_RESERVED/u,
  );
});

test("authority slot holder resolution is time-aware at cutover and assignment expiry", () => {
  const { predecessor, successor } = scheduledSlot();
  assert.deepEqual(resolveAuthoritySlotEffectiveHolder(predecessor, 49), {
    assignmentId: "assignment-a",
    source: "CURRENT",
  });
  assert.deepEqual(resolveAuthoritySlotEffectiveHolder(successor, 49), {
    assignmentId: "assignment-a",
    source: "CURRENT",
  });
  assert.deepEqual(resolveAuthoritySlotEffectiveHolder(successor, 50), {
    assignmentId: "assignment-b",
    source: "SCHEDULED_SUCCESSOR",
  });
  assert.deepEqual(resolveAuthoritySlotEffectiveHolder(successor, 199), {
    assignmentId: "assignment-b",
    source: "SCHEDULED_SUCCESSOR",
  });
  assert.deepEqual(resolveAuthoritySlotEffectiveHolder(successor, 200), {
    assignmentId: null,
    source: "RELEASED_BY_TIME",
  });
});

test("authority slot release planner clears or promotes only the holder valid at transition time", () => {
  const { successor } = scheduledSlot();
  const cleared = planAuthoritySlotRelease(
    successor,
    "assignment-b",
    "revoke:b-before",
    40,
  );
  assert.equal(cleared.kind, "CAS");
  assert.equal(cleared.result, "CLEARED_SUCCESSOR");
  assert.equal(cleared.record.currentAssignmentId, "assignment-a");
  assert.equal(cleared.record.releaseAt, 100);

  const promoted = planAuthoritySlotRelease(
    successor,
    "assignment-a",
    "revoke:a-before",
    40,
  );
  assert.equal(promoted.kind, "CAS");
  assert.equal(promoted.result, "PROMOTED_SUCCESSOR");
  assert.equal(promoted.record.currentAssignmentId, "assignment-b");
  assert.equal(promoted.record.releaseAt, 200);

  assert.equal(
    planAuthoritySlotRelease(successor, "assignment-a", "revoke:a-after", 60)
      .kind,
    "NO_OP",
  );
  const released = planAuthoritySlotRelease(
    successor,
    "assignment-b",
    "revoke:b-after",
    60,
  );
  assert.equal(released.kind, "CAS");
  assert.equal(released.result, "RELEASED");
  assert.equal(released.record.status, "RELEASED");
  assert.equal(released.record.currentAssignmentId, "assignment-b");
  assert.equal(released.record.scheduledSuccessorAssignmentId, null);
});

test("timed release permits deterministic unrelated slot reclaim", () => {
  const { predecessor } = scheduledSlot();
  assert.equal(
    resolveAuthoritySlotEffectiveHolder(predecessor, 99).assignmentId,
    "assignment-a",
  );
  const reclaimed = planAuthoritySlotReservation(predecessor, {
    id: predecessor.id,
    userId: predecessor.userId,
    roleId: predecessor.roleId,
    scopeFingerprint: predecessor.scopeFingerprint,
    lineageId: "assignment-c",
    assignmentId: "assignment-c",
    assignmentExpiresAt: 300,
    transitionIdentity: "assign:c",
    now: 100,
  });
  assert.equal(reclaimed.kind, "CAS");
  assert.equal(reclaimed.record.currentAssignmentId, "assignment-c");
  assert.equal(reclaimed.record.releaseAt, 300);
  const afterBoundary = planAuthoritySlotReservation(predecessor, {
    id: predecessor.id,
    userId: predecessor.userId,
    roleId: predecessor.roleId,
    scopeFingerprint: predecessor.scopeFingerprint,
    lineageId: "assignment-d",
    assignmentId: "assignment-d",
    assignmentExpiresAt: 400,
    transitionIdentity: "assign:d",
    now: 101,
  });
  assert.equal(afterBoundary.kind, "CAS");
  assert.throws(
    () =>
      resolveAuthoritySlotEffectiveHolder(
        { ...predecessor, releaseAt: Number.NaN },
        99,
      ),
    /releaseAt must be a finite timestamp/u,
  );
});

test("repository schedules one exact release and idempotently replays only the same transition", async () => {
  const db = new SlotFakeDb();
  const repository = new NativeMongoAuthoritySlotRepository(
    db as unknown as Db,
  );
  const identity = buildAuthoritySlotIdentity({
    userId: "user",
    roleId: "role",
    structuredScopeGrants: [{ scopeType: "self" }],
  });
  await repository.reserve(
    {
      ...identity,
      lineageId: "assignment-a",
      assignmentId: "assignment-a",
      transitionIdentity: "assign:a",
      now: 1,
    },
    {} as ClientSession,
  );
  assert.equal(
    await repository.scheduleRelease(
      identity.id,
      "assignment-a",
      50,
      "release:a",
      2,
      {} as ClientSession,
    ),
    "SCHEDULED",
  );
  assert.equal(
    await repository.scheduleRelease(
      identity.id,
      "assignment-a",
      50,
      "release:a",
      3,
      {} as ClientSession,
    ),
    "IDEMPOTENT",
  );
  assert.equal(
    await repository.scheduleRelease(
      identity.id,
      "assignment-a",
      60,
      "release:a-changed",
      4,
      {} as ClientSession,
    ),
    "SCHEDULED",
  );
});

test("scheduled release planner normalizes only the effective successor holder", () => {
  const { successor } = scheduledSlot();
  assert.throws(
    () =>
      planAuthoritySlotScheduledRelease(
        successor,
        "assignment-b",
        250,
        "release:b",
        49,
      ),
    /AUTHORITY_SLOT_CURRENT_ASSIGNMENT_MISMATCH/u,
  );

  const normalized = planAuthoritySlotScheduledRelease(
    successor,
    "assignment-b",
    250,
    "release:b",
    50,
  );
  assert.equal(normalized.kind, "CAS");
  assert.equal(normalized.record.currentAssignmentId, "assignment-b");
  assert.equal(normalized.record.scheduledSuccessorAssignmentId, null);
  assert.equal(normalized.record.successorEffectiveAt, null);
  assert.equal(normalized.record.predecessorReleaseAt, null);
  assert.equal(normalized.record.releaseAt, 250);
  assert.equal(
    planAuthoritySlotScheduledRelease(
      normalized.record,
      "assignment-b",
      250,
      "release:b",
      251,
    ).kind,
    "IDEMPOTENT",
  );
});

test("repository schedules release for the effective persisted successor", async () => {
  const db = new SlotFakeDb();
  const repository = new NativeMongoAuthoritySlotRepository(
    db as unknown as Db,
  );
  const identity = buildAuthoritySlotIdentity({
    userId: "user",
    roleId: "role",
    structuredScopeGrants: [{ scopeType: "self" }],
  });
  await repository.reserve(
    {
      ...identity,
      lineageId: "assignment-a",
      assignmentId: "assignment-a",
      assignmentExpiresAt: 100,
      transitionIdentity: "assign:a",
      now: 1,
    },
    {} as ClientSession,
  );
  await repository.reserve(
    {
      ...identity,
      lineageId: "assignment-a",
      assignmentId: "assignment-b",
      predecessorAssignmentId: "assignment-a",
      successorEffectiveAt: 50,
      assignmentExpiresAt: 200,
      transitionIdentity: "successor:b",
      now: 2,
    },
    {} as ClientSession,
  );

  assert.equal(
    await repository.scheduleRelease(
      identity.id,
      "assignment-b",
      250,
      "release:b",
      50,
      {} as ClientSession,
    ),
    "SCHEDULED",
  );
  const stored = await repository.findById(identity.id);
  assert.equal(stored?.currentAssignmentId, "assignment-b");
  assert.equal(stored?.scheduledSuccessorAssignmentId, null);
});

test("repository blocks ordinary reclaim before releaseAt and accepts it exactly at releaseAt", async () => {
  const db = new SlotFakeDb();
  const repository = new NativeMongoAuthoritySlotRepository(
    db as unknown as Db,
  );
  const identity = buildAuthoritySlotIdentity({
    userId: "user",
    roleId: "role",
    structuredScopeGrants: [{ scopeType: "self" }],
  });
  await repository.reserve(
    {
      ...identity,
      lineageId: "assignment-a",
      assignmentId: "assignment-a",
      assignmentExpiresAt: 10,
      transitionIdentity: "assign:a",
      now: 1,
    },
    {} as ClientSession,
  );
  await assert.rejects(
    repository.reserve(
      {
        ...identity,
        lineageId: "assignment-b",
        assignmentId: "assignment-b",
        assignmentExpiresAt: 20,
        transitionIdentity: "assign:b",
        now: 9,
      },
      {} as ClientSession,
    ),
    /AUTHORITY_SLOT_ALREADY_RESERVED/u,
  );
  const reclaimed = await repository.reserve(
    {
      ...identity,
      lineageId: "assignment-b",
      assignmentId: "assignment-b",
      assignmentExpiresAt: 20,
      transitionIdentity: "assign:b",
      now: 10,
    },
    {} as ClientSession,
  );
  assert.equal(reclaimed.currentAssignmentId, "assignment-b");
  assert.equal(reclaimed.releaseAt, 20);
});

test("concurrent ordinary writers have one deterministic authority-slot winner", async () => {
  const db = new SlotFakeDb();
  const repository = new NativeMongoAuthoritySlotRepository(
    db as unknown as Db,
  );
  const identity = buildAuthoritySlotIdentity({
    userId: "user",
    roleId: "role",
    structuredScopeGrants: [{ scopeType: "global" }],
  });
  const write = (assignmentId: string) =>
    repository.reserve(
      {
        ...identity,
        lineageId: assignmentId,
        assignmentId,
        transitionIdentity: `assign:${assignmentId}`,
        now: 1,
      },
      {} as ClientSession,
    );
  const settled = await Promise.allSettled([write("a"), write("b")]);
  assert.equal(settled.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(settled.filter((item) => item.status === "rejected").length, 1);
});

test("authority slot release reports deterministic conflict after stale CAS exhaustion", async () => {
  const db = new SlotFakeDb();
  const repository = new NativeMongoAuthoritySlotRepository(
    db as unknown as Db,
  );
  const identity = buildAuthoritySlotIdentity({
    userId: "user",
    roleId: "role",
    structuredScopeGrants: [{ scopeType: "self" }],
  });
  await repository.reserve(
    {
      ...identity,
      lineageId: "assignment-a",
      assignmentId: "assignment-a",
      assignmentExpiresAt: 100,
      transitionIdentity: "assign:a",
      now: 1,
    },
    {} as ClientSession,
  );
  db.collectionValue.failUpdates = true;
  await assert.rejects(
    repository.releaseAssignment(
      identity.id,
      "assignment-a",
      "revoke:a",
      2,
      {} as ClientSession,
    ),
    /AUTHORITY_SLOT_CONCURRENT_WRITE/u,
  );
});

class SlotFakeDb {
  readonly collectionValue = new SlotFakeCollection();
  collection(): SlotFakeCollection {
    return this.collectionValue;
  }
}

function scheduledSlot() {
  const identity = buildAuthoritySlotIdentity({
    userId: "user",
    roleId: "role",
    structuredScopeGrants: [{ scopeType: "self" }],
  });
  const inserted = planAuthoritySlotReservation(null, {
    ...identity,
    lineageId: "assignment-a",
    assignmentId: "assignment-a",
    assignmentExpiresAt: 100,
    transitionIdentity: "assign:a",
    now: 1,
  });
  assert.equal(inserted.kind, "INSERT");
  const successor = planAuthoritySlotReservation(inserted.record, {
    ...identity,
    lineageId: "assignment-a",
    assignmentId: "assignment-b",
    predecessorAssignmentId: "assignment-a",
    successorEffectiveAt: 50,
    assignmentExpiresAt: 200,
    transitionIdentity: "successor:b",
    now: 2,
  });
  assert.equal(successor.kind, "CAS");
  return { predecessor: inserted.record, successor: successor.record };
}

class SlotFakeCollection {
  private readonly rows = new Map<string, Record<string, unknown>>();
  failUpdates = false;
  async findOne(query: {
    readonly _id: string;
  }): Promise<Record<string, unknown> | null> {
    const row = this.rows.get(query._id);
    return row ? structuredClone(row) : null;
  }
  async insertOne(document: Record<string, unknown>): Promise<void> {
    const id = String(document._id);
    if (this.rows.has(id)) {
      throw Object.assign(new Error("duplicate"), { code: 11000 });
    }
    this.rows.set(id, structuredClone(document));
  }
  async updateOne(
    query: { readonly _id: string; readonly version: number },
    update: { readonly $set: Record<string, unknown> },
  ): Promise<{ modifiedCount: number }> {
    const current = this.rows.get(query._id);
    if (this.failUpdates) return { modifiedCount: 0 };
    if (!current || current.version !== query.version)
      return { modifiedCount: 0 };
    this.rows.set(query._id, { ...current, ...structuredClone(update.$set) });
    return { modifiedCount: 1 };
  }
}
