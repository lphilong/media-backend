import {
  KpiAllocation,
  KpiAllocationStatus,
  KpiActualCorrection,
  KpiActualDailyGridView,
  KpiActualEntry,
  KpiActualSlotExcuseReasonCode,
  KpiActualSlotExcuseStatus,
  KpiActualWorkspacePlanDetail,
  KpiActualWorkspacePlanSummary,
  KpiMetricCode,
  KpiPlanDetailView,
  KpiPlanListItemView,
  KpiPlanMutationView,
  KpiProgressView,
  KpiPlanStatus,
  KpiPlanCurrency,
  KpiSortDirection,
  KpiSortField,
  KpiSubjectType,
} from "@modules/kpi/domain/kpi.types";

export interface KpiTargetMetricInput {
  readonly metricCode: KpiMetricCode | string;
  readonly targetValue: number | string;
  readonly allocationMode?:
    "GROUP_ONLY" | "MEMBER_ALLOCATED" | "HYBRID" | string;
  readonly groupRemainder?: number | string | null;
  readonly actualCaptureMode?: string;
  readonly actualAggregationMethod?: string;
  readonly actualReviewMode?: string;
  readonly actualEvidenceMode?: string;
}

export interface KpiAllocationTargetMetricInput {
  readonly metricCode: KpiMetricCode | string;
  readonly targetValue: number | string;
}

export interface KpiAllocationInput {
  readonly memberTalentId: string;
  readonly membershipId?: string | null;
  readonly allocationStartDate: string;
  readonly allocationEndDate?: string | null;
  readonly targetMetrics: readonly KpiAllocationTargetMetricInput[];
  readonly snapshotMemberDisplayName?: string | null;
}

export interface KpiAllocationDraftMemberInput {
  readonly employmentProfileId: string;
  readonly allocationStartDate: string;
  readonly allocationEndDate?: string | null;
  readonly targetMetrics: readonly KpiAllocationTargetMetricInput[];
  readonly note?: string | null;
}

export interface CreateKpiPlanCommand {
  readonly title: string;
  readonly description?: string | null;
  readonly subjectType: KpiSubjectType | string;
  readonly subjectId: string;
  readonly currencyCode?: KpiPlanCurrency | string;
  readonly periodMonth: string;
  readonly periodStartAt: number;
  readonly periodEndAt: number;
  readonly timezone?: string;
  readonly targetMetrics: readonly KpiTargetMetricInput[];
  readonly externalRef?: string | null;
}

export interface UpdateKpiDraftCoreCommand {
  readonly kpiPlanId: string;
  readonly title?: string;
  readonly description?: string | null;
  readonly currencyCode?: KpiPlanCurrency | string;
  readonly periodMonth?: string;
  readonly periodStartAt?: number;
  readonly periodEndAt?: number;
  readonly timezone?: string;
  readonly externalRef?: string | null;
}

export interface ReplaceKpiTargetMetricsCommand {
  readonly kpiPlanId: string;
  readonly targetMetrics: readonly KpiTargetMetricInput[];
}

export interface ReplaceKpiAllocationsCommand {
  readonly kpiPlanId: string;
  readonly allocations: readonly KpiAllocationInput[];
}

export interface UpsertKpiAllocationDraftCommand {
  readonly kpiPlanId: string;
  readonly allocations: readonly KpiAllocationDraftMemberInput[];
  readonly expectedPlanVersion: number;
  readonly expectedAllocationVersion: number;
  readonly expectedMembershipSnapshotVersion: string;
  readonly idempotencyKey: string;
}

export interface SubmitKpiAllocationDraftCommand {
  readonly kpiPlanId: string;
  readonly expectedPlanVersion: number;
  readonly expectedAllocationVersion: number;
  readonly expectedMembershipSnapshotVersion: string;
  readonly idempotencyKey: string;
  readonly reason?: string;
}

