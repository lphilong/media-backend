import { EmploymentStatus } from "@modules/employment-profile/domain/employment-profile.types";
import { ReferenceSummary } from "@modules/reference-summary";

export const EMPLOYMENT_TERMS_STATUSES = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "SUPERSEDED",
  "CANCELLED",
] as const;

export type EmploymentTermsStatus =
  (typeof EMPLOYMENT_TERMS_STATUSES)[number];

export const EMPLOYMENT_TERMS_PAY_FREQUENCIES = ["MONTHLY"] as const;

export type EmploymentTermsPayFrequency =
  (typeof EMPLOYMENT_TERMS_PAY_FREQUENCIES)[number];

export const EMPLOYMENT_TERMS_ADMIN_READINESS_FILTERS = [
  "CURRENT_EFFECTIVE",
  "PENDING_APPROVAL",
  "EXPIRED",
  "MISSING_BASE_SALARY",
  "OVERLAPPING",
  "PAYROLL_SOURCE_ELIGIBLE",
  "PAYROLL_SOURCE_INELIGIBLE",
] as const;

export type EmploymentTermsAdminReadinessFilter =
  (typeof EMPLOYMENT_TERMS_ADMIN_READINESS_FILTERS)[number];

export interface EmploymentTermsAllowance {
  readonly type: string;
  readonly label: string;
  readonly amount: number;
  readonly currencyCode: string;
  readonly payrollEligible: boolean;
  readonly effectiveFrom: number | null;
  readonly effectiveTo: number | null;
  readonly sourceNote: string | null;
}

export interface EmploymentTermsRecord {
  readonly id: string;
  readonly termsCode: string;
  readonly employmentProfileId: string;
  readonly status: EmploymentTermsStatus;
  readonly effectiveFrom: number;
  readonly effectiveTo: number | null;
  readonly baseSalaryAmount: number;
  readonly currencyCode: string;
  readonly payFrequency: EmploymentTermsPayFrequency;
  readonly allowances: readonly EmploymentTermsAllowance[];
  readonly payrollEligible: boolean;
  readonly sourceNote: string | null;
  readonly createdBy: string;
  readonly createdAt: number;
  readonly updatedBy: string;
  readonly updatedAt: number;
  readonly submittedBy: string | null;
  readonly submittedAt: number | null;
  readonly approvedBy: string | null;
  readonly approvedAt: number | null;
  readonly cancelledBy: string | null;
  readonly cancelledAt: number | null;
  readonly supersedesTermsId: string | null;
  readonly supersededByTermsId: string | null;
  readonly version: number;
}

export interface EmploymentTermsAllowanceView {
  readonly type: string;
  readonly label: string;
  readonly amount?: number;
  readonly currencyCode: string;
  readonly payrollEligible: boolean;
  readonly effectiveFrom: number | null;
  readonly effectiveTo: number | null;
  readonly sourceNote: string | null;
}

export interface EmploymentTermsView {
  readonly id: string;
  readonly termsCode: string;
  readonly employmentProfileId: string;
  readonly status: EmploymentTermsStatus;
  readonly effectiveFrom: number;
  readonly effectiveTo: number | null;
  readonly baseSalaryAmount?: number;
  readonly currencyCode: string;
  readonly payFrequency: EmploymentTermsPayFrequency;
  readonly allowances: readonly EmploymentTermsAllowanceView[];
  readonly payrollEligible: boolean;
  readonly sourceNote: string | null;
  readonly sensitiveAmountsRedacted: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly submittedAt: number | null;
  readonly approvedAt: number | null;
  readonly cancelledAt: number | null;
  readonly supersedesTermsId: string | null;
  readonly supersededByTermsId: string | null;
  readonly version: number;
}

export interface PayrollReadableEmploymentTerms {
  readonly id: string;
  readonly termsCode: string;
  readonly employmentProfileId: string;
  readonly effectiveFrom: number;
  readonly effectiveTo: number | null;
  readonly baseSalaryAmount: number;
  readonly currencyCode: string;
  readonly payFrequency: EmploymentTermsPayFrequency;
  readonly allowances: readonly EmploymentTermsAllowance[];
  readonly version: number;
  readonly approvedAt: number;
}

export interface EmploymentTermsAdminProfileSummary {
  readonly id: string;
  readonly employeeCode: string;
  readonly displayName: string;
  readonly legalName: string;
  readonly employmentStatus: EmploymentStatus;
  readonly orgUnitId: string;
  readonly orgUnitRef: ReferenceSummary | null;
  readonly linkedUserRef?: ReferenceSummary | null;
}

export interface EmploymentTermsAdminListRecord {
  readonly terms: EmploymentTermsRecord;
  readonly employmentProfile: EmploymentTermsAdminProfileSummary;
}

export type EmploymentTermsOverlapContextRecord = Pick<
  EmploymentTermsRecord,
  | "id"
  | "employmentProfileId"
  | "status"
  | "payrollEligible"
  | "effectiveFrom"
  | "effectiveTo"
>;

export interface EmploymentTermsAdminDerivedFlags {
  readonly isCurrentEffective: boolean;
  readonly isExpired: boolean;
  readonly isPendingApproval: boolean;
  readonly hasMissingBaseSalary: boolean;
  readonly hasOverlapForProfile: boolean;
  readonly payrollSourceEligibility: "ELIGIBLE" | "INELIGIBLE";
}

export interface EmploymentTermsAdminListItemView
  extends EmploymentTermsView,
    EmploymentTermsAdminDerivedFlags {
  readonly employmentProfile: EmploymentTermsAdminProfileSummary;
}
