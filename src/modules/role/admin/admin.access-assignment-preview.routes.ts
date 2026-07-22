import { Router } from "express";
import { withCommand } from "@app/base/command.middleware";
import { AdminAccessAssignmentPreviewController } from "./admin.access-assignment-preview.controller";

export function adminAccessAssignmentPreviewRoutes(
  controller: AdminAccessAssignmentPreviewController,
): Router {
  const router = Router();

  router.get("/", withCommand("ACCESS_ASSIGNMENT_LIST"), controller.execute);

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

  router.post(
    "/:assignmentId/revoke",
    withCommand("ACCESS_ASSIGNMENT_REVOKE"),
    controller.execute,
  );

  router.get(
    "/lifecycle",
    withCommand("ACCESS_LIFECYCLE_STATUS"),
    controller.execute,
  );

  router.post(
    "/lifecycle/reviews/:cycleId/decision",
    withCommand("ACCESS_LIFECYCLE_REVIEW_DECIDE"),
    controller.execute,
  );
  router.post(
    "/lifecycle/grace-exceptions",
    withCommand("ACCESS_LIFECYCLE_GRACE_REQUEST"),
    controller.execute,
  );
  router.post(
    "/lifecycle/grace-exceptions/:exceptionId/decision",
    withCommand("ACCESS_LIFECYCLE_GRACE_DECIDE"),
    controller.execute,
  );
  router.post(
    "/lifecycle/successors",
    withCommand("ACCESS_LIFECYCLE_SUCCESSOR_REQUEST"),
    controller.execute,
  );
  router.post(
    "/lifecycle/successors/:requestId/decision",
    withCommand("ACCESS_LIFECYCLE_SUCCESSOR_DECIDE"),
    controller.execute,
  );
  router.get(
    "/break-glass",
    withCommand("BREAK_GLASS_LIST"),
    controller.execute,
  );
  router.post(
    "/break-glass",
    withCommand("BREAK_GLASS_REQUEST"),
    controller.execute,
  );
  router.post(
    "/break-glass/:requestId/decision",
    withCommand("BREAK_GLASS_APPROVE"),
    controller.execute,
  );
  router.post(
    "/break-glass/activations/:activationId/review",
    withCommand("BREAK_GLASS_REVIEW"),
    controller.execute,
  );
  router.post(
    "/break-glass/activations/:activationId/end",
    withCommand("BREAK_GLASS_END"),
    controller.execute,
  );
  router.get(
    "/governance",
    withCommand("GOVERNANCE_STATUS"),
    controller.execute,
  );
  router.post(
    "/governance/successors",
    withCommand("GOVERNANCE_SUCCESSOR_PROPOSE"),
    controller.execute,
  );
  router.post(
    "/governance/successors/:principalId/decision",
    withCommand("GOVERNANCE_SUCCESSOR_DECIDE"),
    controller.execute,
  );
  router.post(
    "/governance/successors/:principalId/activate",
    withCommand("GOVERNANCE_SUCCESSOR_ACTIVATE"),
    controller.execute,
  );

  return router;
}
