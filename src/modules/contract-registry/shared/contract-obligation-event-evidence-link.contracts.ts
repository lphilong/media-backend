import {
  ContractObligationEventEvidenceLinkStatus,
  ContractObligationEventEvidenceLinkView,
} from "../domain/contract-obligation-event-evidence-link.types";

export const CONTRACT_OBLIGATION_EVENT_EVIDENCE_LINK_REASON_MAX_LENGTH =
  1_000;

export interface LinkContractObligationEventEvidenceCommand {
  readonly contractObligationId: string;
  readonly eventId: string;
  readonly linkReason: string;
}

export interface RemoveContractObligationEventEvidenceCommand {
  readonly linkId: string;
  readonly removeReason: string;
}

export interface ListContractObligationEventEvidenceLinksQuery {
  readonly contractObligationId: string;
  readonly status?: ContractObligationEventEvidenceLinkStatus | string;
  readonly limit?: number | string;
  readonly cursor?: string;
}

export interface GetContractObligationEventEvidenceLinkDetailQuery {
  readonly linkId: string;
}

export type ContractObligationEventEvidenceLinkMutationResult =
  ContractObligationEventEvidenceLinkView;

export interface ListContractObligationEventEvidenceLinksResult {
  readonly items: readonly ContractObligationEventEvidenceLinkView[];
  readonly nextCursor?: string;
}

export type GetContractObligationEventEvidenceLinkDetailResult =
  ContractObligationEventEvidenceLinkView;
