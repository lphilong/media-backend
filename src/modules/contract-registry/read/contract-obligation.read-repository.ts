import {
  ContractObligationListItemView,
  ContractObligationStatus,
  ContractObligationView,
} from "../domain/contract-obligation.types";

export interface ListContractObligationsReadInput {
  readonly contractRecordId: string;
  readonly status?: ContractObligationStatus;
  readonly limit: number;
  readonly cursor?: string;
}

export interface ListContractObligationsReadResult {
  readonly items: readonly ContractObligationListItemView[];
  readonly nextCursor?: string;
}

export interface ContractObligationReadRepository {
  listByContractRecordId(
    input: ListContractObligationsReadInput,
  ): Promise<ListContractObligationsReadResult>;

  getDetail(
    obligationId: string,
  ): Promise<ContractObligationView | null>;
}
