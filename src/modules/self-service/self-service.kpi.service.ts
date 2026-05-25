import { Actor } from "@core/actor/actor";
import { EmploymentProfileRepository } from "@modules/employment-profile/domain/employment-profile.repository";
import { KpiActualRepository } from "@modules/kpi/domain/kpi-actual.repository";
import { getKpiMetricCatalogEntry } from "@modules/kpi/domain/kpi-metric-catalog";
import { KpiPlanRepository } from "@modules/kpi/domain/kpi.repository";
import {
  KpiActualEntry,
  KpiAllocation,
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

    const items = await Promise.all(
      allocations.map((allocation) => this.toSelfServiceKpiItem(allocation)),
    );

    return {
      items: items
        .filter((item): item is SelfServiceKpiItemView => item !== null)
        .sort(compareSelfServiceKpiItems),
    };
  }

  private async toSelfServiceKpiItem(
    allocation: KpiAllocation,
  ): Promise<SelfServiceKpiItemView | null> {
    const plan = await this.kpiPlanRepository.findPlanById(
      allocation.kpiPlanId,
    );

    if (!plan || plan.status === "ARCHIVED") {
      return null;
    }

    const entries = await this.kpiActualRepository.listEntriesByPlanId(plan.id);
    const entriesForAllocation = entries.filter(
      (entry) =>
        entry.allocationId === allocation.id &&
        entry.memberTalentId === allocation.memberTalentId,
    );

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
