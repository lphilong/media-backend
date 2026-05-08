import { Db } from "mongodb";
import { SystemInvariantError } from "@core/error/system-error";
import {
  PLATFORM_ACCOUNT_ACCOUNT_CODE_UNIQ_INDEX_NAME,
  PLATFORM_ACCOUNT_CONTENT_PUBLISHING_ENABLED_INDEX_NAME,
  PLATFORM_ACCOUNT_CREATED_AT_ID_INDEX_NAME,
  PLATFORM_ACCOUNT_DISPLAY_NAME_ID_INDEX_NAME,
  PLATFORM_ACCOUNT_LIVE_EXTERNAL_PLATFORM_ID_UNIQ_INDEX_NAME,
  PLATFORM_ACCOUNT_LIVE_NORMALIZED_HANDLE_UNIQ_INDEX_NAME,
  PLATFORM_ACCOUNT_LIVE_NORMALIZED_PROFILE_URL_UNIQ_INDEX_NAME,
  PLATFORM_ACCOUNT_LIVESTREAM_ENABLED_INDEX_NAME,
  PLATFORM_ACCOUNT_MONETIZATION_ENABLED_INDEX_NAME,
  PLATFORM_ACCOUNT_NORMALIZED_DISPLAY_NAME_INDEX_NAME,
  PLATFORM_ACCOUNT_NORMALIZED_HANDLE_INDEX_NAME,
  PLATFORM_ACCOUNT_NORMALIZED_PROFILE_URL_INDEX_NAME,
  PLATFORM_ACCOUNT_OPERATIONAL_STATUS_INDEX_NAME,
  PLATFORM_ACCOUNT_OWNER_KIND_OPERATIONAL_STATUS_INDEX_NAME,
  PLATFORM_ACCOUNT_OWNER_ORG_UNIT_INDEX_NAME,
  PLATFORM_ACCOUNT_OWNER_TALENT_GROUP_INDEX_NAME,
  PLATFORM_ACCOUNT_OWNER_TALENT_INDEX_NAME,
  PLATFORM_ACCOUNT_PLATFORM_OPERATIONAL_STATUS_INDEX_NAME,
  PLATFORM_ACCOUNT_PLATFORM_SURFACE_TYPE_INDEX_NAME,
  initPlatformAccountIndexes,
} from "@infra/mongo/platform-account/platform-account.index";
import { registerPresenters } from "./platform-account.presenter.register";
import type { BootstrapRegistrar } from "@bootstrap/module-registrar";

interface IndexMetadata {
  readonly key?: unknown;
  readonly unique?: unknown;
  readonly partialFilterExpression?: unknown;
}

export function createPlatformAccountBootstrapRegistrar(): BootstrapRegistrar {
  return Object.freeze({
    name: "platform-account",
    registerPresenters,
    async initIndexes(db: Db): Promise<void> {
      await initPlatformAccountIndexes(db);
    },
    async assertReadiness(db: Db): Promise<void> {
      await assertRequiredUniqueIndex(
        db,
        "platform_accounts",
        PLATFORM_ACCOUNT_ACCOUNT_CODE_UNIQ_INDEX_NAME,
        {
          accountCode: 1,
        },
      );

      await assertRequiredUniquePartialIndex(
        db,
        "platform_accounts",
        PLATFORM_ACCOUNT_LIVE_NORMALIZED_HANDLE_UNIQ_INDEX_NAME,
        {
          platform: 1,
          normalizedHandle: 1,
        },
        {
          normalizedHandle: {
            $type: "string",
          },
          operationalStatus: {
            $ne: "ARCHIVED",
          },
        },
      );

      await assertRequiredUniquePartialIndex(
        db,
        "platform_accounts",
        PLATFORM_ACCOUNT_LIVE_EXTERNAL_PLATFORM_ID_UNIQ_INDEX_NAME,
        {
          platform: 1,
          externalPlatformId: 1,
        },
        {
          externalPlatformId: {
            $type: "string",
          },
          operationalStatus: {
            $ne: "ARCHIVED",
          },
        },
      );

      await assertRequiredUniquePartialIndex(
        db,
        "platform_accounts",
        PLATFORM_ACCOUNT_LIVE_NORMALIZED_PROFILE_URL_UNIQ_INDEX_NAME,
        {
          platform: 1,
          normalizedProfileUrl: 1,
        },
        {
          normalizedProfileUrl: {
            $type: "string",
          },
          operationalStatus: {
            $ne: "ARCHIVED",
          },
        },
      );

      await assertRequiredIndex(
        db,
        "platform_accounts",
        PLATFORM_ACCOUNT_PLATFORM_OPERATIONAL_STATUS_INDEX_NAME,
        {
          platform: 1,
          operationalStatus: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "platform_accounts",
        PLATFORM_ACCOUNT_PLATFORM_SURFACE_TYPE_INDEX_NAME,
        {
          platformSurfaceType: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "platform_accounts",
        PLATFORM_ACCOUNT_OPERATIONAL_STATUS_INDEX_NAME,
        {
          operationalStatus: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "platform_accounts",
        PLATFORM_ACCOUNT_OWNER_ORG_UNIT_INDEX_NAME,
        {
          ownerOrgUnitId: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "platform_accounts",
        PLATFORM_ACCOUNT_OWNER_TALENT_INDEX_NAME,
        {
          ownerTalentId: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "platform_accounts",
        PLATFORM_ACCOUNT_OWNER_TALENT_GROUP_INDEX_NAME,
        {
          ownerTalentGroupId: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "platform_accounts",
        PLATFORM_ACCOUNT_OWNER_KIND_OPERATIONAL_STATUS_INDEX_NAME,
        {
          ownerKind: 1,
          operationalStatus: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "platform_accounts",
        PLATFORM_ACCOUNT_NORMALIZED_DISPLAY_NAME_INDEX_NAME,
        {
          normalizedDisplayName: 1,
          _id: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "platform_accounts",
        PLATFORM_ACCOUNT_NORMALIZED_HANDLE_INDEX_NAME,
        {
          normalizedHandle: 1,
          _id: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "platform_accounts",
        PLATFORM_ACCOUNT_NORMALIZED_PROFILE_URL_INDEX_NAME,
        {
          normalizedProfileUrl: 1,
          _id: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "platform_accounts",
        PLATFORM_ACCOUNT_DISPLAY_NAME_ID_INDEX_NAME,
        {
          displayName: 1,
          _id: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "platform_accounts",
        PLATFORM_ACCOUNT_CREATED_AT_ID_INDEX_NAME,
        {
          createdAt: 1,
          _id: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "platform_accounts",
        PLATFORM_ACCOUNT_LIVESTREAM_ENABLED_INDEX_NAME,
        {
          livestreamEnabled: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "platform_accounts",
        PLATFORM_ACCOUNT_CONTENT_PUBLISHING_ENABLED_INDEX_NAME,
        {
          contentPublishingEnabled: 1,
        },
      );

      await assertRequiredIndex(
        db,
        "platform_accounts",
        PLATFORM_ACCOUNT_MONETIZATION_ENABLED_INDEX_NAME,
        {
          monetizationEnabled: 1,
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
