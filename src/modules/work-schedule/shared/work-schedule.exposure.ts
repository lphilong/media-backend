import {
  PlainObject,
  toPlainObject,
} from "@app/base/presentation-result.types";
import { ExposurePolicy } from "@core/exposure/exposure.policy";
import {
  HolidayCalendarEntryRecord,
  HolidayCalendarListItemView,
  HolidayCalendarMutationView,
  HolidayCalendarView,
  MonthlyRosterListItemView,
  MonthlyRosterMutationView,
  MonthlyRosterPreviewConflictView,
  MonthlyRosterPreviewEligibleProfileView,
  MonthlyRosterPreviewRowView,
  MonthlyRosterPreviewSummaryView,
  MonthlyRosterPreviewView,
  MonthlyRosterView,
  RosterExceptionRecord,
  WorkShiftByResourceListItemView,
  WorkShiftBySubjectListItemView,
  WorkShiftDetailView,
  WorkShiftListItemView,
  WorkShiftMutationView,
  WorkScheduleRequestListItemView,
  WorkScheduleRequestView,
  WorkPatternListItemView,
  WorkPatternMutationView,
  WorkPatternView,
} from "@modules/work-schedule/domain/work-schedule.types";

const WORK_SHIFT_ADMIN_LIST_FIELDS = [
  "id",
  "shiftCode",
  "title",
  "subjectKind",
  "subjectEmploymentProfileId",
  "subjectTalentId",
  "subjectTalentGroupId",
  "subjectRef",
  "status",
  "shiftStartAt",
  "shiftEndAt",
  "sourceType",
  "sourceRosterId",
  "sourceRosterRef",
  "sourceRosterMonth",
  "sourceRosterTargetType",
  "sourceRosterTargetId",
  "sourceRosterTargetMode",
  "sourceRosterLocalDate",
  "sourceRosterSlotKey",
  "createdAt",
] as const;

const WORK_SHIFT_ADMIN_BY_SUBJECT_FIELDS = [
  "id",
  "shiftCode",
  "title",
  "subjectKind",
  "status",
  "shiftStartAt",
  "shiftEndAt",
] as const;

const WORK_SHIFT_ADMIN_BY_RESOURCE_FIELDS = [
  "id",
  "shiftCode",
  "title",
  "status",
  "shiftStartAt",
  "shiftEndAt",
] as const;

const WORK_SHIFT_ADMIN_DETAIL_FIELDS = [
  "id",
  "shiftCode",
  "title",
  "subjectKind",
  "subjectEmploymentProfileId",
  "subjectTalentId",
  "subjectTalentGroupId",
  "subjectRef",
  "studioResourceIds",
  "studioResourceRefs",
  "status",
  "shiftStartAt",
  "shiftEndAt",
  "description",
  "externalRef",
  "sourceType",
  "sourceRosterId",
  "sourceRosterRef",
  "sourcePatternId",
  "sourcePatternRef",
  "sourceExceptionId",
  "sourceGenerationRunId",
  "sourceRosterMonth",
  "sourceDepartmentOrgUnitId",
  "sourceDepartmentOrgUnitRef",
  "sourceRosterTargetType",
  "sourceRosterTargetId",
  "sourceRosterTargetMode",
  "sourceMemberIdentityType",
  "sourceRosterLocalDate",
  "sourceRosterSlotKey",
  "createdAt",
  "updatedAt",
] as const;

const WORK_SCHEDULE_REQUEST_ADMIN_FIELDS = [
  "id",
  "requestCode",
  "requestType",
  "status",
  "targetKind",
  "requestSource",
  "targetEmploymentProfileId",
  "targetEmploymentProfileRef",
  "targetWorkShiftId",
  "targetWorkShiftRef",
  "requestedByUserId",
  "requestedByEmploymentProfileId",
  "reason",
  "proposedStartAt",
  "proposedEndAt",
  "proposedTitle",
  "proposedStudioResourceIds",
  "proposedDescription",
  "proposedExternalRef",
  "approvedByUserId",
  "approvedAt",
  "approvalNote",
  "rejectedByUserId",
  "rejectedAt",
  "rejectionReason",
  "cancelledByUserId",
  "cancelledAt",
  "cancellationReason",
  "appliedWorkShiftId",
  "appliedWorkShiftRef",
  "createdAt",
  "updatedAt",
] as const;

