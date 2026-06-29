import { Db } from "mongodb";
import { NativeMongoBusinessCodeSequenceRepository } from "@infra/mongo/business-code/business-code-sequence.repository";
import { NativeMongoKpiPlanRepository } from "@infra/mongo/kpi/kpi.repository";
import { NativeMongoKpiActualRepository } from "@infra/mongo/kpi/kpi-actual.repository";
import { NativeMongoKpiSubjectReadonlyAccess } from "@infra/mongo/kpi/kpi.readonly-access";

export interface KpiInfra {
  readonly kpiPlanRepository: NativeMongoKpiPlanRepository;
  readonly kpiActualRepository: NativeMongoKpiActualRepository;
  readonly kpiBusinessCodeSequenceRepository: NativeMongoBusinessCodeSequenceRepository;
  readonly kpiSubjectReadonlyAccess: NativeMongoKpiSubjectReadonlyAccess;
}

export function createKpiInfra(db: Db): KpiInfra {
  return {
    kpiPlanRepository: new NativeMongoKpiPlanRepository(db),
    kpiActualRepository: new NativeMongoKpiActualRepository(db),
    kpiBusinessCodeSequenceRepository:
      new NativeMongoBusinessCodeSequenceRepository(db),
    kpiSubjectReadonlyAccess: new NativeMongoKpiSubjectReadonlyAccess(db),
  };
}
