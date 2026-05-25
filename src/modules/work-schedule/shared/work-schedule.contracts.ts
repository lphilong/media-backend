import {
  HolidayCalendarEntryRecord,
  HolidayCalendarEntryType,
  HolidayCalendarListItemView,
  HolidayCalendarMutationView,
  HolidayCalendarStatus,
  HolidayCalendarView,
  MonthlyRosterListItemView,
  MonthlyRosterMutationView,
  MonthlyRosterPreviewView,
  MonthlyRosterStatus,
  MonthlyRosterView,
  RosterExceptionType,
  WorkScheduleRequestListItemView,
  WorkScheduleRequestStatus,
  WorkScheduleRequestType,
  WorkScheduleRequestView,
  WorkPatternListItemView,
  WorkPatternMutationView,
  WorkPatternStatus,
  WorkPatternView,
  WorkPatternWeekdayToken,
  WorkShiftByResourceListItemView,
  WorkShiftBySubjectListItemView,
  WorkShiftDetailView,
  WorkShiftListItemView,
  WorkShiftMutationView,
  WorkShiftScope,
  WorkShiftSortDirection,
  WorkShiftSortField,
  WorkShiftSourceType,
  WorkShiftStatus,
  WorkShiftSubjectKind,
} from "@modules/work-schedule/domain/work-schedule.types";

export interface CreateWorkShiftCommand {
  readonly shiftCode?: string | null;
  readonly title: string;
  readonly subjectKind: WorkShiftSubjectKind | string;
  readonly subjectEmploymentProfileId?: string | null;
  readonly subjectTalentId?: string | null;
  readonly subjectTalentGroupId?: string | null;
  readonly studioResourceIds?: readonly string[];
  readonly shiftStartAt: number;
  readonly shiftEndAt: number;
  readonly description?: string | null;
  readonly externalRef?: string | null;
  readonly scope?: WorkShiftScope | string;
}

export interface CreateWorkPatternCommand {
  readonly patternCode?: string | null;
  readonly name: string;
  readonly timezone?: string;
  readonly startLocalTime: string;
  readonly workingMinutes?: number;
  readonly breakMinutes?: number;
  readonly workingDays: readonly (WorkPatternWeekdayToken | string)[];
  readonly description?: string | null;
  readonly externalRef?: string | null;
}

export interface UpdateWorkPatternCommand {
  readonly workPatternId: string;
  readonly name?: string;
  readonly timezone?: string;
  readonly startLocalTime?: string;
  readonly workingMinutes?: number;
  readonly breakMinutes?: number;
  readonly workingDays?: readonly (WorkPatternWeekdayToken | string)[];
  readonly description?: string | null;
  readonly externalRef?: string | null;
}

export interface WorkPatternLifecycleCommand {
  readonly workPatternId: string;
}

export interface CreateHolidayCalendarCommand {
  readonly calendarCode?: string | null;
  readonly name: string;
  readonly scopeType?: string;
  readonly timezone?: string;
  readonly description?: string | null;
  readonly externalRef?: string | null;
}

export interface UpdateHolidayCalendarCommand {
  readonly holidayCalendarId: string;
  readonly name?: string;
  readonly description?: string | null;
  readonly externalRef?: string | null;
}

export interface HolidayCalendarLifecycleCommand {
  readonly holidayCalendarId: string;
}

export interface AddHolidayCalendarEntryCommand {
  readonly holidayCalendarId: string;
  readonly date: string;
  readonly entryType: HolidayCalendarEntryType | string;
  readonly name: string;
  readonly description?: string | null;
  readonly externalRef?: string | null;
}

export interface UpdateHolidayCalendarEntryCommand {
  readonly holidayCalendarId: string;
  readonly holidayCalendarEntryId: string;
  readonly date?: string;
  readonly entryType?: HolidayCalendarEntryType | string;
  readonly name?: string;
  readonly description?: string | null;
  readonly externalRef?: string | null;
}

export interface RemoveHolidayCalendarEntryCommand {
  readonly holidayCalendarId: string;
  readonly holidayCalendarEntryId: string;
}

export interface CreateMonthlyRosterDraftCommand {
  readonly rosterCode?: string | null;
  readonly rosterMonth: string;
  readonly timezone?: string;
  readonly departmentOrgUnitId: string;
  readonly workPatternId: string;
  readonly holidayCalendarId: string;
  readonly description?: string | null;
  readonly externalRef?: string | null;
  readonly scope?: WorkShiftScope | string;
}

export interface UpdateMonthlyRosterDraftCommand {
  readonly monthlyRosterId: string;
  readonly rosterMonth?: string;
  readonly timezone?: string;
  readonly departmentOrgUnitId?: string;
  readonly workPatternId?: string;
  readonly holidayCalendarId?: string;
  readonly description?: string | null;
  readonly externalRef?: string | null;
  readonly scope?: WorkShiftScope | string;
}

export interface MonthlyRosterLifecycleCommand {
  readonly monthlyRosterId: string;
  readonly scope?: WorkShiftScope | string;
}

