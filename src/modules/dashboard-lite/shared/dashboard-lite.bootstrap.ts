import { Db } from "mongodb";
import { SystemInvariantError } from "@core/error/system-error";
import {
  COMMISSION_RULE_STATUS_KIND_EFFECTIVE_WINDOW_INDEX_NAME,
} from "@infra/mongo/commission/commission.index";
import {
  DASHBOARD_LITE_CONTRACT_ACTIVE_EFFECTIVE_END_DATE_INDEX_NAME,
  DASHBOARD_LITE_REVENUE_DRAFT_CREATED_AT_INDEX_NAME,
  DASHBOARD_LITE_REVENUE_FINALIZED_FINALIZED_AT_INDEX_NAME,
  DASHBOARD_LITE_REVENUE_RECONCILED_RECONCILED_AT_INDEX_NAME,
  DASHBOARD_LITE_SETTLEMENT_DRAFT_CREATED_AT_INDEX_NAME,
  DASHBOARD_LITE_SETTLEMENT_FINALIZED_FINALIZED_AT_INDEX_NAME,
  initDashboardLiteSupportIndexes,
} from "@infra/mongo/dashboard-lite/dashboard-lite.index";
import {
  EVENT_STATUS_WINDOW_INDEX_NAME,
} from "@infra/mongo/event-assignment/event-assignment.index";
import { registerPresenters } from "./dashboard-lite.presenter.register";
import type { BootstrapRegistrar } from "@bootstrap/module-registrar";

interface IndexMetadata {
  readonly key?: unknown;
  readonly partialFilterExpression?: unknown;
}

export function createDashboardLiteBootstrapRegistrar(): BootstrapRegistrar {
  return Object.freeze({
    name: "dashboard-lite",
    registerPresenters,
    async initIndexes(db: Db): Promise<void> {
      await initDashboardLiteSupportIndexes(db);
    },
    async assertReadiness(db: Db): Promise<void> {
      await assertRequiredIndex(
        db,
        "events",
        EVENT_STATUS_WINDOW_INDEX_NAME,
        {
          status: 1,
          eventStartAt: 1,
          eventEndAt: 1,
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

      await assertRequiredPartialIndex(
        db,
        "contract_records",
        DASHBOARD_LITE_CONTRACT_ACTIVE_EFFECTIVE_END_DATE_INDEX_NAME,
        {
          effectiveEndDate: 1,
        },
        {
          status: "ACTIVE",
          effectiveEndDate: {
            $type: "number",
          },
        },
      );

      await assertRequiredPartialIndex(
        db,
        "revenue_entries",
        DASHBOARD_LITE_REVENUE_DRAFT_CREATED_AT_INDEX_NAME,
        {
          createdAt: 1,
        },
        {
          status: "DRAFT",
        },
      );

      await assertRequiredPartialIndex(
        db,
        "revenue_entries",
        DASHBOARD_LITE_REVENUE_FINALIZED_FINALIZED_AT_INDEX_NAME,
        {
          finalizedAt: 1,
        },
        {
          status: "FINALIZED",
          finalizedAt: {
            $type: "number",
          },
        },
      );

      await assertRequiredPartialIndex(
        db,
        "revenue_entries",
        DASHBOARD_LITE_REVENUE_RECONCILED_RECONCILED_AT_INDEX_NAME,
        {
          reconciledAt: 1,
        },
        {
          status: "RECONCILED",
          reconciledAt: {
            $type: "number",
          },
        },
      );

      await assertRequiredPartialIndex(
        db,
        "commission_settlements",
        DASHBOARD_LITE_SETTLEMENT_DRAFT_CREATED_AT_INDEX_NAME,
        {
          createdAt: 1,
        },
        {
          status: "DRAFT",
        },
      );

      await assertRequiredPartialIndex(
        db,
        "commission_settlements",
        DASHBOARD_LITE_SETTLEMENT_FINALIZED_FINALIZED_AT_INDEX_NAME,
        {
          finalizedAt: 1,
        },
        {
          status: "FINALIZED",
          finalizedAt: {
            $type: "number",
          },
        },
      );
    },
  });
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
