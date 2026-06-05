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
import { OrgUnitManagerAssignmentRepository } from "@modules/kpi/domain/org-unit-manager-assignment.repository";
import { TalentGroupManagerAssignmentRepository } from "@modules/kpi/domain/talent-group-manager-assignment.repository";
import { ReferenceSummary } from "@modules/reference-summary";
import {
  WorkScheduleConflictError,
  WorkScheduleInvalidResourceReferenceError,
  WorkScheduleInvalidSubjectReferenceError,
  WorkScheduleNotFoundError,
  WorkScheduleOverlapConflictError,
  WorkSchedulePermissionScopeError,
  WorkScheduleRequestBatchNotFoundError,
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
  WorkScheduleRequestBatchRepository,
  WorkShiftRepository,
  WorkShiftSubjectReferenceInput,
} from "@modules/work-schedule/domain/work-schedule.repository";
import { WorkScheduleStudioResourceReadonlyAccess } from "@modules/work-schedule/domain/work-schedule-studio-resource-readonly-access";
import {
  WORK_SCHEDULE_REQUEST_BATCH_STATUSES,
  WORK_SCHEDULE_REQUEST_TYPES,
  WorkScheduleRequestBatchListItemView,
  WorkScheduleRequestBatchRecord,
  WorkScheduleRequestBatchScopeSummary,
  WorkScheduleRequestBatchStatus,
  WorkScheduleRequestBatchView,
  WorkScheduleRequestLineCounts,
  WorkScheduleRequestLineRecord,
  WorkScheduleRequestLineStatus,
  WorkScheduleRequestLineView,
  WorkScheduleRequestType,
  WorkShiftRecord,
} from "@modules/work-schedule/domain/work-schedule.types";
import {
  CancelWorkScheduleRequestBatchCommand,
  CancelWorkScheduleRequestBatchLineCommand,
  DecideWorkScheduleRequestBatchLinesCommand,
  GetWorkScheduleRequestBatchDetailQuery,
  ListWorkScheduleRequestBatchesQuery,
  ListWorkScheduleRequestBatchesResult,
  SubmitWorkScheduleRequestBatchCommand,
  WorkScheduleRequestBatchMutationResult,
} from "@modules/work-schedule/shared/work-schedule.contracts";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_LINES_PER_BATCH = 50;
const TIMEZONE = "Asia/Ho_Chi_Minh" as const;

interface NormalizedLineInput {
  readonly requestType: WorkScheduleRequestType;
  readonly memberEmploymentProfileId: string;
  readonly workShiftId: string | null;
  readonly requestedStartAt: number | null;
  readonly requestedEndAt: number | null;
  readonly timezone: typeof TIMEZONE;
  readonly title: string | null;
  readonly description: string | null;
  readonly externalRef: string | null;
  readonly reason: string;
}

interface NormalizedSubmitBatchCommand {
  readonly periodMonth: string;
  readonly clientToken: string;
  readonly note: string | null;
  readonly lines: readonly NormalizedLineInput[];
}

interface ManagedScopeResolution {
  readonly profiles: ReadonlyMap<string, WorkScheduleReferencedEmploymentProfile>;
  readonly orgUnitProfileIds: ReadonlySet<string>;
  readonly talentGroupProfileIds: ReadonlySet<string>;
}

export class WorkScheduleRequestBatchAdminService {
  constructor(
    private readonly batchRepository: WorkScheduleRequestBatchRepository,
    private readonly workShiftRepository: WorkShiftRepository,
    private readonly codeSequenceRepository: WorkScheduleCodeSequenceRepository,
    private readonly employmentProfileReadonlyAccess: WorkScheduleEmploymentProfileReadonlyAccess,
    private readonly studioResourceReadonlyAccess: WorkScheduleStudioResourceReadonlyAccess,
    private readonly talentGroupManagerAssignmentRepository: Pick<
      TalentGroupManagerAssignmentRepository,
      "listActiveAssignmentsByManagerEmploymentProfile"
    >,
    private readonly orgUnitManagerAssignmentRepository: Pick<
      OrgUnitManagerAssignmentRepository,
      "listActiveByManagerEmploymentProfileId"
    >,
    private readonly audit: AuditGuard,
    private readonly mutationBridge: AuthoritativeAdminMutationBridge,
    private readonly clock: () => number = Date.now,
  ) {}

  async submitManagerBatch(
    actor: Actor,
    command: SubmitWorkScheduleRequestBatchCommand,
  ): Promise<WorkScheduleRequestBatchMutationResult> {
    const permission = this.assertPermission(
      actor,
      Permission.WORK_SCHEDULE_READ,
    );
    const input = normalizeSubmitBatchCommand(command, this.clock());

    return this.executeMutation(
      actor,
      permission,
      "work-schedule.request.create",
      {
        periodMonth: input.periodMonth,
        lineCount: input.lines.length,
      },
      async (session) => {
        const managerProfile =
          await this.requireManagerReadyEmploymentProfile(actor.id, session);
        const existing =
          await this.batchRepository.findBatchByClientToken(
            managerProfile.id,
            input.clientToken,
            session,
          );

        if (existing) {
          return this.toBatchView(existing, session);
        }

        const scope = await this.resolveManagedScope(managerProfile.id, session);
        if (scope.profiles.size === 0) {
          throw new WorkSchedulePermissionScopeError(
            "Active OrgUnit or TalentGroup manager assignment is required",
          );
        }

        assertNoDuplicatePayloadLines(input.lines);
        const lines: WorkScheduleRequestLineRecord[] = [];
        const now = this.clock();
        const batchId = crypto.randomUUID();
        const batchCode = await this.allocateGeneratedBatchCode(now, session);

        for (const [index, line] of input.lines.entries()) {
          await this.assertLineSubmitEligible(
            line,
            input.periodMonth,
            managerProfile.id,
            scope,
            session,
          );
          lines.push({
            id: crypto.randomUUID(),
            batchId,
            lineNo: index + 1,
            requestType: line.requestType,
            memberEmploymentProfileId: line.memberEmploymentProfileId,
            workShiftId: line.workShiftId,
            requestedStartAt: line.requestedStartAt,
            requestedEndAt: line.requestedEndAt,
            timezone: line.timezone,
            title: line.title,
            description:
              line.requestType === "CREATE_SHIFT" &&
              line.description === null &&
              line.externalRef === null
                ? line.reason
                : line.description,
            externalRef: line.externalRef,
            reason: line.reason,
            status: "PENDING",
            approvalNote: null,
            rejectionReason: null,
            cancellationReason: null,
            failureReason: null,
            appliedWorkShiftId: null,
            createdAt: now,
            updatedAt: now,
            approvedAt: null,
            approvedByActorId: null,
            rejectedAt: null,
            rejectedByActorId: null,
            cancelledAt: null,
            cancelledByActorId: null,
            failedAt: null,
            failedByActorId: null,
            submittedByEmploymentProfileId: managerProfile.id,
            periodMonth: input.periodMonth,
          });
        }

        const batch: WorkScheduleRequestBatchRecord = {
          id: batchId,
          batchCode,
          submittedByActorId: actor.id,
          submittedByEmploymentProfileId: managerProfile.id,
          periodMonth: input.periodMonth,
          scopeSummary: deriveScopeSummary(lines, scope),
          status: "PENDING",
          note: input.note,
          lineCounts: deriveLineCounts(lines),
          clientToken: input.clientToken,
          submittedAt: now,
          cancelledAt: null,
          resolvedAt: null,
          createdAt: now,
          updatedAt: now,
        };

        await this.batchRepository.insertBatchWithLines(
          batch,
          lines,
          session,
        );

        await this.recordAudit({
          actor,
          permission,
          targetId: batch.id,
          targetType: "work-schedule-request-batch",
          mutationType: "work-schedule.request.create",
          metadata: {
            batchCode: batch.batchCode,
            periodMonth: batch.periodMonth,
            lineCount: lines.length,
          },
          session,
        });

        return this.toBatchView(batch, session);
      },
    );
  }

