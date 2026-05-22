import { ClientSession } from "mongodb";
import { TalentGroupManagerAssignment } from "./kpi.types";

export interface TalentGroupManagerAssignmentRepository {
  insertAssignment(
    assignment: TalentGroupManagerAssignment,
    session?: ClientSession,
  ): Promise<TalentGroupManagerAssignment>;

  listActiveAssignmentsByGroup(
    groupId: string,
    asOf: number,
    session?: ClientSession,
  ): Promise<readonly TalentGroupManagerAssignment[]>;

  listActiveAssignmentsByManagerEmploymentProfile(
    managerEmploymentProfileId: string,
    asOf: number,
    session?: ClientSession,
  ): Promise<readonly TalentGroupManagerAssignment[]>;
}
