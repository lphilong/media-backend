import { Permission } from "@core/permission/permission.enum";
import { RoleAssignmentScopeGrant } from "./role-assignment-scope";
import { getRoleBundle } from "./role-bundle.catalog";
import { getRoleTemplate, normalizeRoleTemplateCode } from "./role-template.catalog";

const DAY_MS = 24 * 60 * 60 * 1000;

export const SENSITIVE_ACCESS_DEFAULT_REVIEW_WINDOW_DAYS = 90;
export const PRIVILEGED_ACCESS_REVIEW_WINDOW_DAYS = 30;
export const BREAK_GLASS_ACCESS_WINDOW_DAYS = 14;

const OWNER_ADMIN_ROLE_CODES = new Set(["OWNER_ADMIN"]);
const ACCESS_GOVERNANCE_ROLE_CODES = new Set(["ACCESS_ADMIN"]);
const SENSITIVE_ROLE_CODES = new Set([
  "OWNER_ADMIN",
  "ACCESS_ADMIN",
  "HR_TERMS_APPROVER",
  "REVENUE_APPROVER",
  "REVENUE_RECONCILER",
  "COMMISSION_APPROVER",
  "ATTENDANCE_APPROVER",
  "MONTHLY_CLOSE_OWNER",
  "PAYROLL_DRAFT_APPROVER",
]);

const HIGH_RISK_ROLE_CATEGORIES = new Set([
  "ADMINISTRATION",
  "ACCESS_GOVERNANCE",
  "PEOPLE_APPROVAL",
  "FINANCE_APPROVAL",
  "FINANCE_RECONCILIATION",
  "COMMISSION_APPROVAL",
  "ATTENDANCE_APPROVAL",
  "MONTHLY_CLOSE",
  "PAYROLL_APPROVAL",
]);

const ACCESS_GOVERNANCE_PERMISSIONS = new Set<string>([
  Permission.USER_CREATE,
  Permission.USER_EDIT,
  Permission.USER_ACTIVATE,
  Permission.USER_DISABLE,
  Permission.USER_ARCHIVE,
  Permission.USER_AUTH_LINKAGE_SET,
  Permission.USER_AUTH_LINKAGE_UNLINK,
  Permission.USER_PROVISION_ACCOUNT,
  Permission.USER_PASSWORD_SETUP_SEND,
  Permission.ROLE_CREATE,
  Permission.ROLE_UPDATE,
  Permission.ROLE_ACTIVATE,
  Permission.ROLE_DEACTIVATE,
  Permission.ROLE_ARCHIVE,
  Permission.ROLE_PERMISSION_ASSIGN,
  Permission.ROLE_ASSIGNMENT_RULE_SET,
  Permission.ROLE_ASSIGN_TO_USER,
  Permission.ROLE_REVOKE_FROM_USER,
  Permission.ROLE_ASSIGNMENT_VIEW,
]);

const SENSITIVE_PERMISSION_REASONS: Readonly<Record<string, string>> = Object.freeze({
  [Permission.EMPLOYMENT_TERMS_READ_SENSITIVE]:
    "HRET salary/allowance sensitive read permission",
  [Permission.EMPLOYMENT_TERMS_APPROVE]:
    "HRET salary/allowance approval permission",
  [Permission.REVENUE_LEDGER_PLATFORM_EARNING_APPROVE]:
    "Platform Earnings approval permission",
  [Permission.REVENUE_LEDGER_PLATFORM_EARNING_VOID]:
    "Platform Earnings void permission",
  [Permission.REVENUE_LEDGER_PLATFORM_EARNING_REVIEW]:
    "Platform Earnings reject/archive review permission",
  [Permission.REVENUE_LEDGER_RECONCILE]:
    "Revenue reconciliation permission",
  [Permission.REVENUE_LEDGER_MANAGE_LIFECYCLE]:
    "Revenue lifecycle approve/void/archive permission",
  [Permission.KPI_FINALIZE]:
    "KPI finalization permission",
  [Permission.KPI_CORRECT_ACTUAL]:
    "KPI actual correction permission",
  [Permission.COMMISSION_SETTLEMENT_MANAGE_LIFECYCLE]:
    "Commission settlement lifecycle permission cataloged for future SoD",
});

