import {
  ClientSession,
  Collection,
  Db,
} from "mongodb";
import { BaseRepository } from "@infra/database/repository/base.repository";
import {
  EventAssignmentRepository,
  EventOverlapAssignmentCheckInput,
  EventOverlapPlatformCheckInput,
  EventOverlapResourceCheckInput,
  MarkAssignmentsRemovedInput,
  ReplaceEventPlatformAccountsInput,
  ReplaceEventStudioResourcesInput,
  RescheduleEventInput,
  TransitionEventStatusInput,
  UpdateEventCoreInput,
} from "@modules/event-assignment/domain/event-assignment.repository";
import {
  EventAssignmentKind,
  EventAssignmentRecord,
  EventAssignmentStatus,
  EventRecord,
  EventStatus,
} from "@modules/event-assignment/domain/event-assignment.types";

const LIVE_EVENT_STATUSES: readonly EventStatus[] = [
  "SCHEDULED",
  "IN_PROGRESS",
];

interface EventDocument {
  readonly _id: string;
  readonly eventCode: string;
  readonly title: string;
  readonly normalizedTitle: string;
  readonly studioResourceIds: readonly string[];
  readonly platformAccountIds: readonly string[];
  readonly status: EventStatus;
  readonly eventStartAt: number;
  readonly eventEndAt: number;
  readonly description: string | null;
  readonly externalRef: string | null;
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

  constructor(db: Db) {
    super(db, "events");
    this.assignmentCollection =
      db.collection<EventAssignmentDocument>(
        "event_assignments",
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

    if (input.description !== undefined) {
      set.description = input.description;
    }

    if (input.externalRef !== undefined) {
      set.externalRef = input.externalRef;
    }

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

  async replaceEventStudioResources(
    input: ReplaceEventStudioResourcesInput,
    session: ClientSession,
  ): Promise<EventRecord | null> {
    const updated = await this.collection.findOneAndUpdate(
      {
        _id: input.eventId,
      },
      {
        $set: {
          studioResourceIds: [
            ...input.studioResourceIds,
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
    const updated = await this.collection.findOneAndUpdate(
      {
        _id: input.eventId,
        status: {
          $in: [...input.fromStatuses],
        },
      },
      {
        $set: {
          status: input.toStatus,
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

  async hasLiveOverlappingResourceEvent(
    input: EventOverlapResourceCheckInput,
    session?: ClientSession,
  ): Promise<boolean> {
    if (input.studioResourceIds.length === 0) {
      return false;
    }

    const query: Record<string, unknown> = {
      status: {
        $in: [...LIVE_EVENT_STATUSES],
      },
      studioResourceIds: {
        $in: [...input.studioResourceIds],
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
    studioResourceIds: [...event.studioResourceIds],
    platformAccountIds: [...event.platformAccountIds],
    status: event.status,
    eventStartAt: event.eventStartAt,
    eventEndAt: event.eventEndAt,
    description: event.description,
    externalRef: event.externalRef,
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
