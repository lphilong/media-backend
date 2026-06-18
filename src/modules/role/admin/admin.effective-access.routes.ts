import { Router } from "express";
import { withCommand } from "@app/base/command.middleware";
import { AdminEffectiveAccessController } from "./admin.effective-access.controller";

export function adminEffectiveAccessRoutes(
  controller: AdminEffectiveAccessController,
): Router {
  const router = Router();
  router.get(
    "/users/:userId",
    withCommand("EFFECTIVE_ACCESS_GET"),
    controller.execute,
  );
  return router;
}
