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
  StudioBookingStatus,
  StudioBookingView,
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
  readonly ownerEmploymentProfileId: string;
  readonly status?: Extract<EventStatus, "DRAFT" | "PLANNED"> | string;
  readonly assignments: readonly EventAssignmentInput[];
  readonly platformAccountIds?: readonly string[];
  readonly eventStartAt: number;
  readonly eventEndAt: number;
  readonly description?: string | null;
  readonly externalRef?: string | null;
}

export interface UpdateEventCoreCommand {
  readonly eventId: string;
  readonly title?: string;
  readonly ownerEmploymentProfileId?: string;
  readonly description?: string | null;
  readonly externalRef?: string | null;
}

export interface RescheduleEventCommand {
  readonly eventId: string;
  readonly newEventStartAt: number;
  readonly newEventEndAt: number;
  readonly reason: string;
}

export interface ReplaceEventAssignmentsCommand {
  readonly eventId: string;
  readonly replacementAssignments: readonly EventAssignmentInput[];
}

export interface UpdateEventPlatformAccountsCommand {
  readonly eventId: string;
  readonly newPlatformAccountIds: readonly string[];
}

export interface PlanEventCommand {
  readonly eventId: string;
}

export interface ConfirmEventCommand {
  readonly eventId: string;
}

export interface CompleteEventCommand {
  readonly eventId: string;
}

export interface CancelEventCommand {
  readonly eventId: string;
  readonly reason: string;
}

export interface ArchiveEventCommand {
  readonly eventId: string;
}

export interface CreateStudioBookingCommand {
  readonly eventId: string;
  readonly studioResourceId: string;
  readonly bookingStartAt: number;
  readonly bookingEndAt: number;
  readonly status: Extract<StudioBookingStatus, "HELD" | "CONFIRMED"> | string;
}

export interface ConfirmStudioBookingCommand {
  readonly eventId: string;
  readonly bookingId: string;
}

export interface ReleaseStudioBookingCommand {
  readonly eventId: string;
  readonly bookingId: string;
  readonly reason: string;
}

export interface CancelStudioBookingCommand {
  readonly eventId: string;
  readonly bookingId: string;
  readonly reason: string;
}

export interface ListStudioBookingsQuery {
  readonly eventId: string;
}

export interface GetEventDetailQuery {
  readonly eventId: string;
}

export interface ListEventsQuery {
  readonly status?: EventStatus | string;
  readonly statusGroup?: string;
  readonly assignmentKind?: EventAssignmentKind | string;
  readonly assignmentEmploymentProfileId?: string;
  readonly assignmentTalentId?: string;
  readonly assignmentTalentGroupId?: string;
  readonly containsStudioResourceId?: string;
  readonly containsPlatformAccountId?: string;
  readonly windowStartAt?: number | string;
  readonly windowEndAt?: number | string;
  readonly eventOverlapStartAt?: number | string;
  readonly eventOverlapEndAt?: number | string;
  readonly eventStartFromAt?: number | string;
  readonly eventStartToAt?: number | string;
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
export type StudioBookingMutationResult = StudioBookingView;

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

export interface ListStudioBookingsResult {
  readonly items: readonly StudioBookingView[];
}
