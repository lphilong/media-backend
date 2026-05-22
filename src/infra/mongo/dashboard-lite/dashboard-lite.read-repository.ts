import { Collection, Db, Document } from "mongodb";
import {
  createStructuredLogger,
  StructuredLogger,
} from "@infra/logger.adapter";
import { COMMISSION_RULE_STATUS_KIND_EFFECTIVE_WINDOW_INDEX_NAME } from "@infra/mongo/commission/commission.index";
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
import { EVENT_STATUS_WINDOW_INDEX_NAME } from "@infra/mongo/event-assignment/event-assignment.index";
import { DashboardLiteSnapshotProjection } from "@modules/dashboard-lite/domain/dashboard-lite.types";
import {
  DASHBOARD_LITE_MONGO_OPERATION_WARN_AFTER_MS,
  DashboardLiteTimingContext,
  measureDashboardLiteStage,
} from "@modules/dashboard-lite/diagnostics/dashboard-lite.timing";
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
  readonly status: "DRAFT" | "FINALIZED" | "RECONCILED";
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

interface DualCountAggregationDocument {
  readonly _id: null;
  readonly count: number;
  readonly staleCount: number;
}

interface SumAggregationDocument {
  readonly _id: null;
  readonly total: number;
}

interface DashboardLiteReadRepositoryOptions {
  readonly logger?: StructuredLogger;
  readonly timingNow?: () => number;
}

const ACTIVE_EVENT_STATUSES = Object.freeze([
  "SCHEDULED",
  "IN_PROGRESS",
] as const);

const FALLBACK_TIMING_CONTEXT: DashboardLiteTimingContext = Object.freeze({
  traceId: "dashboardLite.snapshot",
  actorId: "SYSTEM",
  context: "SYSTEM",
});

export class NativeMongoDashboardLiteReadRepository implements DashboardLiteReadRepository {
  private readonly eventsCollection: Collection<EventReadDocument>;
  private readonly talentKpiCollection: Collection<TalentKpiReadDocument>;
  private readonly revenueEntriesCollection: Collection<RevenueEntryReadDocument>;
  private readonly commissionRulesCollection: Collection<CommissionRuleReadDocument>;
  private readonly commissionSettlementsCollection: Collection<CommissionSettlementReadDocument>;
  private readonly contractRecordsCollection: Collection<ContractRecordReadDocument>;
  private readonly logger: StructuredLogger;
  private readonly timingNow: (() => number) | undefined;

  constructor(db: Db, options: DashboardLiteReadRepositoryOptions = {}) {
    this.eventsCollection = db.collection<EventReadDocument>("events");
    this.talentKpiCollection =
      db.collection<TalentKpiReadDocument>("talent_kpi_records");
    this.revenueEntriesCollection =
      db.collection<RevenueEntryReadDocument>("revenue_entries");
    this.commissionRulesCollection =
      db.collection<CommissionRuleReadDocument>("commission_rules");
    this.commissionSettlementsCollection =
      db.collection<CommissionSettlementReadDocument>("commission_settlements");
    this.contractRecordsCollection =
      db.collection<ContractRecordReadDocument>("contract_records");
    this.logger = options.logger ?? createStructuredLogger();
    this.timingNow = options.timingNow;
  }

  async getDashboardLiteSnapshotProjection(
    input: DashboardLiteSnapshotReadInput,
    timingContext: DashboardLiteTimingContext = FALLBACK_TIMING_CONTEXT,
  ): Promise<DashboardLiteSnapshotProjection> {
    return measureDashboardLiteStage(
      {
        operation: "dashboardLite.snapshot.operations",
        logger: this.logger,
        timingContext,
        now: this.timingNow,
        metadata: {
          metricGroupCount: 5,
        },
      },
      async () => {
        const [
          eventMetrics,
          talentKpiMetrics,
          revenueMetrics,
          commissionMetrics,
          expiringContractCount30d,
        ] = await Promise.all([
          this.readEventMetrics(input, timingContext),
          this.readTalentKpiMetrics(input, timingContext),
          this.readRevenueMetrics(input, timingContext),
          this.readCommissionMetrics(input, timingContext),
          this.readExpiringContractCount(input, timingContext),
        ]);

        return {
          todayEventCount: eventMetrics.todayEventCount,
          next7DayEventCount: eventMetrics.next7DayEventCount,
          draftTalentKpiCount: talentKpiMetrics.draftTalentKpiCount,
          finalizedTalentKpiCount30d:
            talentKpiMetrics.finalizedTalentKpiCount30d,
          staleTalentKpiDraftCount: talentKpiMetrics.staleTalentKpiDraftCount,
          draftRevenueEntryCount: revenueMetrics.draftRevenueEntryCount,
          finalizedRevenueAmount30d: revenueMetrics.finalizedRevenueAmount30d,
          reconciledRevenueAmount30d: revenueMetrics.reconciledRevenueAmount30d,
          staleRevenueDraftCount: revenueMetrics.staleRevenueDraftCount,
          draftSettlementCount: commissionMetrics.draftSettlementCount,
          finalizedSettlementAmount30d:
            commissionMetrics.finalizedSettlementAmount30d,
          activeCommissionRuleCount:
            commissionMetrics.activeCommissionRuleCount,
          staleSettlementDraftCount:
            commissionMetrics.staleSettlementDraftCount,
          expiringContractCount30d,
        };
      },
    );
  }

