import { ReferenceSummary } from "@modules/reference-summary";

export const EMPLOYMENT_KINDS = [
  "EMPLOYEE",
  "CONTRACTOR",
  "PART_TIME",
  "INTERN",
] as const;

export type EmploymentKind =
  (typeof EMPLOYMENT_KINDS)[number];

export const EMPLOYMENT_STATUSES = [
  "ACTIVE",
  "ON_LEAVE",
  "SUSPENDED",
  "TERMINATED",
  "ARCHIVED",
] as const;

export type EmploymentStatus =
  (typeof EMPLOYMENT_STATUSES)[number];

export const EMPLOYMENT_CONTRACT_STATUSES = [
  "NONE",
  "PENDING_SIGNATURE",
  "ACTIVE",
  "EXPIRED",
  "TERMINATED",
] as const;

export type EmploymentContractStatus =
  (typeof EMPLOYMENT_CONTRACT_STATUSES)[number];

export const EMPLOYMENT_PROFILE_SORT_FIELDS = [
  "employeeCode",
  "displayName",
  "legalName",
  "createdAt",
] as const;

export type EmploymentProfileSortField =
  (typeof EMPLOYMENT_PROFILE_SORT_FIELDS)[number];

export const EMPLOYMENT_PROFILE_SORT_DIRECTIONS = [
  "ASC",
  "DESC",
] as const;

export type EmploymentProfileSortDirection =
  (typeof EMPLOYMENT_PROFILE_SORT_DIRECTIONS)[number];

export interface EmploymentProfileRecord {
  readonly id: string;
  readonly employeeCode: string;
  readonly legalName: string;
  readonly normalizedLegalName: string;
  readonly displayName: string;
  readonly normalizedDisplayName: string;
  readonly employmentKind: EmploymentKind;
  readonly jobTitle: string;
  readonly titleDescription: string | null;
  readonly externalRef: string | null;
  readonly orgUnitId: string;
  readonly orgUnitRef?: ReferenceSummary | null;
  readonly managerEmploymentProfileId: string | null;
  readonly managerEmploymentProfileRef?: ReferenceSummary | null;
  readonly linkedUserId: string | null;
  readonly linkedUserRef?: ReferenceSummary | null;
  readonly employmentStatus: EmploymentStatus;
  readonly contractStatus: EmploymentContractStatus;
  readonly employmentStartDate: number;
  readonly employmentEndDate: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface EmploymentProfileListItemView {
  readonly id: string;
  readonly employeeCode: string;
  readonly displayName: string;
  readonly legalName: string;
  readonly employmentKind: EmploymentKind;
  readonly jobTitle: string;
  readonly orgUnitId: string;
  readonly orgUnitRef?: ReferenceSummary | null;
  readonly managerEmploymentProfileId: string | null;
  readonly managerEmploymentProfileRef?: ReferenceSummary | null;
  readonly linkedUserId: string | null;
  readonly linkedUserRef?: ReferenceSummary | null;
  readonly employmentStatus: EmploymentStatus;
  readonly contractStatus: EmploymentContractStatus;
  readonly createdAt: number;
}

export interface EmploymentProfileDirectReportListItemView {
  readonly id: string;
  readonly employeeCode: string;
  readonly displayName: string;
  readonly employmentStatus: EmploymentStatus;
  readonly contractStatus: EmploymentContractStatus;
  readonly orgUnitId: string;
  readonly orgUnitRef?: ReferenceSummary | null;
  readonly managerEmploymentProfileId: string | null;
  readonly managerEmploymentProfileRef?: ReferenceSummary | null;
}

export interface EmploymentProfileOrgUnitListItemView {
  readonly id: string;
  readonly employeeCode: string;
  readonly displayName: string;
  readonly employmentStatus: EmploymentStatus;
  readonly contractStatus: EmploymentContractStatus;
  readonly orgUnitId: string;
  readonly orgUnitRef?: ReferenceSummary | null;
  readonly managerEmploymentProfileId: string | null;
  readonly managerEmploymentProfileRef?: ReferenceSummary | null;
}

export interface EmploymentProfileDetailView {
  readonly id: string;
  readonly employeeCode: string;
  readonly legalName: string;
  readonly displayName: string;
  readonly employmentKind: EmploymentKind;
  readonly jobTitle: string;
  readonly titleDescription: string | null;
  readonly externalRef: string | null;
  readonly orgUnitId: string;
  readonly orgUnitRef?: ReferenceSummary | null;
  readonly managerEmploymentProfileId: string | null;
  readonly managerEmploymentProfileRef?: ReferenceSummary | null;
  readonly linkedUserId: string | null;
  readonly linkedUserRef?: ReferenceSummary | null;
  readonly employmentStatus: EmploymentStatus;
  readonly contractStatus: EmploymentContractStatus;
  readonly employmentStartDate: number;
  readonly employmentEndDate: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface EmploymentProfileMutationView
  extends EmploymentProfileDetailView {}
