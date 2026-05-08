import { Db } from "mongodb";

export const ORG_UNIT_UNIQ_CODE_INDEX_NAME =
  "uniq_org_unit_code";
export const ORG_UNIT_LIVE_SIBLING_NORMALIZED_NAME_UNIQ_INDEX_NAME =
  "uniq_org_unit_parent_normalized_name_live";
export const ORG_UNIT_PARENT_INDEX_NAME =
  "idx_org_unit_parent";
export const ORG_UNIT_STATUS_TYPE_INDEX_NAME =
  "idx_org_unit_status_type";
export const ORG_UNIT_ANCESTOR_CHAIN_INDEX_NAME =
  "idx_org_unit_ancestor_chain";
export const ORG_UNIT_PARENT_DISPLAY_ORDER_NAME_INDEX_NAME =
  "idx_org_unit_parent_display_order_name";
export const ORG_UNIT_DISPLAY_ORDER_NAME_ID_INDEX_NAME =
  "idx_org_unit_display_order_name";
export const ORG_UNIT_DISPLAY_ORDER_ID_INDEX_NAME =
  "idx_org_unit_display_order";
export const ORG_UNIT_NAME_ID_INDEX_NAME =
  "idx_org_unit_name";
export const ORG_UNIT_CREATED_AT_ID_INDEX_NAME =
  "idx_org_unit_created_at";
export const ORG_UNIT_SEARCH_CODE_INDEX_NAME =
  "idx_org_unit_search_code";
export const ORG_UNIT_NORMALIZED_NAME_INDEX_NAME =
  "idx_org_unit_normalized_name";

export async function initOrgUnitIndexes(
  db: Db,
): Promise<void> {
  const collection = db.collection("org_units");

  await collection.createIndex(
    { code: 1 },
    {
      name: ORG_UNIT_UNIQ_CODE_INDEX_NAME,
      unique: true,
    },
  );

  await collection.createIndex(
    {
      parentOrgUnitId: 1,
      normalizedName: 1,
    },
    {
      name: ORG_UNIT_LIVE_SIBLING_NORMALIZED_NAME_UNIQ_INDEX_NAME,
      unique: true,
      partialFilterExpression: {
        status: {
          $ne: "ARCHIVED",
        },
      },
    },
  );

  await collection.createIndex(
    { parentOrgUnitId: 1 },
    {
      name: ORG_UNIT_PARENT_INDEX_NAME,
    },
  );

  await collection.createIndex(
    { status: 1, type: 1 },
    {
      name: ORG_UNIT_STATUS_TYPE_INDEX_NAME,
    },
  );

  await collection.createIndex(
    { ancestorChain: 1 },
    {
      name: ORG_UNIT_ANCESTOR_CHAIN_INDEX_NAME,
    },
  );

  await collection.createIndex(
    {
      parentOrgUnitId: 1,
      displayOrder: 1,
      name: 1,
    },
    {
      name: ORG_UNIT_PARENT_DISPLAY_ORDER_NAME_INDEX_NAME,
    },
  );

  await collection.createIndex(
    {
      displayOrder: 1,
      name: 1,
      _id: 1,
    },
    {
      name: ORG_UNIT_DISPLAY_ORDER_NAME_ID_INDEX_NAME,
    },
  );

  await collection.createIndex(
    {
      displayOrder: 1,
      _id: 1,
    },
    {
      name: ORG_UNIT_DISPLAY_ORDER_ID_INDEX_NAME,
    },
  );

  await collection.createIndex(
    { name: 1, _id: 1 },
    {
      name: ORG_UNIT_NAME_ID_INDEX_NAME,
    },
  );

  await collection.createIndex(
    { createdAt: 1, _id: 1 },
    {
      name: ORG_UNIT_CREATED_AT_ID_INDEX_NAME,
    },
  );

  await collection.createIndex(
    { searchCode: 1, _id: 1 },
    {
      name: ORG_UNIT_SEARCH_CODE_INDEX_NAME,
    },
  );

  await collection.createIndex(
    { normalizedName: 1, _id: 1 },
    {
      name: ORG_UNIT_NORMALIZED_NAME_INDEX_NAME,
    },
  );
}
