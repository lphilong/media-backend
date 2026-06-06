import { ClientSession } from "mongodb";
import {
  HolidayCalendarEntryRecord,
  HolidayCalendarStatus,
  HolidayCalendarRecord,
  MonthlyRosterRecord,
  MonthlyRosterStatus,
  MonthlyRosterTargetType,
  MonthlyRosterTargetMode,
  RosterExceptionRecord,
  WorkPatternRecord,
  WorkPatternStatus,
  WorkShiftRecord,
  WorkShiftStatus,
  WorkShiftSubjectKind,
  WorkScheduleRequestRecord,
  WorkScheduleRequestBatchRecord,
  WorkScheduleRequestBatchStatus,
  WorkScheduleRequestLineRecord,
  WorkScheduleRequestLineCounts,
  WorkScheduleRequestLineStatus,
  WorkScheduleRequestStatus,
  WorkScheduleRequestType,
} from "./work-schedule.types";

export interface WorkShiftSubjectReferenceInput {
  readonly subjectKind: WorkShiftSubjectKind;
  readonly subjectEmploymentProfileId: string | null;
  readonly subjectTalentId: string | null;
  readonly subjectTalentGroupId: string | null;
}

export interface UpdateWorkShiftCoreInput {
  readonly workShiftId: string;
  readonly title?: string;
  readonly normalizedTitle?: string;
  readonly description?: string | null;
  readonly externalRef?: string | null;
  readonly updatedAt: number;
}

export interface RescheduleWorkShiftInput {
  readonly workShiftId: string;
  readonly shiftStartAt: number;
  readonly shiftEndAt: number;
  readonly updatedAt: number;
}

export interface ReassignWorkShiftSubjectInput
  extends WorkShiftSubjectReferenceInput {
  readonly workShiftId: string;
  readonly updatedAt: number;
}

export interface ReplaceWorkShiftResourcesInput {
  readonly workShiftId: string;
  readonly studioResourceIds: readonly string[];
  readonly updatedAt: number;
}

export interface TransitionWorkShiftStatusInput {
  readonly workShiftId: string;
  readonly fromStatuses: readonly WorkShiftStatus[];
  readonly toStatus: WorkShiftStatus;
  readonly updatedAt: number;
}

export interface WorkShiftOverlapSubjectCheckInput
  extends WorkShiftSubjectReferenceInput {
  readonly shiftStartAt: number;
  readonly shiftEndAt: number;
  readonly excludeWorkShiftId?: string;
}

export interface WorkShiftOverlapResourceCheckInput {
  readonly studioResourceIds: readonly string[];
  readonly shiftStartAt: number;
  readonly shiftEndAt: number;
  readonly excludeWorkShiftId?: string;
}

export interface ActiveEmploymentProfileWorkShiftLookupInput {
  readonly subjectEmploymentProfileIds: readonly string[];
  readonly windowStartAt: number;
  readonly windowEndAt: number;
}

export interface ActiveEmploymentProfileWorkShiftConflictRecord {
  readonly workShiftId: string;
  readonly shiftCode: string;
  readonly title: string;
  readonly subjectEmploymentProfileId: string;
  readonly status: "ACTIVE";
  readonly shiftStartAt: number;
  readonly shiftEndAt: number;
  readonly sourceType: WorkShiftRecord["sourceType"];
  readonly sourceRosterId: string | null;
  readonly sourceRosterMonth: string | null;
  readonly sourceRosterLocalDate: string | null;
  readonly sourceRosterSlotKey: string | null;
}

export interface GeneratedWorkShiftRosterSummary {
  readonly workShiftIds: readonly string[];
  readonly generatedWorkShiftCount: number;
  readonly changeTimeCount: number;
  readonly addSpecialShiftCount: number;
}

export interface WorkShiftRepository {
  insert(
    workShift: WorkShiftRecord,
    session: ClientSession,
  ): Promise<WorkShiftRecord>;

  findById(
    workShiftId: string,
    session?: ClientSession,
  ): Promise<WorkShiftRecord | null>;

