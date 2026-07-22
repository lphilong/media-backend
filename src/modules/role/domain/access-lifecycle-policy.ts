import {
  AccessRiskTier,
  ACCESS_REVIEW_DEFAULT_GRACE_MS,
  ACCESS_REVIEW_MAXIMUM_GRACE_MS,
} from "./role-assignment-lifecycle";

export const ACCESS_LIFECYCLE_ACTIONS = [
  "REVIEW",
  "GRACE_EXCEPTION",
  "RENEWAL",
  "REPLACEMENT",
  "RESTORATION",
] as const;

export type AccessLifecycleAction = (typeof ACCESS_LIFECYCLE_ACTIONS)[number];
export type AccessLifecycleDecisionState =
  "PENDING" | "APPROVED" | "REJECTED" | "APPLIED" | "STALE";

export interface AccessRiskSnapshot {
  readonly tier: AccessRiskTier;
  readonly reasons: readonly string[];
  readonly assessedAt: number;
  readonly permissionFingerprint: string;
  readonly scopeFingerprint: string;
}

export interface AccessLifecycleApproval {
  readonly approverUserId: string;
  readonly decidedAt: number;
  readonly decision: "APPROVED" | "REJECTED";
  readonly reason: string;
}

export interface AssignmentReviewCycleRecord {
  readonly cycleId: string;
  readonly assignmentId: string;
  readonly targetUserId: string;
  readonly requestedBy: string;
  readonly requestedAt: number;
  readonly riskSnapshot: AccessRiskSnapshot;
  readonly reviewDeadline: number;
  readonly state: AccessLifecycleDecisionState;
  readonly approvals: readonly AccessLifecycleApproval[];
  readonly decidedAt: number | null;
  readonly nextReviewDeadline: number | null;
  readonly reason: string;
  readonly createdAt: number;
}

export interface GraceExceptionRecord {
  readonly exceptionId: string;
  readonly cycleId: string;
  readonly targetUserId: string;
  readonly requestedBy: string;
  readonly requestedAt: number;
  readonly requestedExpiresAt: number;
  readonly approvedBy: string | null;
  readonly approvedAt: number | null;
  readonly approvedExpiresAt: number | null;
  readonly state: "PENDING" | "APPROVED" | "REJECTED";
  readonly reason: string;
}

export interface AssignmentLifecycleLineageRecord {
  readonly lineageId: string;
  readonly action: "RENEWAL" | "REPLACEMENT" | "RESTORATION";
  readonly predecessorAssignmentId: string;
  readonly successorAssignmentId: string;
  readonly targetUserId: string;
  readonly requestedBy: string;
  readonly approvals: readonly AccessLifecycleApproval[];
  readonly reason: string;
  readonly idempotencyKey: string;
  readonly appliedAt: number;
}

export interface SuspensionEvidenceRecord {
  readonly suspensionId: string;
  readonly assignmentId: string;
  readonly cause:
    | "EXPIRED"
    | "MALFORMED_SUCCESSOR"
    | "REVIEW_DEADLINE_UNRESOLVABLE"
    | "REVIEW_OVERDUE"
    | "GRACE_EXPIRED"
    | "OWNER_ADMIN_REVIEW_OVERDUE";
  readonly authorityDeadline: number;
  readonly materializedAt: number;
  readonly restoringLineageId: string | null;
}

export interface LifecycleApprovalEvaluation {
  readonly allowed: boolean;
  readonly blockers: readonly string[];
  readonly requiredApprovalCount: 1 | 2;
}

export function evaluateLifecycleApprovals(input: {
  readonly riskTier: AccessRiskTier | string;
  readonly targetUserId: string;
  readonly requesterUserId: string;
  readonly approvals: readonly AccessLifecycleApproval[];
}): LifecycleApprovalEvaluation {
  const riskTier: AccessRiskTier = input.riskTier === "LOW" ? "LOW" : "HIGH";
  const requiredApprovalCount = riskTier === "HIGH" ? 2 : 1;
  const blockers: string[] = [];
  const approved = input.approvals.filter(
    (item) => item.decision === "APPROVED",
  );
  const approverIds = approved.map((item) => item.approverUserId);

  if (approverIds.some((id) => id === input.targetUserId)) {
    blockers.push("TARGET_CANNOT_APPROVE");
  }
  if (approverIds.some((id) => id === input.requesterUserId)) {
    blockers.push("REQUESTER_CANNOT_APPROVE");
  }
  if (new Set(approverIds).size !== approverIds.length) {
    blockers.push("APPROVERS_MUST_BE_DISTINCT");
  }
  if (approved.length < requiredApprovalCount) {
    blockers.push("INSUFFICIENT_APPROVALS");
  }
  if (input.approvals.some((item) => !normalizeReason(item.reason))) {
    blockers.push("APPROVAL_REASON_REQUIRED");
  }

  return {
    allowed: blockers.length === 0,
    blockers,
    requiredApprovalCount,
  };
}

export function validateGraceException(input: {
  readonly reviewDeadline: number;
  readonly requestedExpiresAt: number;
  readonly requestedBy: string;
  readonly targetUserId: string;
  readonly approvedBy?: string | null;
  readonly reason: string;
}): readonly string[] {
  const blockers: string[] = [];
  if (!normalizeReason(input.reason)) blockers.push("REASON_REQUIRED");
  if (
    input.requestedExpiresAt <=
    input.reviewDeadline + ACCESS_REVIEW_DEFAULT_GRACE_MS
  ) {
    blockers.push("GRACE_EXCEPTION_MUST_EXTEND_AUTOMATIC_GRACE");
  }
  if (
    input.requestedExpiresAt >
    input.reviewDeadline + ACCESS_REVIEW_MAXIMUM_GRACE_MS
  ) {
    blockers.push("GRACE_EXCEEDS_MAXIMUM_ABSOLUTE_END");
  }
  if (input.approvedBy === input.targetUserId)
    blockers.push("TARGET_CANNOT_APPROVE");
  if (input.approvedBy === input.requestedBy) {
    blockers.push("REQUESTER_CANNOT_APPROVE");
  }
  return blockers;
}

export function validateImmutableLineage(
  record: AssignmentLifecycleLineageRecord,
): readonly string[] {
  const blockers: string[] = [];
  if (record.predecessorAssignmentId === record.successorAssignmentId) {
    blockers.push("SUCCESSOR_MUST_BE_NEW_AUTHORITY");
  }
  if (!normalizeReason(record.reason)) blockers.push("REASON_REQUIRED");
  if (!normalizeReason(record.idempotencyKey))
    blockers.push("IDEMPOTENCY_KEY_REQUIRED");
  return blockers;
}

function normalizeReason(value: string): string {
  return value.trim();
}
