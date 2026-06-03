import { ClientSession, Db } from "mongodb";
import { BaseRepository } from "@infra/database/repository";
import { OrgUnitManagerAssignmentRepository } from "@modules/kpi/domain/org-unit-manager-assignment.repository";
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

export class NativeMongoOrgUnitManagerAssignmentRepository
  extends BaseRepository<OrgUnitManagerAssignmentDocument>
  implements OrgUnitManagerAssignmentRepository
{
  constructor(db: Db) {
    super(db, "org_unit_manager_assignments");
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
