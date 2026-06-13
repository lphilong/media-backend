import { Router } from "express";
import { withCommand } from "@app/base/command.middleware";
import { PlatformEarningAdminController } from "./admin.platform-earning.controller";

export function adminPlatformEarningRoutes(
  controller: PlatformEarningAdminController,
): Router {
  const router = Router();

  router.get(
    "/platform-earning-batches",
    withCommand("PLATFORM_EARNING_BATCH_LIST"),
    controller.execute,
  );

  router.post(
    "/platform-earning-batches",
    withCommand("PLATFORM_EARNING_BATCH_CREATE"),
    controller.execute,
  );

  router.get(
    "/platform-earning-batches/:batchId",
    withCommand("PLATFORM_EARNING_BATCH_GET"),
    controller.execute,
  );

  router.patch(
    "/platform-earning-batches/:batchId",
    withCommand("PLATFORM_EARNING_BATCH_UPDATE"),
    controller.execute,
  );

  router.get(
    "/platform-earning-batches/:batchId/source-lines",
    withCommand("PLATFORM_EARNING_LINE_LIST"),
    controller.execute,
  );

  router.post(
    "/platform-earning-batches/:batchId/source-lines",
    withCommand("PLATFORM_EARNING_LINE_ADD"),
    controller.execute,
  );

  router.patch(
    "/platform-earning-batches/:batchId/source-lines/:lineId",
    withCommand("PLATFORM_EARNING_LINE_UPDATE"),
    controller.execute,
  );

  router.post(
    "/platform-earning-batches/:batchId/submit",
    withCommand("PLATFORM_EARNING_BATCH_SUBMIT"),
    controller.execute,
  );

  router.post(
    "/platform-earning-batches/:batchId/start-review",
    withCommand("PLATFORM_EARNING_BATCH_START_REVIEW"),
    controller.execute,
  );

  router.post(
    "/platform-earning-batches/:batchId/approve",
    withCommand("PLATFORM_EARNING_BATCH_APPROVE"),
    controller.execute,
  );

  router.post(
    "/platform-earning-batches/:batchId/reject",
    withCommand("PLATFORM_EARNING_BATCH_REJECT"),
    controller.execute,
  );

  router.post(
    "/platform-earning-batches/:batchId/void",
    withCommand("PLATFORM_EARNING_BATCH_VOID"),
    controller.execute,
  );

  router.post(
    "/platform-earning-batches/:batchId/archive",
    withCommand("PLATFORM_EARNING_BATCH_ARCHIVE"),
    controller.execute,
  );

  router.post(
    "/platform-earning-batches/:batchId/create-revenue-entry",
    withCommand("PLATFORM_EARNING_BATCH_CREATE_REVENUE_ENTRY"),
    controller.execute,
  );

  return router;
}
