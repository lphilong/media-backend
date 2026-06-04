import { ClientSession, Collection, Db } from "mongodb";
import { BaseRepository } from "@infra/database/repository";
import {
  OrgUnitManagerAssignmentRepository,
  OrgUnitManagerEmploymentProfileCandidate,
  RevokeOrgUnitManagerAssignmentInput,
  UpdateOrgUnitManagerAssignmentInput,
} from "@modules/kpi/domain/org-unit-manager-assignment.repository";
import {
  OrgUnitManagerAssignment,
  OrgUnitManagerAssignmentStatus,
  OrgUnitManagerRole,
} from "@modules/kpi/domain/kpi.types";

interface OrgUnitManagerAssignmentDocument {
  readonly _id: string;
  readonly orgUnitId: string;
  readonly managerEmploymentProfileId: string;
  readonly role: OrgUnitManagerRole;
  readonly includeDescendants?: boolean;
  readonly actionMask?: readonly string[];
  readonly effectiveFrom: number;
  readonly effectiveTo: number | null;
  readonly status: OrgUnitManagerAssignmentStatus;
  readonly isPrimary?: boolean;
  readonly createdAt: number;
  readonly createdByActorId: string;
  readonly updatedAt: number;
  readonly updatedByActorId: string;
}

interface EmploymentProfileDocument {
  readonly _id: string;
  readonly employeeCode: string;
  readonly legalName: string;
  readonly displayName: string;
  readonly jobTitle: string;
  readonly employmentStatus: string;
}

interface OrgUnitManagerAssignmentUpdateDocument {
  role?: OrgUnitManagerRole;
  includeDescendants?: boolean;
  effectiveFrom?: number;
  effectiveTo?: number | null;
  isPrimary?: boolean;
  updatedAt: number;
  updatedByActorId: string;
}

export class NativeMongoOrgUnitManagerAssignmentRepository
  extends BaseRepository<OrgUnitManagerAssignmentDocument>
  implements OrgUnitManagerAssignmentRepository
{
  private readonly employmentProfileCollection: Collection<EmploymentProfileDocument>;

  constructor(db: Db) {
    super(db, "org_unit_manager_assignments");
    this.employmentProfileCollection = db.collection<EmploymentProfileDocument>(
      "employment_profiles",
    );
  }

  async insertAssignment(
    assignment: OrgUnitManagerAssignment,
    session?: ClientSession,
  ): Promise<OrgUnitManagerAssignment> {
    await this.collection.insertOne(
      toDocument(assignment),
      this.withSession(session),
    );
    return assignment;
  }

  async listAssignmentsByOrgUnitId(
    orgUnitId: string,
    session?: ClientSession,
  ): Promise<readonly OrgUnitManagerAssignment[]> {
    const docs = await this.collection
      .find({ orgUnitId }, this.withSession(session))
      .sort({ status: 1, isPrimary: -1, role: 1, effectiveFrom: 1, _id: 1 })
      .toArray();
    return docs.map(toDomain);
  }

  async listActiveByManagerEmploymentProfileId(
    managerEmploymentProfileId: string,
    asOf: number,
    session?: ClientSession,
  ): Promise<readonly OrgUnitManagerAssignment[]> {
    const docs = await this.collection
      .find(
        activeQuery({ managerEmploymentProfileId, asOf }),
        this.withSession(session),
      )
      .sort({ orgUnitId: 1, isPrimary: -1, role: 1, effectiveFrom: 1, _id: 1 })
      .toArray();
    return docs.map(toDomain);
  }

  async listActiveByManagerEmploymentProfileIdAndRole(
    managerEmploymentProfileId: string,
    role: OrgUnitManagerRole,
    asOf: number,
    session?: ClientSession,
  ): Promise<readonly OrgUnitManagerAssignment[]> {
    const docs = await this.collection
      .find(
        activeQuery({ managerEmploymentProfileId, role, asOf }),
        this.withSession(session),
      )
      .sort({ orgUnitId: 1, isPrimary: -1, effectiveFrom: 1, _id: 1 })
      .toArray();
    return docs.map(toDomain);
  }

  async listActiveByOrgUnitId(
    orgUnitId: string,
    asOf: number,
    session?: ClientSession,
  ): Promise<readonly OrgUnitManagerAssignment[]> {
    const docs = await this.collection
      .find(activeQuery({ orgUnitId, asOf }), this.withSession(session))
      .sort({ isPrimary: -1, role: 1, effectiveFrom: 1, _id: 1 })
      .toArray();
    return docs.map(toDomain);
  }

  async findAssignmentById(
    assignmentId: string,
    session?: ClientSession,
  ): Promise<OrgUnitManagerAssignment | null> {
    const doc = await this.collection.findOne(
      { _id: assignmentId },
      this.withSession(session),
    );
    return doc ? toDomain(doc) : null;
  }

  async updateAssignment(
    input: UpdateOrgUnitManagerAssignmentInput,
    session?: ClientSession,
  ): Promise<OrgUnitManagerAssignment | null> {
    const $set: OrgUnitManagerAssignmentUpdateDocument = {
      updatedAt: input.updatedAt,
      updatedByActorId: input.updatedByActorId,
    };

    if (input.role !== undefined) {
      $set.role = input.role;
    }
    if (input.includeDescendants !== undefined) {
      $set.includeDescendants = input.includeDescendants;
    }
    if (input.effectiveFrom !== undefined) {
      $set.effectiveFrom = input.effectiveFrom;
    }
    if (input.effectiveTo !== undefined) {
      $set.effectiveTo = input.effectiveTo;
    }
    if (input.isPrimary !== undefined) {
      $set.isPrimary = input.isPrimary;
    }

    const updated = await this.collection.findOneAndUpdate(
      { _id: input.assignmentId, status: "ACTIVE" },
      { $set },
      {
        ...this.withSession(session),
        returnDocument: "after",
      },
    );
    return updated ? toDomain(updated) : null;
  }

  async revokeAssignment(
    input: RevokeOrgUnitManagerAssignmentInput,
    session?: ClientSession,
  ): Promise<OrgUnitManagerAssignment | null> {
    const updated = await this.collection.findOneAndUpdate(
      {
        _id: input.assignmentId,
        status: "ACTIVE",
        effectiveFrom: { $lte: input.effectiveTo },
        $or: [
          { effectiveTo: null },
          { effectiveTo: { $gte: input.effectiveTo } },
        ],
      },
      {
        $set: {
          status: "INACTIVE",
          effectiveTo: input.effectiveTo,
          updatedAt: input.updatedAt,
          updatedByActorId: input.updatedByActorId,
        },
      },
      {
        ...this.withSession(session),
        returnDocument: "after",
      },
    );
    return updated ? toDomain(updated) : null;
  }

  async findManagerEmploymentProfileCandidate(
    employmentProfileId: string,
    session?: ClientSession,
  ): Promise<OrgUnitManagerEmploymentProfileCandidate | null> {
    const profile = await this.employmentProfileCollection.findOne(
      { _id: employmentProfileId },
      {
        ...this.withSession(session),
        projection: {
          _id: 1,
          employeeCode: 1,
          legalName: 1,
          displayName: 1,
          jobTitle: 1,
          employmentStatus: 1,
        },
      },
    );
    if (!profile) {
      return null;
    }

    return {
      id: profile._id,
      employeeCode: profile.employeeCode,
      legalName: profile.legalName,
      displayName: profile.displayName,
      jobTitle: profile.jobTitle,
      employmentStatus: profile.employmentStatus,
    };
  }
}

