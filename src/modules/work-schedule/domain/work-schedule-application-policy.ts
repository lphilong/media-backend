import { createHash } from "node:crypto";

export const WORK_SCHEDULE_APPLICATION_STATES = [
  "PENDING",
  "APPROVED_APPLIED",
  "REJECTED",
  "CANCELLED",
  "SOURCE_CHANGED",
  "APPLICATION_CONFLICT",
  "APPLICATION_FAILED",
] as const;
export type WorkScheduleApplicationState =
  (typeof WORK_SCHEDULE_APPLICATION_STATES)[number];

export type WorkScheduleApplicationCompatibility = {
  readonly state: WorkScheduleApplicationState;
  readonly requiresManualReview: boolean;
  readonly reason: string | null;
};

export function mapLegacyWorkScheduleApplication(input: {
  readonly decisionStatus: string;
  readonly applyStatus?: string | null;
}): WorkScheduleApplicationCompatibility {
  if (input.decisionStatus === "PENDING")
    return compatibility("PENDING", false, null);
  if (input.decisionStatus === "REJECTED")
    return compatibility("REJECTED", false, null);
  if (input.decisionStatus === "CANCELLED")
    return compatibility("CANCELLED", false, null);
  if (input.decisionStatus === "APPROVED" && input.applyStatus === "APPLIED") {
    return compatibility("APPROVED_APPLIED", false, null);
  }
  if (
    input.decisionStatus === "FAILED_TO_APPLY" ||
    input.applyStatus === "FAILED_TO_APPLY"
  ) {
    return compatibility("APPLICATION_FAILED", true, "LEGACY_FAILED_TO_APPLY");
  }
  if (
    input.decisionStatus === "APPROVED" &&
    (input.applyStatus === "NOT_APPLIED" || input.applyStatus === null)
  ) {
    return compatibility(
      "APPLICATION_CONFLICT",
      true,
      "LEGACY_APPROVED_NOT_APPLIED",
    );
  }
  return compatibility("APPLICATION_FAILED", true, "AMBIGUOUS_LEGACY_STATE");
}

function compatibility(
  state: WorkScheduleApplicationState,
  requiresManualReview: boolean,
  reason: string | null,
): WorkScheduleApplicationCompatibility {
  return { state, requiresManualReview, reason };
}

export interface WorkScheduleRosterSourceSnapshot {
  readonly snapshotVersion: 2;
  readonly rosterDraftVersion: number;
  readonly holidayCalendarId: string;
  readonly holidayCalendarVersion: number;
  readonly holidayEffectiveDays: readonly string[];
  readonly workPatternId: string;
  readonly workPatternVersion: number;
  readonly resolvedWorkPattern: WorkScheduleResolvedPatternSnapshot;
  readonly resolvedWorkPatternFingerprint: string;
  readonly eligibleEmploymentProfileIds: readonly string[];
  readonly membershipTrace: readonly WorkScheduleRosterMembershipTrace[];
  readonly talentMembershipTraceFingerprint: string | null;
  readonly previewHash: string;
  readonly previewActorId: string;
  readonly previewedAt: number;
}

export interface WorkScheduleResolvedPatternSnapshot {
  readonly timezone: string;
  readonly workingDays: readonly string[];
  readonly startLocalTime: string;
  readonly endLocalTime: string;
  readonly workingMinutes: number;
  readonly breakMinutes: number;
}

export interface WorkScheduleRosterMembershipTrace {
  readonly membershipKind: "ORG_UNIT_ASSOCIATION" | "TALENT_GROUP_MEMBERSHIP";
  readonly membershipId: string | null;
  readonly talentId: string | null;
  readonly employmentProfileId: string | null;
  readonly orgUnitId: string | null;
  readonly membershipStatus: string;
  readonly eligibility: "ELIGIBLE" | "EXCLUDED";
  readonly exclusionReasonCode: string | null;
}

export function createRosterSourceSnapshot(input: {
  readonly rosterDraftVersion: number;
  readonly holidayCalendarId: string;
  readonly holidayCalendarVersion: number;
  readonly holidayEffectiveDays: readonly string[];
  readonly workPatternId: string;
  readonly workPatternVersion: number;
  readonly resolvedWorkPattern: WorkScheduleResolvedPatternSnapshot;
  readonly eligibleEmploymentProfileIds: readonly string[];
  readonly membershipTrace: readonly WorkScheduleRosterMembershipTrace[];
  readonly previewHash: string;
  readonly previewActorId: string;
  readonly previewedAt: number;
}): WorkScheduleRosterSourceSnapshot {
  return {
    snapshotVersion: 2,
    rosterDraftVersion: input.rosterDraftVersion,
    holidayCalendarId: input.holidayCalendarId,
    holidayCalendarVersion: input.holidayCalendarVersion,
    holidayEffectiveDays: [...input.holidayEffectiveDays].sort(),
    workPatternId: input.workPatternId,
    workPatternVersion: input.workPatternVersion,
    resolvedWorkPattern: {
      ...input.resolvedWorkPattern,
      workingDays: [...input.resolvedWorkPattern.workingDays],
    },
    resolvedWorkPatternFingerprint: fingerprint(input.resolvedWorkPattern),
    eligibleEmploymentProfileIds: [
      ...new Set(input.eligibleEmploymentProfileIds),
    ].sort(),
    membershipTrace: [...input.membershipTrace]
      .map((item) => ({ ...item }))
      .sort((left, right) =>
        [
          left.membershipKind,
          left.membershipId ?? "",
          left.employmentProfileId ?? "",
          left.talentId ?? "",
        ]
          .join(":")
          .localeCompare(
            [
              right.membershipKind,
              right.membershipId ?? "",
              right.employmentProfileId ?? "",
              right.talentId ?? "",
            ].join(":"),
          ),
      ),
    talentMembershipTraceFingerprint: input.membershipTrace.some(
      (item) => item.membershipKind === "TALENT_GROUP_MEMBERSHIP",
    )
      ? fingerprint(input.membershipTrace)
      : null,
    previewHash: input.previewHash,
    previewActorId: input.previewActorId,
    previewedAt: input.previewedAt,
  };
}

