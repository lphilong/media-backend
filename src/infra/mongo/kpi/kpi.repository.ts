import crypto from "crypto";
import { ClientSession, Collection, Db } from "mongodb";
import {
  buildGeneratedBusinessCodeRegex,
  BusinessCodePolicy,
  parseGeneratedBusinessCodeSequence,
} from "@core/business-code/business-code-sequence.repository";
import { BaseRepository } from "@infra/database/repository";
import { KpiInvalidAllocationError } from "@modules/kpi/domain/kpi.errors";
import {
  KpiActualWorkspaceDerivedPlanSortRow,
  KpiPlanListCursor,
  KpiActualSlotExcuseIdentityInput,
  KpiPlanRepository,
  ListKpiActualWorkspaceDerivedPlansInput,
  ListKpiPlansInput,
  RemoveKpiActualSlotExcuseInput,
  ReplaceKpiAllocationsForPlanInput,
  SetKpiActualSlotExcuseInput,
  TransitionKpiAllocationsForPlanInput,
  TransitionKpiPlanStatusInput,
  UpdateKpiDraftCoreInput,
} from "@modules/kpi/domain/kpi.repository";
import {
  KpiAllocation,
  KpiAllocationStatusCount,
  KpiAllocationStatus,
  KpiAllocationTargetMetric,
  KpiActualSlotExcuse,
  KpiActualSlotExcuseReasonCode,
  KpiActualSlotExcuseStatus,
  KpiActualSource,
  KpiActualPolicySnapshot,
  KpiFinalResultSnapshot,
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
  readonly finalResult?: KpiFinalResultSnapshot | null;
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
  readonly subjectType?: "TALENT_GROUP" | "ORG_UNIT";
  readonly subjectId?: string;
  readonly groupId?: string | null;
  readonly memberEmploymentProfileId?: string | null;
  readonly memberTalentId?: string | null;
  readonly membershipId: string | null;
  readonly allocationStatus: KpiAllocationStatus;
  readonly allocationStartDate: string;
  readonly allocationEndDate: string | null;
  readonly targetMetrics: readonly KpiAllocationTargetMetric[];
  readonly snapshotMemberDisplayName: string | null;
  readonly note?: string | null;
  readonly createdAt: number;
  readonly createdByActorId?: string | null;
  readonly updatedAt: number;
  readonly updatedByActorId?: string | null;
  readonly submittedAt?: number | null;
  readonly submittedByActorId?: string | null;
  readonly approvedAt?: number | null;
  readonly approvedByActorId?: string | null;
  readonly approvalNote?: string | null;
  readonly rejectedAt?: number | null;
  readonly rejectedByActorId?: string | null;
  readonly rejectionReason?: string | null;
  readonly publishedAt: number | null;
  readonly publishedByActorId?: string | null;
  readonly closedAt: number | null;
}

interface KpiActualSlotExcuseDocument {
  readonly _id: string;
  readonly kpiPlanId: string;
  readonly allocationId: string;
  readonly metricCode: KpiMetricCode;
  readonly actualDate: string;
  readonly status: KpiActualSlotExcuseStatus;
  readonly reasonCode: KpiActualSlotExcuseReasonCode;
  readonly reasonText: string;
  readonly createdAt: number;
  readonly createdByActorId: string;
  readonly updatedAt: number;
  readonly updatedByActorId: string;
  readonly deletedAt: number | null;
  readonly deletedByActorId: string | null;
}

interface KpiActualWorkspaceDerivedPlanDocument extends KpiPlanDocument {
  readonly revenueActual: number;
  readonly achievementPercent: number | null;
  readonly achievementNullRank: 0 | 1;
}