  async listManagerBatches(
    actor: Actor,
    query: ListWorkScheduleRequestBatchesQuery,
  ): Promise<ListWorkScheduleRequestBatchesResult> {
    this.assertPermission(actor, Permission.WORK_SCHEDULE_READ);
    const managerProfile =
      await this.requireManagerReadyEmploymentProfile(actor.id);
    const normalized = normalizeListBatchesQuery(query);
    const result = await this.batchRepository.listBatches({
      ...normalized,
      submittedByEmploymentProfileId: managerProfile.id,
    });

    return {
      items: await Promise.all(
        result.items.map((item) => this.toBatchListItemView(item)),
      ),
      nextCursor: result.nextCursor,
    };
  }

  async getManagerBatchDetail(
    actor: Actor,
    query: GetWorkScheduleRequestBatchDetailQuery,
  ): Promise<WorkScheduleRequestBatchView> {
    this.assertPermission(actor, Permission.WORK_SCHEDULE_READ);
    const managerProfile =
      await this.requireManagerReadyEmploymentProfile(actor.id);
    const batch = await this.requireBatch(query.batchId);
    if (batch.submittedByEmploymentProfileId !== managerProfile.id) {
      throw new WorkSchedulePermissionScopeError(
        "Manager can access only own WorkSchedule request batches",
      );
    }
    return this.toBatchView(batch);
  }

  async cancelManagerBatch(
    actor: Actor,
    command: CancelWorkScheduleRequestBatchCommand,
  ): Promise<WorkScheduleRequestBatchMutationResult> {
    const permission = this.assertPermission(
      actor,
      Permission.WORK_SCHEDULE_READ,
    );
    const reason = normalizeReason(command.cancellationReason, "cancellationReason");
    const managerProfile =
      await this.requireManagerReadyEmploymentProfile(actor.id);

    return this.executeMutation(
      actor,
      permission,
      "work-schedule.request.cancel",
      { batchId: command.batchId },
      async (session) => {
        const batch = await this.requireBatch(command.batchId, session);
        if (batch.submittedByEmploymentProfileId !== managerProfile.id) {
          throw new WorkSchedulePermissionScopeError(
            "Manager can cancel only own WorkSchedule request batches",
          );
        }
        const lines = await this.batchRepository.listLinesByBatchId(
          batch.id,
          session,
        );
        for (const line of lines) {
          assertPendingLine(line);
        }
        const now = this.clock();
        for (const line of lines) {
          await this.transitionLineOrThrow(
            {
              batchId: batch.id,
              lineId: line.id,
              fromStatus: "PENDING",
              toStatus: "CANCELLED",
              updatedAt: now,
              cancellationReason: reason,
              cancelledAt: now,
              cancelledByActorId: actor.id,
            },
            session,
          );
        }

        const updated = await this.updateDerivedBatchState(batch.id, session);
        await this.recordAudit({
          actor,
          permission,
          targetId: batch.id,
          targetType: "work-schedule-request-batch",
          mutationType: "work-schedule.request.cancel",
          metadata: { batchCode: batch.batchCode, cancellationReason: reason },
          session,
        });
        return this.toBatchView(updated, session);
      },
    );
  }

  async cancelManagerLine(
    actor: Actor,
    command: CancelWorkScheduleRequestBatchLineCommand,
  ): Promise<WorkScheduleRequestBatchMutationResult> {
    const permission = this.assertPermission(
      actor,
      Permission.WORK_SCHEDULE_READ,
    );
    const reason = normalizeReason(command.cancellationReason, "cancellationReason");
    const managerProfile =
      await this.requireManagerReadyEmploymentProfile(actor.id);

    return this.executeMutation(
      actor,
      permission,
      "work-schedule.request.cancel",
      { batchId: command.batchId, lineId: command.lineId },
      async (session) => {
        const batch = await this.requireBatch(command.batchId, session);
        if (batch.submittedByEmploymentProfileId !== managerProfile.id) {
          throw new WorkSchedulePermissionScopeError(
            "Manager can cancel only own WorkSchedule request lines",
          );
        }
        const line = await this.requireLine(batch.id, command.lineId, session);
        assertPendingLine(line);
        const now = this.clock();
        await this.transitionLineOrThrow(
          {
            batchId: batch.id,
            lineId: line.id,
            fromStatus: "PENDING",
            toStatus: "CANCELLED",
            updatedAt: now,
            cancellationReason: reason,
            cancelledAt: now,
            cancelledByActorId: actor.id,
          },
          session,
        );
        const updated = await this.updateDerivedBatchState(batch.id, session);
        await this.recordAudit({
          actor,
          permission,
          targetId: line.id,
          targetType: "work-schedule-request-line",
          mutationType: "work-schedule.request.cancel",
          metadata: { batchCode: batch.batchCode, lineNo: line.lineNo },
          session,
        });
        return this.toBatchView(updated, session);
      },
    );
  }

