import {
  ContractConfidentialityTier,
  ContractKind,
  ContractLinkedEntityKind,
  ContractRecordByLinkedEntityListItemView,
  ContractRecordByOwnerListItemView,
  ContractRecordDetailView,
  ContractRecordListItemView,
  ContractRecordMutationView,
  ContractRecordSortDirection,
  ContractRecordSortField,
  ContractRecordStatus,
} from "@modules/contract-registry/domain/contract-registry.types";

export interface CreateContractRecordCommand {
  readonly contractCode?: string | null;
  readonly title: string;
  readonly contractKind: ContractKind | string;
  readonly linkedEntityKind: ContractLinkedEntityKind | string;
  readonly linkedEmploymentProfileId?: string | null;
  readonly linkedTalentId?: string | null;
  readonly ownerEmploymentProfileId: string;
  readonly confidentialityTier: ContractConfidentialityTier | string;
  readonly effectiveStartDate: string;
  readonly effectiveEndDate?: string | null;
  readonly fileReferenceId?: string | null;
  readonly fileDisplayName?: string | null;
  readonly description?: string | null;
  readonly externalRef?: string | null;
}

export interface UpdateContractRecordDraftCoreCommand {
  readonly contractRecordId: string;
  readonly title?: string;
  readonly linkedEntityKind?: ContractLinkedEntityKind | string;
  readonly linkedEmploymentProfileId?: string | null;
  readonly linkedTalentId?: string | null;
  readonly confidentialityTier?: ContractConfidentialityTier | string;
  readonly effectiveStartDate?: string;
  readonly effectiveEndDate?: string | null;
  readonly description?: string | null;
  readonly externalRef?: string | null;
}

export interface AssignContractRecordOwnerCommand {
  readonly contractRecordId: string;
  readonly newOwnerEmploymentProfileId: string;
}

export interface UpdateContractRecordFileReferenceCommand {
  readonly contractRecordId: string;
  readonly newFileReferenceId: string | null;
  readonly newFileDisplayName: string | null;
}

export interface MarkContractRecordPendingSignatureCommand {
  readonly contractRecordId: string;
}

export interface ReopenContractRecordDraftCommand {
  readonly contractRecordId: string;
}

export interface ActivateContractRecordCommand {
  readonly contractRecordId: string;
}

export interface ExpireContractRecordCommand {
  readonly contractRecordId: string;
  readonly expiryDate: string;
}

export interface TerminateContractRecordCommand {
  readonly contractRecordId: string;
  readonly terminationDate: string;
}

export interface ArchiveContractRecordCommand {
  readonly contractRecordId: string;
}

export interface GetContractRecordDetailQuery {
  readonly contractRecordId: string;
}

export interface ListContractRecordsQuery {
  readonly status?: ContractRecordStatus | string;
  readonly contractKind?: ContractKind | string;
  readonly linkedEntityKind?: ContractLinkedEntityKind | string;
  readonly linkedEmploymentProfileId?: string;
  readonly linkedTalentId?: string;
  readonly ownerEmploymentProfileId?: string;
  readonly confidentialityTier?: ContractConfidentialityTier | string;
  readonly hasFileReference?: boolean | string;
  readonly windowStartDate?: string;
  readonly windowEndDate?: string;
  readonly limit?: number | string;
  readonly cursor?: string;
  readonly search?: string;
  readonly sortBy?: ContractRecordSortField | string;
  readonly sortDirection?: ContractRecordSortDirection | string;
}

export interface ListContractRecordsByLinkedEntityQuery {
  readonly linkedEntityKind: ContractLinkedEntityKind | string;
  readonly linkedEmploymentProfileId?: string;
  readonly linkedTalentId?: string;
  readonly status?: ContractRecordStatus | string;
  readonly windowStartDate?: string;
  readonly windowEndDate?: string;
  readonly limit?: number | string;
  readonly cursor?: string;
  readonly sortBy?: ContractRecordSortField | string;
  readonly sortDirection?: ContractRecordSortDirection | string;
}

export interface ListContractRecordsByOwnerQuery {
  readonly ownerEmploymentProfileId: string;
  readonly status?: ContractRecordStatus | string;
  readonly windowStartDate?: string;
  readonly windowEndDate?: string;
  readonly limit?: number | string;
  readonly cursor?: string;
  readonly sortBy?: ContractRecordSortField | string;
  readonly sortDirection?: ContractRecordSortDirection | string;
}

export type ContractRecordMutationResult =
  ContractRecordMutationView;

export type GetContractRecordDetailResult =
  ContractRecordDetailView;

export interface ListContractRecordsResult {
  readonly items: readonly ContractRecordListItemView[];
  readonly nextCursor?: string;
}

export interface ListContractRecordsByLinkedEntityResult {
  readonly items: readonly ContractRecordByLinkedEntityListItemView[];
  readonly nextCursor?: string;
}

export interface ListContractRecordsByOwnerResult {
  readonly items: readonly ContractRecordByOwnerListItemView[];
  readonly nextCursor?: string;
}
