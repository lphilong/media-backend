import {
  OrgUnitChildListItemView,
  OrgUnitDetailView,
  OrgUnitListItemView,
  OrgUnitSortDirection,
  OrgUnitSortField,
  OrgUnitStatus,
  OrgUnitType,
} from "@modules/org-unit/domain/org-unit.types";

export interface ListOrgUnitReadInput {
  readonly status?: OrgUnitStatus;
  readonly type?: OrgUnitType;
  readonly parentOrgUnitId?: string | null;
  readonly rootOnly?: boolean;
  readonly limit: number;
  readonly cursor?: string;
  readonly search?: string;
  readonly sortField?: OrgUnitSortField;
  readonly sortDirection?: OrgUnitSortDirection;
}

export interface ListOrgUnitReadResult {
  readonly items: readonly OrgUnitListItemView[];
  readonly nextCursor?: string;
}

export interface ListDirectChildrenReadInput {
  readonly parentOrgUnitId: string;
  readonly limit: number;
  readonly cursor?: string;
}

export interface ListDirectChildrenReadResult {
  readonly items: readonly OrgUnitChildListItemView[];
  readonly nextCursor?: string;
}

export interface OrgUnitReadRepository {
  listOrgUnits(
    input: ListOrgUnitReadInput,
  ): Promise<ListOrgUnitReadResult>;

  getOrgUnitDetail(
    orgUnitId: string,
  ): Promise<OrgUnitDetailView | null>;

  listDirectChildren(
    input: ListDirectChildrenReadInput,
  ): Promise<ListDirectChildrenReadResult>;
}
