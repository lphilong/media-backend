import { Router } from "express";
import { withCommand } from "@app/base/command.middleware";
import { AdminRoleBundleController } from "./admin.role-bundle.controller";

export function adminRoleBundleRoutes(controller: AdminRoleBundleController): Router {
  const router = Router();
  router.get("/", withCommand("ROLE_BUNDLE_LIST"), controller.execute);
  router.post(
    "/:bundleCode/versions/:bundleVersion/assignments",
    withCommand("ROLE_BUNDLE_ASSIGN"),
    controller.execute,
  );
  return router;
}
