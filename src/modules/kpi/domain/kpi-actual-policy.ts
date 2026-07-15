import { createHash } from "node:crypto";

export const KPI_ACTUAL_CAPTURE_MODES = [
  "GROUP_ENTRY",
  "MEMBER_ENTRY",
  "IMPORTED_SOURCE",
  "DERIVED",
] as const;
export type KpiActualCaptureMode = (typeof KPI_ACTUAL_CAPTURE_MODES)[number];

export const KPI_ACTUAL_AGGREGATION_METHODS = [
  "SUM",
  "AVERAGE",
  "WEIGHTED",
  "MAX",
  "MANUAL",
  "NONE",
] as const;
export type KpiActualAggregationMethod =
  (typeof KPI_ACTUAL_AGGREGATION_METHODS)[number];

export const KPI_ACTUAL_REVIEW_MODES = [
  "NONE",
  "MANAGER_REVIEW",
  "OPS_REVIEW",
] as const;
export type KpiActualReviewMode = (typeof KPI_ACTUAL_REVIEW_MODES)[number];

export const KPI_ACTUAL_EVIDENCE_MODES = [
  "NONE",
  "OPTIONAL",
  "REQUIRED",
  "SOURCE_CONTROLLED",
] as const;
export type KpiActualEvidenceMode = (typeof KPI_ACTUAL_EVIDENCE_MODES)[number];

export const KPI_ACTUAL_LIFECYCLE_STATUSES = [
  "DRAFT",
  "POSTED",
  "UNDER_REVIEW",
  "ACCEPTED",
  "CORRECTED",
  "LOCKED",
] as const;
export type KpiActualLifecycleStatus =
  (typeof KPI_ACTUAL_LIFECYCLE_STATUSES)[number];

export interface KpiMetricActualPolicy {
  readonly policyVersion: string;
  readonly captureMode: KpiActualCaptureMode;
  readonly aggregationMethod: KpiActualAggregationMethod;
  readonly reviewMode: KpiActualReviewMode;
  readonly evidenceMode: KpiActualEvidenceMode;
  readonly directEntryDayOffset: 1;
  readonly directEntryLockLocalTime: "10:00" | "12:00";
  readonly ordinaryCorrectionDayOffset: 2;
  readonly ordinaryCorrectionLockLocalTime: "18:00";
  readonly periodLockDayOfFollowingMonth: 3;
  readonly periodLockLocalTime: "18:00";
  readonly sourceOwner: "MANAGER" | "OPS" | "INTEGRATION" | "SYSTEM";
}

export const DEFAULT_MEMBER_ENTRY_ACTUAL_POLICY: KpiMetricActualPolicy =
  Object.freeze({
    policyVersion: "kpi-actual-policy-v3",
    captureMode: "MEMBER_ENTRY",
    aggregationMethod: "SUM",
    reviewMode: "NONE",
    evidenceMode: "NONE",
    directEntryDayOffset: 1,
    directEntryLockLocalTime: "12:00",
    ordinaryCorrectionDayOffset: 2,
    ordinaryCorrectionLockLocalTime: "18:00",
    periodLockDayOfFollowingMonth: 3,
    periodLockLocalTime: "18:00",
    sourceOwner: "MANAGER",
  });

const HCM_UTC_OFFSET_HOURS = 7;
const DECIMAL_SCALE = 1_000_000n;

export type KpiActualDeadlineStage =
  | "DIRECT_ENTRY"
  | "ORDINARY_CORRECTION"
  | "LATE_CORRECTION_REVIEW_REQUIRED"
  | "LOCKED"
  | "CONTROLLED_REOPEN";

export interface KpiActualDeadlineDecision {
  readonly stage: KpiActualDeadlineStage;
  readonly directEntryClosesAt: number;
  readonly ordinaryCorrectionClosesAt: number;
  readonly periodLocksAt: number;
  readonly requiresReason: boolean;
  readonly requiresReview: boolean;
}

