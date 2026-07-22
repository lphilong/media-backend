import crypto from "node:crypto";
import { ClientSession, Collection, Db } from "mongodb";
import { Actor } from "@core/actor/actor";
import { AuditGuard } from "@core/audit/audit.guard";
import { AuthoritativeAdminMutationBridge } from "@core/application/authoritative-admin-mutation.bridge";
import { Permission } from "@core/permission/permission.enum";
import { PermissionResolver } from "@core/permission/permission.resolver";
import { getTraceIdOrThrow } from "@core/trace/trace.context";
import { ActorSnapshotCacheInvalidator } from "@infra/cache/actor.snapshot.cache";
import {
  AccessLifecycleApproval,
  AssignmentReviewCycleRecord,
  GraceExceptionRecord,
  evaluateLifecycleApprovals,
  validateGraceException,
} from "@modules/role/domain/access-lifecycle-policy";
import {
  ROLE_ASSIGNMENT_SCOPE_TYPES,
  RoleAssignmentScopeGrant,
  buildRoleAssignmentScopeFingerprint,
  normalizeRoleAssignmentScopeGrants,
} from "@modules/role/domain/role-assignment-scope";
import { UserRoleAssignmentRecord } from "@modules/role/domain/role.types";
import {
  StructuredScopeAuthorityService,
  StructuredScopeAuthoritySnapshot,
} from "@modules/role/domain/structured-scope-authority";
import { NativeMongoStructuredScopeAuthorityReader } from "@infra/mongo/role/structured-scope-authority.repository";
import { RoleValidationError } from "@modules/role/domain/role.errors";
import { AccessAuthorityReconciliationService } from "./access-authority-reconciliation.service";
import {
  buildCurrentRoleAssignmentPolicy,
  buildAccessRiskSnapshot,
  classifySensitiveAccess,
  resolveCanonicalAccessReviewWindowMs,
} from "@modules/role/domain/sensitive-access-policy";
import {
  parseAccessDecision,
  parseAccessSuccessorAction,
} from "@modules/role/domain/access-governance-command";
import { AccessLifecycleRepository } from "@modules/role/domain/access-lifecycle.repositories";
import { NativeMongoAccessLifecycleRepository } from "@infra/mongo/role/access-lifecycle.repository";
import {
  ACCESS_LIFECYCLE_COMMAND_POLICY_VERSION,
  ACCESS_REVIEW_DEFAULT_GRACE_MS,
  ACCESS_REVIEW_MAXIMUM_GRACE_MS,
  evaluateRoleAssignmentEffectiveness,
} from "@modules/role/domain/role-assignment-lifecycle";
import {
  evaluateRoleAssignmentRestorationEligibility,
  resolveRoleAssignmentOperationalState,
} from "@modules/role/domain/role-assignment-operational-state";
import { buildAuthoritySlotIdentity } from "@modules/role/domain/authority-slot";
import { NativeMongoAuthoritySlotRepository } from "@infra/mongo/role/authority-slot.repository";
import {
  assertActorCanDelegateRoleBand,
  assertRoleDelegationAllowed,
} from "./admin.access-assignment-apply.service";
import { AccessAssignmentPreviewAdminService } from "./admin.access-assignment-preview.service";
import {
  CandidatePage,
  loadBoundedCandidates,
  normalizeQueueLimit,
  projectVisiblePage,
} from "./access-governance-queue-pagination";
import {
  AccessGovernanceQueueCursorCodec,
  AccessGovernanceSourcePosition,
} from "./access-governance-queue-cursor";

type ReviewCycleDocument = Omit<AssignmentReviewCycleRecord, "cycleId"> & {
  readonly _id: string;
};
type GraceExceptionDocument = Omit<GraceExceptionRecord, "exceptionId"> & {
  readonly _id: string;
};

interface AssignmentDocument extends Omit<
  UserRoleAssignmentRecord,
  "assignmentId"
> {
  readonly _id: string;
}
interface RoleDocument {
  readonly _id: string;
  readonly code: string;
  readonly templateCode?: string | null;
  readonly state: string;
  readonly permissions: readonly string[];
  readonly delegationBand?: "LIMITED" | "PRIVILEGED" | "FOUNDATION";
  readonly maxDelegatableBand?: "NONE" | "LIMITED" | "PRIVILEGED";
}

interface CurrentLifecycleActionContext {
  readonly role: RoleDocument | null;
  readonly currentPolicy: ReturnType<
    typeof buildCurrentRoleAssignmentPolicy
  > | null;
  readonly operational: ReturnType<
    typeof resolveRoleAssignmentOperationalState
  >;
  readonly currentRiskTier: "HIGH" | "LOW";
  readonly reviewDeadline: number;
  readonly reviewWindowMs: number;
  readonly requiredApprovals: 1 | 2;
  readonly completedApprovals: number;
  readonly cycleMatches: boolean;
  readonly reviewEligible: boolean;
  readonly graceEligible: boolean;
}

interface SuccessorRequestDocument {
  readonly _id: string;
  readonly action: "RENEWAL" | "REPLACEMENT" | "RESTORATION";
  readonly predecessorAssignmentId: string;
  readonly targetUserId: string;
  readonly requestedBy: string;
  readonly requestedAt: number;
  readonly reason: string;
  readonly idempotencyKey: string;
  readonly payloadFingerprint: string;
  readonly state: "PENDING" | "APPLIED" | "REJECTED";
  readonly approvals: readonly AccessLifecycleApproval[];
  readonly successor: {
    readonly roleId: string;
    readonly structuredScopeGrants: readonly RoleAssignmentScopeGrant[];
    readonly scopeFingerprint: string;
    readonly effectiveAt: number;
    readonly expiresAt: number | null;
    readonly reviewAt: number;
    readonly riskTier: "HIGH" | "LOW";
    readonly riskReasons: readonly string[];
    readonly riskAssessedAt: number;
    readonly permissionFingerprint: string;
    readonly sourceRoleId: string;
    readonly sourceRoleCode: string;
    readonly sourceRoleTemplateCode: string;
    readonly riskPolicyVersion: "access-risk-policy/v1";
  };
  readonly successorAssignmentId: string | null;
  readonly appliedAt: number | null;
}

type SuccessorAction = SuccessorRequestDocument["action"];

interface SuccessorRequestIntent {
  readonly action: SuccessorRequestDocument["action"];
  readonly predecessorAssignmentId: string;
  readonly roleId: string;
  readonly structuredScopeGrants: readonly RoleAssignmentScopeGrant[];
  readonly scopeFingerprint: string;
  readonly expectedRoleCode: string;
  readonly expectedRoleTemplateCode: string;
  readonly expectedPermissionFingerprint: string;
  readonly expectedRiskTier: "HIGH" | "LOW";
  readonly explicitEffectiveAt: number | null;
  readonly expiresAt: number;
  readonly explicitReviewAt: number | null;
  readonly reason: string;
  readonly idempotencyKey: string;
  readonly payloadFingerprint: string;
}

export class AccessLifecycleP2AdminService {
  private readonly assignments: Collection<AssignmentDocument>;
  private readonly reviewCycles: Collection<ReviewCycleDocument>;
  private readonly roles: Collection<RoleDocument>;
  private readonly graceExceptions: Collection<GraceExceptionDocument>;
  private readonly successorRequests: Collection<SuccessorRequestDocument>;
  private readonly lifecycleRepository: AccessLifecycleRepository;
  private readonly structuredAuthority: StructuredScopeAuthorityService;
  private readonly reconciliation: AccessAuthorityReconciliationService;
  private readonly assignmentPreview: AccessAssignmentPreviewAdminService;
  private readonly authoritySlots: NativeMongoAuthoritySlotRepository;

  constructor(
    private readonly db: Db,
    private readonly audit: AuditGuard,
    private readonly mutationBridge: AuthoritativeAdminMutationBridge,
    private readonly actorCache: ActorSnapshotCacheInvalidator,
    structuredAuthority?: StructuredScopeAuthorityService,
    lifecycleRepository?: AccessLifecycleRepository,
    private readonly nowProvider: () => number = Date.now,
    private readonly queueCursorCodec?: AccessGovernanceQueueCursorCodec,
  ) {
    this.assignments = db.collection("role_assignments");
    this.reviewCycles = db.collection("assignment_review_cycles");
    this.roles = db.collection("roles");
    this.graceExceptions = db.collection("assignment_grace_exceptions");
    this.successorRequests = db.collection("assignment_successor_requests");
    this.lifecycleRepository =
      lifecycleRepository ?? new NativeMongoAccessLifecycleRepository(db);
    this.reconciliation = new AccessAuthorityReconciliationService(db);
    this.assignmentPreview = new AccessAssignmentPreviewAdminService(db);
    this.authoritySlots = new NativeMongoAuthoritySlotRepository(db);
    this.structuredAuthority =
      structuredAuthority ??
      new StructuredScopeAuthorityService(
        new NativeMongoStructuredScopeAuthorityReader(db),
      );
  }

