import { ClientSession } from "mongodb";
import {
  PlatformEarningBatchStatus,
  PlatformEarningSourceType,
  PlatformEarningSourceUnit,
  RevenueCommissionableBasisSnapshot,
  RevenueConversionSnapshot,
  RevenuePlatformCutSnapshot,
} from "./revenue-ledger.types";

export interface PlatformEarningLine {
  readonly id: string;
  readonly batchId: string;
  readonly batchStatus: PlatformEarningBatchStatus;
  readonly sourceDate: number;
  readonly periodMonth: string;
  readonly platform: string;
  readonly platformAccountId: string;
  readonly talentGroupId: string | null;
  readonly memberTalentId: string | null;
  readonly memberEmploymentProfileId: string | null;
  readonly eventId: string | null;
  readonly sourceType: PlatformEarningSourceType;
  readonly sourceUnit: PlatformEarningSourceUnit;
  readonly rawQuantity: number;
  readonly externalSourceRef: string | null;
  readonly notes: string | null;
  readonly duplicateDetectionKey: string;
  readonly correctionOfLineId: string | null;
  readonly replacementLineId: string | null;
  readonly enteredByActorId: string;
  readonly enteredAt: number;
  readonly submittedByActorId: string | null;
  readonly submittedAt: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface PlatformEarningBatch {
  readonly id: string;
  readonly batchCode: string;
  readonly platform: string;
  readonly platformAccountId: string;
  readonly talentGroupId: string | null;
  readonly sourceType: PlatformEarningSourceType;
  readonly sourceUnit: PlatformEarningSourceUnit;
  readonly periodMonth: string;
  readonly sourceDateFrom: number;
  readonly sourceDateTo: number;
  readonly status: PlatformEarningBatchStatus;
  readonly sourceLineCount: number;
  readonly rawQuantityTotal: number;
  readonly conversionSnapshot: RevenueConversionSnapshot | null;
  readonly platformCutSnapshot: RevenuePlatformCutSnapshot | null;
  readonly companyNetAmount: number | null;
  readonly commissionableBasisAmount: number | null;
  readonly submittedByActorId: string | null;
  readonly submittedAt: number | null;
  readonly reviewedByActorId: string | null;
  readonly reviewedAt: number | null;
  readonly approvedByActorId: string | null;
  readonly approvedAt: number | null;
  readonly rejectedByActorId: string | null;
  readonly rejectedAt: number | null;
  readonly rejectionReason: string | null;
  readonly voidedByActorId: string | null;
  readonly voidedAt: number | null;
  readonly voidReason: string | null;
  readonly archivedByActorId: string | null;
  readonly archivedAt: number | null;
  readonly sourceFingerprint: string | null;
  readonly revenueEntryId: string | null;
  readonly revenueEntryCreatedByActorId: string | null;
  readonly revenueEntryCreatedAt: number | null;
  readonly createdByActorId: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface PlatformEarningBatchListFilters {
  readonly status?: PlatformEarningBatchStatus;
  readonly platform?: string;
  readonly platformAccountId?: string;
  readonly platformAccountIds?: readonly string[];
  readonly talentGroupId?: string;
  readonly createdByActorId?: string;
  readonly sourceType?: PlatformEarningSourceType;
  readonly periodMonth?: string;
  readonly createdBeforeAt?: number;
  readonly limit: number;
  readonly cursor?: string;
}

export interface PlatformEarningLineListFilters {
  readonly batchId?: string;
  readonly periodMonth?: string;
  readonly status?: PlatformEarningBatchStatus;
  readonly platform?: string;
  readonly platformAccountId?: string;
  readonly talentGroupId?: string;
  readonly memberTalentId?: string;
  readonly limit: number;
  readonly cursor?: string;
}

export interface PlatformEarningBatchListPage {
  readonly items: readonly PlatformEarningBatch[];
  readonly nextCursor?: string;
}

export interface PlatformEarningLineListPage {
  readonly items: readonly PlatformEarningLine[];
  readonly nextCursor?: string;
}

export interface CreatePlatformEarningBatchInput {
  readonly id: string;
  readonly batchCode: string;
  readonly platform: string;
  readonly platformAccountId: string;
  readonly talentGroupId: string | null;
  readonly sourceType: PlatformEarningSourceType;
  readonly sourceUnit: PlatformEarningSourceUnit;
  readonly periodMonth: string;
  readonly sourceDateFrom: number;
  readonly sourceDateTo: number;
  readonly createdByActorId: string;
  readonly createdAt: number;
}

export interface UpdatePlatformEarningBatchDraftInput {
  readonly batchId: string;
  readonly platformAccountId?: string;
  readonly talentGroupId?: string | null;
  readonly sourceDateFrom?: number;
  readonly sourceDateTo?: number;
  readonly updatedAt: number;
}

export interface UpdatePlatformEarningLineInput {
  readonly lineId: string;
  readonly sourceDate?: number;
  readonly memberTalentId?: string | null;
  readonly memberEmploymentProfileId?: string | null;
  readonly eventId?: string | null;
  readonly rawQuantity?: number;
  readonly externalSourceRef?: string | null;
  readonly notes?: string | null;
  readonly duplicateDetectionKey?: string;
  readonly updatedAt: number;
}

export interface ApprovePlatformEarningBatchInput {
  readonly batchId: string;
  readonly conversionSnapshot: RevenueConversionSnapshot;
  readonly platformCutSnapshot: RevenuePlatformCutSnapshot;
  readonly commissionableBasisSnapshot: RevenueCommissionableBasisSnapshot;
  readonly companyNetAmount: number;
  readonly commissionableBasisAmount: number;
  readonly sourceFingerprint: string;
  readonly approvedByActorId: string;
  readonly approvedAt: number;
  readonly updatedAt: number;
}

export interface PlatformEarningRepository {
  insertBatch(
    input: CreatePlatformEarningBatchInput,
    session: ClientSession,
  ): Promise<PlatformEarningBatch>;

  findBatchById(
    batchId: string,
    session?: ClientSession,
  ): Promise<PlatformEarningBatch | null>;

  listBatches(
    filters: PlatformEarningBatchListFilters,
    session?: ClientSession,
  ): Promise<PlatformEarningBatchListPage>;

  updateDraftBatch(
    input: UpdatePlatformEarningBatchDraftInput,
    session: ClientSession,
  ): Promise<PlatformEarningBatch | null>;

  transitionBatchStatus(
    input: {
      readonly batchId: string;
      readonly fromStatuses: readonly PlatformEarningBatchStatus[];
      readonly toStatus: PlatformEarningBatchStatus;
      readonly submittedByActorId?: string | null;
      readonly submittedAt?: number | null;
      readonly reviewedByActorId?: string | null;
      readonly reviewedAt?: number | null;
      readonly rejectedByActorId?: string | null;
      readonly rejectedAt?: number | null;
      readonly rejectionReason?: string | null;
      readonly voidedByActorId?: string | null;
      readonly voidedAt?: number | null;
      readonly voidReason?: string | null;
      readonly archivedByActorId?: string | null;
      readonly archivedAt?: number | null;
      readonly updatedAt: number;
    },
    session: ClientSession,
  ): Promise<PlatformEarningBatch | null>;

  approveBatch(
    input: ApprovePlatformEarningBatchInput,
    session: ClientSession,
  ): Promise<PlatformEarningBatch | null>;

  markRevenueEntryCreated(
    input: {
      readonly batchId: string;
      readonly revenueEntryId: string;
      readonly revenueEntryCreatedByActorId: string;
      readonly revenueEntryCreatedAt: number;
      readonly updatedAt: number;
    },
    session: ClientSession,
  ): Promise<PlatformEarningBatch | null>;

  insertLine(
    line: PlatformEarningLine,
    session: ClientSession,
  ): Promise<PlatformEarningLine>;

  findLineById(
    lineId: string,
    session?: ClientSession,
  ): Promise<PlatformEarningLine | null>;

  findLineByDuplicateDetectionKey(
    duplicateDetectionKey: string,
    session?: ClientSession,
  ): Promise<PlatformEarningLine | null>;

  updateDraftLine(
    input: UpdatePlatformEarningLineInput,
    session: ClientSession,
  ): Promise<PlatformEarningLine | null>;

  listLines(
    filters: PlatformEarningLineListFilters,
    session?: ClientSession,
  ): Promise<PlatformEarningLineListPage>;

  findLinesByBatchId(
    batchId: string,
    session?: ClientSession,
  ): Promise<readonly PlatformEarningLine[]>;
}
