import { Permission } from "@core/permission/permission.enum";
import { ContextType } from "../context/context.types";

/**
 * Risk level used by audit & security analytics.
 */
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

/**
 * PermissionContract is a SECURITY POLICY DECLARATION.
 * - Not RBAC
 * - Not authorization logic
 * - Machine-readable security intent
 */
export interface PermissionContract {
  readonly code: Permission;
  readonly context: ContextType;
  readonly resource: string;
  readonly auditAction: string;
  readonly riskLevel: RiskLevel;
}

export type PermissionContractRegistry = {
  readonly [permission in Permission]: PermissionContract & {
    readonly code: permission;
  };
};

/**
 * CENTRAL PERMISSION REGISTRY — V2 (SECURITY-FIRST)
 * ❗ Every Permission enum MUST appear exactly once here
 */
export const PermissionContracts: PermissionContractRegistry =
  Object.freeze({
  /* =========================
     USER
  ========================= */
  [Permission.USER_VIEW]: {
    code: Permission.USER_VIEW,
    context: "ADMIN",
    resource: "USER",
    auditAction: "user.view",
    riskLevel: "LOW",
  },
  [Permission.USER_CREATE]: {
    code: Permission.USER_CREATE,
    context: "ADMIN",
    resource: "USER",
    auditAction: "user.create",
    riskLevel: "HIGH",
  },
  [Permission.USER_EDIT]: {
    code: Permission.USER_EDIT,
    context: "ADMIN",
    resource: "USER",
    auditAction: "user.edit",
    riskLevel: "HIGH",
  },
  [Permission.USER_ACTIVATE]: {
    code: Permission.USER_ACTIVATE,
    context: "ADMIN",
    resource: "USER",
    auditAction: "user.activate",
    riskLevel: "HIGH",
  },
  [Permission.USER_DISABLE]: {
    code: Permission.USER_DISABLE,
    context: "ADMIN",
    resource: "USER",
    auditAction: "user.disable",
    riskLevel: "CRITICAL",
  },
  [Permission.USER_ARCHIVE]: {
    code: Permission.USER_ARCHIVE,
    context: "ADMIN",
    resource: "USER",
    auditAction: "user.archive",
    riskLevel: "CRITICAL",
  },
  [Permission.USER_AUTH_LINKAGE_SET]: {
    code: Permission.USER_AUTH_LINKAGE_SET,
    context: "ADMIN",
    resource: "USER",
    auditAction: "user.auth_linkage.set",
    riskLevel: "CRITICAL",
  },

  /* =========================
     ROLE
  ========================= */
  [Permission.ROLE_LIST]: {
    code: Permission.ROLE_LIST,
    context: "ADMIN",
    resource: "ROLE",
    auditAction: "role.list",
    riskLevel: "LOW",
  },
  [Permission.ROLE_VIEW]: {
    code: Permission.ROLE_VIEW,
    context: "ADMIN",
    resource: "ROLE",
    auditAction: "role.view",
    riskLevel: "LOW",
  },
  [Permission.ROLE_CREATE]: {
    code: Permission.ROLE_CREATE,
    context: "ADMIN",
    resource: "ROLE",
    auditAction: "role.create",
    riskLevel: "HIGH",
  },
  [Permission.ROLE_UPDATE]: {
    code: Permission.ROLE_UPDATE,
    context: "ADMIN",
    resource: "ROLE",
    auditAction: "role.update",
    riskLevel: "HIGH",
  },
  [Permission.ROLE_ACTIVATE]: {
    code: Permission.ROLE_ACTIVATE,
    context: "ADMIN",
    resource: "ROLE",
    auditAction: "role.activate",
    riskLevel: "HIGH",
  },
  [Permission.ROLE_DEACTIVATE]: {
    code: Permission.ROLE_DEACTIVATE,
    context: "ADMIN",
    resource: "ROLE",
    auditAction: "role.deactivate",
    riskLevel: "HIGH",
  },
  [Permission.ROLE_ARCHIVE]: {
    code: Permission.ROLE_ARCHIVE,
    context: "ADMIN",
    resource: "ROLE",
    auditAction: "role.archive",
    riskLevel: "CRITICAL",
  },
  [Permission.ROLE_PERMISSION_ASSIGN]: {
    code: Permission.ROLE_PERMISSION_ASSIGN,
    context: "ADMIN",
    resource: "ROLE",
    auditAction: "role.permissions.assign",
    riskLevel: "CRITICAL",
  },
  [Permission.ROLE_ASSIGNMENT_RULE_SET]: {
    code: Permission.ROLE_ASSIGNMENT_RULE_SET,
    context: "ADMIN",
    resource: "ROLE",
    auditAction: "role.assignment_rule.set",
    riskLevel: "HIGH",
  },
  [Permission.ROLE_ASSIGN_TO_USER]: {
    code: Permission.ROLE_ASSIGN_TO_USER,
    context: "ADMIN",
    resource: "ROLE",
    auditAction: "role.assign_to_user",
    riskLevel: "HIGH",
  },
  [Permission.ROLE_REVOKE_FROM_USER]: {
    code: Permission.ROLE_REVOKE_FROM_USER,
    context: "ADMIN",
    resource: "ROLE",
    auditAction: "role.revoke_from_user",
    riskLevel: "HIGH",
  },
  [Permission.ROLE_ASSIGNMENT_VIEW]: {
    code: Permission.ROLE_ASSIGNMENT_VIEW,
    context: "ADMIN",
    resource: "ROLE",
    auditAction: "role.assignment.view",
    riskLevel: "LOW",
  },

  /* =========================
     ORG UNIT
  ========================= */
  [Permission.ORG_UNIT_READ]: {
    code: Permission.ORG_UNIT_READ,
    context: "ADMIN",
    resource: "ORG_UNIT",
    auditAction: "org-unit.read",
    riskLevel: "LOW",
  },
  [Permission.ORG_UNIT_CREATE]: {
    code: Permission.ORG_UNIT_CREATE,
    context: "ADMIN",
    resource: "ORG_UNIT",
    auditAction: "org-unit.create",
    riskLevel: "HIGH",
  },
  [Permission.ORG_UNIT_UPDATE]: {
    code: Permission.ORG_UNIT_UPDATE,
    context: "ADMIN",
    resource: "ORG_UNIT",
    auditAction: "org-unit.update",
    riskLevel: "HIGH",
  },
  [Permission.ORG_UNIT_MANAGE_HIERARCHY]: {
    code: Permission.ORG_UNIT_MANAGE_HIERARCHY,
    context: "ADMIN",
    resource: "ORG_UNIT",
    auditAction: "org-unit.manage-hierarchy",
    riskLevel: "HIGH",
  },
  [Permission.ORG_UNIT_MANAGE_LIFECYCLE]: {
    code: Permission.ORG_UNIT_MANAGE_LIFECYCLE,
    context: "ADMIN",
    resource: "ORG_UNIT",
    auditAction: "org-unit.manage-lifecycle",
    riskLevel: "CRITICAL",
  },

  /* =========================
     EMPLOYMENT PROFILE
  ========================= */
  [Permission.EMPLOYMENT_PROFILE_READ]: {
    code: Permission.EMPLOYMENT_PROFILE_READ,
    context: "ADMIN",
    resource: "EMPLOYMENT_PROFILE",
    auditAction: "employment-profile.read",
    riskLevel: "LOW",
  },
  [Permission.EMPLOYMENT_PROFILE_CREATE]: {
    code: Permission.EMPLOYMENT_PROFILE_CREATE,
    context: "ADMIN",
    resource: "EMPLOYMENT_PROFILE",
    auditAction: "employment-profile.create",
    riskLevel: "HIGH",
  },
  [Permission.EMPLOYMENT_PROFILE_UPDATE]: {
    code: Permission.EMPLOYMENT_PROFILE_UPDATE,
    context: "ADMIN",
    resource: "EMPLOYMENT_PROFILE",
    auditAction: "employment-profile.update",
    riskLevel: "HIGH",
  },
  [Permission.EMPLOYMENT_PROFILE_MANAGE_ORG_ASSIGNMENT]: {
    code: Permission.EMPLOYMENT_PROFILE_MANAGE_ORG_ASSIGNMENT,
    context: "ADMIN",
    resource: "EMPLOYMENT_PROFILE",
    auditAction: "employment-profile.manage-org-assignment",
    riskLevel: "HIGH",
  },
  [Permission.EMPLOYMENT_PROFILE_MANAGE_MANAGER_ASSIGNMENT]: {
    code: Permission.EMPLOYMENT_PROFILE_MANAGE_MANAGER_ASSIGNMENT,
    context: "ADMIN",
    resource: "EMPLOYMENT_PROFILE",
    auditAction: "employment-profile.manage-manager-assignment",
    riskLevel: "HIGH",
  },
  [Permission.EMPLOYMENT_PROFILE_MANAGE_USER_LINKAGE]: {
    code: Permission.EMPLOYMENT_PROFILE_MANAGE_USER_LINKAGE,
    context: "ADMIN",
    resource: "EMPLOYMENT_PROFILE",
    auditAction: "employment-profile.manage-user-linkage",
    riskLevel: "CRITICAL",
  },
  [Permission.EMPLOYMENT_PROFILE_MANAGE_LIFECYCLE]: {
    code: Permission.EMPLOYMENT_PROFILE_MANAGE_LIFECYCLE,
    context: "ADMIN",
    resource: "EMPLOYMENT_PROFILE",
    auditAction: "employment-profile.manage-lifecycle",
    riskLevel: "CRITICAL",
  },

  /* =========================
     TALENT
  ========================= */
  [Permission.TALENT_READ]: {
    code: Permission.TALENT_READ,
    context: "ADMIN",
    resource: "TALENT",
    auditAction: "talent.read",
    riskLevel: "LOW",
  },
  [Permission.TALENT_CREATE]: {
    code: Permission.TALENT_CREATE,
    context: "ADMIN",
    resource: "TALENT",
    auditAction: "talent.create",
    riskLevel: "HIGH",
  },
  [Permission.TALENT_UPDATE]: {
    code: Permission.TALENT_UPDATE,
    context: "ADMIN",
    resource: "TALENT",
    auditAction: "talent.update",
    riskLevel: "HIGH",
  },
  [Permission.TALENT_MANAGE_MANAGER]: {
    code: Permission.TALENT_MANAGE_MANAGER,
    context: "ADMIN",
    resource: "TALENT",
    auditAction: "talent.manage-manager",
    riskLevel: "HIGH",
  },
  [Permission.TALENT_MANAGE_EMPLOYMENT_LINK]: {
    code: Permission.TALENT_MANAGE_EMPLOYMENT_LINK,
    context: "ADMIN",
    resource: "TALENT",
    auditAction: "talent.manage-employment-link",
    riskLevel: "CRITICAL",
  },
  [Permission.TALENT_MANAGE_LIFECYCLE]: {
    code: Permission.TALENT_MANAGE_LIFECYCLE,
    context: "ADMIN",
    resource: "TALENT",
    auditAction: "talent.manage-lifecycle",
    riskLevel: "CRITICAL",
  },
  [Permission.TALENT_MANAGE_COMMERCIAL_PARTICIPATION]: {
    code: Permission.TALENT_MANAGE_COMMERCIAL_PARTICIPATION,
    context: "ADMIN",
    resource: "TALENT",
    auditAction: "talent.manage-commercial-participation",
    riskLevel: "HIGH",
  },

  /* =========================
     TALENT GROUP
  ========================= */
  [Permission.TALENT_GROUP_READ]: {
    code: Permission.TALENT_GROUP_READ,
    context: "ADMIN",
    resource: "TALENT_GROUP",
    auditAction: "talent-group.read",
    riskLevel: "LOW",
  },
  [Permission.TALENT_GROUP_CREATE]: {
    code: Permission.TALENT_GROUP_CREATE,
    context: "ADMIN",
    resource: "TALENT_GROUP",
    auditAction: "talent-group.create",
    riskLevel: "HIGH",
  },
  [Permission.TALENT_GROUP_UPDATE]: {
    code: Permission.TALENT_GROUP_UPDATE,
    context: "ADMIN",
    resource: "TALENT_GROUP",
    auditAction: "talent-group.update",
    riskLevel: "HIGH",
  },
  [Permission.TALENT_GROUP_MANAGE_LIFECYCLE]: {
    code: Permission.TALENT_GROUP_MANAGE_LIFECYCLE,
    context: "ADMIN",
    resource: "TALENT_GROUP",
    auditAction: "talent-group.manage-lifecycle",
    riskLevel: "CRITICAL",
  },
  [Permission.TALENT_GROUP_MANAGE_MEMBERSHIP]: {
    code: Permission.TALENT_GROUP_MANAGE_MEMBERSHIP,
    context: "ADMIN",
    resource: "TALENT_GROUP",
    auditAction: "talent-group.manage-membership",
    riskLevel: "HIGH",
  },

  /* =========================
     PLATFORM ACCOUNT
  ========================= */
  [Permission.PLATFORM_ACCOUNT_READ]: {
    code: Permission.PLATFORM_ACCOUNT_READ,
    context: "ADMIN",
    resource: "PLATFORM_ACCOUNT",
    auditAction: "platform-account.read",
    riskLevel: "LOW",
  },
  [Permission.PLATFORM_ACCOUNT_CREATE]: {
    code: Permission.PLATFORM_ACCOUNT_CREATE,
    context: "ADMIN",
    resource: "PLATFORM_ACCOUNT",
    auditAction: "platform-account.create",
    riskLevel: "HIGH",
  },
  [Permission.PLATFORM_ACCOUNT_UPDATE]: {
    code: Permission.PLATFORM_ACCOUNT_UPDATE,
    context: "ADMIN",
    resource: "PLATFORM_ACCOUNT",
    auditAction: "platform-account.update",
    riskLevel: "HIGH",
  },
  [Permission.PLATFORM_ACCOUNT_MANAGE_OWNERSHIP]: {
    code: Permission.PLATFORM_ACCOUNT_MANAGE_OWNERSHIP,
    context: "ADMIN",
    resource: "PLATFORM_ACCOUNT",
    auditAction: "platform-account.manage-ownership",
    riskLevel: "HIGH",
  },
  [Permission.PLATFORM_ACCOUNT_MANAGE_LIFECYCLE]: {
    code: Permission.PLATFORM_ACCOUNT_MANAGE_LIFECYCLE,
    context: "ADMIN",
    resource: "PLATFORM_ACCOUNT",
    auditAction: "platform-account.manage-lifecycle",
    riskLevel: "CRITICAL",
  },
  [Permission.PLATFORM_ACCOUNT_MANAGE_CAPABILITIES]: {
    code: Permission.PLATFORM_ACCOUNT_MANAGE_CAPABILITIES,
    context: "ADMIN",
    resource: "PLATFORM_ACCOUNT",
    auditAction: "platform-account.manage-capabilities",
    riskLevel: "HIGH",
  },

  /* =========================
     STUDIO RESOURCE
  ========================= */
  [Permission.STUDIO_RESOURCE_READ]: {
    code: Permission.STUDIO_RESOURCE_READ,
    context: "ADMIN",
    resource: "STUDIO_RESOURCE",
    auditAction: "studio-resource.read",
    riskLevel: "LOW",
  },
  [Permission.STUDIO_RESOURCE_CREATE]: {
    code: Permission.STUDIO_RESOURCE_CREATE,
    context: "ADMIN",
    resource: "STUDIO_RESOURCE",
    auditAction: "studio-resource.create",
    riskLevel: "HIGH",
  },
  [Permission.STUDIO_RESOURCE_UPDATE]: {
    code: Permission.STUDIO_RESOURCE_UPDATE,
    context: "ADMIN",
    resource: "STUDIO_RESOURCE",
    auditAction: "studio-resource.update",
    riskLevel: "HIGH",
  },
  [Permission.STUDIO_RESOURCE_MANAGE_AVAILABILITY]: {
    code: Permission.STUDIO_RESOURCE_MANAGE_AVAILABILITY,
    context: "ADMIN",
    resource: "STUDIO_RESOURCE",
    auditAction: "studio-resource.manage-availability",
    riskLevel: "HIGH",
  },
  [Permission.STUDIO_RESOURCE_MANAGE_LIFECYCLE]: {
    code: Permission.STUDIO_RESOURCE_MANAGE_LIFECYCLE,
    context: "ADMIN",
    resource: "STUDIO_RESOURCE",
    auditAction: "studio-resource.manage-lifecycle",
    riskLevel: "CRITICAL",
  },

  /* =========================
     EVENT ASSIGNMENT
  ========================= */
  [Permission.EVENT_READ]: {
    code: Permission.EVENT_READ,
    context: "ADMIN",
    resource: "EVENT_ASSIGNMENT",
    auditAction: "event-assignment.read",
    riskLevel: "LOW",
  },
  [Permission.EVENT_CREATE]: {
    code: Permission.EVENT_CREATE,
    context: "ADMIN",
    resource: "EVENT_ASSIGNMENT",
    auditAction: "event-assignment.create",
    riskLevel: "HIGH",
  },
  [Permission.EVENT_UPDATE]: {
    code: Permission.EVENT_UPDATE,
    context: "ADMIN",
    resource: "EVENT_ASSIGNMENT",
    auditAction: "event-assignment.update",
    riskLevel: "HIGH",
  },
  [Permission.EVENT_MANAGE_ASSIGNMENTS]: {
    code: Permission.EVENT_MANAGE_ASSIGNMENTS,
    context: "ADMIN",
    resource: "EVENT_ASSIGNMENT",
    auditAction: "event-assignment.manage-assignments",
    riskLevel: "HIGH",
  },
  [Permission.EVENT_MANAGE_LIFECYCLE]: {
    code: Permission.EVENT_MANAGE_LIFECYCLE,
    context: "ADMIN",
    resource: "EVENT_ASSIGNMENT",
    auditAction: "event-assignment.manage-lifecycle",
    riskLevel: "CRITICAL",
  },

  /* =========================
     WORK SCHEDULE
  ========================= */
  [Permission.WORK_SCHEDULE_READ]: {
    code: Permission.WORK_SCHEDULE_READ,
    context: "ADMIN",
    resource: "WORK_SCHEDULE",
    auditAction: "work-schedule.read",
    riskLevel: "LOW",
  },
  [Permission.WORK_SCHEDULE_CREATE]: {
    code: Permission.WORK_SCHEDULE_CREATE,
    context: "ADMIN",
    resource: "WORK_SCHEDULE",
    auditAction: "work-schedule.create",
    riskLevel: "HIGH",
  },
  [Permission.WORK_SCHEDULE_UPDATE]: {
    code: Permission.WORK_SCHEDULE_UPDATE,
    context: "ADMIN",
    resource: "WORK_SCHEDULE",
    auditAction: "work-schedule.update",
    riskLevel: "HIGH",
  },
  [Permission.WORK_SCHEDULE_MANAGE_LIFECYCLE]: {
    code: Permission.WORK_SCHEDULE_MANAGE_LIFECYCLE,
    context: "ADMIN",
    resource: "WORK_SCHEDULE",
    auditAction: "work-schedule.manage-lifecycle",
    riskLevel: "CRITICAL",
  },

  /* =========================
     CONTRACT REGISTRY
  ========================= */
  [Permission.CONTRACT_REGISTRY_READ]: {
    code: Permission.CONTRACT_REGISTRY_READ,
    context: "ADMIN",
    resource: "CONTRACT_REGISTRY",
    auditAction: "contract-registry.read",
    riskLevel: "LOW",
  },
  [Permission.CONTRACT_REGISTRY_CREATE]: {
    code: Permission.CONTRACT_REGISTRY_CREATE,
    context: "ADMIN",
    resource: "CONTRACT_REGISTRY",
    auditAction: "contract-registry.create",
    riskLevel: "HIGH",
  },
  [Permission.CONTRACT_REGISTRY_UPDATE]: {
    code: Permission.CONTRACT_REGISTRY_UPDATE,
    context: "ADMIN",
    resource: "CONTRACT_REGISTRY",
    auditAction: "contract-registry.update",
    riskLevel: "HIGH",
  },
  [Permission.CONTRACT_REGISTRY_MANAGE_OWNER]: {
    code: Permission.CONTRACT_REGISTRY_MANAGE_OWNER,
    context: "ADMIN",
    resource: "CONTRACT_REGISTRY",
    auditAction: "contract-registry.manage-owner",
    riskLevel: "HIGH",
  },
  [Permission.CONTRACT_REGISTRY_MANAGE_FILE_REFERENCE]: {
    code: Permission.CONTRACT_REGISTRY_MANAGE_FILE_REFERENCE,
    context: "ADMIN",
    resource: "CONTRACT_REGISTRY",
    auditAction: "contract-registry.manage-file-reference",
    riskLevel: "HIGH",
  },
  [Permission.CONTRACT_REGISTRY_MANAGE_LIFECYCLE]: {
    code: Permission.CONTRACT_REGISTRY_MANAGE_LIFECYCLE,
    context: "ADMIN",
    resource: "CONTRACT_REGISTRY",
    auditAction: "contract-registry.manage-lifecycle",
    riskLevel: "CRITICAL",
  },

  /* =========================
     TALENT KPI
  ========================= */
  [Permission.TALENT_KPI_READ]: {
    code: Permission.TALENT_KPI_READ,
    context: "ADMIN",
    resource: "TALENT_KPI",
    auditAction: "talent-kpi.read",
    riskLevel: "LOW",
  },
  [Permission.TALENT_KPI_CREATE]: {
    code: Permission.TALENT_KPI_CREATE,
    context: "ADMIN",
    resource: "TALENT_KPI",
    auditAction: "talent-kpi.create",
    riskLevel: "HIGH",
  },
  [Permission.TALENT_KPI_UPDATE]: {
    code: Permission.TALENT_KPI_UPDATE,
    context: "ADMIN",
    resource: "TALENT_KPI",
    auditAction: "talent-kpi.update",
    riskLevel: "HIGH",
  },
  [Permission.TALENT_KPI_MANAGE_METRICS]: {
    code: Permission.TALENT_KPI_MANAGE_METRICS,
    context: "ADMIN",
    resource: "TALENT_KPI",
    auditAction: "talent-kpi.manage-metrics",
    riskLevel: "HIGH",
  },
  [Permission.TALENT_KPI_MANAGE_LIFECYCLE]: {
    code: Permission.TALENT_KPI_MANAGE_LIFECYCLE,
    context: "ADMIN",
    resource: "TALENT_KPI",
    auditAction: "talent-kpi.manage-lifecycle",
    riskLevel: "CRITICAL",
  },

  /* =========================
     COMMISSION
  ========================= */
  [Permission.COMMISSION_RULE_READ]: {
    code: Permission.COMMISSION_RULE_READ,
    context: "ADMIN",
    resource: "COMMISSION_RULE",
    auditAction: "commission-rule.read",
    riskLevel: "LOW",
  },
  [Permission.COMMISSION_RULE_CREATE]: {
    code: Permission.COMMISSION_RULE_CREATE,
    context: "ADMIN",
    resource: "COMMISSION_RULE",
    auditAction: "commission-rule.create",
    riskLevel: "HIGH",
  },
  [Permission.COMMISSION_RULE_UPDATE]: {
    code: Permission.COMMISSION_RULE_UPDATE,
    context: "ADMIN",
    resource: "COMMISSION_RULE",
    auditAction: "commission-rule.update",
    riskLevel: "HIGH",
  },
  [Permission.COMMISSION_RULE_MANAGE_LIFECYCLE]: {
    code: Permission.COMMISSION_RULE_MANAGE_LIFECYCLE,
    context: "ADMIN",
    resource: "COMMISSION_RULE",
    auditAction: "commission-rule.manage-lifecycle",
    riskLevel: "CRITICAL",
  },
  [Permission.COMMISSION_SETTLEMENT_READ]: {
    code: Permission.COMMISSION_SETTLEMENT_READ,
    context: "ADMIN",
    resource: "COMMISSION_SETTLEMENT",
    auditAction: "commission-settlement.read",
    riskLevel: "LOW",
  },
  [Permission.COMMISSION_SETTLEMENT_CREATE]: {
    code: Permission.COMMISSION_SETTLEMENT_CREATE,
    context: "ADMIN",
    resource: "COMMISSION_SETTLEMENT",
    auditAction: "commission-settlement.create",
    riskLevel: "HIGH",
  },
  [Permission.COMMISSION_SETTLEMENT_UPDATE]: {
    code: Permission.COMMISSION_SETTLEMENT_UPDATE,
    context: "ADMIN",
    resource: "COMMISSION_SETTLEMENT",
    auditAction: "commission-settlement.update",
    riskLevel: "HIGH",
  },
  [Permission.COMMISSION_SETTLEMENT_MANAGE_LIFECYCLE]: {
    code: Permission.COMMISSION_SETTLEMENT_MANAGE_LIFECYCLE,
    context: "ADMIN",
    resource: "COMMISSION_SETTLEMENT",
    auditAction: "commission-settlement.manage-lifecycle",
    riskLevel: "CRITICAL",
  },

  /* =========================
     REVENUE LEDGER
  ========================= */
  [Permission.REVENUE_LEDGER_READ]: {
    code: Permission.REVENUE_LEDGER_READ,
    context: "ADMIN",
    resource: "REVENUE_LEDGER",
    auditAction: "revenue-ledger.read",
    riskLevel: "LOW",
  },
  [Permission.REVENUE_LEDGER_CREATE]: {
    code: Permission.REVENUE_LEDGER_CREATE,
    context: "ADMIN",
    resource: "REVENUE_LEDGER",
    auditAction: "revenue-ledger.create",
    riskLevel: "HIGH",
  },
  [Permission.REVENUE_LEDGER_UPDATE]: {
    code: Permission.REVENUE_LEDGER_UPDATE,
    context: "ADMIN",
    resource: "REVENUE_LEDGER",
    auditAction: "revenue-ledger.update",
    riskLevel: "HIGH",
  },
  [Permission.REVENUE_LEDGER_MANAGE_LIFECYCLE]: {
    code: Permission.REVENUE_LEDGER_MANAGE_LIFECYCLE,
    context: "ADMIN",
    resource: "REVENUE_LEDGER",
    auditAction: "revenue-ledger.manage-lifecycle",
    riskLevel: "CRITICAL",
  },
  [Permission.REVENUE_LEDGER_RECONCILE]: {
    code: Permission.REVENUE_LEDGER_RECONCILE,
    context: "ADMIN",
    resource: "REVENUE_LEDGER",
    auditAction: "revenue-ledger.reconcile",
    riskLevel: "HIGH",
  },

  /* =========================
     DASHBOARD LITE
  ========================= */
  [Permission.DASHBOARD_LITE_READ]: {
    code: Permission.DASHBOARD_LITE_READ,
    context: "ADMIN",
    resource: "DASHBOARD_LITE",
    auditAction: "dashboardLite.read",
    riskLevel: "LOW",
  },
});
