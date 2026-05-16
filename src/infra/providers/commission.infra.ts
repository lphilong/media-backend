import { Db } from "mongodb";
import { NativeMongoBusinessCodeSequenceRepository } from "@infra/mongo/business-code/business-code-sequence.repository";
import { NativeMongoCommissionReadRepository } from "@infra/mongo/commission/commission.read-repository";
import {
  NativeMongoCommissionContractRegistryReadonlyAccess,
  NativeMongoCommissionEmploymentProfileReadonlyAccess,
  NativeMongoCommissionRevenueLedgerReadonlyAccess,
  NativeMongoCommissionTalentReadonlyAccess,
} from "@infra/mongo/commission/commission.readonly-access";
import { NativeMongoCommissionRepository } from "@infra/mongo/commission/commission.repository";

export interface CommissionRevenueShareInfra {
  readonly commissionRepository: NativeMongoCommissionRepository;
  readonly businessCodeSequenceRepository: NativeMongoBusinessCodeSequenceRepository;
  readonly commissionReadRepository: NativeMongoCommissionReadRepository;
  readonly commissionEmploymentProfileReadonlyAccess: NativeMongoCommissionEmploymentProfileReadonlyAccess;
  readonly commissionTalentReadonlyAccess: NativeMongoCommissionTalentReadonlyAccess;
  readonly commissionContractRegistryReadonlyAccess: NativeMongoCommissionContractRegistryReadonlyAccess;
  readonly commissionRevenueLedgerReadonlyAccess: NativeMongoCommissionRevenueLedgerReadonlyAccess;
}

export function createCommissionRevenueShareInfra(
  db: Db,
): CommissionRevenueShareInfra {
  return {
    commissionRepository:
      new NativeMongoCommissionRepository(db),
    businessCodeSequenceRepository:
      new NativeMongoBusinessCodeSequenceRepository(db),
    commissionReadRepository:
      new NativeMongoCommissionReadRepository(db),
    commissionEmploymentProfileReadonlyAccess:
      new NativeMongoCommissionEmploymentProfileReadonlyAccess(
        db,
      ),
    commissionTalentReadonlyAccess:
      new NativeMongoCommissionTalentReadonlyAccess(db),
    commissionContractRegistryReadonlyAccess:
      new NativeMongoCommissionContractRegistryReadonlyAccess(
        db,
      ),
    commissionRevenueLedgerReadonlyAccess:
      new NativeMongoCommissionRevenueLedgerReadonlyAccess(
        db,
      ),
  };
}
