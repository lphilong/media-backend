import assert from "node:assert/strict";
import { test } from "node:test";
import { Actor } from "@core/actor/actor";
import { Permission } from "@core/permission/permission.enum";
import { DashboardLiteAdminQueryService } from "@modules/dashboard-lite/admin/admin.dashboard-lite.query-service";
import { DashboardLiteSnapshotProjection } from "@modules/dashboard-lite/domain/dashboard-lite.types";
import {
  DashboardLiteReadRepository,
  DashboardLiteSnapshotReadInput,
} from "@modules/dashboard-lite/read/dashboard-lite.read-repository";
import { DashboardLiteAdminSnapshotExposure } from "@modules/dashboard-lite/shared/dashboard-lite.exposure";
import { DashboardLiteReadinessError } from "./dashboard-lite.errors";
import {
  createDashboardLiteWindowSnapshot,
  parseTimeZoneOffsetTokenMs,
  toDashboardLiteUtcDateOnlyString,
} from "./dashboard-lite.time";

const BUSINESS_DAY_GENERATED_AT = Date.UTC(
  2026,
  4,
  18,
  12,
  0,
  0,
  0,
);
const DAY_MS = 24 * 60 * 60 * 1000;

const SNAPSHOT_PROJECTION: DashboardLiteSnapshotProjection =
  {
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
  };

test("UTC local midnight resolves for the Dashboard Lite business date", () => {
  const snapshot = createDashboardLiteWindowSnapshot(
    BUSINESS_DAY_GENERATED_AT,
    "UTC",
  );

  assert.equal(snapshot.businessDate, "2026-05-18");
  assert.equal(snapshot.businessTimeZone, "UTC");
  assert.equal(
    snapshot.todayWindowStartAt,
    Date.UTC(2026, 4, 18, 0, 0, 0, 0),
  );
  assert.equal(
    snapshot.todayWindowEndAt,
    Date.UTC(2026, 4, 19, 0, 0, 0, 0),
  );
  assert.equal(
    snapshot.next7DayWindowEndAt,
    Date.UTC(2026, 4, 25, 0, 0, 0, 0),
  );
  assert.equal(
    snapshot.trailing30DayWindowStartAt,
    BUSINESS_DAY_GENERATED_AT - 30 * DAY_MS,
  );
  assert.equal(
    snapshot.staleDraftThresholdAt,
    BUSINESS_DAY_GENERATED_AT - 7 * DAY_MS,
  );
  assert.equal(
    toDashboardLiteUtcDateOnlyString(
      snapshot.expiringContractWindowStartDate,
    ),
    "2026-05-18",
  );
  assert.equal(
    toDashboardLiteUtcDateOnlyString(
      snapshot.expiringContractWindowEndDate,
    ),
    "2026-06-17",
  );
  assert.equal(
    new Date(snapshot.todayWindowStartAt).toISOString(),
    "2026-05-18T00:00:00.000Z",
  );
});

test("Dashboard Lite window snapshot does not fail readiness for UTC", () => {
  assert.doesNotThrow(() => {
    createDashboardLiteWindowSnapshot(
      BUSINESS_DAY_GENERATED_AT,
      "UTC",
    );
  });
});

test("zero-offset timezone tokens parse to zero milliseconds", () => {
  for (const token of [
    "GMT",
    "UTC",
    "GMT+0",
    "GMT+00:00",
    "GMT-00:00",
  ]) {
    assert.equal(
      parseTimeZoneOffsetTokenMs(token, "UTC"),
      0,
    );
  }
});

test("Asia Ho Chi Minh local midnight resolves to the expected UTC timestamp", () => {
  const snapshot = createDashboardLiteWindowSnapshot(
    BUSINESS_DAY_GENERATED_AT,
    "Asia/Ho_Chi_Minh",
  );

  assert.equal(snapshot.businessDate, "2026-05-18");
  assert.equal(
    snapshot.businessTimeZone,
    "Asia/Ho_Chi_Minh",
  );
  assert.equal(
    snapshot.todayWindowStartAt,
    Date.UTC(2026, 4, 17, 17, 0, 0, 0),
  );
  assert.equal(
    snapshot.todayWindowEndAt,
    Date.UTC(2026, 4, 18, 17, 0, 0, 0),
  );
  assert.equal(
    snapshot.next7DayWindowEndAt,
    Date.UTC(2026, 4, 24, 17, 0, 0, 0),
  );
  assert.equal(
    new Date(snapshot.todayWindowStartAt).toISOString(),
    "2026-05-17T17:00:00.000Z",
  );
});

test("America New York local midnight resolves with DST-aware offset", () => {
  const snapshot = createDashboardLiteWindowSnapshot(
    BUSINESS_DAY_GENERATED_AT,
    "America/New_York",
  );

  assert.equal(snapshot.businessDate, "2026-05-18");
  assert.equal(
    snapshot.todayWindowStartAt,
    Date.UTC(2026, 4, 18, 4, 0, 0, 0),
  );
  assert.equal(
    new Date(snapshot.todayWindowStartAt).toISOString(),
    "2026-05-18T04:00:00.000Z",
  );
});

