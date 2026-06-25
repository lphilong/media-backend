import {
  RevenueEntryByEventListItemView,
  RevenueEntryByPlatformListItemView,
  RevenueEntryByTalentListItemView,
  RevenueEntryDetailView,
  RevenueEntryListItemView,
  RevenueEntrySortDirection,
  RevenueEntrySortField,
  RevenueEntrySource,
  RevenueEntryStatus,
  RevenueKind,
} from "@modules/revenue-ledger/domain/revenue-ledger.types";

export interface RevenueEntryListReadInput {
  readonly status?: RevenueEntryStatus;
  readonly subjectTalentId?: string;
  readonly attributionPlatformAccountId?: string;
  readonly attributionEventId?: string;
  readonly revenueKind?: RevenueKind;
  readonly entrySource?: RevenueEntrySource;
  readonly currencyCode?: string;
  readonly financePeriod?: string;
  readonly financePeriodStartAt?: number;
  readonly financePeriodEndAt?: number;
  readonly windowStartAt?: number;
  readonly windowEndAt?: number;
  readonly createdBeforeAt?: number;
  readonly finalizedFromAt?: number;
  readonly finalizedToAt?: number;
  readonly reconciledFromAt?: number;
  readonly reconciledToAt?: number;
  readonly limit: number;
  readonly cursor?: string;
  readonly search?: string;
  readonly sortField?: RevenueEntrySortField;
  readonly sortDirection?: RevenueEntrySortDirection;
}

export interface RevenueEntryByTalentListReadInput {
  readonly subjectTalentId: string;
  readonly status?: RevenueEntryStatus;
  readonly financePeriod?: string;
  readonly financePeriodStartAt?: number;
  readonly financePeriodEndAt?: number;
  readonly windowStartAt?: number;
  readonly windowEndAt?: number;
  readonly limit: number;
  readonly cursor?: string;
  readonly sortField?: RevenueEntrySortField;
  readonly sortDirection?: RevenueEntrySortDirection;
}

export interface RevenueEntryByPlatformListReadInput {
  readonly attributionPlatformAccountId: string;
  readonly status?: RevenueEntryStatus;
  readonly financePeriod?: string;
  readonly financePeriodStartAt?: number;
  readonly financePeriodEndAt?: number;
  readonly windowStartAt?: number;
  readonly windowEndAt?: number;
  readonly limit: number;
  readonly cursor?: string;
  readonly sortField?: RevenueEntrySortField;
  readonly sortDirection?: RevenueEntrySortDirection;
}

export interface RevenueEntryByEventListReadInput {
  readonly attributionEventId: string;
  readonly status?: RevenueEntryStatus;
  readonly financePeriod?: string;
  readonly financePeriodStartAt?: number;
  readonly financePeriodEndAt?: number;
  readonly windowStartAt?: number;
  readonly windowEndAt?: number;
  readonly limit: number;
  readonly cursor?: string;
  readonly sortField?: RevenueEntrySortField;
  readonly sortDirection?: RevenueEntrySortDirection;
}

export interface RevenueEntryListReadResult {
  readonly items: readonly RevenueEntryListItemView[];
  readonly nextCursor?: string;
}

export interface RevenueEntryByTalentListReadResult {
  readonly items: readonly RevenueEntryByTalentListItemView[];
  readonly nextCursor?: string;
}

export interface RevenueEntryByPlatformListReadResult {
  readonly items: readonly RevenueEntryByPlatformListItemView[];
  readonly nextCursor?: string;
}

export interface RevenueEntryByEventListReadResult {
  readonly items: readonly RevenueEntryByEventListItemView[];
  readonly nextCursor?: string;
}

export interface RevenueLedgerReadRepository {
  listRevenueEntries(
    input: RevenueEntryListReadInput,
  ): Promise<RevenueEntryListReadResult>;

  listRevenueEntriesByTalent(
    input: RevenueEntryByTalentListReadInput,
  ): Promise<RevenueEntryByTalentListReadResult>;

  listRevenueEntriesByPlatform(
    input: RevenueEntryByPlatformListReadInput,
  ): Promise<RevenueEntryByPlatformListReadResult>;

  listRevenueEntriesByEvent(
    input: RevenueEntryByEventListReadInput,
  ): Promise<RevenueEntryByEventListReadResult>;

  getRevenueEntryDetail(
    revenueEntryId: string,
  ): Promise<RevenueEntryDetailView | null>;
}
