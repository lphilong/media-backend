import { Db } from "mongodb";
import { NativeMongoContractRegistryReadRepository } from "@infra/mongo/contract-registry/contract-registry.read-repository";
import {
  NativeMongoContractRegistryEmploymentProfileReadonlyAccess,
  NativeMongoContractRegistryTalentReadonlyAccess,
} from "@infra/mongo/contract-registry/contract-registry.readonly-access";
import { NativeMongoContractRegistryRepository } from "@infra/mongo/contract-registry/contract-registry.repository";

export interface ContractRegistryInfra {
  readonly contractRegistryRepository: NativeMongoContractRegistryRepository;
  readonly contractRegistryReadRepository: NativeMongoContractRegistryReadRepository;
  readonly contractRegistryEmploymentProfileReadonlyAccess: NativeMongoContractRegistryEmploymentProfileReadonlyAccess;
  readonly contractRegistryTalentReadonlyAccess: NativeMongoContractRegistryTalentReadonlyAccess;
}

export function createContractRegistryInfra(
  db: Db,
): ContractRegistryInfra {
  return {
    contractRegistryRepository:
      new NativeMongoContractRegistryRepository(db),
    contractRegistryReadRepository:
      new NativeMongoContractRegistryReadRepository(
        db,
      ),
    contractRegistryEmploymentProfileReadonlyAccess:
      new NativeMongoContractRegistryEmploymentProfileReadonlyAccess(
        db,
      ),
    contractRegistryTalentReadonlyAccess:
      new NativeMongoContractRegistryTalentReadonlyAccess(
        db,
      ),
  };
}
