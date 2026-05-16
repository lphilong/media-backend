import { Db } from "mongodb";
import { NativeMongoBusinessCodeSequenceRepository } from "@infra/mongo/business-code/business-code-sequence.repository";
import {
  NativeMongoEmploymentProfileTalentReadonlyAccess,
  NativeMongoTalentGroupTalentReadonlyAccess,
  NativeMongoTalentEmploymentProfileReadonlyAccess,
  NativeMongoTalentReadRepository,
} from "@infra/mongo/talent/talent.read-repository";
import { NativeMongoTalentPlatformAccountReadonlyAccess } from "@infra/mongo/platform-account/platform-account.read-repository";
import { NativeMongoTalentTalentGroupReadonlyAccess } from "@infra/mongo/talent-group/talent-group.read-repository";
import { NativeMongoTalentWorkScheduleReadonlyAccess } from "@infra/mongo/work-schedule/work-schedule.readonly-access";
import { NativeMongoTalentEventAssignmentReadonlyAccess } from "@infra/mongo/event-assignment/event-assignment.readonly-access";
import { NativeMongoTalentRepository } from "@infra/mongo/talent/talent.repository";

export interface TalentInfra {
  readonly talentRepository: NativeMongoTalentRepository;
  readonly businessCodeSequenceRepository: NativeMongoBusinessCodeSequenceRepository;
  readonly talentReadRepository: NativeMongoTalentReadRepository;
  readonly talentEmploymentProfileReadonlyAccess: NativeMongoTalentEmploymentProfileReadonlyAccess;
  readonly talentGroupTalentReadonlyAccess: NativeMongoTalentGroupTalentReadonlyAccess;
  readonly talentTalentGroupReadonlyAccess: NativeMongoTalentTalentGroupReadonlyAccess;
  readonly talentPlatformAccountReadonlyAccess: NativeMongoTalentPlatformAccountReadonlyAccess;
  readonly talentWorkScheduleReadonlyAccess: NativeMongoTalentWorkScheduleReadonlyAccess;
  readonly talentEventAssignmentReadonlyAccess: NativeMongoTalentEventAssignmentReadonlyAccess;
  readonly employmentProfileTalentReadonlyAccess: NativeMongoEmploymentProfileTalentReadonlyAccess;
}

export function createTalentInfra(
  db: Db,
): TalentInfra {
  return {
    talentRepository:
      new NativeMongoTalentRepository(db),
    businessCodeSequenceRepository:
      new NativeMongoBusinessCodeSequenceRepository(db),
    talentReadRepository:
      new NativeMongoTalentReadRepository(db),
    talentEmploymentProfileReadonlyAccess:
      new NativeMongoTalentEmploymentProfileReadonlyAccess(
        db,
      ),
    talentGroupTalentReadonlyAccess:
      new NativeMongoTalentGroupTalentReadonlyAccess(
        db,
      ),
    talentTalentGroupReadonlyAccess:
      new NativeMongoTalentTalentGroupReadonlyAccess(
        db,
      ),
    talentPlatformAccountReadonlyAccess:
      new NativeMongoTalentPlatformAccountReadonlyAccess(
        db,
      ),
    talentWorkScheduleReadonlyAccess:
      new NativeMongoTalentWorkScheduleReadonlyAccess(
        db,
      ),
    talentEventAssignmentReadonlyAccess:
      new NativeMongoTalentEventAssignmentReadonlyAccess(
        db,
      ),
    employmentProfileTalentReadonlyAccess:
      new NativeMongoEmploymentProfileTalentReadonlyAccess(
        db,
      ),
  };
}
