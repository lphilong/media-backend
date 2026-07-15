import { Actor } from "@core/actor/actor";
import { Permission } from "@core/permission/permission.enum";
import { EmploymentProfileRepository } from "@modules/employment-profile/domain/employment-profile.repository";
import { EmploymentProfileRecord } from "@modules/employment-profile/domain/employment-profile.types";
import { KpiSubjectReadonlyAccess } from "@modules/kpi/domain/kpi-subject-readonly-access";
import {
  MANAGER_KPI_CAPABILITY_PERMISSIONS,
  ManagerKpiCapabilities,
  projectManagerKpiCapabilities,
} from "@modules/kpi/domain/manager-kpi-capability-policy";
import { ReferenceSummary } from "@modules/reference-summary";
import {
  ResponsibilityManagedOrgUnitScope,
  ResponsibilityManagedScopeReader,
} from "@modules/responsibility/domain/responsibility-managed-scope";
import { StructuredScopeAuthorityService } from "@modules/role/domain/structured-scope-authority";

type ManagerWorkspaceKpiCapabilities = ManagerKpiCapabilities;

export interface ManagerWorkspaceOrgUnitScope {
  readonly orgUnitId: string;
  readonly code?: string;
  readonly name: string;
  readonly displayName?: string;
  readonly role: string | null;
  readonly includeDescendants: boolean;
  readonly isPrimary?: boolean;
  readonly capabilities: {
    readonly kpi: ManagerWorkspaceKpiCapabilities;
  };
}

export interface ManagerWorkspaceTalentGroupScope {
  readonly talentGroupId: string;
  readonly code?: string;
  readonly name: string;
  readonly displayName?: string;
  readonly capabilities: {
    readonly kpi: ManagerWorkspaceKpiCapabilities;
  };
}

export interface ManagerWorkspaceContextView {
  readonly actor: {
    readonly id: string;
    readonly displayName: string;
  };
  readonly employmentProfile: {
    readonly id: string;
    readonly displayName: string;
    readonly employeeCode?: string;
    readonly employmentStatus?: string;
    readonly orgUnitId?: string;
  } | null;
  readonly readiness: {
    readonly canUseManagerWorkspace: boolean;
    readonly reasons: readonly string[];
  };
  readonly scopes: {
    readonly orgUnits: readonly ManagerWorkspaceOrgUnitScope[];
    readonly talentGroups: readonly ManagerWorkspaceTalentGroupScope[];
  };
  readonly modules: {
    readonly kpi: {
      readonly visible: boolean;
      readonly unitKpiVisible: boolean;
      readonly talentGroupKpiVisible: boolean;
    };
    readonly workShifts: {
      readonly visible: boolean;
      readonly reason?:
        | "NO_MANAGED_SCOPE_ASSIGNED"
        | "NO_MANAGER_RESPONSIBILITY_ASSIGNED"
        | "NO_STRUCTURED_SCOPE_ASSIGNED"
        | "MISSING_WORK_SCHEDULE_READ_CAPABILITY";
    };
    readonly events: {
      readonly visible: boolean;
      readonly reason?:
        | "NO_MANAGED_SCOPE_ASSIGNED"
        | "NO_MANAGER_RESPONSIBILITY_ASSIGNED"
        | "NO_STRUCTURED_SCOPE_ASSIGNED"
        | "MISSING_EVENT_READ_CAPABILITY";
    };
    readonly revenueSource: {
      readonly visible: boolean;
      readonly reason?:
        | "NO_MANAGED_SCOPE_ASSIGNED"
        | "NO_MANAGER_RESPONSIBILITY_ASSIGNED"
        | "NO_STRUCTURED_SCOPE_ASSIGNED"
        | "MISSING_TALENT_GROUP_PREREQUISITE"
        | "MISSING_REVENUE_SOURCE_READ_CAPABILITY";
    };
    readonly groups: {
      readonly visible: boolean;
      readonly reason?:
        | "NO_MANAGED_SCOPE_ASSIGNED"
        | "NO_MANAGER_RESPONSIBILITY_ASSIGNED"
        | "NO_STRUCTURED_SCOPE_ASSIGNED"
        | "MISSING_MANAGER_GROUP_READ_CAPABILITY";
    };
    readonly members: {
      readonly visible: boolean;
      readonly reason?:
        | "NO_MANAGED_SCOPE_ASSIGNED"
        | "NO_MANAGER_RESPONSIBILITY_ASSIGNED"
        | "NO_STRUCTURED_SCOPE_ASSIGNED"
        | "MISSING_MANAGER_GROUP_READ_CAPABILITY"
        | "MISSING_MANAGER_MEMBER_READ_CAPABILITY";
    };
  };
}

