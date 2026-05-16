import { Db } from "mongodb";

export const TALENT_TALENT_CODE_UNIQ_INDEX_NAME =
  "uniq_talent_talent_code";
export const TALENT_LINKED_EMPLOYMENT_PROFILE_UNIQ_INDEX_NAME =
  "uniq_talent_linked_employment_profile_live";
export const TALENT_MANAGER_INDEX_NAME =
  "idx_talent_manager_employment_profile";
export const TALENT_STATUS_ORIGIN_INDEX_NAME =
  "idx_talent_operational_status_origin";
export const TALENT_COMMERCIAL_PARTICIPATION_INDEX_NAME =
  "idx_talent_commercial_participation";
export const TALENT_NORMALIZED_STAGE_NAME_INDEX_NAME =
  "idx_talent_normalized_stage_name";
export const TALENT_NORMALIZED_LEGAL_NAME_INDEX_NAME =
  "idx_talent_normalized_legal_name";
export const TALENT_NORMALIZED_DISPLAY_SHORT_NAME_INDEX_NAME =
  "idx_talent_normalized_display_short_name";
export const TALENT_STAGE_NAME_INDEX_NAME =
  "idx_talent_stage_name";
export const TALENT_LEGAL_NAME_INDEX_NAME =
  "idx_talent_legal_name";
export const TALENT_CREATED_AT_INDEX_NAME =
  "idx_talent_created_at";

export async function initTalentIndexes(
  db: Db,
): Promise<void> {
  const collection = db.collection("talents");

  await collection.createIndex(
    { talentCode: 1 },
    {
      name: TALENT_TALENT_CODE_UNIQ_INDEX_NAME,
      unique: true,
    },
  );

  await collection.createIndex(
    { linkedEmploymentProfileId: 1 },
    {
      name: TALENT_LINKED_EMPLOYMENT_PROFILE_UNIQ_INDEX_NAME,
      unique: true,
      partialFilterExpression: {
        linkedEmploymentProfileId: {
          $type: "string",
        },
        operationalStatus: {
          $in: ["ACTIVE", "SUSPENDED", "INACTIVE"],
        },
      },
    },
  );

  await collection.createIndex(
    { managerEmploymentProfileId: 1 },
    {
      name: TALENT_MANAGER_INDEX_NAME,
    },
  );

  await collection.createIndex(
    {
      operationalStatus: 1,
      talentOrigin: 1,
    },
    {
      name: TALENT_STATUS_ORIGIN_INDEX_NAME,
    },
  );

  await collection.createIndex(
    {
      commercialParticipationStatus: 1,
      livestreamEligible: 1,
      eventEligible: 1,
    },
    {
      name: TALENT_COMMERCIAL_PARTICIPATION_INDEX_NAME,
    },
  );

  await collection.createIndex(
    {
      normalizedStageName: 1,
      _id: 1,
    },
    {
      name: TALENT_NORMALIZED_STAGE_NAME_INDEX_NAME,
    },
  );

  await collection.createIndex(
    {
      normalizedLegalName: 1,
      _id: 1,
    },
    {
      name: TALENT_NORMALIZED_LEGAL_NAME_INDEX_NAME,
    },
  );

  await collection.createIndex(
    {
      normalizedDisplayShortName: 1,
      _id: 1,
    },
    {
      name:
        TALENT_NORMALIZED_DISPLAY_SHORT_NAME_INDEX_NAME,
    },
  );

  await collection.createIndex(
    {
      stageName: 1,
      _id: 1,
    },
    {
      name: TALENT_STAGE_NAME_INDEX_NAME,
    },
  );

  await collection.createIndex(
    {
      legalName: 1,
      _id: 1,
    },
    {
      name: TALENT_LEGAL_NAME_INDEX_NAME,
    },
  );

  await collection.createIndex(
    {
      createdAt: 1,
      _id: 1,
    },
    {
      name: TALENT_CREATED_AT_INDEX_NAME,
    },
  );
}
