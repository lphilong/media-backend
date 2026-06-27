import { RoleAssignmentScopeType } from "./role-assignment-scope";

export const ROLE_BUNDLE_CODES = [
  "OWNER_ADMIN_BUNDLE",
  "ACCESS_ADMIN_BUNDLE",
  "HR_STAFF_BUNDLE",
  "HR_MANAGER_BUNDLE",
  "PRODUCTION_OPS_BUNDLE",
  "PLATFORM_CHANNEL_OPS_BUNDLE",
  "CREATIVE_VISUAL_LEAD_BUNDLE",
  "CONTENT_OPS_BUNDLE",
  "TALENT_GROUP_MANAGER_BUNDLE",
  "ORG_UNIT_MANAGER_BUNDLE",
  "KPI_OPERATOR_BUNDLE",
  "COMMERCIAL_STAFF_BUNDLE",
  "FINANCE_STAFF_BUNDLE",
  "FINANCE_APPROVER_BUNDLE",
  "COMMISSION_APPROVER_BUNDLE",
  "ATTENDANCE_OPERATOR_BUNDLE",
  "ATTENDANCE_APPROVER_BUNDLE",
  "MONTHLY_CLOSE_OWNER_BUNDLE",
  "PAYROLL_DRAFT_OPERATOR_BUNDLE",
  "PAYROLL_DRAFT_APPROVER_BUNDLE",
  "AUDITOR_BUNDLE",
  "STAFF_CONSOLE_BUNDLE",
] as const;

export type RoleBundleCode = (typeof ROLE_BUNDLE_CODES)[number];
export type RoleBundleStatus = "ACTIVE" | "INACTIVE";
export type RecommendedAccountContext =
  | "STAFF_CONSOLE"
  | "MANAGER_CONSOLE"
  | "ADMIN_CONSOLE";

