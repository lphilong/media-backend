import { Db } from "mongodb";
import { NativeMongoBusinessCodeSequenceRepository } from "@infra/mongo/business-code/business-code-sequence.repository";
import { NativeMongoEmploymentTermsRepository } from "@infra/mongo/employment-terms/employment-terms.repository";

export function createEmploymentTermsInfra(db: Db) {
  return {
    employmentTermsRepository: new NativeMongoEmploymentTermsRepository(db),
    employmentTermsCodeSequenceRepository: new NativeMongoBusinessCodeSequenceRepository(db),
  };
}
