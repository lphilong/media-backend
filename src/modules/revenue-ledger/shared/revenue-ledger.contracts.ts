import {
  RevenueEntryByEventListItemView,
  RevenueEntryByPlatformListItemView,
  RevenueEntryByTalentListItemView,
  RevenueEntryDetailView,
  RevenueEntryListItemView,
  RevenueEntryMutationView,
  RevenueEntrySortDirection,
  RevenueEntrySortField,
  RevenueEntrySource,
  RevenueEntryStatus,
  RevenueKind,
} from "@modules/revenue-ledger/domain/revenue-ledger.types";

export interface CreateRevenueEntryCommand {
  readonly revenueEntryCode?: string | null;
  readonly title: string;
  readonly subjectTalentId: string;
  readonly attributionPlatformAccountId?: string | null;
  readonly attributionEventId?: string | null;
  readonly revenueKind: RevenueKind | string;
  readonly entrySource: RevenueEntrySource | string;
  readonly currencyCode: string;
  readonly recognizedAmount: number;
  readonly recognizedAt: number;
  readonly description?: string | null;
  readonly externalRef?: string | null;
}

export interface UpdateRevenueEntryDraftCoreCommand {
  readonly revenueEntryId: string;
  readonly title?: string;
  readonly description?: string | null;
  readonly externalRef?: string | null;
  readonly subjectTalentId?: string;
  readonly attributionPlatformAccountId?: string | null;
  readonly attributionEventId?: string | null;
  readonly revenueKind?: RevenueKind | string;
  readonly currencyCode?: string;
  readonly recognizedAmount?: number;
  readonly recognizedAt?: number;
}

export interface FinalizeRevenueEntryCommand {
  readonly revenueEntryId: string;
}

export interface ReconcileRevenueEntryCommand {
  readonly revenueEntryId: string;
  readonly reconciliationReference?: string | null;
}

export interface VoidRevenueEntryCommand {
  readonly revenueEntryId: string;
}

export interface ArchiveRevenueEntryCommand {
  readonly revenueEntryId: string;
}

export interface GetRevenueEntryDetailQuery {
  readonly revenueEntryId: string;
}

export interface ListRevenueEntriesQuery {
  readonly status?: RevenueEntryStatus | string;
  readonly subjectTalentId?: string;
  readonly attributionPlatformAccountId?: string;
  readonly attributionEventId?: string;
  readonly revenueKind?: RevenueKind | string;
  readonly entrySource?: RevenueEntrySource | string;
  readonly currencyCode?: string;
  readonly windowStartAt?: number | string;
  readonly windowEndAt?: number | string;
  readonly createdBeforeAt?: number | string;
  readonly finalizedFromAt?: number | string;
  readonly finalizedToAt?: number | string;
  readonly reconciledFromAt?: number | string;
  readonly reconciledToAt?: number | string;
  readonly limit?: number | string;
  readonly cursor?: string;
  readonly search?: string;
  readonly sortBy?: RevenueEntrySortField | string;
  readonly sortDirection?:
    | RevenueEntrySortDirection
    | string;
}

export interface ListRevenueEntriesByTalentQuery {
  readonly subjectTalentId: string;
  readonly status?: RevenueEntryStatus | string;
  readonly windowStartAt?: number | string;
  readonly windowEndAt?: number | string;
  readonly limit?: number | string;
  readonly cursor?: string;
  readonly sortBy?: RevenueEntrySortField | string;
  readonly sortDirection?:
    | RevenueEntrySortDirection
    | string;
}

export interface ListRevenueEntriesByPlatformQuery {
  readonly attributionPlatformAccountId: string;
  readonly status?: RevenueEntryStatus | string;
  readonly windowStartAt?: number | string;
  readonly windowEndAt?: number | string;
  readonly limit?: number | string;
  readonly cursor?: string;
  readonly sortBy?: RevenueEntrySortField | string;
  readonly sortDirection?:
    | RevenueEntrySortDirection
    | string;
}

export interface ListRevenueEntriesByEventQuery {
  readonly attributionEventId: string;
  readonly status?: RevenueEntryStatus | string;
  readonly windowStartAt?: number | string;
  readonly windowEndAt?: number | string;
  readonly limit?: number | string;
  readonly cursor?: string;
  readonly sortBy?: RevenueEntrySortField | string;
  readonly sortDirection?:
    | RevenueEntrySortDirection
    | string;
}

export type RevenueEntryMutationResult =
  RevenueEntryMutationView;

export type GetRevenueEntryDetailResult =
  RevenueEntryDetailView;

export interface ListRevenueEntriesResult {
  readonly items: readonly RevenueEntryListItemView[];
  readonly nextCursor?: string;
}

export interface ListRevenueEntriesByTalentResult {
  readonly items: readonly RevenueEntryByTalentListItemView[];
  readonly nextCursor?: string;
}

export interface ListRevenueEntriesByPlatformResult {
  readonly items: readonly RevenueEntryByPlatformListItemView[];
  readonly nextCursor?: string;
}

export interface ListRevenueEntriesByEventResult {
  readonly items: readonly RevenueEntryByEventListItemView[];
  readonly nextCursor?: string;
}
