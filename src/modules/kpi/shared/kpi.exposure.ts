import {
  PlainObject,
  toPlainObject,
} from "@app/base/presentation-result.types";
import { ExposurePolicy } from "@core/exposure/exposure.policy";
import {
  KpiAllocation,
  KpiActualCorrection,
  KpiActualDailyGridView,
  KpiActualEntry,
  KpiActualWorkspacePlanDetail,
  KpiActualWorkspacePlanSummary,
  KpiFinalResultSnapshot,
  KpiPlanDetailView,
  KpiPlanListItemView,
  KpiPlanMutationView,
  KpiProgressView,
  KpiTargetMetric,
} from "@modules/kpi/domain/kpi.types";
import { KpiManagedMemberPickerItem } from "./kpi.contracts";

const KPI_TARGET_METRIC_FIELDS = [
  "id",
  "kpiPlanId",
  "metricCode",
  "targetValue",
  "unit",
  "rollupMethod",
  "actualSource",
  "createdAt",
  "updatedAt",
] as const;

const KPI_ALLOCATION_FIELDS = [
  "id",
  "kpiPlanId",
  "groupId",
  "memberEmploymentProfileId",
  "memberTalentId",
  "membershipId",
  "allocationStatus",
  "allocationStartDate",
  "allocationEndDate",
  "targetMetrics",
  "snapshotMemberDisplayName",
  "note",
  "createdAt",
  "createdByActorId",
  "updatedAt",
  "updatedByActorId",
  "submittedAt",
  "submittedByActorId",
  "approvedAt",
  "approvedByActorId",
  "approvalNote",
  "rejectedAt",
  "rejectedByActorId",
  "rejectionReason",
  "publishedAt",
  "publishedByActorId",
  "closedAt",
] as const;

const KPI_PLAN_DETAIL_FIELDS = [
  "id",
  "planCode",
  "title",
  "description",
  "subjectType",
  "subjectId",
  "subjectRef",
  "status",
  "currencyCode",
  "periodMonth",
  "periodStartAt",
  "periodEndAt",
  "timezone",
  "actualPolicySnapshot",
  "publishedAt",
  "publishedByActorId",
  "finalizedAt",
  "finalizedByActorId",
  "archivedAt",
  "archivedByActorId",
  "createdAt",
  "createdByActorId",
  "updatedAt",
  "updatedByActorId",
  "externalRef",
  "finalResult",
  "targetMetrics",
  "allocations",
] as const;

const KPI_PLAN_LIST_FIELDS = [
  "id",
  "planCode",
  "title",
  "description",
  "subjectType",
  "subjectId",
  "subjectRef",
  "status",
  "currencyCode",
  "periodMonth",
  "periodStartAt",
  "periodEndAt",
  "timezone",
  "actualPolicySnapshot",
  "publishedAt",
  "publishedByActorId",
  "finalizedAt",
  "finalizedByActorId",
  "archivedAt",
  "archivedByActorId",
  "createdAt",
  "createdByActorId",
  "updatedAt",
  "updatedByActorId",
  "externalRef",
  "allocationWorkflowSummary",
] as const;

const KPI_ACTUAL_ENTRY_FIELDS = [
  "id",
  "kpiPlanId",
  "allocationId",
  "memberTalentId",
  "metricCode",
  "actualDate",
  "actualValue",
  "effectiveValue",
  "editCount",
  "correctionCount",
  "latestCorrectionId",
  "createdAt",
  "createdByActorId",
  "updatedAt",
  "updatedByActorId",
  "lastEditedAt",
  "lastEditedByActorId",
] as const;

const KPI_ACTUAL_CORRECTION_FIELDS = [
  "id",
  "actualEntryId",
  "kpiPlanId",
  "allocationId",
  "metricCode",
  "actualDate",
  "previousValue",
  "correctedValue",
  "reason",
  "correctedAt",
  "createdAt",
] as const;

const KPI_ACTUAL_GRID_FIELDS = [
  "kpiPlanId",
  "planCode",
  "status",
  "subjectType",
  "subjectId",
  "actualDate",
  "policy",
  "editability",
  "targetMetrics",
  "rows",
] as const;

const KPI_MANAGED_MEMBER_PICKER_FIELDS = [
  "employmentProfileId",
  "employeeCode",
  "displayName",
  "talentId",
  "talentCode",
  "groupId",
] as const;