const GLOBAL_LIKE_SCOPES = new Set(["global", "financeGlobal"]);

export interface SensitiveAccessPolicyAssignment {
  readonly roleCode?: string | null;
  readonly roleTemplateCode?: string | null;
  readonly permissions?: readonly string[];
  readonly structuredScopeGrants?: readonly RoleAssignmentScopeGrant[];
  readonly bundleCode?: string | null;
}

export interface SensitiveAccessClassification {
  readonly isSensitive: boolean;
  readonly isGlobalLike: boolean;
  readonly isHighRisk: boolean;
  readonly requiresReason: boolean;
  readonly requiresReview: boolean;
  readonly isBreakGlassLike: boolean;
  readonly isPrivilegedAccessGovernance: boolean;
  readonly maxReviewWindowDays: number | null;
  readonly requiresExpiry: boolean;
  readonly maxExpiryWindowDays: number | null;
  readonly globalScopes: readonly RoleAssignmentScopeGrant[];
  readonly sensitiveRoleCodes: readonly string[];
  readonly highRiskRoleCodes: readonly string[];
  readonly sensitivePermissions: readonly string[];
  readonly riskReasons: readonly string[];
}

export interface SensitiveAccessLifecycleValidation {
  readonly blockers: readonly {
    readonly code: string;
    readonly summary: string;
  }[];
}

export function classifySensitiveAccess(
  assignments: readonly SensitiveAccessPolicyAssignment[],
  options: { readonly catalogSensitive?: boolean } = {},
): SensitiveAccessClassification {
  const riskReasons = new Set<string>();
  const sensitiveRoleCodes = new Set<string>();
  const highRiskRoleCodes = new Set<string>();
  const sensitivePermissions = new Set<string>();
  const globalScopes: RoleAssignmentScopeGrant[] = [];
  const catalogSensitive = options.catalogSensitive === true;
  let isBreakGlassLike: boolean = false;
  let isPrivilegedAccessGovernance: boolean = false;

  if (catalogSensitive) {
    riskReasons.add("Assignment target catalog is marked sensitive");
  }

  for (const assignment of assignments) {
    const roleCodes = normalizeRoleCodes([
      assignment.roleCode,
      assignment.roleTemplateCode,
    ]);
    const bundleCode = normalizeOptionalCode(assignment.bundleCode);
    const bundle = bundleCode ? getRoleBundle(bundleCode) : null;
    if (bundle?.sensitive) {
      riskReasons.add(`Sensitive bundle ${bundle.code}`);
    }

    for (const roleCode of roleCodes) {
      const template = getRoleTemplate(roleCode);
      if (SENSITIVE_ROLE_CODES.has(roleCode)) {
        sensitiveRoleCodes.add(roleCode);
        riskReasons.add(`Sensitive role template ${roleCode}`);
      }
      if (
        SENSITIVE_ROLE_CODES.has(roleCode) ||
        (template && HIGH_RISK_ROLE_CATEGORIES.has(template.category))
      ) {
        highRiskRoleCodes.add(roleCode);
      }
      if (OWNER_ADMIN_ROLE_CODES.has(roleCode)) {
        isBreakGlassLike = true;
        riskReasons.add("Owner Admin break-glass-like access");
      }
      if (
        OWNER_ADMIN_ROLE_CODES.has(roleCode) ||
        ACCESS_GOVERNANCE_ROLE_CODES.has(roleCode)
      ) {
        isPrivilegedAccessGovernance = true;
      }
    }

    for (const permission of assignment.permissions ?? []) {
      if (ACCESS_GOVERNANCE_PERMISSIONS.has(permission)) {
        sensitivePermissions.add(permission);
        riskReasons.add("Access assignment lifecycle/governance permission");
      }
      const reason = SENSITIVE_PERMISSION_REASONS[permission];
      if (reason) {
        sensitivePermissions.add(permission);
        riskReasons.add(reason);
      }
    }

    for (const grant of assignment.structuredScopeGrants ?? []) {
      if (GLOBAL_LIKE_SCOPES.has(grant.scopeType)) {
        globalScopes.push(grant);
        riskReasons.add(`${grant.scopeType} scope grant`);
      }
    }
  }

  const isGlobalLike = globalScopes.length > 0;
  const isHighRisk =
    highRiskRoleCodes.size > 0 ||
    isGlobalLike ||
    sensitivePermissions.size > 0 ||
    catalogSensitive;
  const isSensitive =
    isHighRisk ||
    sensitiveRoleCodes.size > 0 ||
    sensitivePermissions.size > 0 ||
    catalogSensitive;
  const maxWindow = isBreakGlassLike
    ? BREAK_GLASS_ACCESS_WINDOW_DAYS
    : isPrivilegedAccessGovernance
      ? PRIVILEGED_ACCESS_REVIEW_WINDOW_DAYS
      : isSensitive || isGlobalLike
        ? SENSITIVE_ACCESS_DEFAULT_REVIEW_WINDOW_DAYS
        : null;

  return {
    isSensitive,
    isGlobalLike,
    isHighRisk,
    requiresReason: isSensitive || isGlobalLike,
    requiresReview: isSensitive || isGlobalLike,
    isBreakGlassLike,
    isPrivilegedAccessGovernance,
    maxReviewWindowDays: maxWindow,
    requiresExpiry: isBreakGlassLike,
    maxExpiryWindowDays: isBreakGlassLike ? BREAK_GLASS_ACCESS_WINDOW_DAYS : null,
    globalScopes,
    sensitiveRoleCodes: [...sensitiveRoleCodes].sort(),
    highRiskRoleCodes: [...highRiskRoleCodes].sort(),
    sensitivePermissions: [...sensitivePermissions].sort(),
    riskReasons: [...riskReasons].sort(),
  };
}

