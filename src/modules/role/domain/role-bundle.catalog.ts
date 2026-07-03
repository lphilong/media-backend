import { RoleAssignmentScopeType } from "./role-assignment-scope";
import {
  getRoleTemplate,
  evaluateRoleTemplateAssignability,
  isOperatorSupportedRoleAssignmentScopeType,
  RoleAccountContextLifecyclePolicy,
  RoleAssignabilityStatus,
  RoleFeatureStatus,
  RoleLegacyVisibility,
  RoleOperatorFlowGroup,
  RoleResponsibilityPolicy,
  RoleReviewPolicy,
  RoleScopeSelectorSupport,
  RoleSensitivityLevel,
} from "./role-template.catalog";

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
  "STAFF_CONSOLE" | "MANAGER_CONSOLE" | "ADMIN_CONSOLE";

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
  readonly assignabilityStatus: RoleAssignabilityStatus;
  readonly featureStatus: RoleFeatureStatus;
  readonly operatorFlowGroup: RoleOperatorFlowGroup;
  readonly sensitivityLevel: RoleSensitivityLevel;
  readonly reviewPolicy: RoleReviewPolicy;
  readonly accountContextLifecyclePolicy: RoleAccountContextLifecyclePolicy;
  readonly responsibilityPolicy: RoleResponsibilityPolicy;
  readonly scopeSelectorSupport: RoleScopeSelectorSupport;
  readonly futureReadinessNote: string | null;
  readonly legacyVisibility: RoleLegacyVisibility;
  readonly createdAt: string;
  readonly updatedAt: string;
}

const VERSION = "2026-06-26";

