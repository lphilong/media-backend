import { Permission } from "@core/permission/permission.enum";
import { ActorScopeGrants } from "@core/actor/actor";

export const ROLE_TEMPLATE_CODES = [
  "ADMIN_FULL",
  "HR_OPERATIONS",
  "TEAM_MANAGER",
  "PRODUCTION_OPS",
  "COMMERCIAL_FINANCE",
  "TALENT_STAFF_SELF",
  "VIEWER_AUDITOR",
] as const;

export type RoleTemplateCode =
  (typeof ROLE_TEMPLATE_CODES)[number];

export type RoleTemplateStatus =
  | "READY"
  | "PREVIEW_ONLY"
  | "REQUIRES_FUTURE_SCOPE";

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
  readonly permissions: readonly Permission[];
  readonly recommendedScopeGrants: Readonly<ActorScopeGrants>;
  readonly scopePlan: readonly RoleTemplateScopePlanEntry[];
  readonly warnings: readonly string[];
  readonly implementationNotes: readonly string[];
  readonly status: RoleTemplateStatus;
}

export type RoleTemplateListItem = Omit<
  RoleTemplateDefinition,
  "permissions"
> & {
  readonly permissionCount: number;
};

const TEMPLATE_VERSION = "2026-05-20";

const ALL_PERMISSIONS = Object.freeze([
  ...Object.values(Permission),
]);

const GLOBAL_PREVIEW_SCOPE_PLAN: readonly RoleTemplateScopePlanEntry[] =
  Object.freeze([
    scopePlan("Work Schedule", ["global"], "PREVIEW_ONLY"),
    scopePlan("Event Assignment", ["global"], "PREVIEW_ONLY"),
    scopePlan("Contract Registry", ["global"], "PREVIEW_ONLY"),
    scopePlan("Talent KPI", ["global"], "PREVIEW_ONLY"),
    scopePlan("KPI", ["global"], "READY", "Runtime grant: scopeGrants.kpi = [\"global\"]."),
    scopePlan("Revenue Ledger", ["global"], "PREVIEW_ONLY"),
    scopePlan("Commission", ["global"], "PREVIEW_ONLY"),
    scopePlan("Dashboard Lite", ["global"], "PREVIEW_ONLY"),
  ]);

