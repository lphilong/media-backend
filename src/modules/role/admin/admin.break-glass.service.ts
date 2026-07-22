import crypto from "node:crypto";
import { ClientSession, Collection, Db } from "mongodb";
import { Actor } from "@core/actor/actor";
import { AuditGuard } from "@core/audit/audit.guard";
import { AuthoritativeAdminMutationBridge } from "@core/application/authoritative-admin-mutation.bridge";
import { Permission } from "@core/permission/permission.enum";
import { PermissionResolver } from "@core/permission/permission.resolver";
import { getTraceIdOrThrow } from "@core/trace/trace.context";
import { ActorSnapshotCacheInvalidator } from "@infra/cache/actor.snapshot.cache";
import { getCurrentDomainEventCollector } from "@system/event-bridge/domain-event.types";
import { createBreakGlassManuallyEndedEvent } from "@modules/role/domain/role.events";
import {
  BREAK_GLASS_DEFAULT_DURATION_MS,
  BREAK_GLASS_MAXIMUM_DURATION_MS,
  BreakGlassActivationRecord,
  BreakGlassApproval,
  BreakGlassRequestRecord,
  BreakGlassStepUpState,
  buildBreakGlassActivation,
  evaluateBreakGlassActivation,
  isBreakGlassActivationEffective,
  validateBreakGlassRequest,
  validateIndependentBreakGlassReview,
} from "@modules/role/domain/break-glass";
import { GovernanceBusinessCalendar } from "@modules/role/domain/governance-business-calendar";
import {
  GovernancePrincipalRecord,
  evaluateGovernancePrincipalEligibility,
} from "@modules/role/domain/governance-principal";
import {
  buildRoleAssignmentScopeFingerprint,
  normalizeRoleAssignmentScopeGrants,
  ROLE_ASSIGNMENT_SCOPE_TYPES,
} from "@modules/role/domain/role-assignment-scope";
import { RoleValidationError } from "@modules/role/domain/role.errors";
import {
  StructuredScopeAuthorityService,
  StructuredScopeAuthoritySnapshot,
} from "@modules/role/domain/structured-scope-authority";
import { NativeMongoStructuredScopeAuthorityReader } from "@infra/mongo/role/structured-scope-authority.repository";
import {
  parseAccessDecision,
  parseBreakGlassReviewResult,
  parseBreakGlassUrgency,
} from "@modules/role/domain/access-governance-command";
import { BreakGlassRepository } from "@modules/role/domain/access-lifecycle.repositories";
import { NativeMongoBreakGlassRepository } from "@infra/mongo/role/access-lifecycle.repository";
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

type RequestDocument = Omit<BreakGlassRequestRecord, "requestId"> & {
  readonly _id: string;
};
type ActivationDocument = Omit<BreakGlassActivationRecord, "activationId"> & {
  readonly _id: string;
};
type PrincipalDocument = Omit<GovernancePrincipalRecord, "principalId"> & {
  readonly _id: string;
};

interface UserEligibilityDocument {
  readonly _id: string;
  readonly accountStatus: string;
  readonly disabledAt?: number | null;
  readonly archivedAt?: number | null;
  readonly authLinkage?: {
    readonly status?: string;
    readonly subject?: string;
  };
}

export interface BreakGlassStepUpProvider {
  evaluate(actor: Actor): Promise<{
    readonly supported: boolean;
    readonly state: BreakGlassStepUpState;
    readonly evidence?: {
      readonly version: string;
      readonly evaluatedAt: number;
      readonly referenceHash?: string | null;
    };
  }>;
}

export class AccessBreakGlassAdminService {
  private readonly requests: Collection<RequestDocument>;
  private readonly activations: Collection<ActivationDocument>;
  private readonly principals: Collection<PrincipalDocument>;
  private readonly users: Collection<UserEligibilityDocument>;
  private readonly structuredAuthority: StructuredScopeAuthorityService;
  private readonly breakGlassRepository: BreakGlassRepository;

  constructor(
    db: Db,
    private readonly audit: AuditGuard,
    private readonly mutationBridge: AuthoritativeAdminMutationBridge,
    private readonly actorCache: ActorSnapshotCacheInvalidator,
    private readonly stepUpProvider: BreakGlassStepUpProvider = {
      evaluate: async () => ({ supported: false, state: "NOT_SUPPORTED" }),
    },
    private readonly calendarProvider: () => Promise<GovernanceBusinessCalendar> = async () => {
      throw new RoleValidationError("GOVERNANCE_CALENDAR_PROVIDER_REQUIRED");
    },
    structuredAuthority?: StructuredScopeAuthorityService,
    breakGlassRepository?: BreakGlassRepository,
    private readonly nowProvider: () => number = Date.now,
    private readonly queueCursorCodec?: AccessGovernanceQueueCursorCodec,
  ) {
    this.requests = db.collection("break_glass_requests");
    this.activations = db.collection("break_glass_activations");
    this.principals = db.collection("governance_principals");
    this.users = db.collection("users");
    this.breakGlassRepository =
      breakGlassRepository ?? new NativeMongoBreakGlassRepository(db);
    this.structuredAuthority =
      structuredAuthority ??
      new StructuredScopeAuthorityService(
        new NativeMongoStructuredScopeAuthorityReader(db),
      );
  }

