import { ReferenceSummary } from "@modules/reference-summary";
import type {
  WorkScheduleAvailabilityTaxonomyCode,
  WorkScheduleAvailabilityType,
} from "./work-schedule-availability.types";

export const WORK_SHIFT_SUBJECT_KINDS = [
  "EMPLOYMENT_PROFILE",
  "TALENT",
  "TALENT_GROUP",
] as const;

export type WorkShiftSubjectKind =
  (typeof WORK_SHIFT_SUBJECT_KINDS)[number];

export const WORK_SHIFT_STATUSES = [
  "ACTIVE",
  "CANCELLED",
  "ARCHIVED",
] as const;

export type WorkShiftStatus =
  (typeof WORK_SHIFT_STATUSES)[number];

export const WORK_SHIFT_SOURCE_TYPES = [
  "MANUAL",
  "ROSTER_GENERATED",
] as const;

export type WorkShiftSourceType =
  (typeof WORK_SHIFT_SOURCE_TYPES)[number];

export const WORK_SHIFT_SORT_FIELDS = [
  "shiftStartAt",
  "shiftCode",
  "createdAt",
] as const;

export type WorkShiftSortField =
  (typeof WORK_SHIFT_SORT_FIELDS)[number];

export const WORK_SHIFT_SORT_DIRECTIONS = [
  "ASC",
  "DESC",
] as const;

export type WorkShiftSortDirection =
  (typeof WORK_SHIFT_SORT_DIRECTIONS)[number];

export const WORK_SHIFT_SCOPES = [
  "self",
  "team",
  "department",
  "global",
] as const;

export type WorkShiftScope =
  (typeof WORK_SHIFT_SCOPES)[number];

export const WORK_PATTERN_STATUSES = [
  "DRAFT",
  "ACTIVE",
  "ARCHIVED",
] as const;

export type WorkPatternStatus =
  (typeof WORK_PATTERN_STATUSES)[number];

export const WORK_PATTERN_WEEKDAY_TOKENS = [
  "MON",
  "TUE",
  "WED",
  "THU",
  "FRI",
  "SAT",
  "SUN",
] as const;

export type WorkPatternWeekdayToken =
  (typeof WORK_PATTERN_WEEKDAY_TOKENS)[number];

export const WORK_PATTERN_TIMEZONE =
  "Asia/Ho_Chi_Minh" as const;

export const HOLIDAY_CALENDAR_STATUSES = [
  "DRAFT",
  "ACTIVE",
  "ARCHIVED",
] as const;

export type HolidayCalendarStatus =
  (typeof HOLIDAY_CALENDAR_STATUSES)[number];

export const HOLIDAY_CALENDAR_SCOPE_TYPES = [
  "GLOBAL",
] as const;

export type HolidayCalendarScopeType =
  (typeof HOLIDAY_CALENDAR_SCOPE_TYPES)[number];

export const HOLIDAY_CALENDAR_TIMEZONE =
  "Asia/Ho_Chi_Minh" as const;

export const HOLIDAY_CALENDAR_ENTRY_TYPES = [
  "HOLIDAY",
  "COMPANY_OFF_DAY",
  "CUSTOM_OFF_DAY",
] as const;

export type HolidayCalendarEntryType =
  (typeof HOLIDAY_CALENDAR_ENTRY_TYPES)[number];

export const HOLIDAY_CALENDAR_ENTRY_STATUSES = [
  "ACTIVE",
  "REMOVED",
] as const;

export type HolidayCalendarEntryStatus =
  (typeof HOLIDAY_CALENDAR_ENTRY_STATUSES)[number];

export const MONTHLY_ROSTER_STATUSES = [
  "DRAFT",
  "PUBLISHED",
  "LOCKED",
  "ARCHIVED",
] as const;

export type MonthlyRosterStatus =
  (typeof MONTHLY_ROSTER_STATUSES)[number];

export const MONTHLY_ROSTER_TIMEZONE =
  "Asia/Ho_Chi_Minh" as const;

export const MONTHLY_ROSTER_TARGET_SUBJECT_KIND =
  "EMPLOYMENT_PROFILE" as const;

export const MONTHLY_ROSTER_TARGET_TYPES = [
  "ORG_UNIT",
  "TALENT_GROUP",
] as const;

export type MonthlyRosterTargetType =
  (typeof MONTHLY_ROSTER_TARGET_TYPES)[number];

