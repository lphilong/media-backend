import { Router } from "express";
import { withCommand } from "@app/base/command.middleware";
import { WorkScheduleAvailabilityBatchAdminController } from "./admin.work-schedule-availability-batch.controller";

export function adminWorkScheduleAvailabilityBatchRoutes(
  controller: WorkScheduleAvailabilityBatchAdminController,
): Router {
  const router = Router();

  router.get(
    "/",
    withCommand("WORK_SCHEDULE_AVAILABILITY_BATCH_LIST"),
    controller.execute,
  );
  router.get(
    "/:batchId",
    withCommand("WORK_SCHEDULE_AVAILABILITY_BATCH_GET_DETAIL"),
    controller.execute,
  );
  router.post(
    "/:batchId/approve-lines",
    withCommand("WORK_SCHEDULE_AVAILABILITY_BATCH_APPROVE_LINES"),
    controller.execute,
  );
  router.post(
    "/:batchId/reject-lines",
    withCommand("WORK_SCHEDULE_AVAILABILITY_BATCH_REJECT_LINES"),
    controller.execute,
  );
  router.post(
    "/:batchId/cancel-lines",
    withCommand("WORK_SCHEDULE_AVAILABILITY_BATCH_CANCEL_LINES"),
    controller.execute,
  );

  return router;
}
