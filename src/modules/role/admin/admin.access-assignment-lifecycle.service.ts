import { ClientSession, Collection, Db } from "mongodb";
import { Actor } from "@core/actor/actor";
import { AuditGuard } from "@core/audit/audit.guard";
import {
  AuthoritativeAdminMutationBridge,
} from "@core/application/authoritative-admin-mutation.bridge";
import { ActorSnapshotCacheInvalidator } from "@infra/cache/actor.snapshot.cache";
import { getTraceIdOrThrow } from "@core/trace/trace.context";
import { Permission } from "@core/permission/permission.enum";
import { PermissionResolver } from "@core/permission/permission.resolver";
import { getCurrentDomainEventCollector } from "@system/event-bridge/domain-event.types";
import { createRoleRevokedFromUserEvent } from "@modules/role/domain/role.events";
import { isRoleAssignmentCurrentlyEffective } from "@modules/role/domain/role-assignment-lifecycle";
import {
  RoleAssignmentScopeGrant,
  buildRoleAssignmentScopeFingerprint,
} from "@modules/role/domain/role-assignment-scope";
import { classifySensitiveAccess } from "@modules/role/domain/sensitive-access-policy";
import {
  RoleDependencyError,
  RoleValidationError,
} from "@modules/role/domain/role.errors";
import { UserRoleAssignmentRecord } from "@modules/role/domain/role.types";
import { EffectiveAccessAdminService } from "./admin.effective-access.service";

interface AssignmentDocument {
  readonly _id: string;
  readonly roleId: string;
  readonly userId: string;
  readonly structuredScopeGrants?: readonly RoleAssignmentScopeGrant[];
  readonly scopeFingerprint?: string;
  readonly state: "ACTIVE" | "REVOKED";
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
  readonly code: string;
  readonly name: string;
  readonly state: string;
  readonly permissions: readonly string[];
  readonly templateCode?: string;
  readonly templateVersion?: string;
}

interface UserDocument {
  readonly _id: string;
  readonly accountStatus: string;
  readonly disabledAt?: number | null;
  readonly archivedAt?: number | null;
  readonly profile?: {
    readonly displayName?: string;
    readonly email?: string;
  };
}

export interface AccessAssignmentLifecycleCommand {
  readonly assignmentId: string;
  readonly reason: unknown;
}

export class AccessAssignmentLifecycleAdminService {
  private readonly assignments: Collection<AssignmentDocument>;
  private readonly roles: Collection<RoleDocument>;
  private readonly users: Collection<UserDocument>;

  constructor(
    private readonly db: Db,
    private readonly audit: AuditGuard,
    private readonly mutationBridge: AuthoritativeAdminMutationBridge,
    private readonly actorSnapshotCacheInvalidator: ActorSnapshotCacheInvalidator,
  ) {
    this.assignments =
      db.collection<AssignmentDocument>("role_assignments");
    this.roles = db.collection<RoleDocument>("roles");
    this.users = db.collection<UserDocument>("users");
  }

  async listForTargetUser(targetUserId: unknown): Promise<Record<string, unknown>> {
    const normalizedTargetUserId = normalizeRequiredText(
      targetUserId,
      "targetUserId",
    );
    const now = Date.now();
    const targetUser = await this.users.findOne({ _id: normalizedTargetUserId });
    if (!targetUser) {
      throw new RoleDependencyError(
        `Access assignment target user not found: ${normalizedTargetUserId}`,
      );
    }

    const assignmentDocs = await this.assignments
      .find({ userId: normalizedTargetUserId })
      .sort({ updatedAt: -1, _id: 1 })
      .toArray();
    const roleIds = [...new Set(assignmentDocs.map((item) => item.roleId))];
    const roleDocs = roleIds.length
      ? await this.roles
          .find({ _id: { $in: roleIds } })
          .sort({ code: 1, _id: 1 })
          .toArray()
      : [];
    const roleById = new Map(roleDocs.map((role) => [role._id, role]));

    return {
      readOnly: true,
      sourceTruth: false,
      targetUser: toUserSummary(targetUser),
      supportedLifecycleActions: ["REVOKE"],
      unsupportedLifecycleActions: ["DISABLE", "EXPIRE", "ARCHIVE"],
      items: assignmentDocs.map((assignment) =>
        toAssignmentLifecycleView(assignment, roleById.get(assignment.roleId), now),
      ),
      generatedAt: new Date(now).toISOString(),
    };
  }

