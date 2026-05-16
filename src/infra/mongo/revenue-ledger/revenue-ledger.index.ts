import {
  Collection,
  Db,
} from "mongodb";

export const REVENUE_ENTRY_UNIQ_CODE_INDEX_NAME =
  "uniq_revenue_entry_revenue_entry_code";
export const REVENUE_ENTRY_NORMALIZED_TITLE_INDEX_NAME =
  "idx_revenue_entry_normalized_title";
export const REVENUE_ENTRY_SUBJECT_STATUS_RECOGNIZED_AT_INDEX_NAME =
  "idx_revenue_entry_subject_status_recognized_at";
export const REVENUE_ENTRY_PLATFORM_STATUS_RECOGNIZED_AT_INDEX_NAME =
  "idx_revenue_entry_platform_status_recognized_at";
export const REVENUE_ENTRY_EVENT_STATUS_RECOGNIZED_AT_INDEX_NAME =
  "idx_revenue_entry_event_status_recognized_at";
export const REVENUE_ENTRY_REVENUE_KIND_STATUS_RECOGNIZED_AT_INDEX_NAME =
  "idx_revenue_entry_revenue_kind_status_recognized_at";
export const REVENUE_ENTRY_ENTRY_SOURCE_STATUS_RECOGNIZED_AT_INDEX_NAME =
  "idx_revenue_entry_entry_source_status_recognized_at";
export const REVENUE_ENTRY_CURRENCY_CODE_STATUS_RECOGNIZED_AT_INDEX_NAME =
  "idx_revenue_entry_currency_code_status_recognized_at";
export const REVENUE_ENTRY_FLAT_LIST_DEFAULT_NON_ARCHIVED_SORT_INDEX_NAME =
  "idx_revenue_entry_flat_list_default_non_archived_sort";
export const REVENUE_ENTRY_FLAT_LIST_CREATED_AT_ASC_NON_ARCHIVED_SORT_INDEX_NAME =
  "idx_revenue_entry_flat_list_created_at_asc_non_archived_sort";
export const REVENUE_ENTRY_FLAT_LIST_CREATED_AT_DESC_NON_ARCHIVED_SORT_INDEX_NAME =
  "idx_revenue_entry_flat_list_created_at_desc_non_archived_sort";
export const REVENUE_ENTRY_FLAT_LIST_REVENUE_ENTRY_CODE_ASC_NON_ARCHIVED_SORT_INDEX_NAME =
  "idx_revenue_entry_flat_list_revenue_entry_code_asc_non_archived_sort";
export const REVENUE_ENTRY_FLAT_LIST_REVENUE_ENTRY_CODE_DESC_NON_ARCHIVED_SORT_INDEX_NAME =
  "idx_revenue_entry_flat_list_revenue_entry_code_desc_non_archived_sort";

interface RevenueEntryLegacyDocument {
  readonly _id: string;
  readonly title?: unknown;
}

