import { ClientSession, Db } from "mongodb";
import { BaseRepository } from "@infra/database/repository";
import { TalentGroupManagerAssignmentRepository } from "@modules/kpi/domain/talent-group-manager-assignment.repository";
import {
  TalentGroupManagerAssignment,
  TalentGroupManagerAssignmentStatus,
  TalentGroupManagerRole,
} from "@modules/kpi/domain/kpi.types";

interface TalentGroupManagerAssignmentDocument {
  readonly _id: string;
  readonly groupId: string;
  readonly managerEmploymentProfileId: string;
  readonly role: TalentGroupManagerRole;
  readonly effectiveFrom: number;
  readonly effectiveTo: number | null;
  readonly status: TalentGroupManagerAssignmentStatus;
  readonly isPrimary: boolean;
  readonly createdAt: number;
  readonly createdByActorId: string;
  readonly updatedAt: number;
  readonly updatedByActorId: string;
}

export class NativeMongoTalentGroupManagerAssignmentRepository
  extends BaseRepository<TalentGroupManagerAssignmentDocument>
  implements TalentGroupManagerAssignmentRepository
{
  constructor(db: Db) {
    super(db, "talent_group_manager_assignments");
  }

  async insertAssignment(
    assignment: TalentGroupManagerAssignment,
    session?: ClientSession,
  ): Promise<TalentGroupManagerAssignment> {
    await this.collection.insertOne(
      toDocument(assignment),
      this.withSession(session),
    );
    return assignment;
  }

  async listActiveAssignmentsByGroup(
    groupId: string,
    asOf: number,
    session?: ClientSession,
  ): Promise<readonly TalentGroupManagerAssignment[]> {
    const docs = await this.collection
      .find(activeQuery({ groupId, asOf }), this.withSession(session))
      .sort({ isPrimary: -1, role: 1, effectiveFrom: 1, _id: 1 })
      .toArray();
    return docs.map(toDomain);
  }

  async listActiveAssignmentsByManagerEmploymentProfile(
    managerEmploymentProfileId: string,
    asOf: number,
    session?: ClientSession,
  ): Promise<readonly TalentGroupManagerAssignment[]> {
    const docs = await this.collection
      .find(
        activeQuery({ managerEmploymentProfileId, asOf }),
        this.withSession(session),
      )
      .sort({ groupId: 1, isPrimary: -1, effectiveFrom: 1, _id: 1 })
      .toArray();
    return docs.map(toDomain);
  }
}

function activeQuery(params: {
  readonly groupId?: string;
  readonly managerEmploymentProfileId?: string;
  readonly asOf: number;
}): Record<string, unknown> {
  return {
    ...(params.groupId ? { groupId: params.groupId } : {}),
    ...(params.managerEmploymentProfileId
      ? {
          managerEmploymentProfileId:
            params.managerEmploymentProfileId,
        }
      : {}),
    status: "ACTIVE",
    effectiveFrom: { $lte: params.asOf },
    $or: [{ effectiveTo: null }, { effectiveTo: { $gte: params.asOf } }],
  };
}
function toDocument(
  input: TalentGroupManagerAssignment,
): TalentGroupManagerAssignmentDocument {
  return {
    _id: input.id,
    groupId: input.groupId,
    managerEmploymentProfileId: input.managerEmploymentProfileId,
    role: input.role,
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
  doc: TalentGroupManagerAssignmentDocument,
): TalentGroupManagerAssignment {
  return {
    id: doc._id,
    groupId: doc.groupId,
    managerEmploymentProfileId: doc.managerEmploymentProfileId,
    role: doc.role,
    effectiveFrom: doc.effectiveFrom,
    effectiveTo: doc.effectiveTo,
    status: doc.status,
    isPrimary: doc.isPrimary,
    createdAt: doc.createdAt,
    createdByActorId: doc.createdByActorId,
    updatedAt: doc.updatedAt,
    updatedByActorId: doc.updatedByActorId,
  };
}
