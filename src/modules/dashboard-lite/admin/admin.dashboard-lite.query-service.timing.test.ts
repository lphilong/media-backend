import assert from "node:assert/strict";
import { test } from "node:test";

import { Actor } from "@core/actor/actor";
import { Permission } from "@core/permission/permission.enum";
import {
  LogEvent,
  StructuredLogger,
} from "@infra/logger.adapter";
import { DashboardLiteAdminQueryService } from "@modules/dashboard-lite/admin/admin.dashboard-lite.query-service";
import { DashboardLiteSnapshotProjection } from "@modules/dashboard-lite/domain/dashboard-lite.types";
import {
  DashboardLiteReadRepository,
  DashboardLiteSnapshotReadInput,
} from "@modules/dashboard-lite/read/dashboard-lite.read-repository";

const SNAPSHOT_PROJECTION: DashboardLiteSnapshotProjection =
  Object.freeze({
    todayEventCount: 11,
    next7DayEventCount: 22,
    draftTalentKpiCount: 3,
    finalizedTalentKpiCount30d: 4,
    staleTalentKpiDraftCount: 5,
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

test("Dashboard Lite service logs total and window timing without changing snapshot shape", async () => {
  const { logger, events } = createCapturingLogger();
  const service = new DashboardLiteAdminQueryService(
    new CapturingDashboardLiteReadRepository(),
    {
      now: () => Date.UTC(2026, 4, 18, 12, 0, 0, 0),
      timingNow: () => 1,
      businessTimeZone: "UTC",
      logger,
    },
  );

  const snapshot =
    await service.getDashboardLiteSnapshot(
      createDashboardLiteActor(),
      {},
    );

  assert.deepEqual(snapshot.overview, {
    todayEventCount: 11,
    draftTalentKpiCount: 3,
    draftRevenueEntryCount: 6,
    draftSettlementCount: 8,
    activeCommissionRuleCount: 9,
    expiringContractCount30d: 12,
  });
  assert.deepEqual(
    events.map(({ event }) => event.operation),
    [
      "dashboardLite.snapshot.windows",
      "dashboardLite.snapshot.total",
    ],
  );
  assert.equal(events[0]?.event.status, "SUCCESS");
  assert.equal(events[0]?.event.actorId, "admin-dashboard-lite");
  assert.equal(events[0]?.event.context, "ADMIN");
});

test("Dashboard Lite service logs failed total timing and rethrows", async () => {
  const { logger, events } = createCapturingLogger();
  const failure = new Error("repository unavailable");
  const service = new DashboardLiteAdminQueryService(
    new ThrowingDashboardLiteReadRepository(failure),
    {
      now: () => Date.UTC(2026, 4, 18, 12, 0, 0, 0),
      timingNow: () => 1,
      businessTimeZone: "UTC",
      logger,
    },
  );

  await assert.rejects(
    () =>
      service.getDashboardLiteSnapshot(
        createDashboardLiteActor(),
        {},
      ),
    failure,
  );

  const finalEvent = events[events.length - 1];

  assert.equal(
    finalEvent?.event.operation,
    "dashboardLite.snapshot.total",
  );
  assert.equal(finalEvent?.level, "error");
  assert.equal(finalEvent?.event.status, "FAILED");
  assert.equal(
    finalEvent?.event.metadata?.error,
    "repository unavailable",
  );
});

class CapturingDashboardLiteReadRepository
  implements DashboardLiteReadRepository
{
  async getDashboardLiteSnapshotProjection(
    _input: DashboardLiteSnapshotReadInput,
  ): Promise<DashboardLiteSnapshotProjection> {
    return SNAPSHOT_PROJECTION;
  }
}

class ThrowingDashboardLiteReadRepository
  implements DashboardLiteReadRepository
{
  constructor(private readonly error: Error) {}

  async getDashboardLiteSnapshotProjection(
    _input: DashboardLiteSnapshotReadInput,
  ): Promise<DashboardLiteSnapshotProjection> {
    throw this.error;
  }
}

function createDashboardLiteActor(): Actor {
  return new Actor({
    id: "admin-dashboard-lite",
    type: "admin",
    context: "ADMIN",
    roles: [],
    permissions: [Permission.DASHBOARD_LITE_READ],
    scopeGrants: {
      dashboardLite: ["global"],
    },
    isActive: true,
  });
}