  findByShiftCode(
    shiftCode: string,
    session?: ClientSession,
  ): Promise<WorkShiftRecord | null>;

  updateCore(
    input: UpdateWorkShiftCoreInput,
    session: ClientSession,
  ): Promise<WorkShiftRecord | null>;

  reschedule(
    input: RescheduleWorkShiftInput,
    session: ClientSession,
  ): Promise<WorkShiftRecord | null>;

  reassignSubject(
    input: ReassignWorkShiftSubjectInput,
    session: ClientSession,
  ): Promise<WorkShiftRecord | null>;

  replaceResources(
    input: ReplaceWorkShiftResourcesInput,
    session: ClientSession,
  ): Promise<WorkShiftRecord | null>;

  transitionStatus(
    input: TransitionWorkShiftStatusInput,
    session: ClientSession,
  ): Promise<WorkShiftRecord | null>;

  hasActiveOverlappingSubjectShift(
    input: WorkShiftOverlapSubjectCheckInput,
    session?: ClientSession,
  ): Promise<boolean>;

  hasActiveOverlappingResourceShift(
    input: WorkShiftOverlapResourceCheckInput,
    session?: ClientSession,
  ): Promise<boolean>;

  listActiveEmploymentProfileShiftsForWindow(
    input: ActiveEmploymentProfileWorkShiftLookupInput,
    session?: ClientSession,
  ): Promise<
    readonly ActiveEmploymentProfileWorkShiftConflictRecord[]
  >;

  summarizeGeneratedByRoster(
    monthlyRosterId: string,
    session?: ClientSession,
  ): Promise<GeneratedWorkShiftRosterSummary>;
}

export interface InsertWorkPatternInput
  extends WorkPatternRecord {}

export interface UpdateWorkPatternInput {
  readonly workPatternId: string;
  readonly name?: string;
  readonly normalizedName?: string;
  readonly startLocalTime?: string;
  readonly endLocalTime?: string;
  readonly workingMinutes?: number;
  readonly breakMinutes?: number;
  readonly workingDays?: WorkPatternRecord["workingDays"];
  readonly description?: string | null;
  readonly externalRef?: string | null;
  readonly updatedAt: number;
}

export interface TransitionWorkPatternStatusInput {
  readonly workPatternId: string;
  readonly fromStatuses: readonly WorkPatternStatus[];
  readonly toStatus: WorkPatternStatus;
  readonly updatedAt: number;
  readonly activatedAt?: number | null;
  readonly archivedAt?: number | null;
}

export interface WorkPatternRepository {
  insert(
    workPattern: InsertWorkPatternInput,
    session: ClientSession,
  ): Promise<WorkPatternRecord>;

  findById(
    workPatternId: string,
    session?: ClientSession,
  ): Promise<WorkPatternRecord | null>;

  findByPatternCode(
    patternCode: string,
    session?: ClientSession,
  ): Promise<WorkPatternRecord | null>;

  update(
    input: UpdateWorkPatternInput,
    session: ClientSession,
  ): Promise<WorkPatternRecord | null>;

  transitionStatus(
    input: TransitionWorkPatternStatusInput,
    session: ClientSession,
  ): Promise<WorkPatternRecord | null>;
}

export interface InsertHolidayCalendarInput
  extends HolidayCalendarRecord {}

export interface UpdateHolidayCalendarInput {
  readonly holidayCalendarId: string;
  readonly name?: string;
  readonly normalizedName?: string;
  readonly description?: string | null;
  readonly externalRef?: string | null;
  readonly updatedAt: number;
}

export interface TransitionHolidayCalendarStatusInput {
  readonly holidayCalendarId: string;
  readonly fromStatuses: readonly HolidayCalendarStatus[];
  readonly toStatus: HolidayCalendarStatus;
  readonly updatedAt: number;
  readonly activatedAt?: number | null;
  readonly archivedAt?: number | null;
}

export interface AddHolidayCalendarEntryInput {
  readonly holidayCalendarId: string;
  readonly entry: HolidayCalendarEntryRecord;
  readonly updatedAt: number;
}

