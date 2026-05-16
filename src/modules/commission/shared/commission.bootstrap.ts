import { Db } from "mongodb";
import { SystemInvariantError } from "@core/error/system-error";
import {
  COMMISSION_RULE_BENEFICIARY_EMPLOYMENT_INDEX_NAME,
  COMMISSION_RULE_BENEFICIARY_TALENT_INDEX_NAME,
  COMMISSION_RULE_FLAT_LIST_CREATED_AT_ASC_NON_ARCHIVED_SORT_INDEX_NAME,
  COMMISSION_RULE_FLAT_LIST_CREATED_AT_DESC_NON_ARCHIVED_SORT_INDEX_NAME,
  COMMISSION_RULE_FLAT_LIST_DEFAULT_NON_ARCHIVED_SORT_INDEX_NAME,
  COMMISSION_RULE_FLAT_LIST_RULE_CODE_ASC_NON_ARCHIVED_SORT_INDEX_NAME,
  COMMISSION_RULE_FLAT_LIST_RULE_CODE_DESC_NON_ARCHIVED_SORT_INDEX_NAME,
  COMMISSION_RULE_FLAT_LIST_TITLE_ASC_NON_ARCHIVED_SORT_INDEX_NAME,
  COMMISSION_RULE_FLAT_LIST_TITLE_DESC_NON_ARCHIVED_SORT_INDEX_NAME,
  COMMISSION_RULE_NORMALIZED_TITLE_INDEX_NAME,
  COMMISSION_RULE_REVENUE_KIND_STATUS_INDEX_NAME,
  COMMISSION_RULE_SOURCE_CONTRACT_INDEX_NAME,
  COMMISSION_RULE_STATUS_KIND_EFFECTIVE_WINDOW_INDEX_NAME,
  COMMISSION_RULE_UNIQ_CODE_INDEX_NAME,
  COMMISSION_SETTLEMENT_ACTIVE_BENEFICIARY_REVENUE_ENTRY_UNIQ_INDEX_NAME,
  COMMISSION_SETTLEMENT_BENEFICIARY_EMPLOYMENT_STATUS_PERIOD_INDEX_NAME,
  COMMISSION_SETTLEMENT_BENEFICIARY_TALENT_STATUS_PERIOD_INDEX_NAME,
  COMMISSION_SETTLEMENT_CURRENCY_STATUS_PERIOD_INDEX_NAME,
  COMMISSION_SETTLEMENT_FLAT_LIST_CREATED_AT_ASC_NON_ARCHIVED_SORT_INDEX_NAME,
  COMMISSION_SETTLEMENT_FLAT_LIST_CREATED_AT_DESC_NON_ARCHIVED_SORT_INDEX_NAME,
  COMMISSION_SETTLEMENT_FLAT_LIST_DEFAULT_NON_ARCHIVED_SORT_INDEX_NAME,
  COMMISSION_SETTLEMENT_FLAT_LIST_FINALIZED_AT_ASC_NON_ARCHIVED_SORT_INDEX_NAME,
  COMMISSION_SETTLEMENT_FLAT_LIST_FINALIZED_AT_DESC_NON_ARCHIVED_SORT_INDEX_NAME,
  COMMISSION_SETTLEMENT_FLAT_LIST_SETTLEMENT_CODE_ASC_NON_ARCHIVED_SORT_INDEX_NAME,
  COMMISSION_SETTLEMENT_FLAT_LIST_SETTLEMENT_CODE_DESC_NON_ARCHIVED_SORT_INDEX_NAME,
  COMMISSION_SETTLEMENT_LINE_REVENUE_ENTRY_SETTLEMENT_INDEX_NAME,
  COMMISSION_SETTLEMENT_LINE_UNIQ_SETTLEMENT_REVENUE_ENTRY_INDEX_NAME,
  COMMISSION_SETTLEMENT_NORMALIZED_TITLE_INDEX_NAME,
  COMMISSION_SETTLEMENT_REVENUE_ENTRY_STATUS_INDEX_NAME,
  COMMISSION_SETTLEMENT_SOURCE_RULE_STATUS_PERIOD_INDEX_NAME,
  COMMISSION_SETTLEMENT_SUBJECT_STATUS_PERIOD_INDEX_NAME,
  COMMISSION_SETTLEMENT_UNIQ_CODE_INDEX_NAME,
  initCommissionIndexes,
} from "@infra/mongo/commission/commission.index";
import { registerPresenters } from "./commission.presenter.register";
import type { BootstrapRegistrar } from "@bootstrap/module-registrar";

