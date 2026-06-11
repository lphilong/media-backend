import { Db } from "mongodb";
import { NativeMongoPeopleReadinessReadRepository } from "@infra/mongo/people-readiness/people-readiness.read-repository";
import { NativeMongoEmploymentTermsReadinessReadonlyAccess } from "@infra/mongo/employment-terms/employment-terms-readiness.readonly-access";

export function createPeopleReadinessInfra(db: Db) {
  return {
    peopleReadinessReadRepository:
      new NativeMongoPeopleReadinessReadRepository(db),
    employmentTermsReadinessReadonlyAccess:
      new NativeMongoEmploymentTermsReadinessReadonlyAccess(db),
  };
}