export const KpiTargetMetricExposure = Object.freeze({
  expose(input: KpiTargetMetric): PlainObject {
    return toPlainObject(
      ExposurePolicy.expose(
        {
          id: input.id,
          kpiPlanId: input.kpiPlanId,
          metricCode: input.metricCode,
          targetValue: input.targetValue,
          unit: input.unit,
          rollupMethod: input.rollupMethod,
          actualSource: input.actualSource,
          createdAt: input.createdAt,
          updatedAt: input.updatedAt,
        },
        KPI_TARGET_METRIC_FIELDS,
      ),
      "KpiTargetMetric exposure",
    );
  },

  exposeMany(items: readonly KpiTargetMetric[]): readonly PlainObject[] {
    return items.map((item) => this.expose(item));
  },
});

export const KpiAllocationExposure = Object.freeze({
  expose(input: KpiAllocation): PlainObject {
    return toPlainObject(
      ExposurePolicy.expose(
        {
          id: input.id,
          kpiPlanId: input.kpiPlanId,
          groupId: input.groupId,
          memberEmploymentProfileId: input.memberEmploymentProfileId,
          memberTalentId: input.memberTalentId,
          membershipId: input.membershipId,
          allocationStatus: input.allocationStatus,
          allocationStartDate: input.allocationStartDate,
          allocationEndDate: input.allocationEndDate,
          targetMetrics: input.targetMetrics.map((metric) => ({
            metricCode: metric.metricCode,
            targetValue: metric.targetValue,
          })),
          snapshotMemberDisplayName: input.snapshotMemberDisplayName,
          note: input.note,
          createdAt: input.createdAt,
          createdByActorId: input.createdByActorId,
          updatedAt: input.updatedAt,
          updatedByActorId: input.updatedByActorId,
          submittedAt: input.submittedAt,
          submittedByActorId: input.submittedByActorId,
          approvedAt: input.approvedAt,
          approvedByActorId: input.approvedByActorId,
          approvalNote: input.approvalNote,
          rejectedAt: input.rejectedAt,
          rejectedByActorId: input.rejectedByActorId,
          rejectionReason: input.rejectionReason,
          publishedAt: input.publishedAt,
          publishedByActorId: input.publishedByActorId,
          closedAt: input.closedAt,
        },
        KPI_ALLOCATION_FIELDS,
      ),
      "KpiAllocation exposure",
    );
  },

  exposeMany(items: readonly KpiAllocation[]): readonly PlainObject[] {
    return items.map((item) => this.expose(item));
  },
});

export const KpiPlanDetailExposure = Object.freeze({
  expose(input: KpiPlanDetailView): PlainObject {
    return toPlainObject(
      ExposurePolicy.expose(
        {
          id: input.id,
          planCode: input.planCode,
          title: input.title,
          description: input.description,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          subjectRef: input.subjectRef,
          status: input.status,
          currencyCode: input.currencyCode,
          periodMonth: input.periodMonth,
          periodStartAt: input.periodStartAt,
          periodEndAt: input.periodEndAt,
          timezone: input.timezone,
          actualPolicySnapshot: input.actualPolicySnapshot,
          publishedAt: input.publishedAt,
          publishedByActorId: input.publishedByActorId,
          finalizedAt: input.finalizedAt,
          finalizedByActorId: input.finalizedByActorId,
          archivedAt: input.archivedAt,
          archivedByActorId: input.archivedByActorId,
          createdAt: input.createdAt,
          createdByActorId: input.createdByActorId,
          updatedAt: input.updatedAt,
          updatedByActorId: input.updatedByActorId,
          externalRef: input.externalRef,
          finalResult:
            input.status === "FINALIZED"
              ? exposeKpiFinalResult(input.finalResult)
              : null,
          targetMetrics: KpiTargetMetricExposure.exposeMany(
            input.targetMetrics,
          ),
          allocations: KpiAllocationExposure.exposeMany(input.allocations),
        },
        KPI_PLAN_DETAIL_FIELDS,
      ),
      "KpiPlanDetail exposure",
    );
  },
});

export const KpiPlanListExposure = Object.freeze({
  expose(input: KpiPlanListItemView): PlainObject {
    return toPlainObject(
      ExposurePolicy.expose(
        {
          id: input.id,
          planCode: input.planCode,
          title: input.title,
          description: input.description,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          subjectRef: input.subjectRef,
          status: input.status,
          currencyCode: input.currencyCode,
          periodMonth: input.periodMonth,
          periodStartAt: input.periodStartAt,
          periodEndAt: input.periodEndAt,
          timezone: input.timezone,
          actualPolicySnapshot: input.actualPolicySnapshot,
          publishedAt: input.publishedAt,
          publishedByActorId: input.publishedByActorId,
          finalizedAt: input.finalizedAt,
          finalizedByActorId: input.finalizedByActorId,
          archivedAt: input.archivedAt,
          archivedByActorId: input.archivedByActorId,
          createdAt: input.createdAt,
          createdByActorId: input.createdByActorId,
          updatedAt: input.updatedAt,
          updatedByActorId: input.updatedByActorId,
          externalRef: input.externalRef,
          allocationWorkflowSummary: input.allocationWorkflowSummary,
        },
        KPI_PLAN_LIST_FIELDS,
      ),
      "KpiPlanList exposure",
    );
  },

  exposeMany(items: readonly KpiPlanListItemView[]): readonly PlainObject[] {
    return items.map((item) => this.expose(item));
  },
});

