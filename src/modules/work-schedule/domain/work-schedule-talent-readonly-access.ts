import { ClientSession } from "mongodb";
import { TalentOperationalStatus } from "@modules/talent/domain/talent.types";

export interface WorkScheduleReferencedTalent {
  readonly id: string;
  readonly operationalStatus: TalentOperationalStatus;
}

export interface WorkScheduleTalentReadonlyAccess {
  findById(
    talentId: string,
    session?: ClientSession,
  ): Promise<WorkScheduleReferencedTalent | null>;
}
