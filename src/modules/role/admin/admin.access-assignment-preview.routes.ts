import { Router } from "express";
import { withCommand } from "@app/base/command.middleware";
import { AdminAccessAssignmentPreviewController } from "./admin.access-assignment-preview.controller";

export function adminAccessAssignmentPreviewRoutes(
  controller: AdminAccessAssignmentPreviewController,
): Router {
  const router = Router();

  router.post(
    "/preview",
    withCommand("ACCESS_ASSIGNMENT_PREVIEW"),
    controller.execute,
  );

  router.post(
    "/apply",
    withCommand("ACCESS_ASSIGNMENT_APPLY"),
    controller.execute,
  );

  router.get(
    "/targets",
    withCommand("ACCESS_ASSIGNMENT_TARGET_OPTIONS"),
    controller.execute,
  );

  return router;
}
