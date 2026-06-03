import { Db } from "mongodb";
import { SystemInvariantError } from "@core/error/system-error";
import {
  KPI_ALLOCATION_GROUP_MEMBER_INDEX_NAME,
  KPI_ALLOCATION_PLAN_MEMBER_UNIQ_INDEX_NAME,
  KPI_ACTUAL_CORRECTION_ENTRY_INDEX_NAME,
  KPI_ACTUAL_ENTRY_LOOKUP_INDEX_NAME,
  KPI_ACTUAL_ENTRY_PLAN_METRIC_INDEX_NAME,
  KPI_ACTUAL_ENTRY_UNIQ_INDEX_NAME,
  KPI_PLAN_CODE_UNIQ_INDEX_NAME,
  KPI_PLAN_STATUS_PERIOD_INDEX_NAME,
  KPI_PLAN_SUBJECT_PERIOD_STATUS_INDEX_NAME,
  KPI_TARGET_METRIC_PLAN_INDEX_NAME,
  KPI_TARGET_PLAN_METRIC_UNIQ_INDEX_NAME,
  ORG_UNIT_MANAGER_ASSIGNMENT_MANAGER_ACTIVE_INDEX_NAME,
  ORG_UNIT_MANAGER_ASSIGNMENT_MANAGER_ROLE_ACTIVE_INDEX_NAME,
  ORG_UNIT_MANAGER_ASSIGNMENT_ORG_UNIT_ACTIVE_INDEX_NAME,
  TALENT_GROUP_MANAGER_ASSIGNMENT_GROUP_ACTIVE_INDEX_NAME,
  TALENT_GROUP_MANAGER_ASSIGNMENT_MANAGER_ACTIVE_INDEX_NAME,
  initKpiIndexes,
} from "@infra/mongo/kpi/kpi.index";
import { registerPresenters } from "./kpi.presenter.register";
import type { BootstrapRegistrar } from "@bootstrap/module-registrar";

interface IndexMetadata {
  readonly key?: unknown;
  readonly unique?: unknown;
}

