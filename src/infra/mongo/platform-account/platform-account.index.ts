import { Db } from "mongodb";

export const PLATFORM_ACCOUNT_ACCOUNT_CODE_UNIQ_INDEX_NAME =
  "uniq_platform_account_account_code";
export const PLATFORM_ACCOUNT_LIVE_NORMALIZED_HANDLE_UNIQ_INDEX_NAME =
  "uniq_platform_account_platform_normalized_handle_live";
export const PLATFORM_ACCOUNT_LIVE_EXTERNAL_PLATFORM_ID_UNIQ_INDEX_NAME =
  "uniq_platform_account_platform_external_platform_id_live";
export const PLATFORM_ACCOUNT_LIVE_NORMALIZED_PROFILE_URL_UNIQ_INDEX_NAME =
  "uniq_platform_account_platform_normalized_profile_url_live";
export const PLATFORM_ACCOUNT_PLATFORM_OPERATIONAL_STATUS_INDEX_NAME =
  "idx_platform_account_platform_operational_status";
export const PLATFORM_ACCOUNT_PLATFORM_SURFACE_TYPE_INDEX_NAME =
  "idx_platform_account_platform_surface_type";
export const PLATFORM_ACCOUNT_OPERATIONAL_STATUS_INDEX_NAME =
  "idx_platform_account_operational_status";
export const PLATFORM_ACCOUNT_OWNER_ORG_UNIT_INDEX_NAME =
  "idx_platform_account_owner_org_unit";
export const PLATFORM_ACCOUNT_OWNER_TALENT_INDEX_NAME =
  "idx_platform_account_owner_talent";
export const PLATFORM_ACCOUNT_OWNER_TALENT_GROUP_INDEX_NAME =
  "idx_platform_account_owner_talent_group";
export const PLATFORM_ACCOUNT_OWNER_KIND_OPERATIONAL_STATUS_INDEX_NAME =
  "idx_platform_account_owner_kind_operational_status";
export const PLATFORM_ACCOUNT_NORMALIZED_DISPLAY_NAME_INDEX_NAME =
  "idx_platform_account_normalized_display_name";
export const PLATFORM_ACCOUNT_NORMALIZED_HANDLE_INDEX_NAME =
  "idx_platform_account_normalized_handle";
export const PLATFORM_ACCOUNT_NORMALIZED_PROFILE_URL_INDEX_NAME =
  "idx_platform_account_normalized_profile_url";
export const PLATFORM_ACCOUNT_DISPLAY_NAME_ID_INDEX_NAME =
  "idx_platform_account_display_name";
export const PLATFORM_ACCOUNT_CREATED_AT_ID_INDEX_NAME =
  "idx_platform_account_created_at";
export const PLATFORM_ACCOUNT_LIVESTREAM_ENABLED_INDEX_NAME =
  "idx_platform_account_livestream_enabled";
export const PLATFORM_ACCOUNT_CONTENT_PUBLISHING_ENABLED_INDEX_NAME =
  "idx_platform_account_content_publishing_enabled";
export const PLATFORM_ACCOUNT_MONETIZATION_ENABLED_INDEX_NAME =
  "idx_platform_account_monetization_enabled";

