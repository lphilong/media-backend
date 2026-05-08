import { ClientSession } from "mongodb";
import { EmploymentStatus } from "@modules/employment-profile/domain/employment-profile.types";

export interface CommissionReferencedEmploymentProfile {
  readonly id: string;
  readonly employmentStatus: EmploymentStatus;
}

export interface CommissionEmploymentProfileReadonlyAccess {
  findById(
    employmentProfileId: string,
    session?: ClientSession,
  ): Promise<CommissionReferencedEmploymentProfile | null>;
}
