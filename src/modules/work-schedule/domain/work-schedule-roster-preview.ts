import crypto from "crypto";
import { assertWorkScheduleDateOnlyWithinRosterMonth } from "./work-schedule-date";
import { WorkScheduleValidationError } from "./work-schedule.errors";
import {
  HolidayCalendarEntryRecord,
  MonthlyRosterPreviewExcludedMemberView,
  MonthlyRosterPreviewConflictView,
  MonthlyRosterPreviewRowView,
  MonthlyRosterPreviewSummaryView,
  MonthlyRosterPreviewView,
  MonthlyRosterView,
  RosterExceptionRecord,
  WorkPatternView,
  WorkPatternWeekdayToken,
} from "./work-schedule.types";
import { ActiveEmploymentProfileWorkShiftConflictView } from "../read/work-schedule.read-repository";

export interface MonthlyRosterPreviewEligibleProfileInput {
  readonly id: string;
  readonly employmentStatus: "ACTIVE";
  readonly orgUnitId: string;
}

export function buildMonthlyRosterPreview(params: {
  readonly roster: MonthlyRosterView;
  readonly pattern: WorkPatternView;
  readonly activeHolidayEntries: readonly HolidayCalendarEntryRecord[];
  readonly eligibleProfiles: readonly MonthlyRosterPreviewEligibleProfileInput[];
  readonly excludedMembers?: readonly MonthlyRosterPreviewExcludedMemberView[];
  readonly existingActiveShifts: readonly ActiveEmploymentProfileWorkShiftConflictView[];
}): MonthlyRosterPreviewView {
  const profiles = [...params.eligibleProfiles].sort(
    (left, right) => left.id.localeCompare(right.id),
  );
  const eligibleProfileIds = profiles.map(
    (profile) => profile.id,
  );
  const activeEntries = [
    ...params.activeHolidayEntries,
  ].sort((left, right) =>
    left.date === right.date
      ? left.holidayCalendarEntryId.localeCompare(
          right.holidayCalendarEntryId,
        )
      : left.date.localeCompare(right.date),
  );
  const rows = addCandidateSelfConflicts(
    buildPreviewRows({
      monthlyRosterId: params.roster.monthlyRosterId,
      rosterMonth: params.roster.rosterMonth,
      targetType: params.roster.targetType,
      targetMode: params.roster.targetMode,
      targetOrgUnitId: params.roster.targetOrgUnitId,
      targetTalentGroupId:
        params.roster.targetTalentGroupId,
      departmentOrgUnitId:
        params.roster.departmentOrgUnitId,
      profileIds: eligibleProfileIds,
      dates: enumerateRosterMonthDates(
        params.roster.rosterMonth,
      ),
      pattern: params.pattern,
      activeHolidayEntries: activeEntries,
      exceptions: params.roster.exceptions,
      existingActiveShifts:
        params.existingActiveShifts,
    }),
  );
  const summary = summarizePreviewRows(
    eligibleProfileIds.length,
    (params.excludedMembers ?? []).length,
    rows,
  );
  const computedPreviewHash = computePreviewHash({
    roster: {
      monthlyRosterId: params.roster.monthlyRosterId,
      rosterMonth: params.roster.rosterMonth,
      timezone: params.roster.timezone,
      targetType: params.roster.targetType,
      targetMode: params.roster.targetMode,
      targetOrgUnitId: params.roster.targetOrgUnitId,
      targetTalentGroupId:
        params.roster.targetTalentGroupId,
      departmentOrgUnitId:
        params.roster.departmentOrgUnitId,
      workPatternId: params.roster.workPatternId,
      holidayCalendarId:
        params.roster.holidayCalendarId,
      draftVersion: params.roster.draftVersion,
    },
    eligibleProfileIds,
    excludedMembers: params.excludedMembers ?? [],
    rows,
    summary,
  });

  return {
    monthlyRosterId: params.roster.monthlyRosterId,
    rosterMonth: params.roster.rosterMonth,
    timezone: params.roster.timezone,
    targetType: params.roster.targetType,
    targetMode: params.roster.targetMode,
    targetOrgUnitId: params.roster.targetOrgUnitId,
    targetTalentGroupId:
      params.roster.targetTalentGroupId,
    departmentOrgUnitId:
      params.roster.departmentOrgUnitId,
    workPatternId: params.roster.workPatternId,
    holidayCalendarId:
      params.roster.holidayCalendarId,
    rosterStatus: params.roster.status,
    draftVersion: params.roster.draftVersion,
    currentPreviewHash: params.roster.previewHash,
    computedPreviewHash,
    eligibleProfiles: profiles.map((profile) => ({
      subjectEmploymentProfileId: profile.id,
      employmentStatus: "ACTIVE",
      departmentOrgUnitId: profile.orgUnitId,
    })),
    excludedMembers: params.excludedMembers ?? [],
    rows,
    summary,
    warnings:
      (params.excludedMembers ?? []).length > 0
        ? ["EXCLUDED_MEMBERS_PRESENT"]
        : [],
  };
}

