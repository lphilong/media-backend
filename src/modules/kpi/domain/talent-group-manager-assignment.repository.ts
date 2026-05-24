import { ClientSession } from "mongodb";
import { ReferenceSummary } from "@modules/reference-summary";
import { TalentGroupManagerAssignment } from "./kpi.types";

export interface TalentGroupManagerEmploymentProfileCandidate {
  readonly id: string;
  readonly employeeCode: string;
  readonly displayName: string;
  readonly legalName: string;
  readonly employmentStatus: string;
  readonly linkedUserId: string | null;
  readonly linkedUserRef: ReferenceSummary | null;
  readonly linkedUserActorKind: string | null;
  readonly linkedUserAccountStatus: string | null;
}

export interface RevokeTalentGroupManagerAssignmentInput {
  readonly assignmentId: string;
  readonly effectiveTo: number;
  readonly updatedAt: number;
  readonly updatedByActorId: string;
}

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

  findAssignmentById(
    assignmentId: string,
    session?: ClientSession,
  ): Promise<TalentGroupManagerAssignment | null>;

  listActiveAssignmentsByManagerEmploymentProfile(
    managerEmploymentProfileId: string,
    asOf: number,
    session?: ClientSession,
  ): Promise<readonly TalentGroupManagerAssignment[]>;

  revokeAssignment(
    input: RevokeTalentGroupManagerAssignmentInput,
    session?: ClientSession,
  ): Promise<TalentGroupManagerAssignment | null>;

  findManagerEmploymentProfileCandidate(
    employmentProfileId: string,
    session?: ClientSession,
  ): Promise<TalentGroupManagerEmploymentProfileCandidate | null>;
}
