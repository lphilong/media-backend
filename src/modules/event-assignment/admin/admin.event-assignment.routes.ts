import { Router } from "express";
import { withCommand } from "@app/base/command.middleware";
import { EventAssignmentAdminController } from "./admin.event-assignment.controller";
import { EventAssignmentAdminQueryController } from "./admin.event-assignment.query.controller";

export function adminEventAssignmentRoutes(
  mutationController: EventAssignmentAdminController,
  queryController: EventAssignmentAdminQueryController,
): Router {
  const router = Router();

  router.post(
    "/",
    withCommand("EVENT_CREATE"),
    mutationController.execute,
  );

  router.get(
    "/",
    withCommand("EVENT_LIST"),
    queryController.execute,
  );

  router.get(
    "/by-assignment",
    withCommand("EVENT_LIST_BY_ASSIGNMENT"),
    queryController.execute,
  );

  router.get(
    "/by-resource",
    withCommand("EVENT_LIST_BY_RESOURCE"),
    queryController.execute,
  );

  router.get(
    "/by-platform",
    withCommand("EVENT_LIST_BY_PLATFORM"),
    queryController.execute,
  );

  router.get(
    "/:eventId/assignments",
    withCommand("EVENT_ASSIGNMENT_LIST"),
    queryController.execute,
  );

  router.get(
    "/:eventId",
    withCommand("EVENT_GET_DETAIL"),
    queryController.execute,
  );

  router.patch(
    "/:eventId",
    withCommand("EVENT_UPDATE_CORE"),
    mutationController.execute,
  );

  router.post(
    "/:eventId/reschedule",
    withCommand("EVENT_RESCHEDULE"),
    mutationController.execute,
  );

  router.post(
    "/:eventId/assignments",
    withCommand("EVENT_REPLACE_ASSIGNMENTS"),
    mutationController.execute,
  );

  router.post(
    "/:eventId/studio-resources",
    withCommand("EVENT_UPDATE_STUDIO_RESOURCES"),
    mutationController.execute,
  );

  router.post(
    "/:eventId/platform-accounts",
    withCommand("EVENT_UPDATE_PLATFORM_ACCOUNTS"),
    mutationController.execute,
  );

  router.post(
    "/:eventId/start",
    withCommand("EVENT_START"),
    mutationController.execute,
  );

  router.post(
    "/:eventId/complete",
    withCommand("EVENT_COMPLETE"),
    mutationController.execute,
  );

  router.post(
    "/:eventId/cancel",
    withCommand("EVENT_CANCEL"),
    mutationController.execute,
  );

  router.post(
    "/:eventId/archive",
    withCommand("EVENT_ARCHIVE"),
    mutationController.execute,
  );

  return router;
}
