import assert from "node:assert/strict";
import { test } from "node:test";
import { ClientSession } from "mongodb";
import { Actor } from "@core/actor/actor";
import type {
  AuthoritativeAdminMutationBridge,
  AuthoritativeMutationControls,
} from "@core/application/authoritative-admin-mutation.bridge";
import type { AuditGuard } from "@core/audit/audit.guard";
import { Permission } from "@core/permission/permission.enum";
import { bindTraceId } from "@core/trace/trace.context";
import { WorkScheduleRequestBatchAdminService } from "@modules/work-schedule/admin/admin.work-schedule-request-batch.service";
import type { OrgUnitManagerAssignmentRepository } from "@modules/kpi/domain/org-unit-manager-assignment.repository";
import type { TalentGroupManagerAssignmentRepository } from "@modules/kpi/domain/talent-group-manager-assignment.repository";
import {
  WorkScheduleConflictError,
  WorkSchedulePermissionScopeError,
  WorkScheduleStateError,
  WorkScheduleValidationError,
} from "@modules/work-schedule/domain/work-schedule.errors";
import type { WorkScheduleCodeSequenceRepository } from "@modules/work-schedule/domain/work-schedule-code-sequence.repository";
import type { WorkScheduleEmploymentProfileReadonlyAccess } from "@modules/work-schedule/domain/work-schedule-employment-profile-readonly-access";
import type {
  PendingDuplicateWorkScheduleRequestLineInput,
  RescheduleWorkShiftInput,
  TransitionWorkScheduleRequestLineInput,
  TransitionWorkShiftStatusInput,
  UpdateWorkScheduleRequestBatchDerivedInput,
  WorkScheduleRequestBatchListInput,
  WorkScheduleRequestBatchRepository,
  WorkShiftOverlapResourceCheckInput,
  WorkShiftOverlapSubjectCheckInput,
  WorkShiftRepository,
} from "@modules/work-schedule/domain/work-schedule.repository";
import type { WorkScheduleStudioResourceReadonlyAccess } from "@modules/work-schedule/domain/work-schedule-studio-resource-readonly-access";
import type {
  WorkScheduleRequestBatchRecord,
  WorkScheduleRequestLineRecord,
  WorkShiftRecord,
} from "@modules/work-schedule/domain/work-schedule.types";
import { WorkScheduleRequestBatchAdminExposure } from "@modules/work-schedule/shared/work-schedule.exposure";
import type { WorkScheduleRequestBatchLineCommand } from "@modules/work-schedule/shared/work-schedule.contracts";

const NOW = Date.parse("2026-06-06T00:00:00+07:00");
const JUNE_START = Date.parse("2026-06-12T09:00:00+07:00");

