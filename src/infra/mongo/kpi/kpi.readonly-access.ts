import { ClientSession, Collection, Db } from "mongodb";
import { BaseRepository } from "@infra/database/repository";
import {
  KpiActorEmploymentProfileLookup,
  KpiActorTalentLookup,
  KpiGroupMemberLookup,
  KpiSubjectReadonlyAccess,
} from "@modules/kpi/domain/kpi-subject-readonly-access";

interface TalentDocument {
  readonly _id: string;
  readonly displayName?: string;
  readonly stageName?: string | null;
  readonly status: string;
  readonly operationalStatus?: string;
  readonly linkedEmploymentProfileId?: string | null;
}

interface TalentGroupDocument {
  readonly _id: string;
  readonly status: string;
}

interface TalentGroupMemberDocument {
  readonly _id: string;
  readonly groupId: string;
  readonly talentId: string;
  readonly membershipStatus: string;
}

interface EmploymentProfileDocument {
  readonly _id: string;
  readonly linkedUserId: string | null;
  readonly employmentStatus: string;
  readonly displayName?: string;
}

export class NativeMongoKpiSubjectReadonlyAccess
  extends BaseRepository<TalentDocument>
  implements KpiSubjectReadonlyAccess
{
  private readonly groupCollection: Collection<TalentGroupDocument>;
  private readonly memberCollection: Collection<TalentGroupMemberDocument>;
  private readonly employmentProfileCollection: Collection<EmploymentProfileDocument>;

  constructor(db: Db) {
    super(db, "talents");
    this.groupCollection = db.collection<TalentGroupDocument>("talent_groups");
    this.memberCollection = db.collection<TalentGroupMemberDocument>(
      "talent_group_members",
    );
    this.employmentProfileCollection =
      db.collection<EmploymentProfileDocument>("employment_profiles");
  }

  async hasActiveTalent(
    talentId: string,
    session?: ClientSession,
  ): Promise<boolean> {
    const doc = await this.collection.findOne(
      { _id: talentId, status: "ACTIVE" },
      { ...this.withSession(session), projection: { _id: 1 } },
    );
    return doc !== null;
  }

  async hasActiveTalentGroup(
    groupId: string,
    session?: ClientSession,
  ): Promise<boolean> {
    const doc = await this.groupCollection.findOne(
      { _id: groupId, status: "ACTIVE" },
      { ...this.withSession(session), projection: { _id: 1 } },
    );
    return doc !== null;
  }

  async findActiveGroupMember(
    groupId: string,
    memberTalentId: string,
    session?: ClientSession,
  ): Promise<KpiGroupMemberLookup | null> {
    const member = await this.memberCollection.findOne(
      {
        groupId,
        talentId: memberTalentId,
        membershipStatus: "ACTIVE",
      },
      this.withSession(session),
    );
    if (!member) {
      return null;
    }
    const talent = await this.collection.findOne(
      { _id: memberTalentId },
      this.withSession(session),
    );
    return {
      membershipId: member._id,
      talentId: member.talentId,
      employmentProfileId: talent?.linkedEmploymentProfileId ?? null,
      displayName: talent?.stageName ?? talent?.displayName ?? null,
    };
  }

  async findActiveGroupMemberByEmploymentProfile(
    groupId: string,
    employmentProfileId: string,
    session?: ClientSession,
  ): Promise<KpiGroupMemberLookup | null> {
    const profile = await this.employmentProfileCollection.findOne(
      {
        _id: employmentProfileId,
        employmentStatus: "ACTIVE",
      },
      this.withSession(session),
    );
    if (!profile) {
      return null;
    }
    const talent = await this.collection.findOne(
      {
        linkedEmploymentProfileId: employmentProfileId,
        status: "ACTIVE",
        operationalStatus: { $ne: "ARCHIVED" },
      },
      this.withSession(session),
    );
    if (!talent) {
      return null;
    }
    const member = await this.memberCollection.findOne(
      {
        groupId,
        talentId: talent._id,
        membershipStatus: "ACTIVE",
      },
      this.withSession(session),
    );
    if (!member) {
      return null;
    }
    return {
      membershipId: member._id,
      talentId: member.talentId,
      employmentProfileId,
      displayName:
        profile.displayName ?? talent.stageName ?? talent.displayName ?? null,
    };
  }

  async findActiveEmploymentProfileByLinkedUserId(
    linkedUserId: string,
    session?: ClientSession,
  ): Promise<KpiActorEmploymentProfileLookup | null> {
    const doc = await this.employmentProfileCollection.findOne(
      {
        linkedUserId,
        employmentStatus: { $in: ["ACTIVE", "ON_LEAVE"] },
      },
      { ...this.withSession(session), projection: { _id: 1 } },
    );
    return doc ? { employmentProfileId: doc._id } : null;
  }

  async findNonArchivedTalentByLinkedEmploymentProfileId(
    linkedEmploymentProfileId: string,
    session?: ClientSession,
  ): Promise<KpiActorTalentLookup | null> {
    const doc = await this.collection.findOne(
      {
        linkedEmploymentProfileId,
        operationalStatus: { $ne: "ARCHIVED" },
      },
      { ...this.withSession(session), projection: { _id: 1 } },
    );
    return doc ? { talentId: doc._id } : null;
  }
}
