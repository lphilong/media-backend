import { ClientSession, Collection, Db } from "mongodb";
import {
  buildGeneratedBusinessCodeRegex,
  BusinessCodePolicy,
  parseGeneratedBusinessCodeSequence,
} from "@core/business-code/business-code-sequence.repository";
import { BaseRepository } from "@infra/database/repository";
import {
  KpiPlanRepository,
  ListKpiPlansInput,
  TransitionKpiPlanStatusInput,
  UpdateKpiDraftCoreInput,
} from "@modules/kpi/domain/kpi.repository";
import {
  KpiAllocation,
  KpiAllocationStatus,
  KpiAllocationTargetMetric,
  KpiActualSource,
  KpiActualPolicySnapshot,
  KpiMetricCode,
  KpiMetricUnit,
  KpiPlan,
  KpiPlanCurrency,
  KpiPlanStatus,
  KpiRollupMethod,
  KpiSubjectType,
  KpiTargetMetric,
} from "@modules/kpi/domain/kpi.types";

interface KpiPlanDocument {
  readonly _id: string;
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
  readonly actualPolicySnapshot?: KpiActualPolicySnapshot | null;
  readonly publishedAt: number | null;
  readonly publishedByActorId: string | null;
  readonly finalizedAt: number | null;
  readonly finalizedByActorId: string | null;
  readonly archivedAt: number | null;
  readonly archivedByActorId: string | null;
  readonly createdAt: number;
  readonly createdByActorId: string;
  readonly updatedAt: number;
  readonly updatedByActorId: string;
  readonly externalRef: string | null;
}

interface KpiTargetMetricDocument {
  readonly _id: string;
  readonly kpiPlanId: string;
  readonly metricCode: KpiMetricCode;
  readonly targetValue: number;
  readonly unit: KpiMetricUnit;
  readonly rollupMethod: KpiRollupMethod;
  readonly actualSource: KpiActualSource;
  readonly createdAt: number;
  readonly updatedAt: number;
}

interface KpiAllocationDocument {
  readonly _id: string;
  readonly kpiPlanId: string;
  readonly groupId: string;
  readonly memberTalentId: string;
  readonly membershipId: string | null;
  readonly allocationStatus: KpiAllocationStatus;
  readonly allocationStartDate: string;
  readonly allocationEndDate: string | null;
  readonly targetMetrics: readonly KpiAllocationTargetMetric[];
  readonly snapshotMemberDisplayName: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly publishedAt: number | null;
  readonly closedAt: number | null;
}

