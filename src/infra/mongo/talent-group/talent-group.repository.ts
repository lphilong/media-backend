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
import { BaseRepository } from "@infra/database/repository";
import {
  FindLiveTalentGroupByNormalizedNameInput,
  FindLiveTalentGroupMemberByLineupInput,
  FindLiveTalentGroupMemberByTalentInput,
  TalentGroupRepository,
  TransitionTalentGroupMemberStatusInput,
  TransitionTalentGroupStatusInput,
  UpdateTalentGroupCoreInput,
  UpdateTalentGroupMemberLineupInput,
} from "@modules/talent-group/domain/talent-group.repository";
import {
  TalentGroupMemberRecord,
  TalentGroupMemberStatus,
  TalentGroupRecord,
  TalentGroupStatus,
} from "@modules/talent-group/domain/talent-group.types";

interface TalentGroupDocument {
  readonly _id: string;
  readonly groupCode: string;
  readonly name: string;
  readonly normalizedName: string;
  readonly shortName: string | null;
  readonly normalizedShortName: string | null;
  readonly description: string | null;
  readonly externalRef: string | null;
  readonly status: TalentGroupStatus;
  readonly displayOrder: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

interface TalentGroupMemberDocument {
  readonly _id: string;
  readonly groupId: string;
  readonly talentId: string;
  readonly membershipStatus: TalentGroupMemberStatus;
  readonly lineupOrder: number;
  readonly joinedAt: number;
  readonly leftAt: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export class NativeMongoTalentGroupRepository
  extends BaseRepository<TalentGroupDocument>
  implements TalentGroupRepository
{
  private readonly memberCollection: Collection<TalentGroupMemberDocument>;

  constructor(db: Db) {
    super(db, "talent_groups");
    this.memberCollection =
      db.collection<TalentGroupMemberDocument>(
        "talent_group_members",
      );
  }

  async insertGroup(
    group: TalentGroupRecord,
    session: ClientSession,
  ): Promise<TalentGroupRecord> {
    await this.collection.insertOne(
      toTalentGroupDocument(group),
      this.withSession(session),
    );

    return group;
  }

  async findGroupById(
    groupId: string,
    session?: ClientSession,
  ): Promise<TalentGroupRecord | null> {
    const doc = await this.collection.findOne(
      { _id: groupId },
      this.withSession(session),
    );

    return doc ? toTalentGroupRecord(doc) : null;
  }

  async findGroupByCode(
    groupCode: string,
    session?: ClientSession,
  ): Promise<TalentGroupRecord | null> {
    const doc = await this.collection.findOne(
      { groupCode },
      this.withSession(session),
    );

    return doc ? toTalentGroupRecord(doc) : null;
  }

  async findMaxGeneratedCodeSequence(
    policy: Pick<BusinessCodePolicy, "prefix" | "width">,
    session?: ClientSession,
  ): Promise<number> {
    const doc = await this.collection
      .find(
        {
          groupCode:
            buildGeneratedBusinessCodeRegex(policy),
        },
        this.withSession(session),
      )
      .sort({ groupCode: -1 })
      .limit(1)
      .next();

    if (!doc) {
      return 0;
    }

    return (
      parseGeneratedBusinessCodeSequence(
        doc.groupCode,
        policy,
      ) ?? 0
    );
  }

  async findLiveGroupByNormalizedName(
    input: FindLiveTalentGroupByNormalizedNameInput,
    session?: ClientSession,
  ): Promise<TalentGroupRecord | null> {
    const filter: Record<string, unknown> = {
      normalizedName: input.normalizedName,
      status: {
        $ne: "ARCHIVED",
      },
    };

    if (input.excludeGroupId) {
      filter._id = {
        $ne: input.excludeGroupId,
      };
    }

    const doc = await this.collection.findOne(
      filter,
      this.withSession(session),
    );

    return doc ? toTalentGroupRecord(doc) : null;
  }

  async updateGroupCore(
    input: UpdateTalentGroupCoreInput,
    session: ClientSession,
  ): Promise<TalentGroupRecord | null> {
    const set: Record<string, unknown> = {
      updatedAt: input.updatedAt,
    };

    if (input.name !== undefined) {
      set.name = input.name;
    }

    if (input.normalizedName !== undefined) {
      set.normalizedName = input.normalizedName;
    }

    if (input.shortName !== undefined) {
      set.shortName = input.shortName;
    }

    if (input.normalizedShortName !== undefined) {
      set.normalizedShortName =
        input.normalizedShortName;
    }

    if (input.description !== undefined) {
      set.description = input.description;
    }

    if (input.externalRef !== undefined) {
      set.externalRef = input.externalRef;
    }

    if (input.displayOrder !== undefined) {
      set.displayOrder = input.displayOrder;
    }

    const updated =
      await this.collection.findOneAndUpdate(
        { _id: input.groupId },
        {
          $set: set,
        },
        {
          ...this.withSession(session),
          returnDocument: "after",
        },
      );

    return updated
      ? toTalentGroupRecord(updated)
      : null;
  }

  async transitionGroupStatus(
    input: TransitionTalentGroupStatusInput,
    session: ClientSession,
  ): Promise<TalentGroupRecord | null> {
    const updated =
      await this.collection.findOneAndUpdate(
        {
          _id: input.groupId,
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

    return updated
      ? toTalentGroupRecord(updated)
      : null;
  }

  async insertMember(
    member: TalentGroupMemberRecord,
    session: ClientSession,
  ): Promise<TalentGroupMemberRecord> {
    await this.memberCollection.insertOne(
      toTalentGroupMemberDocument(member),
      this.withSession(session),
    );

    return member;
  }

  async findMemberById(
    membershipId: string,
    session?: ClientSession,
  ): Promise<TalentGroupMemberRecord | null> {
    const doc =
      await this.memberCollection.findOne(
        { _id: membershipId },
        this.withSession(session),
      );

    return doc ? toTalentGroupMemberRecord(doc) : null;
  }

  async findLiveMemberByGroupAndTalent(
    input: FindLiveTalentGroupMemberByTalentInput,
    session?: ClientSession,
  ): Promise<TalentGroupMemberRecord | null> {
    const filter: Record<string, unknown> = {
      groupId: input.groupId,
      talentId: input.talentId,
      membershipStatus: {
        $ne: "REMOVED",
      },
    };

    if (input.excludeMembershipId) {
      filter._id = {
        $ne: input.excludeMembershipId,
      };
    }

    const doc =
      await this.memberCollection.findOne(
        filter,
        this.withSession(session),
      );

    return doc ? toTalentGroupMemberRecord(doc) : null;
  }

  async findLiveMemberByGroupAndLineup(
    input: FindLiveTalentGroupMemberByLineupInput,
    session?: ClientSession,
  ): Promise<TalentGroupMemberRecord | null> {
    const filter: Record<string, unknown> = {
      groupId: input.groupId,
      lineupOrder: input.lineupOrder,
      membershipStatus: {
        $ne: "REMOVED",
      },
    };

    if (input.excludeMembershipId) {
      filter._id = {
        $ne: input.excludeMembershipId,
      };
    }

    const doc =
      await this.memberCollection.findOne(
        filter,
        this.withSession(session),
      );

    return doc ? toTalentGroupMemberRecord(doc) : null;
  }

  async updateMemberLineup(
    input: UpdateTalentGroupMemberLineupInput,
    session: ClientSession,
  ): Promise<TalentGroupMemberRecord | null> {
    const updated =
      await this.memberCollection.findOneAndUpdate(
        { _id: input.membershipId },
        {
          $set: {
            lineupOrder: input.lineupOrder,
            updatedAt: input.updatedAt,
          },
        },
        {
          ...this.withSession(session),
          returnDocument: "after",
        },
      );

    return updated
      ? toTalentGroupMemberRecord(updated)
      : null;
  }

  async transitionMemberStatus(
    input: TransitionTalentGroupMemberStatusInput,
    session: ClientSession,
  ): Promise<TalentGroupMemberRecord | null> {
    const set: Record<string, unknown> = {
      membershipStatus: input.toStatus,
      updatedAt: input.updatedAt,
    };

    if (input.leftAt !== undefined) {
      set.leftAt = input.leftAt;
    }

    const updated =
      await this.memberCollection.findOneAndUpdate(
        {
          _id: input.membershipId,
          membershipStatus: {
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

    return updated
      ? toTalentGroupMemberRecord(updated)
      : null;
  }

  async hasActiveMembers(
    groupId: string,
    session?: ClientSession,
  ): Promise<boolean> {
    const doc =
      await this.memberCollection.findOne(
        {
          groupId,
          membershipStatus: "ACTIVE",
        },
        {
          ...this.withSession(session),
          projection: { _id: 1 },
        },
      );

    return doc !== null;
  }

  async hasNonRemovedMembers(
    groupId: string,
    session?: ClientSession,
  ): Promise<boolean> {
    const doc =
      await this.memberCollection.findOne(
        {
          groupId,
          membershipStatus: {
            $ne: "REMOVED",
          },
        },
        {
          ...this.withSession(session),
          projection: { _id: 1 },
        },
      );

    return doc !== null;
  }
}

function toTalentGroupDocument(
  group: TalentGroupRecord,
): TalentGroupDocument {
  return {
    _id: group.id,
    groupCode: group.groupCode,
    name: group.name,
    normalizedName: group.normalizedName,
    shortName: group.shortName,
    normalizedShortName: group.normalizedShortName,
    description: group.description,
    externalRef: group.externalRef,
    status: group.status,
    displayOrder: group.displayOrder,
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
  };
}

function toTalentGroupRecord(
  doc: TalentGroupDocument,
): TalentGroupRecord {
  return {
    id: doc._id,
    groupCode: doc.groupCode,
    name: doc.name,
    normalizedName: doc.normalizedName,
    shortName: doc.shortName,
    normalizedShortName: doc.normalizedShortName,
    description: doc.description,
    externalRef: doc.externalRef,
    status: doc.status,
    displayOrder: doc.displayOrder,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function toTalentGroupMemberDocument(
  member: TalentGroupMemberRecord,
): TalentGroupMemberDocument {
  return {
    _id: member.id,
    groupId: member.groupId,
    talentId: member.talentId,
    membershipStatus: member.membershipStatus,
    lineupOrder: member.lineupOrder,
    joinedAt: member.joinedAt,
    leftAt: member.leftAt,
    createdAt: member.createdAt,
    updatedAt: member.updatedAt,
  };
}

function toTalentGroupMemberRecord(
  doc: TalentGroupMemberDocument,
): TalentGroupMemberRecord {
  return {
    id: doc._id,
    groupId: doc.groupId,
    talentId: doc.talentId,
    membershipStatus: doc.membershipStatus,
    lineupOrder: doc.lineupOrder,
    joinedAt: doc.joinedAt,
    leftAt: doc.leftAt,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}
