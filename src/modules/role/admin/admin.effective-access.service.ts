import { Db } from "mongodb";
import { ActorScopeGrants } from "@core/actor/actor";
import {
  buildWorkspaceAvailability,
} from "@modules/account-context/account-context.workspace-availability";
import {
  AccountContext,
  normalizeAccountContexts,
} from "@modules/account-context/domain/account-context.types";
import { RoleAssignmentScopeGrant, buildRoleAssignmentScopeFingerprint } from "@modules/role/domain/role-assignment-scope";
import { isRoleAssignmentCurrentlyEffective } from "@modules/role/domain/role-assignment-lifecycle";
import { classifySensitiveAccess } from "@modules/role/domain/sensitive-access-policy";
import { RoleDependencyError } from "@modules/role/domain/role.errors";
import { UserRoleAssignmentRecord } from "@modules/role/domain/role.types";

interface UserDocument {
  readonly _id: string;
  readonly actorKind: "ADMIN" | "STAFF";
  readonly accountStatus: string;
  readonly accountContexts?: readonly AccountContext[];
  readonly profile?: { readonly displayName?: string; readonly email?: string };
}

interface AssignmentDocument {
  readonly _id: string;
  readonly roleId: string;
  readonly userId: string;
  readonly scopeGrants?: ActorScopeGrants;
  readonly structuredScopeGrants?: readonly RoleAssignmentScopeGrant[];
  readonly scopeFingerprint?: string;
  readonly state: "ACTIVE" | "REVOKED";
  readonly effectiveAt: number | null;
  readonly expiresAt?: number | null;
  readonly reviewAt?: number | null;
  readonly assignedBy?: string | null;
  readonly assignedAt?: number;
  readonly origin?: "DIRECT" | "BUNDLE" | "LEGACY";
  readonly bundleOrigin?: UserRoleAssignmentRecord["bundleOrigin"];
  readonly reason: string | null;
  readonly createdAt: number;
}

interface RoleDocument {
  readonly _id: string;
  readonly code: string;
  readonly name: string;
  readonly state: string;
  readonly permissions: readonly string[];
  readonly templateCode?: string;
}

export class EffectiveAccessAdminService {
  constructor(private readonly db: Db) {}

