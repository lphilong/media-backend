import { ClientSession } from "mongodb";
import { EmploymentStatus } from "@modules/employment-profile/domain/employment-profile.types";

export interface EventAssignmentReferencedEmploymentProfile {
  readonly id: string;
  readonly employmentStatus: EmploymentStatus;
}

export interface EventAssignmentEmploymentProfileReadonlyAccess {
  findById(
    employmentProfileId: string,
    session?: ClientSession,
  ): Promise<EventAssignmentReferencedEmploymentProfile | null>;
}
