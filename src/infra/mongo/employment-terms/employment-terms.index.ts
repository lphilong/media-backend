import { Db } from "mongodb";

export async function initEmploymentTermsIndexes(db: Db): Promise<void> {
  const collection = db.collection("employment_terms");
  await collection.createIndex({ termsCode: 1 }, { name: "uniq_employment_terms_code", unique: true });
  await collection.createIndex({ employmentProfileId: 1 }, { name: "idx_employment_terms_profile" });
  await collection.createIndex(
    { employmentProfileId: 1, status: 1 },
    { name: "idx_employment_terms_profile_status" },
  );
  await collection.createIndex(
    { employmentProfileId: 1, status: 1, payrollEligible: 1, effectiveFrom: 1, effectiveTo: 1 },
    { name: "idx_employment_terms_payroll_window" },
  );
  await collection.createIndex(
    { supersedesTermsId: 1, supersededByTermsId: 1 },
    { name: "idx_employment_terms_supersession" },
  );
}
