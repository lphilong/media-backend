import { Actor } from "@core/actor/actor";
import { Permission } from "@core/permission/permission.enum";
import { PermissionGuard } from "@core/permission/permission.guard";
import { EmploymentProfileRepository } from "@modules/employment-profile/domain/employment-profile.repository";
import { EmploymentProfileRecord } from "@modules/employment-profile/domain/employment-profile.types";
import {
  OrgUnitManagerAssignment,
  OrgUnitManagerRole,
  TalentGroupManagerAssignment,
} from "@modules/kpi/domain/kpi.types";
import { KpiSubjectReadonlyAccess } from "@modules/kpi/domain/kpi-subject-readonly-access";
import { OrgUnitManagerAssignmentRepository } from "@modules/kpi/domain/org-unit-manager-assignment.repository";
import { TalentGroupManagerAssignmentRepository } from "@modules/kpi/domain/talent-group-manager-assignment.repository";
import { ReferenceSummary } from "@modules/reference-summary";

type ManagerWorkspaceKpiCapabilities = {
  readonly read: boolean;
  readonly manageAllocation: boolean;
  readonly enterActual: boolean;
  readonly correctActual: boolean;
  readonly finalize: false;
};

export interface ManagerWorkspaceOrgUnitScope {
  readonly orgUnitId: string;
  readonly code?: string;
  readonly name: string;
  readonly displayName?: string;
  readonly role: OrgUnitManagerRole;
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
      readonly reason?: "NO_MANAGED_SCOPE_ASSIGNED" | "MISSING_WORK_SCHEDULE_READ_CAPABILITY";
    };
    readonly events: {
      readonly visible: boolean;
      readonly reason?:
        | "NO_MANAGED_SCOPE_ASSIGNED"
        | "MISSING_EVENT_READ_CAPABILITY";
    };
    readonly members: {
      readonly visible: false;
      readonly reason: "NOT_ENABLED_IN_MANAGER_WORKSPACE_YET";
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
    private readonly talentGroupManagerAssignmentRepository: Pick<
      TalentGroupManagerAssignmentRepository,
      "listActiveAssignmentsByManagerEmploymentProfile"
    >,
    private readonly orgUnitManagerAssignmentRepository: Pick<
      OrgUnitManagerAssignmentRepository,
      "listActiveByManagerEmploymentProfileId"
    >,
    private readonly clock: () => number = Date.now,
  ) {}

  async getContext(actor: Actor): Promise<ManagerWorkspaceContextView> {
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

    const asOf = this.clock();
    const [orgUnitAssignments, talentGroupAssignments] = await Promise.all([
      this.orgUnitManagerAssignmentRepository.listActiveByManagerEmploymentProfileId(
        profile.id,
        asOf,
      ),
      this.talentGroupManagerAssignmentRepository.listActiveAssignmentsByManagerEmploymentProfile(
        profile.id,
        asOf,
      ),
    ]);
    const hasManagerCapability = hasKpiManagedCapability(actor);
    const refs = await this.loadScopeRefs(
      orgUnitAssignments,
      talentGroupAssignments,
    );
    const orgUnits = orgUnitAssignments.map((assignment) =>
      toOrgUnitScope(assignment, refs, actor, hasManagerCapability),
    );
    const talentGroups = talentGroupAssignments.map((assignment) =>
      toTalentGroupScope(assignment, refs, actor, hasManagerCapability),
    );
    const unitKpiVisible = orgUnits.some(
      (scope) => scope.capabilities.kpi.read,
    );
    const talentGroupKpiVisible = talentGroups.some(
      (scope) => scope.capabilities.kpi.read,
    );
    const visible = unitKpiVisible || talentGroupKpiVisible;
    const hasManagedAssignment = orgUnits.length + talentGroups.length > 0;
    const workShiftsVisible =
      hasManagedAssignment &&
      actor.permissions.includes(Permission.WORK_SCHEDULE_READ);
    const eventsVisible =
      hasManagedAssignment &&
      actor.permissions.includes(Permission.EVENT_READ);
    const reasons = visible
      ? []
      : [
          orgUnits.length + talentGroups.length === 0
            ? "NO_MANAGED_SCOPE_ASSIGNED"
            : "MISSING_KPI_MANAGER_CAPABILITY",
        ];

    return {
      actor: baseActor,
      employmentProfile: profileView,
      readiness: {
        canUseManagerWorkspace:
          hasManagerCapability || orgUnits.length + talentGroups.length > 0,
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
                : "NO_MANAGED_SCOPE_ASSIGNED",
            },
        events: eventsVisible
          ? { visible: true }
          : {
              visible: false,
              reason: hasManagedAssignment
                ? "MISSING_EVENT_READ_CAPABILITY"
                : "NO_MANAGED_SCOPE_ASSIGNED",
            },
        members: disabledModule(),
      },
    };
  }

  private async loadScopeRefs(
    orgUnitAssignments: readonly OrgUnitManagerAssignment[],
    talentGroupAssignments: readonly TalentGroupManagerAssignment[],
  ): Promise<ReadonlyMap<string, ReferenceSummary>> {
    return this.subjectReadonlyAccess.listSubjectRefs([
      ...orgUnitAssignments.map((assignment) => ({
        subjectType: "ORG_UNIT" as const,
        subjectId: assignment.orgUnitId,
      })),
      ...talentGroupAssignments.map((assignment) => ({
        subjectType: "TALENT_GROUP" as const,
        subjectId: assignment.groupId,
      })),
    ]);
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
      members: disabledModule(),
    },
  };
}

