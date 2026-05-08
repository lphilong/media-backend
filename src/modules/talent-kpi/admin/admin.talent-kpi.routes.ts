import { Router } from "express";
import { withCommand } from "@app/base/command.middleware";
import { TalentKpiAdminController } from "./admin.talent-kpi.controller";
import { TalentKpiAdminQueryController } from "./admin.talent-kpi.query.controller";

export function adminTalentKpiRoutes(
  mutationController: TalentKpiAdminController,
  queryController: TalentKpiAdminQueryController,
): Router {
  const router = Router();

  router.post(
    "/",
    withCommand("TALENT_KPI_RECORD_CREATE"),
    mutationController.execute,
  );

  router.get(
    "/",
    withCommand("TALENT_KPI_RECORD_LIST"),
    queryController.execute,
  );

  router.get(
    "/by-talent",
    withCommand("TALENT_KPI_RECORD_LIST_BY_TALENT"),
    queryController.execute,
  );

  router.get(
    "/by-platform",
    withCommand("TALENT_KPI_RECORD_LIST_BY_PLATFORM"),
    queryController.execute,
  );

  router.get(
    "/by-event",
    withCommand("TALENT_KPI_RECORD_LIST_BY_EVENT"),
    queryController.execute,
  );

  router.get(
    "/:talentKpiRecordId/metrics",
    withCommand("TALENT_KPI_RECORD_LIST_METRICS"),
    queryController.execute,
  );

  router.get(
    "/:talentKpiRecordId",
    withCommand("TALENT_KPI_RECORD_GET_DETAIL"),
    queryController.execute,
  );

  router.patch(
    "/:talentKpiRecordId/draft-core",
    withCommand("TALENT_KPI_RECORD_UPDATE_DRAFT_CORE"),
    mutationController.execute,
  );

  router.post(
    "/:talentKpiRecordId/metrics",
    withCommand("TALENT_KPI_RECORD_REPLACE_METRICS"),
    mutationController.execute,
  );

  router.post(
    "/:talentKpiRecordId/finalize",
    withCommand("TALENT_KPI_RECORD_FINALIZE"),
    mutationController.execute,
  );

  router.post(
    "/:talentKpiRecordId/archive",
    withCommand("TALENT_KPI_RECORD_ARCHIVE"),
    mutationController.execute,
  );

  return router;
}
