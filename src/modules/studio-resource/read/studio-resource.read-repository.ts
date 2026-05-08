import {
  StudioResourceAvailabilityListItemView,
  StudioResourceClass,
  StudioResourceDetailView,
  StudioResourceListItemView,
  StudioResourceOperationalStatus,
  StudioResourceSortDirection,
  StudioResourceSortField,
} from "@modules/studio-resource/domain/studio-resource.types";

export interface ListStudioResourcesReadInput {
  readonly resourceClass?: StudioResourceClass;
  readonly operationalStatus?: StudioResourceOperationalStatus;
  readonly hasMaxOccupancy?: boolean;
  readonly limit: number;
  readonly cursor?: string;
  readonly search?: string;
  readonly sortField?: StudioResourceSortField;
  readonly sortDirection?: StudioResourceSortDirection;
}

export interface ListStudioResourcesReadResult {
  readonly items: readonly StudioResourceListItemView[];
  readonly nextCursor?: string;
}

export interface ListStudioResourceAvailabilityReadResult {
  readonly items: readonly StudioResourceAvailabilityListItemView[];
  readonly nextCursor?: string;
}

export interface StudioResourceReadRepository {
  listStudioResources(
    input: ListStudioResourcesReadInput,
  ): Promise<ListStudioResourcesReadResult>;

  listStudioResourceAvailability(
    input: ListStudioResourcesReadInput,
  ): Promise<ListStudioResourceAvailabilityReadResult>;

  getStudioResourceDetail(
    studioResourceId: string,
  ): Promise<StudioResourceDetailView | null>;
}
