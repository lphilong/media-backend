import { Db } from "mongodb";
import { BaseRepository } from "@infra/database/repository/base.repository";
import { WorkScheduleValidationError } from "@modules/work-schedule/domain/work-schedule.errors";
import {
  WORK_PATTERN_TIMEZONE,
  WorkPatternListItemView,
  WorkPatternStatus,
  WorkPatternView,
  WorkPatternWeekdayToken,
} from "@modules/work-schedule/domain/work-schedule.types";
import {
  WorkPatternListReadInput,
  WorkPatternListReadResult,
  WorkPatternReadRepository,
} from "@modules/work-schedule/read/work-schedule.read-repository";

interface WorkPatternReadDocument {
  readonly _id: string;
  readonly patternCode: string;
  readonly normalizedPatternCode: string;
  readonly name: string;
  readonly normalizedName: string;
  readonly status: WorkPatternStatus;
  readonly timezone: typeof WORK_PATTERN_TIMEZONE;
  readonly startLocalTime: string;
  readonly endLocalTime: string;
  readonly workingMinutes: number;
  readonly breakMinutes: number;
  readonly workingDays: readonly WorkPatternWeekdayToken[];
  readonly description: string | null;
  readonly externalRef: string | null;
  readonly activatedAt: number | null;
  readonly archivedAt: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

interface EncodedCursor {
  readonly queryShapeSignature: string;
  readonly createdAt: number;
  readonly workPatternId: string;
}

export class NativeMongoWorkPatternReadRepository
  extends BaseRepository<WorkPatternReadDocument>
  implements WorkPatternReadRepository
{
  constructor(db: Db) {
    super(db, "work_patterns");
  }

  async listWorkPatterns(
    input: WorkPatternListReadInput,
  ): Promise<WorkPatternListReadResult> {
    const queryShapeSignature =
      buildCursorQueryShapeSignature(input);
    const cursor =
      input.cursor === undefined
        ? undefined
        : decodeCursor(
            input.cursor,
            queryShapeSignature,
          );
    const filters: Array<Record<string, unknown>> =
      [];

    applyStatusFilter(filters, input.status);
    applySearchFilter(filters, input.search);

    if (cursor) {
      filters.push({
        $or: [
          {
            createdAt: {
              $gt: cursor.createdAt,
            },
          },
          {
            createdAt: cursor.createdAt,
            _id: {
              $gt: cursor.workPatternId,
            },
          },
        ],
      });
    }

    const docs = await this.collection
      .find(buildQuery(filters))
      .sort({ createdAt: 1, _id: 1 })
      .limit(input.limit + 1)
      .toArray();
    const hasNext = docs.length > input.limit;
    const page = hasNext
      ? docs.slice(0, input.limit)
      : docs;

    return {
      items: page.map((document) =>
        toWorkPatternView(document),
      ),
      nextCursor:
        hasNext && page.length > 0
          ? encodeCursor({
              queryShapeSignature,
              createdAt: page[page.length - 1].createdAt,
              workPatternId: page[page.length - 1]._id,
            })
          : undefined,
    };
  }

  async getWorkPatternDetail(
    workPatternId: string,
  ): Promise<WorkPatternView | null> {
    const doc = await this.collection.findOne({
      _id: workPatternId,
    });

    return doc ? toWorkPatternView(doc) : null;
  }
}

function applyStatusFilter(
  filters: Array<Record<string, unknown>>,
  status: WorkPatternStatus | undefined,
): void {
  if (status) {
    filters.push({ status });
    return;
  }

  filters.push({
    status: {
      $ne: "ARCHIVED",
    },
  });
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
        "normalizedPatternCode",
        search,
      ),
      buildPrefixRange("normalizedName", search),
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

function toWorkPatternView(
  document: WorkPatternReadDocument,
): WorkPatternListItemView {
  return {
    workPatternId: document._id,
    patternCode: document.patternCode,
    name: document.name,
    status: document.status,
    timezone: document.timezone,
    startLocalTime: document.startLocalTime,
    endLocalTime: document.endLocalTime,
    workingMinutes: document.workingMinutes,
    breakMinutes: document.breakMinutes,
    workingDays: [...document.workingDays],
    description: document.description,
    externalRef: document.externalRef,
    activatedAt: document.activatedAt,
    archivedAt: document.archivedAt,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
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

  if (
    candidate.queryShapeSignature !==
      expectedQueryShapeSignature ||
    typeof candidate.createdAt !== "number" ||
    !Number.isInteger(candidate.createdAt) ||
    typeof candidate.workPatternId !== "string" ||
    !candidate.workPatternId.trim()
  ) {
    throw invalidCursorError();
  }

  return {
    queryShapeSignature: expectedQueryShapeSignature,
    createdAt: candidate.createdAt,
    workPatternId: candidate.workPatternId.trim(),
  };
}

function buildCursorQueryShapeSignature(
  input: WorkPatternListReadInput,
): string {
  return JSON.stringify({
    status: input.status ?? null,
    search: input.search ?? null,
  });
}

function invalidCursorError(): WorkScheduleValidationError {
  return new WorkScheduleValidationError(
    "cursor is invalid",
  );
}
