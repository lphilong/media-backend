import { Db } from "mongodb";
import { NativeMongoBusinessCodeSequenceRepository } from "@infra/mongo/business-code/business-code-sequence.repository";
import {
  NativeMongoTalentGroupReadRepository,
  NativeMongoTalentTalentGroupReadonlyAccess,
} from "@infra/mongo/talent-group/talent-group.read-repository";
import { NativeMongoTalentGroupPlatformAccountReadonlyAccess } from "@infra/mongo/platform-account/platform-account.read-repository";
import { NativeMongoTalentGroupTalentReadonlyAccess } from "@infra/mongo/talent/talent.read-repository";
import { NativeMongoTalentGroupWorkScheduleReadonlyAccess } from "@infra/mongo/work-schedule/work-schedule.readonly-access";
import { NativeMongoTalentGroupEventAssignmentReadonlyAccess } from "@infra/mongo/event-assignment/event-assignment.readonly-access";
import { NativeMongoTalentGroupRepository } from "@infra/mongo/talent-group/talent-group.repository";

export interface TalentGroupInfra {
  readonly talentGroupRepository: NativeMongoTalentGroupRepository;
  readonly businessCodeSequenceRepository: NativeMongoBusinessCodeSequenceRepository;
  readonly talentGroupReadRepository: NativeMongoTalentGroupReadRepository;
  readonly talentGroupTalentReadonlyAccess: NativeMongoTalentGroupTalentReadonlyAccess;
  readonly talentGroupPlatformAccountReadonlyAccess: NativeMongoTalentGroupPlatformAccountReadonlyAccess;
  readonly talentGroupWorkScheduleReadonlyAccess: NativeMongoTalentGroupWorkScheduleReadonlyAccess;
  readonly talentGroupEventAssignmentReadonlyAccess: NativeMongoTalentGroupEventAssignmentReadonlyAccess;
  readonly talentTalentGroupReadonlyAccess: NativeMongoTalentTalentGroupReadonlyAccess;
}

export function createTalentGroupInfra(
  db: Db,
): TalentGroupInfra {
  return {
    talentGroupRepository:
      new NativeMongoTalentGroupRepository(db),
    businessCodeSequenceRepository:
      new NativeMongoBusinessCodeSequenceRepository(db),
    talentGroupReadRepository:
      new NativeMongoTalentGroupReadRepository(db),
    talentGroupTalentReadonlyAccess:
      new NativeMongoTalentGroupTalentReadonlyAccess(
        db,
      ),
    talentGroupPlatformAccountReadonlyAccess:
      new NativeMongoTalentGroupPlatformAccountReadonlyAccess(
        db,
      ),
    talentGroupWorkScheduleReadonlyAccess:
      new NativeMongoTalentGroupWorkScheduleReadonlyAccess(
        db,
      ),
    talentGroupEventAssignmentReadonlyAccess:
      new NativeMongoTalentGroupEventAssignmentReadonlyAccess(
        db,
      ),
    talentTalentGroupReadonlyAccess:
      new NativeMongoTalentTalentGroupReadonlyAccess(
        db,
      ),
  };
}
