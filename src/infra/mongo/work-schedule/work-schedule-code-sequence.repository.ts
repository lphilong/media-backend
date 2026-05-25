import {
  ClientSession,
  Db,
} from "mongodb";
import { BaseRepository } from "@infra/database/repository/base.repository";
import { WorkScheduleCodeSequenceRepository } from "@modules/work-schedule/domain/work-schedule-code-sequence.repository";

type WorkScheduleCodeSequenceModule =
  | "work-shift"
  | "work-pattern"
  | "holiday-calendar"
  | "monthly-roster"
  | "work-schedule-request";

interface WorkShiftCodeSequenceDocument {
  readonly _id: string;
  readonly module: WorkScheduleCodeSequenceModule;
  readonly bucket: string;
  readonly dateBucket?: string;
  readonly value: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export class NativeMongoWorkShiftCodeSequenceRepository
  extends BaseRepository<WorkShiftCodeSequenceDocument>
  implements WorkScheduleCodeSequenceRepository
{
  constructor(db: Db) {
    super(db, "work_shift_code_sequences");
  }

  async allocateNext(
    dateBucket: string,
    session: ClientSession,
  ): Promise<number> {
    return this.allocateNextForBucket(
      "work-shift",
      dateBucket,
      session,
    );
  }

  async allocateNextWorkPatternCode(
    session: ClientSession,
  ): Promise<number> {
    return this.allocateNextForBucket(
      "work-pattern",
      "global",
      session,
    );
  }

  async allocateNextHolidayCalendarCode(
    session: ClientSession,
  ): Promise<number> {
    return this.allocateNextForBucket(
      "holiday-calendar",
      "global",
      session,
    );
  }

  async allocateNextMonthlyRosterCode(
    rosterMonthBucket: string,
    session: ClientSession,
  ): Promise<number> {
    return this.allocateNextForBucket(
      "monthly-roster",
      rosterMonthBucket,
      session,
    );
  }

  async allocateNextWorkScheduleRequestCode(
    requestMonthBucket: string,
    session: ClientSession,
  ): Promise<number> {
    return this.allocateNextForBucket(
      "work-schedule-request",
      requestMonthBucket,
      session,
    );
  }

  private async allocateNextForBucket(
    module: WorkScheduleCodeSequenceModule,
    bucket: string,
    session: ClientSession,
  ): Promise<number> {
    const now = Date.now();
    const document =
      await this.collection.findOneAndUpdate(
        {
          _id: `${module}:${bucket}`,
        },
        {
          $inc: {
            value: 1,
          },
          $set: {
            updatedAt: now,
          },
          $setOnInsert: {
            module,
            bucket,
            dateBucket: bucket,
            createdAt: now,
          },
        },
        {
          ...this.withSession(session),
          upsert: true,
          returnDocument: "after",
        },
      );

    if (!document) {
      throw new Error(
        `Failed to allocate ${module} code sequence`,
      );
    }

    return document.value;
  }
}
