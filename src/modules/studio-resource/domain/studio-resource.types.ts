export const STUDIO_RESOURCE_CLASSES = [
  "SPACE",
  "EQUIPMENT",
  "KIT",
] as const;

export type StudioResourceClass =
  (typeof STUDIO_RESOURCE_CLASSES)[number];

export const STUDIO_RESOURCE_OPERATIONAL_STATUSES = [
  "ACTIVE",
  "OUT_OF_SERVICE",
  "INACTIVE",
  "ARCHIVED",
] as const;

export type StudioResourceOperationalStatus =
  (typeof STUDIO_RESOURCE_OPERATIONAL_STATUSES)[number];

export const STUDIO_RESOURCE_SORT_FIELDS = [
  "resourceCode",
  "name",
  "createdAt",
] as const;

export type StudioResourceSortField =
  (typeof STUDIO_RESOURCE_SORT_FIELDS)[number];

export const STUDIO_RESOURCE_SORT_DIRECTIONS = [
  "ASC",
  "DESC",
] as const;

export type StudioResourceSortDirection =
  (typeof STUDIO_RESOURCE_SORT_DIRECTIONS)[number];

export interface StudioResourceRecord {
  readonly id: string;
  readonly resourceCode: string;
  readonly name: string;
  readonly normalizedName: string;
  readonly shortName: string | null;
  readonly normalizedShortName: string | null;
  readonly resourceClass: StudioResourceClass;
  readonly operationalStatus: StudioResourceOperationalStatus;
  readonly locationLabel: string | null;
  readonly description: string | null;
  readonly externalRef: string | null;
  readonly maxOccupancy: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface StudioResourceDetailView {
  readonly id: string;
  readonly resourceCode: string;
  readonly name: string;
  readonly shortName: string | null;
  readonly resourceClass: StudioResourceClass;
  readonly operationalStatus: StudioResourceOperationalStatus;
  readonly locationLabel: string | null;
  readonly description: string | null;
  readonly externalRef: string | null;
  readonly maxOccupancy: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface StudioResourceListItemView {
  readonly id: string;
  readonly resourceCode: string;
  readonly name: string;
  readonly shortName: string | null;
  readonly resourceClass: StudioResourceClass;
  readonly operationalStatus: StudioResourceOperationalStatus;
  readonly locationLabel: string | null;
  readonly maxOccupancy: number | null;
  readonly createdAt: number;
}

export interface StudioResourceAvailabilityListItemView {
  readonly id: string;
  readonly resourceCode: string;
  readonly name: string;
  readonly resourceClass: StudioResourceClass;
  readonly operationalStatus: StudioResourceOperationalStatus;
  readonly maxOccupancy: number | null;
}

export interface StudioResourceMutationView
  extends StudioResourceDetailView {}
