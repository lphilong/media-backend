import { ClientSession } from "mongodb";
import { EmploymentStatus } from "@modules/employment-profile/domain/employment-profile.types";
import { ReferenceSummary } from "@modules/reference-summary";

export interface WorkScheduleReferencedEmploymentProfile {
  readonly id: string;
  readonly employmentStatus: EmploymentStatus;
  readonly orgUnitId: string;
  readonly linkedUserId: string | null;
  readonly ref?: ReferenceSummary;
}

export interface WorkScheduleTalentGroupMemberEmploymentProfileResolution {
  readonly memberId: string;
  readonly groupId: string;
  readonly talentId: string;
  readonly membershipStatus: string;
  readonly talentOperationalStatus: string | null;
  readonly linkedEmploymentProfileId: string | null;
  readonly employmentProfile: WorkScheduleReferencedEmploymentProfile | null;
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

  listIdsByActiveTalentGroupIds(
    groupIds: readonly string[],
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

  listTalentGroupMemberEmploymentProfileResolutions(
    talentGroupId: string,
    session?: ClientSession,
  ): Promise<
    readonly WorkScheduleTalentGroupMemberEmploymentProfileResolution[]
  >;
}