  async listForActor(
    actor: Actor,
    page: {
      readonly limit?: number;
      readonly requestCursor?: string | null;
      readonly activationCursor?: string | null;
      readonly queue?: "approval" | "independentReview";
      readonly cursor?: string | null;
    } = {},
  ): Promise<Record<string, unknown>> {
    const now = this.nowProvider();
    const pageSize = normalizeQueueLimit(page.limit);
    const selectedQueue = page.queue;
    const authoritySnapshot = await requireStructuredAuthoritySnapshot(
      this.structuredAuthority,
      actor.id,
      now,
    );
    const positionForQueue = (
      queue: "approval" | "independentReview",
      legacyCursor?: string | null,
    ): AccessGovernanceSourcePosition | null => {
      const token = selectedQueue === queue ? page.cursor : legacyCursor;
      if (!token) return null;
      return this.requireQueueCursorCodec().open(
        token,
        breakGlassCursorBinding(actor.id, queue, pageSize),
        now,
      );
    };
    const canApprove = actor.permissions.includes(
      Permission.BREAK_GLASS_APPROVE,
    );
    const canReview = actor.permissions.includes(Permission.BREAK_GLASS_REVIEW);
    const canViewGovernance = actor.permissions.includes(
      Permission.OWNER_GOVERNANCE_VIEW,
    );
    const requestVisibility: Record<string, unknown>[] = [
      { requesterUserId: actor.id },
      { targetUserId: actor.id },
      { "approvals.approverUserId": actor.id },
    ];
    if (canApprove) requestVisibility.push({ status: "PENDING_APPROVAL" });
    const activationVisibility: Record<string, unknown>[] = [
      { targetUserId: actor.id },
      { activatorUserId: actor.id },
      { reviewerUserId: actor.id },
    ];
    if (canReview) {
      activationVisibility.push({
        status: "EXPIRED",
        reviewResult: null,
      });
    }
    const [requestSource, activationSource, primaryOwner] = await Promise.all([
      !selectedQueue || selectedQueue === "approval"
        ? loadBoundedCandidates(
            this.requests,
            canViewGovernance ? {} : { $or: requestVisibility },
            "requestedAt",
            -1,
            positionForQueue("approval", page.requestCursor),
          )
        : emptyBreakGlassCandidatePage<RequestDocument>(),
      !selectedQueue || selectedQueue === "independentReview"
        ? loadBoundedCandidates(
            this.activations,
            canViewGovernance ? {} : { $or: activationVisibility },
            "activatedAt",
            -1,
            positionForQueue("independentReview", page.activationCursor),
          )
        : emptyBreakGlassCandidatePage<ActivationDocument>(),
      this.readEligiblePrimaryOwner(now),
    ]);
    const requests = requestSource.items;
    const activations = activationSource.items;
    const hasExact = (
      permission: Permission,
      scopes: BreakGlassRequestRecord["structuredScopeGrants"],
    ) =>
      scopes.length > 0 &&
      scopes.every((scope) =>
        authoritySnapshot.hasAuthority(permission, scope),
      );

    const requestViews = await Promise.all(
      requests.map(async ({ _id, ...record }) => {
        const request = { ...record, _id } as RequestDocument;
        const blockers = approverListBlockers(actor, request, hasExact);
        const partyVisible =
          actor.id === record.requesterUserId ||
          actor.id === record.targetUserId ||
          record.approvals.some(
            (approval) => approval.approverUserId === actor.id,
          );
        const governanceVisible =
          canViewGovernance &&
          hasExact(
            Permission.OWNER_GOVERNANCE_VIEW,
            record.structuredScopeGrants,
          );
        const canDecide =
          record.status === "PENDING_APPROVAL" && blockers.length === 0;
        if (!partyVisible && !governanceVisible && !canDecide) return null;
        const completedApprovals = record.approvals.filter(
          (approval) => approval.decision === "APPROVED",
        ).length;
        return {
          requestId: _id,
          ...record,
          canApprove: canDecide,
          canReject: canDecide,
          requiredApprovals: record.urgency === "NON_URGENT" ? 2 : 0,
          completedApprovals,
          remainingApprovals: Math.max(
            0,
            (record.urgency === "NON_URGENT" ? 2 : 0) - completedApprovals,
          ),
          ineligibilityReason: canDecide
            ? null
            : (blockers[0] ??
              (record.status !== "PENDING_APPROVAL"
                ? "REQUEST_NOT_PENDING"
                : "BREAK_GLASS_APPROVAL_NOT_AVAILABLE")),
          nextAllowedAction: canDecide ? "INDEPENDENT_APPROVAL" : null,
        };
      }),
    );

    const activationViews = await Promise.all(
      activations.map(async ({ _id, ...record }) => {
        const activation = { ...record, _id } as ActivationDocument;
        const blockers = reviewerListBlockers(actor, activation, hasExact);
        const partyVisible =
          actor.id === record.targetUserId ||
          actor.id === record.activatorUserId ||
          actor.id === record.reviewerUserId;
        const governanceVisible =
          canViewGovernance &&
          hasExact(
            Permission.OWNER_GOVERNANCE_VIEW,
            record.structuredScopeGrants,
          );
        const canReviewActivation = blockers.length === 0;
        const currentlyEffective = isBreakGlassActivationEffective(
          fromActivationDocument(activation),
          now,
        );
        const beneficiaryCanEnd =
          currentlyEffective &&
          actor.id === record.targetUserId &&
          actor.permissions.includes(Permission.BREAK_GLASS_END);
        const primaryOwnerCanEnd =
          currentlyEffective &&
          primaryOwner?.userId === actor.id &&
          actor.permissions.includes(Permission.BREAK_GLASS_END) &&
          actor.permissions.includes(Permission.BREAK_GLASS_ACTIVATE) &&
          hasExact(
            Permission.BREAK_GLASS_ACTIVATE,
            record.structuredScopeGrants,
          );
        const canEnd = beneficiaryCanEnd || primaryOwnerCanEnd;
        if (!partyVisible && !governanceVisible && !canReviewActivation) {
          return null;
        }
        return {
          activationId: _id,
          ...record,
          ...deriveIndependentReviewProjection(
            fromActivationDocument(activation),
            now,
          ),
          currentlyEffective,
          remainingMs: Math.max(0, record.expiresAt - now),
          canReview: canReviewActivation,
          canEnd,
          endIneligibilityReason: canEnd
            ? null
            : currentlyEffective
              ? "BREAK_GLASS_END_NOT_AUTHORIZED"
              : "BREAK_GLASS_NOT_CURRENTLY_ACTIVE",
          ineligibilityReason: canReviewActivation
            ? null
            : (blockers[0] ?? "BREAK_GLASS_REVIEW_NOT_AVAILABLE"),
          nextAllowedAction: canEnd
            ? "END_BREAK_GLASS"
            : record.status === "ACTIVE"
              ? "WAIT_FOR_EXPIRY"
              : canReviewActivation
                ? "INDEPENDENT_REVIEW"
                : null,
        };
      }),
    );
    const requestPage = projectVisiblePage(
      requests,
      requestViews,
      pageSize,
      "requestedAt",
      requestSource,
    );
    const activationPage = projectVisiblePage(
      activations,
      activationViews,
      pageSize,
      "activatedAt",
      activationSource,
    );
    const visibleActivations = activationPage.items;
    const publicMeta = (
      queue: "approval" | "independentReview",
      meta: {
        readonly nextPosition: AccessGovernanceSourcePosition | null;
        readonly exhausted: boolean;
      },
    ) => ({
      nextCursor: meta.nextPosition
        ? this.requireQueueCursorCodec().seal(
            meta.nextPosition,
            breakGlassCursorBinding(actor.id, queue, pageSize),
            now,
          )
        : null,
      exhausted: meta.exhausted,
    });

    return {
      generatedAt: now,
      policy: {
        version: "break-glass-policy/v1",
        defaultDurationMs: BREAK_GLASS_DEFAULT_DURATION_MS,
        maximumDurationMs: BREAK_GLASS_MAXIMUM_DURATION_MS,
      },
      pagination: {
        pageSize,
        requests: publicMeta("approval", requestPage.meta),
        activations: publicMeta("independentReview", activationPage.meta),
      },
      availablePermissions: Object.values(Permission),
      availableScopeTypes: [...ROLE_ASSIGNMENT_SCOPE_TYPES],
      primaryOwner: primaryOwner
        ? { eligible: true, isCurrentActor: primaryOwner.userId === actor.id }
        : { eligible: false, isCurrentActor: false },
      requestEligibility: {
        canRequestNonUrgent: actor.permissions.includes(
          Permission.BREAK_GLASS_REQUEST,
        ),
        canRequestUrgent:
          actor.permissions.includes(Permission.BREAK_GLASS_ACTIVATE) &&
          primaryOwner?.userId === actor.id,
        nonUrgentIneligibilityReason: actor.permissions.includes(
          Permission.BREAK_GLASS_REQUEST,
        )
          ? null
          : "BREAK_GLASS_REQUEST_PERMISSION_REQUIRED",
        urgentIneligibilityReason:
          actor.permissions.includes(Permission.BREAK_GLASS_ACTIVATE) &&
          primaryOwner?.userId === actor.id
            ? null
            : primaryOwner?.userId !== actor.id
              ? "ACTIVE_PRIMARY_OWNER_REQUIRED"
              : "BREAK_GLASS_ACTIVATE_PERMISSION_REQUIRED",
      },
      requests: requestPage.items,
      activations: visibleActivations,
      nextAuthorityTransitionAt:
        visibleActivations
          .filter((item) => item.status === "ACTIVE" && item.expiresAt > now)
          .map((item) => item.expiresAt)
          .sort((left, right) => left - right)[0] ?? null,
    };
  }

