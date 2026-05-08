export const DASHBOARD_LITE_SCOPES = [
  "global",
] as const;

export type DashboardLiteScope =
  (typeof DASHBOARD_LITE_SCOPES)[number];

export interface DashboardLiteOverviewView {
  readonly todayEventCount: number;
  readonly draftTalentKpiCount: number;
  readonly draftRevenueEntryCount: number;
  readonly draftSettlementCount: number;
  readonly activeCommissionRuleCount: number;
  readonly expiringContractCount30d: number;
}

export interface DashboardLiteOperationsView {
  readonly todayEventCount: number;
  readonly next7DayEventCount: number;
  readonly draftTalentKpiCount: number;
  readonly finalizedTalentKpiCount30d: number;
}

export interface DashboardLiteCommercialView {
  readonly draftRevenueEntryCount: number;
  readonly finalizedRevenueAmount30d: number;
  readonly reconciledRevenueAmount30d: number;
  readonly draftSettlementCount: number;
  readonly finalizedSettlementAmount30d: number;
  readonly activeCommissionRuleCount: number;
}

export interface DashboardLiteAttentionView {
  readonly staleTalentKpiDraftCount: number;
  readonly staleRevenueDraftCount: number;
  readonly staleSettlementDraftCount: number;
  readonly expiringContractCount30d: number;
}

export interface DashboardLiteSnapshotView {
  readonly generatedAt: number;
  readonly businessDate: string;
  readonly overview: DashboardLiteOverviewView;
  readonly operations: DashboardLiteOperationsView;
  readonly commercial: DashboardLiteCommercialView;
  readonly attention: DashboardLiteAttentionView;
}

export interface DashboardLiteSnapshotProjection {
  readonly todayEventCount: number;
  readonly next7DayEventCount: number;
  readonly draftTalentKpiCount: number;
  readonly finalizedTalentKpiCount30d: number;
  readonly staleTalentKpiDraftCount: number;
  readonly draftRevenueEntryCount: number;
  readonly finalizedRevenueAmount30d: number;
  readonly reconciledRevenueAmount30d: number;
  readonly staleRevenueDraftCount: number;
  readonly draftSettlementCount: number;
  readonly finalizedSettlementAmount30d: number;
  readonly activeCommissionRuleCount: number;
  readonly staleSettlementDraftCount: number;
  readonly expiringContractCount30d: number;
}
