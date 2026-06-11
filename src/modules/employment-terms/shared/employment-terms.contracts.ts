import {
  EmploymentTermsAllowance,
  EmploymentTermsPayFrequency,
  EmploymentTermsView,
  PayrollReadableEmploymentTerms,
} from "../domain/employment-terms.types";

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

export type EmploymentTermsMutationResult = EmploymentTermsView;
export type EmploymentTermsDetailResult = EmploymentTermsView;
export type EmploymentTermsListResult = readonly EmploymentTermsView[];
export type PayrollReadableEmploymentTermsResult = PayrollReadableEmploymentTerms | null;