const WORK_PATTERN_ADMIN_FIELDS = [
  "workPatternId",
  "patternCode",
  "name",
  "status",
  "timezone",
  "startLocalTime",
  "endLocalTime",
  "workingMinutes",
  "breakMinutes",
  "workingDays",
  "description",
  "externalRef",
  "activatedAt",
  "archivedAt",
  "createdAt",
  "updatedAt",
] as const;

const HOLIDAY_CALENDAR_ENTRY_ADMIN_FIELDS = [
  "holidayCalendarEntryId",
  "date",
  "entryType",
  "name",
  "status",
  "description",
  "externalRef",
  "removedAt",
  "createdAt",
  "updatedAt",
] as const;

const HOLIDAY_CALENDAR_ADMIN_FIELDS = [
  "holidayCalendarId",
  "calendarCode",
  "name",
  "scopeType",
  "timezone",
  "status",
  "entries",
  "description",
  "externalRef",
  "activatedAt",
  "archivedAt",
  "createdAt",
  "updatedAt",
] as const;

const ROSTER_EXCEPTION_ADMIN_FIELDS = [
  "rosterExceptionId",
  "monthlyRosterId",
  "exceptionType",
  "exceptionDate",
  "subjectEmploymentProfileId",
  "subjectEmploymentProfileRef",
  "status",
  "title",
  "startLocalTime",
  "endLocalTime",
  "workingMinutes",
  "breakMinutes",
  "studioResourceIds",
  "studioResourceRefs",
  "reason",
  "sourceNote",
  "description",
  "externalRef",
  "removedAt",
  "createdAt",
  "updatedAt",
] as const;

const MONTHLY_ROSTER_ADMIN_LIST_FIELDS = [
  "monthlyRosterId",
  "rosterCode",
  "rosterMonth",
  "timezone",
  "targetSubjectKind",
  "targetOrgUnitMode",
  "targetType",
  "targetMode",
  "targetOrgUnitId",
  "targetOrgUnitRef",
  "targetTalentGroupId",
  "targetTalentGroupRef",
  "targetRef",
  "departmentOrgUnitId",
  "departmentOrgUnitRef",
  "workPatternId",
  "workPatternRef",
  "holidayCalendarId",
  "holidayCalendarRef",
  "status",
  "draftVersion",
  "exceptionCount",
  "description",
  "externalRef",
  "archivedAt",
  "createdAt",
  "updatedAt",
] as const;

const MONTHLY_ROSTER_ADMIN_DETAIL_FIELDS = [
  ...MONTHLY_ROSTER_ADMIN_LIST_FIELDS,
  "previewHash",
  "lastPreviewedAt",
  "publishedAt",
  "publishedByUserId",
  "publishGenerationRunId",
  "exceptions",
] as const;

const MONTHLY_ROSTER_PREVIEW_ELIGIBLE_PROFILE_FIELDS = [
  "subjectEmploymentProfileId",
  "subjectEmploymentProfileRef",
  "employmentStatus",
  "departmentOrgUnitId",
  "departmentOrgUnitRef",
] as const;

const MONTHLY_ROSTER_PREVIEW_EXCLUDED_MEMBER_FIELDS = [
  "memberId",
  "talentId",
  "talentRef",
  "linkedEmploymentProfileId",
  "linkedEmploymentProfileRef",
  "reasonCode",
] as const;

const MONTHLY_ROSTER_PREVIEW_CONFLICT_FIELDS = [
  "conflictKind",
  "workShiftId",
  "relatedPreviewRowId",
  "shiftCode",
  "title",
  "status",
  "shiftStartAt",
  "shiftEndAt",
  "sourceType",
  "sourceRosterId",
  "sourceRosterMonth",
  "sourceRosterLocalDate",
  "sourceRosterSlotKey",
] as const;