export async function initRevenueLedgerIndexes(
  db: Db,
): Promise<void> {
  const recordCollection =
    db.collection<RevenueEntryLegacyDocument>(
      "revenue_entries",
    );

  await backfillNormalizedSearchFields(
    recordCollection,
  );

  await recordCollection.createIndex(
    {
      revenueEntryCode: 1,
    },
    {
      name: REVENUE_ENTRY_UNIQ_CODE_INDEX_NAME,
      unique: true,
    },
  );

  await recordCollection.createIndex(
    {
      normalizedTitle: 1,
    },
    {
      name: REVENUE_ENTRY_NORMALIZED_TITLE_INDEX_NAME,
    },
  );

  await recordCollection.createIndex(
    {
      subjectTalentId: 1,
      status: 1,
      recognizedAt: 1,
    },
    {
      name:
        REVENUE_ENTRY_SUBJECT_STATUS_RECOGNIZED_AT_INDEX_NAME,
    },
  );

  await recordCollection.createIndex(
    {
      attributionPlatformAccountId: 1,
      status: 1,
      recognizedAt: 1,
    },
    {
      name:
        REVENUE_ENTRY_PLATFORM_STATUS_RECOGNIZED_AT_INDEX_NAME,
      partialFilterExpression: {
        attributionPlatformAccountId: {
          $type: "string",
        },
      },
    },
  );

  await recordCollection.createIndex(
    {
      attributionEventId: 1,
      status: 1,
      recognizedAt: 1,
    },
    {
      name:
        REVENUE_ENTRY_EVENT_STATUS_RECOGNIZED_AT_INDEX_NAME,
      partialFilterExpression: {
        attributionEventId: {
          $type: "string",
        },
      },
    },
  );

  await recordCollection.createIndex(
    {
      revenueKind: 1,
      status: 1,
      recognizedAt: 1,
    },
    {
      name:
        REVENUE_ENTRY_REVENUE_KIND_STATUS_RECOGNIZED_AT_INDEX_NAME,
    },
  );

  await recordCollection.createIndex(
    {
      entrySource: 1,
      status: 1,
      recognizedAt: 1,
    },
    {
      name:
        REVENUE_ENTRY_ENTRY_SOURCE_STATUS_RECOGNIZED_AT_INDEX_NAME,
    },
  );

  await recordCollection.createIndex(
    {
      currencyCode: 1,
      status: 1,
      recognizedAt: 1,
    },
    {
      name:
        REVENUE_ENTRY_CURRENCY_CODE_STATUS_RECOGNIZED_AT_INDEX_NAME,
    },
  );

  await recordCollection.createIndex(
    {
      recognizedAt: -1,
      _id: 1,
    },
    {
      name:
        REVENUE_ENTRY_FLAT_LIST_DEFAULT_NON_ARCHIVED_SORT_INDEX_NAME,
      partialFilterExpression: {
        status: {
          $in: [
            "DRAFT",
            "FINALIZED",
            "RECONCILED",
            "VOIDED",
          ],
        },
      },
    },
  );

  await recordCollection.createIndex(
    {
      createdAt: 1,
      _id: 1,
    },
    {
      name:
        REVENUE_ENTRY_FLAT_LIST_CREATED_AT_ASC_NON_ARCHIVED_SORT_INDEX_NAME,
      partialFilterExpression: {
        status: {
          $in: [
            "DRAFT",
            "FINALIZED",
            "RECONCILED",
            "VOIDED",
          ],
        },
      },
    },
  );

  await recordCollection.createIndex(
    {
      createdAt: -1,
      _id: 1,
    },
    {
      name:
        REVENUE_ENTRY_FLAT_LIST_CREATED_AT_DESC_NON_ARCHIVED_SORT_INDEX_NAME,
      partialFilterExpression: {
        status: {
          $in: [
            "DRAFT",
            "FINALIZED",
            "RECONCILED",
            "VOIDED",
          ],
        },
      },
    },
  );

  await recordCollection.createIndex(
    {
      revenueEntryCode: 1,
      _id: 1,
    },
    {
      name:
        REVENUE_ENTRY_FLAT_LIST_REVENUE_ENTRY_CODE_ASC_NON_ARCHIVED_SORT_INDEX_NAME,
      partialFilterExpression: {
        status: {
          $in: [
            "DRAFT",
            "FINALIZED",
            "RECONCILED",
            "VOIDED",
          ],
        },
      },
    },
  );

  await recordCollection.createIndex(
    {
      revenueEntryCode: -1,
      _id: 1,
    },
    {
      name:
        REVENUE_ENTRY_FLAT_LIST_REVENUE_ENTRY_CODE_DESC_NON_ARCHIVED_SORT_INDEX_NAME,
      partialFilterExpression: {
        status: {
          $in: [
            "DRAFT",
            "FINALIZED",
            "RECONCILED",
            "VOIDED",
          ],
        },
      },
    },
  );
}

async function backfillNormalizedSearchFields(
  collection: Collection<RevenueEntryLegacyDocument>,
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