  async createRequest(
    actor: Actor,
    command: {
      readonly targetUserId: unknown;
      readonly permissions: unknown;
      readonly structuredScopeGrants: unknown;
      readonly urgency: unknown;
      readonly incidentReferenceId: unknown;
      readonly reason: unknown;
      readonly durationMs?: unknown;
      readonly idempotencyKey: unknown;
    },
  ): Promise<Record<string, unknown>> {
    const now = Date.now();
    const permissions = permissionArray(command.permissions);
    const scopes =
      normalizeRoleAssignmentScopeGrants(command.structuredScopeGrants) ?? [];
    const urgency = parseBreakGlassUrgency(command.urgency);
    const requestWithoutFingerprint: BreakGlassRequestRecord = {
      requestId: crypto.randomUUID(),
      idempotencyKey: requiredText(command.idempotencyKey, "idempotencyKey"),
      payloadFingerprint: "",
      targetUserId: requiredText(command.targetUserId, "targetUserId"),
      permissions,
      structuredScopeGrants: scopes,
      scopeFingerprint: buildRoleAssignmentScopeFingerprint(scopes),
      urgency,
      incidentReferenceId: requiredText(
        command.incidentReferenceId,
        "incidentReferenceId",
      ),
      reason: requiredText(command.reason, "reason"),
      requesterUserId: actor.id,
      requestedAt: now,
      requestedDurationMs:
        command.durationMs === undefined
          ? BREAK_GLASS_DEFAULT_DURATION_MS
          : finiteDuration(command.durationMs),
      approvals: [],
      status: urgency === "URGENT" ? "APPROVED" : "PENDING_APPROVAL",
    };
    const request: BreakGlassRequestRecord = {
      ...requestWithoutFingerprint,
      payloadFingerprint: fingerprintBreakGlassRequest(
        requestWithoutFingerprint,
      ),
    };
    const requestBlockers = validateBreakGlassRequest(request);
    if (requestBlockers.length > 0) return blocked(requestBlockers);

    const existing =
      await this.breakGlassRepository.findRequestByIdempotencyKey(
        request.idempotencyKey,
      );
    if (existing) return this.resolveBreakGlassReplay(existing, request);

    const primaryOwner = await this.readEligiblePrimaryOwner(now);
    if (urgency === "URGENT" && primaryOwner?.userId !== actor.id) {
      return blocked(["URGENT_ACTIVATION_PRIMARY_OWNER_ONLY"]);
    }
    const stepUp = await this.stepUpProvider.evaluate(actor);
    const activationBlockers =
      urgency === "URGENT"
        ? evaluateBreakGlassActivation({
            request,
            activatorUserId: actor.id,
            activePrimaryOwnerUserId: primaryOwner?.userId ?? null,
            primaryOwnerEligible: primaryOwner !== null,
            stepUpSupported: stepUp.supported,
            stepUpState: stepUp.state,
          })
        : [];
    if (activationBlockers.length > 0) return blocked(activationBlockers);

    const permissionCode =
      urgency === "URGENT"
        ? Permission.BREAK_GLASS_ACTIVATE
        : Permission.BREAK_GLASS_REQUEST;
    const permission = PermissionResolver.resolve(permissionCode);
    let result: Record<string, unknown>;
    try {
      result = await this.mutationBridge.execute(
        {
          actor,
          traceId: getTraceIdOrThrow(),
          requiredPermission: permission,
          mutationIdentity:
            urgency === "URGENT"
              ? "break-glass.activate"
              : "break-glass.request",
          mutationTargetDescriptor: `break-glass-idempotency:${request.idempotencyKey}`,
        },
        async (session, controls) => {
          const currentReplay =
            await this.breakGlassRepository.findRequestByIdempotencyKey(
              request.idempotencyKey,
              session,
            );
          if (currentReplay) {
            controls.markExplicitNoOpSuccess();
            return this.resolveBreakGlassReplay(
              currentReplay,
              request,
              session,
            );
          }
          let activationStepUpState = stepUp.state;
          if (urgency === "URGENT") {
            const [currentPrimaryOwner, currentStepUp] = await Promise.all([
              this.readEligiblePrimaryOwner(Date.now(), session),
              this.stepUpProvider.evaluate(actor),
            ]);
            const currentBlockers = evaluateBreakGlassActivation({
              request,
              activatorUserId: actor.id,
              activePrimaryOwnerUserId: currentPrimaryOwner?.userId ?? null,
              primaryOwnerEligible: currentPrimaryOwner !== null,
              stepUpSupported: currentStepUp.supported,
              stepUpState: currentStepUp.state,
            });
            if (currentBlockers.length > 0) {
              controls.markExplicitNoOpSuccess();
              return blocked(currentBlockers);
            }
            activationStepUpState = currentStepUp.state;
          }
          await this.breakGlassRepository.insertRequest(request, session);
          let activation: BreakGlassActivationRecord | null = null;
          if (urgency === "URGENT") {
            activation = await this.insertActivation(
              request,
              actor,
              activationStepUpState,
              session,
            );
            const requestActivated = await this.requests.updateOne(
              { _id: request.requestId, status: "APPROVED" },
              { $set: { status: "ACTIVATED" } },
              { session },
            );
            if (requestActivated.modifiedCount !== 1) {
              throw new RoleValidationError("STALE_BREAK_GLASS_REQUEST");
            }
            controls.markAuthSecurityTruthChanged();
          }
          await this.audit.record(
            actor,
            permission,
            request.targetUserId,
            {
              mutationType:
                urgency === "URGENT"
                  ? "break-glass.activate"
                  : "break-glass.request",
              requestId: request.requestId,
              activationId: activation?.activationId ?? null,
              targetUserId: request.targetUserId,
              permissions: request.permissions,
              structuredScopeGrants: request.structuredScopeGrants,
              incidentReferenceId: request.incidentReferenceId,
              reason: request.reason,
              expiresAt: activation?.expiresAt ?? null,
              idempotencyKey: request.idempotencyKey,
              payloadFingerprint: request.payloadFingerprint,
            },
            session,
          );
          return {
            applied: true,
            request: {
              ...request,
              status: activation ? "ACTIVATED" : request.status,
            },
            activation,
          };
        },
      );
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      const raced = await this.breakGlassRepository.findRequestByIdempotencyKey(
        request.idempotencyKey,
      );
      if (!raced) {
        throw new RoleValidationError(
          "BREAK_GLASS_IDEMPOTENCY_RACE_UNRESOLVED",
        );
      }
      result = await this.resolveBreakGlassReplay(raced, request);
    }
    if (urgency === "URGENT" && result.applied === true) {
      await this.invalidate(actor, "break-glass.activate");
    }
    return result;
  }

