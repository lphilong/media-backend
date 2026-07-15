import crypto from "node:crypto";
import { KpiConflictError, KpiInvalidAllocationError } from "./kpi.errors";
import { KpiAllocation, KpiPlan } from "./kpi.types";

export const KPI_PLAN_LIFECYCLE_STATUSES = [
  "DRAFT",
  "RELEASED_FOR_ALLOCATION",
  "ACTIVE",
  "FINALIZED",
  "ARCHIVED",
] as const;
export type KpiPlanLifecycleStatus =
  (typeof KPI_PLAN_LIFECYCLE_STATUSES)[number];

export const KPI_ALLOCATION_LIFECYCLE_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "CHANGES_REQUESTED",
  "APPROVED",
  "PUBLISHED",
  "SUPERSEDED",
  "CORRECTED",
] as const;
export type KpiAllocationLifecycleStatus =
  (typeof KPI_ALLOCATION_LIFECYCLE_STATUSES)[number];

export const KPI_ALLOCATION_MODES = [
  "GROUP_ONLY",
  "MEMBER_ALLOCATED",
  "HYBRID",
] as const;
export type KpiAllocationMode = (typeof KPI_ALLOCATION_MODES)[number];

export interface ExactAllocationMetricInput {
  readonly metricCode: string;
  readonly groupTarget: string;
  readonly memberTargets: readonly string[];
  readonly mode: KpiAllocationMode;
  readonly groupRemainder?: string;
  readonly scale?: number;
}

export interface ExactAllocationMetricResult {
  readonly metricCode: string;
  readonly groupTarget: string;
  readonly memberTotal: string;
  readonly groupRemainder: string;
  readonly delta: string;
}

export interface KpiLifecycleMigrationCandidate {
  readonly recordType: "PLAN" | "ALLOCATION";
  readonly recordId: string;
  readonly currentStatus: string;
  readonly mappedStatus: string;
  readonly automatic: boolean;
  readonly reason: string;
}

export interface KpiLifecycleMigrationDryRun {
  readonly migrationId: "KPI_ALLOCATION_LIFECYCLE_V2";
  readonly dryRun: true;
  readonly candidates: readonly KpiLifecycleMigrationCandidate[];
  readonly requiresManualReview: readonly string[];
  readonly rollbackStrategy: "FORWARD_REPAIR_FROM_AUDIT_LINEAGE";
}

export interface LinkedKpiAllocationVersion {
  readonly previous: KpiAllocation & {
    readonly lifecycleStatus: "SUPERSEDED";
  };
  readonly replacement: KpiAllocation & {
    readonly lifecycleStatus: "CORRECTED";
    readonly correctsAllocationId: string;
  };
}

export function readKpiPlanLifecycleStatus(
  status: string,
): KpiPlanLifecycleStatus {
  if (status === "PUBLISHED") return "ACTIVE";
  if (KPI_PLAN_LIFECYCLE_STATUSES.includes(status as KpiPlanLifecycleStatus)) {
    return status as KpiPlanLifecycleStatus;
  }
  throw new KpiConflictError(
    `Unsupported KPI plan lifecycle status: ${status}`,
  );
}

export function readKpiAllocationLifecycleStatus(
  status: string,
  rejectionReason?: string | null,
): KpiAllocationLifecycleStatus | "LEGACY_REJECTED" | "LEGACY_TERMINAL" {
  if (status === "PENDING_APPROVAL") return "SUBMITTED";
  if (status === "REJECTED") {
    return rejectionReason?.trim() ? "CHANGES_REQUESTED" : "LEGACY_REJECTED";
  }
  if (status === "ACTIVE" || status === "CLOSED" || status === "CANCELLED") {
    return "LEGACY_TERMINAL";
  }
  if (
    KPI_ALLOCATION_LIFECYCLE_STATUSES.includes(
      status as KpiAllocationLifecycleStatus,
    )
  ) {
    return status as KpiAllocationLifecycleStatus;
  }
  throw new KpiConflictError(
    `Unsupported KPI allocation lifecycle status: ${status}`,
  );
}

