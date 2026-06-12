import {
  ClientSession,
  Collection,
  Db,
} from "mongodb";
import {
  EventAssignmentEmploymentProfileReadonlyAccess,
  EventAssignmentReferencedEmploymentProfile,
} from "@modules/event-assignment/domain/event-assignment-employment-profile-readonly-access";
import {
  EventAssignmentReferencedPlatformAccount,
  EventAssignmentPlatformAccountReadonlyAccess,
} from "@modules/event-assignment/domain/event-assignment-platform-account-readonly-access";
import {
  EventAssignmentReferencedStudioResource,
  EventAssignmentStudioResourceReadonlyAccess,
} from "@modules/event-assignment/domain/event-assignment-studio-resource-readonly-access";
import {
  EventAssignmentReferencedTalent,
  EventAssignmentTalentReadonlyAccess,
} from "@modules/event-assignment/domain/event-assignment-talent-readonly-access";
import {
  EventAssignmentReferencedTalentGroup,
  EventAssignmentTalentGroupReadonlyAccess,
} from "@modules/event-assignment/domain/event-assignment-talent-group-readonly-access";
import { EmploymentProfileEventAssignmentReadonlyAccess } from "@modules/employment-profile/domain/employment-profile-event-assignment-readonly-access";
import { PlatformAccountEventAssignmentReadonlyAccess } from "@modules/platform-account/domain/platform-account-event-assignment-readonly-access";
import { StudioResourceEventAssignmentReadonlyAccess } from "@modules/studio-resource/domain/studio-resource-event-assignment-readonly-access";
import { TalentEventAssignmentReadonlyAccess } from "@modules/talent/domain/talent-event-assignment-readonly-access";
import { TalentGroupEventAssignmentReadonlyAccess } from "@modules/talent-group/domain/talent-group-event-assignment-readonly-access";

const LIVE_EVENT_STATUSES = [
  "PLANNED",
  "CONFIRMED",
] as const;

type LiveEventStatus =
  (typeof LIVE_EVENT_STATUSES)[number];

interface EmploymentProfileReferenceDocument {
  readonly _id: string;
  readonly employmentStatus: EventAssignmentReferencedEmploymentProfile["employmentStatus"];
}

interface TalentReferenceDocument {
  readonly _id: string;
  readonly operationalStatus: EventAssignmentReferencedTalent["operationalStatus"];
}

interface TalentGroupReferenceDocument {
  readonly _id: string;
  readonly status: EventAssignmentReferencedTalentGroup["status"];
}

interface StudioResourceReferenceDocument {
  readonly _id: string;
  readonly operationalStatus: EventAssignmentReferencedStudioResource["operationalStatus"];
}

interface PlatformAccountReferenceDocument {
  readonly _id: string;
  readonly operationalStatus: EventAssignmentReferencedPlatformAccount["operationalStatus"];
  readonly livestreamEnabled: boolean;
  readonly contentPublishingEnabled: boolean;
}

interface EventGuardDocument {
  readonly _id: string;
  readonly status:
    | "DRAFT"
    | LiveEventStatus
    | "COMPLETED"
    | "CANCELLED"
    | "ARCHIVED";
  readonly eventEndAt: number;
  readonly studioResourceIds: readonly string[];
  readonly platformAccountIds: readonly string[];
}

interface StudioBookingGuardDocument {
  readonly _id: string;
  readonly studioResourceId: string;
  readonly bookingEndAt: number;
  readonly status: "HELD" | "CONFIRMED" | "RELEASED" | "CANCELLED";
}

interface EventAssignmentGuardDocument {
  readonly _id: string;
  readonly eventId: string;
  readonly assignmentKind:
    | "EMPLOYMENT_PROFILE"
    | "TALENT"
    | "TALENT_GROUP";
  readonly assignmentEmploymentProfileId: string | null;
  readonly assignmentTalentId: string | null;
  readonly assignmentTalentGroupId: string | null;
  readonly assignmentStatus: "ACTIVE" | "REMOVED";
}

export class NativeMongoEventAssignmentEmploymentProfileReadonlyAccess
  implements EventAssignmentEmploymentProfileReadonlyAccess
{
  private readonly collection: Collection<EmploymentProfileReferenceDocument>;

  constructor(db: Db) {
    this.collection =
      db.collection<EmploymentProfileReferenceDocument>(
        "employment_profiles",
      );
  }

  async findById(
    employmentProfileId: string,
    session?: ClientSession,
  ): Promise<EventAssignmentReferencedEmploymentProfile | null> {
    const doc = await this.collection.findOne(
      {
        _id: employmentProfileId,
      },
      {
        projection: {
          _id: 1,
          employmentStatus: 1,
        },
        ...(session ? { session } : {}),
      },
    );

    return doc
      ? {
          id: doc._id,
          employmentStatus: doc.employmentStatus,
        }
      : null;
  }
}

