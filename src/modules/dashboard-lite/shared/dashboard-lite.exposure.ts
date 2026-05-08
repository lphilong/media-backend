import {
  PlainObject,
  toPlainObject,
} from "@app/base/presentation-result.types";
import { ExposurePolicy } from "@core/exposure/exposure.policy";
import {
  DashboardLiteAttentionView,
  DashboardLiteCommercialView,
  DashboardLiteOperationsView,
  DashboardLiteOverviewView,
  DashboardLiteSnapshotView,
} from "@modules/dashboard-lite/domain/dashboard-lite.types";

const DASHBOARD_LITE_SNAPSHOT_FIELDS = [
  "generatedAt",
  "businessDate",
  "overview",
  "operations",
  "commercial",
  "attention",
] as const;

const DASHBOARD_LITE_OVERVIEW_FIELDS = [
  "todayEventCount",
  "draftTalentKpiCount",
  "draftRevenueEntryCount",
  "draftSettlementCount",
  "activeCommissionRuleCount",
  "expiringContractCount30d",
] as const;

const DASHBOARD_LITE_OPERATIONS_FIELDS = [
  "todayEventCount",
  "next7DayEventCount",
  "draftTalentKpiCount",
  "finalizedTalentKpiCount30d",
] as const;

const DASHBOARD_LITE_COMMERCIAL_FIELDS = [
  "draftRevenueEntryCount",
  "finalizedRevenueAmount30d",
  "reconciledRevenueAmount30d",
  "draftSettlementCount",
  "finalizedSettlementAmount30d",
  "activeCommissionRuleCount",
] as const;

const DASHBOARD_LITE_ATTENTION_FIELDS = [
  "staleTalentKpiDraftCount",
  "staleRevenueDraftCount",
  "staleSettlementDraftCount",
  "expiringContractCount30d",
] as const;

export const DashboardLiteAdminSnapshotExposure =
  Object.freeze({
    expose(
      input: DashboardLiteSnapshotView,
    ): PlainObject {
      return toPlainObject(
        ExposurePolicy.expose(
          {
            generatedAt: input.generatedAt,
            businessDate: input.businessDate,
            overview: exposeOverview(input.overview),
            operations: exposeOperations(
              input.operations,
            ),
            commercial: exposeCommercial(
              input.commercial,
            ),
            attention: exposeAttention(input.attention),
          },
          DASHBOARD_LITE_SNAPSHOT_FIELDS,
        ),
        "DashboardLiteAdminSnapshot exposure",
      );
    },
  });

function exposeOverview(
  input: DashboardLiteOverviewView,
): PlainObject {
  return toPlainObject(
    ExposurePolicy.expose(
      {
        todayEventCount: input.todayEventCount,
        draftTalentKpiCount: input.draftTalentKpiCount,
        draftRevenueEntryCount:
          input.draftRevenueEntryCount,
        draftSettlementCount:
          input.draftSettlementCount,
        activeCommissionRuleCount:
          input.activeCommissionRuleCount,
        expiringContractCount30d:
          input.expiringContractCount30d,
      },
      DASHBOARD_LITE_OVERVIEW_FIELDS,
    ),
    "DashboardLiteOverview exposure",
  );
}

function exposeOperations(
  input: DashboardLiteOperationsView,
): PlainObject {
  return toPlainObject(
    ExposurePolicy.expose(
      {
        todayEventCount: input.todayEventCount,
        next7DayEventCount:
          input.next7DayEventCount,
        draftTalentKpiCount: input.draftTalentKpiCount,
        finalizedTalentKpiCount30d:
          input.finalizedTalentKpiCount30d,
      },
      DASHBOARD_LITE_OPERATIONS_FIELDS,
    ),
    "DashboardLiteOperations exposure",
  );
}

function exposeCommercial(
  input: DashboardLiteCommercialView,
): PlainObject {
  return toPlainObject(
    ExposurePolicy.expose(
      {
        draftRevenueEntryCount:
          input.draftRevenueEntryCount,
        finalizedRevenueAmount30d:
          input.finalizedRevenueAmount30d,
        reconciledRevenueAmount30d:
          input.reconciledRevenueAmount30d,
        draftSettlementCount:
          input.draftSettlementCount,
        finalizedSettlementAmount30d:
          input.finalizedSettlementAmount30d,
        activeCommissionRuleCount:
          input.activeCommissionRuleCount,
      },
      DASHBOARD_LITE_COMMERCIAL_FIELDS,
    ),
    "DashboardLiteCommercial exposure",
  );
}

function exposeAttention(
  input: DashboardLiteAttentionView,
): PlainObject {
  return toPlainObject(
    ExposurePolicy.expose(
      {
        staleTalentKpiDraftCount:
          input.staleTalentKpiDraftCount,
        staleRevenueDraftCount:
          input.staleRevenueDraftCount,
        staleSettlementDraftCount:
          input.staleSettlementDraftCount,
        expiringContractCount30d:
          input.expiringContractCount30d,
      },
      DASHBOARD_LITE_ATTENTION_FIELDS,
    ),
    "DashboardLiteAttention exposure",
  );
}
