import crypto from "crypto";
import { ClientSession } from "mongodb";
import { Actor } from "@core/actor/actor";
import {
  AuthoritativeAdminMutationBridge,
  AuthoritativeMutationControls,
} from "@core/application/authoritative-admin-mutation.bridge";
import { AuthoritativeAdminMutationIdentity } from "@core/application/authoritative-admin-mutation.permission-map";
import { AuditGuard } from "@core/audit/audit.guard";
import {
  BusinessCodeSequenceRepository,
  formatBusinessCode,
} from "@core/business-code/business-code-sequence.repository";
import { Permission } from "@core/permission/permission.enum";
import { PermissionContract } from "@core/permission/permission.contract";
import { PermissionGuard } from "@core/permission/permission.guard";
import { PermissionResolver } from "@core/permission/permission.resolver";
import { ReferenceSummary } from "@modules/reference-summary";
import { KPI_PLAN_CODE_POLICY } from "@modules/kpi/domain/kpi-code-policy";
import {
  getKpiMetricCatalogEntry,
  KPI_METRIC_CATALOG,
} from "@modules/kpi/domain/kpi-metric-catalog";
import { resolveManagedTalentGroupIds } from "@modules/kpi/domain/managed-group-scope";
import {
  KpiConflictError,
  KpiInvalidAllocationError,
  KpiInvalidSubjectReferenceError,
  KpiNotFoundError,
  KpiPermissionScopeError,
  KpiStateError,
  KpiValidationError,
} from "@modules/kpi/domain/kpi.errors";
import {
  KpiActualWorkspaceDerivedCursor,
  KpiActualWorkspaceDerivedPlanSortRow,
  KpiActualWorkspaceDerivedSortBy,
  KpiPlanListCursor,
  KpiPlanRepository,
  ListKpiPlansInput,
} from "@modules/kpi/domain/kpi.repository";
import { KpiActualRepository } from "@modules/kpi/domain/kpi-actual.repository";
import {
  KpiSubjectReadonlyAccess,
  kpiSubjectRefKey,
} from "@modules/kpi/domain/kpi-subject-readonly-access";
import { TalentGroupManagerAssignmentRepository } from "@modules/kpi/domain/talent-group-manager-assignment.repository";
import {
  KPI_CREATE_SUBJECT_TYPES,
  KPI_EXECUTABLE_SUBJECT_TYPES,
  KPI_METRIC_CODES,
  KPI_ACTUAL_SLOT_EXCUSE_REASON_CODES,
  KPI_ACTUAL_SLOT_EXCUSE_STATUSES,
  KPI_PLAN_CURRENCIES,
  KPI_PLAN_STATUSES,
  KPI_SORT_DIRECTIONS,
  KPI_SORT_FIELDS,
  KPI_SUBJECT_TYPES,
  KpiAllocation,
  KPI_ALLOCATION_STATUSES,
  KpiAllocationStatusCount,
  KpiAllocationWorkflowSummary,
  KpiAllocationStatus,
  KpiActualEntryStatusSummary,
  KpiActualDailyGridView,
  KpiAllocationTargetMetric,
  KpiActualCorrection,
  KpiActualEntry,
  KpiActualSlotExcuse,
  KpiActualSlotExcuseReasonCode,
  KpiActualSlotExcuseStatus,
  KpiActualSlotExcuseSummary,
  KpiDailyActualStatus,
  KpiActualPolicySnapshot,
  KpiActualWorkspaceActionHints,
  KpiActualWorkspaceMemberSummary,
  KpiActualWorkspaceMetricSummary,
  KpiActualWorkspacePlanDetail,
  KpiActualWorkspacePlanSummary,
  KpiFinalResultSnapshot,
  KpiMetricCode,
  KpiPlan,
  KpiPlanDetailView,
  KpiPlanListItemView,
  KpiPlanMutationView,
  KpiProgressView,
  KpiPlanStatus,
  KpiSubjectType,
  KpiTargetMetric,
} from "@modules/kpi/domain/kpi.types";
import {
  ArchiveKpiPlanCommand,
  CorrectKpiActualCommand,
  CreateKpiPlanCommand,
  CreateKpiActualCommand,
  FinalizeKpiPlanCommand,
  MarkKpiActualExcuseCommand,
  GetKpiPlanDetailQuery,
  GetKpiActualWorkspacePlanDetailQuery,
  GetKpiActualDailyGridQuery,
  GetKpiProgressQuery,
  ListKpiActualCorrectionsQuery,
  ListKpiActualWorkspacePlansQuery,
  ListKpiActualWorkspacePlansResult,
  GetMyKpiProgressQuery,
  KpiActualCorrectionResult,
  KpiActualMutationResult,
  KpiAllocationInput,
  ListKpiAllocationsQuery,
  ListKpiAllocationsResult,
  ListKpiManagedMembersQuery,
  ListKpiManagedMembersResult,
  UpsertKpiAllocationDraftCommand,
  SubmitKpiAllocationDraftCommand,
  ApproveKpiAllocationCommand,
  RejectKpiAllocationCommand,
  PublishKpiAllocationCommand,
  RemoveKpiActualExcuseCommand,
  KpiTargetMetricInput,
  ListKpiPlansQuery,
  ListKpiPlansResult,
  ListKpiActualCorrectionsResult,
  PublishKpiPlanCommand,
  ReplaceKpiAllocationsCommand,
  ReplaceKpiTargetMetricsCommand,
  UpdateKpiActualCommand,
  UpdateKpiDraftCoreCommand,
} from "@modules/kpi/shared/kpi.contracts";

const DEFAULT_TIMEZONE = "Asia/Ho_Chi_Minh";
const DEFAULT_TIMEZONE_OFFSET_MS = 7 * 60 * 60 * 1000;
const HCM_UTC_OFFSET_HOURS = 7;
const DEFAULT_ACTUAL_POLICY_VERSION = "kpi-actual-policy-v2";
const DEFAULT_ACTUAL_ENTRY_OPEN_LOCAL_TIME = "00:00";
const DEFAULT_ACTUAL_ENTRY_LOCK_LOCAL_TIME = "10:00";
const DEFAULT_MAX_DIRECT_EDITS_PER_ENTRY = 3;
const MAX_LIST_LIMIT = 100;
const DEFAULT_LIST_LIMIT = 50;
const TARGET_METRIC_INPUT_FIELDS = ["metricCode", "targetValue"] as const;
const ALLOCATION_INPUT_FIELDS = [
  "memberTalentId",
  "membershipId",
  "allocationStartDate",
  "allocationEndDate",
  "targetMetrics",
  "snapshotMemberDisplayName",
] as const;
const ALLOCATION_DRAFT_INPUT_FIELDS = [
  "employmentProfileId",
  "allocationStartDate",
  "allocationEndDate",
  "targetMetrics",
  "note",
] as const;
const INTEGER_TARGET_METRIC_CODES = new Set<KpiMetricCode>([
  "REVENUE_VND",
  "CONTENT_OUTPUT_COUNT",
  "EVENT_COMPLETION_COUNT",
  "ONBOARDED_TALENT_COUNT",
]);
const ACTUAL_ENTRY_INPUT_FIELDS = [
  "allocationId",
  "metricCode",
  "actualDate",
  "actualValue",
] as const;
const ACTUAL_UPDATE_INPUT_FIELDS = ["actualValue"] as const;
const ACTUAL_CORRECTION_INPUT_FIELDS = ["correctedValue", "reason"] as const;

interface NormalizedPlanPeriod {
  readonly periodMonth: string;
  readonly periodStartAt: number;
  readonly periodEndAt: number;
  readonly timezone: typeof DEFAULT_TIMEZONE;
}

interface NormalizedTargetMetric {
  readonly metricCode: KpiMetricCode;
  readonly targetValue: number;
}

interface NormalizedAllocationInput {
  readonly memberTalentId: string;
  readonly membershipId: string | null;
  readonly allocationStartDate: string;
  readonly allocationEndDate: string | null;
  readonly targetMetrics: readonly KpiAllocationTargetMetric[];
  readonly snapshotMemberDisplayName: string | null;
}

interface NormalizedEmploymentAllocationInput {
  readonly employmentProfileId: string;
  readonly allocationStartDate: string;
  readonly allocationEndDate: string | null;
  readonly targetMetrics: readonly KpiAllocationTargetMetric[];
  readonly note: string | null;
}

interface KpiActualWorkspaceAggregate {
  readonly summary: KpiActualWorkspacePlanSummary;
  readonly members: readonly KpiActualWorkspaceMemberSummary[];
}

type KpiActualWorkspaceCoverageFilter = "complete" | "incomplete";

interface NormalizedActualWorkspacePlansInput extends Omit<
  ListKpiPlansInput,
  "sortBy" | "sortDirection" | "cursor"
> {
  readonly sortBy: "periodMonth" | "planCode" | KpiActualWorkspaceDerivedSortBy;
  readonly sortDirection: "ASC" | "DESC";
  readonly cursor?: string;
  readonly allocationCoverage?: KpiActualWorkspaceCoverageFilter;
  readonly hasOverdueActuals?: boolean;
  readonly hasPendingActuals?: boolean;
}

interface ActualWorkspaceCursorEnvelope {
  readonly version: 1;
  readonly queryKey: string;
  readonly sortBy: "periodMonth" | "planCode" | KpiActualWorkspaceDerivedSortBy;
  readonly sortDirection: "ASC" | "DESC";
  readonly lastPeriodMonth?: string;
  readonly lastPlanCode?: string;
  readonly lastRevenueActual?: number;
  readonly lastAchievementPercent?: number | null;
  readonly lastAchievementNullRank?: 0 | 1;
  readonly lastPlanId: string;
}

interface ActualWorkspacePlanPage {
  readonly items: readonly KpiPlan[];
  readonly nextCursor?: string;
}

export class KpiAdminService {
  constructor(
    private readonly repository: KpiPlanRepository,
    private readonly actualRepository: KpiActualRepository,
    private readonly codeSequenceRepository: BusinessCodeSequenceRepository,
    private readonly subjectReadonlyAccess: KpiSubjectReadonlyAccess,
    private readonly managerAssignmentRepository: TalentGroupManagerAssignmentRepository,
    private readonly audit: AuditGuard,
    private readonly mutationBridge: AuthoritativeAdminMutationBridge,
    private readonly clock: () => number = Date.now,
  ) {}

  async createKpiPlan(
    actor: Actor,
    command: CreateKpiPlanCommand,
  ): Promise<KpiPlanMutationView> {
    const permission = this.assertPermission(actor, Permission.KPI_CREATE_PLAN);
    this.assertKpiGlobalScope(actor, "create KPI plan");
    const period = normalizePlanPeriod({
      periodMonth: command.periodMonth,
      periodStartAt: command.periodStartAt,
      periodEndAt: command.periodEndAt,
      timezone: command.timezone,
    });
    const subjectType = normalizeSubjectType(command.subjectType);
    const operation: AuthoritativeAdminMutationIdentity = "kpi.create-plan";

    assertCreateSubjectType(subjectType);
    assertCreateCommandHasNoAllocations(command);
    assertPlanPeriodIsNotPast(period.periodMonth, this.clock());

    const targetMetrics = normalizeTargetMetrics(
      command.targetMetrics,
      subjectType,
      command.currencyCode ?? "VND",
    );

    return this.executeMutation(
      actor,
      permission,
      operation,
      `kpi-plan:create:${command.subjectType}:${command.subjectId}`,
      async (session) => {
        await this.assertSubjectReferenceActive(
          subjectType,
          normalizeRequiredText(command.subjectId, "subjectId"),
          session,
        );

        const now = this.clock();
        const planCode = await this.allocateGeneratedPlanCode(session);
        const plan: KpiPlan = {
          id: crypto.randomUUID(),
          planCode,
          normalizedPlanCode: normalizeSearchToken(planCode),
          title: normalizeRequiredText(command.title, "title"),
          normalizedTitle: normalizeSearchToken(command.title),
          description: normalizeNullableText(command.description),
          subjectType,
          subjectId: normalizeRequiredText(command.subjectId, "subjectId"),
          status: "DRAFT",
          currencyCode: normalizeCurrency(command.currencyCode ?? "VND"),
          periodMonth: period.periodMonth,
          periodStartAt: period.periodStartAt,
          periodEndAt: period.periodEndAt,
          timezone: period.timezone,
          actualPolicySnapshot: null,
          publishedAt: null,
          publishedByActorId: null,
          finalizedAt: null,
          finalizedByActorId: null,
          finalResult: null,
          archivedAt: null,
          archivedByActorId: null,
          createdAt: now,
          createdByActorId: actor.id,
          updatedAt: now,
          updatedByActorId: actor.id,
          externalRef: normalizeNullableText(command.externalRef),
        };

        const metricRecords = buildTargetMetricRecords(
          plan.id,
          targetMetrics,
          now,
        );
        const allocationRecords: KpiAllocation[] = [];

        await this.repository.insertPlan(plan, session);
        await this.repository.insertTargetMetrics(metricRecords, session);
        await this.repository.insertAllocations(allocationRecords, session);
        await this.recordAudit({
          actor,
          permission,
          kpiPlanId: plan.id,
          mutationType: operation,
          metadata: {
            planCode: plan.planCode,
            subjectType: plan.subjectType,
            status: plan.status,
            periodMonth: plan.periodMonth,
            targetMetricCount: metricRecords.length,
            allocationCount: allocationRecords.length,
          },
          session,
        });

        return this.loadPlanDetail(plan.id, session);
      },
    );
  }

  async listKpiPlans(
    actor: Actor,
    query: ListKpiPlansQuery,
  ): Promise<ListKpiPlansResult> {
    this.assertContextPermission(actor, Permission.KPI_READ);
    const input = this.toListPlansInput(query);

    if (this.hasKpiGlobalScope(actor)) {
      const items = await this.repository.listPlans(input);
      return { items: await this.withAllocationWorkflowSummaries(items) };
    }

    if (!this.hasKpiManagedGroupScope(actor)) {
      throw new KpiPermissionScopeError(
        "Cannot list KPI plans: kpi.global or kpi.managedGroup scope is required",
      );
    }

    return this.listManagedGroupKpiPlans(actor, input);
  }

  async listKpiActualWorkspacePlans(
    actor: Actor,
    query: ListKpiActualWorkspacePlansQuery,
  ): Promise<ListKpiActualWorkspacePlansResult> {
    this.assertContextPermission(actor, Permission.KPI_READ_PROGRESS);
    const input = this.toListActualWorkspacePlansInput(query);
    if (
      input.groupId !== undefined &&
      input.subjectId !== undefined &&
      input.groupId !== input.subjectId
    ) {
      return { items: [] };
    }

    const page = this.hasKpiGlobalScope(actor)
      ? await this.listActualWorkspacePlanPage(input)
      : await this.listManagedGroupActualWorkspacePlans(actor, input);
    const aggregates = await this.buildActualWorkspaceAggregates(
      actor,
      page.items,
    );
    return {
      items: aggregates.map((aggregate) => aggregate.summary),
      nextCursor: page.nextCursor,
    };
  }

  async getKpiActualWorkspacePlanDetail(
    actor: Actor,
    query: GetKpiActualWorkspacePlanDetailQuery,
  ): Promise<KpiActualWorkspacePlanDetail> {
    this.assertContextPermission(actor, Permission.KPI_READ_PROGRESS);
    const plan = await this.requirePlan(query.kpiPlanId);
    if (plan.subjectType !== "TALENT_GROUP") {
      throw new KpiPermissionScopeError(
        "KPI actual workspace supports only TALENT_GROUP plans",
      );
    }
    if (!this.hasKpiGlobalScope(actor)) {
      await this.assertActorCanReadManagedGroupProgress(actor, plan);
    }
    const [aggregate] = await this.buildActualWorkspaceAggregates(actor, [
      plan,
    ]);
    if (!aggregate) {
      throw new KpiNotFoundError(plan.id);
    }
    return {
      ...aggregate.summary,
      finalResult:
        plan.status === "FINALIZED" ? (plan.finalResult ?? null) : null,
      members: aggregate.members,
    };
  }

  async getKpiPlanDetail(
    actor: Actor,
    query: GetKpiPlanDetailQuery,
  ): Promise<KpiPlanDetailView> {
    this.assertContextPermission(actor, Permission.KPI_READ);
    if (this.hasKpiGlobalScope(actor)) {
      return this.loadPlanDetail(query.kpiPlanId);
    }
    if (!this.hasKpiManagedGroupScope(actor)) {
      throw new KpiPermissionScopeError(
        "Cannot read KPI plan detail: kpi.global or kpi.managedGroup scope is required",
      );
    }

    const plan = await this.requirePlan(query.kpiPlanId);
    if (plan.status !== "PUBLISHED") {
      throw new KpiPermissionScopeError(
        "KPI manager-scoped detail is supported only for PUBLISHED plans",
      );
    }
    if (plan.subjectType !== "TALENT_GROUP") {
      throw new KpiPermissionScopeError(
        "KPI manager-scoped detail is supported only for TALENT_GROUP plans",
      );
    }
    const managedGroupIds = await this.resolveManagedTalentGroupIds(actor);
    if (!managedGroupIds.includes(plan.subjectId)) {
      throw new KpiPermissionScopeError(
        `KPI actor is not an active manager for group ${plan.subjectId}`,
      );
    }

    return this.loadPlanDetail(plan.id);
  }

  async updateKpiDraftCore(
    actor: Actor,
    command: UpdateKpiDraftCoreCommand,
  ): Promise<KpiPlanMutationView> {
    const permission = this.assertPermission(
      actor,
      Permission.KPI_UPDATE_DRAFT,
    );
    this.assertKpiGlobalScope(actor, "update KPI draft");
    const operation: AuthoritativeAdminMutationIdentity =
      "kpi.update-draft-core";
    const changedFields = listDefinedFields(command, [
      "title",
      "description",
      "currencyCode",
      "periodMonth",
      "periodStartAt",
      "periodEndAt",
      "timezone",
      "externalRef",
    ]);

    return this.executeMutation(
      actor,
      permission,
      operation,
      `kpi-plan:${command.kpiPlanId}`,
      async (session) => {
        const current = await this.requirePlan(command.kpiPlanId, session);
        this.assertDraft(current, "update draft core");

        const period =
          command.periodMonth !== undefined ||
          command.periodStartAt !== undefined ||
          command.periodEndAt !== undefined ||
          command.timezone !== undefined
            ? normalizePlanPeriod({
                periodMonth: command.periodMonth ?? current.periodMonth,
                periodStartAt: command.periodStartAt ?? current.periodStartAt,
                periodEndAt: command.periodEndAt ?? current.periodEndAt,
                timezone: command.timezone ?? current.timezone,
              })
            : undefined;

        const updated = await this.repository.updateDraftCore(
          {
            kpiPlanId: current.id,
            title:
              command.title === undefined
                ? undefined
                : normalizeRequiredText(command.title, "title"),
            normalizedTitle:
              command.title === undefined
                ? undefined
                : normalizeSearchToken(command.title),
            description:
              command.description === undefined
                ? undefined
                : normalizeNullableText(command.description),
            currencyCode:
              command.currencyCode === undefined
                ? undefined
                : normalizeCurrency(command.currencyCode),
            periodMonth: period?.periodMonth,
            periodStartAt: period?.periodStartAt,
            periodEndAt: period?.periodEndAt,
            timezone: period?.timezone,
            externalRef:
              command.externalRef === undefined
                ? undefined
                : normalizeNullableText(command.externalRef),
            updatedAt: this.clock(),
            updatedByActorId: actor.id,
          },
          session,
        );

        if (!updated) {
          throw new KpiStateError(
            `KPI plan ${current.id} is not DRAFT and cannot update draft core`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          kpiPlanId: updated.id,
          mutationType: operation,
          metadata: {
            status: updated.status,
            changedFields,
          },
          session,
        });

        return this.loadPlanDetail(updated.id, session);
      },
    );
  }

  async replaceKpiTargetMetrics(
    actor: Actor,
    command: ReplaceKpiTargetMetricsCommand,
  ): Promise<KpiPlanMutationView> {
    const permission = this.assertPermission(
      actor,
      Permission.KPI_UPDATE_DRAFT,
    );
    this.assertKpiGlobalScope(actor, "replace KPI target metrics");
    const operation: AuthoritativeAdminMutationIdentity =
      "kpi.replace-target-metrics";

    return this.executeMutation(
      actor,
      permission,
      operation,
      `kpi-plan:${command.kpiPlanId}`,
      async (session) => {
        const current = await this.requirePlan(command.kpiPlanId, session);
        this.assertDraft(current, "replace target metrics");
        const normalized = normalizeTargetMetrics(
          command.targetMetrics,
          current.subjectType,
          current.currencyCode,
        );
        const now = this.clock();
        const records = buildTargetMetricRecords(current.id, normalized, now);
        await this.repository.replaceTargetMetricsForDraftPlan(
          current.id,
          records,
          now,
          actor.id,
          session,
        );
        await this.recordAudit({
          actor,
          permission,
          kpiPlanId: current.id,
          mutationType: operation,
          metadata: {
            status: current.status,
            targetMetricCount: records.length,
            metricCodes: records.map((metric) => metric.metricCode),
          },
          session,
        });
        return this.loadPlanDetail(current.id, session);
      },
    );
  }

