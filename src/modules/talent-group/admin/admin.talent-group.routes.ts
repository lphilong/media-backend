import { Router } from "express";
import { withCommand } from "@app/base/command.middleware";
import { TalentGroupAdminController } from "./admin.talent-group.controller";
import { TalentGroupAdminQueryController } from "./admin.talent-group.query.controller";
import { TalentGroupManagerAssignmentAdminController } from "./admin.talent-group-manager-assignment.controller";

export function adminTalentGroupRoutes(
  mutationController: TalentGroupAdminController,
  queryController: TalentGroupAdminQueryController,
  managerAssignmentController: TalentGroupManagerAssignmentAdminController,
): Router {
  const router = Router();

  router.post(
    "/",
    withCommand("TALENT_GROUP_CREATE"),
    mutationController.execute,
  );

  router.get("/", withCommand("TALENT_GROUP_LIST"), queryController.execute);

  router.get(
    "/by-talent/:talentId",
    withCommand("TALENT_GROUP_LIST_BY_TALENT"),
    queryController.execute,
  );

  router.get(
    "/:groupId",
    withCommand("TALENT_GROUP_GET_DETAIL"),
    queryController.execute,
  );

  router.get(
    "/:groupId/members",
    withCommand("TALENT_GROUP_LIST_MEMBERS"),
    queryController.execute,
  );

  router.get(
    "/:groupId/manager-assignments",
    withCommand("TALENT_GROUP_MANAGER_ASSIGNMENT_LIST"),
    managerAssignmentController.execute,
  );

  router.patch(
    "/:groupId",
    withCommand("TALENT_GROUP_UPDATE_CORE"),
    mutationController.execute,
  );

  router.post(
    "/:groupId/activate",
    withCommand("TALENT_GROUP_ACTIVATE"),
    mutationController.execute,
  );

  router.post(
    "/:groupId/deactivate",
    withCommand("TALENT_GROUP_DEACTIVATE"),
    mutationController.execute,
  );

  router.post(
    "/:groupId/archive",
    withCommand("TALENT_GROUP_ARCHIVE"),
    mutationController.execute,
  );

  router.post(
    "/:groupId/members",
    withCommand("TALENT_GROUP_ADD_MEMBER"),
    mutationController.execute,
  );

  router.post(
    "/:groupId/manager-assignments",
    withCommand("TALENT_GROUP_MANAGER_ASSIGNMENT_CREATE"),
    managerAssignmentController.execute,
  );

  router.post(
    "/:groupId/manager-assignments/:assignmentId/revoke",
    withCommand("TALENT_GROUP_MANAGER_ASSIGNMENT_REVOKE"),
    managerAssignmentController.execute,
  );

  router.patch(
    "/members/:membershipId/lineup",
    withCommand("TALENT_GROUP_UPDATE_MEMBER_LINEUP"),
    mutationController.execute,
  );

  router.post(
    "/members/:membershipId/deactivate",
    withCommand("TALENT_GROUP_DEACTIVATE_MEMBER"),
    mutationController.execute,
  );

  router.post(
    "/members/:membershipId/reactivate",
    withCommand("TALENT_GROUP_REACTIVATE_MEMBER"),
    mutationController.execute,
  );

  router.post(
    "/members/:membershipId/remove",
    withCommand("TALENT_GROUP_REMOVE_MEMBER"),
    mutationController.execute,
  );

  return router;
}
