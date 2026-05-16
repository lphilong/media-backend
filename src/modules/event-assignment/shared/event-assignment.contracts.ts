import {
  EventAssignmentKind,
  EventAssignmentListItemView,
  EventByAssignmentListItemView,
  EventByPlatformListItemView,
  EventByResourceListItemView,
  EventDetailView,
  EventListItemView,
  EventMutationView,
  EventSortDirection,
  EventSortField,
  EventStatus,
} from "@modules/event-assignment/domain/event-assignment.types";

export interface EventAssignmentInput {
  readonly assignmentKind: EventAssignmentKind | string;
  readonly assignmentEmploymentProfileId?: string | null;
  readonly assignmentTalentId?: string | null;
  readonly assignmentTalentGroupId?: string | null;
}

export interface CreateEventCommand {
  readonly eventCode?: string | null;
  readonly title: string;
  readonly assignments: readonly EventAssignmentInput[];
  readonly studioResourceIds?: readonly string[];
  readonly platformAccountIds?: readonly string[];
  readonly eventStartAt: number;
  readonly eventEndAt: number;
  readonly description?: string | null;
  readonly externalRef?: string | null;
}

export interface UpdateEventCoreCommand {
  readonly eventId: string;
  readonly title?: string;
  readonly description?: string | null;
  readonly externalRef?: string | null;
}

export interface RescheduleEventCommand {
  readonly eventId: string;
  readonly newEventStartAt: number;
  readonly newEventEndAt: number;
}

export interface ReplaceEventAssignmentsCommand {
  readonly eventId: string;
  readonly replacementAssignments: readonly EventAssignmentInput[];
}

export interface UpdateEventStudioResourcesCommand {
  readonly eventId: string;
  readonly newStudioResourceIds: readonly string[];
}

export interface UpdateEventPlatformAccountsCommand {
  readonly eventId: string;
  readonly newPlatformAccountIds: readonly string[];
}

export interface StartEventCommand {
  readonly eventId: string;
}

export interface CompleteEventCommand {
  readonly eventId: string;
}

export interface CancelEventCommand {
  readonly eventId: string;
}

export interface ArchiveEventCommand {
  readonly eventId: string;
}

export interface GetEventDetailQuery {
  readonly eventId: string;
}

export interface ListEventsQuery {
  readonly status?: EventStatus | string;
  readonly assignmentKind?: EventAssignmentKind | string;
  readonly assignmentEmploymentProfileId?: string;
  readonly assignmentTalentId?: string;
  readonly assignmentTalentGroupId?: string;
  readonly containsStudioResourceId?: string;
  readonly containsPlatformAccountId?: string;
  readonly windowStartAt?: number | string;
  readonly windowEndAt?: number | string;
  readonly limit?: number | string;
  readonly cursor?: string;
  readonly search?: string;
  readonly sortBy?: EventSortField | string;
  readonly sortDirection?: EventSortDirection | string;
}

export interface ListEventAssignmentsQuery {
  readonly eventId: string;
}

export interface ListEventsByAssignmentQuery {
  readonly assignmentKind: EventAssignmentKind | string;
  readonly assignmentEmploymentProfileId?: string;
  readonly assignmentTalentId?: string;
  readonly assignmentTalentGroupId?: string;
  readonly status?: EventStatus | string;
  readonly windowStartAt?: number | string;
  readonly windowEndAt?: number | string;
  readonly limit?: number | string;
  readonly cursor?: string;
  readonly sortBy?: EventSortField | string;
  readonly sortDirection?: EventSortDirection | string;
}

export interface ListEventsByResourceQuery {
  readonly studioResourceId: string;
  readonly status?: EventStatus | string;
  readonly windowStartAt?: number | string;
  readonly windowEndAt?: number | string;
  readonly limit?: number | string;
  readonly cursor?: string;
  readonly sortBy?: EventSortField | string;
  readonly sortDirection?: EventSortDirection | string;
}

export interface ListEventsByPlatformQuery {
  readonly platformAccountId: string;
  readonly status?: EventStatus | string;
  readonly windowStartAt?: number | string;
  readonly windowEndAt?: number | string;
  readonly limit?: number | string;
  readonly cursor?: string;
  readonly sortBy?: EventSortField | string;
  readonly sortDirection?: EventSortDirection | string;
}

export type EventMutationResult = EventMutationView;

export type GetEventDetailResult = EventDetailView;

export interface ListEventsResult {
  readonly items: readonly EventListItemView[];
  readonly nextCursor?: string;
}

export interface ListEventAssignmentsResult {
  readonly items: readonly EventAssignmentListItemView[];
}

export interface ListEventsByAssignmentResult {
  readonly items: readonly EventByAssignmentListItemView[];
  readonly nextCursor?: string;
}

export interface ListEventsByResourceResult {
  readonly items: readonly EventByResourceListItemView[];
  readonly nextCursor?: string;
}

export interface ListEventsByPlatformResult {
  readonly items: readonly EventByPlatformListItemView[];
  readonly nextCursor?: string;
}
