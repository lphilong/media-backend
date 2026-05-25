import assert from "node:assert/strict";
import { test } from "node:test";
import { ClientSession } from "mongodb";
import { Actor } from "@core/actor/actor";
import type {
  AuthoritativeAdminMutationBridge,
  AuthoritativeMutationControls,
} from "@core/application/authoritative-admin-mutation.bridge";
import type { AuditGuard } from "@core/audit/audit.guard";
import { SystemInvariantError } from "@core/error/system-error";
import { Permission } from "@core/permission/permission.enum";
import { bindTraceId } from "@core/trace/trace.context";
import { WorkScheduleRequestAdminService } from "@modules/work-schedule/admin/admin.work-schedule-request.service";
import type { TalentGroupManagerAssignmentRepository } from "@modules/kpi/domain/talent-group-manager-assignment.repository";
import {
  WorkSchedulePermissionScopeError,
  WorkScheduleStateError,
} from "@modules/work-schedule/domain/work-schedule.errors";
import type { WorkScheduleCodeSequenceRepository } from "@modules/work-schedule/domain/work-schedule-code-sequence.repository";
import type { WorkScheduleEmploymentProfileReadonlyAccess } from "@modules/work-schedule/domain/work-schedule-employment-profile-readonly-access";
import type {
  RescheduleWorkShiftInput,
  TransitionWorkScheduleRequestInput,
  TransitionWorkShiftStatusInput,
  WorkScheduleRequestListInput,
  WorkScheduleRequestRepository,
  WorkShiftOverlapResourceCheckInput,
  WorkShiftOverlapSubjectCheckInput,
  WorkShiftRepository,
} from "@modules/work-schedule/domain/work-schedule.repository";
import type { WorkScheduleStudioResourceReadonlyAccess } from "@modules/work-schedule/domain/work-schedule-studio-resource-readonly-access";
import type {
  WorkScheduleRequestRecord,
  WorkShiftRecord,
} from "@modules/work-schedule/domain/work-schedule.types";

class MemoryRequestRepository
  implements WorkScheduleRequestRepository
{
  readonly records: WorkScheduleRequestRecord[] = [];

  async insert(
    request: WorkScheduleRequestRecord,
  ): Promise<WorkScheduleRequestRecord> {
    this.records.push(request);
    return request;
  }

  async findById(
    requestId: string,
  ): Promise<WorkScheduleRequestRecord | null> {
    return (
      this.records.find(
        (record) => record.id === requestId,
      ) ?? null
    );
  }

  async list(input: WorkScheduleRequestListInput) {
    let items = [...this.records];

    if (input.status) {
      items = items.filter(
        (item) => item.status === input.status,
      );
    }
    if (input.requestType) {
      items = items.filter(
        (item) =>
          item.requestType === input.requestType,
      );
    }
    if (
      input.visibleTargetEmploymentProfileIds ||
      input.visibleRequestedByUserId
    ) {
      items = items.filter(
        (item) =>
          (input.visibleTargetEmploymentProfileIds?.includes(
            item.targetEmploymentProfileId,
          ) ??
            false) ||
          item.requestedByUserId ===
            input.visibleRequestedByUserId,
      );
    }

    return {
      items: items.slice(0, input.limit),
    };
  }

  async transitionStatus(
    input: TransitionWorkScheduleRequestInput,
  ): Promise<WorkScheduleRequestRecord | null> {
    const current = await this.findById(input.requestId);

    if (
      !current ||
      current.status !== input.fromStatus
    ) {
      return null;
    }

    const updated: WorkScheduleRequestRecord = {
      ...current,
      status: input.toStatus,
      updatedAt: input.updatedAt,
      approvedByUserId:
        input.approvedByUserId === undefined
          ? current.approvedByUserId
          : input.approvedByUserId,
      approvedAt:
        input.approvedAt === undefined
          ? current.approvedAt
          : input.approvedAt,
      approvalNote:
        input.approvalNote === undefined
          ? current.approvalNote
          : input.approvalNote,
      rejectedByUserId:
        input.rejectedByUserId === undefined
          ? current.rejectedByUserId
          : input.rejectedByUserId,
      rejectedAt:
        input.rejectedAt === undefined
          ? current.rejectedAt
          : input.rejectedAt,
      rejectionReason:
        input.rejectionReason === undefined
          ? current.rejectionReason
          : input.rejectionReason,
      cancelledByUserId:
        input.cancelledByUserId === undefined
          ? current.cancelledByUserId
          : input.cancelledByUserId,
      cancelledAt:
        input.cancelledAt === undefined
          ? current.cancelledAt
          : input.cancelledAt,
      cancellationReason:
        input.cancellationReason === undefined
          ? current.cancellationReason
          : input.cancellationReason,
      appliedWorkShiftId:
        input.appliedWorkShiftId === undefined
          ? current.appliedWorkShiftId
          : input.appliedWorkShiftId,
    };

    this.replace(updated);
    return updated;
  }

  private replace(
    updated: WorkScheduleRequestRecord,
  ): void {
    const index = this.records.findIndex(
      (record) => record.id === updated.id,
    );
    if (index >= 0) {
      this.records[index] = updated;
    }
  }
}

