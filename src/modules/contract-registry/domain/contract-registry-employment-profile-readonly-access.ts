import { ClientSession } from "mongodb";
import { EmploymentStatus } from "@modules/employment-profile/domain/employment-profile.types";

export interface ContractRegistryReferencedEmploymentProfile {
  readonly id: string;
  readonly employmentStatus: EmploymentStatus;
}

export interface ContractRegistryEmploymentProfileReadonlyAccess {
  findById(
    employmentProfileId: string,
    session?: ClientSession,
  ): Promise<ContractRegistryReferencedEmploymentProfile | null>;
}