  async revoke(
    actor: Actor,
    command: AccessAssignmentLifecycleCommand,
  ): Promise<Record<string, unknown>> {
    const assignmentId = normalizeRequiredText(
      command.assignmentId,
      "assignmentId",
    );
    const reason = normalizeRequiredReason(command.reason);
    const permission = PermissionResolver.resolve(
      Permission.ROLE_REVOKE_FROM_USER,
    );

    const result = await this.mutationBridge.execute(
      {
        actor,
        traceId: getTraceIdOrThrow(),
        requiredPermission: permission,
        mutationIdentity: "role.revoke-from-user",
        mutationTargetDescriptor: `access-assignment.revoke:${assignmentId}`,
      },
      async (session, controls) => {
        const now = Date.now();
        const assignment = await this.assignments.findOne(
          { _id: assignmentId },
          { session },
        );
        const role = assignment
          ? await this.roles.findOne({ _id: assignment.roleId }, { session })
          : null;

        const blockers = this.evaluateRevokeBlockers({
          actor,
          assignment,
          role,
          assignmentId,
          now,
        });

        if (blockers.length > 0) {
          controls.markExplicitNoOpSuccess();
          return buildBlockedRevokeResult({
            assignment,
            role,
            blockers,
            now,
          });
        }

        if (!assignment || !role) {
          controls.markExplicitNoOpSuccess();
          return buildBlockedRevokeResult({
            assignment,
            role,
            blockers: [
              blocker(
                "ASSIGNMENT_NOT_FOUND",
                "Access assignment was not found.",
              ),
            ],
            now,
          });
        }

        const permissionCoverageBefore = await this.readPermissionCoverage(
          role.permissions,
          session,
        );
        const updated = await this.assignments.findOneAndUpdate(
          { _id: assignmentId, state: "ACTIVE" },
          {
            $set: {
              state: "REVOKED",
              revokedAt: now,
              revokedBy: actor.id,
              revokeReason: reason,
              updatedAt: now,
            },
          },
          { session, returnDocument: "after" },
        );

        if (!updated) {
          controls.markExplicitNoOpSuccess();
          return buildBlockedRevokeResult({
            assignment,
            role,
            blockers: [
              blocker(
                "STALE_ASSIGNMENT_STATE",
                "Access assignment changed before revoke was committed.",
              ),
            ],
            now,
          });
        }

        await this.roles.updateOne(
          { _id: role._id },
          { $set: { updatedAt: now } },
          { session },
        );

        await this.audit.record(
          actor,
          permission,
          updated.userId,
          {
            mutationType: "role.revoke-from-user",
            accessAssignmentLifecycle: true,
            lifecycleAction: "REVOKE",
            assignmentId: updated._id,
            targetUserId: updated.userId,
            roleId: role._id,
            roleCode: role.code,
            roleName: role.name,
            scopeFingerprint:
              updated.scopeFingerprint ??
              buildRoleAssignmentScopeFingerprint(undefined),
            structuredScopeGrants: updated.structuredScopeGrants ?? [],
            oldLifecycleState: assignment.state,
            newLifecycleState: updated.state,
            reason,
            bundleOrigin: updated.bundleOrigin ?? null,
            origin: updated.origin ?? "LEGACY",
          },
          session,
        );

        getCurrentDomainEventCollector().emit(
          createRoleRevokedFromUserEvent({
            roleId: role._id,
            assignmentId: updated._id,
            userId: updated.userId,
            aggregateVersion: now,
            occurredAt: now,
          }),
        );

        if (
          hasPermissionCoverageDelta({
            permissions: role.permissions,
            before: permissionCoverageBefore,
            after: await this.readPermissionCoverage(role.permissions, session),
          })
        ) {
          controls.markAuthSecurityTruthChanged();
        }

        return {
          revoked: true,
          lifecycleStatus: "REVOKED",
          blockers: [],
          warnings: [],
          assignment: toAssignmentLifecycleView(updated, role, now),
          auditTrace: {
            written: true,
            lifecycleAction: "REVOKE",
            actorId: actor.id,
            assignmentId: updated._id,
            targetUserId: updated.userId,
            oldStatus: assignment.state,
            newStatus: updated.state,
            reason,
            timestamp: now,
          },
          sourceTrace: {
            mutatesSource: true,
            source: "role_assignments",
            auditSource: "audit_log",
          },
        };
      },
    );

    if (isRecord(result) && result.revoked === true) {
      await this.actorSnapshotCacheInvalidator.invalidateAll({
        traceId: getTraceIdOrThrow(),
        actorId: actor.id,
        context: actor.context,
        operation: "access-assignment.revoke",
      });
      return {
        ...result,
        effectiveAccessAfterLifecycle: await new EffectiveAccessAdminService(
          this.db,
        ).getForUser(readTargetUserId(result)),
      };
    }

    return result;
  }

