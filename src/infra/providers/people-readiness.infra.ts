import { Db } from "mongodb";
import { NativeMongoPeopleReadinessReadRepository } from "@infra/mongo/people-readiness/people-readiness.read-repository";

export function createPeopleReadinessInfra(db: Db) {
  return {
    peopleReadinessReadRepository:
      new NativeMongoPeopleReadinessReadRepository(db),
  };
}
