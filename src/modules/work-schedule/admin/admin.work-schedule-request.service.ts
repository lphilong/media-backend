import crypto from "crypto";
import { ClientSession } from "mongodb";
import { Actor } from "@core/actor/actor";
import { AuthoritativeAdminMutationBridge } from "@core/application/authoritative-admin-mutation.bridge";
import { AuthoritativeAdminMutationIdentity } from "@core/application/authoritative-admin-mutation.permission-map";
import { AuditGuard } from "@core/audit/audit.guard";
import { SystemInvariantError } from "@core/error/system-error";
import { Permission } from "@core/permission/permission.enum";
import { PermissionContract } from "@core/permission/permission.contract";
import { PermissionGuard } from "@core/permission/permission.guard";
import { PermissionResolver } from "@core/permission/permission.resolver";
import { getTraceIdOrThrow } from "@core/trace/trace.context";
import { ReferenceSummary } from "@modules/reference-summary";
import { ResponsibilityManagedScopeReader } from "@modules/responsibility/domain/responsibility-managed-scope";
import {
  WorkScheduleConflictError,
  WorkScheduleInvalidResourceReferenceError,
  WorkScheduleInvalidSubjectReferenceError,
  WorkScheduleNotFoundError,
  WorkScheduleOverlapConflictError,
  WorkSchedulePermissionScopeError,
  WorkScheduleRequestNotFoundError,
  WorkScheduleStateError,
  WorkScheduleValidationError,
} from "@modules/work-schedule/domain/work-schedule.errors";
import { WorkScheduleCodeSequenceRepository } from "@modules/work-schedule/domain/work-schedule-code-sequence.repository";
import {
  WorkScheduleEmploymentProfileReadonlyAccess,
  WorkScheduleReferencedEmploymentProfile,
} from "@modules/work-schedule/domain/work-schedule-employment-profile-readonly-access";
import {
  RescheduleWorkShiftInput,
  TransitionWorkShiftStatusInput,
  WorkScheduleRequestRepository,
  WorkShiftRepository,
  WorkShiftSubjectReferenceInput,
} from "@modules/work-schedule/domain/work-schedule.repository";
import { WorkScheduleStudioResourceReadonlyAccess } from "@modules/work-schedule/domain/work-schedule-studio-resource-readonly-access";
import {
  WORK_SCHEDULE_REQUEST_STATUSES,
  WORK_SCHEDULE_REQUEST_TYPES,
  WorkScheduleRequestListItemView,
  WorkScheduleRequestRecord,
  WorkScheduleRequestStatus,
  WorkScheduleRequestType,
  WorkScheduleRequestView,
  WorkShiftRecord,
} from "@modules/work-schedule/domain/work-schedule.types";
import {
  ApproveWorkScheduleRequestCommand,
  CancelWorkScheduleRequestCommand,
  CreateWorkScheduleRequestCommand,
  GetWorkScheduleRequestDetailQuery,
  ListWorkScheduleRequestsQuery,
  ListWorkScheduleRequestsResult,
  RejectWorkScheduleRequestCommand,
  WorkScheduleRequestMutationResult,
} from "@modules/work-schedule/shared/work-schedule.contracts";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

interface NormalizedCreateRequestCommand {
  readonly requestType: WorkScheduleRequestType;
  readonly targetEmploymentProfileId: string;
  readonly targetWorkShiftId: string | null;
  readonly reason: string;
  readonly proposedStartAt: number | null;
  readonly proposedEndAt: number | null;
  readonly proposedTitle: string | null;
  readonly proposedStudioResourceIds: readonly string[];
  readonly proposedDescription: string | null;
  readonly proposedExternalRef: string | null;
}

interface RequestVisibility {
  readonly unrestricted: boolean;
  readonly visibleTargetEmploymentProfileIds?: readonly string[];
  readonly visibleRequestedByUserId?: string;
}

export class WorkScheduleRequestAdminService {
  constructor(
    private readonly requestRepository: WorkScheduleRequestRepository,
    private readonly workShiftRepository: WorkShiftRepository,
    private readonly codeSequenceRepository: WorkScheduleCodeSequenceRepository,
    private readonly employmentProfileReadonlyAccess: WorkScheduleEmploymentProfileReadonlyAccess,
    private readonly studioResourceReadonlyAccess: WorkScheduleStudioResourceReadonlyAccess,
    private readonly managedScopeReader: ResponsibilityManagedScopeReader,
    private readonly audit: AuditGuard,
    private readonly mutationBridge: AuthoritativeAdminMutationBridge,
  ) {}

