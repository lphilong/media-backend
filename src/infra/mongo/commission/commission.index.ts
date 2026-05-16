import {
  Collection,
  Db,
} from "mongodb";

export const COMMISSION_RULE_UNIQ_CODE_INDEX_NAME =
  "uniq_commission_rule_rule_code";
export const COMMISSION_RULE_NORMALIZED_TITLE_INDEX_NAME =
  "idx_commission_rule_normalized_title";
export const COMMISSION_RULE_STATUS_KIND_EFFECTIVE_WINDOW_INDEX_NAME =
  "idx_commission_rule_status_kind_effective_window";
export const COMMISSION_RULE_SOURCE_CONTRACT_INDEX_NAME =
  "idx_commission_rule_source_contract";
export const COMMISSION_RULE_BENEFICIARY_EMPLOYMENT_INDEX_NAME =
  "idx_commission_rule_beneficiary_employment";
export const COMMISSION_RULE_BENEFICIARY_TALENT_INDEX_NAME =
  "idx_commission_rule_beneficiary_talent";
export const COMMISSION_RULE_REVENUE_KIND_STATUS_INDEX_NAME =
  "idx_commission_rule_revenue_kind_status";
export const COMMISSION_RULE_FLAT_LIST_DEFAULT_NON_ARCHIVED_SORT_INDEX_NAME =
  "idx_commission_rule_flat_list_default_non_archived_sort";
export const COMMISSION_RULE_FLAT_LIST_CREATED_AT_ASC_NON_ARCHIVED_SORT_INDEX_NAME =
  "idx_commission_rule_flat_list_created_at_asc_non_archived_sort";
export const COMMISSION_RULE_FLAT_LIST_CREATED_AT_DESC_NON_ARCHIVED_SORT_INDEX_NAME =
  "idx_commission_rule_flat_list_created_at_desc_non_archived_sort";
export const COMMISSION_RULE_FLAT_LIST_RULE_CODE_ASC_NON_ARCHIVED_SORT_INDEX_NAME =
  "idx_commission_rule_flat_list_rule_code_asc_non_archived_sort";
export const COMMISSION_RULE_FLAT_LIST_RULE_CODE_DESC_NON_ARCHIVED_SORT_INDEX_NAME =
  "idx_commission_rule_flat_list_rule_code_desc_non_archived_sort";
export const COMMISSION_RULE_FLAT_LIST_TITLE_ASC_NON_ARCHIVED_SORT_INDEX_NAME =
  "idx_commission_rule_flat_list_title_asc_non_archived_sort";
export const COMMISSION_RULE_FLAT_LIST_TITLE_DESC_NON_ARCHIVED_SORT_INDEX_NAME =
  "idx_commission_rule_flat_list_title_desc_non_archived_sort";

export const COMMISSION_SETTLEMENT_UNIQ_CODE_INDEX_NAME =
  "uniq_commission_settlement_settlement_code";
export const COMMISSION_SETTLEMENT_ACTIVE_BENEFICIARY_REVENUE_ENTRY_UNIQ_INDEX_NAME =
  "uniq_commission_settlement_active_beneficiary_revenue_entry";
export const COMMISSION_SETTLEMENT_NORMALIZED_TITLE_INDEX_NAME =
  "idx_commission_settlement_normalized_title";
export const COMMISSION_SETTLEMENT_SOURCE_RULE_STATUS_PERIOD_INDEX_NAME =
  "idx_commission_settlement_source_rule_status_period";
export const COMMISSION_SETTLEMENT_SUBJECT_STATUS_PERIOD_INDEX_NAME =
  "idx_commission_settlement_subject_status_period";
export const COMMISSION_SETTLEMENT_BENEFICIARY_EMPLOYMENT_STATUS_PERIOD_INDEX_NAME =
  "idx_commission_settlement_beneficiary_employment_status_period";
export const COMMISSION_SETTLEMENT_BENEFICIARY_TALENT_STATUS_PERIOD_INDEX_NAME =
  "idx_commission_settlement_beneficiary_talent_status_period";
