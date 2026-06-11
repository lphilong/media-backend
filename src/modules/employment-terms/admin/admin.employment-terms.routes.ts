import { Router } from "express";
import { withCommand } from "@app/base/command.middleware";
import { EmploymentTermsAdminController } from "./admin.employment-terms.controller";

export function adminEmploymentTermsRoutes(controller: EmploymentTermsAdminController): Router {
  const router = Router({ mergeParams: true });
  router.get("/", withCommand("EMPLOYMENT_TERMS_LIST"), controller.execute);
  router.get("/:termsId", withCommand("EMPLOYMENT_TERMS_GET"), controller.execute);
  router.post("/", withCommand("EMPLOYMENT_TERMS_CREATE"), controller.execute);
  router.patch("/:termsId", withCommand("EMPLOYMENT_TERMS_UPDATE"), controller.execute);
  router.post("/:termsId/submit", withCommand("EMPLOYMENT_TERMS_SUBMIT"), controller.execute);
  router.post("/:termsId/approve", withCommand("EMPLOYMENT_TERMS_APPROVE"), controller.execute);
  router.post("/:termsId/cancel", withCommand("EMPLOYMENT_TERMS_CANCEL"), controller.execute);
  return router;
}