  async listForActor(
    actor: Actor,
    targetUserId?: string | null,
    page: {
      readonly limit?: number;
      readonly reviewCursor?: string | null;
      readonly graceCursor?: string | null;
      readonly successorCursor?: string | null;
      readonly queue?: "review" | "grace" | "successor";
      readonly cursor?: string | null;
    } = {},
  ): Promise<Record<string, unknown>> {
    const generatedAt = this.nowProvider();
    const pageSize = normalizeQueueLimit(page.limit);
    const selectedQueue = page.queue;
    const authoritySnapshot = await requireStructuredAuthoritySnapshot(
      this.structuredAuthority,
      actor.id,
      generatedAt,
    );
    const positionForQueue = (
      queue: "review" | "grace" | "successor",
      legacyCursor?: string | null,
    ): AccessGovernanceSourcePosition | null => {
      const token = selectedQueue === queue ? page.cursor : legacyCursor;
      if (!token) return null;
      return this.requireQueueCursorCodec().open(
        token,
        lifecycleCursorBinding(actor.id, queue, targetUserId, pageSize),
        generatedAt,
      );
    };
    const [reviewSource, graceSource, successorSource, assignments] =
      await Promise.all([
        !selectedQueue || selectedQueue === "review"
          ? loadBoundedCandidates(
              this.reviewCycles,
              { state: "PENDING" },
              "reviewDeadline",
              1,
              positionForQueue("review", page.reviewCursor),
            )
          : emptyCandidatePage<ReviewCycleDocument>(),
        !selectedQueue || selectedQueue === "grace"
          ? loadBoundedCandidates(
              this.graceExceptions,
              { state: "PENDING" },
              "requestedAt",
              1,
              positionForQueue("grace", page.graceCursor),
            )
          : emptyCandidatePage<GraceExceptionDocument>(),
        !selectedQueue || selectedQueue === "successor"
          ? loadBoundedCandidates(
              this.successorRequests,
              { state: "PENDING" },
              "requestedAt",
              1,
              positionForQueue("successor", page.successorCursor),
            )
          : emptyCandidatePage<SuccessorRequestDocument>(),
        targetUserId && !selectedQueue
          ? this.assignments
              .find({
                userId: targetUserId,
                state: { $in: ["ACTIVE", "SCHEDULED", "SUSPENDED"] },
              })
              .sort({ createdAt: 1, _id: 1 })
              .limit(100)
              .toArray()
          : Promise.resolve([] as AssignmentDocument[]),
      ]);
    const reviewCycles = reviewSource.items;
    const graceExceptions = graceSource.items;
    const successorRequests = successorSource.items;

    const hasExactScope = (
      permission: Permission,
      assignment: AssignmentDocument,
    ): boolean =>
      hasExactSnapshotScope(authoritySnapshot, permission, assignment);
    const canView = (
      assignment: AssignmentDocument,
      partyUserIds: readonly (string | null | undefined)[],
      actionPermissions: readonly Permission[],
    ): boolean => {
      if (partyUserIds.some((userId) => userId === actor.id)) return true;
      const candidates = [
        ...actionPermissions,
        Permission.OWNER_GOVERNANCE_VIEW,
      ].filter(
        (permission, index, values) => values.indexOf(permission) === index,
      );
      return candidates.some(
        (permission) =>
          actor.permissions.includes(permission) &&
          hasExactScope(permission, assignment),
      );
    };

    const reviewViews = await Promise.all(
      reviewCycles.map(async (cycle) => {
        const assignment = await this.assignments.findOne({
          _id: cycle.assignmentId,
        });
        if (
          !assignment ||
          !canView(
            assignment,
            [cycle.requestedBy, cycle.targetUserId],
            [Permission.ROLE_ASSIGNMENT_REVIEW],
          )
        ) {
          return null;
        }
        const blockers = assignment
          ? reviewListBlockers(
              actor,
              cycle,
              assignment,
              await this.resolveCurrentLifecycleActionContext(
                assignment,
                cycle,
                generatedAt,
              ),
              hasExactScope,
            )
          : ["ASSIGNMENT_NOT_FOUND"];
        const actionContext = await this.resolveCurrentLifecycleActionContext(
          assignment,
          cycle,
          generatedAt,
        );
        const permissionAllowed = actor.permissions.includes(
          Permission.ROLE_ASSIGNMENT_REVIEW,
        );
        const requiredApprovals = actionContext.requiredApprovals;
        const completedApprovals = actionContext.completedApprovals;
        const canDecide = permissionAllowed && blockers.length === 0;
        const graceBlockers = graceRequestListBlockers(
          actor,
          cycle,
          assignment,
          actionContext,
          hasExactScope,
        );
        const canRequestGrace = graceBlockers.length === 0;
        return {
          cycleId: cycle._id,
          assignmentId: cycle.assignmentId,
          targetUserId: cycle.targetUserId,
          riskTier: actionContext.currentRiskTier,
          automaticGraceEndsAt:
            actionContext.currentRiskTier === "LOW"
              ? actionContext.reviewDeadline + ACCESS_REVIEW_DEFAULT_GRACE_MS
              : null,
          maximumGraceEndsAt:
            actionContext.currentRiskTier === "LOW"
              ? actionContext.reviewDeadline + ACCESS_REVIEW_MAXIMUM_GRACE_MS
              : null,
          reviewDeadline: actionContext.reviewDeadline,
          state: cycle.state,
          requiredApprovals,
          completedApprovals,
          remainingApprovals: Math.max(
            0,
            requiredApprovals - completedApprovals,
          ),
          canApprove: canDecide,
          canReject: canDecide,
          canRequestGrace,
          ineligibilityReason: canDecide
            ? null
            : !permissionAllowed
              ? "ROLE_ASSIGNMENT_REVIEW_PERMISSION_REQUIRED"
              : (blockers[0] ?? "REVIEW_NOT_AVAILABLE"),
          nextAllowedAction: canDecide
            ? "INDEPENDENT_REVIEW"
            : canRequestGrace
              ? "REQUEST_GRACE_EXCEPTION"
              : null,
        };
      }),
    );

    const graceViews = await Promise.all(
      graceExceptions.map(async (exception) => {
        const preflight = await this.readReviewPreflight(exception.cycleId);
        if (
          !preflight ||
          !canView(
            preflight.assignment,
            [exception.requestedBy, exception.targetUserId],
            [Permission.ROLE_ASSIGNMENT_GRACE_APPROVE],
          )
        ) {
          return null;
        }
        const blockers = graceDecisionListBlockers(
          actor,
          exception,
          preflight.cycle,
          preflight.assignment,
          await this.resolveCurrentLifecycleActionContext(
            preflight.assignment,
            preflight.cycle,
            generatedAt,
          ),
          hasExactScope,
        );
        const canDecide = blockers.length === 0;
        return {
          exceptionId: exception._id,
          cycleId: exception.cycleId,
          targetUserId: exception.targetUserId,
          requestedAt: exception.requestedAt,
          requestedExpiresAt: exception.requestedExpiresAt,
          state: exception.state,
          canApprove: canDecide,
          canReject: canDecide,
          ineligibilityReason: canDecide
            ? null
            : (blockers[0] ?? "GRACE_DECISION_NOT_AVAILABLE"),
          nextAllowedAction: canDecide ? "INDEPENDENT_GRACE_DECISION" : null,
        };
      }),
    );

    const successorViews = await Promise.all(
      successorRequests.map(async (request) => {
        const predecessor = await this.assignments.findOne({
          _id: request.predecessorAssignmentId,
        });
        if (
          !predecessor ||
          !canView(
            predecessor,
            [request.requestedBy, request.targetUserId],
            [permissionForSuccessorAction(request.action)],
          )
        ) {
          return null;
        }
        const permission = permissionForSuccessorAction(request.action);
        const permissionAllowed = actor.permissions.includes(permission);
        const independent =
          actor.id !== request.targetUserId &&
          actor.id !== request.requestedBy &&
          !request.approvals.some(
            (approval) => approval.approverUserId === actor.id,
          );
        const exactScope = predecessor
          ? hasExactScope(permission, predecessor)
          : false;
        const canDecide = permissionAllowed && independent && exactScope;
        const requiredApprovals = request.successor.riskTier === "HIGH" ? 2 : 1;
        const completedApprovals = request.approvals.filter(
          (approval) => approval.decision === "APPROVED",
        ).length;
        return {
          requestId: request._id,
          action: request.action,
          predecessorAssignmentId: request.predecessorAssignmentId,
          targetUserId: request.targetUserId,
          requestedAt: request.requestedAt,
          state: request.state,
          riskTier: request.successor.riskTier,
          effectiveAt: request.successor.effectiveAt,
          expiresAt: request.successor.expiresAt,
          reviewAt: request.successor.reviewAt,
          requiredApprovals,
          completedApprovals,
          remainingApprovals: Math.max(
            0,
            requiredApprovals - completedApprovals,
          ),
          canApprove: canDecide,
          canReject: canDecide,
          ineligibilityReason: canDecide
            ? null
            : !permissionAllowed
              ? "SUCCESSOR_PERMISSION_REQUIRED"
              : !independent
                ? "INDEPENDENT_APPROVER_REQUIRED"
                : !predecessor
                  ? "ASSIGNMENT_NOT_FOUND"
                  : "EXACT_LIFECYCLE_SCOPE_REQUIRED",
          nextAllowedAction: canDecide
            ? "INDEPENDENT_SUCCESSOR_DECISION"
            : null,
        };
      }),
    );

    const assignmentViews = await Promise.all(
      assignments.map(async (assignment) => {
        if (
          !canView(
            assignment,
            [assignment.userId, assignment.assignedBy],
            [
              Permission.ROLE_ASSIGNMENT_RENEW,
              Permission.ROLE_ASSIGNMENT_REPLACE,
            ],
          )
        ) {
          return null;
        }
        const role = await this.roles.findOne({ _id: assignment.roleId });
        const classification = role
          ? classifySensitiveAccess([
              {
                roleCode: role.code,
                roleTemplateCode: role.templateCode ?? role.code,
                permissions: role.permissions,
                structuredScopeGrants: assignment.structuredScopeGrants ?? [],
              },
            ])
          : null;
        const reviewWindowMs = classification
          ? resolveCanonicalAccessReviewWindowMs(classification)
          : null;
        const currentPolicy = role
          ? buildCurrentRoleAssignmentPolicy({
              roleCode: role.code,
              roleTemplateCode: role.templateCode ?? role.code,
              permissions: role.permissions,
              structuredScopeGrants: assignment.structuredScopeGrants ?? [],
              effectiveAt: assignment.effectiveAt,
              durableReviewDeadline:
                assignment.lifecycle?.reviewDeadline ?? assignment.reviewAt,
              durableRiskTier: assignment.lifecycle?.riskTier ?? null,
              storedPermissionFingerprint:
                assignment.lifecycle?.permissionFingerprint ?? null,
              assessedAt: generatedAt,
              scopeFingerprint: currentAssignmentScopeFingerprint(assignment),
            })
          : undefined;
        const renewScope = hasExactScope(
          Permission.ROLE_ASSIGNMENT_RENEW,
          assignment,
        );
        const replaceScope = hasExactScope(
          Permission.ROLE_ASSIGNMENT_REPLACE,
          assignment,
        );
        const operational = resolveRoleAssignmentOperationalState(
          assignment,
          generatedAt,
          currentPolicy,
        );
        const canRenew =
          operational.state === "OPERATIONALLY_ACTIVE" &&
          typeof assignment.expiresAt === "number" &&
          Number.isFinite(assignment.expiresAt) &&
          !assignment.lifecycle?.successorAssignmentId &&
          actor.permissions.includes(Permission.ROLE_ASSIGNMENT_RENEW) &&
          renewScope;
        const canReplace =
          operational.state === "OPERATIONALLY_ACTIVE" &&
          !assignment.lifecycle?.successorAssignmentId &&
          actor.permissions.includes(Permission.ROLE_ASSIGNMENT_REPLACE) &&
          replaceScope;
        const restorationEligibility =
          evaluateRoleAssignmentRestorationEligibility({
            assignment,
            currentRoleState: role?.state,
            now: generatedAt,
            currentPolicy,
          });
        const canRestore =
          restorationEligibility.eligible &&
          actor.permissions.includes(Permission.ROLE_ASSIGNMENT_RENEW) &&
          renewScope;
        return {
          assignmentId: assignment._id,
          targetUserId: assignment.userId,
          roleId: assignment.roleId,
          roleCode: role?.code ?? null,
          structuredScopeGrants: assignment.structuredScopeGrants ?? [],
          scopeFingerprint: currentAssignmentScopeFingerprint(assignment),
          state: assignment.state,
          operationalState: operational.state,
          effectiveAt: assignment.effectiveAt,
          expiresAt: assignment.expiresAt ?? null,
          reviewAt: assignment.reviewAt ?? null,
          riskTier: classification?.isHighRisk ? "HIGH" : "LOW",
          currentPermissionFingerprint:
            currentPolicy?.permissionFingerprint ?? null,
          permissionFingerprintDrifted: Boolean(
            currentPolicy &&
            assignment.lifecycle?.permissionFingerprint &&
            assignment.lifecycle.permissionFingerprint !==
              currentPolicy.permissionFingerprint,
          ),
          riskPolicyVersion: "access-risk-policy/v1",
          reviewWindowMs,
          actionTiming: {
            renewalEffectiveAt:
              assignment.expiresAt !== null &&
              assignment.expiresAt !== undefined &&
              assignment.expiresAt > generatedAt
                ? assignment.expiresAt
                : generatedAt,
            replacementEffectiveAt: generatedAt,
            restorationEffectiveAt: generatedAt,
          },
          canRenew,
          canReplace,
          canRestore,
          ineligibilityReasons: {
            renewal: canRenew ? null : "RENEWAL_NOT_ELIGIBLE",
            replacement: canReplace ? null : "REPLACEMENT_NOT_ELIGIBLE",
            restoration: canRestore
              ? null
              : (restorationEligibility.reason ?? "RESTORATION_NOT_ELIGIBLE"),
          },
        };
      }),
    );

    const reviewPage = projectVisiblePage(
      reviewCycles,
      reviewViews,
      pageSize,
      "reviewDeadline",
      reviewSource,
    );
    const gracePage = projectVisiblePage(
      graceExceptions,
      graceViews,
      pageSize,
      "requestedAt",
      graceSource,
    );
    const successorPage = projectVisiblePage(
      successorRequests,
      successorViews,
      pageSize,
      "requestedAt",
      successorSource,
    );

    const publicMeta = (
      queue: "review" | "grace" | "successor",
      meta: {
        readonly nextPosition: AccessGovernanceSourcePosition | null;
        readonly exhausted: boolean;
      },
    ) => ({
      nextCursor: meta.nextPosition
        ? this.requireQueueCursorCodec().seal(
            meta.nextPosition,
            lifecycleCursorBinding(actor.id, queue, targetUserId, pageSize),
            generatedAt,
          )
        : null,
      exhausted: meta.exhausted,
    });

    return {
      generatedAt,
      availableScopeTypes: [...ROLE_ASSIGNMENT_SCOPE_TYPES],
      policy: {
        version: ACCESS_LIFECYCLE_COMMAND_POLICY_VERSION,
        timeZone: "Asia/Ho_Chi_Minh",
        grace: {
          automaticExtensionMs: ACCESS_REVIEW_DEFAULT_GRACE_MS,
          maximumAbsoluteExtensionMs: ACCESS_REVIEW_MAXIMUM_GRACE_MS,
        },
      },
      pagination: {
        pageSize,
        reviewCycles: publicMeta("review", reviewPage.meta),
        graceExceptions: publicMeta("grace", gracePage.meta),
        successorRequests: publicMeta("successor", successorPage.meta),
      },
      reviewCycles: reviewPage.items,
      graceExceptions: gracePage.items,
      successorRequests: successorPage.items,
      requestableAssignments: assignmentViews.filter(isPresent),
    };
  }