export function validateExactAllocationMetric(
  input: ExactAllocationMetricInput,
): ExactAllocationMetricResult {
  const scale = input.scale ?? 6;
  if (!Number.isInteger(scale) || scale < 0 || scale > 12) {
    throw new KpiInvalidAllocationError("KPI allocation scale is unsupported");
  }
  const multiplier = 10n ** BigInt(scale);
  const target = parseExactDecimal(
    input.groupTarget,
    "groupTarget",
    scale,
    multiplier,
  );
  const memberTotal = input.memberTargets.reduce(
    (total, value) =>
      total + parseExactDecimal(value, "memberTargets[]", scale, multiplier),
    0n,
  );
  const configuredRemainder = parseExactDecimal(
    input.groupRemainder ?? "0",
    "groupRemainder",
    scale,
    multiplier,
  );
  if (memberTotal > target) {
    throw new KpiInvalidAllocationError(
      `KPI allocation ${input.metricCode} is over-allocated`,
    );
  }
  if (input.mode === "GROUP_ONLY" && memberTotal !== 0n) {
    throw new KpiInvalidAllocationError(
      `GROUP_ONLY metric ${input.metricCode} cannot have member targets`,
    );
  }
  if (
    input.mode === "GROUP_ONLY" &&
    input.groupRemainder !== undefined &&
    configuredRemainder !== target
  ) {
    throw new KpiInvalidAllocationError(
      `GROUP_ONLY metric ${input.metricCode} must retain its exact group target`,
    );
  }
  if (input.mode === "MEMBER_ALLOCATED" && memberTotal !== target) {
    throw new KpiInvalidAllocationError(
      `MEMBER_ALLOCATED metric ${input.metricCode} requires an exact sum`,
    );
  }
  const naturalRemainder = target - memberTotal;
  if (input.mode === "HYBRID" && configuredRemainder !== naturalRemainder) {
    throw new KpiInvalidAllocationError(
      `HYBRID metric ${input.metricCode} must persist its exact group remainder`,
    );
  }
  if (input.mode === "MEMBER_ALLOCATED" && configuredRemainder !== 0n) {
    throw new KpiInvalidAllocationError(
      `Only HYBRID metric ${input.metricCode} may retain a group remainder`,
    );
  }
  const remainder =
    input.mode === "HYBRID"
      ? configuredRemainder
      : input.mode === "GROUP_ONLY"
        ? target
        : naturalRemainder;
  return {
    metricCode: input.metricCode,
    groupTarget: formatExactDecimal(target, multiplier, scale),
    memberTotal: formatExactDecimal(memberTotal, multiplier, scale),
    groupRemainder: formatExactDecimal(remainder, multiplier, scale),
    delta: formatExactDecimal(
      target - memberTotal - remainder,
      multiplier,
      scale,
    ),
  };
}

export function allocationSourceFingerprint(input: {
  readonly planId: string;
  readonly sourcePlanVersion: number;
  readonly allocationVersion: number;
  readonly members: readonly {
    readonly employmentProfileId: string;
    readonly talentId: string | null;
    readonly membershipId: string | null;
  }[];
}): string {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        ...input,
        members: [...input.members].sort((left, right) =>
          left.employmentProfileId.localeCompare(right.employmentProfileId),
        ),
      }),
    )
    .digest("hex");
}

export function assertKpiAllocationVersions(input: {
  readonly plan: Pick<KpiPlan, "updatedAt">;
  readonly allocations: readonly Pick<
    KpiAllocation,
    "allocationVersion" | "updatedAt" | "membershipSnapshotVersion"
  >[];
  readonly expectedPlanVersion: number;
  readonly expectedAllocationVersion: number;
  readonly expectedMembershipSnapshotVersion: string;
}): void {
  if (input.expectedPlanVersion !== input.plan.updatedAt) {
    throw new KpiConflictError("KPI source plan version changed");
  }
  const allocationVersion = Math.max(
    0,
    ...input.allocations.map(
      (item) => item.allocationVersion ?? item.updatedAt,
    ),
  );
  if (input.expectedAllocationVersion !== allocationVersion) {
    throw new KpiConflictError("KPI allocation version changed");
  }
  const currentMembershipSnapshotVersion =
    input.allocations.length === 0
      ? "EMPTY"
      : input.allocations[0]?.membershipSnapshotVersion;
  if (
    currentMembershipSnapshotVersion === null ||
    currentMembershipSnapshotVersion === undefined ||
    currentMembershipSnapshotVersion !==
      input.expectedMembershipSnapshotVersion ||
    input.allocations.some(
      (item) =>
        item.membershipSnapshotVersion !== currentMembershipSnapshotVersion,
    )
  ) {
    throw new KpiConflictError("KPI membership snapshot changed");
  }
}

/**
 * Creates an immutable correction pair in memory. Persistence must insert the
 * replacement and retain the superseded source row in one transaction.
 */
