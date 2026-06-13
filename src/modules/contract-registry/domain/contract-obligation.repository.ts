import { ClientSession } from "mongodb";
import { BusinessCodePolicy } from "@core/business-code/business-code-sequence.repository";
import {
  ContractObligation,
  ContractObligationEvidencePolicy,
  ContractObligationEvidenceRef,
  ContractObligationStatus,
  ContractObligationStatusTransition,
  ContractObligationType,
} from "./contract-obligation.types";

export interface UpdateContractObligationMetadataInput {
  readonly obligationId: string;
  readonly fromStatuses: readonly ContractObligationStatus[];
  readonly obligationType?: ContractObligationType;
  readonly title?: string;
  readonly description?: string | null;
  readonly dueDate?: number | null;
  readonly responsibleOwnerEmploymentProfileId?: string;
  readonly evidencePolicy?: ContractObligationEvidencePolicy;
  readonly updatedByActorId: string;
  readonly updatedAt: number;
}

export interface TransitionContractObligationInput {
  readonly obligationId: string;
  readonly fromStatuses: readonly ContractObligationStatus[];
  readonly toStatus: ContractObligationStatus;
  readonly transition: ContractObligationStatusTransition;
  readonly latestDeliveryNote?: string | null;
  readonly latestEvidenceRefs?: readonly ContractObligationEvidenceRef[];
  readonly latestEventEvidenceLinkIds?: readonly string[];
  readonly latestDeliveredByActorId?: string | null;
  readonly latestDeliveredAt?: number | null;
  readonly latestReviewedByActorId?: string | null;
  readonly latestReviewedAt?: number | null;
  readonly acceptedByActorId?: string | null;
  readonly acceptedAt?: number | null;
  readonly rejectedByActorId?: string | null;
  readonly rejectedAt?: number | null;
  readonly rejectionReason?: string | null;
  readonly updatedByActorId: string;
  readonly updatedAt: number;
}

export interface ContractObligationRepository {
  insert(
    obligation: ContractObligation,
    session: ClientSession,
  ): Promise<ContractObligation>;

  findById(
    obligationId: string,
    session?: ClientSession,
  ): Promise<ContractObligation | null>;

  findByCode(
    code: string,
    session?: ClientSession,
  ): Promise<ContractObligation | null>;

  findMaxGeneratedCodeSequence(
    policy: Pick<BusinessCodePolicy, "prefix" | "width">,
    session?: ClientSession,
  ): Promise<number>;

  updateMetadata(
    input: UpdateContractObligationMetadataInput,
    session: ClientSession,
  ): Promise<ContractObligation | null>;

  transitionStatus(
    input: TransitionContractObligationInput,
    session: ClientSession,
  ): Promise<ContractObligation | null>;

  hasUnresolvedByContractRecordId(
    contractRecordId: string,
    session?: ClientSession,
  ): Promise<boolean>;
}