export function createKpiBootstrapRegistrar(): BootstrapRegistrar {
  return Object.freeze({
    name: "kpi",
    registerPresenters,
    async initIndexes(db: Db): Promise<void> {
      await initKpiIndexes(db);
    },
    async assertReadiness(db: Db): Promise<void> {
      await assertRequiredUniqueIndex(
        db,
        "kpi_plans",
        KPI_PLAN_CODE_UNIQ_INDEX_NAME,
        { planCode: 1 },
      );
      await assertRequiredIndex(
        db,
        "kpi_plans",
        KPI_PLAN_SUBJECT_PERIOD_STATUS_INDEX_NAME,
        { subjectType: 1, subjectId: 1, periodMonth: 1, status: 1 },
      );
      await assertRequiredIndex(
        db,
        "kpi_plans",
        KPI_PLAN_STATUS_PERIOD_INDEX_NAME,
        { status: 1, periodMonth: -1, _id: 1 },
      );
      await assertRequiredUniqueIndex(
        db,
        "kpi_target_metrics",
        KPI_TARGET_PLAN_METRIC_UNIQ_INDEX_NAME,
        { kpiPlanId: 1, metricCode: 1 },
      );
      await assertRequiredIndex(
        db,
        "kpi_target_metrics",
        KPI_TARGET_METRIC_PLAN_INDEX_NAME,
        { metricCode: 1, kpiPlanId: 1 },
      );
      await assertRequiredUniqueIndex(
        db,
        "kpi_allocations",
        KPI_ALLOCATION_PLAN_MEMBER_UNIQ_INDEX_NAME,
        { kpiPlanId: 1, memberTalentId: 1 },
      );
      await assertRequiredIndex(
        db,
        "kpi_allocations",
        KPI_ALLOCATION_GROUP_MEMBER_INDEX_NAME,
        { groupId: 1, memberTalentId: 1, allocationStatus: 1 },
      );
      await assertRequiredIndex(
        db,
        "talent_group_manager_assignments",
        TALENT_GROUP_MANAGER_ASSIGNMENT_GROUP_ACTIVE_INDEX_NAME,
        { groupId: 1, status: 1, effectiveFrom: 1, effectiveTo: 1 },
      );
      await assertRequiredIndex(
        db,
        "talent_group_manager_assignments",
        TALENT_GROUP_MANAGER_ASSIGNMENT_MANAGER_ACTIVE_INDEX_NAME,
        {
          managerEmploymentProfileId: 1,
          status: 1,
          effectiveFrom: 1,
          effectiveTo: 1,
        },
      );
      await assertRequiredIndex(
        db,
        "org_unit_manager_assignments",
        ORG_UNIT_MANAGER_ASSIGNMENT_MANAGER_ACTIVE_INDEX_NAME,
        {
          managerEmploymentProfileId: 1,
          status: 1,
          effectiveFrom: 1,
          effectiveTo: 1,
        },
      );
      await assertRequiredIndex(
        db,
        "org_unit_manager_assignments",
        ORG_UNIT_MANAGER_ASSIGNMENT_ORG_UNIT_ACTIVE_INDEX_NAME,
        { orgUnitId: 1, status: 1, effectiveFrom: 1, effectiveTo: 1 },
      );
      await assertRequiredIndex(
        db,
        "org_unit_manager_assignments",
        ORG_UNIT_MANAGER_ASSIGNMENT_MANAGER_ROLE_ACTIVE_INDEX_NAME,
        {
          managerEmploymentProfileId: 1,
          role: 1,
          status: 1,
          effectiveFrom: 1,
          effectiveTo: 1,
        },
      );
      await assertRequiredUniqueIndex(
        db,
        "kpi_actual_entries",
        KPI_ACTUAL_ENTRY_UNIQ_INDEX_NAME,
        { kpiPlanId: 1, allocationId: 1, metricCode: 1, actualDate: 1 },
      );
      await assertRequiredIndex(
        db,
        "kpi_actual_entries",
        KPI_ACTUAL_ENTRY_LOOKUP_INDEX_NAME,
        {
          kpiPlanId: 1,
          allocationId: 1,
          metricCode: 1,
          actualDate: 1,
          _id: 1,
        },
      );
      await assertRequiredIndex(
        db,
        "kpi_actual_entries",
        KPI_ACTUAL_ENTRY_PLAN_METRIC_INDEX_NAME,
        { kpiPlanId: 1, metricCode: 1, allocationId: 1 },
      );
      await assertRequiredIndex(
        db,
        "kpi_actual_corrections",
        KPI_ACTUAL_CORRECTION_ENTRY_INDEX_NAME,
        { actualEntryId: 1, correctedAt: -1, _id: 1 },
      );
    },
  });
}

async function assertRequiredUniqueIndex(
  db: Db,
  collectionName: string,
  indexName: string,
  expectedKey: Record<string, number>,
): Promise<void> {
  const matched = await assertRequiredIndex(
    db,
    collectionName,
    indexName,
    expectedKey,
  );
  if (matched.unique !== true) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      `Required index ${indexName} on ${collectionName} must be unique`,
    );
  }
}

async function assertRequiredIndex(
  db: Db,
  collectionName: string,
  indexName: string,
  expectedKey: Record<string, number>,
): Promise<IndexMetadata> {
  const indexes = await db.collection(collectionName).indexes();
  const matched = indexes.find((index) => index.name === indexName);
  if (!matched) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      `Required index ${indexName} missing on ${collectionName}`,
    );
  }
  if (!hasDeepExactShape(matched.key, expectedKey)) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      `Required index ${indexName} on ${collectionName} has invalid key shape`,
    );
  }
  return matched as IndexMetadata;
}

function hasDeepExactShape(candidate: unknown, expected: unknown): boolean {
  if (Object.is(candidate, expected)) {
    return true;
  }
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    typeof expected !== "object" ||
    expected === null
  ) {
    return false;
  }
  const candidateRecord = candidate as Record<string, unknown>;
  const expectedRecord = expected as Record<string, unknown>;
  const expectedKeys = Object.keys(expectedRecord);
  if (Object.keys(candidateRecord).length !== expectedKeys.length) {
    return false;
  }
  return expectedKeys.every((key) =>
    hasDeepExactShape(candidateRecord[key], expectedRecord[key]),
  );
}
