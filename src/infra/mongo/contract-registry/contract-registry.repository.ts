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
  AssignContractRecordOwnerInput,
  ContractRegistryRepository,
  TransitionContractRecordStatusInput,
  UpdateContractRecordDraftCoreInput,
  UpdateContractRecordFileReferenceInput,
} from "@modules/contract-registry/domain/contract-registry.repository";
import {
  ContractRecord,
  ContractRecordStatus,
} from "@modules/contract-registry/domain/contract-registry.types";

interface ContractRecordDocument {
  readonly _id: string;
  readonly contractCode: string;
  readonly normalizedContractCode: string;
  readonly title: string;
  readonly normalizedTitle: string;
  readonly contractKind: ContractRecord["contractKind"];
  readonly linkedEntityKind: ContractRecord["linkedEntityKind"];
  readonly linkedEmploymentProfileId: string | null;
  readonly linkedTalentId: string | null;
  readonly ownerEmploymentProfileId: string;
  readonly confidentialityTier: ContractRecord["confidentialityTier"];
  readonly status: ContractRecordStatus;
  readonly effectiveStartDate: number;
  readonly effectiveEndDate: number | null;
  readonly fileReferenceId: string | null;
  readonly fileDisplayName: string | null;
  readonly description: string | null;
  readonly externalRef: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

const DRAFT_MUTABLE_STATUSES: readonly ContractRecordStatus[] =
  Object.freeze([
    "DRAFT",
    "PENDING_SIGNATURE",
  ]);

export class NativeMongoContractRegistryRepository
  extends BaseRepository<ContractRecordDocument>
  implements ContractRegistryRepository
{
  constructor(db: Db) {
    super(db, "contract_records");
  }

  async insert(
    contractRecord: ContractRecord,
    session: ClientSession,
  ): Promise<ContractRecord> {
    await this.collection.insertOne(
      toContractRecordDocument(contractRecord),
      this.withSession(session),
    );

    return contractRecord;
  }

  async findById(
    contractRecordId: string,
    session?: ClientSession,
  ): Promise<ContractRecord | null> {
    const document = await this.collection.findOne(
      { _id: contractRecordId },
      this.withSession(session),
    );

    return document
      ? toContractRecord(document)
      : null;
  }

  async findByContractCode(
    contractCode: string,
    session?: ClientSession,
  ): Promise<ContractRecord | null> {
    const document = await this.collection.findOne(
      { contractCode },
      this.withSession(session),
    );

    return document
      ? toContractRecord(document)
      : null;
  }

  async findMaxGeneratedContractCodeSequence(
    policy: Pick<BusinessCodePolicy, "prefix" | "width">,
    session?: ClientSession,
  ): Promise<number> {
    const document = await this.collection
      .find(
        {
          contractCode:
            buildGeneratedBusinessCodeRegex(policy),
        },
        this.withSession(session),
      )
      .sort({ contractCode: -1 })
      .limit(1)
      .next();

    if (!document) {
      return 0;
    }

    return (
      parseGeneratedBusinessCodeSequence(
        document.contractCode,
        policy,
      ) ?? 0
    );
  }

  async updateDraftCore(
    input: UpdateContractRecordDraftCoreInput,
    session: ClientSession,
  ): Promise<ContractRecord | null> {
    const set: Record<string, unknown> = {
      updatedAt: input.updatedAt,
    };

    if (input.title !== undefined) {
      set.title = input.title;
    }

    if (input.normalizedTitle !== undefined) {
      set.normalizedTitle = input.normalizedTitle;
    }

    if (input.linkedEntityKind !== undefined) {
      set.linkedEntityKind = input.linkedEntityKind;
    }

    if (
      input.linkedEmploymentProfileId !== undefined
    ) {
      set.linkedEmploymentProfileId =
        input.linkedEmploymentProfileId;
    }

    if (input.linkedTalentId !== undefined) {
      set.linkedTalentId = input.linkedTalentId;
    }

    if (input.confidentialityTier !== undefined) {
      set.confidentialityTier =
        input.confidentialityTier;
    }

    if (input.effectiveStartDate !== undefined) {
      set.effectiveStartDate =
        input.effectiveStartDate;
    }

    if (input.effectiveEndDate !== undefined) {
      set.effectiveEndDate = input.effectiveEndDate;
    }

    if (input.description !== undefined) {
      set.description = input.description;
    }

    if (input.externalRef !== undefined) {
      set.externalRef = input.externalRef;
    }

    const document =
      await this.collection.findOneAndUpdate(
        {
          _id: input.contractRecordId,
          status: {
            $in: [...DRAFT_MUTABLE_STATUSES],
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

    return document
      ? toContractRecord(document)
      : null;
  }

  async assignOwner(
    input: AssignContractRecordOwnerInput,
    session: ClientSession,
  ): Promise<ContractRecord | null> {
    const document =
      await this.collection.findOneAndUpdate(
        {
          _id: input.contractRecordId,
          status: {
            $ne: "ARCHIVED",
          },
        },
        {
          $set: {
            ownerEmploymentProfileId:
              input.ownerEmploymentProfileId,
            updatedAt: input.updatedAt,
          },
        },
        {
          ...this.withSession(session),
          returnDocument: "after",
        },
      );

    return document
      ? toContractRecord(document)
      : null;
  }

  async updateFileReference(
    input: UpdateContractRecordFileReferenceInput,
    session: ClientSession,
  ): Promise<ContractRecord | null> {
    const document =
      await this.collection.findOneAndUpdate(
        {
          _id: input.contractRecordId,
          status: {
            $ne: "ARCHIVED",
          },
        },
        {
          $set: {
            fileReferenceId: input.fileReferenceId,
            fileDisplayName: input.fileDisplayName,
            updatedAt: input.updatedAt,
          },
        },
        {
          ...this.withSession(session),
          returnDocument: "after",
        },
      );

    return document
      ? toContractRecord(document)
      : null;
  }

  async transitionStatus(
    input: TransitionContractRecordStatusInput,
    session: ClientSession,
  ): Promise<ContractRecord | null> {
    const set: Record<string, unknown> = {
      status: input.toStatus,
      updatedAt: input.updatedAt,
    };

    if (input.effectiveEndDate !== undefined) {
      set.effectiveEndDate = input.effectiveEndDate;
    }

    const document =
      await this.collection.findOneAndUpdate(
        {
          _id: input.contractRecordId,
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

    return document
      ? toContractRecord(document)
      : null;
  }
}

function toContractRecordDocument(
  input: ContractRecord,
): ContractRecordDocument {
  return {
    _id: input.id,
    contractCode: input.contractCode,
    normalizedContractCode:
      canonicalizeContractSearchToken(
        input.contractCode,
      ),
    title: input.title,
    normalizedTitle: input.normalizedTitle,
    contractKind: input.contractKind,
    linkedEntityKind: input.linkedEntityKind,
    linkedEmploymentProfileId:
      input.linkedEmploymentProfileId,
    linkedTalentId: input.linkedTalentId,
    ownerEmploymentProfileId:
      input.ownerEmploymentProfileId,
    confidentialityTier: input.confidentialityTier,
    status: input.status,
    effectiveStartDate: input.effectiveStartDate,
    effectiveEndDate: input.effectiveEndDate,
    fileReferenceId: input.fileReferenceId,
    fileDisplayName: input.fileDisplayName,
    description: input.description,
    externalRef: input.externalRef,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

function toContractRecord(
  input: ContractRecordDocument,
): ContractRecord {
  return {
    id: input._id,
    contractCode: input.contractCode,
    title: input.title,
    normalizedTitle: input.normalizedTitle,
    contractKind: input.contractKind,
    linkedEntityKind: input.linkedEntityKind,
    linkedEmploymentProfileId:
      input.linkedEmploymentProfileId,
    linkedTalentId: input.linkedTalentId,
    ownerEmploymentProfileId:
      input.ownerEmploymentProfileId,
    confidentialityTier: input.confidentialityTier,
    status: input.status,
    effectiveStartDate: input.effectiveStartDate,
    effectiveEndDate: input.effectiveEndDate,
    fileReferenceId: input.fileReferenceId,
    fileDisplayName: input.fileDisplayName,
    description: input.description,
    externalRef: input.externalRef,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

function canonicalizeContractSearchToken(
  value: string,
): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();
}
