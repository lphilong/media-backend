import { Collection, Db } from "mongodb";
import { AuditGuard } from "@core/audit/audit.guard";
import { AuthoritativeSystemMutationBridge } from "@core/application/authoritative-admin-mutation.bridge";
import {
  RegisteredSystemWorkerInvocation,
  assertRegisteredSystemWorkerInvocation,
} from "@core/application/authoritative-system-mutation.policy";
import { getTraceIdOrThrow } from "@core/trace/trace.context";
import { getCurrentDomainEventCollector } from "@system/event-bridge/domain-event.types";
import { evaluateRoleAssignmentEffectiveness } from "@modules/role/domain/role-assignment-lifecycle";
import { UserRoleAssignmentRecord } from "@modules/role/domain/role.types";
import { BreakGlassActivationRecord } from "@modules/role/domain/break-glass";
import {
  createBreakGlassDeadlineExpiredEvent,
  createRoleAssignmentDeadlineSuspendedEvent,
} from "@modules/role/domain/role.events";
import { RoleValidationError } from "@modules/role/domain/role.errors";
import { AccessAuthorityReconciliationService } from "./access-authority-reconciliation.service";
import {
  AccessLifecycleRepository,
  BreakGlassRepository,
} from "@modules/role/domain/access-lifecycle.repositories";
import {
  NativeMongoAccessLifecycleRepository,
  NativeMongoBreakGlassRepository,
} from "@infra/mongo/role/access-lifecycle.repository";
import { buildCurrentRoleAssignmentPolicy } from "@modules/role/domain/sensitive-access-policy";
import { buildRoleAssignmentScopeFingerprint } from "@modules/role/domain/role-assignment-scope";

interface AssignmentDocument extends Omit<
  UserRoleAssignmentRecord,
  "assignmentId"
> {
  readonly _id: string;
}
interface ActivationDocument extends Omit<
  BreakGlassActivationRecord,
  "activationId"
> {
  readonly _id: string;
}
interface RoleDocument {
  readonly _id: string;
  readonly state: string;
  readonly code?: string | null;
  readonly templateCode?: string | null;
  readonly permissions: readonly string[];
}
export class AccessDeadlineWorkerService {
  private readonly assignments: Collection<AssignmentDocument>;
  private readonly activations: Collection<ActivationDocument>;
  private readonly roles: Collection<RoleDocument>;
  private readonly reconciliation: AccessAuthorityReconciliationService;
  private readonly lifecycleRepository: AccessLifecycleRepository;
  private readonly breakGlassRepository: BreakGlassRepository;

  constructor(
    db: Db,
    private readonly audit: AuditGuard,
    private readonly mutationBridge: AuthoritativeSystemMutationBridge,
    repositories?: {
      readonly lifecycle?: AccessLifecycleRepository;
      readonly breakGlass?: BreakGlassRepository;
    },
    private readonly nowProvider: () => number = Date.now,
  ) {
    this.assignments = db.collection("role_assignments");
    this.activations = db.collection("break_glass_activations");
    this.roles = db.collection("roles");
    this.reconciliation = new AccessAuthorityReconciliationService(db);
    this.lifecycleRepository =
      repositories?.lifecycle ?? new NativeMongoAccessLifecycleRepository(db);
    this.breakGlassRepository =
      repositories?.breakGlass ?? new NativeMongoBreakGlassRepository(db);
  }

