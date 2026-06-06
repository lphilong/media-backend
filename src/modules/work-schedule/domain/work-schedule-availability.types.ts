import { ReferenceSummary } from "@modules/reference-summary";
import {
  MonthlyRosterTargetMode,
  MonthlyRosterTargetType,
} from "./work-schedule.types";

export const WORK_SCHEDULE_AVAILABILITY_BATCH_STATUSES = [
  "PENDING",
  "PARTIALLY_APPROVED",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
] as const;

export type WorkScheduleAvailabilityBatchStatus =
  (typeof WORK_SCHEDULE_AVAILABILITY_BATCH_STATUSES)[number];

export const WORK_SCHEDULE_AVAILABILITY_LINE_STATUSES = [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
] as const;

export type WorkScheduleAvailabilityLineStatus =
  (typeof WORK_SCHEDULE_AVAILABILITY_LINE_STATUSES)[number];

export const WORK_SCHEDULE_AVAILABILITY_TYPES = [
  "UNAVAILABLE_FULL_DAY",
  "PREFERRED_TIME",
  "OTHER_AVAILABILITY_NOTE",
] as const;

export type WorkScheduleAvailabilityType =
  (typeof WORK_SCHEDULE_AVAILABILITY_TYPES)[number];

export const WORK_SCHEDULE_AVAILABILITY_TAXONOMY_CODES = [
  "SICK_LEAVE",
  "AUTHORIZED_LEAVE",
  "SHIFT_CHANGE",
  "OTHER",
] as const;

export type WorkScheduleAvailabilityTaxonomyCode =
  (typeof WORK_SCHEDULE_AVAILABILITY_TAXONOMY_CODES)[number];

export type WorkScheduleAvailabilityApplyStatus =
  | "NOT_APPLIED"
  | "ADVISORY_ONLY"
  | "APPLIED";

export type WorkScheduleAvailabilityPolicyEvaluationStatus =
  "NOT_EVALUATED";

export interface WorkScheduleAvailabilityLineCounts {
  readonly total: number;
  readonly pending: number;
  readonly approved: number;
  readonly rejected: number;
  readonly cancelled: number;
}

export interface WorkScheduleAvailabilityBatchRecord {
  readonly id: string;
  readonly availabilityBatchCode: string;
  readonly submittedByActorId: string;
  readonly submittedByEmploymentProfileId: string;
  readonly periodMonth: string;
  readonly targetType: MonthlyRosterTargetType;
  readonly targetMode: MonthlyRosterTargetMode;
  readonly targetOrgUnitId: string | null;
  readonly targetTalentGroupId: string | null;
  readonly targetRef: ReferenceSummary | null;
  readonly status: WorkScheduleAvailabilityBatchStatus;
  readonly note: string | null;
  readonly lineCounts: WorkScheduleAvailabilityLineCounts;
  readonly clientToken: string;
  readonly submittedAt: number;
  readonly cancelledAt: number | null;
  readonly resolvedAt: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface WorkScheduleAvailabilityLineRecord {
  readonly id: string;
  readonly batchId: string;
  readonly lineNo: number;
  readonly pendingDuplicateKey?: string;
  readonly memberEmploymentProfileId: string;
  readonly availabilityType: WorkScheduleAvailabilityType;
  readonly taxonomyCode: WorkScheduleAvailabilityTaxonomyCode;
  readonly dateRangeStart: string;
  readonly dateRangeEnd: string;
  readonly preferredStartLocalTime: string | null;
  readonly preferredEndLocalTime: string | null;
  readonly reason: string;
  readonly status: WorkScheduleAvailabilityLineStatus;
  readonly applyStatus: WorkScheduleAvailabilityApplyStatus;
  readonly policyEvaluationStatus: WorkScheduleAvailabilityPolicyEvaluationStatus;
  readonly appliedRosterId: string | null;
  readonly appliedRosterExceptionId: string | null;
  readonly appliedRosterExceptionIds: readonly string[];
  readonly appliedAt: number | null;
  readonly appliedByActorId: string | null;
  readonly adminDecisionNote: string | null;
  readonly rejectionReason: string | null;
  readonly cancellationReason: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly approvedAt: number | null;
  readonly approvedByActorId: string | null;
  readonly rejectedAt: number | null;
  readonly rejectedByActorId: string | null;
  readonly cancelledAt: number | null;
  readonly cancelledByActorId: string | null;
  readonly submittedByEmploymentProfileId: string;
  readonly periodMonth: string;
  readonly targetType: MonthlyRosterTargetType;
  readonly targetOrgUnitId: string | null;
  readonly targetTalentGroupId: string | null;
}

export interface WorkScheduleAvailabilityLineView
  extends WorkScheduleAvailabilityLineRecord {
  readonly memberEmploymentProfileRef: ReferenceSummary | null;
}

export interface WorkScheduleAvailabilityBatchListItemView
  extends WorkScheduleAvailabilityBatchRecord {
  readonly submittedByEmploymentProfileRef: ReferenceSummary | null;
}

export interface WorkScheduleAvailabilityBatchView
  extends WorkScheduleAvailabilityBatchListItemView {
  readonly lines: readonly WorkScheduleAvailabilityLineView[];
}
