import { Router } from "express";
import { withCommand } from "@app/base/command.middleware";
import { PeopleReadinessAdminController } from "./admin.people-readiness.controller";

export function adminPeopleReadinessRoutes(controller: PeopleReadinessAdminController): Router {
  const router = Router();
  router.get("/summary", withCommand("PEOPLE_READINESS_GET_SUMMARY"), controller.execute);
  router.get("/issues", withCommand("PEOPLE_READINESS_LIST_ISSUES"), controller.execute);
  return router;
}