export interface ApproveKpiAllocationCommand {
  readonly kpiPlanId: string;
  readonly approvalNote?: string | null;
  readonly expectedPlanVersion: number;
  readonly expectedAllocationVersion: number;
  readonly expectedMembershipSnapshotVersion: string;
  readonly idempotencyKey: string;
}

export interface RejectKpiAllocationCommand {
  readonly kpiPlanId: string;
  readonly rejectionReason: string;
  readonly expectedPlanVersion: number;
  readonly expectedAllocationVersion: number;
  readonly expectedMembershipSnapshotVersion: string;
  readonly idempotencyKey: string;
}

export interface PublishKpiAllocationCommand {
  readonly kpiPlanId: string;
  readonly expectedPlanVersion: number;
  readonly expectedAllocationVersion: number;
  readonly expectedMembershipSnapshotVersion: string;
  readonly idempotencyKey: string;
}

export interface ListKpiAllocationsQuery {
  readonly subjectType?:
    Extract<KpiSubjectType, "TALENT_GROUP" | "ORG_UNIT"> | string;
  readonly status?: KpiAllocationStatus | string;
  readonly kpiPlanId?: string;
  readonly groupId?: string;
  readonly limit?: number | string;
}

export interface ListKpiOrgUnitAllocationsQuery {
  readonly status?: KpiAllocationStatus | string;
  readonly kpiPlanId?: string;
  readonly orgUnitId?: string;
  readonly limit?: number | string;
}

export interface PublishKpiPlanCommand {
  readonly kpiPlanId: string;
}

export interface ArchiveKpiPlanCommand {
  readonly kpiPlanId: string;
}

export interface CreateKpiActualCommand {
  readonly kpiPlanId: string;
  readonly allocationId: string;
  readonly metricCode: KpiMetricCode | string;
  readonly actualDate: string;
  readonly actualValue: number;
  readonly evidenceRef?: string | null;
  readonly sourceFingerprint?: string | null;
}

export interface UpdateKpiActualCommand {
  readonly kpiPlanId: string;
  readonly actualEntryId: string;
  readonly actualValue: number;
}

export interface CorrectKpiActualCommand {
  readonly kpiPlanId: string;
  readonly actualEntryId: string;
  readonly correctedValue: number;
  readonly reason: string;
  readonly expectedEntryVersion: number;
  readonly idempotencyKey: string;
}

export interface MarkKpiActualExcuseCommand {
  readonly kpiPlanId: string;
  readonly allocationId: string;
  readonly metricCode: KpiMetricCode | string;
  readonly actualDate: string;
  readonly status: KpiActualSlotExcuseStatus | string;
  readonly reasonCode: KpiActualSlotExcuseReasonCode | string;
  readonly reasonText: string;
}

export interface RemoveKpiActualExcuseCommand {
  readonly kpiPlanId: string;
  readonly excuseId: string;
}

export interface FinalizeKpiPlanCommand {
  readonly kpiPlanId: string;
}

export interface ListKpiPlansQuery {
  readonly subjectType?: KpiSubjectType | string;
  readonly subjectId?: string;
  readonly groupId?: string;
  readonly periodMonth?: string;
  readonly status?: KpiPlanStatus | string;
  readonly metricCode?: KpiMetricCode | string;
  readonly search?: string;
  readonly limit?: number | string;
  readonly sortBy?: KpiSortField | string;
  readonly sortDirection?: KpiSortDirection | string;
}

export interface GetKpiPlanDetailQuery {
  readonly kpiPlanId: string;
}

export interface ListKpiActualWorkspacePlansQuery {
  readonly subjectType?:
    Extract<KpiSubjectType, "TALENT_GROUP" | "ORG_UNIT"> | string;
  readonly periodMonth?: string;
  readonly groupId?: string;
  readonly subjectId?: string;
  readonly search?: string;
  readonly limit?: number | string;
  readonly sortBy?:
    | "periodMonth"
    | "planCode"
    | "revenueActual"
    | "achievementPercent"
    | string;
  readonly sortDirection?: KpiSortDirection | string;
  readonly cursor?: string;
  readonly allocationCoverage?: "complete" | "incomplete" | string;
  readonly hasOverdueActuals?: boolean | string;
  readonly hasPendingActuals?: boolean | string;
}

