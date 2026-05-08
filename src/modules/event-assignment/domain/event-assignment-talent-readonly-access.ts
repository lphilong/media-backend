import { ClientSession } from "mongodb";
import { TalentOperationalStatus } from "@modules/talent/domain/talent.types";

export interface EventAssignmentReferencedTalent {
  readonly id: string;
  readonly operationalStatus: TalentOperationalStatus;
}

export interface EventAssignmentTalentReadonlyAccess {
  findById(
    talentId: string,
    session?: ClientSession,
  ): Promise<EventAssignmentReferencedTalent | null>;
}
