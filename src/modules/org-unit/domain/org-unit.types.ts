export const ORG_UNIT_TYPES = [
  "DEPARTMENT",
  "TEAM",
  "BUSINESS_UNIT",
  "SUPPORT_UNIT",
] as const;

export type OrgUnitType =
  (typeof ORG_UNIT_TYPES)[number];

export const ORG_UNIT_STATUSES = [
  "ACTIVE",
  "INACTIVE",
  "ARCHIVED",
] as const;

export type OrgUnitStatus =
  (typeof ORG_UNIT_STATUSES)[number];

export const ORG_UNIT_SORT_FIELDS = [
  "code",
  "name",
  "createdAt",
  "displayOrder",
] as const;

export type OrgUnitSortField =
  (typeof ORG_UNIT_SORT_FIELDS)[number];

export const ORG_UNIT_SORT_DIRECTIONS = [
  "ASC",
  "DESC",
] as const;

export type OrgUnitSortDirection =
  (typeof ORG_UNIT_SORT_DIRECTIONS)[number];

export interface OrgUnitRecord {
  readonly id: string;
  readonly code: string;
  readonly searchCode: string;
  readonly name: string;
  readonly normalizedName: string;
  readonly type: OrgUnitType;
  readonly status: OrgUnitStatus;
  readonly parentOrgUnitId: string | null;
  readonly ancestorChain: readonly string[];
  readonly depth: number;
  readonly displayOrder: number;
  readonly description: string | null;
  readonly externalRef: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface OrgUnitListItemView {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly type: OrgUnitType;
  readonly status: OrgUnitStatus;
  readonly parentOrgUnitId: string | null;
  readonly depth: number;
  readonly displayOrder: number;
  readonly createdAt: number;
}

export interface OrgUnitChildListItemView {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly type: OrgUnitType;
  readonly status: OrgUnitStatus;
  readonly parentOrgUnitId: string | null;
  readonly depth: number;
  readonly displayOrder: number;
}

export interface OrgUnitHierarchyInfoView {
  readonly id: string;
  readonly parentOrgUnitId: string | null;
  readonly depth: number;
  readonly ancestorChain: readonly string[];
}

export interface OrgUnitDetailView {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly type: OrgUnitType;
  readonly status: OrgUnitStatus;
  readonly description: string | null;
  readonly externalRef: string | null;
  readonly parentOrgUnitId: string | null;
  readonly depth: number;
  readonly displayOrder: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly hierarchy: OrgUnitHierarchyInfoView;
}

export interface OrgUnitMutationView
  extends OrgUnitDetailView {}
