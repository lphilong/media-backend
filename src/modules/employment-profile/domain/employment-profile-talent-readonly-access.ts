import { ClientSession } from "mongodb";

export interface EmploymentProfileTalentReadonlyAccess {
  hasNonArchivedTalentsManagedByEmploymentProfile(
    employmentProfileId: string,
    session?: ClientSession,
  ): Promise<boolean>;

  hasNonArchivedInternalTalentLinkedToEmploymentProfile(
    employmentProfileId: string,
    session?: ClientSession,
  ): Promise<boolean>;
}
