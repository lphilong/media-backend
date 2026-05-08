import { Db } from "mongodb";
import {
  NativeMongoPlatformAccountOrgUnitReadonlyAccess,
  NativeMongoOrgUnitPlatformAccountReadonlyAccess,
  NativeMongoPlatformAccountReadRepository,
  NativeMongoPlatformAccountTalentGroupReadonlyAccess,
  NativeMongoPlatformAccountTalentReadonlyAccess,
  NativeMongoTalentGroupPlatformAccountReadonlyAccess,
  NativeMongoTalentPlatformAccountReadonlyAccess,
} from "@infra/mongo/platform-account/platform-account.read-repository";
import { NativeMongoPlatformAccountEventAssignmentReadonlyAccess } from "@infra/mongo/event-assignment/event-assignment.readonly-access";
import { NativeMongoPlatformAccountRepository } from "@infra/mongo/platform-account/platform-account.repository";

export interface PlatformAccountInfra {
  readonly platformAccountRepository: NativeMongoPlatformAccountRepository;
  readonly platformAccountReadRepository: NativeMongoPlatformAccountReadRepository;
  readonly platformAccountOrgUnitReadonlyAccess: NativeMongoPlatformAccountOrgUnitReadonlyAccess;
  readonly platformAccountTalentReadonlyAccess: NativeMongoPlatformAccountTalentReadonlyAccess;
  readonly platformAccountTalentGroupReadonlyAccess: NativeMongoPlatformAccountTalentGroupReadonlyAccess;
  readonly orgUnitPlatformAccountReadonlyAccess: NativeMongoOrgUnitPlatformAccountReadonlyAccess;
  readonly talentPlatformAccountReadonlyAccess: NativeMongoTalentPlatformAccountReadonlyAccess;
  readonly talentGroupPlatformAccountReadonlyAccess: NativeMongoTalentGroupPlatformAccountReadonlyAccess;
  readonly platformAccountEventAssignmentReadonlyAccess: NativeMongoPlatformAccountEventAssignmentReadonlyAccess;
}

export function createPlatformAccountInfra(
  db: Db,
): PlatformAccountInfra {
  return {
    platformAccountRepository:
      new NativeMongoPlatformAccountRepository(db),
    platformAccountReadRepository:
      new NativeMongoPlatformAccountReadRepository(
        db,
      ),
    platformAccountOrgUnitReadonlyAccess:
      new NativeMongoPlatformAccountOrgUnitReadonlyAccess(
        db,
      ),
    platformAccountTalentReadonlyAccess:
      new NativeMongoPlatformAccountTalentReadonlyAccess(
        db,
      ),
    platformAccountTalentGroupReadonlyAccess:
      new NativeMongoPlatformAccountTalentGroupReadonlyAccess(
        db,
      ),
    orgUnitPlatformAccountReadonlyAccess:
      new NativeMongoOrgUnitPlatformAccountReadonlyAccess(
        db,
      ),
    talentPlatformAccountReadonlyAccess:
      new NativeMongoTalentPlatformAccountReadonlyAccess(
        db,
      ),
    talentGroupPlatformAccountReadonlyAccess:
      new NativeMongoTalentGroupPlatformAccountReadonlyAccess(
        db,
      ),
    platformAccountEventAssignmentReadonlyAccess:
      new NativeMongoPlatformAccountEventAssignmentReadonlyAccess(
        db,
      ),
  };
}
