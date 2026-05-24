import { ReferenceSummary } from "@modules/reference-summary";

export const KPI_SUBJECT_TYPES = [
  "TALENT",
  "TALENT_GROUP",
  "EMPLOYMENT_PROFILE",
  "ORG_UNIT",
] as const;

export type KpiSubjectType = (typeof KPI_SUBJECT_TYPES)[number];

export const KPI_EXECUTABLE_SUBJECT_TYPES = ["TALENT", "TALENT_GROUP"] as const;

export type KpiExecutableSubjectType =
  (typeof KPI_EXECUTABLE_SUBJECT_TYPES)[number];

export const KPI_PLAN_STATUSES = [
  "DRAFT",
  "PUBLISHED",
  "FINALIZED",
  "ARCHIVED",
] as const;

export type KpiPlanStatus = (typeof KPI_PLAN_STATUSES)[number];

export const KPI_METRIC_CODES = [
  "REVENUE_VND",
  "CONTENT_OUTPUT_COUNT",
  "LIVE_HOURS",
  "EVENT_COMPLETION_COUNT",
  "ONBOARDED_TALENT_COUNT",
] as const;

export type KpiMetricCode = (typeof KPI_METRIC_CODES)[number];

export const KPI_METRIC_UNITS = ["VND", "COUNT", "HOUR"] as const;

export type KpiMetricUnit = (typeof KPI_METRIC_UNITS)[number];

export const KPI_ROLLUP_METHODS = ["SUM"] as const;

export type KpiRollupMethod = (typeof KPI_ROLLUP_METHODS)[number];

export const KPI_ACTUAL_SOURCES = ["MANUAL"] as const;

export type KpiActualSource = (typeof KPI_ACTUAL_SOURCES)[number];

export const KPI_PLAN_CURRENCIES = ["VND"] as const;

export type KpiPlanCurrency = (typeof KPI_PLAN_CURRENCIES)[number];

export const KPI_ALLOCATION_STATUSES = [
  "DRAFT",
  "ACTIVE",
  "CLOSED",
  "CANCELLED",
] as const;

export type KpiAllocationStatus = (typeof KPI_ALLOCATION_STATUSES)[number];

export const KPI_ACTUAL_CORRECTION_ALLOWED_UNTIL = ["PLAN_FINALIZED"] as const;

export type KpiActualCorrectionAllowedUntil =
  (typeof KPI_ACTUAL_CORRECTION_ALLOWED_UNTIL)[number];

export interface KpiActualPolicySnapshot {
  readonly timezone: "Asia/Ho_Chi_Minh";
  readonly entryOpenLocalTime: "06:00";
  readonly entryLockLocalTime: "23:00";
  readonly maxDirectEditsPerEntry: number;
  readonly correctionAllowedUntil: KpiActualCorrectionAllowedUntil;
  readonly policyVersion: string;
  readonly policySource: "DEFAULT";
  readonly snapshottedAt: number;
}

export const TALENT_GROUP_MANAGER_ROLES = [
  "OWNER",
  "MANAGER",
  "ASSISTANT",
] as const;

export type TalentGroupManagerRole =
  (typeof TALENT_GROUP_MANAGER_ROLES)[number];

export const TALENT_GROUP_MANAGER_ASSIGNMENT_STATUSES = [
  "ACTIVE",
  "INACTIVE",
  "REMOVED",
] as const;

export type TalentGroupManagerAssignmentStatus =
  (typeof TALENT_GROUP_MANAGER_ASSIGNMENT_STATUSES)[number];

export const KPI_SORT_FIELDS = [
  "periodMonth",
  "planCode",
  "createdAt",
] as const;

export type KpiSortField = (typeof KPI_SORT_FIELDS)[number];

export const KPI_SORT_DIRECTIONS = ["ASC", "DESC"] as const;

export type KpiSortDirection = (typeof KPI_SORT_DIRECTIONS)[number];

export interface KpiPlan {
  readonly id: string;
  readonly planCode: string;
  readonly normalizedPlanCode: string;
  readonly title: string;
  readonly normalizedTitle: string;
  readonly description: string | null;
  readonly subjectType: KpiSubjectType;
  readonly subjectId: string;
  readonly status: KpiPlanStatus;
  readonly currencyCode: KpiPlanCurrency;
  readonly periodMonth: string;
  readonly periodStartAt: number;
  readonly periodEndAt: number;
  readonly timezone: string;
  readonly actualPolicySnapshot: KpiActualPolicySnapshot | null;
  readonly publishedAt: number | null;
  readonly publishedByActorId: string | null;
  readonly finalizedAt: number | null;
  readonly finalizedByActorId: string | null;
  readonly archivedAt: number | null;
  readonly archivedByActorId: string | null;
  readonly createdAt: number;
  readonly createdByActorId: string;
  readonly updatedAt: number;
  readonly updatedByActorId: string;
  readonly externalRef: string | null;
}

