import { ClientSession } from "mongodb";

export interface TalentWorkScheduleReadonlyAccess {
  hasLiveScheduledShiftForTalent(
    talentId: string,
    evaluationTime: number,
    session?: ClientSession,
  ): Promise<boolean>;
}
