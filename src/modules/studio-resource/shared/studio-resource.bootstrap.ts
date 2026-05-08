import { Db } from "mongodb";
import { SystemInvariantError } from "@core/error/system-error";
import {
  STUDIO_RESOURCE_CLASS_STATUS_INDEX_NAME,
  STUDIO_RESOURCE_CREATED_AT_ID_INDEX_NAME,
  STUDIO_RESOURCE_MAX_OCCUPANCY_INDEX_NAME,
  STUDIO_RESOURCE_NAME_ID_INDEX_NAME,
  STUDIO_RESOURCE_NORMALIZED_NAME_INDEX_NAME,
  STUDIO_RESOURCE_NORMALIZED_RESOURCE_CODE_INDEX_NAME,
  STUDIO_RESOURCE_NORMALIZED_SHORT_NAME_INDEX_NAME,
  STUDIO_RESOURCE_RESOURCE_CODE_UNIQ_INDEX_NAME,
  STUDIO_RESOURCE_STATUS_RESOURCE_CODE_INDEX_NAME,
  initStudioResourceIndexes,
} from "@infra/mongo/studio-resource/studio-resource.index";
import { registerPresenters } from "./studio-resource.presenter.register";
import type { BootstrapRegistrar } from "@bootstrap/module-registrar";

interface IndexMetadata {
  readonly key?: unknown;
  readonly unique?: unknown;
}

export function createStudioResourceBootstrapRegistrar(): BootstrapRegistrar {
  return Object.freeze({
    name: "studio-resource",
    registerPresenters,
    async initIndexes(db: Db): Promise<void> {
      await initStudioResourceIndexes(db);
    },
    async assertReadiness(db: Db): Promise<void> {
      await assertRequiredUniqueIndex(
        db,
        "studio_resources",
        STUDIO_RESOURCE_RESOURCE_CODE_UNIQ_INDEX_NAME,
        {
          resourceCode: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "studio_resources",
        STUDIO_RESOURCE_NORMALIZED_RESOURCE_CODE_INDEX_NAME,
        {
          normalizedResourceCode: 1,
          _id: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "studio_resources",
        STUDIO_RESOURCE_NORMALIZED_NAME_INDEX_NAME,
        {
          normalizedName: 1,
          _id: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "studio_resources",
        STUDIO_RESOURCE_NORMALIZED_SHORT_NAME_INDEX_NAME,
        {
          normalizedShortName: 1,
          _id: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "studio_resources",
        STUDIO_RESOURCE_CLASS_STATUS_INDEX_NAME,
        {
          resourceClass: 1,
          operationalStatus: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "studio_resources",
        STUDIO_RESOURCE_STATUS_RESOURCE_CODE_INDEX_NAME,
        {
          operationalStatus: 1,
          resourceCode: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "studio_resources",
        STUDIO_RESOURCE_NAME_ID_INDEX_NAME,
        {
          name: 1,
          _id: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "studio_resources",
        STUDIO_RESOURCE_CREATED_AT_ID_INDEX_NAME,
        {
          createdAt: 1,
          _id: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "studio_resources",
        STUDIO_RESOURCE_MAX_OCCUPANCY_INDEX_NAME,
        {
          maxOccupancy: 1,
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
  expected: Record<string, number>,
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
