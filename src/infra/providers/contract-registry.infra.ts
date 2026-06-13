import { Db } from "mongodb";
import { NativeMongoBusinessCodeSequenceRepository } from "@infra/mongo/business-code/business-code-sequence.repository";
import { NativeMongoContractRegistryReadRepository } from "@infra/mongo/contract-registry/contract-registry.read-repository";
import {
  NativeMongoContractRegistryEmploymentProfileReadonlyAccess,
  NativeMongoContractRegistryTalentReadonlyAccess,
} from "@infra/mongo/contract-registry/contract-registry.readonly-access";
import { NativeMongoContractRegistryRepository } from "@infra/mongo/contract-registry/contract-registry.repository";
import { NativeMongoContractObligationRepository } from "@infra/mongo/contract-registry/contract-obligation.repository";
import { NativeMongoContractObligationReadRepository } from "@infra/mongo/contract-registry/contract-obligation.read-repository";
import { NativeMongoContractObligationEventEvidenceLinkRepository } from "@infra/mongo/contract-registry/contract-obligation-event-evidence-link.repository";
import { NativeMongoContractObligationEventEvidenceLinkReadRepository } from "@infra/mongo/contract-registry/contract-obligation-event-evidence-link.read-repository";

export interface ContractRegistryInfra {
  readonly contractRegistryRepository: NativeMongoContractRegistryRepository;
  readonly businessCodeSequenceRepository: NativeMongoBusinessCodeSequenceRepository;
  readonly contractRegistryReadRepository: NativeMongoContractRegistryReadRepository;
  readonly contractRegistryEmploymentProfileReadonlyAccess: NativeMongoContractRegistryEmploymentProfileReadonlyAccess;
  readonly contractRegistryTalentReadonlyAccess: NativeMongoContractRegistryTalentReadonlyAccess;
  readonly contractObligationRepository: NativeMongoContractObligationRepository;
  readonly contractObligationReadRepository: NativeMongoContractObligationReadRepository;
  readonly contractObligationEventEvidenceLinkRepository: NativeMongoContractObligationEventEvidenceLinkRepository;
  readonly contractObligationEventEvidenceLinkReadRepository: NativeMongoContractObligationEventEvidenceLinkReadRepository;
}

export function createContractRegistryInfra(
  db: Db,
): ContractRegistryInfra {
  return {
    contractRegistryRepository:
      new NativeMongoContractRegistryRepository(db),
    businessCodeSequenceRepository:
      new NativeMongoBusinessCodeSequenceRepository(db),
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
    contractObligationRepository:
      new NativeMongoContractObligationRepository(db),
    contractObligationReadRepository:
      new NativeMongoContractObligationReadRepository(db),
    contractObligationEventEvidenceLinkRepository:
      new NativeMongoContractObligationEventEvidenceLinkRepository(
        db,
      ),
    contractObligationEventEvidenceLinkReadRepository:
      new NativeMongoContractObligationEventEvidenceLinkReadRepository(
        db,
      ),
  };
}