export class NativeMongoKpiPlanRepository
  extends BaseRepository<KpiPlanDocument>
  implements KpiPlanRepository
{
  private readonly targetMetricCollection: Collection<KpiTargetMetricDocument>;
  private readonly allocationCollection: Collection<KpiAllocationDocument>;

  constructor(db: Db) {
    super(db, "kpi_plans");
    this.targetMetricCollection =
      db.collection<KpiTargetMetricDocument>("kpi_target_metrics");
    this.allocationCollection =
      db.collection<KpiAllocationDocument>("kpi_allocations");
  }

  async insertPlan(
    plan: KpiPlan,
    session: ClientSession,
  ): Promise<KpiPlan> {
    await this.collection.insertOne(
      toKpiPlanDocument(plan),
      this.withSession(session),
    );
    return plan;
  }

  async findPlanById(
    kpiPlanId: string,
    session?: ClientSession,
  ): Promise<KpiPlan | null> {
    const doc = await this.collection.findOne(
      { _id: kpiPlanId },
      this.withSession(session),
    );
    return doc ? toKpiPlan(doc) : null;
  }

  async findPlanByPlanCode(
    planCode: string,
    session?: ClientSession,
  ): Promise<KpiPlan | null> {
    const doc = await this.collection.findOne(
      { planCode },
      this.withSession(session),
    );
    return doc ? toKpiPlan(doc) : null;
  }

  async findMaxGeneratedPlanCodeSequence(
    policy: Pick<BusinessCodePolicy, "prefix" | "width">,
    session?: ClientSession,
  ): Promise<number> {
    const doc = await this.collection
      .find(
        { planCode: buildGeneratedBusinessCodeRegex(policy) },
        this.withSession(session),
      )
      .sort({ planCode: -1 })
      .limit(1)
      .next();
    return doc
      ? parseGeneratedBusinessCodeSequence(doc.planCode, policy) ?? 0
      : 0;
  }

  async updateDraftCore(
    input: UpdateKpiDraftCoreInput,
    session: ClientSession,
  ): Promise<KpiPlan | null> {
    const set: Record<string, unknown> = {
      updatedAt: input.updatedAt,
      updatedByActorId: input.updatedByActorId,
    };
    assignIfDefined(set, "title", input.title);
    assignIfDefined(set, "normalizedTitle", input.normalizedTitle);
    assignIfDefined(set, "description", input.description);
    assignIfDefined(set, "currencyCode", input.currencyCode);
    assignIfDefined(set, "periodMonth", input.periodMonth);
    assignIfDefined(set, "periodStartAt", input.periodStartAt);
    assignIfDefined(set, "periodEndAt", input.periodEndAt);
    assignIfDefined(set, "timezone", input.timezone);
    assignIfDefined(set, "externalRef", input.externalRef);

    const updated = await this.collection.findOneAndUpdate(
      { _id: input.kpiPlanId, status: "DRAFT" },
      { $set: set },
      { ...this.withSession(session), returnDocument: "after" },
    );
    return updated ? toKpiPlan(updated) : null;
  }

  async transitionStatus(
    input: TransitionKpiPlanStatusInput,
    session: ClientSession,
  ): Promise<KpiPlan | null> {
    const set: Record<string, unknown> = {
      status: input.toStatus,
      updatedAt: input.updatedAt,
      updatedByActorId: input.updatedByActorId,
    };
    assignIfDefined(set, "publishedAt", input.publishedAt);
    assignIfDefined(set, "publishedByActorId", input.publishedByActorId);
    assignIfDefined(set, "actualPolicySnapshot", input.actualPolicySnapshot);
    assignIfDefined(set, "finalizedAt", input.finalizedAt);
    assignIfDefined(set, "finalizedByActorId", input.finalizedByActorId);
    assignIfDefined(set, "archivedAt", input.archivedAt);
    assignIfDefined(set, "archivedByActorId", input.archivedByActorId);

    const updated = await this.collection.findOneAndUpdate(
      {
        _id: input.kpiPlanId,
        status: { $in: [...input.fromStatuses] },
      },
      { $set: set },
      { ...this.withSession(session), returnDocument: "after" },
    );
    return updated ? toKpiPlan(updated) : null;
  }

  async listPlans(input: ListKpiPlansInput): Promise<readonly KpiPlan[]> {
    const query: Record<string, unknown> = {};
    assignIfDefined(query, "subjectType", input.subjectType);
    assignIfDefined(query, "subjectId", input.subjectId);
    assignIfDefined(query, "periodMonth", input.periodMonth);
    assignIfDefined(query, "status", input.status);
    if (input.groupId !== undefined) {
      query.subjectType = "TALENT_GROUP";
      query.subjectId = input.groupId;
    }
    if (input.metricCode !== undefined) {
      const planIds = await this.targetMetricCollection
        .find(
          { metricCode: input.metricCode },
          { projection: { kpiPlanId: 1 } },
        )
        .toArray();
      query._id = { $in: planIds.map((doc) => doc.kpiPlanId) };
    }
    if (input.search !== undefined) {
      const pattern = new RegExp(escapeRegExp(input.search), "i");
      query.$or = [
        { normalizedPlanCode: pattern },
        { normalizedTitle: pattern },
      ];
    }
    const sortDirection: 1 | -1 =
      input.sortDirection === "ASC" ? 1 : -1;
    const sortField = input.sortBy ?? "periodMonth";
    let sort: Record<string, 1 | -1>;
    if (sortField === "planCode") {
      sort = { planCode: sortDirection, _id: 1 };
    } else if (sortField === "createdAt") {
      sort = { createdAt: sortDirection, _id: 1 };
    } else {
      sort = { periodMonth: sortDirection, planCode: 1, _id: 1 };
    }
    const docs = await this.collection
      .find(query)
      .sort(sort)
      .limit(input.limit)
      .toArray();
    return docs.map(toKpiPlan);
  }

  async insertTargetMetrics(
    metrics: readonly KpiTargetMetric[],
    session: ClientSession,
  ): Promise<readonly KpiTargetMetric[]> {
    for (const metric of metrics) {
      await this.targetMetricCollection.insertOne(
        toKpiTargetMetricDocument(metric),
        this.withSession(session),
      );
    }
    return metrics;
  }

  async replaceTargetMetricsForDraftPlan(
    kpiPlanId: string,
    metrics: readonly KpiTargetMetric[],
    updatedAt: number,
    updatedByActorId: string,
    session: ClientSession,
  ): Promise<void> {
    const existing = await this.targetMetricCollection
      .find({ kpiPlanId }, this.withSession(session))
      .project<{ _id: string }>({ _id: 1 })
      .toArray();
    for (const metric of existing) {
      await this.targetMetricCollection.deleteOne(
        { _id: metric._id },
        this.withSession(session),
      );
    }
    await this.insertTargetMetrics(metrics, session);
    await this.collection.updateOne(
      { _id: kpiPlanId, status: "DRAFT" },
      { $set: { updatedAt, updatedByActorId } },
      this.withSession(session),
    );
  }

  async listTargetMetricsByPlanId(
    kpiPlanId: string,
    session?: ClientSession,
  ): Promise<readonly KpiTargetMetric[]> {
    const docs = await this.targetMetricCollection
      .find({ kpiPlanId }, this.withSession(session))
      .sort({ metricCode: 1, _id: 1 })
      .toArray();
    return docs.map(toKpiTargetMetric);
  }

  async insertAllocations(
    allocations: readonly KpiAllocation[],
    session: ClientSession,
  ): Promise<readonly KpiAllocation[]> {
    for (const allocation of allocations) {
      await this.allocationCollection.insertOne(
        toKpiAllocationDocument(allocation),
        this.withSession(session),
      );
    }
    return allocations;
  }

  async replaceAllocationsForDraftPlan(
    kpiPlanId: string,
    allocations: readonly KpiAllocation[],
    updatedAt: number,
    updatedByActorId: string,
    session: ClientSession,
  ): Promise<void> {
    const existing = await this.allocationCollection
      .find({ kpiPlanId }, this.withSession(session))
      .project<{ _id: string }>({ _id: 1 })
      .toArray();
    for (const allocation of existing) {
      await this.allocationCollection.deleteOne(
        { _id: allocation._id },
        this.withSession(session),
      );
    }
    await this.insertAllocations(allocations, session);
    await this.collection.updateOne(
      { _id: kpiPlanId, status: "DRAFT" },
      { $set: { updatedAt, updatedByActorId } },
      this.withSession(session),
    );
  }

  async listAllocationsByPlanId(
    kpiPlanId: string,
    session?: ClientSession,
  ): Promise<readonly KpiAllocation[]> {
    const docs = await this.allocationCollection
      .find({ kpiPlanId }, this.withSession(session))
      .sort({ memberTalentId: 1, _id: 1 })
      .toArray();
    return docs.map(toKpiAllocation);
  }

  async activateAllocationsForPlan(
    kpiPlanId: string,
    publishedAt: number,
    session: ClientSession,
  ): Promise<void> {
    const draftAllocations = await this.allocationCollection
      .find(
        { kpiPlanId, allocationStatus: "DRAFT" },
        this.withSession(session),
      )
      .project<{ _id: string }>({ _id: 1 })
      .toArray();
    for (const allocation of draftAllocations) {
      await this.allocationCollection.updateOne(
        { _id: allocation._id, allocationStatus: "DRAFT" },
        {
          $set: {
            allocationStatus: "ACTIVE",
            publishedAt,
            updatedAt: publishedAt,
          },
        },
        this.withSession(session),
      );
    }
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assignIfDefined(
  target: Record<string, unknown>,
  field: string,
  value: unknown,
): void {
  if (value !== undefined) {
    target[field] = value;
  }
}

function toKpiPlanDocument(input: KpiPlan): KpiPlanDocument {
  return {
    _id: input.id,
    planCode: input.planCode,
    normalizedPlanCode: input.normalizedPlanCode,
    title: input.title,
    normalizedTitle: input.normalizedTitle,
    description: input.description,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    status: input.status,
    currencyCode: input.currencyCode,
    periodMonth: input.periodMonth,
    periodStartAt: input.periodStartAt,
    periodEndAt: input.periodEndAt,
    timezone: input.timezone,
    actualPolicySnapshot: input.actualPolicySnapshot,
    publishedAt: input.publishedAt,
    publishedByActorId: input.publishedByActorId,
    finalizedAt: input.finalizedAt,
    finalizedByActorId: input.finalizedByActorId,
    archivedAt: input.archivedAt,
    archivedByActorId: input.archivedByActorId,
    createdAt: input.createdAt,
    createdByActorId: input.createdByActorId,
    updatedAt: input.updatedAt,
    updatedByActorId: input.updatedByActorId,
    externalRef: input.externalRef,
  };
}

function toKpiPlan(doc: KpiPlanDocument): KpiPlan {
  return {
    id: doc._id,
    planCode: doc.planCode,
    normalizedPlanCode: doc.normalizedPlanCode,
    title: doc.title,
    normalizedTitle: doc.normalizedTitle,
    description: doc.description,
    subjectType: doc.subjectType,
    subjectId: doc.subjectId,
    status: doc.status,
    currencyCode: doc.currencyCode,
    periodMonth: doc.periodMonth,
    periodStartAt: doc.periodStartAt,
    periodEndAt: doc.periodEndAt,
    timezone: doc.timezone,
    actualPolicySnapshot: doc.actualPolicySnapshot ?? null,
    publishedAt: doc.publishedAt,
    publishedByActorId: doc.publishedByActorId,
    finalizedAt: doc.finalizedAt,
    finalizedByActorId: doc.finalizedByActorId,
    archivedAt: doc.archivedAt,
    archivedByActorId: doc.archivedByActorId,
    createdAt: doc.createdAt,
    createdByActorId: doc.createdByActorId,
    updatedAt: doc.updatedAt,
    updatedByActorId: doc.updatedByActorId,
    externalRef: doc.externalRef,
  };
}

function toKpiTargetMetricDocument(
  input: KpiTargetMetric,
): KpiTargetMetricDocument {
  return {
    _id: input.id,
    kpiPlanId: input.kpiPlanId,
    metricCode: input.metricCode,
    targetValue: input.targetValue,
    unit: input.unit,
    rollupMethod: input.rollupMethod,
    actualSource: input.actualSource,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

function toKpiTargetMetric(doc: KpiTargetMetricDocument): KpiTargetMetric {
  return {
    id: doc._id,
    kpiPlanId: doc.kpiPlanId,
    metricCode: doc.metricCode,
    targetValue: doc.targetValue,
    unit: doc.unit,
    rollupMethod: doc.rollupMethod,
    actualSource: doc.actualSource,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function toKpiAllocationDocument(
  input: KpiAllocation,
): KpiAllocationDocument {
  return {
    _id: input.id,
    kpiPlanId: input.kpiPlanId,
    groupId: input.groupId,
    memberTalentId: input.memberTalentId,
    membershipId: input.membershipId,
    allocationStatus: input.allocationStatus,
    allocationStartDate: input.allocationStartDate,
    allocationEndDate: input.allocationEndDate,
    targetMetrics: input.targetMetrics.map((metric) => ({
      metricCode: metric.metricCode,
      targetValue: metric.targetValue,
    })),
    snapshotMemberDisplayName: input.snapshotMemberDisplayName,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    publishedAt: input.publishedAt,
    closedAt: input.closedAt,
  };
}

function toKpiAllocation(doc: KpiAllocationDocument): KpiAllocation {
  return {
    id: doc._id,
    kpiPlanId: doc.kpiPlanId,
    groupId: doc.groupId,
    memberTalentId: doc.memberTalentId,
    membershipId: doc.membershipId,
    allocationStatus: doc.allocationStatus,
    allocationStartDate: doc.allocationStartDate,
    allocationEndDate: doc.allocationEndDate,
    targetMetrics: doc.targetMetrics.map((metric) => ({
      metricCode: metric.metricCode,
      targetValue: metric.targetValue,
    })),
    snapshotMemberDisplayName: doc.snapshotMemberDisplayName,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    publishedAt: doc.publishedAt,
    closedAt: doc.closedAt,
  };
}