export interface PublishMonthlyRosterCommand {
  readonly monthlyRosterId: string;
  readonly expectedPreviewHash?: string;
  readonly idempotencyKey?: string | null;
  readonly note?: string | null;
  readonly scope?: WorkShiftScope | string;
}

export interface AddRosterExceptionCommand {
  readonly monthlyRosterId: string;
  readonly exceptionType: RosterExceptionType | string;
  readonly exceptionDate: string;
  readonly subjectEmploymentProfileId: string;
  readonly title?: string | null;
  readonly startLocalTime?: string;
  readonly workingMinutes?: number;
  readonly breakMinutes?: number;
  readonly studioResourceIds?: readonly string[];
  readonly reason?: string | null;
  readonly sourceNote?: string | null;
  readonly description?: string | null;
  readonly externalRef?: string | null;
  readonly scope?: WorkShiftScope | string;
}

export interface UpdateRosterExceptionCommand
  extends AddRosterExceptionCommand {
  readonly rosterExceptionId: string;
}

export interface RemoveRosterExceptionCommand {
  readonly monthlyRosterId: string;
  readonly rosterExceptionId: string;
  readonly scope?: WorkShiftScope | string;
}

export interface CreateWorkScheduleRequestCommand {
  readonly requestType: WorkScheduleRequestType | string;
  readonly targetEmploymentProfileId: string;
  readonly targetWorkShiftId?: string | null;
  readonly reason: string;
  readonly proposedStartAt?: number | null;
  readonly proposedEndAt?: number | null;
  readonly proposedTitle?: string | null;
  readonly proposedStudioResourceIds?: readonly string[];
  readonly proposedDescription?: string | null;
  readonly proposedExternalRef?: string | null;
}

export interface ApproveWorkScheduleRequestCommand {
  readonly requestId: string;
  readonly approvalNote?: string | null;
}

export interface RejectWorkScheduleRequestCommand {
  readonly requestId: string;
  readonly rejectionReason: string;
}

export interface CancelWorkScheduleRequestCommand {
  readonly requestId: string;
  readonly cancellationReason?: string | null;
}

export interface UpdateWorkShiftCoreCommand {
  readonly workShiftId: string;
  readonly title?: string;
  readonly description?: string | null;
  readonly externalRef?: string | null;
  readonly scope?: WorkShiftScope | string;
}

export interface RescheduleWorkShiftCommand {
  readonly workShiftId: string;
  readonly newShiftStartAt: number;
  readonly newShiftEndAt: number;
  readonly scope?: WorkShiftScope | string;
}

export interface ReassignWorkShiftSubjectCommand {
  readonly workShiftId: string;
  readonly newSubjectKind: WorkShiftSubjectKind | string;
  readonly newSubjectEmploymentProfileId?: string | null;
  readonly newSubjectTalentId?: string | null;
  readonly newSubjectTalentGroupId?: string | null;
  readonly scope?: WorkShiftScope | string;
}

export interface UpdateWorkShiftResourcesCommand {
  readonly workShiftId: string;
  readonly newStudioResourceIds: readonly string[];
  readonly scope?: WorkShiftScope | string;
}

export interface CancelWorkShiftCommand {
  readonly workShiftId: string;
  readonly scope?: WorkShiftScope | string;
}

export interface ArchiveWorkShiftCommand {
  readonly workShiftId: string;
  readonly scope?: WorkShiftScope | string;
}

export interface GetWorkShiftDetailQuery {
  readonly workShiftId: string;
  readonly scope?: WorkShiftScope | string;
}

export interface ListWorkShiftsQuery {
  readonly status?: WorkShiftStatus | string;
  readonly subjectKind?: WorkShiftSubjectKind | string;
  readonly subjectEmploymentProfileId?: string;
  readonly subjectTalentId?: string;
  readonly subjectTalentGroupId?: string;
  readonly containsStudioResourceId?: string;
  readonly sourceType?: WorkShiftSourceType | string;
  readonly sourceRosterId?: string;
  readonly sourceDepartmentOrgUnitId?: string;
  readonly sourceRosterMonth?: string;
  readonly windowStartAt?: number | string;
  readonly windowEndAt?: number | string;
  readonly limit?: number | string;
  readonly cursor?: string;
  readonly search?: string;
  readonly sortBy?: WorkShiftSortField | string;
  readonly sortDirection?: WorkShiftSortDirection | string;
  readonly scope?: WorkShiftScope | string;
}

export interface ListWorkShiftsBySubjectQuery {
  readonly subjectKind: WorkShiftSubjectKind | string;
  readonly subjectEmploymentProfileId?: string;
  readonly subjectTalentId?: string;
  readonly subjectTalentGroupId?: string;
  readonly status?: WorkShiftStatus | string;
  readonly windowStartAt?: number | string;
  readonly windowEndAt?: number | string;
  readonly limit?: number | string;
  readonly cursor?: string;
  readonly sortBy?: WorkShiftSortField | string;
  readonly sortDirection?: WorkShiftSortDirection | string;
  readonly scope?: WorkShiftScope | string;
}