  async listAdminBatches(
    actor: Actor,
    query: ListWorkScheduleRequestBatchesQuery,
  ): Promise<ListWorkScheduleRequestBatchesResult> {
    this.assertPermission(actor, Permission.WORK_SCHEDULE_READ);
    this.assertGlobalScheduleAuthority(actor);
    const result = await this.batchRepository.listBatches(
      normalizeListBatchesQuery(query),
    );

    return {
      items: await Promise.all(
        result.items.map((item) => this.toBatchListItemView(item)),
      ),
      nextCursor: result.nextCursor,
    };
  }

  async getAdminBatchDetail(
    actor: Actor,
    query: GetWorkScheduleRequestBatchDetailQuery,
  ): Promise<WorkScheduleRequestBatchView> {
    this.assertPermission(actor, Permission.WORK_SCHEDULE_READ);
    this.assertGlobalScheduleAuthority(actor);
    return this.toBatchView(await this.requireBatch(query.batchId));
  }

  async approveAdminLines(
    actor: Actor,
    command: DecideWorkScheduleRequestBatchLinesCommand,
  ): Promise<WorkScheduleRequestBatchMutationResult> {
    const note =
      normalizeOptionalNullableText(command.approvalNote, "approvalNote") ?? null;
    const lineIds = normalizeLineIds(command.lineIds);
    let latest: WorkScheduleRequestBatchRecord | null = null;

    for (const lineId of lineIds) {
      latest = await this.approveOneLine(actor, command.batchId, lineId, note);
    }

    return this.toBatchView(
      latest ?? (await this.requireBatch(command.batchId)),
    );
  }

  async rejectAdminLines(
    actor: Actor,
    command: DecideWorkScheduleRequestBatchLinesCommand,
  ): Promise<WorkScheduleRequestBatchMutationResult> {
    const permission = this.assertPermission(actor, Permission.WORK_SCHEDULE_UPDATE);
    this.assertGlobalScheduleAuthority(actor);
    const reason = normalizeReason(command.rejectionReason, "rejectionReason");
    const lineIds = normalizeLineIds(command.lineIds);

    return this.executeLineDecision(
      actor,
      permission,
      "work-schedule.request.reject",
      command.batchId,
      lineIds,
      async (batch, line, session) => {
        const now = this.clock();
        await this.transitionLineOrThrow(
          {
            batchId: batch.id,
            lineId: line.id,
            fromStatus: "PENDING",
            toStatus: "REJECTED",
            updatedAt: now,
            rejectionReason: reason,
            rejectedAt: now,
            rejectedByActorId: actor.id,
          },
          session,
        );
      },
    );
  }

  async cancelAdminLines(
    actor: Actor,
    command: DecideWorkScheduleRequestBatchLinesCommand,
  ): Promise<WorkScheduleRequestBatchMutationResult> {
    const permission = this.assertPermission(actor, Permission.WORK_SCHEDULE_UPDATE);
    this.assertGlobalScheduleAuthority(actor);
    const reason = normalizeReason(command.cancellationReason, "cancellationReason");
    const lineIds = normalizeLineIds(command.lineIds);

    return this.executeLineDecision(
      actor,
      permission,
      "work-schedule.request.cancel",
      command.batchId,
      lineIds,
      async (batch, line, session) => {
        const now = this.clock();
        await this.transitionLineOrThrow(
          {
            batchId: batch.id,
            lineId: line.id,
            fromStatus: "PENDING",
            toStatus: "CANCELLED",
            updatedAt: now,
            cancellationReason: reason,
            cancelledAt: now,
            cancelledByActorId: actor.id,
          },
          session,
        );
      },
    );
  }

  private async approveOneLine(
    actor: Actor,
    batchId: string,
    lineId: string,
    approvalNote: string | null,
  ): Promise<WorkScheduleRequestBatchRecord> {
    const batch = await this.requireBatch(batchId);
    const line = await this.requireLine(batch.id, lineId);
    const permission = this.assertPermission(
      actor,
      Permission.WORK_SCHEDULE_UPDATE,
    );
    this.assertApprovalMutationPermission(actor, line.requestType);
    this.assertGlobalScheduleAuthority(actor);

    try {
      return await this.executeMutation(
        actor,
        permission,
        "work-schedule.request.approve",
        { batchId, lineId },
        async (session) => {
          const currentBatch = await this.requireBatch(batchId, session);
          assertBatchNotCancelled(currentBatch);
          const currentLine = await this.requireLine(batchId, lineId, session);
          assertPendingLine(currentLine);
          const appliedWorkShiftId = await this.applyApprovedLine(
            currentLine,
            session,
          );
          const now = this.clock();
          await this.transitionLineOrThrow(
            {
              batchId,
              lineId,
              fromStatus: "PENDING",
              toStatus: "APPROVED",
              updatedAt: now,
              approvalNote,
              approvedAt: now,
              approvedByActorId: actor.id,
              appliedWorkShiftId,
            },
            session,
          );
          const updated = await this.updateDerivedBatchState(batchId, session);
          await this.recordAudit({
            actor,
            permission,
            targetId: lineId,
            targetType: "work-schedule-request-line",
            mutationType: "work-schedule.request.approve",
            metadata: {
              batchCode: currentBatch.batchCode,
              lineNo: currentLine.lineNo,
              requestType: currentLine.requestType,
              appliedWorkShiftId,
            },
            session,
          });
          return updated;
        },
      );
    } catch (error) {
      if (!isApprovalApplyFailure(error)) {
        throw error;
      }

      return this.markLineFailedToApply(
        actor,
        permission,
        batchId,
        lineId,
        safeFailureReason(error),
      );
    }
  }

  private async executeLineDecision(
    actor: Actor,
    permission: PermissionContract,
    operation: AuthoritativeAdminMutationIdentity,
    batchId: string,
    lineIds: readonly string[],
    decide: (
      batch: WorkScheduleRequestBatchRecord,
      line: WorkScheduleRequestLineRecord,
      session: ClientSession,
    ) => Promise<void>,
  ): Promise<WorkScheduleRequestBatchMutationResult> {
    let latest: WorkScheduleRequestBatchRecord | null = null;

    for (const lineId of lineIds) {
      latest = await this.executeMutation(
        actor,
        permission,
        operation,
        { batchId, lineId },
        async (session) => {
          const batch = await this.requireBatch(batchId, session);
          assertBatchNotCancelled(batch);
          const line = await this.requireLine(batch.id, lineId, session);
          assertPendingLine(line);
          await decide(batch, line, session);
          const updated = await this.updateDerivedBatchState(batch.id, session);
          await this.recordAudit({
            actor,
            permission,
            targetId: line.id,
            targetType: "work-schedule-request-line",
            mutationType: operation,
            metadata: {
              batchCode: batch.batchCode,
              lineNo: line.lineNo,
              requestType: line.requestType,
            },
            session,
          });
          return updated;
        },
      );
    }

    return this.toBatchView(latest ?? (await this.requireBatch(batchId)));
  }

