import crypto from "crypto";
import { ClientSession, Collection, Db, MongoServerError } from "mongodb";
import { Actor } from "@core/actor/actor";
import { AuditGuard } from "@core/audit/audit.guard";
import {
  AuthoritativeAdminMutationBridge,
} from "@core/application/authoritative-admin-mutation.bridge";
import { getTraceIdOrThrow } from "@core/trace/trace.context";
import { Permission } from "@core/permission/permission.enum";
import { PermissionResolver } from "@core/permission/permission.resolver";
import { ActorSnapshotCacheInvalidator } from "@infra/cache/actor.snapshot.cache";
import { getCurrentDomainEventCollector } from "@system/event-bridge/domain-event.types";
import { createRoleAssignedToUserEvent } from "@modules/role/domain/role.events";
import { isRoleAssignmentCurrentlyEffective } from "@modules/role/domain/role-assignment-lifecycle";
import { RoleAssignmentScopeGrant } from "@modules/role/domain/role-assignment-scope";
import {
  RoleAssignmentConflictError,
  RoleDependencyError,
  RoleValidationError,
} from "@modules/role/domain/role.errors";
import { RoleDelegationBand, RoleMaxDelegatableBand } from "@modules/role/domain/role.types";
import {
  AccessAssignmentPreviewAdminService,
  AccessAssignmentPreviewCommand,
} from "./admin.access-assignment-preview.service";
import { EffectiveAccessAdminService } from "./admin.effective-access.service";

type AssignmentOrigin = "DIRECT" | "BUNDLE";

interface ProposedAssignmentForApply {
  readonly roleId: string;
  readonly roleCode: string;
  readonly roleName: string;
  readonly permissions: readonly string[];
  readonly structuredScopeGrants: readonly RoleAssignmentScopeGrant[];
  readonly scopeFingerprint: string;
  readonly effectiveAt: number;
  readonly expiresAt: number | null;
  readonly reviewAt: number | null;
  readonly origin: AssignmentOrigin;
  readonly bundleOrigin: {
    readonly bundleAssignmentId: string;
    readonly bundleCode: string;
    readonly bundleVersion: string;
  } | null;
  readonly reason: string | null;
}

interface RoleDocument {
  readonly _id: string;
  readonly code: string;
  readonly state: string;
  readonly delegationBand?: RoleDelegationBand;
  readonly maxDelegatableBand?: RoleMaxDelegatableBand;
}

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
  readonly bundleOrigin?: ProposedAssignmentForApply["bundleOrigin"];
  readonly reason: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

interface AssignmentRuleDocument {
  readonly _id: string;
  readonly roleId: string;
  readonly code: string;
  readonly state: "ACTIVE" | "INACTIVE";
  readonly conditions: Record<string, unknown> | null;
}

interface ApplyUserDocument {
  readonly _id: string;
  readonly accountStatus: string;
  readonly disabledAt?: number | null;
  readonly archivedAt?: number | null;
}

export class AccessAssignmentApplyAdminService {
  private readonly previewService: AccessAssignmentPreviewAdminService;
  private readonly roles: Collection<RoleDocument>;
  private readonly assignments: Collection<AssignmentDocument>;
  private readonly assignmentRules: Collection<AssignmentRuleDocument>;

  constructor(
    private readonly db: Db,
    private readonly audit: AuditGuard,
    private readonly mutationBridge: AuthoritativeAdminMutationBridge,
    private readonly actorSnapshotCacheInvalidator: ActorSnapshotCacheInvalidator,
  ) {
    this.previewService = new AccessAssignmentPreviewAdminService(db);
    this.roles = db.collection<RoleDocument>("roles");
    this.assignments = db.collection<AssignmentDocument>("role_assignments");
    this.assignmentRules = db.collection<AssignmentRuleDocument>(
      "role_assignment_rules",
    );
  }

