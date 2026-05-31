import {
  KpiAllocation,
  KpiAllocationStatus,
  KpiActualCorrection,
  KpiActualDailyGridView,
  KpiActualEntry,
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
  readonly targetValue: number;
}

export interface KpiAllocationTargetMetricInput {
  readonly metricCode: KpiMetricCode | string;
  readonly targetValue: number;
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
  readonly allocations?: readonly KpiAllocationInput[];
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
}

export interface SubmitKpiAllocationDraftCommand {
  readonly kpiPlanId: string;
}

export interface ApproveKpiAllocationCommand {
  readonly kpiPlanId: string;
  readonly approvalNote?: string | null;
}

export interface RejectKpiAllocationCommand {
  readonly kpiPlanId: string;
  readonly rejectionReason: string;
}

export interface PublishKpiAllocationCommand {
  readonly kpiPlanId: string;
}

export interface ListKpiAllocationsQuery {
  readonly status?: KpiAllocationStatus | string;
  readonly kpiPlanId?: string;
  readonly groupId?: string;
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

export interface ReplaceKpiAllocationsResult {
  readonly plan: KpiPlanDetailView;
  readonly allocations: readonly KpiAllocation[];
}
