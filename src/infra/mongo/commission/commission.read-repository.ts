import {
  Collection,
  Db,
} from "mongodb";
import { BaseRepository } from "@infra/database/repository/base.repository";
import { CommissionValidationError } from "@modules/commission/domain/commission.errors";
import {
  CommissionBeneficiaryKind,
  CommissionRuleByBeneficiaryListItemView,
  CommissionRuleByContractListItemView,
  CommissionRuleDetailView,
  CommissionRuleListItemView,
  CommissionRuleSortField,
  CommissionRuleStatus,
  CommissionSettlement,
  CommissionSettlementByBeneficiaryListItemView,
  CommissionSettlementByRevenueEntryListItemView,
  CommissionSettlementBySubjectTalentListItemView,
  CommissionSettlementDetailView,
  CommissionSettlementKind,
  CommissionSettlementLineListItemView,
  CommissionSettlementListItemView,
  CommissionSettlementSortField,
  CommissionSettlementStatus,
  CommissionSortDirection,
} from "@modules/commission/domain/commission.types";
import {
  CommissionReadRepository,
  CommissionRuleByBeneficiaryReadInput,
  CommissionRuleByBeneficiaryReadResult,
  CommissionRuleByContractReadInput,
  CommissionRuleByContractReadResult,
  CommissionRuleListReadInput,
  CommissionRuleListReadResult,
  CommissionSettlementByBeneficiaryReadInput,
  CommissionSettlementByBeneficiaryReadResult,
  CommissionSettlementByRevenueEntryReadInput,
  CommissionSettlementByRevenueEntryReadResult,
  CommissionSettlementBySubjectTalentReadInput,
  CommissionSettlementBySubjectTalentReadResult,
  CommissionSettlementListReadInput,
  CommissionSettlementListReadResult,
} from "@modules/commission/read/commission.read-repository";
import { ReferenceSummary } from "@modules/reference-summary";
import { RevenueKind } from "@modules/revenue-ledger/domain/revenue-ledger.types";

