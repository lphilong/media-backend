import { Router } from "express";
import { withCommand } from "@app/base/command.middleware";
import { ResponsibilityAdminController } from "./admin.responsibility.controller";

export function adminResponsibilityRoutes(
  controller: ResponsibilityAdminController,
): Router {
  const router = Router();

  router.get(
    "/",
    withCommand("RESPONSIBILITY_ASSIGNMENT_LIST"),
    controller.execute,
  );
  router.post(
    "/",
    withCommand("RESPONSIBILITY_ASSIGNMENT_CREATE"),
    controller.execute,
  );
  router.get(
    "/summary/:subjectType/:subjectId",
    withCommand("RESPONSIBILITY_ASSIGNMENT_SUMMARY"),
    controller.execute,
  );
  router.get(
    "/:assignmentId",
    withCommand("RESPONSIBILITY_ASSIGNMENT_DETAIL"),
    controller.execute,
  );
  router.patch(
    "/:assignmentId",
    withCommand("RESPONSIBILITY_ASSIGNMENT_UPDATE"),
    controller.execute,
  );
  router.post(
    "/:assignmentId/revoke",
    withCommand("RESPONSIBILITY_ASSIGNMENT_REVOKE"),
    controller.execute,
  );

  return router;
}

