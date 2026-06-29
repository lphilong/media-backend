import {
  EmploymentContractStatus,
  EmploymentKind,
  EmploymentProfileDetailView,
  EmploymentProfileDirectReportListItemView,
  EmploymentProfileListItemView,
  EmploymentProfileSortDirection,
  EmploymentProfileSortField,
  EmploymentStatus,
} from "@modules/employment-profile/domain/employment-profile.types";

export interface ListEmploymentProfileReadInput {
  readonly employmentStatus?: EmploymentStatus;
  readonly contractStatus?: EmploymentContractStatus;
  readonly employmentKind?: EmploymentKind;
  readonly orgUnitId?: string;
  readonly hasLinkedUser?: boolean;
  readonly limit: number;
  readonly cursor?: string;
  readonly search?: string;
  readonly sortField?: EmploymentProfileSortField;
  readonly sortDirection?: EmploymentProfileSortDirection;
}

export interface ListEmploymentProfileReadResult {
  readonly items: readonly EmploymentProfileListItemView[];
  readonly nextCursor?: string;
}

export interface ListDirectReportsReadInput {
  readonly responsibleEmploymentProfileId: string;
  readonly asOf: number;
  readonly limit: number;
  readonly cursor?: string;
  readonly sortField?: EmploymentProfileSortField;
  readonly sortDirection?: EmploymentProfileSortDirection;
}

export interface ListDirectReportsReadResult {
  readonly items: readonly EmploymentProfileDirectReportListItemView[];
  readonly nextCursor?: string;
}

export interface EmploymentProfileReadRepository {
  listEmploymentProfiles(
    input: ListEmploymentProfileReadInput,
  ): Promise<ListEmploymentProfileReadResult>;

  getEmploymentProfileDetail(
    employmentProfileId: string,
  ): Promise<EmploymentProfileDetailView | null>;

  listDirectReports(
    input: ListDirectReportsReadInput,
  ): Promise<ListDirectReportsReadResult>;
}
