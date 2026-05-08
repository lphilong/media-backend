import { ClientSession } from "mongodb";

export interface PlatformAccountEventAssignmentReadonlyAccess {
  hasLiveEventAllocationForPlatformAccount(
    platformAccountId: string,
    evaluationTime: number,
    session?: ClientSession,
  ): Promise<boolean>;
}