  async replaceKpiAllocations(
    actor: Actor,
    command: ReplaceKpiAllocationsCommand,
  ): Promise<KpiPlanMutationView> {
    const permission = this.assertPermission(
      actor,
      Permission.KPI_MANAGE_ALLOCATION,
    );
    this.assertKpiGlobalScope(actor, "replace KPI allocations");
    const operation: AuthoritativeAdminMutationIdentity =
      "kpi.replace-allocations";

    return this.executeMutation(
      actor,
      permission,
      operation,
      `kpi-plan:${command.kpiPlanId}`,
      async (session) => {
        const current = await this.requirePlan(command.kpiPlanId, session);
        this.assertDraft(current, "replace allocations");
        if (current.subjectType !== "TALENT_GROUP") {
          throw new KpiInvalidAllocationError(
            "KPI allocations are allowed only for TALENT_GROUP plans",
          );
        }

        const targetMetrics = await this.repository.listTargetMetricsByPlanId(
          current.id,
          session,
        );
        const normalized = normalizeAllocations(
          command.allocations,
          targetMetrics,
        );
        const records = await this.buildAllocationRecords(
          current,
          normalized,
          targetMetrics,
          this.clock(),
          session,
        );
        await this.repository.replaceAllocationsForDraftPlan(
          current.id,
          records,
          this.clock(),
          actor.id,
          session,
        );
        await this.recordAudit({
          actor,
          permission,
          kpiPlanId: current.id,
          mutationType: operation,
          metadata: {
            status: current.status,
            allocationCount: records.length,
          },
          session,
        });
        return this.loadPlanDetail(current.id, session);
      },
    );
  }

  async listKpiAllocations(
    actor: Actor,
    query: ListKpiAllocationsQuery,
  ): Promise<ListKpiAllocationsResult> {
    this.assertContextPermission(actor, Permission.KPI_READ);
    const status =
      query.status === undefined
        ? undefined
        : normalizeAllocationStatus(query.status);
    const kpiPlanId = normalizeOptionalText(query.kpiPlanId);
    const groupId = normalizeOptionalText(query.groupId);
    const limit = normalizeLimit(query.limit);

    if (this.hasKpiGlobalScope(actor)) {
      return {
        items: await this.repository.listAllocations({
          status,
          kpiPlanId,
          groupId,
          limit,
        }),
      };
    }

    if (!this.hasKpiManagedGroupScope(actor)) {
      throw new KpiPermissionScopeError(
        "Cannot list KPI allocations: kpi.global or kpi.managedGroup scope is required",
      );
    }

    const managedGroupIds = await this.resolveManagedTalentGroupIds(actor);
    const requestedGroups = groupId ? [groupId] : managedGroupIds;
    if (requestedGroups.some((id) => !managedGroupIds.includes(id))) {
      return { items: [] };
    }
    const results = await Promise.all(
      requestedGroups.map((managedGroupId) =>
        this.repository.listAllocations({
          status,
          kpiPlanId,
          groupId: managedGroupId,
          limit,
        }),
      ),
    );
    return { items: results.flat().slice(0, limit) };
  }

  async listKpiManagedMembers(
    actor: Actor,
    query: ListKpiManagedMembersQuery,
  ): Promise<ListKpiManagedMembersResult> {
    this.assertContextPermission(actor, Permission.KPI_ENTER_ACTUAL);
    const plan = await this.requirePlan(query.kpiPlanId);
    await this.assertActorCanDraftAllocation(actor, plan);
    const items =
      await this.subjectReadonlyAccess.listActiveInternalGroupMembers(
        plan.subjectId,
        {
          search: normalizeOptionalText(query.search),
          limit: normalizeLimit(query.limit),
        },
      );
    return { items };
  }

  async upsertKpiAllocationDraft(
    actor: Actor,
    command: UpsertKpiAllocationDraftCommand,
  ): Promise<KpiPlanMutationView> {
    const permission = this.assertContextPermission(
      actor,
      Permission.KPI_ENTER_ACTUAL,
    );
    const operation: AuthoritativeAdminMutationIdentity =
      "kpi.allocation-draft.upsert";

    return this.executeMutation(
      actor,
      permission,
      operation,
      `kpi-plan:${command.kpiPlanId}`,
      async (session) => {
        const plan = await this.requirePlan(command.kpiPlanId, session);
        await this.assertActorCanDraftAllocation(actor, plan, session);
        const targetMetrics = await this.repository.listTargetMetricsByPlanId(
          plan.id,
          session,
        );
        const normalized = normalizeEmploymentAllocations(
          command.allocations,
          targetMetrics,
        );
        const existing = await this.repository.listAllocationsByPlanId(
          plan.id,
          session,
        );
        if (
          existing.some((allocation) => allocation.allocationStatus !== "DRAFT")
        ) {
          throw new KpiStateError(
            "KPI allocation draft can be edited only while all rows are DRAFT",
          );
        }
        const now = this.clock();
        const records = await this.buildEmploymentAllocationRecords(
          actor,
          plan,
          normalized,
          targetMetrics,
          now,
          session,
        );
        await this.repository.replaceAllocationsForPlan(
          {
            kpiPlanId: plan.id,
            allowedCurrentStatuses: ["DRAFT"],
            allocations: records,
            updatedAt: now,
            updatedByActorId: actor.id,
          },
          session,
        );
        await this.recordAudit({
          actor,
          permission,
          kpiPlanId: plan.id,
          mutationType: operation,
          metadata: {
            status: "DRAFT",
            allocationCount: records.length,
          },
          session,
        });
        return this.loadPlanDetail(plan.id, session);
      },
    );
  }

  async submitKpiAllocationDraft(
    actor: Actor,
    command: SubmitKpiAllocationDraftCommand,
  ): Promise<KpiPlanMutationView> {
    const permission = this.assertContextPermission(
      actor,
      Permission.KPI_ENTER_ACTUAL,
    );
    const operation: AuthoritativeAdminMutationIdentity =
      "kpi.allocation.submit";

    return this.executeMutation(
      actor,
      permission,
      operation,
      `kpi-plan:${command.kpiPlanId}`,
      async (session) => {
        const plan = await this.requirePlan(command.kpiPlanId, session);
        await this.assertActorCanDraftAllocation(actor, plan, session);
        const allocations = await this.repository.listAllocationsByPlanId(
          plan.id,
          session,
        );
        if (
          allocations.length === 0 ||
          allocations.some(
            (allocation) => allocation.allocationStatus !== "DRAFT",
          )
        ) {
          throw new KpiStateError(
            "KPI allocation draft requires DRAFT rows before submit",
          );
        }
        const now = this.clock();
        const modified = await this.repository.transitionAllocationsForPlan(
          {
            kpiPlanId: plan.id,
            fromStatus: "DRAFT",
            toStatus: "PENDING_APPROVAL",
            updatedAt: now,
            updatedByActorId: actor.id,
            submittedAt: now,
            submittedByActorId: actor.id,
          },
          session,
        );
        if (modified === 0) {
          throw new KpiStateError("KPI allocation draft is not submittable");
        }
        await this.recordAudit({
          actor,
          permission,
          kpiPlanId: plan.id,
          mutationType: operation,
          metadata: {
            nextStatus: "PENDING_APPROVAL",
            allocationCount: modified,
          },
          session,
        });
        return this.loadPlanDetail(plan.id, session);
      },
    );
  }

  async approveKpiAllocation(
    actor: Actor,
    command: ApproveKpiAllocationCommand,
  ): Promise<KpiPlanMutationView> {
    return this.transitionAdminAllocationApproval(actor, command.kpiPlanId, {
      operation: "kpi.allocation.approve",
      permissionCode: Permission.KPI_MANAGE_ALLOCATION,
      fromStatus: "PENDING_APPROVAL",
      toStatus: "APPROVED",
      approvalNote: normalizeNullableText(command.approvalNote) ?? null,
    });
  }

  async rejectKpiAllocation(
    actor: Actor,
    command: RejectKpiAllocationCommand,
  ): Promise<KpiPlanMutationView> {
    return this.transitionAdminAllocationApproval(actor, command.kpiPlanId, {
      operation: "kpi.allocation.reject",
      permissionCode: Permission.KPI_MANAGE_ALLOCATION,
      fromStatus: "PENDING_APPROVAL",
      toStatus: "REJECTED",
      rejectionReason: normalizeRequiredText(
        command.rejectionReason,
        "rejectionReason",
      ),
    });
  }

  async publishKpiAllocation(
    actor: Actor,
    command: PublishKpiAllocationCommand,
  ): Promise<KpiPlanMutationView> {
    const permission = this.assertPermission(actor, Permission.KPI_PUBLISH);
    this.assertKpiGlobalScope(actor, "publish KPI allocation");
    const operation: AuthoritativeAdminMutationIdentity =
      "kpi.allocation.publish";

    return this.executeMutation(
      actor,
      permission,
      operation,
      `kpi-plan:${command.kpiPlanId}`,
      async (session) => {
        const plan = await this.requirePlan(command.kpiPlanId, session);
        assertExecutableSubjectType(plan.subjectType);
        if (plan.status !== "PUBLISHED") {
          throw new KpiStateError(
            "KPI allocation can be published only after the KPI plan is PUBLISHED",
          );
        }
        const [targetMetrics, allocations] = await Promise.all([
          this.repository.listTargetMetricsByPlanId(plan.id, session),
          this.repository.listAllocationsByPlanId(plan.id, session),
        ]);
        await this.validateGroupAllocationsForTransition(
          plan,
          targetMetrics,
          allocations,
          "APPROVED",
          session,
        );
        const now = this.clock();
        const modified = await this.repository.transitionAllocationsForPlan(
          {
            kpiPlanId: plan.id,
            fromStatus: "APPROVED",
            toStatus: "PUBLISHED",
            updatedAt: now,
            updatedByActorId: actor.id,
            publishedAt: now,
            publishedByActorId: actor.id,
          },
          session,
        );
        if (modified === 0) {
          throw new KpiStateError("KPI allocation is not publishable");
        }
        await this.recordAudit({
          actor,
          permission,
          kpiPlanId: plan.id,
          mutationType: operation,
          metadata: { nextStatus: "PUBLISHED", allocationCount: modified },
          session,
        });
        return this.loadPlanDetail(plan.id, session);
      },
    );
  }

  async publishKpiPlan(
    actor: Actor,
    command: PublishKpiPlanCommand,
  ): Promise<KpiPlanMutationView> {
    const permission = this.assertPermission(actor, Permission.KPI_PUBLISH);
    this.assertKpiGlobalScope(actor, "publish KPI plan");
    const operation: AuthoritativeAdminMutationIdentity = "kpi.publish";

    return this.executeMutation(
      actor,
      permission,
      operation,
      `kpi-plan:${command.kpiPlanId}`,
      async (session) => {
        const current = await this.requirePlan(command.kpiPlanId, session);
        assertExecutableSubjectType(current.subjectType);
        this.assertDraft(current, "publish");
        const targetMetrics = await this.repository.listTargetMetricsByPlanId(
          current.id,
          session,
        );

        if (targetMetrics.length === 0) {
          throw new KpiValidationError(
            "KPI publish requires at least one target metric",
          );
        }
        validateTargetMetricValues(targetMetrics, "targetMetrics");

        const now = this.clock();
        const actualPolicySnapshot = createDefaultActualPolicySnapshot(now);
        const published = await this.repository.transitionStatus(
          {
            kpiPlanId: current.id,
            fromStatuses: ["DRAFT"],
            toStatus: "PUBLISHED",
            publishedAt: now,
            publishedByActorId: actor.id,
            actualPolicySnapshot,
            updatedAt: now,
            updatedByActorId: actor.id,
          },
          session,
        );

        if (!published) {
          throw new KpiStateError(
            `KPI plan ${current.id} is not DRAFT and cannot publish`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          kpiPlanId: published.id,
          mutationType: operation,
          metadata: {
            subjectType: published.subjectType,
            previousStatus: current.status,
            nextStatus: published.status,
            publishedAt: now,
            actualPolicyVersion: actualPolicySnapshot.policyVersion,
          },
          session,
        });

        return this.loadPlanDetail(current.id, session);
      },
    );
  }

  async archiveKpiPlan(
    actor: Actor,
    command: ArchiveKpiPlanCommand,
  ): Promise<KpiPlanMutationView> {
    const permission = this.assertPermission(actor, Permission.KPI_ARCHIVE);
    this.assertKpiGlobalScope(actor, "archive KPI plan");
    const operation: AuthoritativeAdminMutationIdentity = "kpi.archive";

    return this.executeMutation(
      actor,
      permission,
      operation,
      `kpi-plan:${command.kpiPlanId}`,
      async (session) => {
        const current = await this.requirePlan(command.kpiPlanId, session);
        if (current.status === "ARCHIVED") {
          throw new KpiStateError(`KPI plan ${current.id} is already ARCHIVED`);
        }
        if (current.subjectType === "ORG_UNIT" && current.status !== "DRAFT") {
          throw new KpiStateError(
            "Org Unit KPI archive is enabled only for draft planning",
          );
        }

        const now = this.clock();
        const archived = await this.repository.transitionStatus(
          {
            kpiPlanId: current.id,
            fromStatuses: ["DRAFT", "PUBLISHED", "FINALIZED"],
            toStatus: "ARCHIVED",
            archivedAt: now,
            archivedByActorId: actor.id,
            updatedAt: now,
            updatedByActorId: actor.id,
          },
          session,
        );

        if (!archived) {
          throw new KpiStateError(
            `KPI plan ${current.id} cannot transition to ARCHIVED`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          kpiPlanId: archived.id,
          mutationType: operation,
          metadata: {
            subjectType: archived.subjectType,
            previousStatus: current.status,
            nextStatus: archived.status,
            archivedAt: now,
          },
          session,
        });

        return this.loadPlanDetail(current.id, session);
      },
    );
  }

  async createOrSetKpiActual(
    actor: Actor,
    command: CreateKpiActualCommand,
  ): Promise<KpiActualMutationResult> {
    const permission = this.assertContextPermission(
      actor,
      Permission.KPI_ENTER_ACTUAL,
    );
    const operation: AuthoritativeAdminMutationIdentity = "kpi.enter-actual";

    return this.executeMutation(
      actor,
      permission,
      operation,
      `kpi-actual:${command.kpiPlanId}`,
      async (session) => {
        const plan = await this.requirePlan(command.kpiPlanId, session);
        const allocationId = normalizeRequiredText(
          command.allocationId,
          "allocationId",
        );
        const metricCode = normalizeMetricCode(command.metricCode);
        const actualDate = normalizeActualDateText(
          command.actualDate,
          "actualDate",
        );
        const actualValue = normalizeMetricValue(
          command.actualValue,
          metricCode,
          "actualValue",
        );
        assertExecutableSubjectType(plan.subjectType);
        this.assertActualMutationPlanOpen(plan, "enter actual");
        const policy = requireActualPolicySnapshot(plan);
        assertActualDateWithinPlan(plan, actualDate);

        const allocation = await this.requireActiveAllocation(
          plan,
          allocationId,
          metricCode,
          session,
        );
        await this.assertActorCanManageAllocationActual(
          actor,
          plan,
          allocation,
          session,
        );

        assertDirectEditWindowOpen(policy, actualDate, this.clock());

        const existing = await this.actualRepository.findEntryByIdentity(
          {
            kpiPlanId: plan.id,
            allocationId: allocation.id,
            metricCode,
            actualDate,
          },
          session,
        );

        if (existing) {
          if (numbersEqual(existing.actualValue, actualValue)) {
            return { actualEntry: existing };
          }
          throw new KpiConflictError(
            "KPI actual already exists with a different value; use PATCH /actuals/:actualEntryId to edit it",
          );
        }

        await this.assertNoActiveActualSlotExcuse(
          plan.id,
          allocation.id,
          metricCode,
          actualDate,
          session,
        );

        const now = this.clock();
        const entry: KpiActualEntry = {
          id: crypto.randomUUID(),
          kpiPlanId: plan.id,
          allocationId: allocation.id,
          memberTalentId: allocation.memberTalentId,
          metricCode,
          actualDate,
          actualValue,
          effectiveValue: actualValue,
          editCount: 0,
          correctionCount: 0,
          latestCorrectionId: null,
          createdAt: now,
          createdByActorId: actor.id,
          updatedAt: now,
          updatedByActorId: actor.id,
          lastEditedAt: null,
          lastEditedByActorId: null,
        };

        const created = await this.actualRepository.insertEntry(entry, session);
        await this.recordAudit({
          actor,
          permission,
          kpiPlanId: plan.id,
          mutationType: operation,
          targetId: created.id,
          targetType: "kpi-actual-entry",
          metadata: {
            action: "create",
            allocationId: created.allocationId,
            memberTalentId: created.memberTalentId,
            metricCode: created.metricCode,
            actualDate: created.actualDate,
            newValue: created.actualValue,
            editCount: created.editCount,
          },
          session,
        });
        return { actualEntry: created };
      },
    );
  }

  async markKpiActualExcuse(
    actor: Actor,
    command: MarkKpiActualExcuseCommand,
  ): Promise<KpiPlanMutationView> {
    const permission = this.assertContextPermission(
      actor,
      Permission.KPI_ENTER_ACTUAL,
    );
    const operation: AuthoritativeAdminMutationIdentity =
      "kpi.mark-actual-excuse";

    return this.executeMutation(
      actor,
      permission,
      operation,
      `kpi-actual-excuse:${command.kpiPlanId}`,
      async (session) => {
        const plan = await this.requirePlan(command.kpiPlanId, session);
        const allocationId = normalizeRequiredText(
          command.allocationId,
          "allocationId",
        );
        const metricCode = normalizeMetricCode(command.metricCode);
        const actualDate = normalizeActualDateText(
          command.actualDate,
          "actualDate",
        );
        const status = normalizeActualSlotExcuseStatus(command.status);
        const reasonCode = normalizeActualSlotExcuseReasonCode(
          command.reasonCode,
        );
        const reasonText = normalizeRequiredText(
          command.reasonText,
          "reasonText",
        );

        assertExecutableSubjectType(plan.subjectType);
        this.assertActualMutationPlanOpen(plan, "mark actual excuse");
        assertActualDateWithinPlan(plan, actualDate);
        const allocation = await this.requireActiveAllocation(
          plan,
          allocationId,
          metricCode,
          session,
        );
        await this.assertActorCanManageAllocationActual(
          actor,
          plan,
          allocation,
          session,
        );

        const existingActual = await this.actualRepository.findEntryByIdentity(
          {
            kpiPlanId: plan.id,
            allocationId: allocation.id,
            metricCode,
            actualDate,
          },
          session,
        );
        if (existingActual) {
          throw new KpiConflictError(
            "KPI actual entry already exists for this slot; remove or correct the actual instead of marking it excused",
          );
        }

        const now = this.clock();
        const excuse = await this.repository.setActualSlotExcuse(
          {
            kpiPlanId: plan.id,
            allocationId: allocation.id,
            metricCode,
            actualDate,
            status,
            reasonCode,
            reasonText,
            actorId: actor.id,
            now,
          },
          session,
        );

        await this.recordAudit({
          actor,
          permission,
          kpiPlanId: plan.id,
          mutationType: operation,
          targetId: excuse.id,
          targetType: "kpi-actual-slot-excuse",
          metadata: {
            action: "mark",
            allocationId: excuse.allocationId,
            metricCode: excuse.metricCode,
            actualDate: excuse.actualDate,
            status: excuse.status,
            reasonCode: excuse.reasonCode,
          },
          session,
        });

        return this.loadPlanDetail(plan.id, session);
      },
    );
  }

  async removeKpiActualExcuse(
    actor: Actor,
    command: RemoveKpiActualExcuseCommand,
  ): Promise<KpiPlanMutationView> {
    const permission = this.assertContextPermission(
      actor,
      Permission.KPI_ENTER_ACTUAL,
    );
    const operation: AuthoritativeAdminMutationIdentity =
      "kpi.remove-actual-excuse";

    return this.executeMutation(
      actor,
      permission,
      operation,
      `kpi-actual-excuse:${command.excuseId}`,
      async (session) => {
        const plan = await this.requirePlan(command.kpiPlanId, session);
        const excuse = await this.repository.findActualSlotExcuseById(
          normalizeRequiredText(command.excuseId, "excuseId"),
          session,
        );
        if (
          !excuse ||
          excuse.kpiPlanId !== plan.id ||
          excuse.deletedAt !== null
        ) {
          throw new KpiNotFoundError(command.excuseId);
        }
        assertExecutableSubjectType(plan.subjectType);
        this.assertActualMutationPlanOpen(plan, "remove actual excuse");
        assertActualDateWithinPlan(plan, excuse.actualDate);
        const allocation = await this.requireActiveAllocation(
          plan,
          excuse.allocationId,
          excuse.metricCode,
          session,
        );
        await this.assertActorCanManageAllocationActual(
          actor,
          plan,
          allocation,
          session,
        );

        const removed = await this.repository.removeActualSlotExcuse(
          {
            excuseId: excuse.id,
            kpiPlanId: plan.id,
            actorId: actor.id,
            now: this.clock(),
          },
          session,
        );
        if (!removed) {
          throw new KpiNotFoundError(command.excuseId);
        }

        await this.recordAudit({
          actor,
          permission,
          kpiPlanId: plan.id,
          mutationType: operation,
          targetId: removed.id,
          targetType: "kpi-actual-slot-excuse",
          metadata: {
            action: "remove",
            allocationId: removed.allocationId,
            metricCode: removed.metricCode,
            actualDate: removed.actualDate,
            status: removed.status,
            reasonCode: removed.reasonCode,
          },
          session,
        });

        return this.loadPlanDetail(plan.id, session);
      },
    );
  }