export function enumerateRosterMonthDates(
  rosterMonth: string,
): readonly string[] {
  const [year, month] = rosterMonth
    .split("-")
    .map(Number);
  const daysInMonth = new Date(
    Date.UTC(year, month, 0),
  ).getUTCDate();
  const dates: string[] = [];

  for (let day = 1; day <= daysInMonth; day += 1) {
    dates.push(
      `${rosterMonth}-${String(day).padStart(2, "0")}`,
    );
  }

  return dates;
}

export function rosterMonthUtcWindow(
  rosterMonth: string,
): {
  readonly windowStartAt: number;
  readonly windowEndAt: number;
} {
  const [year, month] = rosterMonth
    .split("-")
    .map(Number);
  const nextMonthYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;

  return {
    windowStartAt: Date.UTC(
      year,
      month - 1,
      1,
      -7,
      0,
    ),
    windowEndAt: Date.UTC(
      nextMonthYear,
      nextMonth - 1,
      1,
      -7,
      0,
    ),
  };
}

function buildPreviewRows(params: {
  readonly monthlyRosterId: string;
  readonly rosterMonth: string;
  readonly targetType: MonthlyRosterView["targetType"];
  readonly targetMode: MonthlyRosterView["targetMode"];
  readonly targetOrgUnitId: string | null;
  readonly targetTalentGroupId: string | null;
  readonly departmentOrgUnitId: string | null;
  readonly profileIds: readonly string[];
  readonly dates: readonly string[];
  readonly pattern: WorkPatternView;
  readonly activeHolidayEntries: readonly HolidayCalendarEntryRecord[];
  readonly exceptions: readonly RosterExceptionRecord[];
  readonly existingActiveShifts: readonly ActiveEmploymentProfileWorkShiftConflictView[];
}): readonly MonthlyRosterPreviewRowView[] {
  const eligibleProfileIds = new Set(params.profileIds);
  const holidayByDate = new Map<
    string,
    HolidayCalendarEntryRecord
  >();
  const standardExceptionByProfileDate = new Map<
    string,
    RosterExceptionRecord
  >();
  const specialExceptionsByProfileDate = new Map<
    string,
    RosterExceptionRecord[]
  >();

  for (const entry of params.activeHolidayEntries) {
    if (!holidayByDate.has(entry.date)) {
      holidayByDate.set(entry.date, entry);
    }
  }

  for (const exception of params.exceptions) {
    if (exception.status !== "ACTIVE") {
      continue;
    }

    assertValidPersistedExceptionBase(
      exception,
      params.rosterMonth,
      eligibleProfileIds,
    );

    const key = profileDateKey(
      exception.subjectEmploymentProfileId,
      exception.exceptionDate,
    );

    if (exception.exceptionType === "ADD_SPECIAL_SHIFT") {
      const current =
        specialExceptionsByProfileDate.get(key) ?? [];
      current.push(exception);
      specialExceptionsByProfileDate.set(key, current);
      continue;
    }

    if (standardExceptionByProfileDate.has(key)) {
      throw new WorkScheduleValidationError(
        "Monthly Roster preview found contradictory ACTIVE standard exceptions for one profile/date",
      );
    }

    standardExceptionByProfileDate.set(key, exception);
  }

  for (const specialExceptions of specialExceptionsByProfileDate.values()) {
    specialExceptions.sort((left, right) =>
      left.rosterExceptionId.localeCompare(
        right.rosterExceptionId,
      ),
    );
  }

  const rows: MonthlyRosterPreviewRowView[] = [];

  for (const date of params.dates) {
    const weekday = weekdayTokenForDate(date);
    const isWorkingDay =
      params.pattern.workingDays.includes(weekday);
    const holiday = holidayByDate.get(date) ?? null;

    for (const profileId of params.profileIds) {
      const key = profileDateKey(profileId, date);
      const standardException =
        standardExceptionByProfileDate.get(key) ?? null;

      if (standardException) {
        assertStandardExceptionHasCandidate({
          exception: standardException,
          isWorkingDay,
          holiday,
        });
      }

      if (isWorkingDay) {
        if (holiday) {
          rows.push(
            buildSuppressedRow({
              monthlyRosterId: params.monthlyRosterId,
              rosterMonth: params.rosterMonth,
              targetType: params.targetType,
              targetMode: params.targetMode,
              targetOrgUnitId: params.targetOrgUnitId,
              targetTalentGroupId:
                params.targetTalentGroupId,
              departmentOrgUnitId:
                params.departmentOrgUnitId,
              profileId,
              date,
              rowKind: "HOLIDAY_SUPPRESSED",
              exception: null,
              holiday,
            }),
          );
        } else if (
          standardException?.exceptionType ===
          "WORKING_TO_OFF"
        ) {
          rows.push(
            buildSuppressedRow({
              monthlyRosterId: params.monthlyRosterId,
              rosterMonth: params.rosterMonth,
              targetType: params.targetType,
              targetMode: params.targetMode,
              targetOrgUnitId: params.targetOrgUnitId,
              targetTalentGroupId:
                params.targetTalentGroupId,
              departmentOrgUnitId:
                params.departmentOrgUnitId,
              profileId,
              date,
              rowKind: "WORKING_TO_OFF",
              exception: standardException,
              holiday: null,
            }),
          );
        } else {
          rows.push(
            buildCandidateRowWithConflicts({
              monthlyRosterId:
                params.monthlyRosterId,
              rosterMonth: params.rosterMonth,
              targetType: params.targetType,
              targetMode: params.targetMode,
              targetOrgUnitId: params.targetOrgUnitId,
              targetTalentGroupId:
                params.targetTalentGroupId,
              departmentOrgUnitId:
                params.departmentOrgUnitId,
              profileId,
              date,
              rowKind:
                standardException?.exceptionType ===
                "CHANGE_TIME"
                  ? "CHANGE_TIME"
                  : "STANDARD",
              sourceExceptionId:
                standardException?.exceptionType ===
                "CHANGE_TIME"
                  ? standardException.rosterExceptionId
                  : null,
              sourceRosterSlotKey: "STANDARD",
              startLocalTime:
                standardException?.exceptionType ===
                "CHANGE_TIME"
                  ? requireExceptionLocalTime(
                      standardException,
                    )
                  : params.pattern.startLocalTime,
              workingMinutes:
                params.pattern.workingMinutes,
              breakMinutes: params.pattern.breakMinutes,
              holiday: null,
              existingActiveShifts:
                params.existingActiveShifts,
            }),
          );
        }
      }

      for (const exception of specialExceptionsByProfileDate.get(
        key,
      ) ?? []) {
        assertSpecialExceptionShape(exception);
        rows.push(
          buildCandidateRowWithConflicts({
            monthlyRosterId: params.monthlyRosterId,
            rosterMonth: params.rosterMonth,
            targetType: params.targetType,
            targetMode: params.targetMode,
            targetOrgUnitId: params.targetOrgUnitId,
            targetTalentGroupId:
              params.targetTalentGroupId,
            departmentOrgUnitId:
              params.departmentOrgUnitId,
            profileId,
            date,
            rowKind: "ADD_SPECIAL_SHIFT",
            sourceExceptionId:
              exception.rosterExceptionId,
            sourceRosterSlotKey: `ADD_SPECIAL_SHIFT:${exception.rosterExceptionId}`,
            startLocalTime:
              exception.startLocalTime as string,
            workingMinutes:
              exception.workingMinutes as number,
            breakMinutes:
              exception.breakMinutes as number,
            holiday,
            existingActiveShifts:
              params.existingActiveShifts,
          }),
        );
      }
    }
  }

  return rows;
}

