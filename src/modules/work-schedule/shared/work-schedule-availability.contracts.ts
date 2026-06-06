import { MonthlyRosterTargetType } from "../domain/work-schedule.types";
import {
  WorkScheduleAvailabilityBatchListItemView,
  WorkScheduleAvailabilityBatchStatus,
  WorkScheduleAvailabilityBatchView,
  WorkScheduleAvailabilityTaxonomyCode,
  WorkScheduleAvailabilityType,
} from "../domain/work-schedule-availability.types";

export interface WorkScheduleAvailabilityLineCommand {
  readonly memberEmploymentProfileId: string;
  readonly availabilityType: WorkScheduleAvailabilityType | string;
  readonly taxonomyCode: WorkScheduleAvailabilityTaxonomyCode | string;
  readonly availabilityDate?: string | null;
  readonly dateRangeStart?: string | null;
  readonly dateRangeEnd?: string | null;
  readonly preferredStartLocalTime?: string | null;
  readonly preferredEndLocalTime?: string | null;
  readonly reason: string;
}

export interface SubmitWorkScheduleAvailabilityBatchCommand {
  readonly periodMonth: string;
  readonly targetType: MonthlyRosterTargetType | string;
  readonly targetMode?: string | null;
  readonly targetOrgUnitId?: string | null;
  readonly targetTalentGroupId?: string | null;
  readonly clientToken?: string | null;
  readonly idempotencyKey?: string | null;
  readonly note?: string | null;
  readonly lines: readonly WorkScheduleAvailabilityLineCommand[];
}

export interface ListWorkScheduleAvailabilityBatchesQuery {
  readonly status?: WorkScheduleAvailabilityBatchStatus | string;
  readonly periodMonth?: string;
  readonly targetType?: MonthlyRosterTargetType | string;
  readonly targetOrgUnitId?: string;
  readonly targetTalentGroupId?: string;
  readonly submittedByEmploymentProfileId?: string;
  readonly limit?: number | string;
  readonly cursor?: string;
}

export interface GetWorkScheduleAvailabilityBatchDetailQuery {
  readonly batchId: string;
}

export interface DecideWorkScheduleAvailabilityLinesCommand {
  readonly batchId: string;
  readonly lineIds: readonly string[];
  readonly adminDecisionNote?: string | null;
  readonly rejectionReason?: string | null;
  readonly cancellationReason?: string | null;
}

export interface CancelWorkScheduleAvailabilityBatchCommand {
  readonly batchId: string;
  readonly cancellationReason: string;
}

export interface CancelWorkScheduleAvailabilityLineCommand {
  readonly batchId: string;
  readonly lineId: string;
  readonly cancellationReason: string;
}

export type WorkScheduleAvailabilityBatchMutationResult =
  WorkScheduleAvailabilityBatchView;

export interface ListWorkScheduleAvailabilityBatchesResult {
  readonly items: readonly WorkScheduleAvailabilityBatchListItemView[];
  readonly nextCursor?: string;
}