  async updateKpiActualDirect(
    actor: Actor,
    command: UpdateKpiActualCommand,
  ): Promise<KpiActualMutationResult> {
    const permission = this.assertContextPermission(
      actor,
      Permission.KPI_ENTER_ACTUAL,
    );
    const operation: AuthoritativeAdminMutationIdentity = "kpi.update-actual";

    return this.executeMutation(
      actor,
      permission,
      operation,
      `kpi-actual:${command.actualEntryId}`,
      async (session) => {
        const plan = await this.requirePlan(command.kpiPlanId, session);
        const entry = await this.requireActualEntry(
          command.actualEntryId,
          plan.id,
          session,
        );
        const actualValue = normalizeMetricValue(
          command.actualValue,
          entry.metricCode,
          "actualValue",
        );
        assertExecutableSubjectType(plan.subjectType);
        this.assertActualMutationPlanOpen(plan, "update actual");
        const policy = requireActualPolicySnapshot(plan);
        assertActualDateWithinPlan(plan, entry.actualDate);
        assertDirectEditWindowOpen(policy, entry.actualDate, this.clock());
        const allocation = await this.requireActiveAllocation(
          plan,
          entry.allocationId,
          entry.metricCode,
          session,
        );
        await this.assertActorCanManageAllocationActual(
          actor,
          plan,
          allocation,
          session,
        );
        await this.assertNoActiveActualSlotExcuse(
          plan.id,
          allocation.id,
          entry.metricCode,
          entry.actualDate,
          session,
        );
        return {
          actualEntry: await this.updateExistingActualDirect(
            actor,
            permission,
            operation,
            entry,
            actualValue,
            policy,
            session,
          ),
        };
      },
    );
  }

  async correctKpiActual(
    actor: Actor,
    command: CorrectKpiActualCommand,
  ): Promise<KpiActualCorrectionResult> {
    const permission = this.assertContextPermission(
      actor,
      Permission.KPI_CORRECT_ACTUAL,
    );
    const operation: AuthoritativeAdminMutationIdentity = "kpi.correct-actual";

    return this.executeMutation(
      actor,
      permission,
      operation,
      `kpi-actual-correction:${command.actualEntryId}`,
      async (session) => {
        const plan = await this.requirePlan(command.kpiPlanId, session);
        const entry = await this.requireActualEntry(
          command.actualEntryId,
          plan.id,
          session,
        );
        const reason = normalizeRequiredText(command.reason, "reason");
        const correctedValue = normalizeMetricValue(
          command.correctedValue,
          entry.metricCode,
          "correctedValue",
        );
        assertExecutableSubjectType(plan.subjectType);
        this.assertActualMutationPlanOpen(plan, "correct actual");
        const policy = requireActualPolicySnapshot(plan);
        assertActualDateWithinPlan(plan, entry.actualDate);
        assertCorrectionWindowOpen(policy, entry.actualDate, this.clock());
        const allocation = await this.requireActiveAllocation(
          plan,
          entry.allocationId,
          entry.metricCode,
          session,
        );
        this.assertActualEntryMatchesAllocation(entry, allocation);
        await this.assertNoActiveActualSlotExcuse(
          plan.id,
          entry.allocationId,
          entry.metricCode,
          entry.actualDate,
          session,
        );
        await this.assertActorCanManageAllocationCorrection(
          actor,
          plan,
          allocation,
          session,
        );

        const now = this.clock();
        const correction: KpiActualCorrection = {
          id: crypto.randomUUID(),
          actualEntryId: entry.id,
          kpiPlanId: plan.id,
          allocationId: entry.allocationId,
          memberTalentId: entry.memberTalentId,
          metricCode: entry.metricCode,
          actualDate: entry.actualDate,
          previousValue: entry.effectiveValue,
          correctedValue,
          reason,
          correctedByActorId: actor.id,
          correctedAt: now,
          createdAt: now,
        };
        const updatedEntry =
          await this.actualRepository.insertCorrectionAndApply(
            {
              correction,
              updatedAt: now,
              updatedByActorId: actor.id,
            },
            session,
          );
        if (!updatedEntry) {
          throw new KpiStateError(
            `KPI actual entry ${entry.id} no longer exists`,
          );
        }
        await this.recordAudit({
          actor,
          permission,
          kpiPlanId: plan.id,
          mutationType: operation,
          targetId: correction.id,
          targetType: "kpi-actual-correction",
          metadata: {
            action: "correction",
            actualEntryId: entry.id,
            allocationId: entry.allocationId,
            memberTalentId: entry.memberTalentId,
            metricCode: entry.metricCode,
            actualDate: entry.actualDate,
            previousValue: correction.previousValue,
            correctedValue: correction.correctedValue,
            reason: correction.reason,
          },
          session,
        });
        return { actualEntry: updatedEntry, correction };
      },
    );
  }

  async finalizeKpiPlan(
    actor: Actor,
    command: FinalizeKpiPlanCommand,
  ): Promise<KpiPlanMutationView> {
    const permission = this.assertContextPermission(
      actor,
      Permission.KPI_FINALIZE,
    );
    this.assertKpiGlobalScope(actor, "finalize KPI plan");
    const operation: AuthoritativeAdminMutationIdentity = "kpi.finalize";

    return this.executeMutation(
      actor,
      permission,
      operation,
      `kpi-plan:${command.kpiPlanId}`,
      async (session) => {
        const current = await this.requirePlan(command.kpiPlanId, session);
        assertExecutableSubjectType(current.subjectType);
        if (current.status !== "PUBLISHED") {
          throw new KpiStateError(
            `KPI plan ${current.id} must be PUBLISHED before finalize`,
          );
        }
        const policy = requireActualPolicySnapshot(current);
        assertFinalizeEligible(current, policy, this.clock());

        const now = this.clock();
        const finalResult = await this.buildFinalResultSnapshot(
          actor,
          current,
          now,
        );
        const finalized = await this.repository.transitionStatus(
          {
            kpiPlanId: current.id,
            fromStatuses: ["PUBLISHED"],
            toStatus: "FINALIZED",
            finalizedAt: now,
            finalizedByActorId: actor.id,
            finalResult,
            updatedAt: now,
            updatedByActorId: actor.id,
          },
          session,
        );
        if (!finalized) {
          throw new KpiStateError(
            `KPI plan ${current.id} cannot transition to FINALIZED`,
          );
        }
        await this.recordAudit({
          actor,
          permission,
          kpiPlanId: finalized.id,
          mutationType: operation,
          metadata: {
            subjectType: finalized.subjectType,
            previousStatus: current.status,
            nextStatus: finalized.status,
            finalizedAt: now,
            finalResultSnapshotVersion: finalResult.snapshotVersion,
            revenueActualValue: finalResult.revenue.actualValue,
            revenueAchievementPercent: finalResult.revenue.achievementPercent,
          },
          session,
        });
        return this.loadPlanDetail(current.id, session);
      },
    );
  }

  async getKpiProgress(
    actor: Actor,
    query: GetKpiProgressQuery,
  ): Promise<KpiProgressView> {
    this.assertContextPermission(actor, Permission.KPI_READ_PROGRESS);
    const plan = await this.requirePlan(query.kpiPlanId);
    assertExecutableSubjectType(plan.subjectType);
    const allowedTalentIds = await this.resolveProgressTalentScope(actor, plan);
    return this.buildProgressView(plan, allowedTalentIds);
  }

  async getMyKpiProgress(
    actor: Actor,
    query: GetMyKpiProgressQuery,
  ): Promise<KpiProgressView> {
    this.assertContextPermission(actor, Permission.KPI_READ_PROGRESS);
    if (!this.hasKpiSelfScope(actor) && !this.hasKpiGlobalScope(actor)) {
      throw new KpiPermissionScopeError(
        "KPI self progress requires kpi.self scope",
      );
    }
    const plan = await this.requirePlan(query.kpiPlanId);
    assertExecutableSubjectType(plan.subjectType);
    const actorTalent = await this.resolveActorTalentId(actor);
    if (!actorTalent) {
      throw new KpiPermissionScopeError(
        "KPI progress self-view requires actor-to-talent mapping",
      );
    }
    return this.buildProgressView(plan, new Set([actorTalent]));
  }

  async getKpiActualDailyGrid(
    actor: Actor,
    query: GetKpiActualDailyGridQuery,
  ): Promise<KpiActualDailyGridView> {
    this.assertContextPermission(actor, Permission.KPI_READ_PROGRESS);
    const plan = await this.requirePlan(query.kpiPlanId);
    if (plan.subjectType !== "TALENT_GROUP") {
      throw new KpiPermissionScopeError(
        "KPI actual grid supports only TALENT_GROUP plans",
      );
    }
    const actualDate = normalizeActualDateText(query.actualDate, "actualDate");
    assertActualDateWithinPlan(plan, actualDate);
    await this.assertActorCanReadActualGrid(actor, plan);
    return this.buildActualDailyGridView(actor, plan, actualDate);
  }

  async listKpiActualCorrections(
    actor: Actor,
    query: ListKpiActualCorrectionsQuery,
  ): Promise<ListKpiActualCorrectionsResult> {
    this.assertContextPermission(actor, Permission.KPI_READ_PROGRESS);
    const plan = await this.requirePlan(query.kpiPlanId);
    assertExecutableSubjectType(plan.subjectType);
    const entry = await this.requireActualEntry(query.actualEntryId, plan.id);
    await this.assertActorCanReadActualEntry(actor, plan, entry);
    const items = await this.actualRepository.listCorrectionsByActualEntryId(
      entry.id,
    );
    return { items };
  }

  private async updateExistingActualDirect(
    actor: Actor,
    permission: PermissionContract,
    operation: AuthoritativeAdminMutationIdentity,
    entry: KpiActualEntry,
    actualValue: number,
    policy: KpiActualPolicySnapshot,
    session: ClientSession,
  ): Promise<KpiActualEntry> {
    if (entry.editCount >= policy.maxDirectEditsPerEntry) {
      throw new KpiStateError(
        "KPI actual direct edit limit exceeded; correction is required",
      );
    }
    const previousValue = entry.effectiveValue;
    const updated = await this.actualRepository.updateEntryDirect(
      {
        actualEntryId: entry.id,
        actualValue,
        updatedAt: this.clock(),
        updatedByActorId: actor.id,
        maxCurrentEditCountExclusive: policy.maxDirectEditsPerEntry,
      },
      session,
    );
    if (!updated) {
      throw new KpiStateError(
        "KPI actual direct edit limit exceeded; correction is required",
      );
    }
    await this.recordAudit({
      actor,
      permission,
      kpiPlanId: entry.kpiPlanId,
      mutationType: operation,
      targetId: updated.id,
      targetType: "kpi-actual-entry",
      metadata: {
        action: "update",
        allocationId: updated.allocationId,
        memberTalentId: updated.memberTalentId,
        metricCode: updated.metricCode,
        actualDate: updated.actualDate,
        previousValue,
        newValue: updated.actualValue,
        editCount: updated.editCount,
      },
      session,
    });
    return updated;
  }

  private async requireActualEntry(
    actualEntryId: string,
    kpiPlanId: string,
    session?: ClientSession,
  ): Promise<KpiActualEntry> {
    const entry = await this.actualRepository.findEntryById(
      normalizeRequiredText(actualEntryId, "actualEntryId"),
      session,
    );
    if (!entry || entry.kpiPlanId !== kpiPlanId) {
      throw new KpiNotFoundError(actualEntryId);
    }
    return entry;
  }

  private async requireActiveAllocation(
    plan: KpiPlan,
    allocationId: string,
    metricCode: KpiMetricCode,
    session?: ClientSession,
  ): Promise<KpiAllocation> {
    const allocations = await this.repository.listAllocationsByPlanId(
      plan.id,
      session,
    );
    const allocation = allocations.find((item) => item.id === allocationId);
    if (!allocation || allocation.allocationStatus !== "PUBLISHED") {
      throw new KpiInvalidAllocationError(
        `KPI allocation must exist and be PUBLISHED: ${allocationId}`,
      );
    }
    if (
      plan.subjectType === "TALENT_GROUP" &&
      allocation.groupId !== plan.subjectId
    ) {
      throw new KpiInvalidAllocationError(
        `KPI allocation ${allocationId} does not belong to group ${plan.subjectId}`,
      );
    }
    if (
      !allocation.targetMetrics.some(
        (metric) => metric.metricCode === metricCode,
      )
    ) {
      throw new KpiInvalidAllocationError(
        `KPI allocation ${allocationId} does not include metricCode ${metricCode}`,
      );
    }
    return allocation;
  }

  private async assertNoActiveActualSlotExcuse(
    kpiPlanId: string,
    allocationId: string,
    metricCode: KpiMetricCode,
    actualDate: string,
    session?: ClientSession,
  ): Promise<void> {
    const excuse = await this.repository.findActiveActualSlotExcuseByIdentity(
      {
        kpiPlanId,
        allocationId,
        metricCode,
        actualDate,
      },
      session,
    );
    if (!excuse) {
      return;
    }
    throw new KpiConflictError(
      "KPI actual slot is excused or not required; remove the excuse before entering an actual",
    );
  }

  private async assertActorCanManageAllocationActual(
    actor: Actor,
    plan: KpiPlan,
    allocation: KpiAllocation,
    session?: ClientSession,
  ): Promise<void> {
    if (this.hasKpiGlobalScope(actor)) {
      return;
    }
    await this.assertManagedGroupActualAuthority(
      actor,
      plan,
      allocation.groupId,
      "KPI actual entry",
      session,
    );
  }

  private async assertActorCanManageAllocationCorrection(
    actor: Actor,
    plan: KpiPlan,
    allocation: KpiAllocation,
    session?: ClientSession,
  ): Promise<void> {
    if (this.hasKpiGlobalScope(actor)) {
      return;
    }
    if (!this.hasKpiManagedGroupScope(actor)) {
      throw new KpiPermissionScopeError(
        "KPI actual correction requires kpi.global or kpi.managedGroup scope",
      );
    }
    await this.assertManagedGroupActualAuthority(
      actor,
      plan,
      allocation.groupId,
      "KPI actual correction",
      session,
    );
  }

  private async assertManagedGroupActualAuthority(
    actor: Actor,
    plan: KpiPlan,
    groupId: string,
    operation: string,
    session?: ClientSession,
  ): Promise<void> {
    if (
      actor.context !== "ADMIN" ||
      (actor.type !== "admin" && actor.type !== "staff")
    ) {
      throw new KpiPermissionScopeError(
        `${operation} requires ADMIN manager authority`,
      );
    }
    if (!this.hasKpiManagedGroupScope(actor)) {
      throw new KpiPermissionScopeError(
        `${operation} requires kpi.managedGroup scope`,
      );
    }
    if (plan.status !== "PUBLISHED") {
      throw new KpiPermissionScopeError(
        `${operation} is supported only for PUBLISHED plans`,
      );
    }
    if (plan.subjectType !== "TALENT_GROUP") {
      throw new KpiPermissionScopeError(
        `${operation} is supported only for TALENT_GROUP plans`,
      );
    }
    if (groupId !== plan.subjectId) {
      throw new KpiPermissionScopeError(
        `${operation} allocation is outside plan group ${plan.subjectId}`,
      );
    }
    const managedGroupIds = await this.resolveManagedTalentGroupIds(
      actor,
      session,
    );
    if (managedGroupIds.includes(groupId)) {
      return;
    }
    throw new KpiPermissionScopeError(
      `KPI actor is not an active manager for group ${groupId}`,
    );
  }

  private assertActualEntryMatchesAllocation(
    entry: KpiActualEntry,
    allocation: KpiAllocation,
  ): void {
    if (
      entry.allocationId !== allocation.id ||
      entry.memberTalentId !== allocation.memberTalentId
    ) {
      throw new KpiInvalidAllocationError(
        `KPI actual entry ${entry.id} does not match allocation ${allocation.id}`,
      );
    }
  }

  private async resolveProgressTalentScope(
    actor: Actor,
    plan: KpiPlan,
  ): Promise<Set<string> | undefined> {
    if (this.hasKpiGlobalScope(actor)) {
      return undefined;
    }
    const hasManagedGroupScope = this.hasKpiManagedGroupScope(actor);
    const hasSelfScope = this.hasKpiSelfScope(actor);
    if (!hasManagedGroupScope && !hasSelfScope) {
      throw new KpiPermissionScopeError(
        "KPI progress read requires kpi.global, kpi.managedGroup, or kpi.self scope",
      );
    }
    if (hasManagedGroupScope) {
      await this.assertActorCanReadManagedGroupProgress(actor, plan);
      return undefined;
    }
    if (actor.type !== "staff") {
      const talentId = await this.resolveActorTalentId(actor);
      if (talentId) {
        return new Set([talentId]);
      }
      throw new KpiPermissionScopeError("KPI progress read scope denied");
    }
    const employmentProfile =
      await this.subjectReadonlyAccess.findActiveEmploymentProfileByLinkedUserId(
        actor.id,
      );
    if (!employmentProfile) {
      const talentId = await this.resolveActorTalentId(actor);
      if (talentId) {
        return new Set([talentId]);
      }
      throw new KpiPermissionScopeError(
        "KPI progress read requires actor mapping",
      );
    }
    const talent =
      await this.subjectReadonlyAccess.findNonArchivedTalentByLinkedEmploymentProfileId(
        employmentProfile.employmentProfileId,
      );
    if (talent) {
      return new Set([talent.talentId]);
    }
    throw new KpiPermissionScopeError("KPI progress read scope denied");
  }

  private async assertActorCanReadManagedGroupProgress(
    actor: Actor,
    plan: KpiPlan,
  ): Promise<void> {
    if (
      actor.context !== "ADMIN" ||
      (actor.type !== "admin" && actor.type !== "staff")
    ) {
      throw new KpiPermissionScopeError(
        "KPI managed-group progress read requires ADMIN manager authority",
      );
    }
    if (!this.hasKpiManagedGroupScope(actor)) {
      throw new KpiPermissionScopeError(
        "KPI managed-group progress read requires kpi.managedGroup scope",
      );
    }
    if (plan.status !== "PUBLISHED") {
      throw new KpiPermissionScopeError(
        "KPI manager-scoped progress read is supported only for PUBLISHED plans",
      );
    }
    if (plan.subjectType !== "TALENT_GROUP") {
      throw new KpiPermissionScopeError(
        "KPI manager-scoped progress read is supported only for TALENT_GROUP plans",
      );
    }
    const managedGroupIds = await this.resolveManagedTalentGroupIds(actor);
    if (managedGroupIds.includes(plan.subjectId)) {
      return;
    }
    throw new KpiPermissionScopeError(
      `KPI actor is not an active manager for group ${plan.subjectId}`,
    );
  }

  private async resolveActorTalentId(actor: Actor): Promise<string | null> {
    const employmentProfile =
      await this.subjectReadonlyAccess.findActiveEmploymentProfileByLinkedUserId(
        actor.id,
      );
    if (!employmentProfile) {
      return null;
    }
    const talent =
      await this.subjectReadonlyAccess.findNonArchivedTalentByLinkedEmploymentProfileId(
        employmentProfile.employmentProfileId,
      );
    return talent?.talentId ?? null;
  }

  private async assertActorCanReadActualGrid(
    actor: Actor,
    plan: KpiPlan,
  ): Promise<void> {
    if (this.hasKpiGlobalScope(actor)) {
      return;
    }
    if (!this.hasKpiManagedGroupScope(actor)) {
      throw new KpiPermissionScopeError(
        "KPI actual grid read requires kpi.global or kpi.managedGroup scope",
      );
    }
    if (
      actor.context !== "ADMIN" ||
      (actor.type !== "admin" && actor.type !== "staff")
    ) {
      throw new KpiPermissionScopeError(
        "KPI actual grid read requires ADMIN manager authority",
      );
    }
    if (plan.status !== "PUBLISHED") {
      throw new KpiPermissionScopeError(
        "KPI manager-scoped actual grid read is supported only for PUBLISHED plans",
      );
    }
    if (plan.subjectType !== "TALENT_GROUP") {
      throw new KpiPermissionScopeError(
        "KPI manager-scoped actual grid read is supported only for TALENT_GROUP plans",
      );
    }
    const managedGroupIds = await this.resolveManagedTalentGroupIds(actor);
    if (managedGroupIds.includes(plan.subjectId)) {
      return;
    }
    throw new KpiPermissionScopeError(
      `KPI actor is not an active manager for group ${plan.subjectId}`,
    );
  }

