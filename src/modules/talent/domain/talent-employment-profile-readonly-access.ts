import { ClientSession } from "mongodb";
import { EmploymentStatus } from "@modules/employment-profile/domain/employment-profile.types";

export interface TalentReferencedEmploymentProfile {
  readonly id: string;
  readonly employmentStatus: EmploymentStatus;
}

export interface TalentEmploymentProfileReadonlyAccess {
  findById(
    employmentProfileId: string,
    session?: ClientSession,
  ): Promise<TalentReferencedEmploymentProfile | null>;
}