function disabledModule(): {
  readonly visible: false;
  readonly reason: "NOT_ENABLED_IN_MANAGER_WORKSPACE_YET";
} {
  return {
    visible: false,
    reason: "NOT_ENABLED_IN_MANAGER_WORKSPACE_YET",
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

function hasKpiManagedCapability(actor: Actor): boolean {
  return (
    PermissionGuard.hasKpiScopeGrant(actor, "managedGroup") &&
    (actor.permissions.includes(Permission.KPI_READ) ||
      actor.permissions.includes(Permission.KPI_READ_PROGRESS))
  );
}

function toOrgUnitScope(
  assignment: OrgUnitManagerAssignment,
  refs: ReadonlyMap<string, ReferenceSummary>,
  actor: Actor,
  hasManagerCapability: boolean,
): ManagerWorkspaceOrgUnitScope {
  const ref = refs.get(`ORG_UNIT:${assignment.orgUnitId}`);
  const directUnitManager =
    assignment.role === "UNIT_MANAGER" && !assignment.includeDescendants;
  const canWrite =
    hasManagerCapability &&
    directUnitManager &&
    actor.permissions.includes(Permission.KPI_ENTER_ACTUAL);

  return {
    orgUnitId: assignment.orgUnitId,
    ...(ref?.code ? { code: ref.code } : {}),
    name: ref?.name ?? ref?.displayName ?? assignment.orgUnitId,
    ...(ref?.displayName ? { displayName: ref.displayName } : {}),
    role: assignment.role,
    includeDescendants: assignment.includeDescendants,
    ...(assignment.isPrimary ? { isPrimary: true } : {}),
    capabilities: {
      kpi: {
        read: hasManagerCapability,
        manageAllocation: canWrite,
        enterActual: canWrite,
        correctActual:
          hasManagerCapability &&
          directUnitManager &&
          actor.permissions.includes(Permission.KPI_CORRECT_ACTUAL),
        finalize: false,
      },
    },
  };
}

function toTalentGroupScope(
  assignment: TalentGroupManagerAssignment,
  refs: ReadonlyMap<string, ReferenceSummary>,
  actor: Actor,
  hasManagerCapability: boolean,
): ManagerWorkspaceTalentGroupScope {
  const ref = refs.get(`TALENT_GROUP:${assignment.groupId}`);

  return {
    talentGroupId: assignment.groupId,
    ...(ref?.code ? { code: ref.code } : {}),
    name: ref?.name ?? ref?.displayName ?? assignment.groupId,
    ...(ref?.displayName ? { displayName: ref.displayName } : {}),
    capabilities: {
      kpi: {
        read: hasManagerCapability,
        manageAllocation:
          hasManagerCapability &&
          actor.permissions.includes(Permission.KPI_ENTER_ACTUAL),
        enterActual:
          hasManagerCapability &&
          actor.permissions.includes(Permission.KPI_ENTER_ACTUAL),
        correctActual:
          hasManagerCapability &&
          actor.permissions.includes(Permission.KPI_CORRECT_ACTUAL),
        finalize: false,
      },
    },
  };
}