const MONTHLY_ROSTER_PREVIEW_ROW_FIELDS = [
  "previewRowId",
  "monthlyRosterId",
  "rosterMonth",
  "targetType",
  "targetMode",
  "targetOrgUnitId",
  "targetOrgUnitRef",
  "targetTalentGroupId",
  "targetTalentGroupRef",
  "targetRef",
  "departmentOrgUnitId",
  "departmentOrgUnitRef",
  "subjectEmploymentProfileId",
  "subjectEmploymentProfileRef",
  "localDate",
  "rowKind",
  "sourceExceptionId",
  "sourceRosterSlotKey",
  "startLocalTime",
  "endLocalTime",
  "shiftStartAt",
  "shiftEndAt",
  "workingMinutes",
  "breakMinutes",
  "holidayCalendarEntryId",
  "holidayName",
  "holidayEntryType",
  "isCandidateShift",
  "isSuppressed",
  "conflicts",
  "warnings",
  "blockers",
] as const;

const MONTHLY_ROSTER_PREVIEW_SUMMARY_FIELDS = [
  "totalEligibleProfiles",
  "includedMemberCount",
  "excludedMemberCount",
  "totalStandardCandidateShifts",
  "totalHolidaySuppressions",
  "totalWorkingToOff",
  "totalChangeTime",
  "totalAddSpecialShift",
  "totalCandidateShiftsAfterExceptions",
  "totalConflicts",
] as const;

const MONTHLY_ROSTER_PREVIEW_FIELDS = [
  "monthlyRosterId",
  "rosterMonth",
  "timezone",
  "targetType",
  "targetMode",
  "targetOrgUnitId",
  "targetOrgUnitRef",
  "targetTalentGroupId",
  "targetTalentGroupRef",
  "targetRef",
  "departmentOrgUnitId",
  "departmentOrgUnitRef",
  "workPatternId",
  "workPatternRef",
  "holidayCalendarId",
  "holidayCalendarRef",
  "rosterStatus",
  "draftVersion",
  "currentPreviewHash",
  "computedPreviewHash",
  "eligibleProfiles",
  "excludedMembers",
  "rows",
  "summary",
  "warnings",
] as const;

export const WorkScheduleAdminListExposure =
  Object.freeze({
    expose(input: WorkShiftListItemView): PlainObject {
      return toPlainObject(
        ExposurePolicy.expose(
          {
            id: input.id,
            shiftCode: input.shiftCode,
            title: input.title,
            subjectKind: input.subjectKind,
            subjectEmploymentProfileId:
              input.subjectEmploymentProfileId,
            subjectTalentId: input.subjectTalentId,
            subjectTalentGroupId:
              input.subjectTalentGroupId,
            subjectRef: input.subjectRef,
            status: input.status,
            shiftStartAt: input.shiftStartAt,
            shiftEndAt: input.shiftEndAt,
            sourceType: input.sourceType,
            sourceRosterId: input.sourceRosterId,
            sourceRosterRef: input.sourceRosterRef,
            sourceRosterMonth:
              input.sourceRosterMonth,
            sourceRosterTargetType:
              input.sourceRosterTargetType,
            sourceRosterTargetId:
              input.sourceRosterTargetId,
            sourceRosterTargetMode:
              input.sourceRosterTargetMode,
            sourceRosterLocalDate:
              input.sourceRosterLocalDate,
            sourceRosterSlotKey:
              input.sourceRosterSlotKey,
            createdAt: input.createdAt,
          },
          WORK_SHIFT_ADMIN_LIST_FIELDS,
        ),
        "WorkScheduleAdminList exposure",
      );
    },

    exposeMany(
      items: readonly WorkShiftListItemView[],
    ): readonly PlainObject[] {
      return items.map((item) => this.expose(item));
    },
  });

export const WorkScheduleAdminBySubjectListExposure =
  Object.freeze({
    expose(
      input: WorkShiftBySubjectListItemView,
    ): PlainObject {
      return toPlainObject(
        ExposurePolicy.expose(
          {
            id: input.id,
            shiftCode: input.shiftCode,
            title: input.title,
            subjectKind: input.subjectKind,
            status: input.status,
            shiftStartAt: input.shiftStartAt,
            shiftEndAt: input.shiftEndAt,
          },
          WORK_SHIFT_ADMIN_BY_SUBJECT_FIELDS,
        ),
        "WorkScheduleAdminBySubject exposure",
      );
    },

    exposeMany(
      items: readonly WorkShiftBySubjectListItemView[],
    ): readonly PlainObject[] {
      return items.map((item) => this.expose(item));
    },
  });

