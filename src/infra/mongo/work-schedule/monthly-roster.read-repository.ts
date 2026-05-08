import { Db } from "mongodb";
import { BaseRepository } from "@infra/database/repository/base.repository";
import { WorkScheduleValidationError } from "@modules/work-schedule/domain/work-schedule.errors";
import {
  MONTHLY_ROSTER_STATUSES,
  MONTHLY_ROSTER_TARGET_ORG_UNIT_MODE,
  MONTHLY_ROSTER_TARGET_SUBJECT_KIND,
  MONTHLY_ROSTER_TIMEZONE,
  MonthlyRosterListItemView,
  MonthlyRosterStatus,
  MonthlyRosterView,
  RosterExceptionRecord,
} from "@modules/work-schedule/domain/work-schedule.types";
import {
  MonthlyRosterListReadInput,
  MonthlyRosterListReadResult,
  MonthlyRosterReadRepository,
} from "@modules/work-schedule/read/work-schedule.read-repository";

interface MonthlyRosterReadDocument {
  readonly _id: string;
  readonly rosterCode: string;
  readonly normalizedRosterCode: string;
  readonly rosterMonth: string;
  readonly timezone: typeof MONTHLY_ROSTER_TIMEZONE;
  readonly targetSubjectKind: typeof MONTHLY_ROSTER_TARGET_SUBJECT_KIND;
  readonly targetOrgUnitMode: typeof MONTHLY_ROSTER_TARGET_ORG_UNIT_MODE;
  readonly departmentOrgUnitId: string;
  readonly workPatternId: string;
  readonly holidayCalendarId: string;
  readonly status: MonthlyRosterStatus;
  readonly draftVersion: number;
  readonly previewHash: string | null;
  readonly lastPreviewedAt: number | null;
  readonly publishedAt: number | null;
  readonly publishedByUserId: string | null;
  readonly publishGenerationRunId: string | null;
  readonly description: string | null;
  readonly externalRef: string | null;
  readonly exceptions: readonly RosterExceptionRecord[];
  readonly archivedAt: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

interface EncodedCursor {
  readonly queryShapeSignature: string;
  readonly createdAt: number;
  readonly monthlyRosterId: string;
}

export class NativeMongoMonthlyRosterReadRepository
  extends BaseRepository<MonthlyRosterReadDocument>
  implements MonthlyRosterReadRepository
{
  constructor(db: Db) {
    super(db, "work_monthly_rosters");
  }

  async listMonthlyRosters(
    input: MonthlyRosterListReadInput,
  ): Promise<MonthlyRosterListReadResult> {
    const queryShapeSignature =
      buildCursorQueryShapeSignature(input);
    const cursor =
      input.cursor === undefined
        ? undefined
        : decodeCursor(
            input.cursor,
            queryShapeSignature,
          );
    const filters: Array<Record<string, unknown>> = [];

    applyStatusFilter(filters, input.status);
    applyEqualsFilter(
      filters,
      "rosterMonth",
      input.rosterMonth,
    );
    applyEqualsFilter(
      filters,
      "departmentOrgUnitId",
      input.departmentOrgUnitId,
    );
    applyEqualsFilter(
      filters,
      "workPatternId",
      input.workPatternId,
    );
    applyEqualsFilter(
      filters,
      "holidayCalendarId",
      input.holidayCalendarId,
    );
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
              $gt: cursor.monthlyRosterId,
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
        toMonthlyRosterListItemView(document),
      ),
      nextCursor:
        hasNext && page.length > 0
          ? encodeCursor({
              queryShapeSignature,
              createdAt: page[page.length - 1].createdAt,
              monthlyRosterId: page[page.length - 1]._id,
            })
          : undefined,
    };
  }

  async getMonthlyRosterDetail(
    monthlyRosterId: string,
  ): Promise<MonthlyRosterView | null> {
    const doc = await this.collection.findOne({
      _id: monthlyRosterId,
    });

    return doc ? toMonthlyRosterView(doc) : null;
  }
}

function applyStatusFilter(
  filters: Array<Record<string, unknown>>,
  status: MonthlyRosterStatus | undefined,
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

function applyEqualsFilter(
  filters: Array<Record<string, unknown>>,
  field: string,
  value: string | undefined,
): void {
  if (value !== undefined) {
    filters.push({ [field]: value });
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
    normalizedRosterCode: {
      $gte: search,
      $lt: `${search}\uffff`,
    },
  });
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

function toMonthlyRosterListItemView(
  document: MonthlyRosterReadDocument,
): MonthlyRosterListItemView {
  return {
    monthlyRosterId: document._id,
    rosterCode: document.rosterCode,
    rosterMonth: document.rosterMonth,
    timezone: document.timezone,
    targetSubjectKind: document.targetSubjectKind,
    targetOrgUnitMode: document.targetOrgUnitMode,
    departmentOrgUnitId: document.departmentOrgUnitId,
    workPatternId: document.workPatternId,
    holidayCalendarId: document.holidayCalendarId,
    status: document.status,
    draftVersion: document.draftVersion,
    exceptionCount: document.exceptions.filter(
      (exception) => exception.status === "ACTIVE",
    ).length,
    description: document.description,
    externalRef: document.externalRef,
    archivedAt: document.archivedAt,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

function toMonthlyRosterView(
  document: MonthlyRosterReadDocument,
): MonthlyRosterView {
  return {
    ...toMonthlyRosterListItemView(document),
    previewHash: document.previewHash,
    lastPreviewedAt: document.lastPreviewedAt,
    publishedAt: document.publishedAt,
    publishedByUserId: document.publishedByUserId,
    publishGenerationRunId:
      document.publishGenerationRunId,
    exceptions: document.exceptions.map((exception) => ({
      ...exception,
      studioResourceIds: [
        ...exception.studioResourceIds,
      ],
    })),
  };
}

function encodeCursor(cursor: EncodedCursor): string {
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
    typeof candidate.monthlyRosterId !== "string" ||
    !candidate.monthlyRosterId.trim()
  ) {
    throw invalidCursorError();
  }

  return {
    queryShapeSignature: expectedQueryShapeSignature,
    createdAt: candidate.createdAt,
    monthlyRosterId:
      candidate.monthlyRosterId.trim(),
  };
}

function buildCursorQueryShapeSignature(
  input: MonthlyRosterListReadInput,
): string {
  return JSON.stringify({
    status: input.status ?? null,
    rosterMonth: input.rosterMonth ?? null,
    departmentOrgUnitId:
      input.departmentOrgUnitId ?? null,
    workPatternId: input.workPatternId ?? null,
    holidayCalendarId:
      input.holidayCalendarId ?? null,
    search: input.search ?? null,
  });
}

function invalidCursorError(): WorkScheduleValidationError {
  return new WorkScheduleValidationError(
    "cursor is invalid",
  );
}
