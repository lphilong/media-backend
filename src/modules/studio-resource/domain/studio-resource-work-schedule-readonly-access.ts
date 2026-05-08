import { ClientSession } from "mongodb";

export interface StudioResourceWorkScheduleReadonlyAccess {
  hasLiveScheduledShiftForStudioResource(
    studioResourceId: string,
    evaluationTime: number,
    session?: ClientSession,
  ): Promise<boolean>;
}