class MemoryBatchRepository
  implements WorkScheduleRequestBatchRepository
{
  readonly batches: WorkScheduleRequestBatchRecord[] = [];
  readonly lines: WorkScheduleRequestLineRecord[] = [];

  async insertBatchWithLines(
    batch: WorkScheduleRequestBatchRecord,
    lines: readonly WorkScheduleRequestLineRecord[],
  ): Promise<WorkScheduleRequestBatchRecord> {
    this.batches.push(batch);
    this.lines.push(...lines);
    return batch;
  }

  async findBatchById(
    batchId: string,
  ): Promise<WorkScheduleRequestBatchRecord | null> {
    return this.batches.find((batch) => batch.id === batchId) ?? null;
  }

  async findBatchByClientToken(
    submittedByEmploymentProfileId: string,
    clientToken: string,
  ): Promise<WorkScheduleRequestBatchRecord | null> {
    return (
      this.batches.find(
        (batch) =>
          batch.submittedByEmploymentProfileId ===
            submittedByEmploymentProfileId &&
          batch.clientToken === clientToken,
      ) ?? null
    );
  }

  async listBatches(input: WorkScheduleRequestBatchListInput) {
    let items = [...this.batches];
    if (input.status) {
      items = items.filter((item) => item.status === input.status);
    }
    if (input.periodMonth) {
      items = items.filter((item) => item.periodMonth === input.periodMonth);
    }
    if (input.submittedByEmploymentProfileId) {
      items = items.filter(
        (item) =>
          item.submittedByEmploymentProfileId ===
          input.submittedByEmploymentProfileId,
      );
    }
    return { items: items.slice(0, input.limit) };
  }

  async listLinesByBatchId(
    batchId: string,
  ): Promise<readonly WorkScheduleRequestLineRecord[]> {
    return this.lines
      .filter((line) => line.batchId === batchId)
      .sort((a, b) => a.lineNo - b.lineNo);
  }

  async findLineById(
    batchId: string,
    lineId: string,
  ): Promise<WorkScheduleRequestLineRecord | null> {
    return (
      this.lines.find(
        (line) => line.batchId === batchId && line.id === lineId,
      ) ?? null
    );
  }

  async findPendingDuplicateLine(
    input: PendingDuplicateWorkScheduleRequestLineInput,
  ): Promise<WorkScheduleRequestLineRecord | null> {
    return (
      this.lines.find(
        (line) =>
          line.status === "PENDING" &&
          line.submittedByEmploymentProfileId ===
            input.submittedByEmploymentProfileId &&
          line.periodMonth === input.periodMonth &&
          line.requestType === input.requestType &&
          line.memberEmploymentProfileId ===
            input.memberEmploymentProfileId &&
          line.workShiftId === input.workShiftId &&
          line.requestedStartAt === input.requestedStartAt &&
          line.requestedEndAt === input.requestedEndAt,
      ) ?? null
    );
  }

  async transitionLineStatus(
    input: TransitionWorkScheduleRequestLineInput,
  ): Promise<WorkScheduleRequestLineRecord | null> {
    const current = await this.findLineById(input.batchId, input.lineId);
    if (!current || current.status !== input.fromStatus) {
      return null;
    }
    const updated: WorkScheduleRequestLineRecord = {
      ...current,
      status: input.toStatus,
      updatedAt: input.updatedAt,
      approvalNote: input.approvalNote ?? current.approvalNote,
      rejectionReason: input.rejectionReason ?? current.rejectionReason,
      cancellationReason:
        input.cancellationReason ?? current.cancellationReason,
      failureReason: input.failureReason ?? current.failureReason,
      appliedWorkShiftId:
        input.appliedWorkShiftId ?? current.appliedWorkShiftId,
      approvedAt: input.approvedAt ?? current.approvedAt,
      approvedByActorId:
        input.approvedByActorId ?? current.approvedByActorId,
      rejectedAt: input.rejectedAt ?? current.rejectedAt,
      rejectedByActorId:
        input.rejectedByActorId ?? current.rejectedByActorId,
      cancelledAt: input.cancelledAt ?? current.cancelledAt,
      cancelledByActorId:
        input.cancelledByActorId ?? current.cancelledByActorId,
      failedAt: input.failedAt ?? current.failedAt,
      failedByActorId: input.failedByActorId ?? current.failedByActorId,
    };
    this.replaceLine(updated);
    return updated;
  }

  async updateBatchDerived(
    input: UpdateWorkScheduleRequestBatchDerivedInput,
  ): Promise<WorkScheduleRequestBatchRecord | null> {
    const current = await this.findBatchById(input.batchId);
    if (!current) {
      return null;
    }
    const updated: WorkScheduleRequestBatchRecord = {
      ...current,
      status: input.status,
      lineCounts: input.lineCounts,
      updatedAt: input.updatedAt,
      cancelledAt: input.cancelledAt ?? current.cancelledAt,
      resolvedAt: input.resolvedAt ?? current.resolvedAt,
    };
    this.replaceBatch(updated);
    return updated;
  }

  private replaceBatch(updated: WorkScheduleRequestBatchRecord): void {
    const index = this.batches.findIndex((item) => item.id === updated.id);
    if (index >= 0) {
      this.batches[index] = updated;
    }
  }

  private replaceLine(updated: WorkScheduleRequestLineRecord): void {
    const index = this.lines.findIndex((item) => item.id === updated.id);
    if (index >= 0) {
      this.lines[index] = updated;
    }
  }
}

