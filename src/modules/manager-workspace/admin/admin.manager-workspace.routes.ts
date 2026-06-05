import { Router } from "express";
import { withCommand } from "@app/base/command.middleware";
import { ManagerWorkspaceAdminController } from "./admin.manager-workspace.controller";

export function adminManagerWorkspaceRoutes(
  controller: ManagerWorkspaceAdminController,
): Router {
  const router = Router();

  router.get(
    "/context",
    withCommand("MANAGER_WORKSPACE_CONTEXT"),
    controller.execute,
  );
  router.get(
    "/work-schedule/work-shifts",
    withCommand("MANAGER_WORKSPACE_LIST_WORK_SHIFTS"),
    controller.execute,
  );

  return router;
}