export const MONTHLY_ROSTER_TARGET_ORG_UNIT_MODE =
  "EXACT_ONLY" as const;

export const MONTHLY_ROSTER_TARGET_MODES = [
  "EXACT_ONLY",
] as const;

export type MonthlyRosterTargetMode =
  (typeof MONTHLY_ROSTER_TARGET_MODES)[number];

export const MONTHLY_ROSTER_MEMBER_EXCLUSION_REASON_CODES = [
  "MEMBERSHIP_INACTIVE",
  "TALENT_NOT_FOUND",
  "TALENT_INACTIVE",
  "MISSING_LINKED_EMPLOYMENT_PROFILE",
  "EMPLOYMENT_PROFILE_NOT_FOUND",
  "EMPLOYMENT_PROFILE_INACTIVE",
  "DUPLICATE_EMPLOYMENT_PROFILE",
] as const;

export type MonthlyRosterMemberExclusionReasonCode =
  (typeof MONTHLY_ROSTER_MEMBER_EXCLUSION_REASON_CODES)[number];

export const ROSTER_EXCEPTION_TYPES = [
  "WORKING_TO_OFF",
  "CHANGE_TIME",
  "ADD_SPECIAL_SHIFT",
] as const;

export type RosterExceptionType =
  (typeof ROSTER_EXCEPTION_TYPES)[number];

export const ROSTER_EXCEPTION_STATUSES = [
  "ACTIVE",
  "REMOVED",
] as const;

export type RosterExceptionStatus =
  (typeof ROSTER_EXCEPTION_STATUSES)[number];