export function resolveActualDeadline(input: {
  readonly actualDate: string;
  readonly periodMonth: string;
  readonly now: number;
  readonly policy: KpiMetricActualPolicy;
  readonly controlledReopenUntil?: number | null;
}): KpiActualDeadlineDecision {
  const directEntryClosesAt = localDateTimeToUtcMs(
    input.actualDate,
    input.policy.directEntryLockLocalTime,
    input.policy.directEntryDayOffset,
  );
  const ordinaryCorrectionClosesAt = localDateTimeToUtcMs(
    input.actualDate,
    input.policy.ordinaryCorrectionLockLocalTime,
    input.policy.ordinaryCorrectionDayOffset,
  );
  const periodLocksAt = followingMonthLockAt(
    input.periodMonth,
    input.policy.periodLockDayOfFollowingMonth,
    input.policy.periodLockLocalTime,
  );

  let stage: KpiActualDeadlineStage;
  if (input.now <= directEntryClosesAt) {
    stage = "DIRECT_ENTRY";
  } else if (input.now <= ordinaryCorrectionClosesAt) {
    stage = "ORDINARY_CORRECTION";
  } else if (input.now <= periodLocksAt) {
    stage = "LATE_CORRECTION_REVIEW_REQUIRED";
  } else if (
    input.controlledReopenUntil !== null &&
    input.controlledReopenUntil !== undefined &&
    input.now <= input.controlledReopenUntil
  ) {
    stage = "CONTROLLED_REOPEN";
  } else {
    stage = "LOCKED";
  }

  return {
    stage,
    directEntryClosesAt,
    ordinaryCorrectionClosesAt,
    periodLocksAt,
    requiresReason:
      stage === "LATE_CORRECTION_REVIEW_REQUIRED" ||
      stage === "CONTROLLED_REOPEN",
    requiresReview:
      stage === "LATE_CORRECTION_REVIEW_REQUIRED" ||
      stage === "CONTROLLED_REOPEN",
  };
}

export interface KpiActualCaptureContext {
  readonly actorKind: "MANAGER" | "OPS" | "INTEGRATION" | "SYSTEM";
  readonly targetScope: "GROUP" | "MEMBER";
  readonly hasPublishedAllocation: boolean;
  readonly memberEligible: boolean;
  readonly hasExactManagerAuthority: boolean;
  readonly hasEvidence: boolean;
  readonly sourceFingerprint?: string | null;
  readonly existingManualEntry: boolean;
}

export interface KpiActualCaptureDecision {
  readonly allowed: boolean;
  readonly lifecycleStatus: KpiActualLifecycleStatus;
  readonly reason: string | null;
}

export function authorizeActualCapture(
  policy: KpiMetricActualPolicy,
  context: KpiActualCaptureContext,
): KpiActualCaptureDecision {
  if (policy.evidenceMode === "REQUIRED" && !context.hasEvidence) {
    return denied("EVIDENCE_REQUIRED");
  }
  if (policy.captureMode === "GROUP_ENTRY") {
    if (context.targetScope !== "GROUP") return denied("GROUP_SCOPE_REQUIRED");
    if (!context.hasExactManagerAuthority && context.actorKind !== "OPS") {
      return denied("EXACT_MANAGER_AUTHORITY_REQUIRED");
    }
    return acceptedForReview(policy);
  }
  if (policy.captureMode === "MEMBER_ENTRY") {
    if (context.targetScope !== "MEMBER")
      return denied("MEMBER_SCOPE_REQUIRED");
    if (!context.hasPublishedAllocation) {
      return denied("PUBLISHED_ALLOCATION_REQUIRED");
    }
    if (!context.memberEligible) return denied("MEMBER_NOT_ELIGIBLE");
    if (!context.hasExactManagerAuthority && context.actorKind !== "OPS") {
      return denied("EXACT_MANAGER_AUTHORITY_REQUIRED");
    }
    return acceptedForReview(policy);
  }
  if (policy.captureMode === "IMPORTED_SOURCE") {
    if (context.actorKind !== "INTEGRATION" && context.actorKind !== "OPS") {
      return denied("SOURCE_OWNED_MANAGER_READ_ONLY");
    }
    if (!context.sourceFingerprint)
      return denied("SOURCE_FINGERPRINT_REQUIRED");
    if (context.existingManualEntry)
      return denied("MANUAL_DUPLICATE_FORBIDDEN");
    return acceptedForReview(policy);
  }
  if (context.actorKind !== "SYSTEM")
    return denied("DERIVED_MANUAL_ENTRY_FORBIDDEN");
  if (!context.sourceFingerprint)
    return denied("DERIVATION_FINGERPRINT_REQUIRED");
  if (context.existingManualEntry) return denied("MANUAL_DUPLICATE_FORBIDDEN");
  return acceptedForReview(policy);
}

function denied(reason: string): KpiActualCaptureDecision {
  return { allowed: false, lifecycleStatus: "DRAFT", reason };
}