  async apply(
    actor: Actor,
    command: AccessAssignmentPreviewCommand,
  ): Promise<Record<string, unknown>> {
    const permission = PermissionResolver.resolve(Permission.ROLE_ASSIGN_TO_USER);
    const result = await this.mutationBridge.execute(
      {
        actor,
        traceId: getTraceIdOrThrow(),
        requiredPermission: permission,
        mutationIdentity: "role.assign-to-user",
        mutationTargetDescriptor: buildMutationTargetDescriptor(command),
      },
      async (session, controls) => {
        const preview = await this.previewService.preview(
          {
            ...command,
            actorUserId: actor.id,
          },
          { session },
        );
        const blockers = [...readRecords(preview.blockers)];
        const reason = normalizeReason(command.reason);

        if (!reason) {
          blockers.push(blocker("REASON_REQUIRED", "Reason is required for all access assignment apply requests."));
        }

        if (blockers.length > 0) {
          controls.markExplicitNoOpSuccess();
          return buildBlockedApplyResult(preview, blockers);
        }

        const proposedAssignments = readProposedAssignments(preview);
        if (proposedAssignments.length === 0) {
          controls.markExplicitNoOpSuccess();
          return buildBlockedApplyResult(preview, [
            blocker("NO_ASSIGNMENTS_TO_APPLY", "No child role assignments were resolved for apply."),
          ]);
        }

        await this.assertActorActiveForApply(actor, session);
        const now = Date.now();
        const appliedAssignments: AssignmentDocument[] = [];
        const trackedRoleIds = new Set<string>();

        for (const proposed of proposedAssignments) {
          const role = await this.requireActiveRole(proposed.roleId, session);
          this.assertRoleDelegationAllowed(role);
          await this.assertActorCanDelegateRoleBand(
            actor.id,
            role.delegationBand ?? "LIMITED",
            role._id,
            session,
          );
          await this.assertAssignmentRulesAllow({
            actor,
            role,
            userId: command.targetUserId,
            session,
          });

          const existing = await this.assignments.findOne(
            {
              roleId: proposed.roleId,
              userId: command.targetUserId,
              scopeFingerprint: proposed.scopeFingerprint,
              state: "ACTIVE",
            },
            { session },
          );
          if (existing) {
            throw new RoleAssignmentConflictError(
              `Active assignment already exists for role ${proposed.roleId}, user ${command.targetUserId}, and scope ${proposed.scopeFingerprint}`,
            );
          }

          const assignment: AssignmentDocument = {
            _id: crypto.randomUUID(),
            roleId: proposed.roleId,
            userId: command.targetUserId,
            structuredScopeGrants: [...proposed.structuredScopeGrants],
            scopeFingerprint: proposed.scopeFingerprint,
            state: "ACTIVE",
            effectiveAt: proposed.effectiveAt,
            expiresAt: proposed.expiresAt,
            reviewAt: proposed.reviewAt,
            assignedBy: actor.id,
            assignedAt: now,
            revokedAt: null,
            revokedBy: null,
            revokeReason: null,
            origin: proposed.origin,
            bundleOrigin: proposed.bundleOrigin,
            reason,
            createdAt: now,
            updatedAt: now,
          };
          appliedAssignments.push(assignment);
          trackedRoleIds.add(proposed.roleId);
        }

        try {
          await this.assignments.insertMany(appliedAssignments, {
            ordered: true,
            session,
          });
        } catch (error) {
          if (isDuplicateKeyError(error)) {
            throw new RoleAssignmentConflictError(
              "Active duplicate assignment detected during apply.",
            );
          }
          throw error;
        }

        for (const roleId of trackedRoleIds) {
          await this.roles.updateOne(
            { _id: roleId },
            { $set: { updatedAt: now } },
            { session },
          );
        }

        await this.audit.record(
          actor,
          permission,
          command.targetUserId,
          {
            mutationType: "role.assign-to-user",
            accessAssignmentApply: true,
            targetUserId: command.targetUserId,
            assignmentTarget: preview.assignmentTarget,
            assignmentIds: appliedAssignments.map((item) => item._id),
            roleIds: appliedAssignments.map((item) => item.roleId),
            scopeFingerprints: appliedAssignments.map((item) => item.scopeFingerprint),
            reason,
            bundleExpansion: preview.bundleExpansion ?? null,
            responsibilityRequirements: preview.responsibilityRequirements ?? [],
            accountContextRequirement: preview.accountContextRequirement ?? null,
            sensitiveAccess: preview.sensitiveAccess ?? null,
            sourceTrace: preview.sourceTrace ?? null,
          },
          session,
        );

        for (const assignment of appliedAssignments) {
          getCurrentDomainEventCollector().emit(
            createRoleAssignedToUserEvent({
              roleId: assignment.roleId,
              assignmentId: assignment._id,
              userId: assignment.userId,
              aggregateVersion: now,
              occurredAt: now,
            }),
          );
        }

        controls.markAuthSecurityTruthChanged();

        return {
          applied: true,
          canApply: true,
          applyStatus: "APPLIED",
          blockers: [],
          warnings: preview.warnings ?? [],
          targetUser: preview.targetUser,
          assignmentTarget: preview.assignmentTarget,
          normalizedScope: preview.normalizedScope,
          scopeFingerprint: preview.scopeFingerprint,
          appliedAssignments: appliedAssignments.map((assignment, index) => ({
            assignmentId: assignment._id,
            roleId: assignment.roleId,
            roleCode: proposedAssignments[index]?.roleCode ?? null,
            roleName: proposedAssignments[index]?.roleName ?? null,
            userId: assignment.userId,
            structuredScopeGrants: assignment.structuredScopeGrants ?? [],
            scopeFingerprint: assignment.scopeFingerprint,
            effectiveAt: assignment.effectiveAt,
            expiresAt: assignment.expiresAt ?? null,
            reviewAt: assignment.reviewAt ?? null,
            assignedBy: assignment.assignedBy,
            assignedAt: assignment.assignedAt,
            origin: assignment.origin,
            bundleOrigin: assignment.bundleOrigin ?? null,
            reason: assignment.reason,
          })),
          bundleExpansion: rewriteAppliedBundleExpansion(
            preview.bundleExpansion,
            appliedAssignments,
          ),
          accountContextResult: {
            materialized: false,
            materializationPolicy: "DEFERRED_FAIL_CLOSED",
            requirement: preview.accountContextRequirement ?? null,
            grantsAuthorityByItself: false,
          },
          consoleEntitlementResult: preview.consoleEntitlementPreview ?? null,
          responsibilityRequirements: preview.responsibilityRequirements ?? [],
          sensitiveAccess: preview.sensitiveAccess ?? null,
          duplicateConflicts: [],
          auditTrace: {
            written: true,
            mutationType: "role.assign-to-user",
            assignmentIds: appliedAssignments.map((item) => item._id),
            targetUserId: command.targetUserId,
          },
          sourceTrace: {
            ...(isRecord(preview.sourceTrace) ? preview.sourceTrace : {}),
            mutatesSource: true,
            auditSource: "audit_log",
          },
        };
      },
    );

    if (isRecord(result) && result.applied === true) {
      await this.actorSnapshotCacheInvalidator.invalidateAll({
        traceId: getTraceIdOrThrow(),
        actorId: actor.id,
        context: actor.context,
        operation: "access-assignment.apply",
      });
      return {
        ...result,
        effectiveAccessAfterApply: await new EffectiveAccessAdminService(
          this.db,
        ).getForUser(command.targetUserId),
      };
    }

    return result;
  }