  private evaluateRevokeBlockers(params: {
    readonly actor: Actor;
    readonly assignment: AssignmentDocument | null;
    readonly role: RoleDocument | null;
    readonly assignmentId: string;
    readonly now: number;
  }): readonly Record<string, unknown>[] {
    if (!params.assignment) {
      return [
        blocker(
          "ASSIGNMENT_NOT_FOUND",
          `Access assignment not found: ${params.assignmentId}`,
        ),
      ];
    }

    const blockers: Record<string, unknown>[] = [];

    if (params.assignment.state !== "ACTIVE") {
      blockers.push(
        blocker(
          "ASSIGNMENT_ALREADY_INACTIVE",
          `Access assignment is already ${params.assignment.state}.`,
        ),
      );
    }

    if (params.assignment.userId === params.actor.id) {
      blockers.push(
        blocker(
          "SELF_LIFECYCLE_BLOCKED",
          "Actors cannot revoke their own access assignment through normal lifecycle UI.",
        ),
      );
    }

    if (!params.role) {
      blockers.push(
        blocker(
          "ROLE_NOT_FOUND",
          "Access assignment role was not found.",
        ),
      );
    }

    return blockers;
  }

  private async readPermissionCoverage(
    permissions: readonly string[],
    session: ClientSession,
  ): Promise<Readonly<Record<string, readonly string[]>>> {
    const permissionList = [...new Set(permissions)].sort();
    if (permissionList.length === 0) {
      return {};
    }

    const assignments = await this.assignments
      .find({ state: "ACTIVE" }, { session })
      .toArray();
    const roleIds = [...new Set(assignments.map((assignment) => assignment.roleId))];
    const roles = roleIds.length
      ? await this.roles
          .find({ _id: { $in: roleIds }, state: "ACTIVE" }, { session })
          .toArray()
      : [];
    const roleById = new Map(roles.map((role) => [role._id, role]));
    const now = Date.now();
    const coverage: Record<string, string[]> = Object.fromEntries(
      permissionList.map((permission) => [permission, []]),
    );

    for (const assignment of assignments) {
      if (!isRoleAssignmentCurrentlyEffective(assignment, now)) {
        continue;
      }
      const role = roleById.get(assignment.roleId);
      if (!role) {
        continue;
      }
      for (const permission of permissionList) {
        if (role.permissions.includes(permission)) {
          coverage[permission]?.push(assignment.userId);
        }
      }
    }

    return Object.fromEntries(
      Object.entries(coverage).map(([permission, users]) => [
        permission,
        [...new Set(users)].sort(),
      ]),
    );
  }
}