function acceptedForReview(
  policy: KpiMetricActualPolicy,
): KpiActualCaptureDecision {
  return {
    allowed: true,
    lifecycleStatus: policy.reviewMode === "NONE" ? "ACCEPTED" : "UNDER_REVIEW",
    reason: null,
  };
}

export interface KpiActualAggregationInput {
  readonly id: string;
  readonly acceptedVersion: number;
  readonly scope: "GROUP" | "MEMBER";
  readonly value: string | number | null;
  readonly weight?: string | number | null;
}

export interface KpiActualAggregationResult {
  readonly method: KpiActualAggregationMethod;
  readonly memberValue: string | null;
  readonly groupValue: string | null;
  readonly combinedValue: string | null;
  readonly includedInputVersions: readonly string[];
  readonly nullInputCount: number;
  readonly denominator: string | null;
}

export function aggregateAcceptedActuals(
  method: KpiActualAggregationMethod,
  inputs: readonly KpiActualAggregationInput[],
): KpiActualAggregationResult {
  const unique = new Map<string, KpiActualAggregationInput>();
  for (const input of inputs) {
    const key = `${input.id}@${input.acceptedVersion}`;
    if (unique.has(key)) throw new Error(`DUPLICATE_ACCEPTED_INPUT:${key}`);
    unique.set(key, input);
  }
  const values = [...unique.values()];
  const member = aggregateOneScope(
    method,
    values.filter((item) => item.scope === "MEMBER"),
  );
  const group = aggregateOneScope(
    method,
    values.filter((item) => item.scope === "GROUP"),
  );
  const hasBothScopes = member.value !== null && group.value !== null;
  return {
    method,
    memberValue: member.value,
    groupValue: group.value,
    // GROUP and MEMBER are intentionally separate in HYBRID. Adding them here
    // would turn a display aggregate into double-counted performance.
    combinedValue: hasBothScopes ? null : (member.value ?? group.value),
    includedInputVersions: values.map(
      (item) => `${item.id}@${item.acceptedVersion}`,
    ),
    nullInputCount: values.filter((item) => item.value === null).length,
    denominator: member.denominator ?? group.denominator,
  };
}

function aggregateOneScope(
  method: KpiActualAggregationMethod,
  inputs: readonly KpiActualAggregationInput[],
): { readonly value: string | null; readonly denominator: string | null } {
  if (method === "NONE" || method === "MANUAL")
    return { value: null, denominator: null };
  const present = inputs.filter(
    (item): item is KpiActualAggregationInput & { value: string | number } =>
      item.value !== null,
  );
  if (present.length === 0) return { value: null, denominator: null };
  const scaled = present.map((item) => {
    const value = toScaled(item.value);
    if (value < 0n) throw new Error(`NEGATIVE_ACTUAL:${item.id}`);
    return { item, value };
  });
  if (method === "SUM") {
    return {
      value: fromScaled(scaled.reduce((sum, item) => sum + item.value, 0n)),
      denominator: null,
    };
  }
  if (method === "MAX") {
    return {
      value: fromScaled(
        scaled.reduce(
          (max, item) => (item.value > max ? item.value : max),
          scaled[0]!.value,
        ),
      ),
      denominator: null,
    };
  }
  if (method === "AVERAGE") {
    const denominator = BigInt(present.length) * DECIMAL_SCALE;
    const numerator =
      scaled.reduce((sum, item) => sum + item.value, 0n) * DECIMAL_SCALE;
    return {
      value: fromScaled(divideRounded(numerator, denominator)),
      denominator: String(present.length),
    };
  }
  let weightedTotal = 0n;
  let totalWeight = 0n;
  for (const { item, value } of scaled) {
    if (item.weight === null || item.weight === undefined) {
      throw new Error(`WEIGHT_REQUIRED:${item.id}`);
    }
    const weight = toScaled(item.weight);
    if (weight < 0n) throw new Error(`NEGATIVE_WEIGHT:${item.id}`);
    weightedTotal += value * weight;
    totalWeight += weight;
  }
  if (totalWeight === 0n) throw new Error("WEIGHT_DENOMINATOR_ZERO");
  return {
    value: fromScaled(divideRounded(weightedTotal, totalWeight)),
    denominator: fromScaled(totalWeight),
  };
}

