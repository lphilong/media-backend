import { Router } from "express";
import { withCommand } from "@app/base/command.middleware";
import { WorkPatternAdminController } from "./admin.work-pattern.controller";
import { WorkPatternAdminQueryController } from "./admin.work-pattern.query.controller";

export function adminWorkPatternRoutes(
  mutationController: WorkPatternAdminController,
  queryController: WorkPatternAdminQueryController,
): Router {
  const router = Router();

  router.post(
    "/",
    withCommand("WORK_PATTERN_CREATE"),
    mutationController.execute,
  );

  router.get(
    "/",
    withCommand("WORK_PATTERN_LIST"),
    queryController.execute,
  );

  router.get(
    "/:workPatternId",
    withCommand("WORK_PATTERN_GET_DETAIL"),
    queryController.execute,
  );

  router.patch(
    "/:workPatternId",
    withCommand("WORK_PATTERN_UPDATE"),
    mutationController.execute,
  );

  router.post(
    "/:workPatternId/activate",
    withCommand("WORK_PATTERN_ACTIVATE"),
    mutationController.execute,
  );

  router.post(
    "/:workPatternId/archive",
    withCommand("WORK_PATTERN_ARCHIVE"),
    mutationController.execute,
  );

  return router;
}