function addCandidateSelfConflicts(
  rows: readonly MonthlyRosterPreviewRowView[],
): readonly MonthlyRosterPreviewRowView[] {
  const conflictsByRowId = new Map<
    string,
    MonthlyRosterPreviewConflictView[]
  >();
  const candidatesByProfile = new Map<
    string,
    MonthlyRosterPreviewRowView[]
  >();

  for (const row of rows) {
    if (
      !row.isCandidateShift ||
      row.shiftStartAt === null ||
      row.shiftEndAt === null
    ) {
      continue;
    }

    const current =
      candidatesByProfile.get(
        row.subjectEmploymentProfileId,
      ) ?? [];
    current.push(row);
    candidatesByProfile.set(
      row.subjectEmploymentProfileId,
      current,
    );
  }

  for (const candidates of candidatesByProfile.values()) {
    const sorted = [...candidates].sort(
      compareCandidateRowsForConflictDetection,
    );

    for (let leftIndex = 0; leftIndex < sorted.length; leftIndex += 1) {
      const left = sorted[leftIndex];

      if (
        left.shiftStartAt === null ||
        left.shiftEndAt === null
      ) {
        continue;
      }

      for (
        let rightIndex = leftIndex + 1;
        rightIndex < sorted.length;
        rightIndex += 1
      ) {
        const right = sorted[rightIndex];

        if (
          right.shiftStartAt === null ||
          right.shiftEndAt === null
        ) {
          continue;
        }

        if (right.shiftStartAt >= left.shiftEndAt) {
          break;
        }

        if (left.shiftStartAt < right.shiftEndAt) {
          appendCandidateSelfConflict(
            conflictsByRowId,
            left,
            right,
          );
          appendCandidateSelfConflict(
            conflictsByRowId,
            right,
            left,
          );
        }
      }
    }
  }

  if (conflictsByRowId.size === 0) {
    return rows;
  }

  return rows.map((row) => {
    const candidateConflicts =
      conflictsByRowId.get(row.previewRowId) ?? [];

    if (candidateConflicts.length === 0) {
      return row;
    }

    const conflicts = [
      ...row.conflicts,
      ...candidateConflicts,
    ].sort(comparePreviewConflicts);
    const blockers = row.blockers.includes(
      "SUBJECT_OVERLAP",
    )
      ? row.blockers
      : [...row.blockers, "SUBJECT_OVERLAP"];

    return {
      ...row,
      conflicts,
      blockers,
    };
  });
}