  async decideReview(
    actor: Actor,
    command: {
      readonly cycleId: unknown;
      readonly decision: unknown;
      readonly reason: unknown;
      readonly nextReviewAt?: unknown;
    },
  ): Promise<Record<string, unknown>> {
    const cycleId = requiredText(command.cycleId, "cycleId");
    const decision = parseAccessDecision(command.decision);
    const reason = requiredText(command.reason, "reason");
    const requestNow = this.nowProvider();
    const preflight = await this.readReviewPreflight(cycleId);
    const outerBlockers = preflight
      ? await this.reviewActorBlockers(
          actor,
          preflight.cycle,
          preflight.assignment,
          requestNow,
        )
      : ["REVIEW_CYCLE_NOT_FOUND"];
    if (outerBlockers.length > 0) return blocked(outerBlockers);

    const permission = PermissionResolver.resolve(
      Permission.ROLE_ASSIGNMENT_REVIEW,
    );
    const result = await this.mutationBridge.execute(
      {
        actor,
        traceId: getTraceIdOrThrow(),
        requiredPermission: permission,
        mutationIdentity: "role.assignment.review",
        mutationTargetDescriptor: `assignment-review:${cycleId}`,
      },
      async (session, controls) => {
        const transactionNow = this.nowProvider();
        const current = await this.readReviewPreflight(cycleId, session);
        if (!current || current.cycle.state !== "PENDING") {
          controls.markExplicitNoOpSuccess();
          return blocked(["STALE_REVIEW_CYCLE"]);
        }
        const innerBlockers = await this.reviewActorBlockers(
          actor,
          current.cycle,
          current.assignment,
          transactionNow,
          session,
        );
        if (innerBlockers.length > 0) {
          controls.markExplicitNoOpSuccess();
          return blocked(innerBlockers);
        }

        const actionContext = await this.resolveCurrentLifecycleActionContext(
          current.assignment,
          current.cycle,
          transactionNow,
          session,
        );
        if (!actionContext.reviewEligible) {
          controls.markExplicitNoOpSuccess();
          return blocked(["STALE_ASSIGNMENT_REVIEW_CYCLE"]);
        }
        const approval: AccessLifecycleApproval = {
          approverUserId: actor.id,
          decidedAt: transactionNow,
          decision,
          reason,
        };
        const approvals = [...current.cycle.approvals, approval];

        if (decision === "REJECTED") {
          const reviewRejected = await this.reviewCycles.updateOne(
            { _id: cycleId, state: "PENDING" },
            {
              $set: { state: "REJECTED", approvals, decidedAt: transactionNow },
            },
            { session },
          );
          if (reviewRejected.modifiedCount !== 1) {
            throw new RoleValidationError("STALE_REVIEW_CYCLE");
          }
          const suspended = await this.assignments.updateOne(
            {
              _id: current.assignment._id,
              state: current.assignment.state,
              "lifecycle.cycleId": cycleId,
            },
            {
              $set: {
                state: "SUSPENDED",
                "lifecycle.suspendedAt": transactionNow,
                "lifecycle.suspensionCause": "REVIEW_OVERDUE",
                updatedAt: transactionNow,
              },
            },
            { session },
          );
          if (suspended.modifiedCount !== 1) {
            throw new RoleValidationError("STALE_ASSIGNMENT_STATE");
          }
          await this.reconciliation.reconcileReducedAssignment(
            current.assignment._id,
            actor.id,
            transactionNow,
            session,
          );
          await this.reconciliation.reconcileBundleParent(
            current.assignment.bundleOrigin?.bundleAssignmentId,
            actor.id,
            transactionNow,
            session,
          );
          await this.lifecycleRepository.insertSuspension(
            {
              suspensionId: crypto.randomUUID(),
              assignmentId: current.assignment._id,
              cause: "REVIEW_OVERDUE",
              authorityDeadline: current.cycle.reviewDeadline,
              materializedAt: transactionNow,
              restoringLineageId: null,
            },
            session,
          );
          controls.markAuthSecurityTruthChanged();
        } else {
          const evaluation = evaluateLifecycleApprovals({
            riskTier: actionContext.currentRiskTier,
            targetUserId: current.cycle.targetUserId,
            requesterUserId: current.cycle.requestedBy,
            approvals,
          });
          if (!evaluation.allowed) {
            const approvalSaved = await this.reviewCycles.updateOne(
              {
                _id: cycleId,
                state: "PENDING",
                "approvals.approverUserId": { $ne: actor.id },
              },
              { $set: { approvals } },
              { session },
            );
            if (approvalSaved.modifiedCount !== 1) {
              throw new RoleValidationError("STALE_REVIEW_CYCLE");
            }
          } else {
            const nextReviewAt = finiteTimestamp(
              command.nextReviewAt,
              "nextReviewAt",
            );
            if (nextReviewAt <= transactionNow)
              throw new RoleValidationError("nextReviewAt must be future");
            const maximumNextReviewAt =
              actionContext.reviewDeadline + actionContext.reviewWindowMs;
            if (nextReviewAt > maximumNextReviewAt) {
              throw new RoleValidationError(
                "NEXT_REVIEW_EXCEEDS_CURRENT_POLICY_MAXIMUM",
              );
            }
            if (
              typeof current.assignment.expiresAt === "number" &&
              Number.isFinite(current.assignment.expiresAt) &&
              nextReviewAt > current.assignment.expiresAt
            ) {
              throw new RoleValidationError(
                "NEXT_REVIEW_AFTER_ASSIGNMENT_EXPIRY",
              );
            }
            const successorEffectiveAt =
              current.assignment.lifecycle?.successorEffectiveAt;
            if (
              typeof successorEffectiveAt === "number" &&
              Number.isFinite(successorEffectiveAt) &&
              nextReviewAt > successorEffectiveAt
            ) {
              throw new RoleValidationError(
                "NEXT_REVIEW_AFTER_SUCCESSOR_CUTOVER",
              );
            }
            const nextCycleId = crypto.randomUUID();
            const successorCycle: ReviewCycleDocument = {
              _id: nextCycleId,
              assignmentId: current.assignment._id,
              targetUserId: current.cycle.targetUserId,
              requestedBy: actor.id,
              requestedAt: transactionNow,
              riskSnapshot: actionContext.currentPolicy!.snapshot,
              reviewDeadline: nextReviewAt,
              state: "PENDING",
              approvals: [],
              decidedAt: null,
              nextReviewDeadline: null,
              reason,
              createdAt: transactionNow,
            };
            await this.lifecycleRepository.insertReviewCycle(
              { ...successorCycle, cycleId: successorCycle._id },
              session,
            );
            const assignmentUpdated = await this.assignments.updateOne(
              {
                _id: current.assignment._id,
                state: current.assignment.state,
                "lifecycle.cycleId": cycleId,
              },
              {
                $set: {
                  reviewAt: nextReviewAt,
                  "lifecycle.cycleId": nextCycleId,
                  "lifecycle.riskTier": actionContext.currentRiskTier,
                  "lifecycle.riskReasons":
                    actionContext.currentPolicy!.snapshot.reasons,
                  "lifecycle.riskAssessedAt": transactionNow,
                  "lifecycle.permissionFingerprint":
                    actionContext.currentPolicy!.permissionFingerprint,
                  "lifecycle.scopeFingerprint":
                    actionContext.currentPolicy!.scopeFingerprint,
                  "lifecycle.reviewDeadline": nextReviewAt,
                  "lifecycle.graceExceptionExpiresAt": null,
                  updatedAt: transactionNow,
                },
              },
              { session },
            );
            if (assignmentUpdated.modifiedCount !== 1) {
              throw new RoleValidationError("STALE_ASSIGNMENT_STATE");
            }
            const reviewCompleted = await this.reviewCycles.updateOne(
              { _id: cycleId, state: "PENDING" },
              {
                $set: {
                  state: "APPROVED",
                  approvals,
                  decidedAt: transactionNow,
                  nextReviewDeadline: nextReviewAt,
                },
              },
              { session },
            );
            if (reviewCompleted.modifiedCount !== 1) {
              throw new RoleValidationError("STALE_REVIEW_CYCLE");
            }
            controls.markAuthSecurityTruthChanged();
          }
        }

        await this.audit.record(
          actor,
          permission,
          current.cycle.targetUserId,
          {
            mutationType: "role.assignment.review",
            cycleId,
            assignmentId: current.assignment._id,
            decision,
            reason,
          },
          session,
        );
        return { applied: true, cycleId, decision, approvals };
      },
    );
    await this.invalidate(actor, "access-lifecycle.review");
    return result;
  }

  async requestGraceException(
    actor: Actor,
    command: {
      readonly cycleId: unknown;
      readonly requestedExpiresAt: unknown;
      readonly reason: unknown;
    },
  ): Promise<Record<string, unknown>> {
    const cycleId = requiredText(command.cycleId, "cycleId");
    const reason = requiredText(command.reason, "reason");
    const requestedExpiresAt = finiteTimestamp(
      command.requestedExpiresAt,
      "requestedExpiresAt",
    );
    const requestNow = this.nowProvider();
    const preflight = await this.readReviewPreflight(cycleId);
    if (!preflight) return blocked(["REVIEW_CYCLE_NOT_FOUND"]);
    const outerScopeBlockers = await this.graceRequestBlockers(
      actor,
      preflight.cycle,
      preflight.assignment,
      requestNow,
    );
    if (outerScopeBlockers.length > 0) return blocked(outerScopeBlockers);
    const outerContext = await this.resolveCurrentLifecycleActionContext(
      preflight.assignment,
      preflight.cycle,
      requestNow,
    );
    const validation = validateGraceException({
      reviewDeadline: outerContext.reviewDeadline,
      requestedExpiresAt,
      requestedBy: actor.id,
      targetUserId: preflight.cycle.targetUserId,
      reason,
    });
    if (outerContext.currentRiskTier !== "LOW") {
      return blocked(["HIGH_RISK_HAS_NO_GRACE"]);
    }
    if (validation.length > 0) return blocked(validation);
    const permission = PermissionResolver.resolve(
      Permission.ROLE_ASSIGNMENT_REVIEW,
    );
    return this.mutationBridge.execute(
      {
        actor,
        traceId: getTraceIdOrThrow(),
        requiredPermission: permission,
        mutationIdentity: "role.assignment.grace-request",
        mutationTargetDescriptor: `assignment-grace:${cycleId}`,
      },
      async (session, controls) => {
        const transactionNow = this.nowProvider();
        const current = await this.readReviewPreflight(cycleId, session);
        if (!current || current.cycle.state !== "PENDING") {
          controls.markExplicitNoOpSuccess();
          return blocked(["STALE_REVIEW_CYCLE"]);
        }
        const innerScopeBlockers = await this.graceRequestBlockers(
          actor,
          current.cycle,
          current.assignment,
          transactionNow,
          session,
        );
        if (innerScopeBlockers.length > 0) {
          controls.markExplicitNoOpSuccess();
          return blocked(innerScopeBlockers);
        }
        const currentContext = await this.resolveCurrentLifecycleActionContext(
          current.assignment,
          current.cycle,
          transactionNow,
          session,
        );
        const currentValidation = validateGraceException({
          reviewDeadline: currentContext.reviewDeadline,
          requestedExpiresAt,
          requestedBy: actor.id,
          targetUserId: current.cycle.targetUserId,
          reason,
        });
        if (
          !currentContext.graceEligible ||
          currentContext.currentRiskTier !== "LOW" ||
          currentValidation.length > 0
        ) {
          controls.markExplicitNoOpSuccess();
          return blocked(
            currentContext.currentRiskTier !== "LOW"
              ? ["HIGH_RISK_HAS_NO_GRACE"]
              : !currentContext.graceEligible
                ? ["STALE_ASSIGNMENT_REVIEW_CYCLE"]
                : currentValidation,
          );
        }
        const record: GraceExceptionDocument = {
          _id: crypto.randomUUID(),
          cycleId,
          targetUserId: current.cycle.targetUserId,
          requestedBy: actor.id,
          requestedAt: transactionNow,
          requestedExpiresAt,
          approvedBy: null,
          approvedAt: null,
          approvedExpiresAt: null,
          state: "PENDING",
          reason,
        };
        await this.lifecycleRepository.insertGraceException(
          { ...record, exceptionId: record._id },
          session,
        );
        await this.audit.record(
          actor,
          permission,
          record.targetUserId,
          {
            mutationType: "role.assignment.grace-request",
            exceptionId: record._id,
            cycleId,
            requestedExpiresAt,
            reason,
          },
          session,
        );
        return { applied: true, exceptionId: record._id, state: record.state };
      },
    );
  }

