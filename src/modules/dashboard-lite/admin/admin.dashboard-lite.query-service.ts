import { env } from "@config/env";
import { Actor } from "@core/actor/actor";
import { SystemInvariantError } from "@core/error/system-error";
import { Permission } from "@core/permission/permission.enum";
import { PermissionGuard } from "@core/permission/permission.guard";
import { PermissionResolver } from "@core/permission/permission.resolver";
import {
  DashboardLitePermissionScopeError,
} from "@modules/dashboard-lite/domain/dashboard-lite.errors";
import {
  assertValidBusinessTimeZone,
  createDashboardLiteWindowSnapshot,
  DashboardLiteWindowSnapshot,
  toDashboardLiteUtcDateOnlyString,
} from "@modules/dashboard-lite/domain/dashboard-lite.time";
import {
  DashboardLiteSnapshotProjection,
  DashboardLiteSnapshotView,
  DashboardLiteWindowsView,
} from "@modules/dashboard-lite/domain/dashboard-lite.types";
import { DashboardLiteReadRepository } from "@modules/dashboard-lite/read/dashboard-lite.read-repository";
import {
  GetDashboardLiteSnapshotQuery,
  GetDashboardLiteSnapshotResult,
} from "@modules/dashboard-lite/shared/dashboard-lite.contracts";

type NowProvider = () => number;

interface DashboardLiteQueryRuntimeConfig {
  readonly now?: NowProvider;
  readonly businessTimeZone?: string;
}

export class DashboardLiteAdminQueryService {
  private readonly now: NowProvider;
  private readonly businessTimeZone: string;

  constructor(
    private readonly readRepository: DashboardLiteReadRepository,
    config: DashboardLiteQueryRuntimeConfig = {},
  ) {
    this.now = config.now ?? Date.now;
    this.businessTimeZone =
      config.businessTimeZone ??
      env.ADMIN_BUSINESS_TIMEZONE;

    assertValidBusinessTimeZone(
      this.businessTimeZone,
    );
  }

  async getDashboardLiteSnapshot(
    actor: Actor,
    _query: GetDashboardLiteSnapshotQuery,
  ): Promise<GetDashboardLiteSnapshotResult> {
    this.assertReadPermission(actor);
    assertGlobalScope(
      actor,
      "Dashboard Lite queries require global scope",
    );

    const generatedAt = this.now();
    const window =
      createDashboardLiteWindowSnapshot(
        generatedAt,
        this.businessTimeZone,
      );

    const projection =
      await this.readRepository.getDashboardLiteSnapshotProjection(
        {
          generatedAt: window.generatedAt,
          todayWindowStartAt:
            window.todayWindowStartAt,
          todayWindowEndAt: window.todayWindowEndAt,
          next7DayWindowEndAt:
            window.next7DayWindowEndAt,
          trailing30DayWindowStartAt:
            window.trailing30DayWindowStartAt,
          staleDraftThresholdAt:
            window.staleDraftThresholdAt,
          expiringContractWindowStartDate:
            window.expiringContractWindowStartDate,
          expiringContractWindowEndDate:
            window.expiringContractWindowEndDate,
        },
      );

    return toSnapshotView(
      window,
      projection,
    );
  }

  private assertReadPermission(actor: Actor): void {
    assertAdminActorType(actor);

    const permission = PermissionResolver.resolve(
      Permission.DASHBOARD_LITE_READ,
    );
    PermissionGuard.assert(actor, permission);
  }
}

function toSnapshotView(
  window: DashboardLiteWindowSnapshot,
  projection: DashboardLiteSnapshotProjection,
): DashboardLiteSnapshotView {
  return {
    generatedAt: window.generatedAt,
    businessDate: window.businessDate,
    windows: toWindowsView(window),
    overview: {
      todayEventCount: projection.todayEventCount,
      draftTalentKpiCount:
        projection.draftTalentKpiCount,
      draftRevenueEntryCount:
        projection.draftRevenueEntryCount,
      draftSettlementCount:
        projection.draftSettlementCount,
      activeCommissionRuleCount:
        projection.activeCommissionRuleCount,
      expiringContractCount30d:
        projection.expiringContractCount30d,
    },
    operations: {
      todayEventCount: projection.todayEventCount,
      next7DayEventCount:
        projection.next7DayEventCount,
      draftTalentKpiCount:
        projection.draftTalentKpiCount,
      finalizedTalentKpiCount30d:
        projection.finalizedTalentKpiCount30d,
    },
    commercial: {
      draftRevenueEntryCount:
        projection.draftRevenueEntryCount,
      finalizedRevenueAmount30d:
        projection.finalizedRevenueAmount30d,
      reconciledRevenueAmount30d:
        projection.reconciledRevenueAmount30d,
      draftSettlementCount:
        projection.draftSettlementCount,
      finalizedSettlementAmount30d:
        projection.finalizedSettlementAmount30d,
      activeCommissionRuleCount:
        projection.activeCommissionRuleCount,
    },
    attention: {
      staleTalentKpiDraftCount:
        projection.staleTalentKpiDraftCount,
      staleRevenueDraftCount:
        projection.staleRevenueDraftCount,
      staleSettlementDraftCount:
        projection.staleSettlementDraftCount,
      expiringContractCount30d:
        projection.expiringContractCount30d,
    },
  };
}

function toWindowsView(
  window: DashboardLiteWindowSnapshot,
): DashboardLiteWindowsView {
  return {
    businessTimeZone: window.businessTimeZone,
    today: {
      startAtInclusive: window.todayWindowStartAt,
      endAtExclusive: window.todayWindowEndAt,
    },
    next7Days: {
      startAtInclusive: window.todayWindowStartAt,
      endAtExclusive: window.next7DayWindowEndAt,
    },
    trailing30Days: {
      startAtInclusive:
        window.trailing30DayWindowStartAt,
      endAtExclusive: window.generatedAt,
    },
    staleDrafts: {
      olderThanAtExclusive:
        window.staleDraftThresholdAt,
    },
    contractExpiry30Days: {
      startDateInclusive:
        toDashboardLiteUtcDateOnlyString(
          window.expiringContractWindowStartDate,
        ),
      endDateInclusive:
        toDashboardLiteUtcDateOnlyString(
          window.expiringContractWindowEndDate,
        ),
    },
  };
}

function assertGlobalScope(
  actor: Actor,
  message: string,
): void {
  if (
    PermissionGuard.hasDashboardLiteScopeGrant(
      actor,
      "global",
    )
  ) {
    return;
  }

  throw new DashboardLitePermissionScopeError(message);
}

function assertAdminActorType(
  actor: Actor,
): void {
  if (actor.type === "admin") {
    return;
  }

  throw new SystemInvariantError(
    "PERMISSION_DENIED",
    `Dashboard Lite access requires actor.type admin, received ${actor.type}`,
  );
}