  async approveRequest(
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
    const outerRecord =
      await this.breakGlassRepository.findRequestById(requestId);
    const outer = outerRecord ? toRequestDocument(outerRecord) : null;
    if (!outer) return blocked(["BREAK_GLASS_REQUEST_NOT_FOUND"]);
    const outerBlockers = await this.approverBlockers(actor, outer);
    if (outerBlockers.length > 0) return blocked(outerBlockers);
    const permission = PermissionResolver.resolve(
      Permission.BREAK_GLASS_APPROVE,
    );
    await this.stepUpProvider.evaluate(actor);
    const result = await this.mutationBridge.execute(
      {
        actor,
        traceId: getTraceIdOrThrow(),
        requiredPermission: permission,
        mutationIdentity: "break-glass.approve",
        mutationTargetDescriptor: `break-glass:${requestId}`,
      },
      async (session, controls) => {
        const currentRecord = await this.breakGlassRepository.findRequestById(
          requestId,
          session,
        );
        const current = currentRecord ? toRequestDocument(currentRecord) : null;
        if (!current || current.status !== "PENDING_APPROVAL") {
          controls.markExplicitNoOpSuccess();
          return blocked(["STALE_BREAK_GLASS_REQUEST"]);
        }
        const blockers = await this.approverBlockers(actor, current);
        if (blockers.length > 0) {
          controls.markExplicitNoOpSuccess();
          return blocked(blockers);
        }
        const approval: BreakGlassApproval = {
          approverUserId: actor.id,
          decision,
          reason,
          decidedAt: Date.now(),
        };
        const approvals = [...current.approvals, approval];
        if (decision === "REJECTED") {
          const rejected = await this.requests.updateOne(
            {
              _id: requestId,
              status: "PENDING_APPROVAL",
              "approvals.approverUserId": { $ne: actor.id },
            },
            { $set: { status: "REJECTED", approvals } },
            { session },
          );
          if (rejected.modifiedCount !== 1) {
            throw new RoleValidationError("STALE_BREAK_GLASS_REQUEST");
          }
          await this.audit.record(
            actor,
            permission,
            current.targetUserId,
            {
              mutationType: "break-glass.approve",
              requestId,
              decision,
              reason,
              approvalOrdinal: approvals.length,
              requiredApprovals: 2,
              resultingState: "REJECTED",
              incidentReferenceId: current.incidentReferenceId,
              scopeFingerprint: current.scopeFingerprint,
            },
            session,
          );
          return { applied: true, requestId, status: "REJECTED" };
        }
        if (
          approvals.filter((item) => item.decision === "APPROVED").length < 2
        ) {
          const approvalSaved = await this.requests.updateOne(
            {
              _id: requestId,
              status: "PENDING_APPROVAL",
              "approvals.approverUserId": { $ne: actor.id },
            },
            { $set: { approvals } },
            { session },
          );
          if (approvalSaved.modifiedCount !== 1) {
            throw new RoleValidationError("STALE_BREAK_GLASS_REQUEST");
          }
          await this.audit.record(
            actor,
            permission,
            current.targetUserId,
            {
              mutationType: "break-glass.approve",
              requestId,
              decision,
              reason,
              approvalOrdinal: approvals.length,
              requiredApprovals: 2,
              resultingState: "PENDING_APPROVAL",
              incidentReferenceId: current.incidentReferenceId,
              scopeFingerprint: current.scopeFingerprint,
            },
            session,
          );
          return {
            applied: true,
            requestId,
            status: "PENDING_APPROVAL",
            approvals,
          };
        }
        const request = fromRequestDocument({ ...current, approvals });
        const freshStepUp = await this.stepUpProvider.evaluate(actor);
        const activationBlockers = evaluateBreakGlassActivation({
          request,
          activatorUserId: actor.id,
          activePrimaryOwnerUserId: null,
          primaryOwnerEligible: false,
          stepUpSupported: freshStepUp.supported,
          stepUpState: freshStepUp.state,
        });
        if (activationBlockers.length > 0) {
          controls.markExplicitNoOpSuccess();
          return blocked(activationBlockers);
        }
        const activation = await this.insertActivation(
          request,
          actor,
          freshStepUp.state,
          session,
        );
        const activated = await this.requests.updateOne(
          {
            _id: requestId,
            status: "PENDING_APPROVAL",
            "approvals.approverUserId": { $ne: actor.id },
          },
          { $set: { status: "ACTIVATED", approvals } },
          { session },
        );
        if (activated.modifiedCount !== 1) {
          throw new RoleValidationError("STALE_BREAK_GLASS_REQUEST");
        }
        controls.markAuthSecurityTruthChanged();
        await this.audit.record(
          actor,
          permission,
          request.targetUserId,
          {
            mutationType: "break-glass.approve",
            requestId,
            activationId: activation.activationId,
            decision,
            reason,
            approvalOrdinal: approvals.length,
            requiredApprovals: 2,
            resultingState: "ACTIVATED",
            scopeFingerprint: request.scopeFingerprint,
            incidentReferenceId: request.incidentReferenceId,
            stepUpEvidenceVersion: freshStepUp.evidence?.version ?? null,
            stepUpEvidenceEvaluatedAt:
              freshStepUp.evidence?.evaluatedAt ?? this.nowProvider(),
            stepUpEvidenceReferenceHash:
              freshStepUp.evidence?.referenceHash ?? null,
          },
          session,
        );
        return {
          applied: true,
          requestId,
          status: "ACTIVATED",
          approvals,
          activation,
        };
      },
    );
    await this.invalidate(actor, "break-glass.approve");
    return result;
  }

