import crypto from "crypto";
import { ClientSession, Collection, Db, MongoServerError } from "mongodb";
import { Actor } from "@core/actor/actor";
import { AuditGuard } from "@core/audit/audit.guard";
import { AuthoritativeAdminMutationBridge } from "@core/application/authoritative-admin-mutation.bridge";
import { getTraceIdOrThrow } from "@core/trace/trace.context";
import { Permission } from "@core/permission/permission.enum";
import { PermissionResolver } from "@core/permission/permission.resolver";
import { ActorSnapshotCacheInvalidator } from "@infra/cache/actor.snapshot.cache";
import { getCurrentDomainEventCollector } from "@system/event-bridge/domain-event.types";
import { createRoleAssignedToUserEvent } from "@modules/role/domain/role.events";
import { isRoleAssignmentCurrentlyEffective } from "@modules/role/domain/role-assignment-lifecycle";
import {
  RoleAssignmentScopeGrant,
  buildRoleAssignmentScopeFingerprint,
} from "@modules/role/domain/role-assignment-scope";
import {
  RoleAssignmentConflictError,
  RoleDependencyError,
  RoleValidationError,
} from "@modules/role/domain/role.errors";
import {
  RoleDelegationBand,
  RoleMaxDelegatableBand,
} from "@modules/role/domain/role.types";
import { RoleAssignmentLifecycleSnapshot } from "@modules/role/domain/role.types";
import {
  buildAccessRiskSnapshot,
  buildCurrentRoleAssignmentPolicy,
} from "@modules/role/domain/sensitive-access-policy";
import { AssignmentReviewCycleRecord } from "@modules/role/domain/access-lifecycle-policy";
import {
  AccessAssignmentPreviewAdminService,
  AccessAssignmentPreviewCommand,
} from "./admin.access-assignment-preview.service";
import { EffectiveAccessAdminService } from "./admin.effective-access.service";
import { buildAuthoritySlotIdentity } from "@modules/role/domain/authority-slot";
import { NativeMongoAuthoritySlotRepository } from "@infra/mongo/role/authority-slot.repository";
import { findOperationalAssignmentOccupant } from "./access-assignment-occupancy";

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
  readonly permissions: readonly string[];
  readonly templateCode?: string;
  readonly delegationBand?: RoleDelegationBand;
  readonly maxDelegatableBand?: RoleMaxDelegatableBand;
}

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
  readonly lifecycle?: RoleAssignmentLifecycleSnapshot | null;
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
  readonly accountContexts?: readonly string[];
  readonly disabledAt?: number | null;
  readonly archivedAt?: number | null;
  readonly updatedAt?: number;
}

interface BundleAssignmentDocument {
  readonly _id: string;
  readonly targetUserId: string;
  readonly bundleCode: string;
  readonly bundleVersion: string;
  readonly assignedBy: string;
  readonly assignedAt: number;
  readonly reason: string;
  readonly status: "ACTIVE";
  readonly effectiveAt: number | null;
  readonly expiresAt: number | null;
  readonly reviewAt: number | null;
  readonly childRoleAssignmentIds: readonly string[];
  readonly sourceTrace: Record<string, unknown>;
  readonly createdAt: number;
  readonly updatedAt: number;
}

interface ResponsibilityAssignmentDocument {
  readonly _id: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly responsibleEmploymentProfileId: string;
  readonly responsibilityType: string;
  readonly responsibilityRole: string | null;
  readonly includeDescendants: boolean | null;
  readonly actionMask: readonly string[];
  readonly isPrimary: boolean;
  readonly status: "ACTIVE";
  readonly effectiveAt: number;
  readonly expiresAt: number | null;
  readonly revokedAt: number | null;
  readonly reason: string | null;
  readonly createdBy: string;
  readonly createdAt: number;
  readonly updatedBy: string;
  readonly updatedAt: number;
  readonly revokedBy: string | null;
  readonly revokedReason: string | null;
}

interface GeneratedAccessPrerequisiteDocument {
  readonly _id: string;
  readonly targetUserId: string;
  readonly sourceRoleAssignmentIds: readonly string[];
  readonly kind: "ACCOUNT_CONTEXT" | "RESPONSIBILITY";
  readonly value: string;
  readonly status: "ACTIVE" | "REVOKED";
  readonly createdAt: number;
  readonly revokedAt: number | null;
}