export interface KpiTargetMetric {
  readonly id: string;
  readonly kpiPlanId: string;
  readonly metricCode: KpiMetricCode;
  readonly targetValue: number;
  readonly unit: KpiMetricUnit;
  readonly rollupMethod: KpiRollupMethod;
  readonly actualSource: KpiActualSource;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface KpiAllocationTargetMetric {
  readonly metricCode: KpiMetricCode;
  readonly targetValue: number;
}

export interface KpiAllocation {
  readonly id: string;
  readonly kpiPlanId: string;
  readonly groupId: string;
  readonly memberTalentId: string;
  readonly membershipId: string | null;
  readonly allocationStatus: KpiAllocationStatus;
  readonly allocationStartDate: string;
  readonly allocationEndDate: string | null;
  readonly targetMetrics: readonly KpiAllocationTargetMetric[];
  readonly snapshotMemberDisplayName: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly publishedAt: number | null;
  readonly closedAt: number | null;
}

export interface TalentGroupManagerAssignment {
  readonly id: string;
  readonly groupId: string;
  readonly managerEmploymentProfileId: string;
  readonly role: TalentGroupManagerRole;
  readonly effectiveFrom: number;
  readonly effectiveTo: number | null;
  readonly status: TalentGroupManagerAssignmentStatus;
  readonly isPrimary: boolean;
  readonly createdAt: number;
  readonly createdByActorId: string;
  readonly updatedAt: number;
  readonly updatedByActorId: string;
}

export interface TalentGroupManagerAssignmentView extends TalentGroupManagerAssignment {
  readonly groupRef: ReferenceSummary;
  readonly managerRef: ReferenceSummary;
  readonly managerHasLinkedAdminUser: boolean;
}

export interface KpiActorEmploymentProfileLookup {
  readonly employmentProfileId: string;
}

export interface KpiActorTalentLookup {
  readonly talentId: string;
}

export interface KpiActualEntry {
  readonly id: string;
  readonly kpiPlanId: string;
  readonly allocationId: string;
  readonly memberTalentId: string;
  readonly metricCode: KpiMetricCode;
  readonly actualDate: string;
  readonly actualValue: number;
  readonly effectiveValue: number;
  readonly editCount: number;
  readonly correctionCount: number;
  readonly latestCorrectionId: string | null;
  readonly createdAt: number;
  readonly createdByActorId: string;
  readonly updatedAt: number;
  readonly updatedByActorId: string;
  readonly lastEditedAt: number | null;
  readonly lastEditedByActorId: string | null;
}

export interface KpiActualCorrection {
  readonly id: string;
  readonly actualEntryId: string;
  readonly kpiPlanId: string;
  readonly allocationId: string;
  readonly memberTalentId: string;
  readonly metricCode: KpiMetricCode;
  readonly actualDate: string;
  readonly previousValue: number;
  readonly correctedValue: number;
  readonly reason: string;
  readonly correctedByActorId: string;
  readonly correctedAt: number;
  readonly createdAt: number;
}

export interface KpiProgressMetricTotal {
  readonly metricCode: KpiMetricCode;
  readonly targetValue: number;
  readonly actualValue: number;
  readonly progressPercent: number | null;
}

export interface KpiMemberMetricProgress {
  readonly allocationId: string;
  readonly memberTalentId: string;
  readonly metricCode: KpiMetricCode;
  readonly targetValue: number;
  readonly actualValue: number;
  readonly progressPercent: number | null;
  readonly actualEntryCount: number;
  readonly missingEntryCount: number;
}

export interface KpiProgressView {
  readonly plan: Pick<
    KpiPlan,
    | "id"
    | "planCode"
    | "subjectType"
    | "subjectId"
    | "status"
    | "periodMonth"
    | "periodStartAt"
    | "periodEndAt"
    | "timezone"
  >;
  readonly periodElapsedPercent: number;
  readonly targetMetrics: readonly KpiTargetMetric[];
  readonly groupTotals: readonly KpiProgressMetricTotal[];
  readonly memberProgress: readonly KpiMemberMetricProgress[];
}

export interface KpiActualGridPolicyView {
  readonly timezone: "Asia/Ho_Chi_Minh";
  readonly entryOpenLocalTime: "06:00";
  readonly entryLockLocalTime: "23:00";
  readonly maxDirectEditsPerEntry: number;
  readonly correctionAllowedUntil: KpiActualCorrectionAllowedUntil;
}

export interface KpiActualGridEditabilityView {
  readonly isDirectEditOpen: boolean;
  readonly isPlanFinalized: boolean;
  readonly disabledReason: string | null;
}

export interface KpiActualGridTargetMetricView {
  readonly metricCode: KpiMetricCode;
  readonly targetValue: number;
  readonly unit: KpiMetricUnit;
}

export interface KpiActualGridMetricCellView {
  readonly metricCode: KpiMetricCode;
  readonly targetValue: number;
  readonly actualEntryId: string | null;
  readonly actualValue: number | null;
  readonly effectiveValue: number;
  readonly hasEntry: boolean;
  readonly editCount: number;
  readonly correctionCount: number;
  readonly latestCorrectionId: string | null;
  readonly canDirectEdit: boolean;
  readonly requiresCorrection: boolean;
  readonly disabledReason: string | null;
}

export interface KpiActualGridRowView {
  readonly allocationId: string;
  readonly memberTalentId: string;
  readonly memberDisplayName: string | null;
  readonly allocationStatus: KpiAllocationStatus;
  readonly metrics: readonly KpiActualGridMetricCellView[];
}

export interface KpiActualDailyGridView {
  readonly kpiPlanId: string;
  readonly planCode: string;
  readonly status: KpiPlanStatus;
  readonly subjectType: KpiSubjectType;
  readonly subjectId: string;
  readonly actualDate: string;
  readonly policy: KpiActualGridPolicyView;
  readonly editability: KpiActualGridEditabilityView;
  readonly targetMetrics: readonly KpiActualGridTargetMetricView[];
  readonly rows: readonly KpiActualGridRowView[];
}

export interface KpiPlanDetailView extends KpiPlan {
  readonly subjectRef?: ReferenceSummary | null;
  readonly targetMetrics: readonly KpiTargetMetric[];
  readonly allocations: readonly KpiAllocation[];
}

export interface KpiPlanListItemView extends KpiPlan {
  readonly subjectRef?: ReferenceSummary | null;
}

export interface KpiPlanMutationView extends KpiPlanDetailView {}