  private async readEventMetrics(
    input: DashboardLiteSnapshotReadInput,
    timingContext: DashboardLiteTimingContext,
  ): Promise<{
    readonly todayEventCount: number;
    readonly next7DayEventCount: number;
  }> {
    const baseFilter = {
      status: {
        $in: [...ACTIVE_EVENT_STATUSES],
      },
    };

    return measureDashboardLiteStage(
      {
        operation: "dashboardLite.metrics.events",
        logger: this.logger,
        timingContext,
        now: this.timingNow,
        metadata: {
          metricGroup: "events",
        },
      },
      async () => {
        const [todayEventCount, next7DayEventCount] = await Promise.all([
          this.measureMongoOperation(
            timingContext,
            {
              operation: "dashboardLite.metrics.events.today",
              metricGroup: "events",
              collectionName: "events",
              operationKind: "countDocuments",
              businessWindow: "today",
            },
            () =>
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
            (count) => ({ resultCount: count }),
          ),
          this.measureMongoOperation(
            timingContext,
            {
              operation: "dashboardLite.metrics.events.next7Days",
              metricGroup: "events",
              collectionName: "events",
              operationKind: "countDocuments",
              businessWindow: "next7Days",
            },
            () =>
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
            (count) => ({ resultCount: count }),
          ),
        ]);

        return {
          todayEventCount,
          next7DayEventCount,
        };
      },
    );
  }

