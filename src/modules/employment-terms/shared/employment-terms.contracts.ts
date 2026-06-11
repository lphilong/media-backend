import {
  EmploymentTermsAllowance,
  EmploymentTermsAdminListItemView,
  EmploymentTermsAdminReadinessFilter,
  EmploymentTermsPayFrequency,
  EmploymentTermsStatus,
  EmploymentTermsView,
  PayrollReadableEmploymentTerms,
} from "../domain/employment-terms.types";
import { EmploymentStatus } from "@modules/employment-profile/domain/employment-profile.types";

export interface CreateEmploymentTermsCommand {
  readonly employmentProfileId: string;
  readonly effectiveFrom: unknown;
  readonly effectiveTo?: unknown;
  readonly baseSalaryAmount: unknown;
  readonly currencyCode: unknown;
  readonly payFrequency: EmploymentTermsPayFrequency | string;
  readonly allowances?: readonly Partial<EmploymentTermsAllowance>[];
  readonly payrollEligible: unknown;
  readonly sourceNote?: unknown;
}

export interface UpdateEmploymentTermsCommand extends Partial<Omit<CreateEmploymentTermsCommand, "employmentProfileId">> {
  readonly employmentProfileId: string;
  readonly termsId: string;
}

export interface EmploymentTermsLifecycleCommand {
  readonly employmentProfileId: string;
  readonly termsId: string;
}

export interface ListEmploymentTermsAdminQuery {
  readonly employmentProfileId?: string;
  readonly orgUnitId?: string;
  readonly employmentStatus?: EmploymentStatus | string;
  readonly status?: EmploymentTermsStatus | string;
  readonly payrollEligible?: boolean | string;
  readonly effectiveOn?: number | string;
  readonly expiringBefore?: number | string;
  readonly readiness?: EmploymentTermsAdminReadinessFilter | string;
  readonly search?: string;
  readonly cursor?: string;
  readonly limit?: number | string;
}

export type EmploymentTermsMutationResult = EmploymentTermsView;
export type EmploymentTermsDetailResult = EmploymentTermsView;
export type EmploymentTermsListResult = readonly EmploymentTermsView[];
export interface EmploymentTermsAdminListResult {
  readonly items: readonly EmploymentTermsAdminListItemView[];
  readonly nextCursor: string | null;
  readonly appliedFilters: {
    readonly employmentProfileId?: string;
    readonly orgUnitId?: string;
    readonly employmentStatus?: EmploymentStatus;
    readonly status?: EmploymentTermsStatus;
    readonly payrollEligible?: boolean;
    readonly effectiveOn: number;
    readonly expiringBefore?: number;
    readonly readiness?: EmploymentTermsAdminReadinessFilter;
    readonly search?: string;
  };
}
export type PayrollReadableEmploymentTermsResult = PayrollReadableEmploymentTerms | null;