export interface RoleBundleTemplate {
  readonly code: RoleBundleCode;
  readonly name: string;
  readonly description: string;
  readonly businessPurpose: string;
  readonly status: RoleBundleStatus;
  readonly version: string;
  readonly childRoles: readonly string[];
  readonly recommendedAccountContext: RecommendedAccountContext;
  readonly recommendedScopes: readonly RoleAssignmentScopeType[];
  readonly sensitiveWarning: string | null;
  readonly sensitive: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

const VERSION = "2026-06-26";

export const ROLE_BUNDLE_CATALOG: readonly RoleBundleTemplate[] = Object.freeze([
  bundle("OWNER_ADMIN_BUNDLE", "Owner Admin", "Owner-controlled full administration preset.", ["OWNER_ADMIN"], "ADMIN_CONSOLE", ["global"], true),
  bundle("ACCESS_ADMIN_BUNDLE", "Access Admin", "User and role governance preset.", ["ACCESS_ADMIN"], "ADMIN_CONSOLE", ["global"], true),
  bundle("HR_STAFF_BUNDLE", "HR Staff", "People and employment operations preset.", ["HR_OPERATIONS"], "ADMIN_CONSOLE", ["managedOrgUnit"], true),
  bundle("HR_MANAGER_BUNDLE", "HR Manager", "HR operations and employment terms approval preset.", ["HR_OPERATIONS", "HR_TERMS_APPROVER"], "ADMIN_CONSOLE", ["managedOrgUnit"], true),
  bundle("PRODUCTION_OPS_BUNDLE", "Production Operations", "Event, studio, and scheduling operations preset.", ["PRODUCTION_OPS"], "ADMIN_CONSOLE", ["assignedEvent", "assignedStudioResource"], false),
  bundle("PLATFORM_CHANNEL_OPS_BUNDLE", "Platform Channel Ops", "Platform account operations preset.", ["PLATFORM_CHANNEL_OPS"], "ADMIN_CONSOLE", ["assignedPlatformAccount"], false),
  bundle("CREATIVE_VISUAL_LEAD_BUNDLE", "Creative Visual Lead", "Creative lead visibility preset.", ["CREATIVE_VISUAL_LEAD"], "ADMIN_CONSOLE", ["managedTalentGroup", "assignedEvent"], false),
  bundle("CONTENT_OPS_BUNDLE", "Content Ops", "Content operations visibility preset.", ["CONTENT_OPS"], "ADMIN_CONSOLE", ["managedTalentGroup", "assignedEvent"], false),
  bundle("TALENT_GROUP_MANAGER_BUNDLE", "Talent Group Manager", "Manager capability preset for an explicitly assigned TalentGroup.", ["TALENT_GROUP_MANAGER"], "MANAGER_CONSOLE", ["managedTalentGroup"], false),
  bundle("ORG_UNIT_MANAGER_BUNDLE", "Org Unit Manager", "Manager capability preset for an explicitly assigned OrgUnit.", ["ORG_UNIT_MANAGER"], "MANAGER_CONSOLE", ["managedOrgUnit"], false),
  bundle("KPI_OPERATOR_BUNDLE", "KPI Operator", "KPI operations preset.", ["KPI_OPERATIONS"], "ADMIN_CONSOLE", ["global"], false),
  bundle("COMMERCIAL_STAFF_BUNDLE", "Commercial Staff", "Contract operations preset.", ["COMMERCIAL_CONTRACT_OPS"], "ADMIN_CONSOLE", ["contractPortfolio"], false),
  bundle("FINANCE_STAFF_BUNDLE", "Finance Staff", "Revenue and commission operations preset.", ["REVENUE_FINANCE_OPS", "COMMISSION_OPS"], "ADMIN_CONSOLE", ["financeGlobal", "financePeriod"], true),
  bundle("FINANCE_APPROVER_BUNDLE", "Finance Approver", "Revenue approval and reconciliation preset.", ["REVENUE_APPROVER", "REVENUE_RECONCILER"], "ADMIN_CONSOLE", ["financeGlobal", "financePeriod"], true),
  bundle("COMMISSION_APPROVER_BUNDLE", "Commission Approver", "Commission approval preset.", ["COMMISSION_APPROVER"], "ADMIN_CONSOLE", ["financeGlobal", "financePeriod"], true),
  bundle("ATTENDANCE_OPERATOR_BUNDLE", "Attendance Operator", "Attendance and leave review operations preset.", ["ATTENDANCE_OPS", "LEAVE_REVIEWER"], "ADMIN_CONSOLE", ["attendancePeriodOrg"], false),
  bundle("ATTENDANCE_APPROVER_BUNDLE", "Attendance Approver", "Attendance approval preset.", ["ATTENDANCE_APPROVER"], "ADMIN_CONSOLE", ["attendancePeriodOrg"], true),
  bundle("MONTHLY_CLOSE_OWNER_BUNDLE", "Monthly Close Owner", "Monthly close ownership preset.", ["MONTHLY_CLOSE_OWNER"], "ADMIN_CONSOLE", ["financePeriod", "payrollPeriod"], true),
  bundle("PAYROLL_DRAFT_OPERATOR_BUNDLE", "Payroll Draft Operator", "Payroll draft operations preset.", ["PAYROLL_DRAFT_OPS"], "ADMIN_CONSOLE", ["payrollPeriod"], true),
  bundle("PAYROLL_DRAFT_APPROVER_BUNDLE", "Payroll Draft Approver", "Payroll draft approval preset.", ["PAYROLL_DRAFT_APPROVER"], "ADMIN_CONSOLE", ["payrollPeriod"], true),
  bundle("AUDITOR_BUNDLE", "Auditor", "Read-only operational audit preset without sensitive-read expansion.", ["VIEWER_AUDITOR"], "ADMIN_CONSOLE", ["global"], false),
  bundle("STAFF_CONSOLE_BUNDLE", "Staff Console", "Own-data staff console preset.", ["STAFF_CONSOLE_USER"], "STAFF_CONSOLE", ["self"], false),
]);

const BUNDLE_BY_CODE = new Map(ROLE_BUNDLE_CATALOG.map((item) => [item.code, item]));

export function listRoleBundles(): readonly RoleBundleTemplate[] {
  return ROLE_BUNDLE_CATALOG;
}

export function getRoleBundle(code: string, version?: string): RoleBundleTemplate | null {
  const normalized = code.trim().toUpperCase();
  const bundle = BUNDLE_BY_CODE.get(normalized as RoleBundleCode) ?? null;
  if (!bundle || (version !== undefined && bundle.version !== version.trim())) {
    return null;
  }
  return bundle;
}

function bundle(
  code: RoleBundleCode,
  name: string,
  businessPurpose: string,
  childRoles: readonly string[],
  recommendedAccountContext: RecommendedAccountContext,
  recommendedScopes: readonly RoleAssignmentScopeType[],
  sensitive: boolean,
): RoleBundleTemplate {
  return Object.freeze({
    code,
    name,
    description: businessPurpose,
    businessPurpose,
    status: "ACTIVE",
    version: VERSION,
    childRoles: Object.freeze([...childRoles]),
    recommendedAccountContext,
    recommendedScopes: Object.freeze([...recommendedScopes]),
    sensitiveWarning: sensitive
      ? "Sensitive/global access requires an explicit reason and later review-policy enforcement."
      : null,
    sensitive,
    createdAt: `${VERSION}T00:00:00.000Z`,
    updatedAt: `${VERSION}T00:00:00.000Z`,
  });
}
