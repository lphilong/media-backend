import {
  ContractConfidentialityTier,
  ContractKind,
  ContractLinkedEntityKind,
  ContractRecordByLinkedEntityListItemView,
  ContractRecordByOwnerListItemView,
  ContractRecordDetailView,
  ContractRecordListItemView,
  ContractRecordSortDirection,
  ContractRecordSortField,
  ContractRecordStatus,
} from "@modules/contract-registry/domain/contract-registry.types";

export interface ListContractRecordsReadInput {
  readonly status?: ContractRecordStatus;
  readonly contractKind?: ContractKind;
  readonly linkedEntityKind?: ContractLinkedEntityKind;
  readonly linkedEmploymentProfileId?: string;
  readonly linkedTalentId?: string;
  readonly ownerEmploymentProfileId?: string;
  readonly confidentialityTier?: ContractConfidentialityTier;
  readonly hasFileReference?: boolean;
  readonly windowStartDate?: number;
  readonly windowEndDate?: number;
  readonly limit: number;
  readonly cursor?: string;
  readonly search?: string;
  readonly sortField?: ContractRecordSortField;
  readonly sortDirection?: ContractRecordSortDirection;
}

export interface ListContractRecordsByLinkedEntityReadInput {
  readonly linkedEntityKind: ContractLinkedEntityKind;
  readonly linkedEmploymentProfileId: string | null;
  readonly linkedTalentId: string | null;
  readonly status?: ContractRecordStatus;
  readonly windowStartDate?: number;
  readonly windowEndDate?: number;
  readonly limit: number;
  readonly cursor?: string;
  readonly sortField?: ContractRecordSortField;
  readonly sortDirection?: ContractRecordSortDirection;
}

export interface ListContractRecordsByOwnerReadInput {
  readonly ownerEmploymentProfileId: string;
  readonly status?: ContractRecordStatus;
  readonly windowStartDate?: number;
  readonly windowEndDate?: number;
  readonly limit: number;
  readonly cursor?: string;
  readonly sortField?: ContractRecordSortField;
  readonly sortDirection?: ContractRecordSortDirection;
}

export interface ListContractRecordsReadResult {
  readonly items: readonly ContractRecordListItemView[];
  readonly nextCursor?: string;
}

export interface ListContractRecordsByLinkedEntityReadResult {
  readonly items: readonly ContractRecordByLinkedEntityListItemView[];
  readonly nextCursor?: string;
}

export interface ListContractRecordsByOwnerReadResult {
  readonly items: readonly ContractRecordByOwnerListItemView[];
  readonly nextCursor?: string;
}

export interface ContractRegistryReadRepository {
  listContractRecords(
    input: ListContractRecordsReadInput,
  ): Promise<ListContractRecordsReadResult>;

  listContractRecordsByLinkedEntity(
    input: ListContractRecordsByLinkedEntityReadInput,
  ): Promise<ListContractRecordsByLinkedEntityReadResult>;

  listContractRecordsByOwner(
    input: ListContractRecordsByOwnerReadInput,
  ): Promise<ListContractRecordsByOwnerReadResult>;

  getContractRecordDetail(
    contractRecordId: string,
  ): Promise<ContractRecordDetailView | null>;
}
