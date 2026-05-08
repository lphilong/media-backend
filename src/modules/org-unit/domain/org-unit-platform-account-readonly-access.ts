import { ClientSession } from "mongodb";

export interface OrgUnitPlatformAccountReadonlyAccess {
  hasActiveOwnedPlatformAccountsForOrgUnit(
    orgUnitId: string,
    session?: ClientSession,
  ): Promise<boolean>;

  hasNonArchivedOwnedPlatformAccountsForOrgUnit(
    orgUnitId: string,
    session?: ClientSession,
  ): Promise<boolean>;
}
