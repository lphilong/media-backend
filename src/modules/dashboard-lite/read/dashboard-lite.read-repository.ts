import { DashboardLiteSnapshotProjection } from "@modules/dashboard-lite/domain/dashboard-lite.types";

export interface DashboardLiteSnapshotReadInput {
  readonly generatedAt: number;
  readonly todayWindowStartAt: number;
  readonly todayWindowEndAt: number;
  readonly next7DayWindowEndAt: number;
  readonly trailing30DayWindowStartAt: number;
  readonly staleDraftThresholdAt: number;
  readonly expiringContractWindowStartDate: number;
  readonly expiringContractWindowEndDate: number;
}

export interface DashboardLiteReadRepository {
  getDashboardLiteSnapshotProjection(
    input: DashboardLiteSnapshotReadInput,
  ): Promise<DashboardLiteSnapshotProjection>;
}
