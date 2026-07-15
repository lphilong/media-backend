import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aggregateAcceptedActuals,
  authorizeActualCapture,
  createActualCorrectionLineage,
  DEFAULT_MEMBER_ENTRY_ACTUAL_POLICY,
  resolveActualDeadline,
  resolveActualPrivacy,
  type KpiMetricActualPolicy,
} from "./kpi-actual-policy";

const memberPolicy = DEFAULT_MEMBER_ENTRY_ACTUAL_POLICY;

function policy(
  overrides: Partial<KpiMetricActualPolicy>,
): KpiMetricActualPolicy {
  return { ...memberPolicy, ...overrides };
}

describe("KPI actual policy V3", () => {
  it("keeps GROUP_ENTRY at group scope and never distributes it to members", () => {
    assert.deepEqual(
      authorizeActualCapture(policy({ captureMode: "GROUP_ENTRY" }), {
        actorKind: "MANAGER",
        targetScope: "GROUP",
        hasPublishedAllocation: false,
        memberEligible: false,
        hasExactManagerAuthority: true,
        hasEvidence: false,
        existingManualEntry: false,
      }),
      { allowed: true, lifecycleStatus: "ACCEPTED", reason: null },
    );
    assert.equal(
      authorizeActualCapture(policy({ captureMode: "GROUP_ENTRY" }), {
        actorKind: "MANAGER",
        targetScope: "MEMBER",
        hasPublishedAllocation: true,
        memberEligible: true,
        hasExactManagerAuthority: true,
        hasEvidence: false,
        existingManualEntry: false,
      }).reason,
      "GROUP_SCOPE_REQUIRED",
    );
  });

  it("requires a published allocation, eligible member, and exact Manager authority", () => {
    const base = {
      actorKind: "MANAGER" as const,
      targetScope: "MEMBER" as const,
      hasPublishedAllocation: true,
      memberEligible: true,
      hasExactManagerAuthority: true,
      hasEvidence: false,
      existingManualEntry: false,
    };
    assert.equal(authorizeActualCapture(memberPolicy, base).allowed, true);
    assert.equal(
      authorizeActualCapture(memberPolicy, { ...base, memberEligible: false })
        .reason,
      "MEMBER_NOT_ELIGIBLE",
    );
    assert.equal(
      authorizeActualCapture(memberPolicy, {
        ...base,
        hasExactManagerAuthority: false,
      }).reason,
      "EXACT_MANAGER_AUTHORITY_REQUIRED",
    );
  });

  it("makes imported sources source-owned and denies manual duplicates", () => {
    const imported = policy({
      captureMode: "IMPORTED_SOURCE",
      evidenceMode: "SOURCE_CONTROLLED",
      sourceOwner: "INTEGRATION",
    });
    const base = {
      actorKind: "INTEGRATION" as const,
      targetScope: "MEMBER" as const,
      hasPublishedAllocation: true,
      memberEligible: true,
      hasExactManagerAuthority: false,
      hasEvidence: false,
      sourceFingerprint: "sha256:source-v1",
      existingManualEntry: false,
    };
    assert.equal(authorizeActualCapture(imported, base).allowed, true);
    assert.equal(
      authorizeActualCapture(imported, { ...base, actorKind: "MANAGER" })
        .reason,
      "SOURCE_OWNED_MANAGER_READ_ONLY",
    );
    assert.equal(
      authorizeActualCapture(imported, { ...base, existingManualEntry: true })
        .reason,
      "MANUAL_DUPLICATE_FORBIDDEN",
    );
  });

  it("denies manual derived records and requires input-version fingerprinting", () => {
    const derived = policy({ captureMode: "DERIVED", sourceOwner: "SYSTEM" });
    const base = {
      actorKind: "SYSTEM" as const,
      targetScope: "GROUP" as const,
      hasPublishedAllocation: false,
      memberEligible: false,
      hasExactManagerAuthority: false,
      hasEvidence: false,
      sourceFingerprint: "accepted:a@2,b@4;derivation:v3",
      existingManualEntry: false,
    };
    assert.equal(authorizeActualCapture(derived, base).allowed, true);
    assert.equal(
      authorizeActualCapture(derived, { ...base, actorKind: "MANAGER" }).reason,
      "DERIVED_MANUAL_ENTRY_FORBIDDEN",
    );
  });

  it("keeps HYBRID group and member aggregates separate and rejects duplicate versions", () => {
    const result = aggregateAcceptedActuals("SUM", [
      { id: "group", acceptedVersion: 1, scope: "GROUP", value: "30" },
      { id: "member-a", acceptedVersion: 2, scope: "MEMBER", value: "40" },
      { id: "member-b", acceptedVersion: 1, scope: "MEMBER", value: "30" },
    ]);
    assert.equal(result.groupValue, "30");
    assert.equal(result.memberValue, "70");
    assert.equal(result.combinedValue, null);
    assert.throws(
      () =>
        aggregateAcceptedActuals("SUM", [
          { id: "a", acceptedVersion: 1, scope: "MEMBER", value: 1 },
          { id: "a", acceptedVersion: 1, scope: "MEMBER", value: 1 },
        ]),
      /DUPLICATE_ACCEPTED_INPUT/u,
    );
  });

  it("defines average, weighted, max, null, manual, and none semantics exactly", () => {
    assert.equal(
      aggregateAcceptedActuals("AVERAGE", [
        { id: "a", acceptedVersion: 1, scope: "MEMBER", value: "0.1" },
        { id: "b", acceptedVersion: 1, scope: "MEMBER", value: "0.2" },
        { id: "c", acceptedVersion: 1, scope: "MEMBER", value: null },
      ]).memberValue,
      "0.15",
    );
    assert.equal(
      aggregateAcceptedActuals("WEIGHTED", [
        { id: "a", acceptedVersion: 1, scope: "MEMBER", value: 10, weight: 1 },
        { id: "b", acceptedVersion: 1, scope: "MEMBER", value: 20, weight: 3 },
      ]).memberValue,
      "17.5",
    );
    assert.equal(
      aggregateAcceptedActuals("MAX", [
        { id: "a", acceptedVersion: 1, scope: "MEMBER", value: 10 },
        { id: "b", acceptedVersion: 1, scope: "MEMBER", value: 20 },
      ]).memberValue,
      "20",
    );
    assert.equal(
      aggregateAcceptedActuals("MANUAL", [
        { id: "a", acceptedVersion: 1, scope: "MEMBER", value: 10 },
      ]).memberValue,
      null,
    );
    assert.equal(
      aggregateAcceptedActuals("NONE", [
        { id: "a", acceptedVersion: 1, scope: "MEMBER", value: 10 },
      ]).memberValue,
      null,
    );
  });

  it("enforces evidence and routes configured review to UNDER_REVIEW", () => {
    const reviewed = policy({
      evidenceMode: "REQUIRED",
      reviewMode: "MANAGER_REVIEW",
    });
    const context = {
      actorKind: "OPS" as const,
      targetScope: "MEMBER" as const,
      hasPublishedAllocation: true,
      memberEligible: true,
      hasExactManagerAuthority: false,
      hasEvidence: false,
      existingManualEntry: false,
    };
    assert.equal(
      authorizeActualCapture(reviewed, context).reason,
      "EVIDENCE_REQUIRED",
    );
    assert.equal(
      authorizeActualCapture(reviewed, { ...context, hasEvidence: true })
        .lifecycleStatus,
      "UNDER_REVIEW",
    );
  });

  it("applies D+1 12:00, D+2 18:00, late-review, Day-03 lock, and controlled reopen", () => {
    const base = {
      actualDate: "2026-06-10",
      periodMonth: "2026-06",
      policy: memberPolicy,
    };
    assert.equal(
      resolveActualDeadline({
        ...base,
        now: Date.parse("2026-06-11T05:00:00.000Z"),
      }).stage,
      "DIRECT_ENTRY",
    );
    assert.equal(
      resolveActualDeadline({
        ...base,
        now: Date.parse("2026-06-11T05:00:00.001Z"),
      }).stage,
      "ORDINARY_CORRECTION",
    );
    assert.equal(
      resolveActualDeadline({
        ...base,
        now: Date.parse("2026-06-12T11:00:00.001Z"),
      }).stage,
      "LATE_CORRECTION_REVIEW_REQUIRED",
    );
    const lockedAt = Date.parse("2026-07-03T11:00:00.001Z");
    assert.equal(
      resolveActualDeadline({ ...base, now: lockedAt }).stage,
      "LOCKED",
    );
    assert.equal(
      resolveActualDeadline({
        ...base,
        now: lockedAt,
        controlledReopenUntil: lockedAt + 1,
      }).stage,
      "CONTROLLED_REOPEN",
    );
  });

  it("creates linked replacement lineage without erasing accepted evidence", () => {
    assert.deepEqual(
      createActualCorrectionLineage({
        entryId: "entry-1",
        acceptedVersion: 3,
        correctionId: "correction-4",
        requiresReview: true,
      }),
      {
        previousEntryId: "entry-1",
        previousAcceptedVersion: 3,
        replacementEntryId: "correction-4",
        replacementVersion: 4,
        previousLifecycleStatus: "CORRECTED",
        replacementLifecycleStatus: "UNDER_REVIEW",
      },
    );
  });

  it("enforces member privacy and rejects negative actual domains", () => {
    assert.deepEqual(
      resolveActualPrivacy({
        viewer: "MEMBER",
        exactAuthority: false,
        isOwnMemberRecord: true,
        isPublishedTarget: true,
        isAcceptedActual: true,
        isApprovedGroupAggregate: true,
      }),
      {
        canSeePersonalDetail: true,
        canSeeEvidence: false,
        canSeeGroupAggregate: true,
        canSeePeerDetail: false,
        canSeeRanking: false,
      },
    );
    assert.throws(
      () =>
        aggregateAcceptedActuals("SUM", [
          {
            id: "negative-money",
            acceptedVersion: 1,
            scope: "MEMBER",
            value: -1,
          },
        ]),
      /NEGATIVE_ACTUAL/u,
    );
  });
});
