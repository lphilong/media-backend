import {
  ContractObligationEvidencePolicy,
  ContractObligationEvidenceRef,
  ContractObligationStatus,
  ContractObligationType,
  ContractObligationView,
} from "../domain/contract-obligation.types";

export const CONTRACT_OBLIGATION_TITLE_MAX_LENGTH = 240;
export const CONTRACT_OBLIGATION_DESCRIPTION_MAX_LENGTH = 4_000;
export const CONTRACT_OBLIGATION_DELIVERY_NOTE_MAX_LENGTH = 2_000;
export const CONTRACT_OBLIGATION_REASON_MAX_LENGTH = 1_000;
export const CONTRACT_OBLIGATION_EVIDENCE_REF_MAX_COUNT = 20;
export const CONTRACT_OBLIGATION_EVIDENCE_REF_LABEL_MAX_LENGTH = 160;
export const CONTRACT_OBLIGATION_EVIDENCE_REF_REFERENCE_ID_MAX_LENGTH = 512;
export const CONTRACT_OBLIGATION_EVIDENCE_REF_URL_MAX_LENGTH = 2_048;

export interface ContractObligationEvidenceRefInput {
  readonly type: string;
  readonly label: string;
  readonly url?: string | null;
  readonly referenceId?: string | null;
}

export interface CreateContractObligationCommand {
  readonly contractRecordId: string;
  readonly obligationType: ContractObligationType | string;
  readonly title: string;
  readonly description?: string | null;
  readonly dueDate?: string | null;
  readonly responsibleOwnerEmploymentProfileId: string;
  readonly evidencePolicy:
    | ContractObligationEvidencePolicy
    | string;
}

export interface UpdateContractObligationCommand {
  readonly obligationId: string;
  readonly obligationType?: ContractObligationType | string;
  readonly title?: string;
  readonly description?: string | null;
  readonly dueDate?: string | null;
  readonly responsibleOwnerEmploymentProfileId?: string;
  readonly evidencePolicy?:
    | ContractObligationEvidencePolicy
    | string;
}

export interface ContractObligationLifecycleCommand {
  readonly obligationId: string;
}

export interface DeliverContractObligationCommand {
  readonly obligationId: string;
  readonly deliveryNote?: string | null;
  readonly evidenceRefs?: readonly ContractObligationEvidenceRefInput[];
}

export interface RejectContractObligationCommand {
  readonly obligationId: string;
  readonly reason: string;
}

export interface ReopenContractObligationCommand {
  readonly obligationId: string;
  readonly reason: string;
}

export interface AcceptContractObligationCommand {
  readonly obligationId: string;
  readonly reviewNote?: string | null;
}

export interface CancelContractObligationCommand {
  readonly obligationId: string;
  readonly reason: string;
}

export interface ArchiveContractObligationCommand {
  readonly obligationId: string;
  readonly reason?: string | null;
}

export interface ListContractObligationsQuery {
  readonly contractRecordId: string;
  readonly status?: ContractObligationStatus | string;
  readonly limit?: number | string;
  readonly cursor?: string;
}

export interface GetContractObligationDetailQuery {
  readonly obligationId: string;
}

export type ContractObligationMutationResult =
  ContractObligationView;

export interface ListContractObligationsResult {
  readonly items: readonly ContractObligationView[];
  readonly nextCursor?: string;
}

export type GetContractObligationDetailResult =
  ContractObligationView;

export type NormalizedContractObligationEvidenceRef =
  ContractObligationEvidenceRef;
