import { Db } from "mongodb";
import { NativeMongoDashboardLiteReadRepository } from "@infra/mongo/dashboard-lite/dashboard-lite.read-repository";

export interface DashboardLiteInfra {
  readonly dashboardLiteReadRepository: NativeMongoDashboardLiteReadRepository;
}

export function createDashboardLiteInfra(
  db: Db,
): DashboardLiteInfra {
  return {
    dashboardLiteReadRepository:
      new NativeMongoDashboardLiteReadRepository(
        db,
      ),
  };
}
