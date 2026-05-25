import { Router } from "express";
import { withCommand } from "@app/base/command.middleware";
import { SelfServiceCurrentPersonController } from "./self-service.current-person.controller";
import { SelfServiceEventsController } from "./self-service.events.controller";
import { SelfServiceWorkShiftsController } from "./self-service.work-shifts.controller";

export function selfServiceRoutes(
  currentPersonController: SelfServiceCurrentPersonController,
  workShiftsController: SelfServiceWorkShiftsController,
  eventsController: SelfServiceEventsController,
): Router {
  const router = Router();

  router.get(
    "/me",
    withCommand("SELF_SERVICE_CURRENT_PERSON"),
    currentPersonController.execute,
  );

  router.get(
    "/work-shifts",
    withCommand("SELF_SERVICE_WORK_SHIFTS_LIST"),
    workShiftsController.execute,
  );

  router.get(
    "/events",
    withCommand("SELF_SERVICE_EVENTS_LIST"),
    eventsController.execute,
  );

  return router;
}