  private async markLineFailedToApply(
    actor: Actor,
    permission: PermissionContract,
    batchId: string,
    lineId: string,
    failureReason: string,
  ): Promise<WorkScheduleRequestBatchRecord> {
    return this.executeMutation(
      actor,
      permission,
      "work-schedule.request.approve",
      { batchId, lineId, failedToApply: true },
      async (session) => {
        const batch = await this.requireBatch(batchId, session);
        assertBatchNotCancelled(batch);
        const line = await this.requireLine(batch.id, lineId, session);
        assertPendingLine(line);
        const now = this.clock();
        await this.transitionLineOrThrow(
          {
            batchId,
            lineId,
            fromStatus: "PENDING",
            toStatus: "FAILED_TO_APPLY",
            updatedAt: now,
            failureReason,
            failedAt: now,
            failedByActorId: actor.id,
          },
          session,
        );
        const updated = await this.updateDerivedBatchState(batch.id, session);
        await this.recordAudit({
          actor,
          permission,
          targetId: line.id,
          targetType: "work-schedule-request-line",
          mutationType: "work-schedule.request.approve",
          metadata: {
            batchCode: batch.batchCode,
            lineNo: line.lineNo,
            failedToApply: true,
            failureReason,
          },
          session,
        });
        return updated;
      },
    );
  }

  private async applyApprovedLine(
    line: WorkScheduleRequestLineRecord,
    session: ClientSession,
  ): Promise<string> {
    await this.assertTargetEmploymentProfileEligible(
      line.memberEmploymentProfileId,
      session,
    );

    if (line.requestType === "CREATE_SHIFT") {
      return this.applyCreateShiftLine(line, session);
    }
    if (line.requestType === "RESCHEDULE_SHIFT") {
      return this.applyRescheduleShiftLine(line, session);
    }
    return this.applyCancelShiftLine(line, session);
  }

  private async applyCreateShiftLine(
    line: WorkScheduleRequestLineRecord,
    session: ClientSession,
  ): Promise<string> {
    if (
      line.requestedStartAt === null ||
      line.requestedEndAt === null ||
      line.title === null
    ) {
      throw new WorkScheduleValidationError(
        "CREATE_SHIFT approval requires title, start, and end",
      );
    }
    await this.assertNoOverlapConflicts({
      subject: toEmploymentProfileSubject(line.memberEmploymentProfileId),
      studioResourceIds: [],
      shiftStartAt: line.requestedStartAt,
      shiftEndAt: line.requestedEndAt,
      session,
    });

    const now = this.clock();
    const shiftCode = await this.allocateGeneratedShiftCode(
      line.requestedStartAt,
      session,
    );
    const created = await this.workShiftRepository.insert(
      {
        id: crypto.randomUUID(),
        shiftCode,
        normalizedShiftCode: canonicalizeSearchToken(shiftCode),
        title: line.title,
        normalizedTitle: canonicalizeSearchToken(line.title),
        subjectKind: "EMPLOYMENT_PROFILE",
        subjectEmploymentProfileId: line.memberEmploymentProfileId,
        subjectTalentId: null,
        subjectTalentGroupId: null,
        studioResourceIds: [],
        status: "ACTIVE",
        shiftStartAt: line.requestedStartAt,
        shiftEndAt: line.requestedEndAt,
        description: line.description,
        externalRef: line.externalRef,
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
      },
      session,
    );

    return created.id;
  }