export interface GetKpiActualWorkspacePlanDetailQuery {
  readonly kpiPlanId: string;
}

export interface GetKpiProgressQuery {
  readonly kpiPlanId: string;
}

export interface ListKpiManagedMembersQuery {
  readonly kpiPlanId: string;
  readonly search?: string;
  readonly limit?: number | string;
}

export interface GetKpiActualDailyGridQuery {
  readonly kpiPlanId: string;
  readonly actualDate?: string;
}

export interface ListKpiActualCorrectionsQuery {
  readonly kpiPlanId: string;
  readonly actualEntryId: string;
}

export interface GetMyKpiProgressQuery {
  readonly kpiPlanId: string;
}

export type KpiPlanMutationResult = KpiPlanMutationView;

export interface KpiActualMutationResult {
  readonly actualEntry: KpiActualEntry;
}

export interface KpiActualCorrectionResult {
  readonly actualEntry: KpiActualEntry;
  readonly correction: KpiActualCorrection;
}

export type GetKpiPlanDetailResult = KpiPlanDetailView;

export type GetKpiProgressResult = KpiProgressView;

export type GetKpiActualDailyGridResult = KpiActualDailyGridView;

export interface ListKpiActualCorrectionsResult {
  readonly items: readonly KpiActualCorrection[];
}

export interface ListKpiPlansResult {
  readonly items: readonly KpiPlanListItemView[];
}

export interface ListKpiActualWorkspacePlansResult {
  readonly items: readonly KpiActualWorkspacePlanSummary[];
  readonly nextCursor?: string;
}

export type GetKpiActualWorkspacePlanDetailResult =
  KpiActualWorkspacePlanDetail;

export interface ListKpiAllocationsResult {
  readonly items: readonly KpiAllocation[];
}

export interface KpiManagedMemberPickerItem {
  readonly employmentProfileId: string;
  readonly employeeCode: string | null;
  readonly displayName: string;
  readonly talentId: string;
  readonly talentCode: string | null;
  readonly groupId: string;
}

export interface ListKpiManagedMembersResult {
  readonly items: readonly KpiManagedMemberPickerItem[];
}

export interface KpiOrgUnitManagedMemberPickerItem {
  readonly employmentProfileId: string;
  readonly employeeCode: string | null;
  readonly displayName: string;
  readonly orgUnitId: string;
}

export interface ListKpiOrgUnitManagedMembersResult {
  readonly items: readonly KpiOrgUnitManagedMemberPickerItem[];
}

export interface KpiOrgUnitAllocationItem {
  readonly id: string;
  readonly kpiPlanId: string;
  readonly memberEmploymentProfileId: string;
  readonly memberTalentId: string | null;
  readonly groupId: string | null;
  readonly allocationStatus: KpiAllocationStatus;
  readonly lifecycleStatus?: KpiAllocation["lifecycleStatus"];
  readonly allocationMode?: KpiAllocation["allocationMode"];
  readonly sourcePlanVersion?: number;
  readonly allocationVersion?: number;
  readonly membershipSnapshotVersion?: string | null;
  readonly eligibleMemberSnapshot?: KpiAllocation["eligibleMemberSnapshot"];
  readonly correlationId?: string | null;
  readonly supersedesAllocationId?: string | null;
  readonly correctsAllocationId?: string | null;
  readonly allocationStartDate: string;
  readonly allocationEndDate: string | null;
  readonly targetMetrics: readonly {
    readonly metricCode: KpiMetricCode;
    readonly targetValue: number;
  }[];
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

export interface ListKpiOrgUnitAllocationsResult {
  readonly items: readonly KpiOrgUnitAllocationItem[];
}

export interface ReplaceKpiAllocationsResult {
  readonly plan: KpiPlanDetailView;
  readonly allocations: readonly KpiAllocation[];
}
