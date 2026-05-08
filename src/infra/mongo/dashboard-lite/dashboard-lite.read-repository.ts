import {
  Collection,
  Db,
  Document,
} from "mongodb";
import {
  COMMISSION_RULE_STATUS_KIND_EFFECTIVE_WINDOW_INDEX_NAME,
} from "@infra/mongo/commission/commission.index";
import {
  DASHBOARD_LITE_CONTRACT_ACTIVE_EFFECTIVE_END_DATE_INDEX_NAME,
  DASHBOARD_LITE_REVENUE_DRAFT_CREATED_AT_INDEX_NAME,
  DASHBOARD_LITE_REVENUE_FINALIZED_FINALIZED_AT_INDEX_NAME,
  DASHBOARD_LITE_REVENUE_RECONCILED_RECONCILED_AT_INDEX_NAME,
  DASHBOARD_LITE_SETTLEMENT_DRAFT_CREATED_AT_INDEX_NAME,
  DASHBOARD_LITE_SETTLEMENT_FINALIZED_FINALIZED_AT_INDEX_NAME,
  DASHBOARD_LITE_TALENT_KPI_DRAFT_CREATED_AT_INDEX_NAME,
  DASHBOARD_LITE_TALENT_KPI_FINALIZED_PUBLISHED_AT_INDEX_NAME,
} from "@infra/mongo/dashboard-lite/dashboard-lite.index";
import {
  EVENT_STATUS_WINDOW_INDEX_NAME,
} from "@infra/mongo/event-assignment/event-assignment.index";
import { DashboardLiteSnapshotProjection } from "@modules/dashboard-lite/domain/dashboard-lite.types";
import {
  DashboardLiteReadRepository,
  DashboardLiteSnapshotReadInput,
} from "@modules/dashboard-lite/read/dashboard-lite.read-repository";

interface EventReadDocument {
  readonly status: "SCHEDULED" | "IN_PROGRESS";
  readonly eventStartAt: number;
  readonly eventEndAt: number;
}

interface TalentKpiReadDocument {
  readonly status: "DRAFT" | "FINALIZED";
  readonly createdAt: number;
  readonly publishedAt: number | null;
}

interface RevenueEntryReadDocument {
  readonly status:
    | "DRAFT"
    | "FINALIZED"
    | "RECONCILED";
  readonly createdAt: number;
  readonly finalizedAt: number | null;
  readonly reconciledAt: number | null;
  readonly recognizedAmount: number;
}

interface CommissionRuleReadDocument {
  readonly status: "ACTIVE";
}

interface CommissionSettlementReadDocument {
  readonly status: "DRAFT" | "FINALIZED";
  readonly createdAt: number;
  readonly finalizedAt: number | null;
  readonly settlementAmount: number;
}

interface ContractRecordReadDocument {
  readonly status: "ACTIVE";
  readonly effectiveEndDate: number | null;
}

interface CountAggregationDocument {
  readonly _id: null;
  readonly count: number;
}

interface DualCountAggregationDocument {
  readonly _id: null;
  readonly count: number;
  readonly staleCount: number;
}

interface SumAggregationDocument {
  readonly _id: null;
  readonly total: number;
}

const ACTIVE_EVENT_STATUSES = Object.freeze([
  "SCHEDULED",
  "IN_PROGRESS",
] as const);