class MemoryWorkShiftRepository implements WorkShiftRepository {
  readonly records: WorkShiftRecord[] = [];
  subjectOverlap = false;

  constructor(seed: readonly WorkShiftRecord[] = []) {
    this.records.push(...seed);
  }

  async insert(workShift: WorkShiftRecord): Promise<WorkShiftRecord> {
    this.records.push(workShift);
    return workShift;
  }

  async findById(workShiftId: string): Promise<WorkShiftRecord | null> {
    return this.records.find((record) => record.id === workShiftId) ?? null;
  }

  async findByShiftCode(): Promise<WorkShiftRecord | null> {
    return null;
  }

  async updateCore(): Promise<WorkShiftRecord | null> {
    return null;
  }

  async reschedule(
    input: RescheduleWorkShiftInput,
  ): Promise<WorkShiftRecord | null> {
    const current = await this.findById(input.workShiftId);
    if (!current) {
      return null;
    }
    const updated = {
      ...current,
      shiftStartAt: input.shiftStartAt,
      shiftEndAt: input.shiftEndAt,
      updatedAt: input.updatedAt,
    };
    this.replace(updated);
    return updated;
  }

  async reassignSubject(): Promise<WorkShiftRecord | null> {
    return null;
  }

  async replaceResources(): Promise<WorkShiftRecord | null> {
    return null;
  }

  async transitionStatus(
    input: TransitionWorkShiftStatusInput,
  ): Promise<WorkShiftRecord | null> {
    const current = await this.findById(input.workShiftId);
    if (!current || !input.fromStatuses.includes(current.status)) {
      return null;
    }
    const updated = {
      ...current,
      status: input.toStatus,
      updatedAt: input.updatedAt,
    };
    this.replace(updated);
    return updated;
  }

  async hasActiveOverlappingSubjectShift(
    _input: WorkShiftOverlapSubjectCheckInput,
  ): Promise<boolean> {
    return this.subjectOverlap;
  }

  async hasActiveOverlappingResourceShift(
    _input: WorkShiftOverlapResourceCheckInput,
  ): Promise<boolean> {
    return false;
  }

  async listActiveEmploymentProfileShiftsForWindow() {
    return [];
  }

  async summarizeGeneratedByRoster() {
    return {
      workShiftIds: [],
      generatedWorkShiftCount: 0,
      changeTimeCount: 0,
      addSpecialShiftCount: 0,
    };
  }

  private replace(updated: WorkShiftRecord): void {
    const index = this.records.findIndex((record) => record.id === updated.id);
    if (index >= 0) {
      this.records[index] = updated;
    }
  }
}

class MemoryCodeSequenceRepository
  implements WorkScheduleCodeSequenceRepository
{
  private readonly values = new Map<string, number>();

  async allocateNext(dateBucket: string): Promise<number> {
    return this.next(`shift:${dateBucket}`);
  }

  async allocateNextWorkPatternCode(): Promise<number> {
    return this.next("pattern");
  }

  async allocateNextHolidayCalendarCode(): Promise<number> {
    return this.next("holiday");
  }

  async allocateNextMonthlyRosterCode(month: string): Promise<number> {
    return this.next(`roster:${month}`);
  }

  async allocateNextWorkScheduleRequestCode(month: string): Promise<number> {
    return this.next(`request:${month}`);
  }

  async allocateNextWorkScheduleAvailabilityCode(
    month: string,
  ): Promise<number> {
    return this.next(`availability:${month}`);
  }

  private next(key: string): number {
    const value = (this.values.get(key) ?? 0) + 1;
    this.values.set(key, value);
    return value;
  }
}

class AuditCapture {
  readonly records: unknown[] = [];
  async record(...args: unknown[]) {
    this.records.push(args);
  }
}