  private async applyRescheduleShiftLine(
    line: WorkScheduleRequestLineRecord,
    session: ClientSession,
  ): Promise<string> {
    if (
      line.workShiftId === null ||
      line.requestedStartAt === null ||
      line.requestedEndAt === null
    ) {
      throw new WorkScheduleValidationError(
        "RESCHEDULE_SHIFT approval requires target shift, start, and end",
      );
    }
    const current = await this.requireTargetEmploymentProfileShift(
      line.workShiftId,
      line.memberEmploymentProfileId,
      session,
    );
    assertActiveWorkShift(current, "RESCHEDULE_SHIFT");
    await this.assertNoOverlapConflicts({
      subject: toEmploymentProfileSubject(line.memberEmploymentProfileId),
      studioResourceIds: current.studioResourceIds,
      shiftStartAt: line.requestedStartAt,
      shiftEndAt: line.requestedEndAt,
      excludeWorkShiftId: current.id,
      session,
    });

    if (
      current.shiftStartAt === line.requestedStartAt &&
      current.shiftEndAt === line.requestedEndAt
    ) {
      return current.id;
    }

    const updated = await this.workShiftRepository.reschedule(
      {
        workShiftId: current.id,
        shiftStartAt: line.requestedStartAt,
        shiftEndAt: line.requestedEndAt,
        updatedAt: this.clock(),
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

  private async applyCancelShiftLine(
    line: WorkScheduleRequestLineRecord,
    session: ClientSession,
  ): Promise<string> {
    if (line.workShiftId === null) {
      throw new WorkScheduleValidationError(
        "CANCEL_SHIFT approval requires target shift",
      );
    }
    const current = await this.requireTargetEmploymentProfileShift(
      line.workShiftId,
      line.memberEmploymentProfileId,
      session,
    );
    assertActiveWorkShift(current, "CANCEL_SHIFT");
    const updated = await this.workShiftRepository.transitionStatus(
      {
        workShiftId: current.id,
        fromStatuses: ["ACTIVE"],
        toStatus: "CANCELLED",
        updatedAt: this.clock(),
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

  private async assertLineSubmitEligible(
    line: NormalizedLineInput,
    periodMonth: string,
    submitterEmploymentProfileId: string,
    scope: ManagedScopeResolution,
    session: ClientSession,
  ): Promise<void> {
    if (!scope.profiles.has(line.memberEmploymentProfileId)) {
      throw new WorkSchedulePermissionScopeError(
        "Manager can submit WorkSchedule request lines only for assigned exact OrgUnit or TalentGroup members",
      );
    }

    await this.assertTargetEmploymentProfileEligible(
      line.memberEmploymentProfileId,
      session,
    );

    const duplicate =
      await this.batchRepository.findPendingDuplicateLine(
        {
          submittedByEmploymentProfileId: submitterEmploymentProfileId,
          periodMonth,
          requestType: line.requestType,
          memberEmploymentProfileId: line.memberEmploymentProfileId,
          workShiftId: line.workShiftId,
          requestedStartAt: line.requestedStartAt,
          requestedEndAt: line.requestedEndAt,
        },
        session,
      );
    if (duplicate) {
      throw new WorkScheduleConflictError(
        "Duplicate pending WorkSchedule request line already exists",
      );
    }

    if (line.requestType === "CREATE_SHIFT") {
      assertMonthMatches(periodMonth, line.requestedStartAt);
      return;
    }

    const target = await this.requireTargetEmploymentProfileShift(
      line.workShiftId as string,
      line.memberEmploymentProfileId,
      session,
    );
    assertActiveWorkShift(target, line.requestType);

    if (line.requestType === "RESCHEDULE_SHIFT") {
      assertMonthMatches(periodMonth, line.requestedStartAt);
    } else {
      assertMonthMatches(periodMonth, target.shiftStartAt);
    }
  }

  private async resolveManagedScope(
    managerEmploymentProfileId: string,
    session?: ClientSession,
  ): Promise<ManagedScopeResolution> {
    const asOf = this.clock();
    const [orgUnitAssignments, talentGroupAssignments] = await Promise.all([
      this.orgUnitManagerAssignmentRepository.listActiveByManagerEmploymentProfileId(
        managerEmploymentProfileId,
        asOf,
        session,
      ),
      this.talentGroupManagerAssignmentRepository.listActiveAssignmentsByManagerEmploymentProfile(
        managerEmploymentProfileId,
        asOf,
        session,
      ),
    ]);
    const profiles = new Map<string, WorkScheduleReferencedEmploymentProfile>();
    const orgUnitProfileIds = new Set<string>();
    const talentGroupProfileIds = new Set<string>();

    for (const orgUnitId of [
      ...new Set(orgUnitAssignments.map((assignment) => assignment.orgUnitId)),
    ]) {
      const orgProfiles =
        await this.employmentProfileReadonlyAccess.listByOrgUnitId(
          orgUnitId,
          session,
        );
      for (const profile of orgProfiles) {
        if (profile.employmentStatus === "ACTIVE") {
          profiles.set(profile.id, profile);
          orgUnitProfileIds.add(profile.id);
        }
      }
    }

    for (const talentGroupId of [
      ...new Set(talentGroupAssignments.map((assignment) => assignment.groupId)),
    ]) {
      const resolutions =
        await this.employmentProfileReadonlyAccess.listTalentGroupMemberEmploymentProfileResolutions(
          talentGroupId,
          session,
        );
      for (const resolution of resolutions) {
        const profile = resolution.employmentProfile;
        if (
          resolution.membershipStatus === "ACTIVE" &&
          resolution.talentOperationalStatus === "ACTIVE" &&
          profile?.employmentStatus === "ACTIVE"
        ) {
          profiles.set(profile.id, profile);
          talentGroupProfileIds.add(profile.id);
        }
      }
    }

    return { profiles, orgUnitProfileIds, talentGroupProfileIds };
  }

  private async updateDerivedBatchState(
    batchId: string,
    session: ClientSession,
  ): Promise<WorkScheduleRequestBatchRecord> {
    const lines = await this.batchRepository.listLinesByBatchId(
      batchId,
      session,
    );
    const lineCounts = deriveLineCounts(lines);
    const status = deriveBatchStatus(lineCounts);
    const now = this.clock();
    const updated = await this.batchRepository.updateBatchDerived(
      {
        batchId,
        status,
        lineCounts,
        updatedAt: now,
        ...(status === "CANCELLED" ? { cancelledAt: now } : {}),
        ...(status !== "PENDING" && lineCounts.pending === 0
          ? { resolvedAt: now }
          : {}),
      },
      session,
    );

    if (!updated) {
      throw new WorkScheduleConflictError(
        `Failed to update WorkSchedule request batch: ${batchId}`,
      );
    }
    return updated;
  }

  private async transitionLineOrThrow(
    input: Parameters<WorkScheduleRequestBatchRepository["transitionLineStatus"]>[0],
    session: ClientSession,
  ): Promise<WorkScheduleRequestLineRecord> {
    const updated = await this.batchRepository.transitionLineStatus(
      input,
      session,
    );
    if (!updated) {
      throw new WorkScheduleConflictError(
        `Failed to transition WorkSchedule request line: ${input.lineId}`,
      );
    }
    return updated;
  }

  private async requireBatch(
    batchId: string,
    session?: ClientSession,
  ): Promise<WorkScheduleRequestBatchRecord> {
    const id = normalizeRequiredText(batchId, "batchId");
    const batch = await this.batchRepository.findBatchById(id, session);
    if (!batch) {
      throw new WorkScheduleRequestBatchNotFoundError(id);
    }
    return batch;
  }

  private async requireLine(
    batchId: string,
    lineId: string,
    session?: ClientSession,
  ): Promise<WorkScheduleRequestLineRecord> {
    const id = normalizeRequiredText(lineId, "lineId");
    const line = await this.batchRepository.findLineById(
      batchId,
      id,
      session,
    );
    if (!line) {
      throw new WorkScheduleRequestBatchNotFoundError(`${batchId}/${id}`);
    }
    return line;
  }

  private async toBatchListItemView(
    batch: WorkScheduleRequestBatchRecord,
    session?: ClientSession,
  ): Promise<WorkScheduleRequestBatchListItemView> {
    const submitter =
      await this.employmentProfileReadonlyAccess.findById(
        batch.submittedByEmploymentProfileId,
        session,
      );
    return {
      ...batch,
      submittedByEmploymentProfileRef: submitter?.ref ?? null,
    };
  }

  private async toBatchView(
    batch: WorkScheduleRequestBatchRecord,
    session?: ClientSession,
  ): Promise<WorkScheduleRequestBatchView> {
    const [submitter, lines] = await Promise.all([
      this.employmentProfileReadonlyAccess.findById(
        batch.submittedByEmploymentProfileId,
        session,
      ),
      this.batchRepository.listLinesByBatchId(batch.id, session),
    ]);
    return {
      ...batch,
      submittedByEmploymentProfileRef: submitter?.ref ?? null,
      lines: await Promise.all(
        lines.map((line) => this.toLineView(line, session)),
      ),
    };
  }

  private async toLineView(
    line: WorkScheduleRequestLineRecord,
    session?: ClientSession,
  ): Promise<WorkScheduleRequestLineView> {
    const [member, workShiftRef, appliedWorkShiftRef] = await Promise.all([
      this.employmentProfileReadonlyAccess.findById(
        line.memberEmploymentProfileId,
        session,
      ),
      line.workShiftId === null
        ? Promise.resolve(null)
        : this.toWorkShiftRef(line.workShiftId, session),
      line.appliedWorkShiftId === null
        ? Promise.resolve(null)
        : this.toWorkShiftRef(line.appliedWorkShiftId, session),
    ]);
    return {
      ...line,
      memberEmploymentProfileRef: member?.ref ?? null,
      workShiftRef,
      appliedWorkShiftRef,
    };
  }

  private async toWorkShiftRef(
    workShiftId: string,
    session?: ClientSession,
  ): Promise<ReferenceSummary | null> {
    const workShift = await this.workShiftRepository.findById(
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

  private async assertTargetEmploymentProfileEligible(
    employmentProfileId: string,
    session: ClientSession,
  ): Promise<WorkScheduleReferencedEmploymentProfile> {
    const profile = await this.employmentProfileReadonlyAccess.findById(
      employmentProfileId,
      session,
    );
    if (!profile) {
      throw new WorkScheduleInvalidSubjectReferenceError(
        `Employment profile target does not exist: ${employmentProfileId}`,
      );
    }
    if (profile.employmentStatus !== "ACTIVE") {
      throw new WorkScheduleInvalidSubjectReferenceError(
        `Employment profile target must be ACTIVE: ${employmentProfileId}`,
      );
    }
    return profile;
  }

  private async requireManagerReadyEmploymentProfile(
    actorId: string,
    session?: ClientSession,
  ): Promise<WorkScheduleReferencedEmploymentProfile> {
    const profile =
      await this.employmentProfileReadonlyAccess.findByLinkedUserId(
        actorId,
        session,
      );
    if (
      !profile ||
      (profile.employmentStatus !== "ACTIVE" &&
        profile.employmentStatus !== "ON_LEAVE")
    ) {
      throw new WorkSchedulePermissionScopeError(
        "Manager-ready linked Employment Profile is required",
      );
    }
    return profile;
  }

  private async requireTargetEmploymentProfileShift(
    workShiftId: string,
    employmentProfileId: string,
    session: ClientSession,
  ): Promise<WorkShiftRecord> {
    const workShift = await this.workShiftRepository.findById(
      workShiftId,
      session,
    );
    if (!workShift) {
      throw new WorkScheduleNotFoundError(workShiftId);
    }
    if (
      workShift.subjectKind !== "EMPLOYMENT_PROFILE" ||
      workShift.subjectEmploymentProfileId !== employmentProfileId
    ) {
      throw new WorkScheduleInvalidSubjectReferenceError(
        "Request target shift must be linked to the target employment profile",
      );
    }
    return workShift;
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
          excludeWorkShiftId: params.excludeWorkShiftId,
        },
        params.session,
      );
    if (subjectOverlap) {
      throw new WorkScheduleOverlapConflictError(
        "Subject overlap conflict detected with another ACTIVE work shift",
      );
    }

    if (params.studioResourceIds.length === 0) {
      return;
    }

    for (const studioResourceId of params.studioResourceIds) {
      const studioResource =
        await this.studioResourceReadonlyAccess.findById(
          studioResourceId,
          params.session,
        );
      if (!studioResource) {
        throw new WorkScheduleInvalidResourceReferenceError(
          `Studio resource does not exist: ${studioResourceId}`,
        );
      }
      if (studioResource.operationalStatus !== "ACTIVE") {
        throw new WorkScheduleInvalidResourceReferenceError(
          `Studio resource must be ACTIVE: ${studioResourceId}`,
        );
      }
    }

    const resourceOverlap =
      await this.workShiftRepository.hasActiveOverlappingResourceShift(
        {
          studioResourceIds: params.studioResourceIds,
          shiftStartAt: params.shiftStartAt,
          shiftEndAt: params.shiftEndAt,
          excludeWorkShiftId: params.excludeWorkShiftId,
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
    const permission = PermissionResolver.resolve(permissionCode);
    PermissionGuard.assert(actor, permission);
    return permission;
  }

  private assertGlobalScheduleAuthority(actor: Actor): void {
    if (PermissionGuard.hasWorkScheduleScopeGrant(actor, "global")) {
      return;
    }
    throw new WorkSchedulePermissionScopeError(
      "WorkSchedule request batch decisions require workSchedule.global scope",
    );
  }

  private assertApprovalMutationPermission(
    actor: Actor,
    requestType: WorkScheduleRequestType,
  ): void {
    this.assertPermission(actor, permissionCodeForApproval(requestType));
  }

  private async allocateGeneratedShiftCode(
    timestamp: number,
    session: ClientSession,
  ): Promise<string> {
    const dateBucket = toUtcDateBucket(timestamp);
    const sequence = await this.codeSequenceRepository.allocateNext(
      dateBucket,
      session,
    );
    return `WS-${dateBucket}-${String(sequence).padStart(4, "0")}`;
  }

  private async allocateGeneratedBatchCode(
    timestamp: number,
    session: ClientSession,
  ): Promise<string> {
    const monthBucket = toUtcMonthBucket(timestamp);
    const sequence =
      await this.codeSequenceRepository.allocateNextWorkScheduleRequestCode(
        monthBucket,
        session,
      );
    return `WSRB-${monthBucket}-${String(sequence).padStart(6, "0")}`;
  }

  private async recordAudit(params: {
    readonly actor: Actor;
    readonly permission: PermissionContract;
    readonly targetId: string;
    readonly targetType: string;
    readonly mutationType: AuthoritativeAdminMutationIdentity;
    readonly metadata: Readonly<Record<string, unknown>>;
    readonly session: ClientSession;
  }): Promise<void> {
    await this.audit.record(
      params.actor,
      params.permission,
      params.targetId,
      {
        mutationType: params.mutationType,
        targetId: params.targetId,
        targetType: params.targetType,
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
        mutationTargetDescriptor: buildMutationTargetDescriptor(metadata),
      },
      async (session) => fn(session),
    );
  }
}

function normalizeSubmitBatchCommand(
  command: SubmitWorkScheduleRequestBatchCommand,
  now: number,
): NormalizedSubmitBatchCommand {
  const periodMonth = normalizeRequiredMonth(command.periodMonth, "periodMonth");
  assertPeriodInPlanningWindow(periodMonth, now);
  const clientToken = normalizeRequiredText(
    command.clientToken ?? command.idempotencyKey,
    "clientToken",
  );
  if (clientToken.length < 8 || clientToken.length > 120) {
    throw new WorkScheduleValidationError(
      "clientToken must be 8-120 characters",
    );
  }
  if (!Array.isArray(command.lines) || command.lines.length === 0) {
    throw new WorkScheduleValidationError("lines must contain at least one line");
  }
  if (command.lines.length > MAX_LINES_PER_BATCH) {
    throw new WorkScheduleValidationError(
      `lines must contain at most ${MAX_LINES_PER_BATCH} lines`,
    );
  }

  return {
    periodMonth,
    clientToken,
    note: normalizeOptionalNullableText(command.note, "note") ?? null,
    lines: command.lines.map((line, index) =>
      normalizeLineInput(line, `lines[${index}]`),
    ),
  };
}

function normalizeLineInput(
  line: SubmitWorkScheduleRequestBatchCommand["lines"][number],
  field: string,
): NormalizedLineInput {
  if (typeof line !== "object" || line === null || Array.isArray(line)) {
    throw new WorkScheduleValidationError(`${field} must be a plain object`);
  }
  const requestType = normalizeRequestType(line.requestType);
  const memberEmploymentProfileId = normalizeRequiredText(
    line.memberEmploymentProfileId,
    `${field}.memberEmploymentProfileId`,
  );
  const workShiftId =
    normalizeOptionalNullableText(line.workShiftId, `${field}.workShiftId`) ??
    null;
  const requestedStartAt = normalizeOptionalTimestamp(
    line.requestedStartAt,
    `${field}.requestedStartAt`,
  );
  const requestedEndAt = normalizeOptionalTimestamp(
    line.requestedEndAt,
    `${field}.requestedEndAt`,
  );
  const reason = normalizeReason(line.reason, `${field}.reason`);
  const timezone =
    normalizeOptionalNullableText(line.timezone, `${field}.timezone`) ??
    TIMEZONE;

  if (timezone !== TIMEZONE) {
    throw new WorkScheduleValidationError(
      `${field}.timezone must be ${TIMEZONE}`,
    );
  }

  if (requestType === "CREATE_SHIFT") {
    if (workShiftId !== null) {
      throw new WorkScheduleValidationError(
        `${field}.workShiftId is not supported for CREATE_SHIFT`,
      );
    }
    if (requestedStartAt === null || requestedEndAt === null) {
      throw new WorkScheduleValidationError(
        `${field} CREATE_SHIFT requires requestedStartAt and requestedEndAt`,
      );
    }
  } else if (workShiftId === null) {
    throw new WorkScheduleValidationError(
      `${field} ${requestType} requires workShiftId`,
    );
  }

  if (
    requestType === "RESCHEDULE_SHIFT" &&
    (requestedStartAt === null || requestedEndAt === null)
  ) {
    throw new WorkScheduleValidationError(
      `${field} RESCHEDULE_SHIFT requires requestedStartAt and requestedEndAt`,
    );
  }
  if (requestType === "CANCEL_SHIFT") {
    if (requestedStartAt !== null || requestedEndAt !== null) {
      throw new WorkScheduleValidationError(
        `${field} CANCEL_SHIFT must not include requested time fields`,
      );
    }
  }
  if (requestedStartAt !== null && requestedEndAt !== null) {
    assertValidShiftWindow(requestedStartAt, requestedEndAt);
  }

  return {
    requestType,
    memberEmploymentProfileId,
    workShiftId,
    requestedStartAt,
    requestedEndAt,
    timezone,
    title:
      normalizeOptionalNullableText(line.title, `${field}.title`) ??
      (requestType === "CREATE_SHIFT" ? "Requested work shift" : null),
    description:
      normalizeOptionalNullableText(line.description, `${field}.description`) ??
      null,
    externalRef:
      normalizeOptionalNullableText(line.externalRef, `${field}.externalRef`) ??
      null,
    reason,
  };
}

function normalizeListBatchesQuery(
  query: ListWorkScheduleRequestBatchesQuery,
) {
  return {
    status: normalizeOptionalBatchStatus(query.status),
    periodMonth:
      query.periodMonth === undefined
        ? undefined
        : normalizeRequiredMonth(query.periodMonth, "periodMonth"),
    submittedByEmploymentProfileId:
      normalizeOptionalNullableText(
        query.submittedByEmploymentProfileId,
        "submittedByEmploymentProfileId",
      ) ?? undefined,
    limit: parseLimit(query.limit),
    cursor: parseOptionalCursor(query.cursor),
  };
}

function normalizeRequestType(value: unknown): WorkScheduleRequestType {
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

function normalizeOptionalBatchStatus(
  value: unknown,
): WorkScheduleRequestBatchStatus | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new WorkScheduleValidationError(
      `status must be one of ${WORK_SCHEDULE_REQUEST_BATCH_STATUSES.join(", ")}`,
    );
  }
  const normalized = value.trim().toUpperCase();
  if (
    WORK_SCHEDULE_REQUEST_BATCH_STATUSES.includes(
      normalized as WorkScheduleRequestBatchStatus,
    )
  ) {
    return normalized as WorkScheduleRequestBatchStatus;
  }
  throw new WorkScheduleValidationError(
    `status must be one of ${WORK_SCHEDULE_REQUEST_BATCH_STATUSES.join(", ")}`,
  );
}

function normalizeRequiredText(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new WorkScheduleValidationError(`${field} must be a string`);
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new WorkScheduleValidationError(`${field} is required`);
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

function normalizeReason(value: unknown, field: string): string {
  const reason = normalizeRequiredText(value, field);
  if (reason.length < 10 || reason.length > 1000) {
    throw new WorkScheduleValidationError(
      `${field} must be 10-1000 characters`,
    );
  }
  return reason;
}

function normalizeOptionalTimestamp(value: unknown, field: string): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new WorkScheduleValidationError(`${field} must be an integer timestamp`);
  }
  return value;
}

function normalizeRequiredMonth(value: unknown, field: string): string {
  const month = normalizeRequiredText(value, field);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new WorkScheduleValidationError(`${field} must use YYYY-MM`);
  }
  return month;
}

function normalizeLineIds(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new WorkScheduleValidationError("lineIds must contain at least one line id");
  }
  const ids = value.map((item, index) =>
    normalizeRequiredText(item, `lineIds[${index}]`),
  );
  if (new Set(ids).size !== ids.length) {
    throw new WorkScheduleValidationError("lineIds must not contain duplicates");
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
    throw new WorkScheduleValidationError("limit must be a positive integer");
  }
  return Math.min(numeric, MAX_LIMIT);
}

function parseOptionalCursor(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new WorkScheduleValidationError("cursor must be a string");
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function assertValidShiftWindow(startAt: number, endAt: number): void {
  if (endAt <= startAt) {
    throw new WorkScheduleValidationError(
      "requestedEndAt must be strictly greater than requestedStartAt",
    );
  }
}

function assertPeriodInPlanningWindow(periodMonth: string, now: number): void {
  const allowed = new Set([
    hcmMonthFromTimestamp(now),
    addMonths(hcmMonthFromTimestamp(now), 1),
    addMonths(hcmMonthFromTimestamp(now), 2),
  ]);
  if (!allowed.has(periodMonth)) {
    throw new WorkScheduleValidationError(
      "periodMonth must be current month or one of the next two months",
    );
  }
}

function assertMonthMatches(periodMonth: string, timestamp: number | null): void {
  if (timestamp === null || hcmMonthFromTimestamp(timestamp) !== periodMonth) {
    throw new WorkScheduleValidationError(
      "request line date must be within the batch periodMonth",
    );
  }
}

function deriveLineCounts(
  lines: readonly Pick<WorkScheduleRequestLineRecord, "status">[],
): WorkScheduleRequestLineCounts {
  return {
    total: lines.length,
    pending: lines.filter((line) => line.status === "PENDING").length,
    approved: lines.filter((line) => line.status === "APPROVED").length,
    rejected: lines.filter((line) => line.status === "REJECTED").length,
    cancelled: lines.filter((line) => line.status === "CANCELLED").length,
    failedToApply: lines.filter((line) => line.status === "FAILED_TO_APPLY").length,
  };
}

function deriveBatchStatus(
  counts: WorkScheduleRequestLineCounts,
): WorkScheduleRequestBatchStatus {
  if (counts.total > 0 && counts.cancelled === counts.total) {
    return "CANCELLED";
  }
  if (counts.total > 0 && counts.approved === counts.total) {
    return "APPROVED";
  }
  if (
    counts.total > 0 &&
    counts.pending === 0 &&
    counts.approved === 0 &&
    counts.rejected + counts.failedToApply === counts.total
  ) {
    return "REJECTED";
  }
  if (counts.approved > 0 && counts.approved < counts.total) {
    return "PARTIALLY_APPROVED";
  }
  return "PENDING";
}

function deriveScopeSummary(
  lines: readonly WorkScheduleRequestLineRecord[],
  scope: ManagedScopeResolution,
): WorkScheduleRequestBatchScopeSummary {
  let hasOrgUnit = false;
  let hasTalentGroup = false;
  for (const line of lines) {
    hasOrgUnit =
      hasOrgUnit || scope.orgUnitProfileIds.has(line.memberEmploymentProfileId);
    hasTalentGroup =
      hasTalentGroup ||
      scope.talentGroupProfileIds.has(line.memberEmploymentProfileId);
  }
  if (hasOrgUnit && hasTalentGroup) {
    return "MIXED";
  }
  return hasOrgUnit ? "ORG_UNIT" : "TALENT_GROUP";
}

async function assertNoDuplicatePayloadLines(
  lines: readonly NormalizedLineInput[],
): Promise<void> {
  const keys = lines.map((line) =>
    [
      line.requestType,
      line.memberEmploymentProfileId,
      line.workShiftId ?? "",
      line.requestedStartAt ?? "",
      line.requestedEndAt ?? "",
    ].join("|"),
  );
  if (new Set(keys).size !== keys.length) {
    throw new WorkScheduleValidationError(
      "lines must not contain duplicate request targets",
    );
  }
}

function assertPendingLine(line: WorkScheduleRequestLineRecord): void {
  if (line.status === "PENDING") {
    return;
  }
  throw new WorkScheduleStateError(
    `Work schedule request line ${line.id} cannot transition from ${line.status}`,
  );
}

function assertBatchNotCancelled(batch: WorkScheduleRequestBatchRecord): void {
  if (batch.status !== "CANCELLED") {
    return;
  }
  throw new WorkScheduleStateError(
    `Work schedule request batch ${batch.id} is CANCELLED`,
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

function permissionCodeForApproval(
  requestType: WorkScheduleRequestType,
): Permission {
  if (requestType === "CREATE_SHIFT") {
    return Permission.WORK_SCHEDULE_CREATE;
  }
  if (requestType === "RESCHEDULE_SHIFT") {
    return Permission.WORK_SCHEDULE_UPDATE;
  }
  return Permission.WORK_SCHEDULE_MANAGE_LIFECYCLE;
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

function isApprovalApplyFailure(error: unknown): boolean {
  return (
    error instanceof WorkScheduleValidationError ||
    error instanceof WorkScheduleInvalidSubjectReferenceError ||
    error instanceof WorkScheduleInvalidResourceReferenceError ||
    error instanceof WorkScheduleOverlapConflictError ||
    error instanceof WorkScheduleConflictError ||
    error instanceof WorkScheduleStateError ||
    error instanceof WorkScheduleNotFoundError
  );
}

function safeFailureReason(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.slice(0, 500);
  }
  return "Approval-time WorkSchedule revalidation failed";
}

function canonicalizeSearchToken(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

function hcmMonthFromTimestamp(timestamp: number): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
  });
  const parts = formatter.formatToParts(new Date(timestamp));
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return `${year}-${month}`;
}

function addMonths(month: string, amount: number): string {
  const [yearText, monthText] = month.split("-");
  const date = new Date(Date.UTC(Number(yearText), Number(monthText) - 1 + amount, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function toUtcDateBucket(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function toUtcMonthBucket(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}${month}`;
}

function assertAdminActorType(actor: Actor): void {
  if (actor.type === "admin") {
    return;
  }
  throw new SystemInvariantError(
    "PERMISSION_DENIED",
    `Work schedule request batch access requires actor.type admin, received ${actor.type}`,
  );
}

function buildMutationTargetDescriptor(
  metadata: Readonly<Record<string, unknown>>,
): string {
  const encoded = JSON.stringify(metadata);
  return typeof encoded === "string" && encoded.length > 2
    ? encoded
    : "target:unspecified";
}