test("invalid Dashboard Lite business timezone fails closed", () => {
  assert.throws(
    () => {
      createDashboardLiteWindowSnapshot(
        BUSINESS_DAY_GENERATED_AT,
        "Invalid/Timezone",
      );
    },
    (err: unknown) => {
      assert.equal(
        err instanceof DashboardLiteReadinessError,
        true,
      );
      assert.equal(
        (err as DashboardLiteReadinessError).code,
        "DASHBOARD_LITE_READINESS_ERROR",
      );
      return true;
    },
  );
});

test("Dashboard Lite admin snapshot exposes backend-owned window metadata without changing metrics", async () => {
  const repository =
    new CapturingDashboardLiteReadRepository();
  const service = new DashboardLiteAdminQueryService(
    repository,
    {
      now: () => BUSINESS_DAY_GENERATED_AT,
      businessTimeZone: "UTC",
    },
  );

  const snapshot =
    await service.getDashboardLiteSnapshot(
      createDashboardLiteActor(),
      {},
    );

  assert.deepEqual(repository.capturedInput, {
    generatedAt: BUSINESS_DAY_GENERATED_AT,
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
    trailing30DayWindowStartAt:
      BUSINESS_DAY_GENERATED_AT - 30 * DAY_MS,
    staleDraftThresholdAt:
      BUSINESS_DAY_GENERATED_AT - 7 * DAY_MS,
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
  });

  assert.equal(
    snapshot.generatedAt,
    BUSINESS_DAY_GENERATED_AT,
  );
  assert.equal(snapshot.businessDate, "2026-05-18");
  assert.deepEqual(snapshot.windows, {
    businessTimeZone: "UTC",
    today: {
      startAtInclusive: Date.UTC(
        2026,
        4,
        18,
        0,
        0,
        0,
        0,
      ),
      endAtExclusive: Date.UTC(
        2026,
        4,
        19,
        0,
        0,
        0,
        0,
      ),
    },
    next7Days: {
      startAtInclusive: Date.UTC(
        2026,
        4,
        18,
        0,
        0,
        0,
        0,
      ),
      endAtExclusive: Date.UTC(
        2026,
        4,
        25,
        0,
        0,
        0,
        0,
      ),
    },
    trailing30Days: {
      startAtInclusive:
        BUSINESS_DAY_GENERATED_AT - 30 * DAY_MS,
      endAtExclusive: BUSINESS_DAY_GENERATED_AT,
    },
    staleDrafts: {
      olderThanAtExclusive:
        BUSINESS_DAY_GENERATED_AT - 7 * DAY_MS,
    },
    contractExpiry30Days: {
      startDateInclusive: "2026-05-18",
      endDateInclusive: "2026-06-17",
    },
  });
  assert.deepEqual(snapshot.overview, {
    todayEventCount:
      SNAPSHOT_PROJECTION.todayEventCount,
    draftTalentKpiCount:
      SNAPSHOT_PROJECTION.draftTalentKpiCount,
    draftRevenueEntryCount:
      SNAPSHOT_PROJECTION.draftRevenueEntryCount,
    draftSettlementCount:
      SNAPSHOT_PROJECTION.draftSettlementCount,
    activeCommissionRuleCount:
      SNAPSHOT_PROJECTION.activeCommissionRuleCount,
    expiringContractCount30d:
      SNAPSHOT_PROJECTION.expiringContractCount30d,
  });
  assert.equal(
    snapshot.operations.next7DayEventCount,
    SNAPSHOT_PROJECTION.next7DayEventCount,
  );
  assert.equal(
    snapshot.commercial.finalizedRevenueAmount30d,
    SNAPSHOT_PROJECTION.finalizedRevenueAmount30d,
  );
  assert.equal(
    snapshot.attention.staleSettlementDraftCount,
    SNAPSHOT_PROJECTION.staleSettlementDraftCount,
  );

  assert.deepEqual(
    DashboardLiteAdminSnapshotExposure.expose(snapshot)
      .windows,
    snapshot.windows,
  );
});

class CapturingDashboardLiteReadRepository
  implements DashboardLiteReadRepository
{
  capturedInput:
    | DashboardLiteSnapshotReadInput
    | undefined;

  async getDashboardLiteSnapshotProjection(
    input: DashboardLiteSnapshotReadInput,
  ): Promise<DashboardLiteSnapshotProjection> {
    this.capturedInput = input;
    return SNAPSHOT_PROJECTION;
  }
}

function createDashboardLiteActor(): Actor {
  return new Actor({
    id: "admin-dashboard-lite",
    type: "admin",
    context: "ADMIN",
    accountContexts: ["ADMIN_CONSOLE"],
    roles: [],
    permissions: [Permission.DASHBOARD_LITE_READ],
    scopeGrants: {
      dashboardLite: ["global"],
    },
    isActive: true,
  });
}
