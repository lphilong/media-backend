import {
  EventAssignmentKind,
  EventAssignmentListItemView,
  EventByAssignmentListItemView,
  EventByPlatformListItemView,
  EventByResourceListItemView,
  EventDetailView,
  EventListItemView,
  EventSortDirection,
  EventSortField,
  EventStatus,
} from "@modules/event-assignment/domain/event-assignment.types";

export interface EventListReadInput {
  readonly status?: EventStatus;
  readonly assignmentKind?: EventAssignmentKind;
  readonly assignmentEmploymentProfileId?: string;
  readonly assignmentTalentId?: string;
  readonly assignmentTalentGroupId?: string;
  readonly containsStudioResourceId?: string;
  readonly containsPlatformAccountId?: string;
  readonly windowStartAt?: number;
  readonly windowEndAt?: number;
  readonly limit: number;
  readonly cursor?: string;
  readonly search?: string;
  readonly sortField?: EventSortField;
  readonly sortDirection?: EventSortDirection;
}

export interface EventByAssignmentListReadInput {
  readonly assignmentKind: EventAssignmentKind;
  readonly assignmentEmploymentProfileId: string | null;
  readonly assignmentTalentId: string | null;
  readonly assignmentTalentGroupId: string | null;
  readonly status?: EventStatus;
  readonly windowStartAt?: number;
  readonly windowEndAt?: number;
  readonly limit: number;
  readonly cursor?: string;
  readonly sortField?: EventSortField;
  readonly sortDirection?: EventSortDirection;
}

export interface EventByResourceListReadInput {
  readonly studioResourceId: string;
  readonly status?: EventStatus;
  readonly windowStartAt?: number;
  readonly windowEndAt?: number;
  readonly limit: number;
  readonly cursor?: string;
  readonly sortField?: EventSortField;
  readonly sortDirection?: EventSortDirection;
}

export interface EventByPlatformListReadInput {
  readonly platformAccountId: string;
  readonly status?: EventStatus;
  readonly windowStartAt?: number;
  readonly windowEndAt?: number;
  readonly limit: number;
  readonly cursor?: string;
  readonly sortField?: EventSortField;
  readonly sortDirection?: EventSortDirection;
}

export interface EventListReadResult {
  readonly items: readonly EventListItemView[];
  readonly nextCursor?: string;
}

export interface EventByAssignmentListReadResult {
  readonly items: readonly EventByAssignmentListItemView[];
  readonly nextCursor?: string;
}

export interface EventByResourceListReadResult {
  readonly items: readonly EventByResourceListItemView[];
  readonly nextCursor?: string;
}

export interface EventByPlatformListReadResult {
  readonly items: readonly EventByPlatformListItemView[];
  readonly nextCursor?: string;
}

export interface EventAssignmentReadRepository {
  listEvents(
    input: EventListReadInput,
  ): Promise<EventListReadResult>;

  listEventsByAssignment(
    input: EventByAssignmentListReadInput,
  ): Promise<EventByAssignmentListReadResult>;

  listEventsByResource(
    input: EventByResourceListReadInput,
  ): Promise<EventByResourceListReadResult>;

  listEventsByPlatform(
    input: EventByPlatformListReadInput,
  ): Promise<EventByPlatformListReadResult>;

  listActiveAssignmentsForEvent(
    eventId: string,
  ): Promise<readonly EventAssignmentListItemView[]>;

  getEventDetail(
    eventId: string,
  ): Promise<EventDetailView | null>;
}
