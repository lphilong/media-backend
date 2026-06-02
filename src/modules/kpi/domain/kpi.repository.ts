import { ClientSession } from "mongodb";
import { BusinessCodePolicy } from "@core/business-code/business-code-sequence.repository";
import {
  KpiAllocation,
  KpiAllocationStatusCount,
  KpiAllocationStatus,
  KpiActualSlotExcuse,
  KpiActualSlotExcuseReasonCode,
  KpiActualSlotExcuseStatus,
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
  readonly subjectIds?: readonly string[];
  readonly groupId?: string;
  readonly periodMonth?: string;
  readonly status?: KpiPlanStatus;
  readonly metricCode?: KpiMetricCode;
  readonly search?: string;
  readonly searchSubjectIds?: readonly string[];
  readonly limit: number;
  readonly sortBy?: "periodMonth" | "planCode" | "createdAt";
  readonly sortDirection?: "ASC" | "DESC";
  readonly cursor?: KpiPlanListCursor;
  readonly actualWorkspaceCursorOrder?: boolean;
}

export interface KpiPlanListCursor {
  readonly sortBy: "periodMonth" | "planCode";
  readonly sortDirection: "ASC" | "DESC";
  readonly value: string;
  readonly planId: string;
}

export type KpiActualWorkspaceDerivedSortBy =
  | "revenueActual"
  | "achievementPercent";

export interface KpiActualWorkspaceDerivedCursor {
  readonly sortBy: KpiActualWorkspaceDerivedSortBy;
  readonly sortDirection: "ASC" | "DESC";
  readonly revenueActual?: number;
  readonly achievementPercent?: number | null;
  readonly achievementNullRank?: 0 | 1;
  readonly planId: string;
}

export interface ListKpiActualWorkspaceDerivedPlansInput {
  readonly subjectType: "TALENT_GROUP";
  readonly subjectId?: string;
  readonly subjectIds?: readonly string[];
  readonly groupId?: string;
  readonly periodMonth?: string;
  readonly status?: KpiPlanStatus;
  readonly search?: string;
  readonly searchSubjectIds?: readonly string[];
  readonly allocationCoverage?: "complete" | "incomplete";
  readonly limit: number;
  readonly sortBy: KpiActualWorkspaceDerivedSortBy;
  readonly sortDirection: "ASC" | "DESC";
  readonly cursor?: KpiActualWorkspaceDerivedCursor;
}

export interface KpiActualWorkspaceDerivedPlanSortRow {
  readonly plan: KpiPlan;
  readonly revenueActual: number;
  readonly achievementPercent: number | null;
  readonly achievementNullRank: 0 | 1;
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

export interface KpiActualSlotExcuseIdentityInput {
  readonly kpiPlanId: string;
  readonly allocationId: string;
  readonly metricCode: KpiMetricCode;
  readonly actualDate: string;
}

export interface SetKpiActualSlotExcuseInput
  extends KpiActualSlotExcuseIdentityInput {
  readonly status: KpiActualSlotExcuseStatus;
  readonly reasonCode: KpiActualSlotExcuseReasonCode;
  readonly reasonText: string;
  readonly actorId: string;
  readonly now: number;
}

export interface RemoveKpiActualSlotExcuseInput {
  readonly excuseId: string;
  readonly kpiPlanId: string;
  readonly actorId: string;
  readonly now: number;
}

export interface KpiPlanRepository {
  insertPlan(plan: KpiPlan, session: ClientSession): Promise<KpiPlan>;

  findPlanById(
    kpiPlanId: string,
    session?: ClientSession,
  ): Promise<KpiPlan | null>;

  listPlansByIds(
    kpiPlanIds: readonly string[],
    session?: ClientSession,
  ): Promise<readonly KpiPlan[]>;

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

  listActualWorkspaceDerivedPlans(
    input: ListKpiActualWorkspaceDerivedPlansInput,
  ): Promise<readonly KpiActualWorkspaceDerivedPlanSortRow[]>;

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

  listTargetMetricsByPlanIds(
    kpiPlanIds: readonly string[],
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

  listAllocationsByPlanIds(
    kpiPlanIds: readonly string[],
    session?: ClientSession,
  ): Promise<readonly KpiAllocation[]>;

  countAllocationsByPlanIds(
    kpiPlanIds: readonly string[],
    session?: ClientSession,
  ): Promise<readonly KpiAllocationStatusCount[]>;

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

  findActualSlotExcuseById(
    excuseId: string,
    session?: ClientSession,
  ): Promise<KpiActualSlotExcuse | null>;

  findActiveActualSlotExcuseByIdentity(
    input: KpiActualSlotExcuseIdentityInput,
    session?: ClientSession,
  ): Promise<KpiActualSlotExcuse | null>;

  listActualSlotExcusesByPlanIds(
    kpiPlanIds: readonly string[],
    session?: ClientSession,
  ): Promise<readonly KpiActualSlotExcuse[]>;

  listActualSlotExcusesByPlanIdAndActualDate(
    kpiPlanId: string,
    actualDate: string,
    session?: ClientSession,
  ): Promise<readonly KpiActualSlotExcuse[]>;

  setActualSlotExcuse(
    input: SetKpiActualSlotExcuseInput,
    session: ClientSession,
  ): Promise<KpiActualSlotExcuse>;

  removeActualSlotExcuse(
    input: RemoveKpiActualSlotExcuseInput,
    session: ClientSession,
  ): Promise<KpiActualSlotExcuse | null>;
}
