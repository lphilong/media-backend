import { ClientSession, Db } from "mongodb";
import { BaseRepository } from "@infra/database/repository";
import {
  AssignEmploymentProfileManagerInput,
  AssignEmploymentProfileOrgUnitInput,
  EmploymentProfileRepository,
  SetEmploymentProfileLinkedUserInput,
  TransitionEmploymentProfileLifecycleInput,
  UpdateEmploymentProfileContractStatusInput,
  UpdateEmploymentProfileCoreInput,
} from "@modules/employment-profile/domain/employment-profile.repository";
import {
  EmploymentContractStatus,
  EmploymentKind,
  EmploymentProfileRecord,
  EmploymentStatus,
} from "@modules/employment-profile/domain/employment-profile.types";

interface EmploymentProfileDocument {
  readonly _id: string;
  readonly employeeCode: string;
  readonly legalName: string;
  readonly normalizedLegalName: string;
  readonly displayName: string;
  readonly normalizedDisplayName: string;
  readonly employmentKind: EmploymentKind;
  readonly jobTitle: string;
  readonly titleDescription: string | null;
  readonly externalRef: string | null;
  readonly orgUnitId: string;
  readonly managerEmploymentProfileId: string | null;
  readonly linkedUserId: string | null;
  readonly employmentStatus: EmploymentStatus;
  readonly contractStatus: EmploymentContractStatus;
  readonly employmentStartDate: number;
  readonly employmentEndDate: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export class NativeMongoEmploymentProfileRepository
  extends BaseRepository<EmploymentProfileDocument>
  implements EmploymentProfileRepository
{
  constructor(db: Db) {
    super(db, "employment_profiles");
  }

  async insert(
    employmentProfile: EmploymentProfileRecord,
    session: ClientSession,
  ): Promise<EmploymentProfileRecord> {
    await this.collection.insertOne(
      toEmploymentProfileDocument(
        employmentProfile,
      ),
      this.withSession(session),
    );

    return employmentProfile;
  }

  async findById(
    employmentProfileId: string,
    session?: ClientSession,
  ): Promise<EmploymentProfileRecord | null> {
    const doc = await this.collection.findOne(
      { _id: employmentProfileId },
      this.withSession(session),
    );

    return doc
      ? toEmploymentProfileRecord(doc)
      : null;
  }

  async findByEmployeeCode(
    employeeCode: string,
    session?: ClientSession,
  ): Promise<EmploymentProfileRecord | null> {
    const doc = await this.collection.findOne(
      { employeeCode },
      this.withSession(session),
    );

    return doc
      ? toEmploymentProfileRecord(doc)
      : null;
  }

  async findNonArchivedByLinkedUserId(
    linkedUserId: string,
    session?: ClientSession,
  ): Promise<EmploymentProfileRecord | null> {
    const doc = await this.collection.findOne(
      {
        linkedUserId,
        employmentStatus: {
          $ne: "ARCHIVED",
        },
      },
      this.withSession(session),
    );

    return doc
      ? toEmploymentProfileRecord(doc)
      : null;
  }

  async updateCore(
    input: UpdateEmploymentProfileCoreInput,
    session: ClientSession,
  ): Promise<EmploymentProfileRecord | null> {
    const set: Record<string, unknown> = {
      updatedAt: input.updatedAt,
    };

    if (input.legalName !== undefined) {
      set.legalName = input.legalName;
    }

    if (input.normalizedLegalName !== undefined) {
      set.normalizedLegalName =
        input.normalizedLegalName;
    }

    if (input.displayName !== undefined) {
      set.displayName = input.displayName;
    }

    if (input.normalizedDisplayName !== undefined) {
      set.normalizedDisplayName =
        input.normalizedDisplayName;
    }

    if (input.employmentKind !== undefined) {
      set.employmentKind = input.employmentKind;
    }

    if (input.jobTitle !== undefined) {
      set.jobTitle = input.jobTitle;
    }

    if (input.titleDescription !== undefined) {
      set.titleDescription = input.titleDescription;
    }

    if (input.externalRef !== undefined) {
      set.externalRef = input.externalRef;
    }

    const updated = await this.collection.findOneAndUpdate(
      { _id: input.employmentProfileId },
      {
        $set: set,
      },
      {
        ...this.withSession(session),
        returnDocument: "after",
      },
    );

    return updated
      ? toEmploymentProfileRecord(updated)
      : null;
  }

  async assignOrgUnit(
    input: AssignEmploymentProfileOrgUnitInput,
    session: ClientSession,
  ): Promise<EmploymentProfileRecord | null> {
    const updated = await this.collection.findOneAndUpdate(
      { _id: input.employmentProfileId },
      {
        $set: {
          orgUnitId: input.orgUnitId,
          updatedAt: input.updatedAt,
        },
      },
      {
        ...this.withSession(session),
        returnDocument: "after",
      },
    );

    return updated
      ? toEmploymentProfileRecord(updated)
      : null;
  }

  async assignManager(
    input: AssignEmploymentProfileManagerInput,
    session: ClientSession,
  ): Promise<EmploymentProfileRecord | null> {
    const updated = await this.collection.findOneAndUpdate(
      { _id: input.employmentProfileId },
      {
        $set: {
          managerEmploymentProfileId:
            input.managerEmploymentProfileId,
          updatedAt: input.updatedAt,
        },
      },
      {
        ...this.withSession(session),
        returnDocument: "after",
      },
    );

    return updated
      ? toEmploymentProfileRecord(updated)
      : null;
  }

  async setLinkedUser(
    input: SetEmploymentProfileLinkedUserInput,
    session: ClientSession,
  ): Promise<EmploymentProfileRecord | null> {
    const updated = await this.collection.findOneAndUpdate(
      { _id: input.employmentProfileId },
      {
        $set: {
          linkedUserId: input.linkedUserId,
          updatedAt: input.updatedAt,
        },
      },
      {
        ...this.withSession(session),
        returnDocument: "after",
      },
    );

    return updated
      ? toEmploymentProfileRecord(updated)
      : null;
  }

  async transitionLifecycle(
    input: TransitionEmploymentProfileLifecycleInput,
    session: ClientSession,
  ): Promise<EmploymentProfileRecord | null> {
    const set: Record<string, unknown> = {
      employmentStatus: input.toStatus,
      updatedAt: input.updatedAt,
    };

    if (input.employmentEndDate !== undefined) {
      set.employmentEndDate = input.employmentEndDate;
    }

    if (input.contractStatus !== undefined) {
      set.contractStatus = input.contractStatus;
    }

    const updated = await this.collection.findOneAndUpdate(
      {
        _id: input.employmentProfileId,
        employmentStatus: {
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
      ? toEmploymentProfileRecord(updated)
      : null;
  }

  async updateContractStatus(
    input: UpdateEmploymentProfileContractStatusInput,
    session: ClientSession,
  ): Promise<EmploymentProfileRecord | null> {
    const updated = await this.collection.findOneAndUpdate(
      { _id: input.employmentProfileId },
      {
        $set: {
          contractStatus: input.contractStatus,
          updatedAt: input.updatedAt,
        },
      },
      {
        ...this.withSession(session),
        returnDocument: "after",
      },
    );

    return updated
      ? toEmploymentProfileRecord(updated)
      : null;
  }

  async hasNonArchivedDirectReports(
    employmentProfileId: string,
    session?: ClientSession,
  ): Promise<boolean> {
    const doc = await this.collection.findOne(
      {
        managerEmploymentProfileId:
          employmentProfileId,
        employmentStatus: {
          $ne: "ARCHIVED",
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

function toEmploymentProfileDocument(
  employmentProfile: EmploymentProfileRecord,
): EmploymentProfileDocument {
  return {
    _id: employmentProfile.id,
    employeeCode: employmentProfile.employeeCode,
    legalName: employmentProfile.legalName,
    normalizedLegalName:
      employmentProfile.normalizedLegalName,
    displayName: employmentProfile.displayName,
    normalizedDisplayName:
      employmentProfile.normalizedDisplayName,
    employmentKind:
      employmentProfile.employmentKind,
    jobTitle: employmentProfile.jobTitle,
    titleDescription:
      employmentProfile.titleDescription,
    externalRef: employmentProfile.externalRef,
    orgUnitId: employmentProfile.orgUnitId,
    managerEmploymentProfileId:
      employmentProfile.managerEmploymentProfileId,
    linkedUserId: employmentProfile.linkedUserId,
    employmentStatus:
      employmentProfile.employmentStatus,
    contractStatus:
      employmentProfile.contractStatus,
    employmentStartDate:
      employmentProfile.employmentStartDate,
    employmentEndDate:
      employmentProfile.employmentEndDate,
    createdAt: employmentProfile.createdAt,
    updatedAt: employmentProfile.updatedAt,
  };
}

function toEmploymentProfileRecord(
  document: EmploymentProfileDocument,
): EmploymentProfileRecord {
  return {
    id: document._id,
    employeeCode: document.employeeCode,
    legalName: document.legalName,
    normalizedLegalName:
      document.normalizedLegalName,
    displayName: document.displayName,
    normalizedDisplayName:
      document.normalizedDisplayName,
    employmentKind: document.employmentKind,
    jobTitle: document.jobTitle,
    titleDescription: document.titleDescription,
    externalRef: document.externalRef,
    orgUnitId: document.orgUnitId,
    managerEmploymentProfileId:
      document.managerEmploymentProfileId,
    linkedUserId: document.linkedUserId,
    employmentStatus: document.employmentStatus,
    contractStatus: document.contractStatus,
    employmentStartDate:
      document.employmentStartDate,
    employmentEndDate:
      document.employmentEndDate,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}
