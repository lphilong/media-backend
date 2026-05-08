import { ClientSession } from "mongodb";
import { StudioResourceOperationalStatus } from "@modules/studio-resource/domain/studio-resource.types";

export interface EventAssignmentReferencedStudioResource {
  readonly id: string;
  readonly operationalStatus: StudioResourceOperationalStatus;
}

export interface EventAssignmentStudioResourceReadonlyAccess {
  findById(
    studioResourceId: string,
    session?: ClientSession,
  ): Promise<EventAssignmentReferencedStudioResource | null>;
}