  async materializeDueTransitions(
    invocation: RegisteredSystemWorkerInvocation,
    options: { readonly now?: number; readonly limit?: number } = {},
  ): Promise<Record<string, unknown>> {
    assertRegisteredSystemWorkerInvocation(invocation);
    const now = options.now ?? Date.now();
    const limit = Math.max(1, Math.min(options.limit ?? 100, 500));
    const assignmentCandidates =
      await this.lifecycleRepository.listDueLifecycleTransitionCandidates({
        now,
        limit,
      });
    const activationCandidates = await this.activations
      .find({ status: "ACTIVE", expiresAt: { $lte: now } })
      .sort({ expiresAt: 1, _id: 1 })
      .limit(limit)
      .toArray();

    let assignmentSuspensions = 0;
    for (const candidate of assignmentCandidates) {
      const applied = await this.materializeAssignmentSuspension({
        invocation,
        assignmentId: candidate.assignmentId,
        candidateCycleId: candidate.cycleId,
        candidateDeadline: candidate.candidateDeadline,
        candidateReason: candidate.transitionReason,
        cycleMatchRequired: candidate.cycleMatchRequired,
        now,
      });
      if (applied) assignmentSuspensions += 1;
    }

    let activationExpiries = 0;
    for (const candidate of activationCandidates) {
      if (
        await this.materializeActivationExpiry({
          invocation,
          activationId: candidate._id,
          candidateDeadline: candidate.expiresAt,
          now,
        })
      ) {
        activationExpiries += 1;
      }
    }

    const pendingIndependentReviews = await this.activations.countDocuments({
      status: "EXPIRED",
      reviewerUserId: null,
      "independentReviewDeadline.dueAt": { $lte: now },
    });
    return {
      now,
      assignmentCandidates: assignmentCandidates.length,
      assignmentSuspensions,
      activationCandidates: activationCandidates.length,
      activationExpiries,
      pendingIndependentReviews,
      requestTimeAuthorityRemainsCanonical: true,
      workerId: invocation.workerId,
      jobIdentity: invocation.jobIdentity,
    };
  }

