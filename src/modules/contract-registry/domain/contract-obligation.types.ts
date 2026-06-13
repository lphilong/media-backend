export const CONTRACT_OBLIGATION_TYPES = [
  "DELIVERABLE",
  "SERVICE_MILESTONE",
  "REPORTING",
  "OTHER",
] as const;

export type ContractObligationType =
  (typeof CONTRACT_OBLIGATION_TYPES)[number];

export const CONTRACT_OBLIGATION_STATUSES = [
  "DRAFT",
  "OPEN",
  "DELIVERED",
  "ACCEPTED",
  "REJECTED",
  "CANCELLED",
  "ARCHIVED",
] as const;

export type ContractObligationStatus =
  (typeof CONTRACT_OBLIGATION_STATUSES)[number];

export const CONTRACT_OBLIGATION_EVIDENCE_POLICIES = [
  "OPTIONAL",
  "REQUIRED",
] as const;

export type ContractObligationEvidencePolicy =
  (typeof CONTRACT_OBLIGATION_EVIDENCE_POLICIES)[number];

export const CONTRACT_OBLIGATION_EVIDENCE_REF_TYPES = [
  "URL",
  "PLATFORM_REFERENCE",
  "EXTERNAL_REFERENCE",
  "INTERNAL_REFERENCE",
] as const;

export type ContractObligationEvidenceRefType =
  (typeof CONTRACT_OBLIGATION_EVIDENCE_REF_TYPES)[number];

export interface ContractObligationEvidenceRef {
  readonly type: ContractObligationEvidenceRefType;
  readonly label: string;
  readonly url: string | null;
  readonly referenceId: string | null;
}

export interface ContractObligationStatusTransition {
  readonly fromStatus: ContractObligationStatus | null;
  readonly toStatus: ContractObligationStatus;
  readonly actorId: string;
  readonly occurredAt: number;
  readonly reason: string | null;
}

export interface ContractObligation {
  readonly id: string;
  readonly code: string;
  readonly contractRecordId: string;
  readonly obligationType: ContractObligationType;
  readonly title: string;
  readonly description: string | null;
  readonly dueDate: number | null;
  readonly responsibleOwnerEmploymentProfileId: string;
  readonly evidencePolicy: ContractObligationEvidencePolicy;
  readonly status: ContractObligationStatus;
  readonly latestDeliveryNote: string | null;
  readonly latestEvidenceRefs: readonly ContractObligationEvidenceRef[];
  readonly latestDeliveredByActorId: string | null;
  readonly latestDeliveredAt: number | null;
  readonly latestReviewedByActorId: string | null;
  readonly latestReviewedAt: number | null;
  readonly acceptedByActorId: string | null;
  readonly acceptedAt: number | null;
  readonly rejectedByActorId: string | null;
  readonly rejectedAt: number | null;
  readonly rejectionReason: string | null;
  readonly statusHistory: readonly ContractObligationStatusTransition[];
  readonly createdByActorId: string;
  readonly createdAt: number;
  readonly updatedByActorId: string;
  readonly updatedAt: number;
}

export interface ContractObligationBoundaryMetadata {
  readonly activeSupportedCommercialLegalContractRequired: true;
  readonly legacyEmploymentContractAllowed: false;
  readonly unsupportedContractKindAllowed: false;
  readonly responsibleOwnerGrantsAuthority: false;
  readonly eventEvidenceLinkImplemented: false;
  readonly eventCompletionMutatesObligation: false;
  readonly acceptanceCreatesRevenue: false;
  readonly acceptanceCreatesCommission: false;
  readonly acceptanceCreatesPayroll: false;
  readonly acceptanceCreatesPayment: false;
  readonly acceptanceCreatesTaxOrAccounting: false;
  readonly fileStorageImplemented: false;
}

export interface ContractObligationView
  extends ContractObligation {
  readonly boundaryMetadata: ContractObligationBoundaryMetadata;
}

export type ContractObligationListItemView =
  ContractObligationView;

export const CONTRACT_OBLIGATION_BOUNDARY_METADATA: ContractObligationBoundaryMetadata =
  Object.freeze({
    activeSupportedCommercialLegalContractRequired: true,
    legacyEmploymentContractAllowed: false,
    unsupportedContractKindAllowed: false,
    responsibleOwnerGrantsAuthority: false,
    eventEvidenceLinkImplemented: false,
    eventCompletionMutatesObligation: false,
    acceptanceCreatesRevenue: false,
    acceptanceCreatesCommission: false,
    acceptanceCreatesPayroll: false,
    acceptanceCreatesPayment: false,
    acceptanceCreatesTaxOrAccounting: false,
    fileStorageImplemented: false,
  });

export const UNRESOLVED_CONTRACT_OBLIGATION_STATUSES: readonly ContractObligationStatus[] =
  Object.freeze([
    "DRAFT",
    "OPEN",
    "DELIVERED",
    "REJECTED",
  ]);

export function toContractObligationView(
  obligation: ContractObligation,
): ContractObligationView {
  return {
    ...obligation,
    latestEvidenceRefs: [...obligation.latestEvidenceRefs],
    statusHistory: [...obligation.statusHistory],
    boundaryMetadata:
      CONTRACT_OBLIGATION_BOUNDARY_METADATA,
  };
}