  private async assertActorCanReadActualEntry(
    actor: Actor,
    plan: KpiPlan,
    entry: KpiActualEntry,
  ): Promise<void> {
    if (this.hasKpiGlobalScope(actor)) {
      return;
    }
    if (!this.hasKpiManagedGroupScope(actor)) {
      throw new KpiPermissionScopeError(
        "KPI correction history read requires kpi.global or kpi.managedGroup scope",
      );
    }
    assertActualDateWithinPlan(plan, entry.actualDate);
    const allocation = await this.requireActiveAllocation(
      plan,
      entry.allocationId,
      entry.metricCode,
    );
    this.assertActualEntryMatchesAllocation(entry, allocation);
    await this.assertActorCanManageAllocationCorrection(
      actor,
      plan,
      allocation,
    );
  }

  private async buildActualDailyGridView(
    actor: Actor,
    plan: KpiPlan,
    actualDate: string,
  ): Promise<KpiActualDailyGridView> {
    const [targetMetrics, allocations, entries, excuses] = await Promise.all([
      this.repository.listTargetMetricsByPlanId(plan.id),
      this.repository.listAllocationsByPlanId(plan.id),
      this.actualRepository.listEntriesByPlanIdAndActualDate(
        plan.id,
        actualDate,
      ),
      this.repository.listActualSlotExcusesByPlanIdAndActualDate(
        plan.id,
        actualDate,
      ),
    ]);
    const policy = effectiveActualPolicySnapshot(
      plan.actualPolicySnapshot ??
        createDefaultActualPolicySnapshot(plan.createdAt),
    );
    const editability = resolveDailyGridEditability(
      plan,
      policy,
      actualDate,
      this.clock(),
    );
    const entriesByAllocationMetric = new Map<string, KpiActualEntry>();
    for (const entry of entries) {
      entriesByAllocationMetric.set(
        `${entry.allocationId}:${entry.metricCode}`,
        entry,
      );
    }
    const excusesByAllocationMetric = new Map<string, KpiActualSlotExcuse>();
    for (const excuse of excuses) {
      excusesByAllocationMetric.set(
        `${excuse.allocationId}:${excuse.metricCode}`,
        excuse,
      );
    }
    const canEnterActual =
      plan.status === "PUBLISHED" &&
      actor.permissions.includes(Permission.KPI_ENTER_ACTUAL);
    return {
      kpiPlanId: plan.id,
      planCode: plan.planCode,
      status: plan.status,
      subjectType: plan.subjectType,
      subjectId: plan.subjectId,
      actualDate,
      policy: {
        timezone: policy.timezone,
        entryOpenLocalTime: policy.entryOpenLocalTime,
        entryLockLocalTime: policy.entryLockLocalTime,
        maxDirectEditsPerEntry: policy.maxDirectEditsPerEntry,
        correctionAllowedUntil: policy.correctionAllowedUntil,
      },
      editability,
      targetMetrics: targetMetrics.map((metric) => ({
        metricCode: metric.metricCode,
        targetValue: metric.targetValue,
        unit: metric.unit,
      })),
      rows: allocations.filter(isOfficialKpiAllocation).map((allocation) => ({
        allocationId: allocation.id,
        memberTalentId: allocation.memberTalentId,
        memberDisplayName: allocation.snapshotMemberDisplayName,
        allocationStatus: allocation.allocationStatus,
        metrics: allocation.targetMetrics.map((metric) => {
          const entry = entriesByAllocationMetric.get(
            `${allocation.id}:${metric.metricCode}`,
          );
          const excuse = excusesByAllocationMetric.get(
            `${allocation.id}:${metric.metricCode}`,
          );
          const entryEditLimitReached =
            entry !== undefined &&
            entry.editCount >= policy.maxDirectEditsPerEntry;
          const planDisabledReason =
            plan.status === "PUBLISHED" ? null : editability.disabledReason;
          const disabledReason =
            planDisabledReason ??
            (excuse !== undefined ? `ACTUAL_${excuse.status}` : null) ??
            (entryEditLimitReached ? "DIRECT_EDIT_LIMIT_REACHED" : null) ??
            editability.disabledReason;
          const canDirectEdit =
            editability.isDirectEditOpen &&
            !entryEditLimitReached &&
            excuse === undefined;
          const dailyActualStatus = resolveDailyActualStatus({
            plan,
            allocation,
            actualDate,
            entry,
            excuse,
            now: this.clock(),
          });
          return {
            metricCode: metric.metricCode,
            targetValue: metric.targetValue,
            actualEntryId: entry?.id ?? null,
            actualValue: entry?.actualValue ?? null,
            effectiveValue: entry?.effectiveValue ?? 0,
            hasEntry: entry !== undefined,
            dailyActualStatus,
            actualExcuse: excuse ? toActualSlotExcuseSummary(excuse) : null,
            editCount: entry?.editCount ?? 0,
            correctionCount: entry?.correctionCount ?? 0,
            latestCorrectionId: entry?.latestCorrectionId ?? null,
            canDirectEdit,
            canMarkExcused:
              canEnterActual &&
              entry === undefined &&
              excuse === undefined &&
              plan.status === "PUBLISHED" &&
              allocation.allocationStatus === "PUBLISHED",
            canUnmarkExcused: canEnterActual && excuse !== undefined,
            requiresCorrection: entry !== undefined && !canDirectEdit,
            disabledReason,
          };
        }),
      })),
    };
  }

  private async buildProgressView(
    plan: KpiPlan,
    allowedTalentIds?: Set<string>,
  ): Promise<KpiProgressView> {
    const [targetMetrics, allocations, entries] = await Promise.all([
      this.repository.listTargetMetricsByPlanId(plan.id),
      this.repository.listAllocationsByPlanId(plan.id),
      this.actualRepository.listEntriesByPlanId(plan.id),
    ]);
    const officialAllocations = allocations.filter(isOfficialKpiAllocation);
    const officialAllocationIds = new Set(
      officialAllocations.map((allocation) => allocation.id),
    );
    const relevantAllocations = allowedTalentIds
      ? officialAllocations.filter((allocation) =>
          allowedTalentIds.has(allocation.memberTalentId),
        )
      : officialAllocations;
    const entryKey = (
      entry: Pick<KpiActualEntry, "allocationId" | "metricCode">,
    ) => `${entry.allocationId}:${entry.metricCode}`;
    const actualByAllocationMetric = new Map<string, number>();
    const countByAllocationMetric = new Map<string, number>();
    for (const entry of entries) {
      if (
        !officialAllocationIds.has(entry.allocationId) ||
        (allowedTalentIds !== undefined &&
          !allowedTalentIds.has(entry.memberTalentId))
      ) {
        continue;
      }
      const key = entryKey(entry);
      actualByAllocationMetric.set(
        key,
        (actualByAllocationMetric.get(key) ?? 0) + entry.effectiveValue,
      );
      countByAllocationMetric.set(
        key,
        (countByAllocationMetric.get(key) ?? 0) + 1,
      );
    }
    const periodDayCount = countLocalDaysInPlan(plan);
    const memberProgress = relevantAllocations.flatMap((allocation) =>
      allocation.targetMetrics.map((metric) => {
        const key = `${allocation.id}:${metric.metricCode}`;
        const actualEntryCount = countByAllocationMetric.get(key) ?? 0;
        const actualValue = actualByAllocationMetric.get(key) ?? 0;
        return {
          allocationId: allocation.id,
          memberTalentId: allocation.memberTalentId,
          metricCode: metric.metricCode,
          targetValue: metric.targetValue,
          actualValue,
          progressPercent: calculateProgressPercent(
            actualValue,
            metric.targetValue,
          ),
          actualEntryCount,
          missingEntryCount: Math.max(periodDayCount - actualEntryCount, 0),
        };
      }),
    );
    const groupTotals = targetMetrics.map((target) => {
      const actualValue = memberProgress
        .filter((row) => row.metricCode === target.metricCode)
        .reduce((sum, row) => sum + row.actualValue, 0);
      return {
        metricCode: target.metricCode,
        targetValue: target.targetValue,
        actualValue,
        progressPercent: calculateProgressPercent(
          actualValue,
          target.targetValue,
        ),
      };
    });
    return {
      plan: {
        id: plan.id,
        planCode: plan.planCode,
        subjectType: plan.subjectType,
        subjectId: plan.subjectId,
        status: plan.status,
        periodMonth: plan.periodMonth,
        periodStartAt: plan.periodStartAt,
        periodEndAt: plan.periodEndAt,
        timezone: plan.timezone,
      },
      periodElapsedPercent: calculatePeriodElapsedPercent(plan, this.clock()),
      targetMetrics,
      groupTotals,
      memberProgress,
    };
  }

  private async recordAudit(params: {
    readonly actor: Actor;
    readonly permission: PermissionContract;
    readonly kpiPlanId: string;
    readonly mutationType: AuthoritativeAdminMutationIdentity;
    readonly targetId?: string;
    readonly targetType?: string;
    readonly metadata: Readonly<Record<string, unknown>>;
    readonly session: ClientSession;
  }): Promise<void> {
    await this.audit.record(
      params.actor,
      params.permission,
      params.kpiPlanId,
      {
        mutationType: params.mutationType,
        targetId: params.targetId ?? params.kpiPlanId,
        targetType: params.targetType ?? "kpi-plan",
        actorId: params.actor.id,
        ...params.metadata,
      },
      params.session,
    );
  }

  private async executeMutation<T>(
    actor: Actor,
    permission: PermissionContract,
    mutationIdentity: AuthoritativeAdminMutationIdentity,
    mutationTargetDescriptor: string,
    mutate: (
      session: ClientSession,
      controls: AuthoritativeMutationControls,
    ) => Promise<T>,
  ): Promise<T> {
    return this.mutationBridge.execute(
      {
        actor,
        traceId: actor.trace?.requestId ?? "kpi-admin",
        requiredPermission: permission,
        mutationIdentity,
        mutationTargetDescriptor,
      },
      mutate,
    );
  }

  private assertPermission(
    actor: Actor,
    permissionCode: Permission,
  ): PermissionContract {
    assertAdminActorType(actor);
    return this.assertContextPermission(actor, permissionCode);
  }

  private assertContextPermission(
    actor: Actor,
    permissionCode: Permission,
  ): PermissionContract {
    const permission = PermissionResolver.resolve(permissionCode);
    PermissionGuard.assert(actor, permission);
    return permission;
  }

  private assertKpiGlobalScope(actor: Actor, operation: string): void {
    if (this.hasKpiGlobalScope(actor)) {
      return;
    }

    throw new KpiPermissionScopeError(
      `Cannot ${operation}: kpi.global scope is required`,
    );
  }

  private hasKpiGlobalScope(actor: Actor): boolean {
    return PermissionGuard.hasKpiScopeGrant(actor, "global");
  }

  private hasKpiManagedGroupScope(actor: Actor): boolean {
    return PermissionGuard.hasKpiScopeGrant(actor, "managedGroup");
  }

  private hasKpiSelfScope(actor: Actor): boolean {
    return PermissionGuard.hasKpiScopeGrant(actor, "self");
  }

  private toListActualWorkspacePlansInput(
    query: ListKpiActualWorkspacePlansQuery,
  ): NormalizedActualWorkspacePlansInput {
    const sortBy = query.sortBy
      ? normalizeActualWorkspaceSortBy(query.sortBy)
      : "periodMonth";
    const sortDirection = query.sortDirection
      ? normalizeSortDirection(query.sortDirection)
      : "DESC";
    return {
      subjectType: "TALENT_GROUP",
      subjectId: normalizeOptionalText(query.subjectId),
      groupId: normalizeOptionalText(query.groupId),
      periodMonth: query.periodMonth
        ? normalizePeriodMonth(query.periodMonth)
        : undefined,
      search: normalizeOptionalSearch(query.search),
      limit: normalizeLimit(query.limit),
      sortBy,
      sortDirection,
      cursor: normalizeOptionalText(query.cursor),
      allocationCoverage: query.allocationCoverage
        ? normalizeActualWorkspaceCoverageFilter(query.allocationCoverage)
        : undefined,
      hasOverdueActuals:
        query.hasOverdueActuals === undefined
          ? undefined
          : normalizeActualWorkspaceBooleanFilter(
              query.hasOverdueActuals,
              "hasOverdueActuals",
            ),
      hasPendingActuals:
        query.hasPendingActuals === undefined
          ? undefined
          : normalizeActualWorkspaceBooleanFilter(
              query.hasPendingActuals,
              "hasPendingActuals",
            ),
    };
  }

  private async listActualWorkspacePlanPage(
    input: NormalizedActualWorkspacePlansInput,
  ): Promise<ActualWorkspacePlanPage> {
    const groupIds = await this.resolveActualWorkspaceSearchGroupIds(input);
    const queryKey = buildActualWorkspaceCursorQueryKey({
      ...input,
      authorityScopeKey: "global",
    });
    if (isActualWorkspaceDerivedSortBy(input.sortBy)) {
      const sortBy = input.sortBy;
      const cursor =
        input.cursor === undefined
          ? undefined
          : decodeActualWorkspaceDerivedCursor(input.cursor, input, queryKey);
      return this.listDerivedActualWorkspacePlanPage(
        {
          ...input,
          sortBy,
          searchSubjectIds: groupIds,
          cursor,
        },
        queryKey,
      );
    }
    const sortBy = input.sortBy;
    const cursor =
      input.cursor === undefined
        ? undefined
        : decodeActualWorkspacePlanCursor(input.cursor, input, queryKey);
    return this.collectActualWorkspacePlanPage(
      {
        ...input,
        sortBy,
        searchSubjectIds: groupIds,
        cursor,
      },
      queryKey,
    );
  }

  private async listManagedGroupActualWorkspacePlans(
    actor: Actor,
    input: NormalizedActualWorkspacePlansInput,
  ): Promise<ActualWorkspacePlanPage> {
    if (
      actor.context !== "ADMIN" ||
      (actor.type !== "admin" && actor.type !== "staff")
    ) {
      throw new KpiPermissionScopeError(
        "KPI actual workspace requires ADMIN manager authority",
      );
    }
    if (!this.hasKpiManagedGroupScope(actor)) {
      throw new KpiPermissionScopeError(
        "KPI actual workspace requires kpi.global or kpi.managedGroup scope",
      );
    }

    const managedGroupIds = await this.resolveManagedTalentGroupIds(actor);
    if (managedGroupIds.length === 0) {
      return { items: [] };
    }
    const requestedGroupId = input.groupId ?? input.subjectId;
    const candidateGroupIds =
      requestedGroupId === undefined ? managedGroupIds : [requestedGroupId];
    if (
      candidateGroupIds.some((groupId) => !managedGroupIds.includes(groupId))
    ) {
      return { items: [] };
    }

    const groupIds = await this.resolveActualWorkspaceSearchGroupIds(
      input,
      candidateGroupIds,
    );
    const queryKey = buildActualWorkspaceCursorQueryKey({
      ...input,
      authorityScopeKey: `managed:${candidateGroupIds.join("|")}`,
    });
    if (isActualWorkspaceDerivedSortBy(input.sortBy)) {
      const sortBy = input.sortBy;
      const cursor =
        input.cursor === undefined
          ? undefined
          : decodeActualWorkspaceDerivedCursor(input.cursor, input, queryKey);
      return this.listDerivedActualWorkspacePlanPage(
        {
          ...input,
          sortBy,
          subjectId: undefined,
          groupId: undefined,
          subjectIds: candidateGroupIds,
          searchSubjectIds: groupIds,
          status: "PUBLISHED",
          cursor,
        },
        queryKey,
      );
    }
    const sortBy = input.sortBy;
    const cursor =
      input.cursor === undefined
        ? undefined
        : decodeActualWorkspacePlanCursor(input.cursor, input, queryKey);
    return this.collectActualWorkspacePlanPage(
      {
        ...input,
        sortBy,
        subjectId: undefined,
        groupId: undefined,
        subjectIds: candidateGroupIds,
        searchSubjectIds: groupIds,
        status: "PUBLISHED",
        cursor,
      },
      queryKey,
    );
  }

  private async listDerivedActualWorkspacePlanPage(
    input: Omit<NormalizedActualWorkspacePlansInput, "cursor" | "sortBy"> & {
      readonly sortBy: KpiActualWorkspaceDerivedSortBy;
      readonly subjectIds?: readonly string[];
      readonly searchSubjectIds?: readonly string[];
      readonly status?: KpiPlanStatus;
      readonly cursor?: KpiActualWorkspaceDerivedCursor;
    },
    queryKey: string,
  ): Promise<ActualWorkspacePlanPage> {
    if (!hasActualWorkspaceStatusFilters(input)) {
      const rows = await this.repository.listActualWorkspaceDerivedPlans({
        ...input,
        subjectType: "TALENT_GROUP",
        limit: input.limit + 1,
      });
      const hasNext = rows.length > input.limit;
      const pageRows = hasNext ? rows.slice(0, input.limit) : rows;
      return {
        items: pageRows.map((row) => row.plan),
        nextCursor:
          hasNext && pageRows.length > 0
            ? encodeActualWorkspaceCursor(
                buildActualWorkspaceCursorEnvelope(
                  pageRows[
                    pageRows.length - 1
                  ] as KpiActualWorkspaceDerivedPlanSortRow,
                  input,
                  queryKey,
                ),
              )
            : undefined,
      };
    }

    let cursor = input.cursor;
    const collected: KpiActualWorkspaceDerivedPlanSortRow[] = [];
    let exhausted = false;
    const scanLimit = MAX_LIST_LIMIT;

    while (collected.length < input.limit + 1 && !exhausted) {
      const batch = await this.repository.listActualWorkspaceDerivedPlans({
        ...input,
        subjectType: "TALENT_GROUP",
        cursor,
        limit: scanLimit + 1,
      });
      const page = batch.slice(0, scanLimit);
      exhausted = batch.length <= scanLimit;
      const matching = await this.filterActualWorkspaceDerivedRowsByStatus(
        page,
        input,
      );
      collected.push(...matching);
      if (!exhausted && page.length > 0) {
        cursor = buildActualWorkspaceDerivedCursor(
          page[page.length - 1] as KpiActualWorkspaceDerivedPlanSortRow,
          input.sortBy,
          input.sortDirection,
        );
      }
      if (page.length === 0) {
        exhausted = true;
      }
    }

    const hasNext = collected.length > input.limit;
    const pageRows = hasNext ? collected.slice(0, input.limit) : collected;
    return {
      items: pageRows.map((row) => row.plan),
      nextCursor:
        hasNext && pageRows.length > 0
          ? encodeActualWorkspaceCursor(
              buildActualWorkspaceCursorEnvelope(
                pageRows[
                  pageRows.length - 1
                ] as KpiActualWorkspaceDerivedPlanSortRow,
                input,
                queryKey,
              ),
            )
          : undefined,
    };
  }

  private async resolveActualWorkspaceSearchGroupIds(
    input: NormalizedActualWorkspacePlansInput,
    visibleGroupIds?: readonly string[],
  ): Promise<readonly string[] | undefined> {
    if (input.search === undefined) {
      return undefined;
    }
    const requestedGroupId = input.groupId ?? input.subjectId;
    const groupIds =
      requestedGroupId !== undefined
        ? [requestedGroupId]
        : visibleGroupIds !== undefined
          ? visibleGroupIds
          : undefined;
    return this.subjectReadonlyAccess.listTalentGroupIdsByCodeOrName({
      search: input.search,
      ...(groupIds !== undefined ? { groupIds } : {}),
    });
  }

  private async collectActualWorkspacePlanPage(
    input: Omit<NormalizedActualWorkspacePlansInput, "cursor" | "sortBy"> & {
      readonly sortBy: "periodMonth" | "planCode";
      readonly subjectIds?: readonly string[];
      readonly searchSubjectIds?: readonly string[];
      readonly status?: KpiPlanStatus;
      readonly cursor?: KpiPlanListCursor;
    },
    queryKey: string,
  ): Promise<ActualWorkspacePlanPage> {
    let cursor = input.cursor;
    const collected: KpiPlan[] = [];
    let exhausted = false;
    const scanLimit =
      input.allocationCoverage === undefined &&
      !hasActualWorkspaceStatusFilters(input)
        ? input.limit
        : MAX_LIST_LIMIT;

    while (collected.length < input.limit + 1 && !exhausted) {
      const batch = await this.repository.listPlans({
        ...input,
        cursor,
        actualWorkspaceCursorOrder: true,
        limit: scanLimit + 1,
      });
      const page = batch.slice(0, scanLimit);
      exhausted = batch.length <= scanLimit;
      const coverageMatching =
        input.allocationCoverage === undefined
          ? page
          : await this.filterPlansByAllocationCoverage(
              page,
              input.allocationCoverage,
            );
      const matching = await this.filterPlansByActualWorkspaceStatus(
        coverageMatching,
        input,
      );
      collected.push(...matching);
      if (!exhausted && page.length > 0) {
        cursor = buildPlanListCursor(
          page[page.length - 1] as KpiPlan,
          input.sortBy,
          input.sortDirection,
        );
      }
      if (page.length === 0) {
        exhausted = true;
      }
    }

    const hasNext = collected.length > input.limit;
    const items = hasNext ? collected.slice(0, input.limit) : collected;
    return {
      items,
      nextCursor:
        hasNext && items.length > 0
          ? encodeActualWorkspaceCursor(
              buildActualWorkspaceCursorEnvelope(
                items[items.length - 1] as KpiPlan,
                input,
                queryKey,
              ),
            )
          : undefined,
    };
  }

