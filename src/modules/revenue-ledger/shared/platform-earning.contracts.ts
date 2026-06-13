import {
  PlatformEarningBatch,
  PlatformEarningLine,
} from "@modules/revenue-ledger/domain/platform-earning.repository";
import {
  PlatformEarningBatchStatus,
  PlatformEarningSourceType,
} from "@modules/revenue-ledger/domain/revenue-ledger.types";
import { RevenueEntryMutationResult } from "./revenue-ledger.contracts";

export interface CreatePlatformEarningBatchCommand {
  readonly batchCode?: string | null;
  readonly platform: string;
  readonly platformAccountId: string;
  readonly talentGroupId?: string | null;
  readonly sourceType: PlatformEarningSourceType | string;
  readonly periodMonth: string;
  readonly sourceDateFrom: number;
  readonly sourceDateTo: number;
}

export interface UpdatePlatformEarningBatchCommand {
  readonly batchId: string;
  readonly platformAccountId?: string;
  readonly talentGroupId?: string | null;
  readonly sourceDateFrom?: number;
  readonly sourceDateTo?: number;
}

export interface UpsertPlatformEarningLineCommand {
  readonly batchId: string;
  readonly lineId?: string;
  readonly sourceDate: number;
  readonly memberTalentId?: string | null;
  readonly memberEmploymentProfileId?: string | null;
  readonly eventId?: string | null;
  readonly rawQuantity: number;
  readonly externalSourceRef?: string | null;
  readonly notes?: string | null;
  readonly correctionOfLineId?: string | null;
}

export interface UpdatePlatformEarningLineCommand {
  readonly batchId: string;
  readonly lineId: string;
  readonly sourceDate?: number;
  readonly memberTalentId?: string | null;
  readonly memberEmploymentProfileId?: string | null;
  readonly eventId?: string | null;
  readonly rawQuantity?: number;
  readonly externalSourceRef?: string | null;
  readonly notes?: string | null;
}

export interface RejectPlatformEarningBatchCommand {
  readonly batchId: string;
  readonly reason: string;
}

export interface VoidPlatformEarningBatchCommand {
  readonly batchId: string;
  readonly reason: string;
}

export interface ApprovePlatformEarningBatchCommand {
  readonly batchId: string;
  readonly targetCurrency: string;
  readonly appliedRate: number;
  readonly rateType?: string | null;
  readonly rateEffectiveFrom?: number | null;
  readonly rateEffectiveTo?: number | null;
  readonly platformCutRate: number;
  readonly companyShareRate?: number | null;
  readonly conversionRuleRef?: string | null;
  readonly platformCutRuleRef?: string | null;
  readonly sourceNote?: string | null;
}

export interface PlatformEarningBatchLifecycleCommand {
  readonly batchId: string;
}

export interface CreateRevenueEntryFromPlatformEarningBatchCommand {
  readonly batchId: string;
  readonly revenueEntryCode?: string | null;
  readonly title?: string | null;
  readonly subjectTalentId?: string | null;
  readonly recognizedAt?: number | null;
  readonly description?: string | null;
  readonly externalRef?: string | null;
}

export interface ListPlatformEarningBatchesQuery {
  readonly status?: PlatformEarningBatchStatus | string;
  readonly platform?: string;
  readonly platformAccountId?: string;
  readonly talentGroupId?: string;
  readonly sourceType?: PlatformEarningSourceType | string;
  readonly periodMonth?: string;
  readonly createdBeforeAt?: number | string;
  readonly limit?: number | string;
  readonly cursor?: string;
}

export interface ListPlatformEarningLinesQuery {
  readonly batchId?: string;
  readonly status?: PlatformEarningBatchStatus | string;
  readonly platform?: string;
  readonly platformAccountId?: string;
  readonly talentGroupId?: string;
  readonly memberTalentId?: string;
  readonly periodMonth?: string;
  readonly limit?: number | string;
  readonly cursor?: string;
}

export interface GetPlatformEarningBatchQuery {
  readonly batchId: string;
}

export type PlatformEarningBatchMutationResult =
  PlatformEarningBatch;

export type PlatformEarningLineMutationResult =
  PlatformEarningLine;

export interface ListPlatformEarningBatchesResult {
  readonly items: readonly PlatformEarningBatch[];
  readonly nextCursor?: string;
}

export interface ListPlatformEarningLinesResult {
  readonly items: readonly PlatformEarningLine[];
  readonly nextCursor?: string;
}

export type CreateRevenueEntryFromPlatformEarningBatchResult =
  RevenueEntryMutationResult;