export const KpiPlanMutationExposure = Object.freeze({
  expose(input: KpiPlanMutationView): PlainObject {
    return KpiPlanDetailExposure.expose(input);
  },
});

export const KpiActualEntryExposure = Object.freeze({
  expose(input: KpiActualEntry): PlainObject {
    return toPlainObject(
      ExposurePolicy.expose(
        {
          id: input.id,
          kpiPlanId: input.kpiPlanId,
          allocationId: input.allocationId,
          memberTalentId: input.memberTalentId,
          metricCode: input.metricCode,
          actualDate: input.actualDate,
          actualValue: input.actualValue,
          effectiveValue: input.effectiveValue,
          editCount: input.editCount,
          correctionCount: input.correctionCount,
          latestCorrectionId: input.latestCorrectionId,
          createdAt: input.createdAt,
          createdByActorId: input.createdByActorId,
          updatedAt: input.updatedAt,
          updatedByActorId: input.updatedByActorId,
          lastEditedAt: input.lastEditedAt,
          lastEditedByActorId: input.lastEditedByActorId,
        },
        KPI_ACTUAL_ENTRY_FIELDS,
      ),
      "KpiActualEntry exposure",
    );
  },
});

export const KpiActualCorrectionExposure = Object.freeze({
  expose(input: KpiActualCorrection): PlainObject {
    return toPlainObject(
      ExposurePolicy.expose(
        {
          id: input.id,
          actualEntryId: input.actualEntryId,
          kpiPlanId: input.kpiPlanId,
          allocationId: input.allocationId,
          metricCode: input.metricCode,
          actualDate: input.actualDate,
          previousValue: input.previousValue,
          correctedValue: input.correctedValue,
          reason: input.reason,
          correctedAt: input.correctedAt,
          createdAt: input.createdAt,
        },
        KPI_ACTUAL_CORRECTION_FIELDS,
      ),
      "KpiActualCorrection exposure",
    );
  },
});

export const KpiActualDailyGridExposure = Object.freeze({
  expose(input: KpiActualDailyGridView): PlainObject {
    return toPlainObject(
      ExposurePolicy.expose(
        {
          kpiPlanId: input.kpiPlanId,
          planCode: input.planCode,
          status: input.status,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          actualDate: input.actualDate,
          policy: {
            timezone: input.policy.timezone,
            entryOpenLocalTime: input.policy.entryOpenLocalTime,
            entryLockLocalTime: input.policy.entryLockLocalTime,
            maxDirectEditsPerEntry: input.policy.maxDirectEditsPerEntry,
            correctionAllowedUntil: input.policy.correctionAllowedUntil,
          },
          editability: {
            isDirectEditOpen: input.editability.isDirectEditOpen,
            isPlanFinalized: input.editability.isPlanFinalized,
            disabledReason: input.editability.disabledReason,
          },
          targetMetrics: input.targetMetrics.map((metric) => ({
            metricCode: metric.metricCode,
            targetValue: metric.targetValue,
            unit: metric.unit,
          })),
          rows: input.rows.map((row) => ({
            allocationId: row.allocationId,
            memberTalentId: row.memberTalentId,
            memberDisplayName: row.memberDisplayName,
            allocationStatus: row.allocationStatus,
            metrics: row.metrics.map((metric) => ({
              metricCode: metric.metricCode,
              targetValue: metric.targetValue,
              actualEntryId: metric.actualEntryId,
              actualValue: metric.actualValue,
              effectiveValue: metric.effectiveValue,
              hasEntry: metric.hasEntry,
              dailyActualStatus: metric.dailyActualStatus,
              actualExcuse: metric.actualExcuse,
              editCount: metric.editCount,
              correctionCount: metric.correctionCount,
              latestCorrectionId: metric.latestCorrectionId,
              canDirectEdit: metric.canDirectEdit,
              canMarkExcused: metric.canMarkExcused,
              canUnmarkExcused: metric.canUnmarkExcused,
              requiresCorrection: metric.requiresCorrection,
              disabledReason: metric.disabledReason,
            })),
          })),
        },
        KPI_ACTUAL_GRID_FIELDS,
      ),
      "KpiActualDailyGrid exposure",
    );
  },
});

