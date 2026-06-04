import { ClientSession } from "mongodb";
import {
  OrgUnitManagerAssignment,
  OrgUnitManagerRole,
} from "./kpi.types";

export interface OrgUnitManagerEmploymentProfileCandidate {
  readonly id: string;
  readonly employeeCode: string;
  readonly displayName: string;
  readonly legalName: string;
  readonly jobTitle: string;
  readonly employmentStatus: string;
}

export interface RevokeOrgUnitManagerAssignmentInput {
  readonly assignmentId: string;
  readonly effectiveTo: number;
  readonly updatedAt: number;
  readonly updatedByActorId: string;
}

export interface UpdateOrgUnitManagerAssignmentInput {
  readonly assignmentId: string;
  readonly role?: OrgUnitManagerRole;
  readonly includeDescendants?: boolean;
  readonly effectiveFrom?: number;
  readonly effectiveTo?: number | null;
  readonly isPrimary?: boolean;
  readonly updatedAt: number;
  readonly updatedByActorId: string;
}

export interface OrgUnitManagerAssignmentRepository {
  insertAssignment(
    assignment: OrgUnitManagerAssignment,
    session?: ClientSession,
  ): Promise<OrgUnitManagerAssignment>;

  listAssignmentsByOrgUnitId(
    orgUnitId: string,
    session?: ClientSession,
  ): Promise<readonly OrgUnitManagerAssignment[]>;

  listActiveByManagerEmploymentProfileId(
    managerEmploymentProfileId: string,
    asOf: number,
    session?: ClientSession,
  ): Promise<readonly OrgUnitManagerAssignment[]>;

  listActiveByManagerEmploymentProfileIdAndRole(
    managerEmploymentProfileId: string,
    role: OrgUnitManagerRole,
    asOf: number,
    session?: ClientSession,
  ): Promise<readonly OrgUnitManagerAssignment[]>;

  listActiveByOrgUnitId(
    orgUnitId: string,
    asOf: number,
    session?: ClientSession,
  ): Promise<readonly OrgUnitManagerAssignment[]>;

  findAssignmentById(
    assignmentId: string,
    session?: ClientSession,
  ): Promise<OrgUnitManagerAssignment | null>;

  updateAssignment(
    input: UpdateOrgUnitManagerAssignmentInput,
    session?: ClientSession,
  ): Promise<OrgUnitManagerAssignment | null>;

  revokeAssignment(
    input: RevokeOrgUnitManagerAssignmentInput,
    session?: ClientSession,
  ): Promise<OrgUnitManagerAssignment | null>;

  findManagerEmploymentProfileCandidate(
    employmentProfileId: string,
    session?: ClientSession,
  ): Promise<OrgUnitManagerEmploymentProfileCandidate | null>;
}
