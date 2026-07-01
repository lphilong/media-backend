import assert from "node:assert/strict";
import { test } from "node:test";

import {
  Collection,
  Db,
  Document,
} from "mongodb";
import {
  LogEvent,
  StructuredLogger,
} from "@infra/logger.adapter";
import { NativeMongoDashboardLiteReadRepository } from "./dashboard-lite.read-repository";

function createCapturingLogger(): {
  readonly logger: StructuredLogger;
  readonly events: Array<{
    readonly level: string;
    readonly event: LogEvent;
  }>;
} {
  const events: Array<{
    readonly level: string;
    readonly event: LogEvent;
  }> = [];
  const record =
    (level: string) =>
    (event: LogEvent): void => {
      events.push({ level, event });
    };

  return {
    events,
    logger: {
      info: record("info"),
      warn: record("warn"),
      error: record("error"),
      fatal: record("fatal"),
    },
  };
}

test("Native Mongo Dashboard Lite repository logs groups and operations without changing projection shape", async () => {
  const { logger, events } = createCapturingLogger();
  const repository =
    new NativeMongoDashboardLiteReadRepository(
      createFakeDb(),
      {
        logger,
        timingNow: () => 1,
      },
    );

  const projection =
    await repository.getDashboardLiteSnapshotProjection(
      {
        generatedAt: Date.UTC(2026, 4, 18, 12, 0, 0, 0),
        todayWindowStartAt: Date.UTC(
          2026,
          4,
          18,
          0,
          0,
          0,
          0,
        ),
        todayWindowEndAt: Date.UTC(
          2026,
          4,
          19,
          0,
          0,
          0,
          0,
        ),
        next7DayWindowEndAt: Date.UTC(
          2026,
          4,
          25,
          0,
          0,
          0,
          0,
        ),
        trailing30DayWindowStartAt: Date.UTC(
          2026,
          3,
          18,
          12,
          0,
          0,
          0,
        ),
        staleDraftThresholdAt: Date.UTC(
          2026,
          4,
          11,
          12,
          0,
          0,
          0,
        ),
        expiringContractWindowStartDate: Date.UTC(
          2026,
          4,
          18,
          0,
          0,
          0,
          0,
        ),
        expiringContractWindowEndDate: Date.UTC(
          2026,
          5,
          17,
          0,
          0,
          0,
          0,
        ),
      },
      {
        traceId: "trace-dashboard",
        actorId: "admin-dashboard-lite",
        context: "ADMIN",
      },
    );

  assert.deepEqual(projection, {
    todayEventCount: 11,
    next7DayEventCount: 22,
    draftRevenueEntryCount: 6,
    finalizedRevenueAmount30d: 700.25,
    reconciledRevenueAmount30d: 650.5,
    staleRevenueDraftCount: 7,
    draftSettlementCount: 8,
    finalizedSettlementAmount30d: 900.75,
    activeCommissionRuleCount: 9,
    staleSettlementDraftCount: 10,
    expiringContractCount30d: 12,
  });

  const operations = new Set(
    events.map(({ event }) => event.operation),
  );

  for (const operation of [
    "dashboardLite.snapshot.operations",
    "dashboardLite.metrics.events",
    "dashboardLite.metrics.events.today",
    "dashboardLite.metrics.events.next7Days",
    "dashboardLite.metrics.revenue",
    "dashboardLite.metrics.revenue.draftSummary",
    "dashboardLite.metrics.revenue.finalized30d",
    "dashboardLite.metrics.revenue.reconciled30d",
    "dashboardLite.metrics.commission",
    "dashboardLite.metrics.commission.rules.active",
    "dashboardLite.metrics.commission.settlements.draftSummary",
    "dashboardLite.metrics.commission.settlements.finalized30d",
    "dashboardLite.metrics.contracts",
    "dashboardLite.metrics.contracts.expiring30d",
  ]) {
    assert.equal(
      operations.has(operation),
      true,
      `${operation} was not logged`,
    );
  }

  const mongoEvent = events.find(
    ({ event }) =>
      event.operation ===
      "dashboardLite.metrics.revenue.finalized30d",
  )?.event;

  assert.deepEqual(mongoEvent?.metadata, {
    metricGroup: "revenue",
    collectionName: "revenue_entries",
    operationKind: "aggregate",
    businessWindow: "trailing30Days",
    resultCount: 1,
    durationMs: 0,
    slow: false,
    slowThresholdMs: 100,
  });
});

interface FakeCollection {
  countDocuments(
    filter: unknown,
    options: unknown,
  ): Promise<number>;
  aggregate<TDocument extends Document>(
    pipeline: readonly Document[],
    options: unknown,
  ): {
    toArray(): Promise<TDocument[]>;
  };
}

function createFakeDb(): Db {
  const collections = new Map<string, FakeCollection>([
    [
      "events",
      createCountingCollection([11, 22], []),
    ],
    [
      "revenue_entries",
      createCountingCollection([], [
        [{ _id: null, count: 6, staleCount: 7 }],
        [{ _id: null, total: 700.25 }],
        [{ _id: null, total: 650.5 }],
      ]),
    ],
    [
      "commission_rules",
      createCountingCollection([9], []),
    ],
    [
      "commission_settlements",
      createCountingCollection([], [
        [{ _id: null, count: 8, staleCount: 10 }],
        [{ _id: null, total: 900.75 }],
      ]),
    ],
    [
      "contract_records",
      createCountingCollection([12], []),
    ],
  ]);

  return {
    collection<TSchema extends Document = Document>(
      name: string,
    ): Collection<TSchema> {
      const collection = collections.get(name);
      assert.ok(collection, `Missing fake collection ${name}`);
      return collection as unknown as Collection<TSchema>;
    },
  } as unknown as Db;
}

function createCountingCollection(
  counts: readonly number[],
  aggregateResults: readonly (readonly Document[])[],
): FakeCollection {
  let countIndex = 0;
  let aggregateIndex = 0;

  return {
    async countDocuments(
      _filter: unknown,
      _options: unknown,
    ): Promise<number> {
      const value = counts[countIndex];
      countIndex += 1;
      assert.equal(
        typeof value,
        "number",
        "Unexpected countDocuments call",
      );
      return value;
    },
    aggregate<TDocument extends Document>(
      _pipeline: readonly Document[],
      _options: unknown,
    ): {
      toArray(): Promise<TDocument[]>;
    } {
      const rows = aggregateResults[aggregateIndex];
      aggregateIndex += 1;
      assert.ok(rows, "Unexpected aggregate call");

      return {
        async toArray(): Promise<TDocument[]> {
          return [...rows] as TDocument[];
        },
      };
    },
  };
}