function compareCandidateRowsForConflictDetection(
  left: MonthlyRosterPreviewRowView,
  right: MonthlyRosterPreviewRowView,
): number {
  return (
    compareNullableNumbers(
      left.shiftStartAt,
      right.shiftStartAt,
    ) ||
    compareNullableNumbers(
      left.shiftEndAt,
      right.shiftEndAt,
    ) ||
    left.previewRowId.localeCompare(right.previewRowId)
  );
}

function comparePreviewConflicts(
  left: MonthlyRosterPreviewConflictView,
  right: MonthlyRosterPreviewConflictView,
): number {
  return (
    left.conflictKind.localeCompare(right.conflictKind) ||
    (left.relatedPreviewRowId ?? "").localeCompare(
      right.relatedPreviewRowId ?? "",
    ) ||
    (left.workShiftId ?? "").localeCompare(
      right.workShiftId ?? "",
    ) ||
    left.shiftStartAt - right.shiftStartAt ||
    left.shiftEndAt - right.shiftEndAt
  );
}

function compareNullableNumbers(
  left: number | null,
  right: number | null,
): number {
  if (left === right) {
    return 0;
  }

  if (left === null) {
    return 1;
  }

  if (right === null) {
    return -1;
  }

  return left - right;
}

function appendCandidateSelfConflict(
  conflictsByRowId: Map<
    string,
    MonthlyRosterPreviewConflictView[]
  >,
  row: MonthlyRosterPreviewRowView,
  relatedRow: MonthlyRosterPreviewRowView,
): void {
  const current =
    conflictsByRowId.get(row.previewRowId) ?? [];
  current.push(toCandidatePreviewConflict(relatedRow));
  conflictsByRowId.set(row.previewRowId, current);
}