interface IndexMetadata {
  readonly key?: unknown;
  readonly unique?: unknown;
  readonly partialFilterExpression?: unknown;
}

export function createCommissionBootstrapRegistrar(): BootstrapRegistrar {
  return Object.freeze({
    name: "commission",
    registerPresenters,
    async initIndexes(db: Db): Promise<void> {
      await initCommissionIndexes(db);
    },
    async assertReadiness(db: Db): Promise<void> {
      await assertRequiredUniqueIndex(
        db,
        "commission_rules",
        COMMISSION_RULE_UNIQ_CODE_INDEX_NAME,
        {
          ruleCode: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "commission_rules",
        COMMISSION_RULE_NORMALIZED_TITLE_INDEX_NAME,
        {
          normalizedTitle: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "commission_rules",
        COMMISSION_RULE_STATUS_KIND_EFFECTIVE_WINDOW_INDEX_NAME,
        {
          status: 1,
          settlementKind: 1,
          effectiveStartDate: 1,
          effectiveEndDate: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "commission_rules",
        COMMISSION_RULE_SOURCE_CONTRACT_INDEX_NAME,
        {
          sourceContractRecordId: 1,
        },
      );

      await assertRequiredPartialIndex(
        db,
        "commission_rules",
        COMMISSION_RULE_BENEFICIARY_EMPLOYMENT_INDEX_NAME,
        {
          beneficiaryEmploymentProfileId: 1,
        },
        {
          beneficiaryEmploymentProfileId: {
            $type: "string",
          },
        },
      );

      await assertRequiredPartialIndex(
        db,
        "commission_rules",
        COMMISSION_RULE_BENEFICIARY_TALENT_INDEX_NAME,
        {
          beneficiaryTalentId: 1,
        },
        {
          beneficiaryTalentId: {
            $type: "string",
          },
        },
      );

      await assertRequiredIndex(
        db,
        "commission_rules",
        COMMISSION_RULE_REVENUE_KIND_STATUS_INDEX_NAME,
        {
          appliesToRevenueKinds: 1,
          status: 1,
        },
      );

      await assertRequiredPartialIndex(
        db,
        "commission_rules",
        COMMISSION_RULE_FLAT_LIST_DEFAULT_NON_ARCHIVED_SORT_INDEX_NAME,
        {
          effectiveStartDate: -1,
          ruleCode: 1,
          _id: 1,
        },
        {
          status: {
            $in: ["DRAFT", "ACTIVE", "INACTIVE"],
          },
        },
      );

      await assertRequiredPartialIndex(
        db,
        "commission_rules",
        COMMISSION_RULE_FLAT_LIST_CREATED_AT_ASC_NON_ARCHIVED_SORT_INDEX_NAME,
        {
          createdAt: 1,
          _id: 1,
        },
        {
          status: {
            $in: ["DRAFT", "ACTIVE", "INACTIVE"],
          },
        },
      );

      await assertRequiredPartialIndex(
        db,
        "commission_rules",
        COMMISSION_RULE_FLAT_LIST_CREATED_AT_DESC_NON_ARCHIVED_SORT_INDEX_NAME,
        {
          createdAt: -1,
          _id: 1,
        },
        {
          status: {
            $in: ["DRAFT", "ACTIVE", "INACTIVE"],
          },
        },
      );

      await assertRequiredPartialIndex(
        db,
        "commission_rules",
        COMMISSION_RULE_FLAT_LIST_RULE_CODE_ASC_NON_ARCHIVED_SORT_INDEX_NAME,
        {
          ruleCode: 1,
          _id: 1,
        },
        {
          status: {
            $in: ["DRAFT", "ACTIVE", "INACTIVE"],
          },
        },
      );

      await assertRequiredPartialIndex(
        db,
        "commission_rules",
        COMMISSION_RULE_FLAT_LIST_RULE_CODE_DESC_NON_ARCHIVED_SORT_INDEX_NAME,
        {
          ruleCode: -1,
          _id: 1,
        },
        {
          status: {
            $in: ["DRAFT", "ACTIVE", "INACTIVE"],
          },
        },
      );

      await assertRequiredPartialIndex(
        db,
        "commission_rules",
        COMMISSION_RULE_FLAT_LIST_TITLE_ASC_NON_ARCHIVED_SORT_INDEX_NAME,
        {
          normalizedTitle: 1,
          _id: 1,
        },
        {
          status: {
            $in: ["DRAFT", "ACTIVE", "INACTIVE"],
          },
        },
      );

      await assertRequiredPartialIndex(
        db,
        "commission_rules",
        COMMISSION_RULE_FLAT_LIST_TITLE_DESC_NON_ARCHIVED_SORT_INDEX_NAME,
        {
          normalizedTitle: -1,
          _id: 1,
        },
        {
          status: {
            $in: ["DRAFT", "ACTIVE", "INACTIVE"],
          },
        },
      );

      await assertRequiredUniqueIndex(
        db,
        "commission_settlements",
        COMMISSION_SETTLEMENT_UNIQ_CODE_INDEX_NAME,
        {
          settlementCode: 1,
        },
      );

      await assertRequiredUniquePartialIndex(
        db,
        "commission_settlements",
        COMMISSION_SETTLEMENT_ACTIVE_BENEFICIARY_REVENUE_ENTRY_UNIQ_INDEX_NAME,
        {
          beneficiaryKindSnapshot: 1,
          beneficiaryEmploymentProfileIdSnapshot: 1,
          beneficiaryTalentIdSnapshot: 1,
          revenueEntryIds: 1,
        },
        {
          status: {
            $in: ["DRAFT", "FINALIZED"],
          },
        },
      );

      await assertRequiredIndex(
        db,
        "commission_settlements",
        COMMISSION_SETTLEMENT_NORMALIZED_TITLE_INDEX_NAME,
        {
          normalizedTitle: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "commission_settlements",
        COMMISSION_SETTLEMENT_SOURCE_RULE_STATUS_PERIOD_INDEX_NAME,
        {
          sourceRuleId: 1,
          status: 1,
          settlementPeriodStartAt: 1,
          settlementPeriodEndAt: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "commission_settlements",
        COMMISSION_SETTLEMENT_SUBJECT_STATUS_PERIOD_INDEX_NAME,
        {
          subjectTalentId: 1,
          status: 1,
          settlementPeriodStartAt: 1,
          settlementPeriodEndAt: 1,
        },
      );

      await assertRequiredPartialIndex(
        db,
        "commission_settlements",
        COMMISSION_SETTLEMENT_BENEFICIARY_EMPLOYMENT_STATUS_PERIOD_INDEX_NAME,
        {
          beneficiaryEmploymentProfileIdSnapshot: 1,
          status: 1,
          settlementPeriodStartAt: 1,
        },
        {
          beneficiaryEmploymentProfileIdSnapshot: {
            $type: "string",
          },
        },
      );

      await assertRequiredPartialIndex(
        db,
        "commission_settlements",
        COMMISSION_SETTLEMENT_BENEFICIARY_TALENT_STATUS_PERIOD_INDEX_NAME,
        {
          beneficiaryTalentIdSnapshot: 1,
          status: 1,
          settlementPeriodStartAt: 1,
        },
        {
          beneficiaryTalentIdSnapshot: {
            $type: "string",
          },
        },
      );

      await assertRequiredIndex(
        db,
        "commission_settlements",
        COMMISSION_SETTLEMENT_REVENUE_ENTRY_STATUS_INDEX_NAME,
        {
          revenueEntryIds: 1,
          status: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "commission_settlements",
        COMMISSION_SETTLEMENT_CURRENCY_STATUS_PERIOD_INDEX_NAME,
        {
          settlementCurrencyCode: 1,
          status: 1,
          settlementPeriodStartAt: 1,
        },
      );

      await assertRequiredPartialIndex(
        db,
        "commission_settlements",
        COMMISSION_SETTLEMENT_FLAT_LIST_DEFAULT_NON_ARCHIVED_SORT_INDEX_NAME,
        {
          settlementPeriodStartAt: -1,
          settlementCode: 1,
          _id: 1,
        },
        {
          status: {
            $in: ["DRAFT", "FINALIZED", "VOIDED"],
          },
        },
      );

      await assertRequiredPartialIndex(
        db,
        "commission_settlements",
        COMMISSION_SETTLEMENT_FLAT_LIST_SETTLEMENT_CODE_ASC_NON_ARCHIVED_SORT_INDEX_NAME,
        {
          settlementCode: 1,
          _id: 1,
        },
        {
          status: {
            $in: ["DRAFT", "FINALIZED", "VOIDED"],
          },
        },
      );

      await assertRequiredPartialIndex(
        db,
        "commission_settlements",
        COMMISSION_SETTLEMENT_FLAT_LIST_SETTLEMENT_CODE_DESC_NON_ARCHIVED_SORT_INDEX_NAME,
        {
          settlementCode: -1,
          _id: 1,
        },
        {
          status: {
            $in: ["DRAFT", "FINALIZED", "VOIDED"],
          },
        },
      );

      await assertRequiredPartialIndex(
        db,
        "commission_settlements",
        COMMISSION_SETTLEMENT_FLAT_LIST_CREATED_AT_ASC_NON_ARCHIVED_SORT_INDEX_NAME,
        {
          createdAt: 1,
          _id: 1,
        },
        {
          status: {
            $in: ["DRAFT", "FINALIZED", "VOIDED"],
          },
        },
      );

      await assertRequiredPartialIndex(
        db,
        "commission_settlements",
        COMMISSION_SETTLEMENT_FLAT_LIST_CREATED_AT_DESC_NON_ARCHIVED_SORT_INDEX_NAME,
        {
          createdAt: -1,
          _id: 1,
        },
        {
          status: {
            $in: ["DRAFT", "FINALIZED", "VOIDED"],
          },
        },
      );

      await assertRequiredPartialIndex(
        db,
        "commission_settlements",
        COMMISSION_SETTLEMENT_FLAT_LIST_FINALIZED_AT_ASC_NON_ARCHIVED_SORT_INDEX_NAME,
        {
          finalizedAt: 1,
          _id: 1,
        },
        {
          status: {
            $in: ["DRAFT", "FINALIZED", "VOIDED"],
          },
        },
      );

      await assertRequiredPartialIndex(
        db,
        "commission_settlements",
        COMMISSION_SETTLEMENT_FLAT_LIST_FINALIZED_AT_DESC_NON_ARCHIVED_SORT_INDEX_NAME,
        {
          finalizedAt: -1,
          _id: 1,
        },
        {
          status: {
            $in: ["DRAFT", "FINALIZED", "VOIDED"],
          },
        },
      );

      await assertRequiredUniqueIndex(
        db,
        "commission_settlement_lines",
        COMMISSION_SETTLEMENT_LINE_UNIQ_SETTLEMENT_REVENUE_ENTRY_INDEX_NAME,
        {
          settlementId: 1,
          revenueEntryId: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "commission_settlement_lines",
        COMMISSION_SETTLEMENT_LINE_REVENUE_ENTRY_SETTLEMENT_INDEX_NAME,
        {
          revenueEntryId: 1,
          settlementId: 1,
        },
      );
    },
  });
}

async function assertRequiredUniqueIndex(
  db: Db,
  collectionName: string,
  indexName: string,
  expectedKey: Record<string, number>,
): Promise<void> {
  const matched = await assertRequiredIndex(
    db,
    collectionName,
    indexName,
    expectedKey,
  );

  if (matched.unique !== true) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      `Required index ${indexName} on ${collectionName} must be unique`,
    );
  }
}

async function assertRequiredUniquePartialIndex(
  db: Db,
  collectionName: string,
  indexName: string,
  expectedKey: Record<string, number>,
  expectedPartialFilterExpression: Record<string, unknown>,
): Promise<void> {
  const matched = await assertRequiredIndex(
    db,
    collectionName,
    indexName,
    expectedKey,
  );

  if (matched.unique !== true) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      `Required index ${indexName} on ${collectionName} must be unique`,
    );
  }

  if (
    !hasDeepExactShape(
      matched.partialFilterExpression,
      expectedPartialFilterExpression,
    )
  ) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      `Required index ${indexName} on ${collectionName} has invalid partialFilterExpression`,
    );
  }
}

async function assertRequiredPartialIndex(
  db: Db,
  collectionName: string,
  indexName: string,
  expectedKey: Record<string, number>,
  expectedPartialFilterExpression: Record<string, unknown>,
): Promise<void> {
  const matched = await assertRequiredIndex(
    db,
    collectionName,
    indexName,
    expectedKey,
  );

  if (
    !hasDeepExactShape(
      matched.partialFilterExpression,
      expectedPartialFilterExpression,
    )
  ) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      `Required index ${indexName} on ${collectionName} has invalid partialFilterExpression`,
    );
  }
}

