import { ClientSession } from "mongodb";
import { BusinessCodePolicy } from "@core/business-code/business-code-sequence.repository";
import {
  KpiAllocation,
  KpiAllocationStatus,
  KpiActualPolicySnapshot,
  KpiMetricCode,
  KpiPlan,
  KpiPlanStatus,
  KpiSubjectType,
  KpiTargetMetric,
} from "./kpi.types";

export interface UpdateKpiDraftCoreInput {
  readonly kpiPlanId: string;
  readonly title?: string;
  readonly normalizedTitle?: string;
  readonly description?: string | null;
  readonly currencyCode?: "VND";
  readonly periodMonth?: string;
  readonly periodStartAt?: number;
  readonly periodEndAt?: number;
  readonly timezone?: string;
  readonly externalRef?: string | null;
  readonly updatedAt: number;
  readonly updatedByActorId: string;
}

export interface TransitionKpiPlanStatusInput {
  readonly kpiPlanId: string;
  readonly fromStatuses: readonly KpiPlanStatus[];
  readonly toStatus: KpiPlanStatus;
  readonly publishedAt?: number | null;
  readonly publishedByActorId?: string | null;
  readonly actualPolicySnapshot?: KpiActualPolicySnapshot | null;
  readonly finalizedAt?: number | null;
  readonly finalizedByActorId?: string | null;
  readonly archivedAt?: number | null;
  readonly archivedByActorId?: string | null;
  readonly updatedAt: number;
  readonly updatedByActorId: string;
}

export interface ListKpiPlansInput {
  readonly subjectType?: KpiSubjectType;
  readonly subjectId?: string;
  readonly groupId?: string;
  readonly periodMonth?: string;
  readonly status?: KpiPlanStatus;
  readonly metricCode?: KpiMetricCode;
  readonly search?: string;
  readonly limit: number;
  readonly sortBy?: "periodMonth" | "planCode" | "createdAt";
  readonly sortDirection?: "ASC" | "DESC";
}

export interface ReplaceKpiAllocationsForPlanInput {
  readonly kpiPlanId: string;
  readonly allowedCurrentStatuses: readonly KpiAllocationStatus[];
  readonly allocations: readonly KpiAllocation[];
  readonly updatedAt: number;
  readonly updatedByActorId: string;
}

export interface TransitionKpiAllocationsForPlanInput {
  readonly kpiPlanId: string;
  readonly fromStatus: KpiAllocationStatus;
  readonly toStatus: KpiAllocationStatus;
  readonly updatedAt: number;
  readonly updatedByActorId: string;
  readonly submittedAt?: number | null;
  readonly submittedByActorId?: string | null;
  readonly approvedAt?: number | null;
  readonly approvedByActorId?: string | null;
  readonly approvalNote?: string | null;
  readonly rejectedAt?: number | null;
  readonly rejectedByActorId?: string | null;
  readonly rejectionReason?: string | null;
  readonly publishedAt?: number | null;
  readonly publishedByActorId?: string | null;
}

export interface KpiPlanRepository {
  insertPlan(plan: KpiPlan, session: ClientSession): Promise<KpiPlan>;

  findPlanById(
    kpiPlanId: string,
    session?: ClientSession,
  ): Promise<KpiPlan | null>;

  findPlanByPlanCode(
    planCode: string,
    session?: ClientSession,
  ): Promise<KpiPlan | null>;

  findMaxGeneratedPlanCodeSequence(
    policy: Pick<BusinessCodePolicy, "prefix" | "width">,
    session?: ClientSession,
  ): Promise<number>;

  updateDraftCore(
    input: UpdateKpiDraftCoreInput,
    session: ClientSession,
  ): Promise<KpiPlan | null>;

  transitionStatus(
    input: TransitionKpiPlanStatusInput,
    session: ClientSession,
  ): Promise<KpiPlan | null>;

  listPlans(input: ListKpiPlansInput): Promise<readonly KpiPlan[]>;

  insertTargetMetrics(
    metrics: readonly KpiTargetMetric[],
    session: ClientSession,
  ): Promise<readonly KpiTargetMetric[]>;

  replaceTargetMetricsForDraftPlan(
    kpiPlanId: string,
    metrics: readonly KpiTargetMetric[],
    updatedAt: number,
    updatedByActorId: string,
    session: ClientSession,
  ): Promise<void>;

  listTargetMetricsByPlanId(
    kpiPlanId: string,
    session?: ClientSession,
  ): Promise<readonly KpiTargetMetric[]>;

  insertAllocations(
    allocations: readonly KpiAllocation[],
    session: ClientSession,
  ): Promise<readonly KpiAllocation[]>;

  replaceAllocationsForDraftPlan(
    kpiPlanId: string,
    allocations: readonly KpiAllocation[],
    updatedAt: number,
    updatedByActorId: string,
    session: ClientSession,
  ): Promise<void>;

  listAllocationsByPlanId(
    kpiPlanId: string,
    session?: ClientSession,
  ): Promise<readonly KpiAllocation[]>;

  listAllocations(input: {
    readonly status?: KpiAllocationStatus;
    readonly kpiPlanId?: string;
    readonly groupId?: string;
    readonly memberTalentId?: string;
    readonly memberEmploymentProfileId?: string;
    readonly limit: number;
  }): Promise<readonly KpiAllocation[]>;

  replaceAllocationsForPlan(
    input: ReplaceKpiAllocationsForPlanInput,
    session: ClientSession,
  ): Promise<void>;

  transitionAllocationsForPlan(
    input: TransitionKpiAllocationsForPlanInput,
    session: ClientSession,
  ): Promise<number>;

  activateAllocationsForPlan(
    kpiPlanId: string,
    publishedAt: number,
    session: ClientSession,
  ): Promise<void>;
}
