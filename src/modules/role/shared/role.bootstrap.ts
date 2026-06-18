import { Db } from "mongodb";
import { SystemInvariantError } from "@core/error/system-error";
import {
  ROLE_ACTIVE_ASSIGNMENT_UNIQ_INDEX,
  ROLE_ASSIGNMENT_ROLE_STATE_UPDATED_LIST_INDEX_NAME,
  ROLE_ASSIGNMENT_RULE_ROLE_LIST_INDEX_NAME,
  ROLE_ASSIGNMENT_RULE_UNIQ_CODE_INDEX,
  ROLE_SEARCH_CODE_UPDATED_LIST_INDEX_NAME,
  ROLE_SEARCH_NAME_UPDATED_LIST_INDEX_NAME,
  ROLE_STATE_UPDATED_LIST_INDEX_NAME,
  ROLE_UNIQ_CODE_INDEX,
  ROLE_UPDATED_LIST_INDEX_NAME,
  initRoleIndexes,
} from "@infra/mongo/role/role.index";
import { registerPresenters } from "./role.presenter.register";
import type { BootstrapRegistrar } from "@bootstrap/module-registrar";

interface IndexMetadata {
  readonly key?: unknown;
  readonly unique?: unknown;
  readonly partialFilterExpression?: unknown;
}

export function createRoleBootstrapRegistrar(): BootstrapRegistrar {
  return Object.freeze({
    name: "role",
    registerPresenters,
    async initIndexes(db: Db): Promise<void> {
      await initRoleIndexes(db);
    },
    async assertReadiness(db: Db): Promise<void> {
      await assertRequiredUniqueIndex(
        db,
        "roles",
        ROLE_UNIQ_CODE_INDEX,
        {
          code: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "roles",
        ROLE_STATE_UPDATED_LIST_INDEX_NAME,
        {
          state: 1,
          updatedAt: -1,
          _id: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "roles",
        ROLE_UPDATED_LIST_INDEX_NAME,
        {
          updatedAt: -1,
          _id: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "roles",
        ROLE_SEARCH_NAME_UPDATED_LIST_INDEX_NAME,
        {
          searchName: 1,
          updatedAt: -1,
          _id: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "roles",
        ROLE_SEARCH_CODE_UPDATED_LIST_INDEX_NAME,
        {
          searchCode: 1,
          updatedAt: -1,
          _id: 1,
        },
      );

      await assertRequiredUniquePartialIndex(
        db,
        "role_assignments",
        ROLE_ACTIVE_ASSIGNMENT_UNIQ_INDEX,
        {
          roleId: 1,
          userId: 1,
          scopeFingerprint: 1,
        },
        {
          state: "ACTIVE",
        },
      );

      await assertRequiredIndex(
        db,
        "role_assignments",
        ROLE_ASSIGNMENT_ROLE_STATE_UPDATED_LIST_INDEX_NAME,
        {
          roleId: 1,
          state: 1,
          updatedAt: -1,
          _id: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "role_assignment_rules",
        ROLE_ASSIGNMENT_RULE_ROLE_LIST_INDEX_NAME,
        {
          roleId: 1,
          createdAt: 1,
          _id: 1,
        },
      );

      await assertRequiredUniqueIndex(
        db,
        "role_assignment_rules",
        ROLE_ASSIGNMENT_RULE_UNIQ_CODE_INDEX,
        {
          roleId: 1,
          code: 1,
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
    string | number | boolean | null
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
    !hasExactObjectShape(
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

  if (!hasExactObjectShape(matched.key, expectedKey)) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      `Required index ${indexName} on ${collectionName} has invalid key shape`,
    );
  }

  return matched as IndexMetadata;
}

function hasExactObjectShape(
  candidate: unknown,
  expected: Record<
    string,
    string | number | boolean | null
  >,
): boolean {
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    Array.isArray(candidate)
  ) {
    return false;
  }

  const candidateRecord = candidate as Record<
    string,
    unknown
  >;
  const expectedEntries = Object.entries(expected);

  if (
    Object.keys(candidateRecord).length !==
    expectedEntries.length
  ) {
    return false;
  }

  for (const [field, value] of expectedEntries) {
    if (!Object.is(candidateRecord[field], value)) {
      return false;
    }
  }

  return true;
}