export function assertWorkScheduleApplicationVersions(input: {
  readonly expectedRequestVersion: number;
  readonly actualRequestVersion: number;
  readonly expectedRosterVersion: number;
  readonly actualRosterVersion: number;
  readonly expectedWorkShiftVersion?: number;
  readonly actualWorkShiftVersion?: number;
}): void {
  if (input.expectedRequestVersion !== input.actualRequestVersion) {
    throw new Error("STALE_REQUEST_VERSION");
  }
  if (input.expectedRosterVersion !== input.actualRosterVersion) {
    throw new Error("STALE_ROSTER_VERSION");
  }
  if (
    input.expectedWorkShiftVersion !== undefined &&
    input.expectedWorkShiftVersion !== input.actualWorkShiftVersion
  ) {
    throw new Error("STALE_WORK_SHIFT_VERSION");
  }
}

export type WorkScheduleLeadTimeClass = "NORMAL" | "URGENT" | "EMERGENCY";
export interface WorkScheduleLeadTimeDecision {
  readonly classification: WorkScheduleLeadTimeClass;
  readonly slaMinutes: 240 | 60 | null;
  readonly requiresEmergencyOverride: boolean;
  readonly monitoringOnly: true;
  readonly autoDecision: false;
}

export function classifyWorkScheduleLeadTime(input: {
  readonly now: number;
  readonly proposedStartAt: number;
}): WorkScheduleLeadTimeDecision {
  const hours = (input.proposedStartAt - input.now) / 3_600_000;
  if (hours >= 24) {
    return leadTime("NORMAL", 240, false);
  }
  if (hours >= 4) {
    return leadTime("URGENT", 60, false);
  }
  return leadTime("EMERGENCY", null, true);
}

function leadTime(
  classification: WorkScheduleLeadTimeClass,
  slaMinutes: 240 | 60 | null,
  requiresEmergencyOverride: boolean,
): WorkScheduleLeadTimeDecision {
  return {
    classification,
    slaMinutes,
    requiresEmergencyOverride,
    monitoringOnly: true,
    autoDecision: false,
  };
}

export function assertEmergencyOverride(input: {
  readonly decision: WorkScheduleLeadTimeDecision;
  readonly actorKind: "ADMIN_OPS" | "MANAGER" | "STAFF";
  readonly reason?: string | null;
  readonly identityAndScopeValid: boolean;
}): void {
  if (!input.identityAndScopeValid) throw new Error("IDENTITY_SCOPE_REQUIRED");
  if (!input.decision.requiresEmergencyOverride) return;
  if (input.actorKind !== "ADMIN_OPS")
    throw new Error("EMERGENCY_ADMIN_OPS_ONLY");
  if (!input.reason?.trim()) throw new Error("EMERGENCY_REASON_REQUIRED");
}

export interface WorkScheduleShiftSnapshot {
  readonly workShiftId: string;
  readonly version: number;
  readonly status: string;
  readonly startAt: number;
  readonly endAt: number;
}

export interface WorkScheduleApplicationLineage {
  readonly before: WorkScheduleShiftSnapshot | null;
  readonly after: WorkScheduleShiftSnapshot | null;
  readonly replacementOfWorkShiftId: string | null;
  readonly cancelledWorkShiftId: string | null;
  readonly generatedByRosterId: string | null;
  readonly idempotencyKey: string;
}

export function createWorkScheduleApplicationLineage(input: {
  readonly kind: "CREATE" | "RESCHEDULE" | "CANCEL";
  readonly before: WorkScheduleShiftSnapshot | null;
  readonly after: WorkScheduleShiftSnapshot | null;
  readonly rosterId?: string | null;
  readonly idempotencyKey: string;
}): WorkScheduleApplicationLineage {
  if (input.kind !== "CREATE" && input.before === null) {
    throw new Error("BEFORE_SNAPSHOT_REQUIRED");
  }
  if (input.kind !== "CANCEL" && input.after === null) {
    throw new Error("AFTER_SNAPSHOT_REQUIRED");
  }
  return {
    before: input.before,
    after: input.after,
    replacementOfWorkShiftId:
      input.kind === "RESCHEDULE" ? input.before!.workShiftId : null,
    cancelledWorkShiftId:
      input.kind === "CANCEL" ? input.before!.workShiftId : null,
    generatedByRosterId: input.rosterId ?? null,
    idempotencyKey: input.idempotencyKey,
  };
}

export function rosterSourceFingerprint(input: {
  readonly holidayCalendarVersion: number;
  readonly workPatternVersion: number;
  readonly eligibleProfileIds: readonly string[];
  readonly rosterDraftVersion: number;
}): string {
  return fingerprint({
    ...input,
    eligibleProfileIds: [...input.eligibleProfileIds].sort(),
  });
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