export class AccessAssignmentApplyAdminService {
  private readonly previewService: AccessAssignmentPreviewAdminService;
  private readonly users: Collection<ApplyUserDocument>;
  private readonly roles: Collection<RoleDocument>;
  private readonly reviewCycles: Collection<
    Omit<AssignmentReviewCycleRecord, "cycleId"> & { readonly _id: string }
  >;
  private readonly assignments: Collection<AssignmentDocument>;
  private readonly assignmentRules: Collection<AssignmentRuleDocument>;
  private readonly bundleAssignments: Collection<BundleAssignmentDocument>;
  private readonly responsibilities: Collection<ResponsibilityAssignmentDocument>;
  private readonly generatedPrerequisites: Collection<GeneratedAccessPrerequisiteDocument>;
  private readonly authoritySlots: NativeMongoAuthoritySlotRepository;

  constructor(
    private readonly db: Db,
    private readonly audit: AuditGuard,
    private readonly mutationBridge: AuthoritativeAdminMutationBridge,
    private readonly actorSnapshotCacheInvalidator: ActorSnapshotCacheInvalidator,
  ) {
    this.previewService = new AccessAssignmentPreviewAdminService(db);
    this.users = db.collection<ApplyUserDocument>("users");
    this.roles = db.collection<RoleDocument>("roles");
    this.reviewCycles = db.collection("assignment_review_cycles");
    this.assignments = db.collection<AssignmentDocument>("role_assignments");
    this.assignmentRules = db.collection<AssignmentRuleDocument>(
      "role_assignment_rules",
    );
    this.bundleAssignments =
      db.collection<BundleAssignmentDocument>("bundle_assignments");
    this.responsibilities = db.collection<ResponsibilityAssignmentDocument>(
      "responsibility_assignments",
    );
    this.generatedPrerequisites =
      db.collection<GeneratedAccessPrerequisiteDocument>(
        "generated_access_prerequisites",
      );
    this.authoritySlots = new NativeMongoAuthoritySlotRepository(db);
  }

  async apply(
    actor: Actor,
    command: AccessAssignmentPreviewCommand,
  ): Promise<Record<string, unknown>> {
    const permission = PermissionResolver.resolve(
      Permission.ROLE_ASSIGN_TO_USER,
    );
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
          { session, actor },
        );
        const blockers = [...readRecords(preview.blockers)];
        const reason = normalizeReason(command.reason);

        if (!reason) {
          blockers.push(
            blocker(
              "REASON_REQUIRED",
              "Reason is required for all access assignment apply requests.",
            ),
          );
        }

        if (blockers.length > 0) {
          controls.markExplicitNoOpSuccess();
          return buildBlockedApplyResult(preview, blockers);
        }
        const applyReason = reason;
        if (!applyReason) {
          throw new RoleValidationError("reason is required");
        }

        const proposedAssignments = readProposedAssignments(preview);
        if (proposedAssignments.length === 0) {
          controls.markExplicitNoOpSuccess();
          return buildBlockedApplyResult(preview, [
            blocker(
              "NO_ASSIGNMENTS_TO_APPLY",
              "No child role assignments were resolved for apply.",
            ),
          ]);
        }

        await this.assertActorActiveForApply(actor, session);
        const now = Date.now();
        const appliedAssignments: AssignmentDocument[] = [];
        const reviewCycleDocuments: Array<
          Omit<AssignmentReviewCycleRecord, "cycleId"> & {
            readonly _id: string;
          }
        > = [];
        const trackedRoleIds = new Set<string>();
        const bundleAssignment = buildBundleAssignmentDocument({
          preview,
          proposedAssignments,
          actorId: actor.id,
          targetUserId: command.targetUserId,
          reason: applyReason,
          now,
        });
        const accountContextResult = await this.materializeAccountContext({
          preview,
          actor,
          targetUserId: command.targetUserId,
          reason: applyReason,
          now,
          session,
        });
        const responsibilityOperationResult =
          await this.materializeResponsibilities({
            preview,
            actor,
            reason: applyReason,
            now,
            session,
          });