export async function initPlatformAccountIndexes(
  db: Db,
): Promise<void> {
  const collection =
    db.collection("platform_accounts");

  await collection.createIndex(
    { accountCode: 1 },
    {
      name:
        PLATFORM_ACCOUNT_ACCOUNT_CODE_UNIQ_INDEX_NAME,
      unique: true,
    },
  );

  await collection.createIndex(
    {
      platform: 1,
      normalizedHandle: 1,
    },
    {
      name:
        PLATFORM_ACCOUNT_LIVE_NORMALIZED_HANDLE_UNIQ_INDEX_NAME,
      unique: true,
      partialFilterExpression: {
        normalizedHandle: {
          $type: "string",
        },
        operationalStatus: {
          $ne: "ARCHIVED",
        },
      },
    },
  );

  await collection.createIndex(
    {
      platform: 1,
      externalPlatformId: 1,
    },
    {
      name:
        PLATFORM_ACCOUNT_LIVE_EXTERNAL_PLATFORM_ID_UNIQ_INDEX_NAME,
      unique: true,
      partialFilterExpression: {
        externalPlatformId: {
          $type: "string",
        },
        operationalStatus: {
          $ne: "ARCHIVED",
        },
      },
    },
  );

  await collection.createIndex(
    {
      platform: 1,
      normalizedProfileUrl: 1,
    },
    {
      name:
        PLATFORM_ACCOUNT_LIVE_NORMALIZED_PROFILE_URL_UNIQ_INDEX_NAME,
      unique: true,
      partialFilterExpression: {
        normalizedProfileUrl: {
          $type: "string",
        },
        operationalStatus: {
          $ne: "ARCHIVED",
        },
      },
    },
  );

  await collection.createIndex(
    {
      platform: 1,
      operationalStatus: 1,
    },
    {
      name:
        PLATFORM_ACCOUNT_PLATFORM_OPERATIONAL_STATUS_INDEX_NAME,
    },
  );

  await collection.createIndex(
    { platformSurfaceType: 1 },
    {
      name:
        PLATFORM_ACCOUNT_PLATFORM_SURFACE_TYPE_INDEX_NAME,
    },
  );

  await collection.createIndex(
    { operationalStatus: 1 },
    {
      name:
        PLATFORM_ACCOUNT_OPERATIONAL_STATUS_INDEX_NAME,
    },
  );

  await collection.createIndex(
    { ownerOrgUnitId: 1 },
    {
      name:
        PLATFORM_ACCOUNT_OWNER_ORG_UNIT_INDEX_NAME,
    },
  );

  await collection.createIndex(
    { ownerTalentId: 1 },
    {
      name:
        PLATFORM_ACCOUNT_OWNER_TALENT_INDEX_NAME,
    },
  );

  await collection.createIndex(
    { ownerTalentGroupId: 1 },
    {
      name:
        PLATFORM_ACCOUNT_OWNER_TALENT_GROUP_INDEX_NAME,
    },
  );

  await collection.createIndex(
    {
      ownerKind: 1,
      operationalStatus: 1,
    },
    {
      name:
        PLATFORM_ACCOUNT_OWNER_KIND_OPERATIONAL_STATUS_INDEX_NAME,
    },
  );

  await collection.createIndex(
    {
      normalizedDisplayName: 1,
      _id: 1,
    },
    {
      name:
        PLATFORM_ACCOUNT_NORMALIZED_DISPLAY_NAME_INDEX_NAME,
    },
  );

  await collection.createIndex(
    {
      normalizedHandle: 1,
      _id: 1,
    },
    {
      name:
        PLATFORM_ACCOUNT_NORMALIZED_HANDLE_INDEX_NAME,
    },
  );

  await collection.createIndex(
    {
      normalizedProfileUrl: 1,
      _id: 1,
    },
    {
      name:
        PLATFORM_ACCOUNT_NORMALIZED_PROFILE_URL_INDEX_NAME,
    },
  );

  await collection.createIndex(
    {
      displayName: 1,
      _id: 1,
    },
    {
      name:
        PLATFORM_ACCOUNT_DISPLAY_NAME_ID_INDEX_NAME,
    },
  );

  await collection.createIndex(
    {
      createdAt: 1,
      _id: 1,
    },
    {
      name:
        PLATFORM_ACCOUNT_CREATED_AT_ID_INDEX_NAME,
    },
  );

  await collection.createIndex(
    { livestreamEnabled: 1 },
    {
      name:
        PLATFORM_ACCOUNT_LIVESTREAM_ENABLED_INDEX_NAME,
    },
  );

  await collection.createIndex(
    { contentPublishingEnabled: 1 },
    {
      name:
        PLATFORM_ACCOUNT_CONTENT_PUBLISHING_ENABLED_INDEX_NAME,
    },
  );

  await collection.createIndex(
    { monetizationEnabled: 1 },
    {
      name:
        PLATFORM_ACCOUNT_MONETIZATION_ENABLED_INDEX_NAME,
    },
  );
}
