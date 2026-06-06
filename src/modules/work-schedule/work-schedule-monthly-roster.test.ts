import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { MongoServerError, type ClientSession } from "mongodb";
import { Actor } from "@core/actor/actor";
import type {
  AuthoritativeAdminMutationBridge,
  AuthoritativeMutationControls,
} from "@core/application/authoritative-admin-mutation.bridge";
import type { AuditGuard } from "@core/audit/audit.guard";
import { SystemInvariantError } from "@core/error/system-error";
import { Permission } from "@core/permission/permission.enum";
import { bindTraceId } from "@core/trace/trace.context";
import { MonthlyRosterAdminQueryService } from "@modules/work-schedule/admin/admin.monthly-roster.query-service";
import { MonthlyRosterAdminService } from "@modules/work-schedule/admin/admin.monthly-roster.service";
import { buildMonthlyRosterPreview } from "@modules/work-schedule/domain/work-schedule-roster-preview";
import type { WorkScheduleReferencedEmploymentProfile } from "@modules/work-schedule/domain/work-schedule-employment-profile-readonly-access";
import type { WorkScheduleReferencedOrgUnit } from "@modules/work-schedule/domain/work-schedule-org-unit-readonly-access";
import type { WorkScheduleReferencedStudioResource } from "@modules/work-schedule/domain/work-schedule-studio-resource-readonly-access";
import type { WorkScheduleCodeSequenceRepository } from "@modules/work-schedule/domain/work-schedule-code-sequence.repository";
import {
  WorkScheduleConflictError,
  WorkScheduleInvalidSubjectReferenceError,
  WorkScheduleOverlapConflictError,
  WorkSchedulePermissionScopeError,
  WorkScheduleStateError,
  WorkScheduleValidationError,
} from "@modules/work-schedule/domain/work-schedule.errors";
import type {
  AddHolidayCalendarEntryInput,
  AddRosterExceptionInput,
  HolidayCalendarRepository,
  InsertHolidayCalendarInput,
  InsertMonthlyRosterInput,
  InsertWorkPatternInput,
  MonthlyRosterRepository,
  PublishMonthlyRosterInput,
  RemoveHolidayCalendarEntryInput,
  RemoveRosterExceptionInput,
  TransitionHolidayCalendarStatusInput,
  TransitionMonthlyRosterStatusInput,
  TransitionWorkPatternStatusInput,
  UpdateHolidayCalendarEntryInput,
  UpdateHolidayCalendarInput,
  UpdateMonthlyRosterDraftInput,
  UpdateRosterExceptionInput,
  UpdateWorkPatternInput,
  WorkPatternRepository,
  WorkShiftOverlapResourceCheckInput,
  WorkShiftOverlapSubjectCheckInput,
  WorkShiftRepository,
} from "@modules/work-schedule/domain/work-schedule.repository";
import type {
  UpdateWorkScheduleAvailabilityLineApplyStateInput,
  WorkScheduleAvailabilityBatchRepository,
} from "@modules/work-schedule/domain/work-schedule-availability.repository";
import type {
  WorkScheduleAvailabilityBatchRecord,
  WorkScheduleAvailabilityLineRecord,
} from "@modules/work-schedule/domain/work-schedule-availability.types";
import type {
  HolidayCalendarRecord,
  HolidayCalendarStatus,
  MonthlyRosterRecord,
  MonthlyRosterStatus,
  RosterExceptionRecord,
  WorkPatternRecord,
  WorkPatternStatus,
  WorkShiftRecord,
} from "@modules/work-schedule/domain/work-schedule.types";
import { MonthlyRosterAdminExposure } from "@modules/work-schedule/shared/work-schedule.exposure";
import { NativeMongoMonthlyRosterReadRepository } from "@infra/mongo/work-schedule/monthly-roster.read-repository";

class MemoryMonthlyRosterRepository
  implements MonthlyRosterRepository
{
  readonly records: MonthlyRosterRecord[] = [];

  constructor(seed: readonly MonthlyRosterRecord[] = []) {
    this.records.push(...seed);
  }

  async insert(
    roster: InsertMonthlyRosterInput,
  ): Promise<MonthlyRosterRecord> {
    if (
      this.records.some(
        (record) =>
          record.rosterCode === roster.rosterCode ||
          (record.status !== "ARCHIVED" &&
            record.rosterMonth === roster.rosterMonth &&
            record.targetType === roster.targetType &&
            record.targetOrgUnitId ===
              roster.targetOrgUnitId &&
            record.targetTalentGroupId ===
              roster.targetTalentGroupId),
      )
    ) {
      throw new MongoServerError({
        message: "duplicate key",
        code: 11000,
      });
    }

    this.records.push(roster);
    return roster;
  }

  async findById(
    monthlyRosterId: string,
  ): Promise<MonthlyRosterRecord | null> {
    return (
      this.records.find(
        (record) =>
          record.monthlyRosterId === monthlyRosterId,
      ) ?? null
    );
  }

  async findByRosterCode(
    rosterCode: string,
  ): Promise<MonthlyRosterRecord | null> {
    return (
      this.records.find(
        (record) =>
          record.rosterCode === rosterCode,
      ) ?? null
    );
  }

  async findActiveByTargetAndMonth(
    target: {
      readonly targetType: MonthlyRosterRecord["targetType"];
      readonly targetOrgUnitId: string | null;
      readonly targetTalentGroupId: string | null;
    },
    rosterMonth: string,
  ): Promise<MonthlyRosterRecord | null> {
    return (
      this.records.find(
        (record) =>
          record.status !== "ARCHIVED" &&
          record.targetType === target.targetType &&
          record.targetOrgUnitId ===
            target.targetOrgUnitId &&
          record.targetTalentGroupId ===
            target.targetTalentGroupId &&
          record.rosterMonth === rosterMonth,
      ) ?? null
    );
  }

  async updateDraft(
    input: UpdateMonthlyRosterDraftInput,
  ): Promise<MonthlyRosterRecord | null> {
    const current = await this.findById(
      input.monthlyRosterId,
    );

    if (!current || current.status !== "DRAFT") {
      return null;
    }

    const updated: MonthlyRosterRecord = {
      ...current,
      rosterMonth:
        input.rosterMonth ?? current.rosterMonth,
      targetType: input.targetType ?? current.targetType,
      targetMode: input.targetMode ?? current.targetMode,
      targetOrgUnitId:
        input.targetOrgUnitId === undefined
          ? current.targetOrgUnitId
          : input.targetOrgUnitId,
      targetTalentGroupId:
        input.targetTalentGroupId === undefined
          ? current.targetTalentGroupId
          : input.targetTalentGroupId,
      departmentOrgUnitId:
        input.departmentOrgUnitId === undefined
          ? current.departmentOrgUnitId
          : input.departmentOrgUnitId,
      workPatternId:
        input.workPatternId ?? current.workPatternId,
      holidayCalendarId:
        input.holidayCalendarId ??
        current.holidayCalendarId,
      description:
        input.description === undefined
          ? current.description
          : input.description,
      externalRef:
        input.externalRef === undefined
          ? current.externalRef
          : input.externalRef,
      draftVersion: current.draftVersion + 1,
      updatedAt: input.updatedAt,
    };
    this.replace(updated);
    return updated;
  }

  async transitionStatus(
    input: TransitionMonthlyRosterStatusInput,
  ): Promise<MonthlyRosterRecord | null> {
    const current = await this.findById(
      input.monthlyRosterId,
    );

    if (
      !current ||
      !input.fromStatuses.includes(current.status)
    ) {
      return null;
    }

    const updated: MonthlyRosterRecord = {
      ...current,
      status: input.toStatus,
      archivedAt:
        input.archivedAt === undefined
          ? current.archivedAt
          : input.archivedAt,
      draftVersion: current.draftVersion + 1,
      updatedAt: input.updatedAt,
    };
    this.replace(updated);
    return updated;
  }

  async publish(
    input: PublishMonthlyRosterInput,
  ): Promise<MonthlyRosterRecord | null> {
    const current = await this.findById(
      input.monthlyRosterId,
    );

    if (!current || current.status !== input.fromStatus) {
      return null;
    }

    const updated: MonthlyRosterRecord = {
      ...current,
      status: "PUBLISHED",
      previewHash: input.previewHash,
      lastPreviewedAt: input.lastPreviewedAt,
      publishedAt: input.publishedAt,
      publishedByUserId: input.publishedByUserId,
      publishGenerationRunId:
        input.publishGenerationRunId,
      updatedAt: input.updatedAt,
    };
    this.replace(updated);
    return updated;
  }

  async addException(
    input: AddRosterExceptionInput,
  ): Promise<MonthlyRosterRecord | null> {
    const current = await this.findById(
      input.monthlyRosterId,
    );

    if (!current || current.status !== "DRAFT") {
      return null;
    }

    const updated: MonthlyRosterRecord = {
      ...current,
      exceptions: [
        ...current.exceptions,
        input.exception,
      ],
      draftVersion: current.draftVersion + 1,
      updatedAt: input.updatedAt,
    };
    this.replace(updated);
    return updated;
  }

  async updateException(
    input: UpdateRosterExceptionInput,
  ): Promise<MonthlyRosterRecord | null> {
    const current = await this.findById(
      input.monthlyRosterId,
    );

    if (!current || current.status !== "DRAFT") {
      return null;
    }

    const target = current.exceptions.find(
      (exception) =>
        exception.rosterExceptionId ===
        input.rosterExceptionId,
    );

    if (!target || target.status !== "ACTIVE") {
      return null;
    }

    const updated: MonthlyRosterRecord = {
      ...current,
      exceptions: current.exceptions.map((exception) =>
        exception.rosterExceptionId ===
        input.rosterExceptionId
          ? {
              ...exception,
              exceptionType:
                input.exceptionType ??
                exception.exceptionType,
              exceptionDate:
                input.exceptionDate ??
                exception.exceptionDate,
              subjectEmploymentProfileId:
                input.subjectEmploymentProfileId ??
                exception.subjectEmploymentProfileId,
              title:
                input.title === undefined
                  ? exception.title
                  : input.title,
              startLocalTime:
                input.startLocalTime === undefined
                  ? exception.startLocalTime
                  : input.startLocalTime,
              endLocalTime:
                input.endLocalTime === undefined
                  ? exception.endLocalTime
                  : input.endLocalTime,
              workingMinutes:
                input.workingMinutes === undefined
                  ? exception.workingMinutes
                  : input.workingMinutes,
              breakMinutes:
                input.breakMinutes === undefined
                  ? exception.breakMinutes
                  : input.breakMinutes,
              studioResourceIds:
                input.studioResourceIds === undefined
                  ? exception.studioResourceIds
                  : [...input.studioResourceIds],
              reason:
                input.reason === undefined
                  ? exception.reason
                  : input.reason,
              sourceNote:
                input.sourceNote === undefined
                  ? exception.sourceNote
                  : input.sourceNote,
              description:
                input.description === undefined
                  ? exception.description
                  : input.description,
              externalRef:
                input.externalRef === undefined
                  ? exception.externalRef
                  : input.externalRef,
              updatedAt: input.updatedAt,
            }
          : exception,
      ),
      draftVersion: current.draftVersion + 1,
      updatedAt: input.updatedAt,
    };
    this.replace(updated);
    return updated;
  }

  async removeException(
    input: RemoveRosterExceptionInput,
  ): Promise<MonthlyRosterRecord | null> {
    const current = await this.findById(
      input.monthlyRosterId,
    );

    if (!current || current.status !== "DRAFT") {
      return null;
    }

    const updated: MonthlyRosterRecord = {
      ...current,
      exceptions: current.exceptions.map((exception) =>
        exception.rosterExceptionId ===
          input.rosterExceptionId &&
        exception.status === "ACTIVE"
          ? {
              ...exception,
              status: "REMOVED",
              removedAt: input.removedAt,
              updatedAt: input.updatedAt,
            }
          : exception,
      ),
      draftVersion: current.draftVersion + 1,
      updatedAt: input.updatedAt,
    };
    this.replace(updated);
    return updated;
  }

  private replace(updated: MonthlyRosterRecord): void {
    const index = this.records.findIndex(
      (record) =>
        record.monthlyRosterId ===
        updated.monthlyRosterId,
    );

    if (index >= 0) {
      this.records[index] = updated;
    }
  }
}