export const COMMISSION_SETTLEMENT_REVENUE_ENTRY_STATUS_INDEX_NAME =
  "idx_commission_settlement_revenue_entry_status";
export const COMMISSION_SETTLEMENT_CURRENCY_STATUS_PERIOD_INDEX_NAME =
  "idx_commission_settlement_currency_status_period";
export const COMMISSION_SETTLEMENT_FLAT_LIST_DEFAULT_NON_ARCHIVED_SORT_INDEX_NAME =
  "idx_commission_settlement_flat_list_default_non_archived_sort";
export const COMMISSION_SETTLEMENT_FLAT_LIST_SETTLEMENT_CODE_ASC_NON_ARCHIVED_SORT_INDEX_NAME =
  "idx_commission_settlement_flat_list_settlement_code_asc_non_archived_sort";
export const COMMISSION_SETTLEMENT_FLAT_LIST_SETTLEMENT_CODE_DESC_NON_ARCHIVED_SORT_INDEX_NAME =
  "idx_commission_settlement_flat_list_settlement_code_desc_non_archived_sort";
export const COMMISSION_SETTLEMENT_FLAT_LIST_CREATED_AT_ASC_NON_ARCHIVED_SORT_INDEX_NAME =
  "idx_commission_settlement_flat_list_created_at_asc_non_archived_sort";
export const COMMISSION_SETTLEMENT_FLAT_LIST_CREATED_AT_DESC_NON_ARCHIVED_SORT_INDEX_NAME =
  "idx_commission_settlement_flat_list_created_at_desc_non_archived_sort";
export const COMMISSION_SETTLEMENT_FLAT_LIST_FINALIZED_AT_ASC_NON_ARCHIVED_SORT_INDEX_NAME =
  "idx_commission_settlement_flat_list_finalized_at_asc_non_archived_sort";
export const COMMISSION_SETTLEMENT_FLAT_LIST_FINALIZED_AT_DESC_NON_ARCHIVED_SORT_INDEX_NAME =
  "idx_commission_settlement_flat_list_finalized_at_desc_non_archived_sort";

export const COMMISSION_SETTLEMENT_LINE_UNIQ_SETTLEMENT_REVENUE_ENTRY_INDEX_NAME =
  "uniq_commission_settlement_line_settlement_revenue_entry";
export const COMMISSION_SETTLEMENT_LINE_REVENUE_ENTRY_SETTLEMENT_INDEX_NAME =
  "idx_commission_settlement_line_revenue_entry_settlement";

interface RuleLegacyDocument {
  readonly _id: string;
  readonly title?: unknown;
}

interface SettlementLegacyDocument {
  readonly _id: string;
  readonly title?: unknown;
}

