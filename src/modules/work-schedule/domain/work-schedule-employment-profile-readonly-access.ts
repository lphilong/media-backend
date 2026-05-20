import { ClientSession } from "mongodb";
import { EmploymentStatus } from "@modules/employment-profile/domain/employment-profile.types";
import { ReferenceSummary } from "@modules/reference-summary";

export interface WorkScheduleReferencedEmploymentProfile {
  readonly id: string;
  readonly employmentStatus: EmploymentStatus;
  readonly orgUnitId: string;
  readonly managerEmploymentProfileId: string | null;
  readonly linkedUserId: string | null;
  readonly ref?: ReferenceSummary;
}

export interface WorkScheduleEmploymentProfileReadonlyAccess {
  findById(
    employmentProfileId: string,
    session?: ClientSession,
  ): Promise<WorkScheduleReferencedEmploymentProfile | null>;

  findByLinkedUserId(
    linkedUserId: string,
    session?: ClientSession,
  ): Promise<WorkScheduleReferencedEmploymentProfile | null>;

  listIdsByManagerEmploymentProfileId(
    managerEmploymentProfileId: string,
    session?: ClientSession,
  ): Promise<readonly string[]>;

  listIdsByOrgUnitId(
    orgUnitId: string,
    session?: ClientSession,
  ): Promise<readonly string[]>;

  listByOrgUnitId(
    orgUnitId: string,
    session?: ClientSession,
  ): Promise<readonly WorkScheduleReferencedEmploymentProfile[]>;
}