export class ManagerWorkspaceAdminService {
  constructor(
    private readonly employmentProfileRepository: Pick<
      EmploymentProfileRepository,
      "findNonArchivedByLinkedUserId"
    >,
    private readonly subjectReadonlyAccess: Pick<
      KpiSubjectReadonlyAccess,
      "listSubjectRefs"
    >,
    private readonly managedScopeReader: ResponsibilityManagedScopeReader,
    private readonly structuredAuthority: StructuredScopeAuthorityService,
    private readonly clock: () => number = Date.now,
  ) {}

  async getContext(actor: Actor): Promise<ManagerWorkspaceContextView> {
    if (!actor.accountContexts.includes("MANAGER_CONSOLE")) {
      return emptyContext({ id: actor.id, displayName: actor.id }, null, [
        "MANAGER_CONSOLE_ACCOUNT_CONTEXT_MISSING",
      ]);
    }

    const profile =
      await this.employmentProfileRepository.findNonArchivedByLinkedUserId(
        actor.id,
      );
    const baseActor = {
      id: actor.id,
      displayName: profile?.displayName ?? actor.id,
    };

    if (!profile) {
      return emptyContext(baseActor, null, ["NO_LINKED_EMPLOYMENT_PROFILE"]);
    }

    const profileView = toEmploymentProfileView(profile);
    if (!isManagerReadyEmploymentProfile(profile)) {
      return emptyContext(baseActor, profileView, [
        "EMPLOYMENT_PROFILE_NOT_ACTIVE_OR_ON_LEAVE",
      ]);
    }

    const managedScope =
      await this.managedScopeReader.resolveManagedScopeByResponsibleEmploymentProfile(
        {
          responsibleEmploymentProfileId: profile.id,
          asOf: this.clock(),
        },
      );
    const [authorizedOrgUnitAssignments, authorizedTalentGroupAssignments] =
      await Promise.all([
        this.filterOrgUnitAssignments(actor, managedScope.orgUnitScopes),
        this.filterTalentGroupIds(actor, managedScope.talentGroupIds),
      ]);
    const hasManagedResponsibility =
      managedScope.orgUnitScopes.length + managedScope.talentGroupIds.length >
      0;
    const refs = await this.loadScopeRefs(
      authorizedOrgUnitAssignments,
      authorizedTalentGroupAssignments,
    );
    const orgUnits = await Promise.all(
      authorizedOrgUnitAssignments.map((assignment) =>
        this.toOrgUnitScope(assignment, refs, actor),
      ),
    );
    const talentGroups = await Promise.all(
      authorizedTalentGroupAssignments.map((assignment) =>
        this.toTalentGroupScope(assignment, refs, actor),
      ),
    );
    const unitKpiVisible =
      orgUnits.some((scope) => scope.capabilities.kpi.read);
    const talentGroupKpiVisible =
      talentGroups.some((scope) => scope.capabilities.kpi.read);
    const visible = unitKpiVisible || talentGroupKpiVisible;
    const hasManagedAssignment = orgUnits.length + talentGroups.length > 0;
    const missingAuthorityReason = !hasManagedResponsibility
      ? "NO_MANAGER_RESPONSIBILITY_ASSIGNED"
      : "NO_STRUCTURED_SCOPE_ASSIGNED";
    const [
      workShiftsVisible,
      eventsVisible,
      revenueSourceVisible,
      groupsVisible,
      membersVisible,
    ] = await Promise.all([
      hasStructuredModuleScope(
        this.structuredAuthority,
        actor,
        Permission.WORK_SCHEDULE_READ,
        orgUnits.map((scope) => scope.orgUnitId),
        talentGroups.map((scope) => scope.talentGroupId),
      ),
      hasStructuredModuleScope(
        this.structuredAuthority,
        actor,
        Permission.EVENT_READ,
        orgUnits.map((scope) => scope.orgUnitId),
        talentGroups.map((scope) => scope.talentGroupId),
      ),
      hasAnyManagedTalentGroupAuthority(
        this.structuredAuthority,
        actor,
        talentGroups.map((scope) => scope.talentGroupId),
        [Permission.REVENUE_LEDGER_PLATFORM_EARNING_READ],
      ),
      hasStructuredModuleScope(
        this.structuredAuthority,
        actor,
        Permission.MANAGER_GROUP_READ,
        orgUnits.map((scope) => scope.orgUnitId),
        talentGroups.map((scope) => scope.talentGroupId),
      ),
      hasStructuredModuleScope(
        this.structuredAuthority,
        actor,
        Permission.MANAGER_MEMBER_READ,
        orgUnits.map((scope) => scope.orgUnitId),
        talentGroups.map((scope) => scope.talentGroupId),
      ),
    ]);
    const reasons = visible
      ? []
      : [
          !hasManagedAssignment
            ? missingAuthorityReason
            : "MISSING_KPI_MANAGER_CAPABILITY",
        ];

    return {
      actor: baseActor,
      employmentProfile: profileView,
      readiness: {
        canUseManagerWorkspace: true,
        reasons,
      },
      scopes: {
        orgUnits,
        talentGroups,
      },
      modules: {
        kpi: {
          visible,
          unitKpiVisible,
          talentGroupKpiVisible,
        },
        workShifts: workShiftsVisible
          ? { visible: true }
          : {
              visible: false,
              reason: hasManagedAssignment
                ? "MISSING_WORK_SCHEDULE_READ_CAPABILITY"
                : missingAuthorityReason,
            },
        events: eventsVisible
          ? { visible: true }
          : {
              visible: false,
              reason: hasManagedAssignment
                ? "MISSING_EVENT_READ_CAPABILITY"
                : missingAuthorityReason,
            },
        revenueSource: revenueSourceVisible
          ? { visible: true }
          : {
              visible: false,
              reason:
                talentGroups.length > 0
                  ? "MISSING_REVENUE_SOURCE_READ_CAPABILITY"
                  : hasManagedAssignment
                    ? "MISSING_TALENT_GROUP_PREREQUISITE"
                    : missingAuthorityReason,
            },
        groups: groupsVisible
          ? { visible: true }
          : {
              visible: false,
              reason: hasManagedAssignment
                ? "MISSING_MANAGER_GROUP_READ_CAPABILITY"
                : missingAuthorityReason,
            },
        members:
          membersVisible && groupsVisible
            ? { visible: true }
            : {
                visible: false,
                reason:
                  !groupsVisible && hasManagedAssignment
                    ? "MISSING_MANAGER_GROUP_READ_CAPABILITY"
                    : hasManagedAssignment
                      ? "MISSING_MANAGER_MEMBER_READ_CAPABILITY"
                      : missingAuthorityReason,
              },
      },
    };
  }

