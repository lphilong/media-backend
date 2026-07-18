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
import type { ResponsibilityManagedScopeReader } from "@modules/responsibility/domain/responsibility-managed-scope";
import {
  StructuredScopeAuthorityAssignment,
  StructuredScopeAuthorityReader,
  StructuredScopeAuthorityService,
} from "@modules/role/domain/structured-scope-authority";
import type { UserRoleAssignmentRecord } from "@modules/role/domain/role.types";
import { bindTraceId } from "@core/trace/trace.context";
import { WorkScheduleRequestBatchAdminService } from "@modules/work-schedule/admin/admin.work-schedule-request-batch.service";
import {
  WorkScheduleConflictError,
  WorkSchedulePermissionScopeError,
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

class MemoryBatchRepository implements WorkScheduleRequestBatchRepository {
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
            submittedByEmploymentProfileId && batch.clientToken === clientToken,
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
          line.memberEmploymentProfileId === input.memberEmploymentProfileId &&
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
      applicationState: input.applicationState ?? current.applicationState,
      applicationLineage:
        input.applicationLineage ?? current.applicationLineage,
      applicationIdempotencyKey:
        input.applicationIdempotencyKey ?? current.applicationIdempotencyKey,
      applicationPayloadFingerprint:
        input.applicationPayloadFingerprint ??
        current.applicationPayloadFingerprint,
      emergencyOverrideReason:
        input.emergencyOverrideReason ?? current.emergencyOverrideReason,
      approvedAt: input.approvedAt ?? current.approvedAt,
      approvedByActorId: input.approvedByActorId ?? current.approvedByActorId,
      rejectedAt: input.rejectedAt ?? current.rejectedAt,
      rejectedByActorId: input.rejectedByActorId ?? current.rejectedByActorId,
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

class MemoryCodeSequenceRepository implements WorkScheduleCodeSequenceRepository {
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
  readonly structuredAuthority?: StructuredScopeAuthorityService;
  readonly employmentProfileAccess?: WorkScheduleEmploymentProfileReadonlyAccess;
  readonly managedScope?: ResponsibilityManagedScopeReader;
  readonly mutationBridge?: AuthoritativeAdminMutationBridge;
}): WorkScheduleRequestBatchAdminService {
  return new WorkScheduleRequestBatchAdminService(
    params?.batchRepository ?? new MemoryBatchRepository(),
    params?.workShiftRepository ?? new MemoryWorkShiftRepository(),
    new MemoryCodeSequenceRepository(),
    params?.employmentProfileAccess ?? employmentProfileReadonlyAccess,
    studioResourceReadonlyAccess,
    params?.managedScope ?? managedScopeReader,
    (params?.audit ?? new AuditCapture()) as unknown as AuditGuard,
    params?.mutationBridge ?? mutationBridge,
    params?.structuredAuthority ?? defaultStructuredAuthority(),
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

const studioResourceReadonlyAccess: WorkScheduleStudioResourceReadonlyAccess = {
  async findById(studioResourceId: string) {
    return { id: studioResourceId, operationalStatus: "ACTIVE" };
  },
};

const managedScopeReader = {
  async resolveManagedScopeByResponsibleEmploymentProfile(input: {
    readonly responsibleEmploymentProfileId: string;
  }) {
    return input.responsibleEmploymentProfileId === "ep-manager"
      ? {
          talentGroupIds: ["group-managed"],
          orgUnitIds: ["org-managed"],
          orgUnitScopes: [
            {
              orgUnitId: "org-managed",
              role: "UNIT_MANAGER",
              includeDescendants: false,
              actionMask: [],
              isPrimary: true,
            },
          ],
        }
      : { talentGroupIds: [], orgUnitIds: [], orgUnitScopes: [] };
  },
};

function sharedMemberManagedScope(
  targetType: "ORG_UNIT" | "TALENT_GROUP",
  targetIds: readonly string[],
): ResponsibilityManagedScopeReader {
  return {
    async resolveManagedScopeByResponsibleEmploymentProfile() {
      return {
        orgUnitIds: targetType === "ORG_UNIT" ? [...targetIds] : [],
        talentGroupIds: targetType === "TALENT_GROUP" ? [...targetIds] : [],
        orgUnitScopes:
          targetType === "ORG_UNIT"
            ? targetIds.map((orgUnitId) => ({
                orgUnitId,
                role: "UNIT_MANAGER",
                includeDescendants: false,
                actionMask: [],
                isPrimary: true,
              }))
            : [],
      };
    },
  };
}

function sharedMemberStructuredAuthority(
  targetType: "ORG_UNIT" | "TALENT_GROUP",
  targetIds: readonly string[],
): StructuredScopeAuthorityService {
  return new StructuredScopeAuthorityService(
    {
      async listByUserId(userId: string) {
        return [
          structuredRecord({
            userId: "manager-user",
            permissions: [Permission.WORK_SCHEDULE_READ],
            structuredScopeGrants: targetIds.map((targetId) => ({
              scopeType:
                targetType === "ORG_UNIT"
                  ? "managedOrgUnit"
                  : "managedTalentGroup",
              targetId,
            })),
          }),
        ].filter((record) => record.assignment.userId === userId);
      },
    } satisfies StructuredScopeAuthorityReader,
    () => NOW,
  );
}

function sharedMemberEmploymentAccess(
  targetType: "ORG_UNIT" | "TALENT_GROUP",
  targetIds: readonly string[],
): WorkScheduleEmploymentProfileReadonlyAccess {
  const manager = {
    id: "ep-manager",
    employmentStatus: "ACTIVE" as const,
    orgUnitId: "org-manager",
    linkedUserId: "manager-user",
    ref: { id: "ep-manager", code: "EP-MANAGER", displayName: "Manager" },
  };
  const shared = {
    id: "ep-shared",
    employmentStatus: "ACTIVE" as const,
    orgUnitId: "org-a",
    linkedUserId: null,
    ref: { id: "ep-shared", code: "EP-SHARED", displayName: "Shared Member" },
  };

  return {
    async findById(id: string) {
      return id === manager.id ? manager : id === shared.id ? shared : null;
    },
    async findByLinkedUserId(linkedUserId: string) {
      return linkedUserId === manager.linkedUserId ? manager : null;
    },
    async listIdsByActiveTalentGroupIds() {
      return targetType === "TALENT_GROUP" ? [shared.id] : [];
    },
    async listIdsByOrgUnitId(orgUnitId: string) {
      return targetType === "ORG_UNIT" && targetIds.includes(orgUnitId)
        ? [shared.id]
        : [];
    },
    async listByOrgUnitId(orgUnitId: string) {
      return targetType === "ORG_UNIT" && targetIds.includes(orgUnitId)
        ? [shared]
        : [];
    },
    async listTalentGroupMemberEmploymentProfileResolutions(groupId: string) {
      return targetType === "TALENT_GROUP" && targetIds.includes(groupId)
        ? [
            {
              memberId: "shared-member",
              groupId,
              talentId: "shared-talent",
              membershipStatus: "ACTIVE" as const,
              talentOperationalStatus: "ACTIVE" as const,
              linkedEmploymentProfileId: shared.id,
              employmentProfile: shared,
            },
          ]
        : [];
    },
  };
}

function defaultStructuredAuthority(): StructuredScopeAuthorityService {
  return new StructuredScopeAuthorityService(
    {
      async listByUserId(userId: string) {
        return [
          structuredRecord({
            userId: "manager-user",
            permissions: [Permission.WORK_SCHEDULE_READ],
            structuredScopeGrants: [
              { scopeType: "managedOrgUnit", targetId: "org-managed" },
              {
                scopeType: "managedTalentGroup",
                targetId: "group-managed",
              },
            ],
          }),
        ].filter((record) => record.assignment.userId === userId);
      },
    } satisfies StructuredScopeAuthorityReader,
    () => NOW,
  );
}

function structuredRecord(input: {
  readonly userId: string;
  readonly permissions: readonly Permission[];
  readonly structuredScopeGrants: UserRoleAssignmentRecord["structuredScopeGrants"];
}): StructuredScopeAuthorityAssignment {
  return {
    assignment: {
      assignmentId: `${input.userId}-assignment`,
      roleId: `${input.userId}-role`,
      userId: input.userId,
      structuredScopeGrants: input.structuredScopeGrants,
      state: "ACTIVE",
      effectiveAt: NOW - 1,
      expiresAt: null,
      revokedAt: null,
      origin: "DIRECT",
      bundleOrigin: null,
      reason: null,
      createdAt: NOW - 1,
      updatedAt: NOW - 1,
    },
    role: {
      id: `${input.userId}-role`,
      state: "ACTIVE",
      permissions: input.permissions,
    },
  };
}

function managerActor(id = "manager-user"): Actor {
  return new Actor({
    id,
    type: "admin",
    context: "ADMIN",
    accountContexts: ["MANAGER_CONSOLE"],
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

function sameCanonicalUserOpsActor(): Actor {
  return new Actor({
    id: "manager-user",
    type: "admin",
    context: "ADMIN",
    accountContexts: ["MANAGER_CONSOLE", "ADMIN_CONSOLE"],
    roles: ["TEAM_MANAGER", "PRODUCTION_OPS"],
    permissions: [
      Permission.WORK_SCHEDULE_READ,
      Permission.WORK_SCHEDULE_CREATE,
      Permission.WORK_SCHEDULE_UPDATE,
      Permission.WORK_SCHEDULE_MANAGE_LIFECYCLE,
    ],
    scopeGrants: { workSchedule: ["team", "global"] },
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
  readonly rosterTarget?: {
    readonly type: "ORG_UNIT" | "TALENT_GROUP";
    readonly id: string;
  };
}): WorkShiftRecord {
  const startAt = params?.startAt ?? JUNE_START;
  return {
    id: params?.id ?? "shift-1",
    shiftCode: "WS-20260612-0001",
    normalizedShiftCode: "ws-20260612-0001",
    title: "Current shift",
    normalizedTitle: "current shift",
    subjectKind: "EMPLOYMENT_PROFILE",
    subjectEmploymentProfileId: params?.memberEmploymentProfileId ?? "ep-org",
    subjectTalentId: null,
    subjectTalentGroupId: null,
    studioResourceIds: [],
    status: params?.status ?? "ACTIVE",
    shiftStartAt: startAt,
    shiftEndAt: startAt + 60 * 60 * 1000,
    description: null,
    externalRef: null,
    sourceType: params?.rosterTarget ? "ROSTER_GENERATED" : "MANUAL",
    sourceRosterId: params?.rosterTarget ? "roster-1" : null,
    sourcePatternId: null,
    sourceExceptionId: null,
    sourceGenerationRunId: null,
    sourceRosterMonth: params?.rosterTarget ? "2026-06" : null,
    sourceDepartmentOrgUnitId: null,
    sourceRosterTargetType: params?.rosterTarget?.type ?? null,
    sourceRosterTargetId: params?.rosterTarget?.id ?? null,
    sourceRosterTargetMode: params?.rosterTarget ? "EXACT_ONLY" : null,
    sourceMemberIdentityType: null,
    sourceRosterLocalDate: params?.rosterTarget ? "2026-06-12" : null,
    sourceRosterSlotKey: params?.rosterTarget ? "STANDARD" : null,
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

  for (const memberEmploymentProfileId of ["ep-descendant", "ep-reporting"]) {
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

test("maker Manager cannot cancel own pending request batch or line", async () => {
  const batchRepository = new MemoryBatchRepository();
  const workShiftRepository = new MemoryWorkShiftRepository();
  const audit = new AuditCapture();
  let mutationCalls = 0;
  const service = createService({
    batchRepository,
    workShiftRepository,
    audit,
    mutationBridge: {
      async execute(_params, mutate) {
        mutationCalls += 1;
        return mutate({} as ClientSession, {
          markAuthSecurityTruthChanged() {},
          markExplicitNoOpSuccess() {},
        });
      },
    },
  });
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
  const beforeBatches = structuredClone(batchRepository.batches);
  const beforeLines = structuredClone(batchRepository.lines);
  const beforeShifts = structuredClone(workShiftRepository.records);
  const beforeAuditCount = audit.records.length;
  const beforeMutationCalls = mutationCalls;

  await assert.rejects(
    withTrace(() =>
      service.cancelManagerLine(managerActor(), {
        batchId: batch.id,
        lineId,
        cancellationReason: "Cancel this line because staffing changed",
      }),
    ),
    WorkSchedulePermissionScopeError,
  );

  await assert.rejects(
    withTrace(() =>
      service.cancelManagerBatch(managerActor(), {
        batchId: batch.id,
        cancellationReason: "Cancel entire batch because staffing changed",
      }),
    ),
    WorkSchedulePermissionScopeError,
  );

  assert.deepEqual(batchRepository.batches, beforeBatches);
  assert.deepEqual(batchRepository.lines, beforeLines);
  assert.deepEqual(workShiftRepository.records, beforeShifts);
  assert.equal(audit.records.length, beforeAuditCount);
  assert.equal(mutationCalls, beforeMutationCalls);
});

test("a different Manager still cannot cancel another Manager request batch", async () => {
  const batchRepository = new MemoryBatchRepository();
  const service = createService({ batchRepository });
  const batch = await withTrace(() =>
    service.submitManagerBatch(managerActor(), submitPayload([createLine()])),
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
});

test("unauthorized Manager request submission and cancellation perform no repository mutation", async () => {
  const batchRepository = new MemoryBatchRepository();
  const authorized = createService({ batchRepository });
  const batch = await withTrace(() =>
    authorized.submitManagerBatch(
      managerActor(),
      submitPayload([createLine()]),
    ),
  );
  const beforeBatches = structuredClone(batchRepository.batches);
  const beforeLines = structuredClone(batchRepository.lines);
  const unauthorized = createService({
    batchRepository,
    structuredAuthority: new StructuredScopeAuthorityService(
      {
        async listByUserId() {
          return [];
        },
      },
      () => NOW,
    ),
  });

  await assert.rejects(
    withTrace(() =>
      unauthorized.submitManagerBatch(
        managerActor(),
        submitPayload([createLine()]),
      ),
    ),
    WorkSchedulePermissionScopeError,
  );
  await assert.rejects(
    withTrace(() =>
      unauthorized.cancelManagerBatch(managerActor(), {
        batchId: batch.id,
        cancellationReason: "Authority was removed before cancellation",
      }),
    ),
    WorkSchedulePermissionScopeError,
  );
  assert.deepEqual(batchRepository.batches, beforeBatches);
  assert.deepEqual(batchRepository.lines, beforeLines);
});

test("shared members cannot bridge Manager request history or cancellation to an unauthorized roster target", async () => {
  for (const scenario of [
    {
      type: "ORG_UNIT" as const,
      authorizedTarget: "org-b",
      retainedTarget: "org-a",
    },
    {
      type: "TALENT_GROUP" as const,
      authorizedTarget: "group-b",
      retainedTarget: "group-a",
    },
  ]) {
    const batchRepository = new MemoryBatchRepository();
    const workShiftRepository = new MemoryWorkShiftRepository([
      seedShift({
        id: `shift-${scenario.type}`,
        memberEmploymentProfileId: "ep-shared",
        rosterTarget: { type: scenario.type, id: scenario.authorizedTarget },
      }),
    ]);
    const authorized = createService({
      batchRepository,
      workShiftRepository,
      employmentProfileAccess: sharedMemberEmploymentAccess(scenario.type, [
        scenario.authorizedTarget,
      ]),
      managedScope: sharedMemberManagedScope(scenario.type, [
        scenario.authorizedTarget,
      ]),
      structuredAuthority: sharedMemberStructuredAuthority(scenario.type, [
        scenario.authorizedTarget,
      ]),
    });
    const batch = await withTrace(() =>
      authorized.submitManagerBatch(
        managerActor(),
        submitPayload([
          {
            requestType: "CANCEL_SHIFT",
            memberEmploymentProfileId: "ep-shared",
            workShiftId: `shift-${scenario.type}`,
            reason: "Cancel because the roster coverage is no longer needed",
          },
        ]),
      ),
    );

    assert.equal(
      (await authorized.listManagerBatches(managerActor(), {})).items.length,
      1,
      `${scenario.type} exact target remains visible while authorized`,
    );
    await assert.doesNotReject(() =>
      authorized.getManagerBatchDetail(managerActor(), { batchId: batch.id }),
    );

    const afterTargetBLoss = createService({
      batchRepository,
      workShiftRepository,
      employmentProfileAccess: sharedMemberEmploymentAccess(scenario.type, [
        scenario.retainedTarget,
      ]),
      managedScope: sharedMemberManagedScope(scenario.type, [
        scenario.retainedTarget,
      ]),
      structuredAuthority: sharedMemberStructuredAuthority(scenario.type, [
        scenario.retainedTarget,
      ]),
    });
    const beforeBatches = structuredClone(batchRepository.batches);
    const beforeLines = structuredClone(batchRepository.lines);

    assert.deepEqual(
      (await afterTargetBLoss.listManagerBatches(managerActor(), {})).items,
      [],
      `${scenario.type} shared member does not expose Target B history after scope loss`,
    );
    await assert.rejects(
      () =>
        afterTargetBLoss.getManagerBatchDetail(managerActor(), {
          batchId: batch.id,
        }),
      WorkSchedulePermissionScopeError,
    );
    await assert.rejects(
      withTrace(() =>
        afterTargetBLoss.cancelManagerBatch(managerActor(), {
          batchId: batch.id,
          cancellationReason: "Target B authority was removed",
        }),
      ),
      WorkSchedulePermissionScopeError,
    );
    await assert.rejects(
      withTrace(() =>
        afterTargetBLoss.cancelManagerLine(managerActor(), {
          batchId: batch.id,
          lineId: batch.lines[0]!.id,
          cancellationReason: "Target B authority was removed",
        }),
      ),
      WorkSchedulePermissionScopeError,
    );
    assert.deepEqual(batchRepository.batches, beforeBatches);
    assert.deepEqual(batchRepository.lines, beforeLines);

    const exactTargetService = createService({
      batchRepository: new MemoryBatchRepository(),
      workShiftRepository: new MemoryWorkShiftRepository([
        seedShift({
          id: `shift-authorized-${scenario.type}`,
          memberEmploymentProfileId: "ep-shared",
          rosterTarget: { type: scenario.type, id: scenario.authorizedTarget },
        }),
      ]),
      employmentProfileAccess: sharedMemberEmploymentAccess(scenario.type, [
        scenario.authorizedTarget,
      ]),
      managedScope: sharedMemberManagedScope(scenario.type, [
        scenario.authorizedTarget,
      ]),
      structuredAuthority: sharedMemberStructuredAuthority(scenario.type, [
        scenario.authorizedTarget,
      ]),
    });
    const authorizedBatch = await withTrace(() =>
      exactTargetService.submitManagerBatch(
        managerActor(),
        submitPayload([
          {
            requestType: "CANCEL_SHIFT",
            memberEmploymentProfileId: "ep-shared",
            workShiftId: `shift-authorized-${scenario.type}`,
            reason: "Cancel with exact roster-target authority",
          },
        ]),
      ),
    );
    await assert.rejects(
      withTrace(() =>
        exactTargetService.cancelManagerBatch(managerActor(), {
          batchId: authorizedBatch.id,
          cancellationReason: "Maker cancellation remains prohibited",
        }),
      ),
      WorkSchedulePermissionScopeError,
    );
  }
});

test("same canonical User Admin decisions fail before replay and all request-batch mutation", async () => {
  const batchRepository = new MemoryBatchRepository();
  const workShiftRepository = new MemoryWorkShiftRepository();
  const audit = new AuditCapture();
  let mutationCalls = 0;
  const service = createService({
    batchRepository,
    workShiftRepository,
    audit,
    mutationBridge: {
      async execute(_params, mutate) {
        mutationCalls += 1;
        return mutate({} as ClientSession, {
          markAuthSecurityTruthChanged() {},
          markExplicitNoOpSuccess() {},
        });
      },
    },
  });
  const batch = await withTrace(() =>
    service.submitManagerBatch(
      managerActor(),
      submitPayload([
        createLine({ startAt: JUNE_START }),
        createLine({ startAt: JUNE_START + 3 * 60 * 60 * 1000 }),
      ]),
    ),
  );
  const checker = sameCanonicalUserOpsActor();
  const command = {
    batchId: batch.id,
    lineIds: batch.lines.map((line) => line.id),
    expectedRequestVersions: Object.fromEntries(
      batch.lines.map((line) => [line.id, line.updatedAt]),
    ),
    idempotencyKey: "same-user-batch-decision",
  };
  const beforeBatches = structuredClone(batchRepository.batches);
  const beforeLines = structuredClone(batchRepository.lines);
  const beforeShifts = structuredClone(workShiftRepository.records);
  const beforeAuditCount = audit.records.length;
  const beforeMutationCalls = mutationCalls;

  await assert.rejects(
    withTrace(() => service.approveAdminLines(checker, command)),
    WorkSchedulePermissionScopeError,
  );
  await assert.rejects(
    withTrace(() =>
      service.rejectAdminLines(checker, {
        ...command,
        rejectionReason: "Same maker cannot reject selected lines",
      }),
    ),
    WorkSchedulePermissionScopeError,
  );
  await assert.rejects(
    withTrace(() =>
      service.cancelAdminLines(checker, {
        ...command,
        cancellationReason: "Same maker cannot cancel selected lines",
      }),
    ),
    WorkSchedulePermissionScopeError,
  );

  assert.deepEqual(batchRepository.batches, beforeBatches);
  assert.deepEqual(batchRepository.lines, beforeLines);
  assert.deepEqual(workShiftRepository.records, beforeShifts);
  assert.equal(audit.records.length, beforeAuditCount);
  assert.equal(mutationCalls, beforeMutationCalls);
});

test("same canonical User request-batch approval is denied before exact replay success", async () => {
  const batchRepository = new MemoryBatchRepository();
  const workShiftRepository = new MemoryWorkShiftRepository();
  const audit = new AuditCapture();
  let mutationCalls = 0;
  const service = createService({
    batchRepository,
    workShiftRepository,
    audit,
    mutationBridge: {
      async execute(_params, mutate) {
        mutationCalls += 1;
        return mutate({} as ClientSession, {
          markAuthSecurityTruthChanged() {},
          markExplicitNoOpSuccess() {},
        });
      },
    },
  });
  const batch = await withTrace(() =>
    service.submitManagerBatch(managerActor(), submitPayload([createLine()])),
  );
  const replayCommand = {
    batchId: batch.id,
    lineIds: [batch.lines[0]!.id],
    expectedRequestVersions: {
      [batch.lines[0]!.id]: batch.lines[0]!.updatedAt,
    },
    idempotencyKey: "same-user-replay-guard",
  };
  await withTrace(() => service.approveAdminLines(opsActor(), replayCommand));
  const beforeBatches = structuredClone(batchRepository.batches);
  const beforeLines = structuredClone(batchRepository.lines);
  const beforeShifts = structuredClone(workShiftRepository.records);
  const beforeAuditCount = audit.records.length;
  const beforeMutationCalls = mutationCalls;

  await assert.rejects(
    withTrace(() =>
      service.approveAdminLines(sameCanonicalUserOpsActor(), replayCommand),
    ),
    WorkSchedulePermissionScopeError,
  );
  assert.deepEqual(batchRepository.batches, beforeBatches);
  assert.deepEqual(batchRepository.lines, beforeLines);
  assert.deepEqual(workShiftRepository.records, beforeShifts);
  assert.equal(audit.records.length, beforeAuditCount);
  assert.equal(mutationCalls, beforeMutationCalls);
});

test("invalid request-batch maker identity fails closed before Admin mutation", async () => {
  for (const invalidMakerId of [undefined, null, "", "   ", " manager-user"] as const) {
    const batchRepository = new MemoryBatchRepository();
    let mutationCalls = 0;
    const service = createService({
      batchRepository,
      mutationBridge: {
        async execute(_params, mutate) {
          mutationCalls += 1;
          return mutate({} as ClientSession, {
            markAuthSecurityTruthChanged() {},
            markExplicitNoOpSuccess() {},
          });
        },
      },
    });
    const batch = await withTrace(() =>
      service.submitManagerBatch(managerActor(), submitPayload([createLine()])),
    );
    batchRepository.batches[0] = {
      ...batchRepository.batches[0]!,
      submittedByActorId: invalidMakerId as string,
    };
    const beforeBatches = structuredClone(batchRepository.batches);
    const beforeLines = structuredClone(batchRepository.lines);
    const beforeMutationCalls = mutationCalls;

    await assert.rejects(
      withTrace(() =>
        service.rejectAdminLines(opsActor(), {
          batchId: batch.id,
          lineIds: [batch.lines[0]!.id],
          rejectionReason: "Invalid maker must fail closed",
        }),
      ),
      WorkSchedulePermissionScopeError,
    );
    assert.deepEqual(batchRepository.batches, beforeBatches);
    assert.deepEqual(batchRepository.lines, beforeLines);
    assert.equal(mutationCalls, beforeMutationCalls);
  }
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

  assert.equal(batch.lines[1]?.sourceWorkShiftVersion, 1);
  assert.equal(batch.lines[2]?.sourceWorkShiftVersion, 1);

  const first = await withTrace(() =>
    service.approveAdminLines(opsActor(), {
      batchId: batch.id,
      lineIds: [batch.lines[0]!.id],
      expectedRequestVersions: {
        [batch.lines[0]!.id]: batch.lines[0]!.updatedAt,
      },
      idempotencyKey: "approve-create-1",
      approvalNote: "Approved",
    }),
  );
  assert.equal(first.status, "PARTIALLY_APPROVED");
  assert.equal(first.lineCounts.approved, 1);
  const replay = await withTrace(() =>
    service.approveAdminLines(opsActor(), {
      batchId: batch.id,
      lineIds: [batch.lines[0]!.id],
      expectedRequestVersions: {
        [batch.lines[0]!.id]: batch.lines[0]!.updatedAt,
      },
      idempotencyKey: "approve-create-1",
      approvalNote: "Approved",
    }),
  );
  assert.equal(
    replay.lines[0]?.appliedWorkShiftId,
    first.lines[0]?.appliedWorkShiftId,
  );
  await assert.rejects(
    withTrace(() =>
      service.approveAdminLines(opsActor(), {
        batchId: batch.id,
        lineIds: [batch.lines[0]!.id],
        expectedRequestVersions: {
          [batch.lines[0]!.id]: batch.lines[0]!.updatedAt,
        },
        idempotencyKey: "approve-create-1",
        approvalNote: "Different payload",
      }),
    ),
    /IDEMPOTENCY_CONFLICT/u,
  );

  const final = await withTrace(() =>
    service.approveAdminLines(opsActor(), {
      batchId: batch.id,
      lineIds: [batch.lines[1]!.id, batch.lines[2]!.id],
      expectedRequestVersions: {
        [batch.lines[1]!.id]: batch.lines[1]!.updatedAt,
        [batch.lines[2]!.id]: batch.lines[2]!.updatedAt,
      },
      expectedWorkShiftVersions: {
        [batch.lines[1]!.id]: Number(batch.lines[1]!.sourceWorkShiftVersion),
        [batch.lines[2]!.id]: Number(batch.lines[2]!.sourceWorkShiftVersion),
      },
      expectedSourceGenerationRunIds: {
        [batch.lines[1]!.id]: batch.lines[1]!.sourceGenerationRunId ?? null,
        [batch.lines[2]!.id]: batch.lines[2]!.sourceGenerationRunId ?? null,
      },
      idempotencyKey: "approve-reschedule-cancel-1",
    }),
  );
  assert.equal(final.status, "APPROVED");
  assert.equal(final.lineCounts.approved, 3);
  assert.equal(
    workShiftRepository.records.find((shift) => shift.id === "shift-reschedule")
      ?.status,
    "CANCELLED",
  );
  assert.equal(
    workShiftRepository.records.find(
      (shift) => shift.id === final.lines[1]?.appliedWorkShiftId,
    )?.shiftStartAt,
    JUNE_START + 4 * 60 * 60 * 1000,
  );
  assert.equal(final.lines[1]?.applicationState, "APPROVED_APPLIED");
  assert.equal(
    final.lines[1]?.applicationLineage?.before?.workShiftId,
    "shift-reschedule",
  );
  assert.equal(
    final.lines[1]?.applicationLineage?.after?.workShiftId,
    final.lines[1]?.appliedWorkShiftId,
  );
  assert.equal(
    workShiftRepository.records.find((shift) => shift.id === "shift-cancel")
      ?.status,
    "CANCELLED",
  );
  assert.equal(workShiftRepository.records.length, 4);
});

test("admin approval fails closed when request or source WorkShift versions changed", async () => {
  const workShiftRepository = new MemoryWorkShiftRepository([
    seedShift({ id: "shift-stale", memberEmploymentProfileId: "ep-org" }),
  ]);
  const service = createService({ workShiftRepository });
  const staleRequestBatch = await withTrace(() =>
    service.submitManagerBatch(managerActor(), submitPayload([createLine()])),
  );

  const staleRequestResult = await withTrace(() =>
    service.approveAdminLines(opsActor(), {
      batchId: staleRequestBatch.id,
      lineIds: [staleRequestBatch.lines[0]!.id],
      expectedRequestVersions: {
        [staleRequestBatch.lines[0]!.id]: 999,
      },
      idempotencyKey: "approve-stale-request-1",
    }),
  );
  assert.equal(staleRequestResult.lines[0]?.status, "SOURCE_CHANGED");
  assert.match(
    staleRequestResult.lines[0]?.failureReason ?? "",
    /SOURCE_CHANGED/u,
  );

  const staleShiftBatch = await withTrace(() =>
    service.submitManagerBatch(
      managerActor(),
      submitPayload([
        {
          requestType: "CANCEL_SHIFT",
          memberEmploymentProfileId: "ep-org",
          workShiftId: "shift-stale",
          reason: "Cancel this shift after checking the official source",
        },
      ]),
    ),
  );
  await assert.rejects(
    withTrace(() =>
      service.approveAdminLines(opsActor(), {
        batchId: staleShiftBatch.id,
        lineIds: [staleShiftBatch.lines[0]!.id],
        expectedRequestVersions: {
          [staleShiftBatch.lines[0]!.id]: Number(
            staleShiftBatch.lines[0]!.updatedAt,
          ),
        },
        idempotencyKey: "approve-missing-shift-source-1",
      }),
    ),
    /expectedWorkShiftVersions/u,
  );
  workShiftRepository.records[0] = {
    ...workShiftRepository.records[0]!,
    updatedAt: 999,
  };
  const staleShiftResult = await withTrace(() =>
    service.approveAdminLines(opsActor(), {
      batchId: staleShiftBatch.id,
      lineIds: [staleShiftBatch.lines[0]!.id],
      expectedRequestVersions: {
        [staleShiftBatch.lines[0]!.id]: Number(
          staleShiftBatch.lines[0]!.updatedAt,
        ),
      },
      expectedWorkShiftVersions: {
        [staleShiftBatch.lines[0]!.id]: Number(
          staleShiftBatch.lines[0]!.sourceWorkShiftVersion,
        ),
      },
      expectedSourceGenerationRunIds: {
        [staleShiftBatch.lines[0]!.id]:
          staleShiftBatch.lines[0]!.sourceGenerationRunId ?? null,
      },
      idempotencyKey: "approve-stale-shift-1",
    }),
  );
  assert.equal(staleShiftResult.lines[0]?.status, "SOURCE_CHANGED");
  assert.match(
    staleShiftResult.lines[0]?.failureReason ?? "",
    /SOURCE_CHANGED/u,
  );
  assert.equal(workShiftRepository.records[0]?.status, "ACTIVE");
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
      expectedRequestVersions: {
        [batch.lines[0]!.id]: batch.lines[0]!.updatedAt,
      },
      idempotencyKey: "approve-conflict-1",
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

test("approval-time conflict uses canonical APPLICATION_CONFLICT and terminal failed-only batch derives REJECTED", async () => {
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
      expectedRequestVersions: {
        [batch.lines[0]!.id]: batch.lines[0]!.updatedAt,
      },
      idempotencyKey: "approve-dto-1",
    }),
  );

  assert.equal(result.status, "REJECTED");
  assert.equal(result.lineCounts.failedToApply, 1);
  assert.equal(result.lines[0]?.status, "APPLICATION_CONFLICT");
  assert.match(result.lines[0]?.failureReason ?? "", /overlap/i);
  assert.equal(workShiftRepository.records.length, 0);
});

test("production request path persists lead-time SLA and requires audited emergency override", async () => {
  const workShiftRepository = new MemoryWorkShiftRepository();
  const service = createService({ workShiftRepository });
  const batch = await withTrace(() =>
    service.submitManagerBatch(
      managerActor(),
      submitPayload([createLine({ startAt: NOW + 3 * 60 * 60 * 1000 })]),
    ),
  );
  const line = batch.lines[0]!;
  assert.equal(line.leadTimeClassification, "EMERGENCY");
  assert.equal(line.decisionSlaMinutes, null);

  await assert.rejects(
    withTrace(() =>
      service.approveAdminLines(opsActor(), {
        batchId: batch.id,
        lineIds: [line.id],
        expectedRequestVersions: { [line.id]: line.updatedAt },
        idempotencyKey: "emergency-approval-1",
      }),
    ),
    /EMERGENCY_REASON_REQUIRED/u,
  );
  assert.equal(workShiftRepository.records.length, 0);

  const approved = await withTrace(() =>
    service.approveAdminLines(opsActor(), {
      batchId: batch.id,
      lineIds: [line.id],
      expectedRequestVersions: { [line.id]: line.updatedAt },
      idempotencyKey: "emergency-approval-1",
      emergencyOverrideReason: "Urgent operational coverage approved by Ops",
    }),
  );
  assert.equal(approved.lines[0]?.applicationState, "APPROVED_APPLIED");
  assert.equal(
    approved.lines[0]?.emergencyOverrideReason,
    "Urgent operational coverage approved by Ops",
  );
  assert.equal(workShiftRepository.records.length, 1);
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
      expectedRequestVersions: {
        [batch.lines[0]!.id]: batch.lines[0]!.updatedAt,
      },
      idempotencyKey: "approve-dto-1",
    }),
  );
  const exposed = WorkScheduleRequestBatchAdminExposure.exposeDetail(approved);
  const serialized = JSON.stringify(exposed);

  assert.equal("submittedByActorId" in exposed, false);
  assert.equal(serialized.includes("approvedByActorId"), false);
  assert.equal(serialized.includes("ops-user"), false);
});