export interface ListWorkShiftsByResourceQuery {
  readonly studioResourceId: string;
  readonly status?: WorkShiftStatus | string;
  readonly windowStartAt?: number | string;
  readonly windowEndAt?: number | string;
  readonly limit?: number | string;
  readonly cursor?: string;
  readonly sortBy?: WorkShiftSortField | string;
  readonly sortDirection?: WorkShiftSortDirection | string;
  readonly scope?: WorkShiftScope | string;
}

export interface GetWorkPatternDetailQuery {
  readonly workPatternId: string;
}

export interface ListWorkPatternsQuery {
  readonly status?: WorkPatternStatus | string;
  readonly limit?: number | string;
  readonly cursor?: string;
  readonly search?: string;
}

export interface GetHolidayCalendarDetailQuery {
  readonly holidayCalendarId: string;
}

export interface ListHolidayCalendarsQuery {
  readonly status?: HolidayCalendarStatus | string;
  readonly limit?: number | string;
  readonly cursor?: string;
  readonly search?: string;
}

export interface GetMonthlyRosterDetailQuery {
  readonly monthlyRosterId: string;
  readonly scope?: WorkShiftScope | string;
}

export interface PreviewMonthlyRosterQuery {
  readonly monthlyRosterId: string;
  readonly scope?: WorkShiftScope | string;
}

export interface ListMonthlyRostersQuery {
  readonly status?: MonthlyRosterStatus | string;
  readonly rosterMonth?: string;
  readonly departmentOrgUnitId?: string;
  readonly workPatternId?: string;
  readonly holidayCalendarId?: string;
  readonly limit?: number | string;
  readonly cursor?: string;
  readonly search?: string;
  readonly scope?: WorkShiftScope | string;
}

export interface GetWorkScheduleRequestDetailQuery {
  readonly requestId: string;
}

export interface ListWorkScheduleRequestsQuery {
  readonly status?: WorkScheduleRequestStatus | string;
  readonly requestType?: WorkScheduleRequestType | string;
  readonly targetEmploymentProfileId?: string;
  readonly targetWorkShiftId?: string;
  readonly requestedByUserId?: string;
  readonly limit?: number | string;
  readonly cursor?: string;
}

export type WorkShiftMutationResult =
  WorkShiftMutationView;

export type GetWorkShiftDetailResult =
  WorkShiftDetailView;

export interface ListWorkShiftsResult {
  readonly items: readonly WorkShiftListItemView[];
  readonly nextCursor?: string;
}

export interface ListWorkShiftsBySubjectResult {
  readonly items: readonly WorkShiftBySubjectListItemView[];
  readonly nextCursor?: string;
}

export interface ListWorkShiftsByResourceResult {
  readonly items: readonly WorkShiftByResourceListItemView[];
  readonly nextCursor?: string;
}

export type WorkPatternMutationResult =
  WorkPatternMutationView;

export type GetWorkPatternDetailResult =
  WorkPatternView;

export interface ListWorkPatternsResult {
  readonly items: readonly WorkPatternListItemView[];
  readonly nextCursor?: string;
}

export type HolidayCalendarMutationResult =
  HolidayCalendarMutationView;

export type GetHolidayCalendarDetailResult =
  HolidayCalendarView;

export interface ListHolidayCalendarsResult {
  readonly items: readonly HolidayCalendarListItemView[];
  readonly nextCursor?: string;
}

export type ListHolidayCalendarActiveEntriesResult =
  readonly HolidayCalendarEntryRecord[];

export interface PublishMonthlyRosterResult {
  readonly monthlyRosterId: string;
  readonly status: MonthlyRosterStatus;
  readonly sourceGenerationRunId: string | null;
  readonly publishedAt: number | null;
  readonly publishedByUserId: string | null;
  readonly generatedWorkShiftCount: number;
  readonly skippedWorkingToOffCount: number;
  readonly holidaySuppressedCount: number;
  readonly changeTimeCount: number;
  readonly addSpecialShiftCount: number;
  readonly conflictCount: number;
  readonly computedPreviewHash: string | null;
  readonly generatedWorkShiftIds: readonly string[];
}

export type MonthlyRosterMutationResult =
  MonthlyRosterMutationView;

export type GetMonthlyRosterDetailResult =
  MonthlyRosterView;

export type PreviewMonthlyRosterResult =
  MonthlyRosterPreviewView;

export interface ListMonthlyRostersResult {
  readonly items: readonly MonthlyRosterListItemView[];
  readonly nextCursor?: string;
}

export type WorkScheduleRequestMutationResult =
  WorkScheduleRequestView;

export type GetWorkScheduleRequestDetailResult =
  WorkScheduleRequestView;

export interface ListWorkScheduleRequestsResult {
  readonly items: readonly WorkScheduleRequestListItemView[];
  readonly nextCursor?: string;
}
