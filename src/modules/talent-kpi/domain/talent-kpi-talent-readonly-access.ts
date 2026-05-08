import { ClientSession } from "mongodb";

export interface TalentKpiReferencedTalent {
  readonly id: string;
}

export interface TalentKpiTalentReadonlyAccess {
  findById(
    talentId: string,
    session?: ClientSession,
  ): Promise<TalentKpiReferencedTalent | null>;
}