  async decideGraceException(
    actor: Actor,
    command: {
      readonly exceptionId: unknown;
      readonly decision: unknown;
      readonly reason: unknown;
    },
  ): Promise<Record<string, unknown>> {
    const exceptionId = requiredText(command.exceptionId, "exceptionId");
    const reason = requiredText(command.reason, "reason");
    const decision = parseAccessDecision(command.decision);
    const preflight = await this.graceExceptions.findOne({ _id: exceptionId });
    if (!preflight) return blocked(["GRACE_EXCEPTION_NOT_FOUND"]);
    const outerReview = await this.readReviewPreflight(preflight.cycleId);
    if (!outerReview) return blocked(["REVIEW_CYCLE_NOT_FOUND"]);
    const requestNow = this.nowProvider();
    const outerBlockers = await this.graceDecisionBlockers(
      actor,
      preflight,
      outerReview.cycle,
      outerReview.assignment,
      requestNow,
    );
    if (outerBlockers.length > 0) return blocked(outerBlockers);
    const permission = PermissionResolver.resolve(
      Permission.ROLE_ASSIGNMENT_GRACE_APPROVE,
    );
    return this.mutationBridge.execute(
      {
        actor,
        traceId: getTraceIdOrThrow(),
        requiredPermission: permission,
        mutationIdentity: "role.assignment.grace-approve",
        mutationTargetDescriptor: `assignment-grace:${exceptionId}`,
      },
      async (session, controls) => {
        const transactionNow = this.nowProvider();
        const current = await this.graceExceptions.findOne(
          { _id: exceptionId, state: "PENDING" },
          { session },
        );
        const currentReview = current
          ? await this.readReviewPreflight(current.cycleId, session)
          : null;
        if (!current || !currentReview) {
          controls.markExplicitNoOpSuccess();
          return blocked(["STALE_OR_INELIGIBLE_GRACE_EXCEPTION"]);
        }
        const innerBlockers = await this.graceDecisionBlockers(
          actor,
          current,
          currentReview.cycle,
          currentReview.assignment,
          transactionNow,
          session,
        );
        if (innerBlockers.length > 0) {
          controls.markExplicitNoOpSuccess();
          return blocked(innerBlockers);
        }
        const currentContext = await this.resolveCurrentLifecycleActionContext(
          currentReview.assignment,
          currentReview.cycle,
          transactionNow,
          session,
        );
        if (
          !currentContext.graceEligible ||
          currentContext.currentRiskTier !== "LOW"
        ) {
          controls.markExplicitNoOpSuccess();
          return blocked(
            currentContext.currentRiskTier !== "LOW"
              ? ["HIGH_RISK_HAS_NO_GRACE"]
              : ["STALE_ASSIGNMENT_REVIEW_CYCLE"],
          );
        }
        const decisionSaved = await this.graceExceptions.updateOne(
          { _id: exceptionId, state: "PENDING" },
          {
            $set: {
              state: decision,
              approvedBy: actor.id,
              approvedAt: transactionNow,
              approvedExpiresAt:
                decision === "APPROVED" ? current.requestedExpiresAt : null,
            },
          },
          { session },
        );
        if (decisionSaved.modifiedCount !== 1) {
          throw new RoleValidationError("STALE_GRACE_EXCEPTION");
        }
        if (decision === "APPROVED") {
          const cycle = currentReview.cycle;
          if (currentContext.currentRiskTier !== "LOW") {
            throw new RoleValidationError("HIGH_RISK_HAS_NO_GRACE");
          }
          const assignmentUpdate = await this.assignments.updateOne(
            {
              _id: cycle.assignmentId,
              state: currentReview.assignment.state,
              "lifecycle.cycleId": cycle._id,
            },
            {
              $set: {
                "lifecycle.graceExceptionExpiresAt": current.requestedExpiresAt,
                updatedAt: transactionNow,
              },
            },
            { session },
          );
          if (assignmentUpdate.modifiedCount !== 1) {
            throw new RoleValidationError("STALE_ASSIGNMENT_STATE");
          }
          controls.markAuthSecurityTruthChanged();
        }
        await this.audit.record(
          actor,
          permission,
          current.targetUserId,
          {
            mutationType: "role.assignment.grace-approve",
            exceptionId,
            decision,
            reason,
          },
          session,
        );
        return { applied: true, exceptionId, decision };
      },
    );
  }