export class NativeMongoDashboardLiteReadRepository
  implements DashboardLiteReadRepository
{
  private readonly eventsCollection: Collection<EventReadDocument>;
  private readonly talentKpiCollection: Collection<TalentKpiReadDocument>;
  private readonly revenueEntriesCollection: Collection<RevenueEntryReadDocument>;
  private readonly commissionRulesCollection: Collection<CommissionRuleReadDocument>;
  private readonly commissionSettlementsCollection: Collection<CommissionSettlementReadDocument>;
  private readonly contractRecordsCollection: Collection<ContractRecordReadDocument>;

  constructor(db: Db) {
    this.eventsCollection =
      db.collection<EventReadDocument>("events");
    this.talentKpiCollection =
      db.collection<TalentKpiReadDocument>(
        "talent_kpi_records",
      );
    this.revenueEntriesCollection =
      db.collection<RevenueEntryReadDocument>(
        "revenue_entries",
      );
    this.commissionRulesCollection =
      db.collection<CommissionRuleReadDocument>(
        "commission_rules",
      );
    this.commissionSettlementsCollection =
      db.collection<CommissionSettlementReadDocument>(
        "commission_settlements",
      );
    this.contractRecordsCollection =
      db.collection<ContractRecordReadDocument>(
        "contract_records",
      );
  }

  async getDashboardLiteSnapshotProjection(
    input: DashboardLiteSnapshotReadInput,
  ): Promise<DashboardLiteSnapshotProjection> {
    const [
      eventMetrics,
      talentKpiMetrics,
      revenueMetrics,
      commissionMetrics,
      expiringContractCount30d,
    ] = await Promise.all([
      this.readEventMetrics(input),
      this.readTalentKpiMetrics(input),
      this.readRevenueMetrics(input),
      this.readCommissionMetrics(input),
      this.readExpiringContractCount(input),
    ]);

    return {
      todayEventCount: eventMetrics.todayEventCount,
      next7DayEventCount:
        eventMetrics.next7DayEventCount,
      draftTalentKpiCount:
        talentKpiMetrics.draftTalentKpiCount,
      finalizedTalentKpiCount30d:
        talentKpiMetrics.finalizedTalentKpiCount30d,
      staleTalentKpiDraftCount:
        talentKpiMetrics.staleTalentKpiDraftCount,
      draftRevenueEntryCount:
        revenueMetrics.draftRevenueEntryCount,
      finalizedRevenueAmount30d:
        revenueMetrics.finalizedRevenueAmount30d,
      reconciledRevenueAmount30d:
        revenueMetrics.reconciledRevenueAmount30d,
      staleRevenueDraftCount:
        revenueMetrics.staleRevenueDraftCount,
      draftSettlementCount:
        commissionMetrics.draftSettlementCount,
      finalizedSettlementAmount30d:
        commissionMetrics.finalizedSettlementAmount30d,
      activeCommissionRuleCount:
        commissionMetrics.activeCommissionRuleCount,
      staleSettlementDraftCount:
        commissionMetrics.staleSettlementDraftCount,
      expiringContractCount30d,
    };
  }

  private async readEventMetrics(
    input: DashboardLiteSnapshotReadInput,
  ): Promise<{
    readonly todayEventCount: number;
    readonly next7DayEventCount: number;
  }> {
    const baseFilter = {
      status: {
        $in: [...ACTIVE_EVENT_STATUSES],
      },
    };

    const [
      todayEventCount,
      next7DayEventCount,
    ] = await Promise.all([
      this.eventsCollection.countDocuments(
        {
          ...baseFilter,
          eventEndAt: {
            $gt: input.todayWindowStartAt,
          },
          eventStartAt: {
            $lt: input.todayWindowEndAt,
          },
        },
        {
          hint: EVENT_STATUS_WINDOW_INDEX_NAME,
        },
      ),
      this.eventsCollection.countDocuments(
        {
          ...baseFilter,
          eventStartAt: {
            $gte: input.todayWindowStartAt,
            $lt: input.next7DayWindowEndAt,
          },
        },
        {
          hint: EVENT_STATUS_WINDOW_INDEX_NAME,
        },
      ),
    ]);

    return {
      todayEventCount,
      next7DayEventCount,
    };
  }

  private async readTalentKpiMetrics(
    input: DashboardLiteSnapshotReadInput,
  ): Promise<{
    readonly draftTalentKpiCount: number;
    readonly finalizedTalentKpiCount30d: number;
    readonly staleTalentKpiDraftCount: number;
  }> {
    const [
      draftSummary,
      finalizedTalentKpiCount30d,
    ] = await Promise.all([
      this.talentKpiCollection
        .aggregate<DualCountAggregationDocument>(
          [
            {
              $match: {
                status: "DRAFT",
              },
            },
            {
              $group: {
                _id: null,
                count: { $sum: 1 },
                staleCount: {
                  $sum: {
                    $cond: [
                      {
                        $lt: [
                          "$createdAt",
                          input.staleDraftThresholdAt,
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                },
              },
            },
          ],
          {
            hint:
              DASHBOARD_LITE_TALENT_KPI_DRAFT_CREATED_AT_INDEX_NAME,
          },
        )
        .toArray(),
      this.talentKpiCollection.countDocuments(
        {
          status: "FINALIZED",
          publishedAt: {
            $gte: input.trailing30DayWindowStartAt,
            $lt: input.generatedAt,
          },
        },
        {
          hint:
            DASHBOARD_LITE_TALENT_KPI_FINALIZED_PUBLISHED_AT_INDEX_NAME,
        },
      ),
    ]);

    const summary = draftSummary[0];

    return {
      draftTalentKpiCount:
        readNumeric(summary?.count),
      finalizedTalentKpiCount30d,
      staleTalentKpiDraftCount:
        readNumeric(summary?.staleCount),
    };
  }

  private async readRevenueMetrics(
    input: DashboardLiteSnapshotReadInput,
  ): Promise<{
    readonly draftRevenueEntryCount: number;
    readonly staleRevenueDraftCount: number;
    readonly finalizedRevenueAmount30d: number;
    readonly reconciledRevenueAmount30d: number;
  }> {
    const [
      draftSummary,
      finalizedRevenueAmount30d,
      reconciledRevenueAmount30d,
    ] = await Promise.all([
      this.revenueEntriesCollection
        .aggregate<DualCountAggregationDocument>(
          [
            {
              $match: {
                status: "DRAFT",
              },
            },
            {
              $group: {
                _id: null,
                count: { $sum: 1 },
                staleCount: {
                  $sum: {
                    $cond: [
                      {
                        $lt: [
                          "$createdAt",
                          input.staleDraftThresholdAt,
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                },
              },
            },
          ],
          {
            hint:
              DASHBOARD_LITE_REVENUE_DRAFT_CREATED_AT_INDEX_NAME,
          },
        )
        .toArray(),
      this.readSummedAmount({
        collection: this.revenueEntriesCollection,
        match: {
          status: "FINALIZED",
          finalizedAt: {
            $gte: input.trailing30DayWindowStartAt,
            $lt: input.generatedAt,
          },
        },
        amountField: "recognizedAmount",
        hint:
          DASHBOARD_LITE_REVENUE_FINALIZED_FINALIZED_AT_INDEX_NAME,
      }),
      this.readSummedAmount({
        collection: this.revenueEntriesCollection,
        match: {
          status: "RECONCILED",
          reconciledAt: {
            $gte: input.trailing30DayWindowStartAt,
            $lt: input.generatedAt,
          },
        },
        amountField: "recognizedAmount",
        hint:
          DASHBOARD_LITE_REVENUE_RECONCILED_RECONCILED_AT_INDEX_NAME,
      }),
    ]);

    const summary = draftSummary[0];

    return {
      draftRevenueEntryCount:
        readNumeric(summary?.count),
      staleRevenueDraftCount:
        readNumeric(summary?.staleCount),
      finalizedRevenueAmount30d,
      reconciledRevenueAmount30d,
    };
  }

  private async readCommissionMetrics(
    input: DashboardLiteSnapshotReadInput,
  ): Promise<{
    readonly draftSettlementCount: number;
    readonly staleSettlementDraftCount: number;
    readonly finalizedSettlementAmount30d: number;
    readonly activeCommissionRuleCount: number;
  }> {
    const [
      activeCommissionRuleCount,
      draftSummary,
      finalizedSettlementAmount30d,
    ] = await Promise.all([
      this.commissionRulesCollection.countDocuments(
        {
          status: "ACTIVE",
        },
        {
          hint:
            COMMISSION_RULE_STATUS_KIND_EFFECTIVE_WINDOW_INDEX_NAME,
        },
      ),
      this.commissionSettlementsCollection
        .aggregate<DualCountAggregationDocument>(
          [
            {
              $match: {
                status: "DRAFT",
              },
            },
            {
              $group: {
                _id: null,
                count: { $sum: 1 },
                staleCount: {
                  $sum: {
                    $cond: [
                      {
                        $lt: [
                          "$createdAt",
                          input.staleDraftThresholdAt,
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                },
              },
            },
          ],
          {
            hint:
              DASHBOARD_LITE_SETTLEMENT_DRAFT_CREATED_AT_INDEX_NAME,
          },
        )
        .toArray(),
      this.readSummedAmount({
        collection:
          this.commissionSettlementsCollection,
        match: {
          status: "FINALIZED",
          finalizedAt: {
            $gte: input.trailing30DayWindowStartAt,
            $lt: input.generatedAt,
          },
        },
        amountField: "settlementAmount",
        hint:
          DASHBOARD_LITE_SETTLEMENT_FINALIZED_FINALIZED_AT_INDEX_NAME,
      }),
    ]);

    const summary = draftSummary[0];

    return {
      draftSettlementCount:
        readNumeric(summary?.count),
      staleSettlementDraftCount:
        readNumeric(summary?.staleCount),
      finalizedSettlementAmount30d,
      activeCommissionRuleCount,
    };
  }

  private async readExpiringContractCount(
    input: DashboardLiteSnapshotReadInput,
  ): Promise<number> {
    return this.contractRecordsCollection.countDocuments(
      {
        status: "ACTIVE",
        effectiveEndDate: {
          $gte: input.expiringContractWindowStartDate,
          $lte: input.expiringContractWindowEndDate,
        },
      },
      {
        hint:
          DASHBOARD_LITE_CONTRACT_ACTIVE_EFFECTIVE_END_DATE_INDEX_NAME,
      },
    );
  }

  private async readSummedAmount<
    TDocument extends Document,
  >(params: {
    readonly collection: Collection<TDocument>;
    readonly match: Record<string, unknown>;
    readonly amountField:
      | "recognizedAmount"
      | "settlementAmount";
    readonly hint: string;
  }): Promise<number> {
    const rows = await params.collection
      .aggregate<SumAggregationDocument>(
        [
          {
            $match: params.match,
          },
          {
            $group: {
              _id: null,
              total: {
                $sum: `$${params.amountField}`,
              },
            },
          },
        ],
        {
          hint: params.hint,
        },
      )
      .toArray();

    return readNumeric(rows[0]?.total);
  }
}

function readNumeric(value: unknown): number {
  return typeof value === "number" &&
    Number.isFinite(value)
    ? value
    : 0;
}
