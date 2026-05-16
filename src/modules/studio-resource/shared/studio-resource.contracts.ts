import {
  StudioResourceAvailabilityListItemView,
  StudioResourceClass,
  StudioResourceDetailView,
  StudioResourceMutationView,
  StudioResourceOperationalStatus,
  StudioResourceSortDirection,
  StudioResourceSortField,
  StudioResourceListItemView,
} from "@modules/studio-resource/domain/studio-resource.types";

export interface CreateStudioResourceCommand {
  readonly resourceCode?: string | null;
  readonly name: string;
  readonly resourceClass: StudioResourceClass;
  readonly shortName?: string | null;
  readonly locationLabel?: string | null;
  readonly description?: string | null;
  readonly externalRef?: string | null;
  readonly maxOccupancy?: number | null;
}

export interface UpdateStudioResourceCoreCommand {
  readonly studioResourceId: string;
  readonly name?: string;
  readonly shortName?: string | null;
  readonly locationLabel?: string | null;
  readonly description?: string | null;
  readonly externalRef?: string | null;
  readonly maxOccupancy?: number | null;
}

export interface MarkStudioResourceOutOfServiceCommand {
  readonly studioResourceId: string;
}

export interface RestoreStudioResourceToActiveCommand {
  readonly studioResourceId: string;
}

export interface DeactivateStudioResourceCommand {
  readonly studioResourceId: string;
}

export interface ActivateStudioResourceCommand {
  readonly studioResourceId: string;
}

export interface ArchiveStudioResourceCommand {
  readonly studioResourceId: string;
}

export interface GetStudioResourceDetailQuery {
  readonly studioResourceId: string;
}

export interface ListStudioResourcesQuery {
  readonly resourceClass?: StudioResourceClass | string;
  readonly operationalStatus?: StudioResourceOperationalStatus | string;
  readonly hasMaxOccupancy?: boolean | string;
  readonly limit?: number | string;
  readonly cursor?: string;
  readonly search?: string;
  readonly sortBy?: StudioResourceSortField | string;
  readonly sortDirection?: StudioResourceSortDirection | string;
}

export interface ListStudioResourceAvailabilityQuery {
  readonly resourceClass?: StudioResourceClass | string;
  readonly operationalStatus?: StudioResourceOperationalStatus | string;
  readonly hasMaxOccupancy?: boolean | string;
  readonly limit?: number | string;
  readonly cursor?: string;
  readonly search?: string;
  readonly sortBy?: StudioResourceSortField | string;
  readonly sortDirection?: StudioResourceSortDirection | string;
}

export type StudioResourceMutationResult =
  StudioResourceMutationView;

export type GetStudioResourceDetailResult =
  StudioResourceDetailView;

export interface ListStudioResourcesResult {
  readonly items: readonly StudioResourceListItemView[];
  readonly nextCursor?: string;
}

export interface ListStudioResourceAvailabilityResult {
  readonly items: readonly StudioResourceAvailabilityListItemView[];
  readonly nextCursor?: string;
}
