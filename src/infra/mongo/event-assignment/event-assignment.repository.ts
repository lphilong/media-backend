import {
  ClientSession,
  Collection,
  Db,
} from "mongodb";
import {
  buildGeneratedBusinessCodeRegex,
  BusinessCodePolicy,
  parseGeneratedBusinessCodeSequence,
} from "@core/business-code/business-code-sequence.repository";
import { BaseRepository } from "@infra/database/repository/base.repository";
import {
  EventAssignmentRepository,
  EventOverlapAssignmentCheckInput,
  EventOverlapPlatformCheckInput,
  MarkAssignmentsRemovedInput,
  ReplaceEventPlatformAccountsInput,
  RescheduleEventInput,
  StudioBookingOverlapCheckInput,
  TransitionStudioBookingStatusInput,
  TransitionEventStatusInput,
  UpdateEventCoreInput,
} from "@modules/event-assignment/domain/event-assignment.repository";
import {
  EventAssignmentKind,
  EventAssignmentRecord,
  EventAssignmentStatus,
  EventRecord,
  EventStatus,
  StudioBookingRecord,
  StudioBookingStatus,
} from "@modules/event-assignment/domain/event-assignment.types";

const LIVE_EVENT_STATUSES: readonly EventStatus[] = [
  "PLANNED",
  "CONFIRMED",
];

