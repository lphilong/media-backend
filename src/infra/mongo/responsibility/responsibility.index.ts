import { Db } from "mongodb";

export const RESPONSIBILITY_ASSIGNMENT_SUBJECT_ACTIVE_INDEX_NAME =
  "idx_responsibility_subject_active";
export const RESPONSIBILITY_ASSIGNMENT_RESPONSIBLE_ACTIVE_INDEX_NAME =
  "idx_responsibility_responsible_active";
export const RESPONSIBILITY_ASSIGNMENT_ACTIVE_PRIMARY_UNIQ_INDEX_NAME =
  "uniq_responsibility_active_primary";

export async function initResponsibilityIndexes(db: Db): Promise<void> {
  const collection = db.collection("responsibility_assignments");

  await collection.createIndex(
    {
      subjectType: 1,
      subjectId: 1,
      responsibilityType: 1,
      status: 1,
      effectiveAt: 1,
      expiresAt: 1,
    },
    { name: RESPONSIBILITY_ASSIGNMENT_SUBJECT_ACTIVE_INDEX_NAME },
  );
  await collection.createIndex(
    {
      responsibleEmploymentProfileId: 1,
      responsibilityType: 1,
      status: 1,
      effectiveAt: 1,
      expiresAt: 1,
    },
    { name: RESPONSIBILITY_ASSIGNMENT_RESPONSIBLE_ACTIVE_INDEX_NAME },
  );
  await collection.createIndex(
    {
      subjectType: 1,
      subjectId: 1,
      responsibilityType: 1,
      isPrimary: 1,
      status: 1,
    },
    {
      name: RESPONSIBILITY_ASSIGNMENT_ACTIVE_PRIMARY_UNIQ_INDEX_NAME,
      unique: true,
      partialFilterExpression: {
        isPrimary: true,
        status: "ACTIVE",
      },
    },
  );
}
