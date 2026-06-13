import { ReferenceSummary } from "@modules/reference-summary";

export const REVENUE_ENTRY_KINDS = [
  "PLATFORM_LIVESTREAM",
  "PLATFORM_CONTENT",
  "EVENT_OPERATIONAL",
] as const;

export type RevenueKind =
  (typeof REVENUE_ENTRY_KINDS)[number];

export const REVENUE_ENTRY_SOURCES = [
  "MANUAL",
  "PLATFORM_EARNING_BATCH",
] as const;

export type RevenueEntrySource =
  (typeof REVENUE_ENTRY_SOURCES)[number];

export const REVENUE_ENTRY_STATUSES = [
  "DRAFT",
  "FINALIZED",
  "RECONCILED",
  "VOIDED",
  "ARCHIVED",
] as const;

export type RevenueEntryStatus =
  (typeof REVENUE_ENTRY_STATUSES)[number];

export const REVENUE_ENTRY_SORT_FIELDS = [
  "recognizedAt",
  "revenueEntryCode",
  "createdAt",
] as const;

export type RevenueEntrySortField =
  (typeof REVENUE_ENTRY_SORT_FIELDS)[number];

export const REVENUE_ENTRY_SORT_DIRECTIONS = [
  "ASC",
  "DESC",
] as const;

export type RevenueEntrySortDirection =
  (typeof REVENUE_ENTRY_SORT_DIRECTIONS)[number];

export const REVENUE_LEDGER_SCOPES = [
  "global",
] as const;

export type RevenueLedgerScope =
  (typeof REVENUE_LEDGER_SCOPES)[number];

export const PLATFORM_EARNING_BATCH_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "UNDER_REVIEW",
  "APPROVED",
  "REJECTED",
  "VOIDED",
  "ARCHIVED",
] as const;

export type PlatformEarningBatchStatus =
  (typeof PLATFORM_EARNING_BATCH_STATUSES)[number];

export const PLATFORM_EARNING_SOURCE_UNITS = [
  "DIAMOND",
] as const;

export type PlatformEarningSourceUnit =
  (typeof PLATFORM_EARNING_SOURCE_UNITS)[number];

export const PLATFORM_EARNING_SOURCE_TYPES = [
  "TIKTOK_LIVESTREAM_DIAMOND",
] as const;

export type PlatformEarningSourceType =
  (typeof PLATFORM_EARNING_SOURCE_TYPES)[number];

export interface RevenueSourceSummarySnapshot {
  readonly sourceKind: RevenueEntrySource;
  readonly sourceType: PlatformEarningSourceType | string;
  readonly sourceBatchIds: readonly string[];
  readonly sourceSummaryRef: string;
  readonly sourceLineCount: number;
  readonly periodMonth: string;
  readonly sourceDateFrom: number;
  readonly sourceDateTo: number;
  readonly platform: string;
  readonly platformAccountId: string;
  readonly talentGroupId: string | null;
  readonly memberTalentIds: readonly string[];
  readonly memberEmploymentProfileIds: readonly string[];
  readonly eventIds: readonly string[];
  readonly sourceUnit: PlatformEarningSourceUnit | string;
  readonly rawQuantityTotal: number;
  readonly sourceFingerprint: string | null;
  readonly approvedAt: number;
  readonly approvedByActorId: string;
}

export interface RevenueConversionSnapshot {
  readonly sourceUnit: PlatformEarningSourceUnit | string;
  readonly rawQuantity: number;
  readonly targetCurrency: string;
  readonly appliedRate: number;
  readonly rateType: string;
  readonly rateEffectiveFrom: number | null;
  readonly rateEffectiveTo: number | null;
  readonly grossConvertedAmount: number;
  readonly ruleRef: string | null;
  readonly appliedByActorId: string;
  readonly appliedAt: number;
  readonly sourceNote: string | null;
}

export interface RevenuePlatformCutSnapshot {
  readonly platformCutRate: number;
  readonly companyShareRate: number;
  readonly grossConvertedAmount: number;
  readonly platformCutAmount: number;
  readonly companyNetAmount: number;
  readonly targetCurrency: string;
  readonly ruleRef: string | null;
  readonly appliedByActorId: string;
  readonly appliedAt: number;
  readonly sourceNote: string | null;
}

export interface RevenueCommissionableBasisSnapshot {
  readonly basisType: "COMPANY_NET";
  readonly amount: number;
  readonly currencyCode: string;
  readonly appliedByActorId: string;
  readonly appliedAt: number;
  readonly sourceNote: string | null;
}

