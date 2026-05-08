import { ClientSession } from "mongodb";

export interface WorkShiftCodeSequenceRepository {
  allocateNext(
    dateBucket: string,
    session: ClientSession,
  ): Promise<number>;
}

export interface WorkScheduleCodeSequenceRepository
  extends WorkShiftCodeSequenceRepository {
  allocateNextWorkPatternCode(
    session: ClientSession,
  ): Promise<number>;

  allocateNextHolidayCalendarCode(
    session: ClientSession,
  ): Promise<number>;

  allocateNextMonthlyRosterCode(
    rosterMonthBucket: string,
    session: ClientSession,
  ): Promise<number>;
}