  async reviewActivation(
    actor: Actor,
    command: {
      readonly activationId: unknown;
      readonly result: unknown;
      readonly reason: unknown;
    },
  ): Promise<Record<string, unknown>> {
    const activationId = requiredText(command.activationId, "activationId");
    const reviewResult = parseBreakGlassReviewResult(command.result);
    const reason = requiredText(command.reason, "reason");
    const outerRecord =
      await this.breakGlassRepository.findActivationById(activationId);
    const outer = outerRecord ? toActivationDocument(outerRecord) : null;
    if (!outer) return blocked(["BREAK_GLASS_ACTIVATION_NOT_FOUND"]);
    const blockers = await this.reviewerBlockers(actor, outer);
    if (blockers.length > 0) return blocked(blockers);
    const permission = PermissionResolver.resolve(
      Permission.BREAK_GLASS_REVIEW,
    );
    return this.mutationBridge.execute(
      {
        actor,
        traceId: getTraceIdOrThrow(),
        requiredPermission: permission,
        mutationIdentity: "break-glass.review",
        mutationTargetDescriptor: `break-glass-review:${activationId}`,
      },
      async (session, controls) => {
        const currentRecord =
          await this.breakGlassRepository.findActivationById(
            activationId,
            session,
          );
        const current = currentRecord
          ? toActivationDocument(currentRecord)
          : null;
        if (
          !current ||
          current.reviewerUserId !== null ||
          current.status !== "EXPIRED"
        ) {
          controls.markExplicitNoOpSuccess();
          return blocked(["STALE_BREAK_GLASS_REVIEW"]);
        }
        const innerBlockers = await this.reviewerBlockers(actor, current);
        if (innerBlockers.length > 0) {
          controls.markExplicitNoOpSuccess();
          return blocked(innerBlockers);
        }
        const now = this.nowProvider();
        const wasOverdue = current.independentReviewDeadline.dueAt <= now;
        const updated = await this.activations.findOneAndUpdate(
          { _id: activationId, reviewerUserId: null, status: "EXPIRED" },
          {
            $set: {
              status: "REVIEWED",
              reviewerUserId: actor.id,
              reviewResult,
              reviewedAt: now,
            },
          },
          { session, returnDocument: "after" },
        );
        if (!updated) {
          controls.markExplicitNoOpSuccess();
          return blocked(["STALE_BREAK_GLASS_REVIEW"]);
        }
        await this.audit.record(
          actor,
          permission,
          current.targetUserId,
          {
            mutationType: "break-glass.review",
            activationId,
            reviewResult,
            reason,
            incidentReferenceId: current.incidentReferenceId,
            resultingState: "REVIEWED",
            independentReviewDueAt: current.independentReviewDeadline.dueAt,
            independentReviewCompletedAt: now,
            independentReviewWasOverdue: wasOverdue,
          },
          session,
        );
        return {
          applied: true,
          activationId,
          status: "REVIEWED",
          reviewResult,
        };
      },
    );
  }

