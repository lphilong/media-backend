import {
  EMPLOYMENT_TERMS_PAY_FREQUENCIES,
  EmploymentTermsAllowance,
  EmploymentTermsRecord,
} from "./employment-terms.types";

const MAX_SOURCE_NOTE_LENGTH = 500;
const MAX_ALLOWANCE_TYPE_LENGTH = 64;
const MAX_ALLOWANCE_LABEL_LENGTH = 120;
const BUSINESS_TIME_ZONE = "Asia/Ho_Chi_Minh";

export interface EmploymentTermsReadinessFacts {
  readonly hasOnlyNonPayrollEligibleTerms: boolean;
  readonly hasPendingApproval: boolean;
  readonly hasCurrentValidSource: boolean;
  readonly hasExpiredApprovedSource: boolean;
  readonly hasCurrentCandidateMissingBaseSalary: boolean;
  readonly hasOverlap: boolean;
}

export function evaluateEmploymentTermsReadiness(
  records: readonly EmploymentTermsRecord[],
  asOfDate: number,
): EmploymentTermsReadinessFacts {
  const payrollEligible = records.filter((record) => record.payrollEligible === true);
  const approved = payrollEligible.filter((record) => record.status === "APPROVED");
  const currentCandidates = payrollEligible.filter(
    (record) =>
      (record.status === "APPROVED" || record.status === "PENDING_APPROVAL") &&
      isRecordEffective(record, asOfDate),
  );

  return {
    hasOnlyNonPayrollEligibleTerms:
      records.length > 0 && records.every((record) => record.payrollEligible === false),
    hasPendingApproval: payrollEligible.some(
      (record) => record.status === "PENDING_APPROVAL",
    ),
    hasCurrentValidSource: approved.some(
      (record) => evaluatePayrollReadableEmploymentTerms(record, asOfDate) !== null,
    ),
    hasExpiredApprovedSource: approved.some(
      (record) =>
        isStructurallyPayrollReadable(record) &&
        record.effectiveTo !== null &&
        record.effectiveTo < asOfDate,
    ),
    hasCurrentCandidateMissingBaseSalary: currentCandidates.some(
      (record) => !hasValidBaseSalary(record),
    ),
    hasOverlap: approved.some((record, index) =>
      approved.slice(index + 1).some((candidate) => rangesOverlap(record, candidate)),
    ),
  };
}

export function evaluatePayrollReadableEmploymentTerms(
  record: EmploymentTermsRecord,
  date: number,
): readonly EmploymentTermsAllowance[] | null {
  if (!isStructurallyPayrollReadable(record) || !isRecordEffective(record, date)) {
    return null;
  }

  const payrollAllowances: EmploymentTermsAllowance[] = [];
  for (const allowance of record.allowances) {
    if (!allowance.payrollEligible) continue;
    if (isAllowanceEffective(allowance, date)) payrollAllowances.push(allowance);
  }
  return payrollAllowances;
}

export function toHcmBusinessDateTimestamp(timestamp: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  return Date.UTC(
    readDatePart(parts, "year"),
    readDatePart(parts, "month") - 1,
    readDatePart(parts, "day"),
  );
}

function isStructurallyPayrollReadable(record: EmploymentTermsRecord): boolean {
  if (
    record.status !== "APPROVED" ||
    !record.payrollEligible ||
    record.approvedAt === null ||
    !isCanonicalDate(record.effectiveFrom) ||
    (record.effectiveTo !== null && !isCanonicalDate(record.effectiveTo)) ||
    (record.effectiveTo !== null && record.effectiveTo < record.effectiveFrom) ||
    !hasValidBaseSalary(record) ||
    !/^[A-Z]{3}$/u.test(record.currencyCode) ||
    !EMPLOYMENT_TERMS_PAY_FREQUENCIES.includes(record.payFrequency) ||
    !Array.isArray(record.allowances)
  ) {
    return false;
  }

  return record.allowances.every((allowance) => {
    if (!allowance || typeof allowance !== "object" || typeof allowance.payrollEligible !== "boolean") {
      return false;
    }
    if (!allowance.payrollEligible) return true;
    const actualFrom = allowance.effectiveFrom ?? record.effectiveFrom;
    const actualTo = allowance.effectiveTo ?? record.effectiveTo;
    return isBoundedRequiredText(allowance.type, MAX_ALLOWANCE_TYPE_LENGTH)
      && isBoundedRequiredText(allowance.label, MAX_ALLOWANCE_LABEL_LENGTH)
      && Number.isFinite(allowance.amount)
      && allowance.amount >= 0
      && /^[A-Z]{3}$/u.test(allowance.currencyCode)
      && (allowance.effectiveFrom === null || isCanonicalDate(allowance.effectiveFrom))
      && (allowance.effectiveTo === null || isCanonicalDate(allowance.effectiveTo))
      && isBoundedNullableText(allowance.sourceNote, MAX_SOURCE_NOTE_LENGTH)
      && (actualTo === null || actualTo >= actualFrom);
  });
}

function hasValidBaseSalary(record: EmploymentTermsRecord): boolean {
  return Number.isFinite(record.baseSalaryAmount) && record.baseSalaryAmount >= 0;
}

function isRecordEffective(record: EmploymentTermsRecord, date: number): boolean {
  return isCanonicalDate(record.effectiveFrom)
    && (record.effectiveTo === null || isCanonicalDate(record.effectiveTo))
    && record.effectiveFrom <= date
    && (record.effectiveTo === null || record.effectiveTo >= date);
}

function rangesOverlap(left: EmploymentTermsRecord, right: EmploymentTermsRecord): boolean {
  if (
    !isCanonicalDate(left.effectiveFrom) ||
    !isCanonicalDate(right.effectiveFrom) ||
    (left.effectiveTo !== null && !isCanonicalDate(left.effectiveTo)) ||
    (right.effectiveTo !== null && !isCanonicalDate(right.effectiveTo))
  ) {
    return false;
  }
  return left.effectiveFrom <= (right.effectiveTo ?? Number.MAX_SAFE_INTEGER)
    && right.effectiveFrom <= (left.effectiveTo ?? Number.MAX_SAFE_INTEGER);
}

function isAllowanceEffective(allowance: EmploymentTermsAllowance, date: number): boolean {
  return (allowance.effectiveFrom === null || allowance.effectiveFrom <= date)
    && (allowance.effectiveTo === null || allowance.effectiveTo >= date);
}

function isCanonicalDate(value: unknown): value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return false;
  const date = new Date(value);
  return date.getUTCHours() === 0
    && date.getUTCMinutes() === 0
    && date.getUTCSeconds() === 0
    && date.getUTCMilliseconds() === 0;
}

function isBoundedRequiredText(value: unknown, maxLength: number): value is string {
  if (typeof value !== "string") return false;
  const normalized = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  return normalized.length > 0 && normalized.length <= maxLength;
}

function isBoundedNullableText(value: unknown, maxLength: number): value is string | null {
  return value === null || isBoundedRequiredText(value, maxLength);
}

function readDatePart(
  parts: readonly Intl.DateTimeFormatPart[],
  type: "year" | "month" | "day",
): number {
  const value = parts.find((part) => part.type === type)?.value;
  if (!value) throw new Error(`Failed to resolve ${type} for ${BUSINESS_TIME_ZONE}`);
  return Number.parseInt(value, 10);
}