interface CommissionRuleReadDocument {
  readonly _id: string;
  readonly ruleCode: string;
  readonly title: string;
  readonly normalizedTitle: string;
  readonly settlementKind: CommissionSettlementKind;
  readonly beneficiaryKind: CommissionBeneficiaryKind;
  readonly beneficiaryEmploymentProfileId: string | null;
  readonly beneficiaryTalentId: string | null;
  readonly sourceContractRecordId: string;
  readonly settlementBasis: "RECOGNIZED_GROSS_REVENUE";
  readonly ratePercent: number;
  readonly appliesToRevenueKinds: readonly RevenueKind[];
  readonly status: CommissionRuleStatus;
  readonly effectiveStartDate: number;
  readonly effectiveEndDate: number | null;
  readonly description: string | null;
  readonly externalRef: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

interface CommissionSettlementReadDocument {
  readonly _id: string;
  readonly settlementCode: string;
  readonly title: string;
  readonly normalizedTitle: string;
  readonly sourceRuleId: string;
  readonly sourceContractRecordIdSnapshot: string;
  readonly settlementKindSnapshot: CommissionSettlementKind;
  readonly beneficiaryKindSnapshot: CommissionBeneficiaryKind;
  readonly beneficiaryEmploymentProfileIdSnapshot: string | null;
  readonly beneficiaryTalentIdSnapshot: string | null;
  readonly subjectTalentId: string;
  readonly settlementBasisSnapshot: "RECOGNIZED_GROSS_REVENUE";
  readonly ratePercentSnapshot: number;
  readonly revenueEntryIds: readonly string[];
  readonly settlementPeriodStartAt: number;
  readonly settlementPeriodEndAt: number;
  readonly settlementCurrencyCode: string;
  readonly grossRevenueAmount: number;
  readonly settlementAmount: number;
  readonly status: CommissionSettlementStatus;
  readonly finalizedAt: number | null;
  readonly voidedAt: number | null;
  readonly description: string | null;
  readonly externalRef: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

interface CommissionSettlementLineReadDocument {
  readonly _id: string;
  readonly settlementId: string;
  readonly revenueEntryId: string;
  readonly revenueEntryCodeSnapshot: string;
  readonly revenueKindSnapshot: RevenueKind;
  readonly revenueCurrencyCodeSnapshot: string;
  readonly revenueRecognizedAmountSnapshot: number;
  readonly revenueRecognizedAtSnapshot: number;
  readonly lineSettlementAmount: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

interface EmploymentProfileReferenceReadDocument {
  readonly _id: string;
  readonly employeeCode: string;
  readonly legalName: string;
  readonly displayName: string;
  readonly employmentStatus: string;
}

interface TalentReferenceReadDocument {
  readonly _id: string;
  readonly talentCode: string;
  readonly stageName: string;
  readonly legalName: string;
  readonly displayShortName: string | null;
  readonly operationalStatus: string;
}

interface ContractRecordReferenceReadDocument {
  readonly _id: string;
  readonly contractCode: string;
  readonly title: string;
  readonly status: string;
}

interface RevenueEntryReferenceReadDocument {
  readonly _id: string;
  readonly revenueEntryCode: string;
  readonly title: string;
  readonly status: string;
}

type RuleReadViewKind =
  | "rule-list"
  | "rule-by-beneficiary"
  | "rule-by-contract";

type SettlementReadViewKind =
  | "settlement-list"
  | "settlement-by-beneficiary"
  | "settlement-by-subject-talent"
  | "settlement-by-revenue-entry";

type RuleSortSpec =
  | {
      readonly kind: "default";
    }
  | {
      readonly kind: "field";
      readonly field: CommissionRuleSortField;
      readonly direction: CommissionSortDirection;
    };

type SettlementSortSpec =
  | {
      readonly kind: "default";
    }
  | {
      readonly kind: "field";
      readonly field: CommissionSettlementSortField;
      readonly direction: CommissionSortDirection;
    };

type RuleEncodedCursor =
  | {
      readonly kind: "default";
      readonly queryShapeSignature: string;
      readonly effectiveStartDate: number;
      readonly ruleCode: string;
      readonly id: string;
    }
  | {
      readonly kind: "field";
      readonly queryShapeSignature: string;
      readonly field: CommissionRuleSortField;
      readonly direction: CommissionSortDirection;
      readonly value: string | number;
      readonly id: string;
    };

type SettlementEncodedCursor =
  | {
      readonly kind: "default";
      readonly queryShapeSignature: string;
      readonly settlementPeriodStartAt: number;
      readonly settlementCode: string;
      readonly id: string;
    }
  | {
      readonly kind: "field";
      readonly queryShapeSignature: string;
      readonly field: CommissionSettlementSortField;
      readonly direction: CommissionSortDirection;
      readonly value: string | number | null;
      readonly id: string;
    };

interface RulePageResult {
  readonly items: readonly CommissionRuleReadDocument[];
  readonly nextCursor?: string;
}

interface SettlementPageResult {
  readonly items: readonly CommissionSettlementReadDocument[];
  readonly nextCursor?: string;
}

export class NativeMongoCommissionReadRepository
  extends BaseRepository<CommissionRuleReadDocument>
  implements CommissionReadRepository
{
  private readonly settlementCollection: Collection<CommissionSettlementReadDocument>;
  private readonly settlementLineCollection: Collection<CommissionSettlementLineReadDocument>;
  private readonly employmentProfileCollection: Collection<EmploymentProfileReferenceReadDocument>;
  private readonly talentCollection: Collection<TalentReferenceReadDocument>;
  private readonly contractRecordCollection: Collection<ContractRecordReferenceReadDocument>;
  private readonly revenueEntryCollection: Collection<RevenueEntryReferenceReadDocument>;

  constructor(db: Db) {
    super(db, "commission_rules");
    this.settlementCollection =
      db.collection<CommissionSettlementReadDocument>(
        "commission_settlements",
      );
    this.settlementLineCollection =
      db.collection<CommissionSettlementLineReadDocument>(
        "commission_settlement_lines",
      );
    this.employmentProfileCollection =
      db.collection<EmploymentProfileReferenceReadDocument>(
        "employment_profiles",
      );
    this.talentCollection =
      db.collection<TalentReferenceReadDocument>(
        "talents",
      );
    this.contractRecordCollection =
      db.collection<ContractRecordReferenceReadDocument>(
        "contract_records",
      );
    this.revenueEntryCollection =
      db.collection<RevenueEntryReferenceReadDocument>(
        "revenue_entries",
      );
  }

  async listCommissionRules(
    input: CommissionRuleListReadInput,
  ): Promise<CommissionRuleListReadResult> {
    const page = await this.listRuleDocuments(
      "rule-list",
      input,
      async (filters) => {
        applyRuleStatusFilter(filters, input.status);
        applyRuleSettlementKindFilter(
          filters,
          input.settlementKind,
        );
        applyRuleBeneficiaryKindFilter(
          filters,
          input.beneficiaryKind,
        );
        applyRuleBeneficiaryEmploymentFilter(
          filters,
          input.beneficiaryEmploymentProfileId,
        );
        applyRuleBeneficiaryTalentFilter(
          filters,
          input.beneficiaryTalentId,
        );
        applyRuleSourceContractFilter(
          filters,
          input.sourceContractRecordId,
        );
        applyRuleRevenueKindFilter(
          filters,
          input.appliesToRevenueKind,
        );
        applyRuleWindowFilter(filters, {
          windowStartDate: input.windowStartDate,
          windowEndDate: input.windowEndDate,
        });
        applyRuleSearchFilter(filters, input.search);
      },
    );

    const items = page.items.map(toCommissionRuleListItemView);

    return {
      items: await enrichCommissionRuleReferenceSummaries(
        items,
        {
          employmentProfileCollection:
            this.employmentProfileCollection,
          talentCollection: this.talentCollection,
          contractRecordCollection:
            this.contractRecordCollection,
        },
      ),
      nextCursor: page.nextCursor,
    };
  }

  async listCommissionRulesByBeneficiary(
    input: CommissionRuleByBeneficiaryReadInput,
  ): Promise<CommissionRuleByBeneficiaryReadResult> {
    const page = await this.listRuleDocuments(
      "rule-by-beneficiary",
      input,
      async (filters) => {
        applyRuleStatusFilter(filters, input.status);
        applyRuleBeneficiaryKindFilter(
          filters,
          input.beneficiaryKind,
        );
        applyRuleBeneficiaryEmploymentFilter(
          filters,
          input.beneficiaryEmploymentProfileId ?? undefined,
        );
        applyRuleBeneficiaryTalentFilter(
          filters,
          input.beneficiaryTalentId ?? undefined,
        );
      },
    );

    const items = page.items.map(
      toCommissionRuleByBeneficiaryListItemView,
    );

    return {
      items: await enrichCommissionRuleReferenceSummaries(
        items,
        {
          employmentProfileCollection:
            this.employmentProfileCollection,
          talentCollection: this.talentCollection,
          contractRecordCollection:
            this.contractRecordCollection,
        },
      ),
      nextCursor: page.nextCursor,
    };
  }

  async listCommissionRulesByContract(
    input: CommissionRuleByContractReadInput,
  ): Promise<CommissionRuleByContractReadResult> {
    const page = await this.listRuleDocuments(
      "rule-by-contract",
      input,
      async (filters) => {
        applyRuleStatusFilter(filters, input.status);
        applyRuleSourceContractFilter(
          filters,
          input.sourceContractRecordId,
        );
      },
    );

    const items = page.items.map(
      toCommissionRuleByContractListItemView,
    );

    return {
      items: await enrichCommissionRuleReferenceSummaries(
        items,
        {
          employmentProfileCollection:
            this.employmentProfileCollection,
          talentCollection: this.talentCollection,
          contractRecordCollection:
            this.contractRecordCollection,
        },
      ),
      nextCursor: page.nextCursor,
    };
  }

  async getCommissionRuleDetail(
    commissionRuleId: string,
  ): Promise<CommissionRuleDetailView | null> {
    const document = await this.collection.findOne({
      _id: commissionRuleId,
    });

    if (!document) {
      return null;
    }

    const [detail] =
      await enrichCommissionRuleReferenceSummaries(
        [toCommissionRuleDetailView(document)],
        {
          employmentProfileCollection:
            this.employmentProfileCollection,
          talentCollection: this.talentCollection,
          contractRecordCollection:
            this.contractRecordCollection,
        },
      );

    return detail ?? null;
  }

  async listCommissionSettlements(
    input: CommissionSettlementListReadInput,
  ): Promise<CommissionSettlementListReadResult> {
    const page = await this.listSettlementDocuments(
      "settlement-list",
      input,
      async (filters) => {
        applySettlementStatusFilter(filters, input.status);
        applySettlementKindFilter(
          filters,
          input.settlementKindSnapshot,
        );
        applySettlementBeneficiaryKindFilter(
          filters,
          input.beneficiaryKindSnapshot,
        );
        applySettlementBeneficiaryEmploymentFilter(
          filters,
          input.beneficiaryEmploymentProfileIdSnapshot,
        );
        applySettlementBeneficiaryTalentFilter(
          filters,
          input.beneficiaryTalentIdSnapshot,
        );
        applySettlementSubjectTalentFilter(
          filters,
          input.subjectTalentId,
        );
        applySettlementSourceRuleFilter(
          filters,
          input.sourceRuleId,
        );
        applySettlementRevenueEntryContainsFilter(
          filters,
          input.containsRevenueEntryId,
        );
        applySettlementCurrencyFilter(
          filters,
          input.settlementCurrencyCode,
        );
        applySettlementWindowFilter(filters, {
          windowStartAt: input.windowStartAt,
          windowEndAt: input.windowEndAt,
        });
        applySettlementCreatedBeforeFilter(
          filters,
          input.createdBeforeAt,
        );
        applySettlementTimestampRangeFilter(filters, "finalizedAt", {
          fromAt: input.finalizedFromAt,
          toAt: input.finalizedToAt,
        });
        applySettlementSearchFilter(
          filters,
          input.search,
        );
      },
    );

    const items = page.items.map(
      toCommissionSettlementListItemView,
    );

    return {
      items:
        await enrichCommissionSettlementReferenceSummaries(
          items,
          {
            employmentProfileCollection:
              this.employmentProfileCollection,
            talentCollection: this.talentCollection,
            ruleCollection: this.collection,
            revenueEntryCollection:
              this.revenueEntryCollection,
          },
        ),
      nextCursor: page.nextCursor,
    };
  }

  async listCommissionSettlementsByBeneficiary(
    input: CommissionSettlementByBeneficiaryReadInput,
  ): Promise<CommissionSettlementByBeneficiaryReadResult> {
    const page = await this.listSettlementDocuments(
      "settlement-by-beneficiary",
      input,
      async (filters) => {
        applySettlementStatusFilter(filters, input.status);
        applySettlementBeneficiaryKindFilter(
          filters,
          input.beneficiaryKindSnapshot,
        );
        applySettlementBeneficiaryEmploymentFilter(
          filters,
          input.beneficiaryEmploymentProfileIdSnapshot ?? undefined,
        );
        applySettlementBeneficiaryTalentFilter(
          filters,
          input.beneficiaryTalentIdSnapshot ?? undefined,
        );
        applySettlementWindowFilter(filters, {
          windowStartAt: input.windowStartAt,
          windowEndAt: input.windowEndAt,
        });
      },
    );

    const items = page.items.map(
      toCommissionSettlementByBeneficiaryListItemView,
    );

    return {
      items:
        await enrichCommissionSettlementReferenceSummaries(
          items,
          {
            employmentProfileCollection:
              this.employmentProfileCollection,
            talentCollection: this.talentCollection,
            ruleCollection: this.collection,
            revenueEntryCollection:
              this.revenueEntryCollection,
          },
        ),
      nextCursor: page.nextCursor,
    };
  }

  async listCommissionSettlementsBySubjectTalent(
    input: CommissionSettlementBySubjectTalentReadInput,
  ): Promise<CommissionSettlementBySubjectTalentReadResult> {
    const page = await this.listSettlementDocuments(
      "settlement-by-subject-talent",
      input,
      async (filters) => {
        applySettlementStatusFilter(filters, input.status);
        applySettlementSubjectTalentFilter(
          filters,
          input.subjectTalentId,
        );
        applySettlementWindowFilter(filters, {
          windowStartAt: input.windowStartAt,
          windowEndAt: input.windowEndAt,
        });
      },
    );

    const items = page.items.map(
      toCommissionSettlementBySubjectTalentListItemView,
    );

    return {
      items:
        await enrichCommissionSettlementReferenceSummaries(
          items,
          {
            employmentProfileCollection:
              this.employmentProfileCollection,
            talentCollection: this.talentCollection,
            ruleCollection: this.collection,
            revenueEntryCollection:
              this.revenueEntryCollection,
          },
        ),
      nextCursor: page.nextCursor,
    };
  }

  async listCommissionSettlementsByRevenueEntry(
    input: CommissionSettlementByRevenueEntryReadInput,
  ): Promise<CommissionSettlementByRevenueEntryReadResult> {
    const page = await this.listSettlementDocuments(
      "settlement-by-revenue-entry",
      input,
      async (filters) => {
        applySettlementStatusFilter(filters, input.status);
        applySettlementRevenueEntryContainsFilter(
          filters,
          input.revenueEntryId,
        );
        applySettlementWindowFilter(filters, {
          windowStartAt: input.windowStartAt,
          windowEndAt: input.windowEndAt,
        });
      },
    );

    const items = page.items.map(
      toCommissionSettlementByRevenueEntryListItemView,
    );

    return {
      items:
        await enrichCommissionSettlementReferenceSummaries(
          items,
          {
            employmentProfileCollection:
              this.employmentProfileCollection,
            talentCollection: this.talentCollection,
            ruleCollection: this.collection,
            revenueEntryCollection:
              this.revenueEntryCollection,
          },
        ),
      nextCursor: page.nextCursor,
    };
  }

  async listCommissionSettlementLines(
    commissionSettlementId: string,
  ): Promise<readonly CommissionSettlementLineListItemView[]> {
    const documents = await this.settlementLineCollection
      .find({
        settlementId: commissionSettlementId,
      })
      .sort({
        revenueEntryId: 1,
        _id: 1,
      })
      .toArray();

    return documents.map(
      toCommissionSettlementLineListItemView,
    );
  }

  async getCommissionSettlementDetail(
    commissionSettlementId: string,
  ): Promise<CommissionSettlementDetailView | null> {
    const document =
      await this.settlementCollection.findOne({
        _id: commissionSettlementId,
      });

    if (!document) {
      return null;
    }

    const [detail] =
      await enrichCommissionSettlementReferenceSummaries(
        [toCommissionSettlementDetailView(document)],
        {
          employmentProfileCollection:
            this.employmentProfileCollection,
          talentCollection: this.talentCollection,
          ruleCollection: this.collection,
          revenueEntryCollection:
            this.revenueEntryCollection,
        },
      );

    return detail ?? null;
  }

  private async listRuleDocuments<TInput extends {
    readonly limit: number;
    readonly cursor?: string;
    readonly sortField?: CommissionRuleSortField;
    readonly sortDirection?: CommissionSortDirection;
  }>(
    view: RuleReadViewKind,
    input: TInput,
    buildFilters: (
      filters: Array<Record<string, unknown>>,
    ) => Promise<void>,
  ): Promise<RulePageResult> {
    const sortSpec = toRuleSortSpec(input);
    const queryShapeSignature =
      buildRuleCursorQueryShapeSignature(
        view,
        input,
        sortSpec,
      );
    const cursor =
      input.cursor === undefined
        ? undefined
        : decodeRuleCursor(
            input.cursor,
            sortSpec,
            queryShapeSignature,
          );

    const queryFilters: Array<Record<string, unknown>> =
      [];

    await buildFilters(queryFilters);

    if (cursor) {
      queryFilters.push(
        buildRulePageAfterFilter(sortSpec, cursor),
      );
    }

    const documents = await this.collection
      .find(buildQuery(queryFilters))
      .sort(toRuleSortDocument(sortSpec))
      .limit(input.limit + 1)
      .toArray();

    const hasNext = documents.length > input.limit;
    const page = hasNext
      ? documents.slice(0, input.limit)
      : documents;

    return {
      items: page,
      nextCursor:
        hasNext && page.length > 0
          ? encodeCursor(
              buildRuleCursorFromDocument(
                sortSpec,
                page[page.length - 1] as CommissionRuleReadDocument,
                queryShapeSignature,
              ),
            )
          : undefined,
    };
  }

  private async listSettlementDocuments<TInput extends {
    readonly limit: number;
    readonly cursor?: string;
    readonly sortField?: CommissionSettlementSortField;
    readonly sortDirection?: CommissionSortDirection;
  }>(
    view: SettlementReadViewKind,
    input: TInput,
    buildFilters: (
      filters: Array<Record<string, unknown>>,
    ) => Promise<void>,
  ): Promise<SettlementPageResult> {
    const sortSpec = toSettlementSortSpec(input);
    const queryShapeSignature =
      buildSettlementCursorQueryShapeSignature(
        view,
        input,
        sortSpec,
      );
    const cursor =
      input.cursor === undefined
        ? undefined
        : decodeSettlementCursor(
            input.cursor,
            sortSpec,
            queryShapeSignature,
          );

    const queryFilters: Array<Record<string, unknown>> =
      [];

    await buildFilters(queryFilters);

    if (cursor) {
      queryFilters.push(
        buildSettlementPageAfterFilter(
          sortSpec,
          cursor,
        ),
      );
    }

    const documents = await this.settlementCollection
      .find(buildQuery(queryFilters))
      .sort(toSettlementSortDocument(sortSpec))
      .limit(input.limit + 1)
      .toArray();

    const hasNext = documents.length > input.limit;
    const page = hasNext
      ? documents.slice(0, input.limit)
      : documents;

    return {
      items: page,
      nextCursor:
        hasNext && page.length > 0
          ? encodeCursor(
              buildSettlementCursorFromDocument(
                sortSpec,
                page[page.length - 1] as CommissionSettlementReadDocument,
                queryShapeSignature,
              ),
            )
          : undefined,
    };
  }
}

async function enrichCommissionRuleReferenceSummaries<
  T extends
    | CommissionRuleListItemView
    | CommissionRuleDetailView,
>(
  items: readonly T[],
  collections: {
    readonly employmentProfileCollection: Collection<EmploymentProfileReferenceReadDocument>;
    readonly talentCollection: Collection<TalentReferenceReadDocument>;
    readonly contractRecordCollection: Collection<ContractRecordReferenceReadDocument>;
  },
): Promise<readonly T[]> {
  if (items.length === 0) {
    return items;
  }

  const employmentProfileIds = new Set<string>();
  const talentIds = new Set<string>();
  const contractRecordIds = new Set<string>();

  for (const item of items) {
    addOptionalReferenceId(
      employmentProfileIds,
      item.beneficiaryEmploymentProfileId,
    );
    addOptionalReferenceId(
      talentIds,
      item.beneficiaryTalentId,
    );
    addOptionalReferenceId(
      contractRecordIds,
      item.sourceContractRecordId,
    );
  }

  const [
    employmentProfileRefMap,
    talentRefMap,
    contractRecordRefMap,
  ] = await Promise.all([
    loadEmploymentProfileReferenceSummaries(
      employmentProfileIds,
      collections.employmentProfileCollection,
    ),
    loadTalentReferenceSummaries(
      talentIds,
      collections.talentCollection,
    ),
    loadContractRecordReferenceSummaries(
      contractRecordIds,
      collections.contractRecordCollection,
    ),
  ]);

  return items.map((item) => ({
    ...item,
    beneficiaryRef:
      item.beneficiaryKind === "EMPLOYMENT_PROFILE"
        ? readNullableRef(
            employmentProfileRefMap,
            item.beneficiaryEmploymentProfileId,
          )
        : readNullableRef(
            talentRefMap,
            item.beneficiaryTalentId,
          ),
    sourceContractRecordRef:
      contractRecordRefMap.get(
        item.sourceContractRecordId,
      ) ?? null,
  }));
}

async function enrichCommissionSettlementReferenceSummaries<
  T extends
    | CommissionSettlementListItemView
    | CommissionSettlementDetailView
    | CommissionSettlementByBeneficiaryListItemView
    | CommissionSettlementBySubjectTalentListItemView
    | CommissionSettlementByRevenueEntryListItemView,
>(
  items: readonly T[],
  collections: {
    readonly employmentProfileCollection: Collection<EmploymentProfileReferenceReadDocument>;
    readonly talentCollection: Collection<TalentReferenceReadDocument>;
    readonly ruleCollection: Collection<CommissionRuleReadDocument>;
    readonly revenueEntryCollection: Collection<RevenueEntryReferenceReadDocument>;
  },
): Promise<readonly T[]> {
  if (items.length === 0) {
    return items;
  }

  const employmentProfileIds = new Set<string>();
  const talentIds = new Set<string>();
  const ruleIds = new Set<string>();
  const revenueEntryIds = new Set<string>();

  for (const item of items) {
    if ("beneficiaryEmploymentProfileIdSnapshot" in item) {
      addOptionalReferenceId(
        employmentProfileIds,
        item.beneficiaryEmploymentProfileIdSnapshot,
      );
    }
    if ("beneficiaryTalentIdSnapshot" in item) {
      addOptionalReferenceId(
        talentIds,
        item.beneficiaryTalentIdSnapshot,
      );
    }
    if ("sourceRuleId" in item) {
      addOptionalReferenceId(ruleIds, item.sourceRuleId);
    }
    if ("revenueEntryIds" in item) {
      for (const revenueEntryId of item.revenueEntryIds) {
        addOptionalReferenceId(
          revenueEntryIds,
          revenueEntryId,
        );
      }
    }
  }

  const [
    employmentProfileRefMap,
    talentRefMap,
    ruleRefMap,
    revenueEntryRefMap,
  ] = await Promise.all([
    loadEmploymentProfileReferenceSummaries(
      employmentProfileIds,
      collections.employmentProfileCollection,
    ),
    loadTalentReferenceSummaries(
      talentIds,
      collections.talentCollection,
    ),
    loadCommissionRuleReferenceSummaries(
      ruleIds,
      collections.ruleCollection,
    ),
    loadRevenueEntryReferenceSummaries(
      revenueEntryIds,
      collections.revenueEntryCollection,
    ),
  ]);

  return items.map((item) => ({
    ...item,
    ...("beneficiaryKindSnapshot" in item
      ? {
          beneficiaryRef:
            item.beneficiaryKindSnapshot ===
            "EMPLOYMENT_PROFILE"
              ? readNullableRef(
                  employmentProfileRefMap,
                  item.beneficiaryEmploymentProfileIdSnapshot,
                )
              : readNullableRef(
                  talentRefMap,
                  item.beneficiaryTalentIdSnapshot,
                ),
        }
      : {}),
    ...("sourceRuleId" in item
      ? {
          sourceRuleRef:
            ruleRefMap.get(item.sourceRuleId) ?? null,
        }
      : {}),
    ...("revenueEntryIds" in item
      ? {
          revenueEntryRefs: item.revenueEntryIds.map(
            (revenueEntryId) =>
              revenueEntryRefMap.get(revenueEntryId) ?? {
                id: revenueEntryId,
              },
          ),
        }
      : {}),
  }));
}

function addOptionalReferenceId(
  ids: Set<string>,
  value: string | null,
): void {
  if (typeof value !== "string") {
    return;
  }

  const normalized = value.trim();

  if (normalized) {
    ids.add(normalized);
  }
}

function readNullableRef(
  refs: ReadonlyMap<string, ReferenceSummary>,
  id: string | null,
): ReferenceSummary | null {
  if (!id) {
    return null;
  }

  return refs.get(id) ?? null;
}

async function loadEmploymentProfileReferenceSummaries(
  ids: ReadonlySet<string>,
  collection: Collection<EmploymentProfileReferenceReadDocument>,
): Promise<Map<string, ReferenceSummary>> {
  if (ids.size === 0) {
    return new Map();
  }

  const documents = await collection
    .find(
      {
        _id: {
          $in: [...ids],
        },
      },
      {
        projection: {
          _id: 1,
          employeeCode: 1,
          legalName: 1,
          displayName: 1,
          employmentStatus: 1,
        },
      },
    )
    .toArray();

  return new Map(
    documents.map((document) => [
      document._id,
      toEmploymentProfileReferenceSummary(document),
    ]),
  );
}

async function loadTalentReferenceSummaries(
  ids: ReadonlySet<string>,
  collection: Collection<TalentReferenceReadDocument>,
): Promise<Map<string, ReferenceSummary>> {
  if (ids.size === 0) {
    return new Map();
  }

  const documents = await collection
    .find(
      {
        _id: {
          $in: [...ids],
        },
      },
      {
        projection: {
          _id: 1,
          talentCode: 1,
          stageName: 1,
          legalName: 1,
          displayShortName: 1,
          operationalStatus: 1,
        },
      },
    )
    .toArray();

  return new Map(
    documents.map((document) => [
      document._id,
      toTalentReferenceSummary(document),
    ]),
  );
}

async function loadContractRecordReferenceSummaries(
  ids: ReadonlySet<string>,
  collection: Collection<ContractRecordReferenceReadDocument>,
): Promise<Map<string, ReferenceSummary>> {
  if (ids.size === 0) {
    return new Map();
  }

  const documents = await collection
    .find(
      {
        _id: {
          $in: [...ids],
        },
      },
      {
        projection: {
          _id: 1,
          contractCode: 1,
          title: 1,
          status: 1,
        },
      },
    )
    .toArray();

  return new Map(
    documents.map((document) => [
      document._id,
      toContractRecordReferenceSummary(document),
    ]),
  );
}

async function loadCommissionRuleReferenceSummaries(
  ids: ReadonlySet<string>,
  collection: Collection<CommissionRuleReadDocument>,
): Promise<Map<string, ReferenceSummary>> {
  if (ids.size === 0) {
    return new Map();
  }

  const documents = await collection
    .find(
      {
        _id: {
          $in: [...ids],
        },
      },
      {
        projection: {
          _id: 1,
          ruleCode: 1,
          title: 1,
          status: 1,
        },
      },
    )
    .toArray();

  return new Map(
    documents.map((document) => [
      document._id,
      toCommissionRuleReferenceSummary(document),
    ]),
  );
}

async function loadRevenueEntryReferenceSummaries(
  ids: ReadonlySet<string>,
  collection: Collection<RevenueEntryReferenceReadDocument>,
): Promise<Map<string, ReferenceSummary>> {
  if (ids.size === 0) {
    return new Map();
  }

  const documents = await collection
    .find(
      {
        _id: {
          $in: [...ids],
        },
      },
      {
        projection: {
          _id: 1,
          revenueEntryCode: 1,
          title: 1,
          status: 1,
        },
      },
    )
    .toArray();

  return new Map(
    documents.map((document) => [
      document._id,
      toRevenueEntryReferenceSummary(document),
    ]),
  );
}

function toEmploymentProfileReferenceSummary(
  document: EmploymentProfileReferenceReadDocument,
): ReferenceSummary {
  return {
    id: document._id,
    code: document.employeeCode,
    name: document.displayName || document.legalName,
    status: document.employmentStatus,
  };
}

function toTalentReferenceSummary(
  document: TalentReferenceReadDocument,
): ReferenceSummary {
  return {
    id: document._id,
    code: document.talentCode,
    name:
      document.displayShortName ??
      document.stageName ??
      document.legalName,
    status: document.operationalStatus,
  };
}

function toContractRecordReferenceSummary(
  document: ContractRecordReferenceReadDocument,
): ReferenceSummary {
  return {
    id: document._id,
    code: document.contractCode,
    title: document.title,
    status: document.status,
  };
}

function toCommissionRuleReferenceSummary(
  document: CommissionRuleReadDocument,
): ReferenceSummary {
  return {
    id: document._id,
    code: document.ruleCode,
    title: document.title,
    status: document.status,
  };
}

function toRevenueEntryReferenceSummary(
  document: RevenueEntryReferenceReadDocument,
): ReferenceSummary {
  return {
    id: document._id,
    code: document.revenueEntryCode,
    title: document.title,
    status: document.status,
  };
}

function applyRuleStatusFilter(
  filters: Array<Record<string, unknown>>,
  status: CommissionRuleStatus | undefined,
): void {
  if (status) {
    filters.push({ status });
    return;
  }

  filters.push({
    status: {
      $ne: "ARCHIVED",
    },
  });
}

function applyRuleSettlementKindFilter(
  filters: Array<Record<string, unknown>>,
  settlementKind: CommissionSettlementKind | undefined,
): void {
  if (!settlementKind) {
    return;
  }

  filters.push({ settlementKind });
}

function applyRuleBeneficiaryKindFilter(
  filters: Array<Record<string, unknown>>,
  beneficiaryKind: CommissionBeneficiaryKind | undefined,
): void {
  if (!beneficiaryKind) {
    return;
  }

  filters.push({ beneficiaryKind });
}

function applyRuleBeneficiaryEmploymentFilter(
  filters: Array<Record<string, unknown>>,
  beneficiaryEmploymentProfileId: string | undefined,
): void {
  if (!beneficiaryEmploymentProfileId) {
    return;
  }

  filters.push({ beneficiaryEmploymentProfileId });
}

function applyRuleBeneficiaryTalentFilter(
  filters: Array<Record<string, unknown>>,
  beneficiaryTalentId: string | undefined,
): void {
  if (!beneficiaryTalentId) {
    return;
  }

  filters.push({ beneficiaryTalentId });
}

function applyRuleSourceContractFilter(
  filters: Array<Record<string, unknown>>,
  sourceContractRecordId: string | undefined,
): void {
  if (!sourceContractRecordId) {
    return;
  }

  filters.push({ sourceContractRecordId });
}

function applyRuleRevenueKindFilter(
  filters: Array<Record<string, unknown>>,
  appliesToRevenueKind: RevenueKind | undefined,
): void {
  if (!appliesToRevenueKind) {
    return;
  }

  filters.push({
    appliesToRevenueKinds: appliesToRevenueKind,
  });
}

function applyRuleWindowFilter(
  filters: Array<Record<string, unknown>>,
  input: {
    readonly windowStartDate?: number;
    readonly windowEndDate?: number;
  },
): void {
  if (
    input.windowStartDate !== undefined &&
    input.windowEndDate !== undefined
  ) {
    filters.push({
      effectiveStartDate: {
        $lte: input.windowEndDate,
      },
    });
    filters.push({
      $or: [
        {
          effectiveEndDate: null,
        },
        {
          effectiveEndDate: {
            $gte: input.windowStartDate,
          },
        },
      ],
    });
    return;
  }

  if (input.windowStartDate !== undefined) {
    filters.push({
      $or: [
        {
          effectiveEndDate: null,
        },
        {
          effectiveEndDate: {
            $gte: input.windowStartDate,
          },
        },
      ],
    });
  }

  if (input.windowEndDate !== undefined) {
    filters.push({
      effectiveStartDate: {
        $lte: input.windowEndDate,
      },
    });
  }
}

function applyRuleSearchFilter(
  filters: Array<Record<string, unknown>>,
  search: string | undefined,
): void {
  if (!search) {
    return;
  }

  filters.push({
    $or: [
      {
        ruleCode: {
          $regex: `^${escapeRegex(search)}$`,
          $options: "i",
        },
      },
      buildPrefixRange("normalizedTitle", search),
    ],
  });
}

function applySettlementStatusFilter(
  filters: Array<Record<string, unknown>>,
  status: CommissionSettlementStatus | undefined,
): void {
  if (status) {
    filters.push({ status });
    return;
  }

  filters.push({
    status: {
      $ne: "ARCHIVED",
    },
  });
}

function applySettlementKindFilter(
  filters: Array<Record<string, unknown>>,
  settlementKindSnapshot:
    | CommissionSettlementKind
    | undefined,
): void {
  if (!settlementKindSnapshot) {
    return;
  }

  filters.push({ settlementKindSnapshot });
}

function applySettlementBeneficiaryKindFilter(
  filters: Array<Record<string, unknown>>,
  beneficiaryKindSnapshot:
    | CommissionBeneficiaryKind
    | undefined,
): void {
  if (!beneficiaryKindSnapshot) {
    return;
  }

  filters.push({ beneficiaryKindSnapshot });
}

function applySettlementBeneficiaryEmploymentFilter(
  filters: Array<Record<string, unknown>>,
  beneficiaryEmploymentProfileIdSnapshot:
    | string
    | undefined,
): void {
  if (!beneficiaryEmploymentProfileIdSnapshot) {
    return;
  }

  filters.push({
    beneficiaryEmploymentProfileIdSnapshot,
  });
}

function applySettlementBeneficiaryTalentFilter(
  filters: Array<Record<string, unknown>>,
  beneficiaryTalentIdSnapshot: string | undefined,
): void {
  if (!beneficiaryTalentIdSnapshot) {
    return;
  }

  filters.push({ beneficiaryTalentIdSnapshot });
}

function applySettlementSubjectTalentFilter(
  filters: Array<Record<string, unknown>>,
  subjectTalentId: string | undefined,
): void {
  if (!subjectTalentId) {
    return;
  }

  filters.push({ subjectTalentId });
}

function applySettlementSourceRuleFilter(
  filters: Array<Record<string, unknown>>,
  sourceRuleId: string | undefined,
): void {
  if (!sourceRuleId) {
    return;
  }

  filters.push({ sourceRuleId });
}

function applySettlementRevenueEntryContainsFilter(
  filters: Array<Record<string, unknown>>,
  revenueEntryId: string | undefined,
): void {
  if (!revenueEntryId) {
    return;
  }

  filters.push({
    revenueEntryIds: revenueEntryId,
  });
}

function applySettlementCurrencyFilter(
  filters: Array<Record<string, unknown>>,
  settlementCurrencyCode: string | undefined,
): void {
  if (!settlementCurrencyCode) {
    return;
  }

  filters.push({ settlementCurrencyCode });
}

function applySettlementWindowFilter(
  filters: Array<Record<string, unknown>>,
  input: {
    readonly windowStartAt?: number;
    readonly windowEndAt?: number;
  },
): void {
  if (
    input.windowStartAt !== undefined &&
    input.windowEndAt !== undefined
  ) {
    filters.push({
      settlementPeriodStartAt: {
        $lt: input.windowEndAt,
      },
    });
    filters.push({
      settlementPeriodEndAt: {
        $gt: input.windowStartAt,
      },
    });
    return;
  }

  if (input.windowStartAt !== undefined) {
    filters.push({
      settlementPeriodEndAt: {
        $gt: input.windowStartAt,
      },
    });
  }

  if (input.windowEndAt !== undefined) {
    filters.push({
      settlementPeriodStartAt: {
        $lt: input.windowEndAt,
      },
    });
  }
}

function applySettlementCreatedBeforeFilter(
  filters: Array<Record<string, unknown>>,
  createdBeforeAt: number | undefined,
): void {
  if (createdBeforeAt === undefined) {
    return;
  }

  filters.push({
    createdAt: {
      $lt: createdBeforeAt,
    },
  });
}

function applySettlementTimestampRangeFilter(
  filters: Array<Record<string, unknown>>,
  field: "finalizedAt",
  input: {
    readonly fromAt?: number;
    readonly toAt?: number;
  },
): void {
  if (input.fromAt !== undefined) {
    filters.push({
      [field]: {
        $gte: input.fromAt,
      },
    });
  }

  if (input.toAt !== undefined) {
    filters.push({
      [field]: {
        $lt: input.toAt,
      },
    });
  }
}

function applySettlementSearchFilter(
  filters: Array<Record<string, unknown>>,
  search: string | undefined,
): void {
  if (!search) {
    return;
  }

  filters.push({
    $or: [
      {
        settlementCode: {
          $regex: `^${escapeRegex(search)}$`,
          $options: "i",
        },
      },
      buildPrefixRange("normalizedTitle", search),
    ],
  });
}

function toCommissionRuleDetailView(
  input: CommissionRuleReadDocument,
): CommissionRuleDetailView {
  return {
    id: input._id,
    ruleCode: input.ruleCode,
    title: input.title,
    settlementKind: input.settlementKind,
    beneficiaryKind: input.beneficiaryKind,
    beneficiaryEmploymentProfileId:
      input.beneficiaryEmploymentProfileId,
    beneficiaryTalentId: input.beneficiaryTalentId,
    sourceContractRecordId:
      input.sourceContractRecordId,
    settlementBasis: input.settlementBasis,
    ratePercent: input.ratePercent,
    appliesToRevenueKinds: [
      ...input.appliesToRevenueKinds,
    ],
    status: input.status,
    effectiveStartDate: input.effectiveStartDate,
    effectiveEndDate: input.effectiveEndDate,
    description: input.description,
    externalRef: input.externalRef,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

function toCommissionRuleListItemView(
  input: CommissionRuleReadDocument,
): CommissionRuleListItemView {
  return {
    id: input._id,
    ruleCode: input.ruleCode,
    title: input.title,
    settlementKind: input.settlementKind,
    beneficiaryKind: input.beneficiaryKind,
    beneficiaryEmploymentProfileId:
      input.beneficiaryEmploymentProfileId,
    beneficiaryTalentId: input.beneficiaryTalentId,
    sourceContractRecordId:
      input.sourceContractRecordId,
    ratePercent: input.ratePercent,
    status: input.status,
    effectiveStartDate: input.effectiveStartDate,
    effectiveEndDate: input.effectiveEndDate,
    createdAt: input.createdAt,
  };
}

function toCommissionRuleByBeneficiaryListItemView(
  input: CommissionRuleReadDocument,
): CommissionRuleByBeneficiaryListItemView {
  return toCommissionRuleListItemView(input);
}

function toCommissionRuleByContractListItemView(
  input: CommissionRuleReadDocument,
): CommissionRuleByContractListItemView {
  return toCommissionRuleListItemView(input);
}

function toCommissionSettlementDetailView(
  input: CommissionSettlementReadDocument,
): CommissionSettlementDetailView {
  return {
    id: input._id,
    settlementCode: input.settlementCode,
    title: input.title,
    sourceRuleId: input.sourceRuleId,
    sourceContractRecordIdSnapshot:
      input.sourceContractRecordIdSnapshot,
    settlementKindSnapshot:
      input.settlementKindSnapshot,
    beneficiaryKindSnapshot:
      input.beneficiaryKindSnapshot,
    beneficiaryEmploymentProfileIdSnapshot:
      input.beneficiaryEmploymentProfileIdSnapshot,
    beneficiaryTalentIdSnapshot:
      input.beneficiaryTalentIdSnapshot,
    subjectTalentId: input.subjectTalentId,
    settlementBasisSnapshot:
      input.settlementBasisSnapshot,
    ratePercentSnapshot: input.ratePercentSnapshot,
    revenueEntryIds: [...input.revenueEntryIds],
    settlementPeriodStartAt:
      input.settlementPeriodStartAt,
    settlementPeriodEndAt: input.settlementPeriodEndAt,
    settlementCurrencyCode:
      input.settlementCurrencyCode,
    grossRevenueAmount: input.grossRevenueAmount,
    settlementAmount: input.settlementAmount,
    status: input.status,
    finalizedAt: input.finalizedAt,
    voidedAt: input.voidedAt,
    description: input.description,
    externalRef: input.externalRef,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

function toCommissionSettlementListItemView(
  input: CommissionSettlementReadDocument,
): CommissionSettlementListItemView {
  return {
    id: input._id,
    settlementCode: input.settlementCode,
    title: input.title,
    sourceRuleId: input.sourceRuleId,
    settlementKindSnapshot:
      input.settlementKindSnapshot,
    beneficiaryKindSnapshot:
      input.beneficiaryKindSnapshot,
    beneficiaryEmploymentProfileIdSnapshot:
      input.beneficiaryEmploymentProfileIdSnapshot,
    beneficiaryTalentIdSnapshot:
      input.beneficiaryTalentIdSnapshot,
    subjectTalentId: input.subjectTalentId,
    revenueEntryIds: [...input.revenueEntryIds],
    settlementCurrencyCode:
      input.settlementCurrencyCode,
    grossRevenueAmount: input.grossRevenueAmount,
    settlementAmount: input.settlementAmount,
    status: input.status,
    settlementPeriodStartAt:
      input.settlementPeriodStartAt,
    settlementPeriodEndAt: input.settlementPeriodEndAt,
    finalizedAt: input.finalizedAt,
    createdAt: input.createdAt,
  };
}

function toCommissionSettlementByBeneficiaryListItemView(
  input: CommissionSettlementReadDocument,
): CommissionSettlementByBeneficiaryListItemView {
  return toCommissionSettlementListItemView(input);
}

function toCommissionSettlementBySubjectTalentListItemView(
  input: CommissionSettlementReadDocument,
): CommissionSettlementBySubjectTalentListItemView {
  return toCommissionSettlementListItemView(input);
}

function toCommissionSettlementByRevenueEntryListItemView(
  input: CommissionSettlementReadDocument,
): CommissionSettlementByRevenueEntryListItemView {
  return toCommissionSettlementListItemView(input);
}

function toCommissionSettlementLineListItemView(
  input: CommissionSettlementLineReadDocument,
): CommissionSettlementLineListItemView {
  return {
    id: input._id,
    revenueEntryId: input.revenueEntryId,
    revenueEntryCodeSnapshot:
      input.revenueEntryCodeSnapshot,
    revenueKindSnapshot: input.revenueKindSnapshot,
    revenueCurrencyCodeSnapshot:
      input.revenueCurrencyCodeSnapshot,
    revenueRecognizedAmountSnapshot:
      input.revenueRecognizedAmountSnapshot,
    revenueRecognizedAtSnapshot:
      input.revenueRecognizedAtSnapshot,
    lineSettlementAmount: input.lineSettlementAmount,
  };
}

function toRuleSortSpec(
  input: {
    readonly sortField?: CommissionRuleSortField;
    readonly sortDirection?: CommissionSortDirection;
  },
): RuleSortSpec {
  if (!input.sortField) {
    return {
      kind: "default",
    };
  }

  return {
    kind: "field",
    field: input.sortField,
    direction: input.sortDirection ?? "ASC",
  };
}

function toSettlementSortSpec(
  input: {
    readonly sortField?: CommissionSettlementSortField;
    readonly sortDirection?: CommissionSortDirection;
  },
): SettlementSortSpec {
  if (!input.sortField) {
    return {
      kind: "default",
    };
  }

  return {
    kind: "field",
    field: input.sortField,
    direction: input.sortDirection ?? "ASC",
  };
}

function toRuleSortDocument(
  spec: RuleSortSpec,
): Record<string, 1 | -1> {
  if (spec.kind === "default") {
    return {
      effectiveStartDate: -1,
      ruleCode: 1,
      _id: 1,
    };
  }

  const field = toRuleSortStorageField(spec.field);

  return {
    [field]: toDirectionValue(spec.direction),
    _id: 1,
  };
}

function toSettlementSortDocument(
  spec: SettlementSortSpec,
): Record<string, 1 | -1> {
  if (spec.kind === "default") {
    return {
      settlementPeriodStartAt: -1,
      settlementCode: 1,
      _id: 1,
    };
  }

  return {
    [spec.field]: toDirectionValue(spec.direction),
    _id: 1,
  };
}

function toRuleSortStorageField(
  field: CommissionRuleSortField,
): "ruleCode" | "normalizedTitle" | "effectiveStartDate" | "createdAt" {
  if (field === "title") {
    return "normalizedTitle";
  }

  return field;
}

function buildRuleCursorFromDocument(
  spec: RuleSortSpec,
  document: CommissionRuleReadDocument,
  queryShapeSignature: string,
): RuleEncodedCursor {
  if (spec.kind === "default") {
    return {
      kind: "default",
      queryShapeSignature,
      effectiveStartDate: document.effectiveStartDate,
      ruleCode: document.ruleCode,
      id: document._id,
    };
  }

  return {
    kind: "field",
    queryShapeSignature,
    field: spec.field,
    direction: spec.direction,
    value: readRuleSortFieldValue(document, spec.field),
    id: document._id,
  };
}

function buildSettlementCursorFromDocument(
  spec: SettlementSortSpec,
  document: CommissionSettlementReadDocument,
  queryShapeSignature: string,
): SettlementEncodedCursor {
  if (spec.kind === "default") {
    return {
      kind: "default",
      queryShapeSignature,
      settlementPeriodStartAt:
        document.settlementPeriodStartAt,
      settlementCode: document.settlementCode,
      id: document._id,
    };
  }

  return {
    kind: "field",
    queryShapeSignature,
    field: spec.field,
    direction: spec.direction,
    value: readSettlementSortFieldValue(
      document,
      spec.field,
    ),
    id: document._id,
  };
}

function buildRulePageAfterFilter(
  spec: RuleSortSpec,
  cursor: RuleEncodedCursor,
): Record<string, unknown> {
  if (spec.kind === "default") {
    if (cursor.kind !== "default") {
      throw invalidCursorError();
    }

    return {
      $or: [
        {
          effectiveStartDate: {
            $lt: cursor.effectiveStartDate,
          },
        },
        {
          effectiveStartDate:
            cursor.effectiveStartDate,
          ruleCode: {
            $gt: cursor.ruleCode,
          },
        },
        {
          effectiveStartDate:
            cursor.effectiveStartDate,
          ruleCode: cursor.ruleCode,
          _id: {
            $gt: cursor.id,
          },
        },
      ],
    };
  }

  if (
    cursor.kind !== "field" ||
    cursor.field !== spec.field ||
    cursor.direction !== spec.direction
  ) {
    throw invalidCursorError();
  }

  const comparisonOperator =
    spec.direction === "ASC" ? "$gt" : "$lt";
  const field = toRuleSortStorageField(spec.field);

  return {
    $or: [
      {
        [field]: {
          [comparisonOperator]: cursor.value,
        },
      },
      {
        [field]: cursor.value,
        _id: {
          $gt: cursor.id,
        },
      },
    ],
  };
}

function buildSettlementPageAfterFilter(
  spec: SettlementSortSpec,
  cursor: SettlementEncodedCursor,
): Record<string, unknown> {
  if (spec.kind === "default") {
    if (cursor.kind !== "default") {
      throw invalidCursorError();
    }

    return {
      $or: [
        {
          settlementPeriodStartAt: {
            $lt: cursor.settlementPeriodStartAt,
          },
        },
        {
          settlementPeriodStartAt:
            cursor.settlementPeriodStartAt,
          settlementCode: {
            $gt: cursor.settlementCode,
          },
        },
        {
          settlementPeriodStartAt:
            cursor.settlementPeriodStartAt,
          settlementCode: cursor.settlementCode,
          _id: {
            $gt: cursor.id,
          },
        },
      ],
    };
  }

  if (
    cursor.kind !== "field" ||
    cursor.field !== spec.field ||
    cursor.direction !== spec.direction
  ) {
    throw invalidCursorError();
  }

  const comparisonOperator =
    spec.direction === "ASC" ? "$gt" : "$lt";

  return {
    $or: [
      {
        [spec.field]: {
          [comparisonOperator]: cursor.value,
        },
      },
      {
        [spec.field]: cursor.value,
        _id: {
          $gt: cursor.id,
        },
      },
    ],
  };
}

function encodeCursor(
  cursor: RuleEncodedCursor | SettlementEncodedCursor,
): string {
  return Buffer.from(
    JSON.stringify(cursor),
    "utf8",
  ).toString("base64url");
}

function decodeRuleCursor(
  cursor: string,
  expectedSpec: RuleSortSpec,
  expectedQueryShapeSignature: string,
): RuleEncodedCursor {
  const candidate = decodeCursorPayload(cursor);
  const queryShapeSignature =
    candidate.queryShapeSignature;

  if (
    typeof queryShapeSignature !== "string" ||
    queryShapeSignature !==
      expectedQueryShapeSignature
  ) {
    throw invalidCursorError();
  }

  if (expectedSpec.kind === "default") {
    if (
      candidate.kind !== "default" ||
      typeof candidate.effectiveStartDate !== "number" ||
      !Number.isInteger(candidate.effectiveStartDate) ||
      typeof candidate.ruleCode !== "string" ||
      typeof candidate.id !== "string"
    ) {
      throw invalidCursorError();
    }

    const id = candidate.id.trim();
    const ruleCode = candidate.ruleCode.trim();
    if (!id || !ruleCode) {
      throw invalidCursorError();
    }

    return {
      kind: "default",
      queryShapeSignature,
      effectiveStartDate:
        candidate.effectiveStartDate,
      ruleCode,
      id,
    };
  }

  if (
    candidate.kind !== "field" ||
    candidate.field !== expectedSpec.field ||
    candidate.direction !== expectedSpec.direction ||
    typeof candidate.id !== "string"
  ) {
    throw invalidCursorError();
  }

  const id = candidate.id.trim();
  if (!id) {
    throw invalidCursorError();
  }

  const value = candidate.value;

  if (
    expectedSpec.field === "ruleCode" ||
    expectedSpec.field === "title"
  ) {
    if (typeof value !== "string") {
      throw invalidCursorError();
    }
  } else if (
    typeof value !== "number" ||
    !Number.isInteger(value)
  ) {
    throw invalidCursorError();
  }

  return {
    kind: "field",
    queryShapeSignature,
    field: expectedSpec.field,
    direction: expectedSpec.direction,
    value,
    id,
  };
}

function decodeSettlementCursor(
  cursor: string,
  expectedSpec: SettlementSortSpec,
  expectedQueryShapeSignature: string,
): SettlementEncodedCursor {
  const candidate = decodeCursorPayload(cursor);
  const queryShapeSignature =
    candidate.queryShapeSignature;

  if (
    typeof queryShapeSignature !== "string" ||
    queryShapeSignature !==
      expectedQueryShapeSignature
  ) {
    throw invalidCursorError();
  }

  if (expectedSpec.kind === "default") {
    if (
      candidate.kind !== "default" ||
      typeof candidate.settlementPeriodStartAt !==
        "number" ||
      !Number.isInteger(
        candidate.settlementPeriodStartAt,
      ) ||
      typeof candidate.settlementCode !== "string" ||
      typeof candidate.id !== "string"
    ) {
      throw invalidCursorError();
    }

    const id = candidate.id.trim();
    const settlementCode =
      candidate.settlementCode.trim();

    if (!id || !settlementCode) {
      throw invalidCursorError();
    }

    return {
      kind: "default",
      queryShapeSignature,
      settlementPeriodStartAt:
        candidate.settlementPeriodStartAt,
      settlementCode,
      id,
    };
  }

  if (
    candidate.kind !== "field" ||
    candidate.field !== expectedSpec.field ||
    candidate.direction !== expectedSpec.direction ||
    typeof candidate.id !== "string"
  ) {
    throw invalidCursorError();
  }

  const id = candidate.id.trim();
  if (!id) {
    throw invalidCursorError();
  }

  const value = candidate.value;

  if (expectedSpec.field === "settlementCode") {
    if (typeof value !== "string") {
      throw invalidCursorError();
    }
  } else if (expectedSpec.field === "finalizedAt") {
    if (
      value !== null &&
      (typeof value !== "number" ||
        !Number.isInteger(value))
    ) {
      throw invalidCursorError();
    }
  } else if (
    typeof value !== "number" ||
    !Number.isInteger(value)
  ) {
    throw invalidCursorError();
  }

  return {
    kind: "field",
    queryShapeSignature,
    field: expectedSpec.field,
    direction: expectedSpec.direction,
    value,
    id,
  };
}

function decodeCursorPayload(
  cursor: string,
): Record<string, unknown> {
  const normalized = cursor.trim();

  if (!normalized) {
    throw invalidCursorError();
  }

  let decodedText: string;

  try {
    decodedText = Buffer.from(
      normalized,
      "base64url",
    ).toString("utf8");
  } catch {
    throw invalidCursorError();
  }

  let payload: unknown;

  try {
    payload = JSON.parse(decodedText);
  } catch {
    throw invalidCursorError();
  }

  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    throw invalidCursorError();
  }

  return payload as Record<string, unknown>;
}

function readRuleSortFieldValue(
  document: CommissionRuleReadDocument,
  field: CommissionRuleSortField,
): string | number {
  if (field === "title") {
    return document.normalizedTitle;
  }

  return document[field];
}

function readSettlementSortFieldValue(
  document: CommissionSettlementReadDocument,
  field: CommissionSettlementSortField,
): string | number | null {
  return document[field];
}

function buildRuleCursorQueryShapeSignature(
  view: RuleReadViewKind,
  input: unknown,
  sortSpec: RuleSortSpec,
): string {
  switch (view) {
    case "rule-list": {
      const typed = input as CommissionRuleListReadInput;

      return JSON.stringify({
        view,
        status: typed.status ?? null,
        settlementKind: typed.settlementKind ?? null,
        beneficiaryKind: typed.beneficiaryKind ?? null,
        beneficiaryEmploymentProfileId:
          typed.beneficiaryEmploymentProfileId ??
          null,
        beneficiaryTalentId:
          typed.beneficiaryTalentId ?? null,
        sourceContractRecordId:
          typed.sourceContractRecordId ?? null,
        appliesToRevenueKind:
          typed.appliesToRevenueKind ?? null,
        windowStartDate: typed.windowStartDate ?? null,
        windowEndDate: typed.windowEndDate ?? null,
        search: typed.search ?? null,
        sortSpec,
      });
    }

    case "rule-by-beneficiary": {
      const typed =
        input as CommissionRuleByBeneficiaryReadInput;

      return JSON.stringify({
        view,
        beneficiaryKind: typed.beneficiaryKind,
        beneficiaryEmploymentProfileId:
          typed.beneficiaryEmploymentProfileId,
        beneficiaryTalentId:
          typed.beneficiaryTalentId,
        status: typed.status ?? null,
        sortSpec,
      });
    }

    case "rule-by-contract": {
      const typed =
        input as CommissionRuleByContractReadInput;

      return JSON.stringify({
        view,
        sourceContractRecordId:
          typed.sourceContractRecordId,
        status: typed.status ?? null,
        sortSpec,
      });
    }
  }
}

function buildSettlementCursorQueryShapeSignature(
  view: SettlementReadViewKind,
  input: unknown,
  sortSpec: SettlementSortSpec,
): string {
  switch (view) {
    case "settlement-list": {
      const typed =
        input as CommissionSettlementListReadInput;

      return JSON.stringify({
        view,
        status: typed.status ?? null,
        settlementKindSnapshot:
          typed.settlementKindSnapshot ?? null,
        beneficiaryKindSnapshot:
          typed.beneficiaryKindSnapshot ?? null,
        beneficiaryEmploymentProfileIdSnapshot:
          typed.beneficiaryEmploymentProfileIdSnapshot ??
          null,
        beneficiaryTalentIdSnapshot:
          typed.beneficiaryTalentIdSnapshot ??
          null,
        subjectTalentId: typed.subjectTalentId ?? null,
        sourceRuleId: typed.sourceRuleId ?? null,
        containsRevenueEntryId:
          typed.containsRevenueEntryId ?? null,
        settlementCurrencyCode:
          typed.settlementCurrencyCode ?? null,
        windowStartAt: typed.windowStartAt ?? null,
        windowEndAt: typed.windowEndAt ?? null,
        createdBeforeAt: typed.createdBeforeAt ?? null,
        finalizedFromAt: typed.finalizedFromAt ?? null,
        finalizedToAt: typed.finalizedToAt ?? null,
        search: typed.search ?? null,
        sortSpec,
      });
    }

    case "settlement-by-beneficiary": {
      const typed =
        input as CommissionSettlementByBeneficiaryReadInput;

      return JSON.stringify({
        view,
        beneficiaryKindSnapshot:
          typed.beneficiaryKindSnapshot,
        beneficiaryEmploymentProfileIdSnapshot:
          typed.beneficiaryEmploymentProfileIdSnapshot,
        beneficiaryTalentIdSnapshot:
          typed.beneficiaryTalentIdSnapshot,
        status: typed.status ?? null,
        windowStartAt: typed.windowStartAt ?? null,
        windowEndAt: typed.windowEndAt ?? null,
        sortSpec,
      });
    }

    case "settlement-by-subject-talent": {
      const typed =
        input as CommissionSettlementBySubjectTalentReadInput;

      return JSON.stringify({
        view,
        subjectTalentId: typed.subjectTalentId,
        status: typed.status ?? null,
        windowStartAt: typed.windowStartAt ?? null,
        windowEndAt: typed.windowEndAt ?? null,
        sortSpec,
      });
    }

    case "settlement-by-revenue-entry": {
      const typed =
        input as CommissionSettlementByRevenueEntryReadInput;

      return JSON.stringify({
        view,
        revenueEntryId: typed.revenueEntryId,
        status: typed.status ?? null,
        windowStartAt: typed.windowStartAt ?? null,
        windowEndAt: typed.windowEndAt ?? null,
        sortSpec,
      });
    }
  }
}

function buildQuery(
  filters: ReadonlyArray<Record<string, unknown>>,
): Record<string, unknown> {
  if (filters.length === 0) {
    return {};
  }

  if (filters.length === 1) {
    return filters[0] ?? {};
  }

  return {
    $and: [...filters],
  };
}

function buildPrefixRange(
  field: string,
  prefix: string,
): Record<string, unknown> {
  return {
    [field]: {
      $gte: prefix,
      $lt: `${prefix}\uffff`,
    },
  };
}

function escapeRegex(value: string): string {
  return value.replace(
    /[.*+?^${}()|[\]\\]/gu,
    "\\$&",
  );
}

function toDirectionValue(
  direction: CommissionSortDirection,
): 1 | -1 {
  return direction === "ASC" ? 1 : -1;
}

function invalidCursorError(): CommissionValidationError {
  return new CommissionValidationError(
    "Invalid cursor",
  );
}