export const ROLE_TEMPLATE_CATALOG: readonly RoleTemplateDefinition[] =
  Object.freeze([
    {
      code: "ADMIN_FULL",
      version: TEMPLATE_VERSION,
      name: "Admin Full",
      description:
        "Full explicit permission preset for administrative operators.",
      category: "ADMINISTRATION",
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
      scopePlan: GLOBAL_PREVIEW_SCOPE_PLAN,
      warnings: Object.freeze([
        "Scope grants are preview-only until Batch 3-F assignment-scope materialization or existing user-level grants are configured.",
        "This template does not create elevated implicit access; every permission remains explicit.",
      ]),
      implementationNotes: Object.freeze([
        "Includes every current Permission enum value.",
        "Actor.roles remain non-authoritative for enforcement.",
      ]),
      status: "PREVIEW_ONLY",
    },
    {
      code: "HR_OPERATIONS",
      version: TEMPLATE_VERSION,
      name: "HR Operations",
      description:
        "People, organization, employment, talent, and talent-group operations preset.",
      category: "PEOPLE_OPERATIONS",
      permissions: Object.freeze([
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
      ]),
      recommendedScopeGrants: scopeGrants({
        workSchedule: Object.freeze(["department"]),
        kpi: Object.freeze(["global"]),
      }),
      scopePlan: Object.freeze([
        scopePlan(
          "People and Organization",
          ["org-unit", "department"],
          "REQUIRES_FUTURE_SCOPE",
          "Desired HR scoping is org-unit or department, but these modules do not yet materialize object scope grants.",
        ),
        scopePlan(
          "KPI",
          ["global"],
          "READY",
          "Runtime grant: scopeGrants.kpi = [\"global\"] for read/progress visibility only; this template does not include KPI mutation permissions.",
        ),
        scopePlan(
          "Work Schedule",
          ["department"],
          "PREVIEW_ONLY",
          "Department scope can be expressed by current actor scope grants after Batch 3-F materialization.",
        ),
      ]),
      warnings: Object.freeze([
        "HR module scope is mostly future policy; generated permissions are global unless existing runtime grants restrict a route.",
        "Revenue, commission, finance lifecycle, and role-management permissions are intentionally excluded.",
      ]),
      implementationNotes: Object.freeze([
        "Uses current people, org, talent, talent-group, user-view, auth-linkage, and work-schedule read permissions.",
      ]),
      status: "REQUIRES_FUTURE_SCOPE",
    },
    {
      code: "TEAM_MANAGER",
      version: TEMPLATE_VERSION,
      name: "Team Manager",
      description:
        "Conservative team operations preset for schedules, assignments, labels, and KPI management.",
      category: "MANAGEMENT",
      permissions: Object.freeze([
        Permission.WORK_SCHEDULE_READ,
        Permission.WORK_SCHEDULE_CREATE,
        Permission.WORK_SCHEDULE_UPDATE,
        Permission.WORK_SCHEDULE_MANAGE_LIFECYCLE,
        Permission.EVENT_READ,
        Permission.EVENT_UPDATE,
        Permission.EVENT_MANAGE_ASSIGNMENTS,
        Permission.EVENT_MANAGE_LIFECYCLE,
        Permission.TALENT_READ,
        Permission.TALENT_GROUP_READ,
        Permission.TALENT_KPI_READ,
        Permission.TALENT_KPI_CREATE,
        Permission.TALENT_KPI_UPDATE,
        Permission.TALENT_KPI_MANAGE_METRICS,
        Permission.KPI_READ,
        Permission.KPI_READ_PROGRESS,
        Permission.KPI_ENTER_ACTUAL,
        Permission.KPI_CORRECT_ACTUAL,
      ]),
      recommendedScopeGrants: scopeGrants({
        workSchedule: Object.freeze(["self", "team", "department"]),
        eventAssignment: Object.freeze(["managedGroup"]),
        kpi: Object.freeze(["managedGroup"]),
      }),
      scopePlan: Object.freeze([
        scopePlan(
          "Work Schedule",
          ["self", "team", "department"],
          "PREVIEW_ONLY",
          "Current scope support exists primarily for work schedule routes.",
        ),
        scopePlan(
          "KPI",
          ["managedGroup"],
          "READY",
          "Runtime grant: scopeGrants.kpi = [\"managedGroup\"]; access still requires active manager assignment.",
        ),
        scopePlan(
          "Event Assignment",
          ["managedGroup"],
          "READY",
          "Runtime grant: scopeGrants.eventAssignment = [\"managedGroup\"]; access is limited to events assigned to managed groups or active talents in those groups.",
        ),
      ]),
      warnings: Object.freeze([
        "Talent KPI object scope remains future policy.",
        "Actual KPI workflow behavior is unchanged by this template.",
        "User, role, finance finalize, and reconcile permissions are intentionally excluded.",
      ]),
      implementationNotes: Object.freeze([
        "Includes work-schedule lifecycle permissions because current team and department scope support is work-schedule-centered.",
      ]),
      status: "REQUIRES_FUTURE_SCOPE",
    },
    {
      code: "PRODUCTION_OPS",
      version: TEMPLATE_VERSION,
      name: "Production Ops",
      description:
        "Production operations preset for events, studio resources, work schedules, and platform display references.",
      category: "PRODUCTION",
      permissions: Object.freeze([
        Permission.EVENT_READ,
        Permission.EVENT_CREATE,
        Permission.EVENT_UPDATE,
        Permission.EVENT_MANAGE_ASSIGNMENTS,
        Permission.EVENT_MANAGE_LIFECYCLE,
        Permission.ORG_UNIT_LOOKUP,
        Permission.EMPLOYMENT_PROFILE_LOOKUP,
        Permission.TALENT_LOOKUP,
        Permission.TALENT_GROUP_LOOKUP,
        Permission.PLATFORM_ACCOUNT_LOOKUP,
        Permission.STUDIO_RESOURCE_LOOKUP,
        Permission.EVENT_LOOKUP,
        Permission.STUDIO_RESOURCE_READ,
        Permission.STUDIO_RESOURCE_CREATE,
        Permission.STUDIO_RESOURCE_UPDATE,
        Permission.STUDIO_RESOURCE_MANAGE_AVAILABILITY,
        Permission.STUDIO_RESOURCE_MANAGE_LIFECYCLE,
        Permission.WORK_SCHEDULE_READ,
        Permission.WORK_SCHEDULE_CREATE,
        Permission.WORK_SCHEDULE_UPDATE,
        Permission.WORK_SCHEDULE_MANAGE_LIFECYCLE,
        Permission.PLATFORM_ACCOUNT_READ,
      ]),
      recommendedScopeGrants: scopeGrants({
        workSchedule: Object.freeze(["department"]),
        eventAssignment: Object.freeze(["global"]),
      }),
      scopePlan: Object.freeze([
        scopePlan(
          "Production Operations",
          ["event", "global", "studio", "department"],
          "READY",
          "Runtime grant: scopeGrants.eventAssignment = [\"global\"] because Production Ops is the current central event dispatcher.",
        ),
        scopePlan(
          "Work Schedule",
          ["department"],
          "PREVIEW_ONLY",
          "Work Schedule has current department scope vocabulary but this batch does not persist assignment grants.",
        ),
      ]),
      warnings: Object.freeze([
        "Studio scope is not materialized by this batch.",
        "Platform Account is read-only for assignment and display references.",
      ]),
      implementationNotes: Object.freeze([
        "Uses current event-assignment, studio-resource, work-schedule, and platform-account read permissions.",
      ]),
      status: "REQUIRES_FUTURE_SCOPE",
    },
    {
      code: "COMMERCIAL_FINANCE",
      version: TEMPLATE_VERSION,
      name: "Commercial Finance",
      description:
        "Commercial finance preset for revenue, commission, settlement, contract read, and dashboard read workflows.",
      category: "FINANCE",
      permissions: Object.freeze([
        Permission.REVENUE_LEDGER_READ,
        Permission.REVENUE_LEDGER_LOOKUP,
        Permission.REVENUE_LEDGER_CREATE,
        Permission.REVENUE_LEDGER_UPDATE,
        Permission.REVENUE_LEDGER_MANAGE_LIFECYCLE,
        Permission.REVENUE_LEDGER_RECONCILE,
        Permission.COMMISSION_RULE_READ,
        Permission.COMMISSION_RULE_LOOKUP,
        Permission.COMMISSION_RULE_CREATE,
        Permission.COMMISSION_RULE_UPDATE,
        Permission.COMMISSION_RULE_MANAGE_LIFECYCLE,
        Permission.COMMISSION_SETTLEMENT_READ,
        Permission.COMMISSION_SETTLEMENT_CREATE,
        Permission.COMMISSION_SETTLEMENT_UPDATE,
        Permission.COMMISSION_SETTLEMENT_MANAGE_LIFECYCLE,
        Permission.CONTRACT_REGISTRY_READ,
        Permission.CONTRACT_REGISTRY_LOOKUP,
        Permission.EMPLOYMENT_PROFILE_LOOKUP,
        Permission.TALENT_LOOKUP,
        Permission.PLATFORM_ACCOUNT_LOOKUP,
        Permission.EVENT_LOOKUP,
        Permission.KPI_READ,
        Permission.KPI_READ_PROGRESS,
        Permission.DASHBOARD_LITE_READ,
      ]),
      recommendedScopeGrants: scopeGrants({
        contractRegistry: Object.freeze(["global"]),
        kpi: Object.freeze(["global"]),
        revenueLedger: Object.freeze(["global"]),
        commission: Object.freeze(["global"]),
        dashboardLite: Object.freeze(["global"]),
      }),
      scopePlan: Object.freeze([
        scopePlan(
          "Commercial Finance",
          ["finance", "business-unit", "global"],
          "REQUIRES_FUTURE_SCOPE",
          "Current commercial finance route scope is mostly global-only until assignment-scope grants are implemented.",
        ),
        scopePlan(
          "KPI",
          ["global"],
          "READY",
          "Runtime grant: scopeGrants.kpi = [\"global\"] for read/progress reporting only; actual entry, correction, and finalization are excluded.",
        ),
      ]),
      warnings: Object.freeze([
        "Future separation-of-duties policy is needed for create, finalize, and reconcile combinations.",
        "No assignment scope or scope grants are persisted by this template.",
      ]),
      implementationNotes: Object.freeze([
        "Includes explicit revenue-ledger, commission-rule, commission-settlement, contract-read, and dashboard-read permissions.",
      ]),
      status: "REQUIRES_FUTURE_SCOPE",
    },
    {
      code: "TALENT_STAFF_SELF",
      version: TEMPLATE_VERSION,
      name: "Talent Staff Self",
      description:
        "Read-only self-intended baseline for talent-facing staff access.",
      category: "SELF_SERVICE",
      permissions: Object.freeze([
        Permission.WORK_SCHEDULE_READ,
        Permission.EVENT_READ,
        Permission.TALENT_KPI_READ,
        Permission.KPI_READ_PROGRESS,
        Permission.EMPLOYMENT_PROFILE_READ,
        Permission.TALENT_READ,
      ]),
      recommendedScopeGrants: scopeGrants({
        workSchedule: Object.freeze(["self"]),
        kpi: Object.freeze(["self"]),
      }),
      scopePlan: Object.freeze([
        scopePlan(
          "KPI",
          ["self"],
          "READY",
          "Runtime grant: scopeGrants.kpi = [\"self\"] for own progress only.",
        ),
        scopePlan(
          "Self Service",
          ["self"],
          "REQUIRES_FUTURE_SCOPE",
          "Self-facing routes and object scope are mostly not implemented outside Work Schedule.",
        ),
      ]),
      warnings: Object.freeze([
        "Self-scope intent is preview-only and does not limit generated permissions by itself.",
        "This template does not create staff-facing routes.",
      ]),
      implementationNotes: Object.freeze([
        "Includes only read permissions needed to preview self-service intent.",
      ]),
      status: "REQUIRES_FUTURE_SCOPE",
    },
    {
      code: "VIEWER_AUDITOR",
      version: TEMPLATE_VERSION,
      name: "Viewer Auditor",
      description:
        "Read-only auditor preset across operational and commercial modules.",
      category: "AUDIT",
      permissions: Object.freeze([
        Permission.ORG_UNIT_READ,
        Permission.EMPLOYMENT_PROFILE_READ,
        Permission.TALENT_READ,
        Permission.TALENT_GROUP_READ,
        Permission.PLATFORM_ACCOUNT_READ,
        Permission.STUDIO_RESOURCE_READ,
        Permission.EVENT_READ,
        Permission.WORK_SCHEDULE_READ,
        Permission.CONTRACT_REGISTRY_READ,
        Permission.TALENT_KPI_READ,
        Permission.KPI_READ,
        Permission.KPI_READ_PROGRESS,
        Permission.COMMISSION_RULE_READ,
        Permission.COMMISSION_SETTLEMENT_READ,
        Permission.REVENUE_LEDGER_READ,
        Permission.DASHBOARD_LITE_READ,
      ]),
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
      scopePlan: Object.freeze([
        scopePlan(
          "Read Only Audit",
          ["module", "org", "global"],
          "REQUIRES_FUTURE_SCOPE",
          "Final auditor scope policy must be product-confirmed per module.",
        ),
        scopePlan(
          "KPI",
          ["global"],
          "READY",
          "Runtime grant: scopeGrants.kpi = [\"global\"] for read/progress audit only; no KPI mutations are included.",
        ),
      ]),
      warnings: Object.freeze([
        "User and Role read permissions are excluded by default because governance visibility is sensitive.",
        "No create, update, lifecycle, finalize, or reconcile permissions are included.",
      ]),
      implementationNotes: Object.freeze([
        "Uses current read-only Permission enum values across non-governance modules.",
      ]),
      status: "REQUIRES_FUTURE_SCOPE",
    },
  ]);

