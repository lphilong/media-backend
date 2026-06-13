import {
  ClientSession,
  Db,
} from "mongodb";
import {
  buildGeneratedBusinessCodeRegex,
  BusinessCodePolicy,
  parseGeneratedBusinessCodeSequence,
} from "@core/business-code/business-code-sequence.repository";
import { BaseRepository } from "@infra/database/repository/base.repository";
import {
  ContractObligationRepository,
  TransitionContractObligationInput,
  UpdateContractObligationMetadataInput,
} from "@modules/contract-registry/domain/contract-obligation.repository";
import {
  ContractObligation,
  ContractObligationStatus,
  UNRESOLVED_CONTRACT_OBLIGATION_STATUSES,
} from "@modules/contract-registry/domain/contract-obligation.types";

interface ContractObligationDocument
  extends Omit<
    ContractObligation,
    "id" | "latestEventEvidenceLinkIds"
  > {
  readonly _id: string;
  readonly latestEventEvidenceLinkIds?: readonly string[];
}

export class NativeMongoContractObligationRepository
  extends BaseRepository<ContractObligationDocument>
  implements ContractObligationRepository
{
  constructor(db: Db) {
    super(db, "contract_obligations");
  }

  async insert(
    obligation: ContractObligation,
    session: ClientSession,
  ): Promise<ContractObligation> {
    await this.collection.insertOne(
      toDocument(obligation),
      this.withSession(session),
    );
    return obligation;
  }

  async findById(
    obligationId: string,
    session?: ClientSession,
  ): Promise<ContractObligation | null> {
    const document = await this.collection.findOne(
      { _id: obligationId },
      this.withSession(session),
    );
    return document ? toDomain(document) : null;
  }

  async findByCode(
    code: string,
    session?: ClientSession,
  ): Promise<ContractObligation | null> {
    const document = await this.collection.findOne(
      { code },
      this.withSession(session),
    );
    return document ? toDomain(document) : null;
  }

  async findMaxGeneratedCodeSequence(
    policy: Pick<BusinessCodePolicy, "prefix" | "width">,
    session?: ClientSession,
  ): Promise<number> {
    const document = await this.collection
      .find(
        {
          code: buildGeneratedBusinessCodeRegex(policy),
        },
        this.withSession(session),
      )
      .sort({ code: -1 })
      .limit(1)
      .next();

    return document
      ? (parseGeneratedBusinessCodeSequence(
          document.code,
          policy,
        ) ?? 0)
      : 0;
  }

  async updateMetadata(
    input: UpdateContractObligationMetadataInput,
    session: ClientSession,
  ): Promise<ContractObligation | null> {
    const set: Record<string, unknown> = {
      updatedByActorId: input.updatedByActorId,
      updatedAt: input.updatedAt,
    };

    for (const field of [
      "obligationType",
      "title",
      "description",
      "dueDate",
      "responsibleOwnerEmploymentProfileId",
      "evidencePolicy",
    ] as const) {
      if (input[field] !== undefined) {
        set[field] = input[field];
      }
    }

    const document = await this.collection.findOneAndUpdate(
      {
        _id: input.obligationId,
        status: {
          $in: [...input.fromStatuses],
        },
      },
      {
        $set: set,
      },
      {
        ...this.withSession(session),
        returnDocument: "after",
      },
    );

    return document ? toDomain(document) : null;
  }

  async transitionStatus(
    input: TransitionContractObligationInput,
    session: ClientSession,
  ): Promise<ContractObligation | null> {
    const set: Record<string, unknown> = {
      status: input.toStatus,
      updatedByActorId: input.updatedByActorId,
      updatedAt: input.updatedAt,
    };

    for (const field of [
      "latestDeliveryNote",
      "latestEvidenceRefs",
      "latestEventEvidenceLinkIds",
      "latestDeliveredByActorId",
      "latestDeliveredAt",
      "latestReviewedByActorId",
      "latestReviewedAt",
      "acceptedByActorId",
      "acceptedAt",
      "rejectedByActorId",
      "rejectedAt",
      "rejectionReason",
    ] as const) {
      if (input[field] !== undefined) {
        set[field] = input[field];
      }
    }

    const document = await this.collection.findOneAndUpdate(
      {
        _id: input.obligationId,
        status: {
          $in: [...input.fromStatuses],
        },
      },
      {
        $set: set,
        $push: {
          statusHistory: input.transition,
        },
      },
      {
        ...this.withSession(session),
        returnDocument: "after",
      },
    );

    return document ? toDomain(document) : null;
  }

  async hasUnresolvedByContractRecordId(
    contractRecordId: string,
    session?: ClientSession,
  ): Promise<boolean> {
    const count = await this.collection.countDocuments(
      {
        contractRecordId,
        status: {
          $in: [
            ...UNRESOLVED_CONTRACT_OBLIGATION_STATUSES,
          ],
        },
      },
      {
        ...this.withSession(session),
        limit: 1,
      },
    );

    return count > 0;
  }
}

function toDocument(
  obligation: ContractObligation,
): ContractObligationDocument {
  const { id, ...document } = obligation;
  return {
    _id: id,
    ...document,
    latestEvidenceRefs: [...document.latestEvidenceRefs],
    latestEventEvidenceLinkIds: [
      ...document.latestEventEvidenceLinkIds,
    ],
    statusHistory: [...document.statusHistory],
  };
}

function toDomain(
  document: ContractObligationDocument,
): ContractObligation {
  return {
    id: document._id,
    code: document.code,
    contractRecordId: document.contractRecordId,
    obligationType: document.obligationType,
    title: document.title,
    description: document.description,
    dueDate: document.dueDate,
    responsibleOwnerEmploymentProfileId:
      document.responsibleOwnerEmploymentProfileId,
    evidencePolicy: document.evidencePolicy,
    status: document.status as ContractObligationStatus,
    latestDeliveryNote: document.latestDeliveryNote,
    latestEvidenceRefs: [...document.latestEvidenceRefs],
    latestEventEvidenceLinkIds: [
      ...(document.latestEventEvidenceLinkIds ?? []),
    ],
    latestDeliveredByActorId:
      document.latestDeliveredByActorId,
    latestDeliveredAt: document.latestDeliveredAt,
    latestReviewedByActorId:
      document.latestReviewedByActorId,
    latestReviewedAt: document.latestReviewedAt,
    acceptedByActorId: document.acceptedByActorId,
    acceptedAt: document.acceptedAt,
    rejectedByActorId: document.rejectedByActorId,
    rejectedAt: document.rejectedAt,
    rejectionReason: document.rejectionReason,
    statusHistory: [...document.statusHistory],
    createdByActorId: document.createdByActorId,
    createdAt: document.createdAt,
    updatedByActorId: document.updatedByActorId,
    updatedAt: document.updatedAt,
  };
}