class MemoryWorkPatternRepository
  implements WorkPatternRepository
{
  constructor(
    private readonly records: readonly WorkPatternRecord[],
  ) {}

  async insert(
    workPattern: InsertWorkPatternInput,
  ): Promise<WorkPatternRecord> {
    return workPattern;
  }

  async findById(
    workPatternId: string,
  ): Promise<WorkPatternRecord | null> {
    return (
      this.records.find(
        (record) =>
          record.workPatternId === workPatternId,
      ) ?? null
    );
  }

  async findByPatternCode(): Promise<WorkPatternRecord | null> {
    return null;
  }

  async update(
    _input: UpdateWorkPatternInput,
  ): Promise<WorkPatternRecord | null> {
    return null;
  }

  async transitionStatus(
    _input: TransitionWorkPatternStatusInput,
  ): Promise<WorkPatternRecord | null> {
    return null;
  }
}

class MemoryHolidayCalendarRepository
  implements HolidayCalendarRepository
{
  constructor(
    private readonly records: readonly HolidayCalendarRecord[],
  ) {}

  async insert(
    holidayCalendar: InsertHolidayCalendarInput,
  ): Promise<HolidayCalendarRecord> {
    return holidayCalendar;
  }

  async findById(
    holidayCalendarId: string,
  ): Promise<HolidayCalendarRecord | null> {
    return (
      this.records.find(
        (record) =>
          record.holidayCalendarId ===
          holidayCalendarId,
      ) ?? null
    );
  }

  async findByCalendarCode(): Promise<HolidayCalendarRecord | null> {
    return null;
  }

  async update(
    _input: UpdateHolidayCalendarInput,
  ): Promise<HolidayCalendarRecord | null> {
    return null;
  }

  async transitionStatus(
    _input: TransitionHolidayCalendarStatusInput,
  ): Promise<HolidayCalendarRecord | null> {
    return null;
  }

  async addEntry(
    _input: AddHolidayCalendarEntryInput,
  ): Promise<HolidayCalendarRecord | null> {
    return null;
  }

  async updateEntry(
    _input: UpdateHolidayCalendarEntryInput,
  ): Promise<HolidayCalendarRecord | null> {
    return null;
  }

  async removeEntry(
    _input: RemoveHolidayCalendarEntryInput,
  ): Promise<HolidayCalendarRecord | null> {
    return null;
  }
}

class MemoryWorkShiftRepository
  implements WorkShiftRepository
{
  subjectOverlap = false;
  resourceOverlap = false;
  readonly records: WorkShiftRecord[] = [];

  async insert(
    workShift: WorkShiftRecord,
  ): Promise<WorkShiftRecord> {
    if (
      this.records.some(
        (record) =>
          record.sourceType === "ROSTER_GENERATED" &&
          workShift.sourceType === "ROSTER_GENERATED" &&
          record.sourceRosterId ===
            workShift.sourceRosterId &&
          record.subjectEmploymentProfileId ===
            workShift.subjectEmploymentProfileId &&
          record.sourceRosterLocalDate ===
            workShift.sourceRosterLocalDate &&
          record.sourceRosterSlotKey ===
            workShift.sourceRosterSlotKey,
      )
    ) {
      throw new MongoServerError({
        message: "duplicate key",
        code: 11000,
      });
    }

    this.records.push(workShift);
    return workShift;
  }

  async findById(): Promise<WorkShiftRecord | null> {
    return null;
  }

  async findByShiftCode(): Promise<WorkShiftRecord | null> {
    return null;
  }

  async updateCore(): Promise<WorkShiftRecord | null> {
    return null;
  }

  async reschedule(): Promise<WorkShiftRecord | null> {
    return null;
  }

  async reassignSubject(): Promise<WorkShiftRecord | null> {
    return null;
  }

  async replaceResources(): Promise<WorkShiftRecord | null> {
    return null;
  }

  async transitionStatus(): Promise<WorkShiftRecord | null> {
    return null;
  }

  async hasActiveOverlappingSubjectShift(
    _input: WorkShiftOverlapSubjectCheckInput,
  ): Promise<boolean> {
    return this.subjectOverlap;
  }

  async hasActiveOverlappingResourceShift(
    _input: WorkShiftOverlapResourceCheckInput,
  ): Promise<boolean> {
    return this.resourceOverlap;
  }

  async listActiveEmploymentProfileShiftsForWindow() {
    return [];
  }

  async summarizeGeneratedByRoster(monthlyRosterId: string) {
    const generated = this.records.filter(
      (record) =>
        record.sourceType === "ROSTER_GENERATED" &&
        record.sourceRosterId === monthlyRosterId,
    );

    return {
      workShiftIds: generated.map((record) => record.id),
      generatedWorkShiftCount: generated.length,
      changeTimeCount: generated.filter(
        (record) =>
          record.sourceExceptionId !== null &&
          record.sourceRosterSlotKey === "STANDARD",
      ).length,
      addSpecialShiftCount: generated.filter(
        (record) =>
          record.sourceRosterSlotKey?.startsWith(
            "ADD_SPECIAL_SHIFT:",
          ) ?? false,
      ).length,
    };
  }
}

class MemoryAvailabilityRepository
  implements WorkScheduleAvailabilityBatchRepository
{
  readonly batches: WorkScheduleAvailabilityBatchRecord[] = [];
  readonly lines: WorkScheduleAvailabilityLineRecord[] = [];

  constructor(params: {
    readonly batches?: readonly WorkScheduleAvailabilityBatchRecord[];
    readonly lines?: readonly WorkScheduleAvailabilityLineRecord[];
  } = {}) {
    this.batches.push(...(params.batches ?? []));
    this.lines.push(...(params.lines ?? []));
  }

  async insertBatchWithLines(
    batch: WorkScheduleAvailabilityBatchRecord,
    lines: readonly WorkScheduleAvailabilityLineRecord[],
  ) {
    this.batches.push(batch);
    this.lines.push(...lines);
    return batch;
  }

  async findBatchById(batchId: string) {
    return this.batches.find((batch) => batch.id === batchId) ?? null;
  }

  async findBatchByClientToken() {
    return null;
  }

  async listBatches() {
    return { items: this.batches };
  }

  async listLinesByBatchId(batchId: string) {
    return this.lines.filter((line) => line.batchId === batchId);
  }

  async findLineById(batchId: string, lineId: string) {
    return (
      this.lines.find(
        (line) => line.batchId === batchId && line.id === lineId,
      ) ?? null
    );
  }

  async listLinesByIds(lineIds: readonly string[]) {
    const ids = new Set(lineIds);
    return this.lines.filter((line) => ids.has(line.id));
  }

  async findPendingDuplicateLine() {
    return null;
  }

  async transitionLineStatus() {
    return null;
  }

  async updateBatchDerived() {
    return null;
  }

  async updateLineApplyState(
    input: UpdateWorkScheduleAvailabilityLineApplyStateInput,
  ) {
    const current = await this.findLineById(input.batchId, input.lineId);
    if (
      !current ||
      !input.fromApplyStatuses.includes(current.applyStatus)
    ) {
      return null;
    }
    const updated: WorkScheduleAvailabilityLineRecord = {
      ...current,
      applyStatus: input.applyStatus,
      appliedRosterId:
        input.appliedRosterId === undefined
          ? current.appliedRosterId
          : input.appliedRosterId,
      appliedRosterExceptionId:
        input.appliedRosterExceptionId === undefined
          ? current.appliedRosterExceptionId
          : input.appliedRosterExceptionId,
      appliedRosterExceptionIds:
        input.appliedRosterExceptionIds === undefined
          ? current.appliedRosterExceptionIds
          : [...input.appliedRosterExceptionIds],
      appliedAt:
        input.appliedAt === undefined
          ? current.appliedAt
          : input.appliedAt,
      appliedByActorId:
        input.appliedByActorId === undefined
          ? current.appliedByActorId
          : input.appliedByActorId,
      updatedAt: input.updatedAt,
    };
    const index = this.lines.findIndex(
      (line) => line.id === updated.id,
    );
    this.lines[index] = updated;
    return updated;
  }
}