  private async filterPlansByAllocationCoverage(
    plans: readonly KpiPlan[],
    coverage: KpiActualWorkspaceCoverageFilter,
  ): Promise<readonly KpiPlan[]> {
    if (plans.length === 0) {
      return [];
    }
    const counts = buildAllocationWorkflowSummaries(
      await this.repository.countAllocationsByPlanIds(
        plans.map((plan) => plan.id),
      ),
    );
    return plans.filter((plan) => {
      const summary =
        counts.get(plan.id) ?? createZeroAllocationWorkflowSummary();
      const publishedAllocationCount = summary.officialPublishedCount;
      const totalAllocationCount = summary.total;
      const complete =
        totalAllocationCount > 0 &&
        publishedAllocationCount === totalAllocationCount;
      return coverage === "complete" ? complete : !complete;
    });
  }

  private async filterActualWorkspaceDerivedRowsByStatus(
    rows: readonly KpiActualWorkspaceDerivedPlanSortRow[],
    input: Pick<
      NormalizedActualWorkspacePlansInput,
      "hasOverdueActuals" | "hasPendingActuals"
    >,
  ): Promise<readonly KpiActualWorkspaceDerivedPlanSortRow[]> {
    const matchingPlanIds = new Set(
      (
        await this.filterPlansByActualWorkspaceStatus(
          rows.map((row) => row.plan),
          input,
        )
      ).map((plan) => plan.id),
    );
    return rows.filter((row) => matchingPlanIds.has(row.plan.id));
  }

  private async filterPlansByActualWorkspaceStatus(
    plans: readonly KpiPlan[],
    input: Pick<
      NormalizedActualWorkspacePlansInput,
      "hasOverdueActuals" | "hasPendingActuals"
    >,
  ): Promise<readonly KpiPlan[]> {
    if (plans.length === 0 || !hasActualWorkspaceStatusFilters(input)) {
      return plans;
    }
    const planIds = plans.map((plan) => plan.id);
    const [allocations, entries, excuses] = await Promise.all([
      this.repository.listAllocationsByPlanIds(planIds),
      this.actualRepository.listEntriesByPlanIds(planIds),
      this.repository.listActualSlotExcusesByPlanIds(planIds),
    ]);
    const now = this.clock();
    return plans.filter((plan) =>
      matchesActualWorkspaceStatusFilters(
        buildActualWorkspaceStatusSummary({
          plan,
          allocations: allocations.filter(
            (allocation) => allocation.kpiPlanId === plan.id,
          ),
          entries: entries.filter((entry) => entry.kpiPlanId === plan.id),
          excuses: excuses.filter((excuse) => excuse.kpiPlanId === plan.id),
          now,
        }),
        input,
      ),
    );
  }

  private async buildActualWorkspaceAggregates(
    actor: Actor,
    plans: readonly KpiPlan[],
  ): Promise<readonly KpiActualWorkspaceAggregate[]> {
    if (plans.length === 0) {
      return [];
    }
    const planIds = plans.map((plan) => plan.id);
    const [targetMetrics, allocations, entries, excuses, subjectRefs] =
      await Promise.all([
        this.repository.listTargetMetricsByPlanIds(planIds),
        this.repository.listAllocationsByPlanIds(planIds),
        this.actualRepository.listEntriesByPlanIds(planIds),
        this.repository.listActualSlotExcusesByPlanIds(planIds),
        this.subjectReadonlyAccess.listSubjectRefs(
          plans.map((plan) => ({
            subjectType: plan.subjectType,
            subjectId: plan.subjectId,
          })),
        ),
      ]);
    const actionHintsByPlanId = new Map(
      plans.map((plan) => [
        plan.id,
        this.actualWorkspaceActionHints(actor, plan),
      ]),
    );

    return plans.map((plan) =>
      buildActualWorkspaceAggregate({
        plan,
        targetMetrics: targetMetrics.filter(
          (metric) => metric.kpiPlanId === plan.id,
        ),
        allocations: allocations.filter(
          (allocation) => allocation.kpiPlanId === plan.id,
        ),
        entries: entries.filter((entry) => entry.kpiPlanId === plan.id),
        excuses: excuses.filter((excuse) => excuse.kpiPlanId === plan.id),
        subjectRef: subjectRefs.get(kpiSubjectRefKey(plan)) ?? null,
        actionHints:
          actionHintsByPlanId.get(plan.id) ??
          createNoActualWorkspaceActionHints(),
        now: this.clock(),
      }),
    );
  }

  private async buildFinalResultSnapshot(
    actor: Actor,
    plan: KpiPlan,
    finalizedAt: number,
  ): Promise<KpiFinalResultSnapshot> {
    const [aggregate] = await this.buildActualWorkspaceAggregates(actor, [
      plan,
    ]);
    if (!aggregate) {
      throw new KpiStateError(
        `KPI plan ${plan.id} cannot build final result snapshot`,
      );
    }
    const { summary, members } = aggregate;

    return {
      snapshotVersion: 1,
      planId: plan.id,
      planCode: plan.planCode,
      periodMonth: plan.periodMonth,
      subjectType: plan.subjectType,
      subjectId: plan.subjectId,
      finalizedAt,
      finalizedByActorId: actor.id,
      revenue: {
        metricCode: "REVENUE_VND",
        planTargetValue: summary.revenue.planTargetValue,
        operationalTargetValue: summary.revenue.operationalTargetValue,
        actualValue: summary.revenue.actualValue,
        achievementPercent: summary.revenue.achievementPercent,
        targetMismatch: summary.revenue.targetMismatch,
      },
      allocationCoverage: summary.allocationCoverage,
      actualEntryStatusSummary: summary.actualEntryStatusSummary,
      supportingMetrics: summary.supportingMetrics,
      members: members.map((member) => ({
        allocationId: member.allocationId,
        memberDisplayName: member.memberDisplayName,
        allocationStatus: member.allocationStatus,
        revenue: member.revenue,
        supportingMetrics: member.supportingMetrics,
        actualEntryStatusSummary: member.actualEntryStatusSummary,
      })),
    };
  }

  private actualWorkspaceActionHints(
    actor: Actor,
    plan: KpiPlan,
  ): KpiActualWorkspaceActionHints {
    return {
      canReadActualGrid: true,
      canEnterActual:
        plan.status === "PUBLISHED" &&
        actor.permissions.includes(Permission.KPI_ENTER_ACTUAL),
    };
  }

  private toListPlansInput(query: ListKpiPlansQuery): ListKpiPlansInput {
    return {
      subjectType: query.subjectType
        ? normalizeSubjectType(query.subjectType)
        : undefined,
      subjectId: normalizeOptionalText(query.subjectId),
      groupId: normalizeOptionalText(query.groupId),
      periodMonth: query.periodMonth
        ? normalizePeriodMonth(query.periodMonth)
        : undefined,
      status: query.status ? normalizePlanStatus(query.status) : undefined,
      metricCode: query.metricCode
        ? normalizeMetricCode(query.metricCode)
        : undefined,
      search: normalizeOptionalSearch(query.search),
      limit: normalizeLimit(query.limit),
      sortBy: query.sortBy ? normalizeSortBy(query.sortBy) : undefined,
      sortDirection: query.sortDirection
        ? normalizeSortDirection(query.sortDirection)
        : undefined,
    };
  }

  private async listManagedGroupKpiPlans(
    actor: Actor,
    input: ListKpiPlansInput,
  ): Promise<ListKpiPlansResult> {
    if (input.subjectType && input.subjectType !== "TALENT_GROUP") {
      return { items: [] };
    }
    if (input.status && input.status !== "PUBLISHED") {
      return { items: [] };
    }

    if (
      input.groupId !== undefined &&
      input.subjectId !== undefined &&
      input.groupId !== input.subjectId
    ) {
      return { items: [] };
    }

    const managedGroupIds = await this.resolveManagedTalentGroupIds(actor);
    if (managedGroupIds.length === 0) {
      return { items: [] };
    }

    const requestedGroupId = input.groupId ?? input.subjectId;
    const candidateGroupIds =
      requestedGroupId === undefined ? managedGroupIds : [requestedGroupId];

    if (
      candidateGroupIds.some((groupId) => !managedGroupIds.includes(groupId))
    ) {
      return { items: [] };
    }

    const perGroupResults = await Promise.all(
      candidateGroupIds.map((groupId) =>
        this.repository.listPlans({
          ...input,
          subjectType: "TALENT_GROUP",
          subjectId: undefined,
          groupId,
          status: "PUBLISHED",
        }),
      ),
    );
    const itemsById = new Map<string, KpiPlan>();
    for (const item of perGroupResults.flat()) {
      itemsById.set(item.id, item);
    }

    const visibleItems = Array.from(itemsById.values())
      .sort((left, right) => compareKpiPlanListItems(left, right, input))
      .slice(0, input.limit);

    return {
      items: await this.withAllocationWorkflowSummaries(visibleItems),
    };
  }

  private async resolveManagedTalentGroupIds(
    actor: Actor,
    session?: ClientSession,
  ): Promise<readonly string[]> {
    const groupIds = await resolveManagedTalentGroupIds(
      actor,
      {
        subjectReadonlyAccess: this.subjectReadonlyAccess,
        managerAssignmentRepository: this.managerAssignmentRepository,
      },
      this.clock(),
      session,
    );
    return groupIds ?? [];
  }

  private assertActualMutationPlanOpen(plan: KpiPlan, operation: string): void {
    if (plan.status !== "PUBLISHED") {
      throw new KpiStateError(
        `KPI plan ${plan.id} is ${plan.status}; only PUBLISHED plans can ${operation}`,
      );
    }
  }

  private assertDraft(plan: KpiPlan, operation: string): void {
    if (plan.status !== "DRAFT") {
      throw new KpiStateError(
        `KPI plan ${plan.id} is ${plan.status}; only DRAFT plans can ${operation}`,
      );
    }
  }

  private async requirePlan(
    kpiPlanId: string,
    session?: ClientSession,
  ): Promise<KpiPlan> {
    const plan = await this.repository.findPlanById(
      normalizeRequiredText(kpiPlanId, "kpiPlanId"),
      session,
    );
    if (!plan) {
      throw new KpiNotFoundError(kpiPlanId);
    }
    return plan;
  }

  private async loadPlanDetail(
    kpiPlanId: string,
    session?: ClientSession,
  ): Promise<KpiPlanDetailView> {
    const plan = await this.requirePlan(kpiPlanId, session);
    const [targetMetrics, allocations, subjectRefs] = await Promise.all([
      this.repository.listTargetMetricsByPlanId(plan.id, session),
      this.repository.listAllocationsByPlanId(plan.id, session),
      this.subjectReadonlyAccess.listSubjectRefs(
        [{ subjectType: plan.subjectType, subjectId: plan.subjectId }],
        session,
      ),
    ]);
    return this.toDetailView(
      plan,
      targetMetrics,
      allocations,
      subjectRefs.get(kpiSubjectRefKey(plan)) ?? null,
    );
  }

  private async withAllocationWorkflowSummaries(
    plans: readonly KpiPlan[],
  ): Promise<readonly KpiPlanListItemView[]> {
    if (plans.length === 0) {
      return [];
    }

    const [counts, subjectRefs] = await Promise.all([
      this.repository.countAllocationsByPlanIds(plans.map((plan) => plan.id)),
      this.subjectReadonlyAccess.listSubjectRefs(
        plans.map((plan) => ({
          subjectType: plan.subjectType,
          subjectId: plan.subjectId,
        })),
      ),
    ]);
    const summaries = buildAllocationWorkflowSummaries(counts);

    return plans.map((plan) => ({
      ...plan,
      subjectRef: subjectRefs.get(kpiSubjectRefKey(plan)) ?? null,
      allocationWorkflowSummary:
        summaries.get(plan.id) ?? createZeroAllocationWorkflowSummary(),
    }));
  }

  private toDetailView(
    plan: KpiPlan,
    targetMetrics: readonly KpiTargetMetric[],
    allocations: readonly KpiAllocation[],
    subjectRef?: ReferenceSummary | null,
  ): KpiPlanDetailView {
    const view: KpiPlanDetailView = {
      ...plan,
      targetMetrics,
      allocations,
    };
    return subjectRef === undefined ? view : { ...view, subjectRef };
  }

  private async allocateGeneratedPlanCode(
    session: ClientSession,
  ): Promise<string> {
    await this.codeSequenceRepository.ensureAtLeast(
      KPI_PLAN_CODE_POLICY.moduleKey,
      KPI_PLAN_CODE_POLICY.bucket,
      await this.repository.findMaxGeneratedPlanCodeSequence(
        KPI_PLAN_CODE_POLICY,
        session,
      ),
      session,
    );
    const sequence = await this.codeSequenceRepository.allocateNext(
      KPI_PLAN_CODE_POLICY.moduleKey,
      KPI_PLAN_CODE_POLICY.bucket,
      session,
    );
    return formatBusinessCode(KPI_PLAN_CODE_POLICY, sequence);
  }

  private async assertSubjectReferenceActive(
    subjectType: KpiSubjectType,
    subjectId: string,
    session: ClientSession,
  ): Promise<void> {
    if (subjectType === "TALENT") {
      if (
        !(await this.subjectReadonlyAccess.hasActiveTalent(subjectId, session))
      ) {
        throw new KpiInvalidSubjectReferenceError(
          `KPI TALENT subject must reference an active Talent: ${subjectId}`,
        );
      }
      return;
    }

    if (subjectType === "TALENT_GROUP") {
      if (
        !(await this.subjectReadonlyAccess.hasActiveTalentGroup(
          subjectId,
          session,
        ))
      ) {
        throw new KpiInvalidSubjectReferenceError(
          `KPI TALENT_GROUP subject must reference an active Talent Group: ${subjectId}`,
        );
      }
      return;
    }

    if (subjectType === "ORG_UNIT") {
      if (
        !(await this.subjectReadonlyAccess.hasActiveOrgUnit(subjectId, session))
      ) {
        throw new KpiInvalidSubjectReferenceError(
          `KPI ORG_UNIT subject must reference an active supported Org Unit: ${subjectId}`,
        );
      }
      return;
    }

    throw new KpiValidationError(
      `KPI subjectType ${subjectType} is not supported for KPI planning`,
    );
  }

  private async buildAllocationRecords(
    plan: KpiPlan,
    inputs: readonly NormalizedAllocationInput[],
    targetMetrics: readonly KpiTargetMetric[],
    now: number,
    session: ClientSession,
  ): Promise<readonly KpiAllocation[]> {
    if (inputs.length === 0) {
      return [];
    }

    if (plan.subjectType !== "TALENT_GROUP") {
      throw new KpiInvalidAllocationError(
        "KPI allocations are allowed only for TALENT_GROUP plans",
      );
    }

    const planMetricCodes = new Set(
      targetMetrics.map((metric) => metric.metricCode),
    );

    const allocations: KpiAllocation[] = [];
    for (const input of inputs) {
      const member = await this.subjectReadonlyAccess.findActiveGroupMember(
        plan.subjectId,
        input.memberTalentId,
        session,
      );
      if (!member) {
        throw new KpiInvalidAllocationError(
          `KPI allocation memberTalentId must be an active member of group ${plan.subjectId}: ${input.memberTalentId}`,
        );
      }

      if (
        input.membershipId !== null &&
        input.membershipId !== member.membershipId
      ) {
        throw new KpiInvalidAllocationError(
          `KPI allocation membershipId does not match active group membership for memberTalentId ${input.memberTalentId}`,
        );
      }

      for (const target of input.targetMetrics) {
        if (!planMetricCodes.has(target.metricCode)) {
          throw new KpiInvalidAllocationError(
            `KPI allocation metricCode ${target.metricCode} is not in plan target metrics`,
          );
        }
      }

      allocations.push({
        id: crypto.randomUUID(),
        kpiPlanId: plan.id,
        groupId: plan.subjectId,
        memberEmploymentProfileId: member.employmentProfileId,
        memberTalentId: input.memberTalentId,
        membershipId: member.membershipId,
        allocationStatus: "DRAFT",
        allocationStartDate: input.allocationStartDate,
        allocationEndDate: input.allocationEndDate,
        targetMetrics: input.targetMetrics,
        snapshotMemberDisplayName:
          input.snapshotMemberDisplayName ?? member.displayName,
        note: null,
        createdAt: now,
        createdByActorId: null,
        updatedAt: now,
        updatedByActorId: null,
        submittedAt: null,
        submittedByActorId: null,
        approvedAt: null,
        approvedByActorId: null,
        approvalNote: null,
        rejectedAt: null,
        rejectedByActorId: null,
        rejectionReason: null,
        publishedAt: null,
        publishedByActorId: null,
        closedAt: null,
      });
    }

    return allocations;
  }

  private async buildEmploymentAllocationRecords(
    actor: Actor,
    plan: KpiPlan,
    inputs: readonly NormalizedEmploymentAllocationInput[],
    targetMetrics: readonly KpiTargetMetric[],
    now: number,
    session: ClientSession,
  ): Promise<readonly KpiAllocation[]> {
    if (inputs.length === 0) {
      throw new KpiInvalidAllocationError(
        "KPI allocation draft requires at least one member",
      );
    }
    if (plan.subjectType !== "TALENT_GROUP") {
      throw new KpiInvalidAllocationError(
        "KPI allocation drafts are allowed only for TALENT_GROUP plans",
      );
    }
    const planMetricCodes = new Set(
      targetMetrics.map((metric) => metric.metricCode),
    );
    const allocations: KpiAllocation[] = [];
    for (const input of inputs) {
      const member =
        await this.subjectReadonlyAccess.findActiveGroupMemberByEmploymentProfile(
          plan.subjectId,
          input.employmentProfileId,
          session,
        );
      if (!member) {
        throw new KpiInvalidAllocationError(
          `KPI allocation target must be an active internal EmploymentProfile member of group ${plan.subjectId}: ${input.employmentProfileId}`,
        );
      }
      for (const target of input.targetMetrics) {
        if (!planMetricCodes.has(target.metricCode)) {
          throw new KpiInvalidAllocationError(
            `KPI allocation metricCode ${target.metricCode} is not in plan target metrics`,
          );
        }
      }
      allocations.push({
        id: crypto.randomUUID(),
        kpiPlanId: plan.id,
        groupId: plan.subjectId,
        memberEmploymentProfileId: input.employmentProfileId,
        memberTalentId: member.talentId,
        membershipId: member.membershipId,
        allocationStatus: "DRAFT",
        allocationStartDate: input.allocationStartDate,
        allocationEndDate: input.allocationEndDate,
        targetMetrics: input.targetMetrics,
        snapshotMemberDisplayName: member.displayName,
        note: input.note,
        createdAt: now,
        createdByActorId: actor.id,
        updatedAt: now,
        updatedByActorId: actor.id,
        submittedAt: null,
        submittedByActorId: null,
        approvedAt: null,
        approvedByActorId: null,
        approvalNote: null,
        rejectedAt: null,
        rejectedByActorId: null,
        rejectionReason: null,
        publishedAt: null,
        publishedByActorId: null,
        closedAt: null,
      });
    }
    return allocations;
  }

  private async assertActorCanDraftAllocation(
    actor: Actor,
    plan: KpiPlan,
    session?: ClientSession,
  ): Promise<void> {
    if (
      actor.context !== "ADMIN" ||
      (actor.type !== "admin" && actor.type !== "staff")
    ) {
      throw new KpiPermissionScopeError(
        "KPI allocation draft requires ADMIN manager authority",
      );
    }
    if (!this.hasKpiManagedGroupScope(actor)) {
      throw new KpiPermissionScopeError(
        "KPI allocation draft requires kpi.managedGroup scope",
      );
    }
    if (plan.subjectType !== "TALENT_GROUP") {
      throw new KpiInvalidAllocationError(
        "KPI allocation draft is supported only for TALENT_GROUP plans",
      );
    }
    if (plan.status !== "PUBLISHED") {
      throw new KpiStateError(
        "KPI allocation draft requires a PUBLISHED group KPI plan",
      );
    }
    const managedGroupIds = await this.resolveManagedTalentGroupIds(
      actor,
      session,
    );
    if (managedGroupIds.includes(plan.subjectId)) {
      return;
    }
    throw new KpiPermissionScopeError(
      `KPI actor is not an active manager for group ${plan.subjectId}`,
    );
  }

