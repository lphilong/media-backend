import { ClientSession } from "mongodb";

export interface TalentGroupEventAssignmentReadonlyAccess {
  hasLiveEventBindingForTalentGroup(
    groupId: string,
    evaluationTime: number,
    session?: ClientSession,
  ): Promise<boolean>;
}