export interface UpdateHolidayCalendarEntryInput {
  readonly holidayCalendarId: string;
  readonly holidayCalendarEntryId: string;
  readonly date?: string;
  readonly entryType?: HolidayCalendarEntryRecord["entryType"];
  readonly name?: string;
  readonly description?: string | null;
  readonly externalRef?: string | null;
  readonly updatedAt: number;
}

export interface RemoveHolidayCalendarEntryInput {
  readonly holidayCalendarId: string;
  readonly holidayCalendarEntryId: string;
  readonly updatedAt: number;
  readonly removedAt: number;
}

export interface HolidayCalendarRepository {
  insert(
    holidayCalendar: InsertHolidayCalendarInput,
    session: ClientSession,
  ): Promise<HolidayCalendarRecord>;

  findById(
    holidayCalendarId: string,
    session?: ClientSession,
  ): Promise<HolidayCalendarRecord | null>;

  findByCalendarCode(
    calendarCode: string,
    session?: ClientSession,
  ): Promise<HolidayCalendarRecord | null>;

  update(
    input: UpdateHolidayCalendarInput,
    session: ClientSession,
  ): Promise<HolidayCalendarRecord | null>;

  transitionStatus(
    input: TransitionHolidayCalendarStatusInput,
    session: ClientSession,
  ): Promise<HolidayCalendarRecord | null>;

  addEntry(
    input: AddHolidayCalendarEntryInput,
    session: ClientSession,
  ): Promise<HolidayCalendarRecord | null>;

  updateEntry(
    input: UpdateHolidayCalendarEntryInput,
    session: ClientSession,
  ): Promise<HolidayCalendarRecord | null>;

  removeEntry(
    input: RemoveHolidayCalendarEntryInput,
    session: ClientSession,
  ): Promise<HolidayCalendarRecord | null>;
}

export interface InsertMonthlyRosterInput
  extends MonthlyRosterRecord {}

export interface UpdateMonthlyRosterDraftInput {
  readonly monthlyRosterId: string;
  readonly rosterMonth?: string;
  readonly targetType?: MonthlyRosterTargetType;
  readonly targetMode?: MonthlyRosterTargetMode;
  readonly targetOrgUnitId?: string | null;
  readonly targetTalentGroupId?: string | null;
  readonly departmentOrgUnitId?: string | null;
  readonly workPatternId?: string;
  readonly holidayCalendarId?: string;
  readonly description?: string | null;
  readonly externalRef?: string | null;
  readonly updatedAt: number;
}

export interface TransitionMonthlyRosterStatusInput {
  readonly monthlyRosterId: string;
  readonly fromStatuses: readonly MonthlyRosterStatus[];
  readonly toStatus: MonthlyRosterStatus;
  readonly updatedAt: number;
  readonly archivedAt?: number | null;
}

export interface PublishMonthlyRosterInput {
  readonly monthlyRosterId: string;
  readonly fromStatus: "DRAFT";
  readonly updatedAt: number;
  readonly publishedAt: number;
  readonly publishedByUserId: string;
  readonly publishGenerationRunId: string;
  readonly previewHash: string;
  readonly lastPreviewedAt: number;
}

export interface AddRosterExceptionInput {
  readonly monthlyRosterId: string;
  readonly exception: RosterExceptionRecord;
  readonly updatedAt: number;
  readonly expectedNoActiveSourceAvailabilityLineId?: string;
  readonly expectedNoActiveStandardException?: {
    readonly subjectEmploymentProfileId: string;
    readonly exceptionDate: string;
  };
}

export interface UpdateRosterExceptionInput {
  readonly monthlyRosterId: string;
  readonly rosterExceptionId: string;
  readonly exceptionType?: RosterExceptionRecord["exceptionType"];
  readonly exceptionDate?: string;
  readonly subjectEmploymentProfileId?: string;
  readonly title?: string | null;
  readonly startLocalTime?: string | null;
  readonly endLocalTime?: string | null;
  readonly workingMinutes?: number | null;
  readonly breakMinutes?: number | null;
  readonly studioResourceIds?: readonly string[];
  readonly reason?: string | null;
  readonly sourceNote?: string | null;
  readonly sourceAvailabilityBatchId?: string | null;
  readonly sourceAvailabilityLineId?: string | null;
  readonly sourceAvailabilityType?: RosterExceptionRecord["sourceAvailabilityType"];
  readonly sourceAvailabilityTaxonomyCode?: RosterExceptionRecord["sourceAvailabilityTaxonomyCode"];
  readonly sourceAppliedAt?: number | null;
  readonly sourceAppliedByActorId?: string | null;
  readonly sourceApplyNote?: string | null;
  readonly description?: string | null;
  readonly externalRef?: string | null;
  readonly updatedAt: number;
}