export const WorkScheduleAdminByResourceListExposure =
  Object.freeze({
    expose(
      input: WorkShiftByResourceListItemView,
    ): PlainObject {
      return toPlainObject(
        ExposurePolicy.expose(
          {
            id: input.id,
            shiftCode: input.shiftCode,
            title: input.title,
            status: input.status,
            shiftStartAt: input.shiftStartAt,
            shiftEndAt: input.shiftEndAt,
          },
          WORK_SHIFT_ADMIN_BY_RESOURCE_FIELDS,
        ),
        "WorkScheduleAdminByResource exposure",
      );
    },

    exposeMany(
      items: readonly WorkShiftByResourceListItemView[],
    ): readonly PlainObject[] {
      return items.map((item) => this.expose(item));
    },
  });

export const WorkScheduleAdminDetailExposure =
  Object.freeze({
    expose(input: WorkShiftDetailView): PlainObject {
      return toPlainObject(
        ExposurePolicy.expose(
          {
            id: input.id,
            shiftCode: input.shiftCode,
            title: input.title,
            subjectKind: input.subjectKind,
            subjectEmploymentProfileId:
              input.subjectEmploymentProfileId,
            subjectTalentId: input.subjectTalentId,
            subjectTalentGroupId:
              input.subjectTalentGroupId,
            subjectRef: input.subjectRef,
            studioResourceIds: [
              ...input.studioResourceIds,
            ],
            studioResourceRefs: input.studioResourceRefs,
            status: input.status,
            shiftStartAt: input.shiftStartAt,
            shiftEndAt: input.shiftEndAt,
            description: input.description,
            externalRef: input.externalRef,
            sourceType: input.sourceType,
            sourceRosterId: input.sourceRosterId,
            sourceRosterRef: input.sourceRosterRef,
            sourcePatternId: input.sourcePatternId,
            sourcePatternRef: input.sourcePatternRef,
            sourceExceptionId:
              input.sourceExceptionId,
            sourceGenerationRunId:
              input.sourceGenerationRunId,
            sourceRosterMonth:
              input.sourceRosterMonth,
            sourceDepartmentOrgUnitId:
              input.sourceDepartmentOrgUnitId,
            sourceDepartmentOrgUnitRef:
              input.sourceDepartmentOrgUnitRef,
            sourceRosterTargetType:
              input.sourceRosterTargetType,
            sourceRosterTargetId:
              input.sourceRosterTargetId,
            sourceRosterTargetMode:
              input.sourceRosterTargetMode,
            sourceMemberIdentityType:
              input.sourceMemberIdentityType,
            sourceRosterLocalDate:
              input.sourceRosterLocalDate,
            sourceRosterSlotKey:
              input.sourceRosterSlotKey,
            createdAt: input.createdAt,
            updatedAt: input.updatedAt,
          },
          WORK_SHIFT_ADMIN_DETAIL_FIELDS,
        ),
        "WorkScheduleAdminDetail exposure",
      );
    },
  });

export const WorkScheduleAdminMutationExposure =
  Object.freeze({
    expose(input: WorkShiftMutationView): PlainObject {
      return WorkScheduleAdminDetailExposure.expose(
        input,
      );
    },
  });

