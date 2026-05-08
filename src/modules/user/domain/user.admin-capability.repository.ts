import { ClientSession } from "mongodb";

export type RoleMaxDelegatableBandForCapability =
  | "NONE"
  | "LIMITED"
  | "PRIVILEGED";

export interface UserAdminCapabilityRepository {
  /**
   * Returns ACTIVE user ids grouped by each requested permission code,
   * where permissions are resolved from current runtime role state.
   */
  listActiveUserIdsByPermission(
    permissionCodes: readonly string[],
    session: ClientSession,
  ): Promise<Readonly<Record<string, readonly string[]>>>;

  /**
   * Returns true when at least one ACTIVE role assignment references the user.
   */
  hasActiveRoleAssignments(
    userId: string,
    session: ClientSession,
  ): Promise<boolean>;

  /**
   * Returns delegation ceilings from ACTIVE role assignments resolved against ACTIVE roles.
   */
  listActiveDelegationCeilingsByUserId(
    userId: string,
    session: ClientSession,
  ): Promise<readonly RoleMaxDelegatableBandForCapability[]>;

  /**
   * Returns ACTIVE user ids that retain the full governance recovery capability set.
   */
  listActiveUserIdsWithGovernanceRecoverySurface(
    permissionCodes: readonly string[],
    minimumDelegatableBand: RoleMaxDelegatableBandForCapability,
    session: ClientSession,
  ): Promise<readonly string[]>;
}
