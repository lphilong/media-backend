import { Db } from "mongodb";
import { NativeMongoTalentKpiReadRepository } from "@infra/mongo/talent-kpi/talent-kpi.read-repository";
import {
  NativeMongoTalentKpiEventReadonlyAccess,
  NativeMongoTalentKpiPlatformAccountReadonlyAccess,
  NativeMongoTalentKpiTalentReadonlyAccess,
} from "@infra/mongo/talent-kpi/talent-kpi.readonly-access";
import { NativeMongoTalentKpiRepository } from "@infra/mongo/talent-kpi/talent-kpi.repository";

export interface TalentKpiInfra {
  readonly talentKpiRepository: NativeMongoTalentKpiRepository;
  readonly talentKpiReadRepository: NativeMongoTalentKpiReadRepository;
  readonly talentKpiTalentReadonlyAccess: NativeMongoTalentKpiTalentReadonlyAccess;
  readonly talentKpiPlatformAccountReadonlyAccess: NativeMongoTalentKpiPlatformAccountReadonlyAccess;
  readonly talentKpiEventReadonlyAccess: NativeMongoTalentKpiEventReadonlyAccess;
}

export function createTalentKpiInfra(
  db: Db,
): TalentKpiInfra {
  return {
    talentKpiRepository:
      new NativeMongoTalentKpiRepository(db),
    talentKpiReadRepository:
      new NativeMongoTalentKpiReadRepository(db),
    talentKpiTalentReadonlyAccess:
      new NativeMongoTalentKpiTalentReadonlyAccess(
        db,
      ),
    talentKpiPlatformAccountReadonlyAccess:
      new NativeMongoTalentKpiPlatformAccountReadonlyAccess(
        db,
      ),
    talentKpiEventReadonlyAccess:
      new NativeMongoTalentKpiEventReadonlyAccess(
        db,
      ),
  };
}
