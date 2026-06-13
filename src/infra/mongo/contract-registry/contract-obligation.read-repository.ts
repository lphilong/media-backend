import { Db } from "mongodb";
import { BaseRepository } from "@infra/database/repository/base.repository";
import {
  ContractObligation,
  ContractObligationStatus,
  toContractObligationView,
} from "@modules/contract-registry/domain/contract-obligation.types";
import {
  ContractObligationReadRepository,
  ListContractObligationsReadInput,
  ListContractObligationsReadResult,
} from "@modules/contract-registry/read/contract-obligation.read-repository";
import { ContractObligationValidationError } from "@modules/contract-registry/domain/contract-registry.errors";

interface ContractObligationReadDocument
  extends Omit<ContractObligation, "id"> {
  readonly _id: string;
}

interface ObligationCursor {
  readonly contractRecordId: string;
  readonly status: ContractObligationStatus | null;
  readonly createdAt: number;
  readonly id: string;
}

export class NativeMongoContractObligationReadRepository
  extends BaseRepository<ContractObligationReadDocument>
  implements ContractObligationReadRepository
{
  constructor(db: Db) {
    super(db, "contract_obligations");
  }

  async listByContractRecordId(
    input: ListContractObligationsReadInput,
  ): Promise<ListContractObligationsReadResult> {
    const cursor = input.cursor
      ? decodeCursor(input.cursor, input)
      : undefined;
    const filters: Array<Record<string, unknown>> = [
      {
        contractRecordId: input.contractRecordId,
      },
    ];

    if (input.status) {
      filters.push({ status: input.status });
    }

    if (cursor) {
      filters.push({
        $or: [
          {
            createdAt: {
              $lt: cursor.createdAt,
            },
          },
          {
            createdAt: cursor.createdAt,
            _id: {
              $gt: cursor.id,
            },
          },
        ],
      });
    }

    const documents = await this.collection
      .find({ $and: filters })
      .sort({ createdAt: -1, _id: 1 })
      .limit(input.limit + 1)
      .toArray();
    const hasNext = documents.length > input.limit;
    const page = hasNext
      ? documents.slice(0, input.limit)
      : documents;

    return {
      items: page.map((document) =>
        toContractObligationView(toDomain(document)),
      ),
      nextCursor:
        hasNext && page.length > 0
          ? encodeCursor({
              contractRecordId: input.contractRecordId,
              status: input.status ?? null,
              createdAt: page[page.length - 1].createdAt,
              id: page[page.length - 1]._id,
            })
          : undefined,
    };
  }

  async getDetail(
    obligationId: string,
  ) {
    const document = await this.collection.findOne({
      _id: obligationId,
    });
    return document
      ? toContractObligationView(toDomain(document))
      : null;
  }
}

function toDomain(
  document: ContractObligationReadDocument,
): ContractObligation {
  const { _id, ...obligation } = document;
  return {
    ...obligation,
    id: _id,
    latestEvidenceRefs: [...document.latestEvidenceRefs],
    statusHistory: [...document.statusHistory],
  };
}

function encodeCursor(cursor: ObligationCursor): string {
  return Buffer.from(
    JSON.stringify(cursor),
    "utf8",
  ).toString("base64url");
}

function decodeCursor(
  value: string,
  input: ListContractObligationsReadInput,
): ObligationCursor {
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Record<string, unknown>;

    if (
      parsed.contractRecordId !== input.contractRecordId ||
      parsed.status !== (input.status ?? null) ||
      typeof parsed.createdAt !== "number" ||
      !Number.isInteger(parsed.createdAt) ||
      typeof parsed.id !== "string" ||
      !parsed.id
    ) {
      throw new Error("invalid");
    }

    return parsed as unknown as ObligationCursor;
  } catch {
    throw new ContractObligationValidationError(
      "Contract obligation cursor is invalid",
    );
  }
}
