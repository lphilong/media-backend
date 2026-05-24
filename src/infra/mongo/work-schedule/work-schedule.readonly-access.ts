import {
  ClientSession,
  Collection,
  Db,
} from "mongodb";
import { EmploymentProfileWorkScheduleReadonlyAccess } from "@modules/employment-profile/domain/employment-profile-work-schedule-readonly-access";
import {
  WorkScheduleEmploymentProfileReadonlyAccess,
  WorkScheduleReferencedEmploymentProfile,
} from "@modules/work-schedule/domain/work-schedule-employment-profile-readonly-access";
import {
  WorkScheduleOrgUnitReadonlyAccess,
  WorkScheduleReferencedOrgUnit,
} from "@modules/work-schedule/domain/work-schedule-org-unit-readonly-access";
import {
  WorkScheduleReferencedStudioResource,
  WorkScheduleStudioResourceReadonlyAccess,
} from "@modules/work-schedule/domain/work-schedule-studio-resource-readonly-access";
import {
  WorkScheduleReferencedTalent,
  WorkScheduleTalentReadonlyAccess,
} from "@modules/work-schedule/domain/work-schedule-talent-readonly-access";
import {
  WorkScheduleReferencedTalentGroup,
  WorkScheduleTalentGroupReadonlyAccess,
} from "@modules/work-schedule/domain/work-schedule-talent-group-readonly-access";
import { StudioResourceWorkScheduleReadonlyAccess } from "@modules/studio-resource/domain/studio-resource-work-schedule-readonly-access";
import { TalentWorkScheduleReadonlyAccess } from "@modules/talent/domain/talent-work-schedule-readonly-access";
import { TalentGroupWorkScheduleReadonlyAccess } from "@modules/talent-group/domain/talent-group-work-schedule-readonly-access";

interface EmploymentProfileReferenceDocument {
  readonly _id: string;
  readonly employeeCode: string;
  readonly legalName: string;
  readonly displayName: string;
  readonly employmentStatus: WorkScheduleReferencedEmploymentProfile["employmentStatus"];
  readonly orgUnitId: string;
  readonly managerEmploymentProfileId: string | null;
  readonly linkedUserId: string | null;
}

interface WorkScheduleTalentReferenceDocument {
  readonly _id: string;
  readonly operationalStatus: string;
  readonly linkedEmploymentProfileId: string | null;
}

interface WorkScheduleTalentGroupMemberReferenceDocument {
  readonly _id: string;
  readonly groupId: string;
  readonly talentId: string;
  readonly membershipStatus: string;
}

interface OrgUnitReferenceDocument {
  readonly _id: string;
  readonly type: WorkScheduleReferencedOrgUnit["type"];
  readonly status: WorkScheduleReferencedOrgUnit["status"];
}

interface TalentReferenceDocument {
  readonly _id: string;
  readonly operationalStatus: WorkScheduleReferencedTalent["operationalStatus"];
}

interface TalentGroupReferenceDocument {
  readonly _id: string;
  readonly status: WorkScheduleReferencedTalentGroup["status"];
}

interface StudioResourceReferenceDocument {
  readonly _id: string;
  readonly operationalStatus: WorkScheduleReferencedStudioResource["operationalStatus"];
}

interface WorkShiftGuardDocument {
  readonly _id: string;
  readonly status: "ACTIVE" | "CANCELLED" | "ARCHIVED";
  readonly shiftEndAt: number;
  readonly subjectKind:
    | "EMPLOYMENT_PROFILE"
    | "TALENT"
    | "TALENT_GROUP";
  readonly subjectEmploymentProfileId: string | null;
  readonly subjectTalentId: string | null;
  readonly subjectTalentGroupId: string | null;
  readonly studioResourceIds: readonly string[];
}

