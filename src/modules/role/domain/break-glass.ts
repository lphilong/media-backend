import { RoleAssignmentScopeGrant } from "./role-assignment-scope";
import {
  FrozenGovernanceReviewDeadline,
  GovernanceBusinessCalendar,
  failClosedGovernanceReviewDeadline,
} from "./governance-business-calendar";

export const BREAK_GLASS_DEFAULT_DURATION_MS = 60 * 60 * 1000;
export const BREAK_GLASS_MAXIMUM_DURATION_MS = 4 * 60 * 60 * 1000;

export type BreakGlassUrgency = "URGENT" | "NON_URGENT";
export type BreakGlassStepUpState =
  "SATISFIED" | "NOT_SATISFIED" | "NOT_SUPPORTED";
export type BreakGlassRequestStatus =
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "REJECTED"
  | "ACTIVATED"
  | "EXPIRED"
  | "REVIEWED";

export interface BreakGlassApproval {
  readonly approverUserId: string;
  readonly decision: "APPROVED" | "REJECTED";
  readonly reason: string;
  readonly decidedAt: number;
}

export interface BreakGlassRequestRecord {
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly payloadFingerprint: string;
  readonly targetUserId: string;
  readonly permissions: readonly string[];
  readonly structuredScopeGrants: readonly RoleAssignmentScopeGrant[];
  readonly scopeFingerprint: string;
  readonly urgency: BreakGlassUrgency;
  readonly incidentReferenceId: string;
  readonly reason: string;
  readonly requesterUserId: string;
  readonly requestedAt: number;
  readonly requestedDurationMs: number;
  readonly approvals: readonly BreakGlassApproval[];
  readonly status: BreakGlassRequestStatus;
}

export interface BreakGlassActivationRecord {
  readonly activationId: string;
  readonly requestId: string;
  readonly targetUserId: string;
  readonly permissions: readonly string[];
  readonly structuredScopeGrants: readonly RoleAssignmentScopeGrant[];
  readonly scopeFingerprint: string;
  readonly incidentReferenceId: string;
  readonly reason: string;
  readonly activatorUserId: string;
  readonly activatedAt: number;
  readonly expiresAt: number;
  readonly endedAt?: number | null;
  readonly endedByUserId?: string | null;
  readonly endReason?: string | null;
  readonly status: "ACTIVE" | "EXPIRED" | "REVIEWED";
  readonly stepUpState: BreakGlassStepUpState;
  readonly independentReviewDeadline: FrozenGovernanceReviewDeadline;
  readonly reviewerUserId: string | null;
  readonly reviewResult: "APPROVED_USE" | "MISUSE_FOUND" | null;
  readonly reviewedAt: number | null;
  readonly auditCorrelationId: string;
}

export function validateBreakGlassRequest(
  request: BreakGlassRequestRecord,
): readonly string[] {
  const blockers: string[] = [];
  if (!request.idempotencyKey.trim()) blockers.push("IDEMPOTENCY_KEY_REQUIRED");
  if (!request.payloadFingerprint.trim())
    blockers.push("PAYLOAD_FINGERPRINT_REQUIRED");
  if (request.permissions.length === 0)
    blockers.push("EXACT_PERMISSION_REQUIRED");
  if (request.structuredScopeGrants.length === 0)
    blockers.push("EXACT_SCOPE_REQUIRED");
  if (!request.scopeFingerprint.trim())
    blockers.push("SCOPE_FINGERPRINT_REQUIRED");
  if (!request.incidentReferenceId.trim())
    blockers.push("INCIDENT_REFERENCE_REQUIRED");
  if (!request.reason.trim()) blockers.push("REASON_REQUIRED");
  if (
    request.requestedDurationMs <= 0 ||
    request.requestedDurationMs > BREAK_GLASS_MAXIMUM_DURATION_MS
  ) {
    blockers.push("DURATION_EXCEEDS_FOUR_HOUR_MAXIMUM");
  }
  if (new Set(request.permissions).size !== request.permissions.length) {
    blockers.push("DUPLICATE_PERMISSION");
  }
  return blockers;
}