  private async loadScopeRefs(
    orgUnitAssignments: readonly ResponsibilityManagedOrgUnitScope[],
    talentGroupIds: readonly string[],
  ): Promise<ReadonlyMap<string, ReferenceSummary>> {
    return this.subjectReadonlyAccess.listSubjectRefs([
      ...orgUnitAssignments.map((assignment) => ({
        subjectType: "ORG_UNIT" as const,
        subjectId: assignment.orgUnitId,
      })),
      ...talentGroupIds.map((groupId) => ({
        subjectType: "TALENT_GROUP" as const,
        subjectId: groupId,
      })),
    ]);
  }

  private async filterOrgUnitAssignments(
    actor: Actor,
    assignments: readonly ResponsibilityManagedOrgUnitScope[],
  ): Promise<readonly ResponsibilityManagedOrgUnitScope[]> {
    const authorized = await Promise.all(
      assignments.map(async (assignment) =>
        (await hasAnyManagedOrgUnitAuthority(
          this.structuredAuthority,
          actor,
          assignment.orgUnitId,
        ))
          ? assignment
          : null,
      ),
    );
    return authorized.filter(
      (assignment): assignment is ResponsibilityManagedOrgUnitScope =>
        assignment !== null,
    );
  }

  private async filterTalentGroupIds(
    actor: Actor,
    talentGroupIds: readonly string[],
  ): Promise<readonly string[]> {
    const authorized = await Promise.all(
      uniqueTextValues(talentGroupIds).map(async (talentGroupId) =>
        (await hasAnyManagedTalentGroupAuthority(
          this.structuredAuthority,
          actor,
          talentGroupId,
        ))
          ? talentGroupId
          : null,
      ),
    );
    return authorized.filter((id): id is string => id !== null);
  }

