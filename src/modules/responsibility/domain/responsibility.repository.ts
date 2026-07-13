import { ClientSession } from "mongodb";
import { ReferenceSummary } from "@modules/reference-summary";
import {
  ResponsibilityAssignmentRecord,
  ResponsibilityAssignmentView,
  ResponsibilitySubjectType,
  ResponsibilityType,
} from "./responsibility.types";

export interface ResponsibilityAssignmentFilters {
  readonly responsibleEmploymentProfileId?: string;
  readonly subjectType?: ResponsibilitySubjectType;
  readonly subjectId?: string;
  readonly responsibilityType?: ResponsibilityType;
  readonly status?: "ACTIVE" | "INACTIVE" | "REVOKED";
  readonly active?: boolean;
  readonly asOf: number;
  readonly limit?: number;
  readonly authorizedSubjects?: readonly {
    readonly subjectType: ResponsibilitySubjectType;
    readonly subjectId?: string;
  }[];
}

export interface UpdateResponsibilityAssignmentInput {
  readonly assignmentId: string;
  readonly responsibilityRole?: string | null;
  readonly includeDescendants?: boolean | null;
  readonly actionMask?: readonly string[];
  readonly isPrimary?: boolean;
  readonly effectiveAt?: number;
  readonly expiresAt?: number | null;
  readonly reason?: string | null;
  readonly updatedAt: number;
  readonly updatedBy: string;
}

export interface RevokeResponsibilityAssignmentInput {
  readonly assignmentId: string;
  readonly revokedAt: number;
  readonly revokedBy: string;
  readonly revokedReason: string;
}

export interface ResponsibilityAssignmentRepository {
  insert(
    assignment: ResponsibilityAssignmentRecord,
    session?: ClientSession,
  ): Promise<ResponsibilityAssignmentRecord>;

  listNormalized(
    filters: ResponsibilityAssignmentFilters,
    session?: ClientSession,
  ): Promise<readonly ResponsibilityAssignmentView[]>;

  findNormalizedById(
    assignmentId: string,
    session?: ClientSession,
  ): Promise<ResponsibilityAssignmentView | null>;

  listActiveCentralPrimary(
    filters: {
      readonly subjectType: ResponsibilitySubjectType;
      readonly subjectId: string;
      readonly responsibilityType: ResponsibilityType;
      readonly excludeAssignmentId?: string;
      readonly asOf: number;
    },
    session?: ClientSession,
  ): Promise<readonly ResponsibilityAssignmentRecord[]>;

  update(
    input: UpdateResponsibilityAssignmentInput,
    session?: ClientSession,
  ): Promise<ResponsibilityAssignmentRecord | null>;

  revoke(
    input: RevokeResponsibilityAssignmentInput,
    session?: ClientSession,
  ): Promise<ResponsibilityAssignmentRecord | null>;

  listInheritedForTalent(
    talentId: string,
    asOf: number,
    session?: ClientSession,
  ): Promise<readonly ResponsibilityAssignmentView[]>;

  listInheritedForEmploymentProfile(
    employmentProfileId: string,
    asOf: number,
    session?: ClientSession,
  ): Promise<readonly ResponsibilityAssignmentView[]>;

  findSubjectRef(
    subjectType: ResponsibilitySubjectType,
    subjectId: string,
    session?: ClientSession,
  ): Promise<ReferenceSummary | null>;

  findEmploymentProfileRef(
    employmentProfileId: string,
    session?: ClientSession,
  ): Promise<ReferenceSummary | null>;
}
