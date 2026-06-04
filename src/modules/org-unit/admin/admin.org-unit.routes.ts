import { Router } from "express";
import { withCommand } from "@app/base/command.middleware";
import { OrgUnitAdminController } from "./admin.org-unit.controller";
import { OrgUnitAdminQueryController } from "./admin.org-unit.query.controller";
import { OrgUnitResponsibilityAdminController } from "./admin.org-unit-responsibility.controller";

export function adminOrgUnitRoutes(
  mutationController: OrgUnitAdminController,
  queryController: OrgUnitAdminQueryController,
  responsibilityController: OrgUnitResponsibilityAdminController,
): Router {
  const router = Router();

  router.post(
    "/",
    withCommand("ORG_UNIT_CREATE"),
    mutationController.execute,
  );

  router.get(
    "/",
    withCommand("ORG_UNIT_LIST"),
    queryController.execute,
  );

  router.get(
    "/roots",
    withCommand("ORG_UNIT_LIST_ROOTS"),
    queryController.execute,
  );

  router.get(
    "/:orgUnitId",
    withCommand("ORG_UNIT_GET_DETAIL"),
    queryController.execute,
  );

  router.get(
    "/:orgUnitId/children",
    withCommand("ORG_UNIT_LIST_CHILDREN"),
    queryController.execute,
  );

  router.get(
    "/:orgUnitId/responsibilities",
    withCommand("ORG_UNIT_RESPONSIBILITY_LIST"),
    responsibilityController.execute,
  );

  router.patch(
    "/:orgUnitId",
    withCommand("ORG_UNIT_UPDATE_PROFILE"),
    mutationController.execute,
  );

  router.post(
    "/:orgUnitId/move",
    withCommand("ORG_UNIT_MOVE"),
    mutationController.execute,
  );

  router.post(
    "/:orgUnitId/responsibilities",
    withCommand("ORG_UNIT_RESPONSIBILITY_CREATE"),
    responsibilityController.execute,
  );

  router.patch(
    "/:orgUnitId/responsibilities/:assignmentId",
    withCommand("ORG_UNIT_RESPONSIBILITY_UPDATE"),
    responsibilityController.execute,
  );

  router.delete(
    "/:orgUnitId/responsibilities/:assignmentId",
    withCommand("ORG_UNIT_RESPONSIBILITY_REVOKE"),
    responsibilityController.execute,
  );

  router.post(
    "/:orgUnitId/activate",
    withCommand("ORG_UNIT_ACTIVATE"),
    mutationController.execute,
  );

  router.post(
    "/:orgUnitId/deactivate",
    withCommand("ORG_UNIT_DEACTIVATE"),
    mutationController.execute,
  );

  router.post(
    "/:orgUnitId/archive",
    withCommand("ORG_UNIT_ARCHIVE"),
    mutationController.execute,
  );

  return router;
}
