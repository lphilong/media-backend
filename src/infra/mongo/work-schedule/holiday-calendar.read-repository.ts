import { Db } from "mongodb";
import { BaseRepository } from "@infra/database/repository/base.repository";
import { WorkScheduleValidationError } from "@modules/work-schedule/domain/work-schedule.errors";
import {
  HOLIDAY_CALENDAR_TIMEZONE,
  HolidayCalendarEntryRecord,
  HolidayCalendarEntryStatus,
  HolidayCalendarEntryType,
  HolidayCalendarListItemView,
  HolidayCalendarScopeType,
  HolidayCalendarStatus,
  HolidayCalendarView,
} from "@modules/work-schedule/domain/work-schedule.types";
import {
  HolidayCalendarActiveEntryLookupInput,
  HolidayCalendarListReadInput,
  HolidayCalendarListReadResult,
  HolidayCalendarReadRepository,
} from "@modules/work-schedule/read/work-schedule.read-repository";

interface HolidayCalendarEntryReadDocument {
  readonly holidayCalendarEntryId: string;
  readonly date: string;
  readonly entryType: HolidayCalendarEntryType;
  readonly name: string;
  readonly status: HolidayCalendarEntryStatus;
  readonly description: string | null;
  readonly externalRef: string | null;
  readonly removedAt: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

interface HolidayCalendarReadDocument {
  readonly _id: string;
  readonly calendarCode: string;
  readonly normalizedCalendarCode: string;
  readonly name: string;
  readonly normalizedName: string;
  readonly scopeType: HolidayCalendarScopeType;
  readonly timezone: typeof HOLIDAY_CALENDAR_TIMEZONE;
  readonly status: HolidayCalendarStatus;
  readonly entries?: readonly HolidayCalendarEntryReadDocument[];
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
  readonly holidayCalendarId: string;
}

export class NativeMongoHolidayCalendarReadRepository
  extends BaseRepository<HolidayCalendarReadDocument>
  implements HolidayCalendarReadRepository
{
  constructor(db: Db) {
    super(db, "work_holiday_calendars");
  }

  async listHolidayCalendars(
    input: HolidayCalendarListReadInput,
  ): Promise<HolidayCalendarListReadResult> {
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
              $gt: cursor.holidayCalendarId,
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
      items: page.map(toHolidayCalendarView),
      nextCursor:
        hasNext && page.length > 0
          ? encodeCursor({
              queryShapeSignature,
              createdAt: page[page.length - 1].createdAt,
              holidayCalendarId:
                page[page.length - 1]._id,
            })
          : undefined,
    };
  }

  async getHolidayCalendarDetail(
    holidayCalendarId: string,
  ): Promise<HolidayCalendarView | null> {
    const doc = await this.collection.findOne({
      _id: holidayCalendarId,
    });

    return doc ? toHolidayCalendarView(doc) : null;
  }

  async listActiveEntriesForDateRange(
    input: HolidayCalendarActiveEntryLookupInput,
  ): Promise<readonly HolidayCalendarEntryRecord[]> {
    const doc = await this.collection.findOne({
      _id: input.holidayCalendarId,
      status: "ACTIVE",
      entries: {
        $elemMatch: {
          status: "ACTIVE",
          date: {
            $gte: input.startDate,
            $lte: input.endDate,
          },
        },
      },
    });

    if (!doc) {
      return [];
    }

    return (doc.entries ?? [])
      .filter(
        (entry) =>
          entry.status === "ACTIVE" &&
          entry.date >= input.startDate &&
          entry.date <= input.endDate,
      )
      .map(toHolidayCalendarEntryRecord);
  }
}

function applyStatusFilter(
  filters: Array<Record<string, unknown>>,
  status: HolidayCalendarStatus | undefined,
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
        "normalizedCalendarCode",
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

function toHolidayCalendarView(
  document: HolidayCalendarReadDocument,
): HolidayCalendarListItemView {
  return {
    holidayCalendarId: document._id,
    calendarCode: document.calendarCode,
    name: document.name,
    scopeType: document.scopeType,
    timezone: document.timezone,
    status: document.status,
    entries: (document.entries ?? []).map(
      toHolidayCalendarEntryRecord,
    ),
    description: document.description,
    externalRef: document.externalRef,
    activatedAt: document.activatedAt,
    archivedAt: document.archivedAt,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

function toHolidayCalendarEntryRecord(
  entry: HolidayCalendarEntryReadDocument,
): HolidayCalendarEntryRecord {
  return {
    holidayCalendarEntryId:
      entry.holidayCalendarEntryId,
    date: entry.date,
    entryType: entry.entryType,
    name: entry.name,
    status: entry.status,
    description: entry.description,
    externalRef: entry.externalRef,
    removedAt: entry.removedAt,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
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
    typeof candidate.holidayCalendarId !== "string" ||
    !candidate.holidayCalendarId.trim()
  ) {
    throw invalidCursorError();
  }

  return {
    queryShapeSignature: expectedQueryShapeSignature,
    createdAt: candidate.createdAt,
    holidayCalendarId:
      candidate.holidayCalendarId.trim(),
  };
}

function buildCursorQueryShapeSignature(
  input: HolidayCalendarListReadInput,
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