  async endActivation(
    actor: Actor,
    command: { readonly activationId: unknown; readonly reason: unknown },
  ): Promise<Record<string, unknown>> {
    const activationId = requiredText(command.activationId, "activationId");
    const reason = requiredText(command.reason, "reason");
    const outer =
      await this.breakGlassRepository.findActivationById(activationId);
    if (!outer) return blocked(["BREAK_GLASS_ACTIVATION_NOT_FOUND"]);
    if (outer.endedAt !== undefined && outer.endedAt !== null) {
      return {
        applied: false,
        replay: true,
        activationId,
        status: outer.status,
        endedAt: outer.endedAt,
      };
    }
    const outerBlockers = await this.endBlockers(
      actor,
      outer,
      this.nowProvider(),
    );
    if (outerBlockers.length > 0) return blocked(outerBlockers);
    const permission = PermissionResolver.resolve(Permission.BREAK_GLASS_END);
    const result = await this.mutationBridge.execute(
      {
        actor,
        traceId: getTraceIdOrThrow(),
        requiredPermission: permission,
        mutationIdentity: "break-glass.end",
        mutationTargetDescriptor: `break-glass-end:${activationId}`,
      },
      async (session, controls) => {
        const transactionNow = this.nowProvider();
        const current = await this.breakGlassRepository.findActivationById(
          activationId,
          session,
        );
        if (!current) {
          controls.markExplicitNoOpSuccess();
          return blocked(["BREAK_GLASS_ACTIVATION_NOT_FOUND"]);
        }
        if (current.endedAt !== undefined && current.endedAt !== null) {
          controls.markExplicitNoOpSuccess();
          return {
            applied: false,
            replay: true,
            activationId,
            status: current.status,
            endedAt: current.endedAt,
          };
        }
        const innerBlockers = await this.endBlockers(
          actor,
          current,
          transactionNow,
          session,
        );
        if (innerBlockers.length > 0) {
          controls.markExplicitNoOpSuccess();
          return blocked(innerBlockers);
        }
        const updated: BreakGlassActivationRecord = {
          ...current,
          status: "EXPIRED",
          endedAt: transactionNow,
          endedByUserId: actor.id,
          endReason: reason,
        };
        const persisted =
          await this.breakGlassRepository.replaceActivationIfStatus(
            updated,
            "ACTIVE",
            session,
          );
        if (!persisted) {
          controls.markExplicitNoOpSuccess();
          return blocked(["STALE_BREAK_GLASS_END"]);
        }
        controls.markAuthSecurityTruthChanged();
        await this.audit.record(
          actor,
          permission,
          current.targetUserId,
          {
            mutationType: "break-glass.end",
            activationId,
            targetUserId: current.targetUserId,
            priorState: "ACTIVE",
            resultingState: "EXPIRED",
            endedAt: transactionNow,
            endedByUserId: actor.id,
            originalExpiresAt: current.expiresAt,
            endMode:
              actor.id === current.targetUserId
                ? "BENEFICIARY_SELF"
                : "PRIMARY_OWNER",
            reason,
            incidentReferenceId: current.incidentReferenceId,
            independentReviewDueAt: current.independentReviewDeadline.dueAt,
          },
          session,
        );
        getCurrentDomainEventCollector().emit(
          createBreakGlassManuallyEndedEvent({
            activationId,
            targetUserId: current.targetUserId,
            endedAt: transactionNow,
            endedByUserId: actor.id,
            originalExpiresAt: current.expiresAt,
          }),
        );
        return {
          applied: true,
          activationId,
          status: "EXPIRED",
          endedAt: transactionNow,
          originalExpiresAt: current.expiresAt,
          postUseReviewRequired: true,
        };
      },
    );
    if (result.applied === true) {
      await this.invalidate(actor, "break-glass.end");
    }
    return result;
  }

  private async insertActivation(
    request: BreakGlassRequestRecord,
    actor: Actor,
    stepUpState: BreakGlassStepUpState,
    session: ClientSession,
  ): Promise<BreakGlassActivationRecord> {
    const activation = buildBreakGlassActivation({
      activationId: crypto.randomUUID(),
      request,
      activatorUserId: actor.id,
      activatedAt: Date.now(),
      durationMs: request.requestedDurationMs,
      stepUpState,
      calendar: await this.calendarProvider(),
      auditCorrelationId: getTraceIdOrThrow(),
    });
    await this.breakGlassRepository.insertActivation(activation, session);
    return activation;
  }

