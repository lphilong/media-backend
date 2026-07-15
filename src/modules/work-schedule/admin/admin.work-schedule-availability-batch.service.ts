import crypto from "crypto";
import { ClientSession, MongoServerError } from "mongodb";
import { Actor } from "@core/actor/actor";
import { AuthoritativeAdminMutationBridge } from "@core/application/authoritative-admin-mutation.bridge";
import { AuthoritativeAdminMutationIdentity } from "@core/application/authoritative-admin-mutation.permission-map";
import { AuditGuard } from "@core/audit/audit.guard";
import { PermissionContract } from "@core/permission/permission.contract";
import { Permission } from "@core/permission/permission.enum";
import { PermissionGuard } from "@core/permission/permission.guard";
import { PermissionResolver } from "@core/permission/permission.resolver";
import { getTraceIdOrThrow } from "@core/trace/trace.context";
import { requireAdminObjectScopeAuthority } from "@modules/role/domain/admin-object-scope-authority";
import { StructuredScopeAuthorityService } from "@modules/role/domain/structured-scope-authority";
import { ReferenceSummary } from "@modules/reference-summary";
import { ResponsibilityManagedScopeReader } from "@modules/responsibility/domain/responsibility-managed-scope";
import {
  WorkScheduleAvailabilityBatchNotFoundError,
  WorkScheduleConflictError,
  WorkSchedulePermissionScopeError,
  WorkScheduleStateError,
  WorkScheduleValidationError,
} from "../domain/work-schedule.errors";
import { WorkScheduleCodeSequenceRepository } from "../domain/work-schedule-code-sequence.repository";
import {
  WorkScheduleEmploymentProfileReadonlyAccess,
  WorkScheduleReferencedEmploymentProfile,
} from "../domain/work-schedule-employment-profile-readonly-access";
import { WorkScheduleOrgUnitReadonlyAccess } from "../domain/work-schedule-org-unit-readonly-access";
import { WorkScheduleTalentGroupReadonlyAccess } from "../domain/work-schedule-talent-group-readonly-access";
import { MonthlyRosterTargetType } from "../domain/work-schedule.types";
import { WorkScheduleAvailabilityBatchRepository } from "../domain/work-schedule-availability.repository";
import {
  WORK_SCHEDULE_AVAILABILITY_BATCH_STATUSES,
  WORK_SCHEDULE_AVAILABILITY_TAXONOMY_CODES,
  WORK_SCHEDULE_AVAILABILITY_TYPES,
  WorkScheduleAvailabilityBatchListItemView,
  WorkScheduleAvailabilityBatchRecord,
  WorkScheduleAvailabilityBatchStatus,
  WorkScheduleAvailabilityBatchView,
  WorkScheduleAvailabilityLineCounts,
  WorkScheduleAvailabilityLineRecord,
  WorkScheduleAvailabilityLineView,
  WorkScheduleAvailabilityTaxonomyCode,
  WorkScheduleAvailabilityType,
} from "../domain/work-schedule-availability.types";
import {
  CancelWorkScheduleAvailabilityBatchCommand,
  CancelWorkScheduleAvailabilityLineCommand,
  DecideWorkScheduleAvailabilityLinesCommand,
  GetWorkScheduleAvailabilityBatchDetailQuery,
  ListWorkScheduleAvailabilityBatchesQuery,
  ListWorkScheduleAvailabilityBatchesResult,
  SubmitWorkScheduleAvailabilityBatchCommand,
  WorkScheduleAvailabilityBatchMutationResult,
} from "../shared/work-schedule-availability.contracts";
import {
  assertManagerWorkSchedulePermission,
  assertManagerWorkScheduleTarget,
  hasManagerWorkScheduleTargets,
  ManagerWorkScheduleTargetAuthority,
  resolveManagerWorkScheduleTargetAuthority,
} from "./manager-work-schedule-authority";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_LINES_PER_BATCH = 50;

interface NormalizedAvailabilityLine {
  readonly memberEmploymentProfileId: string;
  readonly availabilityType: WorkScheduleAvailabilityType;
  readonly taxonomyCode: WorkScheduleAvailabilityTaxonomyCode;
  readonly dateRangeStart: string;
  readonly dateRangeEnd: string;
  readonly preferredStartLocalTime: string | null;
  readonly preferredEndLocalTime: string | null;
  readonly reason: string;
}

interface NormalizedSubmitCommand {
  readonly periodMonth: string;
  readonly targetType: MonthlyRosterTargetType;
  readonly targetOrgUnitId: string | null;
  readonly targetTalentGroupId: string | null;
  readonly clientToken: string;
  readonly note: string | null;
  readonly lines: readonly NormalizedAvailabilityLine[];
}

interface TargetResolution {
  readonly targetRef: ReferenceSummary | null;
  readonly profiles: ReadonlyMap<
    string,
    WorkScheduleReferencedEmploymentProfile
  >;
}

export interface ListManagerAvailabilityTargetMembersQuery {
  readonly targetType?: string;
  readonly targetId?: string;
}

export interface ManagerAvailabilityTargetMembersView {
  readonly target: {
    readonly targetType: MonthlyRosterTargetType;
    readonly targetId: string;
    readonly targetMode: "EXACT_ONLY";
    readonly name: string;
    readonly displayName: string;
    readonly code?: string;
  };
  readonly members: readonly {
    readonly employmentProfileId: string;
    readonly displayName: string;
    readonly employeeCode?: string;
  }[];
  readonly totalMembers: number;
}

