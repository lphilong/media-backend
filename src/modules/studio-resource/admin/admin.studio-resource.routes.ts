import { Router } from "express";
import { withCommand } from "@app/base/command.middleware";
import { StudioResourceAdminController } from "./admin.studio-resource.controller";
import { StudioResourceAdminQueryController } from "./admin.studio-resource.query.controller";

export function adminStudioResourceRoutes(
  mutationController: StudioResourceAdminController,
  queryController: StudioResourceAdminQueryController,
): Router {
  const router = Router();

  router.post(
    "/",
    withCommand("STUDIO_RESOURCE_CREATE"),
    mutationController.execute,
  );

  router.get(
    "/",
    withCommand("STUDIO_RESOURCE_LIST"),
    queryController.execute,
  );

  router.get(
    "/availability",
    withCommand("STUDIO_RESOURCE_LIST_AVAILABILITY"),
    queryController.execute,
  );

  router.get(
    "/:studioResourceId",
    withCommand("STUDIO_RESOURCE_GET_DETAIL"),
    queryController.execute,
  );

  router.patch(
    "/:studioResourceId",
    withCommand("STUDIO_RESOURCE_UPDATE_CORE"),
    mutationController.execute,
  );

  router.post(
    "/:studioResourceId/out-of-service",
    withCommand(
      "STUDIO_RESOURCE_MARK_OUT_OF_SERVICE",
    ),
    mutationController.execute,
  );

  router.post(
    "/:studioResourceId/restore-to-active",
    withCommand(
      "STUDIO_RESOURCE_RESTORE_TO_ACTIVE",
    ),
    mutationController.execute,
  );

  router.post(
    "/:studioResourceId/deactivate",
    withCommand("STUDIO_RESOURCE_DEACTIVATE"),
    mutationController.execute,
  );

  router.post(
    "/:studioResourceId/activate",
    withCommand("STUDIO_RESOURCE_ACTIVATE"),
    mutationController.execute,
  );

  router.post(
    "/:studioResourceId/archive",
    withCommand("STUDIO_RESOURCE_ARCHIVE"),
    mutationController.execute,
  );

  return router;
}