export interface RemoveRosterExceptionInput {
  readonly monthlyRosterId: string;
  readonly rosterExceptionId: string;
  readonly updatedAt: number;
  readonly removedAt: number;
}

export interface MonthlyRosterRepository {
  insert(
    monthlyRoster: InsertMonthlyRosterInput,
    session: ClientSession,
  ): Promise<MonthlyRosterRecord>;

  findById(
    monthlyRosterId: string,
    session?: ClientSession,
  ): Promise<MonthlyRosterRecord | null>;

  findByRosterCode(
    rosterCode: string,
    session?: ClientSession,
  ): Promise<MonthlyRosterRecord | null>;

  findActiveByTargetAndMonth(
    target: {
      readonly targetType: MonthlyRosterTargetType;
      readonly targetOrgUnitId: string | null;
      readonly targetTalentGroupId: string | null;
    },
    rosterMonth: string,
    session?: ClientSession,
  ): Promise<MonthlyRosterRecord | null>;

  updateDraft(
    input: UpdateMonthlyRosterDraftInput,
    session: ClientSession,
  ): Promise<MonthlyRosterRecord | null>;

  transitionStatus(
    input: TransitionMonthlyRosterStatusInput,
    session: ClientSession,
  ): Promise<MonthlyRosterRecord | null>;

  publish(
    input: PublishMonthlyRosterInput,
    session: ClientSession,
  ): Promise<MonthlyRosterRecord | null>;

  addException(
    input: AddRosterExceptionInput,
    session: ClientSession,
  ): Promise<MonthlyRosterRecord | null>;

  updateException(
    input: UpdateRosterExceptionInput,
    session: ClientSession,
  ): Promise<MonthlyRosterRecord | null>;

  removeException(
    input: RemoveRosterExceptionInput,
    session: ClientSession,
  ): Promise<MonthlyRosterRecord | null>;
}

export interface WorkScheduleRequestListInput {
  readonly status?: WorkScheduleRequestStatus;
  readonly requestType?: WorkScheduleRequestType;
  readonly targetEmploymentProfileId?: string;
  readonly targetWorkShiftId?: string;
  readonly requestedByUserId?: string;
  readonly visibleTargetEmploymentProfileIds?: readonly string[];
  readonly visibleRequestedByUserId?: string;
  readonly limit: number;
  readonly cursor?: string;
}

export interface WorkScheduleRequestListResult {
  readonly items: readonly WorkScheduleRequestRecord[];
  readonly nextCursor?: string;
}

export interface TransitionWorkScheduleRequestInput {
  readonly requestId: string;
  readonly fromStatus: "PENDING";
  readonly toStatus: Exclude<
    WorkScheduleRequestStatus,
    "PENDING"
  >;
  readonly updatedAt: number;
  readonly approvedByUserId?: string | null;
  readonly approvedAt?: number | null;
  readonly approvalNote?: string | null;
  readonly rejectedByUserId?: string | null;
  readonly rejectedAt?: number | null;
  readonly rejectionReason?: string | null;
  readonly cancelledByUserId?: string | null;
  readonly cancelledAt?: number | null;
  readonly cancellationReason?: string | null;
  readonly appliedWorkShiftId?: string | null;
}

export interface WorkScheduleRequestRepository {
  insert(
    request: WorkScheduleRequestRecord,
    session: ClientSession,
  ): Promise<WorkScheduleRequestRecord>;

  findById(
    requestId: string,
    session?: ClientSession,
  ): Promise<WorkScheduleRequestRecord | null>;

