import { ClientSession } from "mongodb";
import { MonthlyRosterTargetType } from "./work-schedule.types";
import {
  WorkScheduleAvailabilityBatchRecord,
  WorkScheduleAvailabilityBatchStatus,
  WorkScheduleAvailabilityLineCounts,
  WorkScheduleAvailabilityLineRecord,
  WorkScheduleAvailabilityLineStatus,
  WorkScheduleAvailabilityTaxonomyCode,
  WorkScheduleAvailabilityType,
} from "./work-schedule-availability.types";

export interface WorkScheduleAvailabilityBatchListInput {
  readonly status?: WorkScheduleAvailabilityBatchStatus;
  readonly periodMonth?: string;
  readonly targetType?: MonthlyRosterTargetType;
  readonly targetOrgUnitId?: string;
  readonly targetTalentGroupId?: string;
  readonly submittedByEmploymentProfileId?: string;
  readonly limit: number;
  readonly cursor?: string;
}

export interface WorkScheduleAvailabilityBatchListResult {
  readonly items: readonly WorkScheduleAvailabilityBatchRecord[];
  readonly nextCursor?: string;
}

export interface PendingDuplicateWorkScheduleAvailabilityLineInput {
  readonly pendingDuplicateKey: string;
  readonly submittedByEmploymentProfileId: string;
  readonly periodMonth: string;
  readonly targetType: MonthlyRosterTargetType;
  readonly targetOrgUnitId: string | null;
  readonly targetTalentGroupId: string | null;
  readonly memberEmploymentProfileId: string;
  readonly availabilityType: WorkScheduleAvailabilityType;
  readonly taxonomyCode: WorkScheduleAvailabilityTaxonomyCode;
  readonly dateRangeStart: string;
  readonly dateRangeEnd: string;
  readonly preferredStartLocalTime: string | null;
  readonly preferredEndLocalTime: string | null;
  readonly reason: string;
}

export interface TransitionWorkScheduleAvailabilityLineInput {
  readonly batchId: string;
  readonly lineId: string;
  readonly fromStatus: "PENDING";
  readonly toStatus: Exclude<WorkScheduleAvailabilityLineStatus, "PENDING">;
  readonly updatedAt: number;
  readonly adminDecisionNote?: string | null;
  readonly rejectionReason?: string | null;
  readonly cancellationReason?: string | null;
  readonly approvedAt?: number | null;
  readonly approvedByActorId?: string | null;
  readonly rejectedAt?: number | null;
  readonly rejectedByActorId?: string | null;
  readonly cancelledAt?: number | null;
  readonly cancelledByActorId?: string | null;
}

export interface UpdateWorkScheduleAvailabilityBatchDerivedInput {
  readonly batchId: string;
  readonly status: WorkScheduleAvailabilityBatchStatus;
  readonly lineCounts: WorkScheduleAvailabilityLineCounts;
  readonly updatedAt: number;
  readonly cancelledAt?: number | null;
  readonly resolvedAt?: number | null;
}

export interface WorkScheduleAvailabilityBatchRepository {
  insertBatchWithLines(
    batch: WorkScheduleAvailabilityBatchRecord,
    lines: readonly WorkScheduleAvailabilityLineRecord[],
    session: ClientSession,
  ): Promise<WorkScheduleAvailabilityBatchRecord>;

  findBatchById(
    batchId: string,
    session?: ClientSession,
  ): Promise<WorkScheduleAvailabilityBatchRecord | null>;

  findBatchByClientToken(
    submittedByEmploymentProfileId: string,
    clientToken: string,
    session?: ClientSession,
  ): Promise<WorkScheduleAvailabilityBatchRecord | null>;

  listBatches(
    input: WorkScheduleAvailabilityBatchListInput,
    session?: ClientSession,
  ): Promise<WorkScheduleAvailabilityBatchListResult>;

  listLinesByBatchId(
    batchId: string,
    session?: ClientSession,
  ): Promise<readonly WorkScheduleAvailabilityLineRecord[]>;

  findLineById(
    batchId: string,
    lineId: string,
    session?: ClientSession,
  ): Promise<WorkScheduleAvailabilityLineRecord | null>;

  findPendingDuplicateLine(
    input: PendingDuplicateWorkScheduleAvailabilityLineInput,
    session?: ClientSession,
  ): Promise<WorkScheduleAvailabilityLineRecord | null>;

  transitionLineStatus(
    input: TransitionWorkScheduleAvailabilityLineInput,
    session: ClientSession,
  ): Promise<WorkScheduleAvailabilityLineRecord | null>;

  updateBatchDerived(
    input: UpdateWorkScheduleAvailabilityBatchDerivedInput,
    session: ClientSession,
  ): Promise<WorkScheduleAvailabilityBatchRecord | null>;
}
