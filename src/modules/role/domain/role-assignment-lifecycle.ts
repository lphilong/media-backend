export interface RoleAssignmentLifecycle {
  readonly state:
    "ACTIVE" | "SCHEDULED" | "SUSPENDED" | "SUPERSEDED" | "REVOKED" | string;
  readonly effectiveAt?: number | null;
  readonly expiresAt?: number | null;
  readonly reviewAt?: number | null;
  readonly lifecycle?: {
    readonly riskTier: "HIGH" | "LOW" | string;
    readonly reviewDeadline: number;
    readonly graceExceptionExpiresAt?: number | null;
    readonly successorAssignmentId?: string | null;
    readonly successorEffectiveAt?: number | null;
  } | null;
}

export const ACCESS_REVIEW_DEFAULT_GRACE_MS = 72 * 60 * 60 * 1000;
export const ACCESS_REVIEW_MAXIMUM_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
export const ACCESS_LIFECYCLE_COMMAND_POLICY_VERSION =
  "access-lifecycle-command-policy/v2";

export type AccessRiskTier = "HIGH" | "LOW";

export interface CurrentRoleAssignmentPolicy {
  readonly riskTier: AccessRiskTier | string;
  /** The deadline obtained by applying the current Role policy to effectiveAt. */
  readonly reviewDeadline?: number | null;
}

export type RoleAssignmentIneffectiveReason =
  | "INVALID_STATE"
  | "NOT_YET_EFFECTIVE"
  | "MALFORMED_SUCCESSOR"
  | "SUPERSEDED_AT_CUTOVER"
  | "EXPIRED"
  | "REVIEW_DEADLINE_UNRESOLVABLE"
  | "REVIEW_OVERDUE"
  | "GRACE_EXPIRED";

export type RoleAssignmentSuccessorPairClassification =
  | { readonly kind: "NO_SUCCESSOR" }
  | {
      readonly kind: "VALID_SUCCESSOR";
      readonly successorAssignmentId: string;
      readonly successorEffectiveAt: number;
    }
  | { readonly kind: "MALFORMED_SUCCESSOR" };

export interface RoleAssignmentEffectiveness {
  readonly effective: boolean;
  readonly reason?: RoleAssignmentIneffectiveReason;
  readonly nextTransitionAt?: number;
  readonly riskTier?: AccessRiskTier;
  readonly authorityEndsAt?: number;
}

export function isRoleAssignmentCurrentlyEffective(
  assignment: RoleAssignmentLifecycle,
  now: number = Date.now(),
  currentPolicy?: AccessRiskTier | string | CurrentRoleAssignmentPolicy,
): boolean {
  return evaluateRoleAssignmentEffectiveness(assignment, now, currentPolicy)
    .effective;
}

export function evaluateRoleAssignmentEffectiveness(
  assignment: RoleAssignmentLifecycle,
  now: number = Date.now(),
  currentPolicy?: AccessRiskTier | string | CurrentRoleAssignmentPolicy,
): RoleAssignmentEffectiveness {
  if (assignment.state !== "ACTIVE" && assignment.state !== "SCHEDULED") {
    return { effective: false, reason: "INVALID_STATE" };
  }

  const successor = classifyRoleAssignmentSuccessorPair(assignment);
  if (successor.kind === "MALFORMED_SUCCESSOR") {
    return { effective: false, reason: "MALFORMED_SUCCESSOR" };
  }
  if (
    successor.kind === "VALID_SUCCESSOR" &&
    successor.successorEffectiveAt <= now
  ) {
    return {
      effective: false,
      reason: "SUPERSEDED_AT_CUTOVER",
      authorityEndsAt: successor.successorEffectiveAt,
    };
  }

  if (
    assignment.effectiveAt !== undefined &&
    assignment.effectiveAt !== null &&
    !isFiniteTimestamp(assignment.effectiveAt)
  ) {
    const unresolvedReview = resolveReviewAuthorityEnd(
      assignment,
      currentPolicy,
    );
    if (unresolvedReview?.reason === "REVIEW_DEADLINE_UNRESOLVABLE") {
      return {
        effective: false,
        reason: unresolvedReview.reason,
        riskTier: unresolvedReview.riskTier,
        authorityEndsAt: unresolvedReview.authorityEndsAt,
      };
    }
  }

  if (
    assignment.effectiveAt !== undefined &&
    assignment.effectiveAt !== null &&
    (!isFiniteTimestamp(assignment.effectiveAt) || assignment.effectiveAt > now)
  ) {
    return {
      effective: false,
      reason: "NOT_YET_EFFECTIVE",
      ...(isFiniteTimestamp(assignment.effectiveAt)
        ? { nextTransitionAt: assignment.effectiveAt }
        : {}),
    };
  }

  if (
    assignment.expiresAt !== undefined &&
    assignment.expiresAt !== null &&
    (!isFiniteTimestamp(assignment.expiresAt) || assignment.expiresAt <= now)
  ) {
    return { effective: false, reason: "EXPIRED" };
  }

  const review = resolveReviewAuthorityEnd(assignment, currentPolicy);
  if (review && review.authorityEndsAt <= now) {
    return {
      effective: false,
      reason:
        review.reason ??
        (review.riskTier === "HIGH" ? "REVIEW_OVERDUE" : "GRACE_EXPIRED"),
      riskTier: review.riskTier,
      authorityEndsAt: review.authorityEndsAt,
    };
  }

  const transitions = [
    assignment.expiresAt,
    review?.authorityEndsAt,
    assignment.effectiveAt,
    successor.kind === "VALID_SUCCESSOR"
      ? successor.successorEffectiveAt
      : null,
  ].filter((value): value is number => isFiniteTimestamp(value) && value > now);

  return {
    effective: true,
    ...(review
      ? { riskTier: review.riskTier, authorityEndsAt: review.authorityEndsAt }
      : {}),
    ...(transitions.length > 0
      ? { nextTransitionAt: Math.min(...transitions) }
      : {}),
  };
}

