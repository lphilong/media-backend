import { Router } from "express";
import { withCommand } from "@app/base/command.middleware";
import { ReferenceLookupAdminController } from "./admin.reference-lookup.controller";

export function adminReferenceLookupRoutes(
  controller: ReferenceLookupAdminController,
): Router {
  const router = Router();

  router.get(
    "/org-units",
    withCommand("REFERENCE_LOOKUP_ORG_UNITS"),
    controller.execute,
  );
  router.get(
    "/employment-profiles",
    withCommand("REFERENCE_LOOKUP_EMPLOYMENT_PROFILES"),
    controller.execute,
  );
  router.get(
    "/talents",
    withCommand("REFERENCE_LOOKUP_TALENTS"),
    controller.execute,
  );
  router.get(
    "/talent-groups",
    withCommand("REFERENCE_LOOKUP_TALENT_GROUPS"),
    controller.execute,
  );
  router.get(
    "/platform-accounts",
    withCommand("REFERENCE_LOOKUP_PLATFORM_ACCOUNTS"),
    controller.execute,
  );
  router.get(
    "/studio-resources",
    withCommand("REFERENCE_LOOKUP_STUDIO_RESOURCES"),
    controller.execute,
  );
  router.get(
    "/events",
    withCommand("REFERENCE_LOOKUP_EVENTS"),
    controller.execute,
  );
  router.get(
    "/contract-records",
    withCommand("REFERENCE_LOOKUP_CONTRACT_RECORDS"),
    controller.execute,
  );
  router.get(
    "/revenue-entries",
    withCommand("REFERENCE_LOOKUP_REVENUE_ENTRIES"),
    controller.execute,
  );
  router.get(
    "/commission-rules",
    withCommand("REFERENCE_LOOKUP_COMMISSION_RULES"),
    controller.execute,
  );

  return router;
}