  async createRequest(
    actor: Actor,
    command: CreateWorkScheduleRequestCommand,
  ): Promise<WorkScheduleRequestMutationResult> {
    const permission = this.assertPermission(
      actor,
      Permission.WORK_SCHEDULE_READ,
    );
    const input = normalizeCreateRequestCommand(command);

    return this.executeMutation(
      actor,
      permission,
      "work-schedule.request.create",
      {
        requestType: input.requestType,
        targetEmploymentProfileId:
          input.targetEmploymentProfileId,
      },
      async (session) => {
        const actorProfile =
          await this.requireActorLinkedEmploymentProfile(
            actor.id,
            session,
          );
        await this.assertTeamManagerCanRequestForTarget(
          actor,
          actorProfile,
          input.targetEmploymentProfileId,
          session,
        );
        await this.assertTargetEmploymentProfileEligible(
          input.targetEmploymentProfileId,
          session,
        );

        if (input.requestType !== "CREATE_SHIFT") {
          await this.requireTargetEmploymentProfileShift(
            input.targetWorkShiftId as string,
            input.targetEmploymentProfileId,
            session,
          );
        }

        if (input.proposedStudioResourceIds.length > 0) {
          await this.assertStudioResourcesEligible(
            input.proposedStudioResourceIds,
            session,
          );
        }

        const now = Date.now();
        const requestCode =
          await this.allocateGeneratedRequestCode(now, session);
        const record: WorkScheduleRequestRecord = {
          id: crypto.randomUUID(),
          requestCode,
          requestType: input.requestType,
          status: "PENDING",
          targetKind: "EMPLOYMENT_PROFILE_WORK_SHIFT",
          requestSource: "TEAM_MANAGER",
          targetEmploymentProfileId:
            input.targetEmploymentProfileId,
          targetWorkShiftId: input.targetWorkShiftId,
          requestedByUserId: actor.id,
          requestedByEmploymentProfileId:
            actorProfile.id,
          reason: input.reason,
          proposedStartAt: input.proposedStartAt,
          proposedEndAt: input.proposedEndAt,
          proposedTitle: input.proposedTitle,
          proposedStudioResourceIds: [
            ...input.proposedStudioResourceIds,
          ],
          proposedDescription:
            input.proposedDescription,
          proposedExternalRef:
            input.proposedExternalRef,
          approvedByUserId: null,
          approvedAt: null,
          approvalNote: null,
          rejectedByUserId: null,
          rejectedAt: null,
          rejectionReason: null,
          cancelledByUserId: null,
          cancelledAt: null,
          cancellationReason: null,
          appliedWorkShiftId: null,
          createdAt: now,
          updatedAt: now,
        };

        const created =
          await this.requestRepository.insert(
            record,
            session,
          );

        await this.recordAudit({
          actor,
          permission,
          requestId: created.id,
          mutationType:
            "work-schedule.request.create",
          metadata: {
            requestCode: created.requestCode,
            requestType: created.requestType,
            targetEmploymentProfileId:
              created.targetEmploymentProfileId,
          },
          session,
        });

        return this.toRequestView(created, session);
      },
    );
  }

  async listRequests(
    actor: Actor,
    query: ListWorkScheduleRequestsQuery,
  ): Promise<ListWorkScheduleRequestsResult> {
    this.assertPermission(
      actor,
      Permission.WORK_SCHEDULE_READ,
    );

    const normalized = normalizeListQuery(query);
    const visibility =
      await this.resolveRequestVisibility(actor);

    const result = await this.requestRepository.list({
      ...normalized,
      ...(visibility.unrestricted
        ? {}
        : {
            visibleTargetEmploymentProfileIds:
              visibility.visibleTargetEmploymentProfileIds ??
              [],
            visibleRequestedByUserId:
              visibility.visibleRequestedByUserId,
          }),
    });

    return {
      items: await Promise.all(
        result.items.map((item) =>
          this.toRequestView(item),
        ),
      ),
      nextCursor: result.nextCursor,
    };
  }

  async getRequestDetail(
    actor: Actor,
    query: GetWorkScheduleRequestDetailQuery,
  ): Promise<WorkScheduleRequestView> {
    this.assertPermission(
      actor,
      Permission.WORK_SCHEDULE_READ,
    );
    const requestId = normalizeRequiredText(
      query.requestId,
      "requestId",
    );
    const request = await this.requireRequest(requestId);

    await this.assertRequestVisible(actor, request);

    return this.toRequestView(request);
  }

