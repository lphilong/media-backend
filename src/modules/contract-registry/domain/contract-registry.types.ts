import { ReferenceSummary } from "@modules/reference-summary";

export const CONTRACT_KINDS = [
  "EMPLOYMENT",
  "TALENT_SERVICE",
  "TALENT_MANAGEMENT",
] as const;

export type ContractKind =
  (typeof CONTRACT_KINDS)[number];

export const COMMERCIAL_LEGAL_CONTRACT_KINDS = [
  "TALENT_SERVICE",
  "TALENT_MANAGEMENT",
] as const satisfies readonly ContractKind[];

export type CommercialLegalContractKind =
  (typeof COMMERCIAL_LEGAL_CONTRACT_KINDS)[number];

export const LEGACY_EMPLOYMENT_CONTRACT_KINDS = [
  "EMPLOYMENT",
] as const satisfies readonly ContractKind[];

export type LegacyEmploymentContractKind =
  (typeof LEGACY_EMPLOYMENT_CONTRACT_KINDS)[number];

export const CONTRACT_SEMANTIC_BOUNDARIES = [
  "COMMERCIAL_LEGAL",
  "LEGACY_EMPLOYMENT",
  "UNSUPPORTED",
] as const;

export type ContractSemanticBoundary =
  (typeof CONTRACT_SEMANTIC_BOUNDARIES)[number];

export const CONTRACT_KIND_CLASSIFICATIONS = [
  "COMMERCIAL_LEGAL_SUPPORTED",
  "LEGACY_EMPLOYMENT_DEPRECATED",
  "UNSUPPORTED_CONTRACT_KIND",
] as const;

export type ContractKindClassification =
  (typeof CONTRACT_KIND_CLASSIFICATIONS)[number];

export interface ContractBoundaryMetadata {
  readonly semanticBoundary: ContractSemanticBoundary;
  readonly kindClassification: ContractKindClassification;
  readonly commercialLegalRegistry: boolean;
  readonly commercialChainContextEligible: boolean;
  readonly directRevenueSourceEligible: false;
  readonly directCommissionSourceEligible: false;
  readonly payrollSourceEligible: false;
  readonly obligationAcceptanceImplemented: false;
  readonly eventEvidenceLinkImplemented: false;
}

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
  readonly boundaryMetadata: ContractBoundaryMetadata;
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
  readonly boundaryMetadata: ContractBoundaryMetadata;
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
  readonly boundaryMetadata: ContractBoundaryMetadata;
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
  readonly boundaryMetadata: ContractBoundaryMetadata;
}

export interface ContractRecordMutationView
  extends ContractRecordDetailView {}

export function isCommercialLegalContractKind(
  contractKind: ContractKind,
): contractKind is CommercialLegalContractKind {
  return COMMERCIAL_LEGAL_CONTRACT_KINDS.includes(
    contractKind as CommercialLegalContractKind,
  );
}

export function isLegacyEmploymentContractKind(
  contractKind: ContractKind,
): contractKind is LegacyEmploymentContractKind {
  return LEGACY_EMPLOYMENT_CONTRACT_KINDS.includes(
    contractKind as LegacyEmploymentContractKind,
  );
}

export function getContractBoundaryMetadata(
  contractKind: ContractKind,
): ContractBoundaryMetadata {
  switch (contractKind) {
    case "EMPLOYMENT":
      return {
        semanticBoundary: "LEGACY_EMPLOYMENT",
        kindClassification:
          "LEGACY_EMPLOYMENT_DEPRECATED",
        commercialLegalRegistry: false,
        commercialChainContextEligible: false,
        directRevenueSourceEligible: false,
        directCommissionSourceEligible: false,
        payrollSourceEligible: false,
        obligationAcceptanceImplemented: false,
        eventEvidenceLinkImplemented: false,
      };

    case "TALENT_SERVICE":
    case "TALENT_MANAGEMENT":
      return {
        semanticBoundary: "COMMERCIAL_LEGAL",
        kindClassification:
          "COMMERCIAL_LEGAL_SUPPORTED",
        commercialLegalRegistry: true,
        commercialChainContextEligible: true,
        directRevenueSourceEligible: false,
        directCommissionSourceEligible: false,
        payrollSourceEligible: false,
        obligationAcceptanceImplemented: false,
        eventEvidenceLinkImplemented: false,
      };

    default:
      return getUnsupportedContractBoundaryMetadata(
        contractKind,
      );
  }
}

function getUnsupportedContractBoundaryMetadata(
  _contractKind: never,
): ContractBoundaryMetadata {
  return {
    semanticBoundary: "UNSUPPORTED",
    kindClassification:
      "UNSUPPORTED_CONTRACT_KIND",
    commercialLegalRegistry: false,
    commercialChainContextEligible: false,
    directRevenueSourceEligible: false,
    directCommissionSourceEligible: false,
    payrollSourceEligible: false,
    obligationAcceptanceImplemented: false,
    eventEvidenceLinkImplemented: false,
  };
}