  private async materializeAssignmentSuspension(params: {
    readonly invocation: RegisteredSystemWorkerInvocation;
    readonly assignmentId: string;
    readonly candidateCycleId: string;
    readonly candidateDeadline: number;
    readonly candidateReason:
      | "ASSIGNMENT_EXPIRY"
      | "REVIEW_DEADLINE_UNRESOLVABLE"
      | "REVIEW_AUTHORITY_END"
      | "MALFORMED_SUCCESSOR";
    readonly cycleMatchRequired: boolean;
    readonly now: number;
  }): Promise<boolean> {
    const transitionId = `role-assignment-deadline-suspend:${params.assignmentId}:${params.candidateCycleId}:${params.candidateDeadline}`;
    return this.mutationBridge.executeSystem(
      {
        actor: params.invocation.actor,
        invocation: params.invocation,
        traceId: getTraceIdOrThrow(),
        mutationIdentity: "role.assignment.deadline-suspend",
        mutationTargetDescriptor: `deadline-assignment:${params.assignmentId}`,
        command: {
          kind: "ROLE_ASSIGNMENT_DEADLINE_SUSPEND",
          assignmentId: params.assignmentId,
          candidateCycleId: params.candidateCycleId,
          candidateDeadline: params.candidateDeadline,
          transitionId,
        },
      },
      async (session, controls, auditPermission) => {
        const transactionNow = this.nowProvider();
        const current = await this.assignments.findOne(
          { _id: params.assignmentId },
          { session },
        );
        const currentRole = current
          ? await this.roles.findOne(
              { _id: current.roleId, state: "ACTIVE" },
              { session },
            )
          : null;
        if (
          !current ||
          !["ACTIVE", "SCHEDULED"].includes(current.state) ||
          !currentRole ||
          (params.candidateReason === "REVIEW_AUTHORITY_END" &&
            params.cycleMatchRequired &&
            current.lifecycle?.cycleId !== params.candidateCycleId)
        ) {
          controls.markExplicitNoOpSuccess();
          return false;
        }
        const currentPolicy = buildCurrentRoleAssignmentPolicy({
          roleCode: currentRole.code,
          roleTemplateCode: currentRole.templateCode ?? currentRole.code,
          permissions: currentRole.permissions,
          structuredScopeGrants: current.structuredScopeGrants,
          effectiveAt: current.effectiveAt,
          durableReviewDeadline:
            current.lifecycle?.reviewDeadline ?? current.reviewAt,
          durableRiskTier: current.lifecycle?.riskTier ?? null,
          storedPermissionFingerprint:
            current.lifecycle?.permissionFingerprint ?? null,
          assessedAt: transactionNow,
          scopeFingerprint:
            current.scopeFingerprint ??
            buildRoleAssignmentScopeFingerprint(current.structuredScopeGrants),
        });
        const evaluation = evaluateRoleAssignmentEffectiveness(
          current,
          transactionNow,
          currentPolicy,
        );
        const transitionStillDue =
          params.candidateReason === "ASSIGNMENT_EXPIRY"
            ? evaluation.reason === "EXPIRED" &&
              current.expiresAt === params.candidateDeadline
            : params.candidateReason === "MALFORMED_SUCCESSOR"
              ? evaluation.reason === "MALFORMED_SUCCESSOR"
              : params.candidateReason === "REVIEW_DEADLINE_UNRESOLVABLE"
                ? evaluation.reason === "REVIEW_DEADLINE_UNRESOLVABLE"
                : !evaluation.effective &&
                  (evaluation.reason === "REVIEW_OVERDUE" ||
                    evaluation.reason === "GRACE_EXPIRED") &&
                  evaluation.authorityEndsAt === params.candidateDeadline;
        if (!transitionStillDue) {
          controls.markExplicitNoOpSuccess();
          return false;
        }

        const updated = await this.assignments.findOneAndUpdate(
          {
            _id: params.assignmentId,
            state: current.state,
            ...(params.candidateReason === "REVIEW_AUTHORITY_END" &&
            params.cycleMatchRequired
              ? { "lifecycle.cycleId": params.candidateCycleId }
              : params.candidateReason === "ASSIGNMENT_EXPIRY"
                ? { expiresAt: params.candidateDeadline }
                : params.candidateReason === "MALFORMED_SUCCESSOR"
                  ? {
                      "lifecycle.successorAssignmentId":
                        current.lifecycle?.successorAssignmentId ?? null,
                      "lifecycle.successorEffectiveAt":
                        current.lifecycle?.successorEffectiveAt ?? null,
                    }
                  : params.candidateReason === "REVIEW_DEADLINE_UNRESOLVABLE"
                    ? {
                        effectiveAt: current.effectiveAt ?? null,
                        reviewAt: current.reviewAt ?? null,
                        "lifecycle.reviewDeadline":
                          current.lifecycle?.reviewDeadline ?? null,
                      }
                    : {}),
          },
          {
            $set: {
              state: "SUSPENDED",
              "lifecycle.suspendedAt": transactionNow,
              "lifecycle.suspensionCause": evaluation.reason,
              updatedAt: transactionNow,
            },
          },
          { session, returnDocument: "after" },
        );
        if (!updated) {
          controls.markExplicitNoOpSuccess();
          return false;
        }

        await this.reconciliation.reconcileReducedAssignment(
          updated._id,
          params.invocation.actor.id,
          transactionNow,
          session,
        );
        await this.reconciliation.reconcileBundleParent(
          updated.bundleOrigin?.bundleAssignmentId,
          params.invocation.actor.id,
          transactionNow,
          session,
        );
        await this.lifecycleRepository.insertSuspension(
          {
            suspensionId: transitionId,
            assignmentId: updated._id,
            cause: evaluation.reason as
              | "EXPIRED"
              | "MALFORMED_SUCCESSOR"
              | "REVIEW_DEADLINE_UNRESOLVABLE"
              | "REVIEW_OVERDUE"
              | "GRACE_EXPIRED",
            authorityDeadline: params.candidateDeadline,
            materializedAt: transactionNow,
            restoringLineageId: null,
          },
          session,
        );
        await this.audit.record(
          params.invocation.actor,
          auditPermission,
          updated.userId,
          {
            mutationType: "role.assignment.deadline-suspend",
            actorType: "SYSTEM",
            workerId: params.invocation.workerId,
            jobIdentity: params.invocation.jobIdentity,
            assignmentId: updated._id,
            targetUserId: updated.userId,
            priorState: current.state,
            resultingState: "SUSPENDED",
            deadline: params.candidateDeadline,
            cycleId:
              params.candidateReason === "REVIEW_AUTHORITY_END" &&
              params.cycleMatchRequired
                ? params.candidateCycleId
                : null,
            candidateReason: params.candidateReason,
            reasonCode: evaluation.reason,
            transitionId,
            authorityAlreadyRequestTimeIneffective: true,
            currentRiskTier: currentPolicy.riskTier,
            currentPermissionFingerprint: currentPolicy.permissionFingerprint,
            storedPermissionFingerprint:
              current.lifecycle?.permissionFingerprint ?? null,
          },
          session,
        );
        getCurrentDomainEventCollector().emit(
          createRoleAssignmentDeadlineSuspendedEvent({
            assignmentId: updated._id,
            userId: updated.userId,
            cycleId: params.candidateCycleId,
            deadline: params.candidateDeadline,
            reason: evaluation.reason as
              | "EXPIRED"
              | "MALFORMED_SUCCESSOR"
              | "REVIEW_DEADLINE_UNRESOLVABLE"
              | "REVIEW_OVERDUE"
              | "GRACE_EXPIRED",
            transitionId,
            occurredAt: transactionNow,
          }),
        );
        controls.markAuthSecurityTruthChanged();
        return true;
      },
    );
  }

