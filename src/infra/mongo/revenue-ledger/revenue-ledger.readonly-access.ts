import {
  ClientSession,
  Collection,
  Db,
} from "mongodb";
import {
  RevenueLedgerCommissionFinalizedSettlementReference,
  RevenueLedgerCommissionReadonlyAccess,
} from "@modules/revenue-ledger/domain/revenue-ledger-commission-readonly-access";
import {
  RevenueLedgerEventReadonlyAccess,
  RevenueLedgerReferencedEvent,
} from "@modules/revenue-ledger/domain/revenue-ledger-event-readonly-access";
import {
  RevenueLedgerPlatformAccountReadonlyAccess,
  RevenueLedgerReferencedPlatformAccount,
} from "@modules/revenue-ledger/domain/revenue-ledger-platform-account-readonly-access";
import {
  RevenueLedgerReferencedTalent,
  RevenueLedgerTalentReadonlyAccess,
} from "@modules/revenue-ledger/domain/revenue-ledger-talent-readonly-access";
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

interface CommissionSettlementReferenceDocument {
  readonly _id: string;
  readonly status: "FINALIZED" | "VOIDED" | "ARCHIVED" | "DRAFT";
}

interface CommissionSettlementLineReferenceDocument {
  readonly _id: string;
  readonly settlementId: string;
  readonly revenueEntryId: string;
}

export class NativeMongoRevenueLedgerTalentReadonlyAccess
  implements RevenueLedgerTalentReadonlyAccess
{
  private readonly collection: Collection<TalentReferenceDocument>;

  constructor(db: Db) {
    this.collection =
      db.collection<TalentReferenceDocument>("talents");
  }

  async findById(
    talentId: string,
    session?: ClientSession,
  ): Promise<RevenueLedgerReferencedTalent | null> {
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

export class NativeMongoRevenueLedgerPlatformAccountReadonlyAccess
  implements RevenueLedgerPlatformAccountReadonlyAccess
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
  ): Promise<RevenueLedgerReferencedPlatformAccount | null> {
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

export class NativeMongoRevenueLedgerEventReadonlyAccess
  implements RevenueLedgerEventReadonlyAccess
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
  ): Promise<RevenueLedgerReferencedEvent | null> {
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

export class NativeMongoRevenueLedgerCommissionReadonlyAccess
  implements RevenueLedgerCommissionReadonlyAccess
{
  private readonly settlementCollection: Collection<CommissionSettlementReferenceDocument>;
  private readonly settlementLineCollection: Collection<CommissionSettlementLineReferenceDocument>;

  constructor(db: Db) {
    this.settlementCollection =
      db.collection<CommissionSettlementReferenceDocument>(
        "commission_settlements",
      );
    this.settlementLineCollection =
      db.collection<CommissionSettlementLineReferenceDocument>(
        "commission_settlement_lines",
      );
  }

  async findFinalizedSettlementReferenceByRevenueEntryId(
    revenueEntryId: string,
    session?: ClientSession,
  ): Promise<RevenueLedgerCommissionFinalizedSettlementReference | null> {
    const matches = await this.settlementLineCollection
      .aggregate<{ settlementId: string }>(
        [
          {
            $match: {
              revenueEntryId,
            },
          },
          {
            $lookup: {
              from: this.settlementCollection.collectionName,
              localField: "settlementId",
              foreignField: "_id",
              as: "settlement",
            },
          },
          {
            $unwind: "$settlement",
          },
          {
            $match: {
              "settlement.status": "FINALIZED",
            },
          },
          {
            $project: {
              _id: 0,
              settlementId: "$settlement._id",
            },
          },
          {
            $limit: 1,
          },
        ],
        session ? { session } : undefined,
      )
      .toArray();

    const match = matches[0];
    if (!match) {
      return null;
    }

    return {
      commissionSettlementId: match.settlementId,
    };
  }
}
