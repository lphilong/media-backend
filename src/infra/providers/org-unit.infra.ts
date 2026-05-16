import { Db } from "mongodb";
import { NativeMongoBusinessCodeSequenceRepository } from "@infra/mongo/business-code/business-code-sequence.repository";
import { NativeMongoOrgUnitEmploymentReadonlyAccess } from "@infra/mongo/employment-profile/employment-profile.read-repository";
import { NativeMongoOrgUnitPlatformAccountReadonlyAccess } from "@infra/mongo/platform-account/platform-account.read-repository";
import { NativeMongoOrgUnitReadRepository } from "@infra/mongo/org-unit/org-unit.read-repository";
import { NativeMongoOrgUnitRepository } from "@infra/mongo/org-unit/org-unit.repository";

export interface OrgUnitInfra {
  readonly orgUnitRepository: NativeMongoOrgUnitRepository;
  readonly businessCodeSequenceRepository: NativeMongoBusinessCodeSequenceRepository;
  readonly orgUnitReadRepository: NativeMongoOrgUnitReadRepository;
  readonly orgUnitEmploymentReadonlyAccess: NativeMongoOrgUnitEmploymentReadonlyAccess;
  readonly orgUnitPlatformAccountReadonlyAccess: NativeMongoOrgUnitPlatformAccountReadonlyAccess;
}

export function createOrgUnitInfra(
  db: Db,
): OrgUnitInfra {
  return {
    orgUnitRepository:
      new NativeMongoOrgUnitRepository(db),
    businessCodeSequenceRepository:
      new NativeMongoBusinessCodeSequenceRepository(db),
    orgUnitReadRepository:
      new NativeMongoOrgUnitReadRepository(db),
    orgUnitEmploymentReadonlyAccess:
      new NativeMongoOrgUnitEmploymentReadonlyAccess(
        db,
      ),
    orgUnitPlatformAccountReadonlyAccess:
      new NativeMongoOrgUnitPlatformAccountReadonlyAccess(
        db,
      ),
  };
}