        for (const proposed of proposedAssignments) {
          const role = await this.requireActiveRole(proposed.roleId, session);
          assertRoleDelegationAllowed(role);
          await assertActorCanDelegateRoleBand(
            actor.id,
            role.delegationBand ?? "LIMITED",
            role._id,
            this.assignments,
            this.roles,
            session,
          );
          await this.assertAssignmentRulesAllow({
            actor,
            role,
            userId: command.targetUserId,
            session,
          });

          const existing = await findOperationalAssignmentOccupant(
            this.db,
            {
              userId: command.targetUserId,
              roleId: proposed.roleId,
              roleCode: proposed.roleCode,
              structuredScopeGrants: proposed.structuredScopeGrants,
              scopeFingerprint: proposed.scopeFingerprint,
            },
            now,
            session,
          );
          if (existing) {
            throw new RoleAssignmentConflictError(
              `Active assignment already exists for role ${proposed.roleId}, user ${command.targetUserId}, and scope ${proposed.scopeFingerprint}`,
            );
          }

          const riskSnapshot = buildAccessRiskSnapshot({
            assignments: [
              {
                roleCode: proposed.roleCode,
                roleTemplateCode: proposed.roleCode,
                permissions: proposed.permissions,
                structuredScopeGrants: proposed.structuredScopeGrants,
                bundleCode: proposed.bundleOrigin?.bundleCode ?? null,
              },
            ],
            assessedAt: now,
            scopeFingerprint: proposed.scopeFingerprint,
          });
          const cycleId =
            proposed.reviewAt === null ? null : crypto.randomUUID();
          const lifecycle: RoleAssignmentLifecycleSnapshot | null =
            cycleId && proposed.reviewAt !== null
              ? {
                  cycleId,
                  riskTier: riskSnapshot.tier,
                  riskReasons: riskSnapshot.reasons,
                  riskAssessedAt: riskSnapshot.assessedAt,
                  permissionFingerprint: riskSnapshot.permissionFingerprint,
                  scopeFingerprint: riskSnapshot.scopeFingerprint,
                  reviewDeadline: proposed.reviewAt,
                  graceExceptionExpiresAt: null,
                  suspendedAt: null,
                  suspensionCause: null,
                  predecessorAssignmentId: null,
                  successorAssignmentId: null,
                  lineageAction: null,
                }
              : null;
          const assignmentId = crypto.randomUUID();
          const assignment: AssignmentDocument = {
            _id: assignmentId,
            roleId: proposed.roleId,
            userId: command.targetUserId,
            structuredScopeGrants: [...proposed.structuredScopeGrants],
            scopeFingerprint: proposed.scopeFingerprint,
            state: "ACTIVE",
            effectiveAt: proposed.effectiveAt,
            expiresAt: proposed.expiresAt,
            reviewAt: proposed.reviewAt,
            lifecycle,
            assignedBy: actor.id,
            assignedAt: now,
            revokedAt: null,
            revokedBy: null,
            revokeReason: null,
            origin: proposed.origin,
            bundleOrigin:
              proposed.origin === "BUNDLE" && bundleAssignment
                ? {
                    bundleAssignmentId: bundleAssignment._id,
                    bundleCode: bundleAssignment.bundleCode,
                    bundleVersion: bundleAssignment.bundleVersion,
                  }
                : proposed.bundleOrigin,
            reason: applyReason,
            createdAt: now,
            updatedAt: now,
          };
          const slot = buildAuthoritySlotIdentity({
            userId: assignment.userId,
            roleId: assignment.roleId,
            structuredScopeGrants: assignment.structuredScopeGrants,
            scopeFingerprint: assignment.scopeFingerprint,
          });
          await this.authoritySlots.reserve(
            {
              ...slot,
              lineageId: assignmentId,
              assignmentId,
              assignmentExpiresAt: assignment.expiresAt,
              transitionIdentity: `role.assign-to-user:${assignmentId}`,
              now,
            },
            session,
          );
          appliedAssignments.push(assignment);
          if (cycleId && proposed.reviewAt !== null) {
            reviewCycleDocuments.push({
              _id: cycleId,
              assignmentId,
              targetUserId: command.targetUserId,
              requestedBy: actor.id,
              requestedAt: now,
              riskSnapshot,
              reviewDeadline: proposed.reviewAt,
              state: "PENDING",
              approvals: [],
              decidedAt: null,
              nextReviewDeadline: null,
              reason: applyReason,
              createdAt: now,
            });
          }
          trackedRoleIds.add(proposed.roleId);
        }

