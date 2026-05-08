import { Db } from "mongodb";
import { BaseRepository } from "@infra/database/repository/base.repository";
import { WorkScheduleValidationError } from "@modules/work-schedule/domain/work-schedule.errors";
import {
  WorkShiftByResourceListItemView,
  WorkShiftBySubjectListItemView,
  WorkShiftDetailView,
  WorkShiftListItemView,
  WorkShiftSortDirection,
  WorkShiftSortField,
  WorkShiftSourceType,
  WorkShiftStatus,
  WorkShiftSubjectKind,
} from "@modules/work-schedule/domain/work-schedule.types";
import {
  ActiveEmploymentProfileWorkShiftConflictView,
  ActiveEmploymentProfileWorkShiftLookupInput,
  WorkShiftByResourceListReadInput,
  WorkShiftByResourceListReadResult,
  WorkShiftBySubjectListReadInput,
  WorkShiftBySubjectListReadResult,
  WorkShiftListReadInput,
  WorkShiftListReadResult,
  WorkShiftReadRepository,
} from "@modules/work-schedule/read/work-schedule.read-repository";

interface WorkShiftReadDocument {
  readonly _id: string;
  readonly shiftCode: string;
  readonly normalizedShiftCode: string;
  readonly title: string;
  readonly normalizedTitle: string;
  readonly subjectKind: WorkShiftSubjectKind;
  readonly subjectEmploymentProfileId: string | null;
  readonly subjectTalentId: string | null;
  readonly subjectTalentGroupId: string | null;
  readonly studioResourceIds: readonly string[];
  readonly status: WorkShiftStatus;
  readonly shiftStartAt: number;
  readonly shiftEndAt: number;
  readonly description: string | null;
  readonly externalRef: string | null;
  readonly sourceType?: WorkShiftSourceType | null;
  readonly sourceRosterId?: string | null;
  readonly sourcePatternId?: string | null;
  readonly sourceExceptionId?: string | null;
  readonly sourceGenerationRunId?: string | null;
  readonly sourceRosterMonth?: string | null;
  readonly sourceDepartmentOrgUnitId?: string | null;
  readonly sourceRosterLocalDate?: string | null;
  readonly sourceRosterSlotKey?: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

type ReadViewKind =
  | "list"
  | "by-subject"
  | "by-resource";

type SortSpec =
  | {
      readonly kind: "default";
    }
  | {
      readonly kind: "field";
      readonly field: WorkShiftSortField;
      readonly direction: WorkShiftSortDirection;
    };

type EncodedCursor =
  | {
      readonly kind: "default";
      readonly queryShapeSignature: string;
      readonly shiftStartAt: number;
      readonly id: string;
    }
  | {
      readonly kind: "field";
      readonly queryShapeSignature: string;
      readonly field: WorkShiftSortField;
      readonly direction: WorkShiftSortDirection;
      readonly value: string | number;
      readonly id: string;
    };

interface PageResult {
  readonly items: readonly WorkShiftReadDocument[];
  readonly nextCursor?: string;
}

export class NativeMongoWorkShiftReadRepository
  extends BaseRepository<WorkShiftReadDocument>
  implements WorkShiftReadRepository
{
  constructor(db: Db) {
    super(db, "work_shifts");
  }

  async listWorkShifts(
    input: WorkShiftListReadInput,
  ): Promise<WorkShiftListReadResult> {
    const page = await this.listDocuments(
      "list",
      input,
      (filters) => {
        applyBaseFilters(filters, input);
      },
    );

    return {
      items: page.items.map((item) =>
        toWorkShiftListItemView(item),
      ),
      nextCursor: page.nextCursor,
    };
  }

  async listWorkShiftsBySubject(
    input: WorkShiftBySubjectListReadInput,
  ): Promise<WorkShiftBySubjectListReadResult> {
    const page = await this.listDocuments(
      "by-subject",
      input,
      (filters) => {
        applyBySubjectFilters(filters, input);
      },
    );

    return {
      items: page.items.map((item) =>
        toWorkShiftBySubjectListItemView(item),
      ),
      nextCursor: page.nextCursor,
    };
  }

  async listWorkShiftsByResource(
    input: WorkShiftByResourceListReadInput,
  ): Promise<WorkShiftByResourceListReadResult> {
    const page = await this.listDocuments(
      "by-resource",
      input,
      (filters) => {
        applyByResourceFilters(filters, input);
      },
    );

    return {
      items: page.items.map((item) =>
        toWorkShiftByResourceListItemView(item),
      ),
      nextCursor: page.nextCursor,
    };
  }

  async getWorkShiftDetail(
    workShiftId: string,
  ): Promise<WorkShiftDetailView | null> {
    const doc = await this.collection.findOne({
      _id: workShiftId,
    });

    return doc ? toWorkShiftDetailView(doc) : null;
  }

  async listActiveEmploymentProfileShiftsForWindow(
    input: ActiveEmploymentProfileWorkShiftLookupInput,
  ): Promise<
    readonly ActiveEmploymentProfileWorkShiftConflictView[]
  > {
    if (input.subjectEmploymentProfileIds.length === 0) {
      return [];
    }

    const docs = await this.collection
      .find({
        status: "ACTIVE",
        subjectKind: "EMPLOYMENT_PROFILE",
        subjectEmploymentProfileId: {
          $in: [...input.subjectEmploymentProfileIds],
        },
        shiftStartAt: {
          $lt: input.windowEndAt,
        },
        shiftEndAt: {
          $gt: input.windowStartAt,
        },
      })
      .sort({
        subjectEmploymentProfileId: 1,
        shiftStartAt: 1,
        _id: 1,
      })
      .toArray();

    return docs
      .filter(
        (doc) =>
          doc.subjectEmploymentProfileId !== null,
      )
      .map(toActiveEmploymentProfileConflictView);
  }

  private async listDocuments<TInput extends {
    readonly limit: number;
    readonly cursor?: string;
    readonly sortField?: WorkShiftSortField;
    readonly sortDirection?: WorkShiftSortDirection;
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

function applyBaseFilters(
  filters: Array<Record<string, unknown>>,
  input: WorkShiftListReadInput,
): void {
  applyStatusFilter(filters, input.status);
  applySubjectFilter(filters, {
    subjectKind: input.subjectKind,
    subjectEmploymentProfileId:
      input.subjectEmploymentProfileId,
    subjectTalentId: input.subjectTalentId,
    subjectTalentGroupId:
      input.subjectTalentGroupId,
  });
  applyContainsResourceFilter(
    filters,
    input.containsStudioResourceId,
  );
  applySourceFilters(filters, input);
  applyWindowFilter(filters, input);
  applySearchFilter(filters, input.search);
  applyScopeEmploymentProfileFilter(
    filters,
    input.scopeEmploymentProfileIds,
  );
}

function applySourceFilters(
  filters: Array<Record<string, unknown>>,
  input: {
    readonly sourceType?: WorkShiftSourceType;
    readonly sourceRosterId?: string;
    readonly sourceDepartmentOrgUnitId?: string;
    readonly sourceRosterMonth?: string;
  },
): void {
  if (input.sourceType === "MANUAL") {
    filters.push({
      $or: [
        {
          sourceType: "MANUAL",
        },
        {
          sourceType: {
            $exists: false,
          },
        },
        {
          sourceType: null,
        },
      ],
    });
  } else if (input.sourceType) {
    filters.push({
      sourceType: input.sourceType,
    });
  }

  if (input.sourceRosterId) {
    filters.push({
      sourceRosterId: input.sourceRosterId,
    });
  }

  if (input.sourceDepartmentOrgUnitId) {
    filters.push({
      sourceDepartmentOrgUnitId:
        input.sourceDepartmentOrgUnitId,
    });
  }

  if (input.sourceRosterMonth) {
    filters.push({
      sourceRosterMonth: input.sourceRosterMonth,
    });
  }
}

function applyBySubjectFilters(
  filters: Array<Record<string, unknown>>,
  input: WorkShiftBySubjectListReadInput,
): void {
  applyStatusFilter(filters, input.status);
  applyExactSubjectFilter(filters, {
    subjectKind: input.subjectKind,
    subjectEmploymentProfileId:
      input.subjectEmploymentProfileId,
    subjectTalentId: input.subjectTalentId,
    subjectTalentGroupId:
      input.subjectTalentGroupId,
  });
  applyWindowFilter(filters, input);
  applyScopeEmploymentProfileFilter(
    filters,
    input.scopeEmploymentProfileIds,
  );
}

function applyByResourceFilters(
  filters: Array<Record<string, unknown>>,
  input: WorkShiftByResourceListReadInput,
): void {
  applyStatusFilter(filters, input.status);
  applyContainsResourceFilter(
    filters,
    input.studioResourceId,
  );
  applyWindowFilter(filters, input);
  applyScopeEmploymentProfileFilter(
    filters,
    input.scopeEmploymentProfileIds,
  );
}

function applyStatusFilter(
  filters: Array<Record<string, unknown>>,
  status: WorkShiftStatus | undefined,
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

function applySubjectFilter(
  filters: Array<Record<string, unknown>>,
  input: {
    readonly subjectKind?: WorkShiftSubjectKind;
    readonly subjectEmploymentProfileId?: string;
    readonly subjectTalentId?: string;
    readonly subjectTalentGroupId?: string;
  },
): void {
  if (input.subjectKind) {
    filters.push({
      subjectKind: input.subjectKind,
    });
  }

  if (input.subjectEmploymentProfileId) {
    filters.push({
      subjectEmploymentProfileId:
        input.subjectEmploymentProfileId,
    });
  }

  if (input.subjectTalentId) {
    filters.push({
      subjectTalentId: input.subjectTalentId,
    });
  }

  if (input.subjectTalentGroupId) {
    filters.push({
      subjectTalentGroupId:
        input.subjectTalentGroupId,
    });
  }
}

function applyExactSubjectFilter(
  filters: Array<Record<string, unknown>>,
  input: {
    readonly subjectKind: WorkShiftSubjectKind;
    readonly subjectEmploymentProfileId: string | null;
    readonly subjectTalentId: string | null;
    readonly subjectTalentGroupId: string | null;
  },
): void {
  switch (input.subjectKind) {
    case "EMPLOYMENT_PROFILE":
      filters.push({
        subjectKind: input.subjectKind,
      });
      filters.push({
        subjectEmploymentProfileId:
          input.subjectEmploymentProfileId,
      });
      return;

    case "TALENT":
      filters.push({
        subjectKind: input.subjectKind,
      });
      filters.push({
        subjectTalentId: input.subjectTalentId,
      });
      return;

    case "TALENT_GROUP":
      filters.push({
        subjectKind: input.subjectKind,
      });
      filters.push({
        subjectTalentGroupId:
          input.subjectTalentGroupId,
      });
      return;
  }
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

function applyWindowFilter(
  filters: Array<Record<string, unknown>>,
  input: {
    readonly windowStartAt?: number;
    readonly windowEndAt?: number;
  },
): void {
  if (input.windowStartAt !== undefined) {
    filters.push({
      shiftEndAt: {
        $gt: input.windowStartAt,
      },
    });
  }

  if (input.windowEndAt !== undefined) {
    filters.push({
      shiftStartAt: {
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

  filters.push({
    $or: [
      buildPrefixRange(
        "normalizedShiftCode",
        search,
      ),
      buildPrefixRange("normalizedTitle", search),
    ],
  });
}

function applyScopeEmploymentProfileFilter(
  filters: Array<Record<string, unknown>>,
  scopeEmploymentProfileIds:
    | readonly string[]
    | undefined,
): void {
  if (!scopeEmploymentProfileIds) {
    return;
  }

  if (scopeEmploymentProfileIds.length === 0) {
    filters.push({
      _id: {
        $in: [],
      },
    });
    return;
  }

  filters.push({
    subjectKind: "EMPLOYMENT_PROFILE",
  });
  filters.push({
    subjectEmploymentProfileId: {
      $in: [...scopeEmploymentProfileIds],
    },
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

function toWorkShiftListItemView(
  document: WorkShiftReadDocument,
): WorkShiftListItemView {
  return {
    id: document._id,
    shiftCode: document.shiftCode,
    title: document.title,
    subjectKind: document.subjectKind,
    subjectEmploymentProfileId:
      document.subjectEmploymentProfileId,
    subjectTalentId: document.subjectTalentId,
    subjectTalentGroupId:
      document.subjectTalentGroupId,
    status: document.status,
    shiftStartAt: document.shiftStartAt,
    shiftEndAt: document.shiftEndAt,
    sourceType: normalizeSourceType(
      document.sourceType,
    ),
    sourceRosterId:
      document.sourceRosterId ?? null,
    sourceRosterMonth:
      document.sourceRosterMonth ?? null,
    sourceRosterLocalDate:
      document.sourceRosterLocalDate ?? null,
    sourceRosterSlotKey:
      document.sourceRosterSlotKey ?? null,
    createdAt: document.createdAt,
  };
}

function toWorkShiftBySubjectListItemView(
  document: WorkShiftReadDocument,
): WorkShiftBySubjectListItemView {
  return {
    id: document._id,
    shiftCode: document.shiftCode,
    title: document.title,
    subjectKind: document.subjectKind,
    status: document.status,
    shiftStartAt: document.shiftStartAt,
    shiftEndAt: document.shiftEndAt,
  };
}

function toWorkShiftByResourceListItemView(
  document: WorkShiftReadDocument,
): WorkShiftByResourceListItemView {
  return {
    id: document._id,
    shiftCode: document.shiftCode,
    title: document.title,
    status: document.status,
    shiftStartAt: document.shiftStartAt,
    shiftEndAt: document.shiftEndAt,
  };
}

function toWorkShiftDetailView(
  document: WorkShiftReadDocument,
): WorkShiftDetailView {
  return {
    id: document._id,
    shiftCode: document.shiftCode,
    title: document.title,
    subjectKind: document.subjectKind,
    subjectEmploymentProfileId:
      document.subjectEmploymentProfileId,
    subjectTalentId: document.subjectTalentId,
    subjectTalentGroupId:
      document.subjectTalentGroupId,
    studioResourceIds: [
      ...document.studioResourceIds,
    ],
    status: document.status,
    shiftStartAt: document.shiftStartAt,
    shiftEndAt: document.shiftEndAt,
    description: document.description,
    externalRef: document.externalRef,
    sourceType: normalizeSourceType(
      document.sourceType,
    ),
    sourceRosterId:
      document.sourceRosterId ?? null,
    sourcePatternId:
      document.sourcePatternId ?? null,
    sourceExceptionId:
      document.sourceExceptionId ?? null,
    sourceGenerationRunId:
      document.sourceGenerationRunId ?? null,
    sourceRosterMonth:
      document.sourceRosterMonth ?? null,
    sourceDepartmentOrgUnitId:
      document.sourceDepartmentOrgUnitId ?? null,
    sourceRosterLocalDate:
      document.sourceRosterLocalDate ?? null,
    sourceRosterSlotKey:
      document.sourceRosterSlotKey ?? null,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

function toActiveEmploymentProfileConflictView(
  document: WorkShiftReadDocument,
): ActiveEmploymentProfileWorkShiftConflictView {
  return {
    workShiftId: document._id,
    shiftCode: document.shiftCode,
    title: document.title,
    subjectEmploymentProfileId:
      document.subjectEmploymentProfileId as string,
    status: "ACTIVE",
    shiftStartAt: document.shiftStartAt,
    shiftEndAt: document.shiftEndAt,
    sourceType: normalizeSourceType(
      document.sourceType,
    ),
    sourceRosterId:
      document.sourceRosterId ?? null,
    sourceRosterMonth:
      document.sourceRosterMonth ?? null,
    sourceRosterLocalDate:
      document.sourceRosterLocalDate ?? null,
    sourceRosterSlotKey:
      document.sourceRosterSlotKey ?? null,
  };
}

function normalizeSourceType(
  value: WorkShiftSourceType | null | undefined,
): WorkShiftSourceType {
  return value === "ROSTER_GENERATED"
    ? "ROSTER_GENERATED"
    : "MANUAL";
}

function toSortSpec(
  input: Pick<
    WorkShiftListReadInput,
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
      shiftStartAt: 1,
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
  document: WorkShiftReadDocument,
  queryShapeSignature: string,
): EncodedCursor {
  if (spec.kind === "default") {
    return {
      kind: "default",
      queryShapeSignature,
      shiftStartAt: document.shiftStartAt,
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
          shiftStartAt: {
            $gt: cursor.shiftStartAt,
          },
        },
        {
          shiftStartAt: cursor.shiftStartAt,
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
      typeof candidate.shiftStartAt !== "number" ||
      !Number.isInteger(candidate.shiftStartAt) ||
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
      shiftStartAt: candidate.shiftStartAt,
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

  if (expectedSpec.field === "shiftCode") {
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
      const typed = input as WorkShiftListReadInput;

      return JSON.stringify({
        view,
        status: typed.status ?? null,
        subjectKind: typed.subjectKind ?? null,
        subjectEmploymentProfileId:
          typed.subjectEmploymentProfileId ?? null,
        subjectTalentId:
          typed.subjectTalentId ?? null,
        subjectTalentGroupId:
          typed.subjectTalentGroupId ?? null,
        containsStudioResourceId:
          typed.containsStudioResourceId ?? null,
        sourceType: typed.sourceType ?? null,
        sourceRosterId:
          typed.sourceRosterId ?? null,
        sourceDepartmentOrgUnitId:
          typed.sourceDepartmentOrgUnitId ?? null,
        sourceRosterMonth:
          typed.sourceRosterMonth ?? null,
        windowStartAt:
          typed.windowStartAt ?? null,
        windowEndAt: typed.windowEndAt ?? null,
        search: typed.search ?? null,
        scopeEmploymentProfileIds:
          typed.scopeEmploymentProfileIds ?? null,
        sortSpec,
      });
    }

    case "by-subject": {
      const typed =
        input as WorkShiftBySubjectListReadInput;

      return JSON.stringify({
        view,
        subjectKind: typed.subjectKind,
        subjectEmploymentProfileId:
          typed.subjectEmploymentProfileId,
        subjectTalentId: typed.subjectTalentId,
        subjectTalentGroupId:
          typed.subjectTalentGroupId,
        status: typed.status ?? null,
        windowStartAt:
          typed.windowStartAt ?? null,
        windowEndAt: typed.windowEndAt ?? null,
        scopeEmploymentProfileIds:
          typed.scopeEmploymentProfileIds ?? null,
        sortSpec,
      });
    }

    case "by-resource": {
      const typed =
        input as WorkShiftByResourceListReadInput;

      return JSON.stringify({
        view,
        studioResourceId: typed.studioResourceId,
        status: typed.status ?? null,
        windowStartAt:
          typed.windowStartAt ?? null,
        windowEndAt: typed.windowEndAt ?? null,
        scopeEmploymentProfileIds:
          typed.scopeEmploymentProfileIds ?? null,
        sortSpec,
      });
    }
  }
}

function readSortFieldValue(
  document: WorkShiftReadDocument,
  field: WorkShiftSortField,
): string | number {
  switch (field) {
    case "shiftStartAt":
      return document.shiftStartAt;

    case "shiftCode":
      return document.shiftCode;

    case "createdAt":
      return document.createdAt;
  }
}

function toDirectionValue(
  direction: WorkShiftSortDirection,
): 1 | -1 {
  return direction === "ASC" ? 1 : -1;
}

function invalidCursorError(): WorkScheduleValidationError {
  return new WorkScheduleValidationError(
    "cursor is invalid",
  );
}