  async requestSuccessor(
    actor: Actor,
    command: {
      readonly action: unknown;
      readonly predecessorAssignmentId: unknown;
      readonly roleId?: unknown;
      readonly structuredScopeGrants?: unknown;
      readonly effectiveAt?: unknown;
      readonly expiresAt: unknown;
      readonly reviewAt?: unknown;
      readonly riskTier?: unknown;
      readonly riskReasons?: unknown;
      readonly reason: unknown;
      readonly idempotencyKey: unknown;
    },
  ): Promise<Record<string, unknown>> {
    const action = normalizeSuccessorAction(command.action);
    const predecessorAssignmentId = requiredText(
      command.predecessorAssignmentId,
      "predecessorAssignmentId",
    );
    const predecessor = await this.assignments.findOne({
      _id: predecessorAssignmentId,
    });
    if (!predecessor) return blocked(["ASSIGNMENT_NOT_FOUND"]);
    const permissionCode = permissionForSuccessorAction(action);
    const permission = PermissionResolver.resolve(permissionCode);
    const sourceScopes = predecessor.structuredScopeGrants ?? [];
    const scopes =
      normalizeRoleAssignmentScopeGrants(
        action === "REPLACEMENT"
          ? command.structuredScopeGrants
          : (command.structuredScopeGrants ?? sourceScopes),
      ) ?? [];
    if (scopes.length === 0) return blocked(["EXACT_SCOPE_REQUIRED"]);
    const successorRoleId =
      action === "REPLACEMENT"
        ? requiredText(command.roleId, "roleId")
        : predecessor.roleId;
    const scopeFingerprint = buildRoleAssignmentScopeFingerprint(scopes);
    const explicitEffectiveAt = optionalTimestamp(
      command.effectiveAt,
      "effectiveAt",
    );
    const expiresAt = finiteTimestamp(command.expiresAt, "expiresAt");
    const explicitReviewAt = optionalTimestamp(command.reviewAt, "reviewAt");
    const reason = requiredText(command.reason, "reason");
    const idempotencyKey = requiredText(
      command.idempotencyKey,
      "idempotencyKey",
    );
    const payloadFingerprint = fingerprintSuccessorIntent({
      action,
      predecessorAssignmentId,
      roleId: successorRoleId,
      structuredScopeGrants: scopes,
      scopeFingerprint,
      expectedRoleCode: "",
      expectedRoleTemplateCode: "",
      expectedPermissionFingerprint: "",
      expectedRiskTier: "LOW",
      explicitEffectiveAt,
      expiresAt,
      explicitReviewAt,
      reason,
      idempotencyKey,
      requestedBy: actor.id,
      targetUserId: predecessor.userId,
    });
    const existing = await this.successorRequests.findOne({ idempotencyKey });
    if (existing) return resolveSuccessorReplay(existing, payloadFingerprint);

    const requestNow = this.nowProvider();
    const predecessorRole = await this.roles.findOne({
      _id: predecessor.roleId,
      state: "ACTIVE",
    });
    if (!predecessorRole) return blocked(["PREDECESSOR_ROLE_NOT_ACTIVE"]);
    const sourceBlockers = await this.successorSourceBlockers(
      actor,
      action,
      predecessor,
      predecessorRole,
      requestNow,
    );
    if (sourceBlockers.length > 0) return blocked(sourceBlockers);
    if (
      action !== "REPLACEMENT" &&
      (successorRoleId !== predecessor.roleId ||
        buildRoleAssignmentScopeFingerprint(scopes) !==
          currentAssignmentScopeFingerprint(predecessor))
    ) {
      return blocked([`${action}_MUST_PRESERVE_ROLE_AND_SCOPE`]);
    }
    const successorRole = await this.roles.findOne({
      _id: successorRoleId,
      state: "ACTIVE",
    });
    if (!successorRole) return blocked(["SUCCESSOR_ROLE_NOT_ACTIVE"]);
    if (
      action === "REPLACEMENT" &&
      successorRoleId === predecessor.roleId &&
      scopeFingerprint === currentAssignmentScopeFingerprint(predecessor)
    ) {
      return blocked(["REPLACEMENT_MUST_CHANGE_ROLE_OR_SCOPE"]);
    }
    assertRoleDelegationAllowed(successorRole);
    const outerNow = this.nowProvider();
    await assertActorCanDelegateRoleBand(
      actor.id,
      successorRole.delegationBand ?? "LIMITED",
      successorRole._id,
      this.assignments,
      this.roles,
      undefined,
      outerNow,
    );

    const outerRisk = buildAccessRiskSnapshot({
      assignments: [
        {
          roleCode: successorRole.code,
          roleTemplateCode: successorRole.templateCode ?? successorRole.code,
          permissions: successorRole.permissions,
          structuredScopeGrants: scopes,
        },
      ],
      assessedAt: outerNow,
      scopeFingerprint,
    });

    const unsignedIntent = {
      action,
      predecessorAssignmentId,
      roleId: successorRoleId,
      structuredScopeGrants: scopes,
      scopeFingerprint,
      expectedRoleCode: successorRole.code,
      expectedRoleTemplateCode:
        successorRole.templateCode ?? successorRole.code,
      expectedPermissionFingerprint: outerRisk.permissionFingerprint,
      expectedRiskTier: outerRisk.tier,
      explicitEffectiveAt,
      expiresAt,
      explicitReviewAt,
      reason,
      idempotencyKey,
    };
    const intent: SuccessorRequestIntent = {
      ...unsignedIntent,
      payloadFingerprint,
    };
    const outerTiming = resolveSuccessorTiming(
      intent,
      predecessor,
      successorRole,
      outerNow,
    );
    try {
      this.assertSuccessorWithinPredecessorAuthority(
        action,
        outerTiming.effectiveAt,
        predecessor,
        predecessorRole,
        outerNow,
      );
    } catch (error) {
      if (isSuccessorAuthorityValidationError(error)) {
        return blocked([error.message]);
      }
      throw error;
    }
    const prerequisiteBlockers = await this.successorPrerequisiteBlockers(
      actor,
      predecessor,
      successorRole,
      intent,
      outerTiming,
    );
    if (prerequisiteBlockers.length > 0) return blocked(prerequisiteBlockers);
    try {
      return await this.mutationBridge.execute(
        {
          actor,
          traceId: getTraceIdOrThrow(),
          requiredPermission: permission,
          mutationIdentity: mutationIdentityForSuccessorAction(action),
          mutationTargetDescriptor: `assignment-successor:${predecessorAssignmentId}`,
        },
        async (session, controls) => {
          const [
            currentPredecessor,
            currentPredecessorRole,
            currentRole,
            currentReplay,
          ] = await Promise.all([
            this.assignments.findOne(
              { _id: predecessorAssignmentId },
              { session },
            ),
            this.roles.findOne(
              { _id: predecessor.roleId, state: "ACTIVE" },
              { session },
            ),
            this.roles.findOne(
              { _id: successorRoleId, state: "ACTIVE" },
              { session },
            ),
            this.successorRequests.findOne(
              { idempotencyKey: intent.idempotencyKey },
              { session },
            ),
          ]);
          const transactionNow = this.nowProvider();
          if (currentReplay) {
            controls.markExplicitNoOpSuccess();
            return resolveSuccessorReplay(
              currentReplay,
              intent.payloadFingerprint,
            );
          }
          const currentSourceBlockers = currentPredecessor
            ? await this.successorSourceBlockers(
                actor,
                action,
                currentPredecessor,
                currentPredecessorRole,
                transactionNow,
              )
            : ["STALE_SUCCESSOR_SOURCE"];
          if (
            !currentPredecessor ||
            !currentPredecessorRole ||
            !currentRole ||
            currentPredecessor.userId !== predecessor.userId ||
            currentPredecessor.roleId !== currentPredecessorRole._id ||
            currentSourceBlockers.length > 0
          ) {
            controls.markExplicitNoOpSuccess();
            return blocked(
              currentSourceBlockers.length > 0
                ? currentSourceBlockers
                : ["STALE_SUCCESSOR_SOURCE"],
            );
          }
          if (
            action === "REPLACEMENT" &&
            successorRoleId === currentPredecessor.roleId &&
            intent.scopeFingerprint ===
              currentAssignmentScopeFingerprint(currentPredecessor)
          ) {
            controls.markExplicitNoOpSuccess();
            return blocked(["REPLACEMENT_MUST_CHANGE_ROLE_OR_SCOPE"]);
          }
          if (
            action !== "REPLACEMENT" &&
            (successorRoleId !== currentPredecessor.roleId ||
              intent.scopeFingerprint !==
                currentAssignmentScopeFingerprint(currentPredecessor))
          ) {
            controls.markExplicitNoOpSuccess();
            return blocked(["STALE_SUCCESSOR_AUTHORITY"]);
          }
          assertRoleDelegationAllowed(currentRole);
          await assertActorCanDelegateRoleBand(
            actor.id,
            currentRole.delegationBand ?? "LIMITED",
            currentRole._id,
            this.assignments,
            this.roles,
            session,
            transactionNow,
          );
          const currentRisk = buildAccessRiskSnapshot({
            assignments: [
              {
                roleCode: currentRole.code,
                roleTemplateCode: currentRole.templateCode ?? currentRole.code,
                permissions: currentRole.permissions,
                structuredScopeGrants: intent.structuredScopeGrants,
              },
            ],
            assessedAt: transactionNow,
            scopeFingerprint: intent.scopeFingerprint,
          });
          if (
            currentRole.code !== intent.expectedRoleCode ||
            (currentRole.templateCode ?? currentRole.code) !==
              intent.expectedRoleTemplateCode ||
            currentRisk.permissionFingerprint !==
              intent.expectedPermissionFingerprint ||
            currentRisk.tier !== intent.expectedRiskTier
          ) {
            controls.markExplicitNoOpSuccess();
            return blocked(["STALE_SUCCESSOR_RISK"]);
          }
          const timing = resolveSuccessorTiming(
            intent,
            currentPredecessor,
            currentRole,
            transactionNow,
          );
          try {
            this.assertSuccessorWithinPredecessorAuthority(
              action,
              timing.effectiveAt,
              currentPredecessor,
              currentPredecessorRole,
              transactionNow,
            );
          } catch (error) {
            if (isSuccessorAuthorityValidationError(error)) {
              controls.markExplicitNoOpSuccess();
              return blocked([error.message]);
            }
            throw error;
          }
          const currentPrerequisiteBlockers =
            await this.successorPrerequisiteBlockers(
              actor,
              currentPredecessor,
              currentRole,
              intent,
              timing,
              session,
            );
          if (currentPrerequisiteBlockers.length > 0) {
            controls.markExplicitNoOpSuccess();
            return blocked(currentPrerequisiteBlockers);
          }
          const requestWithFingerprint: SuccessorRequestDocument = {
            _id: crypto.randomUUID(),
            action,
            predecessorAssignmentId,
            targetUserId: currentPredecessor.userId,
            requestedBy: actor.id,
            requestedAt: transactionNow,
            reason: intent.reason,
            idempotencyKey: intent.idempotencyKey,
            payloadFingerprint: intent.payloadFingerprint,
            state: "PENDING",
            approvals: [],
            successor: {
              roleId: successorRoleId,
              structuredScopeGrants: intent.structuredScopeGrants,
              scopeFingerprint: intent.scopeFingerprint,
              effectiveAt: timing.effectiveAt,
              expiresAt: timing.expiresAt,
              reviewAt: timing.reviewAt,
              riskTier: currentRisk.tier,
              riskReasons: currentRisk.reasons,
              riskAssessedAt: transactionNow,
              permissionFingerprint: currentRisk.permissionFingerprint,
              sourceRoleId: currentRole._id,
              sourceRoleCode: currentRole.code,
              sourceRoleTemplateCode:
                currentRole.templateCode ?? currentRole.code,
              riskPolicyVersion: "access-risk-policy/v1",
            },
            successorAssignmentId: null,
            appliedAt: null,
          };
          const inserted = await this.successorRequests.insertOne(
            requestWithFingerprint,
            { session },
          );
          if (inserted.insertedId !== requestWithFingerprint._id) {
            throw new RoleValidationError("SUCCESSOR_REQUEST_INSERT_FAILED");
          }
          await this.audit.record(
            actor,
            permission,
            predecessor.userId,
            {
              mutationType: mutationIdentityForSuccessorAction(action),
              requestId: requestWithFingerprint._id,
              predecessorAssignmentId,
              reason: requestWithFingerprint.reason,
              idempotencyKey: requestWithFingerprint.idempotencyKey,
              payloadFingerprint: requestWithFingerprint.payloadFingerprint,
              permissionFingerprint:
                requestWithFingerprint.successor.permissionFingerprint,
              scopeFingerprint:
                requestWithFingerprint.successor.scopeFingerprint,
            },
            session,
          );
          return {
            applied: true,
            requestId: requestWithFingerprint._id,
            state: requestWithFingerprint.state,
          };
        },
      );
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        throw error;
      }
      const raced = await this.successorRequests.findOne({
        idempotencyKey: intent.idempotencyKey,
      });
      if (!raced) {
        throw new RoleValidationError("SUCCESSOR_IDEMPOTENCY_RACE_UNRESOLVED");
      }
      return resolveSuccessorReplay(raced, intent.payloadFingerprint);
    }
  }

  async approveSuccessor(
    actor: Actor,
    command: {
      readonly requestId: unknown;
      readonly decision: unknown;
      readonly reason: unknown;
    },
  ): Promise<Record<string, unknown>> {
    const requestId = requiredText(command.requestId, "requestId");
    const reason = requiredText(command.reason, "reason");
    const decision = parseAccessDecision(command.decision);
    const outer = await this.successorRequests.findOne({ _id: requestId });
    if (!outer) return blocked(["SUCCESSOR_REQUEST_NOT_FOUND"]);
    const predecessor = await this.assignments.findOne({
      _id: outer.predecessorAssignmentId,
    });
    if (!predecessor) return blocked(["ASSIGNMENT_NOT_FOUND"]);
    if (actor.id === outer.targetUserId)
      return blocked(["TARGET_CANNOT_APPROVE"]);
    if (actor.id === outer.requestedBy)
      return blocked(["REQUESTER_CANNOT_APPROVE"]);
    const outerNow = this.nowProvider();
    const outerPredecessorRole = await this.roles.findOne({
      _id: predecessor.roleId,
      state: "ACTIVE",
    });
    if (!outerPredecessorRole) {
      return blocked(["PREDECESSOR_ROLE_NOT_ACTIVE"]);
    }
    const outerSourceBlockers = await this.successorSourceBlockers(
      actor,
      outer.action,
      predecessor,
      outerPredecessorRole,
      outerNow,
    );
    if (outerSourceBlockers.length > 0) return blocked(outerSourceBlockers);
    const permission = PermissionResolver.resolve(
      permissionForSuccessorAction(outer.action),
    );
    const result = await this.mutationBridge.execute(
      {
        actor,
        traceId: getTraceIdOrThrow(),
        requiredPermission: permission,
        mutationIdentity: mutationIdentityForSuccessorAction(outer.action),
        mutationTargetDescriptor: `assignment-successor:${requestId}`,
      },
      async (session, controls) => {
        const current = await this.successorRequests.findOne(
          { _id: requestId, state: "PENDING" },
          { session },
        );
        const [currentPredecessor, currentPredecessorRole, currentRole] =
          current
            ? await Promise.all([
                this.assignments.findOne(
                  { _id: current.predecessorAssignmentId },
                  { session },
                ),
                this.roles.findOne(
                  { _id: predecessor.roleId, state: "ACTIVE" },
                  { session },
                ),
                this.roles.findOne(
                  { _id: current.successor.roleId, state: "ACTIVE" },
                  { session },
                ),
              ])
            : [null, null, null];
        const transactionNow = this.nowProvider();
        if (
          !current ||
          !currentPredecessor ||
          !currentPredecessorRole ||
          !currentRole ||
          currentPredecessor.roleId !== currentPredecessorRole._id ||
          current.action !== outer.action
        ) {
          controls.markExplicitNoOpSuccess();
          return blocked([
            current && current.action !== outer.action
              ? "SUCCESSOR_ACTION_DRIFT"
              : "STALE_SUCCESSOR_REQUEST",
          ]);
        }
        if (
          actor.id === current.targetUserId ||
          actor.id === current.requestedBy ||
          current.approvals.some((item) => item.approverUserId === actor.id)
        ) {
          controls.markExplicitNoOpSuccess();
          return blocked(["STALE_SUCCESSOR_SEPARATION"]);
        }
        const innerSourceBlockers = await this.successorSourceBlockers(
          actor,
          current.action,
          currentPredecessor,
          currentPredecessorRole,
          transactionNow,
        );
        if (innerSourceBlockers.length > 0) {
          controls.markExplicitNoOpSuccess();
          return blocked(innerSourceBlockers);
        }
        assertRoleDelegationAllowed(currentRole);
        try {
          this.assertSuccessorWithinPredecessorAuthority(
            current.action,
            current.successor.effectiveAt,
            currentPredecessor,
            currentPredecessorRole,
            transactionNow,
          );
        } catch (error) {
          if (isSuccessorAuthorityValidationError(error)) {
            controls.markExplicitNoOpSuccess();
            return blocked([error.message]);
          }
          throw error;
        }
        await assertActorCanDelegateRoleBand(
          actor.id,
          currentRole.delegationBand ?? "LIMITED",
          currentRole._id,
          this.assignments,
          this.roles,
          session,
          transactionNow,
        );
        const currentRisk = buildAccessRiskSnapshot({
          assignments: [
            {
              roleCode: currentRole.code,
              roleTemplateCode: currentRole.templateCode ?? currentRole.code,
              permissions: currentRole.permissions,
              structuredScopeGrants: current.successor.structuredScopeGrants,
            },
          ],
          assessedAt: transactionNow,
          scopeFingerprint: current.successor.scopeFingerprint,
        });
        if (
          currentRole.code !== current.successor.sourceRoleCode ||
          (currentRole.templateCode ?? currentRole.code) !==
            current.successor.sourceRoleTemplateCode ||
          currentRisk.permissionFingerprint !==
            current.successor.permissionFingerprint ||
          currentRisk.tier !== current.successor.riskTier ||
          current.successor.expiresAt === null ||
          current.successor.expiresAt <= transactionNow ||
          current.successor.reviewAt > current.successor.expiresAt
        ) {
          controls.markExplicitNoOpSuccess();
          return blocked(["STALE_SUCCESSOR_RISK_OR_TIMING"]);
        }
        const approvalPrerequisiteBlockers =
          await this.successorPrerequisiteBlockers(
            actor,
            currentPredecessor,
            currentRole,
            {
              action: current.action,
              predecessorAssignmentId: current.predecessorAssignmentId,
              roleId: current.successor.roleId,
              structuredScopeGrants: current.successor.structuredScopeGrants,
              scopeFingerprint: current.successor.scopeFingerprint,
              expectedRoleCode: current.successor.sourceRoleCode,
              expectedRoleTemplateCode:
                current.successor.sourceRoleTemplateCode,
              expectedPermissionFingerprint:
                current.successor.permissionFingerprint,
              expectedRiskTier: current.successor.riskTier,
              explicitEffectiveAt: current.successor.effectiveAt,
              expiresAt: current.successor.expiresAt,
              explicitReviewAt: current.successor.reviewAt,
              reason: current.reason,
              idempotencyKey: current.idempotencyKey,
              payloadFingerprint: current.payloadFingerprint,
            },
            {
              effectiveAt: current.successor.effectiveAt,
              expiresAt: current.successor.expiresAt,
              reviewAt: current.successor.reviewAt,
            },
            session,
          );
        if (approvalPrerequisiteBlockers.length > 0) {
          controls.markExplicitNoOpSuccess();
          return blocked(approvalPrerequisiteBlockers);
        }
        const approval: AccessLifecycleApproval = {
          approverUserId: actor.id,
          decidedAt: Date.now(),
          decision,
          reason,
        };
        const approvals = [...current.approvals, approval];
        if (decision === "REJECTED") {
          const rejected = await this.successorRequests.updateOne(
            {
              _id: requestId,
              state: "PENDING",
              "approvals.approverUserId": { $ne: actor.id },
            },
            { $set: { state: "REJECTED", approvals } },
            { session },
          );
          if (rejected.modifiedCount !== 1) {
            throw new RoleValidationError("STALE_SUCCESSOR_REQUEST");
          }
          await this.audit.record(
            actor,
            permission,
            current.targetUserId,
            {
              mutationType: mutationIdentityForSuccessorAction(current.action),
              requestId,
              decision,
              reason,
              approvalOrdinal: approvals.length,
              requiredApprovals: current.successor.riskTier === "HIGH" ? 2 : 1,
              resultingState: "REJECTED",
              idempotencyKey: current.idempotencyKey,
              permissionFingerprint: current.successor.permissionFingerprint,
              scopeFingerprint: current.successor.scopeFingerprint,
            },
            session,
          );
          return { applied: true, requestId, state: "REJECTED" };
        }
        const approvalEvaluation = evaluateLifecycleApprovals({
          riskTier: current.successor.riskTier,
          targetUserId: current.targetUserId,
          requesterUserId: current.requestedBy,
          approvals,
        });
        if (!approvalEvaluation.allowed) {
          const approvalSaved = await this.successorRequests.updateOne(
            {
              _id: requestId,
              state: "PENDING",
              "approvals.approverUserId": { $ne: actor.id },
            },
            { $set: { approvals } },
            { session },
          );
          if (approvalSaved.modifiedCount !== 1) {
            throw new RoleValidationError("STALE_SUCCESSOR_REQUEST");
          }
          await this.audit.record(
            actor,
            permission,
            current.targetUserId,
            {
              mutationType: mutationIdentityForSuccessorAction(current.action),
              requestId,
              decision,
              reason,
              approvalOrdinal: approvals.length,
              requiredApprovals: approvalEvaluation.requiredApprovalCount,
              resultingState: "PENDING",
              idempotencyKey: current.idempotencyKey,
              permissionFingerprint: current.successor.permissionFingerprint,
              scopeFingerprint: current.successor.scopeFingerprint,
            },
            session,
          );
          return {
            applied: true,
            requestId,
            state: "PENDING",
            approvalsRequired: approvalEvaluation.requiredApprovalCount,
          };
        }
        const now = transactionNow;
        const successorAssignmentId = crypto.randomUUID();
        const cycleId = crypto.randomUUID();
        const lineageId = crypto.randomUUID();
        const predecessorSlot = buildAuthoritySlotIdentity({
          userId: currentPredecessor.userId,
          roleId: currentPredecessor.roleId,
          structuredScopeGrants: currentPredecessor.structuredScopeGrants,
          scopeFingerprint:
            currentAssignmentScopeFingerprint(currentPredecessor),
        });
        const successorSlot = buildAuthoritySlotIdentity({
          userId: currentPredecessor.userId,
          roleId: current.successor.roleId,
          structuredScopeGrants: current.successor.structuredScopeGrants,
          scopeFingerprint: current.successor.scopeFingerprint,
        });
        const storedPredecessorSlot =
          predecessorSlot.id === successorSlot.id
            ? await this.authoritySlots.findById(predecessorSlot.id, session)
            : null;
        await this.authoritySlots.reserve(
          {
            ...successorSlot,
            lineageId:
              storedPredecessorSlot?.lineageId ?? currentPredecessor._id,
            assignmentId: successorAssignmentId,
            ...(predecessorSlot.id === successorSlot.id
              ? { predecessorAssignmentId: currentPredecessor._id }
              : {}),
            successorEffectiveAt: current.successor.effectiveAt,
            assignmentExpiresAt: current.successor.expiresAt,
            transitionIdentity: `access-lifecycle.successor:${current.idempotencyKey}`,
            now,
          },
          session,
        );
        if (predecessorSlot.id !== successorSlot.id) {
          await this.authoritySlots.scheduleRelease(
            predecessorSlot.id,
            currentPredecessor._id,
            current.successor.effectiveAt,
            `access-lifecycle.release-predecessor-slot:${current.idempotencyKey}`,
            now,
            session,
          );
        }
        const successor: AssignmentDocument = {
          ...currentPredecessor,
          _id: successorAssignmentId,
          roleId: current.successor.roleId,
          structuredScopeGrants: current.successor.structuredScopeGrants,
          scopeFingerprint: current.successor.scopeFingerprint,
          state: "SCHEDULED",
          effectiveAt: current.successor.effectiveAt,
          expiresAt: current.successor.expiresAt,
          reviewAt: current.successor.reviewAt,
          lifecycle: {
            cycleId,
            riskTier: current.successor.riskTier,
            riskReasons: current.successor.riskReasons,
            riskAssessedAt: now,
            permissionFingerprint: current.successor.permissionFingerprint,
            scopeFingerprint: current.successor.scopeFingerprint,
            reviewDeadline: current.successor.reviewAt,
            graceExceptionExpiresAt: null,
            suspendedAt: null,
            suspensionCause: null,
            predecessorAssignmentId: currentPredecessor._id,
            successorAssignmentId: null,
            lineageAction: current.action,
          },
          assignedBy: current.requestedBy,
          assignedAt: now,
          revokedAt: null,
          revokedBy: null,
          revokeReason: null,
          origin: "DIRECT",
          bundleOrigin: null,
          reason: current.reason,
          createdAt: now,
          updatedAt: now,
        };
        await this.assignments.insertOne(successor, { session });
        const predecessorUpdate = await this.assignments.updateOne(
          {
            _id: currentPredecessor._id,
            state: currentPredecessor.state,
            "lifecycle.successorAssignmentId": null,
          },
          {
            $set: {
              "lifecycle.successorAssignmentId": successorAssignmentId,
              "lifecycle.successorEffectiveAt": current.successor.effectiveAt,
              updatedAt: now,
            },
          },
          { session },
        );
        if (predecessorUpdate.modifiedCount !== 1) {
          throw new RoleValidationError("STALE_ASSIGNMENT_STATE");
        }
        await this.reconciliation.transferSource(
          currentPredecessor._id,
          successorAssignmentId,
          session,
        );
        await this.lifecycleRepository.insertReviewCycle(
          {
            cycleId,
            assignmentId: successorAssignmentId,
            targetUserId: current.targetUserId,
            requestedBy: current.requestedBy,
            requestedAt: current.requestedAt,
            riskSnapshot: {
              tier: current.successor.riskTier,
              reasons: current.successor.riskReasons,
              assessedAt: current.successor.riskAssessedAt,
              permissionFingerprint: current.successor.permissionFingerprint,
              scopeFingerprint: current.successor.scopeFingerprint,
            },
            reviewDeadline: current.successor.reviewAt,
            state: "PENDING",
            approvals: [],
            decidedAt: null,
            nextReviewDeadline: null,
            reason: current.reason,
            createdAt: now,
          },
          session,
        );
        await this.lifecycleRepository.insertLineage(
          {
            lineageId,
            action: current.action,
            predecessorAssignmentId: currentPredecessor._id,
            successorAssignmentId,
            targetUserId: current.targetUserId,
            requestedBy: current.requestedBy,
            approvals,
            reason: current.reason,
            idempotencyKey: current.idempotencyKey,
            appliedAt: now,
          },
          session,
        );
        const requestApplied = await this.successorRequests.updateOne(
          {
            _id: requestId,
            state: "PENDING",
            "approvals.approverUserId": { $ne: actor.id },
          },
          {
            $set: {
              state: "APPLIED",
              approvals,
              successorAssignmentId,
              appliedAt: now,
            },
          },
          { session },
        );
        if (requestApplied.modifiedCount !== 1) {
          throw new RoleValidationError("STALE_SUCCESSOR_REQUEST");
        }
        controls.markAuthSecurityTruthChanged();
        await this.audit.record(
          actor,
          permission,
          current.targetUserId,
          {
            mutationType: mutationIdentityForSuccessorAction(current.action),
            requestId,
            lineageId,
            predecessorAssignmentId: currentPredecessor._id,
            successorAssignmentId,
            reason,
            decision,
            approvalOrdinal: approvals.length,
            requiredApprovals: approvalEvaluation.requiredApprovalCount,
            resultingState: "APPLIED",
            idempotencyKey: current.idempotencyKey,
            permissionFingerprint: current.successor.permissionFingerprint,
            scopeFingerprint: current.successor.scopeFingerprint,
          },
          session,
        );
        return {
          applied: true,
          requestId,
          state: "APPLIED",
          predecessorAssignmentId: currentPredecessor._id,
          successorAssignmentId,
          lineageId,
        };
      },
    );
    await this.invalidate(actor, "access-lifecycle.successor");
    return result;
  }

  private async resolveCurrentLifecycleActionContext(
    assignment: AssignmentDocument,
    cycle: ReviewCycleDocument,
    now: number,
    sessionOrRoleMap?: ClientSession | ReadonlyMap<string, RoleDocument>,
  ): Promise<CurrentLifecycleActionContext> {
    const roleMap =
      sessionOrRoleMap && "get" in sessionOrRoleMap
        ? (sessionOrRoleMap as ReadonlyMap<string, RoleDocument>)
        : null;
    const session = roleMap
      ? undefined
      : (sessionOrRoleMap as ClientSession | undefined);
    const role = roleMap
      ? (roleMap.get(assignment.roleId) ?? null)
      : await this.roles.findOne(
          { _id: assignment.roleId, state: "ACTIVE" },
          session ? { session } : {},
        );
    const scopeFingerprint = currentAssignmentScopeFingerprint(assignment);
    const currentPolicy = role
      ? buildCurrentRoleAssignmentPolicy({
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
        })
      : null;
    const operational = resolveRoleAssignmentOperationalState(
      assignment,
      now,
      currentPolicy ?? undefined,
    );
    const currentRiskTier = currentPolicy?.riskTier === "LOW" ? "LOW" : "HIGH";
    const reviewWindowMs = role
      ? resolveCanonicalAccessReviewWindowMs(
          classifySensitiveAccess([
            {
              roleCode: role.code,
              roleTemplateCode: role.templateCode ?? role.code,
              permissions: role.permissions,
              structuredScopeGrants: assignment.structuredScopeGrants,
            },
          ]),
        )
      : 0;
    const deadlines = [
      cycle.reviewDeadline,
      currentPolicy?.reviewDeadline,
    ].filter(
      (value): value is number =>
        typeof value === "number" && Number.isFinite(value) && value >= 0,
    );
    const reviewDeadline =
      deadlines.length > 0 ? Math.min(...deadlines) : cycle.reviewDeadline;
    const cycleMatches =
      cycle.state === "PENDING" &&
      assignment.lifecycle?.cycleId === cycle._id &&
      assignment.lifecycle.reviewDeadline === cycle.reviewDeadline;
    const reviewEligible =
      role !== null &&
      cycleMatches &&
      (operational.state === "OPERATIONALLY_ACTIVE" ||
        operational.state === "OPERATIONALLY_SUSPENDED");
    return {
      role,
      currentPolicy,
      operational,
      currentRiskTier,
      reviewDeadline,
      reviewWindowMs,
      requiredApprovals: currentRiskTier === "HIGH" ? 2 : 1,
      completedApprovals: cycle.approvals.filter(
        (approval) => approval.decision === "APPROVED",
      ).length,
      cycleMatches,
      reviewEligible,
      graceEligible:
        reviewEligible &&
        operational.state === "OPERATIONALLY_ACTIVE" &&
        currentRiskTier === "LOW",
    };
  }

  private async readReviewPreflight(cycleId: string, session?: ClientSession) {
    const storedCycle = await this.lifecycleRepository.findReviewCycleById(
      cycleId,
      session,
    );
    const cycle = storedCycle
      ? { ...storedCycle, _id: storedCycle.cycleId }
      : null;
    if (!cycle) return null;
    const assignment = await this.assignments.findOne(
      { _id: cycle.assignmentId },
      session ? { session } : {},
    );
    return assignment ? { cycle, assignment } : null;
  }

  private async reviewActorBlockers(
    actor: Actor,
    cycle: ReviewCycleDocument,
    assignment: AssignmentDocument,
    now: number,
    session?: ClientSession,
  ): Promise<readonly string[]> {
    const blockers: string[] = [];
    if (actor.id === cycle.targetUserId) blockers.push("TARGET_CANNOT_APPROVE");
    if (actor.id === cycle.requestedBy)
      blockers.push("REQUESTER_CANNOT_APPROVE");
    if (cycle.approvals.some((item) => item.approverUserId === actor.id)) {
      blockers.push("APPROVER_ALREADY_DECIDED");
    }
    const context = await this.resolveCurrentLifecycleActionContext(
      assignment,
      cycle,
      now,
      session,
    );
    if (!context.reviewEligible) blockers.push("STALE_ASSIGNMENT_REVIEW_CYCLE");
    if (
      !(await this.hasExactLifecycleScope(
        actor.id,
        Permission.ROLE_ASSIGNMENT_REVIEW,
        assignment,
      ))
    ) {
      blockers.push("EXACT_LIFECYCLE_SCOPE_REQUIRED");
    }
    return blockers;
  }

  private async graceRequestBlockers(
    actor: Actor,
    cycle: ReviewCycleDocument,
    assignment: AssignmentDocument,
    now: number,
    session?: ClientSession,
  ): Promise<readonly string[]> {
    const blockers: string[] = [];
    if (!actor.permissions.includes(Permission.ROLE_ASSIGNMENT_REVIEW)) {
      blockers.push("ROLE_ASSIGNMENT_REVIEW_PERMISSION_REQUIRED");
    }
    if (actor.id === cycle.targetUserId)
      blockers.push("TARGET_CANNOT_REQUEST_GRACE");
    if (cycle.state !== "PENDING") blockers.push("STALE_REVIEW_CYCLE");
    const context = await this.resolveCurrentLifecycleActionContext(
      assignment,
      cycle,
      now,
      session,
    );
    if (context.currentRiskTier !== "LOW")
      blockers.push("HIGH_RISK_HAS_NO_GRACE");
    if (!context.graceEligible) {
      blockers.push("STALE_ASSIGNMENT_REVIEW_CYCLE");
    }
    if (
      !(await this.hasExactLifecycleScope(
        actor.id,
        Permission.ROLE_ASSIGNMENT_REVIEW,
        assignment,
      ))
    ) {
      blockers.push("EXACT_LIFECYCLE_SCOPE_REQUIRED");
    }
    return [...new Set(blockers)];
  }

  private async graceDecisionBlockers(
    actor: Actor,
    exception: GraceExceptionDocument,
    cycle: ReviewCycleDocument,
    assignment: AssignmentDocument,
    now: number,
    session?: ClientSession,
  ): Promise<readonly string[]> {
    const blockers: string[] = [];
    if (!actor.permissions.includes(Permission.ROLE_ASSIGNMENT_GRACE_APPROVE)) {
      blockers.push("ROLE_ASSIGNMENT_GRACE_APPROVE_PERMISSION_REQUIRED");
    }
    if (actor.id === exception.targetUserId)
      blockers.push("TARGET_CANNOT_APPROVE");
    if (actor.id === exception.requestedBy)
      blockers.push("REQUESTER_CANNOT_APPROVE");
    if (exception.state !== "PENDING") blockers.push("STALE_GRACE_EXCEPTION");
    const context = await this.resolveCurrentLifecycleActionContext(
      assignment,
      cycle,
      now,
      session,
    );
    if (cycle.state !== "PENDING" || context.currentRiskTier !== "LOW") {
      blockers.push("STALE_OR_HIGH_RISK_REVIEW_CYCLE");
    }
    if (!context.graceEligible) {
      blockers.push("STALE_ASSIGNMENT_REVIEW_CYCLE");
    }
    const graceValidation = validateGraceException({
      reviewDeadline: context.reviewDeadline,
      requestedExpiresAt: exception.requestedExpiresAt,
      requestedBy: exception.requestedBy,
      targetUserId: exception.targetUserId,
      reason: exception.reason,
    });
    blockers.push(...graceValidation);
    if (
      !(await this.hasExactLifecycleScope(
        actor.id,
        Permission.ROLE_ASSIGNMENT_GRACE_APPROVE,
        assignment,
      ))
    ) {
      blockers.push("EXACT_LIFECYCLE_SCOPE_REQUIRED");
    }
    return [...new Set(blockers)];
  }

  private async canViewLifecycleAssignment(
    actor: Actor,
    assignment: AssignmentDocument,
    partyUserIds: readonly (string | null | undefined)[],
    actionPermissions: readonly Permission[],
  ): Promise<boolean> {
    if (partyUserIds.some((userId) => userId === actor.id)) return true;
    const candidates = [
      ...actionPermissions,
      Permission.OWNER_GOVERNANCE_VIEW,
    ].filter(
      (permission, index, values) => values.indexOf(permission) === index,
    );
    for (const permission of candidates) {
      if (
        actor.permissions.includes(permission) &&
        (await this.hasExactLifecycleScope(actor.id, permission, assignment))
      ) {
        return true;
      }
    }
    return false;
  }

  private resolvePredecessorAuthorityEnd(
    predecessor: AssignmentDocument,
    predecessorRole: RoleDocument,
    transactionNow: number,
  ): number | null {
    const scopeFingerprint = currentAssignmentScopeFingerprint(predecessor);
    const currentPolicy = buildCurrentRoleAssignmentPolicy({
      roleCode: predecessorRole.code,
      roleTemplateCode: predecessorRole.templateCode ?? predecessorRole.code,
      permissions: predecessorRole.permissions,
      structuredScopeGrants: predecessor.structuredScopeGrants,
      effectiveAt: predecessor.effectiveAt,
      durableReviewDeadline:
        predecessor.lifecycle?.reviewDeadline ?? predecessor.reviewAt,
      durableRiskTier: predecessor.lifecycle?.riskTier ?? null,
      storedPermissionFingerprint: predecessor.lifecycle?.permissionFingerprint,
      assessedAt: transactionNow,
      scopeFingerprint,
    });
    const effectiveness = evaluateRoleAssignmentEffectiveness(
      predecessor,
      transactionNow,
      currentPolicy,
    );
    if (!effectiveness.effective) {
      throw new RoleValidationError("STALE_SUCCESSOR_SOURCE");
    }
    return effectiveness.nextTransitionAt ?? null;
  }

  private assertSuccessorWithinPredecessorAuthority(
    action: SuccessorAction,
    successorEffectiveAt: number,
    predecessor: AssignmentDocument,
    predecessorRole: RoleDocument,
    transactionNow: number,
  ): void {
    if (action === "RESTORATION") return;
    const predecessorAuthorityEnd = this.resolvePredecessorAuthorityEnd(
      predecessor,
      predecessorRole,
      transactionNow,
    );
    if (
      predecessorAuthorityEnd !== null &&
      successorEffectiveAt > predecessorAuthorityEnd
    ) {
      throw new RoleValidationError(
        "SUCCESSOR_EFFECTIVE_AT_EXCEEDS_PREDECESSOR_AUTHORITY_END",
      );
    }
  }

  private async successorSourceBlockers(
    actor: Actor,
    action: SuccessorRequestDocument["action"],
    assignment: AssignmentDocument,
    currentRole: RoleDocument | null,
    now: number,
  ): Promise<readonly string[]> {
    const permission = permissionForSuccessorAction(action);
    const blockers: string[] = [];
    if (!actor.permissions.includes(permission)) {
      blockers.push("SUCCESSOR_PERMISSION_REQUIRED");
    }
    if (actor.id === assignment.userId) {
      blockers.push("TARGET_CANNOT_MUTATE_SUCCESSOR");
    }
    const currentPolicy = currentRole
      ? buildCurrentRoleAssignmentPolicy({
          roleCode: currentRole.code,
          roleTemplateCode: currentRole.templateCode ?? currentRole.code,
          permissions: currentRole.permissions,
          structuredScopeGrants: assignment.structuredScopeGrants,
          effectiveAt: assignment.effectiveAt,
          durableReviewDeadline:
            assignment.lifecycle?.reviewDeadline ?? assignment.reviewAt,
          durableRiskTier: assignment.lifecycle?.riskTier ?? null,
          storedPermissionFingerprint:
            assignment.lifecycle?.permissionFingerprint ?? null,
          assessedAt: now,
          scopeFingerprint: currentAssignmentScopeFingerprint(assignment),
        })
      : undefined;
    const operational = resolveRoleAssignmentOperationalState(
      assignment,
      now,
      currentPolicy,
    );
    const restorationEligibility =
      action === "RESTORATION"
        ? evaluateRoleAssignmentRestorationEligibility({
            assignment,
            currentRoleState: currentRole?.state,
            now,
            currentPolicy,
          })
        : null;
    const sourceAllowed =
      action === "RESTORATION"
        ? restorationEligibility?.eligible === true
        : operational.state === "OPERATIONALLY_ACTIVE";
    if (!sourceAllowed) {
      blockers.push(
        restorationEligibility?.reason ??
          (operational.state === "OPERATIONALLY_EXPIRED"
            ? "SOURCE_ASSIGNMENT_EXPIRED"
            : action === "RESTORATION"
              ? "RESTORATION_SOURCE_MUST_BE_SUSPENDED"
              : `${action}_SOURCE_MUST_BE_ACTIVE`),
      );
    }
    if (
      action === "RENEWAL" &&
      (typeof assignment.expiresAt !== "number" ||
        !Number.isFinite(assignment.expiresAt))
    ) {
      blockers.push("RENEWAL_SOURCE_REQUIRES_EXPLICIT_EXPIRY");
    }
    if (
      action !== "RESTORATION" &&
      assignment.lifecycle?.successorAssignmentId
    ) {
      blockers.push("SUCCESSOR_ALREADY_SCHEDULED");
    }
    if (
      !(await this.hasExactLifecycleScope(actor.id, permission, assignment))
    ) {
      blockers.push("EXACT_LIFECYCLE_SCOPE_REQUIRED");
    }
    return [...new Set(blockers)];
  }

  private async successorPrerequisiteBlockers(
    actor: Actor,
    predecessor: AssignmentDocument,
    role: RoleDocument,
    intent: SuccessorRequestIntent,
    timing: {
      readonly effectiveAt: number;
      readonly expiresAt: number;
      readonly reviewAt: number;
    },
    session?: ClientSession,
  ): Promise<readonly string[]> {
    const preview = await this.assignmentPreview.preview(
      {
        actorUserId: actor.id,
        targetUserId: predecessor.userId,
        assignmentTargetType: "ROLE",
        assignmentTargetId: role._id,
        structuredScopeGrants: intent.structuredScopeGrants,
        reason: intent.reason,
        effectiveAt: timing.effectiveAt,
        expiresAt: timing.expiresAt,
        reviewAt: timing.reviewAt,
      },
      {
        actor,
        ...(session ? { session } : {}),
        ignoreAssignmentIds: [predecessor._id],
      },
    );
    if (preview.canApply === true) return [];
    const codes = Array.isArray(preview.blockers)
      ? preview.blockers
          .map((item) =>
            typeof item === "object" &&
            item !== null &&
            "code" in item &&
            typeof item.code === "string"
              ? item.code
              : null,
          )
          .filter((item): item is string => item !== null)
      : [];
    return ["SUCCESSOR_PREREQUISITES_NOT_SATISFIED", ...codes];
  }

  private async hasExactLifecycleScope(
    actorUserId: string,
    permission: Permission,
    assignment: AssignmentDocument,
  ): Promise<boolean> {
    const scopes = assignment.structuredScopeGrants ?? [];
    if (scopes.length === 0) return false;
    const checks = await Promise.all(
      scopes.map((scope) =>
        this.structuredAuthority.hasAuthority({
          userId: actorUserId,
          permission,
          scope,
        }),
      ),
    );
    return checks.every(Boolean);
  }

  private async invalidate(actor: Actor, operation: string): Promise<void> {
    await this.actorCache.invalidateAll({
      traceId: getTraceIdOrThrow(),
      actorId: actor.id,
      context: actor.context,
      operation,
    });
  }

  private requireQueueCursorCodec(): AccessGovernanceQueueCursorCodec {
    if (!this.queueCursorCodec) {
      throw new RoleValidationError("ACCESS_GOVERNANCE_CURSOR_CODEC_REQUIRED");
    }
    return this.queueCursorCodec;
  }
}

