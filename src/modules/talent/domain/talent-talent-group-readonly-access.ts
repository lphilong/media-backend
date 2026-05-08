import { ClientSession } from "mongodb";

export interface TalentTalentGroupReadonlyAccess {
  hasActiveMembershipsForTalent(
    talentId: string,
    session?: ClientSession,
  ): Promise<boolean>;

  hasNonRemovedMembershipsForTalent(
    talentId: string,
    session?: ClientSession,
  ): Promise<boolean>;
}