export const KpiProgressExposure = Object.freeze({
  expose(input: KpiProgressView): PlainObject {
    return toPlainObject(
      {
        plan: input.plan,
        periodElapsedPercent: input.periodElapsedPercent,
        targetMetrics: KpiTargetMetricExposure.exposeMany(input.targetMetrics),
        groupTotals: input.groupTotals.map((total) => ({
          metricCode: total.metricCode,
          targetValue: total.targetValue,
          actualValue: total.actualValue,
          progressPercent: total.progressPercent,
        })),
        memberProgress: input.memberProgress.map((row) => ({
          allocationId: row.allocationId,
          memberTalentId: row.memberTalentId,
          metricCode: row.metricCode,
          targetValue: row.targetValue,
          actualValue: row.actualValue,
          progressPercent: row.progressPercent,
          actualEntryCount: row.actualEntryCount,
          missingEntryCount: row.missingEntryCount,
        })),
      },
      "KpiProgress exposure",
    );
  },
});

export const KpiManagedMemberPickerExposure = Object.freeze({
  expose(input: KpiManagedMemberPickerItem): PlainObject {
    return toPlainObject(
      ExposurePolicy.expose(
        {
          employmentProfileId: input.employmentProfileId,
          employeeCode: input.employeeCode,
          displayName: input.displayName,
          talentId: input.talentId,
          talentCode: input.talentCode,
          groupId: input.groupId,
        },
        KPI_MANAGED_MEMBER_PICKER_FIELDS,
      ),
      "KpiManagedMemberPicker exposure",
    );
  },

  exposeMany(
    items: readonly KpiManagedMemberPickerItem[],
  ): readonly PlainObject[] {
    return items.map((item) => this.expose(item));
  },
});

export const KpiActualWorkspaceExposure = Object.freeze({
  exposeSummary(input: KpiActualWorkspacePlanSummary): PlainObject {
    return toPlainObject(
      {
        planId: input.planId,
        planCode: input.planCode,
        title: input.title,
        periodMonth: input.periodMonth,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        subjectRef: input.subjectRef,
        planStatus: input.planStatus,
        revenue: input.revenue,
        allocationCoverage: input.allocationCoverage,
        supportingMetrics: input.supportingMetrics,
        missingSignal: input.missingSignal,
        actualEntryStatusSummary: input.actualEntryStatusSummary,
        closing: input.closing,
        actionHints: input.actionHints,
      },
      "KpiActualWorkspacePlanSummary exposure",
    );
  },

  exposeMany(
    items: readonly KpiActualWorkspacePlanSummary[],
  ): readonly PlainObject[] {
    return items.map((item) => this.exposeSummary(item));
  },

  exposeDetail(input: KpiActualWorkspacePlanDetail): PlainObject {
    return toPlainObject(
      {
        ...this.exposeSummary(input),
        finalResult: exposeKpiFinalResult(input.finalResult),
        members: input.members.map((member) => ({
          allocationId: member.allocationId,
          allocationStatus: member.allocationStatus,
          memberDisplayName: member.memberDisplayName,
          revenue: member.revenue,
          supportingMetrics: member.supportingMetrics,
          missingSignal: member.missingSignal,
          actualEntryStatusSummary: member.actualEntryStatusSummary,
          actionHints: member.actionHints,
        })),
      },
      "KpiActualWorkspacePlanDetail exposure",
    );
  },
});

function exposeKpiFinalResult(
  input: KpiFinalResultSnapshot | null | undefined,
): PlainObject | null {
  if (!input) {
    return null;
  }

  return toPlainObject(
    {
      snapshotVersion: input.snapshotVersion,
      planId: input.planId,
      planCode: input.planCode,
      periodMonth: input.periodMonth,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      finalizedAt: input.finalizedAt,
      revenue: input.revenue,
      allocationCoverage: input.allocationCoverage,
      actualEntryStatusSummary: input.actualEntryStatusSummary,
      supportingMetrics: input.supportingMetrics,
      members: input.members.map((member) => ({
        allocationId: member.allocationId,
        memberDisplayName: member.memberDisplayName,
        allocationStatus: member.allocationStatus,
        revenue: member.revenue,
        supportingMetrics: member.supportingMetrics,
        actualEntryStatusSummary: member.actualEntryStatusSummary,
      })),
    },
    "KpiFinalResult exposure",
  );
}
