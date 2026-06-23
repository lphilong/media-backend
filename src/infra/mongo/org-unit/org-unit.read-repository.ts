import { Collection, Db } from "mongodb";
import { BaseRepository } from "@infra/database/repository";
import { OrgUnitValidationError } from "@modules/org-unit/domain/org-unit.errors";
import {
  OrgUnitChildListItemView,
  OrgUnitDetailView,
  OrgUnitListItemView,
  OrgUnitSortDirection,
  OrgUnitSortField,
  OrgUnitStatus,
  OrgUnitType,
} from "@modules/org-unit/domain/org-unit.types";
import {
  ListDirectChildrenReadInput,
  ListDirectChildrenReadResult,
  ListOrgUnitReadInput,
  ListOrgUnitReadResult,
  OrgUnitReadRepository,
} from "@modules/org-unit/read/org-unit.read-repository";
import { ReferenceSummary } from "@modules/reference-summary";

interface OrgUnitReadDocument {
  readonly _id: string;
  readonly code: string;
  readonly searchCode: string;
  readonly name: string;
  readonly normalizedName: string;
  readonly type: OrgUnitType;
  readonly status: OrgUnitStatus;
  readonly parentOrgUnitId: string | null;
  readonly ancestorChain: readonly string[];
  readonly depth: number;
  readonly displayOrder: number;
  readonly description: string | null;
  readonly externalRef: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

type SortSpec =
  | {
      readonly kind: "default";
    }
  | {
      readonly kind: "field";
      readonly field: OrgUnitSortField;
      readonly direction: OrgUnitSortDirection;
    };

type EncodedCursor =
  | {
      readonly kind: "default";
      readonly queryKey: string;
      readonly displayOrder: number;
      readonly name: string;
      readonly id: string;
    }
  | {
      readonly kind: "field";
      readonly queryKey: string;
      readonly field: OrgUnitSortField;
      readonly direction: OrgUnitSortDirection;
      readonly value: string | number;
      readonly id: string;
    };

export class NativeMongoOrgUnitReadRepository
  extends BaseRepository<OrgUnitReadDocument>
  implements OrgUnitReadRepository
{
  private readonly orgUnitReferenceCollection: Collection<OrgUnitReadDocument>;

  constructor(db: Db) {
    super(db, "org_units");
    this.orgUnitReferenceCollection =
      db.collection<OrgUnitReadDocument>("org_units");
  }

  async listOrgUnits(
    input: ListOrgUnitReadInput,
  ): Promise<ListOrgUnitReadResult> {
    const sortSpec = toSortSpec(input);
    const queryKey = buildListQueryKey(
      input,
      sortSpec,
    );
    const cursor =
      input.cursor === undefined
        ? undefined
        : decodeCursor(
            input.cursor,
            sortSpec,
            queryKey,
          );
    const queryFilters: Array<Record<string, unknown>> =
      [];

    if (input.orgUnitIds) {
      queryFilters.push({ _id: { $in: [...input.orgUnitIds] } });
    }

    if (input.status) {
      queryFilters.push({
        status: input.status,
      });
    } else {
      queryFilters.push({
        status: {
          $ne: "ARCHIVED",
        },
      });
    }

    if (input.type) {
      queryFilters.push({
        type: input.type,
      });
    }

    if (input.rootOnly) {
      queryFilters.push({
        parentOrgUnitId: null,
      });
    } else if (input.parentOrgUnitId !== undefined) {
      queryFilters.push({
        parentOrgUnitId: input.parentOrgUnitId,
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
    const items =
      await enrichOrgUnitParentReferenceSummaries(
        page.map((doc) => toOrgUnitListItemView(doc)),
        this.orgUnitReferenceCollection,
      );

    return {
      items,
      nextCursor:
        hasNext && page.length > 0
          ? encodeCursor(
              buildCursorFromDocument(
                sortSpec,
                page[page.length - 1],
                queryKey,
              ),
            )
          : undefined,
    };
  }

  async getOrgUnitDetail(
    orgUnitId: string,
  ): Promise<OrgUnitDetailView | null> {
    const doc = await this.collection.findOne({
      _id: orgUnitId,
    });

    if (!doc) {
      return null;
    }

    const [detail] =
      await enrichOrgUnitParentReferenceSummaries(
        [toOrgUnitDetailView(doc)],
        this.orgUnitReferenceCollection,
      );

    return detail ?? null;
  }

  async listDirectChildren(
    input: ListDirectChildrenReadInput,
  ): Promise<ListDirectChildrenReadResult> {
    const sortSpec: SortSpec = { kind: "default" };
    const queryKey = buildDirectChildrenQueryKey(
      input,
    );
    const cursor =
      input.cursor === undefined
        ? undefined
        : decodeCursor(
            input.cursor,
            sortSpec,
            queryKey,
          );
    const queryFilters: Array<Record<string, unknown>> =
      [
        {
          parentOrgUnitId: input.parentOrgUnitId,
        },
        {
          status: {
            $ne: "ARCHIVED",
          },
        },
      ];

    if (input.orgUnitIds) {
      queryFilters.push({ _id: { $in: [...input.orgUnitIds] } });
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
    const items =
      await enrichOrgUnitParentReferenceSummaries(
        page.map((doc) => toOrgUnitChildListItemView(doc)),
        this.orgUnitReferenceCollection,
      );

    return {
      items,
      nextCursor:
        hasNext && page.length > 0
          ? encodeCursor(
              buildCursorFromDocument(
                sortSpec,
                page[page.length - 1],
                queryKey,
              ),
            )
          : undefined,
    };
  }
}

async function enrichOrgUnitParentReferenceSummaries<
  T extends {
    readonly parentOrgUnitId: string | null;
  },
>(
  items: readonly T[],
  collection: Collection<OrgUnitReadDocument>,
): Promise<readonly (T & { readonly parentOrgUnitRef: ReferenceSummary | null })[]> {
  if (items.length === 0) {
    return items.map((item) => ({
      ...item,
      parentOrgUnitRef: null,
    }));
  }

  const parentIds = new Set<string>();

  for (const item of items) {
    addOptionalReferenceId(parentIds, item.parentOrgUnitId);
  }

  const parentRefMap =
    await loadOrgUnitReferenceSummaries(parentIds, collection);

  return items.map((item) => ({
    ...item,
    parentOrgUnitRef: item.parentOrgUnitId
      ? parentRefMap.get(item.parentOrgUnitId) ?? null
      : null,
  }));
}

async function loadOrgUnitReferenceSummaries(
  ids: ReadonlySet<string>,
  collection: Collection<OrgUnitReadDocument>,
): Promise<Map<string, ReferenceSummary>> {
  if (ids.size === 0) {
    return new Map();
  }

  const documents = await collection
    .find(
      {
        _id: {
          $in: [...ids],
        },
      },
      {
        projection: {
          _id: 1,
          code: 1,
          name: 1,
          status: 1,
        },
      },
    )
    .toArray();

  return new Map(
    documents.map((document) => [
      document._id,
      toOrgUnitReferenceSummary(document),
    ]),
  );
}

function toOrgUnitReferenceSummary(
  document: Pick<OrgUnitReadDocument, "_id" | "code" | "name" | "status">,
): ReferenceSummary {
  return {
    id: document._id,
    code: document.code,
    name: document.name,
    status: document.status,
  };
}

function addOptionalReferenceId(ids: Set<string>, value: string | null): void {
  const normalized = value?.trim();

  if (normalized) {
    ids.add(normalized);
  }
}

function toOrgUnitListItemView(
  document: OrgUnitReadDocument,
): OrgUnitListItemView {
  return {
    id: document._id,
    code: document.code,
    name: document.name,
    type: document.type,
    status: document.status,
    parentOrgUnitId: document.parentOrgUnitId,
    depth: document.depth,
    displayOrder: document.displayOrder,
    createdAt: document.createdAt,
  };
}

function toOrgUnitChildListItemView(
  document: OrgUnitReadDocument,
): OrgUnitChildListItemView {
  return {
    id: document._id,
    code: document.code,
    name: document.name,
    type: document.type,
    status: document.status,
    parentOrgUnitId: document.parentOrgUnitId,
    depth: document.depth,
    displayOrder: document.displayOrder,
  };
}

function toOrgUnitDetailView(
  document: OrgUnitReadDocument,
): OrgUnitDetailView {
  return {
    id: document._id,
    code: document.code,
    name: document.name,
    type: document.type,
    status: document.status,
    description: document.description,
    externalRef: document.externalRef,
    parentOrgUnitId: document.parentOrgUnitId,
    depth: document.depth,
    displayOrder: document.displayOrder,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    hierarchy: {
      id: document._id,
      parentOrgUnitId: document.parentOrgUnitId,
      depth: document.depth,
      ancestorChain: [...document.ancestorChain],
    },
  };
}

function toSortSpec(
  input: Pick<
    ListOrgUnitReadInput,
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
      displayOrder: 1,
      name: 1,
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
  document: OrgUnitReadDocument,
  queryKey: string,
): EncodedCursor {
  if (spec.kind === "default") {
    return {
      kind: "default",
      queryKey,
      displayOrder: document.displayOrder,
      name: document.name,
      id: document._id,
    };
  }

  return {
    kind: "field",
    queryKey,
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

  return { $and: [...filters] };
}

function buildSearchFilter(
  search: string,
): Record<string, unknown> {
  const normalizedNamePrefix =
    normalizeNamePrefix(search);
  const normalizedCodePrefix =
    normalizeCodePrefix(search);

  return {
    $or: [
      buildPrefixRange(
        "normalizedName",
        normalizedNamePrefix,
      ),
      buildPrefixRange(
        "searchCode",
        normalizedCodePrefix,
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
          displayOrder: {
            $gt: cursor.displayOrder,
          },
        },
        {
          displayOrder: cursor.displayOrder,
          name: {
            $gt: cursor.name,
          },
        },
        {
          displayOrder: cursor.displayOrder,
          name: cursor.name,
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
  expectedQueryKey: string,
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

  if (expectedSpec.kind === "default") {
    if (candidate.kind !== "default") {
      throw invalidCursorError();
    }

    if (
      candidate.queryKey !== expectedQueryKey ||
      typeof candidate.displayOrder !== "number" ||
      !Number.isInteger(candidate.displayOrder) ||
      typeof candidate.name !== "string" ||
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
      queryKey: expectedQueryKey,
      displayOrder: candidate.displayOrder,
      name: candidate.name,
      id,
    };
  }

  if (
    candidate.kind !== "field" ||
    candidate.queryKey !== expectedQueryKey ||
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
    expectedSpec.field === "name" ||
    expectedSpec.field === "code"
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
    queryKey: expectedQueryKey,
    field: expectedSpec.field,
    direction: expectedSpec.direction,
    value,
    id,
  };
}

function buildListQueryKey(
  input: ListOrgUnitReadInput,
  sortSpec: SortSpec,
): string {
  return JSON.stringify({
    surface: "list-org-units",
    status: input.status ?? "__DEFAULT_NON_ARCHIVED__",
    orgUnitIds: input.orgUnitIds ? [...input.orgUnitIds].sort() : null,
    type: input.type ?? null,
    parentOrgUnitId: input.parentOrgUnitId ?? null,
    rootOnly: input.rootOnly ?? false,
    search: input.search ?? null,
    sort: toSortCursorKey(sortSpec),
  });
}

function buildDirectChildrenQueryKey(
  input: ListDirectChildrenReadInput,
): string {
  return JSON.stringify({
    surface: "list-direct-children",
    parentOrgUnitId: input.parentOrgUnitId,
    orgUnitIds: input.orgUnitIds ? [...input.orgUnitIds].sort() : null,
    status: "__DEFAULT_NON_ARCHIVED__",
    sort: {
      kind: "default",
    },
  });
}

function toSortCursorKey(
  spec: SortSpec,
): Record<string, string> {
  if (spec.kind === "default") {
    return {
      kind: "default",
    };
  }

  return {
    kind: "field",
    field: spec.field,
    direction: spec.direction,
  };
}

function readSortFieldValue(
  document: OrgUnitReadDocument,
  field: OrgUnitSortField,
): string | number {
  switch (field) {
    case "code":
      return document.code;

    case "name":
      return document.name;

    case "createdAt":
      return document.createdAt;

    case "displayOrder":
      return document.displayOrder;
  }
}

function toDirectionValue(
  direction: OrgUnitSortDirection,
): 1 | -1 {
  return direction === "ASC" ? 1 : -1;
}

function normalizeNamePrefix(
  value: string,
): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();
}

function normalizeCodePrefix(
  value: string,
): string {
  return value.trim().toLowerCase();
}

function invalidCursorError(): OrgUnitValidationError {
  return new OrgUnitValidationError(
    "cursor is invalid",
  );
}
