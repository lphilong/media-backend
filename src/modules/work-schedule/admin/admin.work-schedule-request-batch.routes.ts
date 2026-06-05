import { Router } from "express";
import { withCommand } from "@app/base/command.middleware";
import { WorkScheduleRequestBatchAdminController } from "./admin.work-schedule-request-batch.controller";

export function adminWorkScheduleRequestBatchRoutes(
  controller: WorkScheduleRequestBatchAdminController,
): Router {
  const router = Router();

  router.get(
    "/",
    withCommand("WORK_SCHEDULE_REQUEST_BATCH_LIST"),
    controller.execute,
  );

  router.get(
    "/:batchId",
    withCommand("WORK_SCHEDULE_REQUEST_BATCH_GET_DETAIL"),
    controller.execute,
  );

  router.post(
    "/:batchId/approve-lines",
    withCommand("WORK_SCHEDULE_REQUEST_BATCH_APPROVE_LINES"),
    controller.execute,
  );

  router.post(
    "/:batchId/reject-lines",
    withCommand("WORK_SCHEDULE_REQUEST_BATCH_REJECT_LINES"),
    controller.execute,
  );

  router.post(
    "/:batchId/cancel-lines",
    withCommand("WORK_SCHEDULE_REQUEST_BATCH_CANCEL_LINES"),
    controller.execute,
  );

  return router;
}
