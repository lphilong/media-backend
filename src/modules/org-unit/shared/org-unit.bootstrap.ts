import { Db } from "mongodb";
import { SystemInvariantError } from "@core/error/system-error";
import {
  ORG_UNIT_ANCESTOR_CHAIN_INDEX_NAME,
  ORG_UNIT_CREATED_AT_ID_INDEX_NAME,
  ORG_UNIT_DISPLAY_ORDER_ID_INDEX_NAME,
  ORG_UNIT_DISPLAY_ORDER_NAME_ID_INDEX_NAME,
  ORG_UNIT_LIVE_SIBLING_NORMALIZED_NAME_UNIQ_INDEX_NAME,
  ORG_UNIT_NAME_ID_INDEX_NAME,
  ORG_UNIT_NORMALIZED_NAME_INDEX_NAME,
  ORG_UNIT_PARENT_DISPLAY_ORDER_NAME_INDEX_NAME,
  ORG_UNIT_PARENT_INDEX_NAME,
  ORG_UNIT_SEARCH_CODE_INDEX_NAME,
  ORG_UNIT_STATUS_TYPE_INDEX_NAME,
  ORG_UNIT_UNIQ_CODE_INDEX_NAME,
  initOrgUnitIndexes,
} from "@infra/mongo/org-unit/org-unit.index";
import { registerPresenters } from "./org-unit.presenter.register";
import type { BootstrapRegistrar } from "@bootstrap/module-registrar";

interface IndexMetadata {
  readonly key?: unknown;
  readonly unique?: unknown;
  readonly partialFilterExpression?: unknown;
}

export function createOrgUnitBootstrapRegistrar(): BootstrapRegistrar {
  return Object.freeze({
    name: "org-unit",
    registerPresenters,
    async initIndexes(db: Db): Promise<void> {
      await initOrgUnitIndexes(db);
    },
    async assertReadiness(db: Db): Promise<void> {
      await assertRequiredUniqueIndex(
        db,
        "org_units",
        ORG_UNIT_UNIQ_CODE_INDEX_NAME,
        {
          code: 1,
        },
      );

      await assertRequiredUniquePartialIndex(
        db,
        "org_units",
        ORG_UNIT_LIVE_SIBLING_NORMALIZED_NAME_UNIQ_INDEX_NAME,
        {
          parentOrgUnitId: 1,
          normalizedName: 1,
        },
        {
          status: {
            $in: ["ACTIVE", "INACTIVE"],
          },
        },
      );

      await assertRequiredIndex(
        db,
        "org_units",
        ORG_UNIT_PARENT_INDEX_NAME,
        {
          parentOrgUnitId: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "org_units",
        ORG_UNIT_STATUS_TYPE_INDEX_NAME,
        {
          status: 1,
          type: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "org_units",
        ORG_UNIT_ANCESTOR_CHAIN_INDEX_NAME,
        {
          ancestorChain: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "org_units",
        ORG_UNIT_PARENT_DISPLAY_ORDER_NAME_INDEX_NAME,
        {
          parentOrgUnitId: 1,
          displayOrder: 1,
          name: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "org_units",
        ORG_UNIT_DISPLAY_ORDER_NAME_ID_INDEX_NAME,
        {
          displayOrder: 1,
          name: 1,
          _id: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "org_units",
        ORG_UNIT_DISPLAY_ORDER_ID_INDEX_NAME,
        {
          displayOrder: 1,
          _id: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "org_units",
        ORG_UNIT_NAME_ID_INDEX_NAME,
        {
          name: 1,
          _id: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "org_units",
        ORG_UNIT_CREATED_AT_ID_INDEX_NAME,
        {
          createdAt: 1,
          _id: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "org_units",
        ORG_UNIT_SEARCH_CODE_INDEX_NAME,
        {
          searchCode: 1,
          _id: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "org_units",
        ORG_UNIT_NORMALIZED_NAME_INDEX_NAME,
        {
          normalizedName: 1,
          _id: 1,
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
  expectedPartialFilterExpression: Record<
    string,
    unknown
  >,
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
    expected === null ||
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
  const expectedKeys = Object.keys(expectedRecord);

  if (
    Object.keys(candidateRecord).length !==
    expectedKeys.length
  ) {
    return false;
  }

  return expectedKeys.every((key) =>
    hasDeepExactShape(
      candidateRecord[key],
      expectedRecord[key],
    ),
  );
}