export const ROLE_BUNDLE_CATALOG: readonly RoleBundleTemplate[] = Object.freeze(
  [
    bundle(
      "OWNER_ADMIN_BUNDLE",
      "Owner Admin",
      "Owner-controlled full administration preset.",
      ["OWNER_ADMIN"],
      "ADMIN_CONSOLE",
      ["global"],
      true,
    ),
    bundle(
      "ACCESS_ADMIN_BUNDLE",
      "Access Admin",
      "User and role governance preset.",
      ["ACCESS_ADMIN"],
      "ADMIN_CONSOLE",
      ["global"],
      true,
    ),
    bundle(
      "HR_STAFF_BUNDLE",
      "HR Staff",
      "People and employment operations preset.",
      ["HR_OPERATIONS"],
      "ADMIN_CONSOLE",
      ["managedOrgUnit"],
      true,
    ),
    bundle(
      "HR_MANAGER_BUNDLE",
      "HR Manager",
      "HR operations and employment terms approval preset.",
      ["HR_OPERATIONS", "HR_TERMS_APPROVER"],
      "ADMIN_CONSOLE",
      ["managedOrgUnit"],
      true,
    ),
    bundle(
      "PRODUCTION_OPS_BUNDLE",
      "Production Operations",
      "Event, studio, and scheduling operations preset.",
      ["PRODUCTION_OPS"],
      "ADMIN_CONSOLE",
      ["assignedEvent", "assignedStudioResource"],
      false,
    ),
    bundle(
      "PLATFORM_CHANNEL_OPS_BUNDLE",
      "Platform Channel Ops",
      "Platform account operations preset.",
      ["PLATFORM_CHANNEL_OPS"],
      "ADMIN_CONSOLE",
      ["assignedPlatformAccount"],
      false,
    ),
    bundle(
      "CREATIVE_VISUAL_LEAD_BUNDLE",
      "Creative Visual Lead",
      "Creative lead visibility preset.",
      ["CREATIVE_VISUAL_LEAD"],
      "ADMIN_CONSOLE",
      ["managedTalentGroup", "assignedEvent"],
      false,
    ),
    bundle(
      "CONTENT_OPS_BUNDLE",
      "Content Ops",
      "Content operations visibility preset.",
      ["CONTENT_OPS"],
      "ADMIN_CONSOLE",
      ["managedTalentGroup", "assignedEvent"],
      false,
    ),
    bundle(
      "TALENT_GROUP_MANAGER_BUNDLE",
      "Talent Group Manager",
      "Manager capability preset for an explicitly assigned TalentGroup.",
      ["TALENT_GROUP_MANAGER"],
      "MANAGER_CONSOLE",
      ["managedTalentGroup"],
      false,
    ),
    bundle(
      "ORG_UNIT_MANAGER_BUNDLE",
      "Org Unit Manager",
      "Manager capability preset for an explicitly assigned OrgUnit.",
      ["ORG_UNIT_MANAGER"],
      "MANAGER_CONSOLE",
      ["managedOrgUnit"],
      false,
    ),
    bundle(
      "KPI_OPERATOR_BUNDLE",
      "KPI Operator",
      "KPI operations preset.",
      ["KPI_OPERATIONS"],
      "ADMIN_CONSOLE",
      ["global"],
      false,
    ),
    bundle(
      "COMMERCIAL_STAFF_BUNDLE",
      "Commercial Staff",
      "Contract operations preset.",
      ["COMMERCIAL_CONTRACT_OPS"],
      "ADMIN_CONSOLE",
      ["contractPortfolio"],
      false,
    ),
    bundle(
      "FINANCE_STAFF_BUNDLE",
      "Finance Staff",
      "Revenue and commission operations preset.",
      ["REVENUE_FINANCE_OPS", "COMMISSION_OPS"],
      "ADMIN_CONSOLE",
      ["financeGlobal", "financePeriod"],
      true,
    ),
    bundle(
      "FINANCE_APPROVER_BUNDLE",
      "Finance Approver",
      "Revenue approval and reconciliation preset.",
      ["REVENUE_APPROVER", "REVENUE_RECONCILER"],
      "ADMIN_CONSOLE",
      ["financeGlobal", "financePeriod"],
      true,
    ),
    bundle(
      "COMMISSION_APPROVER_BUNDLE",
      "Commission Approver",
      "Commission approval preset.",
      ["COMMISSION_APPROVER"],
      "ADMIN_CONSOLE",
      ["financeGlobal", "financePeriod"],
      true,
    ),
    bundle(
      "ATTENDANCE_OPERATOR_BUNDLE",
      "Attendance Operator",
      "Attendance and leave review operations preset.",
      ["ATTENDANCE_OPS", "LEAVE_REVIEWER"],
      "ADMIN_CONSOLE",
      ["attendancePeriodOrg"],
      false,
    ),
    bundle(
      "ATTENDANCE_APPROVER_BUNDLE",
      "Attendance Approver",
      "Attendance approval preset.",
      ["ATTENDANCE_APPROVER"],
      "ADMIN_CONSOLE",
      ["attendancePeriodOrg"],
      true,
    ),
    bundle(
      "MONTHLY_CLOSE_OWNER_BUNDLE",
      "Monthly Close Owner",
      "Monthly close ownership preset.",
      ["MONTHLY_CLOSE_OWNER"],
      "ADMIN_CONSOLE",
      ["financePeriod", "payrollPeriod"],
      true,
    ),
    bundle(
      "PAYROLL_DRAFT_OPERATOR_BUNDLE",
      "Payroll Draft Operator",
      "Payroll draft operations preset.",
      ["PAYROLL_DRAFT_OPS"],
      "ADMIN_CONSOLE",
      ["payrollPeriod"],
      true,
    ),
    bundle(
      "PAYROLL_DRAFT_APPROVER_BUNDLE",
      "Payroll Draft Approver",
      "Payroll draft approval preset.",
      ["PAYROLL_DRAFT_APPROVER"],
      "ADMIN_CONSOLE",
      ["payrollPeriod"],
      true,
    ),
    bundle(
      "AUDITOR_BUNDLE",
      "Auditor",
      "Read-only operational audit preset without sensitive-read expansion.",
      ["VIEWER_AUDITOR"],
      "ADMIN_CONSOLE",
      ["global"],
      false,
    ),
    bundle(
      "STAFF_CONSOLE_BUNDLE",
      "Staff Console",
      "Own-data staff console preset.",
      ["STAFF_CONSOLE_USER"],
      "STAFF_CONSOLE",
      ["self"],
      false,
    ),
  ],
);

