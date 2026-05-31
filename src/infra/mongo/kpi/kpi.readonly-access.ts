import { ClientSession, Collection, Db } from "mongodb";
import { BaseRepository } from "@infra/database/repository";
import {
  KpiActorEmploymentProfileLookup,
  KpiActorTalentLookup,
  KpiGroupMemberLookup,
  KpiManagedMemberLookup,
  KpiSubjectReadonlyAccess,
} from "@modules/kpi/domain/kpi-subject-readonly-access";

interface TalentDocument {
  readonly _id: string;
  readonly talentCode?: string;
  readonly displayName?: string;
  readonly stageName?: string | null;
  readonly talentOrigin?: string;
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
  readonly employeeCode?: string;
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
    this.employmentProfileCollection = db.collection<EmploymentProfileDocument>(
      "employment_profiles",
    );
  }

  async hasActiveTalent(
    talentId: string,
    session?: ClientSession,
  ): Promise<boolean> {
    const doc = await this.collection.findOne(
      { _id: talentId, operationalStatus: "ACTIVE" },
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
    const employmentProfile = talent?.linkedEmploymentProfileId
      ? await this.employmentProfileCollection.findOne(
          {
            _id: talent.linkedEmploymentProfileId,
          },
          this.withSession(session),
        )
      : null;

    return {
      membershipId: member._id,
      talentId: member.talentId,
      employmentProfileId: talent?.linkedEmploymentProfileId ?? null,
      displayName:
        employmentProfile?.displayName ?? talent?.displayName ?? null,
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
        operationalStatus: "ACTIVE",
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

  async listActiveInternalGroupMembers(
    groupId: string,
    input: { readonly search?: string; readonly limit: number },
    session?: ClientSession,
  ): Promise<readonly KpiManagedMemberLookup[]> {
    const members = await this.memberCollection
      .find(
        {
          groupId,
          membershipStatus: "ACTIVE",
        },
        {
          ...this.withSession(session),
          projection: { _id: 1, groupId: 1, talentId: 1 },
        },
      )
      .toArray();
    if (members.length === 0) {
      return [];
    }

    const talents = await this.collection
      .find(
        {
          _id: { $in: members.map((member) => member.talentId) },
          talentOrigin: "INTERNAL",
          operationalStatus: "ACTIVE",
          linkedEmploymentProfileId: { $type: "string" },
        },
        {
          ...this.withSession(session),
          projection: {
            _id: 1,
            talentCode: 1,
            displayName: 1,
            stageName: 1,
            linkedEmploymentProfileId: 1,
          },
        },
      )
      .toArray();
    if (talents.length === 0) {
      return [];
    }
    const talentsById = new Map(talents.map((talent) => [talent._id, talent]));
    const employmentProfileIds = talents
      .map((talent) => talent.linkedEmploymentProfileId)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    const profiles = await this.employmentProfileCollection
      .find(
        {
          _id: { $in: employmentProfileIds },
          employmentStatus: "ACTIVE",
        },
        {
          ...this.withSession(session),
          projection: { _id: 1, employeeCode: 1, displayName: 1 },
        },
      )
      .toArray();
    const profilesById = new Map(
      profiles.map((profile) => [profile._id, profile]),
    );
    const normalizedSearch = input.search?.trim().toLocaleLowerCase("en-US");

    return members
      .map((member): KpiManagedMemberLookup | null => {
        const talent = talentsById.get(member.talentId);
        const employmentProfileId = talent?.linkedEmploymentProfileId;
        const profile = employmentProfileId
          ? profilesById.get(employmentProfileId)
          : undefined;
        if (!talent || !profile || !employmentProfileId) {
          return null;
        }
        const displayName =
          profile.displayName?.trim() ||
          talent.displayName?.trim() ||
          talent.talentCode?.trim() ||
          employmentProfileId;
        const row: KpiManagedMemberLookup = {
          employmentProfileId,
          employeeCode: profile.employeeCode ?? null,
          displayName,
          talentId: talent._id,
          talentCode: talent.talentCode ?? null,
          groupId,
        };
        if (!normalizedSearch) {
          return row;
        }
        const haystack = [
          row.displayName,
          row.employeeCode,
          row.talentCode,
          row.employmentProfileId,
          row.talentId,
        ]
          .filter((value): value is string => Boolean(value))
          .join(" ")
          .toLocaleLowerCase("en-US");
        return haystack.includes(normalizedSearch) ? row : null;
      })
      .filter((row): row is KpiManagedMemberLookup => row !== null)
      .sort((left, right) => left.displayName.localeCompare(right.displayName))
      .slice(0, input.limit);
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
