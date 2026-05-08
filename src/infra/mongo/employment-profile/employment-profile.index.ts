import { Db } from "mongodb";

export const EMPLOYMENT_PROFILE_EMPLOYEE_CODE_INDEX_NAME =
  "uniq_employment_profile_employee_code";
export const EMPLOYMENT_PROFILE_LINKED_USER_UNIQ_INDEX_NAME =
  "uniq_employment_profile_linked_user_live";
export const EMPLOYMENT_PROFILE_ORG_UNIT_INDEX_NAME =
  "idx_employment_profile_org_unit";
export const EMPLOYMENT_PROFILE_MANAGER_INDEX_NAME =
  "idx_employment_profile_manager";
export const EMPLOYMENT_PROFILE_CONTRACT_STATUS_INDEX_NAME =
  "idx_employment_profile_status_contract_status";
export const EMPLOYMENT_PROFILE_ORG_STATUS_EMPLOYEE_CODE_INDEX_NAME =
  "idx_employment_profile_org_status_employee_code";
export const EMPLOYMENT_PROFILE_NORMALIZED_LEGAL_NAME_INDEX_NAME =
  "idx_employment_profile_normalized_legal_name";
export const EMPLOYMENT_PROFILE_NORMALIZED_DISPLAY_NAME_INDEX_NAME =
  "idx_employment_profile_normalized_display_name";
export const EMPLOYMENT_PROFILE_LEGAL_NAME_INDEX_NAME =
  "idx_employment_profile_legal_name";
export const EMPLOYMENT_PROFILE_DISPLAY_NAME_INDEX_NAME =
  "idx_employment_profile_display_name";
export const EMPLOYMENT_PROFILE_CREATED_AT_INDEX_NAME =
  "idx_employment_profile_created_at";
export const EMPLOYMENT_PROFILE_DIRECT_REPORT_INDEX_NAME =
  "idx_employment_profile_manager_status_employee_code";

export async function initEmploymentProfileIndexes(
  db: Db,
): Promise<void> {
  const collection =
    db.collection("employment_profiles");

  await collection.createIndex(
    { employeeCode: 1 },
    {
      name: EMPLOYMENT_PROFILE_EMPLOYEE_CODE_INDEX_NAME,
      unique: true,
    },
  );

  await collection.createIndex(
    { linkedUserId: 1 },
    {
      name: EMPLOYMENT_PROFILE_LINKED_USER_UNIQ_INDEX_NAME,
      unique: true,
      partialFilterExpression: {
        linkedUserId: {
          $type: "string",
        },
        employmentStatus: {
          $ne: "ARCHIVED",
        },
      },
    },
  );

  await collection.createIndex(
    { orgUnitId: 1 },
    {
      name: EMPLOYMENT_PROFILE_ORG_UNIT_INDEX_NAME,
    },
  );

  await collection.createIndex(
    { managerEmploymentProfileId: 1 },
    {
      name: EMPLOYMENT_PROFILE_MANAGER_INDEX_NAME,
    },
  );

  await collection.createIndex(
    {
      employmentStatus: 1,
      contractStatus: 1,
    },
    {
      name: EMPLOYMENT_PROFILE_CONTRACT_STATUS_INDEX_NAME,
    },
  );

  await collection.createIndex(
    {
      orgUnitId: 1,
      employmentStatus: 1,
      employeeCode: 1,
      _id: 1,
    },
    {
      name: EMPLOYMENT_PROFILE_ORG_STATUS_EMPLOYEE_CODE_INDEX_NAME,
    },
  );

  await collection.createIndex(
    {
      normalizedLegalName: 1,
      _id: 1,
    },
    {
      name: EMPLOYMENT_PROFILE_NORMALIZED_LEGAL_NAME_INDEX_NAME,
    },
  );

  await collection.createIndex(
    {
      normalizedDisplayName: 1,
      _id: 1,
    },
    {
      name: EMPLOYMENT_PROFILE_NORMALIZED_DISPLAY_NAME_INDEX_NAME,
    },
  );

  await collection.createIndex(
    {
      legalName: 1,
      _id: 1,
    },
    {
      name: EMPLOYMENT_PROFILE_LEGAL_NAME_INDEX_NAME,
    },
  );

  await collection.createIndex(
    {
      displayName: 1,
      _id: 1,
    },
    {
      name: EMPLOYMENT_PROFILE_DISPLAY_NAME_INDEX_NAME,
    },
  );

  await collection.createIndex(
    {
      createdAt: 1,
      _id: 1,
    },
    {
      name: EMPLOYMENT_PROFILE_CREATED_AT_INDEX_NAME,
    },
  );

  await collection.createIndex(
    {
      managerEmploymentProfileId: 1,
      employmentStatus: 1,
      employeeCode: 1,
      _id: 1,
    },
    {
      name: EMPLOYMENT_PROFILE_DIRECT_REPORT_INDEX_NAME,
    },
  );
}
