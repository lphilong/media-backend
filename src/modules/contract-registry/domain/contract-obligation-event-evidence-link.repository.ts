import { ClientSession } from "mongodb";
import {
  ContractObligationEventEvidenceLink,
  ContractObligationEventEvidenceLinkAction,
} from "./contract-obligation-event-evidence-link.types";

export interface RemoveContractObligationEventEvidenceLinkInput {
  readonly linkId: string;
  readonly action: ContractObligationEventEvidenceLinkAction;
  readonly removedByActorId: string;
  readonly removedAt: number;
  readonly removeReason: string;
  readonly updatedByActorId: string;
  readonly updatedAt: number;
}

export interface ContractObligationEventEvidenceLinkRepository {
  insert(
    link: ContractObligationEventEvidenceLink,
    session: ClientSession,
  ): Promise<ContractObligationEventEvidenceLink>;

  findById(
    linkId: string,
    session?: ClientSession,
  ): Promise<ContractObligationEventEvidenceLink | null>;

  findActiveByObligationAndEvent(
    contractObligationId: string,
    eventId: string,
    session?: ClientSession,
  ): Promise<ContractObligationEventEvidenceLink | null>;

  listActiveByIdsForObligation(
    contractObligationId: string,
    linkIds: readonly string[],
    session?: ClientSession,
  ): Promise<readonly ContractObligationEventEvidenceLink[]>;

  softRemove(
    input: RemoveContractObligationEventEvidenceLinkInput,
    session: ClientSession,
  ): Promise<ContractObligationEventEvidenceLink | null>;
}
