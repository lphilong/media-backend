import { Db } from "mongodb";
import { BaseRepository } from "@infra/database/repository/base.repository";
import { StudioResourceValidationError } from "@modules/studio-resource/domain/studio-resource.errors";
import {
  StudioResourceAvailabilityListItemView,
  StudioResourceClass,
  StudioResourceDetailView,
  StudioResourceListItemView,
  StudioResourceOperationalStatus,
  StudioResourceSortDirection,
  StudioResourceSortField,
} from "@modules/studio-resource/domain/studio-resource.types";
import {
  ListStudioResourcesReadInput,
  ListStudioResourceAvailabilityReadResult,
  ListStudioResourcesReadResult,
  StudioResourceReadRepository,
} from "@modules/studio-resource/read/studio-resource.read-repository";

interface StudioResourceReadDocument {
  readonly _id: string;
  readonly resourceCode: string;
  readonly normalizedResourceCode: string;
  readonly name: string;
  readonly normalizedName: string;
  readonly shortName: string | null;
  readonly normalizedShortName: string | null;
  readonly resourceClass: StudioResourceClass;
  readonly operationalStatus: StudioResourceOperationalStatus;
  readonly locationLabel: string | null;
  readonly description: string | null;
  readonly externalRef: string | null;
  readonly maxOccupancy: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

type ReadViewKind = "list" | "availability";

type SortSpec =
  | {
      readonly kind: "default";
    }
  | {
      readonly kind: "field";
      readonly field: StudioResourceSortField;
      readonly direction: StudioResourceSortDirection;
    };

type EncodedCursor =
  | {
      readonly kind: "default";
      readonly queryShapeSignature: string;
      readonly resourceCode: string;
      readonly id: string;
    }
  | {
      readonly kind: "field";
      readonly queryShapeSignature: string;
      readonly field: StudioResourceSortField;
      readonly direction: StudioResourceSortDirection;
      readonly value: string | number;
      readonly id: string;
    };

export class NativeMongoStudioResourceReadRepository
  extends BaseRepository<StudioResourceReadDocument>
  implements StudioResourceReadRepository
{
  constructor(db: Db) {
    super(db, "studio_resources");
  }

  async listStudioResources(
    input: ListStudioResourcesReadInput,
  ): Promise<ListStudioResourcesReadResult> {
    const page = await this.listDocuments(
      "list",
      input,
    );

    return {
      items: page.items.map((item) =>
        toStudioResourceListItemView(item),
      ),
      nextCursor: page.nextCursor,
    };
  }

  async listStudioResourceAvailability(
    input: ListStudioResourcesReadInput,
  ): Promise<ListStudioResourceAvailabilityReadResult> {
    const page = await this.listDocuments(
      "availability",
      input,
    );

    return {
      items: page.items.map((item) =>
        toStudioResourceAvailabilityListItemView(
          item,
        ),
      ),
      nextCursor: page.nextCursor,
    };
  }

  async getStudioResourceDetail(
    studioResourceId: string,
  ): Promise<StudioResourceDetailView | null> {
    const doc = await this.collection.findOne({
      _id: studioResourceId,
    });

    return doc ? toStudioResourceDetailView(doc) : null;
  }

  private async listDocuments(
    view: ReadViewKind,
    input: ListStudioResourcesReadInput,
  ): Promise<{
    readonly items: readonly StudioResourceReadDocument[];
    readonly nextCursor?: string;
  }> {
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

    if (input.resourceClass) {
      queryFilters.push({
        resourceClass: input.resourceClass,
      });
    }

    if (input.operationalStatus) {
      queryFilters.push({
        operationalStatus: input.operationalStatus,
      });
    } else {
      queryFilters.push({
        operationalStatus: {
          $ne: "ARCHIVED",
        },
      });
    }

    if (input.hasMaxOccupancy === true) {
      queryFilters.push({
        maxOccupancy: {
          $type: "number",
        },
      });
    }

    if (input.hasMaxOccupancy === false) {
      queryFilters.push({
        maxOccupancy: null,
      });
      queryFilters.push({
        maxOccupancy: {
          $exists: true,
        },
      });
    }

    if (input.search) {
      queryFilters.push(
        buildSearchFilter(input.search),
      );
    }

    if (cursor) {
      queryFilters.push(
        buildPageAfterFilter(sortSpec, cursor),
      );
    }

    const docs = await this.collection
      .find(buildQuery(queryFilters))
      .sort(toSortDocument(sortSpec))
      .limit(input.limit + 1)
      .toArray();

    const hasNext = docs.length > input.limit;
    const page = hasNext
      ? docs.slice(0, input.limit)
      : docs;

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

function toStudioResourceListItemView(
  document: StudioResourceReadDocument,
): StudioResourceListItemView {
  return {
    id: document._id,
    resourceCode: document.resourceCode,
    name: document.name,
    shortName: document.shortName,
    resourceClass: document.resourceClass,
    operationalStatus: document.operationalStatus,
    locationLabel: document.locationLabel,
    maxOccupancy: document.maxOccupancy,
    createdAt: document.createdAt,
  };
}

function toStudioResourceAvailabilityListItemView(
  document: StudioResourceReadDocument,
): StudioResourceAvailabilityListItemView {
  return {
    id: document._id,
    resourceCode: document.resourceCode,
    name: document.name,
    resourceClass: document.resourceClass,
    operationalStatus: document.operationalStatus,
    maxOccupancy: document.maxOccupancy,
  };
}

function toStudioResourceDetailView(
  document: StudioResourceReadDocument,
): StudioResourceDetailView {
  return {
    id: document._id,
    resourceCode: document.resourceCode,
    name: document.name,
    shortName: document.shortName,
    resourceClass: document.resourceClass,
    operationalStatus: document.operationalStatus,
    locationLabel: document.locationLabel,
    description: document.description,
    externalRef: document.externalRef,
    maxOccupancy: document.maxOccupancy,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

function toSortSpec(
  input: Pick<
    ListStudioResourcesReadInput,
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
      resourceCode: 1,
      _id: 1,
    };
  }

  const direction = toDirectionValue(
    spec.direction,
  );

  return {
    [spec.field]: direction,
    _id: direction,
  };
}

function buildCursorFromDocument(
  spec: SortSpec,
  document: StudioResourceReadDocument,
  queryShapeSignature: string,
): EncodedCursor {
  if (spec.kind === "default") {
    return {
      kind: "default",
      queryShapeSignature,
      resourceCode: document.resourceCode,
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

function buildSearchFilter(
  search: string,
): Record<string, unknown> {
  return {
    $or: [
      buildPrefixRange(
        "normalizedResourceCode",
        search,
      ),
      buildPrefixRange(
        "normalizedName",
        search,
      ),
      buildPrefixRange(
        "normalizedShortName",
        search,
      ),
    ],
  };
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
          resourceCode: {
            $gt: cursor.resourceCode,
          },
        },
        {
          resourceCode: cursor.resourceCode,
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

  const candidate = payload as Record<
    string,
    unknown
  >;
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
      typeof candidate.resourceCode !== "string" ||
      typeof candidate.id !== "string"
    ) {
      throw invalidCursorError();
    }

    const id = candidate.id.trim();

    if (!id) {
      throw invalidCursorError();
    }

    return {
      kind: "default",
      queryShapeSignature,
      resourceCode: candidate.resourceCode,
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

  if (
    expectedSpec.field === "resourceCode" ||
    expectedSpec.field === "name"
  ) {
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
  input: ListStudioResourcesReadInput,
  sortSpec: SortSpec,
): string {
  return JSON.stringify({
    view,
    resourceClass: input.resourceClass ?? null,
    operationalStatus:
      input.operationalStatus ?? null,
    hasMaxOccupancy:
      input.hasMaxOccupancy ?? null,
    search: input.search ?? null,
    sortSpec,
  });
}

function readSortFieldValue(
  document: StudioResourceReadDocument,
  field: StudioResourceSortField,
): string | number {
  switch (field) {
    case "resourceCode":
      return document.resourceCode;

    case "name":
      return document.name;

    case "createdAt":
      return document.createdAt;
  }
}

function toDirectionValue(
  direction: StudioResourceSortDirection,
): 1 | -1 {
  return direction === "ASC" ? 1 : -1;
}

function invalidCursorError(): StudioResourceValidationError {
  return new StudioResourceValidationError(
    "cursor is invalid",
  );
}
