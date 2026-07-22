import {
  CurrentRoleAssignmentPolicy,
  RoleAssignmentEffectiveness,
  RoleAssignmentLifecycle,
  classifyRoleAssignmentSuccessorPair,
  evaluateRoleAssignmentEffectiveness,
} from "./role-assignment-lifecycle";

export type RoleAssignmentOperationalState =
  | "FUTURE_SCHEDULED"
  | "OPERATIONALLY_ACTIVE"
  | "OPERATIONALLY_SUSPENDED"
  | "OPERATIONALLY_SUPERSEDED"
  | "OPERATIONALLY_EXPIRED"
  | "OPERATIONALLY_REVIEW_BLOCKED"
  | "TERMINAL_REVOKED"
  | "TERMINAL_SUPERSEDED"
  | "INVALID";

export interface RoleAssignmentOperationalResolution {
  readonly state: RoleAssignmentOperationalState;
  readonly authorityEffective: boolean;
  readonly manageable: boolean;
  readonly retainsAuthoritySlot: boolean;
  readonly effectiveness: RoleAssignmentEffectiveness;
}

export type RoleAssignmentRestorationIneligibilityReason =
  | "PREDECESSOR_ROLE_NOT_ACTIVE"
  | "SOURCE_ASSIGNMENT_EXPIRED"
  | "SUCCESSOR_ALREADY_SCHEDULED"
  | "RESTORATION_SOURCE_MUST_BE_SUSPENDED";

export interface RoleAssignmentRestorationEligibility {
  readonly eligible: boolean;
  readonly reason: RoleAssignmentRestorationIneligibilityReason | null;
  readonly operational: RoleAssignmentOperationalResolution;
}

/**
 * Canonical operational interpretation of RoleAssignment persistence.
 * Persisted state alone is intentionally insufficient around an OD-P2-07 cutover.
 */
export function resolveRoleAssignmentOperationalState(
  assignment: RoleAssignmentLifecycle,
  now: number = Date.now(),
  currentPolicy?: string | CurrentRoleAssignmentPolicy,
): RoleAssignmentOperationalResolution {
  const effectiveness = evaluateRoleAssignmentEffectiveness(
    assignment,
    now,
    currentPolicy,
  );

  if (assignment.state === "REVOKED") {
    return resolution("TERMINAL_REVOKED", false, false, false, effectiveness);
  }
  if (assignment.state === "SUPERSEDED") {
    return resolution(
      "TERMINAL_SUPERSEDED",
      false,
      false,
      false,
      effectiveness,
    );
  }
  if (
    assignment.expiresAt !== undefined &&
    assignment.expiresAt !== null &&
    (!isFiniteTimestamp(assignment.expiresAt) || assignment.expiresAt <= now)
  ) {
    return resolution(
      "OPERATIONALLY_EXPIRED",
      false,
      true,
      false,
      effectiveness,
    );
  }
  if (assignment.state === "SUSPENDED") {
    return resolution(
      "OPERATIONALLY_SUSPENDED",
      false,
      true,
      true,
      effectiveness,
    );
  }
  if (effectiveness.effective) {
    return resolution("OPERATIONALLY_ACTIVE", true, true, true, effectiveness);
  }
  if (
    effectiveness.reason === "NOT_YET_EFFECTIVE" &&
    assignment.state === "SCHEDULED"
  ) {
    return resolution("FUTURE_SCHEDULED", false, true, true, effectiveness);
  }
  if (effectiveness.reason === "SUPERSEDED_AT_CUTOVER") {
    return resolution(
      "OPERATIONALLY_SUPERSEDED",
      false,
      false,
      false,
      effectiveness,
    );
  }
  if (effectiveness.reason === "EXPIRED") {
    return resolution(
      "OPERATIONALLY_EXPIRED",
      false,
      true,
      false,
      effectiveness,
    );
  }
  if (
    effectiveness.reason === "REVIEW_DEADLINE_UNRESOLVABLE" ||
    effectiveness.reason === "REVIEW_OVERDUE" ||
    effectiveness.reason === "GRACE_EXPIRED"
  ) {
    return resolution(
      "OPERATIONALLY_REVIEW_BLOCKED",
      false,
      true,
      true,
      effectiveness,
    );
  }
  return resolution("INVALID", false, false, false, effectiveness);
}

function isFiniteTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function isRoleAssignmentOperationallyManageable(
  assignment: RoleAssignmentLifecycle,
  now: number = Date.now(),
  currentPolicy?: string | CurrentRoleAssignmentPolicy,
): boolean {
  return resolveRoleAssignmentOperationalState(assignment, now, currentPolicy)
    .manageable;
}

export function evaluateRoleAssignmentRestorationEligibility(input: {
  readonly assignment: RoleAssignmentLifecycle;
  readonly currentRoleState: string | null | undefined;
  readonly now: number;
  readonly currentPolicy?: string | CurrentRoleAssignmentPolicy;
}): RoleAssignmentRestorationEligibility {
  const operational = resolveRoleAssignmentOperationalState(
    input.assignment,
    input.now,
    input.currentPolicy,
  );
  if (input.currentRoleState !== "ACTIVE") {
    return restorationEligibility(
      false,
      "PREDECESSOR_ROLE_NOT_ACTIVE",
      operational,
    );
  }
  if (operational.state === "OPERATIONALLY_EXPIRED") {
    return restorationEligibility(
      false,
      "SOURCE_ASSIGNMENT_EXPIRED",
      operational,
    );
  }
  if (
    classifyRoleAssignmentSuccessorPair(input.assignment).kind !==
    "NO_SUCCESSOR"
  ) {
    return restorationEligibility(
      false,
      "SUCCESSOR_ALREADY_SCHEDULED",
      operational,
    );
  }
  if (operational.state !== "OPERATIONALLY_SUSPENDED") {
    return restorationEligibility(
      false,
      "RESTORATION_SOURCE_MUST_BE_SUSPENDED",
      operational,
    );
  }
  return restorationEligibility(true, null, operational);
}

function restorationEligibility(
  eligible: boolean,
  reason: RoleAssignmentRestorationIneligibilityReason | null,
  operational: RoleAssignmentOperationalResolution,
): RoleAssignmentRestorationEligibility {
  return Object.freeze({ eligible, reason, operational });
}

function resolution(
  state: RoleAssignmentOperationalState,
  authorityEffective: boolean,
  manageable: boolean,
  retainsAuthoritySlot: boolean,
  effectiveness: RoleAssignmentEffectiveness,
): RoleAssignmentOperationalResolution {
  return Object.freeze({
    state,
    authorityEffective,
    manageable,
    retainsAuthoritySlot,
    effectiveness,
  });
}
