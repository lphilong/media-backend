import { Db } from "mongodb";

export const ROLE_UNIQ_CODE_INDEX =
  "uniq_role_code";
export const ROLE_STATE_UPDATED_LIST_INDEX_NAME =
  "idx_role_state_updated";
export const ROLE_UPDATED_LIST_INDEX_NAME =
  "idx_role_updated";
export const ROLE_SEARCH_NAME_UPDATED_LIST_INDEX_NAME =
  "idx_role_search_name_updated";
export const ROLE_SEARCH_CODE_UPDATED_LIST_INDEX_NAME =
  "idx_role_search_code_updated";

export const ROLE_ACTIVE_ASSIGNMENT_UNIQ_INDEX =
  "uniq_role_assignment_active_role_user_scope";
export const ROLE_ASSIGNMENT_ROLE_STATE_UPDATED_LIST_INDEX_NAME =
  "idx_role_assignment_role_state_updated";

export const ROLE_ASSIGNMENT_RULE_ROLE_LIST_INDEX_NAME =
  "idx_role_assignment_rule_role";
export const ROLE_ASSIGNMENT_RULE_UNIQ_CODE_INDEX =
  "uniq_role_assignment_rule_code";

export async function initRoleIndexes(
  db: Db,
): Promise<void> {
  const roleCollection = db.collection("roles");
  const assignmentCollection =
    db.collection("role_assignments");
  const assignmentRuleCollection =
    db.collection("role_assignment_rules");

  await backfillRoleSearchFields(roleCollection);
  await backfillRoleGovernanceFields(roleCollection);

  await roleCollection.createIndex(
    { code: 1 },
    {
      name: ROLE_UNIQ_CODE_INDEX,
      unique: true,
    },
  );

  await roleCollection.createIndex(
    { state: 1, updatedAt: -1, _id: 1 },
    {
      name: ROLE_STATE_UPDATED_LIST_INDEX_NAME,
    },
  );

  await roleCollection.createIndex(
    { updatedAt: -1, _id: 1 },
    {
      name: ROLE_UPDATED_LIST_INDEX_NAME,
    },
  );

  await roleCollection.createIndex(
    { searchName: 1, updatedAt: -1, _id: 1 },
    {
      name: ROLE_SEARCH_NAME_UPDATED_LIST_INDEX_NAME,
    },
  );

  await roleCollection.createIndex(
    { searchCode: 1, updatedAt: -1, _id: 1 },
    {
      name: ROLE_SEARCH_CODE_UPDATED_LIST_INDEX_NAME,
    },
  );

  await assignmentCollection.createIndex(
    { roleId: 1, userId: 1, scopeFingerprint: 1 },
    {
      name: ROLE_ACTIVE_ASSIGNMENT_UNIQ_INDEX,
      unique: true,
      partialFilterExpression: {
        state: "ACTIVE",
      },
    },
  );

  await assignmentCollection.createIndex(
    { roleId: 1, state: 1, updatedAt: -1, _id: 1 },
    {
      name: ROLE_ASSIGNMENT_ROLE_STATE_UPDATED_LIST_INDEX_NAME,
    },
  );

  await assignmentRuleCollection.createIndex(
    { roleId: 1, createdAt: 1, _id: 1 },
    {
      name: ROLE_ASSIGNMENT_RULE_ROLE_LIST_INDEX_NAME,
    },
  );

  await assignmentRuleCollection.createIndex(
    { roleId: 1, code: 1 },
    {
      name: ROLE_ASSIGNMENT_RULE_UNIQ_CODE_INDEX,
      unique: true,
    },
  );
}

async function backfillRoleSearchFields(
  roleCollection: ReturnType<Db["collection"]>,
): Promise<void> {
  await roleCollection.updateMany(
    {
      $or: [
        { searchName: { $exists: false } },
        { searchCode: { $exists: false } },
      ],
    },
    [
      {
        $set: {
          searchName: {
            $toLower: { $trim: { input: "$name" } },
          },
          searchCode: {
            $toLower: { $trim: { input: "$code" } },
          },
        },
      },
    ],
  );
}

async function backfillRoleGovernanceFields(
  roleCollection: ReturnType<Db["collection"]>,
): Promise<void> {
  await roleCollection.updateMany(
    {
      delegationBand: { $exists: false },
    },
    {
      $set: {
        delegationBand: "LIMITED",
      },
    },
  );

  await roleCollection.updateMany(
    {
      maxDelegatableBand: { $exists: false },
    },
    {
      $set: {
        maxDelegatableBand: "NONE",
      },
    },
  );
}