const CATALOG_BY_CODE = new Map<RoleTemplateCode, RoleTemplateDefinition>(
  ROLE_TEMPLATE_CATALOG.map((template) => [
    template.code,
    template,
  ]),
);

validateRoleTemplateCatalog();

export function listRoleTemplates(): readonly RoleTemplateListItem[] {
  return ROLE_TEMPLATE_CATALOG.map((template) => ({
    code: template.code,
    version: template.version,
    name: template.name,
    description: template.description,
    category: template.category,
    scopePlan: template.scopePlan,
    recommendedScopeGrants: template.recommendedScopeGrants,
    warnings: template.warnings,
    implementationNotes: template.implementationNotes,
    status: template.status,
    permissionCount: template.permissions.length,
  }));
}

export function getRoleTemplate(
  code: string,
): RoleTemplateDefinition | null {
  const normalized = normalizeRoleTemplateCode(code);
  if (!isRoleTemplateCode(normalized)) {
    return null;
  }

  return CATALOG_BY_CODE.get(normalized) ?? null;
}

export function isRoleTemplateCode(
  code: string,
): code is RoleTemplateCode {
  return ROLE_TEMPLATE_CODES.includes(
    code as RoleTemplateCode,
  );
}

export function normalizeRoleTemplateCode(code: string): string {
  return code.trim().toUpperCase();
}