  private async approverBlockers(
    actor: Actor,
    request: RequestDocument,
  ): Promise<readonly string[]> {
    const blockers: string[] = [];
    if (!actor.permissions.includes(Permission.BREAK_GLASS_APPROVE)) {
      blockers.push("BREAK_GLASS_APPROVE_PERMISSION_REQUIRED");
    }
    if (request.urgency !== "NON_URGENT")
      blockers.push("NON_URGENT_REQUEST_REQUIRED");
    if (actor.id === request.requesterUserId)
      blockers.push("REQUESTER_CANNOT_APPROVE");
    if (actor.id === request.targetUserId)
      blockers.push("TARGET_CANNOT_APPROVE");
    if (request.approvals.some((item) => item.approverUserId === actor.id)) {
      blockers.push("APPROVER_ALREADY_DECIDED");
    }
    if (
      !(await this.hasExactBreakGlassScope(
        actor.id,
        Permission.BREAK_GLASS_APPROVE,
        request.structuredScopeGrants,
      ))
    ) {
      blockers.push("EXACT_APPROVER_SCOPE_REQUIRED");
    }
    return blockers;
  }

  private async reviewerBlockers(
    actor: Actor,
    activation: ActivationDocument,
  ): Promise<readonly string[]> {
    const blockers = [
      ...validateIndependentBreakGlassReview({
        activation: fromActivationDocument(activation),
        reviewerUserId: actor.id,
      }),
    ];
    if (!actor.permissions.includes(Permission.BREAK_GLASS_REVIEW)) {
      blockers.push("BREAK_GLASS_REVIEW_PERMISSION_REQUIRED");
    }
    if (
      !(await this.hasExactBreakGlassScope(
        actor.id,
        Permission.BREAK_GLASS_REVIEW,
        activation.structuredScopeGrants,
      ))
    ) {
      blockers.push("EXACT_REVIEWER_SCOPE_REQUIRED");
    }
    return [...new Set(blockers)];
  }

  private async endBlockers(
    actor: Actor,
    activation: BreakGlassActivationRecord,
    now: number,
    session?: ClientSession,
  ): Promise<readonly string[]> {
    if (!isBreakGlassActivationEffective(activation, now)) {
      return ["BREAK_GLASS_NOT_CURRENTLY_ACTIVE"];
    }
    const user = await this.users.findOne(
      { _id: actor.id },
      session ? { session } : {},
    );
    const canonicalActorActive =
      user?.accountStatus === "ACTIVE" &&
      !user.disabledAt &&
      !user.archivedAt &&
      user.authLinkage?.status !== "UNLINKED" &&
      typeof user.authLinkage?.subject === "string" &&
      user.authLinkage.subject.length > 0;
    if (!canonicalActorActive) return ["CANONICAL_ACTIVE_USER_REQUIRED"];
    if (actor.id === activation.targetUserId) return [];

    const primaryOwner = await this.readEligiblePrimaryOwner(now, session);
    if (primaryOwner?.userId !== actor.id) {
      return ["ACTIVE_PRIMARY_OWNER_REQUIRED"];
    }
    if (
      !actor.permissions.includes(Permission.BREAK_GLASS_ACTIVATE) ||
      !(await this.hasExactBreakGlassScope(
        actor.id,
        Permission.BREAK_GLASS_ACTIVATE,
        activation.structuredScopeGrants,
      ))
    ) {
      return ["EXACT_BREAK_GLASS_ACTIVATE_AUTHORITY_REQUIRED"];
    }
    return [];
  }

  private async hasExactBreakGlassScope(
    actorUserId: string,
    permission: Permission,
    scopes: BreakGlassRequestRecord["structuredScopeGrants"],
  ): Promise<boolean> {
    if (scopes.length === 0) return false;
    const exactChecks = await Promise.all(
      scopes.map((scope) =>
        this.structuredAuthority.hasAuthority({
          userId: actorUserId,
          permission,
          scope,
        }),
      ),
    );
    return exactChecks.every(Boolean);
  }

  private requireQueueCursorCodec(): AccessGovernanceQueueCursorCodec {
    if (!this.queueCursorCodec) {
      throw new RoleValidationError("ACCESS_GOVERNANCE_CURSOR_CODEC_REQUIRED");
    }
    return this.queueCursorCodec;
  }

  private async resolveBreakGlassReplay(
    existing: BreakGlassRequestRecord,
    requested: BreakGlassRequestRecord,
    session?: ClientSession,
  ): Promise<Record<string, unknown>> {
    if (existing.payloadFingerprint !== requested.payloadFingerprint) {
      throw new RoleValidationError("IDEMPOTENCY_KEY_CONFLICT");
    }
    const activation =
      await this.breakGlassRepository.findActivationByRequestId(
        existing.requestId,
        session,
      );
    return {
      applied: false,
      replay: true,
      request: existing,
      activation,
    };
  }

  private async readEligiblePrimaryOwner(
    now: number,
    session?: ClientSession,
  ): Promise<PrincipalDocument | null> {
    const principal = await this.principals.findOne(
      {
        principalType: "PRIMARY_OWNER",
        status: "ACTIVE",
      },
      session ? { session } : {},
    );
    if (!principal) return null;
    const user = await this.users.findOne(
      { _id: principal.userId },
      session ? { session } : {},
    );
    const eligibility = evaluateGovernancePrincipalEligibility(
      { ...principal, principalId: principal._id },
      user
        ? {
            userId: user._id,
            userActive:
              user.accountStatus === "ACTIVE" &&
              !user.disabledAt &&
              !user.archivedAt,
            authLinked:
              user.authLinkage?.status !== "UNLINKED" &&
              typeof user.authLinkage?.subject === "string" &&
              !!user.authLinkage.subject,
            accountEligible: user.accountStatus === "ACTIVE",
          }
        : null,
      now,
    );
    return eligibility.eligible ? principal : null;
  }

  private async invalidate(actor: Actor, operation: string): Promise<void> {
    await this.actorCache.invalidateAll({
      traceId: getTraceIdOrThrow(),
      actorId: actor.id,
      context: actor.context,
      operation,
    });
  }
}