export class WorkScheduleAvailabilityBatchAdminService {
  constructor(
    private readonly repository: WorkScheduleAvailabilityBatchRepository,
    private readonly codeSequenceRepository: WorkScheduleCodeSequenceRepository,
    private readonly employmentProfileReadonlyAccess: WorkScheduleEmploymentProfileReadonlyAccess,
    private readonly orgUnitReadonlyAccess: WorkScheduleOrgUnitReadonlyAccess,
    private readonly talentGroupReadonlyAccess: WorkScheduleTalentGroupReadonlyAccess,
    private readonly managedScopeReader: ResponsibilityManagedScopeReader,
    private readonly audit: AuditGuard,
    private readonly mutationBridge: AuthoritativeAdminMutationBridge,
    private readonly structuredAuthority: StructuredScopeAuthorityService,
    private readonly clock: () => number = Date.now,
  ) {}

  async listManagerTargetMembers(
    actor: Actor,
    query: ListManagerAvailabilityTargetMembersQuery,
  ): Promise<ManagerAvailabilityTargetMembersView> {
    assertManagerWorkSchedulePermission(actor, Permission.WORK_SCHEDULE_READ);
    const targetType = normalizeTargetType(query.targetType);
    const targetId = normalizeRequiredText(query.targetId, "targetId");
    const manager = await this.requireManagerProfile(actor.id);
    const target = await this.resolveAssignedTarget(actor, manager.id, {
      targetType,
      targetOrgUnitId: targetType === "ORG_UNIT" ? targetId : null,
      targetTalentGroupId: targetType === "TALENT_GROUP" ? targetId : null,
    });
    const targetName =
      target.targetRef?.name ?? target.targetRef?.displayName ?? targetId;
    const members = [...target.profiles.values()]
      .map((profile) => ({
        employmentProfileId: profile.id,
        displayName:
          profile.ref?.displayName ?? profile.ref?.code ?? profile.id,
        ...(profile.ref?.code ? { employeeCode: profile.ref.code } : {}),
      }))
      .sort(
        (left, right) =>
          left.displayName.localeCompare(right.displayName) ||
          left.employmentProfileId.localeCompare(right.employmentProfileId),
      );

    return {
      target: {
        targetType,
        targetId,
        targetMode: "EXACT_ONLY",
        name: targetName,
        displayName: target.targetRef?.displayName ?? targetName,
        ...(target.targetRef?.code ? { code: target.targetRef.code } : {}),
      },
      members,
      totalMembers: members.length,
    };
  }