  private async assertActorActiveForApply(
    actor: Actor,
    session: ClientSession,
  ): Promise<void> {
    if (!actor.isActive) {
      throw new RoleDependencyError(`Assignment actor is not ACTIVE: ${actor.id}`);
    }
    const actorUser = await this.db.collection<ApplyUserDocument>("users").findOne(
      {
        _id: actor.id,
        accountStatus: "ACTIVE",
        disabledAt: null,
        archivedAt: null,
      },
      { session },
    );
    if (!actorUser) {
      throw new RoleDependencyError(`Assignment actor is not assignable: ${actor.id}`);
    }
  }

  private async requireActiveRole(
    roleId: string,
    session: ClientSession,
  ): Promise<RoleDocument> {
    const role = await this.roles.findOne({ _id: roleId }, { session });
    if (!role || role.state !== "ACTIVE") {
      throw new RoleDependencyError(`Role must be ACTIVE to apply assignment: ${roleId}`);
    }
    return role;
  }

  private assertRoleDelegationAllowed(role: RoleDocument): void {
    if ((role.delegationBand ?? "LIMITED") === "FOUNDATION") {
      throw new RoleDependencyError(
        `Role ${role._id} in delegation band FOUNDATION cannot be assigned on apply path`,
      );
    }
  }

  private async assertActorCanDelegateRoleBand(
    actorId: string,
    targetBand: RoleDelegationBand,
    roleId: string,
    session: ClientSession,
  ): Promise<void> {
    const actorAssignments = await this.assignments
      .find({ userId: actorId, state: "ACTIVE" }, { session })
      .toArray();
    const now = Date.now();
    const activeActorAssignments = actorAssignments.filter((assignment) =>
      isRoleAssignmentCurrentlyEffective(assignment, now),
    );
    const actorRoleIds = [...new Set(activeActorAssignments.map((item) => item.roleId))];
    const actorRoles = actorRoleIds.length
      ? await this.roles
          .find({ _id: { $in: actorRoleIds }, state: "ACTIVE" }, { session })
          .toArray()
      : [];

    if (
      actorRoles.some((role) =>
        isDelegationCeilingSufficient(role.maxDelegatableBand ?? "NONE", targetBand),
      )
    ) {
      return;
    }

    throw new RoleDependencyError(
      `Delegation denied: actor ${actorId} lacks active role delegation ceiling for role ${roleId} band ${targetBand}`,
    );
  }

