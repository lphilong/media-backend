import { Router } from "express";
import { withCommand } from "@app/base/command.middleware";
import { DashboardLiteAdminQueryController } from "./admin.dashboard-lite.query.controller";

export function adminDashboardLiteRoutes(
  queryController: DashboardLiteAdminQueryController,
): Router {
  const router = Router();

  router.get(
    "/snapshot",
    withCommand("DASHBOARD_LITE_GET_SNAPSHOT"),
    queryController.execute,
  );

  return router;
}
