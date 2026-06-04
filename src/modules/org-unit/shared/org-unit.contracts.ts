import {
  OrgUnitChildListItemView,
  OrgUnitDetailView,
  OrgUnitMutationView,
  OrgUnitSortDirection,
  OrgUnitSortField,
  OrgUnitStatus,
  OrgUnitType,
} from "@modules/org-unit/domain/org-unit.types";
import {
  OrgUnitManagerAssignmentView,
  OrgUnitManagerRole,
} from "@modules/kpi/domain/kpi.types";
import { OrgUnitListItemView } from "@modules/org-unit/domain/org-unit.types";

export interface CreateOrgUnitCommand {
  readonly code?: string | null;
  readonly name: string;
  readonly type: OrgUnitType;
  readonly parentOrgUnitId?: string | null;
  readonly description?: string | null;
  readonly displayOrder: number | string;
  readonly externalRef?: string | null;
}

export interface UpdateOrgUnitProfileCommand {
  readonly orgUnitId: string;
  readonly name?: string;
  readonly description?: string | null;
  readonly displayOrder?: number | string;
  readonly externalRef?: string | null;
}

export interface MoveOrgUnitCommand {
  readonly orgUnitId: string;
  readonly newParentOrgUnitId: string | null;
}

export interface ActivateOrgUnitCommand {
  readonly orgUnitId: string;
}

export interface DeactivateOrgUnitCommand {
  readonly orgUnitId: string;
}

export interface ArchiveOrgUnitCommand {
  readonly orgUnitId: string;
}

export interface CreateOrgUnitResponsibilityCommand {
  readonly orgUnitId: string;
  readonly managerEmploymentProfileId: string;
  readonly role: OrgUnitManagerRole | string;
  readonly includeDescendants?: boolean;
  readonly effectiveFrom?: number | string | null;
  readonly effectiveTo?: number | string | null;
  readonly isPrimary?: boolean;
}

export interface UpdateOrgUnitResponsibilityCommand {
  readonly orgUnitId: string;
  readonly assignmentId: string;
  readonly role?: OrgUnitManagerRole | string;
  readonly includeDescendants?: boolean;
  readonly effectiveFrom?: number | string | null;
  readonly effectiveTo?: number | string | null;
  readonly isPrimary?: boolean;
}

export interface RevokeOrgUnitResponsibilityCommand {
  readonly orgUnitId: string;
  readonly assignmentId: string;
}

export interface GetOrgUnitDetailQuery {
  readonly orgUnitId: string;
}

export interface ListOrgUnitsQuery {
  readonly status?: OrgUnitStatus | string;
  readonly type?: OrgUnitType | string;
  readonly parentOrgUnitId?: string;
  readonly rootOnly?: boolean | string;
  readonly limit?: number | string;
  readonly cursor?: string;
  readonly search?: string;
  readonly sortBy?: OrgUnitSortField | string;
  readonly sortDirection?: OrgUnitSortDirection | string;
}

export interface ListRootOrgUnitsQuery {
  readonly limit?: number | string;
  readonly cursor?: string;
}

export interface ListDirectChildrenQuery {
  readonly orgUnitId: string;
  readonly limit?: number | string;
  readonly cursor?: string;
}

export interface ListOrgUnitResponsibilitiesQuery {
  readonly orgUnitId: string;
}

export type OrgUnitMutationResult =
  | OrgUnitMutationView
  | OrgUnitManagerAssignmentView;

export type GetOrgUnitDetailResult =
  OrgUnitDetailView;

export interface ListOrgUnitsResult {
  readonly items: readonly OrgUnitListItemView[];
  readonly nextCursor?: string;
}

export interface ListRootOrgUnitsResult {
  readonly items: readonly OrgUnitListItemView[];
  readonly nextCursor?: string;
}

export interface ListDirectChildrenResult {
  readonly items: readonly OrgUnitChildListItemView[];
  readonly nextCursor?: string;
}

export interface ListOrgUnitResponsibilitiesResult {
  readonly items: readonly OrgUnitManagerAssignmentView[];
}