function toAssignmentLifecycleView(
  assignment: AssignmentDocument,
  role: RoleDocument | undefined | null,
  now: number,
): Record<string, unknown> {
  const currentlyEffective = isRoleAssignmentCurrentlyEffective(assignment, now);
  const scopeFingerprint =
    assignment.scopeFingerprint ?? buildRoleAssignmentScopeFingerprint(undefined);
  const structuredScopeGrants = assignment.structuredScopeGrants ?? [];
  const accessRisk = classifySensitiveAccess([
    {
      roleCode: role?.code ?? null,
      roleTemplateCode: role?.templateCode ?? role?.code ?? null,
      permissions: role?.permissions ?? [],
      structuredScopeGrants,
      bundleCode: assignment.bundleOrigin?.bundleCode ?? null,
    },
  ]);

  return {
    assignmentId: assignment._id,
    targetUserId: assignment.userId,
    roleId: assignment.roleId,
    roleCode: role?.code ?? null,
    roleName: role?.name ?? null,
    roleTemplateCode: role?.templateCode ?? null,
    roleTemplateVersion: role?.templateVersion ?? null,
    structuredScopeGrants,
    scopeFingerprint,
    status: assignment.state,
    lifecycleState: assignment.state,
    currentlyEffective,
    inactiveReason:
      assignment.state !== "ACTIVE"
        ? assignment.state
        : currentlyEffective
          ? null
          : "NOT_CURRENTLY_EFFECTIVE",
    effectiveAt: assignment.effectiveAt,
    expiresAt: assignment.expiresAt ?? null,
    reviewAt: assignment.reviewAt ?? null,
    assignedBy: assignment.assignedBy ?? null,
    assignedAt: assignment.assignedAt ?? assignment.createdAt,
    revokedAt: assignment.revokedAt,
    revokedBy: assignment.revokedBy ?? null,
    revokeReason: assignment.revokeReason ?? null,
    origin: assignment.origin ?? "LEGACY",
    bundleOrigin: assignment.bundleOrigin ?? null,
    reason: assignment.reason,
    sensitiveOrGlobal: accessRisk.isSensitive || accessRisk.isGlobalLike,
    isSensitive: accessRisk.isSensitive,
    isGlobalLike: accessRisk.isGlobalLike,
    isHighRisk: accessRisk.isHighRisk,
    requiresReview: accessRisk.requiresReview,
    isBreakGlassLike: accessRisk.isBreakGlassLike,
    accessRisk,
    supportedActions: assignment.state === "ACTIVE" ? ["REVOKE"] : [],
    auditSummary: {
      assignmentId: assignment._id,
      action: assignment.state === "REVOKED" ? "REVOKE" : "ASSIGN",
      actorId:
        assignment.state === "REVOKED"
          ? assignment.revokedBy ?? null
          : assignment.assignedBy ?? null,
      timestamp:
        assignment.state === "REVOKED"
          ? assignment.revokedAt
          : assignment.assignedAt ?? assignment.createdAt,
      reason:
        assignment.state === "REVOKED"
          ? assignment.revokeReason ?? null
          : assignment.reason,
      oldStatus: assignment.state === "REVOKED" ? "ACTIVE" : null,
      newStatus: assignment.state,
    },
  };
}

function buildBlockedRevokeResult(params: {
  readonly assignment: AssignmentDocument | null;
  readonly role: RoleDocument | null;
  readonly blockers: readonly Record<string, unknown>[];
  readonly now: number;
}): Record<string, unknown> {
  return {
    revoked: false,
    lifecycleStatus: "BLOCKED",
    blockers: params.blockers,
    warnings: [],
    assignment: params.assignment
      ? toAssignmentLifecycleView(params.assignment, params.role, params.now)
      : null,
    auditTrace: {
      written: false,
      reason: "LIFECYCLE_REVOKE_BLOCKED_BEFORE_MUTATION",
    },
    sourceTrace: {
      mutatesSource: false,
      source: "role_assignments",
    },
  };
}

function normalizeRequiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new RoleValidationError(`${field} is required`);
  }
  return value.trim();
}

function normalizeRequiredReason(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new RoleValidationError("reason is required");
  }
  return value.trim();
}

function toUserSummary(user: UserDocument): Record<string, unknown> {
  return {
    id: user._id,
    displayName: user.profile?.displayName ?? null,
    email: user.profile?.email ?? null,
    accountStatus: user.accountStatus,
  };
}

function blocker(code: string, summary: string): Record<string, unknown> {
  return { severity: "BLOCKER", code, summary };
}

function hasPermissionCoverageDelta(params: {
  readonly permissions: readonly string[];
  readonly before: Readonly<Record<string, readonly string[]>>;
  readonly after: Readonly<Record<string, readonly string[]>>;
}): boolean {
  for (const permission of params.permissions) {
    const before = params.before[permission] ?? [];
    const after = params.after[permission] ?? [];
    if (before.length !== after.length) {
      return true;
    }
    for (let index = 0; index < before.length; index += 1) {
      if (before[index] !== after[index]) {
        return true;
      }
    }
  }
  return false;
}

function readTargetUserId(value: Record<string, unknown>): string {
  const assignment = value.assignment;
  if (
    isRecord(assignment) &&
    typeof assignment.targetUserId === "string" &&
    assignment.targetUserId.trim()
  ) {
    return assignment.targetUserId;
  }
  throw new RoleDependencyError(
    "Lifecycle revoke result did not include target user id",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
