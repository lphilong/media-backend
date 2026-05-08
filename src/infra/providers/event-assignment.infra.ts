import { Db } from "mongodb";
import { NativeMongoEventAssignmentReadRepository } from "@infra/mongo/event-assignment/event-assignment.read-repository";
import {
  NativeMongoEventAssignmentEmploymentProfileReadonlyAccess,
  NativeMongoEventAssignmentPlatformAccountReadonlyAccess,
  NativeMongoEventAssignmentStudioResourceReadonlyAccess,
  NativeMongoEventAssignmentTalentGroupReadonlyAccess,
  NativeMongoEventAssignmentTalentReadonlyAccess,
} from "@infra/mongo/event-assignment/event-assignment.readonly-access";
import { NativeMongoEventAssignmentRepository } from "@infra/mongo/event-assignment/event-assignment.repository";

export interface EventAssignmentInfra {
  readonly eventAssignmentRepository: NativeMongoEventAssignmentRepository;
  readonly eventAssignmentReadRepository: NativeMongoEventAssignmentReadRepository;
  readonly eventAssignmentEmploymentProfileReadonlyAccess: NativeMongoEventAssignmentEmploymentProfileReadonlyAccess;
  readonly eventAssignmentTalentReadonlyAccess: NativeMongoEventAssignmentTalentReadonlyAccess;
  readonly eventAssignmentTalentGroupReadonlyAccess: NativeMongoEventAssignmentTalentGroupReadonlyAccess;
  readonly eventAssignmentStudioResourceReadonlyAccess: NativeMongoEventAssignmentStudioResourceReadonlyAccess;
  readonly eventAssignmentPlatformAccountReadonlyAccess: NativeMongoEventAssignmentPlatformAccountReadonlyAccess;
}

export function createEventAssignmentInfra(
  db: Db,
): EventAssignmentInfra {
  return {
    eventAssignmentRepository:
      new NativeMongoEventAssignmentRepository(db),
    eventAssignmentReadRepository:
      new NativeMongoEventAssignmentReadRepository(
        db,
      ),
    eventAssignmentEmploymentProfileReadonlyAccess:
      new NativeMongoEventAssignmentEmploymentProfileReadonlyAccess(
        db,
      ),
    eventAssignmentTalentReadonlyAccess:
      new NativeMongoEventAssignmentTalentReadonlyAccess(
        db,
      ),
    eventAssignmentTalentGroupReadonlyAccess:
      new NativeMongoEventAssignmentTalentGroupReadonlyAccess(
        db,
      ),
    eventAssignmentStudioResourceReadonlyAccess:
      new NativeMongoEventAssignmentStudioResourceReadonlyAccess(
        db,
      ),
    eventAssignmentPlatformAccountReadonlyAccess:
      new NativeMongoEventAssignmentPlatformAccountReadonlyAccess(
        db,
      ),
  };
}
