import { Router } from "express";
import { withCommand } from "@app/base/command.middleware";
import { UserAdminController } from "./admin.user.controller";
import { UserQueryAdminController } from "./admin.user.query.controller";

export function userAdminRoutes(
  mutationController: UserAdminController,
  queryController: UserQueryAdminController,
): Router {
  const router = Router();

  router.post(
    "/",
    withCommand("USER_CREATE"),
    mutationController.execute,
  );

  router.post(
    "/provision",
    withCommand("USER_PROVISION"),
    mutationController.execute,
  );

  router.get(
    "/",
    withCommand("USER_LIST"),
    queryController.execute,
  );

  router.get(
    "/:userId",
    withCommand("USER_GET_DETAIL"),
    queryController.execute,
  );

  router.patch(
    "/:userId",
    withCommand("USER_UPDATE"),
    mutationController.execute,
  );

  router.post(
    "/:userId/activate",
    withCommand("USER_ACTIVATE"),
    mutationController.execute,
  );

  router.post(
    "/:userId/disable",
    withCommand("USER_DISABLE"),
    mutationController.execute,
  );

  router.post(
    "/:userId/archive",
    withCommand("USER_ARCHIVE"),
    mutationController.execute,
  );

  router.put(
    "/:userId/auth-linkage",
    withCommand("USER_AUTH_LINKAGE_SET"),
    mutationController.execute,
  );

  router.delete(
    "/:userId/auth-linkage",
    withCommand("USER_AUTH_LINKAGE_UNLINK"),
    mutationController.execute,
  );

  router.post(
    "/:userId/send-password-setup",
    withCommand("USER_PASSWORD_SETUP_SEND"),
    mutationController.execute,
  );

  return router;
}
