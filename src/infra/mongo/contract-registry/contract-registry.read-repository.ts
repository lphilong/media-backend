import { Db } from "mongodb";
import { BaseRepository } from "@infra/database/repository/base.repository";
import { ContractRegistryValidationError } from "@modules/contract-registry/domain/contract-registry.errors";
import {
  ContractRecordByLinkedEntityListItemView,
  ContractRecordByOwnerListItemView,
  ContractRecordDetailView,
  ContractRecordListItemView,
  ContractRecordSortDirection,
  ContractRecordSortField,
  ContractRecordStatus,
} from "@modules/contract-registry/domain/contract-registry.types";
import {
  ContractRegistryReadRepository,
  ListContractRecordsByLinkedEntityReadInput,
  ListContractRecordsByLinkedEntityReadResult,
  ListContractRecordsByOwnerReadInput,
  ListContractRecordsByOwnerReadResult,
  ListContractRecordsReadInput,
  ListContractRecordsReadResult,
} from "@modules/contract-registry/read/contract-registry.read-repository";

interface ContractRecordReadDocument {
  readonly _id: string;
  readonly contractCode: string;
  readonly normalizedContractCode: string;
  readonly title: string;
  readonly normalizedTitle: string;
  readonly contractKind:
    ContractRecordDetailView["contractKind"];
  readonly linkedEntityKind:
    ContractRecordDetailView["linkedEntityKind"];
  readonly linkedEmploymentProfileId: string | null;
  readonly linkedTalentId: string | null;
  readonly ownerEmploymentProfileId: string;
  readonly confidentialityTier:
    ContractRecordDetailView["confidentialityTier"];
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

type ReadViewKind =
  | "list"
  | "by-linked-entity"
  | "by-owner";

type SortSpec =
  | {
      readonly kind: "default";
    }
  | {
      readonly kind: "field";
      readonly field: ContractRecordSortField;
      readonly direction: ContractRecordSortDirection;
    };

type EncodedCursor =
  | {
      readonly kind: "default";
      readonly queryShapeSignature: string;
      readonly effectiveStartDate: number;
      readonly contractCode: string;
      readonly id: string;
    }
  | {
      readonly kind: "field";
      readonly queryShapeSignature: string;
      readonly field: ContractRecordSortField;
      readonly direction: ContractRecordSortDirection;
      readonly value: string | number;
      readonly id: string;
    };

interface PageResult {
  readonly items: readonly ContractRecordReadDocument[];
  readonly nextCursor?: string;
}

export class NativeMongoContractRegistryReadRepository
  extends BaseRepository<ContractRecordReadDocument>
  implements ContractRegistryReadRepository
{
  constructor(db: Db) {
    super(db, "contract_records");
  }

  async listContractRecords(
    input: ListContractRecordsReadInput,
  ): Promise<ListContractRecordsReadResult> {
    const page = await this.listDocuments(
      "list",
      input,
      (filters) => {
        applyStatusFilter(filters, input.status);
        applyContractKindFilter(
          filters,
          input.contractKind,
        );
        applyLinkedEntityKindFilter(
          filters,
          input.linkedEntityKind,
        );
        applyLinkedEntityIdFilter(filters, {
          linkedEmploymentProfileId:
            input.linkedEmploymentProfileId,
          linkedTalentId: input.linkedTalentId,
        });
        applyOwnerFilter(
          filters,
          input.ownerEmploymentProfileId,
        );
        applyConfidentialityTierFilter(
          filters,
          input.confidentialityTier,
        );
        applyHasFileReferenceFilter(
          filters,
          input.hasFileReference,
        );
        applyWindowIntersectionFilter(filters, {
          windowStartDate: input.windowStartDate,
          windowEndDate: input.windowEndDate,
        });
        applySearchFilter(filters, input.search);
      },
    );

    return {
      items: page.items.map(
        toContractRecordListItemView,
      ),
      nextCursor: page.nextCursor,
    };
  }

  async listContractRecordsByLinkedEntity(
    input: ListContractRecordsByLinkedEntityReadInput,
  ): Promise<ListContractRecordsByLinkedEntityReadResult> {
    const page = await this.listDocuments(
      "by-linked-entity",
      input,
      (filters) => {
        applyStatusFilter(filters, input.status);
        filters.push({
          linkedEntityKind: input.linkedEntityKind,
        });

        if (input.linkedEntityKind === "EMPLOYMENT_PROFILE") {
          filters.push({
            linkedEmploymentProfileId:
              input.linkedEmploymentProfileId,
          });
          filters.push({
            linkedTalentId: null,
          });
        } else {
          filters.push({
            linkedTalentId: input.linkedTalentId,
          });
          filters.push({
            linkedEmploymentProfileId: null,
          });
        }

        applyWindowIntersectionFilter(filters, {
          windowStartDate: input.windowStartDate,
          windowEndDate: input.windowEndDate,
        });
      },
    );

    return {
      items: page.items.map(
        toContractRecordByLinkedEntityListItemView,
      ),
      nextCursor: page.nextCursor,
    };
  }

  async listContractRecordsByOwner(
    input: ListContractRecordsByOwnerReadInput,
  ): Promise<ListContractRecordsByOwnerReadResult> {
    const page = await this.listDocuments(
      "by-owner",
      input,
      (filters) => {
        applyStatusFilter(filters, input.status);
        applyOwnerFilter(
          filters,
          input.ownerEmploymentProfileId,
        );
        applyWindowIntersectionFilter(filters, {
          windowStartDate: input.windowStartDate,
          windowEndDate: input.windowEndDate,
        });
      },
    );

    return {
      items: page.items.map(
        toContractRecordByOwnerListItemView,
      ),
      nextCursor: page.nextCursor,
    };
  }

  async getContractRecordDetail(
    contractRecordId: string,
  ): Promise<ContractRecordDetailView | null> {
    const document = await this.collection.findOne({
      _id: contractRecordId,
    });

    return document
      ? toContractRecordDetailView(document)
      : null;
  }

  private async listDocuments<TInput extends {
    readonly limit: number;
    readonly cursor?: string;
    readonly sortField?: ContractRecordSortField;
    readonly sortDirection?: ContractRecordSortDirection;
  }>(
    view: ReadViewKind,
    input: TInput,
    buildFilters: (
      filters: Array<Record<string, unknown>>,
    ) => void,
  ): Promise<PageResult> {
    const sortSpec = toSortSpec(input);
    const queryShapeSignature =
      buildCursorQueryShapeSignature(
        view,
        input,
        sortSpec,
      );
    const cursor =
      input.cursor === undefined
        ? undefined
        : decodeCursor(
            input.cursor,
            sortSpec,
            queryShapeSignature,
          );

    const queryFilters: Array<Record<string, unknown>> =
      [];

    buildFilters(queryFilters);

    if (cursor) {
      queryFilters.push(
        buildPageAfterFilter(sortSpec, cursor),
      );
    }

    const documents = await this.collection
      .find(buildQuery(queryFilters))
      .sort(toSortDocument(sortSpec))
      .limit(input.limit + 1)
      .toArray();

    const hasNext = documents.length > input.limit;
    const page = hasNext
      ? documents.slice(0, input.limit)
      : documents;

    return {
      items: page,
      nextCursor:
        hasNext && page.length > 0
          ? encodeCursor(
              buildCursorFromDocument(
                sortSpec,
                page[page.length - 1],
                queryShapeSignature,
              ),
            )
          : undefined,
    };
  }
}

function applyStatusFilter(
  filters: Array<Record<string, unknown>>,
  status: ContractRecordStatus | undefined,
): void {
  if (status) {
    filters.push({
      status,
    });
    return;
  }

  filters.push({
    status: {
      $ne: "ARCHIVED",
    },
  });
}

function applyContractKindFilter(
  filters: Array<Record<string, unknown>>,
  contractKind:
    | ContractRecordDetailView["contractKind"]
    | undefined,
): void {
  if (!contractKind) {
    return;
  }

  filters.push({
    contractKind,
  });
}

function applyLinkedEntityKindFilter(
  filters: Array<Record<string, unknown>>,
  linkedEntityKind:
    | ContractRecordDetailView["linkedEntityKind"]
    | undefined,
): void {
  if (!linkedEntityKind) {
    return;
  }

  filters.push({
    linkedEntityKind,
  });
}

function applyLinkedEntityIdFilter(
  filters: Array<Record<string, unknown>>,
  input: {
    readonly linkedEmploymentProfileId?: string;
    readonly linkedTalentId?: string;
  },
): void {
  if (input.linkedEmploymentProfileId) {
    filters.push({
      linkedEmploymentProfileId:
        input.linkedEmploymentProfileId,
    });
  }

  if (input.linkedTalentId) {
    filters.push({
      linkedTalentId: input.linkedTalentId,
    });
  }
}

function applyOwnerFilter(
  filters: Array<Record<string, unknown>>,
  ownerEmploymentProfileId: string | undefined,
): void {
  if (!ownerEmploymentProfileId) {
    return;
  }

  filters.push({
    ownerEmploymentProfileId,
  });
}

function applyConfidentialityTierFilter(
  filters: Array<Record<string, unknown>>,
  confidentialityTier:
    | ContractRecordDetailView["confidentialityTier"]
    | undefined,
): void {
  if (!confidentialityTier) {
    return;
  }

  filters.push({
    confidentialityTier,
  });
}

function applyHasFileReferenceFilter(
  filters: Array<Record<string, unknown>>,
  hasFileReference: boolean | undefined,
): void {
  if (hasFileReference === undefined) {
    return;
  }

  if (hasFileReference) {
    filters.push({
      fileReferenceId: {
        $ne: null,
      },
    });
    return;
  }

  filters.push({
    fileReferenceId: null,
  });
}

function applyWindowIntersectionFilter(
  filters: Array<Record<string, unknown>>,
  input: {
    readonly windowStartDate?: number;
    readonly windowEndDate?: number;
  },
): void {
  if (input.windowStartDate !== undefined) {
    filters.push({
      $or: [
        {
          effectiveEndDate: null,
        },
        {
          effectiveEndDate: {
            $gte: input.windowStartDate,
          },
        },
      ],
    });
  }

  if (input.windowEndDate !== undefined) {
    filters.push({
      effectiveStartDate: {
        $lte: input.windowEndDate,
      },
    });
  }
}

function applySearchFilter(
  filters: Array<Record<string, unknown>>,
  search: string | undefined,
): void {
  if (!search) {
    return;
  }

  filters.push({
    $or: [
      {
        normalizedContractCode: search,
      },
      buildPrefixRange("normalizedTitle", search),
    ],
  });
}

function buildPrefixRange(
  field: string,
  prefix: string,
): Record<string, unknown> {
  return {
    [field]: {
      $gte: prefix,
      $lt: `${prefix}\uffff`,
    },
  };
}

function toContractRecordListItemView(
  input: ContractRecordReadDocument,
): ContractRecordListItemView {
  return {
    id: input._id,
    contractCode: input.contractCode,
    title: input.title,
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
    createdAt: input.createdAt,
  };
}

function toContractRecordByLinkedEntityListItemView(
  input: ContractRecordReadDocument,
): ContractRecordByLinkedEntityListItemView {
  return {
    id: input._id,
    contractCode: input.contractCode,
    title: input.title,
    contractKind: input.contractKind,
    linkedEntityKind: input.linkedEntityKind,
    linkedEmploymentProfileId:
      input.linkedEmploymentProfileId,
    linkedTalentId: input.linkedTalentId,
    status: input.status,
    effectiveStartDate: input.effectiveStartDate,
    effectiveEndDate: input.effectiveEndDate,
  };
}

function toContractRecordByOwnerListItemView(
  input: ContractRecordReadDocument,
): ContractRecordByOwnerListItemView {
  return {
    id: input._id,
    contractCode: input.contractCode,
    title: input.title,
    contractKind: input.contractKind,
    ownerEmploymentProfileId:
      input.ownerEmploymentProfileId,
    confidentialityTier: input.confidentialityTier,
    status: input.status,
    effectiveStartDate: input.effectiveStartDate,
    effectiveEndDate: input.effectiveEndDate,
  };
}

function toContractRecordDetailView(
  input: ContractRecordReadDocument,
): ContractRecordDetailView {
  return {
    id: input._id,
    contractCode: input.contractCode,
    title: input.title,
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

function toSortSpec(
  input: Pick<
    ListContractRecordsReadInput,
    "sortField" | "sortDirection"
  >,
): SortSpec {
  if (!input.sortField) {
    return {
      kind: "default",
    };
  }

  return {
    kind: "field",
    field: input.sortField,
    direction: input.sortDirection ?? "ASC",
  };
}

function toSortDocument(
  spec: SortSpec,
): Record<string, 1 | -1> {
  if (spec.kind === "default") {
    return {
      effectiveStartDate: -1,
      contractCode: 1,
      _id: 1,
    };
  }

  const direction = toDirectionValue(spec.direction);

  return {
    [spec.field]: direction,
    _id: direction,
  };
}

function buildCursorFromDocument(
  spec: SortSpec,
  document: ContractRecordReadDocument,
  queryShapeSignature: string,
): EncodedCursor {
  if (spec.kind === "default") {
    return {
      kind: "default",
      queryShapeSignature,
      effectiveStartDate:
        document.effectiveStartDate,
      contractCode: document.contractCode,
      id: document._id,
    };
  }

  return {
    kind: "field",
    queryShapeSignature,
    field: spec.field,
    direction: spec.direction,
    value: readSortFieldValue(
      document,
      spec.field,
    ),
    id: document._id,
  };
}

function buildQuery(
  filters: ReadonlyArray<Record<string, unknown>>,
): Record<string, unknown> {
  if (filters.length === 0) {
    return {};
  }

  if (filters.length === 1) {
    return filters[0] ?? {};
  }

  return {
    $and: [...filters],
  };
}

function buildPageAfterFilter(
  spec: SortSpec,
  cursor: EncodedCursor,
): Record<string, unknown> {
  if (spec.kind === "default") {
    if (cursor.kind !== "default") {
      throw invalidCursorError();
    }

    return {
      $or: [
        {
          effectiveStartDate: {
            $lt: cursor.effectiveStartDate,
          },
        },
        {
          effectiveStartDate:
            cursor.effectiveStartDate,
          contractCode: {
            $gt: cursor.contractCode,
          },
        },
        {
          effectiveStartDate:
            cursor.effectiveStartDate,
          contractCode: cursor.contractCode,
          _id: {
            $gt: cursor.id,
          },
        },
      ],
    };
  }

  if (
    cursor.kind !== "field" ||
    cursor.field !== spec.field ||
    cursor.direction !== spec.direction
  ) {
    throw invalidCursorError();
  }

  const comparisonOperator =
    spec.direction === "ASC"
      ? "$gt"
      : "$lt";

  return {
    $or: [
      {
        [spec.field]: {
          [comparisonOperator]:
            cursor.value,
        },
      },
      {
        [spec.field]: cursor.value,
        _id: {
          [comparisonOperator]: cursor.id,
        },
      },
    ],
  };
}

function encodeCursor(
  cursor: EncodedCursor,
): string {
  return Buffer.from(
    JSON.stringify(cursor),
    "utf8",
  ).toString("base64url");
}

function decodeCursor(
  cursor: string,
  expectedSpec: SortSpec,
  expectedQueryShapeSignature: string,
): EncodedCursor {
  const normalized = cursor.trim();

  if (!normalized) {
    throw invalidCursorError();
  }

  let decodedText: string;

  try {
    decodedText = Buffer.from(
      normalized,
      "base64url",
    ).toString("utf8");
  } catch {
    throw invalidCursorError();
  }

  let payload: unknown;

  try {
    payload = JSON.parse(decodedText);
  } catch {
    throw invalidCursorError();
  }

  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    throw invalidCursorError();
  }

  const candidate = payload as Record<string, unknown>;
  const queryShapeSignature =
    candidate.queryShapeSignature;

  if (
    typeof queryShapeSignature !== "string" ||
    queryShapeSignature !==
      expectedQueryShapeSignature
  ) {
    throw invalidCursorError();
  }

  if (expectedSpec.kind === "default") {
    if (
      candidate.kind !== "default" ||
      typeof candidate.effectiveStartDate !==
        "number" ||
      !Number.isInteger(
        candidate.effectiveStartDate,
      ) ||
      typeof candidate.contractCode !== "string" ||
      typeof candidate.id !== "string"
    ) {
      throw invalidCursorError();
    }

    const contractCode =
      candidate.contractCode.trim();
    const id = candidate.id.trim();

    if (!contractCode || !id) {
      throw invalidCursorError();
    }

    return {
      kind: "default",
      queryShapeSignature,
      effectiveStartDate:
        candidate.effectiveStartDate,
      contractCode,
      id,
    };
  }

  if (
    candidate.kind !== "field" ||
    candidate.field !== expectedSpec.field ||
    candidate.direction !== expectedSpec.direction ||
    typeof candidate.id !== "string"
  ) {
    throw invalidCursorError();
  }

  const id = candidate.id.trim();

  if (!id) {
    throw invalidCursorError();
  }

  const value = candidate.value;

  if (expectedSpec.field === "contractCode") {
    if (typeof value !== "string") {
      throw invalidCursorError();
    }
  } else if (
    typeof value !== "number" ||
    !Number.isInteger(value)
  ) {
    throw invalidCursorError();
  }

  return {
    kind: "field",
    queryShapeSignature,
    field: expectedSpec.field,
    direction: expectedSpec.direction,
    value,
    id,
  };
}

function buildCursorQueryShapeSignature(
  view: ReadViewKind,
  input: unknown,
  sortSpec: SortSpec,
): string {
  switch (view) {
    case "list": {
      const typed = input as ListContractRecordsReadInput;

      return JSON.stringify({
        view,
        status: typed.status ?? null,
        contractKind: typed.contractKind ?? null,
        linkedEntityKind:
          typed.linkedEntityKind ?? null,
        linkedEmploymentProfileId:
          typed.linkedEmploymentProfileId ?? null,
        linkedTalentId: typed.linkedTalentId ?? null,
        ownerEmploymentProfileId:
          typed.ownerEmploymentProfileId ?? null,
        confidentialityTier:
          typed.confidentialityTier ?? null,
        hasFileReference:
          typed.hasFileReference ?? null,
        windowStartDate:
          typed.windowStartDate ?? null,
        windowEndDate:
          typed.windowEndDate ?? null,
        search: typed.search ?? null,
        sortSpec,
      });
    }

    case "by-linked-entity": {
      const typed =
        input as ListContractRecordsByLinkedEntityReadInput;

      return JSON.stringify({
        view,
        linkedEntityKind: typed.linkedEntityKind,
        linkedEmploymentProfileId:
          typed.linkedEmploymentProfileId,
        linkedTalentId: typed.linkedTalentId,
        status: typed.status ?? null,
        windowStartDate:
          typed.windowStartDate ?? null,
        windowEndDate: typed.windowEndDate ?? null,
        sortSpec,
      });
    }

    case "by-owner": {
      const typed =
        input as ListContractRecordsByOwnerReadInput;

      return JSON.stringify({
        view,
        ownerEmploymentProfileId:
          typed.ownerEmploymentProfileId,
        status: typed.status ?? null,
        windowStartDate:
          typed.windowStartDate ?? null,
        windowEndDate: typed.windowEndDate ?? null,
        sortSpec,
      });
    }
  }
}

function readSortFieldValue(
  document: ContractRecordReadDocument,
  field: ContractRecordSortField,
): string | number {
  switch (field) {
    case "effectiveStartDate":
      return document.effectiveStartDate;

    case "contractCode":
      return document.contractCode;

    case "createdAt":
      return document.createdAt;
  }
}

function toDirectionValue(
  direction: ContractRecordSortDirection,
): 1 | -1 {
  return direction === "ASC" ? 1 : -1;
}

function invalidCursorError(): ContractRegistryValidationError {
  return new ContractRegistryValidationError(
    "cursor is invalid",
  );
}
