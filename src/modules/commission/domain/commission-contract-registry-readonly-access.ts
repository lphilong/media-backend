import { ClientSession } from "mongodb";
import {
  ContractKind,
  ContractLinkedEntityKind,
  ContractRecordStatus,
} from "@modules/contract-registry/domain/contract-registry.types";

export interface CommissionReferencedContractRecord {
  readonly id: string;
  readonly contractKind: ContractKind;
  readonly linkedEntityKind: ContractLinkedEntityKind;
  readonly linkedEmploymentProfileId: string | null;
  readonly linkedTalentId: string | null;
  readonly status: ContractRecordStatus;
  readonly effectiveStartDate: number;
  readonly effectiveEndDate: number | null;
}

export interface CommissionContractRegistryReadonlyAccess {
  findById(
    contractRecordId: string,
    session?: ClientSession,
  ): Promise<CommissionReferencedContractRecord | null>;
}
