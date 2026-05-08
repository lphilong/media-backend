import { Router } from "express";
import { withCommand } from "@app/base/command.middleware";
import { EmploymentProfileAdminController } from "./admin.employment-profile.controller";
import { EmploymentProfileAdminQueryController } from "./admin.employment-profile.query.controller";

export function adminEmploymentProfileRoutes(
  mutationController: EmploymentProfileAdminController,
  queryController: EmploymentProfileAdminQueryController,
): Router {
  const router = Router();

  router.post(
    "/",
    withCommand("EMPLOYMENT_PROFILE_CREATE"),
    mutationController.execute,
  );

  router.get(
    "/",
    withCommand("EMPLOYMENT_PROFILE_LIST"),
    queryController.execute,
  );

  router.get(
    "/:employmentProfileId",
    withCommand("EMPLOYMENT_PROFILE_GET_DETAIL"),
    queryController.execute,
  );

  router.get(
    "/:employmentProfileId/direct-reports",
    withCommand(
      "EMPLOYMENT_PROFILE_LIST_DIRECT_REPORTS",
    ),
    queryController.execute,
  );

  router.patch(
    "/:employmentProfileId",
    withCommand("EMPLOYMENT_PROFILE_UPDATE_CORE"),
    mutationController.execute,
  );

  router.post(
    "/:employmentProfileId/org-unit-assignment",
    withCommand(
      "EMPLOYMENT_PROFILE_ASSIGN_ORG_UNIT",
    ),
    mutationController.execute,
  );

  router.post(
    "/:employmentProfileId/manager-assignment",
    withCommand(
      "EMPLOYMENT_PROFILE_ASSIGN_MANAGER",
    ),
    mutationController.execute,
  );

  router.post(
    "/:employmentProfileId/user-link",
    withCommand("EMPLOYMENT_PROFILE_LINK_USER"),
    mutationController.execute,
  );

  router.post(
    "/:employmentProfileId/user-unlink",
    withCommand("EMPLOYMENT_PROFILE_UNLINK_USER"),
    mutationController.execute,
  );

  router.post(
    "/:employmentProfileId/place-on-leave",
    withCommand(
      "EMPLOYMENT_PROFILE_PLACE_ON_LEAVE",
    ),
    mutationController.execute,
  );

  router.post(
    "/:employmentProfileId/return-from-leave",
    withCommand(
      "EMPLOYMENT_PROFILE_RETURN_FROM_LEAVE",
    ),
    mutationController.execute,
  );

  router.post(
    "/:employmentProfileId/suspend",
    withCommand("EMPLOYMENT_PROFILE_SUSPEND"),
    mutationController.execute,
  );

  router.post(
    "/:employmentProfileId/reactivate",
    withCommand("EMPLOYMENT_PROFILE_REACTIVATE"),
    mutationController.execute,
  );

  router.post(
    "/:employmentProfileId/terminate",
    withCommand("EMPLOYMENT_PROFILE_TERMINATE"),
    mutationController.execute,
  );

  router.post(
    "/:employmentProfileId/archive",
    withCommand("EMPLOYMENT_PROFILE_ARCHIVE"),
    mutationController.execute,
  );

  router.post(
    "/:employmentProfileId/contract-status",
    withCommand(
      "EMPLOYMENT_PROFILE_UPDATE_CONTRACT_STATUS",
    ),
    mutationController.execute,
  );

  return router;
}
