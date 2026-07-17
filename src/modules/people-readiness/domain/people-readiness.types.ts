import { AccountContext } from "@modules/account-context/domain/account-context.types";

export const PEOPLE_READINESS_OPERATIONAL_EMPLOYMENT_STATUSES = Object.freeze([
  "ACTIVE",
  "ON_LEAVE",
] as const);

export function isPeopleReadinessEmploymentStatusOperational(status: string): boolean {
  return (PEOPLE_READINESS_OPERATIONAL_EMPLOYMENT_STATUSES as readonly string[]).includes(status);
}

export const PEOPLE_READINESS_CATEGORIES = [
  "ACCOUNT_LOGIN_READY",
  "EMPLOYMENT_PROFILE_LIFECYCLE",
  "ORGUNIT_PARTICIPATION",
  "TALENTGROUP_MEMBER_LINKAGE",
  "RESPONSIBILITY_READY",
  "SELF_SERVICE_READY",
  "WORKSCHEDULE_READY",
  "KPI_READY",
  "EMPLOYMENT_TERMS_READY",
] as const;

export type PeopleReadinessCategory =
  (typeof PEOPLE_READINESS_CATEGORIES)[number];

export const PEOPLE_READINESS_SEVERITIES = [
  "BLOCKER",
  "WARNING",
  "INFO",
] as const;

export type PeopleReadinessSeverity =
  (typeof PEOPLE_READINESS_SEVERITIES)[number];

export const PEOPLE_READINESS_ISSUE_CODES = [
  "ACTIVE_USER_WITHOUT_EMPLOYMENT_PROFILE",
  "EMPLOYMENT_PROFILE_REQUIRES_LOGIN_BUT_MISSING_ACTIVE_USER",
  "EMPLOYMENT_PROFILE_LINKED_USER_INACTIVE",
  "EMPLOYMENT_PROFILE_NOT_ACTIVE_FOR_OPERATIONS",
  "EMPLOYMENT_PROFILE_MISSING_ORG_UNIT",
  "EMPLOYMENT_PROFILE_IN_INACTIVE_ORG_UNIT",
  "INTERNAL_TALENT_MISSING_EMPLOYMENT_PROFILE",
  "INTERNAL_TALENT_LINKED_PROFILE_NOT_ACTIVE",
  "EXTERNAL_TALENT_HAS_EMPLOYMENT_PROFILE_LINK",
  "TALENTGROUP_ACTIVE_MEMBER_MISSING_EMPLOYMENT_PROFILE",
  "TALENTGROUP_ACTIVE_MEMBER_LINKED_PROFILE_NOT_ACTIVE",
  "TALENTGROUP_ACTIVE_MEMBER_TALENT_NOT_ACTIVE",
  "TALENTGROUP_HAS_NO_OPERATIONAL_MEMBERS",
  "ORGUNIT_HAS_NO_ACTIVE_EMPLOYMENT_PROFILES",
  "ORGUNIT_RESPONSIBILITY_MANAGER_NOT_PROFILE_READY",
  "ORGUNIT_RESPONSIBILITY_MANAGER_NOT_LOGIN_READY",
  "TALENTGROUP_RESPONSIBILITY_MANAGER_NOT_PROFILE_READY",
  "TALENTGROUP_RESPONSIBILITY_MANAGER_NOT_LOGIN_READY",
  "SELF_SERVICE_PROFILE_NOT_ACTIVE",
  "ACTIVE_PROFILE_MISSING_EMPLOYMENT_TERMS",
  "EMPLOYMENT_TERMS_PENDING_APPROVAL",
  "EMPLOYMENT_TERMS_EXPIRED",
  "EMPLOYMENT_TERMS_MISSING_BASE_SALARY",
  "EMPLOYMENT_TERMS_OVERLAP",
] as const;

export type PeopleReadinessIssueCode =
  (typeof PEOPLE_READINESS_ISSUE_CODES)[number];

export type PeopleReadinessEntityType =
  | "USER"
  | "EMPLOYMENT_PROFILE"
  | "TALENT"
  | "ORG_UNIT"
  | "TALENT_GROUP"
  | "TALENT_GROUP_MEMBER"
  | "ORG_UNIT_RESPONSIBILITY"
  | "TALENT_GROUP_RESPONSIBILITY";

export interface PeopleReadinessSafeEntitySummary {
  readonly entityType: PeopleReadinessEntityType;
  readonly id: string;
  readonly displayName: string;
  readonly code?: string;
  readonly status?: string;
  readonly lifecycleStatus?: string;
  readonly adminRepairTarget?: string;
}

export interface PeopleReadinessRepairTarget {
  readonly targetType: PeopleReadinessEntityType;
  readonly targetId: string;
  readonly suggestedSurface: string;
  readonly suggestedAction?: string;
}

export interface PeopleReadinessIssue {
  readonly id: string;
  readonly issueCode: PeopleReadinessIssueCode;
  readonly category: PeopleReadinessCategory;
  readonly severity: PeopleReadinessSeverity;
  readonly primaryEntityType: PeopleReadinessEntityType;
  readonly primaryEntity: PeopleReadinessSafeEntitySummary;
  readonly relatedEntities: readonly PeopleReadinessSafeEntitySummary[];
  readonly summary: string;
  readonly repairTarget: PeopleReadinessRepairTarget;
  readonly generatedAt: number;
  readonly isBlockingForNewOperations: boolean;
  readonly metadata?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface PeopleReadinessUser {
  readonly id: string;
  readonly displayName: string;
  readonly accountStatus: string;
  readonly actorKind: string;
  readonly accountContexts: readonly AccountContext[];
}

export interface PeopleReadinessEmploymentProfile {
  readonly id: string;
  readonly employeeCode: string;
  readonly displayName: string;
  readonly orgUnitId: string | null;
  readonly linkedUserId: string | null;
  readonly employmentStatus: string;
}

export interface PeopleReadinessTalent {
  readonly id: string;
  readonly talentCode: string;
  readonly displayName: string;
  readonly talentOrigin: string;
  readonly operationalStatus: string;
  readonly linkedEmploymentProfileId: string | null;
}

export interface PeopleReadinessOrgUnit {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly type: string;
  readonly status: string;
}

export interface PeopleReadinessTalentGroup {
  readonly id: string;
  readonly groupCode: string;
  readonly name: string;
  readonly status: string;
}

export interface PeopleReadinessTalentGroupMember {
  readonly id: string;
  readonly groupId: string;
  readonly talentId: string;
  readonly membershipStatus: string;
}

export interface PeopleReadinessResponsibilityAssignment {
  readonly id: string;
  readonly targetId: string;
  readonly responsibleEmploymentProfileId: string;
  readonly responsibilityRole: string;
  readonly status: string;
  readonly effectiveAt: number;
  readonly expiresAt: number | null;
}

export interface PeopleReadinessSnapshot {
  readonly users: readonly PeopleReadinessUser[];
  readonly employmentProfiles: readonly PeopleReadinessEmploymentProfile[];
  readonly talents: readonly PeopleReadinessTalent[];
  readonly orgUnits: readonly PeopleReadinessOrgUnit[];
  readonly talentGroups: readonly PeopleReadinessTalentGroup[];
  readonly talentGroupMembers: readonly PeopleReadinessTalentGroupMember[];
  readonly orgUnitResponsibilities: readonly PeopleReadinessResponsibilityAssignment[];
  readonly talentGroupResponsibilities: readonly PeopleReadinessResponsibilityAssignment[];
}
