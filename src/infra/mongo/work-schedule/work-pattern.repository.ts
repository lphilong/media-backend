import {
  ClientSession,
  Db,
} from "mongodb";
import { BaseRepository } from "@infra/database/repository/base.repository";
import {
  InsertWorkPatternInput,
  TransitionWorkPatternStatusInput,
  UpdateWorkPatternInput,
  WorkPatternRepository,
} from "@modules/work-schedule/domain/work-schedule.repository";
import {
  WORK_PATTERN_TIMEZONE,
  WorkPatternRecord,
  WorkPatternStatus,
  WorkPatternWeekdayToken,
} from "@modules/work-schedule/domain/work-schedule.types";

interface WorkPatternDocument {
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

export class NativeMongoWorkPatternRepository
  extends BaseRepository<WorkPatternDocument>
  implements WorkPatternRepository
{
  constructor(db: Db) {
    super(db, "work_patterns");
  }

  async insert(
    workPattern: InsertWorkPatternInput,
    session: ClientSession,
  ): Promise<WorkPatternRecord> {
    await this.collection.insertOne(
      toWorkPatternDocument(workPattern),
      this.withSession(session),
    );

    return workPattern;
  }

  async findById(
    workPatternId: string,
    session?: ClientSession,
  ): Promise<WorkPatternRecord | null> {
    const doc = await this.collection.findOne(
      { _id: workPatternId },
      this.withSession(session),
    );

    return doc ? toWorkPatternRecord(doc) : null;
  }

  async findByPatternCode(
    patternCode: string,
    session?: ClientSession,
  ): Promise<WorkPatternRecord | null> {
    const doc = await this.collection.findOne(
      { patternCode },
      this.withSession(session),
    );

    return doc ? toWorkPatternRecord(doc) : null;
  }

  async update(
    input: UpdateWorkPatternInput,
    session: ClientSession,
  ): Promise<WorkPatternRecord | null> {
    const set: Record<string, unknown> = {
      updatedAt: input.updatedAt,
    };

    if (input.name !== undefined) {
      set.name = input.name;
    }

    if (input.normalizedName !== undefined) {
      set.normalizedName = input.normalizedName;
    }

    if (input.startLocalTime !== undefined) {
      set.startLocalTime = input.startLocalTime;
    }

    if (input.endLocalTime !== undefined) {
      set.endLocalTime = input.endLocalTime;
    }

    if (input.workingMinutes !== undefined) {
      set.workingMinutes = input.workingMinutes;
    }

    if (input.breakMinutes !== undefined) {
      set.breakMinutes = input.breakMinutes;
    }

    if (input.workingDays !== undefined) {
      set.workingDays = [...input.workingDays];
    }

    if (input.description !== undefined) {
      set.description = input.description;
    }

    if (input.externalRef !== undefined) {
      set.externalRef = input.externalRef;
    }

    const updated = await this.collection.findOneAndUpdate(
      { _id: input.workPatternId },
      { $set: set },
      {
        ...this.withSession(session),
        returnDocument: "after",
      },
    );

    return updated ? toWorkPatternRecord(updated) : null;
  }

  async transitionStatus(
    input: TransitionWorkPatternStatusInput,
    session: ClientSession,
  ): Promise<WorkPatternRecord | null> {
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
        _id: input.workPatternId,
        status: { $in: [...input.fromStatuses] },
      },
      { $set: set },
      {
        ...this.withSession(session),
        returnDocument: "after",
      },
    );

    return updated ? toWorkPatternRecord(updated) : null;
  }
}

function toWorkPatternDocument(
  record: WorkPatternRecord,
): WorkPatternDocument {
  return {
    _id: record.workPatternId,
    patternCode: record.patternCode,
    normalizedPatternCode:
      record.normalizedPatternCode,
    name: record.name,
    normalizedName: record.normalizedName,
    status: record.status,
    timezone: record.timezone,
    startLocalTime: record.startLocalTime,
    endLocalTime: record.endLocalTime,
    workingMinutes: record.workingMinutes,
    breakMinutes: record.breakMinutes,
    workingDays: [...record.workingDays],
    description: record.description,
    externalRef: record.externalRef,
    activatedAt: record.activatedAt,
    archivedAt: record.archivedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function toWorkPatternRecord(
  document: WorkPatternDocument,
): WorkPatternRecord {
  return {
    workPatternId: document._id,
    patternCode: document.patternCode,
    normalizedPatternCode:
      document.normalizedPatternCode,
    name: document.name,
    normalizedName: document.normalizedName,
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