  private async assertAssignmentRulesAllow(params: {
    readonly actor: Actor;
    readonly role: RoleDocument;
    readonly userId: string;
    readonly session: ClientSession;
  }): Promise<void> {
    const rules = await this.assignmentRules
      .find({ roleId: params.role._id }, { session: params.session })
      .toArray();
    const evaluationContext = {
      role: {
        id: params.role._id,
        code: params.role.code,
        state: params.role.state,
      },
      target: {
        userId: params.userId,
      },
      actor: {
        id: params.actor.id,
        type: params.actor.type,
        context: params.actor.context,
      },
    };

    for (const rule of rules) {
      if (rule.state !== "ACTIVE" || rule.conditions === null) {
        continue;
      }
      if (!doesRuleConditionMatchContext(rule.conditions, evaluationContext)) {
        throw new RoleDependencyError(
          `Role assignment denied by rule ${rule.code} for role ${params.role._id} and user ${params.userId}`,
        );
      }
    }
  }
}

function buildBlockedApplyResult(
  preview: Record<string, unknown>,
  blockers: readonly Record<string, unknown>[],
): Record<string, unknown> {
  return {
    applied: false,
    canApply: false,
    applyStatus: "BLOCKED",
    blockers,
    warnings: preview.warnings ?? [],
    targetUser: preview.targetUser,
    assignmentTarget: preview.assignmentTarget,
    normalizedScope: preview.normalizedScope,
    scopeFingerprint: preview.scopeFingerprint,
    proposedAssignments: preview.proposedAssignments ?? [],
    bundleExpansion: preview.bundleExpansion ?? null,
    accountContextResult: {
      materialized: false,
      materializationPolicy: "DEFERRED_FAIL_CLOSED",
      requirement: preview.accountContextRequirement ?? null,
      grantsAuthorityByItself: false,
    },
    consoleEntitlementResult: preview.consoleEntitlementPreview ?? null,
    responsibilityRequirements: preview.responsibilityRequirements ?? [],
    sensitiveAccess: preview.sensitiveAccess ?? null,
    duplicateConflicts: preview.duplicateConflicts ?? [],
    auditTrace: {
      written: false,
      reason: "APPLY_BLOCKED_BEFORE_MUTATION",
    },
    sourceTrace: {
      ...(isRecord(preview.sourceTrace) ? preview.sourceTrace : {}),
      mutatesSource: false,
    },
  };
}

