import { Router } from "express";
import { withCommand } from "@app/base/command.middleware";
import { WorkScheduleRequestAdminController } from "./admin.work-schedule-request.controller";

export function adminWorkScheduleRequestRoutes(
  controller: WorkScheduleRequestAdminController,
): Router {
  const router = Router();

  router.get(
    "/",
    withCommand("WORK_SCHEDULE_REQUEST_LIST"),
    controller.execute,
  );

  router.get(
    "/:requestId",
    withCommand("WORK_SCHEDULE_REQUEST_GET_DETAIL"),
    controller.execute,
  );

  router.post(
    "/",
    withCommand("WORK_SCHEDULE_REQUEST_CREATE"),
    controller.execute,
  );

  router.post(
    "/:requestId/cancel",
    withCommand("WORK_SCHEDULE_REQUEST_CANCEL"),
    controller.execute,
  );

  router.post(
    "/:requestId/approve",
    withCommand("WORK_SCHEDULE_REQUEST_APPROVE"),
    controller.execute,
  );

  router.post(
    "/:requestId/reject",
    withCommand("WORK_SCHEDULE_REQUEST_REJECT"),
    controller.execute,
  );

  return router;
}
