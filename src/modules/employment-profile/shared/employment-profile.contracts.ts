import {
  EmploymentContractStatus,
  EmploymentKind,
  EmploymentProfileDetailView,
  EmploymentProfileDirectReportListItemView,
  EmploymentProfileListItemView,
  EmploymentProfileMutationView,
  EmploymentProfileSortDirection,
  EmploymentProfileSortField,
  EmploymentStatus,
} from "@modules/employment-profile/domain/employment-profile.types";

export interface CreateEmploymentProfileCommand {
  readonly employeeCode?: string | null;
  readonly legalName: string;
  readonly displayName: string;
  readonly employmentKind: EmploymentKind;
  readonly jobTitle: string;
  readonly orgUnitId: string;
  readonly managerEmploymentProfileId?: string | null;
  readonly linkedUserId?: string | null;
  readonly contractStatus: EmploymentContractStatus;
  readonly employmentStartDate: number | string;
  readonly externalRef?: string | null;
  readonly titleDescription?: string | null;
}

export interface UpdateEmploymentProfileCoreCommand {
  readonly employmentProfileId: string;
  readonly legalName?: string;
  readonly displayName?: string;
  readonly employmentKind?: EmploymentKind;
  readonly jobTitle?: string;
  readonly externalRef?: string | null;
  readonly titleDescription?: string | null;
}

export interface AssignEmploymentProfileOrgUnitCommand {
  readonly employmentProfileId: string;
  readonly newOrgUnitId: string;
}

export interface AssignEmploymentProfileManagerCommand {
  readonly employmentProfileId: string;
  readonly newManagerEmploymentProfileId: string | null;
}

export interface LinkEmploymentProfileUserCommand {
  readonly employmentProfileId: string;
  readonly linkedUserId: string;
}

export interface UnlinkEmploymentProfileUserCommand {
  readonly employmentProfileId: string;
}

export interface PlaceEmploymentProfileOnLeaveCommand {
  readonly employmentProfileId: string;
}

export interface ReturnEmploymentProfileFromLeaveCommand {
  readonly employmentProfileId: string;
}

export interface SuspendEmploymentProfileCommand {
  readonly employmentProfileId: string;
}

export interface ReactivateEmploymentProfileCommand {
  readonly employmentProfileId: string;
}

export interface TerminateEmploymentProfileCommand {
  readonly employmentProfileId: string;
  readonly employmentEndDate: number | string;
}

export interface ArchiveEmploymentProfileCommand {
  readonly employmentProfileId: string;
}

export interface UpdateEmploymentProfileContractStatusCommand {
  readonly employmentProfileId: string;
  readonly newContractStatus: EmploymentContractStatus;
}

export interface GetEmploymentProfileDetailQuery {
  readonly employmentProfileId: string;
}

export interface ListEmploymentProfilesQuery {
  readonly employmentStatus?: EmploymentStatus | string;
  readonly contractStatus?: EmploymentContractStatus | string;
  readonly employmentKind?: EmploymentKind | string;
  readonly orgUnitId?: string;
  readonly managerEmploymentProfileId?: string;
  readonly hasLinkedUser?: boolean | string;
  readonly limit?: number | string;
  readonly cursor?: string;
  readonly search?: string;
  readonly sortBy?: EmploymentProfileSortField | string;
  readonly sortDirection?: EmploymentProfileSortDirection | string;
}

export interface ListEmploymentProfileDirectReportsQuery {
  readonly employmentProfileId: string;
  readonly limit?: number | string;
  readonly cursor?: string;
  readonly sortBy?: EmploymentProfileSortField | string;
  readonly sortDirection?: EmploymentProfileSortDirection | string;
}

export type EmploymentProfileMutationResult =
  EmploymentProfileMutationView;

export type GetEmploymentProfileDetailResult =
  EmploymentProfileDetailView;

export interface ListEmploymentProfilesResult {
  readonly items: readonly EmploymentProfileListItemView[];
  readonly nextCursor?: string;
}

export interface ListEmploymentProfileDirectReportsResult {
  readonly items: readonly EmploymentProfileDirectReportListItemView[];
  readonly nextCursor?: string;
}