        if (bundleAssignment) {
          const withChildren: BundleAssignmentDocument = {
            ...bundleAssignment,
            childRoleAssignmentIds: appliedAssignments.map((item) => item._id),
          };
          await this.bundleAssignments.insertOne(withChildren, { session });
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
        if (reviewCycleDocuments.length > 0) {
          await this.reviewCycles.insertMany(reviewCycleDocuments, {
            ordered: true,
            session,
          });
        }
        const sourceRoleAssignmentIds = appliedAssignments.map(
          (item) => item._id,
        );
        const generatedPrerequisites: GeneratedAccessPrerequisiteDocument[] = [
          ...accountContextResult.appliedAccountContexts.map((context) => ({
            _id: crypto.randomUUID(),
            targetUserId: command.targetUserId,
            sourceRoleAssignmentIds,
            kind: "ACCOUNT_CONTEXT" as const,
            value: context,
            status: "ACTIVE" as const,
            createdAt: now,
            revokedAt: null,
          })),
          ...responsibilityOperationResult.items
            .filter(
              (
                item,
              ): item is typeof item & { responsibilityAssignmentId: string } =>
                item.operation === "CREATE" &&
                item.responsibilityAssignmentId !== null,
            )
            .map((item) => ({
              _id: crypto.randomUUID(),
              targetUserId: command.targetUserId,
              sourceRoleAssignmentIds,
              kind: "RESPONSIBILITY" as const,
              value: item.responsibilityAssignmentId,
              status: "ACTIVE" as const,
              createdAt: now,
              revokedAt: null,
            })),
        ];
        if (generatedPrerequisites.length > 0) {
          await this.generatedPrerequisites.insertMany(generatedPrerequisites, {
            ordered: true,
            session,
          });
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
            scopeFingerprints: appliedAssignments.map(
              (item) => item.scopeFingerprint,
            ),
            reason: applyReason,
            bundleExpansion: preview.bundleExpansion ?? null,
            bundleAssignmentId: bundleAssignment?._id ?? null,
            responsibilityRequirements:
              preview.responsibilityRequirements ?? [],
            responsibilityOperationResult,
            accountContextRequirement:
              preview.accountContextRequirement ?? null,
            accountContextResult,
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
            lifecycle: assignment.lifecycle ?? null,
            assignedBy: assignment.assignedBy,
            assignedAt: assignment.assignedAt,
            origin: assignment.origin,
            bundleOrigin: assignment.bundleOrigin ?? null,
            reason: assignment.reason,
          })),
          bundleExpansion: rewriteAppliedBundleExpansion(
            preview.bundleExpansion,
            appliedAssignments,
            bundleAssignment,
          ),
          accountContextResult,
          consoleEntitlementResult: preview.consoleEntitlementPreview ?? null,
          responsibilityRequirements: preview.responsibilityRequirements ?? [],
          responsibilityOperationResult,
          sensitiveAccess: preview.sensitiveAccess ?? null,
          duplicateConflicts: [],
          auditTrace: {
            written: true,
            mutationType: "role.assign-to-user",
            assignmentIds: appliedAssignments.map((item) => item._id),
            bundleAssignmentId: bundleAssignment?._id ?? null,
            accountContextMaterialized: accountContextResult.materialized,
            responsibilityOperationIds: responsibilityOperationResult.items.map(
              (item) => item.responsibilityAssignmentId,
            ),
            targetUserId: command.targetUserId,
          },
          sourceTrace: {
            ...(isRecord(preview.sourceTrace) ? preview.sourceTrace : {}),
            mutatesSource: true,
            bundleAssignmentSource: bundleAssignment
              ? "bundle_assignments"
              : null,
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
      throw new RoleDependencyError(
        `Assignment actor is not ACTIVE: ${actor.id}`,
      );
    }
    const actorUser = await this.users.findOne(
      {
        _id: actor.id,
        accountStatus: "ACTIVE",
        disabledAt: null,
        archivedAt: null,
      },
      { session },
    );
    if (!actorUser) {
      throw new RoleDependencyError(
        `Assignment actor is not assignable: ${actor.id}`,
      );
    }
  }

  private async materializeAccountContext(params: {
    readonly preview: Record<string, unknown>;
    readonly actor: Actor;
    readonly targetUserId: string;
    readonly reason: string;
    readonly now: number;
    readonly session: ClientSession;
  }): Promise<{
    readonly materialized: boolean;
    readonly materializationPolicy: string;
    readonly requirement: unknown;
    readonly previousAccountContexts: readonly string[];
    readonly appliedAccountContexts: readonly string[];
    readonly resultingAccountContexts: readonly string[];
    readonly grantsAuthorityByItself: false;
    readonly reason: string;
  }> {
    const requirement = readAccountContextRequirement(params.preview);
    if (requirement.proposedAccountContexts.length === 0) {
      return {
        materialized: false,
        materializationPolicy:
          requirement.requiredAccountContexts.length === 0
            ? "NOT_REQUIRED"
            : "REUSED_EXISTING",
        requirement: params.preview.accountContextRequirement ?? null,
        previousAccountContexts: requirement.currentAccountContexts,
        appliedAccountContexts: [],
        resultingAccountContexts: requirement.currentAccountContexts,
        grantsAuthorityByItself: false,
        reason: params.reason,
      };
    }

    if (requirement.status !== "PROPOSED_FOR_APPLICATION") {
      throw new RoleDependencyError(
        "AccountContext materialization was not allowed by preview.",
      );
    }
    if (
      params.actor.context !== "ADMIN" ||
      !params.actor.accountContexts.includes("ADMIN_CONSOLE") ||
      !params.actor.permissions.includes(Permission.ROLE_ASSIGN_TO_USER)
    ) {
      throw new RoleDependencyError(
        "Actor is not authorized to materialize required AccountContext.",
      );
    }

    const targetUser = await this.users.findOne(
      {
        _id: params.targetUserId,
        accountStatus: "ACTIVE",
        disabledAt: null,
        archivedAt: null,
      },
      { session: params.session },
    );
    if (!targetUser) {
      throw new RoleDependencyError(
        `Target user is no longer assignable: ${params.targetUserId}`,
      );
    }
    const current = normalizeAccountContextArray(targetUser.accountContexts);
    const resulting = normalizeAccountContextArray([
      ...current,
      ...requirement.proposedAccountContexts,
    ]);

    await this.users.updateOne(
      { _id: params.targetUserId },
      { $set: { accountContexts: resulting, updatedAt: params.now } },
      { session: params.session },
    );

    return {
      materialized: true,
      materializationPolicy: "APPLIED_FROM_ACCESS_ASSIGNMENT_PREVIEW",
      requirement: params.preview.accountContextRequirement ?? null,
      previousAccountContexts: current,
      appliedAccountContexts: requirement.proposedAccountContexts,
      resultingAccountContexts: resulting,
      grantsAuthorityByItself: false,
      reason: params.reason,
    };
  }

  private async materializeResponsibilities(params: {
    readonly preview: Record<string, unknown>;
    readonly actor: Actor;
    readonly reason: string;
    readonly now: number;
    readonly session: ClientSession;
  }): Promise<{
    readonly materialized: boolean;
    readonly items: readonly {
      readonly operation: string;
      readonly responsibilityAssignmentId: string | null;
      readonly subjectType: string | null;
      readonly subjectId: string | null;
      readonly responsibilityType: string | null;
      readonly source: string;
    }[];
  }> {
    const requirements = readRecords(params.preview.responsibilityRequirements);
    const items: Array<{
      readonly operation: string;
      readonly responsibilityAssignmentId: string | null;
      readonly subjectType: string | null;
      readonly subjectId: string | null;
      readonly responsibilityType: string | null;
      readonly source: string;
    }> = [];

    for (const requirement of requirements) {
      if (requirement.status === "SATISFIED") {
        items.push({
          operation: "REUSE_EXISTING",
          responsibilityAssignmentId:
            typeof requirement.responsibilityAssignmentId === "string"
              ? requirement.responsibilityAssignmentId
              : null,
          subjectType:
            typeof requirement.requiredSubjectType === "string"
              ? requirement.requiredSubjectType
              : null,
          subjectId:
            typeof requirement.targetId === "string"
              ? requirement.targetId
              : null,
          responsibilityType:
            typeof requirement.requiredResponsibilityType === "string"
              ? requirement.requiredResponsibilityType
              : null,
          source: "responsibility_assignments",
        });
        continue;
      }
      if (requirement.status !== "CREATE_PROPOSED") {
        continue;
      }
      const proposed = isRecord(requirement.proposedResponsibility)
        ? requirement.proposedResponsibility
        : null;
      if (!proposed) {
        throw new RoleDependencyError(
          "Responsibility materialization was proposed without a responsibility payload.",
        );
      }
      const subjectType = readRequiredString(
        proposed.subjectType,
        "proposedResponsibility.subjectType",
      );
      const subjectId = readRequiredString(
        proposed.subjectId,
        "proposedResponsibility.subjectId",
      );
      const responsibleEmploymentProfileId = readRequiredString(
        proposed.responsibleEmploymentProfileId,
        "proposedResponsibility.responsibleEmploymentProfileId",
      );
      const responsibilityType = readRequiredString(
        proposed.responsibilityType,
        "proposedResponsibility.responsibilityType",
      );
      assertActorCanMaterializeResponsibility(params.actor, responsibilityType);
      await this.assertNoActivePrimaryResponsibility({
        subjectType,
        subjectId,
        responsibilityType,
        now: params.now,
        session: params.session,
      });

      const assignment: ResponsibilityAssignmentDocument = {
        _id: crypto.randomUUID(),
        subjectType,
        subjectId,
        responsibleEmploymentProfileId,
        responsibilityType,
        responsibilityRole:
          typeof proposed.responsibilityRole === "string"
            ? proposed.responsibilityRole
            : null,
        includeDescendants: false,
        actionMask: [],
        isPrimary: true,
        status: "ACTIVE",
        effectiveAt: params.now,
        expiresAt: null,
        revokedAt: null,
        reason: params.reason,
        createdBy: params.actor.id,
        createdAt: params.now,
        updatedBy: params.actor.id,
        updatedAt: params.now,
        revokedBy: null,
        revokedReason: null,
      };
      await this.responsibilities.insertOne(assignment, {
        session: params.session,
      });
      items.push({
        operation: "CREATE",
        responsibilityAssignmentId: assignment._id,
        subjectType,
        subjectId,
        responsibilityType,
        source: "responsibility_assignments",
      });
    }

    return {
      materialized: items.some((item) => item.operation === "CREATE"),
      items,
    };
  }

  private async assertNoActivePrimaryResponsibility(params: {
    readonly subjectType: string;
    readonly subjectId: string;
    readonly responsibilityType: string;
    readonly now: number;
    readonly session: ClientSession;
  }): Promise<void> {
    const existing = await this.responsibilities.findOne(
      {
        subjectType: params.subjectType,
        subjectId: params.subjectId,
        responsibilityType: params.responsibilityType,
        isPrimary: true,
        status: "ACTIVE",
        effectiveAt: { $lte: params.now },
        $or: [{ expiresAt: null }, { expiresAt: { $gte: params.now } }],
      },
      { session: params.session },
    );
    if (existing) {
      throw new RoleAssignmentConflictError(
        `Active primary responsibility already exists for ${params.subjectType}:${params.subjectId}:${params.responsibilityType}`,
      );
    }
  }

  private async requireActiveRole(
    roleId: string,
    session: ClientSession,
  ): Promise<RoleDocument> {
    const role = await this.roles.findOne({ _id: roleId }, { session });
    if (!role || role.state !== "ACTIVE") {
      throw new RoleDependencyError(
        `Role must be ACTIVE to apply assignment: ${roleId}`,
      );
    }
    return role;
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

export function assertRoleDelegationAllowed(role: {
  readonly _id: string;
  readonly delegationBand?: RoleDelegationBand;
}): void {
  if ((role.delegationBand ?? "LIMITED") === "FOUNDATION") {
    throw new RoleDependencyError(
      `Role ${role._id} in delegation band FOUNDATION cannot be assigned on apply path`,
    );
  }
}

export async function assertActorCanDelegateRoleBand(
  actorId: string,
  targetBand: RoleDelegationBand,
  roleId: string,
  assignments: DelegationCollection<AssignmentDocument>,
  roles: DelegationCollection<RoleDocument>,
  session?: ClientSession,
  now: number = Date.now(),
): Promise<void> {
  const actorAssignments = await assignments
    .find(
      { userId: actorId, state: { $in: ["ACTIVE", "SCHEDULED"] } },
      session ? { session } : {},
    )
    .toArray();
  const actorRoleIds = [
    ...new Set(actorAssignments.map((item) => item.roleId)),
  ];
  const actorRoles = actorRoleIds.length
    ? await roles
        .find(
          { _id: { $in: actorRoleIds }, state: "ACTIVE" },
          session ? { session } : {},
        )
        .toArray()
    : [];
  const actorRoleById = new Map(actorRoles.map((role) => [role._id, role]));
  const activeActorAssignments = actorAssignments.filter((assignment) => {
    const role = actorRoleById.get(assignment.roleId);
    if (!role) return false;
    const scopeFingerprint =
      assignment.scopeFingerprint ??
      buildRoleAssignmentScopeFingerprint(assignment.structuredScopeGrants);
    const currentPolicy = buildCurrentRoleAssignmentPolicy({
      roleCode: role.code,
      roleTemplateCode: role.templateCode ?? role.code,
      permissions: role.permissions,
      structuredScopeGrants: assignment.structuredScopeGrants,
      effectiveAt: assignment.effectiveAt,
      durableReviewDeadline:
        assignment.lifecycle?.reviewDeadline ?? assignment.reviewAt,
      durableRiskTier: assignment.lifecycle?.riskTier ?? null,
      storedPermissionFingerprint:
        assignment.lifecycle?.permissionFingerprint ?? null,
      assessedAt: now,
      scopeFingerprint,
    });
    return isRoleAssignmentCurrentlyEffective(assignment, now, currentPolicy);
  });
  const activeActorRoleIds = new Set(
    activeActorAssignments.map((assignment) => assignment.roleId),
  );

  if (
    actorRoles.some(
      (role) =>
        activeActorRoleIds.has(role._id) &&
        isDelegationCeilingSufficient(
          role.maxDelegatableBand ?? "NONE",
          targetBand,
        ),
    )
  ) {
    return;
  }

  throw new RoleDependencyError(
    `Delegation denied: actor ${actorId} lacks active role delegation ceiling for role ${roleId} band ${targetBand}`,
  );
}

interface DelegationCollection<T> {
  find(
    filter: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): {
    toArray(): Promise<T[]>;
  };
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
      materializationPolicy: "NOT_APPLIED_BLOCKED",
      requirement: preview.accountContextRequirement ?? null,
      previousAccountContexts:
        readAccountContextRequirement(preview).currentAccountContexts,
      appliedAccountContexts: [],
      resultingAccountContexts:
        readAccountContextRequirement(preview).currentAccountContexts,
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
      throw new RoleValidationError(
        `proposedAssignments[${index}] must be an object`,
      );
    }
    return {
      roleId: readRequiredString(
        item.roleId,
        `proposedAssignments[${index}].roleId`,
      ),
      roleCode: readRequiredString(
        item.roleCode,
        `proposedAssignments[${index}].roleCode`,
      ),
      roleName: readRequiredString(
        item.roleName,
        `proposedAssignments[${index}].roleName`,
      ),
      permissions: readStringArray(item.permissions),
      structuredScopeGrants: readScopeGrants(item.structuredScopeGrants),
      scopeFingerprint: readRequiredString(
        item.scopeFingerprint,
        `proposedAssignments[${index}].scopeFingerprint`,
      ),
      effectiveAt: readRequiredNumber(
        item.effectiveAt,
        `proposedAssignments[${index}].effectiveAt`,
      ),
      expiresAt: readNullableNumber(
        item.expiresAt,
        `proposedAssignments[${index}].expiresAt`,
      ),
      reviewAt: readNullableNumber(
        item.reviewAt,
        `proposedAssignments[${index}].reviewAt`,
      ),
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

function buildBundleAssignmentDocument(params: {
  readonly preview: Record<string, unknown>;
  readonly proposedAssignments: readonly ProposedAssignmentForApply[];
  readonly actorId: string;
  readonly targetUserId: string;
  readonly reason: string;
  readonly now: number;
}): BundleAssignmentDocument | null {
  const expansion = params.preview.bundleExpansion;
  const target = params.preview.assignmentTarget;
  if (!isRecord(expansion) || !isRecord(target)) {
    return null;
  }
  const bundleCode = readRequiredString(target.code, "assignmentTarget.code");
  const bundleVersion = readRequiredString(
    target.version,
    "assignmentTarget.version",
  );
  return {
    _id: crypto.randomUUID(),
    targetUserId: params.targetUserId,
    bundleCode,
    bundleVersion,
    assignedBy: params.actorId,
    assignedAt: params.now,
    reason: params.reason,
    status: "ACTIVE",
    effectiveAt: readNullableNumber(
      params.proposedAssignments[0]?.effectiveAt,
      "bundleAssignment.effectiveAt",
    ),
    expiresAt: readNullableNumber(
      params.proposedAssignments[0]?.expiresAt,
      "bundleAssignment.expiresAt",
    ),
    reviewAt: readNullableNumber(
      params.proposedAssignments[0]?.reviewAt,
      "bundleAssignment.reviewAt",
    ),
    childRoleAssignmentIds: [],
    sourceTrace: {
      source: "access-assignment.apply",
      bundleCatalogSource: "role-bundle.catalog",
      previewBundleAssignmentId:
        typeof expansion.bundleAssignmentId === "string"
          ? expansion.bundleAssignmentId
          : null,
    },
    createdAt: params.now,
    updatedAt: params.now,
  };
}

function rewriteAppliedBundleExpansion(
  value: unknown,
  assignments: readonly AssignmentDocument[],
  bundleAssignment: BundleAssignmentDocument | null,
): unknown {
  if (!isRecord(value)) {
    return null;
  }
  return {
    ...value,
    persistedParentBundleAssignment: bundleAssignment !== null,
    parentBundleAssignment: bundleAssignment
      ? {
          bundleAssignmentId: bundleAssignment._id,
          bundleCode: bundleAssignment.bundleCode,
          bundleVersion: bundleAssignment.bundleVersion,
          targetUserId: bundleAssignment.targetUserId,
          assignedBy: bundleAssignment.assignedBy,
          assignedAt: bundleAssignment.assignedAt,
          status: bundleAssignment.status,
          reason: bundleAssignment.reason,
        }
      : null,
    appliedChildCount: assignments.length,
    childAssignmentIds: assignments.map((item) => item._id),
  };
}

function readAccountContextRequirement(preview: Record<string, unknown>): {
  readonly status: string | null;
  readonly requiredAccountContexts: readonly string[];
  readonly currentAccountContexts: readonly string[];
  readonly proposedAccountContexts: readonly string[];
} {
  const requirement = isRecord(preview.accountContextRequirement)
    ? preview.accountContextRequirement
    : {};
  return {
    status: typeof requirement.status === "string" ? requirement.status : null,
    requiredAccountContexts: readStringArray(
      requirement.requiredAccountContexts,
    ),
    currentAccountContexts: readStringArray(requirement.currentAccountContexts),
    proposedAccountContexts: readStringArray(
      requirement.proposedAccountContexts,
    ),
  };
}

function normalizeAccountContextArray(values: unknown): readonly string[] {
  const order = ["STAFF_CONSOLE", "MANAGER_CONSOLE", "ADMIN_CONSOLE"];
  const set = new Set(readStringArray(values));
  return order.filter((item) => set.has(item));
}

function assertActorCanMaterializeResponsibility(
  actor: Actor,
  responsibilityType: string,
): void {
  if (
    actor.context !== "ADMIN" ||
    !actor.accountContexts.includes("ADMIN_CONSOLE")
  ) {
    throw new RoleDependencyError(
      "Responsibility materialization requires ADMIN_CONSOLE actor context.",
    );
  }
  const requiredPermission =
    responsibilityType === "TALENT_GROUP_MANAGER"
      ? Permission.TALENT_GROUP_UPDATE
      : responsibilityType === "ORG_UNIT_MANAGER"
        ? Permission.ORG_UNIT_UPDATE
        : null;
  if (!requiredPermission || !actor.permissions.includes(requiredPermission)) {
    throw new RoleDependencyError(
      `Actor is not authorized to materialize responsibility ${responsibilityType}.`,
    );
  }
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
