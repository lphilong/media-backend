import { Db } from "mongodb";
import { NativeMongoResponsibilityAssignmentRepository } from "@infra/mongo/responsibility/responsibility.repository";

export interface ResponsibilityInfra {
  readonly responsibilityAssignmentRepository: NativeMongoResponsibilityAssignmentRepository;
}

export function createResponsibilityInfra(db: Db): ResponsibilityInfra {
  return {
    responsibilityAssignmentRepository:
      new NativeMongoResponsibilityAssignmentRepository(db),
  };
}

