import { ReferenceSummary } from "@modules/reference-summary";

export const KPI_SUBJECT_TYPES = [
  "TALENT",
  "TALENT_GROUP",
  "EMPLOYMENT_PROFILE",
  "ORG_UNIT",
] as const;

export type KpiSubjectType = (typeof KPI_SUBJECT_TYPES)[number];

export const KPI_EXECUTABLE_SUBJECT_TYPES = ["TALENT", "TALENT_GROUP"] as const;
export const KPI_CREATE_SUBJECT_TYPES = ["TALENT_GROUP"] as const;

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
  "PENDING_APPROVAL",
  "APPROVED",
  "PUBLISHED",
  "REJECTED",
  "ACTIVE",
  "CLOSED",
  "CANCELLED",
] as const;

export type KpiAllocationStatus = (typeof KPI_ALLOCATION_STATUSES)[number];

export interface KpiAllocationWorkflowSummaryByStatus {
  readonly draft: number;
  readonly pendingApproval: number;
  readonly approved: number;
  readonly published: number;
  readonly rejected: number;
  readonly active: number;
  readonly closed: number;
  readonly cancelled: number;
}

export interface KpiAllocationWorkflowSummary {
  readonly total: number;
  readonly byStatus: KpiAllocationWorkflowSummaryByStatus;
  readonly hasDraft: boolean;
  readonly hasPendingApproval: boolean;
  readonly hasApproved: boolean;
  readonly hasPublished: boolean;
  readonly hasRejected: boolean;
  readonly hasLegacyActive: boolean;
  readonly officialPublishedCount: number;
}

export interface KpiAllocationStatusCount {
  readonly kpiPlanId: string;
  readonly allocationStatus: KpiAllocationStatus;
  readonly count: number;
}

export const KPI_ACTUAL_CORRECTION_ALLOWED_UNTIL = ["PLAN_FINALIZED"] as const;

export type KpiActualCorrectionAllowedUntil =
  (typeof KPI_ACTUAL_CORRECTION_ALLOWED_UNTIL)[number];

export const KPI_DAILY_ACTUAL_STATUSES = [
  "NOT_DUE",
  "DUE_OPEN",
  "ENTERED",
  "ENTERED_ZERO",
  "OVERDUE",
  "EXCUSED",
  "NOT_REQUIRED",
  "BLOCKED_BY_PLAN_STATUS",
  "BLOCKED_BY_ALLOCATION_STATUS",
] as const;

export type KpiDailyActualStatus = (typeof KPI_DAILY_ACTUAL_STATUSES)[number];

export const KPI_ACTUAL_SLOT_EXCUSE_STATUSES = [
  "EXCUSED",
  "NOT_REQUIRED",
] as const;

export type KpiActualSlotExcuseStatus =
  (typeof KPI_ACTUAL_SLOT_EXCUSE_STATUSES)[number];

export const KPI_ACTUAL_SLOT_EXCUSE_REASON_CODES = [
  "MEMBER_LEAVE",
  "SCHEDULED_OFF",
  "HOLIDAY_OR_CLOSURE",
  "NO_OPERATION_REQUIRED",
  "DATA_SOURCE_UNAVAILABLE",
  "OTHER",
] as const;

export type KpiActualSlotExcuseReasonCode =
  (typeof KPI_ACTUAL_SLOT_EXCUSE_REASON_CODES)[number];

export interface KpiActualEntryStatusSummary {
  readonly expectedEntryCount: number;
  readonly enteredEntryCount: number;
  readonly enteredZeroCount: number;
  readonly pendingEntryCount: number;
  readonly overdueEntryCount: number;
  readonly excusedEntryCount: number;
  readonly notRequiredEntryCount: number;
  readonly notDueEntryCount: number;
}

export interface KpiFinalResultRevenueSnapshot {
  readonly metricCode: "REVENUE_VND";
  readonly planTargetValue: number | null;
  readonly operationalTargetValue: number;
  readonly actualValue: number;
  readonly achievementPercent: number | null;
  readonly targetMismatch: boolean;
}

export interface KpiFinalResultMemberRevenueSnapshot {
  readonly metricCode: "REVENUE_VND";
  readonly targetValue: number;
  readonly actualValue: number;
  readonly achievementPercent: number | null;
}

export interface KpiFinalResultMemberSnapshot {
  readonly allocationId: string;
  readonly memberDisplayName: string | null;
  readonly allocationStatus: "PUBLISHED";
  readonly revenue: KpiFinalResultMemberRevenueSnapshot;
  readonly supportingMetrics: readonly KpiActualWorkspaceMetricSummary[];
  readonly actualEntryStatusSummary: KpiActualEntryStatusSummary;
}

export interface KpiFinalResultSnapshot {
  readonly snapshotVersion: 1;
  readonly planId: string;
  readonly planCode: string;
  readonly periodMonth: string;
  readonly subjectType: KpiSubjectType;
  readonly subjectId: string;
  readonly finalizedAt: number;
  readonly finalizedByActorId: string;
  readonly revenue: KpiFinalResultRevenueSnapshot;
  readonly allocationCoverage: KpiActualWorkspaceAllocationCoverage;
  readonly actualEntryStatusSummary: KpiActualEntryStatusSummary;
  readonly supportingMetrics: readonly KpiActualWorkspaceMetricSummary[];
  readonly members: readonly KpiFinalResultMemberSnapshot[];
}

