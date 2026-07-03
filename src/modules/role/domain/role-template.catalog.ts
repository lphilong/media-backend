import { ActorScopeGrants } from "@core/actor/actor";
import { Permission } from "@core/permission/permission.enum";
import { AccountContext } from "@modules/account-context/domain/account-context.types";
import { RoleAssignmentScopeType } from "./role-assignment-scope";

export const ROLE_TEMPLATE_CODES = [
  "OWNER_ADMIN",
  "ACCESS_ADMIN",
  "HR_OPERATIONS",
  "HR_TERMS_APPROVER",
  "PRODUCTION_OPS",
  "PLATFORM_CHANNEL_OPS",
  "CREATIVE_VISUAL_LEAD",
  "CONTENT_OPS",
  "TALENT_GROUP_MANAGER",
  "ORG_UNIT_MANAGER",
  "KPI_OPERATIONS",
  "COMMERCIAL_CONTRACT_OPS",
  "REVENUE_FINANCE_OPS",
  "REVENUE_APPROVER",
  "REVENUE_RECONCILER",
  "COMMISSION_OPS",
  "COMMISSION_APPROVER",
  "ATTENDANCE_OPS",
  "LEAVE_REVIEWER",
  "ATTENDANCE_APPROVER",
  "MONTHLY_CLOSE_OWNER",
  "PAYROLL_DRAFT_OPS",
  "PAYROLL_DRAFT_APPROVER",
  "VIEWER_AUDITOR",
  "STAFF_CONSOLE_USER",
] as const;

export const LEGACY_ROLE_TEMPLATE_CODES = [
  "ADMIN_FULL",
  "TEAM_MANAGER",
  "COMMERCIAL_FINANCE",
  "TALENT_STAFF_SELF",
] as const;

export type RoleTemplateCode = (typeof ROLE_TEMPLATE_CODES)[number];
export type LegacyRoleTemplateCode =
  (typeof LEGACY_ROLE_TEMPLATE_CODES)[number];

export type RoleTemplateStatus =
  "READY" | "PREVIEW_ONLY" | "REQUIRES_FUTURE_SCOPE";

export type RoleAssignabilityStatus =
  | "READY_ASSIGNABLE"
  | "REQUIRES_SCOPE_SELECTION"
  | "RESTRICTED_SENSITIVE"
  | "FUTURE_READY_CONDITION"
  | "SYSTEM_CONTROLLED"
  | "READ_ONLY_AUDIT";

export type RoleFeatureStatus =
  "SOURCE_BACKED" | "PARTIAL_SOURCE_BACKED" | "FUTURE_READY";

export type RoleOperatorFlowGroup =
  | "READY_TO_ASSIGN"
  | "REQUIRES_SCOPE_SELECTION"
  | "RESTRICTED_SENSITIVE"
  | "FUTURE_READINESS"
  | "SYSTEM_CONTROLLED"
  | "READ_ONLY_AUDIT";

export type RoleSensitivityLevel = "STANDARD" | "SENSITIVE" | "HIGH_RISK";
export type RoleReviewPolicy = "NOT_REQUIRED" | "REVIEW_REQUIRED";
export type RoleAccountContextLifecyclePolicy = "SYSTEM_DERIVED_PREVIEW_ONLY";
export type RoleResponsibilityPolicy =
  "NOT_REQUIRED" | "REQUIRES_EXISTING_RESPONSIBILITY";
export type RoleScopeSelectorSupport =
  "SUPPORTED" | "NOT_REQUIRED" | "UNSUPPORTED";
export type RoleLegacyVisibility = "NORMAL_OPERATOR" | "INTERNAL_ONLY";

export interface RoleTemplateScopePlanEntry {
  readonly module: string;
  readonly scopes: readonly string[];
  readonly status: RoleTemplateStatus;
  readonly note: string;
}

export interface RoleTemplateDefinition {
  readonly code: RoleTemplateCode;
  readonly version: string;
  readonly name: string;
  readonly description: string;
  readonly category: string;
  readonly recommendedAccountContext: AccountContext;
  readonly permissions: readonly Permission[];
  readonly recommendedScopeGrants: Readonly<ActorScopeGrants>;
  readonly scopePlan: readonly RoleTemplateScopePlanEntry[];
  readonly warnings: readonly string[];
  readonly implementationNotes: readonly string[];
  readonly status: RoleTemplateStatus;
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
}

export interface LegacyRoleTemplateMapping {
  readonly legacyCode: LegacyRoleTemplateCode;
  readonly replacementRoleCodes: readonly RoleTemplateCode[];
  readonly replacementBundleCodes: readonly string[];
  readonly note: string;
}

export type RoleTemplateListItem = Omit<
  RoleTemplateDefinition,
  "permissions"
> & {
  readonly permissionCount: number;
};

type RoleTemplateDefinitionInput = Omit<
  RoleTemplateDefinition,
  | "version"
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
>;

const TEMPLATE_VERSION = "2026-06-26";

const ALL_PERMISSIONS = Object.freeze([...Object.values(Permission)]);

const OPERATOR_SUPPORTED_SCOPE_SELECTORS = new Set<RoleAssignmentScopeType>([
  "self",
  "global",
  "managedTalentGroup",
  "managedOrgUnit",
  "assignedPlatformAccount",
  "financeGlobal",
  "financePeriod",
  "assignedEvent",
  "assignedStudioResource",
]);

const ASSIGNABLE_ROLE_TEMPLATE_STATUSES = new Set<RoleAssignabilityStatus>([
  "READY_ASSIGNABLE",
  "REQUIRES_SCOPE_SELECTION",
  "RESTRICTED_SENSITIVE",
  "READ_ONLY_AUDIT",
]);

const RESTRICTED_SENSITIVE_ROLE_CODES = new Set<RoleTemplateCode>([
  "OWNER_ADMIN",
  "ACCESS_ADMIN",
  "HR_TERMS_APPROVER",
  "REVENUE_APPROVER",
  "REVENUE_RECONCILER",
  "COMMISSION_OPS",
  "COMMISSION_APPROVER",
]);

export const LEGACY_ROLE_TEMPLATE_COMPATIBILITY: readonly LegacyRoleTemplateMapping[] =
  Object.freeze([
    legacyMap(
      "ADMIN_FULL",
      ["OWNER_ADMIN", "ACCESS_ADMIN"],
      ["OWNER_ADMIN_BUNDLE", "ACCESS_ADMIN_BUNDLE"],
    ),
    legacyMap(
      "TEAM_MANAGER",
      ["TALENT_GROUP_MANAGER", "ORG_UNIT_MANAGER"],
      ["TALENT_GROUP_MANAGER_BUNDLE", "ORG_UNIT_MANAGER_BUNDLE"],
    ),
    legacyMap(
      "COMMERCIAL_FINANCE",
      [
        "COMMERCIAL_CONTRACT_OPS",
        "REVENUE_FINANCE_OPS",
        "REVENUE_APPROVER",
        "REVENUE_RECONCILER",
        "COMMISSION_OPS",
        "COMMISSION_APPROVER",
      ],
      [
        "COMMERCIAL_STAFF_BUNDLE",
        "FINANCE_STAFF_BUNDLE",
        "FINANCE_APPROVER_BUNDLE",
        "COMMISSION_APPROVER_BUNDLE",
      ],
    ),
    legacyMap(
      "TALENT_STAFF_SELF",
      ["STAFF_CONSOLE_USER"],
      ["STAFF_CONSOLE_BUNDLE"],
    ),
  ]);