export async function initCommissionIndexes(
  db: Db,
): Promise<void> {
  const ruleCollection =
    db.collection<RuleLegacyDocument>(
      "commission_rules",
    );
  const settlementCollection =
    db.collection<SettlementLegacyDocument>(
      "commission_settlements",
    );

  await backfillNormalizedTitle(ruleCollection);
  await backfillNormalizedTitle(settlementCollection);

  await ruleCollection.createIndex(
    {
      ruleCode: 1,
    },
    {
      name: COMMISSION_RULE_UNIQ_CODE_INDEX_NAME,
      unique: true,
    },
  );

  await ruleCollection.createIndex(
    {
      normalizedTitle: 1,
    },
    {
      name: COMMISSION_RULE_NORMALIZED_TITLE_INDEX_NAME,
    },
  );

  await ruleCollection.createIndex(
    {
      status: 1,
      settlementKind: 1,
      effectiveStartDate: 1,
      effectiveEndDate: 1,
    },
    {
      name:
        COMMISSION_RULE_STATUS_KIND_EFFECTIVE_WINDOW_INDEX_NAME,
    },
  );

  await ruleCollection.createIndex(
    {
      sourceContractRecordId: 1,
    },
    {
      name: COMMISSION_RULE_SOURCE_CONTRACT_INDEX_NAME,
    },
  );

  await ruleCollection.createIndex(
    {
      beneficiaryEmploymentProfileId: 1,
    },
    {
      name:
        COMMISSION_RULE_BENEFICIARY_EMPLOYMENT_INDEX_NAME,
      partialFilterExpression: {
        beneficiaryEmploymentProfileId: {
          $type: "string",
        },
      },
    },
  );

  await ruleCollection.createIndex(
    {
      beneficiaryTalentId: 1,
    },
    {
      name: COMMISSION_RULE_BENEFICIARY_TALENT_INDEX_NAME,
      partialFilterExpression: {
        beneficiaryTalentId: {
          $type: "string",
        },
      },
    },
  );

  await ruleCollection.createIndex(
    {
      appliesToRevenueKinds: 1,
      status: 1,
    },
    {
      name:
        COMMISSION_RULE_REVENUE_KIND_STATUS_INDEX_NAME,
    },
  );

  await ruleCollection.createIndex(
    {
      effectiveStartDate: -1,
      ruleCode: 1,
      _id: 1,
    },
    {
      name:
        COMMISSION_RULE_FLAT_LIST_DEFAULT_NON_ARCHIVED_SORT_INDEX_NAME,
      partialFilterExpression: {
        status: {
          $in: ["DRAFT", "ACTIVE", "INACTIVE"],
        },
      },
    },
  );

  await ruleCollection.createIndex(
    {
      createdAt: 1,
      _id: 1,
    },
    {
      name:
        COMMISSION_RULE_FLAT_LIST_CREATED_AT_ASC_NON_ARCHIVED_SORT_INDEX_NAME,
      partialFilterExpression: {
        status: {
          $in: ["DRAFT", "ACTIVE", "INACTIVE"],
        },
      },
    },
  );

  await ruleCollection.createIndex(
    {
      createdAt: -1,
      _id: 1,
    },
    {
      name:
        COMMISSION_RULE_FLAT_LIST_CREATED_AT_DESC_NON_ARCHIVED_SORT_INDEX_NAME,
      partialFilterExpression: {
        status: {
          $in: ["DRAFT", "ACTIVE", "INACTIVE"],
        },
      },
    },
  );

  await ruleCollection.createIndex(
    {
      ruleCode: 1,
      _id: 1,
    },
    {
      name:
        COMMISSION_RULE_FLAT_LIST_RULE_CODE_ASC_NON_ARCHIVED_SORT_INDEX_NAME,
      partialFilterExpression: {
        status: {
          $in: ["DRAFT", "ACTIVE", "INACTIVE"],
        },
      },
    },
  );

  await ruleCollection.createIndex(
    {
      ruleCode: -1,
      _id: 1,
    },
    {
      name:
        COMMISSION_RULE_FLAT_LIST_RULE_CODE_DESC_NON_ARCHIVED_SORT_INDEX_NAME,
      partialFilterExpression: {
        status: {
          $in: ["DRAFT", "ACTIVE", "INACTIVE"],
        },
      },
    },
  );

  await ruleCollection.createIndex(
    {
      normalizedTitle: 1,
      _id: 1,
    },
    {
      name:
        COMMISSION_RULE_FLAT_LIST_TITLE_ASC_NON_ARCHIVED_SORT_INDEX_NAME,
      partialFilterExpression: {
        status: {
          $in: ["DRAFT", "ACTIVE", "INACTIVE"],
        },
      },
    },
  );

  await ruleCollection.createIndex(
    {
      normalizedTitle: -1,
      _id: 1,
    },
    {
      name:
        COMMISSION_RULE_FLAT_LIST_TITLE_DESC_NON_ARCHIVED_SORT_INDEX_NAME,
      partialFilterExpression: {
        status: {
          $in: ["DRAFT", "ACTIVE", "INACTIVE"],
        },
      },
    },
  );

  await settlementCollection.createIndex(
    {
      settlementCode: 1,
    },
    {
      name:
        COMMISSION_SETTLEMENT_UNIQ_CODE_INDEX_NAME,
      unique: true,
    },
  );

  await settlementCollection.createIndex(
    {
      beneficiaryKindSnapshot: 1,
      beneficiaryEmploymentProfileIdSnapshot: 1,
      beneficiaryTalentIdSnapshot: 1,
      revenueEntryIds: 1,
    },
    {
      name:
        COMMISSION_SETTLEMENT_ACTIVE_BENEFICIARY_REVENUE_ENTRY_UNIQ_INDEX_NAME,
      unique: true,
      partialFilterExpression: {
        status: {
          $in: ["DRAFT", "FINALIZED"],
        },
      },
    },
  );

  await settlementCollection.createIndex(
    {
      normalizedTitle: 1,
    },
    {
      name:
        COMMISSION_SETTLEMENT_NORMALIZED_TITLE_INDEX_NAME,
    },
  );

  await settlementCollection.createIndex(
    {
      sourceRuleId: 1,
      status: 1,
      settlementPeriodStartAt: 1,
      settlementPeriodEndAt: 1,
    },
    {
      name:
        COMMISSION_SETTLEMENT_SOURCE_RULE_STATUS_PERIOD_INDEX_NAME,
    },
  );

  await settlementCollection.createIndex(
    {
      subjectTalentId: 1,
      status: 1,
      settlementPeriodStartAt: 1,
      settlementPeriodEndAt: 1,
    },
    {
      name:
        COMMISSION_SETTLEMENT_SUBJECT_STATUS_PERIOD_INDEX_NAME,
    },
  );

  await settlementCollection.createIndex(
    {
      beneficiaryEmploymentProfileIdSnapshot: 1,
      status: 1,
      settlementPeriodStartAt: 1,
    },
    {
      name:
        COMMISSION_SETTLEMENT_BENEFICIARY_EMPLOYMENT_STATUS_PERIOD_INDEX_NAME,
      partialFilterExpression: {
        beneficiaryEmploymentProfileIdSnapshot: {
          $type: "string",
        },
      },
    },
  );

  await settlementCollection.createIndex(
    {
      beneficiaryTalentIdSnapshot: 1,
      status: 1,
      settlementPeriodStartAt: 1,
    },
    {
      name:
        COMMISSION_SETTLEMENT_BENEFICIARY_TALENT_STATUS_PERIOD_INDEX_NAME,
      partialFilterExpression: {
        beneficiaryTalentIdSnapshot: {
          $type: "string",
        },
      },
    },
  );

  await settlementCollection.createIndex(
    {
      revenueEntryIds: 1,
      status: 1,
    },
    {
      name:
        COMMISSION_SETTLEMENT_REVENUE_ENTRY_STATUS_INDEX_NAME,
    },
  );

  await settlementCollection.createIndex(
    {
      settlementCurrencyCode: 1,
      status: 1,
      settlementPeriodStartAt: 1,
    },
    {
      name:
        COMMISSION_SETTLEMENT_CURRENCY_STATUS_PERIOD_INDEX_NAME,
    },
  );

  await settlementCollection.createIndex(
    {
      settlementPeriodStartAt: -1,
      settlementCode: 1,
      _id: 1,
    },
    {
      name:
        COMMISSION_SETTLEMENT_FLAT_LIST_DEFAULT_NON_ARCHIVED_SORT_INDEX_NAME,
      partialFilterExpression: {
        status: {
          $in: ["DRAFT", "FINALIZED", "VOIDED"],
        },
      },
    },
  );

  await settlementCollection.createIndex(
    {
      settlementCode: 1,
      _id: 1,
    },
    {
      name:
        COMMISSION_SETTLEMENT_FLAT_LIST_SETTLEMENT_CODE_ASC_NON_ARCHIVED_SORT_INDEX_NAME,
      partialFilterExpression: {
        status: {
          $in: ["DRAFT", "FINALIZED", "VOIDED"],
        },
      },
    },
  );

  await settlementCollection.createIndex(
    {
      settlementCode: -1,
      _id: 1,
    },
    {
      name:
        COMMISSION_SETTLEMENT_FLAT_LIST_SETTLEMENT_CODE_DESC_NON_ARCHIVED_SORT_INDEX_NAME,
      partialFilterExpression: {
        status: {
          $in: ["DRAFT", "FINALIZED", "VOIDED"],
        },
      },
    },
  );

  await settlementCollection.createIndex(
    {
      createdAt: 1,
      _id: 1,
    },
    {
      name:
        COMMISSION_SETTLEMENT_FLAT_LIST_CREATED_AT_ASC_NON_ARCHIVED_SORT_INDEX_NAME,
      partialFilterExpression: {
        status: {
          $in: ["DRAFT", "FINALIZED", "VOIDED"],
        },
      },
    },
  );

  await settlementCollection.createIndex(
    {
      createdAt: -1,
      _id: 1,
    },
    {
      name:
        COMMISSION_SETTLEMENT_FLAT_LIST_CREATED_AT_DESC_NON_ARCHIVED_SORT_INDEX_NAME,
      partialFilterExpression: {
        status: {
          $in: ["DRAFT", "FINALIZED", "VOIDED"],
        },
      },
    },
  );

  await settlementCollection.createIndex(
    {
      finalizedAt: 1,
      _id: 1,
    },
    {
      name:
        COMMISSION_SETTLEMENT_FLAT_LIST_FINALIZED_AT_ASC_NON_ARCHIVED_SORT_INDEX_NAME,
      partialFilterExpression: {
        status: {
          $in: ["DRAFT", "FINALIZED", "VOIDED"],
        },
      },
    },
  );

  await settlementCollection.createIndex(
    {
      finalizedAt: -1,
      _id: 1,
    },
    {
      name:
        COMMISSION_SETTLEMENT_FLAT_LIST_FINALIZED_AT_DESC_NON_ARCHIVED_SORT_INDEX_NAME,
      partialFilterExpression: {
        status: {
          $in: ["DRAFT", "FINALIZED", "VOIDED"],
        },
      },
    },
  );

  const settlementLineCollection =
    db.collection("commission_settlement_lines");

  await settlementLineCollection.createIndex(
    {
      settlementId: 1,
      revenueEntryId: 1,
    },
    {
      name:
        COMMISSION_SETTLEMENT_LINE_UNIQ_SETTLEMENT_REVENUE_ENTRY_INDEX_NAME,
      unique: true,
    },
  );

  await settlementLineCollection.createIndex(
    {
      revenueEntryId: 1,
      settlementId: 1,
    },
    {
      name:
        COMMISSION_SETTLEMENT_LINE_REVENUE_ENTRY_SETTLEMENT_INDEX_NAME,
    },
  );
}

async function backfillNormalizedTitle(
  collection: Collection<
    RuleLegacyDocument | SettlementLegacyDocument
  >,
): Promise<void> {
  const cursor = collection.find(
    {
      normalizedTitle: {
        $exists: false,
      },
    },
    {
      projection: {
        _id: 1,
        title: 1,
      },
    },
  );

  const operations: Array<{
    updateOne: {
      filter: Record<string, unknown>;
      update: {
        $set: Record<string, unknown>;
      };
    };
  }> = [];

  for await (const document of cursor) {
    const title =
      typeof document.title === "string"
        ? document.title
        : "";

    operations.push({
      updateOne: {
        filter: {
          _id: document._id,
        },
        update: {
          $set: {
            normalizedTitle:
              canonicalizeSearchToken(title),
          },
        },
      },
    });

    if (operations.length >= 500) {
      await collection.bulkWrite(operations, {
        ordered: true,
      });
      operations.length = 0;
    }
  }

  if (operations.length > 0) {
    await collection.bulkWrite(operations, {
      ordered: true,
    });
  }
}

function canonicalizeSearchToken(
  value: string,
): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();
}