  private async transitionAdminAllocationApproval(
    actor: Actor,
    kpiPlanId: string,
    input: {
      readonly operation: AuthoritativeAdminMutationIdentity;
      readonly permissionCode: Permission;
      readonly fromStatus: KpiAllocationStatus;
      readonly toStatus: KpiAllocationStatus;
      readonly approvalNote?: string | null;
      readonly rejectionReason?: string | null;
    },
  ): Promise<KpiPlanMutationView> {
    const permission = this.assertPermission(actor, input.permissionCode);
    this.assertKpiGlobalScope(actor, "approve KPI allocation");
    return this.executeMutation(
      actor,
      permission,
      input.operation,
      `kpi-plan:${kpiPlanId}`,
      async (session) => {
        const plan = await this.requirePlan(kpiPlanId, session);
        assertExecutableSubjectType(plan.subjectType);
        this.assertActualMutationPlanOpen(plan, "approve or reject allocation");
        const allocations = await this.repository.listAllocationsByPlanId(
          plan.id,
          session,
        );
        if (
          allocations.length === 0 ||
          allocations.some(
            (allocation) => allocation.allocationStatus !== input.fromStatus,
          )
        ) {
          throw new KpiStateError(
            `KPI allocation requires status ${input.fromStatus}`,
          );
        }
        const now = this.clock();
        const modified = await this.repository.transitionAllocationsForPlan(
          {
            kpiPlanId: plan.id,
            fromStatus: input.fromStatus,
            toStatus: input.toStatus,
            updatedAt: now,
            updatedByActorId: actor.id,
            approvedAt: input.toStatus === "APPROVED" ? now : undefined,
            approvedByActorId:
              input.toStatus === "APPROVED" ? actor.id : undefined,
            approvalNote: input.approvalNote,
            rejectedAt: input.toStatus === "REJECTED" ? now : undefined,
            rejectedByActorId:
              input.toStatus === "REJECTED" ? actor.id : undefined,
            rejectionReason: input.rejectionReason,
          },
          session,
        );
        if (modified === 0) {
          throw new KpiStateError("KPI allocation transition failed");
        }
        await this.recordAudit({
          actor,
          permission,
          kpiPlanId: plan.id,
          mutationType: input.operation,
          metadata: {
            previousStatus: input.fromStatus,
            nextStatus: input.toStatus,
            allocationCount: modified,
            approvalNote: input.approvalNote,
            rejectionReason: input.rejectionReason,
          },
          session,
        });
        return this.loadPlanDetail(plan.id, session);
      },
    );
  }

  private async validateGroupAllocationsForTransition(
    plan: KpiPlan,
    targetMetrics: readonly KpiTargetMetric[],
    allocations: readonly KpiAllocation[],
    expectedStatus: KpiAllocationStatus,
    session: ClientSession,
  ): Promise<void> {
    if (allocations.length === 0) {
      throw new KpiInvalidAllocationError(
        "KPI allocation publish requires allocation rows",
      );
    }
    if (
      allocations.some(
        (allocation) => allocation.allocationStatus !== expectedStatus,
      )
    ) {
      throw new KpiStateError(
        `KPI allocation rows must all be ${expectedStatus}`,
      );
    }
    await this.validateGroupAllocationsForPublish(
      plan,
      targetMetrics,
      allocations,
      session,
      expectedStatus,
    );
  }

  private async validateGroupAllocationsForPublish(
    plan: KpiPlan,
    targetMetrics: readonly KpiTargetMetric[],
    allocations: readonly KpiAllocation[],
    session: ClientSession,
    expectedStatus: KpiAllocationStatus = "DRAFT",
  ): Promise<void> {
    if (allocations.length === 0) {
      throw new KpiInvalidAllocationError(
        "KPI TALENT_GROUP publish requires allocation rows",
      );
    }

    const totals = new Map<KpiMetricCode, number>();
    for (const target of targetMetrics) {
      totals.set(target.metricCode, 0);
    }

    for (const allocation of allocations) {
      if (allocation.allocationStatus !== expectedStatus) {
        throw new KpiInvalidAllocationError(
          `KPI allocation ${allocation.id} must be ${expectedStatus} before publish`,
        );
      }
      const member = await this.subjectReadonlyAccess.findActiveGroupMember(
        plan.subjectId,
        allocation.memberTalentId,
        session,
      );
      if (!member) {
        throw new KpiInvalidAllocationError(
          `KPI allocation memberTalentId must still be an active member at publish: ${allocation.memberTalentId}`,
        );
      }
      for (const metric of allocation.targetMetrics) {
        normalizeTargetValue(
          metric.targetValue,
          metric.metricCode,
          `allocations[].targetMetrics[].targetValue`,
        );
        if (!totals.has(metric.metricCode)) {
          throw new KpiInvalidAllocationError(
            `KPI allocation metricCode ${metric.metricCode} is not in plan target metrics`,
          );
        }
        totals.set(
          metric.metricCode,
          (totals.get(metric.metricCode) ?? 0) + metric.targetValue,
        );
      }
    }

    for (const target of targetMetrics) {
      const total = totals.get(target.metricCode) ?? 0;
      if (!numbersEqual(total, target.targetValue)) {
        throw new KpiInvalidAllocationError(
          `KPI allocation total for ${target.metricCode} must equal plan target ${target.targetValue}; received ${total}`,
        );
      }
    }
  }
}

function assertAdminActorType(actor: Actor): void {
  if (actor.type !== "admin" || actor.context !== "ADMIN") {
    throw new KpiPermissionScopeError(
      "KPI V2 admin operations require ADMIN actor context",
    );
  }
}

function normalizeTargetMetrics(
  input: readonly KpiTargetMetricInput[],
  subjectType: KpiSubjectType,
  currencyCodeInput: unknown,
): readonly NormalizedTargetMetric[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new KpiValidationError(
      "KPI plan requires at least one target metric",
    );
  }

  const currencyCode = normalizeCurrency(currencyCodeInput);
  const seen = new Set<KpiMetricCode>();
  return input.map((metric, index) => {
    const metricRecord = requirePlainRecord(metric, `targetMetrics[${index}]`);
    assertOnlyFields(
      metricRecord,
      TARGET_METRIC_INPUT_FIELDS,
      `targetMetrics[${index}]`,
    );
    const metricCode = normalizeMetricCode(metricRecord.metricCode);
    if (seen.has(metricCode)) {
      throw new KpiValidationError(
        `KPI targetMetrics[${index}] duplicates metricCode ${metricCode}`,
      );
    }
    seen.add(metricCode);

    const catalog = getKpiMetricCatalogEntry(metricCode);
    if (!catalog.allowedSubjectTypes.includes(subjectType)) {
      throw new KpiValidationError(
        `KPI metric ${metricCode} is not allowed for subjectType ${subjectType}`,
      );
    }
    if (
      catalog.currencyCode !== undefined &&
      catalog.currencyCode !== currencyCode
    ) {
      throw new KpiValidationError(
        `KPI metric ${metricCode} requires currencyCode ${catalog.currencyCode}`,
      );
    }

    return {
      metricCode,
      targetValue: normalizeTargetValue(
        metricRecord.targetValue,
        metricCode,
        `targetMetrics[${index}].targetValue`,
      ),
    };
  });
}

function buildTargetMetricRecords(
  kpiPlanId: string,
  input: readonly NormalizedTargetMetric[],
  now: number,
): readonly KpiTargetMetric[] {
  return input.map((metric) => {
    const catalog = getKpiMetricCatalogEntry(metric.metricCode);
    return {
      id: crypto.randomUUID(),
      kpiPlanId,
      metricCode: metric.metricCode,
      targetValue: metric.targetValue,
      unit: catalog.unit,
      rollupMethod: catalog.rollupMethod,
      actualSource: "MANUAL",
      createdAt: now,
      updatedAt: now,
    };
  });
}

function normalizeAllocations(
  input: readonly KpiAllocationInput[],
  targetMetrics: readonly Pick<KpiTargetMetric, "metricCode">[],
): readonly NormalizedAllocationInput[] {
  if (!Array.isArray(input)) {
    throw new KpiValidationError("KPI allocations must be an array");
  }
  const planMetricCodes = new Set(
    targetMetrics.map((metric) => metric.metricCode),
  );
  const seenMembers = new Set<string>();

  return input.map((allocation, allocationIndex) => {
    const allocationRecord = requirePlainRecord(
      allocation,
      `allocations[${allocationIndex}]`,
    );
    assertOnlyFields(
      allocationRecord,
      ALLOCATION_INPUT_FIELDS,
      `allocations[${allocationIndex}]`,
    );
    const memberTalentId = normalizeRequiredText(
      allocationRecord.memberTalentId,
      `allocations[${allocationIndex}].memberTalentId`,
    );
    if (seenMembers.has(memberTalentId)) {
      throw new KpiValidationError(
        `KPI allocations duplicate memberTalentId ${memberTalentId}`,
      );
    }
    seenMembers.add(memberTalentId);

    if (!Array.isArray(allocationRecord.targetMetrics)) {
      throw new KpiValidationError(
        `KPI allocations[${allocationIndex}].targetMetrics must be an array`,
      );
    }

    const seenMetricCodes = new Set<KpiMetricCode>();
    const normalizedTargets = allocationRecord.targetMetrics.map(
      (target, targetIndex: number) => {
        const targetRecord = requirePlainRecord(
          target,
          `allocations[${allocationIndex}].targetMetrics[${targetIndex}]`,
        );
        assertOnlyFields(
          targetRecord,
          TARGET_METRIC_INPUT_FIELDS,
          `allocations[${allocationIndex}].targetMetrics[${targetIndex}]`,
        );
        const metricCode = normalizeMetricCode(targetRecord.metricCode);
        if (!planMetricCodes.has(metricCode)) {
          throw new KpiInvalidAllocationError(
            `KPI allocation metricCode ${metricCode} is not in plan target metrics`,
          );
        }
        if (seenMetricCodes.has(metricCode)) {
          throw new KpiValidationError(
            `KPI allocations[${allocationIndex}].targetMetrics duplicates metricCode ${metricCode}`,
          );
        }
        seenMetricCodes.add(metricCode);
        return {
          metricCode,
          targetValue: normalizeTargetValue(
            targetRecord.targetValue,
            metricCode,
            `allocations[${allocationIndex}].targetMetrics[${targetIndex}].targetValue`,
          ),
        };
      },
    );

    return {
      memberTalentId,
      membershipId: normalizeNullableText(allocationRecord.membershipId),
      allocationStartDate: normalizeDateText(
        allocationRecord.allocationStartDate,
        `allocations[${allocationIndex}].allocationStartDate`,
      ),
      allocationEndDate: normalizeNullableDateText(
        allocationRecord.allocationEndDate,
        `allocations[${allocationIndex}].allocationEndDate`,
      ),
      targetMetrics: normalizedTargets,
      snapshotMemberDisplayName: normalizeNullableText(
        allocationRecord.snapshotMemberDisplayName,
      ),
    };
  });
}

function normalizeEmploymentAllocations(
  input: readonly unknown[],
  targetMetrics: readonly Pick<KpiTargetMetric, "metricCode">[],
): readonly NormalizedEmploymentAllocationInput[] {
  if (!Array.isArray(input)) {
    throw new KpiValidationError("KPI allocations must be an array");
  }
  if (input.length === 0) {
    throw new KpiInvalidAllocationError(
      "KPI allocation draft requires at least one member",
    );
  }
  const planMetricCodes = new Set(
    targetMetrics.map((metric) => metric.metricCode),
  );
  const seenProfiles = new Set<string>();

  return input.map((allocation, allocationIndex) => {
    const allocationRecord = requirePlainRecord(
      allocation,
      `allocations[${allocationIndex}]`,
    );
    assertOnlyFields(
      allocationRecord,
      ALLOCATION_DRAFT_INPUT_FIELDS,
      `allocations[${allocationIndex}]`,
    );
    const employmentProfileId = normalizeRequiredText(
      allocationRecord.employmentProfileId,
      `allocations[${allocationIndex}].employmentProfileId`,
    );
    if (seenProfiles.has(employmentProfileId)) {
      throw new KpiValidationError(
        `KPI allocations duplicate employmentProfileId ${employmentProfileId}`,
      );
    }
    seenProfiles.add(employmentProfileId);

    if (!Array.isArray(allocationRecord.targetMetrics)) {
      throw new KpiValidationError(
        `KPI allocations[${allocationIndex}].targetMetrics must be an array`,
      );
    }
    const seenMetricCodes = new Set<KpiMetricCode>();
    const normalizedTargets = allocationRecord.targetMetrics.map(
      (target, targetIndex: number) => {
        const targetRecord = requirePlainRecord(
          target,
          `allocations[${allocationIndex}].targetMetrics[${targetIndex}]`,
        );
        assertOnlyFields(
          targetRecord,
          TARGET_METRIC_INPUT_FIELDS,
          `allocations[${allocationIndex}].targetMetrics[${targetIndex}]`,
        );
        const metricCode = normalizeMetricCode(targetRecord.metricCode);
        if (!planMetricCodes.has(metricCode)) {
          throw new KpiInvalidAllocationError(
            `KPI allocation metricCode ${metricCode} is not in plan target metrics`,
          );
        }
        if (seenMetricCodes.has(metricCode)) {
          throw new KpiValidationError(
            `KPI allocations[${allocationIndex}].targetMetrics duplicates metricCode ${metricCode}`,
          );
        }
        seenMetricCodes.add(metricCode);
        return {
          metricCode,
          targetValue: normalizeTargetValue(
            targetRecord.targetValue,
            metricCode,
            `allocations[${allocationIndex}].targetMetrics[${targetIndex}].targetValue`,
          ),
        };
      },
    );

    return {
      employmentProfileId,
      allocationStartDate: normalizeDateText(
        allocationRecord.allocationStartDate,
        `allocations[${allocationIndex}].allocationStartDate`,
      ),
      allocationEndDate: normalizeNullableDateText(
        allocationRecord.allocationEndDate,
        `allocations[${allocationIndex}].allocationEndDate`,
      ),
      targetMetrics: normalizedTargets,
      note: normalizeNullableText(allocationRecord.note),
    };
  });
}

export function normalizePlanPeriod(input: {
  readonly periodMonth: unknown;
  readonly periodStartAt: unknown;
  readonly periodEndAt: unknown;
  readonly timezone: unknown;
}): NormalizedPlanPeriod {
  const periodMonth = normalizePeriodMonth(input.periodMonth);
  const periodStartAt = normalizeTimestamp(
    input.periodStartAt,
    "periodStartAt",
  );
  const periodEndAt = normalizeTimestamp(input.periodEndAt, "periodEndAt");
  const timezone =
    input.timezone === undefined || input.timezone === null
      ? DEFAULT_TIMEZONE
      : normalizeRequiredText(input.timezone, "timezone");

  if (timezone !== DEFAULT_TIMEZONE) {
    throw new KpiValidationError(
      `KPI timezone must be ${DEFAULT_TIMEZONE} in Phase 4-C.2`,
    );
  }

  const expected = expectedMonthWindow(periodMonth);
  if (
    periodStartAt !== expected.periodStartAt ||
    periodEndAt !== expected.periodEndAt
  ) {
    throw new KpiValidationError(
      `KPI periodStartAt/periodEndAt must match calendar month ${periodMonth} in ${DEFAULT_TIMEZONE}`,
    );
  }

  return {
    periodMonth,
    periodStartAt,
    periodEndAt,
    timezone,
  };
}

function expectedMonthWindow(periodMonth: string): {
  readonly periodStartAt: number;
  readonly periodEndAt: number;
} {
  const [yearText, monthText] = periodMonth.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const periodStartAt = Date.UTC(
    year,
    monthIndex,
    1,
    -HCM_UTC_OFFSET_HOURS,
    0,
    0,
    0,
  );
  const nextMonthStartAt = Date.UTC(
    year,
    monthIndex + 1,
    1,
    -HCM_UTC_OFFSET_HOURS,
    0,
    0,
    0,
  );
  return {
    periodStartAt,
    periodEndAt: nextMonthStartAt - 1,
  };
}

export function normalizePeriodMonth(value: unknown): string {
  const text = normalizeRequiredText(value, "periodMonth");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(text)) {
    throw new KpiValidationError("KPI periodMonth must use YYYY-MM format");
  }
  return text;
}

function normalizeMetricCode(value: unknown): KpiMetricCode {
  const text = normalizeRequiredText(value, "metricCode");
  if (!KPI_METRIC_CODES.includes(text as KpiMetricCode)) {
    throw new KpiValidationError(
      `KPI metricCode is unsupported or not active in MVP: ${text}`,
    );
  }
  return text as KpiMetricCode;
}

function normalizeActualSlotExcuseStatus(
  value: unknown,
): KpiActualSlotExcuseStatus {
  const text = normalizeRequiredText(value, "status");
  if (!KPI_ACTUAL_SLOT_EXCUSE_STATUSES.includes(text as never)) {
    throw new KpiValidationError(
      `KPI actual excuse status is unsupported: ${text}`,
    );
  }
  return text as KpiActualSlotExcuseStatus;
}

function normalizeActualSlotExcuseReasonCode(
  value: unknown,
): KpiActualSlotExcuseReasonCode {
  const text = normalizeRequiredText(value, "reasonCode");
  if (!KPI_ACTUAL_SLOT_EXCUSE_REASON_CODES.includes(text as never)) {
    throw new KpiValidationError(
      `KPI actual excuse reasonCode is unsupported: ${text}`,
    );
  }
  return text as KpiActualSlotExcuseReasonCode;
}

function normalizeSubjectType(value: unknown): KpiSubjectType {
  const text = normalizeRequiredText(value, "subjectType");
  if (!KPI_SUBJECT_TYPES.includes(text as KpiSubjectType)) {
    throw new KpiValidationError(`KPI subjectType is unsupported: ${text}`);
  }
  return text as KpiSubjectType;
}

function assertExecutableSubjectType(subjectType: KpiSubjectType): void {
  if (KPI_EXECUTABLE_SUBJECT_TYPES.includes(subjectType as never)) {
    return;
  }

  throw new KpiValidationError(
    subjectType === "ORG_UNIT"
      ? "Org Unit KPI execution is not enabled yet"
      : `KPI subjectType ${subjectType} is future-compatible but not executable in Phase 4-C.2`,
  );
}

function assertCreateSubjectType(subjectType: KpiSubjectType): void {
  if (KPI_CREATE_SUBJECT_TYPES.includes(subjectType as never)) {
    return;
  }

  throw new KpiValidationError(
    `KPI create subjectType ${subjectType} is not supported; use TALENT_GROUP or ORG_UNIT`,
  );
}

function assertCreateCommandHasNoAllocations(
  command: CreateKpiPlanCommand,
): void {
  if (Object.prototype.hasOwnProperty.call(command, "allocations")) {
    throw new KpiValidationError(
      "KPI create does not accept allocations; allocate members after publish",
    );
  }
}

function assertPlanPeriodIsNotPast(periodMonth: string, now: number): void {
  const currentMonth = currentMonthInDefaultTimezone(now);
  if (periodMonth < currentMonth) {
    throw new KpiValidationError(
      `KPI periodMonth ${periodMonth} is before the current ${DEFAULT_TIMEZONE} month ${currentMonth}`,
    );
  }
}

