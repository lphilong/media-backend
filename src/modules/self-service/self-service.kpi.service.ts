import { Actor } from "@core/actor/actor";
import { KpiActualRepository } from "@modules/kpi/domain/kpi-actual.repository";
import { getKpiMetricCatalogEntry } from "@modules/kpi/domain/kpi-metric-catalog";
import { KpiPlanRepository } from "@modules/kpi/domain/kpi.repository";
import {
  KpiActualEntry,
  KpiActualEntryStatusSummary,
  KpiActualSlotExcuse,
  KpiAllocation,
  KpiDailyActualStatus,
  KpiMetricCode,
  KpiPlan,
} from "@modules/kpi/domain/kpi.types";
import {
  SelfServiceKpiItemView,
  SelfServiceKpiListView,
} from "@modules/self-service/domain/self-service.types";
import { SelfServiceIdentityResolver } from "@modules/self-service/shared/self-service.identity-resolver";

const MAX_SELF_SERVICE_KPI_ALLOCATIONS = 100;
const MAX_SELF_SERVICE_KPI_HISTORY_ITEMS = 12;
const HCM_UTC_OFFSET_HOURS = 7;
const DEFAULT_ACTUAL_ENTRY_LOCK_LOCAL_TIME = "10:00";

export class SelfServiceKpiService {
  constructor(
    private readonly identityResolver: SelfServiceIdentityResolver,
    private readonly kpiPlanRepository: KpiPlanRepository,
    private readonly kpiActualRepository: KpiActualRepository,
    private readonly clock: () => number = Date.now,
  ) {}

