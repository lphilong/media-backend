import { ClientSession } from "mongodb";

export interface TalentGroupWorkScheduleReadonlyAccess {
  hasLiveScheduledShiftForTalentGroup(
    groupId: string,
    evaluationTime: number,
    session?: ClientSession,
  ): Promise<boolean>;
}
