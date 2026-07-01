import { Db } from "mongodb";

export const DASHBOARD_LITE_CONTRACT_ACTIVE_EFFECTIVE_END_DATE_INDEX_NAME =
  "idx_dashboard_lite_contract_active_effective_end_date";

export const DASHBOARD_LITE_REVENUE_DRAFT_CREATED_AT_INDEX_NAME =
  "idx_dashboard_lite_revenue_draft_created_at";
export const DASHBOARD_LITE_REVENUE_FINALIZED_FINALIZED_AT_INDEX_NAME =
  "idx_dashboard_lite_revenue_finalized_finalized_at";
export const DASHBOARD_LITE_REVENUE_RECONCILED_RECONCILED_AT_INDEX_NAME =
  "idx_dashboard_lite_revenue_reconciled_reconciled_at";

export const DASHBOARD_LITE_SETTLEMENT_DRAFT_CREATED_AT_INDEX_NAME =
  "idx_dashboard_lite_settlement_draft_created_at";
export const DASHBOARD_LITE_SETTLEMENT_FINALIZED_FINALIZED_AT_INDEX_NAME =
  "idx_dashboard_lite_settlement_finalized_finalized_at";

export async function initDashboardLiteSupportIndexes(
  db: Db,
): Promise<void> {
  const contractRecords = db.collection(
    "contract_records",
  );
  await contractRecords.createIndex(
    {
      effectiveEndDate: 1,
    },
    {
      name:
        DASHBOARD_LITE_CONTRACT_ACTIVE_EFFECTIVE_END_DATE_INDEX_NAME,
      partialFilterExpression: {
        status: "ACTIVE",
        effectiveEndDate: {
          $type: "number",
        },
      },
    },
  );

  const revenueEntries = db.collection(
    "revenue_entries",
  );
  await revenueEntries.createIndex(
    {
      createdAt: 1,
    },
    {
      name:
        DASHBOARD_LITE_REVENUE_DRAFT_CREATED_AT_INDEX_NAME,
      partialFilterExpression: {
        status: "DRAFT",
      },
    },
  );
  await revenueEntries.createIndex(
    {
      finalizedAt: 1,
    },
    {
      name:
        DASHBOARD_LITE_REVENUE_FINALIZED_FINALIZED_AT_INDEX_NAME,
      partialFilterExpression: {
        status: "FINALIZED",
        finalizedAt: {
          $type: "number",
        },
      },
    },
  );
  await revenueEntries.createIndex(
    {
      reconciledAt: 1,
    },
    {
      name:
        DASHBOARD_LITE_REVENUE_RECONCILED_RECONCILED_AT_INDEX_NAME,
      partialFilterExpression: {
        status: "RECONCILED",
        reconciledAt: {
          $type: "number",
        },
      },
    },
  );

  const commissionSettlements = db.collection(
    "commission_settlements",
  );
  await commissionSettlements.createIndex(
    {
      createdAt: 1,
    },
    {
      name:
        DASHBOARD_LITE_SETTLEMENT_DRAFT_CREATED_AT_INDEX_NAME,
      partialFilterExpression: {
        status: "DRAFT",
      },
    },
  );
  await commissionSettlements.createIndex(
    {
      finalizedAt: 1,
    },
    {
      name:
        DASHBOARD_LITE_SETTLEMENT_FINALIZED_FINALIZED_AT_INDEX_NAME,
      partialFilterExpression: {
        status: "FINALIZED",
        finalizedAt: {
          $type: "number",
        },
      },
    },
  );
}
