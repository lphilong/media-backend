import { Router } from "express";
import { withCommand } from "@app/base/command.middleware";
import { WorkScheduleAdminController } from "./admin.work-schedule.controller";
import { WorkScheduleAdminQueryController } from "./admin.work-schedule.query.controller";

export function adminWorkScheduleRoutes(
  mutationController: WorkScheduleAdminController,
  queryController: WorkScheduleAdminQueryController,
): Router {
  const router = Router();

  router.post(
    "/",
    withCommand("WORK_SHIFT_CREATE"),
    mutationController.execute,
  );

  router.get(
    "/",
    withCommand("WORK_SHIFT_LIST"),
    queryController.execute,
  );

  router.get(
    "/by-subject",
    withCommand("WORK_SHIFT_LIST_BY_SUBJECT"),
    queryController.execute,
  );

  router.get(
    "/by-resource",
    withCommand("WORK_SHIFT_LIST_BY_RESOURCE"),
    queryController.execute,
  );

  router.get(
    "/:workShiftId",
    withCommand("WORK_SHIFT_GET_DETAIL"),
    queryController.execute,
  );

  router.patch(
    "/:workShiftId",
    withCommand("WORK_SHIFT_UPDATE_CORE"),
    mutationController.execute,
  );

  router.post(
    "/:workShiftId/reschedule",
    withCommand("WORK_SHIFT_RESCHEDULE"),
    mutationController.execute,
  );

  router.post(
    "/:workShiftId/reassign-subject",
    withCommand("WORK_SHIFT_REASSIGN_SUBJECT"),
    mutationController.execute,
  );

  router.post(
    "/:workShiftId/resources",
    withCommand("WORK_SHIFT_UPDATE_RESOURCES"),
    mutationController.execute,
  );

  router.post(
    "/:workShiftId/cancel",
    withCommand("WORK_SHIFT_CANCEL"),
    mutationController.execute,
  );

  router.post(
    "/:workShiftId/archive",
    withCommand("WORK_SHIFT_ARCHIVE"),
    mutationController.execute,
  );

  return router;
}
