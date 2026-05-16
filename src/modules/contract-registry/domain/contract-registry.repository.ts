import { ClientSession } from "mongodb";
import { BusinessCodePolicy } from "@core/business-code/business-code-sequence.repository";
import {
  ContractConfidentialityTier,
  ContractLinkedEntityKind,
  ContractRecord,
  ContractRecordStatus,
} from "./contract-registry.types";

export interface UpdateContractRecordDraftCoreInput {
  readonly contractRecordId: string;
  readonly title?: string;
  readonly normalizedTitle?: string;
  readonly linkedEntityKind?: ContractLinkedEntityKind;
  readonly linkedEmploymentProfileId?: string | null;
  readonly linkedTalentId?: string | null;
  readonly confidentialityTier?: ContractConfidentialityTier;
  readonly effectiveStartDate?: number;
  readonly effectiveEndDate?: number | null;
  readonly description?: string | null;
  readonly externalRef?: string | null;
  readonly updatedAt: number;
}

export interface AssignContractRecordOwnerInput {
  readonly contractRecordId: string;
  readonly ownerEmploymentProfileId: string;
  readonly updatedAt: number;
}

export interface UpdateContractRecordFileReferenceInput {
  readonly contractRecordId: string;
  readonly fileReferenceId: string | null;
  readonly fileDisplayName: string | null;
  readonly updatedAt: number;
}

export interface TransitionContractRecordStatusInput {
  readonly contractRecordId: string;
  readonly fromStatuses: readonly ContractRecordStatus[];
  readonly toStatus: ContractRecordStatus;
  readonly effectiveEndDate?: number;
  readonly updatedAt: number;
}

export interface ContractRegistryRepository {
  insert(
    contractRecord: ContractRecord,
    session: ClientSession,
  ): Promise<ContractRecord>;

  findById(
    contractRecordId: string,
    session?: ClientSession,
  ): Promise<ContractRecord | null>;

  findByContractCode(
    contractCode: string,
    session?: ClientSession,
  ): Promise<ContractRecord | null>;

  findMaxGeneratedContractCodeSequence(
    policy: Pick<BusinessCodePolicy, "prefix" | "width">,
    session?: ClientSession,
  ): Promise<number>;

  updateDraftCore(
    input: UpdateContractRecordDraftCoreInput,
    session: ClientSession,
  ): Promise<ContractRecord | null>;

  assignOwner(
    input: AssignContractRecordOwnerInput,
    session: ClientSession,
  ): Promise<ContractRecord | null>;

  updateFileReference(
    input: UpdateContractRecordFileReferenceInput,
    session: ClientSession,
  ): Promise<ContractRecord | null>;

  transitionStatus(
    input: TransitionContractRecordStatusInput,
    session: ClientSession,
  ): Promise<ContractRecord | null>;
}