export interface RevenueEntry {
  readonly id: string;
  readonly revenueEntryCode: string;
  readonly title: string;
  readonly normalizedTitle: string;
  readonly subjectTalentId: string;
  readonly attributionPlatformAccountId: string | null;
  readonly attributionTalentGroupId: string | null;
  readonly attributionEmploymentProfileId: string | null;
  readonly attributionEventId: string | null;
  readonly revenueKind: RevenueKind;
  readonly entrySource: RevenueEntrySource;
  readonly sourceBatchIds: readonly string[];
  readonly sourceSummaryRef: string | null;
  readonly sourceLineCount: number | null;
  readonly sourceSummarySnapshot: RevenueSourceSummarySnapshot | null;
  readonly conversionSnapshot: RevenueConversionSnapshot | null;
  readonly platformCutSnapshot: RevenuePlatformCutSnapshot | null;
  readonly commissionableBasisSnapshot: RevenueCommissionableBasisSnapshot | null;
  readonly status: RevenueEntryStatus;
  readonly currencyCode: string;
  readonly recognizedAmount: number;
  readonly recognizedAt: number;
  readonly finalizedAt: number | null;
  readonly reconciledAt: number | null;
  readonly voidedAt: number | null;
  readonly reconciliationReference: string | null;
  readonly description: string | null;
  readonly externalRef: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface RevenueEntryDetailView {
  readonly id: string;
  readonly revenueEntryCode: string;
  readonly title: string;
  readonly subjectTalentId: string;
  readonly attributionPlatformAccountId: string | null;
  readonly attributionTalentGroupId: string | null;
  readonly attributionEmploymentProfileId: string | null;
  readonly attributionEventId: string | null;
  readonly subjectTalentRef?: ReferenceSummary | null;
  readonly attributionPlatformAccountRef?: ReferenceSummary | null;
  readonly attributionEventRef?: ReferenceSummary | null;
  readonly revenueKind: RevenueKind;
  readonly entrySource: RevenueEntrySource;
  readonly sourceBatchIds: readonly string[];
  readonly sourceSummaryRef: string | null;
  readonly sourceLineCount: number | null;
  readonly sourceSummarySnapshot: RevenueSourceSummarySnapshot | null;
  readonly conversionSnapshot: RevenueConversionSnapshot | null;
  readonly platformCutSnapshot: RevenuePlatformCutSnapshot | null;
  readonly commissionableBasisSnapshot: RevenueCommissionableBasisSnapshot | null;
  readonly status: RevenueEntryStatus;
  readonly currencyCode: string;
  readonly recognizedAmount: number;
  readonly recognizedAt: number;
  readonly finalizedAt: number | null;
  readonly reconciledAt: number | null;
  readonly voidedAt: number | null;
  readonly reconciliationReference: string | null;
  readonly description: string | null;
  readonly externalRef: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface RevenueEntryListItemView {
  readonly id: string;
  readonly revenueEntryCode: string;
  readonly title: string;
  readonly subjectTalentId: string;
  readonly attributionPlatformAccountId: string | null;
  readonly attributionTalentGroupId: string | null;
  readonly attributionEmploymentProfileId: string | null;
  readonly attributionEventId: string | null;
  readonly subjectTalentRef?: ReferenceSummary | null;
  readonly attributionPlatformAccountRef?: ReferenceSummary | null;
  readonly attributionEventRef?: ReferenceSummary | null;
  readonly revenueKind: RevenueKind;
  readonly entrySource: RevenueEntrySource;
  readonly sourceBatchIds: readonly string[];
  readonly sourceSummaryRef: string | null;
  readonly sourceLineCount: number | null;
  readonly status: RevenueEntryStatus;
  readonly currencyCode: string;
  readonly recognizedAmount: number;
  readonly recognizedAt: number;
  readonly createdAt: number;
}

export interface RevenueEntryByTalentListItemView {
  readonly id: string;
  readonly revenueEntryCode: string;
  readonly title: string;
  readonly subjectTalentId: string;
  readonly revenueKind: RevenueKind;
  readonly status: RevenueEntryStatus;
  readonly currencyCode: string;
  readonly recognizedAmount: number;
  readonly recognizedAt: number;
}

export interface RevenueEntryByPlatformListItemView {
  readonly id: string;
  readonly revenueEntryCode: string;
  readonly title: string;
  readonly subjectTalentId: string;
  readonly attributionPlatformAccountId: string;
  readonly revenueKind: RevenueKind;
  readonly status: RevenueEntryStatus;
  readonly currencyCode: string;
  readonly recognizedAmount: number;
  readonly recognizedAt: number;
}

export interface RevenueEntryByEventListItemView {
  readonly id: string;
  readonly revenueEntryCode: string;
  readonly title: string;
  readonly subjectTalentId: string;
  readonly attributionEventId: string;
  readonly revenueKind: RevenueKind;
  readonly status: RevenueEntryStatus;
  readonly currencyCode: string;
  readonly recognizedAmount: number;
  readonly recognizedAt: number;
}

export interface RevenueEntryMutationView
  extends RevenueEntryDetailView {}