function activeQuery(params: {
  readonly orgUnitId?: string;
  readonly managerEmploymentProfileId?: string;
  readonly role?: OrgUnitManagerRole;
  readonly asOf: number;
}): Record<string, unknown> {
  return {
    ...(params.orgUnitId ? { orgUnitId: params.orgUnitId } : {}),
    ...(params.managerEmploymentProfileId
      ? {
          managerEmploymentProfileId: params.managerEmploymentProfileId,
        }
      : {}),
    ...(params.role ? { role: params.role } : {}),
    status: "ACTIVE",
    effectiveFrom: { $lte: params.asOf },
    $or: [{ effectiveTo: null }, { effectiveTo: { $gte: params.asOf } }],
  };
}

function toDocument(
  input: OrgUnitManagerAssignment,
): OrgUnitManagerAssignmentDocument {
  return {
    _id: input.id,
    orgUnitId: input.orgUnitId,
    managerEmploymentProfileId: input.managerEmploymentProfileId,
    role: input.role,
    includeDescendants: input.includeDescendants,
    actionMask: input.actionMask,
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo,
    status: input.status,
    isPrimary: input.isPrimary,
    createdAt: input.createdAt,
    createdByActorId: input.createdByActorId,
    updatedAt: input.updatedAt,
    updatedByActorId: input.updatedByActorId,
  };
}

function toDomain(
  doc: OrgUnitManagerAssignmentDocument,
): OrgUnitManagerAssignment {
  return {
    id: doc._id,
    orgUnitId: doc.orgUnitId,
    managerEmploymentProfileId: doc.managerEmploymentProfileId,
    role: doc.role,
    includeDescendants: doc.includeDescendants ?? false,
    actionMask: doc.actionMask ?? [],
    effectiveFrom: doc.effectiveFrom,
    effectiveTo: doc.effectiveTo,
    status: doc.status,
    isPrimary: doc.isPrimary ?? false,
    createdAt: doc.createdAt,
    createdByActorId: doc.createdByActorId,
    updatedAt: doc.updatedAt,
    updatedByActorId: doc.updatedByActorId,
  };
}