function buildSuppressedRow(params: {
  readonly monthlyRosterId: string;
  readonly rosterMonth: string;
  readonly targetType: MonthlyRosterView["targetType"];
  readonly targetMode: MonthlyRosterView["targetMode"];
  readonly targetOrgUnitId: string | null;
  readonly targetTalentGroupId: string | null;
  readonly departmentOrgUnitId: string | null;
  readonly profileId: string;
  readonly date: string;
  readonly rowKind: "WORKING_TO_OFF" | "HOLIDAY_SUPPRESSED";
  readonly exception: RosterExceptionRecord | null;
  readonly holiday: HolidayCalendarEntryRecord | null;
}): MonthlyRosterPreviewRowView {
  return {
    previewRowId: previewRowId({
      monthlyRosterId: params.monthlyRosterId,
      profileId: params.profileId,
      date: params.date,
      rowKind: params.rowKind,
      sourceExceptionId:
        params.exception?.rosterExceptionId ?? null,
      sourceRosterSlotKey: null,
    }),
    monthlyRosterId: params.monthlyRosterId,
    rosterMonth: params.rosterMonth,
    targetType: params.targetType,
    targetMode: params.targetMode,
    targetOrgUnitId: params.targetOrgUnitId,
    targetTalentGroupId: params.targetTalentGroupId,
    departmentOrgUnitId: params.departmentOrgUnitId,
    subjectEmploymentProfileId: params.profileId,
    localDate: params.date,
    rowKind: params.rowKind,
    sourceExceptionId:
      params.exception?.rosterExceptionId ?? null,
    sourceRosterSlotKey: null,
    startLocalTime: null,
    endLocalTime: null,
    shiftStartAt: null,
    shiftEndAt: null,
    workingMinutes: null,
    breakMinutes: null,
    holidayCalendarEntryId:
      params.holiday?.holidayCalendarEntryId ?? null,
    holidayName: params.holiday?.name ?? null,
    holidayEntryType:
      params.holiday?.entryType ?? null,
    isCandidateShift: false,
    isSuppressed: true,
    conflicts: [],
    warnings: [],
    blockers: [],
  };
}

function buildCandidateRowWithConflicts(params: {
  readonly monthlyRosterId: string;
  readonly rosterMonth: string;
  readonly targetType: MonthlyRosterView["targetType"];
  readonly targetMode: MonthlyRosterView["targetMode"];
  readonly targetOrgUnitId: string | null;
  readonly targetTalentGroupId: string | null;
  readonly departmentOrgUnitId: string | null;
  readonly profileId: string;
  readonly date: string;
  readonly rowKind: "STANDARD" | "CHANGE_TIME" | "ADD_SPECIAL_SHIFT";
  readonly sourceExceptionId: string | null;
  readonly sourceRosterSlotKey: string;
  readonly startLocalTime: string;
  readonly workingMinutes: number;
  readonly breakMinutes: number;
  readonly holiday: HolidayCalendarEntryRecord | null;
  readonly existingActiveShifts: readonly ActiveEmploymentProfileWorkShiftConflictView[];
}): MonthlyRosterPreviewRowView {
  const endLocalTime = calculateEndLocalTime({
    startLocalTime: params.startLocalTime,
    workingMinutes: params.workingMinutes,
    breakMinutes: params.breakMinutes,
  });
  const shiftStartAt = toVietnamLocalUtcMillis(
    params.date,
    params.startLocalTime,
  );
  const shiftEndAt = toVietnamLocalUtcMillis(
    params.date,
    endLocalTime,
  );
  const conflicts = params.existingActiveShifts
    .filter(
      (shift) =>
        shift.subjectEmploymentProfileId ===
          params.profileId &&
        shift.shiftStartAt < shiftEndAt &&
        shift.shiftEndAt > shiftStartAt,
    )
    .map(toPreviewConflict);

  return {
    previewRowId: previewRowId({
      monthlyRosterId: params.monthlyRosterId,
      profileId: params.profileId,
      date: params.date,
      rowKind: params.rowKind,
      sourceExceptionId: params.sourceExceptionId,
      sourceRosterSlotKey: params.sourceRosterSlotKey,
    }),
    monthlyRosterId: params.monthlyRosterId,
    rosterMonth: params.rosterMonth,
    targetType: params.targetType,
    targetMode: params.targetMode,
    targetOrgUnitId: params.targetOrgUnitId,
    targetTalentGroupId: params.targetTalentGroupId,
    departmentOrgUnitId: params.departmentOrgUnitId,
    subjectEmploymentProfileId: params.profileId,
    localDate: params.date,
    rowKind: params.rowKind,
    sourceExceptionId: params.sourceExceptionId,
    sourceRosterSlotKey: params.sourceRosterSlotKey,
    startLocalTime: params.startLocalTime,
    endLocalTime,
    shiftStartAt,
    shiftEndAt,
    workingMinutes: params.workingMinutes,
    breakMinutes: params.breakMinutes,
    holidayCalendarEntryId:
      params.holiday?.holidayCalendarEntryId ?? null,
    holidayName: params.holiday?.name ?? null,
    holidayEntryType:
      params.holiday?.entryType ?? null,
    isCandidateShift: true,
    isSuppressed: false,
    conflicts,
    warnings: [],
    blockers:
      conflicts.length > 0
        ? ["SUBJECT_OVERLAP"]
        : [],
  };
}