export class NativeMongoWorkScheduleEmploymentProfileReadonlyAccess
  implements WorkScheduleEmploymentProfileReadonlyAccess
{
  private readonly collection: Collection<EmploymentProfileReferenceDocument>;
  private readonly talentCollection: Collection<WorkScheduleTalentReferenceDocument>;
  private readonly talentGroupMemberCollection: Collection<WorkScheduleTalentGroupMemberReferenceDocument>;

  constructor(db: Db) {
    this.collection =
      db.collection<EmploymentProfileReferenceDocument>(
        "employment_profiles",
      );
    this.talentCollection =
      db.collection<WorkScheduleTalentReferenceDocument>(
        "talents",
      );
    this.talentGroupMemberCollection =
      db.collection<WorkScheduleTalentGroupMemberReferenceDocument>(
        "talent_group_members",
      );
  }

  async findById(
    employmentProfileId: string,
    session?: ClientSession,
  ): Promise<WorkScheduleReferencedEmploymentProfile | null> {
    const doc = await this.collection.findOne(
      {
        _id: employmentProfileId,
      },
      {
        projection: {
          _id: 1,
          employeeCode: 1,
          legalName: 1,
          displayName: 1,
          employmentStatus: 1,
          orgUnitId: 1,
          managerEmploymentProfileId: 1,
          linkedUserId: 1,
        },
        ...(session ? { session } : {}),
      },
    );

    return doc
      ? {
          id: doc._id,
          employmentStatus: doc.employmentStatus,
          orgUnitId: doc.orgUnitId,
          managerEmploymentProfileId:
            doc.managerEmploymentProfileId,
          linkedUserId: doc.linkedUserId,
          ref: toEmploymentProfileReferenceSummary(doc),
        }
      : null;
  }

  async findByLinkedUserId(
    linkedUserId: string,
    session?: ClientSession,
  ): Promise<WorkScheduleReferencedEmploymentProfile | null> {
    const doc = await this.collection.findOne(
      {
        linkedUserId,
        employmentStatus: {
          $ne: "ARCHIVED",
        },
      },
      {
        projection: {
          _id: 1,
          employeeCode: 1,
          legalName: 1,
          displayName: 1,
          employmentStatus: 1,
          orgUnitId: 1,
          managerEmploymentProfileId: 1,
          linkedUserId: 1,
        },
        ...(session ? { session } : {}),
      },
    );

    return doc
      ? {
          id: doc._id,
          employmentStatus: doc.employmentStatus,
          orgUnitId: doc.orgUnitId,
          managerEmploymentProfileId:
            doc.managerEmploymentProfileId,
          linkedUserId: doc.linkedUserId,
          ref: toEmploymentProfileReferenceSummary(doc),
        }
      : null;
  }

  async listIdsByManagerEmploymentProfileId(
    managerEmploymentProfileId: string,
    session?: ClientSession,
  ): Promise<readonly string[]> {
    const docs = await this.collection
      .find(
        {
          managerEmploymentProfileId,
        },
        {
          projection: {
            _id: 1,
          },
          ...(session ? { session } : {}),
        },
      )
      .sort({
        _id: 1,
      })
      .toArray();

    return docs.map((doc) => doc._id);
  }

  async listIdsByActiveTalentGroupIds(
    groupIds: readonly string[],
    session?: ClientSession,
  ): Promise<readonly string[]> {
    const normalizedGroupIds = [...new Set(groupIds)].sort();
    const options = session ? { session } : {};

    if (normalizedGroupIds.length === 0) {
      return [];
    }

    const talentIds =
      await this.talentGroupMemberCollection.distinct(
        "talentId",
        {
          groupId: {
            $in: normalizedGroupIds,
          },
          membershipStatus: "ACTIVE",
        },
        options,
      );

    if (talentIds.length === 0) {
      return [];
    }

    const employmentProfileIds =
      await this.talentCollection.distinct(
        "linkedEmploymentProfileId",
        {
          _id: {
            $in: talentIds,
          },
          operationalStatus: {
            $ne: "ARCHIVED",
          },
          linkedEmploymentProfileId: {
            $type: "string",
          },
        },
        options,
      );

    const ids = employmentProfileIds.filter(
      (id): id is string => typeof id === "string" && id.length > 0,
    );

    if (ids.length === 0) {
      return [];
    }

    const docs = await this.collection
      .find(
        {
          _id: {
            $in: ids,
          },
        },
        {
          projection: {
            _id: 1,
          },
          ...(session ? { session } : {}),
        },
      )
      .sort({
        _id: 1,
      })
      .toArray();

    return docs.map((doc) => doc._id);
  }

  async listIdsByOrgUnitId(
    orgUnitId: string,
    session?: ClientSession,
  ): Promise<readonly string[]> {
    const docs = await this.collection
      .find(
        {
          orgUnitId,
        },
        {
          projection: {
            _id: 1,
          },
          ...(session ? { session } : {}),
        },
      )
      .sort({
        _id: 1,
      })
      .toArray();

    return docs.map((doc) => doc._id);
  }

  async listByOrgUnitId(
    orgUnitId: string,
    session?: ClientSession,
  ): Promise<
    readonly WorkScheduleReferencedEmploymentProfile[]
  > {
    const docs = await this.collection
      .find(
        {
          orgUnitId,
        },
        {
          projection: {
            _id: 1,
            employeeCode: 1,
            legalName: 1,
            displayName: 1,
            employmentStatus: 1,
            orgUnitId: 1,
            managerEmploymentProfileId: 1,
            linkedUserId: 1,
          },
          ...(session ? { session } : {}),
        },
      )
      .sort({
        _id: 1,
      })
      .toArray();

    return docs.map((doc) => ({
      id: doc._id,
      employmentStatus: doc.employmentStatus,
      orgUnitId: doc.orgUnitId,
      managerEmploymentProfileId:
        doc.managerEmploymentProfileId,
      linkedUserId: doc.linkedUserId,
      ref: toEmploymentProfileReferenceSummary(doc),
    }));
  }
}

