import { ClientSession } from "mongodb";

export interface OrgUnitEmploymentReadonlyAccess {
  hasNonArchivedProfilesAssignedToOrgUnit(
    orgUnitId: string,
    session?: ClientSession,
  ): Promise<boolean>;
}