const mutationBridge: AuthoritativeAdminMutationBridge = {
  async execute(_params, mutate) {
    const controls: AuthoritativeMutationControls = {
      markAuthSecurityTruthChanged() {},
      markExplicitNoOpSuccess() {},
    };
    return mutate({} as ClientSession, controls);
  },
};

function createService(params?: {
  readonly batchRepository?: MemoryBatchRepository;
  readonly workShiftRepository?: MemoryWorkShiftRepository;
  readonly audit?: AuditCapture;
}): WorkScheduleRequestBatchAdminService {
  return new WorkScheduleRequestBatchAdminService(
    params?.batchRepository ?? new MemoryBatchRepository(),
    params?.workShiftRepository ?? new MemoryWorkShiftRepository(),
    new MemoryCodeSequenceRepository(),
    employmentProfileReadonlyAccess,
    studioResourceReadonlyAccess,
    talentGroupManagerAssignmentRepository,
    orgUnitManagerAssignmentRepository,
    (params?.audit ?? new AuditCapture()) as unknown as AuditGuard,
    mutationBridge,
    () => NOW,
  );
}

const employmentProfileReadonlyAccess: WorkScheduleEmploymentProfileReadonlyAccess =
  {
    async findById(id: string) {
      const names: Record<string, string> = {
        "ep-manager": "Manager",
        "ep-other-manager": "Other Manager",
        "ep-org": "Org Member",
        "ep-tg": "Talent Group Member",
        "ep-descendant": "Descendant Member",
        "ep-reporting": "Reporting Member",
        "ep-inactive": "Inactive Member",
      };
      if (!names[id]) {
        return null;
      }
      return {
        id,
        employmentStatus: id === "ep-inactive" ? "SUSPENDED" : "ACTIVE",
        orgUnitId: id === "ep-descendant" ? "org-child" : "org-managed",
        managerEmploymentProfileId:
          id === "ep-reporting" ? "ep-manager" : null,
        linkedUserId:
          id === "ep-manager"
            ? "manager-user"
            : id === "ep-other-manager"
              ? "other-manager-user"
              : null,
        ref: {
          id,
          code: id.toUpperCase(),
          displayName: names[id],
        },
      };
    },
    async findByLinkedUserId(linkedUserId: string) {
      if (linkedUserId === "manager-user") {
        return this.findById("ep-manager");
      }
      if (linkedUserId === "other-manager-user") {
        return this.findById("ep-other-manager");
      }
      return null;
    },
    async listIdsByManagerEmploymentProfileId() {
      return ["ep-reporting"];
    },
    async listIdsByActiveTalentGroupIds() {
      return ["ep-tg"];
    },
    async listIdsByOrgUnitId(orgUnitId: string) {
      return orgUnitId === "org-managed" ? ["ep-org"] : [];
    },
    async listByOrgUnitId(orgUnitId: string) {
      return orgUnitId === "org-managed"
        ? [(await this.findById("ep-org"))!]
        : [];
    },
    async listTalentGroupMemberEmploymentProfileResolutions(groupId: string) {
      if (groupId !== "group-managed") {
        return [];
      }
      return [
        {
          memberId: "member-tg",
          groupId,
          talentId: "talent-tg",
          membershipStatus: "ACTIVE",
          talentOperationalStatus: "ACTIVE",
          linkedEmploymentProfileId: "ep-tg",
          employmentProfile: await this.findById("ep-tg"),
        },
        {
          memberId: "member-unlinked",
          groupId,
          talentId: "talent-unlinked",
          membershipStatus: "ACTIVE",
          talentOperationalStatus: "ACTIVE",
          linkedEmploymentProfileId: null,
          employmentProfile: null,
        },
      ];
    },
  };

const studioResourceReadonlyAccess: WorkScheduleStudioResourceReadonlyAccess =
  {
    async findById(studioResourceId: string) {
      return { id: studioResourceId, operationalStatus: "ACTIVE" };
    },
  };