export interface KpiActualCorrectionLineage {
  readonly previousEntryId: string;
  readonly previousAcceptedVersion: number;
  readonly replacementEntryId: string;
  readonly replacementVersion: number;
  readonly previousLifecycleStatus: "LOCKED" | "CORRECTED";
  readonly replacementLifecycleStatus: "CORRECTED" | "UNDER_REVIEW";
}

export function createActualCorrectionLineage(input: {
  readonly entryId: string;
  readonly acceptedVersion: number;
  readonly correctionId: string;
  readonly requiresReview: boolean;
}): KpiActualCorrectionLineage {
  return {
    previousEntryId: input.entryId,
    previousAcceptedVersion: input.acceptedVersion,
    replacementEntryId: input.correctionId,
    replacementVersion: input.acceptedVersion + 1,
    previousLifecycleStatus: "CORRECTED",
    replacementLifecycleStatus: input.requiresReview
      ? "UNDER_REVIEW"
      : "CORRECTED",
  };
}

export function actualSourceFingerprint(input: {
  readonly owner: string;
  readonly sourceRecordId: string;
  readonly sourceVersion: string;
  readonly value: string | number;
}): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

export type KpiActualViewer = "ADMIN_OPS" | "MANAGER" | "MEMBER";
export interface KpiActualPrivacyDecision {
  readonly canSeePersonalDetail: boolean;
  readonly canSeeEvidence: boolean;
  readonly canSeeGroupAggregate: boolean;
  readonly canSeePeerDetail: boolean;
  readonly canSeeRanking: boolean;
}

export function resolveActualPrivacy(input: {
  readonly viewer: KpiActualViewer;
  readonly exactAuthority: boolean;
  readonly isOwnMemberRecord: boolean;
  readonly isPublishedTarget: boolean;
  readonly isAcceptedActual: boolean;
  readonly isApprovedGroupAggregate: boolean;
}): KpiActualPrivacyDecision {
  if (input.viewer === "ADMIN_OPS") {
    return {
      canSeePersonalDetail: true,
      canSeeEvidence: true,
      canSeeGroupAggregate: true,
      canSeePeerDetail: true,
      canSeeRanking: false,
    };
  }
  if (input.viewer === "MANAGER") {
    return {
      canSeePersonalDetail: input.exactAuthority,
      canSeeEvidence: input.exactAuthority,
      canSeeGroupAggregate: input.exactAuthority,
      canSeePeerDetail: input.exactAuthority,
      canSeeRanking: false,
    };
  }
  return {
    canSeePersonalDetail:
      input.isOwnMemberRecord &&
      input.isPublishedTarget &&
      input.isAcceptedActual,
    canSeeEvidence: false,
    canSeeGroupAggregate: input.isApprovedGroupAggregate,
    canSeePeerDetail: false,
    canSeeRanking: false,
  };
}

function toScaled(value: string | number): bigint {
  const text = String(value);
  if (!/^-?\d+(?:\.\d{1,6})?$/.test(text))
    throw new Error(`INVALID_DECIMAL:${text}`);
  const negative = text.startsWith("-");
  const unsigned = negative ? text.slice(1) : text;
  const [whole, fraction = ""] = unsigned.split(".");
  const scaled =
    BigInt(whole!) * DECIMAL_SCALE + BigInt(fraction.padEnd(6, "0"));
  return negative ? -scaled : scaled;
}

function fromScaled(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / DECIMAL_SCALE;
  const fraction = String(absolute % DECIMAL_SCALE)
    .padStart(6, "0")
    .replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

function divideRounded(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return remainder * 2n >= denominator ? quotient + 1n : quotient;
}

function localDateTimeToUtcMs(
  dateText: string,
  timeText: string,
  dayOffset: number,
): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText);
  if (!match) throw new Error(`INVALID_LOCAL_DATE:${dateText}`);
  const [hour, minute] = timeText.split(":").map(Number);
  return Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]) + dayOffset,
    hour! - HCM_UTC_OFFSET_HOURS,
    minute,
  );
}

function followingMonthLockAt(
  periodMonth: string,
  day: number,
  timeText: string,
): number {
  const match = /^(\d{4})-(\d{2})$/.exec(periodMonth);
  if (!match) throw new Error(`INVALID_PERIOD_MONTH:${periodMonth}`);
  const [hour, minute] = timeText.split(":").map(Number);
  return Date.UTC(
    Number(match[1]),
    Number(match[2]),
    day,
    hour! - HCM_UTC_OFFSET_HOURS,
    minute,
  );
}