  list(
    input: WorkScheduleRequestListInput,
    session?: ClientSession,
  ): Promise<WorkScheduleRequestListResult>;

  transitionStatus(
    input: TransitionWorkScheduleRequestInput,
    session: ClientSession,
  ): Promise<WorkScheduleRequestRecord | null>;
}

export interface WorkScheduleRequestBatchListInput {
  readonly status?: WorkScheduleRequestBatchStatus;
  readonly periodMonth?: string;
  readonly submittedByEmploymentProfileId?: string;
  readonly submittedByActorId?: string;
  readonly limit: number;
  readonly cursor?: string;
}

export interface WorkScheduleRequestBatchListResult {
  readonly items: readonly WorkScheduleRequestBatchRecord[];
  readonly nextCursor?: string;
}

export interface PendingDuplicateWorkScheduleRequestLineInput {
  readonly submittedByEmploymentProfileId: string;
  readonly periodMonth: string;
  readonly requestType: WorkScheduleRequestType;
  readonly memberEmploymentProfileId: string;
  readonly workShiftId: string | null;
  readonly requestedStartAt: number | null;
  readonly requestedEndAt: number | null;
}

export interface TransitionWorkScheduleRequestLineInput {
  readonly batchId: string;
  readonly lineId: string;
  readonly fromStatus: "PENDING";
  readonly toStatus: Exclude<
    WorkScheduleRequestLineStatus,
    "PENDING"
  >;
  readonly updatedAt: number;
  readonly approvalNote?: string | null;
  readonly rejectionReason?: string | null;
  readonly cancellationReason?: string | null;
  readonly failureReason?: string | null;
  readonly appliedWorkShiftId?: string | null;
  readonly approvedAt?: number | null;
  readonly approvedByActorId?: string | null;
  readonly rejectedAt?: number | null;
  readonly rejectedByActorId?: string | null;
  readonly cancelledAt?: number | null;
  readonly cancelledByActorId?: string | null;
  readonly failedAt?: number | null;
  readonly failedByActorId?: string | null;
}

export interface UpdateWorkScheduleRequestBatchDerivedInput {
  readonly batchId: string;
  readonly status: WorkScheduleRequestBatchStatus;
  readonly lineCounts: WorkScheduleRequestLineCounts;
  readonly updatedAt: number;
  readonly cancelledAt?: number | null;
  readonly resolvedAt?: number | null;
}

export interface WorkScheduleRequestBatchRepository {
  insertBatchWithLines(
    batch: WorkScheduleRequestBatchRecord,
    lines: readonly WorkScheduleRequestLineRecord[],
    session: ClientSession,
  ): Promise<WorkScheduleRequestBatchRecord>;

  findBatchById(
    batchId: string,
    session?: ClientSession,
  ): Promise<WorkScheduleRequestBatchRecord | null>;

  findBatchByClientToken(
    submittedByEmploymentProfileId: string,
    clientToken: string,
    session?: ClientSession,
  ): Promise<WorkScheduleRequestBatchRecord | null>;

  listBatches(
    input: WorkScheduleRequestBatchListInput,
    session?: ClientSession,
  ): Promise<WorkScheduleRequestBatchListResult>;

  listLinesByBatchId(
    batchId: string,
    session?: ClientSession,
  ): Promise<readonly WorkScheduleRequestLineRecord[]>;

  findLineById(
    batchId: string,
    lineId: string,
    session?: ClientSession,
  ): Promise<WorkScheduleRequestLineRecord | null>;

  findPendingDuplicateLine(
    input: PendingDuplicateWorkScheduleRequestLineInput,
    session?: ClientSession,
  ): Promise<WorkScheduleRequestLineRecord | null>;

  transitionLineStatus(
    input: TransitionWorkScheduleRequestLineInput,
    session: ClientSession,
  ): Promise<WorkScheduleRequestLineRecord | null>;

  updateBatchDerived(
    input: UpdateWorkScheduleRequestBatchDerivedInput,
    session: ClientSession,
  ): Promise<WorkScheduleRequestBatchRecord | null>;
}
