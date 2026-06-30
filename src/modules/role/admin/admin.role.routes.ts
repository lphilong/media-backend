import { Router } from "express";
import { withCommand } from "@app/base/command.middleware";
import { AdminRoleController } from "./admin.role.controller";
import { AdminRoleQueryController } from "./admin.role.query.controller";

export function adminRoleRoutes(
  mutationController: AdminRoleController,
  queryController: AdminRoleQueryController,
): Router {
  const router = Router();

  router.post(
    "/",
    withCommand("ROLE_CREATE"),
    mutationController.execute,
  );

  router.get(
    "/",
    withCommand("ROLE_LIST"),
    queryController.execute,
  );

  router.post(
    "/from-template",
    withCommand("ROLE_CREATE_FROM_TEMPLATE"),
    mutationController.execute,
  );

  router.get(
    "/:roleId",
    withCommand("ROLE_GET_DETAIL"),
    queryController.execute,
  );

  router.patch(
    "/:roleId",
    withCommand("ROLE_UPDATE"),
    mutationController.execute,
  );

  router.post(
    "/:roleId/activate",
    withCommand("ROLE_ACTIVATE"),
    mutationController.execute,
  );

  router.post(
    "/:roleId/deactivate",
    withCommand("ROLE_DEACTIVATE"),
    mutationController.execute,
  );

  router.post(
    "/:roleId/archive",
    withCommand("ROLE_ARCHIVE"),
    mutationController.execute,
  );

  router.put(
    "/:roleId/permissions",
    withCommand("ROLE_PERMISSION_ASSIGN"),
    mutationController.execute,
  );

  router.put(
    "/:roleId/assignment-rules",
    withCommand("ROLE_ASSIGNMENT_RULE_SET"),
    mutationController.execute,
  );

  router.get(
    "/:roleId/permission-matrix",
    withCommand("ROLE_PERMISSION_MATRIX"),
    queryController.execute,
  );

  return router;
}