interface EventDocument {
  readonly _id: string;
  readonly eventCode: string;
  readonly title: string;
  readonly normalizedTitle: string;
  readonly ownerEmploymentProfileId: string;
  readonly studioResourceIds: readonly string[];
  readonly platformAccountIds: readonly string[];
  readonly status: EventStatus;
  readonly eventStartAt: number;
  readonly eventEndAt: number;
  readonly description: string | null;
  readonly externalRef: string | null;
  readonly createdByActorId: string;
  readonly updatedByActorId: string;
  readonly plannedAt: number | null;
  readonly plannedByActorId: string | null;
  readonly confirmedAt: number | null;
  readonly confirmedByActorId: string | null;
  readonly completedAt: number | null;
  readonly completedByActorId: string | null;
  readonly cancelledAt: number | null;
  readonly cancelledByActorId: string | null;
  readonly cancellationReason: string | null;
  readonly lastRescheduledAt: number | null;
  readonly lastRescheduledByActorId: string | null;
  readonly lastRescheduleReason: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

interface StudioBookingDocument {
  readonly _id: string;
  readonly eventId: string;
  readonly studioResourceId: string;
  readonly bookingStartAt: number;
  readonly bookingEndAt: number;
  readonly status: StudioBookingStatus;
  readonly createdByActorId: string;
  readonly updatedByActorId: string;
  readonly cancelledAt: number | null;
  readonly cancelledByActorId: string | null;
  readonly cancellationReason: string | null;
  readonly releasedAt: number | null;
  readonly releasedByActorId: string | null;
  readonly releaseReason: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

interface EventAssignmentDocument {
  readonly _id: string;
  readonly eventId: string;
  readonly assignmentKind: EventAssignmentKind;
  readonly assignmentEmploymentProfileId: string | null;
  readonly assignmentTalentId: string | null;
  readonly assignmentTalentGroupId: string | null;
  readonly assignmentStatus: EventAssignmentStatus;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly removedAt: number | null;
}

export class NativeMongoEventAssignmentRepository
  extends BaseRepository<EventDocument>
  implements EventAssignmentRepository
{
  private readonly assignmentCollection: Collection<EventAssignmentDocument>;
  private readonly bookingCollection: Collection<StudioBookingDocument>;
  private readonly bookingResourceGuardCollection: Collection<{
    readonly _id: string;
    readonly updatedAt: number;
  }>;

  constructor(db: Db) {
    super(db, "events");
    this.assignmentCollection =
      db.collection<EventAssignmentDocument>(
        "event_assignments",
      );
    this.bookingCollection =
      db.collection<StudioBookingDocument>("studio_bookings");
    this.bookingResourceGuardCollection = db.collection(
      "studio_booking_resource_guards",
    );
  }

  async insertEvent(
    event: EventRecord,
    session: ClientSession,
  ): Promise<EventRecord> {
    await this.collection.insertOne(
      toEventDocument(event),
      this.withSession(session),
    );

    return event;
  }

  async insertAssignments(
    assignments: readonly EventAssignmentRecord[],
    session: ClientSession,
  ): Promise<readonly EventAssignmentRecord[]> {
    if (assignments.length === 0) {
      return [];
    }

    await this.assignmentCollection.insertMany(
      assignments.map(toEventAssignmentDocument),
      this.withSession(session),
    );

    return assignments;
  }

  async findEventById(
    eventId: string,
    session?: ClientSession,
  ): Promise<EventRecord | null> {
    const doc = await this.collection.findOne(
      {
        _id: eventId,
      },
      this.withSession(session),
    );

    return doc ? toEventRecord(doc) : null;
  }

  async findEventByEventCode(
    eventCode: string,
    session?: ClientSession,
  ): Promise<EventRecord | null> {
    const doc = await this.collection.findOne(
      {
        eventCode,
      },
      this.withSession(session),
    );

    return doc ? toEventRecord(doc) : null;
  }

  async findMaxGeneratedEventCodeSequence(
    policy: Pick<BusinessCodePolicy, "prefix" | "width">,
    session?: ClientSession,
  ): Promise<number> {
    const doc = await this.collection
      .find(
        {
          eventCode:
            buildGeneratedBusinessCodeRegex(policy),
        },
        this.withSession(session),
      )
      .sort({ eventCode: -1 })
      .limit(1)
      .next();

    if (!doc) {
      return 0;
    }

    return (
      parseGeneratedBusinessCodeSequence(
        doc.eventCode,
        policy,
      ) ?? 0
    );
  }

  async updateEventCore(
    input: UpdateEventCoreInput,
    session: ClientSession,
  ): Promise<EventRecord | null> {
    const set: Record<string, unknown> = {
      updatedAt: input.updatedAt,
    };

    if (input.title !== undefined) {
      set.title = input.title;
    }

    if (input.normalizedTitle !== undefined) {
      set.normalizedTitle = input.normalizedTitle;
    }

    if (input.ownerEmploymentProfileId !== undefined) {
      set.ownerEmploymentProfileId = input.ownerEmploymentProfileId;
    }

    if (input.description !== undefined) {
      set.description = input.description;
    }

    if (input.externalRef !== undefined) {
      set.externalRef = input.externalRef;
    }
    set.updatedByActorId = input.updatedByActorId;

    const updated = await this.collection.findOneAndUpdate(
      {
        _id: input.eventId,
      },
      {
        $set: set,
      },
      {
        ...this.withSession(session),
        returnDocument: "after",
      },
    );

    return updated ? toEventRecord(updated) : null;
  }

  async rescheduleEvent(
    input: RescheduleEventInput,
    session: ClientSession,
  ): Promise<EventRecord | null> {
    const updated = await this.collection.findOneAndUpdate(
      {
        _id: input.eventId,
      },
      {
        $set: {
          eventStartAt: input.eventStartAt,
          eventEndAt: input.eventEndAt,
          lastRescheduleReason: input.reason,
          lastRescheduledAt: input.updatedAt,
          lastRescheduledByActorId: input.rescheduledByActorId,
          updatedByActorId: input.rescheduledByActorId,
          updatedAt: input.updatedAt,
        },
      },
      {
        ...this.withSession(session),
        returnDocument: "after",
      },
    );

    return updated ? toEventRecord(updated) : null;
  }

  async replaceEventPlatformAccounts(
    input: ReplaceEventPlatformAccountsInput,
    session: ClientSession,
  ): Promise<EventRecord | null> {
    const updated = await this.collection.findOneAndUpdate(
      {
        _id: input.eventId,
      },
      {
        $set: {
          platformAccountIds: [
            ...input.platformAccountIds,
          ],
          updatedAt: input.updatedAt,
        },
      },
      {
        ...this.withSession(session),
        returnDocument: "after",
      },
    );

    return updated ? toEventRecord(updated) : null;
  }

  async touchEvent(
    eventId: string,
    updatedAt: number,
    session: ClientSession,
  ): Promise<EventRecord | null> {
    const updated = await this.collection.findOneAndUpdate(
      {
        _id: eventId,
      },
      {
        $set: {
          updatedAt,
        },
      },
      {
        ...this.withSession(session),
        returnDocument: "after",
      },
    );

    return updated ? toEventRecord(updated) : null;
  }

  async transitionEventStatus(
    input: TransitionEventStatusInput,
    session: ClientSession,
  ): Promise<EventRecord | null> {
    const set: Record<string, unknown> = {
      status: input.toStatus,
      updatedByActorId: input.actorId,
      updatedAt: input.updatedAt,
    };
    if (input.toStatus === "PLANNED") {
      set.plannedAt = input.updatedAt;
      set.plannedByActorId = input.actorId;
    } else if (input.toStatus === "CONFIRMED") {
      set.confirmedAt = input.updatedAt;
      set.confirmedByActorId = input.actorId;
    } else if (input.toStatus === "COMPLETED") {
      set.completedAt = input.updatedAt;
      set.completedByActorId = input.actorId;
    } else if (input.toStatus === "CANCELLED") {
      set.cancelledAt = input.updatedAt;
      set.cancelledByActorId = input.actorId;
      set.cancellationReason = input.reason ?? null;
    }

    const updated = await this.collection.findOneAndUpdate(
      {
        _id: input.eventId,
        status: {
          $in: [...input.fromStatuses],
        },
      },
      {
        $set: set,
      },
      {
        ...this.withSession(session),
        returnDocument: "after",
      },
    );

    return updated ? toEventRecord(updated) : null;
  }

  async insertStudioBooking(
    booking: StudioBookingRecord,
    session: ClientSession,
  ): Promise<StudioBookingRecord> {
    await this.bookingCollection.insertOne(
      toStudioBookingDocument(booking),
      this.withSession(session),
    );
    return booking;
  }

  async findStudioBookingById(
    bookingId: string,
    session?: ClientSession,
  ): Promise<StudioBookingRecord | null> {
    const doc = await this.bookingCollection.findOne(
      { _id: bookingId },
      this.withSession(session),
    );
    return doc ? toStudioBookingRecord(doc) : null;
  }

  async listStudioBookingsByEventId(
    eventId: string,
    statuses?: readonly StudioBookingStatus[],
    session?: ClientSession,
  ): Promise<readonly StudioBookingRecord[]> {
    const query: Record<string, unknown> = { eventId };
    if (statuses?.length) {
      query.status = { $in: [...statuses] };
    }
    const docs = await this.bookingCollection
      .find(query, this.withSession(session))
      .sort({ bookingStartAt: 1, _id: 1 })
      .toArray();
    return docs.map(toStudioBookingRecord);
  }

  async hasOverlappingStudioBooking(
    input: StudioBookingOverlapCheckInput,
    session?: ClientSession,
  ): Promise<boolean> {
    const query: Record<string, unknown> = {
      studioResourceId: input.studioResourceId,
      status: { $in: [...input.statuses] },
      bookingStartAt: { $lt: input.bookingEndAt },
      bookingEndAt: { $gt: input.bookingStartAt },
    };
    if (input.excludeBookingId) {
      query._id = { $ne: input.excludeBookingId };
    }
    return (
      (await this.bookingCollection.findOne(query, {
        projection: { _id: 1 },
        ...this.withSession(session),
      })) !== null
    );
  }

  async lockStudioResourceBooking(
    studioResourceId: string,
    updatedAt: number,
    session: ClientSession,
  ): Promise<void> {
    await this.bookingResourceGuardCollection.updateOne(
      { _id: studioResourceId },
      { $set: { updatedAt } },
      { ...this.withSession(session), upsert: true },
    );
  }

  async transitionStudioBookingStatus(
    input: TransitionStudioBookingStatusInput,
    session: ClientSession,
  ): Promise<StudioBookingRecord | null> {
    const set: Record<string, unknown> = {
      status: input.toStatus,
      updatedByActorId: input.actorId,
      updatedAt: input.updatedAt,
    };
    if (input.toStatus === "CANCELLED") {
      set.cancelledAt = input.updatedAt;
      set.cancelledByActorId = input.actorId;
      set.cancellationReason = input.reason ?? null;
    } else if (input.toStatus === "RELEASED") {
      set.releasedAt = input.updatedAt;
      set.releasedByActorId = input.actorId;
      set.releaseReason = input.reason ?? null;
    }
    const updated = await this.bookingCollection.findOneAndUpdate(
      {
        _id: input.bookingId,
        eventId: input.eventId,
        status: { $in: [...input.fromStatuses] },
      },
      { $set: set },
      { ...this.withSession(session), returnDocument: "after" },
    );
    return updated ? toStudioBookingRecord(updated) : null;
  }

  async transitionStudioBookingsByEvent(
    eventId: string,
    fromStatuses: readonly StudioBookingStatus[],
    toStatus: StudioBookingStatus,
    actorId: string,
    reason: string | undefined,
    updatedAt: number,
    session: ClientSession,
  ): Promise<void> {
    const set: Record<string, unknown> = {
      status: toStatus,
      updatedByActorId: actorId,
      updatedAt,
    };
    if (toStatus === "CANCELLED") {
      set.cancelledAt = updatedAt;
      set.cancelledByActorId = actorId;
      set.cancellationReason = reason ?? null;
    }
    await this.bookingCollection.updateMany(
      { eventId, status: { $in: [...fromStatuses] } },
      { $set: set },
      this.withSession(session),
    );
  }

  async syncEventStudioResourceIdsFromBookings(
    eventId: string,
    updatedByActorId: string,
    updatedAt: number,
    session: ClientSession,
  ): Promise<EventRecord | null> {
    const studioResourceIds = await this.bookingCollection.distinct(
      "studioResourceId",
      { eventId, status: { $in: ["HELD", "CONFIRMED"] } },
      this.withSession(session),
    );
    const updated = await this.collection.findOneAndUpdate(
      { _id: eventId },
      {
        $set: {
          studioResourceIds: [...studioResourceIds].sort(),
          updatedByActorId,
          updatedAt,
        },
      },
      { ...this.withSession(session), returnDocument: "after" },
    );
    return updated ? toEventRecord(updated) : null;
  }

  async listAssignmentsByEventId(
    eventId: string,
    assignmentStatus?: EventAssignmentStatus,
    session?: ClientSession,
  ): Promise<readonly EventAssignmentRecord[]> {
    const query: Record<string, unknown> = {
      eventId,
    };

    if (assignmentStatus) {
      query.assignmentStatus = assignmentStatus;
    }

    const docs = await this.assignmentCollection
      .find(query, this.withSession(session))
      .toArray();

    return docs
      .map(toEventAssignmentRecord)
      .sort(compareAssignmentRecords);
  }

  async markAssignmentsRemoved(
    input: MarkAssignmentsRemovedInput,
    session: ClientSession,
  ): Promise<void> {
    if (input.assignmentIds.length === 0) {
      return;
    }

    await this.assignmentCollection.updateMany(
      {
        _id: {
          $in: [...input.assignmentIds],
        },
        eventId: input.eventId,
        assignmentStatus: "ACTIVE",
      },
      {
        $set: {
          assignmentStatus: "REMOVED",
          removedAt: input.removedAt,
          updatedAt: input.updatedAt,
        },
      },
      this.withSession(session),
    );
  }

  async hasLiveOverlappingAssignmentEvent(
    input: EventOverlapAssignmentCheckInput,
    session?: ClientSession,
  ): Promise<boolean> {
    const matchFilters: Array<Record<string, unknown>> = [];

    if (input.assignmentEmploymentProfileIds.length > 0) {
      matchFilters.push({
        assignmentEmploymentProfileId: {
          $in: [
            ...input.assignmentEmploymentProfileIds,
          ],
        },
      });
    }

    if (input.assignmentTalentIds.length > 0) {
      matchFilters.push({
        assignmentTalentId: {
          $in: [...input.assignmentTalentIds],
        },
      });
    }

    if (input.assignmentTalentGroupIds.length > 0) {
      matchFilters.push({
        assignmentTalentGroupId: {
          $in: [
            ...input.assignmentTalentGroupIds,
          ],
        },
      });
    }

    if (matchFilters.length === 0) {
      return false;
    }

    const assignmentMatch: Record<string, unknown> = {
      assignmentStatus: "ACTIVE",
      $or: matchFilters,
    };

    if (input.excludeEventId) {
      assignmentMatch.eventId = {
        $ne: input.excludeEventId,
      };
    }

    const pipeline: Record<string, unknown>[] = [
      {
        $match: assignmentMatch,
      },
      {
        $lookup: {
          from: "events",
          localField: "eventId",
          foreignField: "_id",
          as: "event",
        },
      },
      {
        $unwind: "$event",
      },
      {
        $match: {
          "event.status": {
            $in: [...LIVE_EVENT_STATUSES],
          },
          "event.eventStartAt": {
            $lt: input.eventEndAt,
          },
          "event.eventEndAt": {
            $gt: input.eventStartAt,
          },
        },
      },
      {
        $limit: 1,
      },
      {
        $project: {
          _id: 1,
        },
      },
    ];

    const docs = await this.assignmentCollection
      .aggregate(pipeline, this.withSession(session))
      .toArray();

    return docs.length > 0;
  }

  async hasLiveOverlappingPlatformEvent(
    input: EventOverlapPlatformCheckInput,
    session?: ClientSession,
  ): Promise<boolean> {
    if (input.platformAccountIds.length === 0) {
      return false;
    }

    const query: Record<string, unknown> = {
      status: {
        $in: [...LIVE_EVENT_STATUSES],
      },
      platformAccountIds: {
        $in: [...input.platformAccountIds],
      },
      eventStartAt: {
        $lt: input.eventEndAt,
      },
      eventEndAt: {
        $gt: input.eventStartAt,
      },
    };

    if (input.excludeEventId) {
      query._id = {
        $ne: input.excludeEventId,
      };
    }

    const doc = await this.collection.findOne(
      query,
      {
        projection: {
          _id: 1,
        },
        ...this.withSession(session),
      },
    );

    return doc !== null;
  }
}

function toEventDocument(
  event: EventRecord,
): EventDocument {
  return {
    _id: event.id,
    eventCode: event.eventCode,
    title: event.title,
    normalizedTitle: event.normalizedTitle,
    ownerEmploymentProfileId: event.ownerEmploymentProfileId,
    studioResourceIds: [...event.studioResourceIds],
    platformAccountIds: [...event.platformAccountIds],
    status: event.status,
    eventStartAt: event.eventStartAt,
    eventEndAt: event.eventEndAt,
    description: event.description,
    externalRef: event.externalRef,
    createdByActorId: event.createdByActorId,
    updatedByActorId: event.updatedByActorId,
    plannedAt: event.plannedAt,
    plannedByActorId: event.plannedByActorId,
    confirmedAt: event.confirmedAt,
    confirmedByActorId: event.confirmedByActorId,
    completedAt: event.completedAt,
    completedByActorId: event.completedByActorId,
    cancelledAt: event.cancelledAt,
    cancelledByActorId: event.cancelledByActorId,
    cancellationReason: event.cancellationReason,
    lastRescheduledAt: event.lastRescheduledAt,
    lastRescheduledByActorId: event.lastRescheduledByActorId,
    lastRescheduleReason: event.lastRescheduleReason,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  };
}

function toEventRecord(
  document: EventDocument,
): EventRecord {
  return {
    id: document._id,
    eventCode: document.eventCode,
    title: document.title,
    normalizedTitle: document.normalizedTitle,
    ownerEmploymentProfileId: document.ownerEmploymentProfileId,
    studioResourceIds: [
      ...document.studioResourceIds,
    ],
    platformAccountIds: [
      ...document.platformAccountIds,
    ],
    status: document.status,
    eventStartAt: document.eventStartAt,
    eventEndAt: document.eventEndAt,
    description: document.description,
    externalRef: document.externalRef,
    createdByActorId: document.createdByActorId,
    updatedByActorId: document.updatedByActorId,
    plannedAt: document.plannedAt,
    plannedByActorId: document.plannedByActorId,
    confirmedAt: document.confirmedAt,
    confirmedByActorId: document.confirmedByActorId,
    completedAt: document.completedAt,
    completedByActorId: document.completedByActorId,
    cancelledAt: document.cancelledAt,
    cancelledByActorId: document.cancelledByActorId,
    cancellationReason: document.cancellationReason,
    lastRescheduledAt: document.lastRescheduledAt,
    lastRescheduledByActorId: document.lastRescheduledByActorId,
    lastRescheduleReason: document.lastRescheduleReason,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

function toStudioBookingDocument(
  booking: StudioBookingRecord,
): StudioBookingDocument {
  return {
    _id: booking.id,
    eventId: booking.eventId,
    studioResourceId: booking.studioResourceId,
    bookingStartAt: booking.bookingStartAt,
    bookingEndAt: booking.bookingEndAt,
    status: booking.status,
    createdByActorId: booking.createdByActorId,
    updatedByActorId: booking.updatedByActorId,
    cancelledAt: booking.cancelledAt,
    cancelledByActorId: booking.cancelledByActorId,
    cancellationReason: booking.cancellationReason,
    releasedAt: booking.releasedAt,
    releasedByActorId: booking.releasedByActorId,
    releaseReason: booking.releaseReason,
    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt,
  };
}

function toStudioBookingRecord(
  document: StudioBookingDocument,
): StudioBookingRecord {
  return {
    id: document._id,
    eventId: document.eventId,
    studioResourceId: document.studioResourceId,
    bookingStartAt: document.bookingStartAt,
    bookingEndAt: document.bookingEndAt,
    status: document.status,
    createdByActorId: document.createdByActorId,
    updatedByActorId: document.updatedByActorId,
    cancelledAt: document.cancelledAt,
    cancelledByActorId: document.cancelledByActorId,
    cancellationReason: document.cancellationReason,
    releasedAt: document.releasedAt,
    releasedByActorId: document.releasedByActorId,
    releaseReason: document.releaseReason,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

function toEventAssignmentDocument(
  assignment: EventAssignmentRecord,
): EventAssignmentDocument {
  return {
    _id: assignment.id,
    eventId: assignment.eventId,
    assignmentKind: assignment.assignmentKind,
    assignmentEmploymentProfileId:
      assignment.assignmentEmploymentProfileId,
    assignmentTalentId:
      assignment.assignmentTalentId,
    assignmentTalentGroupId:
      assignment.assignmentTalentGroupId,
    assignmentStatus: assignment.assignmentStatus,
    createdAt: assignment.createdAt,
    updatedAt: assignment.updatedAt,
    removedAt: assignment.removedAt,
  };
}

function toEventAssignmentRecord(
  document: EventAssignmentDocument,
): EventAssignmentRecord {
  return {
    id: document._id,
    eventId: document.eventId,
    assignmentKind: document.assignmentKind,
    assignmentEmploymentProfileId:
      document.assignmentEmploymentProfileId,
    assignmentTalentId: document.assignmentTalentId,
    assignmentTalentGroupId:
      document.assignmentTalentGroupId,
    assignmentStatus: document.assignmentStatus,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    removedAt: document.removedAt,
  };
}

function compareAssignmentRecords(
  left: EventAssignmentRecord,
  right: EventAssignmentRecord,
): number {
  if (left.assignmentKind < right.assignmentKind) {
    return -1;
  }

  if (left.assignmentKind > right.assignmentKind) {
    return 1;
  }

  const leftReferenceId = getAssignmentReferenceId(left);
  const rightReferenceId = getAssignmentReferenceId(
    right,
  );

  if (leftReferenceId < rightReferenceId) {
    return -1;
  }

  if (leftReferenceId > rightReferenceId) {
    return 1;
  }

  return 0;
}

function getAssignmentReferenceId(
  assignment: Pick<
    EventAssignmentRecord,
    | "assignmentKind"
    | "assignmentEmploymentProfileId"
    | "assignmentTalentId"
    | "assignmentTalentGroupId"
  >,
): string {
  switch (assignment.assignmentKind) {
    case "EMPLOYMENT_PROFILE":
      return assignment.assignmentEmploymentProfileId ?? "";

    case "TALENT":
      return assignment.assignmentTalentId ?? "";

    case "TALENT_GROUP":
      return assignment.assignmentTalentGroupId ?? "";
  }
}