class MemoryWorkShiftRepository
  implements WorkShiftRepository
{
  readonly records: WorkShiftRecord[] = [];

  constructor(seed: readonly WorkShiftRecord[] = []) {
    this.records.push(...seed);
  }

  async insert(
    workShift: WorkShiftRecord,
  ): Promise<WorkShiftRecord> {
    this.records.push(workShift);
    return workShift;
  }

  async findById(
    workShiftId: string,
  ): Promise<WorkShiftRecord | null> {
    return (
      this.records.find(
        (record) => record.id === workShiftId,
      ) ?? null
    );
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
    if (
      !current ||
      !input.fromStatuses.includes(current.status)
    ) {
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
    return false;
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
    const index = this.records.findIndex(
      (record) => record.id === updated.id,
    );
    if (index >= 0) {
      this.records[index] = updated;
    }
  }
}

class MemoryCodeSequenceRepository
  implements WorkScheduleCodeSequenceRepository
{
  private readonly values = new Map<string, number>();

  async allocateNext(
    dateBucket: string,
  ): Promise<number> {
    return this.next(`shift:${dateBucket}`);
  }

  async allocateNextWorkPatternCode(): Promise<number> {
    return this.next("pattern");
  }

  async allocateNextHolidayCalendarCode(): Promise<number> {
    return this.next("holiday");
  }

  async allocateNextMonthlyRosterCode(
    rosterMonthBucket: string,
  ): Promise<number> {
    return this.next(`roster:${rosterMonthBucket}`);
  }

  async allocateNextWorkScheduleRequestCode(
    requestMonthBucket: string,
  ): Promise<number> {
    return this.next(`request:${requestMonthBucket}`);
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
  readonly requestRepository?: MemoryRequestRepository;
  readonly workShiftRepository?: MemoryWorkShiftRepository;
  readonly audit?: AuditCapture;
}): WorkScheduleRequestAdminService {
  return new WorkScheduleRequestAdminService(
    params?.requestRepository ??
      new MemoryRequestRepository(),
    params?.workShiftRepository ??
      new MemoryWorkShiftRepository(),
    new MemoryCodeSequenceRepository(),
    employmentProfileReadonlyAccess,
    studioResourceReadonlyAccess,
    managerAssignmentRepository,
    (params?.audit ?? new AuditCapture()) as unknown as AuditGuard,
    mutationBridge,
  );
}

const employmentProfileReadonlyAccess: WorkScheduleEmploymentProfileReadonlyAccess =
  {
    async findById(employmentProfileId: string) {
      const refs: Record<string, string> = {
        "ep-manager": "Manager",
        "ep-managed": "Managed Member",
        "ep-unmanaged": "Unmanaged Member",
      };
      if (!refs[employmentProfileId]) {
        return null;
      }
      return {
        id: employmentProfileId,
        employmentStatus: "ACTIVE",
        orgUnitId: "org-1",
        managerEmploymentProfileId: null,
        linkedUserId:
          employmentProfileId === "ep-manager"
            ? "manager-user"
            : null,
        ref: {
          id: employmentProfileId,
          displayName: refs[employmentProfileId],
        },
      };
    },
    async findByLinkedUserId(linkedUserId: string) {
      if (linkedUserId !== "manager-user") {
        return null;
      }
      return {
        id: "ep-manager",
        employmentStatus: "ACTIVE",
        orgUnitId: "org-1",
        managerEmploymentProfileId: null,
        linkedUserId,
        ref: {
          id: "ep-manager",
          displayName: "Manager",
        },
      };
    },
    async listIdsByManagerEmploymentProfileId() {
      return [];
    },
    async listIdsByActiveTalentGroupIds(
      groupIds: readonly string[],
    ) {
      return groupIds.includes("group-managed")
        ? ["ep-managed"]
        : [];
    },
    async listIdsByOrgUnitId() {
      return ["ep-manager", "ep-managed"];
    },
    async listByOrgUnitId() {
      return [];
    },
  };

const studioResourceReadonlyAccess: WorkScheduleStudioResourceReadonlyAccess =
  {
    async findById(studioResourceId: string) {
      return {
        id: studioResourceId,
        operationalStatus: "ACTIVE",
      };
    },
  };

const managerAssignmentRepository: Pick<
  TalentGroupManagerAssignmentRepository,
  "listActiveAssignmentsByManagerEmploymentProfile"
> = {
  async listActiveAssignmentsByManagerEmploymentProfile(
    managerEmploymentProfileId: string,
  ) {
    if (managerEmploymentProfileId !== "ep-manager") {
      return [];
    }
    return [
      {
        id: "assignment-1",
        groupId: "group-managed",
        managerEmploymentProfileId,
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
    ];
  },
};

function teamManagerActor(): Actor {
  return new Actor({
    id: "manager-user",
    type: "admin",
    context: "ADMIN",
    roles: ["TEAM_MANAGER"],
    permissions: [Permission.WORK_SCHEDULE_READ],
    scopeGrants: {
      workSchedule: ["self", "team"],
    },
    isActive: true,
  });
}

function productionOpsActor(): Actor {
  return new Actor({
    id: "ops-user",
    type: "admin",
    context: "ADMIN",
    roles: ["PRODUCTION_OPS"],
    permissions: [
      Permission.WORK_SCHEDULE_READ,
      Permission.WORK_SCHEDULE_CREATE,
      Permission.WORK_SCHEDULE_UPDATE,
      Permission.WORK_SCHEDULE_MANAGE_LIFECYCLE,
    ],
    scopeGrants: {
      workSchedule: ["global"],
    },
    isActive: true,
  });
}

function adminFullActor(): Actor {
  return new Actor({
    id: "admin-user",
    type: "admin",
    context: "ADMIN",
    roles: ["ADMIN_FULL"],
    permissions: [
      Permission.WORK_SCHEDULE_READ,
      Permission.WORK_SCHEDULE_CREATE,
      Permission.WORK_SCHEDULE_UPDATE,
      Permission.WORK_SCHEDULE_MANAGE_LIFECYCLE,
    ],
    scopeGrants: {
      workSchedule: ["global"],
    },
    isActive: true,
  });
}

function hrActor(): Actor {
  return new Actor({
    id: "hr-user",
    type: "admin",
    context: "ADMIN",
    roles: ["HR_OPERATIONS"],
    permissions: [Permission.WORK_SCHEDULE_READ],
    scopeGrants: {
      workSchedule: ["department"],
    },
    isActive: true,
  });
}

function createRequestPayload() {
  return {
    requestType: "CREATE_SHIFT",
    targetEmploymentProfileId: "ep-managed",
    reason: "Need coverage for livestream booking",
    proposedTitle: "Livestream coverage",
    proposedStartAt: Date.UTC(2026, 4, 25, 9),
    proposedEndAt: Date.UTC(2026, 4, 25, 11),
    proposedStudioResourceIds: ["studio-1"],
  };
}

function seedShift(params?: {
  readonly id?: string;
  readonly startAt?: number;
  readonly endAt?: number;
}): WorkShiftRecord {
  return {
    id: params?.id ?? "shift-1",
    shiftCode: "WS-20260525-0001",
    normalizedShiftCode: "ws-20260525-0001",
    title: "Current shift",
    normalizedTitle: "current shift",
    subjectKind: "EMPLOYMENT_PROFILE",
    subjectEmploymentProfileId: "ep-managed",
    subjectTalentId: null,
    subjectTalentGroupId: null,
    studioResourceIds: ["studio-1"],
    status: "ACTIVE",
    shiftStartAt:
      params?.startAt ?? Date.UTC(2026, 4, 25, 9),
    shiftEndAt:
      params?.endAt ?? Date.UTC(2026, 4, 25, 11),
    description: null,
    externalRef: null,
    sourceType: "MANUAL",
    sourceRosterId: null,
    sourcePatternId: null,
    sourceExceptionId: null,
    sourceGenerationRunId: null,
    sourceRosterMonth: null,
    sourceDepartmentOrgUnitId: null,
    sourceRosterLocalDate: null,
    sourceRosterSlotKey: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

function withTrace<T>(fn: () => Promise<T>): Promise<T> {
  return bindTraceId("test-trace", fn);
}

test("TEAM_MANAGER can create PENDING request for managed member without creating official WorkShift", async () => {
  const requestRepository =
    new MemoryRequestRepository();
  const workShiftRepository =
    new MemoryWorkShiftRepository();
  const service = createService({
    requestRepository,
    workShiftRepository,
  });

  const result = await withTrace(() =>
    service.createRequest(
      teamManagerActor(),
      createRequestPayload(),
    ),
  );

  assert.equal(result.status, "PENDING");
  assert.equal(result.requestType, "CREATE_SHIFT");
  assert.equal(
    result.targetEmploymentProfileId,
    "ep-managed",
  );
  assert.equal(
    result.requestedByUserId,
    "manager-user",
  );
  assert.equal(requestRepository.records.length, 1);
  assert.equal(workShiftRepository.records.length, 0);
});

test("TEAM_MANAGER cannot create request for unmanaged member", async () => {
  const service = createService();

  await assert.rejects(
    withTrace(() =>
      service.createRequest(teamManagerActor(), {
        ...createRequestPayload(),
        targetEmploymentProfileId: "ep-unmanaged",
      }),
    ),
    WorkSchedulePermissionScopeError,
  );
});

test("TEAM_MANAGER cannot approve or reject requests", async () => {
  const requestRepository =
    new MemoryRequestRepository();
  const service = createService({ requestRepository });
  const created = await withTrace(() =>
    service.createRequest(
      teamManagerActor(),
      createRequestPayload(),
    ),
  );

  await assert.rejects(
    withTrace(() =>
      service.approveRequest(teamManagerActor(), {
        requestId: created.id,
      }),
    ),
    SystemInvariantError,
  );
  await assert.rejects(
    withTrace(() =>
      service.rejectRequest(teamManagerActor(), {
        requestId: created.id,
        rejectionReason: "Not aligned",
      }),
    ),
    SystemInvariantError,
  );
});

test("TEAM_MANAGER can cancel own PENDING request but not approved request", async () => {
  const requestRepository =
    new MemoryRequestRepository();
  const service = createService({ requestRepository });
  const pending = await withTrace(() =>
    service.createRequest(
      teamManagerActor(),
      createRequestPayload(),
    ),
  );

  const cancelled = await withTrace(() =>
    service.cancelRequest(teamManagerActor(), {
      requestId: pending.id,
      cancellationReason: "Replacing details",
    }),
  );
  assert.equal(cancelled.status, "CANCELLED");
  assert.equal(
    cancelled.cancelledByUserId,
    "manager-user",
  );

  const approved = await withTrace(async () => {
    const created = await service.createRequest(
      teamManagerActor(),
      createRequestPayload(),
    );
    return service.approveRequest(productionOpsActor(), {
      requestId: created.id,
    });
  });

  await assert.rejects(
    withTrace(() =>
      service.cancelRequest(teamManagerActor(), {
        requestId: approved.id,
      }),
    ),
    WorkScheduleStateError,
  );
});

test("PRODUCTION_OPS approve CREATE_SHIFT applies official WorkShift once and records audit", async () => {
  const requestRepository =
    new MemoryRequestRepository();
  const workShiftRepository =
    new MemoryWorkShiftRepository();
  const audit = new AuditCapture();
  const service = createService({
    requestRepository,
    workShiftRepository,
    audit,
  });
  const created = await withTrace(() =>
    service.createRequest(
      teamManagerActor(),
      createRequestPayload(),
    ),
  );

  assert.equal(workShiftRepository.records.length, 0);

  const approved = await withTrace(() =>
    service.approveRequest(productionOpsActor(), {
      requestId: created.id,
      approvalNote: "Covered by global ops",
    }),
  );

  assert.equal(approved.status, "APPROVED");
  assert.equal(approved.approvedByUserId, "ops-user");
  assert.ok(approved.approvedAt);
  assert.ok(approved.appliedWorkShiftId);
  assert.equal(workShiftRepository.records.length, 1);
  assert.equal(
    workShiftRepository.records[0]?.subjectEmploymentProfileId,
    "ep-managed",
  );
  assert.ok(
    audit.records.length >= 2,
    "request submit and approval audits recorded",
  );

  await assert.rejects(
    withTrace(() =>
      service.approveRequest(productionOpsActor(), {
        requestId: created.id,
      }),
    ),
    WorkScheduleStateError,
  );
});

test("ADMIN_FULL can reject and HR cannot approve in MVP", async () => {
  const requestRepository =
    new MemoryRequestRepository();
  const service = createService({ requestRepository });
  const created = await withTrace(() =>
    service.createRequest(
      teamManagerActor(),
      createRequestPayload(),
    ),
  );

  await assert.rejects(
    withTrace(() =>
      service.approveRequest(hrActor(), {
        requestId: created.id,
      }),
    ),
    SystemInvariantError,
  );

  const rejected = await withTrace(() =>
    service.rejectRequest(adminFullActor(), {
      requestId: created.id,
      rejectionReason: "Coverage no longer needed",
    }),
  );
  assert.equal(rejected.status, "REJECTED");
  assert.equal(rejected.rejectedByUserId, "admin-user");
});

test("approval applies RESCHEDULE_SHIFT and CANCEL_SHIFT only on approval", async () => {
  const requestRepository =
    new MemoryRequestRepository();
  const workShiftRepository =
    new MemoryWorkShiftRepository([seedShift()]);
  const service = createService({
    requestRepository,
    workShiftRepository,
  });

  const rescheduleRequest = await withTrace(() =>
    service.createRequest(teamManagerActor(), {
      requestType: "RESCHEDULE_SHIFT",
      targetEmploymentProfileId: "ep-managed",
      targetWorkShiftId: "shift-1",
      reason: "Move after rehearsal",
      proposedStartAt: Date.UTC(2026, 4, 25, 12),
      proposedEndAt: Date.UTC(2026, 4, 25, 14),
    }),
  );

  assert.equal(
    workShiftRepository.records[0]?.shiftStartAt,
    Date.UTC(2026, 4, 25, 9),
  );

  await withTrace(() =>
    service.approveRequest(productionOpsActor(), {
      requestId: rescheduleRequest.id,
    }),
  );
  assert.equal(
    workShiftRepository.records[0]?.shiftStartAt,
    Date.UTC(2026, 4, 25, 12),
  );

  const cancelRequest = await withTrace(() =>
    service.createRequest(teamManagerActor(), {
      requestType: "CANCEL_SHIFT",
      targetEmploymentProfileId: "ep-managed",
      targetWorkShiftId: "shift-1",
      reason: "Booking cancelled",
    }),
  );
  assert.equal(
    workShiftRepository.records[0]?.status,
    "ACTIVE",
  );

  await withTrace(() =>
    service.approveRequest(productionOpsActor(), {
      requestId: cancelRequest.id,
    }),
  );
  assert.equal(
    workShiftRepository.records[0]?.status,
    "CANCELLED",
  );
});
