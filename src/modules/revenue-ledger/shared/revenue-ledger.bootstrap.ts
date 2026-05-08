import { Db } from "mongodb";
import { SystemInvariantError } from "@core/error/system-error";
import {
  REVENUE_ENTRY_CURRENCY_CODE_STATUS_RECOGNIZED_AT_INDEX_NAME,
  REVENUE_ENTRY_ENTRY_SOURCE_STATUS_RECOGNIZED_AT_INDEX_NAME,
  REVENUE_ENTRY_EVENT_STATUS_RECOGNIZED_AT_INDEX_NAME,
  REVENUE_ENTRY_FLAT_LIST_CREATED_AT_ASC_NON_ARCHIVED_SORT_INDEX_NAME,
  REVENUE_ENTRY_FLAT_LIST_CREATED_AT_DESC_NON_ARCHIVED_SORT_INDEX_NAME,
  REVENUE_ENTRY_FLAT_LIST_DEFAULT_NON_ARCHIVED_SORT_INDEX_NAME,
  REVENUE_ENTRY_FLAT_LIST_REVENUE_ENTRY_CODE_ASC_NON_ARCHIVED_SORT_INDEX_NAME,
  REVENUE_ENTRY_FLAT_LIST_REVENUE_ENTRY_CODE_DESC_NON_ARCHIVED_SORT_INDEX_NAME,
  REVENUE_ENTRY_NORMALIZED_TITLE_INDEX_NAME,
  REVENUE_ENTRY_PLATFORM_STATUS_RECOGNIZED_AT_INDEX_NAME,
  REVENUE_ENTRY_REVENUE_KIND_STATUS_RECOGNIZED_AT_INDEX_NAME,
  REVENUE_ENTRY_SUBJECT_STATUS_RECOGNIZED_AT_INDEX_NAME,
  REVENUE_ENTRY_UNIQ_CODE_INDEX_NAME,
  initRevenueLedgerIndexes,
} from "@infra/mongo/revenue-ledger/revenue-ledger.index";
import { registerPresenters } from "./revenue-ledger.presenter.register";
import type { BootstrapRegistrar } from "@bootstrap/module-registrar";

interface IndexMetadata {
  readonly key?: unknown;
  readonly unique?: unknown;
  readonly partialFilterExpression?: unknown;
}

export function createRevenueLedgerBootstrapRegistrar(): BootstrapRegistrar {
  return Object.freeze({
    name: "revenue-ledger",
    registerPresenters,
    async initIndexes(db: Db): Promise<void> {
      await initRevenueLedgerIndexes(db);
    },
    async assertReadiness(db: Db): Promise<void> {
      await assertRequiredUniqueIndex(
        db,
        "revenue_entries",
        REVENUE_ENTRY_UNIQ_CODE_INDEX_NAME,
        {
          revenueEntryCode: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "revenue_entries",
        REVENUE_ENTRY_NORMALIZED_TITLE_INDEX_NAME,
        {
          normalizedTitle: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "revenue_entries",
        REVENUE_ENTRY_SUBJECT_STATUS_RECOGNIZED_AT_INDEX_NAME,
        {
          subjectTalentId: 1,
          status: 1,
          recognizedAt: 1,
        },
      );

      await assertRequiredPartialIndex(
        db,
        "revenue_entries",
        REVENUE_ENTRY_PLATFORM_STATUS_RECOGNIZED_AT_INDEX_NAME,
        {
          attributionPlatformAccountId: 1,
          status: 1,
          recognizedAt: 1,
        },
        {
          attributionPlatformAccountId: {
            $ne: null,
          },
        },
      );

      await assertRequiredPartialIndex(
        db,
        "revenue_entries",
        REVENUE_ENTRY_EVENT_STATUS_RECOGNIZED_AT_INDEX_NAME,
        {
          attributionEventId: 1,
          status: 1,
          recognizedAt: 1,
        },
        {
          attributionEventId: {
            $ne: null,
          },
        },
      );

      await assertRequiredIndex(
        db,
        "revenue_entries",
        REVENUE_ENTRY_REVENUE_KIND_STATUS_RECOGNIZED_AT_INDEX_NAME,
        {
          revenueKind: 1,
          status: 1,
          recognizedAt: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "revenue_entries",
        REVENUE_ENTRY_ENTRY_SOURCE_STATUS_RECOGNIZED_AT_INDEX_NAME,
        {
          entrySource: 1,
          status: 1,
          recognizedAt: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "revenue_entries",
        REVENUE_ENTRY_CURRENCY_CODE_STATUS_RECOGNIZED_AT_INDEX_NAME,
        {
          currencyCode: 1,
          status: 1,
          recognizedAt: 1,
        },
      );

      await assertRequiredPartialIndex(
        db,
        "revenue_entries",
        REVENUE_ENTRY_FLAT_LIST_DEFAULT_NON_ARCHIVED_SORT_INDEX_NAME,
        {
          recognizedAt: -1,
          _id: 1,
        },
        {
          status: {
            $ne: "ARCHIVED",
          },
        },
      );

      await assertRequiredPartialIndex(
        db,
        "revenue_entries",
        REVENUE_ENTRY_FLAT_LIST_CREATED_AT_ASC_NON_ARCHIVED_SORT_INDEX_NAME,
        {
          createdAt: 1,
          _id: 1,
        },
        {
          status: {
            $ne: "ARCHIVED",
          },
        },
      );

      await assertRequiredPartialIndex(
        db,
        "revenue_entries",
        REVENUE_ENTRY_FLAT_LIST_CREATED_AT_DESC_NON_ARCHIVED_SORT_INDEX_NAME,
        {
          createdAt: -1,
          _id: 1,
        },
        {
          status: {
            $ne: "ARCHIVED",
          },
        },
      );

      await assertRequiredPartialIndex(
        db,
        "revenue_entries",
        REVENUE_ENTRY_FLAT_LIST_REVENUE_ENTRY_CODE_ASC_NON_ARCHIVED_SORT_INDEX_NAME,
        {
          revenueEntryCode: 1,
          _id: 1,
        },
        {
          status: {
            $ne: "ARCHIVED",
          },
        },
      );

      await assertRequiredPartialIndex(
        db,
        "revenue_entries",
        REVENUE_ENTRY_FLAT_LIST_REVENUE_ENTRY_CODE_DESC_NON_ARCHIVED_SORT_INDEX_NAME,
        {
          revenueEntryCode: -1,
          _id: 1,
        },
        {
          status: {
            $ne: "ARCHIVED",
          },
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
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    typeof expected !== "object" ||
    expected === null
  ) {
    return Object.is(candidate, expected);
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