function toPreviewConflict(
  shift: ActiveEmploymentProfileWorkShiftConflictView,
): MonthlyRosterPreviewConflictView {
  return {
    conflictKind: "SUBJECT_OVERLAP",
    workShiftId: shift.workShiftId,
    relatedPreviewRowId: null,
    shiftCode: shift.shiftCode,
    title: shift.title,
    status: shift.status,
    shiftStartAt: shift.shiftStartAt,
    shiftEndAt: shift.shiftEndAt,
    sourceType: shift.sourceType,
    sourceRosterId: shift.sourceRosterId,
    sourceRosterMonth: shift.sourceRosterMonth,
    sourceRosterLocalDate:
      shift.sourceRosterLocalDate,
    sourceRosterSlotKey: shift.sourceRosterSlotKey,
  };
}

function toCandidatePreviewConflict(
  row: MonthlyRosterPreviewRowView,
): MonthlyRosterPreviewConflictView {
  if (
    row.shiftStartAt === null ||
    row.shiftEndAt === null
  ) {
    throw new WorkScheduleValidationError(
      "Monthly Roster candidate self-conflict is missing candidate timing",
    );
  }

  return {
    conflictKind: "CANDIDATE_SUBJECT_OVERLAP",
    workShiftId: null,
    relatedPreviewRowId: row.previewRowId,
    shiftCode: null,
    title: null,
    status: null,
    shiftStartAt: row.shiftStartAt,
    shiftEndAt: row.shiftEndAt,
    sourceType: null,
    sourceRosterId: row.monthlyRosterId,
    sourceRosterMonth: row.rosterMonth,
    sourceRosterLocalDate: row.localDate,
    sourceRosterSlotKey: row.sourceRosterSlotKey,
  };
}

function summarizePreviewRows(
  totalEligibleProfiles: number,
  excludedMemberCount: number,
  rows: readonly MonthlyRosterPreviewRowView[],
): MonthlyRosterPreviewSummaryView {
  return {
    totalEligibleProfiles,
    includedMemberCount: totalEligibleProfiles,
    excludedMemberCount,
    totalStandardCandidateShifts: rows.filter(
      (row) =>
        row.rowKind === "STANDARD" ||
        row.rowKind === "CHANGE_TIME" ||
        row.rowKind === "WORKING_TO_OFF" ||
        row.rowKind === "HOLIDAY_SUPPRESSED",
    ).length,
    totalHolidaySuppressions: rows.filter(
      (row) => row.rowKind === "HOLIDAY_SUPPRESSED",
    ).length,
    totalWorkingToOff: rows.filter(
      (row) => row.rowKind === "WORKING_TO_OFF",
    ).length,
    totalChangeTime: rows.filter(
      (row) => row.rowKind === "CHANGE_TIME",
    ).length,
    totalAddSpecialShift: rows.filter(
      (row) => row.rowKind === "ADD_SPECIAL_SHIFT",
    ).length,
    totalCandidateShiftsAfterExceptions: rows.filter(
      (row) => row.isCandidateShift,
    ).length,
    totalConflicts: rows.reduce(
      (total, row) => total + row.conflicts.length,
      0,
    ),
  };
}

