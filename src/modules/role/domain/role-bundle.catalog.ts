import { RoleAssignmentScopeType } from "./role-assignment-scope";

export const ROLE_BUNDLE_CODES = [
  "OWNER_ADMIN_BUNDLE",
  "HR_OPERATIONS_BUNDLE",
  "TALENT_GROUP_MANAGER_BUNDLE",
  "PRODUCTION_OPS_BUNDLE",
  "FINANCE_STAFF_BUNDLE",
  "STAFF_CONSOLE_BUNDLE",
  "AUDITOR_READ_ONLY_BUNDLE",
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

const VERSION = "2026-06-18";

export const ROLE_BUNDLE_CATALOG: readonly RoleBundleTemplate[] = Object.freeze([
  bundle("OWNER_ADMIN_BUNDLE", "Owner Admin", "Owner-controlled full administration preset.", "ADMIN_FULL", "ADMIN_CONSOLE", ["global"], true),
  bundle("HR_OPERATIONS_BUNDLE", "HR Operations", "People and employment operations preset.", "HR_OPERATIONS", "ADMIN_CONSOLE", ["managedOrgUnit"], true),
  bundle("TALENT_GROUP_MANAGER_BUNDLE", "Talent Group Manager", "Manager capability preset for an explicitly assigned TalentGroup.", "TEAM_MANAGER", "MANAGER_CONSOLE", ["managedTalentGroup"], false),
  bundle("PRODUCTION_OPS_BUNDLE", "Production Operations", "Event, studio, and scheduling operations preset.", "PRODUCTION_OPS", "ADMIN_CONSOLE", ["assignedEvent", "assignedStudioResource"], false),
  bundle("FINANCE_STAFF_BUNDLE", "Finance Staff", "Commercial finance operations preset.", "COMMERCIAL_FINANCE", "ADMIN_CONSOLE", ["financeGlobal", "financePeriod"], true),
  bundle("STAFF_CONSOLE_BUNDLE", "Staff Console", "Own-data staff console preset.", "TALENT_STAFF_SELF", "STAFF_CONSOLE", ["self"], false),
  bundle("AUDITOR_READ_ONLY_BUNDLE", "Auditor Read Only", "Read-only operational audit preset without sensitive-read expansion.", "VIEWER_AUDITOR", "ADMIN_CONSOLE", ["global"], false),
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
  childRole: string,
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
    childRoles: Object.freeze([childRole]),
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
