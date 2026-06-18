import { Collection, Db } from "mongodb";
import { ActorScopeGrants } from "@core/actor/actor";
import { RoleAssignmentScopeGrant } from "@modules/role/domain/role-assignment-scope";
import {
  StructuredScopeAuthorityAssignment,
  StructuredScopeAuthorityReader,
} from "@modules/role/domain/structured-scope-authority";
import {
  RoleAssignmentState,
  UserRoleAssignmentRecord,
} from "@modules/role/domain/role.types";

interface RoleAssignmentDocument {
  readonly _id: string;
  readonly roleId: string;
  readonly userId: string;
  readonly scopeGrants?: ActorScopeGrants;
  readonly structuredScopeGrants?: readonly RoleAssignmentScopeGrant[];
  readonly scopeFingerprint?: string;
  readonly state: RoleAssignmentState;
  readonly effectiveAt: number | null;
  readonly expiresAt?: number | null;
  readonly reviewAt?: number | null;
  readonly assignedBy?: string | null;
  readonly assignedAt?: number;
  readonly revokedAt: number | null;
  readonly revokedBy?: string | null;
  readonly revokeReason?: string | null;
  readonly origin?: "DIRECT" | "BUNDLE" | "LEGACY";
  readonly bundleOrigin?: UserRoleAssignmentRecord["bundleOrigin"];
  readonly reason: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

interface RoleDocument {
  readonly _id: string;
  readonly state: string;
  readonly permissions: readonly string[];
}

export class NativeMongoStructuredScopeAuthorityReader
  implements StructuredScopeAuthorityReader
{
  private readonly assignmentCollection: Collection<RoleAssignmentDocument>;
  private readonly roleCollection: Collection<RoleDocument>;

  constructor(db: Db) {
    this.assignmentCollection =
      db.collection<RoleAssignmentDocument>("role_assignments");
    this.roleCollection = db.collection<RoleDocument>("roles");
  }

  async listByUserId(
    userId: string,
  ): Promise<readonly StructuredScopeAuthorityAssignment[]> {
    const assignments = await this.assignmentCollection
      .find({ userId })
      .sort({ createdAt: 1, _id: 1 })
      .toArray();
    const roleIds = [...new Set(assignments.map((item) => item.roleId))];
    const roles =
      roleIds.length === 0
        ? []
        : await this.roleCollection
            .find({ _id: { $in: roleIds } })
            .sort({ _id: 1 })
            .toArray();
    const roleById = new Map(roles.map((role) => [role._id, role]));

    return assignments.map((assignment) => ({
      assignment: toAssignmentRecord(assignment),
      role: roleById.get(assignment.roleId)
        ? {
            id: assignment.roleId,
            state: roleById.get(assignment.roleId)?.state ?? "MISSING",
            permissions: [
              ...(roleById.get(assignment.roleId)?.permissions ?? []),
            ],
          }
        : null,
    }));
  }
}

function toAssignmentRecord(
  document: RoleAssignmentDocument,
): UserRoleAssignmentRecord {
  return {
    assignmentId: document._id,
    roleId: document.roleId,
    userId: document.userId,
    ...(document.scopeGrants ? { scopeGrants: document.scopeGrants } : {}),
    ...(document.structuredScopeGrants
      ? { structuredScopeGrants: document.structuredScopeGrants }
      : {}),
    ...(document.scopeFingerprint
      ? { scopeFingerprint: document.scopeFingerprint }
      : {}),
    state: document.state,
    effectiveAt: document.effectiveAt,
    expiresAt: document.expiresAt ?? null,
    reviewAt: document.reviewAt ?? null,
    assignedBy: document.assignedBy ?? null,
    assignedAt: document.assignedAt ?? document.createdAt,
    revokedAt: document.revokedAt,
    revokedBy: document.revokedBy ?? null,
    revokeReason: document.revokeReason ?? null,
    origin: document.origin ?? "LEGACY",
    bundleOrigin: document.bundleOrigin ?? null,
    reason: document.reason,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}
