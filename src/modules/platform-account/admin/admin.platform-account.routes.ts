import { Router } from "express";
import { withCommand } from "@app/base/command.middleware";
import { PlatformAccountAdminController } from "./admin.platform-account.controller";
import { PlatformAccountAdminQueryController } from "./admin.platform-account.query.controller";

export function adminPlatformAccountRoutes(
  mutationController: PlatformAccountAdminController,
  queryController: PlatformAccountAdminQueryController,
): Router {
  const router = Router();

  router.post(
    "/",
    withCommand("PLATFORM_ACCOUNT_CREATE"),
    mutationController.execute,
  );

  router.get(
    "/",
    withCommand("PLATFORM_ACCOUNT_LIST"),
    queryController.execute,
  );

  router.get(
    "/:platformAccountId",
    withCommand("PLATFORM_ACCOUNT_GET_DETAIL"),
    queryController.execute,
  );

  router.patch(
    "/:platformAccountId",
    withCommand("PLATFORM_ACCOUNT_UPDATE_CORE"),
    mutationController.execute,
  );

  router.post(
    "/:platformAccountId/ownership-transfer",
    withCommand(
      "PLATFORM_ACCOUNT_TRANSFER_OWNERSHIP",
    ),
    mutationController.execute,
  );

  router.post(
    "/:platformAccountId/activate",
    withCommand("PLATFORM_ACCOUNT_ACTIVATE"),
    mutationController.execute,
  );

  router.post(
    "/:platformAccountId/deactivate",
    withCommand("PLATFORM_ACCOUNT_DEACTIVATE"),
    mutationController.execute,
  );

  router.post(
    "/:platformAccountId/archive",
    withCommand("PLATFORM_ACCOUNT_ARCHIVE"),
    mutationController.execute,
  );

  router.post(
    "/:platformAccountId/capabilities",
    withCommand(
      "PLATFORM_ACCOUNT_UPDATE_CAPABILITIES",
    ),
    mutationController.execute,
  );

  return router;
}
