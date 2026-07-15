import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertEmergencyOverride,
  assertWorkScheduleApplicationVersions,
  classifyWorkScheduleLeadTime,
  createRosterSourceSnapshot,
  createWorkScheduleApplicationLineage,
  mapLegacyWorkScheduleApplication,
  rosterSourceFingerprint,
} from "./domain/work-schedule-application-policy";

describe("WorkSchedule automatic application hardening", () => {
  it("maps approved-not-applied and FAILED_TO_APPLY without replaying history", () => {
    assert.deepEqual(
      mapLegacyWorkScheduleApplication({
        decisionStatus: "APPROVED",
        applyStatus: "NOT_APPLIED",
      }),
      {
        state: "APPLICATION_CONFLICT",
        requiresManualReview: true,
        reason: "LEGACY_APPROVED_NOT_APPLIED",
      },
    );
    assert.equal(
      mapLegacyWorkScheduleApplication({
        decisionStatus: "FAILED_TO_APPLY",
      }).state,
      "APPLICATION_FAILED",
    );
    assert.equal(
      mapLegacyWorkScheduleApplication({
        decisionStatus: "APPROVED",
        applyStatus: "APPLIED",
      }).state,
      "APPROVED_APPLIED",
    );
  });

  it("rejects stale request, roster, and WorkShift versions", () => {
    const base = {
      expectedRequestVersion: 1,
      actualRequestVersion: 1,
      expectedRosterVersion: 2,
      actualRosterVersion: 2,
      expectedWorkShiftVersion: 3,
      actualWorkShiftVersion: 3,
    };
    assert.doesNotThrow(() => assertWorkScheduleApplicationVersions(base));
    assert.throws(
      () =>
        assertWorkScheduleApplicationVersions({
          ...base,
          actualRequestVersion: 2,
        }),
      /STALE_REQUEST_VERSION/u,
    );
    assert.throws(
      () =>
        assertWorkScheduleApplicationVersions({
          ...base,
          actualRosterVersion: 3,
        }),
      /STALE_ROSTER_VERSION/u,
    );
    assert.throws(
      () =>
        assertWorkScheduleApplicationVersions({
          ...base,
          actualWorkShiftVersion: 4,
        }),
      /STALE_WORK_SHIFT_VERSION/u,
    );
  });

  it("creates deterministic immutable roster source snapshots", () => {
    const snapshot = createRosterSourceSnapshot({
      rosterDraftVersion: 4,
      holidayCalendarId: "calendar",
      holidayCalendarVersion: 5,
      holidayEffectiveDays: ["2026-08-02", "2026-08-01"],
      workPatternId: "pattern",
      workPatternVersion: 6,
      resolvedWorkPattern: {
        timezone: "Asia/Ho_Chi_Minh",
        workingDays: ["MON", "TUE", "WED"],
        startLocalTime: "09:00",
        endLocalTime: "18:00",
        workingMinutes: 480,
        breakMinutes: 60,
      },
      eligibleEmploymentProfileIds: ["profile-b", "profile-a", "profile-a"],
      membershipTrace: [
        {
          membershipKind: "TALENT_GROUP_MEMBERSHIP",
          membershipId: "member-a",
          talentId: "talent-a",
          employmentProfileId: "profile-a",
          orgUnitId: "org-a",
          membershipStatus: "ACTIVE",
          eligibility: "ELIGIBLE",
          exclusionReasonCode: null,
        },
      ],
      previewHash: "preview-hash",
      previewActorId: "admin",
      previewedAt: 1_700_000_000_000,
    });
    assert.deepEqual(snapshot.holidayEffectiveDays, [
      "2026-08-01",
      "2026-08-02",
    ]);
    assert.deepEqual(snapshot.eligibleEmploymentProfileIds, [
      "profile-a",
      "profile-b",
    ]);
    assert.equal(snapshot.snapshotVersion, 2);
    assert.deepEqual(snapshot.resolvedWorkPattern.workingDays, [
      "MON",
      "TUE",
      "WED",
    ]);
    assert.equal(snapshot.membershipTrace[0]?.membershipId, "member-a");
    assert.equal(snapshot.resolvedWorkPatternFingerprint.length, 64);
  });

  it("classifies normal, urgent, and emergency lead time with monitoring-only SLA", () => {
    const now = 1_700_000_000_000;
    assert.deepEqual(
      classifyWorkScheduleLeadTime({
        now,
        proposedStartAt: now + 24 * 3_600_000,
      }),
      {
        classification: "NORMAL",
        slaMinutes: 240,
        requiresEmergencyOverride: false,
        monitoringOnly: true,
        autoDecision: false,
      },
    );
    assert.equal(
      classifyWorkScheduleLeadTime({
        now,
        proposedStartAt: now + 4 * 3_600_000,
      }).classification,
      "URGENT",
    );
    const emergency = classifyWorkScheduleLeadTime({
      now,
      proposedStartAt: now + 3_600_000,
    });
    assert.equal(emergency.classification, "EMERGENCY");
    assert.throws(
      () =>
        assertEmergencyOverride({
          decision: emergency,
          actorKind: "MANAGER",
          reason: "urgent member need",
          identityAndScopeValid: true,
        }),
      /EMERGENCY_ADMIN_OPS_ONLY/u,
    );
    assert.throws(
      () =>
        assertEmergencyOverride({
          decision: emergency,
          actorKind: "ADMIN_OPS",
          reason: "",
          identityAndScopeValid: true,
        }),
      /EMERGENCY_REASON_REQUIRED/u,
    );
    assert.doesNotThrow(() =>
      assertEmergencyOverride({
        decision: emergency,
        actorKind: "ADMIN_OPS",
        reason: "service continuity",
        identityAndScopeValid: true,
      }),
    );
  });

  it("retains before/after replacement and cancellation lineage", () => {
    const before = {
      workShiftId: "shift-1",
      version: 2,
      status: "ACTIVE",
      startAt: 10,
      endAt: 20,
    };
    const after = {
      workShiftId: "shift-2",
      version: 1,
      status: "ACTIVE",
      startAt: 30,
      endAt: 40,
    };
    assert.equal(
      createWorkScheduleApplicationLineage({
        kind: "RESCHEDULE",
        before,
        after,
        idempotencyKey: "idem-reschedule",
      }).replacementOfWorkShiftId,
      "shift-1",
    );
    assert.equal(
      createWorkScheduleApplicationLineage({
        kind: "CANCEL",
        before,
        after: null,
        idempotencyKey: "idem-cancel",
      }).cancelledWorkShiftId,
      "shift-1",
    );
  });

  it("fingerprints source versions independent of member ordering", () => {
    const left = rosterSourceFingerprint({
      holidayCalendarVersion: 1,
      workPatternVersion: 2,
      eligibleProfileIds: ["b", "a"],
      rosterDraftVersion: 3,
    });
    const right = rosterSourceFingerprint({
      holidayCalendarVersion: 1,
      workPatternVersion: 2,
      eligibleProfileIds: ["a", "b"],
      rosterDraftVersion: 3,
    });
    assert.equal(left, right);
  });
});
