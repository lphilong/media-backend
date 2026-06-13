import { Db } from "mongodb";
import { BaseRepository } from "@infra/database/repository/base.repository";
import { ContractObligationValidationError } from "@modules/contract-registry/domain/contract-registry.errors";
import {
  ContractObligationEventEvidenceLink,
  ContractObligationEventEvidenceLinkStatus,
  toContractObligationEventEvidenceLinkView,
} from "@modules/contract-registry/domain/contract-obligation-event-evidence-link.types";
import {
  ContractObligationEventEvidenceLinkReadRepository,
  ListContractObligationEventEvidenceLinksReadInput,
  ListContractObligationEventEvidenceLinksReadResult,
} from "@modules/contract-registry/read/contract-obligation-event-evidence-link.read-repository";

interface ContractObligationEventEvidenceLinkReadDocument
  extends Omit<ContractObligationEventEvidenceLink, "id"> {
  readonly _id: string;
}

interface EvidenceLinkCursor {
  readonly contractObligationId: string;
  readonly status: ContractObligationEventEvidenceLinkStatus | null;
  readonly createdAt: number;
  readonly id: string;
}

export class NativeMongoContractObligationEventEvidenceLinkReadRepository
  extends BaseRepository<ContractObligationEventEvidenceLinkReadDocument>
  implements ContractObligationEventEvidenceLinkReadRepository
{
  constructor(db: Db) {
    super(db, "contract_obligation_event_evidence_links");
  }

  async listByObligationId(
    input: ListContractObligationEventEvidenceLinksReadInput,
  ): Promise<ListContractObligationEventEvidenceLinksReadResult> {
    const cursor = input.cursor
      ? decodeCursor(input.cursor, input)
      : undefined;
    const filters: Array<Record<string, unknown>> = [
      {
        contractObligationId: input.contractObligationId,
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
        toContractObligationEventEvidenceLinkView(
          toDomain(document),
        ),
      ),
      nextCursor:
        hasNext && page.length > 0
          ? encodeCursor({
              contractObligationId: input.contractObligationId,
              status: input.status ?? null,
              createdAt: page[page.length - 1].createdAt,
              id: page[page.length - 1]._id,
            })
          : undefined,
    };
  }

  async getDetail(linkId: string) {
    const document = await this.collection.findOne({
      _id: linkId,
    });
    return document
      ? toContractObligationEventEvidenceLinkView(
          toDomain(document),
        )
      : null;
  }
}

function toDomain(
  document: ContractObligationEventEvidenceLinkReadDocument,
): ContractObligationEventEvidenceLink {
  const { _id, ...link } = document;
  return {
    ...link,
    id: _id,
    snapshot: {
      ...document.snapshot,
      completionEvidenceRefs: [
        ...document.snapshot.completionEvidenceRefs,
      ],
    },
    actionHistory: [...document.actionHistory],
  };
}

function encodeCursor(cursor: EvidenceLinkCursor): string {
  return Buffer.from(
    JSON.stringify(cursor),
    "utf8",
  ).toString("base64url");
}

function decodeCursor(
  value: string,
  input: ListContractObligationEventEvidenceLinksReadInput,
): EvidenceLinkCursor {
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Record<string, unknown>;

    if (
      parsed.contractObligationId !== input.contractObligationId ||
      parsed.status !== (input.status ?? null) ||
      typeof parsed.createdAt !== "number" ||
      !Number.isInteger(parsed.createdAt) ||
      typeof parsed.id !== "string" ||
      !parsed.id
    ) {
      throw new Error("invalid");
    }

    return parsed as unknown as EvidenceLinkCursor;
  } catch {
    throw new ContractObligationValidationError(
      "Contract obligation event evidence link cursor is invalid",
    );
  }
}