const orgUnitManagerAssignmentRepository: Pick<
  OrgUnitManagerAssignmentRepository,
  "listActiveByManagerEmploymentProfileId"
> = {
  async listActiveByManagerEmploymentProfileId(managerId: string) {
    return managerId === "ep-manager"
      ? [
          {
            id: "org-assignment",
            orgUnitId: "org-managed",
            managerEmploymentProfileId: managerId,
            role: "UNIT_MANAGER",
            includeDescendants: false,
            actionMask: [],
            effectiveFrom: 1,
            effectiveTo: null,
            status: "ACTIVE",
            isPrimary: true,
            createdAt: 1,
            createdByActorId: "seed",
            updatedAt: 1,
            updatedByActorId: "seed",
          },
        ]
      : [];
  },
};

const talentGroupManagerAssignmentRepository: Pick<
  TalentGroupManagerAssignmentRepository,
  "listActiveAssignmentsByManagerEmploymentProfile"
> = {
  async listActiveAssignmentsByManagerEmploymentProfile(managerId: string) {
    return managerId === "ep-manager"
      ? [
          {
            id: "tg-assignment",
            groupId: "group-managed",
            managerEmploymentProfileId: managerId,
            role: "MANAGER",
            effectiveFrom: 1,
            effectiveTo: null,
            status: "ACTIVE",
            isPrimary: true,
            createdAt: 1,
            createdByActorId: "seed",
            updatedAt: 1,
            updatedByActorId: "seed",
          },
        ]
      : [];
  },
};

function managerActor(id = "manager-user"): Actor {
  return new Actor({
    id,
    type: "admin",
    context: "ADMIN",
    accountContexts: ["ADMIN_CONSOLE"],
    roles: ["TEAM_MANAGER"],
    permissions: [Permission.WORK_SCHEDULE_READ],
    scopeGrants: { workSchedule: ["team"] },
    isActive: true,
  });
}

function opsActor(): Actor {
  return new Actor({
    id: "ops-user",
    type: "admin",
    context: "ADMIN",
    accountContexts: ["ADMIN_CONSOLE"],
    roles: ["PRODUCTION_OPS"],
    permissions: [
      Permission.WORK_SCHEDULE_READ,
      Permission.WORK_SCHEDULE_CREATE,
      Permission.WORK_SCHEDULE_UPDATE,
      Permission.WORK_SCHEDULE_MANAGE_LIFECYCLE,
    ],
    scopeGrants: { workSchedule: ["global"] },
    isActive: true,
  });
}

function createLine(params?: {
  readonly memberEmploymentProfileId?: string;
  readonly startAt?: number;
}): WorkScheduleRequestBatchLineCommand {
  const startAt = params?.startAt ?? JUNE_START;
  return {
    requestType: "CREATE_SHIFT",
    memberEmploymentProfileId: params?.memberEmploymentProfileId ?? "ep-org",
    requestedStartAt: startAt,
    requestedEndAt: startAt + 60 * 60 * 1000,
    reason: "Need official coverage for scheduled production",
  };
}

function submitPayload(lines = [createLine()]) {
  return {
    periodMonth: "2026-06",
    clientToken: `client-token-${cryptoRandom()}`,
    note: "Manager request batch",
    lines,
  };
}

function seedShift(params?: {
  readonly id?: string;
  readonly memberEmploymentProfileId?: string;
  readonly startAt?: number;
  readonly status?: WorkShiftRecord["status"];
}): WorkShiftRecord {
  const startAt = params?.startAt ?? JUNE_START;
  return {
    id: params?.id ?? "shift-1",
    shiftCode: "WS-20260612-0001",
    normalizedShiftCode: "ws-20260612-0001",
    title: "Current shift",
    normalizedTitle: "current shift",
    subjectKind: "EMPLOYMENT_PROFILE",
    subjectEmploymentProfileId:
      params?.memberEmploymentProfileId ?? "ep-org",
    subjectTalentId: null,
    subjectTalentGroupId: null,
    studioResourceIds: [],
    status: params?.status ?? "ACTIVE",
    shiftStartAt: startAt,
    shiftEndAt: startAt + 60 * 60 * 1000,
    description: null,
    externalRef: null,
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
    createdAt: 1,
    updatedAt: 1,
  };
}

