import { Router } from "express";
import { withCommand } from "@app/base/command.middleware";
import { TalentAdminController } from "./admin.talent.controller";
import { TalentAdminQueryController } from "./admin.talent.query.controller";

export function adminTalentRoutes(
  mutationController: TalentAdminController,
  queryController: TalentAdminQueryController,
): Router {
  const router = Router();

  router.post(
    "/",
    withCommand("TALENT_CREATE"),
    mutationController.execute,
  );

  router.get(
    "/",
    withCommand("TALENT_LIST"),
    queryController.execute,
  );

  router.get(
    "/:talentId",
    withCommand("TALENT_GET_DETAIL"),
    queryController.execute,
  );

  router.patch(
    "/:talentId",
    withCommand("TALENT_UPDATE_CORE"),
    mutationController.execute,
  );

  router.post(
    "/:talentId/manager-assignment",
    withCommand("TALENT_ASSIGN_MANAGER"),
    mutationController.execute,
  );

  router.post(
    "/:talentId/employment-profile-link",
    withCommand("TALENT_LINK_EMPLOYMENT_PROFILE"),
    mutationController.execute,
  );

  router.post(
    "/:talentId/suspend",
    withCommand("TALENT_SUSPEND"),
    mutationController.execute,
  );

  router.post(
    "/:talentId/reactivate",
    withCommand("TALENT_REACTIVATE"),
    mutationController.execute,
  );

  router.post(
    "/:talentId/deactivate",
    withCommand("TALENT_DEACTIVATE"),
    mutationController.execute,
  );

  router.post(
    "/:talentId/archive",
    withCommand("TALENT_ARCHIVE"),
    mutationController.execute,
  );

  router.post(
    "/:talentId/commercial-participation-status",
    withCommand(
      "TALENT_UPDATE_COMMERCIAL_PARTICIPATION",
    ),
    mutationController.execute,
  );

  return router;
}
