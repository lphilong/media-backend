import {
  KpiMetricCode,
  KpiMetricUnit,
  KpiPlanCurrency,
  KpiRollupMethod,
  KpiSubjectType,
} from "./kpi.types";

export interface KpiMetricCatalogEntry {
  readonly code: KpiMetricCode;
  readonly unit: KpiMetricUnit;
  readonly rollupMethod: KpiRollupMethod;
  readonly allowedSubjectTypes: readonly KpiSubjectType[];
  readonly currencyCode?: KpiPlanCurrency;
}

export const KPI_METRIC_CATALOG: Readonly<
  Record<KpiMetricCode, KpiMetricCatalogEntry>
> = Object.freeze({
  REVENUE_VND: {
    code: "REVENUE_VND",
    unit: "VND",
    rollupMethod: "SUM",
    allowedSubjectTypes: ["TALENT", "TALENT_GROUP", "ORG_UNIT"],
    currencyCode: "VND",
  },
  CONTENT_OUTPUT_COUNT: {
    code: "CONTENT_OUTPUT_COUNT",
    unit: "COUNT",
    rollupMethod: "SUM",
    allowedSubjectTypes: ["TALENT", "TALENT_GROUP"],
  },
  LIVE_HOURS: {
    code: "LIVE_HOURS",
    unit: "HOUR",
    rollupMethod: "SUM",
    allowedSubjectTypes: ["TALENT", "TALENT_GROUP"],
  },
  EVENT_COMPLETION_COUNT: {
    code: "EVENT_COMPLETION_COUNT",
    unit: "COUNT",
    rollupMethod: "SUM",
    allowedSubjectTypes: ["TALENT", "TALENT_GROUP"],
  },
  ONBOARDED_TALENT_COUNT: {
    code: "ONBOARDED_TALENT_COUNT",
    unit: "COUNT",
    rollupMethod: "SUM",
    allowedSubjectTypes: ["TALENT_GROUP"],
  },
  TIKTOK_DIAMOND: {
    code: "TIKTOK_DIAMOND",
    unit: "COUNT",
    rollupMethod: "SUM",
    allowedSubjectTypes: ["TALENT_GROUP"],
  },
});

export function getKpiMetricCatalogEntry(
  metricCode: KpiMetricCode,
): KpiMetricCatalogEntry {
  return KPI_METRIC_CATALOG[metricCode];
}