  async submitManagerBatch(
    actor: Actor,
    command: SubmitWorkScheduleAvailabilityBatchCommand,
  ): Promise<WorkScheduleAvailabilityBatchMutationResult> {
    const permission = assertManagerWorkSchedulePermission(
      actor,
      Permission.WORK_SCHEDULE_READ,
    );
    const input = normalizeSubmitCommand(command, this.clock());

    return this.executeMutation(
      actor,
      permission,
      "work-schedule.request.create",
      { periodMonth: input.periodMonth, lineCount: input.lines.length },
      async (session) => {
        const manager = await this.requireManagerProfile(actor.id, session);
        const target = await this.resolveAssignedTarget(
          actor,
          manager.id,
          input,
          session,
        );
        const existing = await this.repository.findBatchByClientToken(
          manager.id,
          input.clientToken,
          session,
        );
        if (existing) {
          return this.toBatchView(existing, session);
        }

        assertNoDuplicatePayloadLines(input.lines);

        const now = this.clock();
        const batchId = crypto.randomUUID();
        const lines: WorkScheduleAvailabilityLineRecord[] = [];
        for (const [index, line] of input.lines.entries()) {
          if (!target.profiles.has(line.memberEmploymentProfileId)) {
            throw new WorkSchedulePermissionScopeError(
              "Availability member must be an active member of the selected assigned target",
            );
          }
          const duplicateInput = {
            pendingDuplicateKey: createPendingDuplicateKey({
              submittedByEmploymentProfileId: manager.id,
              periodMonth: input.periodMonth,
              targetType: input.targetType,
              targetOrgUnitId: input.targetOrgUnitId,
              targetTalentGroupId: input.targetTalentGroupId,
              ...line,
            }),
            submittedByEmploymentProfileId: manager.id,
            periodMonth: input.periodMonth,
            targetType: input.targetType,
            targetOrgUnitId: input.targetOrgUnitId,
            targetTalentGroupId: input.targetTalentGroupId,
            ...line,
          };
          const duplicate = await this.repository.findPendingDuplicateLine(
            duplicateInput,
            session,
          );
          if (duplicate) {
            throw new WorkScheduleConflictError(
              "Duplicate pending WorkSchedule availability line already exists",
            );
          }
          lines.push({
            id: crypto.randomUUID(),
            batchId,
            lineNo: index + 1,
            pendingDuplicateKey: duplicateInput.pendingDuplicateKey,
            ...line,
            status: "PENDING",
            applyStatus:
              line.availabilityType === "OTHER_AVAILABILITY_NOTE"
                ? "ADVISORY_ONLY"
                : "NOT_APPLIED",
            policyEvaluationStatus: "NOT_EVALUATED",
            appliedRosterId: null,
            appliedRosterExceptionId: null,
            appliedRosterExceptionIds: [],
            appliedAt: null,
            appliedByActorId: null,
            adminDecisionNote: null,
            rejectionReason: null,
            cancellationReason: null,
            createdAt: now,
            updatedAt: now,
            approvedAt: null,
            approvedByActorId: null,
            rejectedAt: null,
            rejectedByActorId: null,
            cancelledAt: null,
            cancelledByActorId: null,
            submittedByEmploymentProfileId: manager.id,
            periodMonth: input.periodMonth,
            targetType: input.targetType,
            targetOrgUnitId: input.targetOrgUnitId,
            targetTalentGroupId: input.targetTalentGroupId,
          });
        }

        const batch: WorkScheduleAvailabilityBatchRecord = {
          id: batchId,
          availabilityBatchCode: await this.allocateBatchCode(now, session),
          submittedByActorId: actor.id,
          submittedByEmploymentProfileId: manager.id,
          periodMonth: input.periodMonth,
          targetType: input.targetType,
          targetMode: "EXACT_ONLY",
          targetOrgUnitId: input.targetOrgUnitId,
          targetTalentGroupId: input.targetTalentGroupId,
          targetRef: target.targetRef,
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

        try {
          await this.repository.insertBatchWithLines(batch, lines, session);
        } catch (error) {
          if (isPendingDuplicateKeyError(error)) {
            throw new WorkScheduleConflictError(
              "Duplicate pending WorkSchedule availability line already exists",
            );
          }
          throw error;
        }
        await this.recordAudit({
          actor,
          permission,
          targetId: batch.id,
          targetType: "work-schedule-availability-batch",
          mutationType: "work-schedule.request.create",
          metadata: {
            availabilityBatchCode: batch.availabilityBatchCode,
            periodMonth: batch.periodMonth,
            targetType: batch.targetType,
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
    query: ListWorkScheduleAvailabilityBatchesQuery,
  ): Promise<ListWorkScheduleAvailabilityBatchesResult> {
    assertManagerWorkSchedulePermission(actor, Permission.WORK_SCHEDULE_READ);
    const manager = await this.requireManagerProfile(actor.id);
    const authority = await this.resolveManagerAuthority(actor, manager.id);
    if (!hasManagerWorkScheduleTargets(authority)) {
      return { items: [], nextCursor: undefined };
    }
    const result = await this.repository.listBatches({
      ...normalizeListQuery(query),
      submittedByEmploymentProfileId: manager.id,
    });
    return {
      items: await Promise.all(
        result.items
          .filter((item) => this.isBatchAuthorized(authority, item))
          .map((item) => this.toListItem(item)),
      ),
      nextCursor: result.nextCursor,
    };
  }

  async getManagerBatchDetail(
    actor: Actor,
    query: GetWorkScheduleAvailabilityBatchDetailQuery,
  ): Promise<WorkScheduleAvailabilityBatchView> {
    assertManagerWorkSchedulePermission(actor, Permission.WORK_SCHEDULE_READ);
    const manager = await this.requireManagerProfile(actor.id);
    const authority = await this.resolveManagerAuthority(actor, manager.id);
    const batch = await this.requireBatch(query.batchId);
    this.assertBatchAuthorized(authority, batch);
    this.assertOwnedBy(batch, manager.id, "access");
    return this.toBatchView(batch);
  }

  async cancelManagerBatch(
    actor: Actor,
    command: CancelWorkScheduleAvailabilityBatchCommand,
  ): Promise<WorkScheduleAvailabilityBatchMutationResult> {
    const permission = assertManagerWorkSchedulePermission(
      actor,
      Permission.WORK_SCHEDULE_READ,
    );
    const reason = normalizeReason(
      command.cancellationReason,
      "cancellationReason",
    );
    const manager = await this.requireManagerProfile(actor.id);
    return this.executeMutation(
      actor,
      permission,
      "work-schedule.request.cancel",
      { batchId: command.batchId },
      async (session) => {
        const authority = await this.resolveManagerAuthority(
          actor,
          manager.id,
          session,
        );
        const batch = await this.requireBatch(command.batchId, session);
        this.assertBatchAuthorized(authority, batch);
        this.assertOwnedBy(batch, manager.id, "cancel");
        if (batch.status !== "PENDING") {
          throw new WorkScheduleStateError(
            `Availability batch ${batch.id} cannot be cancelled from ${batch.status}`,
          );
        }
        const lines = await this.repository.listLinesByBatchId(
          batch.id,
          session,
        );
        lines.forEach(assertPendingLine);
        const now = this.clock();
        for (const line of lines) {
          await this.transitionLine(
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
        const updated = await this.updateDerivedBatch(batch.id, session);
        await this.recordAudit({
          actor,
          permission,
          targetId: batch.id,
          targetType: "work-schedule-availability-batch",
          mutationType: "work-schedule.request.cancel",
          metadata: { cancellationReason: reason },
          session,
        });
        return this.toBatchView(updated, session);
      },
    );
  }

  async cancelManagerLine(
    actor: Actor,
    command: CancelWorkScheduleAvailabilityLineCommand,
  ): Promise<WorkScheduleAvailabilityBatchMutationResult> {
    const permission = assertManagerWorkSchedulePermission(
      actor,
      Permission.WORK_SCHEDULE_READ,
    );
    const reason = normalizeReason(
      command.cancellationReason,
      "cancellationReason",
    );
    const manager = await this.requireManagerProfile(actor.id);
    return this.executeMutation(
      actor,
      permission,
      "work-schedule.request.cancel",
      { batchId: command.batchId, lineId: command.lineId },
      async (session) => {
        const authority = await this.resolveManagerAuthority(
          actor,
          manager.id,
          session,
        );
        const batch = await this.requireBatch(command.batchId, session);
        this.assertBatchAuthorized(authority, batch);
        this.assertOwnedBy(batch, manager.id, "cancel");
        const line = await this.requireLine(batch.id, command.lineId, session);
        assertPendingLine(line);
        const now = this.clock();
        await this.transitionLine(
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
        const updated = await this.updateDerivedBatch(batch.id, session);
        await this.recordAudit({
          actor,
          permission,
          targetId: line.id,
          targetType: "work-schedule-availability-line",
          mutationType: "work-schedule.request.cancel",
          metadata: { lineNo: line.lineNo },
          session,
        });
        return this.toBatchView(updated, session);
      },
    );
  }

  async listAdminBatches(
    actor: Actor,
    query: ListWorkScheduleAvailabilityBatchesQuery,
  ): Promise<ListWorkScheduleAvailabilityBatchesResult> {
    this.assertPermission(actor, Permission.WORK_SCHEDULE_READ);
    this.assertGlobalAuthority(actor);
    const result = await this.repository.listBatches(normalizeListQuery(query));
    return {
      items: await Promise.all(
        result.items.map((item) => this.toListItem(item)),
      ),
      nextCursor: result.nextCursor,
    };
  }

  async getAdminBatchDetail(
    actor: Actor,
    query: GetWorkScheduleAvailabilityBatchDetailQuery,
  ): Promise<WorkScheduleAvailabilityBatchView> {
    this.assertPermission(actor, Permission.WORK_SCHEDULE_READ);
    const batch = await this.requireBatch(query.batchId);
    await this.assertAdminStructuredAuthorityForBatch(
      actor,
      Permission.WORK_SCHEDULE_READ,
      batch,
      "read WorkSchedule availability batch",
    );
    return this.toBatchView(batch);
  }

  async approveAdminLines(
    _actor: Actor,
    _command: DecideWorkScheduleAvailabilityLinesCommand,
  ): Promise<WorkScheduleAvailabilityBatchMutationResult> {
    throw new WorkScheduleValidationError(
      "Availability approval without atomic Monthly Roster application is prohibited; use applyAvailabilityLinesToMonthlyRoster",
    );
  }

  async rejectAdminLines(
    actor: Actor,
    command: DecideWorkScheduleAvailabilityLinesCommand,
  ): Promise<WorkScheduleAvailabilityBatchMutationResult> {
    normalizeReason(command.rejectionReason, "rejectionReason");
    return this.decideAdminLines(actor, command, "REJECTED");
  }

  async cancelAdminLines(
    actor: Actor,
    command: DecideWorkScheduleAvailabilityLinesCommand,
  ): Promise<WorkScheduleAvailabilityBatchMutationResult> {
    normalizeReason(command.cancellationReason, "cancellationReason");
    return this.decideAdminLines(actor, command, "CANCELLED");
  }

  private async decideAdminLines(
    actor: Actor,
    command: DecideWorkScheduleAvailabilityLinesCommand,
    status: "APPROVED" | "REJECTED" | "CANCELLED",
  ): Promise<WorkScheduleAvailabilityBatchMutationResult> {
    const permission = this.assertPermission(
      actor,
      Permission.WORK_SCHEDULE_UPDATE,
    );
    const lineIds = normalizeLineIds(command.lineIds);
    const note =
      normalizeOptionalText(command.adminDecisionNote, "adminDecisionNote") ??
      null;
    const rejectionReason =
      status === "REJECTED"
        ? normalizeReason(command.rejectionReason, "rejectionReason")
        : null;
    const cancellationReason =
      status === "CANCELLED"
        ? normalizeReason(command.cancellationReason, "cancellationReason")
        : null;
    const operation: AuthoritativeAdminMutationIdentity =
      status === "APPROVED"
        ? "work-schedule.request.approve"
        : status === "REJECTED"
          ? "work-schedule.request.reject"
          : "work-schedule.request.cancel";

    return this.executeMutation(
      actor,
      permission,
      operation,
      { batchId: command.batchId, lineCount: lineIds.length },
      async (session) => {
        const batch = await this.requireBatch(command.batchId, session);
        await this.assertAdminStructuredAuthorityForBatch(
          actor,
          Permission.WORK_SCHEDULE_UPDATE,
          batch,
          "decide WorkSchedule availability lines",
        );
        const now = this.clock();
        for (const lineId of lineIds) {
          const line = await this.requireLine(batch.id, lineId, session);
          assertPendingLine(line);
          await this.transitionLine(
            {
              batchId: batch.id,
              lineId,
              fromStatus: "PENDING",
              toStatus: status,
              updatedAt: now,
              adminDecisionNote: note,
              ...(status === "APPROVED"
                ? { approvedAt: now, approvedByActorId: actor.id }
                : {}),
              ...(status === "REJECTED"
                ? {
                    rejectionReason,
                    rejectedAt: now,
                    rejectedByActorId: actor.id,
                  }
                : {}),
              ...(status === "CANCELLED"
                ? {
                    cancellationReason,
                    cancelledAt: now,
                    cancelledByActorId: actor.id,
                  }
                : {}),
            },
            session,
          );
        }
        const updated = await this.updateDerivedBatch(batch.id, session);
        await this.recordAudit({
          actor,
          permission,
          targetId: batch.id,
          targetType: "work-schedule-availability-batch",
          mutationType: operation,
          metadata: { lineIds, decision: status },
          session,
        });
        return this.toBatchView(updated, session);
      },
    );
  }

  private async resolveAssignedTarget(
    actor: Actor,
    managerEmploymentProfileId: string,
    input: Pick<
      NormalizedSubmitCommand,
      "targetType" | "targetOrgUnitId" | "targetTalentGroupId"
    >,
    session?: ClientSession,
  ): Promise<TargetResolution> {
    const authority = await this.resolveManagerAuthority(
      actor,
      managerEmploymentProfileId,
      session,
    );
    if (input.targetType === "ORG_UNIT") {
      assertManagerWorkScheduleTarget(
        authority,
        "ORG_UNIT",
        input.targetOrgUnitId as string,
      );
      const target = await this.orgUnitReadonlyAccess.findById(
        input.targetOrgUnitId as string,
        session,
      );
      if (!target || target.status !== "ACTIVE") {
        throw new WorkScheduleValidationError(
          "Selected OrgUnit target must be ACTIVE",
        );
      }
      const profiles =
        await this.employmentProfileReadonlyAccess.listByOrgUnitId(
          input.targetOrgUnitId as string,
          session,
        );
      return {
        targetRef: target.ref ?? { id: target.id, status: target.status },
        profiles: new Map(
          profiles
            .filter((profile) => profile.employmentStatus === "ACTIVE")
            .map((profile) => [profile.id, profile]),
        ),
      };
    }

    assertManagerWorkScheduleTarget(
      authority,
      "TALENT_GROUP",
      input.targetTalentGroupId as string,
    );
    const target = await this.talentGroupReadonlyAccess.findById(
      input.targetTalentGroupId as string,
      session,
    );
    if (!target || target.status !== "ACTIVE") {
      throw new WorkScheduleValidationError(
        "Selected TalentGroup target must be ACTIVE",
      );
    }
    const resolutions =
      await this.employmentProfileReadonlyAccess.listTalentGroupMemberEmploymentProfileResolutions(
        input.targetTalentGroupId as string,
        session,
      );
    const profiles = new Map<string, WorkScheduleReferencedEmploymentProfile>();
    for (const resolution of resolutions) {
      if (
        resolution.membershipStatus === "ACTIVE" &&
        resolution.talentOperationalStatus === "ACTIVE" &&
        resolution.employmentProfile?.employmentStatus === "ACTIVE"
      ) {
        profiles.set(
          resolution.employmentProfile.id,
          resolution.employmentProfile,
        );
      }
    }
    return {
      targetRef: target.ref ?? { id: target.id, status: target.status },
      profiles,
    };
  }

  private resolveManagerAuthority(
    actor: Actor,
    managerEmploymentProfileId: string,
    session?: ClientSession,
  ): Promise<ManagerWorkScheduleTargetAuthority> {
    return resolveManagerWorkScheduleTargetAuthority({
      actor,
      managerEmploymentProfileId,
      permission: Permission.WORK_SCHEDULE_READ,
      managedScopeReader: this.managedScopeReader,
      structuredAuthority: this.structuredAuthority,
      asOf: this.clock(),
      session,
    });
  }

  private isBatchAuthorized(
    authority: ManagerWorkScheduleTargetAuthority,
    batch: Pick<
      WorkScheduleAvailabilityBatchRecord,
      "targetType" | "targetOrgUnitId" | "targetTalentGroupId"
    >,
  ): boolean {
    return batch.targetType === "ORG_UNIT"
      ? batch.targetOrgUnitId !== null &&
          authority.orgUnitIds.has(batch.targetOrgUnitId)
      : batch.targetTalentGroupId !== null &&
          authority.talentGroupIds.has(batch.targetTalentGroupId);
  }

  private assertBatchAuthorized(
    authority: ManagerWorkScheduleTargetAuthority,
    batch: Pick<
      WorkScheduleAvailabilityBatchRecord,
      "targetType" | "targetOrgUnitId" | "targetTalentGroupId"
    >,
  ): void {
    if (!this.isBatchAuthorized(authority, batch)) {
      throw new WorkSchedulePermissionScopeError(
        "Matching exact Manager responsibility and structured WorkSchedule scope are required for this availability batch",
      );
    }
  }

  private async updateDerivedBatch(
    batchId: string,
    session: ClientSession,
  ): Promise<WorkScheduleAvailabilityBatchRecord> {
    const lines = await this.repository.listLinesByBatchId(batchId, session);
    const lineCounts = deriveLineCounts(lines);
    const status = deriveBatchStatus(lineCounts);
    const now = this.clock();
    const updated = await this.repository.updateBatchDerived(
      {
        batchId,
        status,
        lineCounts,
        updatedAt: now,
        ...(status === "CANCELLED" ? { cancelledAt: now } : {}),
        ...(lineCounts.pending === 0 ? { resolvedAt: now } : {}),
      },
      session,
    );
    if (!updated) {
      throw new WorkScheduleConflictError(
        `Failed to update availability batch: ${batchId}`,
      );
    }
    return updated;
  }

  private async transitionLine(
    input: Parameters<
      WorkScheduleAvailabilityBatchRepository["transitionLineStatus"]
    >[0],
    session: ClientSession,
  ): Promise<void> {
    const updated = await this.repository.transitionLineStatus(input, session);
    if (!updated) {
      throw new WorkScheduleConflictError(
        `Failed to transition availability line: ${input.lineId}`,
      );
    }
  }

  private async requireBatch(
    batchId: string,
    session?: ClientSession,
  ): Promise<WorkScheduleAvailabilityBatchRecord> {
    const id = normalizeRequiredText(batchId, "batchId");
    const batch = await this.repository.findBatchById(id, session);
    if (!batch) {
      throw new WorkScheduleAvailabilityBatchNotFoundError(id);
    }
    return batch;
  }

  private async requireLine(
    batchId: string,
    lineId: string,
    session?: ClientSession,
  ): Promise<WorkScheduleAvailabilityLineRecord> {
    const id = normalizeRequiredText(lineId, "lineId");
    const line = await this.repository.findLineById(batchId, id, session);
    if (!line) {
      throw new WorkScheduleAvailabilityBatchNotFoundError(`${batchId}/${id}`);
    }
    return line;
  }

  private async requireManagerProfile(
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

  private assertOwnedBy(
    batch: WorkScheduleAvailabilityBatchRecord,
    managerEmploymentProfileId: string,
    action: string,
  ): void {
    if (batch.submittedByEmploymentProfileId !== managerEmploymentProfileId) {
      throw new WorkSchedulePermissionScopeError(
        `Manager can ${action} only own WorkSchedule availability batches`,
      );
    }
  }

  private async toListItem(
    batch: WorkScheduleAvailabilityBatchRecord,
    session?: ClientSession,
  ): Promise<WorkScheduleAvailabilityBatchListItemView> {
    const submitter = await this.employmentProfileReadonlyAccess.findById(
      batch.submittedByEmploymentProfileId,
      session,
    );
    return {
      ...batch,
      submittedByEmploymentProfileRef: submitter?.ref ?? null,
    };
  }

  private async toBatchView(
    batch: WorkScheduleAvailabilityBatchRecord,
    session?: ClientSession,
  ): Promise<WorkScheduleAvailabilityBatchView> {
    const [item, lines] = await Promise.all([
      this.toListItem(batch, session),
      this.repository.listLinesByBatchId(batch.id, session),
    ]);
    return {
      ...item,
      lines: await Promise.all(
        lines.map(async (line): Promise<WorkScheduleAvailabilityLineView> => {
          const member = await this.employmentProfileReadonlyAccess.findById(
            line.memberEmploymentProfileId,
            session,
          );
          return {
            ...line,
            memberEmploymentProfileRef: member?.ref ?? null,
          };
        }),
      ),
    };
  }

  private assertPermission(actor: Actor, code: Permission): PermissionContract {
    PermissionGuard.assertAdminActor(actor);
    const permission = PermissionResolver.resolve(code);
    PermissionGuard.assert(actor, permission);
    return permission;
  }

  private assertGlobalAuthority(actor: Actor): void {
    if (!PermissionGuard.hasWorkScheduleScopeGrant(actor, "global")) {
      throw new WorkSchedulePermissionScopeError(
        "WorkSchedule availability administration requires workSchedule.global scope",
      );
    }
  }

  private async assertAdminStructuredAuthorityForBatch(
    actor: Actor,
    permission: Permission,
    batch: Pick<
      WorkScheduleAvailabilityBatchRecord,
      "targetType" | "targetOrgUnitId" | "targetTalentGroupId"
    >,
    action: string,
  ): Promise<void> {
    const scope =
      batch.targetType === "ORG_UNIT"
        ? batch.targetOrgUnitId
          ? {
              scopeType: "managedOrgUnit" as const,
              targetId: batch.targetOrgUnitId,
            }
          : null
        : batch.targetTalentGroupId
          ? {
              scopeType: "managedTalentGroup" as const,
              targetId: batch.targetTalentGroupId,
            }
          : null;

    if (!scope) {
      throw new WorkSchedulePermissionScopeError(
        `Cannot ${action}: WorkSchedule availability batch target is not object-bound`,
      );
    }

    await requireAdminObjectScopeAuthority({
      actor,
      permission,
      scope,
      authority: this.structuredAuthority,
      error: new WorkSchedulePermissionScopeError(
        `Cannot ${action}: matching structured WorkSchedule object scope is required`,
      ),
    });
  }

  private async allocateBatchCode(
    timestamp: number,
    session: ClientSession,
  ): Promise<string> {
    const month = toUtcMonthBucket(timestamp);
    const sequence =
      await this.codeSequenceRepository.allocateNextWorkScheduleAvailabilityCode(
        month,
        session,
      );
    return `WSAB-${month}-${String(sequence).padStart(6, "0")}`;
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
        mutationTargetDescriptor: JSON.stringify(metadata),
      },
      async (session) => fn(session),
    );
  }
}

function normalizeSubmitCommand(
  command: SubmitWorkScheduleAvailabilityBatchCommand,
  now: number,
): NormalizedSubmitCommand {
  const periodMonth = normalizeMonth(command.periodMonth, "periodMonth");
  assertPeriodInPlanningWindow(periodMonth, now);
  const targetType = normalizeTargetType(command.targetType);
  const targetMode =
    normalizeOptionalText(command.targetMode, "targetMode") ?? "EXACT_ONLY";
  if (targetMode !== "EXACT_ONLY") {
    throw new WorkScheduleValidationError("targetMode must be EXACT_ONLY");
  }
  const targetOrgUnitId =
    normalizeOptionalText(command.targetOrgUnitId, "targetOrgUnitId") ?? null;
  const targetTalentGroupId =
    normalizeOptionalText(command.targetTalentGroupId, "targetTalentGroupId") ??
    null;
  if (
    (targetType === "ORG_UNIT" && (!targetOrgUnitId || targetTalentGroupId)) ||
    (targetType === "TALENT_GROUP" && (!targetTalentGroupId || targetOrgUnitId))
  ) {
    throw new WorkScheduleValidationError(
      "Exactly one target id is required for targetType",
    );
  }
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
    throw new WorkScheduleValidationError(
      "lines must contain at least one line",
    );
  }
  if (command.lines.length > MAX_LINES_PER_BATCH) {
    throw new WorkScheduleValidationError(
      `lines must contain at most ${MAX_LINES_PER_BATCH} lines`,
    );
  }
  const note = normalizeOptionalText(command.note, "note") ?? null;
  if (note && note.length > 1000) {
    throw new WorkScheduleValidationError(
      "note must be at most 1000 characters",
    );
  }
  return {
    periodMonth,
    targetType,
    targetOrgUnitId,
    targetTalentGroupId,
    clientToken,
    note,
    lines: command.lines.map((line, index) =>
      normalizeLine(line, `lines[${index}]`, periodMonth),
    ),
  };
}

function normalizeLine(
  line: SubmitWorkScheduleAvailabilityBatchCommand["lines"][number],
  field: string,
  periodMonth: string,
): NormalizedAvailabilityLine {
  if (typeof line !== "object" || line === null || Array.isArray(line)) {
    throw new WorkScheduleValidationError(`${field} must be a plain object`);
  }
  const availabilityType = normalizeAvailabilityType(line.availabilityType);
  const taxonomyCode = normalizeTaxonomyCode(line.taxonomyCode);
  const singleDate = normalizeOptionalDate(
    line.availabilityDate,
    `${field}.availabilityDate`,
  );
  const rangeStart = normalizeOptionalDate(
    line.dateRangeStart,
    `${field}.dateRangeStart`,
  );
  const rangeEnd = normalizeOptionalDate(
    line.dateRangeEnd,
    `${field}.dateRangeEnd`,
  );
  if (singleDate && (rangeStart || rangeEnd)) {
    throw new WorkScheduleValidationError(
      `${field} must use availabilityDate or dateRangeStart/dateRangeEnd`,
    );
  }
  if (!singleDate && (!rangeStart || !rangeEnd)) {
    throw new WorkScheduleValidationError(
      `${field} requires availabilityDate or dateRangeStart/dateRangeEnd`,
    );
  }
  const dateRangeStart = singleDate ?? (rangeStart as string);
  const dateRangeEnd = singleDate ?? (rangeEnd as string);
  if (dateRangeEnd < dateRangeStart) {
    throw new WorkScheduleValidationError(
      `${field}.dateRangeEnd must not be before dateRangeStart`,
    );
  }
  if (
    dateRangeStart.slice(0, 7) !== periodMonth ||
    dateRangeEnd.slice(0, 7) !== periodMonth
  ) {
    throw new WorkScheduleValidationError(
      `${field} dates must be within the batch periodMonth`,
    );
  }

  const preferredStartLocalTime = normalizeOptionalLocalTime(
    line.preferredStartLocalTime,
    `${field}.preferredStartLocalTime`,
  );
  const preferredEndLocalTime = normalizeOptionalLocalTime(
    line.preferredEndLocalTime,
    `${field}.preferredEndLocalTime`,
  );

  if (availabilityType === "UNAVAILABLE_FULL_DAY") {
    assertTaxonomyAllowed(
      taxonomyCode,
      ["SICK_LEAVE", "AUTHORIZED_LEAVE", "OTHER"],
      field,
    );
    if (preferredStartLocalTime || preferredEndLocalTime) {
      throw new WorkScheduleValidationError(
        `${field} UNAVAILABLE_FULL_DAY must not include preferred time fields`,
      );
    }
  } else if (availabilityType === "PREFERRED_TIME") {
    assertTaxonomyAllowed(taxonomyCode, ["SHIFT_CHANGE", "OTHER"], field);
    if (!preferredStartLocalTime || !preferredEndLocalTime) {
      throw new WorkScheduleValidationError(
        `${field} PREFERRED_TIME requires preferred start and end time`,
      );
    }
    if (preferredEndLocalTime <= preferredStartLocalTime) {
      throw new WorkScheduleValidationError(
        `${field}.preferredEndLocalTime must be after preferredStartLocalTime`,
      );
    }
  } else {
    if (preferredStartLocalTime || preferredEndLocalTime) {
      throw new WorkScheduleValidationError(
        `${field} OTHER_AVAILABILITY_NOTE must not include preferred time fields`,
      );
    }
  }

  return {
    memberEmploymentProfileId: normalizeRequiredText(
      line.memberEmploymentProfileId,
      `${field}.memberEmploymentProfileId`,
    ),
    availabilityType,
    taxonomyCode,
    dateRangeStart,
    dateRangeEnd,
    preferredStartLocalTime,
    preferredEndLocalTime,
    reason: normalizeReason(line.reason, `${field}.reason`),
  };
}

function normalizeListQuery(query: ListWorkScheduleAvailabilityBatchesQuery) {
  const targetType = query.targetType
    ? normalizeTargetType(query.targetType)
    : undefined;
  const targetOrgUnitId =
    normalizeOptionalText(query.targetOrgUnitId, "targetOrgUnitId") ??
    undefined;
  const targetTalentGroupId =
    normalizeOptionalText(query.targetTalentGroupId, "targetTalentGroupId") ??
    undefined;
  if (targetOrgUnitId && targetTalentGroupId) {
    throw new WorkScheduleValidationError(
      "Only one target id filter may be provided",
    );
  }
  if (
    (targetType === "ORG_UNIT" && targetTalentGroupId) ||
    (targetType === "TALENT_GROUP" && targetOrgUnitId)
  ) {
    throw new WorkScheduleValidationError(
      "Target id filter must match targetType",
    );
  }
  return {
    status: normalizeOptionalBatchStatus(query.status),
    periodMonth: query.periodMonth
      ? normalizeMonth(query.periodMonth, "periodMonth")
      : undefined,
    targetType,
    targetOrgUnitId,
    targetTalentGroupId,
    submittedByEmploymentProfileId:
      normalizeOptionalText(
        query.submittedByEmploymentProfileId,
        "submittedByEmploymentProfileId",
      ) ?? undefined,
    limit: parseLimit(query.limit),
    cursor: normalizeOptionalText(query.cursor, "cursor") ?? undefined,
  };
}

function normalizeTargetType(value: unknown): MonthlyRosterTargetType {
  const normalized = normalizeRequiredText(value, "targetType").toUpperCase();
  if (normalized === "ORG_UNIT" || normalized === "TALENT_GROUP") {
    return normalized;
  }
  throw new WorkScheduleValidationError(
    "targetType must be ORG_UNIT or TALENT_GROUP",
  );
}

function normalizeAvailabilityType(
  value: unknown,
): WorkScheduleAvailabilityType {
  const normalized = normalizeRequiredText(
    value,
    "availabilityType",
  ).toUpperCase();
  if (
    WORK_SCHEDULE_AVAILABILITY_TYPES.includes(
      normalized as WorkScheduleAvailabilityType,
    )
  ) {
    return normalized as WorkScheduleAvailabilityType;
  }
  throw new WorkScheduleValidationError(
    `availabilityType must be one of ${WORK_SCHEDULE_AVAILABILITY_TYPES.join(", ")}`,
  );
}

function normalizeTaxonomyCode(
  value: unknown,
): WorkScheduleAvailabilityTaxonomyCode {
  const normalized = normalizeRequiredText(value, "taxonomyCode").toUpperCase();
  if (
    WORK_SCHEDULE_AVAILABILITY_TAXONOMY_CODES.includes(
      normalized as WorkScheduleAvailabilityTaxonomyCode,
    )
  ) {
    return normalized as WorkScheduleAvailabilityTaxonomyCode;
  }
  throw new WorkScheduleValidationError(
    `taxonomyCode must be one of ${WORK_SCHEDULE_AVAILABILITY_TAXONOMY_CODES.join(", ")}`,
  );
}

function normalizeOptionalBatchStatus(
  value: unknown,
): WorkScheduleAvailabilityBatchStatus | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const normalized = normalizeRequiredText(value, "status").toUpperCase();
  if (
    WORK_SCHEDULE_AVAILABILITY_BATCH_STATUSES.includes(
      normalized as WorkScheduleAvailabilityBatchStatus,
    )
  ) {
    return normalized as WorkScheduleAvailabilityBatchStatus;
  }
  throw new WorkScheduleValidationError(
    `status must be one of ${WORK_SCHEDULE_AVAILABILITY_BATCH_STATUSES.join(", ")}`,
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

function normalizeOptionalText(
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

function normalizeMonth(value: unknown, field: string): string {
  const month = normalizeRequiredText(value, field);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new WorkScheduleValidationError(`${field} must use YYYY-MM`);
  }
  return month;
}

function normalizeOptionalDate(value: unknown, field: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const date = normalizeRequiredText(value, field);
  if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(date)) {
    throw new WorkScheduleValidationError(`${field} must use YYYY-MM-DD`);
  }
  const [year, month, day] = date.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new WorkScheduleValidationError(`${field} must be a valid date`);
  }
  return date;
}

function normalizeOptionalLocalTime(
  value: unknown,
  field: string,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const time = normalizeRequiredText(value, field);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new WorkScheduleValidationError(`${field} must use HH:mm`);
  }
  return time;
}

function normalizeLineIds(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new WorkScheduleValidationError(
      "lineIds must contain at least one id",
    );
  }
  const ids = value.map((item, index) =>
    normalizeRequiredText(item, `lineIds[${index}]`),
  );
  if (new Set(ids).size !== ids.length) {
    throw new WorkScheduleValidationError(
      "lineIds must not contain duplicates",
    );
  }
  return ids;
}

function parseLimit(value: unknown): number {
  if (value === undefined || value === null) {
    return DEFAULT_LIMIT;
  }
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new WorkScheduleValidationError("limit must be a positive integer");
  }
  return Math.min(number, MAX_LIMIT);
}

function assertTaxonomyAllowed(
  taxonomyCode: WorkScheduleAvailabilityTaxonomyCode,
  allowed: readonly WorkScheduleAvailabilityTaxonomyCode[],
  field: string,
): void {
  if (!allowed.includes(taxonomyCode)) {
    throw new WorkScheduleValidationError(
      `${field}.taxonomyCode is not allowed for availabilityType`,
    );
  }
}

function assertNoDuplicatePayloadLines(
  lines: readonly NormalizedAvailabilityLine[],
): void {
  const keys = lines.map((line) => JSON.stringify(line));
  if (new Set(keys).size !== keys.length) {
    throw new WorkScheduleValidationError(
      "lines must not contain exact duplicate availability lines",
    );
  }
}

function createPendingDuplicateKey(
  input: {
    readonly submittedByEmploymentProfileId: string;
    readonly periodMonth: string;
    readonly targetType: MonthlyRosterTargetType;
    readonly targetOrgUnitId: string | null;
    readonly targetTalentGroupId: string | null;
  } & NormalizedAvailabilityLine,
): string {
  const canonical = [
    input.submittedByEmploymentProfileId,
    input.periodMonth,
    input.targetType,
    input.targetOrgUnitId,
    input.targetTalentGroupId,
    input.memberEmploymentProfileId,
    input.availabilityType,
    input.taxonomyCode,
    input.dateRangeStart,
    input.dateRangeEnd,
    input.preferredStartLocalTime,
    input.preferredEndLocalTime,
    input.reason,
  ];
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonical))
    .digest("hex");
}

function isPendingDuplicateKeyError(error: unknown): error is MongoServerError {
  if (!(error instanceof MongoServerError) || error.code !== 11000) {
    return false;
  }
  const keyPattern = (
    error as MongoServerError & {
      readonly keyPattern?: Readonly<Record<string, unknown>>;
    }
  ).keyPattern;
  return keyPattern?.pendingDuplicateKey === 1;
}

function assertPendingLine(line: WorkScheduleAvailabilityLineRecord): void {
  if (line.status !== "PENDING") {
    throw new WorkScheduleStateError(
      `Availability line ${line.id} cannot transition from ${line.status}`,
    );
  }
}

function deriveLineCounts(
  lines: readonly Pick<WorkScheduleAvailabilityLineRecord, "status">[],
): WorkScheduleAvailabilityLineCounts {
  return {
    total: lines.length,
    pending: lines.filter((line) => line.status === "PENDING").length,
    approved: lines.filter((line) => line.status === "APPROVED").length,
    rejected: lines.filter((line) => line.status === "REJECTED").length,
    cancelled: lines.filter((line) => line.status === "CANCELLED").length,
  };
}

function deriveBatchStatus(
  counts: WorkScheduleAvailabilityLineCounts,
): WorkScheduleAvailabilityBatchStatus {
  if (counts.total > 0 && counts.cancelled === counts.total) {
    return "CANCELLED";
  }
  if (counts.total > 0 && counts.approved === counts.total) {
    return "APPROVED";
  }
  if (counts.approved > 0) {
    return "PARTIALLY_APPROVED";
  }
  if (counts.pending > 0) {
    return "PENDING";
  }
  if (counts.rejected > 0) {
    return "REJECTED";
  }
  return "PENDING";
}

function assertPeriodInPlanningWindow(periodMonth: string, now: number): void {
  const current = hcmMonthFromTimestamp(now);
  if (
    !new Set([current, addMonths(current, 1), addMonths(current, 2)]).has(
      periodMonth,
    )
  ) {
    throw new WorkScheduleValidationError(
      "periodMonth must be current month or one of the next two months",
    );
  }
}

function hcmMonthFromTimestamp(timestamp: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date(timestamp));
  return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}`;
}

function addMonths(month: string, amount: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + amount, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function toUtcMonthBucket(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