function currentMonthInDefaultTimezone(now: number): string {
  const local = new Date(now + DEFAULT_TIMEZONE_OFFSET_MS);
  const year = local.getUTCFullYear();
  const month = String(local.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function buildActualWorkspaceSlotData(input: {
  readonly plan: KpiPlan;
  readonly allocations: readonly KpiAllocation[];
  readonly entries: readonly KpiActualEntry[];
  readonly excuses: readonly KpiActualSlotExcuse[];
}) {
  const officialAllocations = input.allocations.filter(
    (allocation) =>
      isOfficialKpiAllocation(allocation) &&
      allocation.groupId === input.plan.subjectId,
  );
  const officialAllocationsById = new Map(
    officialAllocations.map((allocation) => [allocation.id, allocation]),
  );
  const actualByAllocationMetric = new Map<string, number>();
  const entryCountByAllocationMetric = new Map<string, number>();
  const entriesBySlot = new Map<string, KpiActualEntry>();
  const excusesBySlot = new Map<string, KpiActualSlotExcuse>();

  for (const entry of input.entries) {
    const allocation = officialAllocationsById.get(entry.allocationId);
    if (
      !allocation ||
      !isActualWorkspaceCatalogMetricCode(entry.metricCode) ||
      entry.memberTalentId !== allocation.memberTalentId ||
      !allocation.targetMetrics.some(
        (metric) => metric.metricCode === entry.metricCode,
      ) ||
      !isActualEntryWithinPlanPeriod(input.plan, entry.actualDate)
    ) {
      continue;
    }
    const key = actualWorkspaceAllocationMetricKey(
      allocation.id,
      entry.metricCode,
    );
    actualByAllocationMetric.set(
      key,
      (actualByAllocationMetric.get(key) ?? 0) + entry.effectiveValue,
    );
    entryCountByAllocationMetric.set(
      key,
      (entryCountByAllocationMetric.get(key) ?? 0) + 1,
    );
    entriesBySlot.set(
      actualWorkspaceSlotKey(allocation.id, entry.metricCode, entry.actualDate),
      entry,
    );
  }

  for (const excuse of input.excuses) {
    const allocation = officialAllocationsById.get(excuse.allocationId);
    if (
      !allocation ||
      excuse.deletedAt !== null ||
      !allocation.targetMetrics.some(
        (metric) => metric.metricCode === excuse.metricCode,
      ) ||
      !isActualEntryWithinPlanPeriod(input.plan, excuse.actualDate)
    ) {
      continue;
    }
    excusesBySlot.set(
      actualWorkspaceSlotKey(
        allocation.id,
        excuse.metricCode,
        excuse.actualDate,
      ),
      excuse,
    );
  }

  return {
    officialAllocations,
    actualByAllocationMetric,
    entryCountByAllocationMetric,
    entriesBySlot,
    excusesBySlot,
  };
}

function buildActualWorkspaceStatusSummary(input: {
  readonly plan: KpiPlan;
  readonly allocations: readonly KpiAllocation[];
  readonly entries: readonly KpiActualEntry[];
  readonly excuses: readonly KpiActualSlotExcuse[];
  readonly now: number;
}): KpiActualEntryStatusSummary {
  const slotData = buildActualWorkspaceSlotData(input);
  return summarizeDailyActualStatuses({
    plan: input.plan,
    allocations: slotData.officialAllocations,
    entriesBySlot: slotData.entriesBySlot,
    excusesBySlot: slotData.excusesBySlot,
    now: input.now,
  });
}

function buildActualWorkspaceAggregate(input: {
  readonly plan: KpiPlan;
  readonly targetMetrics: readonly KpiTargetMetric[];
  readonly allocations: readonly KpiAllocation[];
  readonly entries: readonly KpiActualEntry[];
  readonly excuses: readonly KpiActualSlotExcuse[];
  readonly subjectRef: ReferenceSummary | null;
  readonly actionHints: KpiActualWorkspaceActionHints;
  readonly now: number;
}): KpiActualWorkspaceAggregate {
  const {
    officialAllocations,
    actualByAllocationMetric,
    entryCountByAllocationMetric,
    entriesBySlot,
    excusesBySlot,
  } = buildActualWorkspaceSlotData(input);
  const periodDayCount = countLocalDaysInPlan(input.plan);
  const members = officialAllocations.map((allocation) => {
    const catalogTargetMetrics = allocation.targetMetrics.filter((metric) =>
      isActualWorkspaceCatalogMetricCode(metric.metricCode),
    );
    const metricSummaries = catalogTargetMetrics
      .map((metric) => {
        const key = actualWorkspaceAllocationMetricKey(
          allocation.id,
          metric.metricCode,
        );
        const actualValue = actualByAllocationMetric.get(key) ?? 0;
        return {
          metricCode: metric.metricCode,
          targetValue: metric.targetValue,
          actualValue,
          achievementPercent: calculateProgressPercent(
            actualValue,
            metric.targetValue,
          ),
        } satisfies KpiActualWorkspaceMetricSummary;
      })
      .sort(compareActualWorkspaceMetricSummary);
    const revenue = metricSummaries.find(
      (metric) => metric.metricCode === "REVENUE_VND",
    );
    const missingCount = catalogTargetMetrics.reduce((sum, metric) => {
      const key = actualWorkspaceAllocationMetricKey(
        allocation.id,
        metric.metricCode,
      );
      return (
        sum +
        Math.max(
          periodDayCount - (entryCountByAllocationMetric.get(key) ?? 0),
          0,
        )
      );
    }, 0);
    const actualEntryStatusSummary = summarizeDailyActualStatuses({
      plan: input.plan,
      allocations: [allocation],
      now: input.now,
      entriesBySlot,
      excusesBySlot,
    });

    return {
      allocationId: allocation.id,
      allocationStatus: "PUBLISHED",
      memberDisplayName: allocation.snapshotMemberDisplayName,
      revenue: {
        metricCode: "REVENUE_VND",
        targetValue: revenue?.targetValue ?? 0,
        actualValue: revenue?.actualValue ?? 0,
        achievementPercent: revenue?.achievementPercent ?? null,
      },
      supportingMetrics: metricSummaries.filter(
        (metric) => metric.metricCode !== "REVENUE_VND",
      ),
      missingSignal: createActualWorkspaceMissingSignal(missingCount),
      actualEntryStatusSummary,
      actionHints: input.actionHints,
    } satisfies KpiActualWorkspaceMemberSummary;
  });

  const groupTargets = new Map<KpiMetricCode, number>();
  const groupActuals = new Map<KpiMetricCode, number>();
  for (const allocation of officialAllocations) {
    for (const metric of allocation.targetMetrics) {
      if (!isActualWorkspaceCatalogMetricCode(metric.metricCode)) {
        continue;
      }
      groupTargets.set(
        metric.metricCode,
        (groupTargets.get(metric.metricCode) ?? 0) + metric.targetValue,
      );
      const key = actualWorkspaceAllocationMetricKey(
        allocation.id,
        metric.metricCode,
      );
      groupActuals.set(
        metric.metricCode,
        (groupActuals.get(metric.metricCode) ?? 0) +
          (actualByAllocationMetric.get(key) ?? 0),
      );
    }
  }
  const metricCodes = new Set([...groupTargets.keys(), ...groupActuals.keys()]);
  const groupMetricSummaries = Array.from(metricCodes)
    .map((metricCode) => {
      const targetValue = groupTargets.get(metricCode) ?? 0;
      const actualValue = groupActuals.get(metricCode) ?? 0;
      return {
        metricCode,
        targetValue,
        actualValue,
        achievementPercent: calculateProgressPercent(actualValue, targetValue),
      } satisfies KpiActualWorkspaceMetricSummary;
    })
    .sort(compareActualWorkspaceMetricSummary);
  const revenue = groupMetricSummaries.find(
    (metric) => metric.metricCode === "REVENUE_VND",
  );
  const operationalTargetValue = revenue?.targetValue ?? 0;
  const planTargetValue =
    input.targetMetrics.find((metric) => metric.metricCode === "REVENUE_VND")
      ?.targetValue ?? null;
  const publishedAllocationCount = input.allocations.filter(
    isOfficialKpiAllocation,
  ).length;
  const totalAllocationCount = input.allocations.length;

  return {
    summary: {
      planId: input.plan.id,
      planCode: input.plan.planCode,
      title: input.plan.title,
      periodMonth: input.plan.periodMonth,
      subjectType: "TALENT_GROUP",
      subjectId: input.plan.subjectId,
      subjectRef: input.subjectRef,
      planStatus: input.plan.status,
      revenue: {
        metricCode: "REVENUE_VND",
        operationalTargetValue,
        planTargetValue,
        actualValue: revenue?.actualValue ?? 0,
        achievementPercent: revenue?.achievementPercent ?? null,
        targetSource: "ALLOCATED",
        targetMismatch:
          planTargetValue !== null &&
          !numbersEqual(planTargetValue, operationalTargetValue),
      },
      allocationCoverage: {
        publishedAllocationCount,
        totalAllocationCount,
        isAllExistingAllocationsPublished:
          totalAllocationCount > 0 &&
          publishedAllocationCount === totalAllocationCount,
      },
      supportingMetrics: groupMetricSummaries.filter(
        (metric) => metric.metricCode !== "REVENUE_VND",
      ),
      missingSignal: createActualWorkspaceMissingSignal(
        members.reduce((sum, member) => sum + member.missingSignal.count, 0),
      ),
      actualEntryStatusSummary: sumActualEntryStatusSummaries(
        members.map((member) => member.actualEntryStatusSummary),
      ),
      closing: resolveActualWorkspaceClosing(input.plan, input.now),
      actionHints: input.actionHints,
    },
    members,
  };
}

function isActualWorkspaceCatalogMetricCode(
  metricCode: string,
): metricCode is KpiMetricCode {
  return Object.prototype.hasOwnProperty.call(KPI_METRIC_CATALOG, metricCode);
}

function actualWorkspaceAllocationMetricKey(
  allocationId: string,
  metricCode: KpiMetricCode,
): string {
  return `${allocationId}:${metricCode}`;
}

function actualWorkspaceSlotKey(
  allocationId: string,
  metricCode: KpiMetricCode,
  actualDate: string,
): string {
  return `${allocationId}:${metricCode}:${actualDate}`;
}

function compareActualWorkspaceMetricSummary(
  left: KpiActualWorkspaceMetricSummary,
  right: KpiActualWorkspaceMetricSummary,
): number {
  return left.metricCode.localeCompare(right.metricCode);
}

function createActualWorkspaceMissingSignal(
  count: number,
): KpiActualWorkspacePlanSummary["missingSignal"] {
  return {
    count,
    semantics: "CALENDAR_DAY_METRIC_SLOT_LIMITED",
  };
}

type MutableKpiActualEntryStatusSummary = {
  -readonly [Key in keyof KpiActualEntryStatusSummary]: KpiActualEntryStatusSummary[Key];
};

function summarizeDailyActualStatuses(input: {
  readonly plan: KpiPlan;
  readonly allocations: readonly KpiAllocation[];
  readonly entriesBySlot: ReadonlyMap<string, KpiActualEntry>;
  readonly excusesBySlot: ReadonlyMap<string, KpiActualSlotExcuse>;
  readonly now: number;
}): KpiActualEntryStatusSummary {
  const summary = createEmptyActualEntryStatusSummary();
  const actualDates = listLocalDatesInPlan(input.plan.periodMonth);
  for (const allocation of input.allocations) {
    const targetMetrics = allocation.targetMetrics.filter((metric) =>
      isActualWorkspaceCatalogMetricCode(metric.metricCode),
    );
    for (const metric of targetMetrics) {
      for (const actualDate of actualDates) {
        summary.expectedEntryCount += 1;
        const status = resolveDailyActualStatus({
          plan: input.plan,
          allocation,
          actualDate,
          entry: input.entriesBySlot.get(
            actualWorkspaceSlotKey(
              allocation.id,
              metric.metricCode,
              actualDate,
            ),
          ),
          excuse: input.excusesBySlot.get(
            actualWorkspaceSlotKey(
              allocation.id,
              metric.metricCode,
              actualDate,
            ),
          ),
          now: input.now,
        });
        applyDailyActualStatus(summary, status);
      }
    }
  }
  return summary;
}

function createEmptyActualEntryStatusSummary(): MutableKpiActualEntryStatusSummary {
  return {
    expectedEntryCount: 0,
    enteredEntryCount: 0,
    enteredZeroCount: 0,
    pendingEntryCount: 0,
    overdueEntryCount: 0,
    excusedEntryCount: 0,
    notRequiredEntryCount: 0,
    notDueEntryCount: 0,
  };
}

function sumActualEntryStatusSummaries(
  summaries: readonly KpiActualEntryStatusSummary[],
): KpiActualEntryStatusSummary {
  const total = createEmptyActualEntryStatusSummary();
  for (const summary of summaries) {
    total.expectedEntryCount += summary.expectedEntryCount;
    total.enteredEntryCount += summary.enteredEntryCount;
    total.enteredZeroCount += summary.enteredZeroCount;
    total.pendingEntryCount += summary.pendingEntryCount;
    total.overdueEntryCount += summary.overdueEntryCount;
    total.excusedEntryCount += summary.excusedEntryCount;
    total.notRequiredEntryCount += summary.notRequiredEntryCount;
    total.notDueEntryCount += summary.notDueEntryCount;
  }
  return total;
}

function applyDailyActualStatus(
  summary: {
    enteredEntryCount: number;
    enteredZeroCount: number;
    pendingEntryCount: number;
    overdueEntryCount: number;
    excusedEntryCount: number;
    notRequiredEntryCount: number;
    notDueEntryCount: number;
  },
  status: KpiDailyActualStatus,
): void {
  switch (status) {
    case "ENTERED":
      summary.enteredEntryCount += 1;
      return;
    case "ENTERED_ZERO":
      summary.enteredEntryCount += 1;
      summary.enteredZeroCount += 1;
      return;
    case "DUE_OPEN":
      summary.pendingEntryCount += 1;
      return;
    case "OVERDUE":
      summary.overdueEntryCount += 1;
      return;
    case "EXCUSED":
      summary.excusedEntryCount += 1;
      return;
    case "NOT_REQUIRED":
      summary.notRequiredEntryCount += 1;
      return;
    case "NOT_DUE":
      summary.notDueEntryCount += 1;
      return;
    case "BLOCKED_BY_PLAN_STATUS":
    case "BLOCKED_BY_ALLOCATION_STATUS":
      return;
  }
}

function resolveDailyActualStatus(input: {
  readonly plan: KpiPlan;
  readonly allocation: KpiAllocation;
  readonly actualDate: string;
  readonly entry?: KpiActualEntry;
  readonly excuse?: KpiActualSlotExcuse;
  readonly now: number;
}): KpiDailyActualStatus {
  if (input.plan.status !== "PUBLISHED") {
    return "BLOCKED_BY_PLAN_STATUS";
  }
  if (input.allocation.allocationStatus !== "PUBLISHED") {
    return "BLOCKED_BY_ALLOCATION_STATUS";
  }
  if (input.entry && numbersEqual(input.entry.actualValue, 0)) {
    return "ENTERED_ZERO";
  }
  if (input.entry) {
    return "ENTERED";
  }
  if (input.excuse?.status === "EXCUSED") {
    return "EXCUSED";
  }
  if (input.excuse?.status === "NOT_REQUIRED") {
    return "NOT_REQUIRED";
  }
  if (input.now < localDateTimeToUtcMs(input.actualDate, "00:00")) {
    return "NOT_DUE";
  }
  if (
    input.now <=
    localDateTimeToUtcMs(
      input.actualDate,
      DEFAULT_ACTUAL_ENTRY_LOCK_LOCAL_TIME,
      1,
    )
  ) {
    return "DUE_OPEN";
  }
  return "OVERDUE";
}

function toActualSlotExcuseSummary(
  excuse: KpiActualSlotExcuse,
): KpiActualSlotExcuseSummary {
  return {
    id: excuse.id,
    status: excuse.status,
    reasonCode: excuse.reasonCode,
    reasonText: excuse.reasonText,
    createdAt: excuse.createdAt,
    createdByActorId: excuse.createdByActorId,
    updatedAt: excuse.updatedAt,
    updatedByActorId: excuse.updatedByActorId,
  };
}

function listLocalDatesInPlan(periodMonth: string): readonly string[] {
  const [yearText, monthText] = periodMonth.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: lastDay }, (_value, index) => {
    const day = String(index + 1).padStart(2, "0");
    return `${day}-${monthText}-${yearText}`;
  });
}

function createNoActualWorkspaceActionHints(): KpiActualWorkspaceActionHints {
  return { canReadActualGrid: false, canEnterActual: false };
}

function resolveActualWorkspaceClosing(
  plan: KpiPlan,
  now: number,
): KpiActualWorkspacePlanSummary["closing"] {
  if (now <= plan.periodEndAt) {
    return { periodState: "CURRENT" };
  }
  const entryOpenUntil = localDateTimeToUtcMs(
    lastLocalDateOfPeriod(plan.periodMonth),
    DEFAULT_ACTUAL_ENTRY_LOCK_LOCAL_TIME,
    1,
  );
  if (now <= entryOpenUntil) {
    return { periodState: "CLOSING", entryOpenUntil };
  }
  return { periodState: "CLOSED" };
}

function isActualEntryWithinPlanPeriod(
  plan: KpiPlan,
  actualDate: string,
): boolean {
  try {
    assertActualDateWithinPlan(plan, actualDate);
    return true;
  } catch {
    return false;
  }
}

function compareKpiPlanListItems(
  left: KpiPlan,
  right: KpiPlan,
  input: Pick<ListKpiPlansInput, "sortBy" | "sortDirection">,
): number {
  const direction = input.sortDirection === "ASC" ? 1 : -1;
  const sortBy = input.sortBy ?? "periodMonth";
  if (sortBy === "createdAt") {
    const createdDiff = (left.createdAt - right.createdAt) * direction;
    return createdDiff || left.id.localeCompare(right.id);
  }
  const leftValue = sortBy === "planCode" ? left.planCode : left.periodMonth;
  const rightValue = sortBy === "planCode" ? right.planCode : right.periodMonth;
  const fieldDiff = leftValue.localeCompare(rightValue) * direction;
  return (
    fieldDiff ||
    left.planCode.localeCompare(right.planCode) ||
    left.id.localeCompare(right.id)
  );
}

function buildPlanListCursor(
  plan: KpiPlan,
  sortBy: "periodMonth" | "planCode",
  sortDirection: "ASC" | "DESC",
): KpiPlanListCursor {
  return {
    sortBy,
    sortDirection,
    value: sortBy === "planCode" ? plan.planCode : plan.periodMonth,
    planId: plan.id,
  };
}

function buildActualWorkspaceDerivedCursor(
  row: KpiActualWorkspaceDerivedPlanSortRow,
  sortBy: KpiActualWorkspaceDerivedSortBy,
  sortDirection: "ASC" | "DESC",
): KpiActualWorkspaceDerivedCursor {
  return sortBy === "revenueActual"
    ? {
        sortBy,
        sortDirection,
        revenueActual: row.revenueActual,
        planId: row.plan.id,
      }
    : {
        sortBy,
        sortDirection,
        achievementPercent: row.achievementPercent,
        achievementNullRank: row.achievementNullRank,
        planId: row.plan.id,
      };
}

function buildActualWorkspaceCursorEnvelope(
  row: KpiPlan | KpiActualWorkspaceDerivedPlanSortRow,
  input: Pick<NormalizedActualWorkspacePlansInput, "sortBy" | "sortDirection">,
  queryKey: string,
): ActualWorkspaceCursorEnvelope {
  const plan = isDerivedPlanSortRow(row) ? row.plan : row;
  return {
    version: 1,
    queryKey,
    sortBy: input.sortBy,
    sortDirection: input.sortDirection,
    ...(input.sortBy === "planCode" ? { lastPlanCode: plan.planCode } : {}),
    ...(input.sortBy === "periodMonth"
      ? { lastPeriodMonth: plan.periodMonth }
      : {}),
    ...(input.sortBy === "revenueActual" && isDerivedPlanSortRow(row)
      ? { lastRevenueActual: row.revenueActual }
      : {}),
    ...(input.sortBy === "achievementPercent" && isDerivedPlanSortRow(row)
      ? {
          lastAchievementPercent: row.achievementPercent,
          lastAchievementNullRank: row.achievementNullRank,
        }
      : {}),
    lastPlanId: plan.id,
  };
}

function encodeActualWorkspaceCursor(
  cursor: ActualWorkspaceCursorEnvelope,
): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeActualWorkspacePlanCursor(
  cursor: string,
  input: Pick<NormalizedActualWorkspacePlansInput, "sortBy" | "sortDirection">,
  expectedQueryKey: string,
): KpiPlanListCursor {
  if (input.sortBy !== "periodMonth" && input.sortBy !== "planCode") {
    throw invalidActualWorkspaceCursorError();
  }
  const normalized = cursor.trim();
  if (!normalized) {
    throw invalidActualWorkspaceCursorError();
  }

  let decodedText: string;
  try {
    decodedText = Buffer.from(normalized, "base64url").toString("utf8");
  } catch {
    throw invalidActualWorkspaceCursorError();
  }

  let payload: unknown;
  try {
    payload = JSON.parse(decodedText);
  } catch {
    throw invalidActualWorkspaceCursorError();
  }

  if (!isRecord(payload)) {
    throw invalidActualWorkspaceCursorError();
  }
  if (
    payload.version !== 1 ||
    payload.queryKey !== expectedQueryKey ||
    payload.sortBy !== input.sortBy ||
    payload.sortDirection !== input.sortDirection ||
    typeof payload.lastPlanId !== "string" ||
    payload.lastPlanId.trim().length === 0
  ) {
    throw invalidActualWorkspaceCursorError();
  }
  if (payload.sortBy !== "periodMonth" && payload.sortBy !== "planCode") {
    throw invalidActualWorkspaceCursorError();
  }
  const value =
    payload.sortBy === "planCode"
      ? payload.lastPlanCode
      : payload.lastPeriodMonth;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw invalidActualWorkspaceCursorError();
  }
  return {
    sortBy: input.sortBy,
    sortDirection: input.sortDirection,
    value,
    planId: payload.lastPlanId,
  };
}

function isActualWorkspaceDerivedSortBy(
  sortBy: NormalizedActualWorkspacePlansInput["sortBy"],
): sortBy is KpiActualWorkspaceDerivedSortBy {
  return sortBy === "revenueActual" || sortBy === "achievementPercent";
}

function isDerivedPlanSortRow(
  value: KpiPlan | KpiActualWorkspaceDerivedPlanSortRow,
): value is KpiActualWorkspaceDerivedPlanSortRow {
  return Object.prototype.hasOwnProperty.call(value, "plan");
}

