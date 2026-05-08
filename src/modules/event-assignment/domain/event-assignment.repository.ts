import { ClientSession } from "mongodb";
import {
  EventAssignmentKind,
  EventAssignmentRecord,
  EventRecord,
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
  readonly description?: string | null;
  readonly externalRef?: string | null;
  readonly updatedAt: number;
}

export interface RescheduleEventInput {
  readonly eventId: string;
  readonly eventStartAt: number;
  readonly eventEndAt: number;
  readonly updatedAt: number;
}

export interface ReplaceEventStudioResourcesInput {
  readonly eventId: string;
  readonly studioResourceIds: readonly string[];
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

export interface EventOverlapResourceCheckInput {
  readonly studioResourceIds: readonly string[];
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

  updateEventCore(
    input: UpdateEventCoreInput,
    session: ClientSession,
  ): Promise<EventRecord | null>;

  rescheduleEvent(
    input: RescheduleEventInput,
    session: ClientSession,
  ): Promise<EventRecord | null>;

  replaceEventStudioResources(
    input: ReplaceEventStudioResourcesInput,
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

  hasLiveOverlappingResourceEvent(
    input: EventOverlapResourceCheckInput,
    session?: ClientSession,
  ): Promise<boolean>;

  hasLiveOverlappingPlatformEvent(
    input: EventOverlapPlatformCheckInput,
    session?: ClientSession,
  ): Promise<boolean>;
}