export function createLinkedKpiAllocationCorrection(input: {
  readonly source: KpiAllocation;
  readonly replacementId: string;
  readonly actorId: string;
  readonly now: number;
  readonly reason: string;
  readonly idempotencyKey: string;
}): LinkedKpiAllocationVersion {
  const reason = input.reason.trim();
  if (!reason) {
    throw new KpiInvalidAllocationError(
      "KPI allocation correction requires a reason",
    );
  }
  if (!input.idempotencyKey.trim()) {
    throw new KpiInvalidAllocationError(
      "KPI allocation correction requires an idempotency key",
    );
  }
  if (input.source.lifecycleStatus !== "PUBLISHED") {
    throw new KpiInvalidAllocationError(
      "Only a published KPI allocation may be corrected",
    );
  }
  const nextVersion = (input.source.allocationVersion ?? 0) + 1;
  return {
    previous: {
      ...input.source,
      lifecycleStatus: "SUPERSEDED",
      closedAt: input.now,
      updatedAt: input.now,
      updatedByActorId: input.actorId,
    },
    replacement: {
      ...input.source,
      id: input.replacementId,
      lifecycleStatus: "CORRECTED",
      allocationStatus: "DRAFT",
      allocationVersion: nextVersion,
      correctsAllocationId: input.source.id,
      supersedesAllocationId: input.source.id,
      idempotencyKey: input.idempotencyKey.trim(),
      idempotencyFingerprint: allocationSourceFingerprint({
        planId: input.source.kpiPlanId,
        sourcePlanVersion:
          input.source.sourcePlanVersion ?? input.source.updatedAt,
        allocationVersion: nextVersion,
        members: [
          {
            employmentProfileId:
              input.source.memberEmploymentProfileId ?? "GROUP_ONLY",
            talentId: input.source.memberTalentId,
            membershipId: input.source.membershipId,
          },
        ],
      }),
      correlationId: crypto.randomUUID(),
      note: reason,
      submittedAt: null,
      submittedByActorId: null,
      approvedAt: null,
      approvedByActorId: null,
      approvalNote: null,
      rejectedAt: null,
      rejectedByActorId: null,
      rejectionReason: null,
      publishedAt: null,
      publishedByActorId: null,
      closedAt: null,
      createdAt: input.now,
      createdByActorId: input.actorId,
      updatedAt: input.now,
      updatedByActorId: input.actorId,
    },
  };
}

export function planKpiLifecycleMigrationDryRun(input: {
  readonly plans: readonly Pick<KpiPlan, "id" | "status">[];
  readonly allocations: readonly Pick<
    KpiAllocation,
    "id" | "allocationStatus" | "rejectionReason"
  >[];
}): KpiLifecycleMigrationDryRun {
  const candidates: KpiLifecycleMigrationCandidate[] = [];
  const requiresManualReview: string[] = [];
  for (const plan of input.plans) {
    if (plan.status === "PUBLISHED") {
      candidates.push({
        recordType: "PLAN",
        recordId: plan.id,
        currentStatus: plan.status,
        mappedStatus: "ACTIVE",
        automatic: true,
        reason: "Historical PUBLISHED plan preserves its publication timestamp",
      });
    }
  }
  for (const allocation of input.allocations) {
    const mapped = readKpiAllocationLifecycleStatus(
      allocation.allocationStatus,
      allocation.rejectionReason,
    );
    if (mapped === "LEGACY_REJECTED" || mapped === "LEGACY_TERMINAL") {
      requiresManualReview.push(allocation.id);
      continue;
    }
    if (mapped !== allocation.allocationStatus) {
      candidates.push({
        recordType: "ALLOCATION",
        recordId: allocation.id,
        currentStatus: allocation.allocationStatus,
        mappedStatus: mapped,
        automatic: true,
        reason:
          "Backward-compatible lifecycle mapping with source lineage retained",
      });
    }
  }
  return {
    migrationId: "KPI_ALLOCATION_LIFECYCLE_V2",
    dryRun: true,
    candidates,
    requiresManualReview,
    rollbackStrategy: "FORWARD_REPAIR_FROM_AUDIT_LINEAGE",
  };
}

function parseExactDecimal(
  value: string,
  field: string,
  scale: number,
  multiplier: bigint,
): bigint {
  const normalized = value.trim();
  const pattern =
    scale === 0
      ? /^(?:0|[1-9]\d*)$/u
      : new RegExp(`^(?:0|[1-9]\\d*)(?:\\.\\d{1,${scale}})?$`, "u");
  if (!pattern.test(normalized)) {
    throw new KpiInvalidAllocationError(
      `${field} must be a non-negative canonical decimal with at most ${scale} places`,
    );
  }
  const [whole, fraction = ""] = normalized.split(".");
  return (
    BigInt(whole) * multiplier + BigInt(fraction.padEnd(scale, "0") || "0")
  );
}

function formatExactDecimal(
  value: bigint,
  multiplier: bigint,
  scale: number,
): string {
  const whole = value / multiplier;
  const fraction = (value % multiplier)
    .toString()
    .padStart(scale, "0")
    .replace(/0+$/u, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
