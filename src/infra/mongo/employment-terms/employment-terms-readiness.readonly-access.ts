import { Db } from "mongodb";
import { EmploymentTermsReadinessReadonlyAccess } from "@modules/employment-terms/domain/employment-terms-readiness-readonly-access";
import {
  EmploymentTermsReadinessFacts,
  evaluateEmploymentTermsReadiness,
} from "@modules/employment-terms/domain/employment-terms-readiness";
import { EmploymentTermsRecord } from "@modules/employment-terms/domain/employment-terms.types";

interface EmploymentTermsDocument extends Omit<EmploymentTermsRecord, "id"> {
  readonly _id: string;
}

export class NativeMongoEmploymentTermsReadinessReadonlyAccess
  implements EmploymentTermsReadinessReadonlyAccess
{
  constructor(private readonly db: Db) {}

  async getReadinessFacts(
    employmentProfileIds: readonly string[],
    asOfDate: number,
  ): Promise<ReadonlyMap<string, EmploymentTermsReadinessFacts>> {
    const uniqueIds = [...new Set(employmentProfileIds.filter(Boolean))];
    if (uniqueIds.length === 0) return new Map();

    const documents = await this.db.collection<EmploymentTermsDocument>("employment_terms")
      .find({ employmentProfileId: { $in: uniqueIds } })
      .sort({ employmentProfileId: 1, effectiveFrom: 1, _id: 1 })
      .toArray();
    const recordsByProfile = new Map<string, EmploymentTermsRecord[]>();
    for (const document of documents) {
      const records = recordsByProfile.get(document.employmentProfileId) ?? [];
      const { _id, ...record } = document;
      records.push({ id: _id, ...record });
      recordsByProfile.set(document.employmentProfileId, records);
    }

    return new Map(uniqueIds.map((employmentProfileId) => [
      employmentProfileId,
      evaluateEmploymentTermsReadiness(
        recordsByProfile.get(employmentProfileId) ?? [],
        asOfDate,
      ),
    ]));
  }
}
