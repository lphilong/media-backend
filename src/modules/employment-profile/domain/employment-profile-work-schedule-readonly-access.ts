import { ClientSession } from "mongodb";

export interface EmploymentProfileWorkScheduleReadonlyAccess {
  hasLiveScheduledShiftForEmploymentProfile(
    employmentProfileId: string,
    evaluationTime: number,
    session?: ClientSession,
  ): Promise<boolean>;
}
