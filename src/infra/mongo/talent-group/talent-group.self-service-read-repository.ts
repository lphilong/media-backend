import { Collection, Db } from "mongodb";
import {
  SelfServiceTalentGroupsReadRepository,
  SelfServiceTalentGroupManagerReadModel,
  SelfServiceTalentGroupMemberReadModel,
  SelfServiceTalentGroupMembershipReadModel,
  SelfServiceTalentGroupReadModel,
} from "@modules/self-service/domain/self-service-talent-groups.repository";
import { TalentOrigin } from "@modules/talent/domain/talent.types";

interface TalentGroupDocument {
  readonly _id: string;
  readonly groupCode: string;
  readonly name: string;
  readonly status: string;
  readonly displayOrder: number;
}

interface TalentGroupMemberDocument {
  readonly _id: string;
  readonly groupId: string;
  readonly talentId: string;
  readonly membershipStatus: string;
  readonly lineupOrder: number;
  readonly joinedAt: number;
}

interface TalentDocument {
  readonly _id: string;
  readonly talentCode: string;
  readonly stageName: string;
  readonly displayShortName: string | null;
  readonly talentOrigin: TalentOrigin;
  readonly linkedEmploymentProfileId: string | null;
  readonly operationalStatus: string;
}

interface EmploymentProfileDocument {
  readonly _id: string;
  readonly employeeCode: string;
  readonly displayName: string;
  readonly employmentStatus: string;
}

interface TalentGroupManagerAssignmentDocument {
  readonly _id: string;
  readonly groupId: string;
  readonly managerEmploymentProfileId: string;
  readonly effectiveFrom: number;
  readonly effectiveTo: number | null;
  readonly status: string;
  readonly isPrimary: boolean;
}

