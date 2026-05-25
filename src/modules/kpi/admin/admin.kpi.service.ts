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
import { KPI_PLAN_CODE_POLICY } from "@modules/kpi/domain/kpi-code-policy";
import { getKpiMetricCatalogEntry } from "@modules/kpi/domain/kpi-metric-catalog";
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
  KpiPlanRepository,
  ListKpiPlansInput,
} from "@modules/kpi/domain/kpi.repository";
import { KpiActualRepository } from "@modules/kpi/domain/kpi-actual.repository";
import { KpiSubjectReadonlyAccess } from "@modules/kpi/domain/kpi-subject-readonly-access";
import { TalentGroupManagerAssignmentRepository } from "@modules/kpi/domain/talent-group-manager-assignment.repository";
import {
  KPI_EXECUTABLE_SUBJECT_TYPES,
  KPI_METRIC_CODES,
  KPI_PLAN_CURRENCIES,
  KPI_PLAN_STATUSES,
  KPI_SORT_DIRECTIONS,
  KPI_SORT_FIELDS,
  KPI_SUBJECT_TYPES,
  KpiAllocation,
  KPI_ALLOCATION_STATUSES,
  KpiAllocationStatus,
  KpiActualDailyGridView,
  KpiAllocationTargetMetric,
  KpiActualCorrection,
  KpiActualEntry,
  KpiActualPolicySnapshot,
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
  GetKpiPlanDetailQuery,
  GetKpiActualDailyGridQuery,
  GetKpiProgressQuery,
  ListKpiActualCorrectionsQuery,
  GetMyKpiProgressQuery,
  KpiActualCorrectionResult,
  KpiActualMutationResult,
  KpiAllocationInput,
  ListKpiAllocationsQuery,
  ListKpiAllocationsResult,
  UpsertKpiAllocationDraftCommand,
  SubmitKpiAllocationDraftCommand,
  ApproveKpiAllocationCommand,
  RejectKpiAllocationCommand,
  PublishKpiAllocationCommand,
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
const HCM_UTC_OFFSET_HOURS = 7;
const DEFAULT_ACTUAL_POLICY_VERSION = "kpi-actual-policy-v1";
const DEFAULT_ACTUAL_ENTRY_OPEN_LOCAL_TIME = "06:00";
const DEFAULT_ACTUAL_ENTRY_LOCK_LOCAL_TIME = "23:00";
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

    assertExecutableSubjectType(subjectType);

    const targetMetrics = normalizeTargetMetrics(
      command.targetMetrics,
      subjectType,
      command.currencyCode ?? "VND",
    );
    const allocations = command.allocations
      ? normalizeAllocations(command.allocations, targetMetrics)
      : [];

    return this.executeMutation(
      actor,
      permission,
      operation,
      `kpi-plan:create:${command.subjectType}:${command.subjectId}`,
      async (session) => {
        await this.assertSubjectExecutable(
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
        const allocationRecords = await this.buildAllocationRecords(
          plan,
          allocations,
          metricRecords,
          now,
          session,
        );

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

        return this.toDetailView(plan, metricRecords, allocationRecords);
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
      return { items };
    }

    if (!this.hasKpiManagedGroupScope(actor)) {
      throw new KpiPermissionScopeError(
        "Cannot list KPI plans: kpi.global or kpi.managedGroup scope is required",
      );
    }

    return this.listManagedGroupKpiPlans(actor, input);
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
      query.status === undefined ? undefined : normalizeAllocationStatus(query.status);
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
          existing.some(
            (allocation) => allocation.allocationStatus !== "DRAFT",
          )
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
          metadata: { nextStatus: "PENDING_APPROVAL", allocationCount: modified },
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
      approvalNote:
        normalizeNullableText(command.approvalNote) ?? null,
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

        assertDirectEditWindowOpen(policy, actualDate, this.clock());

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
        this.assertActualMutationPlanOpen(plan, "update actual");
        const policy = requireActualPolicySnapshot(plan);
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
        this.assertActualMutationPlanOpen(plan, "correct actual");
        requireActualPolicySnapshot(plan);
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
        if (current.status !== "PUBLISHED") {
          throw new KpiStateError(
            `KPI plan ${current.id} must be PUBLISHED before finalize`,
          );
        }
        const policy = requireActualPolicySnapshot(current);
        assertFinalizeEligible(current, policy, this.clock());

        const now = this.clock();
        const finalized = await this.repository.transitionStatus(
          {
            kpiPlanId: current.id,
            fromStatuses: ["PUBLISHED"],
            toStatus: "FINALIZED",
            finalizedAt: now,
            finalizedByActorId: actor.id,
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
    const actorTalent = await this.resolveActorTalentId(actor);
    if (!actorTalent) {
      throw new KpiPermissionScopeError(
        "KPI progress self-view requires actor-to-talent mapping",
      );
    }
    const plan = await this.requirePlan(query.kpiPlanId);
    return this.buildProgressView(plan, new Set([actorTalent]));
  }

  async getKpiActualDailyGrid(
    actor: Actor,
    query: GetKpiActualDailyGridQuery,
  ): Promise<KpiActualDailyGridView> {
    this.assertContextPermission(actor, Permission.KPI_READ_PROGRESS);
    const plan = await this.requirePlan(query.kpiPlanId);
    const actualDate = normalizeActualDateText(query.actualDate, "actualDate");
    assertActualDateWithinPlan(plan, actualDate);
    await this.assertActorCanReadActualGrid(actor, plan);
    return this.buildActualDailyGridView(plan, actualDate);
  }

  async listKpiActualCorrections(
    actor: Actor,
    query: ListKpiActualCorrectionsQuery,
  ): Promise<ListKpiActualCorrectionsResult> {
    this.assertContextPermission(actor, Permission.KPI_READ_PROGRESS);
    const plan = await this.requirePlan(query.kpiPlanId);
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

  private async assertActorCanManageAllocationActual(
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
        "KPI actual entry requires kpi.global or kpi.managedGroup scope",
      );
    }
    if (actor.type !== "staff") {
      throw new KpiPermissionScopeError(
        "KPI actual entry requires admin or assigned talent-group manager authority",
      );
    }
    if (plan.subjectType !== "TALENT_GROUP") {
      throw new KpiPermissionScopeError(
        "KPI manager-scoped actual entry is supported only for TALENT_GROUP plans",
      );
    }
    const employmentProfile =
      await this.subjectReadonlyAccess.findActiveEmploymentProfileByLinkedUserId(
        actor.id,
        session,
      );
    if (!employmentProfile) {
      throw new KpiPermissionScopeError(
        "KPI manager-scoped actual entry requires actor-to-employment-profile mapping",
      );
    }
    const assignments =
      await this.managerAssignmentRepository.listActiveAssignmentsByManagerEmploymentProfile(
        employmentProfile.employmentProfileId,
        this.clock(),
        session,
      );
    if (
      assignments.some(
        (assignment) => assignment.groupId === allocation.groupId,
      )
    ) {
      return;
    }
    throw new KpiPermissionScopeError(
      `KPI actor is not an active manager for group ${allocation.groupId}`,
    );
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
    if (actor.type !== "staff") {
      if (!hasSelfScope) {
        throw new KpiPermissionScopeError("KPI progress read scope denied");
      }
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
    if (hasManagedGroupScope && plan.subjectType === "TALENT_GROUP") {
      const assignments =
        await this.managerAssignmentRepository.listActiveAssignmentsByManagerEmploymentProfile(
          employmentProfile.employmentProfileId,
          this.clock(),
        );
      if (
        assignments.some((assignment) => assignment.groupId === plan.subjectId)
      ) {
        return undefined;
      }
    }
    if (!hasSelfScope) {
      throw new KpiPermissionScopeError("KPI progress read scope denied");
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
    if (actor.type !== "staff") {
      throw new KpiPermissionScopeError(
        "KPI actual grid read requires admin or assigned talent-group manager authority",
      );
    }
    if (plan.subjectType !== "TALENT_GROUP") {
      throw new KpiPermissionScopeError(
        "KPI manager-scoped actual grid read is supported only for TALENT_GROUP plans",
      );
    }
    const employmentProfile =
      await this.subjectReadonlyAccess.findActiveEmploymentProfileByLinkedUserId(
        actor.id,
      );
    if (!employmentProfile) {
      throw new KpiPermissionScopeError(
        "KPI actual grid read requires actor-to-employment-profile mapping",
      );
    }
    const assignments =
      await this.managerAssignmentRepository.listActiveAssignmentsByManagerEmploymentProfile(
        employmentProfile.employmentProfileId,
        this.clock(),
      );
    if (
      assignments.some((assignment) => assignment.groupId === plan.subjectId)
    ) {
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
    if (actor.type !== "staff") {
      throw new KpiPermissionScopeError(
        "KPI correction history read requires admin or assigned talent-group manager authority",
      );
    }
    if (plan.subjectType !== "TALENT_GROUP") {
      throw new KpiPermissionScopeError(
        "KPI manager-scoped correction history read is supported only for TALENT_GROUP plans",
      );
    }
    const allocations = await this.repository.listAllocationsByPlanId(plan.id);
    const allocation = allocations.find(
      (item) => item.id === entry.allocationId,
    );
    if (!allocation) {
      throw new KpiInvalidAllocationError(
        `KPI actual entry allocation is missing: ${entry.allocationId}`,
      );
    }
    await this.assertActorCanManageAllocationActual(actor, plan, allocation);
  }

  private async buildActualDailyGridView(
    plan: KpiPlan,
    actualDate: string,
  ): Promise<KpiActualDailyGridView> {
    const [targetMetrics, allocations, entries] = await Promise.all([
      this.repository.listTargetMetricsByPlanId(plan.id),
      this.repository.listAllocationsByPlanId(plan.id),
      this.actualRepository.listEntriesByPlanIdAndActualDate(
        plan.id,
        actualDate,
      ),
    ]);
    const policy =
      plan.actualPolicySnapshot ??
      createDefaultActualPolicySnapshot(plan.createdAt);
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
          const entryEditLimitReached =
            entry !== undefined &&
            entry.editCount >= policy.maxDirectEditsPerEntry;
          const disabledReason =
            editability.disabledReason ??
            (entryEditLimitReached ? "DIRECT_EDIT_LIMIT_REACHED" : null);
          const canDirectEdit =
            editability.isDirectEditOpen && !entryEditLimitReached;
          return {
            metricCode: metric.metricCode,
            targetValue: metric.targetValue,
            actualEntryId: entry?.id ?? null,
            actualValue: entry?.actualValue ?? null,
            effectiveValue: entry?.effectiveValue ?? 0,
            hasEntry: entry !== undefined,
            editCount: entry?.editCount ?? 0,
            correctionCount: entry?.correctionCount ?? 0,
            latestCorrectionId: entry?.latestCorrectionId ?? null,
            canDirectEdit,
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
        allowedTalentIds !== undefined &&
        !allowedTalentIds.has(entry.memberTalentId)
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
        }),
      ),
    );
    const itemsById = new Map<string, KpiPlanListItemView>();
    for (const item of perGroupResults.flat()) {
      itemsById.set(item.id, item);
    }

    return {
      items: Array.from(itemsById.values())
        .sort((left, right) => compareKpiPlanListItems(left, right, input))
        .slice(0, input.limit),
    };
  }

  private async resolveManagedTalentGroupIds(
    actor: Actor,
  ): Promise<readonly string[]> {
    const groupIds = await resolveManagedTalentGroupIds(
      actor,
      {
        subjectReadonlyAccess: this.subjectReadonlyAccess,
        managerAssignmentRepository: this.managerAssignmentRepository,
      },
      this.clock(),
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
    const [targetMetrics, allocations] = await Promise.all([
      this.repository.listTargetMetricsByPlanId(plan.id, session),
      this.repository.listAllocationsByPlanId(plan.id, session),
    ]);
    return this.toDetailView(plan, targetMetrics, allocations);
  }

  private toDetailView(
    plan: KpiPlan,
    targetMetrics: readonly KpiTargetMetric[],
    allocations: readonly KpiAllocation[],
  ): KpiPlanDetailView {
    return {
      ...plan,
      targetMetrics,
      allocations,
    };
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

  private async assertSubjectExecutable(
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

    throw new KpiValidationError(
      `KPI subjectType ${subjectType} is not executable in Phase 4-C.2`,
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
    session: ClientSession,
  ): Promise<void> {
    if (actor.type !== "staff") {
      throw new KpiPermissionScopeError(
        "KPI allocation draft requires assigned team-manager staff authority",
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
    const employmentProfile =
      await this.subjectReadonlyAccess.findActiveEmploymentProfileByLinkedUserId(
        actor.id,
        session,
      );
    if (!employmentProfile) {
      throw new KpiPermissionScopeError(
        "KPI allocation draft requires actor-to-employment-profile mapping",
      );
    }
    const assignments =
      await this.managerAssignmentRepository.listActiveAssignmentsByManagerEmploymentProfile(
        employmentProfile.employmentProfileId,
        this.clock(),
        session,
      );
    if (assignments.some((assignment) => assignment.groupId === plan.subjectId)) {
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
    `KPI subjectType ${subjectType} is future-compatible but not executable in Phase 4-C.2`,
  );
}

function compareKpiPlanListItems(
  left: KpiPlanListItemView,
  right: KpiPlanListItemView,
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
  return plan.actualPolicySnapshot;
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

function isDirectEditWindowOpen(
  policy: KpiActualPolicySnapshot,
  actualDate: string,
  now: number,
): boolean {
  const windowStart = localDateTimeToUtcMs(
    actualDate,
    policy.entryOpenLocalTime,
  );
  const windowEnd = localDateTimeToUtcMs(actualDate, policy.entryLockLocalTime);
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
  const lastLockAt = localDateTimeToUtcMs(lastDate, policy.entryLockLocalTime);
  if (now <= lastLockAt) {
    throw new KpiStateError(
      `KPI plan ${plan.id} cannot finalize while a daily edit window remains open`,
    );
  }
}

function localDateTimeToUtcMs(dateText: string, timeText: string): number {
  const { day, month, year } = parseActualDateText(dateText, "date");
  const [hourText, minuteText] = timeText.split(":");
  return Date.UTC(
    year,
    month - 1,
    day,
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
