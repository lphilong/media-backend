import { Router } from "express";
import { withCommand } from "@app/base/command.middleware";
import { MonthlyRosterAdminController } from "./admin.monthly-roster.controller";
import { MonthlyRosterAdminQueryController } from "./admin.monthly-roster.query.controller";

export function adminMonthlyRosterRoutes(
  mutationController: MonthlyRosterAdminController,
  queryController: MonthlyRosterAdminQueryController,
): Router {
  const router = Router();

  router.post(
    "/",
    withCommand("MONTHLY_ROSTER_CREATE_DRAFT"),
    mutationController.execute,
  );

  router.get(
    "/",
    withCommand("MONTHLY_ROSTER_LIST"),
    queryController.execute,
  );

  router.get(
    "/:monthlyRosterId/preview",
    withCommand("MONTHLY_ROSTER_PREVIEW"),
    queryController.execute,
  );

  router.get(
    "/:monthlyRosterId",
    withCommand("MONTHLY_ROSTER_GET_DETAIL"),
    queryController.execute,
  );

  router.patch(
    "/:monthlyRosterId",
    withCommand("MONTHLY_ROSTER_UPDATE_DRAFT"),
    mutationController.execute,
  );

  router.post(
    "/:monthlyRosterId/archive",
    withCommand("MONTHLY_ROSTER_ARCHIVE"),
    mutationController.execute,
  );

  router.post(
    "/:monthlyRosterId/publish",
    withCommand("MONTHLY_ROSTER_PUBLISH"),
    mutationController.execute,
  );

  router.post(
    "/:monthlyRosterId/exceptions",
    withCommand("ROSTER_EXCEPTION_ADD"),
    mutationController.execute,
  );

  router.patch(
    "/:monthlyRosterId/exceptions/:rosterExceptionId",
    withCommand("ROSTER_EXCEPTION_UPDATE"),
    mutationController.execute,
  );

  router.post(
    "/:monthlyRosterId/exceptions/:rosterExceptionId/remove",
    withCommand("ROSTER_EXCEPTION_REMOVE"),
    mutationController.execute,
  );

  return router;
}
