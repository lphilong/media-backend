import {
  PeopleReadinessCategory,
  PeopleReadinessEntityType,
  PeopleReadinessIssue,
  PeopleReadinessIssueCode,
  PeopleReadinessSeverity,
} from "../domain/people-readiness.types";

export interface ListPeopleReadinessIssuesQuery {
  readonly category?: string;
  readonly issueCode?: string;
  readonly severity?: string;
  readonly entityType?: string;
  readonly cursor?: string;
  readonly limit?: string;
}

export interface PeopleReadinessAppliedFilters {
  readonly category?: PeopleReadinessCategory;
  readonly issueCode?: PeopleReadinessIssueCode;
  readonly severity?: PeopleReadinessSeverity;
  readonly entityType?: PeopleReadinessEntityType;
}

export interface PeopleReadinessSummaryResult {
  readonly totalIssueCount: number;
  readonly countsByCategory: Readonly<Record<string, number>>;
  readonly countsBySeverity: Readonly<Record<string, number>>;
  readonly countsByIssueCode: Readonly<Record<string, number>>;
  readonly generatedAt: number;
  readonly dataCoverage: {
    readonly exactForSupportedIssueCodes: true;
    readonly coverageNotes: readonly string[];
  };
}

export interface PeopleReadinessIssueListResult {
  readonly items: readonly PeopleReadinessIssue[];
  readonly nextCursor: string | null;
  readonly totalCount: number;
  readonly generatedAt: number;
  readonly appliedFilters: PeopleReadinessAppliedFilters;
}
