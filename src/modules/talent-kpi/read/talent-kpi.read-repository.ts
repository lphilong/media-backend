import {
  TalentKpiByEventListItemView,
  TalentKpiByPlatformListItemView,
  TalentKpiByTalentListItemView,
  TalentKpiMeasurementSource,
  TalentKpiMetricCode,
  TalentKpiMetricValueListItemView,
  TalentKpiRecordDetailView,
  TalentKpiRecordListItemView,
  TalentKpiRecordStatus,
  TalentKpiSortDirection,
  TalentKpiSortField,
} from "@modules/talent-kpi/domain/talent-kpi.types";

export interface TalentKpiRecordListReadInput {
  readonly status?: TalentKpiRecordStatus;
  readonly subjectTalentId?: string;
  readonly attributionPlatformAccountId?: string;
  readonly attributionEventId?: string;
  readonly measurementSource?: TalentKpiMeasurementSource;
  readonly containsMetricCode?: TalentKpiMetricCode;
  readonly windowStartAt?: number;
  readonly windowEndAt?: number;
  readonly limit: number;
  readonly cursor?: string;
  readonly search?: string;
  readonly sortField?: TalentKpiSortField;
  readonly sortDirection?: TalentKpiSortDirection;
}

export interface TalentKpiByTalentListReadInput {
  readonly subjectTalentId: string;
  readonly status?: TalentKpiRecordStatus;
  readonly windowStartAt?: number;
  readonly windowEndAt?: number;
  readonly limit: number;
  readonly cursor?: string;
  readonly sortField?: TalentKpiSortField;
  readonly sortDirection?: TalentKpiSortDirection;
}

export interface TalentKpiByPlatformListReadInput {
  readonly attributionPlatformAccountId: string;
  readonly status?: TalentKpiRecordStatus;
  readonly windowStartAt?: number;
  readonly windowEndAt?: number;
  readonly limit: number;
  readonly cursor?: string;
  readonly sortField?: TalentKpiSortField;
  readonly sortDirection?: TalentKpiSortDirection;
}

export interface TalentKpiByEventListReadInput {
  readonly attributionEventId: string;
  readonly status?: TalentKpiRecordStatus;
  readonly windowStartAt?: number;
  readonly windowEndAt?: number;
  readonly limit: number;
  readonly cursor?: string;
  readonly sortField?: TalentKpiSortField;
  readonly sortDirection?: TalentKpiSortDirection;
}

export interface TalentKpiRecordListReadResult {
  readonly items: readonly TalentKpiRecordListItemView[];
  readonly nextCursor?: string;
}

export interface TalentKpiByTalentListReadResult {
  readonly items: readonly TalentKpiByTalentListItemView[];
  readonly nextCursor?: string;
}

export interface TalentKpiByPlatformListReadResult {
  readonly items: readonly TalentKpiByPlatformListItemView[];
  readonly nextCursor?: string;
}

export interface TalentKpiByEventListReadResult {
  readonly items: readonly TalentKpiByEventListItemView[];
  readonly nextCursor?: string;
}

export interface TalentKpiReadRepository {
  listTalentKpiRecords(
    input: TalentKpiRecordListReadInput,
  ): Promise<TalentKpiRecordListReadResult>;

  listTalentKpiRecordsByTalent(
    input: TalentKpiByTalentListReadInput,
  ): Promise<TalentKpiByTalentListReadResult>;

  listTalentKpiRecordsByPlatform(
    input: TalentKpiByPlatformListReadInput,
  ): Promise<TalentKpiByPlatformListReadResult>;

  listTalentKpiRecordsByEvent(
    input: TalentKpiByEventListReadInput,
  ): Promise<TalentKpiByEventListReadResult>;

  listMetricValuesForRecord(
    talentKpiRecordId: string,
  ): Promise<
    readonly TalentKpiMetricValueListItemView[]
  >;

  getTalentKpiRecordDetail(
    talentKpiRecordId: string,
  ): Promise<TalentKpiRecordDetailView | null>;
}