  private async readTalentKpiMetrics(
    input: DashboardLiteSnapshotReadInput,
    timingContext: DashboardLiteTimingContext,
  ): Promise<{
    readonly draftTalentKpiCount: number;
    readonly finalizedTalentKpiCount30d: number;
    readonly staleTalentKpiDraftCount: number;
  }> {
    return measureDashboardLiteStage(
      {
        operation: "dashboardLite.metrics.talentKpi",
        logger: this.logger,
        timingContext,
        now: this.timingNow,
        metadata: {
          metricGroup: "talentKpi",
        },
      },
      async () => {
        const [draftSummary, finalizedTalentKpiCount30d] = await Promise.all([
          this.measureMongoOperation(
            timingContext,
            {
              operation: "dashboardLite.metrics.talentKpi.draftSummary",
              metricGroup: "talentKpi",
              collectionName: "talent_kpi_records",
              operationKind: "aggregate",
              businessWindow: "staleDrafts",
              metricNames: ["draftTalentKpiCount", "staleTalentKpiDraftCount"],
            },
            () =>
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
                    hint: DASHBOARD_LITE_TALENT_KPI_DRAFT_CREATED_AT_INDEX_NAME,
                  },
                )
                .toArray(),
            (rows) => ({ resultCount: rows.length }),
          ),
          this.measureMongoOperation(
            timingContext,
            {
              operation: "dashboardLite.metrics.talentKpi.finalized30d",
              metricGroup: "talentKpi",
              collectionName: "talent_kpi_records",
              operationKind: "countDocuments",
              businessWindow: "trailing30Days",
            },
            () =>
              this.talentKpiCollection.countDocuments(
                {
                  status: "FINALIZED",
                  publishedAt: {
                    $gte: input.trailing30DayWindowStartAt,
                    $lt: input.generatedAt,
                  },
                },
                {
                  hint: DASHBOARD_LITE_TALENT_KPI_FINALIZED_PUBLISHED_AT_INDEX_NAME,
                },
              ),
            (count) => ({ resultCount: count }),
          ),
        ]);

        const summary = draftSummary[0];

        return {
          draftTalentKpiCount: readNumeric(summary?.count),
          finalizedTalentKpiCount30d,
          staleTalentKpiDraftCount: readNumeric(summary?.staleCount),
        };
      },
    );
  }

  private async readRevenueMetrics(
    input: DashboardLiteSnapshotReadInput,
    timingContext: DashboardLiteTimingContext,
  ): Promise<{
    readonly draftRevenueEntryCount: number;
    readonly staleRevenueDraftCount: number;
    readonly finalizedRevenueAmount30d: number;
    readonly reconciledRevenueAmount30d: number;
  }> {
    return measureDashboardLiteStage(
      {
        operation: "dashboardLite.metrics.revenue",
        logger: this.logger,
        timingContext,
        now: this.timingNow,
        metadata: {
          metricGroup: "revenue",
        },
      },
      async () => {
        const [
          draftSummary,
          finalizedRevenueAmount30d,
          reconciledRevenueAmount30d,
        ] = await Promise.all([
          this.measureMongoOperation(
            timingContext,
            {
              operation: "dashboardLite.metrics.revenue.draftSummary",
              metricGroup: "revenue",
              collectionName: "revenue_entries",
              operationKind: "aggregate",
              businessWindow: "staleDrafts",
              metricNames: ["draftRevenueEntryCount", "staleRevenueDraftCount"],
            },
            () =>
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
                    hint: DASHBOARD_LITE_REVENUE_DRAFT_CREATED_AT_INDEX_NAME,
                  },
                )
                .toArray(),
            (rows) => ({ resultCount: rows.length }),
          ),
          this.readSummedAmount({
            timingContext,
            operation: "dashboardLite.metrics.revenue.finalized30d",
            metricGroup: "revenue",
            collection: this.revenueEntriesCollection,
            collectionName: "revenue_entries",
            businessWindow: "trailing30Days",
            match: {
              status: "FINALIZED",
              finalizedAt: {
                $gte: input.trailing30DayWindowStartAt,
                $lt: input.generatedAt,
              },
            },
            amountField: "recognizedAmount",
            hint: DASHBOARD_LITE_REVENUE_FINALIZED_FINALIZED_AT_INDEX_NAME,
          }),
          this.readSummedAmount({
            timingContext,
            operation: "dashboardLite.metrics.revenue.reconciled30d",
            metricGroup: "revenue",
            collection: this.revenueEntriesCollection,
            collectionName: "revenue_entries",
            businessWindow: "trailing30Days",
            match: {
              status: "RECONCILED",
              reconciledAt: {
                $gte: input.trailing30DayWindowStartAt,
                $lt: input.generatedAt,
              },
            },
            amountField: "recognizedAmount",
            hint: DASHBOARD_LITE_REVENUE_RECONCILED_RECONCILED_AT_INDEX_NAME,
          }),
        ]);

        const summary = draftSummary[0];

        return {
          draftRevenueEntryCount: readNumeric(summary?.count),
          staleRevenueDraftCount: readNumeric(summary?.staleCount),
          finalizedRevenueAmount30d,
          reconciledRevenueAmount30d,
        };
      },
    );
  }

  private async readCommissionMetrics(
    input: DashboardLiteSnapshotReadInput,
    timingContext: DashboardLiteTimingContext,
  ): Promise<{
    readonly draftSettlementCount: number;
    readonly staleSettlementDraftCount: number;
    readonly finalizedSettlementAmount30d: number;
    readonly activeCommissionRuleCount: number;
  }> {
    return measureDashboardLiteStage(
      {
        operation: "dashboardLite.metrics.commission",
        logger: this.logger,
        timingContext,
        now: this.timingNow,
        metadata: {
          metricGroup: "commission",
        },
      },
      async () => {
        const [
          activeCommissionRuleCount,
          draftSummary,
          finalizedSettlementAmount30d,
        ] = await Promise.all([
          this.measureMongoOperation(
            timingContext,
            {
              operation: "dashboardLite.metrics.commission.rules.active",
              metricGroup: "commission",
              collectionName: "commission_rules",
              operationKind: "countDocuments",
              businessWindow: "current",
            },
            () =>
              this.commissionRulesCollection.countDocuments(
                {
                  status: "ACTIVE",
                },
                {
                  hint: COMMISSION_RULE_STATUS_KIND_EFFECTIVE_WINDOW_INDEX_NAME,
                },
              ),
            (count) => ({ resultCount: count }),
          ),
          this.measureMongoOperation(
            timingContext,
            {
              operation:
                "dashboardLite.metrics.commission.settlements.draftSummary",
              metricGroup: "commission",
              collectionName: "commission_settlements",
              operationKind: "aggregate",
              businessWindow: "staleDrafts",
              metricNames: [
                "draftSettlementCount",
                "staleSettlementDraftCount",
              ],
            },
            () =>
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
                    hint: DASHBOARD_LITE_SETTLEMENT_DRAFT_CREATED_AT_INDEX_NAME,
                  },
                )
                .toArray(),
            (rows) => ({ resultCount: rows.length }),
          ),
          this.readSummedAmount({
            timingContext,
            operation:
              "dashboardLite.metrics.commission.settlements.finalized30d",
            metricGroup: "commission",
            collection: this.commissionSettlementsCollection,
            collectionName: "commission_settlements",
            businessWindow: "trailing30Days",
            match: {
              status: "FINALIZED",
              finalizedAt: {
                $gte: input.trailing30DayWindowStartAt,
                $lt: input.generatedAt,
              },
            },
            amountField: "settlementAmount",
            hint: DASHBOARD_LITE_SETTLEMENT_FINALIZED_FINALIZED_AT_INDEX_NAME,
          }),
        ]);

        const summary = draftSummary[0];

        return {
          draftSettlementCount: readNumeric(summary?.count),
          staleSettlementDraftCount: readNumeric(summary?.staleCount),
          finalizedSettlementAmount30d,
          activeCommissionRuleCount,
        };
      },
    );
  }

  private async readExpiringContractCount(
    input: DashboardLiteSnapshotReadInput,
    timingContext: DashboardLiteTimingContext,
  ): Promise<number> {
    return measureDashboardLiteStage(
      {
        operation: "dashboardLite.metrics.contracts",
        logger: this.logger,
        timingContext,
        now: this.timingNow,
        metadata: {
          metricGroup: "contracts",
        },
      },
      () =>
        this.measureMongoOperation(
          timingContext,
          {
            operation: "dashboardLite.metrics.contracts.expiring30d",
            metricGroup: "contracts",
            collectionName: "contract_records",
            operationKind: "countDocuments",
            businessWindow: "contractExpiry30Days",
          },
          () =>
            this.contractRecordsCollection.countDocuments(
              {
                status: "ACTIVE",
                effectiveEndDate: {
                  $gte: input.expiringContractWindowStartDate,
                  $lte: input.expiringContractWindowEndDate,
                },
              },
              {
                hint: DASHBOARD_LITE_CONTRACT_ACTIVE_EFFECTIVE_END_DATE_INDEX_NAME,
              },
            ),
          (count) => ({ resultCount: count }),
        ),
    );
  }

  private async measureMongoOperation<T>(
    timingContext: DashboardLiteTimingContext,
    metadata: {
      readonly operation: string;
      readonly metricGroup: string;
      readonly collectionName: string;
      readonly operationKind: "countDocuments" | "aggregate";
      readonly businessWindow: string;
      readonly metricNames?: readonly string[];
    },
    task: () => T | Promise<T>,
    resultMetadata: (result: T) => Readonly<Record<string, unknown>>,
  ): Promise<T> {
    return measureDashboardLiteStage(
      {
        operation: metadata.operation,
        logger: this.logger,
        timingContext,
        now: this.timingNow,
        warnAfterMs: DASHBOARD_LITE_MONGO_OPERATION_WARN_AFTER_MS,
        metadata: {
          metricGroup: metadata.metricGroup,
          collectionName: metadata.collectionName,
          operationKind: metadata.operationKind,
          businessWindow: metadata.businessWindow,
          ...(metadata.metricNames
            ? { metricNames: metadata.metricNames }
            : {}),
        },
        resultMetadata,
      },
      task,
    );
  }

  private async readSummedAmount<TDocument extends Document>(params: {
    readonly timingContext: DashboardLiteTimingContext;
    readonly operation: string;
    readonly metricGroup: string;
    readonly collection: Collection<TDocument>;
    readonly collectionName: string;
    readonly businessWindow: string;
    readonly match: Record<string, unknown>;
    readonly amountField: "recognizedAmount" | "settlementAmount";
    readonly hint: string;
  }): Promise<number> {
    const rows = await this.measureMongoOperation(
      params.timingContext,
      {
        operation: params.operation,
        metricGroup: params.metricGroup,
        collectionName: params.collectionName,
        operationKind: "aggregate",
        businessWindow: params.businessWindow,
      },
      () =>
        params.collection
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
          .toArray(),
      (result) => ({ resultCount: result.length }),
    );

    return readNumeric(rows[0]?.total);
  }
}

function readNumeric(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