export function validateSensitiveAccessLifecycle(
  classification: SensitiveAccessClassification,
  lifecycle: {
    readonly effectiveAt: number;
    readonly reviewAt: number | null;
    readonly expiresAt: number | null;
  },
): SensitiveAccessLifecycleValidation {
  const blockers: Array<{ code: string; summary: string }> = [];

  if (classification.requiresReview) {
    if (lifecycle.reviewAt === null) {
      blockers.push({
        code: "REVIEW_AT_REQUIRED",
        summary: "reviewAt is required for sensitive or global access.",
      });
    } else if (
      classification.maxReviewWindowDays !== null &&
      lifecycle.reviewAt >
        lifecycle.effectiveAt + classification.maxReviewWindowDays * DAY_MS
    ) {
      blockers.push({
        code: "REVIEW_AT_EXCEEDS_MAX_WINDOW",
        summary: `reviewAt must be within ${classification.maxReviewWindowDays} days for this access grant.`,
      });
    }
  }

  if (classification.requiresExpiry) {
    if (lifecycle.expiresAt === null) {
      blockers.push({
        code: "EXPIRES_AT_REQUIRED",
        summary: "expiresAt is required for break-glass-like access.",
      });
    } else if (
      classification.maxExpiryWindowDays !== null &&
      lifecycle.expiresAt >
        lifecycle.effectiveAt + classification.maxExpiryWindowDays * DAY_MS
    ) {
      blockers.push({
        code: "EXPIRES_AT_EXCEEDS_MAX_WINDOW",
        summary: `expiresAt must be within ${classification.maxExpiryWindowDays} days for break-glass-like access.`,
      });
    }
  }

  return { blockers };
}

function normalizeRoleCodes(
  values: readonly (string | null | undefined)[],
): readonly string[] {
  return [
    ...new Set(
      values
        .filter((value): value is string => typeof value === "string")
        .map(normalizeRoleTemplateCode)
        .filter(Boolean),
    ),
  ];
}

function normalizeOptionalCode(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim()
    ? normalizeRoleTemplateCode(value)
    : null;
}
