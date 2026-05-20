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

export interface RevenueEntry {
  readonly id: string;
  readonly revenueEntryCode: string;
  readonly title: string;
  readonly normalizedTitle: string;
  readonly subjectTalentId: string;
  readonly attributionPlatformAccountId: string | null;
  readonly attributionEventId: string | null;
  readonly revenueKind: RevenueKind;
  readonly entrySource: RevenueEntrySource;
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
  readonly attributionEventId: string | null;
  readonly subjectTalentRef?: ReferenceSummary | null;
  readonly attributionPlatformAccountRef?: ReferenceSummary | null;
  readonly attributionEventRef?: ReferenceSummary | null;
  readonly revenueKind: RevenueKind;
  readonly entrySource: RevenueEntrySource;
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
  readonly attributionEventId: string | null;
  readonly subjectTalentRef?: ReferenceSummary | null;
  readonly attributionPlatformAccountRef?: ReferenceSummary | null;
  readonly attributionEventRef?: ReferenceSummary | null;
  readonly revenueKind: RevenueKind;
  readonly entrySource: RevenueEntrySource;
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