  async approveRequest(
    actor: Actor,
    command: ApproveWorkScheduleRequestCommand,
  ): Promise<WorkScheduleRequestMutationResult> {
    const permission = this.assertPermission(
      actor,
      Permission.WORK_SCHEDULE_UPDATE,
    );
    this.assertGlobalScheduleAuthority(actor);
    const requestId = normalizeRequiredText(
      command.requestId,
      "requestId",
    );
    const approvalNote =
      normalizeOptionalNullableText(
        command.approvalNote,
        "approvalNote",
      ) ?? null;

    return this.executeMutation(
      actor,
      permission,
      "work-schedule.request.approve",
      { requestId },
      async (session) => {
        const request = await this.requireRequest(
          requestId,
          session,
        );
        assertPendingRequest(request);
        assertNotApplied(request);
        this.assertApprovalMutationPermission(
          actor,
          request.requestType,
        );

        const appliedWorkShiftId =
          await this.applyApprovedRequest(
            request,
            session,
          );
        const now = Date.now();
        const updated =
          await this.requestRepository.transitionStatus(
            {
              requestId: request.id,
              fromStatus: "PENDING",
              toStatus: "APPROVED",
              updatedAt: now,
              approvedByUserId: actor.id,
              approvedAt: now,
              approvalNote,
              appliedWorkShiftId,
            },
            session,
          );

        if (!updated) {
          throw new WorkScheduleConflictError(
            `Failed to approve work schedule request: ${request.id}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          requestId: updated.id,
          mutationType:
            "work-schedule.request.approve",
          metadata: {
            requestCode: updated.requestCode,
            requestType: updated.requestType,
            appliedWorkShiftId,
            approvalNote,
          },
          session,
        });

        return this.toRequestView(updated, session);
      },
    );
  }

  async rejectRequest(
    actor: Actor,
    command: RejectWorkScheduleRequestCommand,
  ): Promise<WorkScheduleRequestMutationResult> {
    const permission = this.assertPermission(
      actor,
      Permission.WORK_SCHEDULE_UPDATE,
    );
    this.assertGlobalScheduleAuthority(actor);
    const requestId = normalizeRequiredText(
      command.requestId,
      "requestId",
    );
    const rejectionReason = normalizeRequiredText(
      command.rejectionReason,
      "rejectionReason",
    );

    return this.executeMutation(
      actor,
      permission,
      "work-schedule.request.reject",
      { requestId },
      async (session) => {
        const request = await this.requireRequest(
          requestId,
          session,
        );
        assertPendingRequest(request);
        const now = Date.now();
        const updated =
          await this.requestRepository.transitionStatus(
            {
              requestId: request.id,
              fromStatus: "PENDING",
              toStatus: "REJECTED",
              updatedAt: now,
              rejectedByUserId: actor.id,
              rejectedAt: now,
              rejectionReason,
            },
            session,
          );

        if (!updated) {
          throw new WorkScheduleConflictError(
            `Failed to reject work schedule request: ${request.id}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          requestId: updated.id,
          mutationType:
            "work-schedule.request.reject",
          metadata: {
            requestCode: updated.requestCode,
            requestType: updated.requestType,
            rejectionReason,
          },
          session,
        });

        return this.toRequestView(updated, session);
      },
    );
  }