export class NativeMongoEventAssignmentTalentReadonlyAccess
  implements EventAssignmentTalentReadonlyAccess
{
  private readonly collection: Collection<TalentReferenceDocument>;

  constructor(db: Db) {
    this.collection =
      db.collection<TalentReferenceDocument>("talents");
  }

  async findById(
    talentId: string,
    session?: ClientSession,
  ): Promise<EventAssignmentReferencedTalent | null> {
    const doc = await this.collection.findOne(
      {
        _id: talentId,
      },
      {
        projection: {
          _id: 1,
          operationalStatus: 1,
        },
        ...(session ? { session } : {}),
      },
    );

    return doc
      ? {
          id: doc._id,
          operationalStatus:
            doc.operationalStatus,
        }
      : null;
  }
}

export class NativeMongoEventAssignmentTalentGroupReadonlyAccess
  implements EventAssignmentTalentGroupReadonlyAccess
{
  private readonly collection: Collection<TalentGroupReferenceDocument>;

  constructor(db: Db) {
    this.collection =
      db.collection<TalentGroupReferenceDocument>(
        "talent_groups",
      );
  }

  async findById(
    talentGroupId: string,
    session?: ClientSession,
  ): Promise<EventAssignmentReferencedTalentGroup | null> {
    const doc = await this.collection.findOne(
      {
        _id: talentGroupId,
      },
      {
        projection: {
          _id: 1,
          status: 1,
        },
        ...(session ? { session } : {}),
      },
    );

    return doc
      ? {
          id: doc._id,
          status: doc.status,
        }
      : null;
  }
}

export class NativeMongoEventAssignmentStudioResourceReadonlyAccess
  implements EventAssignmentStudioResourceReadonlyAccess
{
  private readonly collection: Collection<StudioResourceReferenceDocument>;

  constructor(db: Db) {
    this.collection =
      db.collection<StudioResourceReferenceDocument>(
        "studio_resources",
      );
  }

  async findById(
    studioResourceId: string,
    session?: ClientSession,
  ): Promise<EventAssignmentReferencedStudioResource | null> {
    const doc = await this.collection.findOne(
      {
        _id: studioResourceId,
      },
      {
        projection: {
          _id: 1,
          operationalStatus: 1,
        },
        ...(session ? { session } : {}),
      },
    );

    return doc
      ? {
          id: doc._id,
          operationalStatus:
            doc.operationalStatus,
        }
      : null;
  }
}

export class NativeMongoEventAssignmentPlatformAccountReadonlyAccess
  implements EventAssignmentPlatformAccountReadonlyAccess
{
  private readonly collection: Collection<PlatformAccountReferenceDocument>;

  constructor(db: Db) {
    this.collection =
      db.collection<PlatformAccountReferenceDocument>(
        "platform_accounts",
      );
  }

  async findById(
    platformAccountId: string,
    session?: ClientSession,
  ): Promise<EventAssignmentReferencedPlatformAccount | null> {
    const doc = await this.collection.findOne(
      {
        _id: platformAccountId,
      },
      {
        projection: {
          _id: 1,
          operationalStatus: 1,
          livestreamEnabled: 1,
          contentPublishingEnabled: 1,
        },
        ...(session ? { session } : {}),
      },
    );

    return doc
      ? {
          id: doc._id,
          operationalStatus:
            doc.operationalStatus,
          livestreamEnabled: doc.livestreamEnabled,
          contentPublishingEnabled:
            doc.contentPublishingEnabled,
        }
      : null;
  }
}

export class NativeMongoEmploymentProfileEventAssignmentReadonlyAccess
  implements EmploymentProfileEventAssignmentReadonlyAccess
{
  private readonly eventCollection: Collection<EventGuardDocument>;
  private readonly assignmentCollection: Collection<EventAssignmentGuardDocument>;

  constructor(db: Db) {
    this.eventCollection =
      db.collection<EventGuardDocument>("events");
    this.assignmentCollection =
      db.collection<EventAssignmentGuardDocument>(
        "event_assignments",
      );
  }

  async hasLiveEventBindingForEmploymentProfile(
    employmentProfileId: string,
    evaluationTime: number,
    session?: ClientSession,
  ): Promise<boolean> {
    return hasLiveAssignmentBinding({
      eventCollection: this.eventCollection,
      assignmentCollection: this.assignmentCollection,
      assignmentMatch: {
        assignmentStatus: "ACTIVE",
        assignmentKind: "EMPLOYMENT_PROFILE",
        assignmentEmploymentProfileId:
          employmentProfileId,
      },
      evaluationTime,
      session,
    });
  }
}