const BUNDLE_BY_CODE = new Map(
  ROLE_BUNDLE_CATALOG.map((item) => [item.code, item]),
);

export function listRoleBundles(): readonly RoleBundleTemplate[] {
  return ROLE_BUNDLE_CATALOG;
}

export function getRoleBundle(
  code: string,
  version?: string,
): RoleBundleTemplate | null {
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
  const metadata = buildBundleMetadata({
    code,
    childRoles,
    recommendedScopes,
    sensitive,
  });
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
    ...metadata,
    createdAt: `${VERSION}T00:00:00.000Z`,
    updatedAt: `${VERSION}T00:00:00.000Z`,
  });
}

function buildBundleMetadata(params: {
  readonly code: RoleBundleCode;
  readonly childRoles: readonly string[];
  readonly recommendedScopes: readonly RoleAssignmentScopeType[];
  readonly sensitive: boolean;
}): Pick<
  RoleBundleTemplate,
  | "assignabilityStatus"
  | "featureStatus"
  | "operatorFlowGroup"
  | "sensitivityLevel"
  | "reviewPolicy"
  | "accountContextLifecyclePolicy"
  | "responsibilityPolicy"
  | "scopeSelectorSupport"
  | "futureReadinessNote"
  | "legacyVisibility"
> {
  const childTemplates = params.childRoles
    .map((code) => getRoleTemplate(code))
    .filter((item): item is NonNullable<typeof item> => item !== null);
  const childDecisions = params.childRoles
    .map((code) => ({
      code,
      template: getRoleTemplate(code),
    }))
    .map((item) => ({
      ...item,
      decision: evaluateRoleTemplateAssignability(item.template),
    }));
  const childBlockers = childDecisions.filter(
    (item) => !item.decision.assignable,
  );
  const unsupportedScopes = params.recommendedScopes.filter(
    (scopeType) => !isOperatorSupportedRoleAssignmentScopeType(scopeType),
  );
  const childRestricted = childTemplates.some(
    (template) => template.assignabilityStatus === "RESTRICTED_SENSITIVE",
  );
  const childAuditOnly =
    childDecisions.length > 0 &&
    childDecisions.every(
      (item) =>
        item.decision.assignable &&
        item.template?.assignabilityStatus === "READ_ONLY_AUDIT",
    );
  const scopeSelectorSupport =
    params.recommendedScopes.length === 0
      ? "NOT_REQUIRED"
      : unsupportedScopes.length > 0
        ? "UNSUPPORTED"
        : "SUPPORTED";
  const futureReadinessNote =
    childBlockers.length > 0
      ? `Bundle child roles are not assignable: ${childBlockers
          .map((item) => item.code)
          .join(", ")}.`
      : unsupportedScopes.length > 0
        ? `Operator scope selector support is not available for: ${unsupportedScopes.join(", ")}.`
        : null;
  const sensitivityLevel =
    params.sensitive || childRestricted
      ? "HIGH_RISK"
      : params.recommendedScopes.includes("global")
        ? "SENSITIVE"
        : "STANDARD";
  const assignabilityStatus = futureReadinessNote
    ? "FUTURE_READY_CONDITION"
    : childAuditOnly || params.code === "AUDITOR_BUNDLE"
      ? "READ_ONLY_AUDIT"
      : sensitivityLevel !== "STANDARD"
        ? "RESTRICTED_SENSITIVE"
        : params.recommendedScopes.length > 0
          ? "REQUIRES_SCOPE_SELECTION"
          : "READY_ASSIGNABLE";

  return {
    assignabilityStatus,
    featureStatus: futureReadinessNote
      ? childTemplates.length > 0
        ? "PARTIAL_SOURCE_BACKED"
        : "FUTURE_READY"
      : "SOURCE_BACKED",
    operatorFlowGroup: flowGroupForAssignability(assignabilityStatus),
    sensitivityLevel,
    reviewPolicy:
      sensitivityLevel === "STANDARD" &&
      !params.recommendedScopes.includes("global")
        ? "NOT_REQUIRED"
        : "REVIEW_REQUIRED",
    accountContextLifecyclePolicy: "SYSTEM_DERIVED_PREVIEW_ONLY",
    responsibilityPolicy: params.childRoles.some(
      (code) => code === "TALENT_GROUP_MANAGER" || code === "ORG_UNIT_MANAGER",
    )
      ? "REQUIRES_EXISTING_RESPONSIBILITY"
      : "NOT_REQUIRED",
    scopeSelectorSupport,
    futureReadinessNote,
    legacyVisibility: "NORMAL_OPERATOR",
  };
}