  private async toOrgUnitScope(
    assignment: ResponsibilityManagedOrgUnitScope,
    refs: ReadonlyMap<string, ReferenceSummary>,
    actor: Actor,
  ): Promise<ManagerWorkspaceOrgUnitScope> {
    const ref = refs.get(`ORG_UNIT:${assignment.orgUnitId}`);
    const directUnitManager =
      assignment.role === "UNIT_MANAGER" && !assignment.includeDescendants;
    const capabilities = await resolveManagerKpiCapabilities(
      MANAGER_KPI_CAPABILITY_PERMISSIONS,
      (permission) =>
        directUnitManager ||
        permission === Permission.KPI_READ ||
        permission === Permission.KPI_READ_PROGRESS
          ? hasManagedOrgUnitAuthority(
              this.structuredAuthority,
              actor,
              permission,
              assignment.orgUnitId,
            )
          : Promise.resolve(false),
    );

    return {
      orgUnitId: assignment.orgUnitId,
      ...(ref?.code ? { code: ref.code } : {}),
      name: ref?.name ?? ref?.displayName ?? assignment.orgUnitId,
      ...(ref?.displayName ? { displayName: ref.displayName } : {}),
      role: assignment.role,
      includeDescendants: assignment.includeDescendants,
      ...(assignment.isPrimary ? { isPrimary: true } : {}),
      capabilities: {
        kpi: capabilities,
      },
    };
  }

  private async toTalentGroupScope(
    groupId: string,
    refs: ReadonlyMap<string, ReferenceSummary>,
    actor: Actor,
  ): Promise<ManagerWorkspaceTalentGroupScope> {
    const ref = refs.get(`TALENT_GROUP:${groupId}`);
    const capabilities = await resolveManagerKpiCapabilities(
      MANAGER_KPI_CAPABILITY_PERMISSIONS,
      (permission) =>
        hasManagedTalentGroupAuthority(
          this.structuredAuthority,
          actor,
          permission,
          groupId,
        ),
    );

    return {
      talentGroupId: groupId,
      ...(ref?.code ? { code: ref.code } : {}),
      name: ref?.name ?? ref?.displayName ?? groupId,
      ...(ref?.displayName ? { displayName: ref.displayName } : {}),
      capabilities: {
        kpi: capabilities,
      },
    };
  }
}

function emptyContext(
  actor: ManagerWorkspaceContextView["actor"],
  employmentProfile: ManagerWorkspaceContextView["employmentProfile"],
  reasons: readonly string[],
): ManagerWorkspaceContextView {
  return {
    actor,
    employmentProfile,
    readiness: {
      canUseManagerWorkspace: false,
      reasons,
    },
    scopes: {
      orgUnits: [],
      talentGroups: [],
    },
    modules: {
      kpi: {
        visible: false,
        unitKpiVisible: false,
        talentGroupKpiVisible: false,
      },
      workShifts: {
        visible: false,
        reason: "NO_MANAGED_SCOPE_ASSIGNED",
      },
      events: {
        visible: false,
        reason: "NO_MANAGED_SCOPE_ASSIGNED",
      },
      revenueSource: {
        visible: false,
        reason: "NO_MANAGED_SCOPE_ASSIGNED",
      },
      groups: {
        visible: false,
        reason: "NO_MANAGED_SCOPE_ASSIGNED",
      },
      members: {
        visible: false,
        reason: "NO_MANAGED_SCOPE_ASSIGNED",
      },
    },
  };
}

function toEmploymentProfileView(profile: EmploymentProfileRecord): {
  readonly id: string;
  readonly displayName: string;
  readonly employeeCode?: string;
  readonly employmentStatus?: string;
  readonly orgUnitId?: string;
} {
  return {
    id: profile.id,
    displayName: profile.displayName,
    ...(profile.employeeCode ? { employeeCode: profile.employeeCode } : {}),
    employmentStatus: profile.employmentStatus,
    ...(profile.orgUnitId ? { orgUnitId: profile.orgUnitId } : {}),
  };
}

function isManagerReadyEmploymentProfile(
  profile: EmploymentProfileRecord,
): boolean {
  return (
    profile.employmentStatus === "ACTIVE" ||
    profile.employmentStatus === "ON_LEAVE"
  );
}