function computePreviewHash(input: unknown): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex");
}

function assertValidPersistedExceptionBase(
  exception: RosterExceptionRecord,
  rosterMonth: string,
  eligibleProfileIds: ReadonlySet<string>,
): void {
  assertWorkScheduleDateOnlyWithinRosterMonth(
    exception.exceptionDate,
    rosterMonth,
    {
      field: "exceptionDate",
      invalidDateMessage:
        "Monthly Roster preview found an ACTIVE exception with invalid exceptionDate",
      outsideMonthMessage:
        "Monthly Roster preview found an ACTIVE exception outside rosterMonth",
    },
  );

  if (
    !eligibleProfileIds.has(
      exception.subjectEmploymentProfileId,
    )
  ) {
    throw new WorkScheduleValidationError(
      "Monthly Roster preview found an ACTIVE exception for an ineligible Employment Profile",
    );
  }
}

function assertStandardExceptionHasCandidate(params: {
  readonly exception: RosterExceptionRecord;
  readonly isWorkingDay: boolean;
  readonly holiday: HolidayCalendarEntryRecord | null;
}): void {
  if (!params.isWorkingDay || params.holiday) {
    throw new WorkScheduleValidationError(
      "Monthly Roster preview found an ACTIVE standard exception without a standard roster candidate",
    );
  }

  if (
    params.exception.exceptionType === "CHANGE_TIME" &&
    !params.exception.startLocalTime
  ) {
    throw new WorkScheduleValidationError(
      "Monthly Roster preview found a CHANGE_TIME exception without startLocalTime",
    );
  }
}

function assertSpecialExceptionShape(
  exception: RosterExceptionRecord,
): void {
  if (
    exception.exceptionType !== "ADD_SPECIAL_SHIFT" ||
    !exception.title ||
    !exception.startLocalTime ||
    typeof exception.workingMinutes !== "number" ||
    typeof exception.breakMinutes !== "number"
  ) {
    throw new WorkScheduleValidationError(
      "Monthly Roster preview found an invalid ADD_SPECIAL_SHIFT exception",
    );
  }
}

function requireExceptionLocalTime(
  exception: RosterExceptionRecord,
): string {
  if (!exception.startLocalTime) {
    throw new WorkScheduleValidationError(
      "Monthly Roster preview found a CHANGE_TIME exception without startLocalTime",
    );
  }

  return exception.startLocalTime;
}

function profileDateKey(
  profileId: string,
  date: string,
): string {
  return `${profileId}:${date}`;
}

function previewRowId(params: {
  readonly monthlyRosterId: string;
  readonly profileId: string;
  readonly date: string;
  readonly rowKind: string;
  readonly sourceExceptionId: string | null;
  readonly sourceRosterSlotKey: string | null;
}): string {
  return [
    params.monthlyRosterId,
    params.date,
    params.profileId,
    params.rowKind,
    params.sourceExceptionId ?? "NO_EXCEPTION",
    params.sourceRosterSlotKey ?? "NO_SLOT",
  ].join(":");
}

function weekdayTokenForDate(
  date: string,
): WorkPatternWeekdayToken {
  const [year, month, day] = date
    .split("-")
    .map(Number);
  const parsed = new Date(
    Date.UTC(year, month - 1, day),
  );
  const tokens: readonly WorkPatternWeekdayToken[] =
    ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

  return tokens[parsed.getUTCDay()];
}

function calculateEndLocalTime(params: {
  readonly startLocalTime: string;
  readonly workingMinutes: number;
  readonly breakMinutes: number;
}): string {
  const start = parseLocalTimeMinutes(
    params.startLocalTime,
  );
  const total =
    start +
    params.workingMinutes +
    params.breakMinutes;

  if (total >= 24 * 60) {
    throw new WorkScheduleValidationError(
      "Monthly Roster preview windows must end within the same local calendar date",
    );
  }

  return formatLocalTimeMinutes(total);
}

function parseLocalTimeMinutes(value: string): number {
  const [hourText, minuteText] = value.split(":");
  return Number(hourText) * 60 + Number(minuteText);
}

function formatLocalTimeMinutes(value: number): string {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function toVietnamLocalUtcMillis(
  date: string,
  time: string,
): number {
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
