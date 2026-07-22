import { Collection, Db } from "mongodb";
import { Actor } from "@core/actor/actor";
import { AuditGuard } from "@core/audit/audit.guard";
import { AuthoritativeAdminMutationBridge } from "@core/application/authoritative-admin-mutation.bridge";
import { ActorSnapshotCacheInvalidator } from "@infra/cache/actor.snapshot.cache";
import { getTraceIdOrThrow } from "@core/trace/trace.context";
import { Permission } from "@core/permission/permission.enum";
import { PermissionResolver } from "@core/permission/permission.resolver";
import { getCurrentDomainEventCollector } from "@system/event-bridge/domain-event.types";
import { createRoleRevokedFromUserEvent } from "@modules/role/domain/role.events";
import { evaluateRoleAssignmentEffectiveness } from "@modules/role/domain/role-assignment-lifecycle";
import {
  RoleAssignmentScopeGrant,
  buildRoleAssignmentScopeFingerprint,
} from "@modules/role/domain/role-assignment-scope";
import {
  buildCurrentRoleAssignmentPolicy,
  classifySensitiveAccess,
} from "@modules/role/domain/sensitive-access-policy";
import {
  RoleDependencyError,
  RoleValidationError,
} from "@modules/role/domain/role.errors";
import { UserRoleAssignmentRecord } from "@modules/role/domain/role.types";
import { EffectiveAccessAdminService } from "./admin.effective-access.service";
import { AccessAuthorityReconciliationService } from "./access-authority-reconciliation.service";
import { buildAuthoritySlotIdentity } from "@modules/role/domain/authority-slot";
import { NativeMongoAuthoritySlotRepository } from "@infra/mongo/role/authority-slot.repository";
import {
  isRoleAssignmentOperationallyManageable,
  resolveRoleAssignmentOperationalState,
} from "@modules/role/domain/role-assignment-operational-state";

interface AssignmentDocument {
  readonly _id: string;
  readonly roleId: string;
  readonly userId: string;
  readonly structuredScopeGrants?: readonly RoleAssignmentScopeGrant[];
  readonly scopeFingerprint?: string;
  readonly state:
    "ACTIVE" | "SCHEDULED" | "SUSPENDED" | "SUPERSEDED" | "REVOKED";
  readonly effectiveAt: number | null;
  readonly expiresAt?: number | null;
  readonly reviewAt?: number | null;
  readonly lifecycle?: UserRoleAssignmentRecord["lifecycle"];
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
  private readonly reconciliation: AccessAuthorityReconciliationService;
  private readonly authoritySlots: NativeMongoAuthoritySlotRepository;

  constructor(
    private readonly db: Db,
    private readonly audit: AuditGuard,
    private readonly mutationBridge: AuthoritativeAdminMutationBridge,
    private readonly actorSnapshotCacheInvalidator: ActorSnapshotCacheInvalidator,
  ) {
    this.assignments = db.collection<AssignmentDocument>("role_assignments");
    this.roles = db.collection<RoleDocument>("roles");
    this.users = db.collection<UserDocument>("users");
    this.reconciliation = new AccessAuthorityReconciliationService(db);
    this.authoritySlots = new NativeMongoAuthoritySlotRepository(db);
  }

