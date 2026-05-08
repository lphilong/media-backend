import { Db } from "mongodb";
import { SystemInvariantError } from "@core/error/system-error";
import {
  USER_ACCOUNT_STATUS_ACTOR_KIND_UPDATED_LIST_INDEX_NAME,
  USER_ACCOUNT_STATUS_UPDATED_LIST_INDEX_NAME,
  USER_ACTOR_KIND_UPDATED_LIST_INDEX_NAME,
  USER_AUTH_LINKAGE_UNIQ_INDEX_NAME,
  USER_SEARCH_DISPLAY_NAME_UPDATED_LIST_INDEX_NAME,
  USER_SEARCH_EMAIL_UPDATED_LIST_INDEX_NAME,
  USER_UPDATED_LIST_INDEX_NAME,
  initUserIndexes,
} from "@infra/mongo/user/user.index";
import { registerPresenters } from "./user.presenter.register";
import type { BootstrapRegistrar } from "@bootstrap/module-registrar";

interface IndexMetadata {
  readonly key?: unknown;
  readonly unique?: unknown;
}

export function createUserBootstrapRegistrar(): BootstrapRegistrar {
  return Object.freeze({
    name: "user",
    registerPresenters,
    async initIndexes(db: Db): Promise<void> {
      await initUserIndexes(db);
    },
    async assertReadiness(db: Db): Promise<void> {
      await assertRequiredUniqueIndex(
        db,
        "users",
        USER_AUTH_LINKAGE_UNIQ_INDEX_NAME,
        {
          "authLinkage.provider": 1,
          "authLinkage.subject": 1,
        },
      );

      await assertRequiredIndex(
        db,
        "users",
        USER_UPDATED_LIST_INDEX_NAME,
        {
          updatedAt: -1,
          _id: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "users",
        USER_ACCOUNT_STATUS_UPDATED_LIST_INDEX_NAME,
        {
          accountStatus: 1,
          updatedAt: -1,
          _id: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "users",
        USER_ACTOR_KIND_UPDATED_LIST_INDEX_NAME,
        {
          actorKind: 1,
          updatedAt: -1,
          _id: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "users",
        USER_ACCOUNT_STATUS_ACTOR_KIND_UPDATED_LIST_INDEX_NAME,
        {
          accountStatus: 1,
          actorKind: 1,
          updatedAt: -1,
          _id: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "users",
        USER_SEARCH_DISPLAY_NAME_UPDATED_LIST_INDEX_NAME,
        {
          searchDisplayName: 1,
          updatedAt: -1,
          _id: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "users",
        USER_SEARCH_EMAIL_UPDATED_LIST_INDEX_NAME,
        {
          searchEmail: 1,
          updatedAt: -1,
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

  if (!hasExactKeyShape(matched.key, expectedKey)) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      `Required index ${indexName} on ${collectionName} has invalid key shape`,
    );
  }

  return matched as IndexMetadata;
}

function hasExactKeyShape(
  candidate: unknown,
  expected: Record<string, number>,
): boolean {
  if (
    typeof candidate !== "object" ||
    candidate === null
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

  for (const [field, direction] of expectedEntries) {
    if (candidateRecord[field] !== direction) {
      return false;
    }
  }

  return true;
}