export function resolveReviewAuthorityEnd(
  assignment: RoleAssignmentLifecycle,
  currentPolicy?: AccessRiskTier | string | CurrentRoleAssignmentPolicy,
): {
  readonly riskTier: AccessRiskTier;
  readonly authorityEndsAt: number;
  readonly reason?: "REVIEW_DEADLINE_UNRESOLVABLE";
} | null {
  const durableReviewDeadline =
    assignment.lifecycle?.reviewDeadline ?? assignment.reviewAt;
  const currentReviewDeadline =
    typeof currentPolicy === "object" && currentPolicy !== null
      ? currentPolicy.reviewDeadline
      : null;
  const durableRiskValue = assignment.lifecycle?.riskTier;
  const durableRisk =
    durableRiskValue === undefined || durableRiskValue === null
      ? undefined
      : normalizeRiskTier(durableRiskValue);
  const currentRiskValue =
    typeof currentPolicy === "object" && currentPolicy !== null
      ? currentPolicy.riskTier
      : currentPolicy;
  const currentRisk =
    currentRiskValue === undefined
      ? durableRisk
      : normalizeRiskTier(currentRiskValue);
  const riskTier =
    durableRisk === "HIGH" || currentRisk === "HIGH" ? "HIGH" : "LOW";
  const reviewDeadline = earliestFiniteTimestamp(
    durableReviewDeadline,
    currentReviewDeadline,
  );
  if (reviewDeadline === undefined || reviewDeadline === null) {
    return riskTier === "HIGH"
      ? {
          riskTier,
          authorityEndsAt: 0,
          reason: "REVIEW_DEADLINE_UNRESOLVABLE",
        }
      : null;
  }
  if (!isFiniteTimestamp(reviewDeadline)) {
    return { riskTier: "HIGH", authorityEndsAt: 0 };
  }
  if (riskTier === "HIGH") {
    return { riskTier, authorityEndsAt: reviewDeadline };
  }

  const maximumEnd = reviewDeadline + ACCESS_REVIEW_MAXIMUM_GRACE_MS;
  const defaultEnd = reviewDeadline + ACCESS_REVIEW_DEFAULT_GRACE_MS;
  const exceptionEnd = assignment.lifecycle?.graceExceptionExpiresAt;
  const authorityEndsAt =
    isFiniteTimestamp(exceptionEnd) && exceptionEnd > reviewDeadline
      ? Math.min(exceptionEnd, maximumEnd)
      : defaultEnd;
  return { riskTier, authorityEndsAt };
}

export function classifyRoleAssignmentSuccessorPair(
  assignment: Pick<RoleAssignmentLifecycle, "lifecycle">,
): RoleAssignmentSuccessorPairClassification {
  const successorAssignmentId = assignment.lifecycle?.successorAssignmentId;
  const successorEffectiveAt = assignment.lifecycle?.successorEffectiveAt;
  const idAbsent =
    successorAssignmentId === undefined || successorAssignmentId === null;
  const cutoverAbsent =
    successorEffectiveAt === undefined || successorEffectiveAt === null;
  if (idAbsent && cutoverAbsent) return { kind: "NO_SUCCESSOR" };
  if (
    typeof successorAssignmentId === "string" &&
    successorAssignmentId.trim().length > 0 &&
    isFiniteTimestamp(successorEffectiveAt)
  ) {
    return {
      kind: "VALID_SUCCESSOR",
      successorAssignmentId,
      successorEffectiveAt,
    };
  }
  return { kind: "MALFORMED_SUCCESSOR" };
}

function earliestFiniteTimestamp(
  durable: unknown,
  current: unknown,
): number | null | undefined {
  if (
    durable !== undefined &&
    durable !== null &&
    !isFiniteTimestamp(durable)
  ) {
    return durable as number;
  }
  if (
    current !== undefined &&
    current !== null &&
    !isFiniteTimestamp(current)
  ) {
    return current as number;
  }
  const values = [durable, current].filter(isFiniteTimestamp);
  if (values.length > 0) return Math.min(...values);
  return durable === null || current === null ? null : undefined;
}

function normalizeRiskTier(value: unknown): AccessRiskTier {
  return value === "LOW" ? "LOW" : "HIGH";
}

function isFiniteTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