  async listForTargetUser(
    targetUserId: unknown,
  ): Promise<Record<string, unknown>> {
    const normalizedTargetUserId = normalizeRequiredText(
      targetUserId,
      "targetUserId",
    );
    const now = Date.now();
    const targetUser = await this.users.findOne({
      _id: normalizedTargetUserId,
    });
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
      supportedLifecycleActions: [
        "REVIEW",
        "GRACE_EXCEPTION",
        "RENEWAL",
        "REPLACEMENT",
        "RESTORATION",
        "REVOKE",
      ],
      unsupportedLifecycleActions: ["IN_PLACE_RENEWAL", "DIRECT_REACTIVATION"],
      items: assignmentDocs.map((assignment) =>
        toAssignmentLifecycleView(
          assignment,
          roleById.get(assignment.roleId),
          now,
        ),
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

        const updated = await this.assignments.findOneAndUpdate(
          {
            _id: assignmentId,
            state: { $in: ["ACTIVE", "SCHEDULED", "SUSPENDED"] },
          },
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

        const slot = buildAuthoritySlotIdentity({
          userId: updated.userId,
          roleId: updated.roleId,
          structuredScopeGrants: updated.structuredScopeGrants,
          scopeFingerprint: updated.scopeFingerprint,
        });
        await this.authoritySlots.releaseAssignment(
          slot.id,
          updated._id,
          `role.revoke-from-user:${updated._id}`,
          now,
          session,
        );

        await this.reconciliation.reconcileReducedAssignment(
          updated._id,
          actor.id,
          now,
          session,
        );
        await this.reconciliation.reconcileBundleParent(
          updated.bundleOrigin?.bundleAssignmentId,
          actor.id,
          now,
          session,
        );

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

        controls.markAuthSecurityTruthChanged();

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

    if (
      !isRoleAssignmentOperationallyManageable(params.assignment, params.now)
    ) {
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
        blocker("ROLE_NOT_FOUND", "Access assignment role was not found."),
      );
    }

    return blockers;
  }
}

function toAssignmentLifecycleView(
  assignment: AssignmentDocument,
  role: RoleDocument | undefined | null,
  now: number,
): Record<string, unknown> {
  const scopeFingerprint =
    assignment.scopeFingerprint ??
    buildRoleAssignmentScopeFingerprint(undefined);
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
  const currentPolicy = role
    ? buildCurrentRoleAssignmentPolicy({
        roleCode: role.code,
        roleTemplateCode: role.templateCode ?? role.code,
        permissions: role.permissions,
        structuredScopeGrants,
        effectiveAt: assignment.effectiveAt,
        durableReviewDeadline:
          assignment.lifecycle?.reviewDeadline ?? assignment.reviewAt,
        durableRiskTier: assignment.lifecycle?.riskTier ?? null,
        storedPermissionFingerprint:
          assignment.lifecycle?.permissionFingerprint ?? null,
        assessedAt: now,
        scopeFingerprint,
      })
    : undefined;
  const effectiveness = evaluateRoleAssignmentEffectiveness(
    assignment,
    now,
    currentPolicy,
  );
  const currentlyEffective = effectiveness.effective;
  const operational = resolveRoleAssignmentOperationalState(
    assignment,
    now,
    currentPolicy,
  );

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
    operationalState: operational.state,
    currentlyEffective,
    inactiveReason: currentlyEffective
      ? null
      : (effectiveness.reason ?? assignment.state),
    effectiveAt: assignment.effectiveAt,
    expiresAt: assignment.expiresAt ?? null,
    reviewAt: assignment.reviewAt ?? null,
    lifecycle: assignment.lifecycle ?? null,
    nextAuthorityTransitionAt: effectiveness.nextTransitionAt ?? null,
    authorityEndsAt: effectiveness.authorityEndsAt ?? null,
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
    currentPermissionFingerprint: currentPolicy?.permissionFingerprint ?? null,
    permissionFingerprintDrifted: Boolean(
      currentPolicy &&
      assignment.lifecycle?.permissionFingerprint &&
      assignment.lifecycle.permissionFingerprint !==
        currentPolicy.permissionFingerprint,
    ),
    supportedActions:
      operational.state === "OPERATIONALLY_ACTIVE"
        ? ["REVIEW", "GRACE_EXCEPTION", "RENEWAL", "REPLACEMENT", "REVOKE"]
        : operational.state === "OPERATIONALLY_SUSPENDED"
          ? ["RENEWAL", "REPLACEMENT", "RESTORATION", "REVOKE"]
          : operational.state === "FUTURE_SCHEDULED"
            ? ["REVOKE"]
            : [],
    auditSummary: {
      assignmentId: assignment._id,
      action: assignment.state === "REVOKED" ? "REVOKE" : "ASSIGN",
      actorId:
        assignment.state === "REVOKED"
          ? (assignment.revokedBy ?? null)
          : (assignment.assignedBy ?? null),
      timestamp:
        assignment.state === "REVOKED"
          ? assignment.revokedAt
          : (assignment.assignedAt ?? assignment.createdAt),
      reason:
        assignment.state === "REVOKED"
          ? (assignment.revokeReason ?? null)
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