function uniqueTextValues(values: readonly string[]): readonly string[] {
  return [
    ...new Set(
      values.map((value) => value.trim()).filter((value) => value.length > 0),
    ),
  ];
}

async function hasAnyManagedOrgUnitAuthority(
  service: StructuredScopeAuthorityService,
  actor: Actor,
  orgUnitIds: string | readonly string[],
  permissions: readonly Permission[] = [
    Permission.KPI_READ,
    Permission.KPI_READ_PROGRESS,
    Permission.KPI_MANAGE_ALLOCATION,
    Permission.KPI_ENTER_ACTUAL,
    Permission.KPI_CORRECT_ACTUAL,
    Permission.KPI_APPROVE_ALLOCATION,
    Permission.WORK_SCHEDULE_READ,
    Permission.EVENT_READ,
    Permission.MANAGER_GROUP_READ,
    Permission.MANAGER_MEMBER_READ,
  ],
): Promise<boolean> {
  const ids = Array.isArray(orgUnitIds) ? orgUnitIds : [orgUnitIds];
  for (const permission of permissions) {
    for (const orgUnitId of ids) {
      if (
        await hasManagedOrgUnitAuthority(service, actor, permission, orgUnitId)
      ) {
        return true;
      }
    }
  }
  return false;
}

async function hasAnyManagedTalentGroupAuthority(
  service: StructuredScopeAuthorityService,
  actor: Actor,
  talentGroupIds: string | readonly string[],
  permissions: readonly Permission[] = [
    Permission.KPI_READ,
    Permission.KPI_READ_PROGRESS,
    Permission.KPI_MANAGE_ALLOCATION,
    Permission.KPI_ENTER_ACTUAL,
    Permission.KPI_CORRECT_ACTUAL,
    Permission.KPI_APPROVE_ALLOCATION,
    Permission.WORK_SCHEDULE_READ,
    Permission.EVENT_READ,
    Permission.REVENUE_LEDGER_PLATFORM_EARNING_READ,
    Permission.MANAGER_GROUP_READ,
    Permission.MANAGER_MEMBER_READ,
  ],
): Promise<boolean> {
  const ids = Array.isArray(talentGroupIds) ? talentGroupIds : [talentGroupIds];
  for (const permission of permissions) {
    for (const talentGroupId of ids) {
      if (
        await hasManagedTalentGroupAuthority(
          service,
          actor,
          permission,
          talentGroupId,
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

async function hasStructuredModuleScope(
  service: StructuredScopeAuthorityService,
  actor: Actor,
  permission: Permission,
  orgUnitIds: readonly string[],
  talentGroupIds: readonly string[],
): Promise<boolean> {
  return (
    (await hasAnyManagedOrgUnitAuthority(service, actor, orgUnitIds, [
      permission,
    ])) ||
    (await hasAnyManagedTalentGroupAuthority(service, actor, talentGroupIds, [
      permission,
    ]))
  );
}

function hasManagedOrgUnitAuthority(
  service: StructuredScopeAuthorityService,
  actor: Actor,
  permission: Permission,
  orgUnitId: string,
): Promise<boolean> {
  if (!actor.isActive) {
    return Promise.resolve(false);
  }
  if (!actor.permissions.includes(permission)) {
    return Promise.resolve(false);
  }
  return service.hasAuthority({
    userId: actor.id,
    permission,
    scope: { scopeType: "managedOrgUnit", targetId: orgUnitId },
  });
}

function hasManagedTalentGroupAuthority(
  service: StructuredScopeAuthorityService,
  actor: Actor,
  permission: Permission,
  talentGroupId: string,
): Promise<boolean> {
  if (!actor.isActive) {
    return Promise.resolve(false);
  }
  if (!actor.permissions.includes(permission)) {
    return Promise.resolve(false);
  }
  return service.hasAuthority({
    userId: actor.id,
    permission,
    scope: { scopeType: "managedTalentGroup", targetId: talentGroupId },
  });
}

async function resolveManagerKpiCapabilities(
  permissions: readonly Permission[],
  hasAuthority: (permission: Permission) => Promise<boolean>,
): Promise<ManagerKpiCapabilities> {
  const decisions = await Promise.all(
    permissions.map(async (permission) => [permission, await hasAuthority(permission)] as const),
  );
  return projectManagerKpiCapabilities(
    new Set(decisions.filter(([, allowed]) => allowed).map(([permission]) => permission)),
  );
}
