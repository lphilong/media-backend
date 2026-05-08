import {
  ClientSession,
  Collection,
  Db,
} from "mongodb";
import {
  TalentKpiEventReadonlyAccess,
  TalentKpiReferencedEvent,
} from "@modules/talent-kpi/domain/talent-kpi-event-readonly-access";
import {
  TalentKpiPlatformAccountReadonlyAccess,
  TalentKpiReferencedPlatformAccount,
} from "@modules/talent-kpi/domain/talent-kpi-platform-account-readonly-access";
import {
  TalentKpiReferencedTalent,
  TalentKpiTalentReadonlyAccess,
} from "@modules/talent-kpi/domain/talent-kpi-talent-readonly-access";
import { EventStatus } from "@modules/event-assignment/domain/event-assignment.types";

interface TalentReferenceDocument {
  readonly _id: string;
}

interface PlatformAccountReferenceDocument {
  readonly _id: string;
}

interface EventReferenceDocument {
  readonly _id: string;
  readonly status: EventStatus;
  readonly platformAccountIds: readonly string[];
}

interface EventAssignmentReferenceDocument {
  readonly _id: string;
  readonly eventId: string;
  readonly assignmentKind:
    | "EMPLOYMENT_PROFILE"
    | "TALENT"
    | "TALENT_GROUP";
  readonly assignmentTalentId: string | null;
  readonly assignmentStatus: "ACTIVE" | "REMOVED";
}

export class NativeMongoTalentKpiTalentReadonlyAccess
  implements TalentKpiTalentReadonlyAccess
{
  private readonly collection: Collection<TalentReferenceDocument>;

  constructor(db: Db) {
    this.collection =
      db.collection<TalentReferenceDocument>("talents");
  }

  async findById(
    talentId: string,
    session?: ClientSession,
  ): Promise<TalentKpiReferencedTalent | null> {
    const document = await this.collection.findOne(
      {
        _id: talentId,
      },
      {
        projection: {
          _id: 1,
        },
        ...(session ? { session } : {}),
      },
    );

    return document
      ? {
          id: document._id,
        }
      : null;
  }
}

export class NativeMongoTalentKpiPlatformAccountReadonlyAccess
  implements TalentKpiPlatformAccountReadonlyAccess
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
  ): Promise<TalentKpiReferencedPlatformAccount | null> {
    const document = await this.collection.findOne(
      {
        _id: platformAccountId,
      },
      {
        projection: {
          _id: 1,
        },
        ...(session ? { session } : {}),
      },
    );

    return document
      ? {
          id: document._id,
        }
      : null;
  }
}

export class NativeMongoTalentKpiEventReadonlyAccess
  implements TalentKpiEventReadonlyAccess
{
  private readonly eventCollection: Collection<EventReferenceDocument>;
  private readonly assignmentCollection: Collection<EventAssignmentReferenceDocument>;

  constructor(db: Db) {
    this.eventCollection =
      db.collection<EventReferenceDocument>("events");
    this.assignmentCollection =
      db.collection<EventAssignmentReferenceDocument>(
        "event_assignments",
      );
  }

  async findById(
    eventId: string,
    session?: ClientSession,
  ): Promise<TalentKpiReferencedEvent | null> {
    const document = await this.eventCollection.findOne(
      {
        _id: eventId,
      },
      {
        projection: {
          _id: 1,
          status: 1,
          platformAccountIds: 1,
        },
        ...(session ? { session } : {}),
      },
    );

    return document
      ? {
          id: document._id,
          status: document.status,
          platformAccountIds: [
            ...document.platformAccountIds,
          ],
        }
      : null;
  }

  async hasActiveTalentAssignment(
    eventId: string,
    talentId: string,
    session?: ClientSession,
  ): Promise<boolean> {
    const document =
      await this.assignmentCollection.findOne(
        {
          eventId,
          assignmentKind: "TALENT",
          assignmentTalentId: talentId,
          assignmentStatus: "ACTIVE",
        },
        {
          projection: {
            _id: 1,
          },
          ...(session ? { session } : {}),
        },
      );

    return document !== null;
  }
}
