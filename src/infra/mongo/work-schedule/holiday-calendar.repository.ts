import {
  ClientSession,
  Db,
} from "mongodb";
import { BaseRepository } from "@infra/database/repository/base.repository";
import {
  AddHolidayCalendarEntryInput,
  HolidayCalendarRepository,
  InsertHolidayCalendarInput,
  RemoveHolidayCalendarEntryInput,
  TransitionHolidayCalendarStatusInput,
  UpdateHolidayCalendarEntryInput,
  UpdateHolidayCalendarInput,
} from "@modules/work-schedule/domain/work-schedule.repository";
import {
  HOLIDAY_CALENDAR_TIMEZONE,
  HolidayCalendarEntryRecord,
  HolidayCalendarEntryStatus,
  HolidayCalendarEntryType,
  HolidayCalendarRecord,
  HolidayCalendarScopeType,
  HolidayCalendarStatus,
} from "@modules/work-schedule/domain/work-schedule.types";

interface HolidayCalendarEntryDocument {
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

interface HolidayCalendarDocument {
  readonly _id: string;
  readonly calendarCode: string;
  readonly normalizedCalendarCode: string;
  readonly name: string;
  readonly normalizedName: string;
  readonly scopeType: HolidayCalendarScopeType;
  readonly timezone: typeof HOLIDAY_CALENDAR_TIMEZONE;
  readonly status: HolidayCalendarStatus;
  readonly entries: readonly HolidayCalendarEntryDocument[];
  readonly description: string | null;
  readonly externalRef: string | null;
  readonly activatedAt: number | null;
  readonly archivedAt: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export class NativeMongoHolidayCalendarRepository
  extends BaseRepository<HolidayCalendarDocument>
  implements HolidayCalendarRepository
{
  constructor(db: Db) {
    super(db, "work_holiday_calendars");
  }

  async insert(
    holidayCalendar: InsertHolidayCalendarInput,
    session: ClientSession,
  ): Promise<HolidayCalendarRecord> {
    await this.collection.insertOne(
      toHolidayCalendarDocument(holidayCalendar),
      this.withSession(session),
    );

    return holidayCalendar;
  }

  async findById(
    holidayCalendarId: string,
    session?: ClientSession,
  ): Promise<HolidayCalendarRecord | null> {
    const doc = await this.collection.findOne(
      { _id: holidayCalendarId },
      this.withSession(session),
    );

    return doc ? toHolidayCalendarRecord(doc) : null;
  }

  async findByCalendarCode(
    calendarCode: string,
    session?: ClientSession,
  ): Promise<HolidayCalendarRecord | null> {
    const doc = await this.collection.findOne(
      { calendarCode },
      this.withSession(session),
    );

    return doc ? toHolidayCalendarRecord(doc) : null;
  }

  async update(
    input: UpdateHolidayCalendarInput,
    session: ClientSession,
  ): Promise<HolidayCalendarRecord | null> {
    const set: Record<string, unknown> = {
      updatedAt: input.updatedAt,
    };

    if (input.name !== undefined) {
      set.name = input.name;
    }

    if (input.normalizedName !== undefined) {
      set.normalizedName = input.normalizedName;
    }

    if (input.description !== undefined) {
      set.description = input.description;
    }

    if (input.externalRef !== undefined) {
      set.externalRef = input.externalRef;
    }

    const updated = await this.collection.findOneAndUpdate(
      {
        _id: input.holidayCalendarId,
        status: {
          $ne: "ARCHIVED",
        },
      },
      { $set: set },
      {
        ...this.withSession(session),
        returnDocument: "after",
      },
    );

    return updated ? toHolidayCalendarRecord(updated) : null;
  }

  async transitionStatus(
    input: TransitionHolidayCalendarStatusInput,
    session: ClientSession,
  ): Promise<HolidayCalendarRecord | null> {
    const set: Record<string, unknown> = {
      status: input.toStatus,
      updatedAt: input.updatedAt,
    };

    if (input.activatedAt !== undefined) {
      set.activatedAt = input.activatedAt;
    }

    if (input.archivedAt !== undefined) {
      set.archivedAt = input.archivedAt;
    }

    const updated = await this.collection.findOneAndUpdate(
      {
        _id: input.holidayCalendarId,
        status: { $in: [...input.fromStatuses] },
      },
      { $set: set },
      {
        ...this.withSession(session),
        returnDocument: "after",
      },
    );

    return updated ? toHolidayCalendarRecord(updated) : null;
  }

  async addEntry(
    input: AddHolidayCalendarEntryInput,
    session: ClientSession,
  ): Promise<HolidayCalendarRecord | null> {
    const updated = await this.collection.findOneAndUpdate(
      {
        _id: input.holidayCalendarId,
        status: {
          $ne: "ARCHIVED",
        },
        entries: {
          $not: {
            $elemMatch: {
              date: input.entry.date,
              status: "ACTIVE",
            },
          },
        },
      },
      {
        $push: {
          entries: toHolidayCalendarEntryDocument(
            input.entry,
          ),
        },
        $set: {
          updatedAt: input.updatedAt,
        },
      },
      {
        ...this.withSession(session),
        returnDocument: "after",
      },
    );

    return updated ? toHolidayCalendarRecord(updated) : null;
  }

  async updateEntry(
    input: UpdateHolidayCalendarEntryInput,
    session: ClientSession,
  ): Promise<HolidayCalendarRecord | null> {
    const set: Record<string, unknown> = {
      updatedAt: input.updatedAt,
      "entries.$[entry].updatedAt": input.updatedAt,
    };

    if (input.date !== undefined) {
      set["entries.$[entry].date"] = input.date;
    }

    if (input.entryType !== undefined) {
      set["entries.$[entry].entryType"] =
        input.entryType;
    }

    if (input.name !== undefined) {
      set["entries.$[entry].name"] = input.name;
    }

    if (input.description !== undefined) {
      set["entries.$[entry].description"] =
        input.description;
    }

    if (input.externalRef !== undefined) {
      set["entries.$[entry].externalRef"] =
        input.externalRef;
    }

    const filters: Array<Record<string, unknown>> = [
      {
        _id: input.holidayCalendarId,
        status: {
          $ne: "ARCHIVED",
        },
      },
      {
        entries: {
          $elemMatch: {
            holidayCalendarEntryId:
              input.holidayCalendarEntryId,
            status: "ACTIVE",
          },
        },
      },
    ];

    if (input.date !== undefined) {
      filters.push({
        entries: {
          $not: {
            $elemMatch: {
              date: input.date,
              status: "ACTIVE",
              holidayCalendarEntryId: {
                $ne: input.holidayCalendarEntryId,
              },
            },
          },
        },
      });
    }

    const updated = await this.collection.findOneAndUpdate(
      {
        $and: filters,
      },
      { $set: set },
      {
        ...this.withSession(session),
        arrayFilters: [
          {
            "entry.holidayCalendarEntryId":
              input.holidayCalendarEntryId,
            "entry.status": "ACTIVE",
          },
        ],
        returnDocument: "after",
      },
    );

    return updated ? toHolidayCalendarRecord(updated) : null;
  }

  async removeEntry(
    input: RemoveHolidayCalendarEntryInput,
    session: ClientSession,
  ): Promise<HolidayCalendarRecord | null> {
    const updated = await this.collection.findOneAndUpdate(
      {
        _id: input.holidayCalendarId,
        status: {
          $ne: "ARCHIVED",
        },
        entries: {
          $elemMatch: {
            holidayCalendarEntryId:
              input.holidayCalendarEntryId,
            status: "ACTIVE",
          },
        },
      },
      {
        $set: {
          updatedAt: input.updatedAt,
          "entries.$[entry].status": "REMOVED",
          "entries.$[entry].removedAt": input.removedAt,
          "entries.$[entry].updatedAt": input.updatedAt,
        },
      },
      {
        ...this.withSession(session),
        arrayFilters: [
          {
            "entry.holidayCalendarEntryId":
              input.holidayCalendarEntryId,
            "entry.status": "ACTIVE",
          },
        ],
        returnDocument: "after",
      },
    );

    return updated ? toHolidayCalendarRecord(updated) : null;
  }
}

function toHolidayCalendarDocument(
  record: HolidayCalendarRecord,
): HolidayCalendarDocument {
  return {
    _id: record.holidayCalendarId,
    calendarCode: record.calendarCode,
    normalizedCalendarCode:
      record.normalizedCalendarCode,
    name: record.name,
    normalizedName: record.normalizedName,
    scopeType: record.scopeType,
    timezone: record.timezone,
    status: record.status,
    entries: record.entries.map(
      toHolidayCalendarEntryDocument,
    ),
    description: record.description,
    externalRef: record.externalRef,
    activatedAt: record.activatedAt,
    archivedAt: record.archivedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function toHolidayCalendarEntryDocument(
  record: HolidayCalendarEntryRecord,
): HolidayCalendarEntryDocument {
  return {
    holidayCalendarEntryId:
      record.holidayCalendarEntryId,
    date: record.date,
    entryType: record.entryType,
    name: record.name,
    status: record.status,
    description: record.description,
    externalRef: record.externalRef,
    removedAt: record.removedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function toHolidayCalendarRecord(
  document: HolidayCalendarDocument,
): HolidayCalendarRecord {
  return {
    holidayCalendarId: document._id,
    calendarCode: document.calendarCode,
    normalizedCalendarCode:
      document.normalizedCalendarCode,
    name: document.name,
    normalizedName: document.normalizedName,
    scopeType: document.scopeType,
    timezone: document.timezone,
    status: document.status,
    entries: document.entries.map((entry) => ({
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
    })),
    description: document.description,
    externalRef: document.externalRef,
    activatedAt: document.activatedAt,
    archivedAt: document.archivedAt,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}
