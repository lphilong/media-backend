import { ClientSession } from "mongodb";

export interface TalentPlatformAccountReadonlyAccess {
  hasActiveOwnedPlatformAccountsForTalent(
    talentId: string,
    session?: ClientSession,
  ): Promise<boolean>;

  hasNonArchivedOwnedPlatformAccountsForTalent(
    talentId: string,
    session?: ClientSession,
  ): Promise<boolean>;
}