  async listCurrentKpi(actor: Actor): Promise<SelfServiceKpiListView> {
    const { employmentProfile, linkedInternalTalent } =
      await this.identityResolver.resolveEmploymentProfileWithLinkedInternalTalent(
        actor,
      );

    if (!linkedInternalTalent) {
      return {
        items: [],
        current: null,
        latestPrevious: null,
        history: [],
      };
    }

    const allocations = (
      await this.kpiPlanRepository.listAllocations({
        status: "PUBLISHED",
        memberTalentId: linkedInternalTalent.id,
        memberEmploymentProfileId: employmentProfile.id,
        limit: MAX_SELF_SERVICE_KPI_ALLOCATIONS,
      })
    ).filter(
      (allocation) =>
        allocation.allocationStatus === "PUBLISHED" &&
        allocation.memberTalentId === linkedInternalTalent.id &&
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
    const previousOfficialPlans = plans
      .filter(
        (plan) =>
          isOfficialSelfServiceHistoryPlan(plan) && plan.periodEndAt < now,
      )
      .sort(compareKpiPlansNewestFirst);
    const historyPlans = previousOfficialPlans.slice(
      0,
      MAX_SELF_SERVICE_KPI_HISTORY_ITEMS,
    );
    const currentPlanIds = new Set(currentPublishedPlans.map((plan) => plan.id));
    const historyPlanIds = new Set(historyPlans.map((plan) => plan.id));
    const exposedPlanIds = uniqueNonEmpty(
      [...currentPlanIds, ...historyPlanIds],
    );
    const currentAllocations = allocations.filter((allocation) =>
      currentPlanIds.has(allocation.kpiPlanId),
    );
    const historyAllocations = allocations.filter((allocation) =>
      historyPlanIds.has(allocation.kpiPlanId),
    );
    const [entries, excuses] = await Promise.all([
      this.kpiActualRepository.listEntriesByPlanIds(exposedPlanIds),
      this.kpiPlanRepository.listActualSlotExcusesByPlanIds(exposedPlanIds),
    ]);
    const entriesByAllocation = groupEntriesByAllocation(entries);
    const entriesBySlot = groupEntriesBySlot(entries);
    const excusesBySlot = groupExcusesBySlot(excuses);
    const planById = new Map(plans.map((plan) => [plan.id, plan]));

    const currentItems = currentAllocations
      .map((allocation) =>
        toSelfServiceKpiItem({
          allocation,
          plan: planById.get(allocation.kpiPlanId),
          entriesForAllocation:
            entriesByAllocation.get(allocation.id) ?? [],
          entriesBySlot,
          excusesBySlot,
          now,
        }),
      )
      .filter((item): item is SelfServiceKpiItemView => item !== null)
      .sort(compareSelfServiceKpiItems);
    const historyItems = historyAllocations
      .map((allocation) =>
        toSelfServiceKpiItem({
          allocation,
          plan: planById.get(allocation.kpiPlanId),
          entriesForAllocation: entriesByAllocation.get(allocation.id) ?? [],
          entriesBySlot,
          excusesBySlot,
          now,
        }),
      )
      .filter((item): item is SelfServiceKpiItemView => item !== null)
      .sort(compareSelfServiceKpiItems);

    return {
      items: currentItems,
      current: currentItems[0] ?? null,
      latestPrevious: historyItems[0] ?? null,
      history: historyItems,
    };
  }
}

function toSelfServiceKpiItem(input: {
  readonly allocation: KpiAllocation;
  readonly plan: KpiPlan | undefined;
  readonly entriesForAllocation: readonly KpiActualEntry[];
  readonly entriesBySlot: ReadonlyMap<string, KpiActualEntry>;
  readonly excusesBySlot: ReadonlyMap<string, KpiActualSlotExcuse>;
  readonly now: number;
}): SelfServiceKpiItemView | null {
  const plan = input.plan;
  if (!plan) {
    return null;
  }

  return buildSelfServiceKpiItem({ ...input, plan });
}

function buildSelfServiceKpiItem(input: {
  readonly allocation: KpiAllocation;
  readonly plan: KpiPlan;
  readonly entriesForAllocation: readonly KpiActualEntry[];
  readonly entriesBySlot: ReadonlyMap<string, KpiActualEntry>;
  readonly excusesBySlot: ReadonlyMap<string, KpiActualSlotExcuse>;
  readonly now: number;
}): SelfServiceKpiItemView {
  const { allocation, plan, entriesForAllocation } = input;
  return {
    kpiPlanId: plan.id,
    planCode: plan.planCode,
    title: plan.title,
    periodMonth: plan.periodMonth,
    periodStartAt: plan.periodStartAt,
    periodEndAt: plan.periodEndAt,
    officialStatus:
      plan.status === "FINALIZED" ? "OFFICIAL_FINALIZED" : "OFFICIAL_PUBLISHED",
    isCurrentPeriod:
      plan.status === "PUBLISHED" &&
      plan.periodStartAt <= input.now &&
      plan.periodEndAt >= input.now,
    isPreviousPeriod: plan.periodEndAt < input.now,
    isReadOnly: true,
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
    actualEntryStatusSummary: summarizeActualEntryStatuses(input),
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

function groupEntriesBySlot(
  entries: readonly KpiActualEntry[],
): Map<string, KpiActualEntry> {
  const map = new Map<string, KpiActualEntry>();

  for (const entry of entries) {
    map.set(
      slotKey(entry.allocationId, entry.metricCode, entry.actualDate),
      entry,
    );
  }

  return map;
}

function groupExcusesBySlot(
  excuses: readonly KpiActualSlotExcuse[],
): Map<string, KpiActualSlotExcuse> {
  const map = new Map<string, KpiActualSlotExcuse>();

  for (const excuse of excuses) {
    map.set(
      slotKey(excuse.allocationId, excuse.metricCode, excuse.actualDate),
      excuse,
    );
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

function isOfficialSelfServiceHistoryPlan(plan: KpiPlan): boolean {
  return plan.status === "PUBLISHED" || plan.status === "FINALIZED";
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

type MutableKpiActualEntryStatusSummary = {
  -readonly [Key in keyof KpiActualEntryStatusSummary]: KpiActualEntryStatusSummary[Key];
};

function summarizeActualEntryStatuses(input: {
  readonly allocation: KpiAllocation;
  readonly plan: KpiPlan;
  readonly entriesBySlot: ReadonlyMap<string, KpiActualEntry>;
  readonly excusesBySlot: ReadonlyMap<string, KpiActualSlotExcuse>;
  readonly now: number;
}): KpiActualEntryStatusSummary {
  const summary = createEmptyActualEntryStatusSummary();
  const actualDates = listLocalDatesInPlan(input.plan.periodMonth);
  const targetMetrics = input.allocation.targetMetrics.filter((metric) =>
    isKnownKpiMetricCode(metric.metricCode),
  );

  for (const metric of targetMetrics) {
    for (const actualDate of actualDates) {
      summary.expectedEntryCount += 1;
      const status = resolveDailyActualStatus({
        plan: input.plan,
        allocation: input.allocation,
        actualDate,
        entry: input.entriesBySlot.get(
          slotKey(input.allocation.id, metric.metricCode, actualDate),
        ),
        excuse: input.excusesBySlot.get(
          slotKey(input.allocation.id, metric.metricCode, actualDate),
        ),
        now: input.now,
      });
      applyDailyActualStatus(summary, status);
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

function resolveDailyActualStatus(input: {
  readonly plan: KpiPlan;
  readonly allocation: KpiAllocation;
  readonly actualDate: string;
  readonly entry?: KpiActualEntry;
  readonly excuse?: KpiActualSlotExcuse;
  readonly now: number;
}): KpiDailyActualStatus {
  if (!isOfficialSelfServiceHistoryPlan(input.plan)) {
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

function applyDailyActualStatus(
  summary: MutableKpiActualEntryStatusSummary,
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

function slotKey(
  allocationId: string,
  metricCode: KpiMetricCode,
  actualDate: string,
): string {
  return `${allocationId}:${metricCode}:${actualDate}`;
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

function localDateTimeToUtcMs(
  dateText: string,
  timeText: string,
  dayOffset = 0,
): number {
  const { day, month, year } = parseActualDateText(dateText);
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

function parseActualDateText(dateText: string): {
  readonly day: number;
  readonly month: number;
  readonly year: number;
} {
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(dateText);
  if (!match) {
    return { day: 1, month: 1, year: 1970 };
  }
  return {
    day: Number(match[1]),
    month: Number(match[2]),
    year: Number(match[3]),
  };
}

function isKnownKpiMetricCode(metricCode: string): metricCode is KpiMetricCode {
  return getKpiMetricCatalogEntry(metricCode as KpiMetricCode) !== undefined;
}

function numbersEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= 1e-9;
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

function compareKpiPlansNewestFirst(left: KpiPlan, right: KpiPlan): number {
  return (
    right.periodMonth.localeCompare(left.periodMonth) ||
    left.title.localeCompare(right.title) ||
    left.id.localeCompare(right.id)
  );
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
