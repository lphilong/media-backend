import {
  ContractObligationEventEvidenceLinkStatus,
  ContractObligationEventEvidenceLinkView,
} from "../domain/contract-obligation-event-evidence-link.types";

export interface ListContractObligationEventEvidenceLinksReadInput {
  readonly contractObligationId: string;
  readonly status?: ContractObligationEventEvidenceLinkStatus;
  readonly limit: number;
  readonly cursor?: string;
}

export interface ListContractObligationEventEvidenceLinksReadResult {
  readonly items: readonly ContractObligationEventEvidenceLinkView[];
  readonly nextCursor?: string;
}

export interface ContractObligationEventEvidenceLinkReadRepository {
  listByObligationId(
    input: ListContractObligationEventEvidenceLinksReadInput,
  ): Promise<ListContractObligationEventEvidenceLinksReadResult>;

  getDetail(
    linkId: string,
  ): Promise<ContractObligationEventEvidenceLinkView | null>;
}