export const WorkScheduleRequestAdminExposure =
  Object.freeze({
    expose(
      input:
        | WorkScheduleRequestView
        | WorkScheduleRequestListItemView,
    ): PlainObject {
      return toPlainObject(
        ExposurePolicy.expose(
          {
            id: input.id,
            requestCode: input.requestCode,
            requestType: input.requestType,
            status: input.status,
            targetKind: input.targetKind,
            requestSource: input.requestSource,
            targetEmploymentProfileId:
              input.targetEmploymentProfileId,
            targetEmploymentProfileRef:
              input.targetEmploymentProfileRef ?? null,
            targetWorkShiftId:
              input.targetWorkShiftId,
            targetWorkShiftRef:
              input.targetWorkShiftRef ?? null,
            requestedByUserId:
              input.requestedByUserId,
            requestedByEmploymentProfileId:
              input.requestedByEmploymentProfileId,
            reason: input.reason,
            proposedStartAt:
              input.proposedStartAt,
            proposedEndAt: input.proposedEndAt,
            proposedTitle: input.proposedTitle,
            proposedStudioResourceIds: [
              ...input.proposedStudioResourceIds,
            ],
            proposedDescription:
              input.proposedDescription,
            proposedExternalRef:
              input.proposedExternalRef,
            approvedByUserId:
              input.approvedByUserId,
            approvedAt: input.approvedAt,
            approvalNote: input.approvalNote,
            rejectedByUserId:
              input.rejectedByUserId,
            rejectedAt: input.rejectedAt,
            rejectionReason: input.rejectionReason,
            cancelledByUserId:
              input.cancelledByUserId,
            cancelledAt: input.cancelledAt,
            cancellationReason:
              input.cancellationReason,
            appliedWorkShiftId:
              input.appliedWorkShiftId,
            appliedWorkShiftRef:
              input.appliedWorkShiftRef ?? null,
            createdAt: input.createdAt,
            updatedAt: input.updatedAt,
          },
          WORK_SCHEDULE_REQUEST_ADMIN_FIELDS,
        ),
        "WorkScheduleRequestAdmin exposure",
      );
    },

    exposeMany(
      items: readonly WorkScheduleRequestListItemView[],
    ): readonly PlainObject[] {
      return items.map((item) => this.expose(item));
    },
  });

export const WorkPatternAdminExposure =
  Object.freeze({
    expose(
      input:
        | WorkPatternView
        | WorkPatternListItemView
        | WorkPatternMutationView,
    ): PlainObject {
      return toPlainObject(
        ExposurePolicy.expose(
          {
            workPatternId: input.workPatternId,
            patternCode: input.patternCode,
            name: input.name,
            status: input.status,
            timezone: input.timezone,
            startLocalTime: input.startLocalTime,
            endLocalTime: input.endLocalTime,
            workingMinutes: input.workingMinutes,
            breakMinutes: input.breakMinutes,
            workingDays: [...input.workingDays],
            description: input.description,
            externalRef: input.externalRef,
            activatedAt: input.activatedAt,
            archivedAt: input.archivedAt,
            createdAt: input.createdAt,
            updatedAt: input.updatedAt,
          },
          WORK_PATTERN_ADMIN_FIELDS,
        ),
        "WorkPatternAdmin exposure",
      );
    },

    exposeMany(
      items: readonly WorkPatternListItemView[],
    ): readonly PlainObject[] {
      return items.map((item) => this.expose(item));
    },
  });

export const HolidayCalendarEntryAdminExposure =
  Object.freeze({
    expose(input: HolidayCalendarEntryRecord): PlainObject {
      return toPlainObject(
        ExposurePolicy.expose(
          {
            holidayCalendarEntryId:
              input.holidayCalendarEntryId,
            date: input.date,
            entryType: input.entryType,
            name: input.name,
            status: input.status,
            description: input.description,
            externalRef: input.externalRef,
            removedAt: input.removedAt,
            createdAt: input.createdAt,
            updatedAt: input.updatedAt,
          },
          HOLIDAY_CALENDAR_ENTRY_ADMIN_FIELDS,
        ),
        "HolidayCalendarEntryAdmin exposure",
      );
    },

    exposeMany(
      items: readonly HolidayCalendarEntryRecord[],
    ): readonly PlainObject[] {
      return items.map((item) => this.expose(item));
    },
  });

export const HolidayCalendarAdminExposure =
  Object.freeze({
    expose(
      input:
        | HolidayCalendarView
        | HolidayCalendarListItemView
        | HolidayCalendarMutationView,
    ): PlainObject {
      return toPlainObject(
        ExposurePolicy.expose(
          {
            holidayCalendarId:
              input.holidayCalendarId,
            calendarCode: input.calendarCode,
            name: input.name,
            scopeType: input.scopeType,
            timezone: input.timezone,
            status: input.status,
            entries:
              HolidayCalendarEntryAdminExposure.exposeMany(
                input.entries,
              ),
            description: input.description,
            externalRef: input.externalRef,
            activatedAt: input.activatedAt,
            archivedAt: input.archivedAt,
            createdAt: input.createdAt,
            updatedAt: input.updatedAt,
          },
          HOLIDAY_CALENDAR_ADMIN_FIELDS,
        ),
        "HolidayCalendarAdmin exposure",
      );
    },

    exposeMany(
      items: readonly HolidayCalendarListItemView[],
    ): readonly PlainObject[] {
      return items.map((item) => this.expose(item));
    },
  });

