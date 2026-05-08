import {
  RoleAssignmentRuleState,
  RoleAssignmentState,
  RoleDelegationBand,
  RoleMaxDelegatableBand,
  RoleMutationView,
  RoleState,
} from "@modules/role/domain/role.types";
import {
  RoleAssignmentView,
  RoleDetailView,
  RoleListItemView,
  RolePermissionMatrixView,
} from "@modules/role/domain/role.types";

export interface RoleAssignmentRuleInput {
  readonly id?: string;
  readonly code: string;
  readonly description?: string | null;
  readonly state?: RoleAssignmentRuleState;
  readonly conditions?: Record<string, unknown> | null;
}

export interface CreateRoleCommand {
  readonly name: string;
  readonly code: string;
  readonly description?: string | null;
  readonly initialPermissions?: readonly string[];
  readonly initialDelegationBand?: RoleDelegationBand;
  readonly initialMaxDelegatableBand?: RoleMaxDelegatableBand;
  readonly initialAssignmentRules?: readonly RoleAssignmentRuleInput[];
}

export interface UpdateRoleCommand {
  readonly roleId: string;
  readonly name?: string | null;
  readonly description?: string | null;
  readonly delegationBand?: RoleDelegationBand;
  readonly maxDelegatableBand?: RoleMaxDelegatableBand;
}

export interface ActivateRoleCommand {
  readonly roleId: string;
}

export interface DeactivateRoleCommand {
  readonly roleId: string;
  readonly reason?: string | null;
}

export interface ArchiveRoleCommand {
  readonly roleId: string;
  readonly reason?: string | null;
}

export interface SetRolePermissionsCommand {
  readonly roleId: string;
  readonly permissions: readonly string[];
}

export interface SetRoleAssignmentRulesCommand {
  readonly roleId: string;
  readonly rules: readonly RoleAssignmentRuleInput[];
}

export interface AssignRoleToUserCommand {
  readonly roleId: string;
  readonly userId: string;
  readonly reason?: string | null;
  readonly effectiveAt?: number | string | null;
}

export interface RevokeRoleFromUserCommand {
  readonly roleId: string;
  readonly assignmentId: string;
  readonly reason?: string | null;
}

export interface ListRolesQuery {
  readonly state?: RoleState | string;
  readonly limit?: number | string;
  readonly cursor?: string;
  readonly search?: string;
}

export interface GetRoleDetailQuery {
  readonly roleId: string;
}

export interface ListRoleAssignmentsQuery {
  readonly roleId: string;
  readonly state?: RoleAssignmentState | string;
  readonly limit?: number | string;
  readonly cursor?: string;
}

export interface ListRolePermissionMatrixQuery {
  readonly roleId: string;
}

export type RoleMutationResult = RoleMutationView;

export interface ListRolesResult {
  readonly items: readonly RoleListItemView[];
  readonly nextCursor?: string;
}

export type GetRoleDetailResult = RoleDetailView;

export interface ListRoleAssignmentsResult {
  readonly items: readonly RoleAssignmentView[];
  readonly nextCursor?: string;
}

export type GetRolePermissionMatrixResult =
  RolePermissionMatrixView;