export class NativeMongoKpiPlanRepository
  extends BaseRepository<KpiPlanDocument>
  implements KpiPlanRepository
{
  private readonly targetMetricCollection: Collection<KpiTargetMetricDocument>;
  private readonly allocationCollection: Collection<KpiAllocationDocument>;
  private readonly actualExcuseCollection: Collection<KpiActualSlotExcuseDocument>;

  constructor(db: Db) {
    super(db, "kpi_plans");
    this.targetMetricCollection =
      db.collection<KpiTargetMetricDocument>("kpi_target_metrics");
    this.allocationCollection =
      db.collection<KpiAllocationDocument>("kpi_allocations");
    this.actualExcuseCollection =
      db.collection<KpiActualSlotExcuseDocument>("kpi_actual_slot_excuses");
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

  async listPlansByIds(
    kpiPlanIds: readonly string[],
    session?: ClientSession,
  ): Promise<readonly KpiPlan[]> {
    const ids = uniqueNonEmpty(kpiPlanIds);

    if (ids.length === 0) {
      return [];
    }

    const docs = await this.collection
      .find({ _id: { $in: ids } }, this.withSession(session))
      .sort({ periodMonth: -1, planCode: 1, _id: 1 })
      .toArray();
    return docs.map(toKpiPlan);
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
    assignIfDefined(set, "finalResult", input.finalResult);
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
    const filters: Record<string, unknown>[] = [];
    const query: Record<string, unknown> = {};
    assignIfDefined(query, "subjectType", input.subjectType);
    assignIfDefined(query, "periodMonth", input.periodMonth);
    assignIfDefined(query, "status", input.status);
    const subjectIds = normalizeSubjectIdFilter(input);
    if (subjectIds === null) {
      return [];
    }
    if (input.groupId !== undefined) {
      query.subjectType = "TALENT_GROUP";
    }
    if (subjectIds !== undefined) {
      query.subjectId =
        subjectIds.length === 1 ? subjectIds[0] : { $in: subjectIds };
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
    filters.push(query);
    if (input.search !== undefined || input.searchSubjectIds !== undefined) {
      const searchFilters: Record<string, unknown>[] = [];
      if (input.search !== undefined) {
        const pattern = new RegExp(escapeRegExp(input.search), "i");
        searchFilters.push(
          { normalizedPlanCode: pattern },
          { normalizedTitle: pattern },
        );
      }
      const searchSubjectIds = uniqueNonEmpty(input.searchSubjectIds ?? []);
      if (searchSubjectIds.length > 0) {
        searchFilters.push({ subjectId: { $in: searchSubjectIds } });
      }
      if (searchFilters.length === 0) {
        return [];
      }
      filters.push({ $or: searchFilters });
    }
    const sortDirection: 1 | -1 =
      input.sortDirection === "ASC" ? 1 : -1;
    const sortField = input.sortBy ?? "periodMonth";
    let sort: Record<string, 1 | -1>;
    if (sortField === "planCode") {
      sort = { planCode: sortDirection, _id: 1 };
    } else if (sortField === "createdAt") {
      sort = { createdAt: sortDirection, _id: 1 };
    } else if (input.actualWorkspaceCursorOrder === true) {
      sort = { periodMonth: sortDirection, _id: 1 };
    } else {
      sort = { periodMonth: sortDirection, planCode: 1, _id: 1 };
    }
    if (input.cursor !== undefined) {
      filters.push(buildKpiPlanCursorFilter(input.cursor));
    }
    const docs = await this.collection
      .find(buildQuery(filters))
      .sort(sort)
      .limit(input.limit)
      .toArray();
    return docs.map(toKpiPlan);
  }

  private async buildPlanMatchFilters(
    input: ListKpiPlansInput | ListKpiActualWorkspaceDerivedPlansInput,
  ): Promise<readonly Record<string, unknown>[]> {
    const filters: Record<string, unknown>[] = [];
    const query: Record<string, unknown> = {};
    assignIfDefined(query, "subjectType", input.subjectType);
    assignIfDefined(query, "periodMonth", input.periodMonth);
    assignIfDefined(query, "status", input.status);
    const subjectIds = normalizeSubjectIdFilter(input);
    if (subjectIds === null) {
      return [{ _id: { $in: [] } }];
    }
    if (input.groupId !== undefined) {
      query.subjectType = "TALENT_GROUP";
    }
    if (subjectIds !== undefined) {
      query.subjectId =
        subjectIds.length === 1 ? subjectIds[0] : { $in: subjectIds };
    }
    if ("metricCode" in input && input.metricCode !== undefined) {
      const planIds = await this.targetMetricCollection
        .find(
          { metricCode: input.metricCode },
          { projection: { kpiPlanId: 1 } },
        )
        .toArray();
      query._id = { $in: planIds.map((doc) => doc.kpiPlanId) };
    }
    filters.push(query);
    if (input.search !== undefined || input.searchSubjectIds !== undefined) {
      const searchFilters: Record<string, unknown>[] = [];
      if (input.search !== undefined) {
        const pattern = new RegExp(escapeRegExp(input.search), "i");
        searchFilters.push(
          { normalizedPlanCode: pattern },
          { normalizedTitle: pattern },
        );
      }
      const searchSubjectIds = uniqueNonEmpty(input.searchSubjectIds ?? []);
      if (searchSubjectIds.length > 0) {
        searchFilters.push({ subjectId: { $in: searchSubjectIds } });
      }
      if (searchFilters.length === 0) {
        return [{ _id: { $in: [] } }];
      }
      filters.push({ $or: searchFilters });
    }
    return filters;
  }

  async listActualWorkspaceDerivedPlans(
    input: ListKpiActualWorkspaceDerivedPlansInput,
  ): Promise<readonly KpiActualWorkspaceDerivedPlanSortRow[]> {
    const filters = await this.buildPlanMatchFilters(input);
    const pipeline: Record<string, unknown>[] = [
      { $match: buildQuery(filters) },
      {
        $lookup: {
          from: "kpi_allocations",
          let: { planId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ["$kpiPlanId", "$$planId"] },
              },
            },
          ],
          as: "workspaceAllocations",
        },
      },
      {
        $addFields: {
          totalAllocationCount: { $size: "$workspaceAllocations" },
          publishedAllocationCount: {
            $size: {
              $filter: {
                input: "$workspaceAllocations",
                as: "allocation",
                cond: {
                  $eq: ["$$allocation.allocationStatus", "PUBLISHED"],
                },
              },
            },
          },
        },
      },
      ...buildAllocationCoverageStages(input.allocationCoverage),
      {
        $addFields: {
          revenueAllocations: {
            $filter: {
              input: "$workspaceAllocations",
              as: "allocation",
              cond: {
                $and: [
                  { $eq: ["$$allocation.allocationStatus", "PUBLISHED"] },
                  { $eq: ["$$allocation.groupId", "$subjectId"] },
                  {
                    $in: [
                      "REVENUE_VND",
                      {
                        $map: {
                          input: "$$allocation.targetMetrics",
                          as: "metric",
                          in: "$$metric.metricCode",
                        },
                      },
                    ],
                  },
                ],
              },
            },
          },
        },
      },
      {
        $addFields: {
          revenueAllocationPairs: {
            $map: {
              input: "$revenueAllocations",
              as: "allocation",
              in: {
                allocationId: "$$allocation._id",
                memberTalentId: "$$allocation.memberTalentId",
              },
            },
          },
          operationalTargetValue: {
            $sum: {
              $map: {
                input: "$revenueAllocations",
                as: "allocation",
                in: {
                  $sum: {
                    $map: {
                      input: {
                        $filter: {
                          input: "$$allocation.targetMetrics",
                          as: "metric",
                          cond: {
                            $eq: ["$$metric.metricCode", "REVENUE_VND"],
                          },
                        },
                      },
                      as: "metric",
                      in: "$$metric.targetValue",
                    },
                  },
                },
              },
            },
          },
        },
      },
      {
        $lookup: {
          from: "kpi_actual_entries",
          let: {
            planId: "$_id",
            periodStartAt: "$periodStartAt",
            periodEndAt: "$periodEndAt",
            allocationPairs: "$revenueAllocationPairs",
          },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$kpiPlanId", "$$planId"] },
                    { $eq: ["$metricCode", "REVENUE_VND"] },
                    {
                      $in: [
                        {
                          allocationId: "$allocationId",
                          memberTalentId: "$memberTalentId",
                        },
                        "$$allocationPairs",
                      ],
                    },
                  ],
                },
              },
            },
            {
              $addFields: {
                actualDateAt: {
                  $dateFromString: {
                    dateString: "$actualDate",
                    format: "%d-%m-%Y",
                    timezone: "Asia/Ho_Chi_Minh",
                    onError: null,
                    onNull: null,
                  },
                },
              },
            },
            {
              $match: {
                $expr: {
                  $and: [
                    { $ne: ["$actualDateAt", null] },
                    { $gte: [{ $toLong: "$actualDateAt" }, "$$periodStartAt"] },
                    { $lte: [{ $toLong: "$actualDateAt" }, "$$periodEndAt"] },
                  ],
                },
              },
            },
            {
              $group: {
                _id: null,
                actualValue: { $sum: "$effectiveValue" },
              },
            },
          ],
          as: "revenueActualRows",
        },
      },
      {
        $addFields: {
          revenueActual: {
            $ifNull: [
              { $arrayElemAt: ["$revenueActualRows.actualValue", 0] },
              0,
            ],
          },
        },
      },
      {
        $addFields: {
          achievementPercent: {
            $cond: [
              { $eq: ["$operationalTargetValue", 0] },
              null,
              {
                $multiply: [
                  { $divide: ["$revenueActual", "$operationalTargetValue"] },
                  100,
                ],
              },
            ],
          },
        },
      },
      {
        $addFields: {
          achievementNullRank: {
            $cond: [{ $eq: ["$achievementPercent", null] }, 1, 0],
          },
        },
      },
      ...buildDerivedCursorStages(input),
      { $sort: buildDerivedSort(input) },
      { $limit: input.limit },
      { $project: { workspaceAllocations: 0, revenueAllocations: 0, revenueAllocationPairs: 0, revenueActualRows: 0 } },
    ];

    const docs = await this.collection
      .aggregate<KpiActualWorkspaceDerivedPlanDocument>(pipeline)
      .toArray();
    return docs.map((doc) => ({
      plan: toKpiPlan(doc),
      revenueActual: doc.revenueActual,
      achievementPercent: doc.achievementPercent,
      achievementNullRank: doc.achievementNullRank,
    }));
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

  async listTargetMetricsByPlanIds(
    kpiPlanIds: readonly string[],
    session?: ClientSession,
  ): Promise<readonly KpiTargetMetric[]> {
    const ids = uniqueNonEmpty(kpiPlanIds);

    if (ids.length === 0) {
      return [];
    }

    const docs = await this.targetMetricCollection
      .find({ kpiPlanId: { $in: ids } }, this.withSession(session))
      .sort({ kpiPlanId: 1, metricCode: 1, _id: 1 })
      .toArray();
    return docs.map(toKpiTargetMetric);
  }

  async insertAllocations(
    allocations: readonly KpiAllocation[],
    session: ClientSession,
  ): Promise<readonly KpiAllocation[]> {
    for (const allocation of allocations) {
      assertValidAllocationIdentity(allocation);
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

  async listAllocationsByPlanIds(
    kpiPlanIds: readonly string[],
    session?: ClientSession,
  ): Promise<readonly KpiAllocation[]> {
    const ids = uniqueNonEmpty(kpiPlanIds);

    if (ids.length === 0) {
      return [];
    }

    const docs = await this.allocationCollection
      .find({ kpiPlanId: { $in: ids } }, this.withSession(session))
      .sort({ kpiPlanId: 1, memberTalentId: 1, _id: 1 })
      .toArray();
    return docs.map(toKpiAllocation);
  }

  async countAllocationsByPlanIds(
    kpiPlanIds: readonly string[],
    session?: ClientSession,
  ): Promise<readonly KpiAllocationStatusCount[]> {
    const ids = uniqueNonEmpty(kpiPlanIds);

    if (ids.length === 0) {
      return [];
    }

    const docs = await this.allocationCollection
      .aggregate<{
        readonly _id: {
          readonly kpiPlanId: string;
          readonly allocationStatus: KpiAllocationStatus;
        };
        readonly count: number;
      }>(
        [
          { $match: { kpiPlanId: { $in: ids } } },
          {
            $group: {
              _id: {
                kpiPlanId: "$kpiPlanId",
                allocationStatus: "$allocationStatus",
              },
              count: { $sum: 1 },
            },
          },
        ],
        this.withSession(session),
      )
      .toArray();

    return docs.map((doc) => ({
      kpiPlanId: doc._id.kpiPlanId,
      allocationStatus: doc._id.allocationStatus,
      count: doc.count,
    }));
  }

  async listAllocations(input: {
    readonly status?: KpiAllocationStatus;
    readonly kpiPlanId?: string;
    readonly groupId?: string;
    readonly memberTalentId?: string;
    readonly memberEmploymentProfileId?: string;
    readonly limit: number;
  }): Promise<readonly KpiAllocation[]> {
    const query: Record<string, unknown> = {};
    assignIfDefined(query, "allocationStatus", input.status);
    assignIfDefined(query, "kpiPlanId", input.kpiPlanId);
    assignIfDefined(query, "groupId", input.groupId);
    assignIfDefined(query, "memberTalentId", input.memberTalentId);
    assignIfDefined(
      query,
      "memberEmploymentProfileId",
      input.memberEmploymentProfileId,
    );
    const docs = await this.allocationCollection
      .find(query)
      .sort({ updatedAt: -1, _id: 1 })
      .limit(input.limit)
      .toArray();
    return docs.map(toKpiAllocation);
  }

  async replaceAllocationsForPlan(
    input: ReplaceKpiAllocationsForPlanInput,
    session: ClientSession,
  ): Promise<void> {
    for (const allocation of input.allocations) {
      assertValidAllocationIdentity(allocation);
    }
    const existing = await this.allocationCollection
      .find({ kpiPlanId: input.kpiPlanId }, this.withSession(session))
      .toArray();
    if (
      existing.some(
        (allocation) =>
          !input.allowedCurrentStatuses.includes(
            allocation.allocationStatus,
          ),
      )
    ) {
      throw new Error("KPI allocation status conflict");
    }
    for (const allocation of existing) {
      await this.allocationCollection.deleteOne(
        { _id: allocation._id },
        this.withSession(session),
      );
    }
    await this.insertAllocations(input.allocations, session);
    await this.collection.updateOne(
      { _id: input.kpiPlanId },
      {
        $set: {
          updatedAt: input.updatedAt,
          updatedByActorId: input.updatedByActorId,
        },
      },
      this.withSession(session),
    );
  }

  async transitionAllocationsForPlan(
    input: TransitionKpiAllocationsForPlanInput,
    session: ClientSession,
  ): Promise<number> {
    const set: Record<string, unknown> = {
      allocationStatus: input.toStatus,
      updatedAt: input.updatedAt,
      updatedByActorId: input.updatedByActorId,
    };
    assignIfDefined(set, "submittedAt", input.submittedAt);
    assignIfDefined(set, "submittedByActorId", input.submittedByActorId);
    assignIfDefined(set, "approvedAt", input.approvedAt);
    assignIfDefined(set, "approvedByActorId", input.approvedByActorId);
    assignIfDefined(set, "approvalNote", input.approvalNote);
    assignIfDefined(set, "rejectedAt", input.rejectedAt);
    assignIfDefined(set, "rejectedByActorId", input.rejectedByActorId);
    assignIfDefined(set, "rejectionReason", input.rejectionReason);
    assignIfDefined(set, "publishedAt", input.publishedAt);
    assignIfDefined(set, "publishedByActorId", input.publishedByActorId);
    const result = await this.allocationCollection.updateMany(
      {
        kpiPlanId: input.kpiPlanId,
        allocationStatus: input.fromStatus,
      },
      { $set: set },
      this.withSession(session),
    );
    return result.modifiedCount;
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
            allocationStatus: "PUBLISHED",
            publishedAt,
            publishedByActorId: null,
            updatedAt: publishedAt,
          },
        },
        this.withSession(session),
      );
    }
  }

  async findActualSlotExcuseById(
    excuseId: string,
    session?: ClientSession,
  ): Promise<KpiActualSlotExcuse | null> {
    const doc = await this.actualExcuseCollection.findOne(
      { _id: excuseId },
      this.withSession(session),
    );
    return doc ? toKpiActualSlotExcuse(doc) : null;
  }

  async findActiveActualSlotExcuseByIdentity(
    input: KpiActualSlotExcuseIdentityInput,
    session?: ClientSession,
  ): Promise<KpiActualSlotExcuse | null> {
    const doc = await this.actualExcuseCollection.findOne(
      {
        kpiPlanId: input.kpiPlanId,
        allocationId: input.allocationId,
        metricCode: input.metricCode,
        actualDate: input.actualDate,
        deletedAt: null,
      },
      this.withSession(session),
    );
    return doc ? toKpiActualSlotExcuse(doc) : null;
  }

  async listActualSlotExcusesByPlanIds(
    kpiPlanIds: readonly string[],
    session?: ClientSession,
  ): Promise<readonly KpiActualSlotExcuse[]> {
    const ids = uniqueNonEmpty(kpiPlanIds);
    if (ids.length === 0) {
      return [];
    }
    const docs = await this.actualExcuseCollection
      .find(
        { kpiPlanId: { $in: ids }, deletedAt: null },
        this.withSession(session),
      )
      .sort({ kpiPlanId: 1, allocationId: 1, metricCode: 1, actualDate: 1 })
      .toArray();
    return docs.map(toKpiActualSlotExcuse);
  }

  async listActualSlotExcusesByPlanIdAndActualDate(
    kpiPlanId: string,
    actualDate: string,
    session?: ClientSession,
  ): Promise<readonly KpiActualSlotExcuse[]> {
    const docs = await this.actualExcuseCollection
      .find({ kpiPlanId, actualDate, deletedAt: null }, this.withSession(session))
      .sort({ allocationId: 1, metricCode: 1, _id: 1 })
      .toArray();
    return docs.map(toKpiActualSlotExcuse);
  }

  async setActualSlotExcuse(
    input: SetKpiActualSlotExcuseInput,
    session: ClientSession,
  ): Promise<KpiActualSlotExcuse> {
    const updated = await this.actualExcuseCollection.findOneAndUpdate(
      {
        kpiPlanId: input.kpiPlanId,
        allocationId: input.allocationId,
        metricCode: input.metricCode,
        actualDate: input.actualDate,
        deletedAt: null,
      },
      {
        $setOnInsert: {
          _id: cryptoRandomId(),
          kpiPlanId: input.kpiPlanId,
          allocationId: input.allocationId,
          metricCode: input.metricCode,
          actualDate: input.actualDate,
          createdAt: input.now,
          createdByActorId: input.actorId,
          deletedAt: null,
          deletedByActorId: null,
        },
        $set: {
          status: input.status,
          reasonCode: input.reasonCode,
          reasonText: input.reasonText,
          updatedAt: input.now,
          updatedByActorId: input.actorId,
        },
      },
      { ...this.withSession(session), upsert: true, returnDocument: "after" },
    );
    if (!updated) {
      throw new Error("KPI actual slot excuse upsert failed");
    }
    return toKpiActualSlotExcuse(updated);
  }

  async removeActualSlotExcuse(
    input: RemoveKpiActualSlotExcuseInput,
    session: ClientSession,
  ): Promise<KpiActualSlotExcuse | null> {
    const updated = await this.actualExcuseCollection.findOneAndUpdate(
      {
        _id: input.excuseId,
        kpiPlanId: input.kpiPlanId,
        deletedAt: null,
      },
      {
        $set: {
          deletedAt: input.now,
          deletedByActorId: input.actorId,
          updatedAt: input.now,
          updatedByActorId: input.actorId,
        },
      },
      { ...this.withSession(session), returnDocument: "after" },
    );
    return updated ? toKpiActualSlotExcuse(updated) : null;
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

function buildQuery(filters: readonly Record<string, unknown>[]): Record<string, unknown> {
  const nonEmpty = filters.filter((filter) => Object.keys(filter).length > 0);
  if (nonEmpty.length === 0) {
    return {};
  }
  if (nonEmpty.length === 1) {
    return nonEmpty[0] as Record<string, unknown>;
  }
  return { $and: nonEmpty };
}

function normalizeSubjectIdFilter(
  input: Pick<ListKpiPlansInput, "subjectId" | "subjectIds" | "groupId">,
): readonly string[] | undefined | null {
  const requested = [
    ...(input.subjectId !== undefined ? [input.subjectId] : []),
    ...(input.groupId !== undefined ? [input.groupId] : []),
  ];
  const requestedIds = uniqueNonEmpty(requested);
  const scopedIds = uniqueNonEmpty(input.subjectIds ?? []);
  if (input.subjectIds !== undefined && scopedIds.length === 0) {
    return null;
  }
  if (requestedIds.length > 1) {
    return null;
  }
  if (requestedIds.length === 1 && scopedIds.length > 0) {
    return scopedIds.includes(requestedIds[0] as string) ? requestedIds : null;
  }
  if (requestedIds.length === 1) {
    return requestedIds;
  }
  return scopedIds.length > 0 ? scopedIds : undefined;
}

function buildKpiPlanCursorFilter(
  cursor: KpiPlanListCursor,
): Record<string, unknown> {
  const field = cursor.sortBy === "planCode" ? "planCode" : "periodMonth";
  const comparisonOperator = cursor.sortDirection === "ASC" ? "$gt" : "$lt";
  return {
    $or: [
      {
        [field]: {
          [comparisonOperator]: cursor.value,
        },
      },
      {
        [field]: cursor.value,
        _id: { $gt: cursor.planId },
      },
    ],
  };
}

function buildAllocationCoverageStages(
  coverage: ListKpiActualWorkspaceDerivedPlansInput["allocationCoverage"],
): readonly Record<string, unknown>[] {
  if (coverage === undefined) {
    return [];
  }
  const completeExpression = {
    $and: [
      { $gt: ["$totalAllocationCount", 0] },
      { $eq: ["$publishedAllocationCount", "$totalAllocationCount"] },
    ],
  };
  return [
    {
      $match: {
        $expr:
          coverage === "complete"
            ? completeExpression
            : { $not: [completeExpression] },
      },
    },
  ];
}

function buildDerivedCursorStages(
  input: ListKpiActualWorkspaceDerivedPlansInput,
): readonly Record<string, unknown>[] {
  if (!input.cursor) {
    return [];
  }
  return [{ $match: buildDerivedCursorExpression(input.cursor) }];
}

function buildDerivedCursorExpression(
  cursor: NonNullable<ListKpiActualWorkspaceDerivedPlansInput["cursor"]>,
): Record<string, unknown> {
  if (cursor.sortBy === "revenueActual") {
    const comparisonOperator = cursor.sortDirection === "ASC" ? "$gt" : "$lt";
    const revenueActual = cursor.revenueActual ?? 0;
    return {
      $expr: {
        $or: [
          { [comparisonOperator]: ["$revenueActual", revenueActual] },
          {
            $and: [
              { $eq: ["$revenueActual", revenueActual] },
              { $gt: ["$_id", cursor.planId] },
            ],
          },
        ],
      },
    };
  }

  const comparisonOperator = cursor.sortDirection === "ASC" ? "$gt" : "$lt";
  const achievementNullRank = cursor.achievementNullRank ?? 0;
  const achievementPercent = cursor.achievementPercent ?? null;
  if (achievementNullRank === 1) {
    return {
      $expr: {
        $and: [
          { $eq: ["$achievementNullRank", 1] },
          { $gt: ["$_id", cursor.planId] },
        ],
      },
    };
  }
  return {
    $expr: {
      $or: [
        { $gt: ["$achievementNullRank", achievementNullRank] },
        {
          $and: [
            { $eq: ["$achievementNullRank", achievementNullRank] },
            {
              $or: [
                {
                  [comparisonOperator]: [
                    "$achievementPercent",
                    achievementPercent,
                  ],
                },
                {
                  $and: [
                    { $eq: ["$achievementPercent", achievementPercent] },
                    { $gt: ["$_id", cursor.planId] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

function buildDerivedSort(
  input: ListKpiActualWorkspaceDerivedPlansInput,
): Record<string, 1 | -1> {
  const direction: 1 | -1 = input.sortDirection === "ASC" ? 1 : -1;
  if (input.sortBy === "revenueActual") {
    return { revenueActual: direction, _id: 1 };
  }
  return { achievementNullRank: 1, achievementPercent: direction, _id: 1 };
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
    finalResult: input.finalResult ?? null,
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
    finalResult: doc.finalResult ?? null,
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
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    groupId: input.groupId,
    memberEmploymentProfileId: input.memberEmploymentProfileId,
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
    note: input.note,
    createdAt: input.createdAt,
    createdByActorId: input.createdByActorId,
    updatedAt: input.updatedAt,
    updatedByActorId: input.updatedByActorId,
    submittedAt: input.submittedAt,
    submittedByActorId: input.submittedByActorId,
    approvedAt: input.approvedAt,
    approvedByActorId: input.approvedByActorId,
    approvalNote: input.approvalNote,
    rejectedAt: input.rejectedAt,
    rejectedByActorId: input.rejectedByActorId,
    rejectionReason: input.rejectionReason,
    publishedAt: input.publishedAt,
    publishedByActorId: input.publishedByActorId,
    closedAt: input.closedAt,
  };
}

function toKpiAllocation(doc: KpiAllocationDocument): KpiAllocation {
  const subjectType = doc.subjectType ?? "TALENT_GROUP";
  const subjectId = doc.subjectId ?? doc.groupId ?? "";
  return {
    id: doc._id,
    kpiPlanId: doc.kpiPlanId,
    subjectType,
    subjectId,
    groupId: doc.groupId ?? (subjectType === "TALENT_GROUP" ? subjectId : null),
    memberEmploymentProfileId: doc.memberEmploymentProfileId ?? null,
    memberTalentId: doc.memberTalentId ?? null,
    membershipId: doc.membershipId,
    allocationStatus: doc.allocationStatus,
    allocationStartDate: doc.allocationStartDate,
    allocationEndDate: doc.allocationEndDate,
    targetMetrics: doc.targetMetrics.map((metric) => ({
      metricCode: metric.metricCode,
      targetValue: metric.targetValue,
    })),
    snapshotMemberDisplayName: doc.snapshotMemberDisplayName,
    note: doc.note ?? null,
    createdAt: doc.createdAt,
    createdByActorId: doc.createdByActorId ?? null,
    updatedAt: doc.updatedAt,
    updatedByActorId: doc.updatedByActorId ?? null,
    submittedAt: doc.submittedAt ?? null,
    submittedByActorId: doc.submittedByActorId ?? null,
    approvedAt: doc.approvedAt ?? null,
    approvedByActorId: doc.approvedByActorId ?? null,
    approvalNote: doc.approvalNote ?? null,
    rejectedAt: doc.rejectedAt ?? null,
    rejectedByActorId: doc.rejectedByActorId ?? null,
    rejectionReason: doc.rejectionReason ?? null,
    publishedAt: doc.publishedAt,
    publishedByActorId: doc.publishedByActorId ?? null,
    closedAt: doc.closedAt,
  };
}

function assertValidAllocationIdentity(input: KpiAllocation): void {
  const subjectId = readNonEmptyText(input.subjectId);
  const memberTalentId = readNonEmptyText(input.memberTalentId);
  const memberEmploymentProfileId = readNonEmptyText(
    input.memberEmploymentProfileId,
  );

  if (!subjectId) {
    throw new KpiInvalidAllocationError("KPI allocation subjectId is required");
  }

  if (!memberTalentId && !memberEmploymentProfileId) {
    throw new KpiInvalidAllocationError(
      "KPI allocation requires memberTalentId or memberEmploymentProfileId",
    );
  }

  if (input.subjectType === "TALENT_GROUP") {
    if (!memberTalentId) {
      throw new KpiInvalidAllocationError(
        "KPI TALENT_GROUP allocation requires memberTalentId",
      );
    }
    if (input.groupId !== input.subjectId) {
      throw new KpiInvalidAllocationError(
        "KPI TALENT_GROUP allocation groupId must match subjectId",
      );
    }
    return;
  }

  if (input.subjectType === "ORG_UNIT") {
    if (!memberEmploymentProfileId) {
      throw new KpiInvalidAllocationError(
        "KPI ORG_UNIT allocation requires memberEmploymentProfileId",
      );
    }
    return;
  }

  throw new KpiInvalidAllocationError(
    `KPI allocation subjectType is unsupported: ${input.subjectType}`,
  );
}

function readNonEmptyText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

function toKpiActualSlotExcuse(
  doc: KpiActualSlotExcuseDocument,
): KpiActualSlotExcuse {
  return {
    id: doc._id,
    kpiPlanId: doc.kpiPlanId,
    allocationId: doc.allocationId,
    metricCode: doc.metricCode,
    actualDate: doc.actualDate,
    status: doc.status,
    reasonCode: doc.reasonCode,
    reasonText: doc.reasonText,
    createdAt: doc.createdAt,
    createdByActorId: doc.createdByActorId,
    updatedAt: doc.updatedAt,
    updatedByActorId: doc.updatedByActorId,
    deletedAt: doc.deletedAt,
    deletedByActorId: doc.deletedByActorId,
  };
}

function cryptoRandomId(): string {
  return crypto.randomUUID();
}
