import {
  WorkScheduleAvailabilityBatchListItemView,
  WorkScheduleAvailabilityBatchView,
  WorkScheduleAvailabilityLineView,
} from "../domain/work-schedule-availability.types";

export function exposeManagerAvailabilityListItem(
  input: WorkScheduleAvailabilityBatchListItemView,
) {
  return exposeBatchBase(input);
}

export function exposeManagerAvailabilityBatch(
  input: WorkScheduleAvailabilityBatchView,
) {
  return {
    ...exposeBatchBase(input),
    lines: input.lines.map(exposeAvailabilityLine),
  };
}

export function exposeAdminAvailabilityListItem(
  input: WorkScheduleAvailabilityBatchListItemView,
) {
  return {
    ...exposeBatchBase(input),
    submitter: toSafeReference(
      input.submittedByEmploymentProfileId,
      input.submittedByEmploymentProfileRef,
    ),
  };
}

export function exposeAdminAvailabilityBatch(
  input: WorkScheduleAvailabilityBatchView,
) {
  return {
    ...exposeAdminAvailabilityListItem(input),
    lines: input.lines.map(exposeAvailabilityLine),
  };
}

function exposeBatchBase(
  input: WorkScheduleAvailabilityBatchListItemView,
) {
  return {
    id: input.id,
    availabilityBatchCode: input.availabilityBatchCode,
    status: input.status,
    periodMonth: input.periodMonth,
    targetType: input.targetType,
    targetMode: input.targetMode,
    targetOrgUnitId: input.targetOrgUnitId,
    targetTalentGroupId: input.targetTalentGroupId,
    target: input.targetRef,
    note: input.note,
    lineCounts: input.lineCounts,
    clientToken: input.clientToken,
    submittedAt: input.submittedAt,
    cancelledAt: input.cancelledAt,
    resolvedAt: input.resolvedAt,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

function exposeAvailabilityLine(input: WorkScheduleAvailabilityLineView) {
  return {
    id: input.id,
    lineNo: input.lineNo,
    member: toSafeReference(
      input.memberEmploymentProfileId,
      input.memberEmploymentProfileRef,
    ),
    availabilityType: input.availabilityType,
    taxonomyCode: input.taxonomyCode,
    availabilityDate:
      input.dateRangeStart === input.dateRangeEnd
        ? input.dateRangeStart
        : null,
    dateRangeStart: input.dateRangeStart,
    dateRangeEnd: input.dateRangeEnd,
    preferredStartLocalTime: input.preferredStartLocalTime,
    preferredEndLocalTime: input.preferredEndLocalTime,
    reason: input.reason,
    status: input.status,
    applyStatus: input.applyStatus,
    policyEvaluationStatus: input.policyEvaluationStatus,
    adminDecisionNote: input.adminDecisionNote,
    rejectionReason: input.rejectionReason,
    cancellationReason: input.cancellationReason,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    approvedAt: input.approvedAt,
    rejectedAt: input.rejectedAt,
    cancelledAt: input.cancelledAt,
  };
}

function toSafeReference(
  employmentProfileId: string,
  ref:
    | WorkScheduleAvailabilityLineView["memberEmploymentProfileRef"]
    | WorkScheduleAvailabilityBatchListItemView["submittedByEmploymentProfileRef"],
) {
  return {
    employmentProfileId,
    displayName:
      ref?.displayName ?? ref?.title ?? ref?.name ?? employmentProfileId,
    employeeCode: ref?.code,
    status: ref?.status,
  };
}