export function evaluateBreakGlassActivation(input: {
  readonly request: BreakGlassRequestRecord;
  readonly activatorUserId: string;
  readonly activePrimaryOwnerUserId: string | null;
  readonly primaryOwnerEligible: boolean;
  readonly stepUpSupported: boolean;
  readonly stepUpState: BreakGlassStepUpState;
}): readonly string[] {
  const blockers = [...validateBreakGlassRequest(input.request)];
  const approved = input.request.approvals.filter(
    (item) => item.decision === "APPROVED",
  );
  const approverIds = approved.map((item) => item.approverUserId);

  if (input.request.urgency === "URGENT") {
    if (
      !input.primaryOwnerEligible ||
      input.activatorUserId !== input.activePrimaryOwnerUserId
    ) {
      blockers.push("URGENT_ACTIVATION_PRIMARY_OWNER_ONLY");
    }
  } else {
    if (approved.length < 2) blockers.push("TWO_APPROVALS_REQUIRED");
    if (approverIds.includes(input.request.requesterUserId)) {
      blockers.push("REQUESTER_CANNOT_APPROVE");
    }
    if (approverIds.includes(input.request.targetUserId)) {
      blockers.push("TARGET_CANNOT_APPROVE");
    }
    if (new Set(approverIds).size !== approverIds.length) {
      blockers.push("APPROVERS_MUST_BE_DISTINCT");
    }
  }
  if (input.stepUpSupported && input.stepUpState !== "SATISFIED") {
    blockers.push("STEP_UP_REQUIRED");
  }
  if (!input.stepUpSupported && input.stepUpState !== "NOT_SUPPORTED") {
    blockers.push("STEP_UP_NOT_SUPPORTED_MUST_BE_RECORDED");
  }
  return [...new Set(blockers)];
}

export function buildBreakGlassActivation(input: {
  readonly activationId: string;
  readonly request: BreakGlassRequestRecord;
  readonly activatorUserId: string;
  readonly activatedAt: number;
  readonly durationMs?: number;
  readonly stepUpState: BreakGlassStepUpState;
  readonly calendar: GovernanceBusinessCalendar;
  readonly auditCorrelationId: string;
}): BreakGlassActivationRecord {
  const durationMs = input.durationMs ?? BREAK_GLASS_DEFAULT_DURATION_MS;
  if (durationMs <= 0 || durationMs > BREAK_GLASS_MAXIMUM_DURATION_MS) {
    throw new Error("DURATION_EXCEEDS_FOUR_HOUR_MAXIMUM");
  }
  const expiresAt = input.activatedAt + durationMs;
  return {
    activationId: input.activationId,
    requestId: input.request.requestId,
    targetUserId: input.request.targetUserId,
    permissions: [...input.request.permissions],
    structuredScopeGrants: [...input.request.structuredScopeGrants],
    scopeFingerprint: input.request.scopeFingerprint,
    incidentReferenceId: input.request.incidentReferenceId,
    reason: input.request.reason,
    activatorUserId: input.activatorUserId,
    activatedAt: input.activatedAt,
    expiresAt,
    endedAt: null,
    endedByUserId: null,
    endReason: null,
    status: "ACTIVE",
    stepUpState: input.stepUpState,
    independentReviewDeadline: failClosedGovernanceReviewDeadline(
      expiresAt,
      input.calendar,
    ),
    reviewerUserId: null,
    reviewResult: null,
    reviewedAt: null,
    auditCorrelationId: input.auditCorrelationId,
  };
}

export function isBreakGlassActivationEffective(
  activation: BreakGlassActivationRecord,
  now: number,
): boolean {
  return (
    activation.status === "ACTIVE" &&
    Number.isFinite(activation.activatedAt) &&
    activation.activatedAt <= now &&
    Number.isFinite(activation.expiresAt) &&
    activation.expiresAt > now &&
    (activation.endedAt === undefined ||
      activation.endedAt === null ||
      activation.endedAt > now) &&
    (activation.stepUpState === "SATISFIED" ||
      activation.stepUpState === "NOT_SUPPORTED")
  );
}

export function validateIndependentBreakGlassReview(input: {
  readonly activation: BreakGlassActivationRecord;
  readonly reviewerUserId: string;
}): readonly string[] {
  const blockers: string[] = [];
  if (input.activation.status !== "EXPIRED") {
    blockers.push("POST_USE_REVIEW_REQUIRES_EXPIRED_ACTIVATION");
  }
  if (input.reviewerUserId === input.activation.activatorUserId) {
    blockers.push("ACTIVATOR_CANNOT_REVIEW");
  }
  if (input.reviewerUserId === input.activation.targetUserId) {
    blockers.push("TARGET_CANNOT_REVIEW");
  }
  if (input.activation.reviewerUserId !== null)
    blockers.push("ALREADY_REVIEWED");
  return blockers;
}

export function canRenewBreakGlassActivation(
  _activation: BreakGlassActivationRecord,
): false {
  return false;
}
