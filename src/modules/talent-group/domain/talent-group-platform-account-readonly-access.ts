import { ClientSession } from "mongodb";

export interface TalentGroupPlatformAccountReadonlyAccess {
  hasActiveOwnedPlatformAccountsForTalentGroup(
    groupId: string,
    session?: ClientSession,
  ): Promise<boolean>;

  hasNonArchivedOwnedPlatformAccountsForTalentGroup(
    groupId: string,
    session?: ClientSession,
  ): Promise<boolean>;
}
