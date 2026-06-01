import { Router } from "express";
import { withCommand } from "@app/base/command.middleware";
import { KpiAdminController } from "./admin.kpi.controller";
import { KpiAdminQueryController } from "./admin.kpi.query.controller";

export function adminKpiRoutes(
  mutationController: KpiAdminController,
  queryController: KpiAdminQueryController,
): Router {
  const router = Router();

  router.get(
    "/actual-workspace/plans",
    withCommand("KPI_ACTUAL_WORKSPACE_PLAN_LIST"),
    queryController.execute,
  );
  router.get(
    "/actual-workspace/plans/:kpiPlanId",
    withCommand("KPI_ACTUAL_WORKSPACE_PLAN_GET_DETAIL"),
    queryController.execute,
  );
  router.get("/plans", withCommand("KPI_PLAN_LIST"), queryController.execute);
  router.get(
    "/allocations",
    withCommand("KPI_ALLOCATION_LIST"),
    queryController.execute,
  );
  router.get(
    "/my-progress",
    withCommand("KPI_MY_PROGRESS"),
    queryController.execute,
  );
  router.post(
    "/plans",
    withCommand("KPI_PLAN_CREATE"),
    mutationController.execute,
  );
  router.get(
    "/plans/:kpiPlanId",
    withCommand("KPI_PLAN_GET_DETAIL"),
    queryController.execute,
  );
  router.get(
    "/plans/:kpiPlanId/progress",
    withCommand("KPI_PLAN_PROGRESS"),
    queryController.execute,
  );
  router.get(
    "/plans/:kpiPlanId/managed-members",
    withCommand("KPI_PLAN_MANAGED_MEMBER_LIST"),
    queryController.execute,
  );
  router.get(
    "/plans/:kpiPlanId/actuals",
    withCommand("KPI_PLAN_ACTUAL_DAILY_GRID"),
    queryController.execute,
  );
  router.patch(
    "/plans/:kpiPlanId/draft-core",
    withCommand("KPI_PLAN_UPDATE_DRAFT_CORE"),
    mutationController.execute,
  );
  router.put(
    "/plans/:kpiPlanId/target-metrics",
    withCommand("KPI_PLAN_REPLACE_TARGET_METRICS"),
    mutationController.execute,
  );
  router.put(
    "/plans/:kpiPlanId/allocations",
    withCommand("KPI_PLAN_REPLACE_ALLOCATIONS"),
    mutationController.execute,
  );
  router.put(
    "/plans/:kpiPlanId/allocation-draft",
    withCommand("KPI_ALLOCATION_DRAFT_UPSERT"),
    mutationController.execute,
  );
  router.post(
    "/plans/:kpiPlanId/allocation-submit",
    withCommand("KPI_ALLOCATION_SUBMIT"),
    mutationController.execute,
  );
  router.post(
    "/plans/:kpiPlanId/allocation-approve",
    withCommand("KPI_ALLOCATION_APPROVE"),
    mutationController.execute,
  );
  router.post(
    "/plans/:kpiPlanId/allocation-reject",
    withCommand("KPI_ALLOCATION_REJECT"),
    mutationController.execute,
  );
  router.post(
    "/plans/:kpiPlanId/allocation-publish",
    withCommand("KPI_ALLOCATION_PUBLISH"),
    mutationController.execute,
  );
  router.post(
    "/plans/:kpiPlanId/publish",
    withCommand("KPI_PLAN_PUBLISH"),
    mutationController.execute,
  );
  router.post(
    "/plans/:kpiPlanId/actuals",
    withCommand("KPI_ACTUAL_CREATE"),
    mutationController.execute,
  );
  router.patch(
    "/plans/:kpiPlanId/actuals/:actualEntryId",
    withCommand("KPI_ACTUAL_UPDATE"),
    mutationController.execute,
  );
  router.post(
    "/plans/:kpiPlanId/actuals/:actualEntryId/corrections",
    withCommand("KPI_ACTUAL_CORRECT"),
    mutationController.execute,
  );
  router.get(
    "/plans/:kpiPlanId/actuals/:actualEntryId/corrections",
    withCommand("KPI_ACTUAL_CORRECTION_LIST"),
    queryController.execute,
  );
  router.post(
    "/plans/:kpiPlanId/finalize",
    withCommand("KPI_PLAN_FINALIZE"),
    mutationController.execute,
  );
  router.post(
    "/plans/:kpiPlanId/archive",
    withCommand("KPI_PLAN_ARCHIVE"),
    mutationController.execute,
  );

  return router;
}