function emptyCandidatePage<T>(): CandidatePage<T> {
  return { items: [], sourceExhausted: true, lastPosition: null };
}

function lifecycleCursorBinding(
  actorId: string,
  queue: "review" | "grace" | "successor",
  targetUserId: string | null | undefined,
  pageSize: number,
) {
  return {
    actorId,
    queue: `lifecycle:${queue}`,
    permission:
      queue === "review"
        ? Permission.ROLE_ASSIGNMENT_REVIEW
        : queue === "grace"
          ? Permission.ROLE_ASSIGNMENT_GRACE_APPROVE
          : `${Permission.ROLE_ASSIGNMENT_RENEW}|${Permission.ROLE_ASSIGNMENT_REPLACE}`,
    queryIdentity: targetUserId?.trim() || "all-targets",
    pageSize,
  } as const;
}

function hasExactSnapshotScope(
  snapshot: StructuredScopeAuthoritySnapshot,
  permission: Permission,
  assignment: AssignmentDocument,
): boolean {
  const scopes = assignment.structuredScopeGrants ?? [];
  return (
    scopes.length > 0 &&
    scopes.every((scope) => snapshot.hasAuthority(permission, scope))
  );
}

async function requireStructuredAuthoritySnapshot(
  authority: StructuredScopeAuthorityService,
  userId: string,
  capturedAt: number,
): Promise<StructuredScopeAuthoritySnapshot> {
  if (typeof authority.createSnapshot !== "function") {
    throw new RoleValidationError("STRUCTURED_AUTHORITY_SNAPSHOT_REQUIRED");
  }
  const snapshot = await authority.createSnapshot(userId, capturedAt);
  if (
    !snapshot ||
    snapshot.userId !== userId ||
    snapshot.capturedAt !== capturedAt ||
    typeof snapshot.hasAuthority !== "function" ||
    typeof snapshot.listAuthorizedScopeGrants !== "function"
  ) {
    throw new RoleValidationError("STRUCTURED_AUTHORITY_SNAPSHOT_REQUIRED");
  }
  return snapshot;
}

