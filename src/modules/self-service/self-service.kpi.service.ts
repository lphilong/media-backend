import { Actor } from "@core/actor/actor";
import { EmploymentProfileRepository } from "@modules/employment-profile/domain/employment-profile.repository";
import { KpiActualRepository } from "@modules/kpi/domain/kpi-actual.repository";
import { getKpiMetricCatalogEntry } from "@modules/kpi/domain/kpi-metric-catalog";
import { KpiPlanRepository } from "@modules/kpi/domain/kpi.repository";
import {
  KpiActualEntry,
  KpiAllocation,
  KpiPlan,
} from "@modules/kpi/domain/kpi.types";
import { SelfServiceCurrentPersonNotLinkedError } from "@modules/self-service/domain/self-service.errors";
import {
  SelfServiceKpiItemView,
  SelfServiceKpiListView,
} from "@modules/self-service/domain/self-service.types";
import { TalentRepository } from "@modules/talent/domain/talent.repository";

const MAX_SELF_SERVICE_KPI_ALLOCATIONS = 100;

export class SelfServiceKpiService {
  constructor(
    private readonly employmentProfileRepository: EmploymentProfileRepository,
    private readonly talentRepository: TalentRepository,
    private readonly kpiPlanRepository: KpiPlanRepository,
    private readonly kpiActualRepository: KpiActualRepository,
    private readonly clock: () => number = Date.now,
  ) {}

  async listCurrentKpi(actor: Actor): Promise<SelfServiceKpiListView> {
    const employmentProfile =
      await this.employmentProfileRepository.findNonArchivedByLinkedUserId(
        actor.id,
      );

    if (!employmentProfile) {
      throw new SelfServiceCurrentPersonNotLinkedError();
    }

    const linkedTalent =
      await this.talentRepository.findNonArchivedByLinkedEmploymentProfileId(
        employmentProfile.id,
      );

    if (
      !linkedTalent ||
      linkedTalent.talentOrigin !== "INTERNAL" ||
      linkedTalent.linkedEmploymentProfileId !== employmentProfile.id
    ) {
      return { items: [] };
    }

    const allocations = (
      await this.kpiPlanRepository.listAllocations({
        status: "PUBLISHED",
        memberTalentId: linkedTalent.id,
        memberEmploymentProfileId: employmentProfile.id,
        limit: MAX_SELF_SERVICE_KPI_ALLOCATIONS,
      })
    ).filter(
      (allocation) =>
        allocation.allocationStatus === "PUBLISHED" &&
        allocation.memberTalentId === linkedTalent.id &&
        allocation.memberEmploymentProfileId === employmentProfile.id,
    );

    const planIds = uniqueNonEmpty(
      allocations.map((allocation) => allocation.kpiPlanId),
    );
    const plans = await this.kpiPlanRepository.listPlansByIds(planIds);
    const now = this.clock();
    const currentPublishedPlans = plans.filter(
      (plan) =>
        plan.status === "PUBLISHED" &&
        plan.periodStartAt <= now &&
        plan.periodEndAt >= now,
    );
    const currentPublishedPlanIds = new Set(
      currentPublishedPlans.map((plan) => plan.id),
    );
    const currentAllocations = allocations.filter((allocation) =>
      currentPublishedPlanIds.has(allocation.kpiPlanId),
    );
    const entries = await this.kpiActualRepository.listEntriesByPlanIds(
      [...currentPublishedPlanIds],
    );
    const entriesByAllocation = groupEntriesByAllocation(entries);
    const planById = new Map(
      currentPublishedPlans.map((plan) => [plan.id, plan]),
    );

    return {
      items: currentAllocations
        .map((allocation) =>
          toSelfServiceKpiItem(
            allocation,
            planById.get(allocation.kpiPlanId),
            entriesByAllocation.get(allocation.id) ?? [],
          ),
        )
        .filter((item): item is SelfServiceKpiItemView => item !== null)
        .sort(compareSelfServiceKpiItems),
    };
  }
}

function toSelfServiceKpiItem(
  allocation: KpiAllocation,
  plan: KpiPlan | undefined,
  entriesForAllocation: readonly KpiActualEntry[],
): SelfServiceKpiItemView | null {
  if (!plan) {
    return null;
  }

  return buildSelfServiceKpiItem(allocation, plan, entriesForAllocation);
}

function buildSelfServiceKpiItem(
  allocation: KpiAllocation,
  plan: KpiPlan,
  entriesForAllocation: readonly KpiActualEntry[],
): SelfServiceKpiItemView {
  return {
    kpiPlanId: plan.id,
    title: plan.title,
    periodMonth: plan.periodMonth,
    periodStartAt: plan.periodStartAt,
    periodEndAt: plan.periodEndAt,
    officialStatus: "OFFICIAL_PUBLISHED",
    lastUpdatedAt: resolveLastUpdatedAt(allocation, entriesForAllocation),
    metrics: allocation.targetMetrics.map((metric) => {
      const actualValue = entriesForAllocation
        .filter((entry) => entry.metricCode === metric.metricCode)
        .reduce((sum, entry) => sum + entry.effectiveValue, 0);
      const catalog = getKpiMetricCatalogEntry(metric.metricCode);

      return {
        metricCode: metric.metricCode,
        unit: catalog.unit,
        targetValue: metric.targetValue,
        actualValue,
        progressPercent: calculateProgressPercent(
          actualValue,
          metric.targetValue,
        ),
      };
    }),
  };
}

function groupEntriesByAllocation(
  entries: readonly KpiActualEntry[],
): Map<string, KpiActualEntry[]> {
  const map = new Map<string, KpiActualEntry[]>();

  for (const entry of entries) {
    const current = map.get(entry.allocationId) ?? [];
    current.push(entry);
    map.set(entry.allocationId, current);
  }

  return map;
}

function uniqueNonEmpty(values: readonly string[]): readonly string[] {
  return [
    ...new Set(
      values
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  ];
}

function resolveLastUpdatedAt(
  allocation: KpiAllocation,
  entries: readonly Pick<KpiActualEntry, "updatedAt">[],
): number {
  return Math.max(
    allocation.updatedAt,
    allocation.publishedAt ?? 0,
    ...entries.map((entry) => entry.updatedAt),
  );
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

function compareSelfServiceKpiItems(
  left: SelfServiceKpiItemView,
  right: SelfServiceKpiItemView,
): number {
  return (
    right.periodMonth.localeCompare(left.periodMonth) ||
    left.title.localeCompare(right.title) ||
    left.kpiPlanId.localeCompare(right.kpiPlanId)
  );
}