async function assertRequiredIndex(
  db: Db,
  collectionName: string,
  indexName: string,
  expectedKey: Record<string, number>,
): Promise<IndexMetadata> {
  const indexes = await db
    .collection(collectionName)
    .indexes();
  const matched = indexes.find((index) => {
    const name =
      typeof index.name === "string"
        ? index.name
        : undefined;

    return name === indexName;
  });

  if (!matched) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      `Required index ${indexName} missing on ${collectionName}`,
    );
  }

  if (!hasDeepExactShape(matched.key, expectedKey)) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      `Required index ${indexName} on ${collectionName} has invalid key shape`,
    );
  }

  return matched as IndexMetadata;
}

function hasDeepExactShape(
  candidate: unknown,
  expected: unknown,
): boolean {
  if (Object.is(candidate, expected)) {
    return true;
  }

  if (
    Array.isArray(candidate) &&
    Array.isArray(expected)
  ) {
    if (candidate.length !== expected.length) {
      return false;
    }

    return candidate.every((entry, index) =>
      hasDeepExactShape(entry, expected[index]),
    );
  }

  if (
    typeof candidate !== "object" ||
    candidate === null ||
    typeof expected !== "object" ||
    expected === null
  ) {
    return false;
  }

  if (
    Array.isArray(candidate) ||
    Array.isArray(expected)
  ) {
    return false;
  }

  const candidateRecord = candidate as Record<
    string,
    unknown
  >;
  const expectedRecord = expected as Record<
    string,
    unknown
  >;
  const candidateKeys = Object.keys(candidateRecord);
  const expectedKeys = Object.keys(expectedRecord);

  if (candidateKeys.length !== expectedKeys.length) {
    return false;
  }

  for (const key of expectedKeys) {
    if (
      !Object.prototype.hasOwnProperty.call(
        candidateRecord,
        key,
      ) ||
      !hasDeepExactShape(
        candidateRecord[key],
        expectedRecord[key],
      )
    ) {
      return false;
    }
  }

  return true;
}
