import { ClientSession } from "mongodb";
import { TalentOperationalStatus } from "@modules/talent/domain/talent.types";

export interface PlatformAccountReferencedTalent {
  readonly id: string;
  readonly operationalStatus: TalentOperationalStatus;
}

export interface PlatformAccountTalentReadonlyAccess {
  findById(
    talentId: string,
    session?: ClientSession,
  ): Promise<PlatformAccountReferencedTalent | null>;
}
