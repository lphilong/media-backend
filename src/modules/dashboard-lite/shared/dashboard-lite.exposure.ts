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
  DashboardLiteWindowsView,
} from "@modules/dashboard-lite/domain/dashboard-lite.types";

const DASHBOARD_LITE_SNAPSHOT_FIELDS = [
  "generatedAt",
  "businessDate",
  "windows",
  "overview",
  "operations",
  "commercial",
  "attention",
] as const;

const DASHBOARD_LITE_WINDOWS_FIELDS = [
  "businessTimeZone",
  "today",
  "next7Days",
  "trailing30Days",
  "staleDrafts",
  "contractExpiry30Days",
] as const;

const DASHBOARD_LITE_TIMESTAMP_WINDOW_FIELDS = [
  "startAtInclusive",
  "endAtExclusive",
] as const;

const DASHBOARD_LITE_STALE_DRAFTS_FIELDS = [
  "olderThanAtExclusive",
] as const;

const DASHBOARD_LITE_CONTRACT_EXPIRY_FIELDS = [
  "startDateInclusive",
  "endDateInclusive",
] as const;

const DASHBOARD_LITE_OVERVIEW_FIELDS = [
  "todayEventCount",
  "draftRevenueEntryCount",
  "draftSettlementCount",
  "activeCommissionRuleCount",
  "expiringContractCount30d",
] as const;

const DASHBOARD_LITE_OPERATIONS_FIELDS = [
  "todayEventCount",
  "next7DayEventCount",
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
            windows: exposeWindows(input.windows),
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

function exposeWindows(
  input: DashboardLiteWindowsView,
): PlainObject {
  return toPlainObject(
    ExposurePolicy.expose(
      {
        businessTimeZone: input.businessTimeZone,
        today: exposeTimestampWindow(input.today),
        next7Days: exposeTimestampWindow(
          input.next7Days,
        ),
        trailing30Days: exposeTimestampWindow(
          input.trailing30Days,
        ),
        staleDrafts: toPlainObject(
          ExposurePolicy.expose(
            {
              olderThanAtExclusive:
                input.staleDrafts.olderThanAtExclusive,
            },
            DASHBOARD_LITE_STALE_DRAFTS_FIELDS,
          ),
          "DashboardLiteStaleDraftsWindow exposure",
        ),
        contractExpiry30Days: toPlainObject(
          ExposurePolicy.expose(
            {
              startDateInclusive:
                input.contractExpiry30Days
                  .startDateInclusive,
              endDateInclusive:
                input.contractExpiry30Days
                  .endDateInclusive,
            },
            DASHBOARD_LITE_CONTRACT_EXPIRY_FIELDS,
          ),
          "DashboardLiteContractExpiryWindow exposure",
        ),
      },
      DASHBOARD_LITE_WINDOWS_FIELDS,
    ),
    "DashboardLiteWindows exposure",
  );
}

function exposeTimestampWindow(input: {
  readonly startAtInclusive: number;
  readonly endAtExclusive: number;
}): PlainObject {
  return toPlainObject(
    ExposurePolicy.expose(
      {
        startAtInclusive: input.startAtInclusive,
        endAtExclusive: input.endAtExclusive,
      },
      DASHBOARD_LITE_TIMESTAMP_WINDOW_FIELDS,
    ),
    "DashboardLiteTimestampWindow exposure",
  );
}

function exposeOverview(
  input: DashboardLiteOverviewView,
): PlainObject {
  return toPlainObject(
    ExposurePolicy.expose(
      {
        todayEventCount: input.todayEventCount,
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