  async cancelRequest(
    actor: Actor,
    command: CancelWorkScheduleRequestCommand,
  ): Promise<WorkScheduleRequestMutationResult> {
    const permission = this.assertPermission(
      actor,
      Permission.WORK_SCHEDULE_READ,
    );
    const requestId = normalizeRequiredText(
      command.requestId,
      "requestId",
    );
    const cancellationReason =
      normalizeOptionalNullableText(
        command.cancellationReason,
        "cancellationReason",
      ) ?? null;

    return this.executeMutation(
      actor,
      permission,
      "work-schedule.request.cancel",
      { requestId },
      async (session) => {
        const request = await this.requireRequest(
          requestId,
          session,
        );
        assertPendingRequest(request);

        if (request.requestedByUserId === actor.id) {
          await this.assertRequestVisible(
            actor,
            request,
            session,
          );
        } else {
          this.assertPermission(
            actor,
            Permission.WORK_SCHEDULE_UPDATE,
          );
          this.assertGlobalScheduleAuthority(actor);
        }

        const now = Date.now();
        const updated =
          await this.requestRepository.transitionStatus(
            {
              requestId: request.id,
              fromStatus: "PENDING",
              toStatus: "CANCELLED",
              updatedAt: now,
              cancelledByUserId: actor.id,
              cancelledAt: now,
              cancellationReason,
            },
            session,
          );

        if (!updated) {
          throw new WorkScheduleConflictError(
            `Failed to cancel work schedule request: ${request.id}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          requestId: updated.id,
          mutationType:
            "work-schedule.request.cancel",
          metadata: {
            requestCode: updated.requestCode,
            requestType: updated.requestType,
            cancellationReason,
          },
          session,
        });

        return this.toRequestView(updated, session);
      },
    );
  }

  private async applyApprovedRequest(
    request: WorkScheduleRequestRecord,
    session: ClientSession,
  ): Promise<string> {
    await this.assertTargetEmploymentProfileEligible(
      request.targetEmploymentProfileId,
      session,
    );

    switch (request.requestType) {
      case "CREATE_SHIFT":
        return this.applyCreateShiftRequest(
          request,
          session,
        );
      case "RESCHEDULE_SHIFT":
        return this.applyRescheduleShiftRequest(
          request,
          session,
        );
      case "CANCEL_SHIFT":
        return this.applyCancelShiftRequest(
          request,
          session,
        );
    }
  }

  private async applyCreateShiftRequest(
    request: WorkScheduleRequestRecord,
    session: ClientSession,
  ): Promise<string> {
    if (
      request.proposedStartAt === null ||
      request.proposedEndAt === null ||
      request.proposedTitle === null
    ) {
      throw new WorkScheduleValidationError(
        "CREATE_SHIFT approval requires proposed title, start, and end",
      );
    }

    const subject = toEmploymentProfileSubject(
      request.targetEmploymentProfileId,
    );
    await this.assertStudioResourcesEligible(
      request.proposedStudioResourceIds,
      session,
    );
    await this.assertNoOverlapConflicts({
      subject,
      studioResourceIds:
        request.proposedStudioResourceIds,
      shiftStartAt: request.proposedStartAt,
      shiftEndAt: request.proposedEndAt,
      session,
    });

    const now = Date.now();
    const shiftCode =
      await this.allocateGeneratedShiftCode(
        request.proposedStartAt,
        session,
      );
    const record: WorkShiftRecord = {
      id: crypto.randomUUID(),
      shiftCode,
      normalizedShiftCode:
        canonicalizeSearchToken(shiftCode),
      title: request.proposedTitle,
      normalizedTitle: canonicalizeSearchToken(
        request.proposedTitle,
      ),
      subjectKind: "EMPLOYMENT_PROFILE",
      subjectEmploymentProfileId:
        request.targetEmploymentProfileId,
      subjectTalentId: null,
      subjectTalentGroupId: null,
      studioResourceIds: [
        ...request.proposedStudioResourceIds,
      ],
      status: "ACTIVE",
      shiftStartAt: request.proposedStartAt,
      shiftEndAt: request.proposedEndAt,
      description: request.proposedDescription,
      externalRef: request.proposedExternalRef,
      sourceType: "MANUAL",
      sourceRosterId: null,
      sourcePatternId: null,
      sourceExceptionId: null,
      sourceGenerationRunId: null,
      sourceRosterMonth: null,
      sourceDepartmentOrgUnitId: null,
      sourceRosterTargetType: null,
      sourceRosterTargetId: null,
      sourceRosterTargetMode: null,
      sourceMemberIdentityType: null,
      sourceRosterLocalDate: null,
      sourceRosterSlotKey: null,
      createdAt: now,
      updatedAt: now,
    };
    const created =
      await this.workShiftRepository.insert(
        record,
        session,
      );

    return created.id;
  }

  private async applyRescheduleShiftRequest(
    request: WorkScheduleRequestRecord,
    session: ClientSession,
  ): Promise<string> {
    if (
      request.targetWorkShiftId === null ||
      request.proposedStartAt === null ||
      request.proposedEndAt === null
    ) {
      throw new WorkScheduleValidationError(
        "RESCHEDULE_SHIFT approval requires target shift, proposed start, and proposed end",
      );
    }

    const current =
      await this.requireTargetEmploymentProfileShift(
        request.targetWorkShiftId,
        request.targetEmploymentProfileId,
        session,
      );
    assertActiveWorkShift(current, "RESCHEDULE_SHIFT");
    await this.assertNoOverlapConflicts({
      subject: toEmploymentProfileSubject(
        request.targetEmploymentProfileId,
      ),
      studioResourceIds: current.studioResourceIds,
      shiftStartAt: request.proposedStartAt,
      shiftEndAt: request.proposedEndAt,
      excludeWorkShiftId: current.id,
      session,
    });

    if (
      current.shiftStartAt === request.proposedStartAt &&
      current.shiftEndAt === request.proposedEndAt
    ) {
      return current.id;
    }

    const updated =
      await this.workShiftRepository.reschedule(
        {
          workShiftId: current.id,
          shiftStartAt: request.proposedStartAt,
          shiftEndAt: request.proposedEndAt,
          updatedAt: Date.now(),
        } satisfies RescheduleWorkShiftInput,
        session,
      );

    if (!updated) {
      throw new WorkScheduleConflictError(
        `Failed to reschedule work shift: ${current.id}`,
      );
    }

    return updated.id;
  }

  private async applyCancelShiftRequest(
    request: WorkScheduleRequestRecord,
    session: ClientSession,
  ): Promise<string> {
    if (request.targetWorkShiftId === null) {
      throw new WorkScheduleValidationError(
        "CANCEL_SHIFT approval requires target shift",
      );
    }

    const current =
      await this.requireTargetEmploymentProfileShift(
        request.targetWorkShiftId,
        request.targetEmploymentProfileId,
        session,
      );
    assertActiveWorkShift(current, "CANCEL_SHIFT");
    const updated =
      await this.workShiftRepository.transitionStatus(
        {
          workShiftId: current.id,
          fromStatuses: ["ACTIVE"],
          toStatus: "CANCELLED",
          updatedAt: Date.now(),
        } satisfies TransitionWorkShiftStatusInput,
        session,
      );

    if (!updated) {
      throw new WorkScheduleConflictError(
        `Failed to cancel work shift: ${current.id}`,
      );
    }

    return updated.id;
  }

  private assertApprovalMutationPermission(
    actor: Actor,
    requestType: WorkScheduleRequestType,
  ): void {
    if (requestType === "CREATE_SHIFT") {
      this.assertPermission(
        actor,
        Permission.WORK_SCHEDULE_CREATE,
      );
      return;
    }

    if (requestType === "RESCHEDULE_SHIFT") {
      this.assertPermission(
        actor,
        Permission.WORK_SCHEDULE_UPDATE,
      );
      return;
    }

    this.assertPermission(
      actor,
      Permission.WORK_SCHEDULE_MANAGE_LIFECYCLE,
    );
  }

  private async assertTeamManagerCanRequestForTarget(
    actor: Actor,
    actorProfile: WorkScheduleReferencedEmploymentProfile,
    targetEmploymentProfileId: string,
    session: ClientSession,
  ): Promise<void> {
    if (
      !PermissionGuard.hasWorkScheduleScopeGrant(
        actor,
        "team",
      )
    ) {
      throw new WorkSchedulePermissionScopeError(
        "Schedule requests require workSchedule.team scope",
      );
    }

    const managedIds =
      await this.resolveManagedEmploymentProfileIds(
        actorProfile.id,
        session,
      );

    if (managedIds.includes(targetEmploymentProfileId)) {
      return;
    }

    throw new WorkSchedulePermissionScopeError(
      "TEAM_MANAGER can request schedule changes only for active managed group members",
    );
  }

  private async resolveManagedEmploymentProfileIds(
    managerEmploymentProfileId: string,
    session?: ClientSession,
  ): Promise<readonly string[]> {
    const managedScope =
      await this.managedScopeReader.resolveManagedScopeByResponsibleEmploymentProfile(
        {
          responsibleEmploymentProfileId: managerEmploymentProfileId,
          asOf: Date.now(),
        },
        session,
      );
    const groupIds = [...new Set(managedScope.talentGroupIds)].sort();

    if (groupIds.length === 0) {
      return [];
    }

    const ids =
      await this.employmentProfileReadonlyAccess.listIdsByActiveTalentGroupIds(
        groupIds,
        session,
      );

    return [...new Set(ids)].sort();
  }

  private async resolveRequestVisibility(
    actor: Actor,
    session?: ClientSession,
  ): Promise<RequestVisibility> {
    if (
      PermissionGuard.hasWorkScheduleScopeGrant(
        actor,
        "global",
      )
    ) {
      return { unrestricted: true };
    }

    const actorProfile =
      await this.requireActorLinkedEmploymentProfile(
        actor.id,
        session,
      );
    const visibleTargetIds = new Set<string>();

    if (
      PermissionGuard.hasWorkScheduleScopeGrant(
        actor,
        "self",
      )
    ) {
      visibleTargetIds.add(actorProfile.id);
    }

    if (
      PermissionGuard.hasWorkScheduleScopeGrant(
        actor,
        "team",
      )
    ) {
      for (const id of await this.resolveManagedEmploymentProfileIds(
        actorProfile.id,
        session,
      )) {
        visibleTargetIds.add(id);
      }
    }

    if (
      PermissionGuard.hasWorkScheduleScopeGrant(
        actor,
        "department",
      )
    ) {
      const departmentIds =
        await this.employmentProfileReadonlyAccess.listIdsByOrgUnitId(
          actorProfile.orgUnitId,
          session,
        );
      for (const id of departmentIds) {
        visibleTargetIds.add(id);
      }
    }

    return {
      unrestricted: false,
      visibleTargetEmploymentProfileIds: [
        ...visibleTargetIds,
      ].sort(),
      visibleRequestedByUserId: actor.id,
    };
  }

  private async assertRequestVisible(
    actor: Actor,
    request: WorkScheduleRequestRecord,
    session?: ClientSession,
  ): Promise<void> {
    const visibility =
      await this.resolveRequestVisibility(actor, session);

    if (visibility.unrestricted) {
      return;
    }

    if (
      visibility.visibleRequestedByUserId ===
      request.requestedByUserId
    ) {
      return;
    }

    if (
      visibility.visibleTargetEmploymentProfileIds?.includes(
        request.targetEmploymentProfileId,
      )
    ) {
      return;
    }

    throw new WorkSchedulePermissionScopeError(
      "Actor cannot access this work schedule request",
    );
  }

  private async assertTargetEmploymentProfileEligible(
    employmentProfileId: string,
    session: ClientSession,
  ): Promise<WorkScheduleReferencedEmploymentProfile> {
    const employmentProfile =
      await this.employmentProfileReadonlyAccess.findById(
        employmentProfileId,
        session,
      );

    if (!employmentProfile) {
      throw new WorkScheduleInvalidSubjectReferenceError(
        `Employment profile target does not exist: ${employmentProfileId}`,
      );
    }

    if (employmentProfile.employmentStatus !== "ACTIVE") {
      throw new WorkScheduleInvalidSubjectReferenceError(
        `Employment profile target must be ACTIVE: ${employmentProfileId}`,
      );
    }

    return employmentProfile;
  }

  private async requireTargetEmploymentProfileShift(
    workShiftId: string,
    targetEmploymentProfileId: string,
    session: ClientSession,
  ): Promise<WorkShiftRecord> {
    const workShift =
      await this.workShiftRepository.findById(
        workShiftId,
        session,
      );

    if (!workShift) {
      throw new WorkScheduleNotFoundError(workShiftId);
    }

    if (
      workShift.subjectKind !== "EMPLOYMENT_PROFILE" ||
      workShift.subjectEmploymentProfileId !==
        targetEmploymentProfileId
    ) {
      throw new WorkScheduleInvalidSubjectReferenceError(
        "Request target shift must be linked to the target employment profile",
      );
    }

    return workShift;
  }

  private async assertStudioResourcesEligible(
    studioResourceIds: readonly string[],
    session: ClientSession,
  ): Promise<void> {
    for (const studioResourceId of studioResourceIds) {
      const studioResource =
        await this.studioResourceReadonlyAccess.findById(
          studioResourceId,
          session,
        );

      if (!studioResource) {
        throw new WorkScheduleInvalidResourceReferenceError(
          `Studio resource does not exist: ${studioResourceId}`,
        );
      }

      if (
        studioResource.operationalStatus !== "ACTIVE"
      ) {
        throw new WorkScheduleInvalidResourceReferenceError(
          `Studio resource must be ACTIVE: ${studioResourceId}`,
        );
      }
    }
  }

  private async assertNoOverlapConflicts(params: {
    readonly subject: WorkShiftSubjectReferenceInput;
    readonly studioResourceIds: readonly string[];
    readonly shiftStartAt: number;
    readonly shiftEndAt: number;
    readonly excludeWorkShiftId?: string;
    readonly session: ClientSession;
  }): Promise<void> {
    const subjectOverlap =
      await this.workShiftRepository.hasActiveOverlappingSubjectShift(
        {
          ...params.subject,
          shiftStartAt: params.shiftStartAt,
          shiftEndAt: params.shiftEndAt,
          excludeWorkShiftId:
            params.excludeWorkShiftId,
        },
        params.session,
      );

    if (subjectOverlap) {
      throw new WorkScheduleOverlapConflictError(
        "Subject overlap conflict detected with another ACTIVE work shift",
      );
    }

    const resourceOverlap =
      await this.workShiftRepository.hasActiveOverlappingResourceShift(
        {
          studioResourceIds:
            params.studioResourceIds,
          shiftStartAt: params.shiftStartAt,
          shiftEndAt: params.shiftEndAt,
          excludeWorkShiftId:
            params.excludeWorkShiftId,
        },
        params.session,
      );

    if (resourceOverlap) {
      throw new WorkScheduleOverlapConflictError(
        "Studio resource overlap conflict detected with another ACTIVE work shift",
      );
    }
  }

  private assertPermission(
    actor: Actor,
    permissionCode: Permission,
  ): PermissionContract {
    assertAdminActorType(actor);
    const permission =
      PermissionResolver.resolve(permissionCode);
    PermissionGuard.assert(actor, permission);

    return permission;
  }

  private assertGlobalScheduleAuthority(
    actor: Actor,
  ): void {
    if (
      PermissionGuard.hasWorkScheduleScopeGrant(
        actor,
        "global",
      )
    ) {
      return;
    }

    throw new WorkSchedulePermissionScopeError(
      "WorkSchedule request approval requires workSchedule.global scope",
    );
  }

  private async requireActorLinkedEmploymentProfile(
    actorId: string,
    session?: ClientSession,
  ): Promise<WorkScheduleReferencedEmploymentProfile> {
    const actorProfile =
      await this.employmentProfileReadonlyAccess.findByLinkedUserId(
        actorId,
        session,
      );

    if (!actorProfile) {
      throw new WorkSchedulePermissionScopeError(
        "Actor-linked employment profile is required for WorkSchedule request scope",
      );
    }

    return actorProfile;
  }

  private async requireRequest(
    requestId: string,
    session?: ClientSession,
  ): Promise<WorkScheduleRequestRecord> {
    const request =
      await this.requestRepository.findById(
        requestId,
        session,
      );

    if (!request) {
      throw new WorkScheduleRequestNotFoundError(
        requestId,
      );
    }

    return request;
  }

  private async toRequestView(
    record: WorkScheduleRequestRecord,
    session?: ClientSession,
  ): Promise<WorkScheduleRequestView> {
    const targetProfile =
      await this.employmentProfileReadonlyAccess.findById(
        record.targetEmploymentProfileId,
        session,
      );
    const targetWorkShiftRef =
      record.targetWorkShiftId === null
        ? null
        : await this.toWorkShiftRef(
            record.targetWorkShiftId,
            session,
          );
    const appliedWorkShiftRef =
      record.appliedWorkShiftId === null
        ? null
        : await this.toWorkShiftRef(
            record.appliedWorkShiftId,
            session,
          );

    return {
      ...record,
      targetEmploymentProfileRef:
        targetProfile?.ref ?? null,
      targetWorkShiftRef,
      appliedWorkShiftRef,
    };
  }

  private async toWorkShiftRef(
    workShiftId: string,
    session?: ClientSession,
  ): Promise<ReferenceSummary | null> {
    const workShift =
      await this.workShiftRepository.findById(
        workShiftId,
        session,
      );

    if (!workShift) {
      return null;
    }

    return {
      id: workShift.id,
      code: workShift.shiftCode,
      title: workShift.title,
      status: workShift.status,
    };
  }

  private async allocateGeneratedShiftCode(
    shiftStartAt: number,
    session: ClientSession,
  ): Promise<string> {
    const dateBucket =
      toUtcDateBucket(shiftStartAt);
    const sequence =
      await this.codeSequenceRepository.allocateNext(
        dateBucket,
        session,
      );

    return `WS-${dateBucket}-${String(sequence).padStart(4, "0")}`;
  }

  private async allocateGeneratedRequestCode(
    timestamp: number,
    session: ClientSession,
  ): Promise<string> {
    const monthBucket =
      toUtcMonthBucket(timestamp);
    const sequence =
      await this.codeSequenceRepository.allocateNextWorkScheduleRequestCode(
        monthBucket,
        session,
      );

    return `WSR-${monthBucket}-${String(sequence).padStart(6, "0")}`;
  }

  private async recordAudit(params: {
    readonly actor: Actor;
    readonly permission: PermissionContract;
    readonly requestId: string;
    readonly mutationType: AuthoritativeAdminMutationIdentity;
    readonly metadata: Readonly<Record<string, unknown>>;
    readonly session: ClientSession;
  }): Promise<void> {
    await this.audit.record(
      params.actor,
      params.permission,
      params.requestId,
      {
        mutationType: params.mutationType,
        targetId: params.requestId,
        targetType: "work-schedule-request",
        actorId: params.actor.id,
        ...params.metadata,
      },
      params.session,
    );
  }

  private async executeMutation<T>(
    actor: Actor,
    permission: PermissionContract,
    operation: AuthoritativeAdminMutationIdentity,
    metadata: Readonly<Record<string, unknown>>,
    fn: (session: ClientSession) => Promise<T>,
  ): Promise<T> {
    return this.mutationBridge.execute(
      {
        actor,
        traceId: getTraceIdOrThrow(),
        requiredPermission: permission,
        mutationIdentity: operation,
        mutationTargetDescriptor:
          buildMutationTargetDescriptor(metadata),
      },
      async (session) => fn(session),
    );
  }
}

function normalizeCreateRequestCommand(
  command: CreateWorkScheduleRequestCommand,
): NormalizedCreateRequestCommand {
  const requestType = normalizeRequestType(
    command.requestType,
  );
  const targetEmploymentProfileId =
    normalizeRequiredText(
      command.targetEmploymentProfileId,
      "targetEmploymentProfileId",
    );
  const targetWorkShiftId =
    normalizeOptionalNullableText(
      command.targetWorkShiftId,
      "targetWorkShiftId",
    ) ?? null;
  const reason = normalizeRequiredText(
    command.reason,
    "reason",
  );
  const proposedStartAt = normalizeOptionalTimestamp(
    command.proposedStartAt,
    "proposedStartAt",
  );
  const proposedEndAt = normalizeOptionalTimestamp(
    command.proposedEndAt,
    "proposedEndAt",
  );
  const proposedTitle =
    normalizeOptionalNullableText(
      command.proposedTitle,
      "proposedTitle",
    ) ?? null;

  if (requestType === "CREATE_SHIFT") {
    if (targetWorkShiftId !== null) {
      throw new WorkScheduleValidationError(
        "CREATE_SHIFT request must not include targetWorkShiftId",
      );
    }
    if (
      proposedStartAt === null ||
      proposedEndAt === null ||
      proposedTitle === null
    ) {
      throw new WorkScheduleValidationError(
        "CREATE_SHIFT request requires proposedTitle, proposedStartAt, and proposedEndAt",
      );
    }
  } else if (targetWorkShiftId === null) {
    throw new WorkScheduleValidationError(
      `${requestType} request requires targetWorkShiftId`,
    );
  }

  if (requestType === "RESCHEDULE_SHIFT") {
    if (
      proposedStartAt === null ||
      proposedEndAt === null
    ) {
      throw new WorkScheduleValidationError(
        "RESCHEDULE_SHIFT request requires proposedStartAt and proposedEndAt",
      );
    }
  }

  if (
    proposedStartAt !== null &&
    proposedEndAt !== null
  ) {
    assertValidShiftWindow(
      proposedStartAt,
      proposedEndAt,
    );
  }

  return {
    requestType,
    targetEmploymentProfileId,
    targetWorkShiftId,
    reason,
    proposedStartAt,
    proposedEndAt,
    proposedTitle,
    proposedStudioResourceIds:
      normalizeStudioResourceIds(
        command.proposedStudioResourceIds,
        "proposedStudioResourceIds",
      ),
    proposedDescription:
      normalizeOptionalNullableText(
        command.proposedDescription,
        "proposedDescription",
      ) ?? null,
    proposedExternalRef:
      normalizeOptionalNullableText(
        command.proposedExternalRef,
        "proposedExternalRef",
      ) ?? null,
  };
}

function normalizeListQuery(
  query: ListWorkScheduleRequestsQuery,
) {
  return {
    status: normalizeOptionalRequestStatus(query.status),
    requestType: normalizeOptionalRequestType(
      query.requestType,
    ),
    targetEmploymentProfileId:
      normalizeOptionalId(
        query.targetEmploymentProfileId,
        "targetEmploymentProfileId",
      ),
    targetWorkShiftId: normalizeOptionalId(
      query.targetWorkShiftId,
      "targetWorkShiftId",
    ),
    requestedByUserId: normalizeOptionalId(
      query.requestedByUserId,
      "requestedByUserId",
    ),
    limit: parseLimit(query.limit),
    cursor: parseOptionalCursor(query.cursor),
  };
}

function normalizeRequestType(
  value: unknown,
): WorkScheduleRequestType {
  if (typeof value !== "string") {
    throw new WorkScheduleValidationError(
      `requestType must be one of ${WORK_SCHEDULE_REQUEST_TYPES.join(", ")}`,
    );
  }

  const normalized = value.trim().toUpperCase();
  if (
    WORK_SCHEDULE_REQUEST_TYPES.includes(
      normalized as WorkScheduleRequestType,
    )
  ) {
    return normalized as WorkScheduleRequestType;
  }

  throw new WorkScheduleValidationError(
    `requestType must be one of ${WORK_SCHEDULE_REQUEST_TYPES.join(", ")}`,
  );
}

function normalizeOptionalRequestType(
  value: unknown,
): WorkScheduleRequestType | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  return normalizeRequestType(value);
}

function normalizeOptionalRequestStatus(
  value: unknown,
): WorkScheduleRequestStatus | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new WorkScheduleValidationError(
      `status must be one of ${WORK_SCHEDULE_REQUEST_STATUSES.join(", ")}`,
    );
  }

  const normalized = value.trim().toUpperCase();
  if (
    WORK_SCHEDULE_REQUEST_STATUSES.includes(
      normalized as WorkScheduleRequestStatus,
    )
  ) {
    return normalized as WorkScheduleRequestStatus;
  }

  throw new WorkScheduleValidationError(
    `status must be one of ${WORK_SCHEDULE_REQUEST_STATUSES.join(", ")}`,
  );
}

function normalizeRequiredText(
  value: unknown,
  field: string,
): string {
  if (typeof value !== "string") {
    throw new WorkScheduleValidationError(
      `${field} must be a string`,
    );
  }

  const normalized = value.trim();
  if (!normalized) {
    throw new WorkScheduleValidationError(
      `${field} is required`,
    );
  }

  return normalized;
}

function normalizeOptionalNullableText(
  value: unknown,
  field: string,
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  return normalizeRequiredText(value, field);
}

function normalizeOptionalId(
  value: unknown,
  field: string,
): string | undefined {
  return (
    normalizeOptionalNullableText(value, field) ??
    undefined
  );
}

function normalizeOptionalTimestamp(
  value: unknown,
  field: string,
): number | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (
    typeof value !== "number" ||
    !Number.isInteger(value)
  ) {
    throw new WorkScheduleValidationError(
      `${field} must be an integer timestamp`,
    );
  }

  return value;
}

function normalizeStudioResourceIds(
  value: unknown,
  field: string,
): readonly string[] {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new WorkScheduleValidationError(
      `${field} must be an array`,
    );
  }

  const ids = value.map((item, index) =>
    normalizeRequiredText(
      item,
      `${field}[${index}]`,
    ),
  );
  const distinct = new Set(ids);

  if (distinct.size !== ids.length) {
    throw new WorkScheduleValidationError(
      `${field} must not contain duplicate values`,
    );
  }

  return ids;
}

function parseLimit(value: unknown): number {
  if (value === undefined || value === null) {
    return DEFAULT_LIMIT;
  }

  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  if (!Number.isInteger(numeric) || numeric < 1) {
    throw new WorkScheduleValidationError(
      "limit must be a positive integer",
    );
  }

  return Math.min(numeric, MAX_LIMIT);
}

function parseOptionalCursor(
  value: unknown,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new WorkScheduleValidationError(
      "cursor must be a string",
    );
  }

  const normalized = value.trim();
  return normalized.length > 0
    ? normalized
    : undefined;
}

function assertValidShiftWindow(
  shiftStartAt: number,
  shiftEndAt: number,
): void {
  if (shiftEndAt <= shiftStartAt) {
    throw new WorkScheduleValidationError(
      "proposedEndAt must be strictly greater than proposedStartAt",
    );
  }
}

function assertPendingRequest(
  request: WorkScheduleRequestRecord,
): void {
  if (request.status === "PENDING") {
    return;
  }

  throw new WorkScheduleStateError(
    `Work schedule request ${request.id} cannot transition from ${request.status}`,
  );
}

function assertNotApplied(
  request: WorkScheduleRequestRecord,
): void {
  if (request.appliedWorkShiftId === null) {
    return;
  }

  throw new WorkScheduleStateError(
    `Work schedule request ${request.id} has already been applied`,
  );
}

function assertActiveWorkShift(
  workShift: WorkShiftRecord,
  operation: string,
): void {
  if (workShift.status === "ACTIVE") {
    return;
  }

  throw new WorkScheduleStateError(
    `${operation} approval requires target WorkShift status ACTIVE, received ${workShift.status}`,
  );
}

function toEmploymentProfileSubject(
  employmentProfileId: string,
): WorkShiftSubjectReferenceInput {
  return {
    subjectKind: "EMPLOYMENT_PROFILE",
    subjectEmploymentProfileId: employmentProfileId,
    subjectTalentId: null,
    subjectTalentGroupId: null,
  };
}

function canonicalizeSearchToken(
  value: string,
): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();
}

function toUtcDateBucket(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(
    2,
    "0",
  );
  const day = String(date.getUTCDate()).padStart(
    2,
    "0",
  );

  return `${year}${month}${day}`;
}

function toUtcMonthBucket(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(
    2,
    "0",
  );

  return `${year}${month}`;
}

function assertAdminActorType(actor: Actor): void {
  PermissionGuard.assertAdminActor(actor);
}

function buildMutationTargetDescriptor(
  metadata: Readonly<Record<string, unknown>>,
): string {
  const encoded = JSON.stringify(metadata);

  if (
    typeof encoded === "string" &&
    encoded.length > 2
  ) {
    return encoded;
  }

  return "target:unspecified";
}
