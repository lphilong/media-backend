import { Router } from "express";
import { withCommand } from "@app/base/command.middleware";
import { AdminRoleTemplateController } from "./admin.role-template.controller";

export function adminRoleTemplateRoutes(
  controller: AdminRoleTemplateController,
): Router {
  const router = Router();

  router.get(
    "/",
    withCommand("ROLE_TEMPLATE_LIST"),
    controller.execute,
  );

  router.post(
    "/:templateCode/preview",
    withCommand("ROLE_TEMPLATE_PREVIEW"),
    controller.execute,
  );

  return router;
}
