import { Db } from "mongodb";
import { SystemInvariantError } from "@core/error/system-error";
import {
  TALENT_KPI_METRIC_VALUE_METRIC_CODE_RECORD_INDEX_NAME,
  TALENT_KPI_METRIC_VALUE_UNIQ_RECORD_METRIC_CODE_INDEX_NAME,
  TALENT_KPI_RECORD_ACTIVE_MEASUREMENT_IDENTITY_UNIQ_INDEX_NAME,
  TALENT_KPI_RECORD_FLAT_LIST_CREATED_AT_ASC_NON_ARCHIVED_SORT_INDEX_NAME,
  TALENT_KPI_RECORD_FLAT_LIST_CREATED_AT_DESC_NON_ARCHIVED_SORT_INDEX_NAME,
  TALENT_KPI_RECORD_FLAT_LIST_DEFAULT_NON_ARCHIVED_SORT_INDEX_NAME,
  TALENT_KPI_RECORD_EVENT_STATUS_PERIOD_INDEX_NAME,
  TALENT_KPI_RECORD_MEASUREMENT_SOURCE_STATUS_INDEX_NAME,
  TALENT_KPI_RECORD_NORMALIZED_KPI_RECORD_CODE_INDEX_NAME,
  TALENT_KPI_RECORD_NORMALIZED_TITLE_INDEX_NAME,
  TALENT_KPI_RECORD_PLATFORM_STATUS_PERIOD_INDEX_NAME,
  TALENT_KPI_RECORD_SUBJECT_STATUS_PERIOD_INDEX_NAME,
  TALENT_KPI_RECORD_UNIQ_CODE_INDEX_NAME,
  initTalentKpiIndexes,
} from "@infra/mongo/talent-kpi/talent-kpi.index";
import { registerPresenters } from "./talent-kpi.presenter.register";
import type { BootstrapRegistrar } from "@bootstrap/module-registrar";

interface IndexMetadata {
  readonly key?: unknown;
  readonly unique?: unknown;
  readonly partialFilterExpression?: unknown;
}

export function createTalentKpiBootstrapRegistrar(): BootstrapRegistrar {
  return Object.freeze({
    name: "talent-kpi",
    registerPresenters,
    async initIndexes(db: Db): Promise<void> {
      await initTalentKpiIndexes(db);
    },
    async assertReadiness(db: Db): Promise<void> {
      await assertRequiredUniqueIndex(
        db,
        "talent_kpi_records",
        TALENT_KPI_RECORD_UNIQ_CODE_INDEX_NAME,
        {
          kpiRecordCode: 1,
        },
      );

      await assertRequiredUniquePartialIndex(
        db,
        "talent_kpi_records",
        TALENT_KPI_RECORD_ACTIVE_MEASUREMENT_IDENTITY_UNIQ_INDEX_NAME,
        {
          subjectTalentId: 1,
          attributionPlatformAccountId: 1,
          attributionEventId: 1,
          periodStartAt: 1,
          periodEndAt: 1,
          measurementSource: 1,
        },
        {
          status: {
            $ne: "ARCHIVED",
          },
        },
      );

      await assertRequiredIndex(
        db,
        "talent_kpi_records",
        TALENT_KPI_RECORD_NORMALIZED_KPI_RECORD_CODE_INDEX_NAME,
        {
          normalizedKpiRecordCode: 1,
          _id: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "talent_kpi_records",
        TALENT_KPI_RECORD_NORMALIZED_TITLE_INDEX_NAME,
        {
          normalizedTitle: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "talent_kpi_records",
        TALENT_KPI_RECORD_SUBJECT_STATUS_PERIOD_INDEX_NAME,
        {
          subjectTalentId: 1,
          status: 1,
          periodStartAt: 1,
          periodEndAt: 1,
        },
      );

      await assertRequiredPartialIndex(
        db,
        "talent_kpi_records",
        TALENT_KPI_RECORD_PLATFORM_STATUS_PERIOD_INDEX_NAME,
        {
          attributionPlatformAccountId: 1,
          status: 1,
          periodStartAt: 1,
          periodEndAt: 1,
        },
        {
          attributionPlatformAccountId: {
            $ne: null,
          },
        },
      );

      await assertRequiredPartialIndex(
        db,
        "talent_kpi_records",
        TALENT_KPI_RECORD_EVENT_STATUS_PERIOD_INDEX_NAME,
        {
          attributionEventId: 1,
          status: 1,
          periodStartAt: 1,
          periodEndAt: 1,
        },
        {
          attributionEventId: {
            $ne: null,
          },
        },
      );

      await assertRequiredIndex(
        db,
        "talent_kpi_records",
        TALENT_KPI_RECORD_MEASUREMENT_SOURCE_STATUS_INDEX_NAME,
        {
          measurementSource: 1,
          status: 1,
        },
      );

      await assertRequiredPartialIndex(
        db,
        "talent_kpi_records",
        TALENT_KPI_RECORD_FLAT_LIST_DEFAULT_NON_ARCHIVED_SORT_INDEX_NAME,
        {
          periodStartAt: -1,
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
        "talent_kpi_records",
        TALENT_KPI_RECORD_FLAT_LIST_CREATED_AT_ASC_NON_ARCHIVED_SORT_INDEX_NAME,
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
        "talent_kpi_records",
        TALENT_KPI_RECORD_FLAT_LIST_CREATED_AT_DESC_NON_ARCHIVED_SORT_INDEX_NAME,
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

      await assertRequiredUniqueIndex(
        db,
        "talent_kpi_metric_values",
        TALENT_KPI_METRIC_VALUE_UNIQ_RECORD_METRIC_CODE_INDEX_NAME,
        {
          kpiRecordId: 1,
          metricCode: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "talent_kpi_metric_values",
        TALENT_KPI_METRIC_VALUE_METRIC_CODE_RECORD_INDEX_NAME,
        {
          metricCode: 1,
          kpiRecordId: 1,
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
