import {
  Collection,
  Db,
} from "mongodb";
import { BaseRepository } from "@infra/database/repository/base.repository";
import { EventAssignmentValidationError } from "@modules/event-assignment/domain/event-assignment.errors";
import {
  EventAssignmentKind,
  EventAssignmentListItemView,
  EventAssignmentStatus,
  EventByAssignmentListItemView,
  EventByPlatformListItemView,
  EventByResourceListItemView,
  EventDetailView,
  EventListItemView,
  EventSortDirection,
  EventSortField,
  EventStatus,
} from "@modules/event-assignment/domain/event-assignment.types";
import {
  EventAssignmentReadRepository,
  EventByAssignmentListReadInput,
  EventByAssignmentListReadResult,
  EventByPlatformListReadInput,
  EventByPlatformListReadResult,
  EventByResourceListReadInput,
  EventByResourceListReadResult,
  EventListReadInput,
  EventListReadResult,
} from "@modules/event-assignment/read/event-assignment.read-repository";

interface EventReadDocument {
  readonly _id: string;
  readonly eventCode: string;
  readonly title: string;
  readonly normalizedTitle: string;
  readonly studioResourceIds: readonly string[];
  readonly platformAccountIds: readonly string[];
  readonly status: EventStatus;
  readonly eventStartAt: number;
  readonly eventEndAt: number;
  readonly description: string | null;
  readonly externalRef: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

interface EventAssignmentReadDocument {
  readonly _id: string;
  readonly eventId: string;
  readonly assignmentKind: EventAssignmentKind;
  readonly assignmentEmploymentProfileId: string | null;
  readonly assignmentTalentId: string | null;
  readonly assignmentTalentGroupId: string | null;
  readonly assignmentStatus: EventAssignmentStatus;
  readonly createdAt: number;
}

type ReadViewKind =
  | "list"
  | "by-assignment"
  | "by-resource"
  | "by-platform";

type SortSpec =
  | {
      readonly kind: "default";
    }
  | {
      readonly kind: "field";
      readonly field: EventSortField;
      readonly direction: EventSortDirection;
    };

type EncodedCursor =
  | {
      readonly kind: "default";
      readonly queryShapeSignature: string;
      readonly eventStartAt: number;
      readonly id: string;
    }
  | {
      readonly kind: "field";
      readonly queryShapeSignature: string;
      readonly field: EventSortField;
      readonly direction: EventSortDirection;
      readonly value: string | number;
      readonly id: string;
    };

interface PageResult {
  readonly items: readonly EventReadDocument[];
  readonly nextCursor?: string;
}

interface EventAssignmentFilterInput {
  readonly assignmentKind?: EventAssignmentKind;
  readonly assignmentEmploymentProfileId?: string;
  readonly assignmentTalentId?: string;
  readonly assignmentTalentGroupId?: string;
}

export class NativeMongoEventAssignmentReadRepository
  extends BaseRepository<EventReadDocument>
  implements EventAssignmentReadRepository
{
  private readonly assignmentCollection: Collection<EventAssignmentReadDocument>;

  constructor(db: Db) {
    super(db, "events");
    this.assignmentCollection =
      db.collection<EventAssignmentReadDocument>(
        "event_assignments",
      );
  }

  async listEvents(
    input: EventListReadInput,
  ): Promise<EventListReadResult> {
    const page = await this.listDocuments(
      "list",
      input,
      async (filters) => {
        applyStatusFilter(filters, input.status);
        await applyAssignmentFilter(
          filters,
          input,
          this.assignmentCollection,
        );
        applyContainsResourceFilter(
          filters,
          input.containsStudioResourceId,
        );
        applyContainsPlatformFilter(
          filters,
          input.containsPlatformAccountId,
        );
        applyWindowFilter(filters, input);
        applySearchFilter(filters, input.search);
      },
    );

    return {
      items: page.items.map(toEventListItemView),
      nextCursor: page.nextCursor,
    };
  }

  async listEventsByAssignment(
    input: EventByAssignmentListReadInput,
  ): Promise<EventByAssignmentListReadResult> {
    const page = await this.listDocuments(
      "by-assignment",
      input,
      async (filters) => {
        applyStatusFilter(filters, input.status);

        await applyAssignmentFilter(
          filters,
          {
            assignmentKind: input.assignmentKind,
            assignmentEmploymentProfileId:
              input.assignmentEmploymentProfileId ??
              undefined,
            assignmentTalentId:
              input.assignmentTalentId ??
              undefined,
            assignmentTalentGroupId:
              input.assignmentTalentGroupId ??
              undefined,
          },
          this.assignmentCollection,
        );

        applyWindowFilter(filters, input);
      },
    );

    return {
      items: page.items.map(
        toEventByAssignmentListItemView,
      ),
      nextCursor: page.nextCursor,
    };
  }

  async listEventsByResource(
    input: EventByResourceListReadInput,
  ): Promise<EventByResourceListReadResult> {
    const page = await this.listDocuments(
      "by-resource",
      input,
      async (filters) => {
        applyStatusFilter(filters, input.status);
        applyContainsResourceFilter(
          filters,
          input.studioResourceId,
        );
        applyWindowFilter(filters, input);
      },
    );

    return {
      items: page.items.map(toEventByResourceListItemView),
      nextCursor: page.nextCursor,
    };
  }

  async listEventsByPlatform(
    input: EventByPlatformListReadInput,
  ): Promise<EventByPlatformListReadResult> {
    const page = await this.listDocuments(
      "by-platform",
      input,
      async (filters) => {
        applyStatusFilter(filters, input.status);
        applyContainsPlatformFilter(
          filters,
          input.platformAccountId,
        );
        applyWindowFilter(filters, input);
      },
    );

    return {
      items: page.items.map(toEventByPlatformListItemView),
      nextCursor: page.nextCursor,
    };
  }

  async listActiveAssignmentsForEvent(
    eventId: string,
  ): Promise<readonly EventAssignmentListItemView[]> {
    const docs = await this.assignmentCollection
      .find(
        {
          eventId,
          assignmentStatus: "ACTIVE",
        },
      )
      .toArray();

    return docs
      .sort(compareAssignmentDocuments)
      .map((doc) => ({
        id: doc._id,
        eventId: doc.eventId,
        assignmentKind: doc.assignmentKind,
        assignmentEmploymentProfileId:
          doc.assignmentEmploymentProfileId,
        assignmentTalentId: doc.assignmentTalentId,
        assignmentTalentGroupId:
          doc.assignmentTalentGroupId,
        assignmentStatus: doc.assignmentStatus,
        createdAt: doc.createdAt,
      }));
  }

  async getEventDetail(
    eventId: string,
  ): Promise<EventDetailView | null> {
    const doc = await this.collection.findOne({
      _id: eventId,
    });

    return doc ? toEventDetailView(doc) : null;
  }

  private async listDocuments<TInput extends {
    readonly limit: number;
    readonly cursor?: string;
    readonly sortField?: EventSortField;
    readonly sortDirection?: EventSortDirection;
  }>(
    view: ReadViewKind,
    input: TInput,
    buildFilters: (
      filters: Array<Record<string, unknown>>,
    ) => Promise<void>,
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

    await buildFilters(queryFilters);

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

function applyStatusFilter(
  filters: Array<Record<string, unknown>>,
  status: EventStatus | undefined,
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

async function applyAssignmentFilter(
  filters: Array<Record<string, unknown>>,
  input: EventAssignmentFilterInput,
  assignmentCollection: Collection<EventAssignmentReadDocument>,
): Promise<void> {
  if (
    input.assignmentKind === undefined &&
    input.assignmentEmploymentProfileId === undefined &&
    input.assignmentTalentId === undefined &&
    input.assignmentTalentGroupId === undefined
  ) {
    return;
  }

  const query: Record<string, unknown> = {
    assignmentStatus: "ACTIVE",
  };

  if (input.assignmentKind) {
    query.assignmentKind = input.assignmentKind;
  }

  if (input.assignmentEmploymentProfileId) {
    query.assignmentEmploymentProfileId =
      input.assignmentEmploymentProfileId;
  }

  if (input.assignmentTalentId) {
    query.assignmentTalentId =
      input.assignmentTalentId;
  }

  if (input.assignmentTalentGroupId) {
    query.assignmentTalentGroupId =
      input.assignmentTalentGroupId;
  }

  const eventIds =
    await assignmentCollection.distinct(
      "eventId",
      query,
    );

  if (eventIds.length === 0) {
    filters.push({
      _id: {
        $in: [],
      },
    });

    return;
  }

  filters.push({
    _id: {
      $in: [...eventIds],
    },
  });
}

function applyContainsResourceFilter(
  filters: Array<Record<string, unknown>>,
  studioResourceId: string | undefined,
): void {
  if (!studioResourceId) {
    return;
  }

  filters.push({
    studioResourceIds: studioResourceId,
  });
}

function applyContainsPlatformFilter(
  filters: Array<Record<string, unknown>>,
  platformAccountId: string | undefined,
): void {
  if (!platformAccountId) {
    return;
  }

  filters.push({
    platformAccountIds: platformAccountId,
  });
}

function applyWindowFilter(
  filters: Array<Record<string, unknown>>,
  input: {
    readonly windowStartAt?: number;
    readonly windowEndAt?: number;
  },
): void {
  if (input.windowStartAt !== undefined) {
    filters.push({
      eventEndAt: {
        $gt: input.windowStartAt,
      },
    });
  }

  if (input.windowEndAt !== undefined) {
    filters.push({
      eventStartAt: {
        $lt: input.windowEndAt,
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

  const normalizedTitleSearch =
    search.toLowerCase();

  filters.push({
    $or: [
      {
        eventCode: search,
      },
      buildPrefixRange(
        "normalizedTitle",
        normalizedTitleSearch,
      ),
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

function toEventListItemView(
  document: EventReadDocument,
): EventListItemView {
  return {
    id: document._id,
    eventCode: document.eventCode,
    title: document.title,
    status: document.status,
    eventStartAt: document.eventStartAt,
    eventEndAt: document.eventEndAt,
    createdAt: document.createdAt,
  };
}

function toEventByAssignmentListItemView(
  document: EventReadDocument,
): EventByAssignmentListItemView {
  return {
    id: document._id,
    eventCode: document.eventCode,
    title: document.title,
    status: document.status,
    eventStartAt: document.eventStartAt,
    eventEndAt: document.eventEndAt,
  };
}

function toEventByResourceListItemView(
  document: EventReadDocument,
): EventByResourceListItemView {
  return {
    id: document._id,
    eventCode: document.eventCode,
    title: document.title,
    status: document.status,
    eventStartAt: document.eventStartAt,
    eventEndAt: document.eventEndAt,
  };
}

function toEventByPlatformListItemView(
  document: EventReadDocument,
): EventByPlatformListItemView {
  return {
    id: document._id,
    eventCode: document.eventCode,
    title: document.title,
    status: document.status,
    eventStartAt: document.eventStartAt,
    eventEndAt: document.eventEndAt,
  };
}

function toEventDetailView(
  document: EventReadDocument,
): EventDetailView {
  return {
    id: document._id,
    eventCode: document.eventCode,
    title: document.title,
    studioResourceIds: [
      ...document.studioResourceIds,
    ],
    platformAccountIds: [
      ...document.platformAccountIds,
    ],
    status: document.status,
    eventStartAt: document.eventStartAt,
    eventEndAt: document.eventEndAt,
    description: document.description,
    externalRef: document.externalRef,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

function toSortSpec(
  input: Pick<
    EventListReadInput,
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
      eventStartAt: 1,
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
  document: EventReadDocument,
  queryShapeSignature: string,
): EncodedCursor {
  if (spec.kind === "default") {
    return {
      kind: "default",
      queryShapeSignature,
      eventStartAt: document.eventStartAt,
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
          eventStartAt: {
            $gt: cursor.eventStartAt,
          },
        },
        {
          eventStartAt: cursor.eventStartAt,
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
      typeof candidate.eventStartAt !== "number" ||
      !Number.isInteger(candidate.eventStartAt) ||
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
      eventStartAt: candidate.eventStartAt,
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

  if (expectedSpec.field === "eventCode") {
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
      const typed = input as EventListReadInput;

      return JSON.stringify({
        view,
        status: typed.status ?? null,
        assignmentKind:
          typed.assignmentKind ?? null,
        assignmentEmploymentProfileId:
          typed.assignmentEmploymentProfileId ?? null,
        assignmentTalentId:
          typed.assignmentTalentId ?? null,
        assignmentTalentGroupId:
          typed.assignmentTalentGroupId ?? null,
        containsStudioResourceId:
          typed.containsStudioResourceId ?? null,
        containsPlatformAccountId:
          typed.containsPlatformAccountId ?? null,
        windowStartAt:
          typed.windowStartAt ?? null,
        windowEndAt: typed.windowEndAt ?? null,
        search: typed.search ?? null,
        sortSpec,
      });
    }

    case "by-assignment": {
      const typed =
        input as EventByAssignmentListReadInput;

      return JSON.stringify({
        view,
        assignmentKind: typed.assignmentKind,
        assignmentEmploymentProfileId:
          typed.assignmentEmploymentProfileId,
        assignmentTalentId:
          typed.assignmentTalentId,
        assignmentTalentGroupId:
          typed.assignmentTalentGroupId,
        status: typed.status ?? null,
        windowStartAt:
          typed.windowStartAt ?? null,
        windowEndAt: typed.windowEndAt ?? null,
        sortSpec,
      });
    }

    case "by-resource": {
      const typed =
        input as EventByResourceListReadInput;

      return JSON.stringify({
        view,
        studioResourceId: typed.studioResourceId,
        status: typed.status ?? null,
        windowStartAt:
          typed.windowStartAt ?? null,
        windowEndAt: typed.windowEndAt ?? null,
        sortSpec,
      });
    }

    case "by-platform": {
      const typed =
        input as EventByPlatformListReadInput;

      return JSON.stringify({
        view,
        platformAccountId: typed.platformAccountId,
        status: typed.status ?? null,
        windowStartAt:
          typed.windowStartAt ?? null,
        windowEndAt: typed.windowEndAt ?? null,
        sortSpec,
      });
    }
  }
}

function readSortFieldValue(
  document: EventReadDocument,
  field: EventSortField,
): string | number {
  switch (field) {
    case "eventStartAt":
      return document.eventStartAt;

    case "eventCode":
      return document.eventCode;

    case "createdAt":
      return document.createdAt;
  }
}

function toDirectionValue(
  direction: EventSortDirection,
): 1 | -1 {
  return direction === "ASC" ? 1 : -1;
}

function invalidCursorError(): EventAssignmentValidationError {
  return new EventAssignmentValidationError(
    "cursor is invalid",
  );
}

function compareAssignmentDocuments(
  left: EventAssignmentReadDocument,
  right: EventAssignmentReadDocument,
): number {
  if (left.assignmentKind < right.assignmentKind) {
    return -1;
  }

  if (left.assignmentKind > right.assignmentKind) {
    return 1;
  }

  const leftReferenceId =
    readAssignmentReferenceId(left);
  const rightReferenceId =
    readAssignmentReferenceId(right);

  if (leftReferenceId < rightReferenceId) {
    return -1;
  }

  if (leftReferenceId > rightReferenceId) {
    return 1;
  }

  return 0;
}

function readAssignmentReferenceId(
  assignment: Pick<
    EventAssignmentReadDocument,
    | "assignmentKind"
    | "assignmentEmploymentProfileId"
    | "assignmentTalentId"
    | "assignmentTalentGroupId"
  >,
): string {
  switch (assignment.assignmentKind) {
    case "EMPLOYMENT_PROFILE":
      return assignment.assignmentEmploymentProfileId ?? "";

    case "TALENT":
      return assignment.assignmentTalentId ?? "";

    case "TALENT_GROUP":
      return assignment.assignmentTalentGroupId ?? "";
  }
}
