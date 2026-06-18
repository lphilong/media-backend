export interface RoleAssignmentLifecycle {
  readonly state: "ACTIVE" | "REVOKED";
  readonly effectiveAt?: number | null;
  readonly expiresAt?: number | null;
}

export function isRoleAssignmentCurrentlyEffective(
  assignment: RoleAssignmentLifecycle,
  now: number = Date.now(),
): boolean {
  return (
    assignment.state === "ACTIVE" &&
    (assignment.effectiveAt === undefined ||
      assignment.effectiveAt === null ||
      assignment.effectiveAt <= now) &&
    (assignment.expiresAt === undefined ||
      assignment.expiresAt === null ||
      assignment.expiresAt > now)
  );
}
