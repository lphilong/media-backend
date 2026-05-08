import { ClientSession } from "mongodb";

export interface TalentEventAssignmentReadonlyAccess {
  hasLiveEventBindingForTalent(
    talentId: string,
    evaluationTime: number,
    session?: ClientSession,
  ): Promise<boolean>;
}