function withTrace<T>(fn: () => Promise<T>): Promise<T> {
  return bindTraceId("test-trace", fn);
}

let tokenCounter = 0;
function cryptoRandom(): string {
  tokenCounter += 1;
  return String(tokenCounter).padStart(4, "0");
}

test("manager submits multi-line mixed OrgUnit and TalentGroup batch without official mutation", async () => {
  const batchRepository = new MemoryBatchRepository();
  const workShiftRepository = new MemoryWorkShiftRepository([
    seedShift({ id: "shift-tg", memberEmploymentProfileId: "ep-tg" }),
  ]);
  const service = createService({ batchRepository, workShiftRepository });

  const result = await withTrace(() =>
    service.submitManagerBatch(
      managerActor(),
      submitPayload([
        createLine({ memberEmploymentProfileId: "ep-org" }),
        {
          requestType: "CANCEL_SHIFT",
          memberEmploymentProfileId: "ep-tg",
          workShiftId: "shift-tg",
          reason: "Cancel because production coverage is no longer needed",
        },
      ]),
    ),
  );

  assert.equal(result.status, "PENDING");
  assert.equal(result.scopeSummary, "MIXED");
  assert.equal(result.lineCounts.total, 2);
  assert.equal(batchRepository.lines.length, 2);
  assert.equal(workShiftRepository.records.length, 1);
});

test("batch validation enforces max lines, planning window, reason length, duplicate pending line, and no draft", async () => {
  const batchRepository = new MemoryBatchRepository();
  const service = createService({ batchRepository });
  const fifty = Array.from({ length: 50 }, (_, index) =>
    createLine({ startAt: JUNE_START + index * 2 * 60 * 60 * 1000 }),
  );

  const accepted = await withTrace(() =>
    service.submitManagerBatch(managerActor(), submitPayload(fifty)),
  );
  assert.equal(accepted.lineCounts.total, 50);
  assert.equal(batchRepository.batches[0]?.status, "PENDING");

  await assert.rejects(
    withTrace(() =>
      service.submitManagerBatch(
        managerActor(),
        submitPayload([
          ...fifty,
          createLine({ startAt: JUNE_START + 100 * 60 * 60 * 1000 }),
        ]),
      ),
    ),
    WorkScheduleValidationError,
  );
  await assert.rejects(
    withTrace(() =>
      service.submitManagerBatch(managerActor(), {
        ...submitPayload(),
        periodMonth: "2026-09",
      }),
    ),
    WorkScheduleValidationError,
  );
  await assert.rejects(
    withTrace(() =>
      service.submitManagerBatch(
        managerActor(),
        submitPayload([{ ...createLine(), reason: "too short" }]),
      ),
    ),
    WorkScheduleValidationError,
  );
  await assert.rejects(
    withTrace(() =>
      service.submitManagerBatch(managerActor(), submitPayload([createLine()])),
    ),
    WorkScheduleConflictError,
  );
});

test("manager unified scope allows exact OrgUnit and TalentGroup members while denying descendants, reporting manager, and role-name-only actors", async () => {
  const service = createService({
    workShiftRepository: new MemoryWorkShiftRepository([
      seedShift({ id: "shift-tg", memberEmploymentProfileId: "ep-tg" }),
    ]),
  });

  await withTrace(() =>
    service.submitManagerBatch(
      managerActor(),
      submitPayload([
        createLine({ memberEmploymentProfileId: "ep-org" }),
        {
          requestType: "CANCEL_SHIFT",
          memberEmploymentProfileId: "ep-tg",
          workShiftId: "shift-tg",
          reason: "Cancel because production coverage is no longer needed",
        },
      ]),
    ),
  );

  for (const memberEmploymentProfileId of [
    "ep-descendant",
    "ep-reporting",
  ]) {
    await assert.rejects(
      withTrace(() =>
        service.submitManagerBatch(
          managerActor(),
          submitPayload([createLine({ memberEmploymentProfileId })]),
        ),
      ),
      WorkSchedulePermissionScopeError,
    );
  }

  await assert.rejects(
    withTrace(() =>
      service.submitManagerBatch(
        managerActor("other-manager-user"),
        submitPayload([createLine()]),
      ),
    ),
    WorkSchedulePermissionScopeError,
  );
});

