import { Db } from "mongodb";

export const KPI_PLAN_CODE_UNIQ_INDEX_NAME = "uniq_kpi_plan_code";
export const KPI_PLAN_SUBJECT_PERIOD_STATUS_INDEX_NAME =
  "idx_kpi_plan_subject_period_status";
export const KPI_PLAN_STATUS_PERIOD_INDEX_NAME =
  "idx_kpi_plan_status_period";
export const KPI_TARGET_PLAN_METRIC_UNIQ_INDEX_NAME =
  "uniq_kpi_target_plan_metric";
export const KPI_TARGET_METRIC_PLAN_INDEX_NAME =
  "idx_kpi_target_metric_plan";
export const KPI_ALLOCATION_PLAN_MEMBER_UNIQ_INDEX_NAME =
  "uniq_kpi_allocation_plan_member";
export const KPI_ALLOCATION_GROUP_MEMBER_INDEX_NAME =
  "idx_kpi_allocation_group_member";
export const TALENT_GROUP_MANAGER_ASSIGNMENT_GROUP_ACTIVE_INDEX_NAME =
  "idx_tg_manager_assignment_group_active";
export const TALENT_GROUP_MANAGER_ASSIGNMENT_MANAGER_ACTIVE_INDEX_NAME =
  "idx_tg_manager_assignment_manager_active";
export const KPI_ACTUAL_ENTRY_UNIQ_INDEX_NAME =
  "uniq_kpi_actual_entry_identity";
export const KPI_ACTUAL_ENTRY_LOOKUP_INDEX_NAME =
  "idx_kpi_actual_entry_lookup";
export const KPI_ACTUAL_ENTRY_PLAN_METRIC_INDEX_NAME =
  "idx_kpi_actual_entry_plan_metric";
export const KPI_ACTUAL_CORRECTION_ENTRY_INDEX_NAME =
  "idx_kpi_actual_correction_entry";

export async function initKpiIndexes(db: Db): Promise<void> {
  const plans = db.collection("kpi_plans");
  const targets = db.collection("kpi_target_metrics");
  const allocations = db.collection("kpi_allocations");
  const actualEntries = db.collection("kpi_actual_entries");
  const actualCorrections = db.collection("kpi_actual_corrections");
  const managerAssignments = db.collection(
    "talent_group_manager_assignments",
  );

  await plans.createIndex(
    { planCode: 1 },
    { name: KPI_PLAN_CODE_UNIQ_INDEX_NAME, unique: true },
  );
  await plans.createIndex(
    { subjectType: 1, subjectId: 1, periodMonth: 1, status: 1 },
    { name: KPI_PLAN_SUBJECT_PERIOD_STATUS_INDEX_NAME },
  );
  await plans.createIndex(
    { status: 1, periodMonth: -1, _id: 1 },
    { name: KPI_PLAN_STATUS_PERIOD_INDEX_NAME },
  );
  await targets.createIndex(
    { kpiPlanId: 1, metricCode: 1 },
    { name: KPI_TARGET_PLAN_METRIC_UNIQ_INDEX_NAME, unique: true },
  );
  await targets.createIndex(
    { metricCode: 1, kpiPlanId: 1 },
    { name: KPI_TARGET_METRIC_PLAN_INDEX_NAME },
  );
  await allocations.createIndex(
    { kpiPlanId: 1, memberTalentId: 1 },
    { name: KPI_ALLOCATION_PLAN_MEMBER_UNIQ_INDEX_NAME, unique: true },
  );
  await allocations.createIndex(
    { groupId: 1, memberTalentId: 1, allocationStatus: 1 },
    { name: KPI_ALLOCATION_GROUP_MEMBER_INDEX_NAME },
  );
  await managerAssignments.createIndex(
    { groupId: 1, status: 1, effectiveFrom: 1, effectiveTo: 1 },
    { name: TALENT_GROUP_MANAGER_ASSIGNMENT_GROUP_ACTIVE_INDEX_NAME },
  );
  await managerAssignments.createIndex(
    {
      managerEmploymentProfileId: 1,
      status: 1,
      effectiveFrom: 1,
      effectiveTo: 1,
    },
    {
      name: TALENT_GROUP_MANAGER_ASSIGNMENT_MANAGER_ACTIVE_INDEX_NAME,
    },
  );
  await actualEntries.createIndex(
    { kpiPlanId: 1, allocationId: 1, metricCode: 1, actualDate: 1 },
    { name: KPI_ACTUAL_ENTRY_UNIQ_INDEX_NAME, unique: true },
  );
  await actualEntries.createIndex(
    { kpiPlanId: 1, allocationId: 1, metricCode: 1, actualDate: 1, _id: 1 },
    { name: KPI_ACTUAL_ENTRY_LOOKUP_INDEX_NAME },
  );
  await actualEntries.createIndex(
    { kpiPlanId: 1, metricCode: 1, allocationId: 1 },
    { name: KPI_ACTUAL_ENTRY_PLAN_METRIC_INDEX_NAME },
  );
  await actualCorrections.createIndex(
    { actualEntryId: 1, correctedAt: -1, _id: 1 },
    { name: KPI_ACTUAL_CORRECTION_ENTRY_INDEX_NAME },
  );
}
