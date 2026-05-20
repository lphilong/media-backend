import { ReferenceSummary } from "@modules/reference-summary";

export const CONTRACT_KINDS = [
  "EMPLOYMENT",
  "TALENT_SERVICE",
  "TALENT_MANAGEMENT",
] as const;

export type ContractKind =
  (typeof CONTRACT_KINDS)[number];

export const CONTRACT_LINKED_ENTITY_KINDS = [
  "EMPLOYMENT_PROFILE",
  "TALENT",
] as const;

export type ContractLinkedEntityKind =
  (typeof CONTRACT_LINKED_ENTITY_KINDS)[number];

export const CONTRACT_CONFIDENTIALITY_TIERS = [
  "INTERNAL",
  "CONFIDENTIAL",
  "RESTRICTED",
] as const;

export type ContractConfidentialityTier =
  (typeof CONTRACT_CONFIDENTIALITY_TIERS)[number];

export const CONTRACT_RECORD_STATUSES = [
  "DRAFT",
  "PENDING_SIGNATURE",
  "ACTIVE",
  "EXPIRED",
  "TERMINATED",
  "ARCHIVED",
] as const;

export type ContractRecordStatus =
  (typeof CONTRACT_RECORD_STATUSES)[number];

export const CONTRACT_RECORD_SORT_FIELDS = [
  "effectiveStartDate",
  "contractCode",
  "createdAt",
] as const;

export type ContractRecordSortField =
  (typeof CONTRACT_RECORD_SORT_FIELDS)[number];

export const CONTRACT_RECORD_SORT_DIRECTIONS = [
  "ASC",
  "DESC",
] as const;

export type ContractRecordSortDirection =
  (typeof CONTRACT_RECORD_SORT_DIRECTIONS)[number];

export const CONTRACT_RECORD_SCOPES = [
  "global",
] as const;

export type ContractRecordScope =
  (typeof CONTRACT_RECORD_SCOPES)[number];

export interface ContractRecord {
  readonly id: string;
  readonly contractCode: string;
  readonly title: string;
  readonly normalizedTitle: string;
  readonly contractKind: ContractKind;
  readonly linkedEntityKind: ContractLinkedEntityKind;
  readonly linkedEmploymentProfileId: string | null;
  readonly linkedTalentId: string | null;
  readonly ownerEmploymentProfileId: string;
  readonly confidentialityTier: ContractConfidentialityTier;
  readonly status: ContractRecordStatus;
  readonly effectiveStartDate: number;
  readonly effectiveEndDate: number | null;
  readonly fileReferenceId: string | null;
  readonly fileDisplayName: string | null;
  readonly description: string | null;
  readonly externalRef: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface ContractRecordDetailView {
  readonly id: string;
  readonly contractCode: string;
  readonly title: string;
  readonly contractKind: ContractKind;
  readonly linkedEntityKind: ContractLinkedEntityKind;
  readonly linkedEmploymentProfileId: string | null;
  readonly linkedTalentId: string | null;
  readonly ownerEmploymentProfileId: string;
  readonly linkedEmploymentProfileRef?: ReferenceSummary | null;
  readonly linkedTalentRef?: ReferenceSummary | null;
  readonly ownerEmploymentProfileRef?: ReferenceSummary | null;
  readonly confidentialityTier: ContractConfidentialityTier;
  readonly status: ContractRecordStatus;
  readonly effectiveStartDate: number;
  readonly effectiveEndDate: number | null;
  readonly fileReferenceId: string | null;
  readonly fileDisplayName: string | null;
  readonly description: string | null;
  readonly externalRef: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface ContractRecordListItemView {
  readonly id: string;
  readonly contractCode: string;
  readonly title: string;
  readonly contractKind: ContractKind;
  readonly linkedEntityKind: ContractLinkedEntityKind;
  readonly linkedEmploymentProfileId: string | null;
  readonly linkedTalentId: string | null;
  readonly ownerEmploymentProfileId: string;
  readonly linkedEmploymentProfileRef?: ReferenceSummary | null;
  readonly linkedTalentRef?: ReferenceSummary | null;
  readonly ownerEmploymentProfileRef?: ReferenceSummary | null;
  readonly confidentialityTier: ContractConfidentialityTier;
  readonly status: ContractRecordStatus;
  readonly effectiveStartDate: number;
  readonly effectiveEndDate: number | null;
  readonly createdAt: number;
}

export interface ContractRecordByLinkedEntityListItemView {
  readonly id: string;
  readonly contractCode: string;
  readonly title: string;
  readonly contractKind: ContractKind;
  readonly linkedEntityKind: ContractLinkedEntityKind;
  readonly linkedEmploymentProfileId: string | null;
  readonly linkedTalentId: string | null;
  readonly linkedEmploymentProfileRef?: ReferenceSummary | null;
  readonly linkedTalentRef?: ReferenceSummary | null;
  readonly status: ContractRecordStatus;
  readonly effectiveStartDate: number;
  readonly effectiveEndDate: number | null;
}

export interface ContractRecordByOwnerListItemView {
  readonly id: string;
  readonly contractCode: string;
  readonly title: string;
  readonly contractKind: ContractKind;
  readonly ownerEmploymentProfileId: string;
  readonly ownerEmploymentProfileRef?: ReferenceSummary | null;
  readonly confidentialityTier: ContractConfidentialityTier;
  readonly status: ContractRecordStatus;
  readonly effectiveStartDate: number;
  readonly effectiveEndDate: number | null;
}

export interface ContractRecordMutationView
  extends ContractRecordDetailView {}