const GOVERNANCE_PERMISSIONS = Object.freeze([
  Permission.USER_VIEW,
  Permission.USER_CREATE,
  Permission.USER_EDIT,
  Permission.USER_ACTIVATE,
  Permission.USER_DISABLE,
  Permission.USER_ARCHIVE,
  Permission.USER_AUTH_LINKAGE_SET,
  Permission.USER_AUTH_LINKAGE_UNLINK,
  Permission.USER_PROVISION_ACCOUNT,
  Permission.USER_PASSWORD_SETUP_SEND,
  Permission.ROLE_LIST,
  Permission.ROLE_VIEW,
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

const PEOPLE_OPERATIONS_PERMISSIONS = Object.freeze([
  Permission.ORG_UNIT_READ,
  Permission.ORG_UNIT_LOOKUP,
  Permission.ORG_UNIT_CREATE,
  Permission.ORG_UNIT_UPDATE,
  Permission.ORG_UNIT_MANAGE_HIERARCHY,
  Permission.ORG_UNIT_MANAGE_LIFECYCLE,
  Permission.EMPLOYMENT_PROFILE_READ,
  Permission.EMPLOYMENT_PROFILE_LOOKUP,
  Permission.EMPLOYMENT_PROFILE_CREATE,
  Permission.EMPLOYMENT_PROFILE_UPDATE,
  Permission.EMPLOYMENT_PROFILE_MANAGE_ORG_ASSIGNMENT,
  Permission.EMPLOYMENT_PROFILE_MANAGE_MANAGER_ASSIGNMENT,
  Permission.EMPLOYMENT_PROFILE_MANAGE_USER_LINKAGE,
  Permission.EMPLOYMENT_PROFILE_MANAGE_LIFECYCLE,
  Permission.EMPLOYMENT_TERMS_READ,
  Permission.EMPLOYMENT_TERMS_MANAGE_DRAFT,
  Permission.TALENT_READ,
  Permission.TALENT_LOOKUP,
  Permission.TALENT_CREATE,
  Permission.TALENT_UPDATE,
  Permission.TALENT_MANAGE_MANAGER,
  Permission.TALENT_MANAGE_EMPLOYMENT_LINK,
  Permission.TALENT_MANAGE_LIFECYCLE,
  Permission.TALENT_GROUP_READ,
  Permission.TALENT_GROUP_LOOKUP,
  Permission.TALENT_GROUP_CREATE,
  Permission.TALENT_GROUP_UPDATE,
  Permission.TALENT_GROUP_MANAGE_LIFECYCLE,
  Permission.TALENT_GROUP_MANAGE_MEMBERSHIP,
  Permission.USER_VIEW,
  Permission.USER_CREATE,
  Permission.USER_PROVISION_ACCOUNT,
  Permission.USER_AUTH_LINKAGE_SET,
  Permission.USER_PASSWORD_SETUP_SEND,
  Permission.WORK_SCHEDULE_READ,
  Permission.KPI_READ,
  Permission.KPI_READ_PROGRESS,
]);

const PRODUCTION_PERMISSIONS = Object.freeze([
  Permission.EVENT_READ,
  Permission.EVENT_LOOKUP,
  Permission.EVENT_CREATE,
  Permission.EVENT_UPDATE,
  Permission.EVENT_MANAGE_ASSIGNMENTS,
  Permission.EVENT_MANAGE_LIFECYCLE,
  Permission.ORG_UNIT_LOOKUP,
  Permission.EMPLOYMENT_PROFILE_LOOKUP,
  Permission.TALENT_LOOKUP,
  Permission.TALENT_GROUP_LOOKUP,
  Permission.PLATFORM_ACCOUNT_READ,
  Permission.PLATFORM_ACCOUNT_LOOKUP,
  Permission.STUDIO_RESOURCE_READ,
  Permission.STUDIO_RESOURCE_LOOKUP,
  Permission.STUDIO_RESOURCE_CREATE,
  Permission.STUDIO_RESOURCE_UPDATE,
  Permission.STUDIO_RESOURCE_MANAGE_AVAILABILITY,
  Permission.STUDIO_RESOURCE_MANAGE_LIFECYCLE,
  Permission.WORK_SCHEDULE_READ,
  Permission.WORK_SCHEDULE_CREATE,
  Permission.WORK_SCHEDULE_UPDATE,
  Permission.WORK_SCHEDULE_MANAGE_LIFECYCLE,
]);

const PLATFORM_PERMISSIONS = Object.freeze([
  Permission.PLATFORM_ACCOUNT_READ,
  Permission.PLATFORM_ACCOUNT_LOOKUP,
  Permission.PLATFORM_ACCOUNT_CREATE,
  Permission.PLATFORM_ACCOUNT_UPDATE,
  Permission.PLATFORM_ACCOUNT_MANAGE_OWNERSHIP,
  Permission.PLATFORM_ACCOUNT_MANAGE_LIFECYCLE,
  Permission.PLATFORM_ACCOUNT_MANAGE_CAPABILITIES,
]);

const KPI_OPERATIONS_PERMISSIONS = Object.freeze([
  Permission.KPI_READ,
  Permission.KPI_CREATE_PLAN,
  Permission.KPI_UPDATE_DRAFT,
  Permission.KPI_PUBLISH,
  Permission.KPI_MANAGE_ALLOCATION,
  Permission.KPI_ARCHIVE,
  Permission.KPI_ENTER_ACTUAL,
  Permission.KPI_CORRECT_ACTUAL,
  Permission.KPI_READ_PROGRESS,
  Permission.KPI_FINALIZE,
]);

const COMMERCIAL_CONTRACT_PERMISSIONS = Object.freeze([
  Permission.CONTRACT_REGISTRY_READ,
  Permission.CONTRACT_REGISTRY_LOOKUP,
  Permission.CONTRACT_REGISTRY_CREATE,
  Permission.CONTRACT_REGISTRY_UPDATE,
  Permission.CONTRACT_REGISTRY_MANAGE_OWNER,
  Permission.CONTRACT_REGISTRY_MANAGE_FILE_REFERENCE,
  Permission.CONTRACT_REGISTRY_MANAGE_LIFECYCLE,
  Permission.CONTRACT_OBLIGATION_READ,
  Permission.CONTRACT_OBLIGATION_MANAGE_DRAFT,
  Permission.CONTRACT_OBLIGATION_DELIVER,
  Permission.CONTRACT_OBLIGATION_MANAGE_LIFECYCLE,
  Permission.CONTRACT_OBLIGATION_EVENT_EVIDENCE_LINK_READ,
  Permission.CONTRACT_OBLIGATION_EVENT_EVIDENCE_LINK,
  Permission.CONTRACT_OBLIGATION_EVENT_EVIDENCE_REMOVE,
  Permission.EMPLOYMENT_PROFILE_LOOKUP,
  Permission.TALENT_LOOKUP,
  Permission.PLATFORM_ACCOUNT_LOOKUP,
  Permission.EVENT_LOOKUP,
]);

const REVENUE_FINANCE_PERMISSIONS = Object.freeze([
  Permission.REVENUE_LEDGER_READ,
  Permission.REVENUE_LEDGER_LOOKUP,
  Permission.REVENUE_LEDGER_CREATE,
  Permission.REVENUE_LEDGER_UPDATE,
  Permission.REVENUE_LEDGER_MANAGE_LIFECYCLE,
  Permission.REVENUE_LEDGER_PLATFORM_EARNING_SUBMIT,
  Permission.REVENUE_LEDGER_PLATFORM_EARNING_REVIEW,
  Permission.DASHBOARD_LITE_READ,
]);

const REVENUE_APPROVER_PERMISSIONS = Object.freeze([
  Permission.REVENUE_LEDGER_READ,
  Permission.REVENUE_LEDGER_LOOKUP,
  Permission.REVENUE_LEDGER_MANAGE_LIFECYCLE,
  Permission.REVENUE_LEDGER_PLATFORM_EARNING_REVIEW,
  Permission.REVENUE_LEDGER_PLATFORM_EARNING_APPROVE,
  Permission.REVENUE_LEDGER_PLATFORM_EARNING_VOID,
  Permission.DASHBOARD_LITE_READ,
]);

const COMMISSION_OPS_PERMISSIONS = Object.freeze([
  Permission.COMMISSION_RULE_READ,
  Permission.COMMISSION_RULE_LOOKUP,
  Permission.COMMISSION_RULE_CREATE,
  Permission.COMMISSION_RULE_UPDATE,
  Permission.COMMISSION_RULE_MANAGE_LIFECYCLE,
  Permission.COMMISSION_SETTLEMENT_READ,
  Permission.COMMISSION_SETTLEMENT_CREATE,
  Permission.COMMISSION_SETTLEMENT_UPDATE,
  Permission.COMMISSION_SETTLEMENT_MANAGE_LIFECYCLE,
]);

const VIEWER_AUDITOR_PERMISSIONS = Object.freeze([
  Permission.EMPLOYMENT_TERMS_READ,
  Permission.EMPLOYMENT_TERMS_AUDIT,
  Permission.ORG_UNIT_READ,
  Permission.EMPLOYMENT_PROFILE_READ,
  Permission.TALENT_READ,
  Permission.TALENT_GROUP_READ,
  Permission.PLATFORM_ACCOUNT_READ,
  Permission.STUDIO_RESOURCE_READ,
  Permission.EVENT_READ,
  Permission.WORK_SCHEDULE_READ,
  Permission.CONTRACT_REGISTRY_READ,
  Permission.CONTRACT_OBLIGATION_READ,
  Permission.CONTRACT_OBLIGATION_EVENT_EVIDENCE_LINK_READ,
  Permission.TALENT_KPI_READ,
  Permission.KPI_READ,
  Permission.KPI_READ_PROGRESS,
  Permission.COMMISSION_RULE_READ,
  Permission.COMMISSION_SETTLEMENT_READ,
  Permission.REVENUE_LEDGER_READ,
  Permission.DASHBOARD_LITE_READ,
]);

const STAFF_CONSOLE_PERMISSIONS = Object.freeze([
  Permission.WORK_SCHEDULE_READ,
  Permission.EVENT_READ,
  Permission.TALENT_KPI_READ,
  Permission.KPI_READ_PROGRESS,
  Permission.EMPLOYMENT_PROFILE_READ,
  Permission.TALENT_READ,
]);

const GLOBAL_SCOPE_PLAN: readonly RoleTemplateScopePlanEntry[] = Object.freeze([
  scopePlan("Work Schedule", ["global"], "READY"),
  scopePlan("Event Assignment", ["global"], "READY"),
  scopePlan("Contract Registry", ["global"], "READY"),
  scopePlan("KPI", ["global"], "READY"),
  scopePlan("Revenue Ledger", ["financeGlobal"], "READY"),
  scopePlan("Commission", ["financeGlobal"], "READY"),
  scopePlan("Dashboard Lite", ["global"], "READY"),
]);

export const ROLE_TEMPLATE_CATALOG: readonly RoleTemplateDefinition[] =
  Object.freeze([
    template({
      code: "OWNER_ADMIN",
      name: "Owner Admin",
      description: "Owner-controlled full administration preset.",
      category: "ADMINISTRATION",
      recommendedAccountContext: "ADMIN_CONSOLE",
      permissions: ALL_PERMISSIONS,
      recommendedScopeGrants: scopeGrants({
        workSchedule: Object.freeze(["global"]),
        eventAssignment: Object.freeze(["global"]),
        contractRegistry: Object.freeze(["global"]),
        talentKpi: Object.freeze(["global"]),
        kpi: Object.freeze(["global"]),
        revenueLedger: Object.freeze(["global"]),
        commission: Object.freeze(["global"]),
        dashboardLite: Object.freeze(["global"]),
      }),
      scopePlan: GLOBAL_SCOPE_PLAN,
      warnings: [
        "Owner Admin is the explicit break-glass role and includes every current permission enum value.",
        "Separation-of-duties constraints are not enforced by the template catalog.",
      ],
      implementationNotes: [
        "Replaces legacy ADMIN_FULL for new role creation and bundle expansion.",
      ],
      status: "READY",
    }),
    template({
      code: "ACCESS_ADMIN",
      name: "Access Admin",
      description: "User, role, and access assignment administration preset.",
      category: "ACCESS_GOVERNANCE",
      recommendedAccountContext: "ADMIN_CONSOLE",
      permissions: GOVERNANCE_PERMISSIONS,
      recommendedScopeGrants: scopeGrants({}),
      scopePlan: [scopePlan("Access Governance", ["global"], "READY")],
      warnings: [
        "Can assign roles and modify user linkage; operational module permissions are intentionally excluded.",
      ],
      implementationNotes: [
        "Uses current user and role governance permission keys only.",
      ],
      status: "READY",
    }),
    template({
      code: "HR_OPERATIONS",
      name: "HR Operations",
      description:
        "People, organization, employment, talent, and talent-group operations preset.",
      category: "PEOPLE_OPERATIONS",
      recommendedAccountContext: "ADMIN_CONSOLE",
      permissions: PEOPLE_OPERATIONS_PERMISSIONS,
      recommendedScopeGrants: scopeGrants({
        workSchedule: Object.freeze(["department"]),
        kpi: Object.freeze(["global"]),
      }),
      scopePlan: [
        scopePlan(
          "People and Organization",
          ["managedOrgUnit"],
          "REQUIRES_FUTURE_SCOPE",
        ),
        scopePlan("Work Schedule", ["department"], "READY"),
        scopePlan("KPI", ["global"], "READY"),
      ],
      warnings: [
        "Sensitive employment terms read, approval, audit, revenue, commission, and role-management permissions are intentionally excluded.",
      ],
      implementationNotes: [
        "Normalizes the previous HR template to staff operations only; approval is split to HR_TERMS_APPROVER.",
      ],
      status: "READY",
    }),
    template({
      code: "HR_TERMS_APPROVER",
      name: "HR Terms Approver",
      description:
        "Employment terms sensitive-read, approval, and audit preset.",
      category: "PEOPLE_APPROVAL",
      recommendedAccountContext: "ADMIN_CONSOLE",
      permissions: [
        Permission.EMPLOYMENT_TERMS_READ,
        Permission.EMPLOYMENT_TERMS_READ_SENSITIVE,
        Permission.EMPLOYMENT_TERMS_APPROVE,
        Permission.EMPLOYMENT_TERMS_AUDIT,
      ],
      recommendedScopeGrants: scopeGrants({}),
      scopePlan: [
        scopePlan(
          "Employment Terms",
          ["managedOrgUnit"],
          "REQUIRES_FUTURE_SCOPE",
        ),
      ],
      warnings: [
        "Includes sensitive employment terms access and approval authority.",
      ],
      implementationNotes: [
        "Separated from HR_OPERATIONS to avoid granting sensitive approval by default.",
      ],
      status: "READY",
    }),
    template({
      code: "PRODUCTION_OPS",
      name: "Production Ops",
      description:
        "Production operations preset for events, studio resources, and work schedules.",
      category: "PRODUCTION",
      recommendedAccountContext: "ADMIN_CONSOLE",
      permissions: PRODUCTION_PERMISSIONS,
      recommendedScopeGrants: scopeGrants({
        workSchedule: Object.freeze(["global"]),
        eventAssignment: Object.freeze(["global"]),
      }),
      scopePlan: [
        scopePlan("Event Assignment", ["global", "assignedEvent"], "READY"),
        scopePlan("Work Schedule", ["global"], "READY"),
        scopePlan(
          "Studio Resource",
          ["assignedStudioResource"],
          "REQUIRES_FUTURE_SCOPE",
        ),
      ],
      warnings: [
        "Platform Account is read/lookup only for assignment and display references.",
      ],
      implementationNotes: [
        "Normalizes PRODUCTION_OPS by excluding Platform Account create/update/ownership/lifecycle/capabilities permissions.",
      ],
      status: "READY",
    }),
    template({
      code: "PLATFORM_CHANNEL_OPS",
      name: "Platform Channel Ops",
      description:
        "Platform account metadata, ownership, lifecycle, and capability operations preset.",
      category: "PLATFORM",
      recommendedAccountContext: "ADMIN_CONSOLE",
      permissions: PLATFORM_PERMISSIONS,
      recommendedScopeGrants: scopeGrants({}),
      scopePlan: [
        scopePlan(
          "Platform Account",
          ["assignedPlatformAccount", "global"],
          "REQUIRES_FUTURE_SCOPE",
        ),
      ],
      warnings: [
        "Credential access is outside the current Permission enum and is not granted by this template.",
      ],
      implementationNotes: [
        "Uses existing platform account metadata and lifecycle permissions.",
      ],
      status: "READY",
    }),
    template({
      code: "CREATIVE_VISUAL_LEAD",
      name: "Creative Visual Lead",
      description:
        "Creative lead preset for scoped event, studio-resource, talent, and schedule visibility.",
      category: "CREATIVE",
      recommendedAccountContext: "ADMIN_CONSOLE",
      permissions: [
        Permission.EVENT_READ,
        Permission.EVENT_LOOKUP,
        Permission.STUDIO_RESOURCE_READ,
        Permission.STUDIO_RESOURCE_LOOKUP,
        Permission.WORK_SCHEDULE_READ,
        Permission.TALENT_READ,
        Permission.TALENT_LOOKUP,
        Permission.TALENT_GROUP_READ,
        Permission.TALENT_GROUP_LOOKUP,
      ],
      recommendedScopeGrants: scopeGrants({
        workSchedule: Object.freeze(["team"]),
        eventAssignment: Object.freeze(["managedGroup"]),
      }),
      scopePlan: [
        scopePlan(
          "Creative Workflow",
          ["managedTalentGroup", "assignedEvent"],
          "REQUIRES_FUTURE_SCOPE",
        ),
      ],
      warnings: [
        "Creative project and visual-approval permissions do not exist yet; this is a visibility-only source-backed preset.",
      ],
      implementationNotes: [
        "Uses event, studio, talent, and schedule read permissions available today.",
      ],
      status: "REQUIRES_FUTURE_SCOPE",
    }),
    template({
      code: "CONTENT_OPS",
      name: "Content Ops",
      description:
        "Content operations preset for scoped event and studio operational visibility.",
      category: "CONTENT",
      recommendedAccountContext: "ADMIN_CONSOLE",
      permissions: [
        Permission.EVENT_READ,
        Permission.EVENT_LOOKUP,
        Permission.STUDIO_RESOURCE_READ,
        Permission.STUDIO_RESOURCE_LOOKUP,
        Permission.WORK_SCHEDULE_READ,
        Permission.PLATFORM_ACCOUNT_READ,
        Permission.PLATFORM_ACCOUNT_LOOKUP,
      ],
      recommendedScopeGrants: scopeGrants({
        workSchedule: Object.freeze(["team"]),
        eventAssignment: Object.freeze(["managedGroup"]),
      }),
      scopePlan: [
        scopePlan(
          "Content Workflow",
          ["managedTalentGroup", "assignedEvent"],
          "REQUIRES_FUTURE_SCOPE",
        ),
      ],
      warnings: [
        "Content project permissions do not exist yet; this is a source-backed operational visibility preset.",
      ],
      implementationNotes: [
        "Uses event, studio, platform reference, and schedule read permissions available today.",
      ],
      status: "REQUIRES_FUTURE_SCOPE",
    }),
    template({
      code: "TALENT_GROUP_MANAGER",
      name: "Talent Group Manager",
      description:
        "Manager capability preset for an explicitly assigned TalentGroup.",
      category: "MANAGEMENT",
      recommendedAccountContext: "MANAGER_CONSOLE",
      permissions: [
        Permission.WORK_SCHEDULE_READ,
        Permission.EVENT_READ,
        Permission.TALENT_READ,
        Permission.TALENT_GROUP_READ,
        Permission.TALENT_KPI_READ,
        Permission.KPI_READ,
        Permission.KPI_READ_PROGRESS,
        Permission.KPI_ENTER_ACTUAL,
        Permission.KPI_CORRECT_ACTUAL,
      ],
      recommendedScopeGrants: scopeGrants({
        workSchedule: Object.freeze(["team"]),
        eventAssignment: Object.freeze(["managedGroup"]),
        kpi: Object.freeze(["managedGroup"]),
      }),
      scopePlan: [
        scopePlan("Talent Group", ["managedTalentGroup"], "READY"),
        scopePlan("KPI", ["managedGroup"], "READY"),
      ],
      warnings: [
        "Talent KPI object scope remains future policy; role enforcement remains permission-based.",
      ],
      implementationNotes: [
        "Replaces legacy TEAM_MANAGER for target catalog and bundle expansion.",
      ],
      status: "READY",
    }),
    template({
      code: "ORG_UNIT_MANAGER",
      name: "Org Unit Manager",
      description:
        "Manager capability preset for an explicitly assigned OrgUnit.",
      category: "MANAGEMENT",
      recommendedAccountContext: "MANAGER_CONSOLE",
      permissions: [
        Permission.ORG_UNIT_READ,
        Permission.EMPLOYMENT_PROFILE_READ,
        Permission.TALENT_READ,
        Permission.WORK_SCHEDULE_READ,
        Permission.KPI_READ,
        Permission.KPI_READ_PROGRESS,
        Permission.KPI_ENTER_ACTUAL,
        Permission.KPI_CORRECT_ACTUAL,
      ],
      recommendedScopeGrants: scopeGrants({
        workSchedule: Object.freeze(["department"]),
        kpi: Object.freeze(["managedGroup"]),
      }),
      scopePlan: [
        scopePlan("Org Unit", ["managedOrgUnit"], "REQUIRES_FUTURE_SCOPE"),
      ],
      warnings: [
        "OrgUnit manager object scoping is not yet materialized outside structured assignment scope metadata.",
      ],
      implementationNotes: [
        "Uses source-backed people, schedule, and KPI permissions only.",
      ],
      status: "READY",
    }),
    template({
      code: "KPI_OPERATIONS",
      name: "KPI Operations",
      description:
        "KPI plan, allocation, actual, correction, progress, and finalize operations preset.",
      category: "KPI",
      recommendedAccountContext: "ADMIN_CONSOLE",
      permissions: KPI_OPERATIONS_PERMISSIONS,
      recommendedScopeGrants: scopeGrants({
        kpi: Object.freeze(["global"]),
      }),
      scopePlan: [scopePlan("KPI", ["global"], "READY")],
      warnings: [
        "Includes KPI finalize authority; approval policy is not split by the current Permission enum.",
      ],
      implementationNotes: ["Uses current KPI V2 permission keys."],
      status: "READY",
    }),
    template({
      code: "COMMERCIAL_CONTRACT_OPS",
      name: "Commercial Contract Ops",
      description:
        "Contract registry and obligation operations preset without finance approval authority.",
      category: "COMMERCIAL",
      recommendedAccountContext: "ADMIN_CONSOLE",
      permissions: COMMERCIAL_CONTRACT_PERMISSIONS,
      recommendedScopeGrants: scopeGrants({
        contractRegistry: Object.freeze(["global"]),
      }),
      scopePlan: [
        scopePlan("Contract Portfolio", ["contractPortfolio"], "READY"),
      ],
      warnings: [
        "Contract obligation review is intentionally excluded from this operations preset.",
      ],
      implementationNotes: [
        "Uses current contract registry and obligation operation permissions.",
      ],
      status: "REQUIRES_FUTURE_SCOPE",
    }),
    template({
      code: "REVENUE_FINANCE_OPS",
      name: "Revenue Finance Ops",
      description:
        "Revenue ledger maker and platform earning review operations preset.",
      category: "FINANCE",
      recommendedAccountContext: "ADMIN_CONSOLE",
      permissions: REVENUE_FINANCE_PERMISSIONS,
      recommendedScopeGrants: scopeGrants({
        revenueLedger: Object.freeze(["global"]),
        dashboardLite: Object.freeze(["global"]),
      }),
      scopePlan: [
        scopePlan(
          "Revenue Ledger",
          ["financeGlobal", "financePeriod"],
          "READY",
        ),
      ],
      warnings: [
        "Approval, void, and reconcile permissions are split to approver/reconciler roles.",
      ],
      implementationNotes: [
        "Replaces the revenue portion of legacy COMMERCIAL_FINANCE for new roles.",
      ],
      status: "READY",
    }),
    template({
      code: "REVENUE_APPROVER",
      name: "Revenue Approver",
      description:
        "Revenue ledger approval, void, and lifecycle authority preset.",
      category: "FINANCE_APPROVAL",
      recommendedAccountContext: "ADMIN_CONSOLE",
      permissions: REVENUE_APPROVER_PERMISSIONS,
      recommendedScopeGrants: scopeGrants({
        revenueLedger: Object.freeze(["global"]),
        dashboardLite: Object.freeze(["global"]),
      }),
      scopePlan: [
        scopePlan(
          "Revenue Ledger",
          ["financeGlobal", "financePeriod"],
          "READY",
        ),
      ],
      warnings: ["Includes sensitive revenue approval and void authority."],
      implementationNotes: [
        "Uses current revenue platform earning approval permissions.",
      ],
      status: "READY",
    }),
    template({
      code: "REVENUE_RECONCILER",
      name: "Revenue Reconciler",
      description: "Revenue ledger reconciliation and reporting preset.",
      category: "FINANCE_RECONCILIATION",
      recommendedAccountContext: "ADMIN_CONSOLE",
      permissions: [
        Permission.REVENUE_LEDGER_READ,
        Permission.REVENUE_LEDGER_LOOKUP,
        Permission.REVENUE_LEDGER_RECONCILE,
        Permission.DASHBOARD_LITE_READ,
      ],
      recommendedScopeGrants: scopeGrants({
        revenueLedger: Object.freeze(["global"]),
        dashboardLite: Object.freeze(["global"]),
      }),
      scopePlan: [
        scopePlan(
          "Revenue Ledger",
          ["financeGlobal", "financePeriod"],
          "READY",
        ),
      ],
      warnings: ["Includes reconciliation authority."],
      implementationNotes: [
        "Separated from Revenue Finance Ops for target SoD alignment.",
      ],
      status: "READY",
    }),
    template({
      code: "COMMISSION_OPS",
      name: "Commission Ops",
      description: "Commission rule and settlement operations preset.",
      category: "COMMISSION",
      recommendedAccountContext: "ADMIN_CONSOLE",
      permissions: COMMISSION_OPS_PERMISSIONS,
      recommendedScopeGrants: scopeGrants({
        commission: Object.freeze(["global"]),
      }),
      scopePlan: [
        scopePlan("Commission", ["financeGlobal", "financePeriod"], "READY"),
      ],
      warnings: [
        "The current Permission enum does not split commission draft from finalize.",
      ],
      implementationNotes: [
        "Replaces the commission operations portion of legacy COMMERCIAL_FINANCE for new roles.",
      ],
      status: "READY",
    }),
    template({
      code: "COMMISSION_APPROVER",
      name: "Commission Approver",
      description:
        "Commission settlement approval-oriented preset using available settlement lifecycle permission.",
      category: "COMMISSION_APPROVAL",
      recommendedAccountContext: "ADMIN_CONSOLE",
      permissions: [
        Permission.COMMISSION_SETTLEMENT_READ,
        Permission.COMMISSION_SETTLEMENT_MANAGE_LIFECYCLE,
      ],
      recommendedScopeGrants: scopeGrants({
        commission: Object.freeze(["global"]),
      }),
      scopePlan: [
        scopePlan(
          "Commission",
          ["financeGlobal", "financePeriod"],
          "REQUIRES_FUTURE_SCOPE",
        ),
      ],
      warnings: [
        "The current Permission enum does not expose a distinct commission approval permission.",
      ],
      implementationNotes: [
        "Uses settlement lifecycle as the closest available source-backed approver capability.",
      ],
      status: "READY",
    }),
    futureTemplate(
      "ATTENDANCE_OPS",
      "Attendance Ops",
      "Attendance operations preset.",
      "ATTENDANCE",
      "ADMIN_CONSOLE",
      ["attendancePeriodOrg"],
    ),
    futureTemplate(
      "LEAVE_REVIEWER",
      "Leave Reviewer",
      "Leave request review preset.",
      "ATTENDANCE_REVIEW",
      "ADMIN_CONSOLE",
      ["attendancePeriodOrg"],
    ),
    futureTemplate(
      "ATTENDANCE_APPROVER",
      "Attendance Approver",
      "Attendance approval preset.",
      "ATTENDANCE_APPROVAL",
      "ADMIN_CONSOLE",
      ["attendancePeriodOrg"],
    ),
    futureTemplate(
      "MONTHLY_CLOSE_OWNER",
      "Monthly Close Owner",
      "Monthly close ownership preset.",
      "MONTHLY_CLOSE",
      "ADMIN_CONSOLE",
      ["financePeriod", "payrollPeriod"],
    ),
    futureTemplate(
      "PAYROLL_DRAFT_OPS",
      "Payroll Draft Ops",
      "Payroll draft operations preset.",
      "PAYROLL",
      "ADMIN_CONSOLE",
      ["payrollPeriod"],
    ),
    futureTemplate(
      "PAYROLL_DRAFT_APPROVER",
      "Payroll Draft Approver",
      "Payroll draft approval preset.",
      "PAYROLL_APPROVAL",
      "ADMIN_CONSOLE",
      ["payrollPeriod"],
    ),
    template({
      code: "VIEWER_AUDITOR",
      name: "Viewer Auditor",
      description:
        "Read-only auditor preset across operational and commercial modules.",
      category: "AUDIT",
      recommendedAccountContext: "ADMIN_CONSOLE",
      permissions: VIEWER_AUDITOR_PERMISSIONS,
      recommendedScopeGrants: scopeGrants({
        workSchedule: Object.freeze(["global"]),
        eventAssignment: Object.freeze(["global"]),
        contractRegistry: Object.freeze(["global"]),
        talentKpi: Object.freeze(["global"]),
        kpi: Object.freeze(["global"]),
        revenueLedger: Object.freeze(["global"]),
        commission: Object.freeze(["global"]),
        dashboardLite: Object.freeze(["global"]),
      }),
      scopePlan: GLOBAL_SCOPE_PLAN,
      warnings: [
        "Sensitive employment terms read and user/role governance visibility are excluded by default.",
        "No create, update, lifecycle, finalize, approve, void, or reconcile permissions are included.",
      ],
      implementationNotes: [
        "Normalizes VIEWER_AUDITOR as the target auditor role and replaces AUDITOR_READ_ONLY_BUNDLE usage with AUDITOR_BUNDLE.",
      ],
      status: "READY",
    }),
    template({
      code: "STAFF_CONSOLE_USER",
      name: "Staff Console User",
      description: "Read-only self-intended baseline for staff console access.",
      category: "SELF_SERVICE",
      recommendedAccountContext: "STAFF_CONSOLE",
      permissions: STAFF_CONSOLE_PERMISSIONS,
      recommendedScopeGrants: scopeGrants({
        workSchedule: Object.freeze(["self"]),
        kpi: Object.freeze(["self"]),
      }),
      scopePlan: [
        scopePlan("Self Service", ["self"], "REQUIRES_FUTURE_SCOPE"),
        scopePlan("KPI", ["self"], "READY"),
      ],
      warnings: [
        "Self-scope intent relies on route-level object checks; generated permissions alone are not a scope boundary.",
      ],
      implementationNotes: [
        "Replaces legacy TALENT_STAFF_SELF for new role creation and staff-console bundles.",
      ],
      status: "READY",
    }),
  ]);

const CATALOG_BY_CODE = new Map<RoleTemplateCode, RoleTemplateDefinition>(
  ROLE_TEMPLATE_CATALOG.map((item) => [item.code, item]),
);

const LEGACY_BY_CODE = new Map<
  LegacyRoleTemplateCode,
  LegacyRoleTemplateMapping
>(LEGACY_ROLE_TEMPLATE_COMPATIBILITY.map((item) => [item.legacyCode, item]));

validateRoleTemplateCatalog();

export function listRoleTemplates(): readonly RoleTemplateListItem[] {
  return ROLE_TEMPLATE_CATALOG.map((item) => ({
    code: item.code,
    version: item.version,
    name: item.name,
    description: item.description,
    category: item.category,
    recommendedAccountContext: item.recommendedAccountContext,
    scopePlan: item.scopePlan,
    recommendedScopeGrants: item.recommendedScopeGrants,
    warnings: item.warnings,
    implementationNotes: item.implementationNotes,
    status: item.status,
    assignabilityStatus: item.assignabilityStatus,
    featureStatus: item.featureStatus,
    operatorFlowGroup: item.operatorFlowGroup,
    sensitivityLevel: item.sensitivityLevel,
    reviewPolicy: item.reviewPolicy,
    accountContextLifecyclePolicy: item.accountContextLifecyclePolicy,
    responsibilityPolicy: item.responsibilityPolicy,
    scopeSelectorSupport: item.scopeSelectorSupport,
    futureReadinessNote: item.futureReadinessNote,
    legacyVisibility: item.legacyVisibility,
    permissionCount: item.permissions.length,
  }));
}

export function getRoleTemplate(code: string): RoleTemplateDefinition | null {
  const normalized = normalizeRoleTemplateCode(code);
  if (!isRoleTemplateCode(normalized)) {
    return null;
  }

  return CATALOG_BY_CODE.get(normalized) ?? null;
}

export function getLegacyRoleTemplateMapping(
  code: string,
): LegacyRoleTemplateMapping | null {
  const normalized = normalizeRoleTemplateCode(code);
  if (!isLegacyRoleTemplateCode(normalized)) {
    return null;
  }

  return LEGACY_BY_CODE.get(normalized) ?? null;
}

export function isRoleTemplateCode(code: string): code is RoleTemplateCode {
  return ROLE_TEMPLATE_CODES.includes(code as RoleTemplateCode);
}

export function isLegacyRoleTemplateCode(
  code: string,
): code is LegacyRoleTemplateCode {
  return LEGACY_ROLE_TEMPLATE_CODES.includes(code as LegacyRoleTemplateCode);
}

export function normalizeRoleTemplateCode(code: string): string {
  return code.trim().toUpperCase();
}

export function validateRoleTemplateCatalog(): void {
  const knownPermissionCodes = new Set<string>(Object.values(Permission));
  const seenCodes = new Set<string>();

  for (const item of ROLE_TEMPLATE_CATALOG) {
    if (seenCodes.has(item.code)) {
      throw new Error(`Duplicate role template code: ${item.code}`);
    }
    seenCodes.add(item.code);

    const seenPermissions = new Set<Permission>();
    for (const permission of item.permissions) {
      if (!knownPermissionCodes.has(permission)) {
        throw new Error(
          `Role template ${item.code} contains unknown permission: ${permission}`,
        );
      }

      if (seenPermissions.has(permission)) {
        throw new Error(
          `Role template ${item.code} contains duplicate permission: ${permission}`,
        );
      }

      seenPermissions.add(permission);
    }
  }

  const expectedCodes = [...ROLE_TEMPLATE_CODES].sort();
  const actualCodes = [...seenCodes].sort();

  if (
    expectedCodes.length !== actualCodes.length ||
    expectedCodes.some((code, index) => code !== actualCodes[index])
  ) {
    throw new Error(
      `Role template catalog must contain exactly: ${expectedCodes.join(", ")}`,
    );
  }
}

export interface RoleTemplateAssignabilityBlocker {
  readonly code:
    | "ROLE_TEMPLATE_NOT_FOUND"
    | "ROLE_TEMPLATE_FUTURE_GATED"
    | "ROLE_TEMPLATE_HAS_NO_PERMISSIONS"
    | "ROLE_TEMPLATE_UNSUPPORTED_SCOPE_SELECTOR"
    | "ROLE_TEMPLATE_NOT_ASSIGNABLE";
  readonly summary: string;
}

export interface RoleTemplateAssignabilityDecision {
  readonly assignable: boolean;
  readonly blockers: readonly RoleTemplateAssignabilityBlocker[];
}

export function evaluateRoleTemplateAssignability(
  template: RoleTemplateDefinition | RoleTemplateListItem | null | undefined,
): RoleTemplateAssignabilityDecision {
  if (!template) {
    return {
      assignable: false,
      blockers: [
        {
          code: "ROLE_TEMPLATE_NOT_FOUND",
          summary: "Role template is not present in the active catalog.",
        },
      ],
    };
  }

  const blockers: RoleTemplateAssignabilityBlocker[] = [];
  const permissionCount =
    "permissionCount" in template
      ? template.permissionCount
      : template.permissions.length;

  if (permissionCount === 0) {
    blockers.push({
      code: "ROLE_TEMPLATE_HAS_NO_PERMISSIONS",
      summary: "Role template has no source-backed permissions.",
    });
  }
  if (template.scopeSelectorSupport === "UNSUPPORTED") {
    blockers.push({
      code: "ROLE_TEMPLATE_UNSUPPORTED_SCOPE_SELECTOR",
      summary:
        template.futureReadinessNote ??
        "Role template requires an unsupported assignment scope selector.",
    });
  }
  if (
    template.status === "REQUIRES_FUTURE_SCOPE" ||
    template.futureReadinessNote
  ) {
    blockers.push({
      code: "ROLE_TEMPLATE_FUTURE_GATED",
      summary:
        template.futureReadinessNote ??
        "Role template is explicitly gated for future source readiness.",
    });
  }
  if (!ASSIGNABLE_ROLE_TEMPLATE_STATUSES.has(template.assignabilityStatus)) {
    blockers.push({
      code: "ROLE_TEMPLATE_NOT_ASSIGNABLE",
      summary: `Role template assignability status is ${template.assignabilityStatus}.`,
    });
  }

  return {
    assignable: blockers.length === 0,
    blockers: Object.freeze(blockers),
  };
}

export function isRoleTemplateAssignable(
  template: RoleTemplateDefinition | RoleTemplateListItem | null | undefined,
): boolean {
  return evaluateRoleTemplateAssignability(template).assignable;
}

export function isOperatorSupportedRoleAssignmentScopeType(
  scopeType: RoleAssignmentScopeType,
): boolean {
  return OPERATOR_SUPPORTED_SCOPE_SELECTORS.has(scopeType);
}

function template(
  definition: RoleTemplateDefinitionInput,
): RoleTemplateDefinition {
  const metadata = buildRoleTemplateMetadata(definition);
  return Object.freeze({
    ...definition,
    ...metadata,
    version: TEMPLATE_VERSION,
    permissions: Object.freeze([...definition.permissions]),
    recommendedScopeGrants: scopeGrants(definition.recommendedScopeGrants),
    scopePlan: Object.freeze([...definition.scopePlan]),
    warnings: Object.freeze([...definition.warnings]),
    implementationNotes: Object.freeze([...definition.implementationNotes]),
  });
}

function futureTemplate(
  code: RoleTemplateCode,
  name: string,
  description: string,
  category: string,
  recommendedAccountContext: AccountContext,
  scopes: readonly string[],
): RoleTemplateDefinition {
  return template({
    code,
    name,
    description,
    category,
    recommendedAccountContext,
    permissions: Object.freeze([]),
    recommendedScopeGrants: scopeGrants({}),
    scopePlan: [scopePlan(name, scopes, "REQUIRES_FUTURE_SCOPE")],
    warnings: [
      "No source permission keys exist for this target role yet; this placeholder grants no runtime permissions.",
    ],
    implementationNotes: [
      "Kept in the active catalog so target role/bundle codes are stable while implementation catches up.",
    ],
    status: "REQUIRES_FUTURE_SCOPE",
  });
}

function legacyMap(
  legacyCode: LegacyRoleTemplateCode,
  replacementRoleCodes: readonly RoleTemplateCode[],
  replacementBundleCodes: readonly string[],
): LegacyRoleTemplateMapping {
  return Object.freeze({
    legacyCode,
    replacementRoleCodes: Object.freeze([...replacementRoleCodes]),
    replacementBundleCodes: Object.freeze([...replacementBundleCodes]),
    note: "Compatibility metadata only; legacy code is not returned by the active template catalog and cannot be used for new template creation.",
  });
}

function scopePlan(
  module: string,
  scopes: readonly string[],
  status: RoleTemplateStatus,
  note = "Scope plan records target policy intent; runtime enforcement remains permission and route-guard based unless the module already materializes assignment scope.",
): RoleTemplateScopePlanEntry {
  return Object.freeze({
    module,
    scopes: Object.freeze([...scopes]),
    status,
    note,
  });
}

function scopeGrants(grants: ActorScopeGrants): Readonly<ActorScopeGrants> {
  return Object.freeze(grants);
}

export function operatorRequiredScopeTypesForRoleTemplate(
  code: string,
): readonly RoleAssignmentScopeType[] {
  const normalized = normalizeRoleTemplateCode(code);
  switch (normalized) {
    case "OWNER_ADMIN":
    case "ACCESS_ADMIN":
    case "KPI_OPERATIONS":
    case "VIEWER_AUDITOR":
      return Object.freeze(["global"]);
    case "HR_OPERATIONS":
    case "HR_TERMS_APPROVER":
      return Object.freeze(["managedOrgUnit"]);
    case "PRODUCTION_OPS":
      return Object.freeze(["assignedEvent", "assignedStudioResource"]);
    case "PLATFORM_CHANNEL_OPS":
      return Object.freeze(["assignedPlatformAccount"]);
    case "CREATIVE_VISUAL_LEAD":
    case "CONTENT_OPS":
      return Object.freeze(["managedTalentGroup", "assignedEvent"]);
    case "TALENT_GROUP_MANAGER":
      return Object.freeze(["managedTalentGroup"]);
    case "ORG_UNIT_MANAGER":
      return Object.freeze(["managedOrgUnit"]);
    case "COMMERCIAL_CONTRACT_OPS":
      return Object.freeze(["contractPortfolio"]);
    case "REVENUE_FINANCE_OPS":
    case "REVENUE_APPROVER":
    case "REVENUE_RECONCILER":
    case "COMMISSION_OPS":
    case "COMMISSION_APPROVER":
      return Object.freeze(["financeGlobal", "financePeriod"]);
    case "ATTENDANCE_OPS":
    case "LEAVE_REVIEWER":
    case "ATTENDANCE_APPROVER":
      return Object.freeze(["attendancePeriodOrg"]);
    case "MONTHLY_CLOSE_OWNER":
      return Object.freeze(["financePeriod", "payrollPeriod"]);
    case "PAYROLL_DRAFT_OPS":
    case "PAYROLL_DRAFT_APPROVER":
      return Object.freeze(["payrollPeriod"]);
    case "STAFF_CONSOLE_USER":
      return Object.freeze(["self"]);
    default:
      return Object.freeze([]);
  }
}

function buildRoleTemplateMetadata(
  definition: RoleTemplateDefinitionInput,
): Pick<
  RoleTemplateDefinition,
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
  const requiredScopes = operatorRequiredScopeTypesForRoleTemplate(
    definition.code,
  );
  const unsupportedScopes = requiredScopes.filter(
    (scopeType) => !OPERATOR_SUPPORTED_SCOPE_SELECTORS.has(scopeType),
  );
  const scopeSelectorSupport =
    requiredScopes.length === 0
      ? "NOT_REQUIRED"
      : unsupportedScopes.length > 0
        ? "UNSUPPORTED"
        : "SUPPORTED";
  const futureReadinessNote =
    definition.permissions.length === 0
      ? "This target role code is reserved for a future source-backed module."
      : scopeSelectorSupport === "UNSUPPORTED"
        ? `Operator scope selector support is not available for: ${unsupportedScopes.join(", ")}.`
        : null;
  const featureStatus =
    definition.permissions.length === 0
      ? "FUTURE_READY"
      : definition.status === "READY" && !futureReadinessNote
        ? "SOURCE_BACKED"
        : "PARTIAL_SOURCE_BACKED";
  const sensitivityLevel = RESTRICTED_SENSITIVE_ROLE_CODES.has(definition.code)
    ? "HIGH_RISK"
    : definition.warnings.some((warning) =>
          /sensitive|approval|approve|void|lifecycle/iu.test(warning),
        )
      ? "SENSITIVE"
      : "STANDARD";
  const reviewPolicy =
    sensitivityLevel === "STANDARD" && !requiredScopes.includes("global")
      ? "NOT_REQUIRED"
      : "REVIEW_REQUIRED";
  const responsibilityPolicy =
    definition.code === "TALENT_GROUP_MANAGER" ||
    definition.code === "ORG_UNIT_MANAGER"
      ? "REQUIRES_EXISTING_RESPONSIBILITY"
      : "NOT_REQUIRED";
  const assignabilityStatus = classifyAssignability({
    code: definition.code,
    futureReadinessNote,
    requiredScopes,
    sensitivityLevel,
  });

  return {
    assignabilityStatus,
    featureStatus,
    operatorFlowGroup: flowGroupForAssignability(assignabilityStatus),
    sensitivityLevel,
    reviewPolicy,
    accountContextLifecyclePolicy: "SYSTEM_DERIVED_PREVIEW_ONLY",
    responsibilityPolicy,
    scopeSelectorSupport,
    futureReadinessNote,
    legacyVisibility: "NORMAL_OPERATOR",
  };
}

function classifyAssignability(params: {
  readonly code: RoleTemplateCode;
  readonly futureReadinessNote: string | null;
  readonly requiredScopes: readonly RoleAssignmentScopeType[];
  readonly sensitivityLevel: RoleSensitivityLevel;
}): RoleAssignabilityStatus {
  if (params.futureReadinessNote) {
    return "FUTURE_READY_CONDITION";
  }
  if (params.code === "VIEWER_AUDITOR") {
    return "READ_ONLY_AUDIT";
  }
  if (params.sensitivityLevel !== "STANDARD") {
    return "RESTRICTED_SENSITIVE";
  }
  if (params.requiredScopes.length > 0) {
    return "REQUIRES_SCOPE_SELECTION";
  }
  return "READY_ASSIGNABLE";
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
