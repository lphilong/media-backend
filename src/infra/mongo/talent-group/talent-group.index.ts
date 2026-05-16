import { Db } from "mongodb";

export const TALENT_GROUP_GROUP_CODE_UNIQ_INDEX_NAME =
  "uniq_talent_group_group_code";
export const TALENT_GROUP_NORMALIZED_NAME_UNIQ_INDEX_NAME =
  "uniq_talent_group_normalized_name_live";
export const TALENT_GROUP_STATUS_INDEX_NAME =
  "idx_talent_group_status";
export const TALENT_GROUP_NORMALIZED_SHORT_NAME_INDEX_NAME =
  "idx_talent_group_normalized_short_name";
export const TALENT_GROUP_STATUS_DISPLAY_ORDER_NAME_INDEX_NAME =
  "idx_talent_group_status_display_order_name";
export const TALENT_GROUP_DISPLAY_ORDER_NAME_INDEX_NAME =
  "idx_talent_group_display_order_name";
export const TALENT_GROUP_NAME_INDEX_NAME =
  "idx_talent_group_name";
export const TALENT_GROUP_CREATED_AT_INDEX_NAME =
  "idx_talent_group_created_at";

export const TALENT_GROUP_MEMBER_GROUP_TALENT_UNIQ_INDEX_NAME =
  "uniq_talent_group_member_group_talent_live";
export const TALENT_GROUP_MEMBER_GROUP_LINEUP_UNIQ_INDEX_NAME =
  "uniq_talent_group_member_group_lineup_live";
export const TALENT_GROUP_MEMBER_GROUP_STATUS_LINEUP_INDEX_NAME =
  "idx_talent_group_member_group_status_lineup";
export const TALENT_GROUP_MEMBER_TALENT_STATUS_INDEX_NAME =
  "idx_talent_group_member_talent_status";

export async function initTalentGroupIndexes(
  db: Db,
): Promise<void> {
  const groupCollection =
    db.collection("talent_groups");
  const memberCollection = db.collection(
    "talent_group_members",
  );

  await groupCollection.createIndex(
    { groupCode: 1 },
    {
      name: TALENT_GROUP_GROUP_CODE_UNIQ_INDEX_NAME,
      unique: true,
    },
  );

  await groupCollection.createIndex(
    { normalizedName: 1 },
    {
      name: TALENT_GROUP_NORMALIZED_NAME_UNIQ_INDEX_NAME,
      unique: true,
      partialFilterExpression: {
        status: {
          $in: ["ACTIVE", "INACTIVE"],
        },
      },
    },
  );

  await groupCollection.createIndex(
    { status: 1 },
    {
      name: TALENT_GROUP_STATUS_INDEX_NAME,
    },
  );

  await groupCollection.createIndex(
    {
      normalizedShortName: 1,
      _id: 1,
    },
    {
      name:
        TALENT_GROUP_NORMALIZED_SHORT_NAME_INDEX_NAME,
    },
  );

  await groupCollection.createIndex(
    {
      status: 1,
      displayOrder: 1,
      name: 1,
      _id: 1,
    },
    {
      name:
        TALENT_GROUP_STATUS_DISPLAY_ORDER_NAME_INDEX_NAME,
    },
  );

  await groupCollection.createIndex(
    {
      displayOrder: 1,
      name: 1,
      _id: 1,
    },
    {
      name:
        TALENT_GROUP_DISPLAY_ORDER_NAME_INDEX_NAME,
    },
  );

  await groupCollection.createIndex(
    {
      name: 1,
      _id: 1,
    },
    {
      name: TALENT_GROUP_NAME_INDEX_NAME,
    },
  );

  await groupCollection.createIndex(
    {
      createdAt: 1,
      _id: 1,
    },
    {
      name: TALENT_GROUP_CREATED_AT_INDEX_NAME,
    },
  );

  await memberCollection.createIndex(
    {
      groupId: 1,
      talentId: 1,
    },
    {
      name:
        TALENT_GROUP_MEMBER_GROUP_TALENT_UNIQ_INDEX_NAME,
      unique: true,
      partialFilterExpression: {
        membershipStatus: {
          $in: ["ACTIVE", "INACTIVE"],
        },
      },
    },
  );

  await memberCollection.createIndex(
    {
      groupId: 1,
      lineupOrder: 1,
    },
    {
      name:
        TALENT_GROUP_MEMBER_GROUP_LINEUP_UNIQ_INDEX_NAME,
      unique: true,
      partialFilterExpression: {
        membershipStatus: {
          $in: ["ACTIVE", "INACTIVE"],
        },
      },
    },
  );

  await memberCollection.createIndex(
    {
      groupId: 1,
      membershipStatus: 1,
      lineupOrder: 1,
      _id: 1,
    },
    {
      name:
        TALENT_GROUP_MEMBER_GROUP_STATUS_LINEUP_INDEX_NAME,
    },
  );

  await memberCollection.createIndex(
    {
      talentId: 1,
      membershipStatus: 1,
    },
    {
      name:
        TALENT_GROUP_MEMBER_TALENT_STATUS_INDEX_NAME,
    },
  );
}
