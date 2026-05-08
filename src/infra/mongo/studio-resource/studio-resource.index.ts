import { Db } from "mongodb";

export const STUDIO_RESOURCE_RESOURCE_CODE_UNIQ_INDEX_NAME =
  "uniq_studio_resource_resource_code";
export const STUDIO_RESOURCE_NORMALIZED_RESOURCE_CODE_INDEX_NAME =
  "idx_studio_resource_normalized_resource_code";
export const STUDIO_RESOURCE_NORMALIZED_NAME_INDEX_NAME =
  "idx_studio_resource_normalized_name";
export const STUDIO_RESOURCE_NORMALIZED_SHORT_NAME_INDEX_NAME =
  "idx_studio_resource_normalized_short_name";
export const STUDIO_RESOURCE_CLASS_STATUS_INDEX_NAME =
  "idx_studio_resource_class_status";
export const STUDIO_RESOURCE_STATUS_RESOURCE_CODE_INDEX_NAME =
  "idx_studio_resource_status_resource_code";
export const STUDIO_RESOURCE_NAME_ID_INDEX_NAME =
  "idx_studio_resource_name";
export const STUDIO_RESOURCE_CREATED_AT_ID_INDEX_NAME =
  "idx_studio_resource_created_at";
export const STUDIO_RESOURCE_MAX_OCCUPANCY_INDEX_NAME =
  "idx_studio_resource_max_occupancy";

export async function initStudioResourceIndexes(
  db: Db,
): Promise<void> {
  const collection =
    db.collection("studio_resources");

  await backfillNormalizedResourceCode(
    collection,
  );

  await collection.createIndex(
    { resourceCode: 1 },
    {
      name:
        STUDIO_RESOURCE_RESOURCE_CODE_UNIQ_INDEX_NAME,
      unique: true,
    },
  );

  await collection.createIndex(
    {
      normalizedResourceCode: 1,
      _id: 1,
    },
    {
      name:
        STUDIO_RESOURCE_NORMALIZED_RESOURCE_CODE_INDEX_NAME,
    },
  );

  await collection.createIndex(
    {
      normalizedName: 1,
      _id: 1,
    },
    {
      name:
        STUDIO_RESOURCE_NORMALIZED_NAME_INDEX_NAME,
    },
  );

  await collection.createIndex(
    {
      normalizedShortName: 1,
      _id: 1,
    },
    {
      name:
        STUDIO_RESOURCE_NORMALIZED_SHORT_NAME_INDEX_NAME,
    },
  );

  await collection.createIndex(
    {
      resourceClass: 1,
      operationalStatus: 1,
    },
    {
      name:
        STUDIO_RESOURCE_CLASS_STATUS_INDEX_NAME,
    },
  );

  await collection.createIndex(
    {
      operationalStatus: 1,
      resourceCode: 1,
    },
    {
      name:
        STUDIO_RESOURCE_STATUS_RESOURCE_CODE_INDEX_NAME,
    },
  );

  await collection.createIndex(
    {
      name: 1,
      _id: 1,
    },
    {
      name:
        STUDIO_RESOURCE_NAME_ID_INDEX_NAME,
    },
  );

  await collection.createIndex(
    {
      createdAt: 1,
      _id: 1,
    },
    {
      name:
        STUDIO_RESOURCE_CREATED_AT_ID_INDEX_NAME,
    },
  );

  await collection.createIndex(
    { maxOccupancy: 1 },
    {
      name:
        STUDIO_RESOURCE_MAX_OCCUPANCY_INDEX_NAME,
    },
  );
}

async function backfillNormalizedResourceCode(
  collection: ReturnType<Db["collection"]>,
): Promise<void> {
  const cursor = collection.find(
    {
      normalizedResourceCode: {
        $exists: false,
      },
    },
    {
      projection: {
        _id: 1,
        resourceCode: 1,
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
    const resourceCode =
      typeof document.resourceCode === "string"
        ? document.resourceCode
        : "";

    operations.push({
      updateOne: {
        filter: { _id: document._id },
        update: {
          $set: {
            normalizedResourceCode:
              canonicalizeStudioResourceSearchText(
                resourceCode,
              ),
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

function canonicalizeStudioResourceSearchText(
  value: string,
): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();
}