export const RosterExceptionAdminExposure =
  Object.freeze({
    expose(input: RosterExceptionRecord): PlainObject {
      return toPlainObject(
        ExposurePolicy.expose(
          {
            rosterExceptionId:
              input.rosterExceptionId,
            monthlyRosterId: input.monthlyRosterId,
            exceptionType: input.exceptionType,
            exceptionDate: input.exceptionDate,
            subjectEmploymentProfileId:
              input.subjectEmploymentProfileId,
            subjectEmploymentProfileRef:
              input.subjectEmploymentProfileRef,
            status: input.status,
            title: input.title,
            startLocalTime: input.startLocalTime,
            endLocalTime: input.endLocalTime,
            workingMinutes: input.workingMinutes,
            breakMinutes: input.breakMinutes,
            studioResourceIds: [
              ...input.studioResourceIds,
            ],
            studioResourceRefs: input.studioResourceRefs,
            reason: input.reason,
            sourceNote: input.sourceNote,
            description: input.description,
            externalRef: input.externalRef,
            removedAt: input.removedAt,
            createdAt: input.createdAt,
            updatedAt: input.updatedAt,
          },
          ROSTER_EXCEPTION_ADMIN_FIELDS,
        ),
        "RosterExceptionAdmin exposure",
      );
    },

    exposeMany(
      items: readonly RosterExceptionRecord[],
    ): readonly PlainObject[] {
      return items.map((item) => this.expose(item));
    },
  });

export const MonthlyRosterAdminExposure =
  Object.freeze({
    exposeListItem(
      input: MonthlyRosterListItemView,
    ): PlainObject {
      return toPlainObject(
        ExposurePolicy.expose(
          {
            monthlyRosterId:
              input.monthlyRosterId,
            rosterCode: input.rosterCode,
            rosterMonth: input.rosterMonth,
            timezone: input.timezone,
            targetSubjectKind:
              input.targetSubjectKind,
            targetOrgUnitMode:
              input.targetOrgUnitMode,
            targetType: input.targetType,
            targetMode: input.targetMode,
            targetOrgUnitId: input.targetOrgUnitId,
            targetOrgUnitRef: input.targetOrgUnitRef,
            targetTalentGroupId:
              input.targetTalentGroupId,
            targetTalentGroupRef:
              input.targetTalentGroupRef,
            targetRef: input.targetRef,
            departmentOrgUnitId:
              input.departmentOrgUnitId,
            departmentOrgUnitRef:
              input.departmentOrgUnitRef,
            workPatternId: input.workPatternId,
            workPatternRef: input.workPatternRef,
            holidayCalendarId:
              input.holidayCalendarId,
            holidayCalendarRef:
              input.holidayCalendarRef,
            status: input.status,
            draftVersion: input.draftVersion,
            exceptionCount: input.exceptionCount,
            description: input.description,
            externalRef: input.externalRef,
            archivedAt: input.archivedAt,
            createdAt: input.createdAt,
            updatedAt: input.updatedAt,
          },
          MONTHLY_ROSTER_ADMIN_LIST_FIELDS,
        ),
        "MonthlyRosterAdminList exposure",
      );
    },

    exposeDetail(
      input:
        | MonthlyRosterView
        | MonthlyRosterMutationView,
    ): PlainObject {
      return toPlainObject(
        ExposurePolicy.expose(
          {
            monthlyRosterId:
              input.monthlyRosterId,
            rosterCode: input.rosterCode,
            rosterMonth: input.rosterMonth,
            timezone: input.timezone,
            targetSubjectKind:
              input.targetSubjectKind,
            targetOrgUnitMode:
              input.targetOrgUnitMode,
            targetType: input.targetType,
            targetMode: input.targetMode,
            targetOrgUnitId: input.targetOrgUnitId,
            targetOrgUnitRef: input.targetOrgUnitRef,
            targetTalentGroupId:
              input.targetTalentGroupId,
            targetTalentGroupRef:
              input.targetTalentGroupRef,
            targetRef: input.targetRef,
            departmentOrgUnitId:
              input.departmentOrgUnitId,
            departmentOrgUnitRef:
              input.departmentOrgUnitRef,
            workPatternId: input.workPatternId,
            workPatternRef: input.workPatternRef,
            holidayCalendarId:
              input.holidayCalendarId,
            holidayCalendarRef:
              input.holidayCalendarRef,
            status: input.status,
            draftVersion: input.draftVersion,
            exceptionCount: input.exceptionCount,
            description: input.description,
            externalRef: input.externalRef,
            archivedAt: input.archivedAt,
            createdAt: input.createdAt,
            updatedAt: input.updatedAt,
            previewHash: input.previewHash,
            lastPreviewedAt:
              input.lastPreviewedAt,
            publishedAt: input.publishedAt,
            publishedByUserId:
              input.publishedByUserId,
            publishGenerationRunId:
              input.publishGenerationRunId,
            exceptions:
              RosterExceptionAdminExposure.exposeMany(
                input.exceptions,
              ),
          },
          MONTHLY_ROSTER_ADMIN_DETAIL_FIELDS,
        ),
        "MonthlyRosterAdminDetail exposure",
      );
    },

    exposeMany(
      items: readonly MonthlyRosterListItemView[],
    ): readonly PlainObject[] {
      return items.map((item) =>
        this.exposeListItem(item),
      );
    },
  });