function reviewListBlockers(
  actor: Actor,
  cycle: ReviewCycleDocument,
  assignment: AssignmentDocument,
  context: CurrentLifecycleActionContext,
  hasExact: (permission: Permission, assignment: AssignmentDocument) => boolean,
): readonly string[] {
  const blockers: string[] = [];
  if (actor.id === cycle.targetUserId) blockers.push("TARGET_CANNOT_APPROVE");
  if (actor.id === cycle.requestedBy) blockers.push("REQUESTER_CANNOT_APPROVE");
  if (cycle.approvals.some((item) => item.approverUserId === actor.id)) {
    blockers.push("APPROVER_ALREADY_DECIDED");
  }
  if (!context.reviewEligible) blockers.push("STALE_ASSIGNMENT_REVIEW_CYCLE");
  if (!hasExact(Permission.ROLE_ASSIGNMENT_REVIEW, assignment)) {
    blockers.push("EXACT_LIFECYCLE_SCOPE_REQUIRED");
  }
  return blockers;
}

function graceRequestListBlockers(
  actor: Actor,
  cycle: ReviewCycleDocument,
  assignment: AssignmentDocument,
  context: CurrentLifecycleActionContext,
  hasExact: (permission: Permission, assignment: AssignmentDocument) => boolean,
): readonly string[] {
  const blockers: string[] = [];
  if (!actor.permissions.includes(Permission.ROLE_ASSIGNMENT_REVIEW)) {
    blockers.push("ROLE_ASSIGNMENT_REVIEW_PERMISSION_REQUIRED");
  }
  if (actor.id === cycle.targetUserId)
    blockers.push("TARGET_CANNOT_REQUEST_GRACE");
  if (cycle.state !== "PENDING") blockers.push("STALE_REVIEW_CYCLE");
  if (context.currentRiskTier !== "LOW")
    blockers.push("HIGH_RISK_HAS_NO_GRACE");
  if (!context.graceEligible) {
    blockers.push("STALE_ASSIGNMENT_REVIEW_CYCLE");
  }
  if (!hasExact(Permission.ROLE_ASSIGNMENT_REVIEW, assignment)) {
    blockers.push("EXACT_LIFECYCLE_SCOPE_REQUIRED");
  }
  return [...new Set(blockers)];
}

