import {
  EventCompletionEvidenceRef,
  EventStatus,
} from "@modules/event-assignment/domain/event-assignment.types";

export const CONTRACT_OBLIGATION_EVENT_EVIDENCE_LINK_STATUSES = [
  "ACTIVE",
  "REMOVED",
] as const;

export type ContractObligationEventEvidenceLinkStatus =
  (typeof CONTRACT_OBLIGATION_EVENT_EVIDENCE_LINK_STATUSES)[number];

export interface ContractObligationEventEvidenceSnapshot {
  readonly eventId: string;
  readonly eventCode: string;
  readonly eventTitle: string;
  readonly eventStatus: EventStatus;
  readonly eventUpdatedAt: number;
  readonly eventCompletedAt: number;
  readonly eventCompletedByActorId: string;
  readonly completionEvidenceNote: string;
  readonly completionEvidenceRefs: readonly EventCompletionEvidenceRef[];
}

export interface ContractObligationEventEvidenceLinkAction {
  readonly action: "LINKED" | "REMOVED";
  readonly actorId: string;
  readonly occurredAt: number;
  readonly reason: string;
}

export interface ContractObligationEventEvidenceLink {
  readonly id: string;
  readonly contractObligationId: string;
  readonly contractRecordId: string;
  readonly eventId: string;
  readonly status: ContractObligationEventEvidenceLinkStatus;
  readonly linkedByActorId: string;
  readonly linkedAt: number;
  readonly linkReason: string;
  readonly removedByActorId: string | null;
  readonly removedAt: number | null;
  readonly removeReason: string | null;
  readonly snapshot: ContractObligationEventEvidenceSnapshot;
  readonly actionHistory: readonly ContractObligationEventEvidenceLinkAction[];
  readonly createdByActorId: string;
  readonly createdAt: number;
  readonly updatedByActorId: string;
  readonly updatedAt: number;
}

export interface ContractObligationEventEvidenceLinkBoundaryMetadata {
  readonly linkTarget: "CONTRACT_OBLIGATION";
  readonly supportingEvidenceOnly: true;
  readonly historicalSnapshot: true;
  readonly linkMutatesEvent: false;
  readonly linkMutatesObligationStatus: false;
  readonly deliveryRemainsExplicit: true;
  readonly acceptanceCreated: false;
  readonly revenueCreated: false;
  readonly commissionCreated: false;
  readonly payrollCreated: false;
  readonly paymentCreated: false;
  readonly taxOrAccountingCreated: false;
  readonly fileStorageCreated: false;
  readonly inferredEventContractMatching: false;
}

export interface ContractObligationEventEvidenceLinkView
  extends ContractObligationEventEvidenceLink {
  readonly boundaryMetadata: ContractObligationEventEvidenceLinkBoundaryMetadata;
}

export const CONTRACT_OBLIGATION_EVENT_EVIDENCE_LINK_BOUNDARY_METADATA: ContractObligationEventEvidenceLinkBoundaryMetadata =
  Object.freeze({
    linkTarget: "CONTRACT_OBLIGATION",
    supportingEvidenceOnly: true,
    historicalSnapshot: true,
    linkMutatesEvent: false,
    linkMutatesObligationStatus: false,
    deliveryRemainsExplicit: true,
    acceptanceCreated: false,
    revenueCreated: false,
    commissionCreated: false,
    payrollCreated: false,
    paymentCreated: false,
    taxOrAccountingCreated: false,
    fileStorageCreated: false,
    inferredEventContractMatching: false,
  });

export function toContractObligationEventEvidenceLinkView(
  link: ContractObligationEventEvidenceLink,
): ContractObligationEventEvidenceLinkView {
  return {
    ...link,
    snapshot: {
      ...link.snapshot,
      completionEvidenceRefs: [
        ...link.snapshot.completionEvidenceRefs,
      ],
    },
    actionHistory: [...link.actionHistory],
    boundaryMetadata:
      CONTRACT_OBLIGATION_EVENT_EVIDENCE_LINK_BOUNDARY_METADATA,
  };
}