export class NativeMongoSelfServiceTalentGroupsReadRepository
  implements SelfServiceTalentGroupsReadRepository
{
  private readonly groupCollection: Collection<TalentGroupDocument>;
  private readonly memberCollection: Collection<TalentGroupMemberDocument>;
  private readonly talentCollection: Collection<TalentDocument>;
  private readonly employmentProfileCollection: Collection<EmploymentProfileDocument>;
  private readonly managerAssignmentCollection: Collection<TalentGroupManagerAssignmentDocument>;

  constructor(db: Db) {
    this.groupCollection = db.collection<TalentGroupDocument>("talent_groups");
    this.memberCollection = db.collection<TalentGroupMemberDocument>(
      "talent_group_members",
    );
    this.talentCollection = db.collection<TalentDocument>("talents");
    this.employmentProfileCollection =
      db.collection<EmploymentProfileDocument>("employment_profiles");
    this.managerAssignmentCollection =
      db.collection<TalentGroupManagerAssignmentDocument>(
        "talent_group_manager_assignments",
      );
  }

  async listActiveMembershipsByTalent(
    talentId: string,
  ): Promise<readonly SelfServiceTalentGroupMembershipReadModel[]> {
    const docs = await this.memberCollection
      .find(
        {
          talentId,
          membershipStatus: "ACTIVE",
        },
        {
          projection: {
            groupId: 1,
            lineupOrder: 1,
            joinedAt: 1,
          },
        },
      )
      .sort({ joinedAt: 1, lineupOrder: 1, _id: 1 })
      .toArray();

    return docs.map((doc) => ({
      groupId: doc.groupId,
      lineupOrder: doc.lineupOrder,
      joinedAt: doc.joinedAt,
    }));
  }

  async listActiveGroupsByIds(
    groupIds: readonly string[],
  ): Promise<readonly SelfServiceTalentGroupReadModel[]> {
    const uniqueIds = uniqueNonEmpty(groupIds);

    if (uniqueIds.length === 0) {
      return [];
    }

    const docs = await this.groupCollection
      .find(
        {
          _id: { $in: uniqueIds },
          status: "ACTIVE",
        },
        {
          projection: {
            groupCode: 1,
            name: 1,
            status: 1,
            displayOrder: 1,
          },
        },
      )
      .sort({ displayOrder: 1, name: 1, _id: 1 })
      .toArray();

    return docs.map((doc) => ({
      id: doc._id,
      talentGroupCode: doc.groupCode,
      name: doc.name,
      status: "ACTIVE",
      displayOrder: doc.displayOrder,
    }));
  }

  async listActiveCurrentManagersByGroupIds(
    groupIds: readonly string[],
    asOf: number,
  ): Promise<readonly SelfServiceTalentGroupManagerReadModel[]> {
    const uniqueIds = uniqueNonEmpty(groupIds);

    if (uniqueIds.length === 0) {
      return [];
    }

    const assignments = await this.managerAssignmentCollection
      .find(
        {
          groupId: { $in: uniqueIds },
          status: "ACTIVE",
          effectiveFrom: { $lte: asOf },
          $or: [{ effectiveTo: null }, { effectiveTo: { $gte: asOf } }],
        },
        {
          projection: {
            groupId: 1,
            managerEmploymentProfileId: 1,
            isPrimary: 1,
          },
        },
      )
      .sort({ groupId: 1, isPrimary: -1, effectiveFrom: 1, _id: 1 })
      .toArray();

    const profiles = await this.loadEmploymentProfiles(
      assignments.map((assignment) => assignment.managerEmploymentProfileId),
      true,
    );

    return assignments
      .map((assignment): SelfServiceTalentGroupManagerReadModel | null => {
        const profile = profiles.get(assignment.managerEmploymentProfileId);

        if (!profile) {
          return null;
        }

        const manager: SelfServiceTalentGroupManagerReadModel = {
          groupId: assignment.groupId,
          displayName: profile.displayName,
          isPrimary: assignment.isPrimary,
        };

        const employeeCode = optionalText(profile.employeeCode);

        if (employeeCode) {
          return {
            ...manager,
            employeeCode,
          };
        }

        return manager;
      })
      .filter((item): item is SelfServiceTalentGroupManagerReadModel => item !== null);
  }

  async listActiveMembersByGroupIds(
    groupIds: readonly string[],
  ): Promise<readonly SelfServiceTalentGroupMemberReadModel[]> {
    const uniqueIds = uniqueNonEmpty(groupIds);

    if (uniqueIds.length === 0) {
      return [];
    }

    const memberships = await this.memberCollection
      .find(
        {
          groupId: { $in: uniqueIds },
          membershipStatus: "ACTIVE",
        },
        {
          projection: {
            groupId: 1,
            talentId: 1,
            lineupOrder: 1,
          },
        },
      )
      .sort({ groupId: 1, lineupOrder: 1, _id: 1 })
      .toArray();

    if (memberships.length === 0) {
      return [];
    }

    const talents = await this.loadTalents(
      memberships.map((membership) => membership.talentId),
    );
    const profiles = await this.loadEmploymentProfiles(
      [...talents.values()]
        .map((talent) => talent.linkedEmploymentProfileId)
        .filter((value): value is string => typeof value === "string"),
      false,
    );

    return memberships
      .map((membership): SelfServiceTalentGroupMemberReadModel | null => {
        const talent = talents.get(membership.talentId);

        if (!talent) {
          return null;
        }

        const display = deriveSelfServiceTalentDisplay(
          talent,
          talent.linkedEmploymentProfileId
            ? (profiles.get(talent.linkedEmploymentProfileId) ?? null)
            : null,
        );

        const member: SelfServiceTalentGroupMemberReadModel = {
          groupId: membership.groupId,
          talentCode: talent.talentCode,
          displayName: display.displayName,
          origin: talent.talentOrigin,
          lineupOrder: membership.lineupOrder,
        };

        if (display.performanceAlias) {
          return {
            ...member,
            performanceAlias: display.performanceAlias,
          };
        }

        return member;
      })
      .filter(
        (item): item is SelfServiceTalentGroupMemberReadModel => item !== null,
      );
  }

  private async loadTalents(
    talentIds: readonly string[],
  ): Promise<Map<string, TalentDocument>> {
    const uniqueIds = uniqueNonEmpty(talentIds);

    if (uniqueIds.length === 0) {
      return new Map();
    }

    const docs = await this.talentCollection
      .find(
        {
          _id: { $in: uniqueIds },
          operationalStatus: "ACTIVE",
        },
        {
          projection: {
            talentCode: 1,
            stageName: 1,
            displayShortName: 1,
            talentOrigin: 1,
            linkedEmploymentProfileId: 1,
            operationalStatus: 1,
          },
        },
      )
      .toArray();

    return new Map(docs.map((doc) => [doc._id, doc]));
  }

  private async loadEmploymentProfiles(
    employmentProfileIds: readonly string[],
    requireActive: boolean,
  ): Promise<Map<string, EmploymentProfileDocument>> {
    const uniqueIds = uniqueNonEmpty(employmentProfileIds);

    if (uniqueIds.length === 0) {
      return new Map();
    }

    const docs = await this.employmentProfileCollection
      .find(
        {
          _id: { $in: uniqueIds },
          employmentStatus: requireActive ? "ACTIVE" : { $ne: "ARCHIVED" },
        },
        {
          projection: {
            employeeCode: 1,
            displayName: 1,
            employmentStatus: 1,
          },
        },
      )
      .toArray();

    return new Map(docs.map((doc) => [doc._id, doc]));
  }
}

function deriveSelfServiceTalentDisplay(
  talent: TalentDocument,
  employmentProfile: EmploymentProfileDocument | null,
): {
  readonly displayName: string;
  readonly performanceAlias?: string;
} {
  const stageName = optionalText(talent.stageName);
  const displayShortName = optionalText(talent.displayShortName);

  if (talent.talentOrigin === "INTERNAL") {
    const displayName = optionalText(employmentProfile?.displayName) ?? talent.talentCode;
    const performanceAlias =
      stageName && stageName !== displayName ? stageName : undefined;

    return {
      displayName,
      performanceAlias,
    };
  }

  return {
    displayName: displayShortName ?? stageName ?? talent.talentCode,
    performanceAlias: stageName,
  };
}

function uniqueNonEmpty(values: readonly string[]): readonly string[] {
  return [
    ...new Set(
      values
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  ];
}

function optionalText(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}
