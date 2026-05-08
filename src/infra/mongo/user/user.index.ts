import { Db } from "mongodb";

export const USER_AUTH_LINKAGE_UNIQ_INDEX_NAME =
  "uniq_user_auth_provider_subject";
export const USER_UPDATED_LIST_INDEX_NAME =
  "idx_user_updated";
export const USER_ACCOUNT_STATUS_UPDATED_LIST_INDEX_NAME =
  "idx_user_account_status_updated";
export const USER_ACTOR_KIND_UPDATED_LIST_INDEX_NAME =
  "idx_user_actor_kind_updated";
export const USER_ACCOUNT_STATUS_ACTOR_KIND_UPDATED_LIST_INDEX_NAME =
  "idx_user_account_status_actor_kind_updated";
export const USER_SEARCH_DISPLAY_NAME_UPDATED_LIST_INDEX_NAME =
  "idx_user_search_display_name_updated";
export const USER_SEARCH_EMAIL_UPDATED_LIST_INDEX_NAME =
  "idx_user_search_email_updated";

export async function initUserIndexes(
  db: Db,
): Promise<void> {
  const collection = db.collection("users");

  await backfillUserSearchFields(collection);

  await collection.createIndex(
    {
      "authLinkage.provider": 1,
      "authLinkage.subject": 1,
    },
    {
      name: USER_AUTH_LINKAGE_UNIQ_INDEX_NAME,
      unique: true,
    },
  );

  await collection.createIndex(
    { updatedAt: -1, _id: 1 },
    {
      name: USER_UPDATED_LIST_INDEX_NAME,
    },
  );

  await collection.createIndex(
    { accountStatus: 1, updatedAt: -1, _id: 1 },
    {
      name: USER_ACCOUNT_STATUS_UPDATED_LIST_INDEX_NAME,
    },
  );

  await collection.createIndex(
    { actorKind: 1, updatedAt: -1, _id: 1 },
    {
      name: USER_ACTOR_KIND_UPDATED_LIST_INDEX_NAME,
    },
  );

  await collection.createIndex(
    {
      accountStatus: 1,
      actorKind: 1,
      updatedAt: -1,
      _id: 1,
    },
    {
      name: USER_ACCOUNT_STATUS_ACTOR_KIND_UPDATED_LIST_INDEX_NAME,
    },
  );

  await collection.createIndex(
    {
      searchDisplayName: 1,
      updatedAt: -1,
      _id: 1,
    },
    {
      name: USER_SEARCH_DISPLAY_NAME_UPDATED_LIST_INDEX_NAME,
    },
  );

  await collection.createIndex(
    {
      searchEmail: 1,
      updatedAt: -1,
      _id: 1,
    },
    {
      name: USER_SEARCH_EMAIL_UPDATED_LIST_INDEX_NAME,
    },
  );
}

async function backfillUserSearchFields(
  collection: ReturnType<Db["collection"]>,
): Promise<void> {
  await collection.updateMany(
    {
      $or: [
        { searchDisplayName: { $exists: false } },
        { searchEmail: { $exists: false } },
      ],
    },
    [
      {
        $set: {
          searchDisplayName: {
            $toLower: {
              $trim: {
                input: "$profile.displayName",
              },
            },
          },
          searchEmail: {
            $toLower: {
              $trim: {
                input: {
                  $ifNull: ["$profile.email", ""],
                },
              },
            },
          },
        },
      },
    ],
  );
}
