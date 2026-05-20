import { ReferenceSummary } from "@modules/reference-summary";
import { ActorScopeGrants } from "@core/actor/actor";
import type { RoleTemplateCode } from "./role-template.catalog";

export const ROLE_STATES = ["DRAFT", "ACTIVE", "INACTIVE", "ARCHIVED"] as const;

export type RoleState = (typeof ROLE_STATES)[number];

export const ROLE_ASSIGNMENT_STATES = ["ACTIVE", "REVOKED"] as const;

export type RoleAssignmentState = (typeof ROLE_ASSIGNMENT_STATES)[number];

export const ROLE_ASSIGNMENT_RULE_STATES = ["ACTIVE", "INACTIVE"] as const;

export type RoleAssignmentRuleState =
  (typeof ROLE_ASSIGNMENT_RULE_STATES)[number];

export const ROLE_DELEGATION_BANDS = [
  "LIMITED",
  "PRIVILEGED",
  "FOUNDATION",
] as const;

export type RoleDelegationBand = (typeof ROLE_DELEGATION_BANDS)[number];

export const ROLE_MAX_DELEGATABLE_BANDS = [
  "NONE",
  "LIMITED",
  "PRIVILEGED",
] as const;

export type RoleMaxDelegatableBand =
  (typeof ROLE_MAX_DELEGATABLE_BANDS)[number];

export interface RoleRecord {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly state: RoleState;
  readonly permissions: readonly string[];
  readonly delegationBand: RoleDelegationBand;
  readonly maxDelegatableBand: RoleMaxDelegatableBand;
  readonly templateCode?: RoleTemplateCode;
  readonly templateVersion?: string;
  readonly templateAppliedAt?: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly activatedAt: number | null;
  readonly archivedAt: number | null;
}

export interface RoleAssignmentRuleRecord {
  readonly id: string;
  readonly roleId: string;
  readonly code: string;
  readonly description: string | null;
  readonly state: RoleAssignmentRuleState;
  readonly conditions: Record<string, unknown> | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface UserRoleAssignmentRecord {
  readonly assignmentId: string;
  readonly roleId: string;
  readonly userId: string;
  readonly scopeGrants?: ActorScopeGrants;
  readonly state: RoleAssignmentState;
  readonly effectiveAt: number | null;
  readonly revokedAt: number | null;
  readonly reason: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface RoleListItemView {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly state: RoleState;
  readonly permissionsSummary: number;
  readonly assignmentCountSummary: number;
  readonly templateCode?: RoleTemplateCode;
  readonly templateVersion?: string;
  readonly templateAppliedAt?: number;
  readonly updatedAt: number;
}

export interface RoleAssignmentRuleView {
  readonly id: string;
  readonly code: string;
  readonly description: string | null;
  readonly state: RoleAssignmentRuleState;
  readonly conditions: Record<string, unknown> | null;
}

export interface RoleDetailView {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly state: RoleState;
  readonly permissions: readonly string[];
  readonly delegationBand: RoleDelegationBand;
  readonly maxDelegatableBand: RoleMaxDelegatableBand;
  readonly assignmentRules: readonly RoleAssignmentRuleView[];
  readonly templateCode?: RoleTemplateCode;
  readonly templateVersion?: string;
  readonly templateAppliedAt?: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly activatedAt: number | null;
  readonly archivedAt: number | null;
}

export interface RoleMutationView {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly state: RoleState;
  readonly permissions: readonly string[];
  readonly delegationBand: RoleDelegationBand;
  readonly maxDelegatableBand: RoleMaxDelegatableBand;
  readonly assignmentRules: readonly RoleAssignmentRuleView[];
  readonly templateCode?: RoleTemplateCode;
  readonly templateVersion?: string;
  readonly templateAppliedAt?: number;
  readonly updatedAt: number;
  readonly activatedAt: number | null;
  readonly archivedAt: number | null;
}

export interface RoleAssignmentView {
  readonly assignmentId: string;
  readonly roleId: string;
  readonly userId: string;
  readonly userRef?: ReferenceSummary | null;
  readonly scopeGrants?: ActorScopeGrants;
  readonly state: RoleAssignmentState;
  readonly effectiveAt: number | null;
  readonly revokedAt: number | null;
  readonly reason: string | null;
}

export interface RolePermissionMatrixView {
  readonly roleId: string;
  readonly roleCode: string;
  readonly roleState: RoleState;
  readonly permissions: readonly string[];
  readonly delegationBand: RoleDelegationBand;
  readonly maxDelegatableBand: RoleMaxDelegatableBand;
}