export interface WorkShiftRecord {
  readonly id: string;
  readonly shiftCode: string;
  readonly normalizedShiftCode: string;
  readonly title: string;
  readonly normalizedTitle: string;
  readonly subjectKind: WorkShiftSubjectKind;
  readonly subjectEmploymentProfileId: string | null;
  readonly subjectTalentId: string | null;
  readonly subjectTalentGroupId: string | null;
  readonly studioResourceIds: readonly string[];
  readonly status: WorkShiftStatus;
  readonly shiftStartAt: number;
  readonly shiftEndAt: number;
  readonly description: string | null;
  readonly externalRef: string | null;
  readonly sourceType: WorkShiftSourceType;
  readonly sourceRosterId: string | null;
  readonly sourcePatternId: string | null;
  readonly sourceExceptionId: string | null;
  readonly sourceGenerationRunId: string | null;
  readonly sourceRosterMonth: string | null;
  readonly sourceDepartmentOrgUnitId: string | null;
  readonly sourceRosterTargetType: MonthlyRosterTargetType | null;
  readonly sourceRosterTargetId: string | null;
  readonly sourceRosterTargetMode: MonthlyRosterTargetMode | null;
  readonly sourceMemberIdentityType:
    | typeof MONTHLY_ROSTER_TARGET_SUBJECT_KIND
    | null;
  readonly sourceRosterLocalDate: string | null;
  readonly sourceRosterSlotKey: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface WorkShiftDetailView {
  readonly id: string;
  readonly shiftCode: string;
  readonly title: string;
  readonly subjectKind: WorkShiftSubjectKind;
  readonly subjectEmploymentProfileId: string | null;
  readonly subjectTalentId: string | null;
  readonly subjectTalentGroupId: string | null;
  readonly subjectRef?: ReferenceSummary | null;
  readonly studioResourceIds: readonly string[];
  readonly studioResourceRefs?: readonly ReferenceSummary[];
  readonly status: WorkShiftStatus;
  readonly shiftStartAt: number;
  readonly shiftEndAt: number;
  readonly description: string | null;
  readonly externalRef: string | null;
  readonly sourceType: WorkShiftSourceType | string | null;
  readonly sourceRosterId: string | null;
  readonly sourceRosterRef?: ReferenceSummary | null;
  readonly sourcePatternId: string | null;
  readonly sourcePatternRef?: ReferenceSummary | null;
  readonly sourceExceptionId: string | null;
  readonly sourceGenerationRunId: string | null;
  readonly sourceRosterMonth: string | null;
  readonly sourceDepartmentOrgUnitId: string | null;
  readonly sourceDepartmentOrgUnitRef?: ReferenceSummary | null;
  readonly sourceRosterTargetType: MonthlyRosterTargetType | null;
  readonly sourceRosterTargetId: string | null;
  readonly sourceRosterTargetMode: MonthlyRosterTargetMode | null;
  readonly sourceMemberIdentityType:
    | typeof MONTHLY_ROSTER_TARGET_SUBJECT_KIND
    | null;
  readonly sourceRosterLocalDate: string | null;
  readonly sourceRosterSlotKey: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface WorkShiftListItemView {
  readonly id: string;
  readonly shiftCode: string;
  readonly title: string;
  readonly subjectKind: WorkShiftSubjectKind;
  readonly subjectEmploymentProfileId: string | null;
  readonly subjectTalentId: string | null;
  readonly subjectTalentGroupId: string | null;
  readonly subjectRef?: ReferenceSummary | null;
  readonly status: WorkShiftStatus;
  readonly shiftStartAt: number;
  readonly shiftEndAt: number;
  readonly sourceType: WorkShiftSourceType;
  readonly sourceRosterId: string | null;
  readonly sourceRosterRef?: ReferenceSummary | null;
  readonly sourceRosterMonth: string | null;
  readonly sourceRosterTargetType: MonthlyRosterTargetType | null;
  readonly sourceRosterTargetId: string | null;
  readonly sourceRosterTargetMode: MonthlyRosterTargetMode | null;
  readonly sourceRosterLocalDate: string | null;
  readonly sourceRosterSlotKey: string | null;
  readonly createdAt: number;
}

export interface WorkShiftBySubjectListItemView {
  readonly id: string;
  readonly shiftCode: string;
  readonly title: string;
  readonly subjectKind: WorkShiftSubjectKind;
  readonly status: WorkShiftStatus;
  readonly shiftStartAt: number;
  readonly shiftEndAt: number;
  readonly sourceType: WorkShiftSourceType | string | null;
  readonly sourceRosterTargetType: MonthlyRosterTargetType | null;
  readonly sourceRosterTargetId: string | null;
}

export interface WorkShiftByResourceListItemView {
  readonly id: string;
  readonly shiftCode: string;
  readonly title: string;
  readonly status: WorkShiftStatus;
  readonly shiftStartAt: number;
  readonly shiftEndAt: number;
}

export interface WorkShiftMutationView
  extends WorkShiftDetailView {}

export interface WorkPatternRecord {
  readonly workPatternId: string;
  readonly patternCode: string;
  readonly normalizedPatternCode: string;
  readonly name: string;
  readonly normalizedName: string;
  readonly status: WorkPatternStatus;
  readonly timezone: typeof WORK_PATTERN_TIMEZONE;
  readonly startLocalTime: string;
  readonly endLocalTime: string;
  readonly workingMinutes: number;
  readonly breakMinutes: number;
  readonly workingDays: readonly WorkPatternWeekdayToken[];
  readonly description: string | null;
  readonly externalRef: string | null;
  readonly activatedAt: number | null;
  readonly archivedAt: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface WorkPatternView {
  readonly workPatternId: string;
  readonly patternCode: string;
  readonly name: string;
  readonly status: WorkPatternStatus;
  readonly timezone: typeof WORK_PATTERN_TIMEZONE;
  readonly startLocalTime: string;
  readonly endLocalTime: string;
  readonly workingMinutes: number;
  readonly breakMinutes: number;
  readonly workingDays: readonly WorkPatternWeekdayToken[];
  readonly description: string | null;
  readonly externalRef: string | null;
  readonly activatedAt: number | null;
  readonly archivedAt: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface WorkPatternListItemView
  extends WorkPatternView {}

export interface WorkPatternMutationView
  extends WorkPatternView {}

export interface HolidayCalendarEntryRecord {
  readonly holidayCalendarEntryId: string;
  readonly date: string;
  readonly entryType: HolidayCalendarEntryType;
  readonly name: string;
  readonly status: HolidayCalendarEntryStatus;
  readonly description: string | null;
  readonly externalRef: string | null;
  readonly removedAt: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface HolidayCalendarRecord {
  readonly holidayCalendarId: string;
  readonly calendarCode: string;
  readonly normalizedCalendarCode: string;
  readonly name: string;
  readonly normalizedName: string;
  readonly scopeType: HolidayCalendarScopeType;
  readonly timezone: typeof HOLIDAY_CALENDAR_TIMEZONE;
  readonly status: HolidayCalendarStatus;
  readonly entries: readonly HolidayCalendarEntryRecord[];
  readonly description: string | null;
  readonly externalRef: string | null;
  readonly activatedAt: number | null;
  readonly archivedAt: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface HolidayCalendarView {
  readonly holidayCalendarId: string;
  readonly calendarCode: string;
  readonly name: string;
  readonly scopeType: HolidayCalendarScopeType;
  readonly timezone: typeof HOLIDAY_CALENDAR_TIMEZONE;
  readonly status: HolidayCalendarStatus;
  readonly entries: readonly HolidayCalendarEntryRecord[];
  readonly description: string | null;
  readonly externalRef: string | null;
  readonly activatedAt: number | null;
  readonly archivedAt: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface HolidayCalendarListItemView
  extends HolidayCalendarView {}

export interface HolidayCalendarMutationView
  extends HolidayCalendarView {}

export interface RosterExceptionRecord {
  readonly rosterExceptionId: string;
  readonly monthlyRosterId: string;
  readonly exceptionType: RosterExceptionType;
  readonly exceptionDate: string;
  readonly subjectEmploymentProfileId: string;
  readonly subjectEmploymentProfileRef?: ReferenceSummary | null;
  readonly status: RosterExceptionStatus;
  readonly title: string | null;
  readonly startLocalTime: string | null;
  readonly endLocalTime: string | null;
  readonly workingMinutes: number | null;
  readonly breakMinutes: number | null;
  readonly studioResourceIds: readonly string[];
  readonly studioResourceRefs?: readonly ReferenceSummary[];
  readonly reason: string | null;
  readonly sourceNote: string | null;
  readonly sourceAvailabilityBatchId?: string | null;
  readonly sourceAvailabilityLineId?: string | null;
  readonly sourceAvailabilityType?: WorkScheduleAvailabilityType | null;
  readonly sourceAvailabilityTaxonomyCode?: WorkScheduleAvailabilityTaxonomyCode | null;
  readonly sourceAppliedAt?: number | null;
  readonly sourceAppliedByActorId?: string | null;
  readonly sourceApplyNote?: string | null;
  readonly description: string | null;
  readonly externalRef: string | null;
  readonly removedAt: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface MonthlyRosterRecord {
  readonly monthlyRosterId: string;
  readonly rosterCode: string;
  readonly normalizedRosterCode: string;
  readonly rosterMonth: string;
  readonly timezone: typeof MONTHLY_ROSTER_TIMEZONE;
  readonly targetSubjectKind: typeof MONTHLY_ROSTER_TARGET_SUBJECT_KIND;
  readonly targetOrgUnitMode: typeof MONTHLY_ROSTER_TARGET_ORG_UNIT_MODE;
  readonly targetType: MonthlyRosterTargetType;
  readonly targetMode: MonthlyRosterTargetMode;
  readonly targetOrgUnitId: string | null;
  readonly targetTalentGroupId: string | null;
  readonly departmentOrgUnitId: string | null;
  readonly workPatternId: string;
  readonly holidayCalendarId: string;
  readonly status: MonthlyRosterStatus;
  readonly draftVersion: number;
  readonly previewHash: string | null;
  readonly lastPreviewedAt: number | null;
  readonly publishedAt: number | null;
  readonly publishedByUserId: string | null;
  readonly publishGenerationRunId: string | null;
  readonly description: string | null;
  readonly externalRef: string | null;
  readonly exceptions: readonly RosterExceptionRecord[];
  readonly archivedAt: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface MonthlyRosterListItemView {
  readonly monthlyRosterId: string;
  readonly rosterCode: string;
  readonly rosterMonth: string;
  readonly timezone: typeof MONTHLY_ROSTER_TIMEZONE;
  readonly targetSubjectKind: typeof MONTHLY_ROSTER_TARGET_SUBJECT_KIND;
  readonly targetOrgUnitMode: typeof MONTHLY_ROSTER_TARGET_ORG_UNIT_MODE;
  readonly targetType: MonthlyRosterTargetType;
  readonly targetMode: MonthlyRosterTargetMode;
  readonly targetOrgUnitId: string | null;
  readonly targetOrgUnitRef?: ReferenceSummary | null;
  readonly targetTalentGroupId: string | null;
  readonly targetTalentGroupRef?: ReferenceSummary | null;
  readonly targetRef?: ReferenceSummary | null;
  readonly departmentOrgUnitId: string | null;
  readonly departmentOrgUnitRef?: ReferenceSummary | null;
  readonly workPatternId: string;
  readonly workPatternRef?: ReferenceSummary | null;
  readonly holidayCalendarId: string;
  readonly holidayCalendarRef?: ReferenceSummary | null;
  readonly status: MonthlyRosterStatus;
  readonly draftVersion: number;
  readonly exceptionCount: number;
  readonly description: string | null;
  readonly externalRef: string | null;
  readonly archivedAt: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface MonthlyRosterView
  extends MonthlyRosterListItemView {
  readonly previewHash: string | null;
  readonly lastPreviewedAt: number | null;
  readonly publishedAt: number | null;
  readonly publishedByUserId: string | null;
  readonly publishGenerationRunId: string | null;
  readonly exceptions: readonly RosterExceptionRecord[];
}

export interface MonthlyRosterMutationView
  extends MonthlyRosterView {}

export const MONTHLY_ROSTER_PREVIEW_ROW_KINDS = [
  "STANDARD",
  "WORKING_TO_OFF",
  "CHANGE_TIME",
  "ADD_SPECIAL_SHIFT",
  "HOLIDAY_SUPPRESSED",
] as const;

export type MonthlyRosterPreviewRowKind =
  (typeof MONTHLY_ROSTER_PREVIEW_ROW_KINDS)[number];

export interface MonthlyRosterPreviewEligibleProfileView {
  readonly subjectEmploymentProfileId: string;
  readonly subjectEmploymentProfileRef?: ReferenceSummary | null;
  readonly employmentStatus: "ACTIVE";
  readonly departmentOrgUnitId: string | null;
  readonly departmentOrgUnitRef?: ReferenceSummary | null;
}

export interface MonthlyRosterPreviewExcludedMemberView {
  readonly memberId: string;
  readonly talentId: string | null;
  readonly talentRef?: ReferenceSummary | null;
  readonly linkedEmploymentProfileId: string | null;
  readonly linkedEmploymentProfileRef?: ReferenceSummary | null;
  readonly reasonCode: MonthlyRosterMemberExclusionReasonCode;
}

export interface MonthlyRosterPreviewConflictView {
  readonly conflictKind:
    | "SUBJECT_OVERLAP"
    | "CANDIDATE_SUBJECT_OVERLAP";
  readonly workShiftId: string | null;
  readonly relatedPreviewRowId: string | null;
  readonly shiftCode: string | null;
  readonly title: string | null;
  readonly status: "ACTIVE" | null;
  readonly shiftStartAt: number;
  readonly shiftEndAt: number;
  readonly sourceType: WorkShiftSourceType | null;
  readonly sourceRosterId: string | null;
  readonly sourceRosterMonth: string | null;
  readonly sourceRosterLocalDate: string | null;
  readonly sourceRosterSlotKey: string | null;
}

export interface MonthlyRosterPreviewRowView {
  readonly previewRowId: string;
  readonly monthlyRosterId: string;
  readonly rosterMonth: string;
  readonly targetType: MonthlyRosterTargetType;
  readonly targetMode: MonthlyRosterTargetMode;
  readonly targetOrgUnitId: string | null;
  readonly targetOrgUnitRef?: ReferenceSummary | null;
  readonly targetTalentGroupId: string | null;
  readonly targetTalentGroupRef?: ReferenceSummary | null;
  readonly targetRef?: ReferenceSummary | null;
  readonly departmentOrgUnitId: string | null;
  readonly departmentOrgUnitRef?: ReferenceSummary | null;
  readonly subjectEmploymentProfileId: string;
  readonly subjectEmploymentProfileRef?: ReferenceSummary | null;
  readonly localDate: string;
  readonly rowKind: MonthlyRosterPreviewRowKind;
  readonly sourceExceptionId: string | null;
  readonly sourceRosterSlotKey: string | null;
  readonly startLocalTime: string | null;
  readonly endLocalTime: string | null;
  readonly shiftStartAt: number | null;
  readonly shiftEndAt: number | null;
  readonly workingMinutes: number | null;
  readonly breakMinutes: number | null;
  readonly holidayCalendarEntryId: string | null;
  readonly holidayName: string | null;
  readonly holidayEntryType: HolidayCalendarEntryType | null;
  readonly isCandidateShift: boolean;
  readonly isSuppressed: boolean;
  readonly conflicts: readonly MonthlyRosterPreviewConflictView[];
  readonly warnings: readonly string[];
  readonly blockers: readonly string[];
}

export interface MonthlyRosterPreviewSummaryView {
  readonly totalEligibleProfiles: number;
  readonly includedMemberCount: number;
  readonly excludedMemberCount: number;
  readonly totalStandardCandidateShifts: number;
  readonly totalHolidaySuppressions: number;
  readonly totalWorkingToOff: number;
  readonly totalChangeTime: number;
  readonly totalAddSpecialShift: number;
  readonly totalCandidateShiftsAfterExceptions: number;
  readonly totalConflicts: number;
}

export interface MonthlyRosterPreviewView {
  readonly monthlyRosterId: string;
  readonly rosterMonth: string;
  readonly timezone: typeof MONTHLY_ROSTER_TIMEZONE;
  readonly targetType: MonthlyRosterTargetType;
  readonly targetMode: MonthlyRosterTargetMode;
  readonly targetOrgUnitId: string | null;
  readonly targetOrgUnitRef?: ReferenceSummary | null;
  readonly targetTalentGroupId: string | null;
  readonly targetTalentGroupRef?: ReferenceSummary | null;
  readonly targetRef?: ReferenceSummary | null;
  readonly departmentOrgUnitId: string | null;
  readonly departmentOrgUnitRef?: ReferenceSummary | null;
  readonly workPatternId: string;
  readonly workPatternRef?: ReferenceSummary | null;
  readonly holidayCalendarId: string;
  readonly holidayCalendarRef?: ReferenceSummary | null;
  readonly rosterStatus: MonthlyRosterStatus;
  readonly draftVersion: number;
  readonly currentPreviewHash: string | null;
  readonly computedPreviewHash: string;
  readonly eligibleProfiles: readonly MonthlyRosterPreviewEligibleProfileView[];
  readonly excludedMembers: readonly MonthlyRosterPreviewExcludedMemberView[];
  readonly rows: readonly MonthlyRosterPreviewRowView[];
  readonly summary: MonthlyRosterPreviewSummaryView;
  readonly warnings: readonly string[];
}

export const WORK_SCHEDULE_REQUEST_TYPES = [
  "CREATE_SHIFT",
  "RESCHEDULE_SHIFT",
  "CANCEL_SHIFT",
] as const;

export type WorkScheduleRequestType =
  (typeof WORK_SCHEDULE_REQUEST_TYPES)[number];

export const WORK_SCHEDULE_REQUEST_STATUSES = [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
] as const;

export type WorkScheduleRequestStatus =
  (typeof WORK_SCHEDULE_REQUEST_STATUSES)[number];

export const WORK_SCHEDULE_REQUEST_TARGET_KINDS = [
  "EMPLOYMENT_PROFILE_WORK_SHIFT",
] as const;

export type WorkScheduleRequestTargetKind =
  (typeof WORK_SCHEDULE_REQUEST_TARGET_KINDS)[number];

export const WORK_SCHEDULE_REQUEST_SOURCES = [
  "TEAM_MANAGER",
] as const;

export type WorkScheduleRequestSource =
  (typeof WORK_SCHEDULE_REQUEST_SOURCES)[number];

export interface WorkScheduleRequestRecord {
  readonly id: string;
  readonly requestCode: string;
  readonly requestType: WorkScheduleRequestType;
  readonly status: WorkScheduleRequestStatus;
  readonly targetKind: WorkScheduleRequestTargetKind;
  readonly requestSource: WorkScheduleRequestSource;
  readonly targetEmploymentProfileId: string;
  readonly targetWorkShiftId: string | null;
  readonly requestedByUserId: string;
  readonly requestedByEmploymentProfileId: string | null;
  readonly reason: string;
  readonly proposedStartAt: number | null;
  readonly proposedEndAt: number | null;
  readonly proposedTitle: string | null;
  readonly proposedStudioResourceIds: readonly string[];
  readonly proposedDescription: string | null;
  readonly proposedExternalRef: string | null;
  readonly approvedByUserId: string | null;
  readonly approvedAt: number | null;
  readonly approvalNote: string | null;
  readonly rejectedByUserId: string | null;
  readonly rejectedAt: number | null;
  readonly rejectionReason: string | null;
  readonly cancelledByUserId: string | null;
  readonly cancelledAt: number | null;
  readonly cancellationReason: string | null;
  readonly appliedWorkShiftId: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface WorkScheduleRequestView
  extends WorkScheduleRequestRecord {
  readonly targetEmploymentProfileRef?: ReferenceSummary | null;
  readonly targetWorkShiftRef?: ReferenceSummary | null;
  readonly appliedWorkShiftRef?: ReferenceSummary | null;
}

export interface WorkScheduleRequestListItemView
  extends WorkScheduleRequestView {}

export const WORK_SCHEDULE_REQUEST_BATCH_STATUSES = [
  "PENDING",
  "PARTIALLY_APPROVED",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
] as const;

export type WorkScheduleRequestBatchStatus =
  (typeof WORK_SCHEDULE_REQUEST_BATCH_STATUSES)[number];

export const WORK_SCHEDULE_REQUEST_BATCH_SCOPE_SUMMARIES = [
  "ORG_UNIT",
  "TALENT_GROUP",
  "MIXED",
] as const;

export type WorkScheduleRequestBatchScopeSummary =
  (typeof WORK_SCHEDULE_REQUEST_BATCH_SCOPE_SUMMARIES)[number];

export const WORK_SCHEDULE_REQUEST_LINE_STATUSES = [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
  "FAILED_TO_APPLY",
] as const;

export type WorkScheduleRequestLineStatus =
  (typeof WORK_SCHEDULE_REQUEST_LINE_STATUSES)[number];

export interface WorkScheduleRequestLineCounts {
  readonly total: number;
  readonly pending: number;
  readonly approved: number;
  readonly rejected: number;
  readonly cancelled: number;
  readonly failedToApply: number;
}

export interface WorkScheduleRequestBatchRecord {
  readonly id: string;
  readonly batchCode: string;
  readonly submittedByActorId: string;
  readonly submittedByEmploymentProfileId: string;
  readonly periodMonth: string;
  readonly scopeSummary: WorkScheduleRequestBatchScopeSummary;
  readonly status: WorkScheduleRequestBatchStatus;
  readonly note: string | null;
  readonly lineCounts: WorkScheduleRequestLineCounts;
  readonly clientToken: string;
  readonly submittedAt: number;
  readonly cancelledAt: number | null;
  readonly resolvedAt: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface WorkScheduleRequestLineRecord {
  readonly id: string;
  readonly batchId: string;
  readonly lineNo: number;
  readonly requestType: WorkScheduleRequestType;
  readonly memberEmploymentProfileId: string;
  readonly workShiftId: string | null;
  readonly requestedStartAt: number | null;
  readonly requestedEndAt: number | null;
  readonly timezone: string;
  readonly title: string | null;
  readonly description: string | null;
  readonly externalRef: string | null;
  readonly reason: string;
  readonly status: WorkScheduleRequestLineStatus;
  readonly approvalNote: string | null;
  readonly rejectionReason: string | null;
  readonly cancellationReason: string | null;
  readonly failureReason: string | null;
  readonly appliedWorkShiftId: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly approvedAt: number | null;
  readonly approvedByActorId: string | null;
  readonly rejectedAt: number | null;
  readonly rejectedByActorId: string | null;
  readonly cancelledAt: number | null;
  readonly cancelledByActorId: string | null;
  readonly failedAt: number | null;
  readonly failedByActorId: string | null;
  readonly submittedByEmploymentProfileId: string;
  readonly periodMonth: string;
}

export interface WorkScheduleRequestLineView
  extends WorkScheduleRequestLineRecord {
  readonly memberEmploymentProfileRef?: ReferenceSummary | null;
  readonly workShiftRef?: ReferenceSummary | null;
  readonly appliedWorkShiftRef?: ReferenceSummary | null;
}

export interface WorkScheduleRequestBatchView
  extends WorkScheduleRequestBatchRecord {
  readonly submittedByEmploymentProfileRef?: ReferenceSummary | null;
  readonly lines: readonly WorkScheduleRequestLineView[];
}

export interface WorkScheduleRequestBatchListItemView
  extends WorkScheduleRequestBatchRecord {
  readonly submittedByEmploymentProfileRef?: ReferenceSummary | null;
}