  async getForUser(userId: string): Promise<Record<string, unknown>> {
    const now = Date.now();
    const user = await this.db.collection<UserDocument>("users").findOne({
      _id: userId,
    });
    if (!user) {
      throw new RoleDependencyError(`Effective access user not found: ${userId}`);
    }

    const assignmentDocs = await this.db
      .collection<AssignmentDocument>("role_assignments")
      .find({ userId, state: "ACTIVE" })
      .sort({ createdAt: 1, _id: 1 })
      .toArray();
    const activeAssignments = assignmentDocs.filter((assignment) =>
      isRoleAssignmentCurrentlyEffective(assignment, now),
    );
    const roleIds = [...new Set(activeAssignments.map((item) => item.roleId))];
    const roles = roleIds.length
      ? await this.db
          .collection<RoleDocument>("roles")
          .find({ _id: { $in: roleIds }, state: "ACTIVE" })
          .sort({ code: 1, _id: 1 })
          .toArray()
      : [];
    const roleById = new Map(roles.map((role) => [role._id, role]));
    const permissionSources = new Map<string, Array<Record<string, unknown>>>();

    for (const assignment of activeAssignments) {
      const role = roleById.get(assignment.roleId);
      if (!role) {
        continue;
      }
      for (const permission of role.permissions) {
        const accessRisk = classifySensitiveAccess([
          {
            roleCode: role.code,
            roleTemplateCode: role.templateCode ?? role.code,
            permissions: role.permissions,
            structuredScopeGrants: assignment.structuredScopeGrants ?? [],
            bundleCode: assignment.bundleOrigin?.bundleCode ?? null,
          },
        ]);
        const sources = permissionSources.get(permission) ?? [];
        sources.push({
          assignmentId: assignment._id,
          roleId: role._id,
          roleCode: role.code,
          roleName: role.name,
          scopeFingerprint:
            assignment.scopeFingerprint ??
            buildRoleAssignmentScopeFingerprint(undefined),
          structuredScopeGrants: assignment.structuredScopeGrants ?? [],
          legacyScopeGrants: assignment.scopeGrants ?? null,
          origin: assignment.origin ?? "LEGACY",
          bundleOrigin: assignment.bundleOrigin ?? null,
          accessRisk,
          isSensitive: accessRisk.isSensitive,
          isGlobalLike: accessRisk.isGlobalLike,
          isHighRisk: accessRisk.isHighRisk,
          requiresReview: accessRisk.requiresReview,
          isBreakGlassLike: accessRisk.isBreakGlassLike,
        });
        permissionSources.set(permission, sources);
      }
    }

    const assignments = activeAssignments.map((assignment) => {
      const role = roleById.get(assignment.roleId);
      const structuredScopeGrants = assignment.structuredScopeGrants ?? [];
      const accessRisk = classifySensitiveAccess([
        {
          roleCode: role?.code ?? null,
          roleTemplateCode: role?.templateCode ?? role?.code ?? null,
          permissions: role ? role.permissions : [],
          structuredScopeGrants,
          bundleCode: assignment.bundleOrigin?.bundleCode ?? null,
        },
      ]);
      return {
        assignmentId: assignment._id,
        roleId: assignment.roleId,
        roleCode: role?.code ?? null,
        roleName: role?.name ?? null,
        permissions: role ? [...role.permissions] : [],
        legacyScopeGrants: assignment.scopeGrants ?? null,
        structuredScopeGrants,
        scopeFingerprint:
          assignment.scopeFingerprint ??
          buildRoleAssignmentScopeFingerprint(undefined),
        reason: assignment.reason,
        assignedBy: assignment.assignedBy ?? null,
        assignedAt: assignment.assignedAt ?? assignment.createdAt,
        effectiveAt: assignment.effectiveAt,
        expiresAt: assignment.expiresAt ?? null,
        reviewAt: assignment.reviewAt ?? null,
        origin: assignment.origin ?? "LEGACY",
        bundleOrigin: assignment.bundleOrigin ?? null,
        sensitiveOrGlobal: accessRisk.isSensitive || accessRisk.isGlobalLike,
        isSensitive: accessRisk.isSensitive,
        isGlobalLike: accessRisk.isGlobalLike,
        isHighRisk: accessRisk.isHighRisk,
        requiresReview: accessRisk.requiresReview,
        isBreakGlassLike: accessRisk.isBreakGlassLike,
        accessRisk,
      };
    });

    const accountContexts = normalizeAccountContexts(user.accountContexts);
    const workspaceAvailability = buildWorkspaceAvailability({
      accountContexts,
      effectiveAccessTraceAvailable: true,
      legacyActorKind: user.actorKind,
    });

    return {
      readOnly: true,
      sourceTruth: false,
      user: {
        id: user._id,
        displayName: user.profile?.displayName ?? null,
        email: user.profile?.email ?? null,
        accountStatus: user.accountStatus,
      },
      accountContextSignals: {
        canonicalAccountContextImplemented: true,
        canonicalSource: "ACCOUNT_CONTEXT",
        accountContexts,
        legacyActorKind: user.actorKind,
        compatibilityContexts: [],
        grantsAuthorityByItself: false,
      },
      workspaceAvailability,
      activeRoleAssignments: assignments,
      roles: roles.map((role) => ({
        id: role._id,
        code: role.code,
        name: role.name,
        templateCode: role.templateCode ?? null,
      })),
      permissions: [...permissionSources.keys()].sort(),
      permissionSourceTrace: [...permissionSources.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([permission, sources]) => ({ permission, sources })),
      businessResponsibilitySupport: {
        status: "NOT_EVALUATED",
        claims: [],
        note: "Business responsibility assignments remain separate source truth and are not inferred by this read model.",
      },
      generatedAt: new Date(now).toISOString(),
    };
  }
}
