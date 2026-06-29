import { ReferenceSummary } from "@modules/reference-summary";

export const RESPONSIBILITY_SUBJECT_TYPES = [
  "TALENT_GROUP",
  "ORG_UNIT",
  "TALENT",
  "EMPLOYMENT_PROFILE",
] as const;

export type ResponsibilitySubjectType =
  (typeof RESPONSIBILITY_SUBJECT_TYPES)[number];

export const RESPONSIBILITY_TYPES = [
  "TALENT_GROUP_MANAGER",
  "ORG_UNIT_MANAGER",
  "TALENT_DIRECT_MANAGER",
  "EMPLOYMENT_REPORTING_MANAGER",
] as const;

export type ResponsibilityType = (typeof RESPONSIBILITY_TYPES)[number];

export const RESPONSIBILITY_STATUSES = ["ACTIVE", "INACTIVE", "REVOKED"] as const;

export type ResponsibilityStatus = (typeof RESPONSIBILITY_STATUSES)[number];

export interface ResponsibilityAssignmentRecord {
  readonly id: string;
  readonly subjectType: ResponsibilitySubjectType;
  readonly subjectId: string;
  readonly responsibleEmploymentProfileId: string;
  readonly responsibilityType: ResponsibilityType;
  readonly responsibilityRole: string | null;
  readonly includeDescendants: boolean | null;
  readonly actionMask: readonly string[];
  readonly isPrimary: boolean;
  readonly status: ResponsibilityStatus;
  readonly effectiveAt: number;
  readonly expiresAt: number | null;
  readonly revokedAt: number | null;
  readonly reason: string | null;
  readonly createdBy: string;
  readonly createdAt: number;
  readonly updatedBy: string;
  readonly updatedAt: number;
  readonly revokedBy: string | null;
  readonly revokedReason: string | null;
  readonly reviewNeeded: boolean;
  readonly reviewReason: string | null;
}

export interface ResponsibilityAssignmentView
  extends ResponsibilityAssignmentRecord {
  readonly subjectRef: ReferenceSummary | null;
  readonly responsibleEmploymentProfileRef: ReferenceSummary | null;
}

export interface ResponsibilityAssignmentListQuery {
  readonly responsibleEmploymentProfileId?: string;
  readonly subjectType?: string;
  readonly subjectId?: string;
  readonly responsibilityType?: string;
  readonly status?: string;
  readonly active?: string | boolean;
  readonly limit?: string | number;
}

export interface ResponsibilityAssignmentListResult {
  readonly items: readonly ResponsibilityAssignmentView[];
}

export interface CreateResponsibilityAssignmentCommand {
  readonly subjectType: string;
  readonly subjectId: string;
  readonly responsibleEmploymentProfileId: string;
  readonly responsibilityType: string;
  readonly responsibilityRole?: string | null;
  readonly includeDescendants?: boolean | null;
  readonly actionMask?: readonly string[] | null;
  readonly isPrimary?: boolean;
  readonly effectiveAt?: number | string | null;
  readonly expiresAt?: number | string | null;
  readonly reason?: string | null;
}

export interface UpdateResponsibilityAssignmentCommand {
  readonly assignmentId: string;
  readonly responsibilityRole?: string | null;
  readonly includeDescendants?: boolean | null;
  readonly actionMask?: readonly string[] | null;
  readonly isPrimary?: boolean;
  readonly effectiveAt?: number | string | null;
  readonly expiresAt?: number | string | null;
  readonly reason?: string | null;
}

export interface RevokeResponsibilityAssignmentCommand {
  readonly assignmentId: string;
  readonly reason?: string | null;
}

export interface ResponsibilitySummaryResult {
  readonly items: readonly ResponsibilityAssignmentView[];
  readonly inherited: readonly ResponsibilityAssignmentView[];
}
