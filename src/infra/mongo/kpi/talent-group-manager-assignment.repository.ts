import { ClientSession, Collection, Db } from "mongodb";
import { BaseRepository } from "@infra/database/repository";
import {
  RevokeTalentGroupManagerAssignmentInput,
  TalentGroupManagerAssignmentRepository,
  TalentGroupManagerEmploymentProfileCandidate,
} from "@modules/kpi/domain/talent-group-manager-assignment.repository";
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

interface EmploymentProfileDocument {
  readonly _id: string;
  readonly employeeCode: string;
  readonly legalName: string;
  readonly displayName: string;
  readonly employmentStatus: string;
  readonly linkedUserId: string | null;
}

interface UserDocument {
  readonly _id: string;
  readonly actorKind: string;
  readonly accountStatus: string;
  readonly profile?: {
    readonly displayName?: string;
    readonly email?: string;
  };
}

export class NativeMongoTalentGroupManagerAssignmentRepository
  extends BaseRepository<TalentGroupManagerAssignmentDocument>
  implements TalentGroupManagerAssignmentRepository
{
  private readonly employmentProfileCollection: Collection<EmploymentProfileDocument>;
  private readonly userCollection: Collection<UserDocument>;

  constructor(db: Db) {
    super(db, "talent_group_manager_assignments");
    this.employmentProfileCollection = db.collection<EmploymentProfileDocument>(
      "employment_profiles",
    );
    this.userCollection = db.collection<UserDocument>("users");
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

  async findAssignmentById(
    assignmentId: string,
    session?: ClientSession,
  ): Promise<TalentGroupManagerAssignment | null> {
    const doc = await this.collection.findOne(
      { _id: assignmentId },
      this.withSession(session),
    );
    return doc ? toDomain(doc) : null;
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

  async revokeAssignment(
    input: RevokeTalentGroupManagerAssignmentInput,
    session?: ClientSession,
  ): Promise<TalentGroupManagerAssignment | null> {
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
  ): Promise<TalentGroupManagerEmploymentProfileCandidate | null> {
    const profile = await this.employmentProfileCollection.findOne(
      { _id: employmentProfileId },
      this.withSession(session),
    );
    if (!profile) {
      return null;
    }

    const linkedUser = profile.linkedUserId
      ? await this.userCollection.findOne(
          { _id: profile.linkedUserId },
          {
            ...this.withSession(session),
            projection: {
              _id: 1,
              actorKind: 1,
              accountStatus: 1,
              profile: 1,
            },
          },
        )
      : null;

    return {
      id: profile._id,
      employeeCode: profile.employeeCode,
      displayName: profile.displayName,
      legalName: profile.legalName,
      employmentStatus: profile.employmentStatus,
      linkedUserId: profile.linkedUserId,
      linkedUserRef: linkedUser
        ? {
            id: linkedUser._id,
            displayName: linkedUser.profile?.displayName,
            name: linkedUser.profile?.email,
            status: linkedUser.accountStatus,
          }
        : null,
      linkedUserActorKind: linkedUser?.actorKind ?? null,
      linkedUserAccountStatus: linkedUser?.accountStatus ?? null,
    };
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
          managerEmploymentProfileId: params.managerEmploymentProfileId,
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