function readProposedAssignments(
  preview: Readonly<Record<string, unknown>>,
): readonly ProposedAssignmentForApply[] {
  if (!Array.isArray(preview.proposedAssignments)) {
    return [];
  }
  return preview.proposedAssignments.map((item, index) => {
    if (!isRecord(item)) {
      throw new RoleValidationError(`proposedAssignments[${index}] must be an object`);
    }
    return {
      roleId: readRequiredString(item.roleId, `proposedAssignments[${index}].roleId`),
      roleCode: readRequiredString(item.roleCode, `proposedAssignments[${index}].roleCode`),
      roleName: readRequiredString(item.roleName, `proposedAssignments[${index}].roleName`),
      permissions: readStringArray(item.permissions),
      structuredScopeGrants: readScopeGrants(item.structuredScopeGrants),
      scopeFingerprint: readRequiredString(
        item.scopeFingerprint,
        `proposedAssignments[${index}].scopeFingerprint`,
      ),
      effectiveAt: readRequiredNumber(item.effectiveAt, `proposedAssignments[${index}].effectiveAt`),
      expiresAt: readNullableNumber(item.expiresAt, `proposedAssignments[${index}].expiresAt`),
      reviewAt: readNullableNumber(item.reviewAt, `proposedAssignments[${index}].reviewAt`),
      origin: item.origin === "BUNDLE" ? "BUNDLE" : "DIRECT",
      bundleOrigin: isRecord(item.bundleOrigin)
        ? {
            bundleAssignmentId: readRequiredString(
              item.bundleOrigin.bundleAssignmentId,
              `proposedAssignments[${index}].bundleOrigin.bundleAssignmentId`,
            ),
            bundleCode: readRequiredString(
              item.bundleOrigin.bundleCode,
              `proposedAssignments[${index}].bundleOrigin.bundleCode`,
            ),
            bundleVersion: readRequiredString(
              item.bundleOrigin.bundleVersion,
              `proposedAssignments[${index}].bundleOrigin.bundleVersion`,
            ),
          }
        : null,
      reason: typeof item.reason === "string" ? item.reason : null,
    };
  });
}

function rewriteAppliedBundleExpansion(
  value: unknown,
  assignments: readonly AssignmentDocument[],
): unknown {
  if (!isRecord(value)) {
    return null;
  }
  return {
    ...value,
    persistedParentBundleAssignment: false,
    appliedChildCount: assignments.length,
    childAssignmentIds: assignments.map((item) => item._id),
  };
}

function readRecords(value: unknown): readonly Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function readScopeGrants(value: unknown): readonly RoleAssignmentScopeGrant[] {
  return Array.isArray(value)
    ? value.filter((item): item is RoleAssignmentScopeGrant => isRecord(item))
    : [];
}

function readStringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function readRequiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new RoleValidationError(`${field} is required`);
  }
  return value.trim();
}

function readRequiredNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RoleValidationError(`${field} must be a number`);
  }
  return value;
}

function readNullableNumber(value: unknown, field: string): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  return readRequiredNumber(value, field);
}

function normalizeReason(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    throw new RoleValidationError("reason must be a string");
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function blocker(code: string, summary: string): Record<string, unknown> {
  return { severity: "BLOCKER", code, summary };
}

function buildMutationTargetDescriptor(
  command: AccessAssignmentPreviewCommand,
): string {
  const targetUserId =
    typeof command.targetUserId === "string" && command.targetUserId.trim()
      ? command.targetUserId.trim()
      : "unknown-target-user";
  const target =
    command.assignmentTargetCode ??
    command.assignmentTargetId ??
    command.assignmentTargetType;
  return `access-assignment.apply:${targetUserId}:${target}`;
}

function isDuplicateKeyError(error: unknown): boolean {
  return error instanceof MongoServerError && error.code === 11000;
}

function isDelegationCeilingSufficient(
  ceiling: RoleMaxDelegatableBand,
  targetBand: RoleDelegationBand,
): boolean {
  if (targetBand === "FOUNDATION") {
    return false;
  }
  const ceilingRank =
    ceiling === "PRIVILEGED" ? 2 : ceiling === "LIMITED" ? 1 : 0;
  const targetRank = targetBand === "PRIVILEGED" ? 2 : 1;
  return ceilingRank >= targetRank;
}

function doesRuleConditionMatchContext(
  condition: Record<string, unknown>,
  context: Record<string, unknown>,
): boolean {
  for (const [key, expectedValue] of Object.entries(condition)) {
    if (!(key in context)) {
      return false;
    }
    if (!doesRuleConditionValueMatch(expectedValue, context[key])) {
      return false;
    }
  }
  return true;
}

function doesRuleConditionValueMatch(
  expectedValue: unknown,
  actualValue: unknown,
): boolean {
  if (expectedValue === null || typeof expectedValue !== "object") {
    return Object.is(expectedValue, actualValue);
  }
  if (
    typeof actualValue !== "object" ||
    actualValue === null ||
    Array.isArray(actualValue)
  ) {
    return false;
  }
  return doesRuleConditionMatchContext(
    expectedValue as Record<string, unknown>,
    actualValue as Record<string, unknown>,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
