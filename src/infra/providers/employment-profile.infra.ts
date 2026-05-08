import { Db } from "mongodb";
import {
  NativeMongoEmploymentProfileOrgUnitReadonlyAccess,
  NativeMongoEmploymentProfileReadRepository,
  NativeMongoEmploymentProfileUserReadonlyAccess,
  NativeMongoOrgUnitEmploymentReadonlyAccess,
} from "@infra/mongo/employment-profile/employment-profile.read-repository";
import { NativeMongoEmploymentProfileTalentReadonlyAccess } from "@infra/mongo/talent/talent.read-repository";
import { NativeMongoEmploymentProfileWorkScheduleReadonlyAccess } from "@infra/mongo/work-schedule/work-schedule.readonly-access";
import { NativeMongoEmploymentProfileEventAssignmentReadonlyAccess } from "@infra/mongo/event-assignment/event-assignment.readonly-access";
import { NativeMongoEmploymentProfileRepository } from "@infra/mongo/employment-profile/employment-profile.repository";

export interface EmploymentProfileInfra {
  readonly employmentProfileRepository: NativeMongoEmploymentProfileRepository;
  readonly employmentProfileReadRepository: NativeMongoEmploymentProfileReadRepository;
  readonly employmentProfileOrgUnitReadonlyAccess: NativeMongoEmploymentProfileOrgUnitReadonlyAccess;
  readonly employmentProfileUserReadonlyAccess: NativeMongoEmploymentProfileUserReadonlyAccess;
  readonly employmentProfileTalentReadonlyAccess: NativeMongoEmploymentProfileTalentReadonlyAccess;
  readonly employmentProfileWorkScheduleReadonlyAccess: NativeMongoEmploymentProfileWorkScheduleReadonlyAccess;
  readonly employmentProfileEventAssignmentReadonlyAccess: NativeMongoEmploymentProfileEventAssignmentReadonlyAccess;
  readonly orgUnitEmploymentReadonlyAccess: NativeMongoOrgUnitEmploymentReadonlyAccess;
}

export function createEmploymentProfileInfra(
  db: Db,
): EmploymentProfileInfra {
  return {
    employmentProfileRepository:
      new NativeMongoEmploymentProfileRepository(db),
    employmentProfileReadRepository:
      new NativeMongoEmploymentProfileReadRepository(
        db,
      ),
    employmentProfileOrgUnitReadonlyAccess:
      new NativeMongoEmploymentProfileOrgUnitReadonlyAccess(
        db,
      ),
    employmentProfileUserReadonlyAccess:
      new NativeMongoEmploymentProfileUserReadonlyAccess(
        db,
      ),
    employmentProfileTalentReadonlyAccess:
      new NativeMongoEmploymentProfileTalentReadonlyAccess(
        db,
      ),
    employmentProfileWorkScheduleReadonlyAccess:
      new NativeMongoEmploymentProfileWorkScheduleReadonlyAccess(
        db,
      ),
    employmentProfileEventAssignmentReadonlyAccess:
      new NativeMongoEmploymentProfileEventAssignmentReadonlyAccess(
        db,
      ),
    orgUnitEmploymentReadonlyAccess:
      new NativeMongoOrgUnitEmploymentReadonlyAccess(
        db,
      ),
  };
}