export interface RoleBundleAssignabilityBlocker {
  readonly code:
    | "ROLE_BUNDLE_NOT_FOUND"
    | "ROLE_BUNDLE_NOT_ACTIVE"
    | "ROLE_BUNDLE_CHILD_ROLE_NOT_ASSIGNABLE"
    | "ROLE_BUNDLE_UNSUPPORTED_SCOPE_SELECTOR"
    | "ROLE_BUNDLE_NOT_ASSIGNABLE";
  readonly summary: string;
  readonly childRoleCode?: string;
}

export interface RoleBundleAssignabilityDecision {
  readonly assignable: boolean;
  readonly blockers: readonly RoleBundleAssignabilityBlocker[];
}

export function evaluateRoleBundleAssignability(
  bundle: RoleBundleTemplate | null | undefined,
): RoleBundleAssignabilityDecision {
  if (!bundle) {
    return {
      assignable: false,
      blockers: [
        {
          code: "ROLE_BUNDLE_NOT_FOUND",
          summary: "Role bundle is not present in the active catalog.",
        },
      ],
    };
  }

  const blockers: RoleBundleAssignabilityBlocker[] = [];
  if (bundle.status !== "ACTIVE") {
    blockers.push({
      code: "ROLE_BUNDLE_NOT_ACTIVE",
      summary: "Role bundle is not active.",
    });
  }
  for (const childRoleCode of bundle.childRoles) {
    const childTemplate = getRoleTemplate(childRoleCode);
    const childDecision = evaluateRoleTemplateAssignability(childTemplate);
    if (!childDecision.assignable) {
      blockers.push({
        code: "ROLE_BUNDLE_CHILD_ROLE_NOT_ASSIGNABLE",
        childRoleCode,
        summary: `Bundle child role ${childRoleCode} is not assignable: ${childDecision.blockers
          .map((item) => item.summary)
          .join(" ")}`,
      });
    }
  }
  if (bundle.scopeSelectorSupport === "UNSUPPORTED") {
    blockers.push({
      code: "ROLE_BUNDLE_UNSUPPORTED_SCOPE_SELECTOR",
      summary:
        bundle.futureReadinessNote ??
        "Role bundle requires an unsupported assignment scope selector.",
    });
  }
  if (bundle.assignabilityStatus === "FUTURE_READY_CONDITION") {
    blockers.push({
      code: "ROLE_BUNDLE_NOT_ASSIGNABLE",
      summary:
        bundle.futureReadinessNote ??
        "Role bundle is explicitly gated for future source readiness.",
    });
  }

  return {
    assignable: blockers.length === 0,
    blockers: Object.freeze(blockers),
  };
}

export function isRoleBundleAssignable(
  bundle: RoleBundleTemplate | null | undefined,
): boolean {
  return evaluateRoleBundleAssignability(bundle).assignable;
}

function flowGroupForAssignability(
  status: RoleAssignabilityStatus,
): RoleOperatorFlowGroup {
  switch (status) {
    case "READY_ASSIGNABLE":
      return "READY_TO_ASSIGN";
    case "REQUIRES_SCOPE_SELECTION":
      return "REQUIRES_SCOPE_SELECTION";
    case "RESTRICTED_SENSITIVE":
      return "RESTRICTED_SENSITIVE";
    case "SYSTEM_CONTROLLED":
      return "SYSTEM_CONTROLLED";
    case "READ_ONLY_AUDIT":
      return "READ_ONLY_AUDIT";
    case "FUTURE_READY_CONDITION":
    default:
      return "FUTURE_READINESS";
  }
}
