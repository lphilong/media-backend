import { Db } from "mongodb";
import { NativeMongoWorkShiftReadRepository } from "@infra/mongo/work-schedule/work-schedule.read-repository";
import { NativeMongoWorkPatternReadRepository } from "@infra/mongo/work-schedule/work-pattern.read-repository";
import { NativeMongoWorkPatternRepository } from "@infra/mongo/work-schedule/work-pattern.repository";
import { NativeMongoHolidayCalendarReadRepository } from "@infra/mongo/work-schedule/holiday-calendar.read-repository";
import { NativeMongoHolidayCalendarRepository } from "@infra/mongo/work-schedule/holiday-calendar.repository";
import { NativeMongoMonthlyRosterReadRepository } from "@infra/mongo/work-schedule/monthly-roster.read-repository";
import { NativeMongoMonthlyRosterRepository } from "@infra/mongo/work-schedule/monthly-roster.repository";
import {
  NativeMongoWorkScheduleEmploymentProfileReadonlyAccess,
  NativeMongoWorkScheduleOrgUnitReadonlyAccess,
  NativeMongoWorkScheduleStudioResourceReadonlyAccess,
  NativeMongoWorkScheduleTalentGroupReadonlyAccess,
  NativeMongoWorkScheduleTalentReadonlyAccess,
} from "@infra/mongo/work-schedule/work-schedule.readonly-access";
import { NativeMongoWorkShiftCodeSequenceRepository } from "@infra/mongo/work-schedule/work-schedule-code-sequence.repository";
import { NativeMongoWorkScheduleRequestRepository } from "@infra/mongo/work-schedule/work-schedule-request.repository";
import { NativeMongoWorkScheduleRequestBatchRepository } from "@infra/mongo/work-schedule/work-schedule-request-batch.repository";
import { NativeMongoWorkScheduleAvailabilityBatchRepository } from "@infra/mongo/work-schedule/work-schedule-availability-batch.repository";
import { NativeMongoWorkShiftRepository } from "@infra/mongo/work-schedule/work-schedule.repository";

export interface WorkScheduleInfra {
  readonly workShiftRepository: NativeMongoWorkShiftRepository;
  readonly workShiftCodeSequenceRepository: NativeMongoWorkShiftCodeSequenceRepository;
  readonly workShiftReadRepository: NativeMongoWorkShiftReadRepository;
  readonly workPatternRepository: NativeMongoWorkPatternRepository;
  readonly workPatternReadRepository: NativeMongoWorkPatternReadRepository;
  readonly holidayCalendarRepository: NativeMongoHolidayCalendarRepository;
  readonly holidayCalendarReadRepository: NativeMongoHolidayCalendarReadRepository;
  readonly monthlyRosterRepository: NativeMongoMonthlyRosterRepository;
  readonly monthlyRosterReadRepository: NativeMongoMonthlyRosterReadRepository;
  readonly workScheduleRequestRepository: NativeMongoWorkScheduleRequestRepository;
  readonly workScheduleRequestBatchRepository: NativeMongoWorkScheduleRequestBatchRepository;
  readonly workScheduleAvailabilityBatchRepository: NativeMongoWorkScheduleAvailabilityBatchRepository;
  readonly workScheduleOrgUnitReadonlyAccess: NativeMongoWorkScheduleOrgUnitReadonlyAccess;
  readonly workScheduleEmploymentProfileReadonlyAccess: NativeMongoWorkScheduleEmploymentProfileReadonlyAccess;
  readonly workScheduleTalentReadonlyAccess: NativeMongoWorkScheduleTalentReadonlyAccess;
  readonly workScheduleTalentGroupReadonlyAccess: NativeMongoWorkScheduleTalentGroupReadonlyAccess;
  readonly workScheduleStudioResourceReadonlyAccess: NativeMongoWorkScheduleStudioResourceReadonlyAccess;
}

export function createWorkScheduleInfra(
  db: Db,
): WorkScheduleInfra {
  return {
    workShiftRepository:
      new NativeMongoWorkShiftRepository(db),
    workShiftCodeSequenceRepository:
      new NativeMongoWorkShiftCodeSequenceRepository(
        db,
      ),
    workShiftReadRepository:
      new NativeMongoWorkShiftReadRepository(db),
    workPatternRepository:
      new NativeMongoWorkPatternRepository(db),
    workPatternReadRepository:
      new NativeMongoWorkPatternReadRepository(db),
    holidayCalendarRepository:
      new NativeMongoHolidayCalendarRepository(db),
    holidayCalendarReadRepository:
      new NativeMongoHolidayCalendarReadRepository(db),
    monthlyRosterRepository:
      new NativeMongoMonthlyRosterRepository(db),
    monthlyRosterReadRepository:
      new NativeMongoMonthlyRosterReadRepository(db),
    workScheduleRequestRepository:
      new NativeMongoWorkScheduleRequestRepository(db),
    workScheduleRequestBatchRepository:
      new NativeMongoWorkScheduleRequestBatchRepository(db),
    workScheduleAvailabilityBatchRepository:
      new NativeMongoWorkScheduleAvailabilityBatchRepository(db),
    workScheduleOrgUnitReadonlyAccess:
      new NativeMongoWorkScheduleOrgUnitReadonlyAccess(
        db,
      ),
    workScheduleEmploymentProfileReadonlyAccess:
      new NativeMongoWorkScheduleEmploymentProfileReadonlyAccess(
        db,
      ),
    workScheduleTalentReadonlyAccess:
      new NativeMongoWorkScheduleTalentReadonlyAccess(
        db,
      ),
    workScheduleTalentGroupReadonlyAccess:
      new NativeMongoWorkScheduleTalentGroupReadonlyAccess(
        db,
      ),
    workScheduleStudioResourceReadonlyAccess:
      new NativeMongoWorkScheduleStudioResourceReadonlyAccess(
        db,
      ),
  };
}