function toEmploymentProfileReferenceSummary(
  document: EmploymentProfileReferenceDocument,
): WorkScheduleReferencedEmploymentProfile["ref"] {
  return {
    id: document._id,
    code: document.employeeCode,
    displayName: document.displayName,
    name: document.legalName,
    status: document.employmentStatus,
  };
}

export class NativeMongoWorkScheduleOrgUnitReadonlyAccess
  implements WorkScheduleOrgUnitReadonlyAccess
{
  private readonly collection: Collection<OrgUnitReferenceDocument>;

  constructor(db: Db) {
    this.collection =
      db.collection<OrgUnitReferenceDocument>(
        "org_units",
      );
  }

  async findById(
    orgUnitId: string,
    session?: ClientSession,
  ): Promise<WorkScheduleReferencedOrgUnit | null> {
    const doc = await this.collection.findOne(
      { _id: orgUnitId },
      {
        projection: {
          _id: 1,
          type: 1,
          status: 1,
        },
        ...(session ? { session } : {}),
      },
    );

    return doc
      ? {
          id: doc._id,
          type: doc.type,
          status: doc.status,
        }
      : null;
  }
}

export class NativeMongoWorkScheduleTalentReadonlyAccess
  implements WorkScheduleTalentReadonlyAccess
{
  private readonly collection: Collection<TalentReferenceDocument>;

  constructor(db: Db) {
    this.collection =
      db.collection<TalentReferenceDocument>("talents");
  }

  async findById(
    talentId: string,
    session?: ClientSession,
  ): Promise<WorkScheduleReferencedTalent | null> {
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

export class NativeMongoWorkScheduleTalentGroupReadonlyAccess
  implements WorkScheduleTalentGroupReadonlyAccess
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
  ): Promise<WorkScheduleReferencedTalentGroup | null> {
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

export class NativeMongoWorkScheduleStudioResourceReadonlyAccess
  implements WorkScheduleStudioResourceReadonlyAccess
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
  ): Promise<WorkScheduleReferencedStudioResource | null> {
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

export class NativeMongoEmploymentProfileWorkScheduleReadonlyAccess
  implements EmploymentProfileWorkScheduleReadonlyAccess
{
  private readonly collection: Collection<WorkShiftGuardDocument>;

  constructor(db: Db) {
    this.collection =
      db.collection<WorkShiftGuardDocument>(
        "work_shifts",
      );
  }

  async hasLiveScheduledShiftForEmploymentProfile(
    employmentProfileId: string,
    evaluationTime: number,
    session?: ClientSession,
  ): Promise<boolean> {
    const doc = await this.collection.findOne(
      {
        status: "ACTIVE",
        shiftEndAt: {
          $gt: evaluationTime,
        },
        subjectKind: "EMPLOYMENT_PROFILE",
        subjectEmploymentProfileId:
          employmentProfileId,
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

export class NativeMongoTalentWorkScheduleReadonlyAccess
  implements TalentWorkScheduleReadonlyAccess
{
  private readonly collection: Collection<WorkShiftGuardDocument>;

  constructor(db: Db) {
    this.collection =
      db.collection<WorkShiftGuardDocument>(
        "work_shifts",
      );
  }

  async hasLiveScheduledShiftForTalent(
    talentId: string,
    evaluationTime: number,
    session?: ClientSession,
  ): Promise<boolean> {
    const doc = await this.collection.findOne(
      {
        status: "ACTIVE",
        shiftEndAt: {
          $gt: evaluationTime,
        },
        subjectKind: "TALENT",
        subjectTalentId: talentId,
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

export class NativeMongoTalentGroupWorkScheduleReadonlyAccess
  implements TalentGroupWorkScheduleReadonlyAccess
{
  private readonly collection: Collection<WorkShiftGuardDocument>;

  constructor(db: Db) {
    this.collection =
      db.collection<WorkShiftGuardDocument>(
        "work_shifts",
      );
  }

  async hasLiveScheduledShiftForTalentGroup(
    groupId: string,
    evaluationTime: number,
    session?: ClientSession,
  ): Promise<boolean> {
    const doc = await this.collection.findOne(
      {
        status: "ACTIVE",
        shiftEndAt: {
          $gt: evaluationTime,
        },
        subjectKind: "TALENT_GROUP",
        subjectTalentGroupId: groupId,
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

export class NativeMongoStudioResourceWorkScheduleReadonlyAccess
  implements StudioResourceWorkScheduleReadonlyAccess
{
  private readonly collection: Collection<WorkShiftGuardDocument>;

  constructor(db: Db) {
    this.collection =
      db.collection<WorkShiftGuardDocument>(
        "work_shifts",
      );
  }

  async hasLiveScheduledShiftForStudioResource(
    studioResourceId: string,
    evaluationTime: number,
    session?: ClientSession,
  ): Promise<boolean> {
    const doc = await this.collection.findOne(
      {
        status: "ACTIVE",
        shiftEndAt: {
          $gt: evaluationTime,
        },
        studioResourceIds: studioResourceId,
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
