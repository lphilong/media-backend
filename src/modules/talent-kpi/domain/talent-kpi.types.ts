export const TALENT_KPI_MEASUREMENT_SOURCES = [
  "MANUAL",
] as const;

export type TalentKpiMeasurementSource =
  (typeof TALENT_KPI_MEASUREMENT_SOURCES)[number];

export const TALENT_KPI_RECORD_STATUSES = [
  "DRAFT",
  "FINALIZED",
  "ARCHIVED",
] as const;

export type TalentKpiRecordStatus =
  (typeof TALENT_KPI_RECORD_STATUSES)[number];

export const TALENT_KPI_METRIC_CODES = [
  "LIVESTREAM_HOURS",
  "LIVESTREAM_SESSION_COUNT",
  "CONTENT_PUBLISH_COUNT",
  "EVENT_APPEARANCE_COUNT",
  "ENGAGEMENT_COUNT",
  "FOLLOWER_DELTA",
  "REVENUE_ATTRIBUTED_AMOUNT",
] as const;

export type TalentKpiMetricCode =
  (typeof TALENT_KPI_METRIC_CODES)[number];

export const TALENT_KPI_SORT_FIELDS = [
  "periodStartAt",
  "kpiRecordCode",
  "createdAt",
] as const;

export type TalentKpiSortField =
  (typeof TALENT_KPI_SORT_FIELDS)[number];

export const TALENT_KPI_SORT_DIRECTIONS = [
  "ASC",
  "DESC",
] as const;

export type TalentKpiSortDirection =
  (typeof TALENT_KPI_SORT_DIRECTIONS)[number];

export const TALENT_KPI_SCOPES = ["global"] as const;

export type TalentKpiScope =
  (typeof TALENT_KPI_SCOPES)[number];

export interface TalentKpiRecord {
  readonly id: string;
  readonly kpiRecordCode: string;
  readonly normalizedKpiRecordCode: string;
  readonly title: string;
  readonly normalizedTitle: string;
  readonly subjectTalentId: string;
  readonly attributionPlatformAccountId: string | null;
  readonly attributionEventId: string | null;
  readonly measurementSource: TalentKpiMeasurementSource;
  readonly status: TalentKpiRecordStatus;
  readonly periodStartAt: number;
  readonly periodEndAt: number;
  readonly publishedAt: number | null;
  readonly description: string | null;
  readonly externalRef: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface TalentKpiMetricValue {
  readonly id: string;
  readonly kpiRecordId: string;
  readonly metricCode: TalentKpiMetricCode;
  readonly numericValue: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface TalentKpiRecordDetailView {
  readonly id: string;
  readonly kpiRecordCode: string;
  readonly title: string;
  readonly subjectTalentId: string;
  readonly attributionPlatformAccountId: string | null;
  readonly attributionEventId: string | null;
  readonly measurementSource: TalentKpiMeasurementSource;
  readonly status: TalentKpiRecordStatus;
  readonly periodStartAt: number;
  readonly periodEndAt: number;
  readonly publishedAt: number | null;
  readonly description: string | null;
  readonly externalRef: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface TalentKpiRecordListItemView {
  readonly id: string;
  readonly kpiRecordCode: string;
  readonly title: string;
  readonly subjectTalentId: string;
  readonly attributionPlatformAccountId: string | null;
  readonly attributionEventId: string | null;
  readonly measurementSource: TalentKpiMeasurementSource;
  readonly status: TalentKpiRecordStatus;
  readonly periodStartAt: number;
  readonly periodEndAt: number;
  readonly publishedAt: number | null;
  readonly createdAt: number;
}

export interface TalentKpiMetricValueListItemView {
  readonly id: string;
  readonly metricCode: TalentKpiMetricCode;
  readonly numericValue: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface TalentKpiByTalentListItemView {
  readonly id: string;
  readonly kpiRecordCode: string;
  readonly title: string;
  readonly subjectTalentId: string;
  readonly status: TalentKpiRecordStatus;
  readonly measurementSource: TalentKpiMeasurementSource;
  readonly periodStartAt: number;
  readonly periodEndAt: number;
  readonly publishedAt: number | null;
}

export interface TalentKpiByPlatformListItemView {
  readonly id: string;
  readonly kpiRecordCode: string;
  readonly title: string;
  readonly subjectTalentId: string;
  readonly attributionPlatformAccountId: string;
  readonly status: TalentKpiRecordStatus;
  readonly periodStartAt: number;
  readonly periodEndAt: number;
}

export interface TalentKpiByEventListItemView {
  readonly id: string;
  readonly kpiRecordCode: string;
  readonly title: string;
  readonly subjectTalentId: string;
  readonly attributionEventId: string;
  readonly status: TalentKpiRecordStatus;
  readonly periodStartAt: number;
  readonly periodEndAt: number;
}

export interface TalentKpiRecordMutationView
  extends TalentKpiRecordDetailView {}
