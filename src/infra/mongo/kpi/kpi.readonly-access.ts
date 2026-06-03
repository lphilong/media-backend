import { ClientSession, Collection, Db } from "mongodb";
import { BaseRepository } from "@infra/database/repository";
import { ReferenceSummary } from "@modules/reference-summary";
import {
  KpiActorEmploymentProfileLookup,
  KpiActorTalentLookup,
  KpiGroupMemberLookup,
  KpiManagedMemberLookup,
  KpiOrgUnitMemberLookup,
  KpiSubjectReferenceLookup,
  KpiSubjectReadonlyAccess,
  kpiSubjectRefKey,
} from "@modules/kpi/domain/kpi-subject-readonly-access";
import { deriveTalentDisplaySummary } from "@modules/talent/domain/talent-display";
import { TalentOrigin } from "@modules/talent/domain/talent.types";

interface TalentDocument {
  readonly _id: string;
  readonly talentCode?: string;
  readonly displayName?: string;
  readonly stageName?: string | null;
  readonly legalName?: string | null;
  readonly displayShortName?: string | null;
  readonly talentOrigin?: string;
  readonly operationalStatus?: string;
  readonly linkedEmploymentProfileId?: string | null;
}

interface TalentGroupDocument {
  readonly _id: string;
  readonly groupCode?: string;
  readonly name?: string;
  readonly status: string;
}

interface OrgUnitDocument {
  readonly _id: string;
  readonly code?: string;
  readonly name?: string;
  readonly type?: string;
  readonly status?: string;
  readonly ancestorChain?: readonly string[];
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
  readonly orgUnitId?: string;
}