function decodeActualWorkspaceDerivedCursor(
  cursor: string,
  input: Pick<NormalizedActualWorkspacePlansInput, "sortBy" | "sortDirection">,
  expectedQueryKey: string,
): KpiActualWorkspaceDerivedCursor {
  if (!isActualWorkspaceDerivedSortBy(input.sortBy)) {
    throw invalidActualWorkspaceCursorError();
  }
  const payload = decodeActualWorkspaceCursorPayload(cursor);
  if (
    payload.version !== 1 ||
    payload.queryKey !== expectedQueryKey ||
    payload.sortBy !== input.sortBy ||
    payload.sortDirection !== input.sortDirection ||
    typeof payload.lastPlanId !== "string" ||
    payload.lastPlanId.trim().length === 0
  ) {
    throw invalidActualWorkspaceCursorError();
  }
  if (payload.sortBy === "revenueActual") {
    if (
      typeof payload.lastRevenueActual !== "number" ||
      !Number.isFinite(payload.lastRevenueActual)
    ) {
      throw invalidActualWorkspaceCursorError();
    }
    return {
      sortBy: "revenueActual",
      sortDirection: input.sortDirection,
      revenueActual: payload.lastRevenueActual,
      planId: payload.lastPlanId,
    };
  }
  if (payload.sortBy === "achievementPercent") {
    if (
      payload.lastAchievementNullRank !== 0 &&
      payload.lastAchievementNullRank !== 1
    ) {
      throw invalidActualWorkspaceCursorError();
    }
    if (
      payload.lastAchievementNullRank === 0 &&
      (typeof payload.lastAchievementPercent !== "number" ||
        !Number.isFinite(payload.lastAchievementPercent))
    ) {
      throw invalidActualWorkspaceCursorError();
    }
    if (
      payload.lastAchievementNullRank === 1 &&
      payload.lastAchievementPercent !== null
    ) {
      throw invalidActualWorkspaceCursorError();
    }
    return {
      sortBy: "achievementPercent",
      sortDirection: input.sortDirection,
      achievementPercent: payload.lastAchievementPercent as number | null,
      achievementNullRank: payload.lastAchievementNullRank,
      planId: payload.lastPlanId,
    };
  }
  throw invalidActualWorkspaceCursorError();
}

function decodeActualWorkspaceCursorPayload(
  cursor: string,
): Record<string, unknown> {
  const normalized = cursor.trim();
  if (!normalized) {
    throw invalidActualWorkspaceCursorError();
  }

  let decodedText: string;
  try {
    decodedText = Buffer.from(normalized, "base64url").toString("utf8");
  } catch {
    throw invalidActualWorkspaceCursorError();
  }

  let payload: unknown;
  try {
    payload = JSON.parse(decodedText);
  } catch {
    throw invalidActualWorkspaceCursorError();
  }

  if (!isRecord(payload)) {
    throw invalidActualWorkspaceCursorError();
  }
  return payload;
}

function buildActualWorkspaceCursorQueryKey(
  input: Pick<
    NormalizedActualWorkspacePlansInput,
    | "periodMonth"
    | "groupId"
    | "subjectId"
    | "search"
    | "sortBy"
    | "sortDirection"
    | "allocationCoverage"
    | "hasOverdueActuals"
    | "hasPendingActuals"
  > & { readonly authorityScopeKey?: string },
): string {
  return JSON.stringify({
    authorityScopeKey: input.authorityScopeKey ?? null,
    periodMonth: input.periodMonth ?? null,
    groupId: input.groupId ?? null,
    subjectId: input.subjectId ?? null,
    search: input.search ?? null,
    sortBy: input.sortBy,
    sortDirection: input.sortDirection,
    allocationCoverage: input.allocationCoverage ?? null,
    hasOverdueActuals: input.hasOverdueActuals ?? null,
    hasPendingActuals: input.hasPendingActuals ?? null,
  });
}

function invalidActualWorkspaceCursorError(): KpiValidationError {
  return new KpiValidationError("KPI actual workspace cursor is invalid");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildAllocationWorkflowSummaries(
  counts: readonly KpiAllocationStatusCount[],
): Map<string, KpiAllocationWorkflowSummary> {
  const summaries = new Map<string, KpiAllocationWorkflowSummary>();

  for (const count of counts) {
    const current =
      summaries.get(count.kpiPlanId) ?? createZeroAllocationWorkflowSummary();
    const key = allocationWorkflowSummaryStatusKey(count.allocationStatus);
    const byStatus = {
      ...current.byStatus,
      [key]: current.byStatus[key] + count.count,
    };
    summaries.set(count.kpiPlanId, createAllocationWorkflowSummary(byStatus));
  }

  return summaries;
}

function createZeroAllocationWorkflowSummary(): KpiAllocationWorkflowSummary {
  return createAllocationWorkflowSummary({
    draft: 0,
    pendingApproval: 0,
    approved: 0,
    published: 0,
    rejected: 0,
    active: 0,
    closed: 0,
    cancelled: 0,
  });
}

function createAllocationWorkflowSummary(
  byStatus: KpiAllocationWorkflowSummary["byStatus"],
): KpiAllocationWorkflowSummary {
  return {
    total:
      byStatus.draft +
      byStatus.pendingApproval +
      byStatus.approved +
      byStatus.published +
      byStatus.rejected +
      byStatus.active +
      byStatus.closed +
      byStatus.cancelled,
    byStatus,
    hasDraft: byStatus.draft > 0,
    hasPendingApproval: byStatus.pendingApproval > 0,
    hasApproved: byStatus.approved > 0,
    hasPublished: byStatus.published > 0,
    hasRejected: byStatus.rejected > 0,
    hasLegacyActive: byStatus.active > 0,
    officialPublishedCount: byStatus.published,
  };
}

function allocationWorkflowSummaryStatusKey(
  status: KpiAllocationStatus,
): keyof KpiAllocationWorkflowSummary["byStatus"] {
  switch (status) {
    case "DRAFT":
      return "draft";
    case "PENDING_APPROVAL":
      return "pendingApproval";
    case "APPROVED":
      return "approved";
    case "PUBLISHED":
      return "published";
    case "REJECTED":
      return "rejected";
    case "ACTIVE":
      return "active";
    case "CLOSED":
      return "closed";
    case "CANCELLED":
      return "cancelled";
  }
  const exhaustive: never = status;
  return exhaustive;
}

function normalizePlanStatus(value: unknown): KpiPlanStatus {
  const text = normalizeRequiredText(value, "status");
  if (!KPI_PLAN_STATUSES.includes(text as KpiPlanStatus)) {
    throw new KpiValidationError(`KPI status is unsupported: ${text}`);
  }
  return text as KpiPlanStatus;
}

function normalizeAllocationStatus(value: unknown): KpiAllocationStatus {
  const text = normalizeRequiredText(value, "allocationStatus");
  if (!KPI_ALLOCATION_STATUSES.includes(text as KpiAllocationStatus)) {
    throw new KpiValidationError(
      `KPI allocationStatus is unsupported: ${text}`,
    );
  }
  return text as KpiAllocationStatus;
}

function isOfficialKpiAllocation(allocation: KpiAllocation): boolean {
  return allocation.allocationStatus === "PUBLISHED";
}

function normalizeSortBy(
  value: unknown,
): "periodMonth" | "planCode" | "createdAt" {
  const text = normalizeRequiredText(value, "sortBy");
  if (!KPI_SORT_FIELDS.includes(text as never)) {
    throw new KpiValidationError(`KPI sortBy is unsupported: ${text}`);
  }
  return text as "periodMonth" | "planCode" | "createdAt";
}

function normalizeActualWorkspaceSortBy(
  value: unknown,
): "periodMonth" | "planCode" | KpiActualWorkspaceDerivedSortBy {
  const text = normalizeRequiredText(value, "sortBy");
  if (
    text !== "periodMonth" &&
    text !== "planCode" &&
    text !== "revenueActual" &&
    text !== "achievementPercent"
  ) {
    throw new KpiValidationError(
      `KPI actual workspace sortBy is unsupported: ${text}`,
    );
  }
  return text;
}

function normalizeActualWorkspaceCoverageFilter(
  value: unknown,
): KpiActualWorkspaceCoverageFilter {
  const text = normalizeRequiredText(value, "allocationCoverage");
  if (text !== "complete" && text !== "incomplete") {
    throw new KpiValidationError(
      `KPI actual workspace allocationCoverage is unsupported: ${text}`,
    );
  }
  return text;
}

function normalizeActualWorkspaceBooleanFilter(
  value: unknown,
  field: "hasOverdueActuals" | "hasPendingActuals",
): boolean {
  if (value === true || value === "true") {
    return true;
  }
  if (value === false || value === "false") {
    return false;
  }
  throw new KpiValidationError(
    `KPI actual workspace ${field} must be true or false`,
  );
}

function hasActualWorkspaceStatusFilters(
  input: Pick<
    NormalizedActualWorkspacePlansInput,
    "hasOverdueActuals" | "hasPendingActuals"
  >,
): boolean {
  return (
    input.hasOverdueActuals !== undefined ||
    input.hasPendingActuals !== undefined
  );
}

function matchesActualWorkspaceStatusFilters(
  summary: KpiActualEntryStatusSummary,
  input: Pick<
    NormalizedActualWorkspacePlansInput,
    "hasOverdueActuals" | "hasPendingActuals"
  >,
): boolean {
  return (
    (input.hasOverdueActuals === undefined ||
      input.hasOverdueActuals === summary.overdueEntryCount > 0) &&
    (input.hasPendingActuals === undefined ||
      input.hasPendingActuals === summary.pendingEntryCount > 0)
  );
}

function normalizeSortDirection(value: unknown): "ASC" | "DESC" {
  const text = normalizeRequiredText(value, "sortDirection").toUpperCase();
  if (!KPI_SORT_DIRECTIONS.includes(text as never)) {
    throw new KpiValidationError(`KPI sortDirection is unsupported: ${text}`);
  }
  return text as "ASC" | "DESC";
}

function normalizeCurrency(value: unknown): "VND" {
  const text = normalizeRequiredText(value, "currencyCode");
  if (!KPI_PLAN_CURRENCIES.includes(text as never)) {
    throw new KpiValidationError("KPI currencyCode supports only VND");
  }
  return "VND";
}

function validateTargetMetricValues(
  targetMetrics: readonly Pick<KpiTargetMetric, "metricCode" | "targetValue">[],
  field: string,
): void {
  targetMetrics.forEach((metric, index) => {
    normalizeTargetValue(
      metric.targetValue,
      metric.metricCode,
      `${field}[${index}].targetValue`,
    );
  });
}

function normalizeTargetValue(
  value: unknown,
  metricCode: KpiMetricCode,
  field: string,
): number {
  return normalizeMetricValue(value, metricCode, field, "target");
}

function normalizeMetricValue(
  value: unknown,
  metricCode: KpiMetricCode,
  field: string,
  valueKind = "actual",
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new KpiValidationError(
      `KPI ${metricCode} requires a finite non-negative numeric ${valueKind} value at ${field}.`,
    );
  }
  if (INTEGER_TARGET_METRIC_CODES.has(metricCode) && !Number.isInteger(value)) {
    throw new KpiValidationError(
      `${metricCode} requires an integer ${valueKind} value.`,
    );
  }
  if (metricCode === "LIVE_HOURS" && !hasAtMostDecimalPlaces(value, 2)) {
    throw new KpiValidationError(
      "LIVE_HOURS supports at most 2 decimal places.",
    );
  }
  return value;
}

function createDefaultActualPolicySnapshot(
  snapshottedAt: number,
): KpiActualPolicySnapshot {
  return {
    timezone: DEFAULT_TIMEZONE,
    entryOpenLocalTime: DEFAULT_ACTUAL_ENTRY_OPEN_LOCAL_TIME,
    entryLockLocalTime: DEFAULT_ACTUAL_ENTRY_LOCK_LOCAL_TIME,
    maxDirectEditsPerEntry: DEFAULT_MAX_DIRECT_EDITS_PER_ENTRY,
    correctionAllowedUntil: "PLAN_FINALIZED",
    policyVersion: DEFAULT_ACTUAL_POLICY_VERSION,
    policySource: "DEFAULT",
    snapshottedAt,
  };
}

function requireActualPolicySnapshot(plan: KpiPlan): KpiActualPolicySnapshot {
  if (!plan.actualPolicySnapshot) {
    throw new KpiStateError(
      `KPI plan ${plan.id} has no actual policy snapshot`,
    );
  }
  return effectiveActualPolicySnapshot(plan.actualPolicySnapshot);
}

function effectiveActualPolicySnapshot(
  policy: KpiActualPolicySnapshot,
): KpiActualPolicySnapshot {
  return {
    ...policy,
    entryOpenLocalTime: DEFAULT_ACTUAL_ENTRY_OPEN_LOCAL_TIME,
    entryLockLocalTime: DEFAULT_ACTUAL_ENTRY_LOCK_LOCAL_TIME,
    policyVersion: DEFAULT_ACTUAL_POLICY_VERSION,
  };
}

function assertActualDateWithinPlan(plan: KpiPlan, actualDate: string): void {
  const start = localDateTimeToUtcMs(actualDate, "00:00");
  const end = localDateTimeToUtcMs(actualDate, "23:59") + 59_999;
  if (start < plan.periodStartAt || end > plan.periodEndAt) {
    throw new KpiValidationError(
      `KPI actualDate ${actualDate} is outside plan period ${plan.periodMonth}`,
    );
  }
}

function assertDirectEditWindowOpen(
  policy: KpiActualPolicySnapshot,
  actualDate: string,
  now: number,
): void {
  if (isDirectEditWindowOpen(policy, actualDate, now)) {
    return;
  }
  throw new KpiStateError(
    "KPI actual direct edit window is closed; correction is required",
  );
}

function assertCorrectionWindowOpen(
  policy: KpiActualPolicySnapshot,
  actualDate: string,
  now: number,
): void {
  const directEditWindowEnd = localDateTimeToUtcMs(
    actualDate,
    policy.entryLockLocalTime,
    1,
  );
  if (now > directEditWindowEnd) {
    return;
  }
  throw new KpiStateError(
    "KPI actual correction is allowed only after the direct edit window closes; use direct edit before cutoff",
  );
}

function isDirectEditWindowOpen(
  policy: KpiActualPolicySnapshot,
  actualDate: string,
  now: number,
): boolean {
  const windowStart = localDateTimeToUtcMs(
    actualDate,
    policy.entryOpenLocalTime,
  );
  const windowEnd = localDateTimeToUtcMs(
    actualDate,
    policy.entryLockLocalTime,
    1,
  );
  return now >= windowStart && now <= windowEnd;
}

function resolveDailyGridEditability(
  plan: KpiPlan,
  policy: KpiActualPolicySnapshot,
  actualDate: string,
  now: number,
): {
  readonly isDirectEditOpen: boolean;
  readonly isPlanFinalized: boolean;
  readonly disabledReason: string | null;
} {
  if (plan.status === "FINALIZED") {
    return {
      isDirectEditOpen: false,
      isPlanFinalized: true,
      disabledReason: "PLAN_FINALIZED",
    };
  }
  if (plan.status !== "PUBLISHED") {
    return {
      isDirectEditOpen: false,
      isPlanFinalized: false,
      disabledReason: "PLAN_NOT_PUBLISHED",
    };
  }
  const isOpen = isDirectEditWindowOpen(policy, actualDate, now);
  return {
    isDirectEditOpen: isOpen,
    isPlanFinalized: false,
    disabledReason: isOpen ? null : "DIRECT_EDIT_WINDOW_CLOSED",
  };
}

function assertFinalizeEligible(
  plan: KpiPlan,
  policy: KpiActualPolicySnapshot,
  now: number,
): void {
  if (now <= plan.periodEndAt) {
    throw new KpiStateError(
      `KPI plan ${plan.id} cannot finalize before periodEndAt`,
    );
  }
  const lastDate = lastLocalDateOfPeriod(plan.periodMonth);
  const lastLockAt = localDateTimeToUtcMs(
    lastDate,
    policy.entryLockLocalTime,
    1,
  );
  if (now <= lastLockAt) {
    throw new KpiStateError(
      `KPI plan ${plan.id} cannot finalize while a daily edit window remains open`,
    );
  }
}

function localDateTimeToUtcMs(
  dateText: string,
  timeText: string,
  dayOffset = 0,
): number {
  const { day, month, year } = parseActualDateText(dateText, "date");
  const [hourText, minuteText] = timeText.split(":");
  return Date.UTC(
    year,
    month - 1,
    day + dayOffset,
    Number(hourText) - HCM_UTC_OFFSET_HOURS,
    Number(minuteText),
    0,
    0,
  );
}

function lastLocalDateOfPeriod(periodMonth: string): string {
  const [yearText, monthText] = periodMonth.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return `${String(lastDay).padStart(2, "0")}-${monthText}-${yearText}`;
}

function countLocalDaysInPlan(plan: KpiPlan): number {
  const lastDate = lastLocalDateOfPeriod(plan.periodMonth);
  const { day } = parseActualDateText(lastDate, "periodEndDate");
  return day;
}

function calculateProgressPercent(
  actualValue: number,
  targetValue: number,
): number | null {
  if (targetValue === 0) {
    return null;
  }
  return (actualValue / targetValue) * 100;
}

function calculatePeriodElapsedPercent(plan: KpiPlan, now: number): number {
  if (now <= plan.periodStartAt) {
    return 0;
  }
  if (now >= plan.periodEndAt) {
    return 100;
  }
  return (
    ((now - plan.periodStartAt) / (plan.periodEndAt - plan.periodStartAt)) * 100
  );
}

function hasAtMostDecimalPlaces(value: number, decimalPlaces: number): boolean {
  const multiplier = 10 ** decimalPlaces;
  return Math.abs(value * multiplier - Math.round(value * multiplier)) < 1e-9;
}

function normalizeTimestamp(value: unknown, field: string): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value)
  ) {
    throw new KpiValidationError(
      `KPI ${field} must be a UTC millisecond timestamp`,
    );
  }
  return value;
}

function normalizeLimit(value: unknown): number {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_LIST_LIMIT;
  }
  const numeric =
    typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (
    !Number.isFinite(numeric) ||
    !Number.isInteger(numeric) ||
    numeric < 1 ||
    numeric > MAX_LIST_LIMIT
  ) {
    throw new KpiValidationError(
      `KPI limit must be an integer between 1 and ${MAX_LIST_LIMIT}`,
    );
  }
  return numeric;
}

function normalizeRequiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new KpiValidationError(`KPI ${field} is required`);
  }
  return value.trim();
}

function normalizeOptionalText(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  return normalizeRequiredText(value, "query");
}

function normalizeOptionalSearch(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  return normalizeSearchToken(value);
}

function normalizeNullableText(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return normalizeRequiredText(value, "nullableText");
}

function normalizeSearchToken(value: unknown): string {
  return normalizeRequiredText(value, "searchToken").toLocaleLowerCase("en-US");
}

function normalizeDateText(value: unknown, field: string): string {
  const text = normalizeRequiredText(value, field);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new KpiValidationError(`KPI ${field} must use YYYY-MM-DD format`);
  }
  return text;
}

function normalizeActualDateText(value: unknown, field: string): string {
  const text = normalizeRequiredText(value, field);
  parseActualDateText(text, field);
  return text;
}

function parseActualDateText(
  text: string,
  field: string,
): { readonly day: number; readonly month: number; readonly year: number } {
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(text);
  if (!match) {
    throw new KpiValidationError(`KPI ${field} must use DD-MM-YYYY format`);
  }
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (month < 1 || month > 12) {
    throw new KpiValidationError(`KPI ${field} must be a valid calendar date`);
  }
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > lastDay) {
    throw new KpiValidationError(`KPI ${field} must be a valid calendar date`);
  }
  const roundTrip = new Date(Date.UTC(year, month - 1, day));
  if (
    roundTrip.getUTCFullYear() !== year ||
    roundTrip.getUTCMonth() !== month - 1 ||
    roundTrip.getUTCDate() !== day
  ) {
    throw new KpiValidationError(`KPI ${field} must be a valid calendar date`);
  }
  return { day, month, year };
}

function normalizeNullableDateText(
  value: unknown,
  field: string,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return normalizeDateText(value, field);
}

function numbersEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= 1e-9;
}

function requirePlainRecord(
  value: unknown,
  field: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new KpiValidationError(`KPI ${field} must be a plain object`);
  }
  return value as Record<string, unknown>;
}

function assertOnlyFields(
  value: Record<string, unknown>,
  allowedFields: readonly string[],
  field: string,
): void {
  const unexpected = Object.keys(value).filter(
    (key) => !allowedFields.includes(key),
  );
  if (unexpected.length > 0) {
    throw new KpiValidationError(
      `KPI ${field} contains unsupported field(s): ${unexpected.join(", ")}`,
    );
  }
}

function listDefinedFields<T extends object>(
  input: T,
  fields: readonly (keyof T & string)[],
): readonly string[] {
  return fields.filter((field) => input[field] !== undefined);
}
