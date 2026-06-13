import { ClientSession, Db } from "mongodb";
import { BaseRepository } from "@infra/database/repository/base.repository";
import {
  ContractObligationEventEvidenceLinkRepository,
  RemoveContractObligationEventEvidenceLinkInput,
} from "@modules/contract-registry/domain/contract-obligation-event-evidence-link.repository";
import {
  ContractObligationEventEvidenceLink,
  ContractObligationEventEvidenceLinkStatus,
} from "@modules/contract-registry/domain/contract-obligation-event-evidence-link.types";

interface ContractObligationEventEvidenceLinkDocument
  extends Omit<ContractObligationEventEvidenceLink, "id"> {
  readonly _id: string;
}

export class NativeMongoContractObligationEventEvidenceLinkRepository
  extends BaseRepository<ContractObligationEventEvidenceLinkDocument>
  implements ContractObligationEventEvidenceLinkRepository
{
  constructor(db: Db) {
    super(db, "contract_obligation_event_evidence_links");
  }

  async insert(
    link: ContractObligationEventEvidenceLink,
    session: ClientSession,
  ): Promise<ContractObligationEventEvidenceLink> {
    await this.collection.insertOne(
      toDocument(link),
      this.withSession(session),
    );
    return link;
  }

  async findById(
    linkId: string,
    session?: ClientSession,
  ): Promise<ContractObligationEventEvidenceLink | null> {
    const document = await this.collection.findOne(
      { _id: linkId },
      this.withSession(session),
    );
    return document ? toDomain(document) : null;
  }

  async findActiveByObligationAndEvent(
    contractObligationId: string,
    eventId: string,
    session?: ClientSession,
  ): Promise<ContractObligationEventEvidenceLink | null> {
    const document = await this.collection.findOne(
      {
        contractObligationId,
        eventId,
        status: "ACTIVE",
      },
      this.withSession(session),
    );
    return document ? toDomain(document) : null;
  }

  async listActiveByIdsForObligation(
    contractObligationId: string,
    linkIds: readonly string[],
    session?: ClientSession,
  ): Promise<readonly ContractObligationEventEvidenceLink[]> {
    if (linkIds.length === 0) {
      return [];
    }
    const documents = await this.collection
      .find(
        {
          _id: { $in: [...linkIds] },
          contractObligationId,
          status: "ACTIVE",
        },
        this.withSession(session),
      )
      .toArray();
    return documents.map(toDomain);
  }

  async softRemove(
    input: RemoveContractObligationEventEvidenceLinkInput,
    session: ClientSession,
  ): Promise<ContractObligationEventEvidenceLink | null> {
    const document = await this.collection.findOneAndUpdate(
      {
        _id: input.linkId,
        status: "ACTIVE",
      },
      {
        $set: {
          status: "REMOVED" satisfies ContractObligationEventEvidenceLinkStatus,
          removedByActorId: input.removedByActorId,
          removedAt: input.removedAt,
          removeReason: input.removeReason,
          updatedByActorId: input.updatedByActorId,
          updatedAt: input.updatedAt,
        },
        $push: {
          actionHistory: input.action,
        },
      },
      {
        ...this.withSession(session),
        returnDocument: "after",
      },
    );
    return document ? toDomain(document) : null;
  }
}

function toDocument(
  link: ContractObligationEventEvidenceLink,
): ContractObligationEventEvidenceLinkDocument {
  const { id, ...document } = link;
  return {
    _id: id,
    ...document,
    snapshot: {
      ...document.snapshot,
      completionEvidenceRefs: [
        ...document.snapshot.completionEvidenceRefs,
      ],
    },
    actionHistory: [...document.actionHistory],
  };
}

function toDomain(
  document: ContractObligationEventEvidenceLinkDocument,
): ContractObligationEventEvidenceLink {
  return {
    id: document._id,
    contractObligationId: document.contractObligationId,
    contractRecordId: document.contractRecordId,
    eventId: document.eventId,
    status: document.status,
    linkedByActorId: document.linkedByActorId,
    linkedAt: document.linkedAt,
    linkReason: document.linkReason,
    removedByActorId: document.removedByActorId,
    removedAt: document.removedAt,
    removeReason: document.removeReason,
    snapshot: {
      ...document.snapshot,
      completionEvidenceRefs: [
        ...document.snapshot.completionEvidenceRefs,
      ],
    },
    actionHistory: [...document.actionHistory],
    createdByActorId: document.createdByActorId,
    createdAt: document.createdAt,
    updatedByActorId: document.updatedByActorId,
    updatedAt: document.updatedAt,
  };
}
