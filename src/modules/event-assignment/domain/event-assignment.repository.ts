import { ClientSession } from "mongodb";
import { BusinessCodePolicy } from "@core/business-code/business-code-sequence.repository";
import {
  EventAssignmentKind,
  EventCompletionEvidenceRef,
  EventAssignmentRecord,
  EventRecord,
  StudioBookingRecord,
  StudioBookingStatus,
  EventStatus,
} from "./event-assignment.types";

export interface EventAssignmentReferenceInput {
  readonly assignmentKind: EventAssignmentKind;
  readonly assignmentEmploymentProfileId: string | null;
  readonly assignmentTalentId: string | null;
  readonly assignmentTalentGroupId: string | null;
}

export interface UpdateEventCoreInput {
  readonly eventId: string;
  readonly title?: string;
  readonly normalizedTitle?: string;
  readonly ownerEmploymentProfileId?: string;
  readonly description?: string | null;
  readonly externalRef?: string | null;
  readonly updatedByActorId: string;
  readonly updatedAt: number;
}

export interface RescheduleEventInput {
  readonly eventId: string;
  readonly eventStartAt: number;
  readonly eventEndAt: number;
  readonly reason: string;
  readonly rescheduledByActorId: string;
  readonly updatedAt: number;
}

export interface ReplaceEventPlatformAccountsInput {
  readonly eventId: string;
  readonly platformAccountIds: readonly string[];
  readonly updatedAt: number;
}

export interface TransitionEventStatusInput {
  readonly eventId: string;
  readonly fromStatuses: readonly EventStatus[];
  readonly toStatus: EventStatus;
  readonly actorId: string;
  readonly reason?: string;
  readonly completionEvidenceNote?: string;
  readonly completionEvidenceRefs?: readonly EventCompletionEvidenceRef[];
  readonly updatedAt: number;
}

export interface StudioBookingOverlapCheckInput {
  readonly studioResourceId: string;
  readonly bookingStartAt: number;
  readonly bookingEndAt: number;
  readonly statuses: readonly StudioBookingStatus[];
  readonly excludeBookingId?: string;
}

export interface TransitionStudioBookingStatusInput {
  readonly bookingId: string;
  readonly eventId: string;
  readonly fromStatuses: readonly StudioBookingStatus[];
  readonly toStatus: StudioBookingStatus;
  readonly actorId: string;
  readonly reason?: string;
  readonly updatedAt: number;
}

export interface MarkAssignmentsRemovedInput {
  readonly eventId: string;
  readonly assignmentIds: readonly string[];
  readonly removedAt: number;
  readonly updatedAt: number;
}

export interface EventOverlapAssignmentCheckInput {
  readonly assignmentEmploymentProfileIds: readonly string[];
  readonly assignmentTalentIds: readonly string[];
  readonly assignmentTalentGroupIds: readonly string[];
  readonly eventStartAt: number;
  readonly eventEndAt: number;
  readonly excludeEventId?: string;
}

export interface EventOverlapPlatformCheckInput {
  readonly platformAccountIds: readonly string[];
  readonly eventStartAt: number;
  readonly eventEndAt: number;
  readonly excludeEventId?: string;
}

export interface EventAssignmentRepository {
  insertEvent(
    event: EventRecord,
    session: ClientSession,
  ): Promise<EventRecord>;

  insertAssignments(
    assignments: readonly EventAssignmentRecord[],
    session: ClientSession,
  ): Promise<readonly EventAssignmentRecord[]>;

  findEventById(
    eventId: string,
    session?: ClientSession,
  ): Promise<EventRecord | null>;

  findEventByEventCode(
    eventCode: string,
    session?: ClientSession,
  ): Promise<EventRecord | null>;

  findMaxGeneratedEventCodeSequence(
    policy: Pick<BusinessCodePolicy, "prefix" | "width">,
    session?: ClientSession,
  ): Promise<number>;

  updateEventCore(
    input: UpdateEventCoreInput,
    session: ClientSession,
  ): Promise<EventRecord | null>;

  rescheduleEvent(
    input: RescheduleEventInput,
    session: ClientSession,
  ): Promise<EventRecord | null>;

  replaceEventPlatformAccounts(
    input: ReplaceEventPlatformAccountsInput,
    session: ClientSession,
  ): Promise<EventRecord | null>;

  touchEvent(
    eventId: string,
    updatedAt: number,
    session: ClientSession,
  ): Promise<EventRecord | null>;

  transitionEventStatus(
    input: TransitionEventStatusInput,
    session: ClientSession,
  ): Promise<EventRecord | null>;

  insertStudioBooking(
    booking: StudioBookingRecord,
    session: ClientSession,
  ): Promise<StudioBookingRecord>;

  findStudioBookingById(
    bookingId: string,
    session?: ClientSession,
  ): Promise<StudioBookingRecord | null>;

  listStudioBookingsByEventId(
    eventId: string,
    statuses?: readonly StudioBookingStatus[],
    session?: ClientSession,
  ): Promise<readonly StudioBookingRecord[]>;

  hasOverlappingStudioBooking(
    input: StudioBookingOverlapCheckInput,
    session?: ClientSession,
  ): Promise<boolean>;

  lockStudioResourceBooking(
    studioResourceId: string,
    updatedAt: number,
    session: ClientSession,
  ): Promise<void>;

  transitionStudioBookingStatus(
    input: TransitionStudioBookingStatusInput,
    session: ClientSession,
  ): Promise<StudioBookingRecord | null>;

  transitionStudioBookingsByEvent(
    eventId: string,
    fromStatuses: readonly StudioBookingStatus[],
    toStatus: StudioBookingStatus,
    actorId: string,
    reason: string | undefined,
    updatedAt: number,
    session: ClientSession,
  ): Promise<void>;

  syncEventStudioResourceIdsFromBookings(
    eventId: string,
    updatedByActorId: string,
    updatedAt: number,
    session: ClientSession,
  ): Promise<EventRecord | null>;

  listAssignmentsByEventId(
    eventId: string,
    assignmentStatus?: EventAssignmentRecord["assignmentStatus"],
    session?: ClientSession,
  ): Promise<readonly EventAssignmentRecord[]>;

  markAssignmentsRemoved(
    input: MarkAssignmentsRemovedInput,
    session: ClientSession,
  ): Promise<void>;

  hasLiveOverlappingAssignmentEvent(
    input: EventOverlapAssignmentCheckInput,
    session?: ClientSession,
  ): Promise<boolean>;

  hasLiveOverlappingPlatformEvent(
    input: EventOverlapPlatformCheckInput,
    session?: ClientSession,
  ): Promise<boolean>;
}