export class NativeMongoKpiSubjectReadonlyAccess
  extends BaseRepository<TalentDocument>
  implements KpiSubjectReadonlyAccess
{
  private readonly groupCollection: Collection<TalentGroupDocument>;
  private readonly orgUnitCollection: Collection<OrgUnitDocument>;
  private readonly memberCollection: Collection<TalentGroupMemberDocument>;
  private readonly employmentProfileCollection: Collection<EmploymentProfileDocument>;

  constructor(db: Db) {
    super(db, "talents");
    this.groupCollection = db.collection<TalentGroupDocument>("talent_groups");
    this.orgUnitCollection = db.collection<OrgUnitDocument>("org_units");
    this.memberCollection = db.collection<TalentGroupMemberDocument>(
      "talent_group_members",
    );
    this.employmentProfileCollection = db.collection<EmploymentProfileDocument>(
      "employment_profiles",
    );
  }

  async listSubjectRefs(
    subjects: readonly KpiSubjectReferenceLookup[],
    session?: ClientSession,
  ): Promise<Map<string, ReferenceSummary>> {
    const refs = new Map<string, ReferenceSummary>();
    const groupIds = uniqueSubjectIds(subjects, "TALENT_GROUP");
    const talentIds = uniqueSubjectIds(subjects, "TALENT");
    const orgUnitIds = uniqueSubjectIds(subjects, "ORG_UNIT");

    if (groupIds.length > 0) {
      const groups = await this.groupCollection
        .find(
          { _id: { $in: groupIds } },
          {
            ...this.withSession(session),
            projection: { _id: 1, groupCode: 1, name: 1, status: 1 },
          },
        )
        .toArray();

      for (const group of groups) {
        const name = readText(group.name);
        const code = readText(group.groupCode);
        const status = readText(group.status);
        refs.set(
          kpiSubjectRefKey({
            subjectType: "TALENT_GROUP",
            subjectId: group._id,
          }),
          {
            id: group._id,
            ...(code ? { code } : {}),
            ...(name ? { name, displayName: name } : {}),
            ...(status ? { status } : {}),
          },
        );
      }
    }

    if (talentIds.length > 0) {
      const talents = await this.collection
        .find(
          { _id: { $in: talentIds } },
          {
            ...this.withSession(session),
            projection: {
              _id: 1,
              talentCode: 1,
              stageName: 1,
              legalName: 1,
              displayShortName: 1,
              talentOrigin: 1,
              operationalStatus: 1,
              linkedEmploymentProfileId: 1,
            },
          },
        )
        .toArray();
      const profileIds = talents
        .map((talent) => talent.linkedEmploymentProfileId)
        .filter((id): id is string => typeof id === "string" && id.length > 0);
      const profiles =
        profileIds.length === 0
          ? []
          : await this.employmentProfileCollection
              .find(
                { _id: { $in: [...new Set(profileIds)] } },
                {
                  ...this.withSession(session),
                  projection: { _id: 1, displayName: 1 },
                },
              )
              .toArray();
      const profilesById = new Map(
        profiles.map((profile) => [profile._id, profile]),
      );

      for (const talent of talents) {
        const talentOrigin = toTalentOrigin(talent.talentOrigin);
        const talentCode = readText(talent.talentCode) ?? talent._id;
        if (!talentOrigin) {
          continue;
        }
        const linkedProfile = talent.linkedEmploymentProfileId
          ? profilesById.get(talent.linkedEmploymentProfileId)
          : null;
        const display = deriveTalentDisplaySummary(
          {
            talentCode,
            stageName: talent.stageName,
            legalName: talent.legalName,
            displayShortName: talent.displayShortName,
            talentOrigin,
          },
          linkedProfile ?? null,
        );
        const status = readText(talent.operationalStatus);
        refs.set(
          kpiSubjectRefKey({ subjectType: "TALENT", subjectId: talent._id }),
          {
            id: talent._id,
            code: talentCode,
            displayName: display.displayName,
            ...(status ? { status } : {}),
          },
        );
      }
    }

    if (orgUnitIds.length > 0) {
      const orgUnits = await this.orgUnitCollection
        .find(
          { _id: { $in: orgUnitIds } },
          {
            ...this.withSession(session),
            projection: { _id: 1, code: 1, name: 1, status: 1 },
          },
        )
        .toArray();

      for (const orgUnit of orgUnits) {
        const code = readText(orgUnit.code);
        const name = readText(orgUnit.name);
        const status = readText(orgUnit.status);
        refs.set(
          kpiSubjectRefKey({
            subjectType: "ORG_UNIT",
            subjectId: orgUnit._id,
          }),
          {
            id: orgUnit._id,
            ...(code ? { code } : {}),
            ...(name ? { name, displayName: name } : {}),
            ...(status ? { status } : {}),
          },
        );
      }
    }

    return refs;
  }

  async listTalentGroupIdsByCodeOrName(
    input: { readonly search: string; readonly groupIds?: readonly string[] },
    session?: ClientSession,
  ): Promise<readonly string[]> {
    const search = readText(input.search);
    if (!search) {
      return [];
    }
    const groupIds = uniqueTextValues(input.groupIds ?? []);
    if (input.groupIds !== undefined && groupIds.length === 0) {
      return [];
    }
    const pattern = new RegExp(escapeRegExp(search), "i");
    const docs = await this.groupCollection
      .find(
        {
          ...(input.groupIds !== undefined ? { _id: { $in: groupIds } } : {}),
          $or: [{ groupCode: pattern }, { name: pattern }],
        },
        {
          ...this.withSession(session),
          projection: { _id: 1 },
        },
      )
      .sort({ groupCode: 1, _id: 1 })
      .toArray();
    return docs.map((doc) => doc._id);
  }

  async listActiveOrgUnitIdsByIds(
    orgUnitIds: readonly string[],
    session?: ClientSession,
  ): Promise<readonly string[]> {
    const ids = uniqueTextValues(orgUnitIds);
    if (ids.length === 0) {
      return [];
    }
    const docs = await this.orgUnitCollection
      .find(activeSupportedOrgUnitQuery({ _id: { $in: ids } }), {
        ...this.withSession(session),
        projection: { _id: 1 },
      })
      .sort({ _id: 1 })
      .toArray();
    return docs.map((doc) => doc._id);
  }

  async listActiveOrgUnitDescendantIds(
    ancestorOrgUnitIds: readonly string[],
    session?: ClientSession,
  ): Promise<readonly string[]> {
    const ids = uniqueTextValues(ancestorOrgUnitIds);
    if (ids.length === 0) {
      return [];
    }
    const docs = await this.orgUnitCollection
      .find(activeSupportedOrgUnitQuery({ ancestorChain: { $in: ids } }), {
        ...this.withSession(session),
        projection: { _id: 1 },
      })
      .sort({ _id: 1 })
      .toArray();
    return docs.map((doc) => doc._id);
  }

  async listActiveOrgUnitIdsByCodeOrName(
    input: { readonly search: string; readonly orgUnitIds?: readonly string[] },
    session?: ClientSession,
  ): Promise<readonly string[]> {
    const search = readText(input.search);
    if (!search) {
      return [];
    }
    const orgUnitIds = uniqueTextValues(input.orgUnitIds ?? []);
    if (input.orgUnitIds !== undefined && orgUnitIds.length === 0) {
      return [];
    }
    const pattern = new RegExp(escapeRegExp(search), "i");
    const docs = await this.orgUnitCollection
      .find(
        activeSupportedOrgUnitQuery({
          ...(input.orgUnitIds !== undefined
            ? { _id: { $in: orgUnitIds } }
            : {}),
          $or: [{ code: pattern }, { name: pattern }],
        }),
        {
          ...this.withSession(session),
          projection: { _id: 1 },
        },
      )
      .sort({ code: 1, _id: 1 })
      .toArray();
    return docs.map((doc) => doc._id);
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

  async hasActiveOrgUnit(
    orgUnitId: string,
    session?: ClientSession,
  ): Promise<boolean> {
    const doc = await this.orgUnitCollection.findOne(
      activeSupportedOrgUnitQuery({ _id: orgUnitId }),
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

  async findActiveOrgUnitMemberByEmploymentProfile(
    orgUnitId: string,
    employmentProfileId: string,
    session?: ClientSession,
  ): Promise<KpiOrgUnitMemberLookup | null> {
    const profile = await this.employmentProfileCollection.findOne(
      {
        _id: employmentProfileId,
        orgUnitId,
        employmentStatus: { $in: ["ACTIVE", "ON_LEAVE"] },
      },
      {
        ...this.withSession(session),
        projection: {
          _id: 1,
          employeeCode: 1,
          displayName: 1,
          orgUnitId: 1,
        },
      },
    );
    return profile ? toOrgUnitMemberLookup(profile, orgUnitId) : null;
  }

  async listActiveOrgUnitMembers(
    orgUnitId: string,
    input: { readonly search?: string; readonly limit: number },
    session?: ClientSession,
  ): Promise<readonly KpiOrgUnitMemberLookup[]> {
    const profiles = await this.employmentProfileCollection
      .find(
        {
          orgUnitId,
          employmentStatus: { $in: ["ACTIVE", "ON_LEAVE"] },
        },
        {
          ...this.withSession(session),
          projection: {
            _id: 1,
            employeeCode: 1,
            displayName: 1,
            orgUnitId: 1,
          },
        },
      )
      .toArray();
    const normalizedSearch = input.search?.trim().toLocaleLowerCase("en-US");

    return profiles
      .map((profile) => toOrgUnitMemberLookup(profile, orgUnitId))
      .filter((row): row is KpiOrgUnitMemberLookup => row !== null)
      .filter((row) => {
        if (!normalizedSearch) {
          return true;
        }
        const haystack = [
          row.displayName,
          row.employeeCode,
          row.employmentProfileId,
          row.orgUnitId,
        ]
          .filter((value): value is string => Boolean(value))
          .join(" ")
          .toLocaleLowerCase("en-US");
        return haystack.includes(normalizedSearch);
      })
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

function uniqueSubjectIds(
  subjects: readonly KpiSubjectReferenceLookup[],
  subjectType: KpiSubjectReferenceLookup["subjectType"],
): readonly string[] {
  return uniqueTextValues(
    subjects
      .filter((subject) => subject.subjectType === subjectType)
      .map((subject) => subject.subjectId),
  );
}

function uniqueTextValues(values: readonly string[]): readonly string[] {
  return [
    ...new Set(
      values.map((value) => value.trim()).filter((value) => value.length > 0),
    ),
  ];
}

function toTalentOrigin(value: string | undefined): TalentOrigin | null {
  return value === "INTERNAL" || value === "EXTERNAL" ? value : null;
}

function readText(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function toOrgUnitMemberLookup(
  profile: EmploymentProfileDocument,
  orgUnitId: string,
): KpiOrgUnitMemberLookup | null {
  if (profile.orgUnitId !== orgUnitId) {
    return null;
  }
  const displayName =
    profile.displayName?.trim() ||
    profile.employeeCode?.trim() ||
    profile._id;
  return {
    employmentProfileId: profile._id,
    employeeCode: profile.employeeCode ?? null,
    displayName,
    orgUnitId,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function activeSupportedOrgUnitQuery(
  extra: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...extra,
    status: "ACTIVE",
    type: { $in: ["DEPARTMENT", "TEAM", "BUSINESS_UNIT", "SUPPORT_UNIT"] },
  };
}