function graceDecisionListBlockers(
  actor: Actor,
  exception: GraceExceptionDocument,
  cycle: ReviewCycleDocument,
  assignment: AssignmentDocument,
  context: CurrentLifecycleActionContext,
  hasExact: (permission: Permission, assignment: AssignmentDocument) => boolean,
): readonly string[] {
  const blockers: string[] = [];
  if (!actor.permissions.includes(Permission.ROLE_ASSIGNMENT_GRACE_APPROVE)) {
    blockers.push("ROLE_ASSIGNMENT_GRACE_APPROVE_PERMISSION_REQUIRED");
  }
  if (actor.id === exception.targetUserId)
    blockers.push("TARGET_CANNOT_APPROVE");
  if (actor.id === exception.requestedBy)
    blockers.push("REQUESTER_CANNOT_APPROVE");
  if (exception.state !== "PENDING") blockers.push("STALE_GRACE_EXCEPTION");
  if (cycle.state !== "PENDING" || context.currentRiskTier !== "LOW") {
    blockers.push("STALE_OR_HIGH_RISK_REVIEW_CYCLE");
  }
  if (!context.graceEligible) {
    blockers.push("STALE_ASSIGNMENT_REVIEW_CYCLE");
  }
  blockers.push(
    ...validateGraceException({
      reviewDeadline: context.reviewDeadline,
      requestedExpiresAt: exception.requestedExpiresAt,
      requestedBy: exception.requestedBy,
      targetUserId: exception.targetUserId,
      reason: exception.reason,
    }),
  );
  if (!hasExact(Permission.ROLE_ASSIGNMENT_GRACE_APPROVE, assignment)) {
    blockers.push("EXACT_LIFECYCLE_SCOPE_REQUIRED");
  }
  return [...new Set(blockers)];
}

function permissionForSuccessorAction(
  action: SuccessorRequestDocument["action"],
): Permission {
  return action === "REPLACEMENT"
    ? Permission.ROLE_ASSIGNMENT_REPLACE
    : Permission.ROLE_ASSIGNMENT_RENEW;
}

function mutationIdentityForSuccessorAction(
  action: SuccessorRequestDocument["action"],
):
  | "role.assignment.renew"
  | "role.assignment.replace"
  | "role.assignment.restore" {
  return action === "REPLACEMENT"
    ? "role.assignment.replace"
    : action === "RESTORATION"
      ? "role.assignment.restore"
      : "role.assignment.renew";
}

function normalizeSuccessorAction(
  value: unknown,
): SuccessorRequestDocument["action"] {
  return parseAccessSuccessorAction(value);
}

function currentAssignmentScopeFingerprint(
  assignment: AssignmentDocument,
): string {
  const scopes =
    normalizeRoleAssignmentScopeGrants(assignment.structuredScopeGrants) ?? [];
  return buildRoleAssignmentScopeFingerprint(scopes);
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new RoleValidationError(`${field} is required`);
  }
  return value.trim();
}

function finiteTimestamp(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new RoleValidationError(`${field} must be a finite timestamp`);
  }
  return value;
}

function optionalTimestamp(value: unknown, field: string): number | null {
  return value === null || value === undefined
    ? null
    : finiteTimestamp(value, field);
}

function stringArray(value: unknown, field: string): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string" || !item.trim())
  ) {
    throw new RoleValidationError(`${field} must be a non-empty string array`);
  }
  return [...new Set(value.map((item) => String(item).trim()))].sort();
}

function blocked(blockers: readonly string[]): Record<string, unknown> {
  return { applied: false, blockers: [...blockers], auditWritten: false };
}

function fingerprintSuccessorIntent(
  intent: Omit<SuccessorRequestIntent, "payloadFingerprint"> & {
    readonly requestedBy: string;
    readonly targetUserId: string;
  },
): string {
  const canonical = JSON.stringify({
    action: intent.action,
    predecessorAssignmentId: intent.predecessorAssignmentId,
    targetUserId: intent.targetUserId,
    requestedBy: intent.requestedBy,
    roleId: intent.roleId,
    structuredScopeGrants: intent.structuredScopeGrants,
    scopeFingerprint: intent.scopeFingerprint,
    effectiveAt: intent.explicitEffectiveAt,
    expiresAt: intent.expiresAt,
    reviewAt: intent.explicitReviewAt,
    reason: intent.reason,
  });
  return `assignment-successor:v1:${crypto
    .createHash("sha256")
    .update(canonical)
    .digest("hex")}`;
}

function resolveSuccessorReplay(
  existing: SuccessorRequestDocument,
  requestedPayloadFingerprint: string,
): Record<string, unknown> {
  if (
    !existing.payloadFingerprint ||
    existing.payloadFingerprint !== requestedPayloadFingerprint
  ) {
    throw new RoleValidationError("IDEMPOTENCY_KEY_CONFLICT");
  }
  return {
    applied: false,
    replay: true,
    requestId: existing._id,
    state: existing.state,
  };
}

function resolveSuccessorTiming(
  intent: SuccessorRequestIntent,
  predecessor: AssignmentDocument,
  role: RoleDocument,
  transactionNow: number,
): {
  readonly effectiveAt: number;
  readonly expiresAt: number;
  readonly reviewAt: number;
} {
  const defaultEffectiveAt =
    intent.action === "RENEWAL" &&
    predecessor.expiresAt !== null &&
    predecessor.expiresAt !== undefined &&
    predecessor.expiresAt > transactionNow
      ? predecessor.expiresAt
      : transactionNow;
  const effectiveAt = intent.explicitEffectiveAt ?? defaultEffectiveAt;
  if (effectiveAt < transactionNow) {
    throw new RoleValidationError("SUCCESSOR_EFFECTIVE_AT_IN_PAST");
  }
  if (intent.expiresAt <= effectiveAt) {
    throw new RoleValidationError(
      "SUCCESSOR_EXPIRES_AT_MUST_FOLLOW_EFFECTIVE_AT",
    );
  }
  const classification = classifySensitiveAccess([
    {
      roleCode: role.code,
      roleTemplateCode: role.templateCode ?? role.code,
      permissions: role.permissions,
      structuredScopeGrants: intent.structuredScopeGrants,
    },
  ]);
  const maximumReviewAt =
    effectiveAt + resolveCanonicalAccessReviewWindowMs(classification);
  const reviewAt = intent.explicitReviewAt ?? maximumReviewAt;
  if (reviewAt <= effectiveAt) {
    throw new RoleValidationError(
      "SUCCESSOR_REVIEW_AT_MUST_FOLLOW_EFFECTIVE_AT",
    );
  }
  if (reviewAt > maximumReviewAt) {
    throw new RoleValidationError(
      "SUCCESSOR_REVIEW_AT_EXCEEDS_CANONICAL_RISK_WINDOW",
    );
  }
  if (reviewAt > intent.expiresAt) {
    throw new RoleValidationError("SUCCESSOR_REVIEW_AT_MUST_NOT_FOLLOW_EXPIRY");
  }
  return { effectiveAt, expiresAt: intent.expiresAt, reviewAt };
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === 11000
  );
}

function isSuccessorAuthorityValidationError(
  error: unknown,
): error is RoleValidationError {
  return (
    error instanceof RoleValidationError &&
    (error.message ===
      "SUCCESSOR_EFFECTIVE_AT_EXCEEDS_PREDECESSOR_AUTHORITY_END" ||
      error.message === "STALE_SUCCESSOR_SOURCE")
  );
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}