export class NativeMongoTalentEventAssignmentReadonlyAccess
  implements TalentEventAssignmentReadonlyAccess
{
  private readonly eventCollection: Collection<EventGuardDocument>;
  private readonly assignmentCollection: Collection<EventAssignmentGuardDocument>;

  constructor(db: Db) {
    this.eventCollection =
      db.collection<EventGuardDocument>("events");
    this.assignmentCollection =
      db.collection<EventAssignmentGuardDocument>(
        "event_assignments",
      );
  }

  async hasLiveEventBindingForTalent(
    talentId: string,
    evaluationTime: number,
    session?: ClientSession,
  ): Promise<boolean> {
    return hasLiveAssignmentBinding({
      eventCollection: this.eventCollection,
      assignmentCollection: this.assignmentCollection,
      assignmentMatch: {
        assignmentStatus: "ACTIVE",
        assignmentKind: "TALENT",
        assignmentTalentId: talentId,
      },
      evaluationTime,
      session,
    });
  }
}

export class NativeMongoTalentGroupEventAssignmentReadonlyAccess
  implements TalentGroupEventAssignmentReadonlyAccess
{
  private readonly eventCollection: Collection<EventGuardDocument>;
  private readonly assignmentCollection: Collection<EventAssignmentGuardDocument>;

  constructor(db: Db) {
    this.eventCollection =
      db.collection<EventGuardDocument>("events");
    this.assignmentCollection =
      db.collection<EventAssignmentGuardDocument>(
        "event_assignments",
      );
  }

  async hasLiveEventBindingForTalentGroup(
    groupId: string,
    evaluationTime: number,
    session?: ClientSession,
  ): Promise<boolean> {
    return hasLiveAssignmentBinding({
      eventCollection: this.eventCollection,
      assignmentCollection: this.assignmentCollection,
      assignmentMatch: {
        assignmentStatus: "ACTIVE",
        assignmentKind: "TALENT_GROUP",
        assignmentTalentGroupId: groupId,
      },
      evaluationTime,
      session,
    });
  }
}

export class NativeMongoStudioResourceEventAssignmentReadonlyAccess
  implements StudioResourceEventAssignmentReadonlyAccess
{
  private readonly bookingCollection: Collection<StudioBookingGuardDocument>;

  constructor(db: Db) {
    this.bookingCollection =
      db.collection<StudioBookingGuardDocument>("studio_bookings");
  }

  async hasLiveEventAllocationForStudioResource(
    studioResourceId: string,
    evaluationTime: number,
    session?: ClientSession,
  ): Promise<boolean> {
    const doc = await this.bookingCollection.findOne(
      {
        status: { $in: ["HELD", "CONFIRMED"] },
        bookingEndAt: {
          $gt: evaluationTime,
        },
        studioResourceId,
      },
      {
        projection: {
          _id: 1,
        },
        ...(session ? { session } : {}),
      },
    );

    return doc !== null;
  }
}

export class NativeMongoPlatformAccountEventAssignmentReadonlyAccess
  implements PlatformAccountEventAssignmentReadonlyAccess
{
  private readonly eventCollection: Collection<EventGuardDocument>;

  constructor(db: Db) {
    this.eventCollection =
      db.collection<EventGuardDocument>("events");
  }

  async hasLiveEventAllocationForPlatformAccount(
    platformAccountId: string,
    evaluationTime: number,
    session?: ClientSession,
  ): Promise<boolean> {
    const doc = await this.eventCollection.findOne(
      {
        status: {
          $in: [...LIVE_EVENT_STATUSES],
        },
        eventEndAt: {
          $gt: evaluationTime,
        },
        platformAccountIds: platformAccountId,
      },
      {
        projection: {
          _id: 1,
        },
        ...(session ? { session } : {}),
      },
    );

    return doc !== null;
  }
}

async function hasLiveAssignmentBinding(params: {
  readonly eventCollection: Collection<EventGuardDocument>;
  readonly assignmentCollection: Collection<EventAssignmentGuardDocument>;
  readonly assignmentMatch: Record<string, unknown>;
  readonly evaluationTime: number;
  readonly session?: ClientSession;
}): Promise<boolean> {
  const docs = await params.assignmentCollection
    .aggregate(
      [
        {
          $match: params.assignmentMatch,
        },
        {
          $lookup: {
            from:
              params.eventCollection.collectionName,
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
            "event.eventEndAt": {
              $gt: params.evaluationTime,
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
      ],
      {
        ...(params.session
          ? { session: params.session }
          : {}),
      },
    )
    .toArray();

  return docs.length > 0;
}