  private async materializeActivationExpiry(params: {
    readonly invocation: RegisteredSystemWorkerInvocation;
    readonly activationId: string;
    readonly candidateDeadline: number;
    readonly now: number;
  }): Promise<boolean> {
    const transitionId = `break-glass-deadline-expire:${params.activationId}:${params.candidateDeadline}`;
    return this.mutationBridge.executeSystem(
      {
        actor: params.invocation.actor,
        invocation: params.invocation,
        traceId: getTraceIdOrThrow(),
        mutationIdentity: "break-glass.deadline-expire",
        mutationTargetDescriptor: `deadline-break-glass:${params.activationId}`,
        command: {
          kind: "BREAK_GLASS_DEADLINE_EXPIRE",
          activationId: params.activationId,
          candidateDeadline: params.candidateDeadline,
          transitionId,
        },
      },
      async (session, controls, auditPermission) => {
        const currentRecord =
          await this.breakGlassRepository.findActivationById(
            params.activationId,
            session,
          );
        const current = currentRecord
          ? { ...currentRecord, _id: currentRecord.activationId }
          : null;
        if (
          !current ||
          current.status !== "ACTIVE" ||
          current.expiresAt !== params.candidateDeadline ||
          current.expiresAt > params.now
        ) {
          controls.markExplicitNoOpSuccess();
          return false;
        }
        const updated = await this.activations.findOneAndUpdate(
          {
            _id: params.activationId,
            status: "ACTIVE",
            expiresAt: params.candidateDeadline,
          },
          { $set: { status: "EXPIRED" } },
          { session, returnDocument: "after" },
        );
        if (!updated) {
          controls.markExplicitNoOpSuccess();
          return false;
        }
        await this.breakGlassRepository.insertExpiryEvidence(
          {
            transitionId,
            activationId: updated._id,
            deadline: params.candidateDeadline,
            materializedAt: params.now,
            jobIdentity: params.invocation.jobIdentity,
          },
          session,
        );
        await this.audit.record(
          params.invocation.actor,
          auditPermission,
          updated.targetUserId,
          {
            mutationType: "break-glass.deadline-expire",
            actorType: "SYSTEM",
            workerId: params.invocation.workerId,
            jobIdentity: params.invocation.jobIdentity,
            activationId: updated._id,
            targetUserId: updated.targetUserId,
            priorState: "ACTIVE",
            resultingState: "EXPIRED",
            deadline: params.candidateDeadline,
            incidentReferenceId: updated.incidentReferenceId,
            reasonCode: "BREAK_GLASS_DEADLINE_REACHED",
            transitionId,
            authorityAlreadyRequestTimeIneffective: true,
          },
          session,
        );
        getCurrentDomainEventCollector().emit(
          createBreakGlassDeadlineExpiredEvent({
            activationId: updated._id,
            targetUserId: updated.targetUserId,
            deadline: params.candidateDeadline,
            transitionId,
            occurredAt: params.now,
          }),
        );
        controls.markAuthSecurityTruthChanged();
        return true;
      },
    );
  }
}
