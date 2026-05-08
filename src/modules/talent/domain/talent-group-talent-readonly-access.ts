import { ClientSession } from "mongodb";
import { TalentOperationalStatus } from "./talent.types";

export interface TalentGroupReferencedTalent {
  readonly id: string;
  readonly operationalStatus: TalentOperationalStatus;
}

export interface TalentGroupTalentReadonlyAccess {
  findById(
    talentId: string,
    session?: ClientSession,
  ): Promise<TalentGroupReferencedTalent | null>;
}
