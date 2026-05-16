import {
  TalentKpiByEventListItemView,
  TalentKpiByPlatformListItemView,
  TalentKpiByTalentListItemView,
  TalentKpiMeasurementSource,
  TalentKpiMetricCode,
  TalentKpiMetricValueListItemView,
  TalentKpiRecordDetailView,
  TalentKpiRecordListItemView,
  TalentKpiRecordMutationView,
  TalentKpiRecordStatus,
  TalentKpiSortDirection,
  TalentKpiSortField,
} from "@modules/talent-kpi/domain/talent-kpi.types";

export interface TalentKpiMetricInput {
  readonly metricCode: TalentKpiMetricCode | string;
  readonly numericValue: number;
}

export interface CreateTalentKpiRecordCommand {
  readonly kpiRecordCode?: string | null;
  readonly title: string;
  readonly subjectTalentId: string;
  readonly attributionPlatformAccountId?: string | null;
  readonly attributionEventId?: string | null;
  readonly measurementSource:
    | TalentKpiMeasurementSource
    | string;
  readonly periodStartAt: number;
  readonly periodEndAt: number;
  readonly metrics: readonly TalentKpiMetricInput[];
  readonly description?: string | null;
  readonly externalRef?: string | null;
}

export interface UpdateTalentKpiDraftCoreCommand {
  readonly talentKpiRecordId: string;
  readonly title?: string;
  readonly subjectTalentId?: string;
  readonly attributionPlatformAccountId?: string | null;
  readonly attributionEventId?: string | null;
  readonly periodStartAt?: number;
  readonly periodEndAt?: number;
  readonly description?: string | null;
  readonly externalRef?: string | null;
}

export interface ReplaceTalentKpiMetricsCommand {
  readonly talentKpiRecordId: string;
  readonly metrics: readonly TalentKpiMetricInput[];
}

export interface FinalizeTalentKpiRecordCommand {
  readonly talentKpiRecordId: string;
}

export interface ArchiveTalentKpiRecordCommand {
  readonly talentKpiRecordId: string;
}

export interface GetTalentKpiRecordDetailQuery {
  readonly talentKpiRecordId: string;
}

export interface ListTalentKpiRecordsQuery {
  readonly status?: TalentKpiRecordStatus | string;
  readonly subjectTalentId?: string;
  readonly attributionPlatformAccountId?: string;
  readonly attributionEventId?: string;
  readonly measurementSource?:
    | TalentKpiMeasurementSource
    | string;
  readonly containsMetricCode?:
    | TalentKpiMetricCode
    | string;
  readonly windowStartAt?: number | string;
  readonly windowEndAt?: number | string;
  readonly limit?: number | string;
  readonly cursor?: string;
  readonly search?: string;
  readonly sortBy?: TalentKpiSortField | string;
  readonly sortDirection?:
    | TalentKpiSortDirection
    | string;
}

export interface ListTalentKpiMetricValuesQuery {
  readonly talentKpiRecordId: string;
}

export interface ListTalentKpiByTalentQuery {
  readonly subjectTalentId: string;
  readonly status?: TalentKpiRecordStatus | string;
  readonly windowStartAt?: number | string;
  readonly windowEndAt?: number | string;
  readonly limit?: number | string;
  readonly cursor?: string;
  readonly sortBy?: TalentKpiSortField | string;
  readonly sortDirection?:
    | TalentKpiSortDirection
    | string;
}

export interface ListTalentKpiByPlatformQuery {
  readonly attributionPlatformAccountId: string;
  readonly status?: TalentKpiRecordStatus | string;
  readonly windowStartAt?: number | string;
  readonly windowEndAt?: number | string;
  readonly limit?: number | string;
  readonly cursor?: string;
  readonly sortBy?: TalentKpiSortField | string;
  readonly sortDirection?:
    | TalentKpiSortDirection
    | string;
}

export interface ListTalentKpiByEventQuery {
  readonly attributionEventId: string;
  readonly status?: TalentKpiRecordStatus | string;
  readonly windowStartAt?: number | string;
  readonly windowEndAt?: number | string;
  readonly limit?: number | string;
  readonly cursor?: string;
  readonly sortBy?: TalentKpiSortField | string;
  readonly sortDirection?:
    | TalentKpiSortDirection
    | string;
}

export type TalentKpiRecordMutationResult =
  TalentKpiRecordMutationView;

export type GetTalentKpiRecordDetailResult =
  TalentKpiRecordDetailView;

export interface ListTalentKpiRecordsResult {
  readonly items: readonly TalentKpiRecordListItemView[];
  readonly nextCursor?: string;
}

export interface ListTalentKpiMetricValuesResult {
  readonly items: readonly TalentKpiMetricValueListItemView[];
}

export interface ListTalentKpiByTalentResult {
  readonly items: readonly TalentKpiByTalentListItemView[];
  readonly nextCursor?: string;
}

export interface ListTalentKpiByPlatformResult {
  readonly items: readonly TalentKpiByPlatformListItemView[];
  readonly nextCursor?: string;
}

export interface ListTalentKpiByEventResult {
  readonly items: readonly TalentKpiByEventListItemView[];
  readonly nextCursor?: string;
}