test("manager cancels own pending line and batch but cannot cancel another manager batch or terminal lines", async () => {
  const batchRepository = new MemoryBatchRepository();
  const service = createService({ batchRepository });
  const batch = await withTrace(() =>
    service.submitManagerBatch(
      managerActor(),
      submitPayload([
        createLine({ startAt: JUNE_START }),
        createLine({ startAt: JUNE_START + 3 * 60 * 60 * 1000 }),
      ]),
    ),
  );

  const lineId = batch.lines[0]!.id;
  const afterLineCancel = await withTrace(() =>
    service.cancelManagerLine(managerActor(), {
      batchId: batch.id,
      lineId,
      cancellationReason: "Cancel this line because staffing changed",
    }),
  );
  assert.equal(afterLineCancel.lines[0]?.status, "CANCELLED");

  await assert.rejects(
    withTrace(() =>
      service.cancelManagerLine(managerActor(), {
        batchId: batch.id,
        lineId,
        cancellationReason: "Cancel this line because staffing changed",
      }),
    ),
    WorkScheduleStateError,
  );

  await assert.rejects(
    withTrace(() =>
      service.cancelManagerBatch(managerActor("other-manager-user"), {
        batchId: batch.id,
        cancellationReason: "Other manager cannot cancel this request",
      }),
    ),
    WorkSchedulePermissionScopeError,
  );

  const ownPending = await withTrace(() =>
    service.submitManagerBatch(
      managerActor(),
      submitPayload([createLine({ startAt: JUNE_START + 8 * 60 * 60 * 1000 })]),
    ),
  );
  const cancelled = await withTrace(() =>
    service.cancelManagerBatch(managerActor(), {
      batchId: ownPending.id,
      cancellationReason: "Cancel entire batch because plan changed",
    }),
  );
  assert.equal(cancelled.status, "CANCELLED");
  assert.equal(cancelled.lineCounts.cancelled, 1);
});

test("admin approves create, reschedule, and cancel lines with derived partial and approved statuses", async () => {
  const batchRepository = new MemoryBatchRepository();
  const workShiftRepository = new MemoryWorkShiftRepository([
    seedShift({ id: "shift-reschedule", memberEmploymentProfileId: "ep-org" }),
    seedShift({ id: "shift-cancel", memberEmploymentProfileId: "ep-tg" }),
  ]);
  const service = createService({ batchRepository, workShiftRepository });
  const batch = await withTrace(() =>
    service.submitManagerBatch(
      managerActor(),
      submitPayload([
        createLine({ memberEmploymentProfileId: "ep-org" }),
        {
          requestType: "RESCHEDULE_SHIFT",
          memberEmploymentProfileId: "ep-org",
          workShiftId: "shift-reschedule",
          requestedStartAt: JUNE_START + 4 * 60 * 60 * 1000,
          requestedEndAt: JUNE_START + 5 * 60 * 60 * 1000,
          reason: "Move this shift because production timing changed",
        },
        {
          requestType: "CANCEL_SHIFT",
          memberEmploymentProfileId: "ep-tg",
          workShiftId: "shift-cancel",
          reason: "Cancel this shift because production was cancelled",
        },
      ]),
    ),
  );

  const first = await withTrace(() =>
    service.approveAdminLines(opsActor(), {
      batchId: batch.id,
      lineIds: [batch.lines[0]!.id],
      approvalNote: "Approved",
    }),
  );
  assert.equal(first.status, "PARTIALLY_APPROVED");
  assert.equal(first.lineCounts.approved, 1);

  const final = await withTrace(() =>
    service.approveAdminLines(opsActor(), {
      batchId: batch.id,
      lineIds: [batch.lines[1]!.id, batch.lines[2]!.id],
    }),
  );
  assert.equal(final.status, "APPROVED");
  assert.equal(final.lineCounts.approved, 3);
  assert.equal(
    workShiftRepository.records.find((shift) => shift.id === "shift-reschedule")
      ?.shiftStartAt,
    JUNE_START + 4 * 60 * 60 * 1000,
  );
  assert.equal(
    workShiftRepository.records.find((shift) => shift.id === "shift-cancel")
      ?.status,
    "CANCELLED",
  );
  assert.equal(workShiftRepository.records.length, 3);
});

