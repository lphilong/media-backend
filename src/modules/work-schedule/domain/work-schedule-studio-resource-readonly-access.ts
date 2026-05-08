import { ClientSession } from "mongodb";
import { StudioResourceOperationalStatus } from "@modules/studio-resource/domain/studio-resource.types";

export interface WorkScheduleReferencedStudioResource {
  readonly id: string;
  readonly operationalStatus: StudioResourceOperationalStatus;
}

export interface WorkScheduleStudioResourceReadonlyAccess {
  findById(
    studioResourceId: string,
    session?: ClientSession,
  ): Promise<WorkScheduleReferencedStudioResource | null>;
}
