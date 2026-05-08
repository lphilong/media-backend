import {
  HolidayCalendarEntryRecord,
  HolidayCalendarListItemView,
  HolidayCalendarStatus,
  HolidayCalendarView,
  MonthlyRosterListItemView,
  MonthlyRosterStatus,
  MonthlyRosterView,
  WorkPatternListItemView,
  WorkPatternStatus,
  WorkPatternView,
  WorkShiftByResourceListItemView,
  WorkShiftBySubjectListItemView,
  WorkShiftDetailView,
  WorkShiftListItemView,
  WorkShiftSortDirection,
  WorkShiftSortField,
  WorkShiftSourceType,
  WorkShiftStatus,
  WorkShiftSubjectKind,
} from "@modules/work-schedule/domain/work-schedule.types";

export interface WorkShiftListReadInput {
  readonly status?: WorkShiftStatus;
  readonly subjectKind?: WorkShiftSubjectKind;
  readonly subjectEmploymentProfileId?: string;
  readonly subjectTalentId?: string;
  readonly subjectTalentGroupId?: string;
  readonly containsStudioResourceId?: string;
  readonly sourceType?: WorkShiftSourceType;
  readonly sourceRosterId?: string;
  readonly sourceDepartmentOrgUnitId?: string;
  readonly sourceRosterMonth?: string;
  readonly windowStartAt?: number;
  readonly windowEndAt?: number;
  readonly limit: number;
  readonly cursor?: string;
  readonly search?: string;
  readonly sortField?: WorkShiftSortField;
  readonly sortDirection?: WorkShiftSortDirection;
  readonly scopeEmploymentProfileIds?: readonly string[];
}

export interface WorkShiftBySubjectListReadInput {
  readonly subjectKind: WorkShiftSubjectKind;
  readonly subjectEmploymentProfileId: string | null;
  readonly subjectTalentId: string | null;
  readonly subjectTalentGroupId: string | null;
  readonly status?: WorkShiftStatus;
  readonly windowStartAt?: number;
  readonly windowEndAt?: number;
  readonly limit: number;
  readonly cursor?: string;
  readonly sortField?: WorkShiftSortField;
  readonly sortDirection?: WorkShiftSortDirection;
  readonly scopeEmploymentProfileIds?: readonly string[];
}

export interface WorkShiftByResourceListReadInput {
  readonly studioResourceId: string;
  readonly status?: WorkShiftStatus;
  readonly windowStartAt?: number;
  readonly windowEndAt?: number;
  readonly limit: number;
  readonly cursor?: string;
  readonly sortField?: WorkShiftSortField;
  readonly sortDirection?: WorkShiftSortDirection;
  readonly scopeEmploymentProfileIds?: readonly string[];
}

export interface ActiveEmploymentProfileWorkShiftLookupInput {
  readonly subjectEmploymentProfileIds: readonly string[];
  readonly windowStartAt: number;
  readonly windowEndAt: number;
}

export interface ActiveEmploymentProfileWorkShiftConflictView {
  readonly workShiftId: string;
  readonly shiftCode: string;
  readonly title: string;
  readonly subjectEmploymentProfileId: string;
  readonly status: "ACTIVE";
  readonly shiftStartAt: number;
  readonly shiftEndAt: number;
  readonly sourceType: WorkShiftSourceType;
  readonly sourceRosterId: string | null;
  readonly sourceRosterMonth: string | null;
  readonly sourceRosterLocalDate: string | null;
  readonly sourceRosterSlotKey: string | null;
}

export interface WorkShiftListReadResult {
  readonly items: readonly WorkShiftListItemView[];
  readonly nextCursor?: string;
}

export interface WorkShiftBySubjectListReadResult {
  readonly items: readonly WorkShiftBySubjectListItemView[];
  readonly nextCursor?: string;
}

export interface WorkShiftByResourceListReadResult {
  readonly items: readonly WorkShiftByResourceListItemView[];
  readonly nextCursor?: string;
}

export interface WorkShiftReadRepository {
  listWorkShifts(
    input: WorkShiftListReadInput,
  ): Promise<WorkShiftListReadResult>;

  listWorkShiftsBySubject(
    input: WorkShiftBySubjectListReadInput,
  ): Promise<WorkShiftBySubjectListReadResult>;

  listWorkShiftsByResource(
    input: WorkShiftByResourceListReadInput,
  ): Promise<WorkShiftByResourceListReadResult>;

  getWorkShiftDetail(
    workShiftId: string,
  ): Promise<WorkShiftDetailView | null>;

  listActiveEmploymentProfileShiftsForWindow(
    input: ActiveEmploymentProfileWorkShiftLookupInput,
  ): Promise<
    readonly ActiveEmploymentProfileWorkShiftConflictView[]
  >;
}

export interface WorkPatternListReadInput {
  readonly status?: WorkPatternStatus;
  readonly limit: number;
  readonly cursor?: string;
  readonly search?: string;
}

export interface WorkPatternListReadResult {
  readonly items: readonly WorkPatternListItemView[];
  readonly nextCursor?: string;
}

export interface WorkPatternReadRepository {
  listWorkPatterns(
    input: WorkPatternListReadInput,
  ): Promise<WorkPatternListReadResult>;

  getWorkPatternDetail(
    workPatternId: string,
  ): Promise<WorkPatternView | null>;
}

export interface HolidayCalendarListReadInput {
  readonly status?: HolidayCalendarStatus;
  readonly limit: number;
  readonly cursor?: string;
  readonly search?: string;
}

export interface HolidayCalendarListReadResult {
  readonly items: readonly HolidayCalendarListItemView[];
  readonly nextCursor?: string;
}

export interface HolidayCalendarActiveEntryLookupInput {
  readonly holidayCalendarId: string;
  readonly startDate: string;
  readonly endDate: string;
}

export interface HolidayCalendarReadRepository {
  listHolidayCalendars(
    input: HolidayCalendarListReadInput,
  ): Promise<HolidayCalendarListReadResult>;

  getHolidayCalendarDetail(
    holidayCalendarId: string,
  ): Promise<HolidayCalendarView | null>;

  listActiveEntriesForDateRange(
    input: HolidayCalendarActiveEntryLookupInput,
  ): Promise<readonly HolidayCalendarEntryRecord[]>;
}

export interface MonthlyRosterListReadInput {
  readonly status?: MonthlyRosterStatus;
  readonly rosterMonth?: string;
  readonly departmentOrgUnitId?: string;
  readonly workPatternId?: string;
  readonly holidayCalendarId?: string;
  readonly limit: number;
  readonly cursor?: string;
  readonly search?: string;
}

export interface MonthlyRosterListReadResult {
  readonly items: readonly MonthlyRosterListItemView[];
  readonly nextCursor?: string;
}

export interface MonthlyRosterReadRepository {
  listMonthlyRosters(
    input: MonthlyRosterListReadInput,
  ): Promise<MonthlyRosterListReadResult>;

  getMonthlyRosterDetail(
    monthlyRosterId: string,
  ): Promise<MonthlyRosterView | null>;
}