export interface KpiActualPolicySnapshot {
  readonly timezone: "Asia/Ho_Chi_Minh";
  readonly entryOpenLocalTime: "00:00";
  readonly entryLockLocalTime: "10:00";
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
  readonly finalResult?: KpiFinalResultSnapshot | null;
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
  readonly memberEmploymentProfileId: string | null;
  readonly memberTalentId: string;
  readonly membershipId: string | null;
  readonly allocationStatus: KpiAllocationStatus;
  readonly allocationStartDate: string;
  readonly allocationEndDate: string | null;
  readonly targetMetrics: readonly KpiAllocationTargetMetric[];
  readonly snapshotMemberDisplayName: string | null;
  readonly note: string | null;
  readonly createdAt: number;
  readonly createdByActorId: string | null;
  readonly updatedAt: number;
  readonly updatedByActorId: string | null;
  readonly submittedAt: number | null;
  readonly submittedByActorId: string | null;
  readonly approvedAt: number | null;
  readonly approvedByActorId: string | null;
  readonly approvalNote: string | null;
  readonly rejectedAt: number | null;
  readonly rejectedByActorId: string | null;
  readonly rejectionReason: string | null;
  readonly publishedAt: number | null;
  readonly publishedByActorId: string | null;
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

export interface KpiActualSlotExcuse {
  readonly id: string;
  readonly kpiPlanId: string;
  readonly allocationId: string;
  readonly metricCode: KpiMetricCode;
  readonly actualDate: string;
  readonly status: KpiActualSlotExcuseStatus;
  readonly reasonCode: KpiActualSlotExcuseReasonCode;
  readonly reasonText: string;
  readonly createdAt: number;
  readonly createdByActorId: string;
  readonly updatedAt: number;
  readonly updatedByActorId: string;
  readonly deletedAt: number | null;
  readonly deletedByActorId: string | null;
}

export interface KpiActualSlotExcuseSummary {
  readonly id: string;
  readonly status: KpiActualSlotExcuseStatus;
  readonly reasonCode: KpiActualSlotExcuseReasonCode;
  readonly reasonText: string;
  readonly createdAt: number;
  readonly createdByActorId: string;
  readonly updatedAt: number;
  readonly updatedByActorId: string;
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
  readonly entryOpenLocalTime: "00:00";
  readonly entryLockLocalTime: "10:00";
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
  readonly dailyActualStatus: KpiDailyActualStatus;
  readonly actualExcuse: KpiActualSlotExcuseSummary | null;
  readonly editCount: number;
  readonly correctionCount: number;
  readonly latestCorrectionId: string | null;
  readonly canDirectEdit: boolean;
  readonly canMarkExcused: boolean;
  readonly canUnmarkExcused: boolean;
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
  readonly allocationWorkflowSummary: KpiAllocationWorkflowSummary;
}

export interface KpiActualWorkspaceMetricSummary {
  readonly metricCode: KpiMetricCode;
  readonly targetValue: number;
  readonly actualValue: number;
  readonly achievementPercent: number | null;
}

export interface KpiActualWorkspaceRevenueSummary {
  readonly metricCode: "REVENUE_VND";
  readonly operationalTargetValue: number;
  readonly planTargetValue: number | null;
  readonly actualValue: number;
  readonly achievementPercent: number | null;
  readonly targetSource: "ALLOCATED";
  readonly targetMismatch: boolean;
}

export interface KpiActualWorkspaceAllocationCoverage {
  readonly publishedAllocationCount: number;
  readonly totalAllocationCount: number;
  readonly isAllExistingAllocationsPublished: boolean;
}

export interface KpiActualWorkspaceMissingSignal {
  readonly count: number;
  readonly semantics: "CALENDAR_DAY_METRIC_SLOT_LIMITED";
}

export interface KpiActualWorkspaceClosing {
  readonly periodState: "CURRENT" | "CLOSING" | "CLOSED";
  readonly entryOpenUntil?: number;
}

export interface KpiActualWorkspaceActionHints {
  readonly canReadActualGrid: boolean;
  readonly canEnterActual: boolean;
}

export interface KpiActualWorkspacePlanSummary {
  readonly planId: string;
  readonly planCode: string;
  readonly title: string;
  readonly periodMonth: string;
  readonly subjectType: "TALENT_GROUP";
  readonly subjectId: string;
  readonly subjectRef: ReferenceSummary | null;
  readonly planStatus: KpiPlanStatus;
  readonly revenue: KpiActualWorkspaceRevenueSummary;
  readonly allocationCoverage: KpiActualWorkspaceAllocationCoverage;
  readonly supportingMetrics: readonly KpiActualWorkspaceMetricSummary[];
  readonly missingSignal: KpiActualWorkspaceMissingSignal;
  readonly actualEntryStatusSummary: KpiActualEntryStatusSummary;
  readonly closing: KpiActualWorkspaceClosing;
  readonly actionHints: KpiActualWorkspaceActionHints;
}

export interface KpiActualWorkspaceMemberSummary {
  readonly allocationId: string;
  readonly allocationStatus: "PUBLISHED";
  readonly memberDisplayName: string | null;
  readonly revenue: Omit<
    KpiActualWorkspaceRevenueSummary,
    "operationalTargetValue" | "planTargetValue" | "targetSource" | "targetMismatch"
  > & {
    readonly targetValue: number;
  };
  readonly supportingMetrics: readonly KpiActualWorkspaceMetricSummary[];
  readonly missingSignal: KpiActualWorkspaceMissingSignal;
  readonly actualEntryStatusSummary: KpiActualEntryStatusSummary;
  readonly actionHints: KpiActualWorkspaceActionHints;
}

export interface KpiActualWorkspacePlanDetail
  extends KpiActualWorkspacePlanSummary {
  readonly finalResult?: KpiFinalResultSnapshot | null;
  readonly members: readonly KpiActualWorkspaceMemberSummary[];
}

export interface KpiPlanMutationView extends KpiPlanDetailView {}