function emptyBreakGlassCandidatePage<T>(): CandidatePage<T> {
  return { items: [], sourceExhausted: true, lastPosition: null };
}

function breakGlassCursorBinding(
  actorId: string,
  queue: "approval" | "independentReview",
  pageSize: number,
) {
  return {
    actorId,
    queue: `break-glass:${queue}`,
    permission:
      queue === "approval"
        ? Permission.BREAK_GLASS_APPROVE
        : Permission.BREAK_GLASS_REVIEW,
    queryIdentity: "break-glass-governance",
    pageSize,
  } as const;
}

function approverListBlockers(
  actor: Actor,
  request: RequestDocument,
  hasExact: (
    permission: Permission,
    scopes: BreakGlassRequestRecord["structuredScopeGrants"],
  ) => boolean,
): readonly string[] {
  const blockers: string[] = [];
  if (!actor.permissions.includes(Permission.BREAK_GLASS_APPROVE)) {
    blockers.push("BREAK_GLASS_APPROVE_PERMISSION_REQUIRED");
  }
  if (request.urgency !== "NON_URGENT")
    blockers.push("NON_URGENT_REQUEST_REQUIRED");
  if (actor.id === request.requesterUserId)
    blockers.push("REQUESTER_CANNOT_APPROVE");
  if (actor.id === request.targetUserId) blockers.push("TARGET_CANNOT_APPROVE");
  if (request.approvals.some((item) => item.approverUserId === actor.id)) {
    blockers.push("APPROVER_ALREADY_DECIDED");
  }
  if (
    !hasExact(Permission.BREAK_GLASS_APPROVE, request.structuredScopeGrants)
  ) {
    blockers.push("EXACT_APPROVER_SCOPE_REQUIRED");
  }
  return blockers;
}

function reviewerListBlockers(
  actor: Actor,
  activation: ActivationDocument,
  hasExact: (
    permission: Permission,
    scopes: BreakGlassRequestRecord["structuredScopeGrants"],
  ) => boolean,
): readonly string[] {
  const blockers = [
    ...validateIndependentBreakGlassReview({
      activation: fromActivationDocument(activation),
      reviewerUserId: actor.id,
    }),
  ];
  if (!actor.permissions.includes(Permission.BREAK_GLASS_REVIEW)) {
    blockers.push("BREAK_GLASS_REVIEW_PERMISSION_REQUIRED");
  }
  if (
    !hasExact(Permission.BREAK_GLASS_REVIEW, activation.structuredScopeGrants)
  ) {
    blockers.push("EXACT_REVIEWER_SCOPE_REQUIRED");
  }
  return [...new Set(blockers)];
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

function permissionArray(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new RoleValidationError("permissions must be a non-empty array");
  }
  const allowed = new Set<string>(Object.values(Permission));
  const permissions = value.map((item) => requiredText(item, "permission"));
  if (permissions.some((permission) => !allowed.has(permission))) {
    throw new RoleValidationError("permissions contain an unknown permission");
  }
  return [...new Set(permissions)].sort();
}

function finiteDuration(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RoleValidationError("durationMs must be finite");
  }
  return value;
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new RoleValidationError(`${field} is required`);
  }
  return value.trim();
}

function toRequestDocument(record: BreakGlassRequestRecord): RequestDocument {
  const { requestId, ...rest } = record;
  return { _id: requestId, ...rest };
}

function fromRequestDocument(
  document: RequestDocument,
): BreakGlassRequestRecord {
  const { _id, ...rest } = document;
  return { requestId: _id, ...rest };
}

function toActivationDocument(
  record: BreakGlassActivationRecord,
): ActivationDocument {
  const { activationId, ...rest } = record;
  return { _id: activationId, ...rest };
}

function fromActivationDocument(
  document: ActivationDocument,
): BreakGlassActivationRecord {
  const { _id, ...rest } = document;
  return { activationId: _id, ...rest };
}

function blocked(blockers: readonly string[]): Record<string, unknown> {
  return { applied: false, blockers: [...blockers], auditWritten: false };
}

function deriveIndependentReviewProjection(
  activation: BreakGlassActivationRecord,
  now: number,
): {
  readonly independentReviewState: "PENDING" | "OVERDUE" | "COMPLETED";
  readonly independentReviewCategory: "POST_USE_REVIEW";
  readonly overdueSince: number | null;
  readonly completedAt: number | null;
  readonly wasOverdue: boolean;
} {
  const dueAt = activation.independentReviewDeadline.dueAt;
  if (
    activation.status === "REVIEWED" ||
    activation.reviewerUserId !== null ||
    activation.reviewedAt !== null
  ) {
    const completedAt = activation.reviewedAt;
    return {
      independentReviewState: "COMPLETED",
      independentReviewCategory: "POST_USE_REVIEW",
      overdueSince: null,
      completedAt,
      wasOverdue: completedAt !== null && dueAt <= completedAt,
    };
  }
  const overdue = activation.status === "EXPIRED" && dueAt <= now;
  return {
    independentReviewState: overdue ? "OVERDUE" : "PENDING",
    independentReviewCategory: "POST_USE_REVIEW",
    overdueSince: overdue ? dueAt : null,
    completedAt: null,
    wasOverdue: false,
  };
}

function fingerprintBreakGlassRequest(
  request: BreakGlassRequestRecord,
): string {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        targetUserId: request.targetUserId,
        permissions: [...request.permissions].sort(),
        structuredScopeGrants: request.structuredScopeGrants,
        scopeFingerprint: request.scopeFingerprint,
        urgency: request.urgency,
        incidentReferenceId: request.incidentReferenceId,
        reason: request.reason,
        requesterUserId: request.requesterUserId,
        requestedDurationMs: request.requestedDurationMs,
      }),
    )
    .digest("hex");
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === 11000
  );
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}