export const MonthlyRosterPreviewAdminExposure =
  Object.freeze({
    exposeEligibleProfile(
      input: MonthlyRosterPreviewEligibleProfileView,
    ): PlainObject {
      return toPlainObject(
        ExposurePolicy.expose(
          {
            subjectEmploymentProfileId:
              input.subjectEmploymentProfileId,
            subjectEmploymentProfileRef:
              input.subjectEmploymentProfileRef,
            employmentStatus: input.employmentStatus,
            departmentOrgUnitId:
              input.departmentOrgUnitId,
            departmentOrgUnitRef:
              input.departmentOrgUnitRef,
          },
          MONTHLY_ROSTER_PREVIEW_ELIGIBLE_PROFILE_FIELDS,
        ),
        "MonthlyRosterPreviewEligibleProfile exposure",
      );
    },

    exposeConflict(
      input: MonthlyRosterPreviewConflictView,
    ): PlainObject {
      return toPlainObject(
        ExposurePolicy.expose(
          {
            conflictKind: input.conflictKind,
            workShiftId: input.workShiftId,
            relatedPreviewRowId:
              input.relatedPreviewRowId,
            shiftCode: input.shiftCode,
            title: input.title,
            status: input.status,
            shiftStartAt: input.shiftStartAt,
            shiftEndAt: input.shiftEndAt,
            sourceType: input.sourceType,
            sourceRosterId: input.sourceRosterId,
            sourceRosterMonth:
              input.sourceRosterMonth,
            sourceRosterLocalDate:
              input.sourceRosterLocalDate,
            sourceRosterSlotKey:
              input.sourceRosterSlotKey,
          },
          MONTHLY_ROSTER_PREVIEW_CONFLICT_FIELDS,
        ),
        "MonthlyRosterPreviewConflict exposure",
      );
    },

    exposeExcludedMember(
      input: MonthlyRosterPreviewView["excludedMembers"][number],
    ): PlainObject {
      return toPlainObject(
        ExposurePolicy.expose(
          {
            memberId: input.memberId,
            talentId: input.talentId,
            talentRef: input.talentRef,
            linkedEmploymentProfileId:
              input.linkedEmploymentProfileId,
            linkedEmploymentProfileRef:
              input.linkedEmploymentProfileRef,
            reasonCode: input.reasonCode,
          },
          MONTHLY_ROSTER_PREVIEW_EXCLUDED_MEMBER_FIELDS,
        ),
        "MonthlyRosterPreviewExcludedMember exposure",
      );
    },

    exposeRow(
      input: MonthlyRosterPreviewRowView,
    ): PlainObject {
      return toPlainObject(
        ExposurePolicy.expose(
          {
            previewRowId: input.previewRowId,
            monthlyRosterId: input.monthlyRosterId,
            rosterMonth: input.rosterMonth,
            targetType: input.targetType,
            targetMode: input.targetMode,
            targetOrgUnitId: input.targetOrgUnitId,
            targetOrgUnitRef: input.targetOrgUnitRef,
            targetTalentGroupId:
              input.targetTalentGroupId,
            targetTalentGroupRef:
              input.targetTalentGroupRef,
            targetRef: input.targetRef,
            departmentOrgUnitId:
              input.departmentOrgUnitId,
            departmentOrgUnitRef:
              input.departmentOrgUnitRef,
            subjectEmploymentProfileId:
              input.subjectEmploymentProfileId,
            subjectEmploymentProfileRef:
              input.subjectEmploymentProfileRef,
            localDate: input.localDate,
            rowKind: input.rowKind,
            sourceExceptionId:
              input.sourceExceptionId,
            sourceRosterSlotKey:
              input.sourceRosterSlotKey,
            startLocalTime: input.startLocalTime,
            endLocalTime: input.endLocalTime,
            shiftStartAt: input.shiftStartAt,
            shiftEndAt: input.shiftEndAt,
            workingMinutes: input.workingMinutes,
            breakMinutes: input.breakMinutes,
            holidayCalendarEntryId:
              input.holidayCalendarEntryId,
            holidayName: input.holidayName,
            holidayEntryType: input.holidayEntryType,
            isCandidateShift: input.isCandidateShift,
            isSuppressed: input.isSuppressed,
            conflicts: input.conflicts.map((conflict) =>
              this.exposeConflict(conflict),
            ),
            warnings: [...input.warnings],
            blockers: [...input.blockers],
          },
          MONTHLY_ROSTER_PREVIEW_ROW_FIELDS,
        ),
        "MonthlyRosterPreviewRow exposure",
      );
    },

    exposeSummary(
      input: MonthlyRosterPreviewSummaryView,
    ): PlainObject {
      return toPlainObject(
        ExposurePolicy.expose(
          {
            totalEligibleProfiles:
              input.totalEligibleProfiles,
            includedMemberCount:
              input.includedMemberCount,
            excludedMemberCount:
              input.excludedMemberCount,
            totalStandardCandidateShifts:
              input.totalStandardCandidateShifts,
            totalHolidaySuppressions:
              input.totalHolidaySuppressions,
            totalWorkingToOff:
              input.totalWorkingToOff,
            totalChangeTime: input.totalChangeTime,
            totalAddSpecialShift:
              input.totalAddSpecialShift,
            totalCandidateShiftsAfterExceptions:
              input.totalCandidateShiftsAfterExceptions,
            totalConflicts: input.totalConflicts,
          },
          MONTHLY_ROSTER_PREVIEW_SUMMARY_FIELDS,
        ),
        "MonthlyRosterPreviewSummary exposure",
      );
    },

    expose(input: MonthlyRosterPreviewView): PlainObject {
      return toPlainObject(
        ExposurePolicy.expose(
          {
            monthlyRosterId: input.monthlyRosterId,
            rosterMonth: input.rosterMonth,
            timezone: input.timezone,
            targetType: input.targetType,
            targetMode: input.targetMode,
            targetOrgUnitId: input.targetOrgUnitId,
            targetOrgUnitRef: input.targetOrgUnitRef,
            targetTalentGroupId:
              input.targetTalentGroupId,
            targetTalentGroupRef:
              input.targetTalentGroupRef,
            targetRef: input.targetRef,
            departmentOrgUnitId:
              input.departmentOrgUnitId,
            departmentOrgUnitRef:
              input.departmentOrgUnitRef,
            workPatternId: input.workPatternId,
            workPatternRef: input.workPatternRef,
            holidayCalendarId:
              input.holidayCalendarId,
            holidayCalendarRef:
              input.holidayCalendarRef,
            rosterStatus: input.rosterStatus,
            draftVersion: input.draftVersion,
            currentPreviewHash:
              input.currentPreviewHash,
            computedPreviewHash:
              input.computedPreviewHash,
            eligibleProfiles:
              input.eligibleProfiles.map((profile) =>
                this.exposeEligibleProfile(profile),
              ),
            excludedMembers:
              input.excludedMembers.map((member) =>
                this.exposeExcludedMember(member),
              ),
            rows: input.rows.map((row) =>
              this.exposeRow(row),
            ),
            summary: this.exposeSummary(input.summary),
            warnings: [...input.warnings],
          },
          MONTHLY_ROSTER_PREVIEW_FIELDS,
        ),
        "MonthlyRosterPreview exposure",
      );
    },
  });
