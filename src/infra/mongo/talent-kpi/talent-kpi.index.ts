import {
  Collection,
  Db,
} from "mongodb";

export const TALENT_KPI_RECORD_UNIQ_CODE_INDEX_NAME =
  "uniq_talent_kpi_record_kpi_record_code";
export const TALENT_KPI_RECORD_ACTIVE_MEASUREMENT_IDENTITY_UNIQ_INDEX_NAME =
  "uniq_talent_kpi_record_active_measurement_identity";
export const TALENT_KPI_RECORD_NORMALIZED_KPI_RECORD_CODE_INDEX_NAME =
  "idx_talent_kpi_record_normalized_kpi_record_code";
export const TALENT_KPI_RECORD_NORMALIZED_TITLE_INDEX_NAME =
  "idx_talent_kpi_record_normalized_title";
export const TALENT_KPI_RECORD_SUBJECT_STATUS_PERIOD_INDEX_NAME =
  "idx_talent_kpi_record_subject_status_period";
export const TALENT_KPI_RECORD_PLATFORM_STATUS_PERIOD_INDEX_NAME =
  "idx_talent_kpi_record_platform_status_period";
export const TALENT_KPI_RECORD_EVENT_STATUS_PERIOD_INDEX_NAME =
  "idx_talent_kpi_record_event_status_period";
export const TALENT_KPI_RECORD_MEASUREMENT_SOURCE_STATUS_INDEX_NAME =
  "idx_talent_kpi_record_measurement_source_status";
export const TALENT_KPI_RECORD_FLAT_LIST_DEFAULT_NON_ARCHIVED_SORT_INDEX_NAME =
  "idx_talent_kpi_record_flat_list_default_non_archived_sort";
export const TALENT_KPI_RECORD_FLAT_LIST_CREATED_AT_ASC_NON_ARCHIVED_SORT_INDEX_NAME =
  "idx_talent_kpi_record_flat_list_created_at_asc_non_archived_sort";
export const TALENT_KPI_RECORD_FLAT_LIST_CREATED_AT_DESC_NON_ARCHIVED_SORT_INDEX_NAME =
  "idx_talent_kpi_record_flat_list_created_at_desc_non_archived_sort";

export const TALENT_KPI_METRIC_VALUE_UNIQ_RECORD_METRIC_CODE_INDEX_NAME =
  "uniq_talent_kpi_metric_value_record_metric_code";
export const TALENT_KPI_METRIC_VALUE_METRIC_CODE_RECORD_INDEX_NAME =
  "idx_talent_kpi_metric_value_metric_code_record";

interface TalentKpiRecordLegacyDocument {
  readonly _id: string;
  readonly kpiRecordCode?: unknown;
  readonly title?: unknown;
}

export async function initTalentKpiIndexes(
  db: Db,
): Promise<void> {
  const recordCollection =
    db.collection<TalentKpiRecordLegacyDocument>(
      "talent_kpi_records",
    );

  await backfillNormalizedSearchFields(
    recordCollection,
  );

  await recordCollection.createIndex(
    {
      kpiRecordCode: 1,
    },
    {
      name: TALENT_KPI_RECORD_UNIQ_CODE_INDEX_NAME,
      unique: true,
    },
  );

  await recordCollection.createIndex(
    {
      subjectTalentId: 1,
      attributionPlatformAccountId: 1,
      attributionEventId: 1,
      periodStartAt: 1,
      periodEndAt: 1,
      measurementSource: 1,
    },
    {
      name:
        TALENT_KPI_RECORD_ACTIVE_MEASUREMENT_IDENTITY_UNIQ_INDEX_NAME,
      unique: true,
      partialFilterExpression: {
        status: {
          $ne: "ARCHIVED",
        },
      },
    },
  );

  await recordCollection.createIndex(
    {
      normalizedKpiRecordCode: 1,
      _id: 1,
    },
    {
      name:
        TALENT_KPI_RECORD_NORMALIZED_KPI_RECORD_CODE_INDEX_NAME,
    },
  );

  await recordCollection.createIndex(
    {
      normalizedTitle: 1,
    },
    {
      name:
        TALENT_KPI_RECORD_NORMALIZED_TITLE_INDEX_NAME,
    },
  );

  await recordCollection.createIndex(
    {
      subjectTalentId: 1,
      status: 1,
      periodStartAt: 1,
      periodEndAt: 1,
    },
    {
      name:
        TALENT_KPI_RECORD_SUBJECT_STATUS_PERIOD_INDEX_NAME,
    },
  );

  await recordCollection.createIndex(
    {
      attributionPlatformAccountId: 1,
      status: 1,
      periodStartAt: 1,
      periodEndAt: 1,
    },
    {
      name:
        TALENT_KPI_RECORD_PLATFORM_STATUS_PERIOD_INDEX_NAME,
      partialFilterExpression: {
        attributionPlatformAccountId: {
          $ne: null,
        },
      },
    },
  );

  await recordCollection.createIndex(
    {
      attributionEventId: 1,
      status: 1,
      periodStartAt: 1,
      periodEndAt: 1,
    },
    {
      name:
        TALENT_KPI_RECORD_EVENT_STATUS_PERIOD_INDEX_NAME,
      partialFilterExpression: {
        attributionEventId: {
          $ne: null,
        },
      },
    },
  );

  await recordCollection.createIndex(
    {
      measurementSource: 1,
      status: 1,
    },
    {
      name:
        TALENT_KPI_RECORD_MEASUREMENT_SOURCE_STATUS_INDEX_NAME,
    },
  );

  await recordCollection.createIndex(
    {
      periodStartAt: -1,
      _id: 1,
    },
    {
      name:
        TALENT_KPI_RECORD_FLAT_LIST_DEFAULT_NON_ARCHIVED_SORT_INDEX_NAME,
      partialFilterExpression: {
        status: {
          $ne: "ARCHIVED",
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
        TALENT_KPI_RECORD_FLAT_LIST_CREATED_AT_ASC_NON_ARCHIVED_SORT_INDEX_NAME,
      partialFilterExpression: {
        status: {
          $ne: "ARCHIVED",
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
        TALENT_KPI_RECORD_FLAT_LIST_CREATED_AT_DESC_NON_ARCHIVED_SORT_INDEX_NAME,
      partialFilterExpression: {
        status: {
          $ne: "ARCHIVED",
        },
      },
    },
  );

  const metricCollection = db.collection(
    "talent_kpi_metric_values",
  );

  await metricCollection.createIndex(
    {
      kpiRecordId: 1,
      metricCode: 1,
    },
    {
      name:
        TALENT_KPI_METRIC_VALUE_UNIQ_RECORD_METRIC_CODE_INDEX_NAME,
      unique: true,
    },
  );

  await metricCollection.createIndex(
    {
      metricCode: 1,
      kpiRecordId: 1,
    },
    {
      name:
        TALENT_KPI_METRIC_VALUE_METRIC_CODE_RECORD_INDEX_NAME,
    },
  );
}

async function backfillNormalizedSearchFields(
  collection: Collection<TalentKpiRecordLegacyDocument>,
): Promise<void> {
  const cursor = collection.find(
    {
      $or: [
        {
          normalizedKpiRecordCode: {
            $exists: false,
          },
        },
        {
          normalizedTitle: {
            $exists: false,
          },
        },
      ],
    },
    {
      projection: {
        _id: 1,
        kpiRecordCode: 1,
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
    const kpiRecordCode =
      typeof document.kpiRecordCode === "string"
        ? document.kpiRecordCode
        : "";
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
            normalizedKpiRecordCode:
              canonicalizeSearchToken(
                kpiRecordCode,
              ),
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