export function validateRoleTemplateCatalog(): void {
  const knownPermissionCodes = new Set<string>(
    Object.values(Permission),
  );
  const seenCodes = new Set<string>();

  for (const template of ROLE_TEMPLATE_CATALOG) {
    if (seenCodes.has(template.code)) {
      throw new Error(
        `Duplicate role template code: ${template.code}`,
      );
    }
    seenCodes.add(template.code);

    const seenPermissions = new Set<Permission>();
    for (const permission of template.permissions) {
      if (!knownPermissionCodes.has(permission)) {
        throw new Error(
          `Role template ${template.code} contains unknown permission: ${permission}`,
        );
      }

      if (seenPermissions.has(permission)) {
        throw new Error(
          `Role template ${template.code} contains duplicate permission: ${permission}`,
        );
      }

      seenPermissions.add(permission);
    }
  }

  const expectedCodes = [...ROLE_TEMPLATE_CODES].sort();
  const actualCodes = [...seenCodes].sort();

  if (
    expectedCodes.length !== actualCodes.length ||
    expectedCodes.some(
      (code, index) => code !== actualCodes[index],
    )
  ) {
    throw new Error(
      `Role template catalog must contain exactly: ${expectedCodes.join(", ")}`,
    );
  }
}

function scopePlan(
  module: string,
  scopes: readonly string[],
  status: RoleTemplateStatus,
  note = "Preview-only scope plan; this batch does not persist or materialize scope grants.",
): RoleTemplateScopePlanEntry {
  return Object.freeze({
    module,
    scopes: Object.freeze([...scopes]),
    status,
    note,
  });
}

function scopeGrants(
  grants: ActorScopeGrants,
): Readonly<ActorScopeGrants> {
  return Object.freeze(grants);
}