class MemoryWorkShiftCodeSequenceRepository
  implements WorkScheduleCodeSequenceRepository
{
  private value = 0;
  private workPatternValue = 0;
  private holidayCalendarValue = 0;
  private workScheduleRequestValue = 0;
  private readonly monthlyRosterValues = new Map<
    string,
    number
  >();

  async allocateNext(): Promise<number> {
    this.value += 1;
    return this.value;
  }

  async allocateNextWorkPatternCode(): Promise<number> {
    this.workPatternValue += 1;
    return this.workPatternValue;
  }

  async allocateNextHolidayCalendarCode(): Promise<number> {
    this.holidayCalendarValue += 1;
    return this.holidayCalendarValue;
  }

  async allocateNextMonthlyRosterCode(
    rosterMonthBucket: string,
  ): Promise<number> {
    const next =
      (this.monthlyRosterValues.get(rosterMonthBucket) ??
        0) + 1;
    this.monthlyRosterValues.set(
      rosterMonthBucket,
      next,
    );
    return next;
  }

  async allocateNextWorkScheduleRequestCode(): Promise<number> {
    this.workScheduleRequestValue += 1;
    return this.workScheduleRequestValue;
  }

  async allocateNextWorkScheduleAvailabilityCode(): Promise<number> {
    this.workScheduleRequestValue += 1;
    return this.workScheduleRequestValue;
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

const audit = {
  async record() {},
} as unknown as AuditGuard;

function createActor(
  permissions: readonly Permission[],
  workScheduleScopes: readonly string[] = ["global"],
): Actor {
  return new Actor({
    id: "admin-user-1",
    type: "admin",
    context: "ADMIN",
    roles: [],
    permissions,
    scopeGrants: {
      workSchedule: workScheduleScopes as never,
    },
    isActive: true,
  });
}

function seedPattern(params: {
  readonly workPatternId?: string;
  readonly status?: WorkPatternStatus;
  readonly workingDays?: readonly WorkPatternRecord["workingDays"][number][];
} = {}): WorkPatternRecord {
  return {
    workPatternId: params.workPatternId ?? "pattern-1",
    patternCode: "PAT-1",
    normalizedPatternCode: "pat-1",
    name: "Office",
    normalizedName: "office",
    status: params.status ?? "ACTIVE",
    timezone: "Asia/Ho_Chi_Minh",
    startLocalTime: "08:00",
    endLocalTime: "17:00",
    workingMinutes: 480,
    breakMinutes: 60,
    workingDays:
      params.workingDays ?? [
        "MON",
        "TUE",
        "WED",
        "THU",
        "FRI",
      ],
    description: null,
    externalRef: null,
    activatedAt: 1,
    archivedAt: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

function seedCalendar(params: {
  readonly holidayCalendarId?: string;
  readonly status?: HolidayCalendarStatus;
  readonly activeHolidayDate?: string;
} = {}): HolidayCalendarRecord {
  const entries = params.activeHolidayDate
    ? [
        {
          holidayCalendarEntryId: "entry-1",
          date: params.activeHolidayDate,
          entryType: "HOLIDAY" as const,
          name: "Holiday",
          status: "ACTIVE" as const,
          description: null,
          externalRef: null,
          removedAt: null,
          createdAt: 1,
          updatedAt: 1,
        },
      ]
    : [];

  return {
    holidayCalendarId:
      params.holidayCalendarId ?? "calendar-1",
    calendarCode: "CAL-1",
    normalizedCalendarCode: "cal-1",
    name: "Vietnam",
    normalizedName: "vietnam",
    scopeType: "GLOBAL",
    timezone: "Asia/Ho_Chi_Minh",
    status: params.status ?? "ACTIVE",
    entries,
    description: null,
    externalRef: null,
    activatedAt: 1,
    archivedAt: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

function seedRoster(params: {
  readonly monthlyRosterId?: string;
  readonly rosterMonth?: string;
  readonly targetType?: MonthlyRosterRecord["targetType"];
  readonly targetOrgUnitId?: string | null;
  readonly targetTalentGroupId?: string | null;
  readonly departmentOrgUnitId?: string;
  readonly workPatternId?: string;
  readonly holidayCalendarId?: string;
  readonly status?: MonthlyRosterStatus;
  readonly exceptions?: readonly RosterExceptionRecord[];
} = {}): MonthlyRosterRecord {
  const targetType = params.targetType ?? "ORG_UNIT";
  const targetOrgUnitId =
    targetType === "ORG_UNIT"
      ? (params.targetOrgUnitId ??
        params.departmentOrgUnitId ??
        "dept-1")
      : null;
  const targetTalentGroupId =
    targetType === "TALENT_GROUP"
      ? (params.targetTalentGroupId ?? "group-1")
      : null;

  return {
    monthlyRosterId:
      params.monthlyRosterId ?? "roster-1",
    rosterCode: "MR-2026-05-HR",
    normalizedRosterCode: "mr-2026-05-hr",
    rosterMonth: params.rosterMonth ?? "2026-05",
    timezone: "Asia/Ho_Chi_Minh",
    targetSubjectKind: "EMPLOYMENT_PROFILE",
    targetOrgUnitMode: "EXACT_ONLY",
    targetType,
    targetMode: "EXACT_ONLY",
    targetOrgUnitId,
    targetTalentGroupId,
    departmentOrgUnitId:
      targetType === "ORG_UNIT"
        ? (params.departmentOrgUnitId ?? targetOrgUnitId)
        : null,
    workPatternId: params.workPatternId ?? "pattern-1",
    holidayCalendarId:
      params.holidayCalendarId ?? "calendar-1",
    status: params.status ?? "DRAFT",
    draftVersion: 1,
    previewHash: null,
    lastPreviewedAt: null,
    publishedAt: null,
    publishedByUserId: null,
    publishGenerationRunId: null,
    description: null,
    externalRef: null,
    exceptions: params.exceptions ?? [],
    archivedAt:
      params.status === "ARCHIVED" ? 2 : null,
    createdAt: 1,
    updatedAt: 1,
  };
}

function seedRosterException(params: {
  readonly rosterExceptionId?: string;
  readonly monthlyRosterId?: string;
  readonly exceptionType?: RosterExceptionRecord["exceptionType"];
  readonly exceptionDate?: string;
  readonly subjectEmploymentProfileId?: string;
  readonly status?: RosterExceptionRecord["status"];
  readonly startLocalTime?: string;
  readonly workingMinutes?: number;
  readonly breakMinutes?: number;
  readonly sourceAvailabilityLineId?: string | null;
} = {}): RosterExceptionRecord {
  const exceptionType =
    params.exceptionType ?? "WORKING_TO_OFF";

  return {
    rosterExceptionId:
      params.rosterExceptionId ?? "exception-1",
    monthlyRosterId:
      params.monthlyRosterId ?? "roster-1",
    exceptionType,
    exceptionDate:
      params.exceptionDate ?? "2026-05-04",
    subjectEmploymentProfileId:
      params.subjectEmploymentProfileId ?? "emp-1",
    status: params.status ?? "ACTIVE",
    title:
      exceptionType === "ADD_SPECIAL_SHIFT"
        ? "Special shift"
        : null,
    startLocalTime:
      exceptionType === "WORKING_TO_OFF"
        ? null
        : (params.startLocalTime ?? "09:00"),
    endLocalTime:
      exceptionType === "WORKING_TO_OFF"
        ? null
        : "18:00",
    workingMinutes:
      exceptionType === "ADD_SPECIAL_SHIFT"
        ? (params.workingMinutes ?? 120)
        : null,
    breakMinutes:
      exceptionType === "ADD_SPECIAL_SHIFT"
        ? (params.breakMinutes ?? 30)
        : null,
    studioResourceIds: [],
    reason: null,
    sourceNote: null,
    sourceAvailabilityBatchId:
      params.sourceAvailabilityLineId === undefined
        ? null
        : "availability-batch-1",
    sourceAvailabilityLineId:
      params.sourceAvailabilityLineId ?? null,
    sourceAvailabilityType:
      params.sourceAvailabilityLineId === undefined
        ? null
        : "UNAVAILABLE_FULL_DAY",
    sourceAvailabilityTaxonomyCode:
      params.sourceAvailabilityLineId === undefined
        ? null
        : "AUTHORIZED_LEAVE",
    sourceAppliedAt:
      params.sourceAvailabilityLineId === undefined ? null : 1,
    sourceAppliedByActorId:
      params.sourceAvailabilityLineId === undefined
        ? null
        : "admin-user-1",
    sourceApplyNote: null,
    description: null,
    externalRef: null,
    removedAt:
      params.status === "REMOVED" ? 2 : null,
    createdAt: 1,
    updatedAt: 1,
  };
}

function seedAvailabilityBatch(params: {
  readonly id?: string;
  readonly periodMonth?: string;
  readonly targetType?: MonthlyRosterRecord["targetType"];
  readonly targetOrgUnitId?: string | null;
  readonly targetTalentGroupId?: string | null;
} = {}): WorkScheduleAvailabilityBatchRecord {
  const targetType = params.targetType ?? "ORG_UNIT";
  return {
    id: params.id ?? "availability-batch-1",
    availabilityBatchCode: "WSAB-202605-000001",
    submittedByActorId: "manager-user",
    submittedByEmploymentProfileId: "manager-profile",
    periodMonth: params.periodMonth ?? "2026-05",
    targetType,
    targetMode: "EXACT_ONLY",
    targetOrgUnitId:
      targetType === "ORG_UNIT"
        ? (params.targetOrgUnitId ?? "dept-1")
        : null,
    targetTalentGroupId:
      targetType === "TALENT_GROUP"
        ? (params.targetTalentGroupId ?? "group-1")
        : null,
    targetRef: null,
    status: "APPROVED",
    note: null,
    lineCounts: {
      total: 1,
      pending: 0,
      approved: 1,
      rejected: 0,
      cancelled: 0,
    },
    clientToken: "availability-client-token",
    submittedAt: 1,
    cancelledAt: null,
    resolvedAt: 2,
    createdAt: 1,
    updatedAt: 2,
  };
}

function seedAvailabilityLine(params: {
  readonly id: string;
  readonly batchId?: string;
  readonly memberEmploymentProfileId?: string;
  readonly availabilityType?: WorkScheduleAvailabilityLineRecord["availabilityType"];
  readonly taxonomyCode?: WorkScheduleAvailabilityLineRecord["taxonomyCode"];
  readonly dateRangeStart?: string;
  readonly dateRangeEnd?: string;
  readonly preferredStartLocalTime?: string | null;
  readonly preferredEndLocalTime?: string | null;
  readonly status?: WorkScheduleAvailabilityLineRecord["status"];
  readonly applyStatus?: WorkScheduleAvailabilityLineRecord["applyStatus"];
  readonly appliedRosterId?: string | null;
  readonly appliedRosterExceptionId?: string | null;
  readonly appliedRosterExceptionIds?: readonly string[];
  readonly targetType?: MonthlyRosterRecord["targetType"];
  readonly targetOrgUnitId?: string | null;
  readonly targetTalentGroupId?: string | null;
}): WorkScheduleAvailabilityLineRecord {
  const targetType = params.targetType ?? "ORG_UNIT";
  return {
    id: params.id,
    batchId: params.batchId ?? "availability-batch-1",
    lineNo: 1,
    pendingDuplicateKey: "pending-key",
    memberEmploymentProfileId:
      params.memberEmploymentProfileId ?? "emp-1",
    availabilityType:
      params.availabilityType ?? "UNAVAILABLE_FULL_DAY",
    taxonomyCode:
      params.taxonomyCode ?? "AUTHORIZED_LEAVE",
    dateRangeStart:
      params.dateRangeStart ?? "2026-05-04",
    dateRangeEnd:
      params.dateRangeEnd ??
      params.dateRangeStart ??
      "2026-05-04",
    preferredStartLocalTime:
      params.preferredStartLocalTime ?? null,
    preferredEndLocalTime:
      params.preferredEndLocalTime ?? null,
    reason:
      "Approved availability planning signal for roster application",
    status: params.status ?? "APPROVED",
    applyStatus: params.applyStatus ?? "NOT_APPLIED",
    policyEvaluationStatus: "NOT_EVALUATED",
    appliedRosterId: params.appliedRosterId ?? null,
    appliedRosterExceptionId:
      params.appliedRosterExceptionId ?? null,
    appliedRosterExceptionIds: [
      ...(params.appliedRosterExceptionIds ?? []),
    ],
    appliedAt: null,
    appliedByActorId: null,
    adminDecisionNote: null,
    rejectionReason: null,
    cancellationReason: null,
    createdAt: 1,
    updatedAt: 1,
    approvedAt: 2,
    approvedByActorId: "ops-user",
    rejectedAt: null,
    rejectedByActorId: null,
    cancelledAt: null,
    cancelledByActorId: null,
    submittedByEmploymentProfileId: "manager-profile",
    periodMonth: "2026-05",
    targetType,
    targetOrgUnitId:
      targetType === "ORG_UNIT"
        ? (params.targetOrgUnitId ?? "dept-1")
        : null,
    targetTalentGroupId:
      targetType === "TALENT_GROUP"
        ? (params.targetTalentGroupId ?? "group-1")
        : null,
  };
}

function createService(params: {
  readonly rosters?: readonly MonthlyRosterRecord[];
  readonly orgUnits?: readonly WorkScheduleReferencedOrgUnit[];
  readonly talentGroups?: readonly {
    readonly id: string;
    readonly status: "ACTIVE" | "ARCHIVED";
  }[];
  readonly profiles?: readonly WorkScheduleReferencedEmploymentProfile[];
  readonly talentGroupMemberResolutions?: readonly {
    readonly memberId: string;
    readonly groupId: string;
    readonly talentId: string;
    readonly membershipStatus: string;
    readonly talentOperationalStatus: string | null;
    readonly linkedEmploymentProfileId: string | null;
    readonly employmentProfile: WorkScheduleReferencedEmploymentProfile | null;
  }[];
  readonly patterns?: readonly WorkPatternRecord[];
  readonly calendars?: readonly HolidayCalendarRecord[];
  readonly resources?: readonly WorkScheduleReferencedStudioResource[];
  readonly workShiftRepository?: MemoryWorkShiftRepository;
  readonly availabilityRepository?: MemoryAvailabilityRepository;
  readonly codeSequenceRepository?: WorkScheduleCodeSequenceRepository;
  readonly now?: () => number;
} = {}): MonthlyRosterAdminService {
  const orgUnits =
    params.orgUnits ??
    [
      {
        id: "dept-1",
        type: "DEPARTMENT",
        status: "ACTIVE",
      },
    ];
  const profiles =
    params.profiles ??
    [
      {
        id: "emp-1",
        employmentStatus: "ACTIVE",
        orgUnitId: "dept-1",
        managerEmploymentProfileId: null,
        linkedUserId: null,
      },
      {
        id: "actor-profile",
        employmentStatus: "ACTIVE",
        orgUnitId: "dept-1",
        managerEmploymentProfileId: null,
        linkedUserId: "admin-user-1",
      },
    ];
  const talentGroups =
    params.talentGroups ??
    [
      {
        id: "group-1",
        status: "ACTIVE" as const,
      },
    ];
  const resources =
    params.resources ??
    [
      {
        id: "studio-1",
        operationalStatus: "ACTIVE",
      },
    ];

  return new MonthlyRosterAdminService(
    new MemoryMonthlyRosterRepository(
      params.rosters,
    ),
    new MemoryWorkPatternRepository(
      params.patterns ?? [seedPattern()],
    ),
    new MemoryHolidayCalendarRepository(
      params.calendars ?? [seedCalendar()],
    ),
    params.workShiftRepository ??
      new MemoryWorkShiftRepository(),
    params.codeSequenceRepository ??
      new MemoryWorkShiftCodeSequenceRepository(),
    {
      findById: async (id: string) =>
        orgUnits.find((unit) => unit.id === id) ?? null,
    },
    {
      findById: async (id: string) =>
        profiles.find((profile) => profile.id === id) ??
        null,
      findByLinkedUserId: async (linkedUserId: string) =>
        profiles.find(
          (profile) =>
            profile.linkedUserId === linkedUserId,
        ) ?? null,
      listIdsByManagerEmploymentProfileId: async () => [],
      listIdsByActiveTalentGroupIds: async () => [],
      listIdsByOrgUnitId: async () => [],
      listByOrgUnitId: async (orgUnitId: string) =>
        profiles.filter(
          (profile) => profile.orgUnitId === orgUnitId,
        ),
      listTalentGroupMemberEmploymentProfileResolutions:
        async (talentGroupId: string) =>
          (
            params.talentGroupMemberResolutions ??
            profiles.map((profile) => ({
              memberId: `member-${profile.id}`,
              groupId: talentGroupId,
              talentId: `talent-${profile.id}`,
              membershipStatus: "ACTIVE",
              talentOperationalStatus: "ACTIVE",
              linkedEmploymentProfileId: profile.id,
              employmentProfile: profile,
            }))
          ).filter(
            (resolution) =>
              resolution.groupId === talentGroupId,
          ),
    },
    {
      findById: async (id: string) =>
        resources.find((resource) => resource.id === id) ??
        null,
    },
    audit,
    mutationBridge,
    {
      findById: async (id: string) =>
        talentGroups.find((group) => group.id === id) ??
        null,
    },
    {
      info() {},
      warn() {},
      error() {},
      debug() {},
    } as never,
    params.now ??
      (() => Date.parse("2026-05-15T00:00:00.000Z")),
    params.availabilityRepository ??
      new MemoryAvailabilityRepository(),
  );
}

function createRosterPayload(
  params: Partial<{
    readonly rosterCode: string | null;
    readonly rosterMonth: string;
    readonly targetType: MonthlyRosterRecord["targetType"];
    readonly targetOrgUnitId: string | null;
    readonly targetTalentGroupId: string | null;
    readonly departmentOrgUnitId: string;
    readonly workPatternId: string;
    readonly holidayCalendarId: string;
  }> = {},
) {
  return {
    rosterCode:
      "rosterCode" in params
        ? params.rosterCode
        : "MR-2026-05-HR",
    rosterMonth: params.rosterMonth ?? "2026-05",
    targetType: params.targetType ?? "ORG_UNIT",
    targetMode: "EXACT_ONLY",
    targetOrgUnitId:
      params.targetType === "TALENT_GROUP"
        ? null
        : (params.targetOrgUnitId ??
          params.departmentOrgUnitId ??
          "dept-1"),
    targetTalentGroupId:
      params.targetType === "TALENT_GROUP"
        ? (params.targetTalentGroupId ?? "group-1")
        : null,
    departmentOrgUnitId:
      params.targetType === "TALENT_GROUP"
        ? undefined
        : (params.departmentOrgUnitId ??
          params.targetOrgUnitId ??
          "dept-1"),
    workPatternId: params.workPatternId ?? "pattern-1",
    holidayCalendarId:
      params.holidayCalendarId ?? "calendar-1",
  };
}

function expectedPreviewHash(params: {
  readonly roster?: MonthlyRosterRecord;
  readonly pattern?: WorkPatternRecord;
  readonly calendar?: HolidayCalendarRecord;
  readonly profiles?: readonly WorkScheduleReferencedEmploymentProfile[];
} = {}): string {
  const roster = params.roster ?? seedRoster();
  const profiles =
    params.profiles ??
    [
      {
        id: "emp-1",
        employmentStatus: "ACTIVE",
        orgUnitId: "dept-1",
        managerEmploymentProfileId: null,
        linkedUserId: null,
      },
      {
        id: "actor-profile",
        employmentStatus: "ACTIVE",
        orgUnitId: "dept-1",
        managerEmploymentProfileId: null,
        linkedUserId: "admin-user-1",
      },
    ];

  return buildMonthlyRosterPreview({
    roster: {
      ...roster,
      exceptionCount: roster.exceptions.filter(
        (exception) => exception.status === "ACTIVE",
      ).length,
    },
    pattern: params.pattern ?? seedPattern(),
    activeHolidayEntries: (
      params.calendar ?? seedCalendar()
    ).entries.filter((entry) => entry.status === "ACTIVE"),
    eligibleProfiles: profiles
      .filter((profile) => profile.employmentStatus === "ACTIVE")
      .filter((profile) =>
        roster.targetType === "ORG_UNIT"
          ? profile.orgUnitId === roster.targetOrgUnitId
          : true,
      )
      .map((profile) => ({
        id: profile.id,
        employmentStatus: "ACTIVE" as const,
        orgUnitId: profile.orgUnitId,
      })),
    excludedMembers: [],
    existingActiveShifts: [],
  }).computedPreviewHash;
}

function vietnamUtc(date: string, time: string): number {
  const [year, month, day] = date
    .split("-")
    .map(Number);
  const [hour, minute] = time.split(":").map(Number);

  return Date.UTC(
    year,
    month - 1,
    day,
    hour - 7,
    minute,
  );
}

test("Monthly Roster creates DRAFT with active department, pattern, and calendar", async () => {
  await bindTraceId("trace-monthly-roster-create", async () => {
    const created =
      await createService().createMonthlyRosterDraft(
        createActor([
          Permission.WORK_SCHEDULE_CREATE,
        ]),
        createRosterPayload(),
      );

    assert.equal(created.status, "DRAFT");
    assert.equal(created.timezone, "Asia/Ho_Chi_Minh");
    assert.equal(
      created.targetSubjectKind,
      "EMPLOYMENT_PROFILE",
    );
    assert.equal(
      created.targetOrgUnitMode,
      "EXACT_ONLY",
    );
    assert.equal(created.exceptionCount, 0);
  });
});

test("Monthly Roster accepts Talent Group target and blocks zero eligible Talent Group publish", async () => {
  await bindTraceId("trace-roster-talent-group-target", async () => {
    const linkedProfile = {
      id: "emp-linked",
      employmentStatus: "ACTIVE" as const,
      orgUnitId: "dept-1",
      managerEmploymentProfileId: null,
      linkedUserId: null,
    };
    const created =
      await createService({
        profiles: [linkedProfile],
        talentGroupMemberResolutions: [
          {
            memberId: "member-linked",
            groupId: "group-1",
            talentId: "talent-linked",
            membershipStatus: "ACTIVE",
            talentOperationalStatus: "ACTIVE",
            linkedEmploymentProfileId: linkedProfile.id,
            employmentProfile: linkedProfile,
          },
        ],
      }).createMonthlyRosterDraft(
        createActor([
          Permission.WORK_SCHEDULE_CREATE,
        ]),
        {
          rosterMonth: "2026-05",
          timezone: "Asia/Ho_Chi_Minh",
          targetType: "TALENT_GROUP",
          targetMode: "EXACT_ONLY",
          targetTalentGroupId: "group-1",
          workPatternId: "pattern-1",
          holidayCalendarId: "calendar-1",
          scope: "global",
        },
      );

    assert.equal(created.targetType, "TALENT_GROUP");
    assert.equal(created.targetMode, "EXACT_ONLY");
    assert.equal(created.targetOrgUnitId, null);
    assert.equal(created.targetTalentGroupId, "group-1");
    assert.equal(created.departmentOrgUnitId, null);

    const zeroEligibleRoster = seedRoster({
      monthlyRosterId: "roster-zero-tg",
      targetType: "TALENT_GROUP",
      targetTalentGroupId: "group-1",
    });

    await assert.rejects(
      createService({
        rosters: [zeroEligibleRoster],
        profiles: [],
        talentGroupMemberResolutions: [
          {
            memberId: "member-unlinked",
            groupId: "group-1",
            talentId: "talent-unlinked",
            membershipStatus: "ACTIVE",
            talentOperationalStatus: "ACTIVE",
            linkedEmploymentProfileId: null,
            employmentProfile: null,
          },
        ],
      }).publishMonthlyRoster(
        createActor([
          Permission.WORK_SCHEDULE_MANAGE_LIFECYCLE,
        ]),
        {
          monthlyRosterId: "roster-zero-tg",
          expectedPreviewHash: expectedPreviewHash({
            roster: zeroEligibleRoster,
            profiles: [],
          }),
          scope: "global",
        },
      ),
      WorkScheduleValidationError,
    );
  });
});

test("Monthly Roster create generates rosterCode when omitted, null, or blank and increments by roster month bucket", async () => {
  const sequenceRepository =
    new MemoryWorkShiftCodeSequenceRepository();
  const actor = createActor([
    Permission.WORK_SCHEDULE_CREATE,
  ]);

  await bindTraceId("trace-monthly-roster-code-generation", async () => {
    const first =
      await createService({
        codeSequenceRepository: sequenceRepository,
      }).createMonthlyRosterDraft(
        actor,
        createRosterPayload({
          rosterCode: undefined,
          departmentOrgUnitId: "dept-1",
        }),
      );
    const second =
      await createService({
        codeSequenceRepository: sequenceRepository,
        orgUnits: [
          {
            id: "dept-2",
            type: "DEPARTMENT",
            status: "ACTIVE",
          },
        ],
        profiles: [
          {
            id: "emp-2",
            employmentStatus: "ACTIVE",
            orgUnitId: "dept-2",
            managerEmploymentProfileId: null,
            linkedUserId: null,
          },
        ],
      }).createMonthlyRosterDraft(
        actor,
        createRosterPayload({
          rosterCode: null,
          departmentOrgUnitId: "dept-2",
        }),
      );
    const differentMonth =
      await createService({
        codeSequenceRepository: sequenceRepository,
      }).createMonthlyRosterDraft(
        actor,
        createRosterPayload({
          rosterCode: "   ",
          rosterMonth: "2026-06",
        }),
      );

    assert.equal(first.rosterCode, "MR-202605-000001");
    assert.equal(second.rosterCode, "MR-202605-000002");
    assert.equal(
      differentMonth.rosterCode,
      "MR-202606-000001",
    );
    assert.match(first.rosterCode, /^MR-\d{6}-\d{6}$/u);
  });
});

test("Monthly Roster explicit custom rosterCode is preserved and update cannot mutate it", async () => {
  await bindTraceId("trace-monthly-roster-custom-code", async () => {
    const created =
      await createService().createMonthlyRosterDraft(
        createActor([Permission.WORK_SCHEDULE_CREATE]),
        createRosterPayload({
          rosterCode: "  CUSTOM-MR  ",
        }),
      );

    assert.equal(created.rosterCode, "CUSTOM-MR");

    const updated =
      await createService({
        rosters: [
          {
            ...seedRoster({
              monthlyRosterId:
                created.monthlyRosterId,
            }),
            rosterCode: created.rosterCode,
            normalizedRosterCode: "custom-mr",
          },
        ],
      }).updateMonthlyRosterDraft(
        createActor([Permission.WORK_SCHEDULE_UPDATE]),
        {
          monthlyRosterId: created.monthlyRosterId,
          description: "Metadata update",
          rosterCode: "NEW-MR",
        } as never,
      );

    assert.equal(updated.rosterCode, "CUSTOM-MR");
  });
});

test("Monthly Roster enforces target, pattern, calendar, month, duplicate, and client status contracts", async (t) => {
  const actor = createActor([
    Permission.WORK_SCHEDULE_CREATE,
  ]);

  await t.test("active non-department Org Unit target", async () => {
    await bindTraceId("trace-roster-active-team-target", async () => {
      const created = await createService({
        orgUnits: [
          {
            id: "team-1",
            type: "TEAM",
            status: "ACTIVE",
          },
        ],
        profiles: [
          {
            id: "emp-team",
            employmentStatus: "ACTIVE",
            orgUnitId: "team-1",
            managerEmploymentProfileId: null,
            linkedUserId: null,
          },
        ],
      }).createMonthlyRosterDraft(
        actor,
        createRosterPayload({
          targetOrgUnitId: "team-1",
          departmentOrgUnitId: "team-1",
        }),
      );

      assert.equal(created.targetType, "ORG_UNIT");
      assert.equal(created.targetOrgUnitId, "team-1");
      assert.equal(created.departmentOrgUnitId, "team-1");
    });
  });

  await t.test("inactive department", async () => {
    await bindTraceId("trace-roster-inactive-dept", async () => {
      await assert.rejects(
        createService({
          orgUnits: [
            {
              id: "dept-1",
              type: "DEPARTMENT",
              status: "INACTIVE",
            },
          ],
        }).createMonthlyRosterDraft(
          actor,
          createRosterPayload(),
        ),
        WorkScheduleInvalidSubjectReferenceError,
      );
    });
  });

  await t.test("unsupported or mismatched target shape", async () => {
    await bindTraceId("trace-roster-invalid-target-shape", async () => {
      await assert.rejects(
        createService().createMonthlyRosterDraft(actor, {
          rosterMonth: "2026-05",
          timezone: "Asia/Ho_Chi_Minh",
          targetType: "COMPANY",
          targetMode: "EXACT_ONLY",
          workPatternId: "pattern-1",
          holidayCalendarId: "calendar-1",
          scope: "global",
        }),
        WorkScheduleValidationError,
      );

      await assert.rejects(
        createService().createMonthlyRosterDraft(actor, {
          rosterMonth: "2026-05",
          timezone: "Asia/Ho_Chi_Minh",
          targetType: "ORG_UNIT",
          targetMode: "EXACT_ONLY",
          targetOrgUnitId: "dept-1",
          targetTalentGroupId: "group-1",
          workPatternId: "pattern-1",
          holidayCalendarId: "calendar-1",
          scope: "global",
        }),
        WorkScheduleValidationError,
      );
    });
  });

  await t.test("draft pattern", async () => {
    await bindTraceId("trace-roster-draft-pattern", async () => {
      await assert.rejects(
        createService({
          patterns: [seedPattern({ status: "DRAFT" })],
        }).createMonthlyRosterDraft(
          actor,
          createRosterPayload(),
        ),
        WorkScheduleInvalidSubjectReferenceError,
      );
    });
  });

  await t.test("archived calendar", async () => {
    await bindTraceId("trace-roster-archived-calendar", async () => {
      await assert.rejects(
        createService({
          calendars: [
            seedCalendar({ status: "ARCHIVED" }),
          ],
        }).createMonthlyRosterDraft(
          actor,
          createRosterPayload(),
        ),
        WorkScheduleInvalidSubjectReferenceError,
      );
    });
  });

  await t.test("invalid month and duplicate", async () => {
    await bindTraceId("trace-roster-invalid-month", async () => {
      await assert.rejects(
        createService().createMonthlyRosterDraft(actor, {
          ...createRosterPayload(),
          rosterMonth: "2026-13",
        }),
        WorkScheduleValidationError,
      );

      await assert.rejects(
        createService({
          rosters: [seedRoster()],
        }).createMonthlyRosterDraft(
          actor,
          createRosterPayload(),
        ),
        WorkScheduleConflictError,
      );
    });
  });

  await t.test("client status field forbidden at boundary", async () => {
    const routes = await readFile(
      "src/modules/work-schedule/admin/admin.monthly-roster.controller.ts",
      "utf8",
    );
    assert.equal(
      routes.includes('"status"'),
      false,
    );
  });
});

test("Monthly Roster list/detail exposure and draft update work, archived is read-only", async () => {
  const roster = seedRoster();
  const exposed =
    MonthlyRosterAdminExposure.exposeDetail({
      ...roster,
      exceptionCount: 0,
    });

  assert.equal(
    exposed.monthlyRosterId,
    "roster-1",
  );
  assert.deepEqual(exposed.exceptions, []);

  await bindTraceId("trace-roster-update-archive", async () => {
    const service = createService({
      rosters: [roster],
    });
    const actor = createActor([
      Permission.WORK_SCHEDULE_UPDATE,
      Permission.WORK_SCHEDULE_MANAGE_LIFECYCLE,
    ]);
    const updated =
      await service.updateMonthlyRosterDraft(actor, {
        monthlyRosterId: "roster-1",
        description: "May roster",
        externalRef: "EXT-1",
      });

    assert.equal(updated.description, "May roster");
    assert.equal(updated.draftVersion, 2);

    const archived =
      await service.archiveMonthlyRoster(actor, {
        monthlyRosterId: "roster-1",
      });
    assert.equal(archived.status, "ARCHIVED");

    await assert.rejects(
      service.updateMonthlyRosterDraft(actor, {
        monthlyRosterId: "roster-1",
        description: "Nope",
      }),
      WorkScheduleStateError,
    );
  });
});

test("Monthly Roster locks structural draft fields while active exceptions exist", async (t) => {
  const actor = createActor([
    Permission.WORK_SCHEDULE_UPDATE,
  ]);

  await t.test("WORKING_TO_OFF blocks rosterMonth", async () => {
    await bindTraceId("trace-roster-lock-month", async () => {
      await assert.rejects(
        createService({
          rosters: [
            seedRoster({
              exceptions: [
                seedRosterException({
                  exceptionType: "WORKING_TO_OFF",
                }),
              ],
            }),
          ],
        }).updateMonthlyRosterDraft(actor, {
          monthlyRosterId: "roster-1",
          rosterMonth: "2026-06",
        }),
        (error: unknown) => {
          assert.ok(error instanceof WorkScheduleStateError);
          assert.match(
            error.message,
            /Structural Monthly Roster fields cannot be changed while active draft exceptions exist/u,
          );
          return true;
        },
      );
    });
  });

  await t.test("CHANGE_TIME blocks departmentOrgUnitId", async () => {
    await bindTraceId("trace-roster-lock-dept", async () => {
      await assert.rejects(
        createService({
          rosters: [
            seedRoster({
              exceptions: [
                seedRosterException({
                  exceptionType: "CHANGE_TIME",
                }),
              ],
            }),
          ],
          orgUnits: [
            {
              id: "dept-1",
              type: "DEPARTMENT",
              status: "ACTIVE",
            },
            {
              id: "dept-2",
              type: "DEPARTMENT",
              status: "ACTIVE",
            },
          ],
        }).updateMonthlyRosterDraft(actor, {
          monthlyRosterId: "roster-1",
          departmentOrgUnitId: "dept-2",
        }),
        WorkScheduleStateError,
      );
    });
  });

  await t.test("ADD_SPECIAL_SHIFT blocks workPatternId", async () => {
    await bindTraceId("trace-roster-lock-pattern", async () => {
      await assert.rejects(
        createService({
          rosters: [
            seedRoster({
              exceptions: [
                seedRosterException({
                  exceptionType: "ADD_SPECIAL_SHIFT",
                }),
              ],
            }),
          ],
          patterns: [
            seedPattern(),
            seedPattern({ workPatternId: "pattern-2" }),
          ],
        }).updateMonthlyRosterDraft(actor, {
          monthlyRosterId: "roster-1",
          workPatternId: "pattern-2",
        }),
        WorkScheduleStateError,
      );
    });
  });

  await t.test("active exception blocks holidayCalendarId", async () => {
    await bindTraceId("trace-roster-lock-calendar", async () => {
      await assert.rejects(
        createService({
          rosters: [
            seedRoster({
              exceptions: [
                seedRosterException({
                  exceptionType: "WORKING_TO_OFF",
                }),
              ],
            }),
          ],
          calendars: [
            seedCalendar(),
            seedCalendar({
              holidayCalendarId: "calendar-2",
            }),
          ],
        }).updateMonthlyRosterDraft(actor, {
          monthlyRosterId: "roster-1",
          holidayCalendarId: "calendar-2",
        }),
        WorkScheduleStateError,
      );
    });
  });
});

test("Monthly Roster permits metadata and same structural values while active exceptions exist", async () => {
  await bindTraceId("trace-roster-lock-allowed", async () => {
    const service = createService({
      rosters: [
        seedRoster({
          exceptions: [
            seedRosterException({
              exceptionType: "CHANGE_TIME",
            }),
          ],
        }),
      ],
    });
    const actor = createActor([
      Permission.WORK_SCHEDULE_UPDATE,
    ]);

    const metadataOnly =
      await service.updateMonthlyRosterDraft(actor, {
        monthlyRosterId: "roster-1",
        description: "Metadata can change",
        externalRef: "ROSTER-EXT-1",
      });

    assert.equal(
      metadataOnly.description,
      "Metadata can change",
    );
    assert.equal(metadataOnly.externalRef, "ROSTER-EXT-1");
    assert.equal(metadataOnly.exceptionCount, 1);

    const sameStructuralValues =
      await service.updateMonthlyRosterDraft(actor, {
        monthlyRosterId: "roster-1",
        rosterMonth: " 2026-05 ",
        departmentOrgUnitId: " dept-1 ",
        workPatternId: " pattern-1 ",
        holidayCalendarId: " calendar-1 ",
        description: "Same structural values",
      });

    assert.equal(
      sameStructuralValues.rosterMonth,
      "2026-05",
    );
    assert.equal(
      sameStructuralValues.departmentOrgUnitId,
      "dept-1",
    );
    assert.equal(
      sameStructuralValues.workPatternId,
      "pattern-1",
    );
    assert.equal(
      sameStructuralValues.holidayCalendarId,
      "calendar-1",
    );
    assert.equal(
      sameStructuralValues.description,
      "Same structural values",
    );
  });
});

test("Monthly Roster structural draft update succeeds after active exceptions are removed", async () => {
  await bindTraceId("trace-roster-lock-after-remove", async () => {
    const service = createService({
      rosters: [
        seedRoster({
          exceptions: [
            seedRosterException({
              exceptionType: "WORKING_TO_OFF",
            }),
          ],
        }),
      ],
      patterns: [
        seedPattern(),
        seedPattern({ workPatternId: "pattern-2" }),
      ],
    });
    const actor = createActor([
      Permission.WORK_SCHEDULE_UPDATE,
    ]);

    await service.removeRosterException(actor, {
      monthlyRosterId: "roster-1",
      rosterExceptionId: "exception-1",
    });

    const updated =
      await service.updateMonthlyRosterDraft(actor, {
        monthlyRosterId: "roster-1",
        workPatternId: "pattern-2",
      });

    assert.equal(updated.status, "DRAFT");
    assert.equal(updated.workPatternId, "pattern-2");
    assert.equal(updated.exceptionCount, 0);
    assert.equal(updated.exceptions[0].status, "REMOVED");
  });
});

test("Monthly Roster structural draft update still enforces active base references", async () => {
  const actor = createActor([
    Permission.WORK_SCHEDULE_UPDATE,
  ]);

  await bindTraceId("trace-roster-update-active-refs", async () => {
    await assert.rejects(
      createService({
        rosters: [seedRoster()],
        orgUnits: [
          {
            id: "dept-1",
            type: "DEPARTMENT",
            status: "ACTIVE",
          },
          {
            id: "dept-2",
            type: "TEAM",
            status: "ARCHIVED",
          },
        ],
      }).updateMonthlyRosterDraft(actor, {
        monthlyRosterId: "roster-1",
        departmentOrgUnitId: "dept-2",
      }),
      WorkScheduleInvalidSubjectReferenceError,
    );

    await assert.rejects(
      createService({
        rosters: [seedRoster()],
        patterns: [
          seedPattern(),
          seedPattern({
            workPatternId: "pattern-2",
            status: "ARCHIVED",
          }),
        ],
      }).updateMonthlyRosterDraft(actor, {
        monthlyRosterId: "roster-1",
        workPatternId: "pattern-2",
      }),
      WorkScheduleInvalidSubjectReferenceError,
    );

    await assert.rejects(
      createService({
        rosters: [seedRoster()],
        calendars: [
          seedCalendar(),
          seedCalendar({
            holidayCalendarId: "calendar-2",
            status: "ARCHIVED",
          }),
        ],
      }).updateMonthlyRosterDraft(actor, {
        monthlyRosterId: "roster-1",
        holidayCalendarId: "calendar-2",
      }),
      WorkScheduleInvalidSubjectReferenceError,
    );
  });
});

test("Roster exceptions persist valid WORKING_TO_OFF, CHANGE_TIME, and ADD_SPECIAL_SHIFT intents", async () => {
  await bindTraceId("trace-roster-exceptions-valid", async () => {
    const service = createService({
      rosters: [seedRoster()],
    });
    const actor = createActor([
      Permission.WORK_SCHEDULE_UPDATE,
    ]);

    const off =
      await service.addRosterException(actor, {
        monthlyRosterId: "roster-1",
        exceptionType: "WORKING_TO_OFF",
        exceptionDate: "2026-05-04",
        subjectEmploymentProfileId: "emp-1",
      });
    assert.equal(off.exceptionCount, 1);

    const change =
      await service.addRosterException(actor, {
        monthlyRosterId: "roster-1",
        exceptionType: "CHANGE_TIME",
        exceptionDate: "2026-05-05",
        subjectEmploymentProfileId: "emp-1",
        startLocalTime: "09:00",
      });
    assert.equal(
      change.exceptions[
        change.exceptions.length - 1
      ].endLocalTime,
      "18:00",
    );

    const special =
      await service.addRosterException(actor, {
        monthlyRosterId: "roster-1",
        exceptionType: "ADD_SPECIAL_SHIFT",
        exceptionDate: "2026-05-09",
        subjectEmploymentProfileId: "emp-1",
        title: "Saturday inventory",
        startLocalTime: "10:00",
        workingMinutes: 120,
        breakMinutes: 30,
        studioResourceIds: ["studio-1"],
      });
    assert.equal(
      special.exceptions[
        special.exceptions.length - 1
      ].endLocalTime,
      "12:30",
    );
  });
});

test("Roster exceptions enforce date/profile/status and standard-candidate validation", async (t) => {
  const actor = createActor([
    Permission.WORK_SCHEDULE_UPDATE,
  ]);

  await t.test("outside month and impossible date", async () => {
    await bindTraceId("trace-exception-date", async () => {
      const service = createService({
        rosters: [seedRoster()],
      });

      await assert.rejects(
        service.addRosterException(actor, {
          monthlyRosterId: "roster-1",
          exceptionType: "WORKING_TO_OFF",
          exceptionDate: "2026-06-01",
          subjectEmploymentProfileId: "emp-1",
        }),
        WorkScheduleValidationError,
      );

      await assert.rejects(
        service.addRosterException(actor, {
          monthlyRosterId: "roster-1",
          exceptionType: "WORKING_TO_OFF",
          exceptionDate: "2026-02-30",
          subjectEmploymentProfileId: "emp-1",
        }),
        WorkScheduleValidationError,
      );
    });
  });

  await t.test("outside department and inactive profile", async () => {
    await bindTraceId("trace-exception-profile", async () => {
      await assert.rejects(
        createService({
          rosters: [seedRoster()],
          profiles: [
            {
              id: "emp-1",
              employmentStatus: "ACTIVE",
              orgUnitId: "other-dept",
              managerEmploymentProfileId: null,
              linkedUserId: null,
            },
            {
              id: "actor-profile",
              employmentStatus: "ACTIVE",
              orgUnitId: "dept-1",
              managerEmploymentProfileId: null,
              linkedUserId: "admin-user-1",
            },
          ],
        }).addRosterException(actor, {
          monthlyRosterId: "roster-1",
          exceptionType: "WORKING_TO_OFF",
          exceptionDate: "2026-05-04",
          subjectEmploymentProfileId: "emp-1",
        }),
        WorkScheduleInvalidSubjectReferenceError,
      );

      await assert.rejects(
        createService({
          rosters: [seedRoster()],
          profiles: [
            {
              id: "emp-1",
              employmentStatus: "ON_LEAVE",
              orgUnitId: "dept-1",
              managerEmploymentProfileId: null,
              linkedUserId: null,
            },
            {
              id: "actor-profile",
              employmentStatus: "ACTIVE",
              orgUnitId: "dept-1",
              managerEmploymentProfileId: null,
              linkedUserId: "admin-user-1",
            },
          ],
        }).addRosterException(actor, {
          monthlyRosterId: "roster-1",
          exceptionType: "WORKING_TO_OFF",
          exceptionDate: "2026-05-04",
          subjectEmploymentProfileId: "emp-1",
        }),
        WorkScheduleInvalidSubjectReferenceError,
      );
    });
  });

  await t.test("archived roster and non-standard candidate", async () => {
    await bindTraceId("trace-exception-state-standard", async () => {
      await assert.rejects(
        createService({
          rosters: [seedRoster({ status: "ARCHIVED" })],
        }).addRosterException(actor, {
          monthlyRosterId: "roster-1",
          exceptionType: "CHANGE_TIME",
          exceptionDate: "2026-05-04",
          subjectEmploymentProfileId: "emp-1",
          startLocalTime: "09:00",
        }),
        WorkScheduleStateError,
      );

      await assert.rejects(
        createService({
          rosters: [seedRoster()],
        }).addRosterException(actor, {
          monthlyRosterId: "roster-1",
          exceptionType: "CHANGE_TIME",
          exceptionDate: "2026-05-09",
          subjectEmploymentProfileId: "emp-1",
          startLocalTime: "09:00",
        }),
        WorkScheduleValidationError,
      );

      await assert.rejects(
        createService({
          rosters: [seedRoster()],
          calendars: [
            seedCalendar({
              activeHolidayDate: "2026-05-04",
            }),
          ],
        }).addRosterException(actor, {
          monthlyRosterId: "roster-1",
          exceptionType: "WORKING_TO_OFF",
          exceptionDate: "2026-05-04",
          subjectEmploymentProfileId: "emp-1",
        }),
        WorkScheduleValidationError,
      );
    });
  });
});

test("Roster exception update/remove and conflict behavior are enforced", async () => {
  await bindTraceId("trace-exception-update-remove", async () => {
    const service = createService({
      rosters: [seedRoster()],
    });
    const actor = createActor([
      Permission.WORK_SCHEDULE_UPDATE,
    ]);
    const added =
      await service.addRosterException(actor, {
        monthlyRosterId: "roster-1",
        exceptionType: "CHANGE_TIME",
        exceptionDate: "2026-05-04",
        subjectEmploymentProfileId: "emp-1",
        startLocalTime: "09:00",
      });
    const exceptionId =
      added.exceptions[0].rosterExceptionId;

    const updated =
      await service.updateRosterException(actor, {
        monthlyRosterId: "roster-1",
        rosterExceptionId: exceptionId,
        exceptionType: "CHANGE_TIME",
        exceptionDate: "2026-05-04",
        subjectEmploymentProfileId: "emp-1",
        startLocalTime: "10:00",
      });
    assert.equal(
      updated.exceptions[0].endLocalTime,
      "19:00",
    );

    await assert.rejects(
      service.addRosterException(actor, {
        monthlyRosterId: "roster-1",
        exceptionType: "WORKING_TO_OFF",
        exceptionDate: "2026-05-04",
        subjectEmploymentProfileId: "emp-1",
      }),
      WorkScheduleConflictError,
    );

    const removed =
      await service.removeRosterException(actor, {
        monthlyRosterId: "roster-1",
        rosterExceptionId: exceptionId,
      });
    assert.equal(
      removed.exceptions[0].status,
      "REMOVED",
    );
  });
});

test("ADD_SPECIAL_SHIFT allows off days but rejects overnight and existing overlaps", async () => {
  await bindTraceId("trace-special-shift-rules", async () => {
    const actor = createActor([
      Permission.WORK_SCHEDULE_UPDATE,
    ]);
    await assert.rejects(
      createService({
        rosters: [seedRoster()],
      }).addRosterException(actor, {
        monthlyRosterId: "roster-1",
        exceptionType: "ADD_SPECIAL_SHIFT",
        exceptionDate: "2026-05-09",
        subjectEmploymentProfileId: "emp-1",
        title: "Overnight",
        startLocalTime: "23:00",
        workingMinutes: 120,
        breakMinutes: 0,
      }),
      WorkScheduleValidationError,
    );

    const workShiftRepository =
      new MemoryWorkShiftRepository();
    workShiftRepository.subjectOverlap = true;
    await assert.rejects(
      createService({
        rosters: [seedRoster()],
        workShiftRepository,
      }).addRosterException(actor, {
        monthlyRosterId: "roster-1",
        exceptionType: "ADD_SPECIAL_SHIFT",
        exceptionDate: "2026-05-09",
        subjectEmploymentProfileId: "emp-1",
        title: "Overlap",
        startLocalTime: "10:00",
        workingMinutes: 60,
        breakMinutes: 0,
      }),
      WorkScheduleOverlapConflictError,
    );
  });
});

test("Monthly Roster planning window is backend-authoritative for create and publish", async () => {
  await bindTraceId("trace-roster-planning-window", async () => {
    const actor = createActor([
      Permission.WORK_SCHEDULE_CREATE,
      Permission.WORK_SCHEDULE_MANAGE_LIFECYCLE,
    ]);

    for (const rosterMonth of [
      "2026-05",
      "2026-06",
      "2026-07",
    ]) {
      const created =
        await createService().createMonthlyRosterDraft(
          actor,
          createRosterPayload({
            rosterCode: `MR-${rosterMonth}`,
            rosterMonth,
          }),
        );
      assert.equal(created.rosterMonth, rosterMonth);
    }

    for (const rosterMonth of [
      "2026-04",
      "2026-08",
    ]) {
      await assert.rejects(
        createService().createMonthlyRosterDraft(
          actor,
          createRosterPayload({
            rosterCode: `MR-${rosterMonth}`,
            rosterMonth,
          }),
        ),
        WorkScheduleValidationError,
      );
    }

    await assert.rejects(
      createService({
        rosters: [
          seedRoster({
            rosterMonth: "2026-08",
          }),
        ],
      }).publishMonthlyRoster(actor, {
        monthlyRosterId: "roster-1",
        expectedPreviewHash: "hash",
      }),
      WorkScheduleValidationError,
    );
  });
});

test("Monthly Roster older drafts allow metadata-only edits but remain unpublishable", async () => {
  await bindTraceId("trace-older-roster-draft", async () => {
    const now = () =>
      Date.parse("2026-06-15T00:00:00.000Z");
    const service = createService({
      rosters: [seedRoster()],
      now,
    });
    const actor = createActor([
      Permission.WORK_SCHEDULE_UPDATE,
      Permission.WORK_SCHEDULE_MANAGE_LIFECYCLE,
    ]);

    const updated = await service.updateMonthlyRosterDraft(
      actor,
      {
        monthlyRosterId: "roster-1",
        description: "Older draft metadata remains editable",
        externalRef: "OLDER-DRAFT",
      },
    );

    assert.equal(
      updated.description,
      "Older draft metadata remains editable",
    );
    assert.equal(updated.externalRef, "OLDER-DRAFT");

    await assert.rejects(
      service.publishMonthlyRoster(actor, {
        monthlyRosterId: "roster-1",
        expectedPreviewHash: "hash",
      }),
      WorkScheduleValidationError,
    );
  });
});

test("Admin Monthly Roster operations require global authority", async () => {
  await bindTraceId("trace-roster-permission-scope", async () => {
    await assert.rejects(
      createService().createMonthlyRosterDraft(
        createActor([Permission.WORK_SCHEDULE_READ]),
        createRosterPayload(),
      ),
      SystemInvariantError,
    );

    await assert.rejects(
      createService().createMonthlyRosterDraft(
        createActor(
          [Permission.WORK_SCHEDULE_CREATE],
          ["self", "team"],
        ),
        createRosterPayload(),
      ),
      WorkSchedulePermissionScopeError,
    );

    await assert.rejects(
      createService().createMonthlyRosterDraft(
        createActor(
          [Permission.WORK_SCHEDULE_CREATE],
          ["department"],
        ),
        {
          ...createRosterPayload(),
          scope: "department",
        },
      ),
      WorkSchedulePermissionScopeError,
    );

    await assert.rejects(
      createService({
        rosters: [seedRoster()],
      }).updateMonthlyRosterDraft(
        createActor(
          [Permission.WORK_SCHEDULE_UPDATE],
          ["department"],
        ),
        {
          monthlyRosterId: "roster-1",
          description: "Not authorized",
          scope: "department",
        },
      ),
      WorkSchedulePermissionScopeError,
    );

    const created =
      await createService().createMonthlyRosterDraft(
        createActor([Permission.WORK_SCHEDULE_CREATE]),
        createRosterPayload(),
      );
    assert.equal(created.status, "DRAFT");
  });
});

test("Monthly Roster read query normalizes filters and enforces read permission", async () => {
  let capturedQuery: unknown;
  const readService =
    new MonthlyRosterAdminQueryService(
      {
        listMonthlyRosters: async (input: unknown) => {
          capturedQuery = input;
          return { items: [] };
        },
        getMonthlyRosterDetail: async () => ({
          ...seedRoster(),
          exceptionCount: 0,
        }),
      },
      {
        findById: async () => null,
        findByLinkedUserId: async () => null,
        listIdsByManagerEmploymentProfileId: async () => [],
        listIdsByActiveTalentGroupIds: async () => [],
        listIdsByOrgUnitId: async () => [],
        listByOrgUnitId: async () => [],
        listTalentGroupMemberEmploymentProfileResolutions:
          async () => [],
      },
      {
        listWorkPatterns: async () => ({ items: [] }),
        getWorkPatternDetail: async () => null,
      },
      {
        listHolidayCalendars: async () => ({ items: [] }),
        getHolidayCalendarDetail: async () => null,
        listActiveEntriesForDateRange: async () => [],
      },
      {
        listWorkShifts: async () => ({ items: [] }),
        listWorkShiftsBySubject: async () => ({ items: [] }),
        listWorkShiftsByResource: async () => ({ items: [] }),
        getWorkShiftDetail: async () => null,
        listActiveEmploymentProfileShiftsForWindow:
          async () => [],
      },
      {
        findById: async () => null,
      },
      {
        findById: async () => null,
      },
    );

  await assert.rejects(
    readService.listMonthlyRosters(
      createActor([Permission.WORK_SCHEDULE_UPDATE]),
      {},
    ),
    SystemInvariantError,
  );

  await assert.rejects(
    readService.listMonthlyRosters(
      createActor(
        [Permission.WORK_SCHEDULE_READ],
        ["department"],
      ),
      {
        scope: "department",
        departmentOrgUnitId: "dept-1",
      },
    ),
    WorkSchedulePermissionScopeError,
  );

  const list = await readService.listMonthlyRosters(
    createActor([Permission.WORK_SCHEDULE_READ]),
    {
      status: "draft",
      rosterMonth: "2026-05",
      departmentOrgUnitId: "dept-1",
      search: "MR",
    },
  );
  assert.equal(list.items.length, 0);
  assert.deepEqual(capturedQuery, {
    status: "DRAFT",
    rosterMonth: "2026-05",
    departmentOrgUnitId: "dept-1",
    targetType: undefined,
    targetOrgUnitId: undefined,
    targetTalentGroupId: undefined,
    workPatternId: undefined,
    holidayCalendarId: undefined,
    limit: 20,
    cursor: undefined,
    search: "mr",
  });
});

test("Admin applies approved availability lines to a DRAFT Monthly Roster without creating WorkShifts", async () => {
  await bindTraceId("trace-roster-apply-availability-success", async () => {
    const availabilityRepository =
      new MemoryAvailabilityRepository({
        batches: [seedAvailabilityBatch()],
        lines: [
          seedAvailabilityLine({
            id: "line-off",
            availabilityType: "UNAVAILABLE_FULL_DAY",
            taxonomyCode: "AUTHORIZED_LEAVE",
            dateRangeStart: "2026-05-04",
          }),
          seedAvailabilityLine({
            id: "line-time",
            availabilityType: "PREFERRED_TIME",
            taxonomyCode: "SHIFT_CHANGE",
            dateRangeStart: "2026-05-05",
            preferredStartLocalTime: "09:00",
            preferredEndLocalTime: "18:00",
          }),
          seedAvailabilityLine({
            id: "line-note",
            availabilityType: "OTHER_AVAILABILITY_NOTE",
            taxonomyCode: "OTHER",
            dateRangeStart: "2026-05-06",
            applyStatus: "ADVISORY_ONLY",
          }),
        ],
      });
    const workShiftRepository =
      new MemoryWorkShiftRepository();
    const service = createService({
      rosters: [seedRoster()],
      availabilityRepository,
      workShiftRepository,
      now: () => 1000,
    });

    const result =
      await service.applyAvailabilityLinesToMonthlyRoster(
        createActor([Permission.WORK_SCHEDULE_UPDATE]),
        {
          monthlyRosterId: "roster-1",
          availabilityLineIds: [
            "line-off",
            "line-time",
            "line-note",
          ],
          applyNote: "Apply accepted availability to draft roster",
        },
      );

    assert.equal(result.appliedCount, 2);
    assert.equal(result.advisoryOnlyCount, 1);
    assert.equal(result.failedCount, 0);
    assert.deepEqual(
      result.results.map((item) => item.outcome),
      ["APPLIED", "APPLIED", "ADVISORY_ONLY"],
    );
    assert.equal(workShiftRepository.records.length, 0);

    const roster = await (
      service as unknown as {
        rosterRepository: MemoryMonthlyRosterRepository;
      }
    ).rosterRepository.findById("roster-1");
    assert.equal(
      roster?.exceptions.filter(
        (exception) => exception.status === "ACTIVE",
      ).length,
      2,
    );
    const off = roster?.exceptions.find(
      (exception) =>
        exception.sourceAvailabilityLineId === "line-off",
    );
    assert.equal(off?.exceptionType, "WORKING_TO_OFF");
    assert.equal(off?.sourceAvailabilityBatchId, "availability-batch-1");
    assert.equal(off?.sourceAvailabilityType, "UNAVAILABLE_FULL_DAY");
    assert.equal(off?.sourceAvailabilityTaxonomyCode, "AUTHORIZED_LEAVE");
    assert.equal(off?.sourceAppliedAt, 1000);
    assert.equal(off?.sourceAppliedByActorId, "admin-user-1");
    const changed = roster?.exceptions.find(
      (exception) =>
        exception.sourceAvailabilityLineId === "line-time",
    );
    assert.equal(changed?.exceptionType, "CHANGE_TIME");
    assert.equal(changed?.startLocalTime, "09:00");
    assert.equal(changed?.endLocalTime, "18:00");

    const line = availabilityRepository.lines.find(
      (candidate) => candidate.id === "line-off",
    );
    assert.equal(line?.applyStatus, "APPLIED");
    assert.equal(line?.appliedRosterId, "roster-1");
    assert.equal(line?.appliedRosterExceptionIds.length, 1);
    assert.equal(line?.policyEvaluationStatus, "NOT_EVALUATED");
    assert.equal(
      availabilityRepository.lines.find(
        (candidate) => candidate.id === "line-note",
      )?.applyStatus,
      "ADVISORY_ONLY",
    );
  });
});

test("Admin apply availability is idempotent, conflict-safe, and fails closed for invalid lines", async () => {
  await bindTraceId("trace-roster-apply-availability-guards", async () => {
    const availabilityRepository =
      new MemoryAvailabilityRepository({
        batches: [
          seedAvailabilityBatch(),
          seedAvailabilityBatch({
            id: "batch-other",
            targetOrgUnitId: "dept-other",
          }),
        ],
        lines: [
          seedAvailabilityLine({
            id: "line-applied",
            dateRangeStart: "2026-05-04",
          }),
          seedAvailabilityLine({
            id: "line-pending",
            dateRangeStart: "2026-05-05",
            status: "PENDING",
          }),
          seedAvailabilityLine({
            id: "line-unrepresentable-time",
            availabilityType: "PREFERRED_TIME",
            taxonomyCode: "SHIFT_CHANGE",
            dateRangeStart: "2026-05-06",
            preferredStartLocalTime: "10:00",
            preferredEndLocalTime: "12:00",
          }),
          seedAvailabilityLine({
            id: "line-target-mismatch",
            batchId: "batch-other",
            dateRangeStart: "2026-05-07",
            targetOrgUnitId: "dept-other",
          }),
          seedAvailabilityLine({
            id: "line-date-range",
            dateRangeStart: "2026-05-07",
            dateRangeEnd: "2026-05-08",
          }),
        ],
      });
    const service = createService({
      rosters: [
        seedRoster({
          exceptions: [
            seedRosterException({
              rosterExceptionId: "existing-source",
              exceptionDate: "2026-05-04",
              sourceAvailabilityLineId: "line-applied",
            }),
            seedRosterException({
              rosterExceptionId: "existing-conflict",
              exceptionDate: "2026-05-07",
            }),
          ],
        }),
      ],
      availabilityRepository,
      now: () => 2000,
    });

    const result =
      await service.applyAvailabilityLinesToMonthlyRoster(
        createActor([Permission.WORK_SCHEDULE_UPDATE]),
        {
          monthlyRosterId: "roster-1",
          availabilityLineIds: [
            "line-applied",
            "line-pending",
            "line-unrepresentable-time",
            "line-target-mismatch",
            "line-date-range",
          ],
        },
      );

    assert.deepEqual(
      result.results.map((item) => item.outcome),
      [
        "SKIPPED_ALREADY_APPLIED",
        "FAILED",
        "FAILED",
        "FAILED",
        "FAILED",
      ],
    );
    assert.equal(result.appliedCount, 0);
    assert.equal(result.skippedAlreadyAppliedCount, 1);
    assert.equal(result.failedCount, 4);
    assert.equal(
      availabilityRepository.lines.find(
        (line) => line.id === "line-pending",
      )?.applyStatus,
      "NOT_APPLIED",
    );

    const rangeRepository =
      new MemoryAvailabilityRepository({
        batches: [seedAvailabilityBatch()],
        lines: [
          seedAvailabilityLine({
            id: "line-range",
            dateRangeStart: "2026-05-04",
            dateRangeEnd: "2026-05-05",
          }),
        ],
      });
    const rangeService = createService({
      rosters: [seedRoster()],
      availabilityRepository: rangeRepository,
      now: () => 3000,
    });
    const rangeResult =
      await rangeService.applyAvailabilityLinesToMonthlyRoster(
        createActor([Permission.WORK_SCHEDULE_UPDATE]),
        {
          monthlyRosterId: "roster-1",
          availabilityLineIds: ["line-range"],
        },
      );
    assert.equal(rangeResult.appliedCount, 1);
    assert.equal(
      rangeResult.results[0]?.rosterExceptionIds.length,
      2,
    );
  });
});

test("Admin apply availability route exists and requires update plus global scope", async () => {
  await bindTraceId("trace-roster-apply-availability-authority", async () => {
    const rosterRoutes = await readFile(
      "src/modules/work-schedule/admin/admin.monthly-roster.routes.ts",
      "utf8",
    );
    assert.equal(
      rosterRoutes.includes("/apply-availability-lines"),
      true,
    );

    const availabilityRepository =
      new MemoryAvailabilityRepository({
        batches: [seedAvailabilityBatch()],
        lines: [
          seedAvailabilityLine({
            id: "line-off",
            dateRangeStart: "2026-05-04",
          }),
        ],
      });
    const service = createService({
      rosters: [seedRoster()],
      availabilityRepository,
    });

    await assert.rejects(
      service.applyAvailabilityLinesToMonthlyRoster(
        createActor([Permission.WORK_SCHEDULE_READ]),
        {
          monthlyRosterId: "roster-1",
          availabilityLineIds: ["line-off"],
        },
      ),
      SystemInvariantError,
    );
    await assert.rejects(
      service.applyAvailabilityLinesToMonthlyRoster(
        createActor(
          [Permission.WORK_SCHEDULE_UPDATE],
          ["team"],
        ),
        {
          monthlyRosterId: "roster-1",
          availabilityLineIds: ["line-off"],
        },
      ),
      WorkSchedulePermissionScopeError,
    );
    await assert.rejects(
      service.applyAvailabilityLinesToMonthlyRoster(
        new Actor({
          id: "self-user",
          type: "staff",
          context: "SELF_SERVICE",
          roles: [],
          permissions: [Permission.WORK_SCHEDULE_UPDATE],
          scopeGrants: { workSchedule: ["global"] },
          isActive: true,
        }),
        {
          monthlyRosterId: "roster-1",
          availabilityLineIds: ["line-off"],
        },
      ),
      SystemInvariantError,
    );
    await assert.rejects(
      createService({
        rosters: [seedRoster({ status: "PUBLISHED" })],
        availabilityRepository,
      }).applyAvailabilityLinesToMonthlyRoster(
        createActor([Permission.WORK_SCHEDULE_UPDATE]),
        {
          monthlyRosterId: "roster-1",
          availabilityLineIds: ["line-off"],
        },
      ),
      WorkScheduleStateError,
    );
  });
});

test("Monthly Roster publish requires global dispatcher scope because it creates official Work Shifts", async () => {
  await assert.rejects(
    createService({ rosters: [seedRoster()] }).publishMonthlyRoster(
      createActor(
        [Permission.WORK_SCHEDULE_MANAGE_LIFECYCLE],
        ["self", "team", "department"],
      ),
      {
        monthlyRosterId: "roster-1",
        expectedPreviewHash: "hash",
      },
    ),
    WorkSchedulePermissionScopeError,
  );
});

test("Monthly Roster publish generates Work Shifts from current preview with source metadata and backend shift codes", async () => {
  await bindTraceId("trace-monthly-roster-publish", async () => {
    const roster = seedRoster({
      exceptions: [
        seedRosterException({
          rosterExceptionId: "ex-off",
          exceptionType: "WORKING_TO_OFF",
          exceptionDate: "2026-05-04",
        }),
        seedRosterException({
          rosterExceptionId: "ex-change",
          exceptionType: "CHANGE_TIME",
          exceptionDate: "2026-05-05",
        }),
        seedRosterException({
          rosterExceptionId: "ex-special",
          exceptionType: "ADD_SPECIAL_SHIFT",
          exceptionDate: "2026-05-01",
        }),
      ],
    });
    const calendar = seedCalendar({
      activeHolidayDate: "2026-05-01",
    });
    const workShiftRepository =
      new MemoryWorkShiftRepository();
    const service = createService({
      rosters: [roster],
      calendars: [calendar],
      workShiftRepository,
    });
    const hash = expectedPreviewHash({
      roster,
      calendar,
    });

    const result = await service.publishMonthlyRoster(
      createActor([
        Permission.WORK_SCHEDULE_MANAGE_LIFECYCLE,
      ]),
      {
        monthlyRosterId: "roster-1",
        expectedPreviewHash: hash,
      },
    );

    assert.equal(result.status, "PUBLISHED");
    assert.equal(result.computedPreviewHash, hash);
    assert.equal(result.conflictCount, 0);
    assert.equal(result.skippedWorkingToOffCount, 1);
    assert.equal(result.holidaySuppressedCount, 2);
    assert.equal(result.changeTimeCount, 1);
    assert.equal(result.addSpecialShiftCount, 1);
    assert.equal(
      result.generatedWorkShiftCount,
      workShiftRepository.records.length,
    );
    assert.ok(
      workShiftRepository.records.every((record) =>
        /^WS-\d{8}-\d{4}$/u.test(record.shiftCode),
      ),
    );
    assert.equal(
      new Set(
        workShiftRepository.records.map(
          (record) => record.shiftCode,
        ),
      ).size,
      workShiftRepository.records.length,
    );

    const standard = workShiftRepository.records.find(
      (record) =>
        record.subjectEmploymentProfileId === "emp-1" &&
        record.sourceRosterLocalDate === "2026-05-06" &&
        record.sourceRosterSlotKey === "STANDARD",
    );
    assert.ok(standard);
    assert.equal(standard.sourceType, "ROSTER_GENERATED");
    assert.equal(standard.sourceRosterId, "roster-1");
    assert.equal(standard.sourcePatternId, "pattern-1");
    assert.equal(standard.sourceExceptionId, null);
    assert.equal(
      standard.sourceGenerationRunId,
      result.sourceGenerationRunId,
    );
    assert.equal(standard.sourceRosterMonth, "2026-05");
    assert.equal(
      standard.sourceDepartmentOrgUnitId,
      "dept-1",
    );

    assert.equal(
      workShiftRepository.records.some(
        (record) =>
          record.subjectEmploymentProfileId === "emp-1" &&
          record.sourceRosterLocalDate === "2026-05-04",
      ),
      false,
    );
    assert.equal(
      workShiftRepository.records.some(
        (record) =>
          record.sourceRosterLocalDate === "2026-05-01" &&
          record.sourceRosterSlotKey === "STANDARD",
      ),
      false,
    );

    const changed = workShiftRepository.records.find(
      (record) =>
        record.sourceExceptionId === "ex-change" &&
        record.sourceRosterSlotKey === "STANDARD",
    );
    assert.ok(changed);
    assert.equal(
      changed.shiftStartAt,
      vietnamUtc("2026-05-05", "09:00"),
    );

    const special = workShiftRepository.records.find(
      (record) =>
        record.sourceRosterSlotKey ===
        "ADD_SPECIAL_SHIFT:ex-special",
    );
    assert.ok(special);
    assert.equal(special.sourceExceptionId, "ex-special");
    assert.equal(special.title, "Special shift");
  });
});

test("Monthly Roster publish rejects stale hash, conflicts, unauthorized actors, and idempotently no-ops after success", async () => {
  await bindTraceId("trace-monthly-roster-publish-guards", async () => {
    await assert.rejects(
      createService({
        rosters: [seedRoster()],
      }).publishMonthlyRoster(
        createActor([
          Permission.WORK_SCHEDULE_MANAGE_LIFECYCLE,
        ]),
        {
          monthlyRosterId: "roster-1",
          expectedPreviewHash: "stale",
        },
      ),
      WorkScheduleConflictError,
    );

    await assert.rejects(
      createService({
        rosters: [seedRoster()],
      }).publishMonthlyRoster(
        createActor([Permission.WORK_SCHEDULE_UPDATE]),
        {
          monthlyRosterId: "roster-1",
          expectedPreviewHash: expectedPreviewHash(),
        },
      ),
      SystemInvariantError,
    );

    const conflictRepository =
      new MemoryWorkShiftRepository();
    conflictRepository.subjectOverlap = true;
    await assert.rejects(
      createService({
        rosters: [seedRoster()],
        workShiftRepository: conflictRepository,
      }).publishMonthlyRoster(
        createActor([
          Permission.WORK_SCHEDULE_MANAGE_LIFECYCLE,
        ]),
        {
          monthlyRosterId: "roster-1",
          expectedPreviewHash: expectedPreviewHash(),
        },
      ),
      WorkScheduleOverlapConflictError,
    );
    assert.equal(conflictRepository.records.length, 0);

    const repository = new MemoryWorkShiftRepository();
    const service = createService({
      rosters: [seedRoster()],
      workShiftRepository: repository,
    });
    const first = await service.publishMonthlyRoster(
      createActor([
        Permission.WORK_SCHEDULE_MANAGE_LIFECYCLE,
      ]),
      {
        monthlyRosterId: "roster-1",
        expectedPreviewHash: expectedPreviewHash(),
        idempotencyKey: "retry-1",
      },
    );
    const countAfterFirst = repository.records.length;
    const second = await service.publishMonthlyRoster(
      createActor([
        Permission.WORK_SCHEDULE_MANAGE_LIFECYCLE,
      ]),
      {
        monthlyRosterId: "roster-1",
        idempotencyKey: "retry-1",
      },
    );

    assert.equal(repository.records.length, countAfterFirst);
    assert.equal(second.status, "PUBLISHED");
    assert.equal(
      second.generatedWorkShiftCount,
      first.generatedWorkShiftCount,
    );
  });
});

test("Monthly Roster publish blocks candidate self-conflicts from the shared preview", async () => {
  await bindTraceId(
    "trace-monthly-roster-publish-candidate-conflict",
    async () => {
      const roster = seedRoster({
        exceptions: [
          seedRosterException({
            rosterExceptionId: "ex-special-overlap",
            exceptionType: "ADD_SPECIAL_SHIFT",
            exceptionDate: "2026-05-04",
            startLocalTime: "10:00",
            workingMinutes: 60,
            breakMinutes: 0,
          }),
        ],
      });
      const workShiftRepository =
        new MemoryWorkShiftRepository();

      await assert.rejects(
        createService({
          rosters: [roster],
          workShiftRepository,
        }).publishMonthlyRoster(
          createActor([
            Permission.WORK_SCHEDULE_MANAGE_LIFECYCLE,
          ]),
          {
            monthlyRosterId: "roster-1",
            expectedPreviewHash: expectedPreviewHash({
              roster,
            }),
          },
        ),
        WorkScheduleOverlapConflictError,
      );

      assert.equal(workShiftRepository.records.length, 0);
      assert.equal(roster.status, "DRAFT");
      assert.equal(roster.publishedAt, null);
      assert.equal(roster.publishedByUserId, null);
      assert.equal(roster.publishGenerationRunId, null);
    },
  );
});

test("Monthly Roster publish succeeds when candidate rows only touch at boundaries", async () => {
  await bindTraceId(
    "trace-monthly-roster-publish-candidate-boundary",
    async () => {
      const roster = seedRoster({
        exceptions: [
          seedRosterException({
            rosterExceptionId: "ex-special-boundary",
            exceptionType: "ADD_SPECIAL_SHIFT",
            exceptionDate: "2026-05-04",
            startLocalTime: "17:00",
            workingMinutes: 60,
            breakMinutes: 0,
          }),
        ],
      });
      const workShiftRepository =
        new MemoryWorkShiftRepository();
      const result = await createService({
        rosters: [roster],
        workShiftRepository,
      }).publishMonthlyRoster(
        createActor([
          Permission.WORK_SCHEDULE_MANAGE_LIFECYCLE,
        ]),
        {
          monthlyRosterId: "roster-1",
          expectedPreviewHash: expectedPreviewHash({
            roster,
          }),
        },
      );

      assert.equal(result.status, "PUBLISHED");
      assert.equal(result.conflictCount, 0);
      assert.equal(
        workShiftRepository.records.some(
          (record) =>
            record.sourceRosterSlotKey ===
            "ADD_SPECIAL_SHIFT:ex-special-boundary",
        ),
        true,
      );
    },
  );
});

test("Monthly Roster publish duplicate protection leaves roster draft metadata unchanged when transaction rollback cannot be exercised by memory tests", async () => {
  await bindTraceId(
    "trace-monthly-roster-publish-duplicate-protection",
    async () => {
      const roster = seedRoster();
      const workShiftRepository =
        new MemoryWorkShiftRepository();
      workShiftRepository.records.push({
        id: "preexisting-generated",
        shiftCode: "WS-20260504-9999",
        normalizedShiftCode: "ws-20260504-9999",
        title: "Preexisting generated shift",
        normalizedTitle: "preexisting generated shift",
        subjectKind: "EMPLOYMENT_PROFILE",
        subjectEmploymentProfileId: "actor-profile",
        subjectTalentId: null,
        subjectTalentGroupId: null,
        studioResourceIds: [],
        status: "ACTIVE",
        shiftStartAt: vietnamUtc("2026-05-01", "08:00"),
        shiftEndAt: vietnamUtc("2026-05-01", "17:00"),
        description: null,
        externalRef: null,
        sourceType: "ROSTER_GENERATED",
        sourceRosterId: "roster-1",
        sourcePatternId: "pattern-1",
        sourceExceptionId: null,
        sourceGenerationRunId: "preexisting-run",
        sourceRosterMonth: "2026-05",
        sourceDepartmentOrgUnitId: "dept-1",
        sourceRosterTargetType: "ORG_UNIT",
        sourceRosterTargetId: "dept-1",
        sourceRosterTargetMode: "EXACT_ONLY",
        sourceMemberIdentityType: "EMPLOYMENT_PROFILE",
        sourceRosterLocalDate: "2026-05-01",
        sourceRosterSlotKey: "STANDARD",
        createdAt: 1,
        updatedAt: 1,
      });

      await assert.rejects(
        createService({
          rosters: [roster],
          workShiftRepository,
        }).publishMonthlyRoster(
          createActor([
            Permission.WORK_SCHEDULE_MANAGE_LIFECYCLE,
          ]),
          {
            monthlyRosterId: "roster-1",
            expectedPreviewHash: expectedPreviewHash({
              roster,
            }),
          },
        ),
        WorkScheduleConflictError,
      );

      assert.equal(workShiftRepository.records.length, 1);
      assert.equal(roster.status, "DRAFT");
      assert.equal(roster.publishedAt, null);
      assert.equal(roster.publishedByUserId, null);
      assert.equal(roster.publishGenerationRunId, null);
    },
  );
});

test("Monthly Roster read repository defaults to non-archived and supports roster filters", async () => {
  let capturedQuery: unknown;
  const repository =
    new NativeMongoMonthlyRosterReadRepository({
      collection() {
        return {
          find(query: unknown) {
            capturedQuery = query;
            return {
              sort() {
                return {
                  limit() {
                    return {
                      toArray: async () => [],
                    };
                  },
                };
              },
            };
          },
        };
      },
    } as never);

  await repository.listMonthlyRosters({
    limit: 20,
    rosterMonth: "2026-05",
    departmentOrgUnitId: "dept-1",
    search: "mr",
  });

  assert.deepEqual(capturedQuery, {
    $and: [
      {
        status: {
          $ne: "ARCHIVED",
        },
      },
      { rosterMonth: "2026-05" },
      { departmentOrgUnitId: "dept-1" },
      {
        normalizedRosterCode: {
          $gte: "mr",
          $lt: "mr\uffff",
        },
      },
    ],
  });
});

test("Monthly Roster routes are present with preview and publish and without lock, approval, or generated shift routes", async () => {
  const adminRoutes = await readFile(
    "src/app/router/admin.routes.ts",
    "utf8",
  );
  const rosterRoutes = await readFile(
    "src/modules/work-schedule/admin/admin.monthly-roster.routes.ts",
    "utf8",
  );

  assert.equal(
    adminRoutes.includes("/work-schedule/rosters"),
    true,
  );
  assert.equal(
    rosterRoutes.includes("ROSTER_EXCEPTION_ADD"),
    true,
  );
  assert.equal(rosterRoutes.includes("/preview"), true);
  assert.equal(rosterRoutes.includes("/publish"), true);
  assert.equal(
    rosterRoutes.includes("MONTHLY_ROSTER_PREVIEW"),
    true,
  );
  assert.equal(
    rosterRoutes.includes("MONTHLY_ROSTER_PUBLISH"),
    true,
  );

  for (const text of [adminRoutes, rosterRoutes]) {
    assert.equal(text.includes("/lock"), false);
    assert.equal(
      text.includes("roster-change-requests"),
      false,
    );
    assert.equal(text.includes("approval"), false);
  }
});
