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
  router.get(
    "/work-schedule/request-batches",
    withCommand(
      "MANAGER_WORKSPACE_LIST_WORK_SCHEDULE_REQUEST_BATCHES",
    ),
    controller.execute,
  );
  router.post(
    "/work-schedule/request-batches",
    withCommand(
      "MANAGER_WORKSPACE_SUBMIT_WORK_SCHEDULE_REQUEST_BATCH",
    ),
    controller.execute,
  );
  router.get(
    "/work-schedule/request-batches/:batchId",
    withCommand(
      "MANAGER_WORKSPACE_GET_WORK_SCHEDULE_REQUEST_BATCH",
    ),
    controller.execute,
  );
  router.post(
    "/work-schedule/request-batches/:batchId/cancel",
    withCommand(
      "MANAGER_WORKSPACE_CANCEL_WORK_SCHEDULE_REQUEST_BATCH",
    ),
    controller.execute,
  );
  router.post(
    "/work-schedule/request-batches/:batchId/lines/:lineId/cancel",
    withCommand(
      "MANAGER_WORKSPACE_CANCEL_WORK_SCHEDULE_REQUEST_LINE",
    ),
    controller.execute,
  );

  return router;
}