test("admin reject and cancel require reasons and update derived status", async () => {
  const service = createService();
  const batch = await withTrace(() =>
    service.submitManagerBatch(
      managerActor(),
      submitPayload([
        createLine({ startAt: JUNE_START }),
        createLine({ startAt: JUNE_START + 2 * 60 * 60 * 1000 }),
      ]),
    ),
  );

  await assert.rejects(
    withTrace(() =>
      service.rejectAdminLines(opsActor(), {
        batchId: batch.id,
        lineIds: [batch.lines[0]!.id],
      }),
    ),
    WorkScheduleValidationError,
  );

  const rejected = await withTrace(() =>
    service.rejectAdminLines(opsActor(), {
      batchId: batch.id,
      lineIds: [batch.lines[0]!.id],
      rejectionReason: "Reject because the requested coverage is not needed",
    }),
  );
  assert.equal(rejected.lineCounts.rejected, 1);

  await assert.rejects(
    withTrace(() =>
      service.cancelAdminLines(opsActor(), {
        batchId: batch.id,
        lineIds: [batch.lines[1]!.id],
      }),
    ),
    WorkScheduleValidationError,
  );

  const cancelled = await withTrace(() =>
    service.cancelAdminLines(opsActor(), {
      batchId: batch.id,
      lineIds: [batch.lines[1]!.id],
      cancellationReason: "Cancel because the request is no longer actionable",
    }),
  );
  assert.equal(cancelled.lineCounts.cancelled, 1);
  assert.equal(cancelled.status, "PENDING");
});

test("approval-time conflict marks selected line FAILED_TO_APPLY and terminal failed-only batch derives REJECTED", async () => {
  const workShiftRepository = new MemoryWorkShiftRepository();
  workShiftRepository.subjectOverlap = true;
  const service = createService({ workShiftRepository });
  const batch = await withTrace(() =>
    service.submitManagerBatch(managerActor(), submitPayload([createLine()])),
  );

  const result = await withTrace(() =>
    service.approveAdminLines(opsActor(), {
      batchId: batch.id,
      lineIds: [batch.lines[0]!.id],
    }),
  );

  assert.equal(result.status, "REJECTED");
  assert.equal(result.lineCounts.failedToApply, 1);
  assert.equal(result.lines[0]?.status, "FAILED_TO_APPLY");
  assert.match(result.lines[0]?.failureReason ?? "", /overlap/i);
  assert.equal(workShiftRepository.records.length, 0);
});

test("admin DTO exposure excludes raw actor and decision audit internals", async () => {
  const service = createService();
  const batch = await withTrace(() =>
    service.submitManagerBatch(managerActor(), submitPayload([createLine()])),
  );
  const approved = await withTrace(() =>
    service.approveAdminLines(opsActor(), {
      batchId: batch.id,
      lineIds: [batch.lines[0]!.id],
    }),
  );
  const exposed = WorkScheduleRequestBatchAdminExposure.exposeDetail(approved);
  const serialized = JSON.stringify(exposed);

  assert.equal("submittedByActorId" in exposed, false);
  assert.equal(serialized.includes("approvedByActorId"), false);
  assert.equal(serialized.includes("ops-user"), false);
});
