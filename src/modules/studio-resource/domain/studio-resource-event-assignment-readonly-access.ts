import { ClientSession } from "mongodb";

export interface StudioResourceEventAssignmentReadonlyAccess {
  hasLiveEventAllocationForStudioResource(
    studioResourceId: string,
    evaluationTime: number,
    session?: ClientSession,
  ): Promise<boolean>;
}
