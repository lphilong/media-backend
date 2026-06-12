import assert from "node:assert/strict";
import test from "node:test";
import { Actor } from "@core/actor/actor";
import { EmploymentProfileRecord } from "@modules/employment-profile/domain/employment-profile.types";
import {
  OrgUnitManagerAssignment,
  TalentGroupManagerAssignment,
} from "@modules/kpi/domain/kpi.types";
import { WorkScheduleReferencedEmploymentProfile } from "@modules/work-schedule/domain/work-schedule-employment-profile-readonly-access";
import { WorkShiftListReadInput } from "@modules/work-schedule/read/work-schedule.read-repository";
import { ManagerWorkspaceAdminService } from "./admin/admin.manager-workspace.service";
import { ManagerWorkspaceWorkScheduleAdminService } from "./admin/admin.manager-workspace-work-schedule.service";
import { ManagerWorkspaceEventAdminService } from "./admin/admin.manager-workspace-event.service";
import { EventAssignmentPermissionScopeError } from "@modules/event-assignment/domain/event-assignment.errors";

const now = Date.UTC(2026, 5, 4, 0, 0, 0, 0);

test("manager Events use active OrgUnit and TalentGroup assignments only", async () => {
  let capturedScope: unknown;
  const service = new ManagerWorkspaceEventAdminService(
    {
      async findNonArchivedByLinkedUserId() {
        return activeProfile();
      },
    },
    {
      async listActiveAssignmentsByManagerEmploymentProfile() {
        return [talentGroupAssignment("tg-managed")];
      },
    },
    {
      async listActiveByManagerEmploymentProfileId() {
        return [orgUnitAssignment("ou-managed", "UNIT_MANAGER")];
      },
    },
    {
      async listManagerEventSummaries(scope) {
        capturedScope = scope;
        return [];
      },
      async getManagerEventSummary() {
        return null;
      },
    },
    () => now,
  );

  const result = await service.listEvents(
    managerActor({ permissions: ["event.read"], roles: ["TEAM_MANAGER"] }),
  );

  assert.deepEqual(result.items, []);
  assert.deepEqual(capturedScope, {
    orgUnitIds: ["ou-managed"],
    talentGroupIds: ["tg-managed"],
  });
});

test("manager Event detail returns completion evidence as read-only summary", async () => {
  const service = new ManagerWorkspaceEventAdminService(
    {
      async findNonArchivedByLinkedUserId() {
        return activeProfile();
      },
    },
    {
      async listActiveAssignmentsByManagerEmploymentProfile() {
        return [talentGroupAssignment("tg-managed")];
      },
    },
    {
      async listActiveByManagerEmploymentProfileId() {
        return [orgUnitAssignment("ou-managed", "UNIT_MANAGER")];
      },
    },
    {
      async listManagerEventSummaries() {
        return [];
      },
      async getManagerEventSummary() {
        return {
          id: "event-completed",
          eventCode: "EVT-COMPLETE",
          title: "Completed event",
          status: "COMPLETED",
          eventStartAt: now,
          eventEndAt: now + 3_600_000,
          owner: { id: "ep-owner", displayName: "Owner" },
          participants: [],
          completionEvidence: {
            completedAt: now + 3_600_000,
            completedByActorId: "admin-1",
            evidenceNote: "Delivered recap package.",
            evidenceRefs: [
              {
                type: "INTERNAL_REFERENCE",
                label: "Ops ticket",
                url: null,
                referenceId: "OPS-123",
              },
            ],
          },
          studioBookings: [],
        };
      },
    },
    () => now,
  );

  const result = await service.getEvent(
    managerActor({ permissions: ["event.read"], roles: ["TEAM_MANAGER"] }),
    "event-completed",
  );

  assert.equal(result.completionEvidence?.evidenceNote, "Delivered recap package.");
  assert.equal("completeEvent" in service, false);
  assert.equal("updateCompletionEvidence" in service, false);
});

test("manager Events fail closed without assignment scope and expose no mutation surface", async () => {
  const service = new ManagerWorkspaceEventAdminService(
    {
      async findNonArchivedByLinkedUserId() {
        return activeProfile();
      },
    },
    {
      async listActiveAssignmentsByManagerEmploymentProfile() {
        return [];
      },
    },
    {
      async listActiveByManagerEmploymentProfileId() {
        return [];
      },
    },
    {
      async listManagerEventSummaries() {
        return [];
      },
      async getManagerEventSummary() {
        return null;
      },
    },
    () => now,
  );
  const actor = managerActor({
    permissions: ["event.read"],
    roles: ["TEAM_MANAGER"],
  });

  assert.deepEqual((await service.listEvents(actor)).items, []);
  await assert.rejects(
    service.getEvent(actor, "event-out-of-scope"),
    EventAssignmentPermissionScopeError,
  );
  assert.equal("createEvent" in service, false);
  assert.equal("cancelEvent" in service, false);
});

test("manager workspace context fail-closes without linked EmploymentProfile", async () => {
  const service = createService({ profile: null });
  const context = await service.getContext(managerActor());

  assert.equal(context.employmentProfile, null);
  assert.equal(context.modules.kpi.visible, false);
  assert.equal(context.modules.kpi.unitKpiVisible, false);
  assert.equal(context.modules.kpi.talentGroupKpiVisible, false);
  assert.deepEqual(context.readiness.reasons, ["NO_LINKED_EMPLOYMENT_PROFILE"]);
});

test("manager workspace context shows readiness empty state with active profile and no assignments", async () => {
  const service = createService({ profile: activeProfile() });
  const context = await service.getContext(managerActor());

  assert.equal(context.employmentProfile?.id, "ep-manager");
  assert.equal(context.readiness.canUseManagerWorkspace, true);
  assert.deepEqual(context.readiness.reasons, ["NO_MANAGED_SCOPE_ASSIGNED"]);
  assert.equal(context.scopes.orgUnits.length, 0);
  assert.equal(context.scopes.talentGroups.length, 0);
  assert.equal(context.modules.kpi.visible, false);
});

test("OrgUnit-only manager context exposes Unit KPI only", async () => {
  const service = createService({
    profile: activeProfile(),
    orgUnitAssignments: [orgUnitAssignment("ou-production", "UNIT_MANAGER")],
  });
  const context = await service.getContext(managerActor());

  assert.equal(context.modules.kpi.visible, true);
  assert.equal(context.modules.kpi.unitKpiVisible, true);
  assert.equal(context.modules.kpi.talentGroupKpiVisible, false);
  assert.equal(context.scopes.orgUnits[0]?.orgUnitId, "ou-production");
  assert.equal(context.scopes.orgUnits[0]?.name, "Production Unit");
  assert.equal(context.modules.workShifts.visible, false);
});

test("managed Work is visible only with assignment and WorkSchedule read capability", async () => {
  const service = createService({
    profile: activeProfile(),
    orgUnitAssignments: [orgUnitAssignment("ou-production", "UNIT_MANAGER")],
  });
  const context = await service.getContext(
    managerActor({
      permissions: ["workSchedule.read"],
      scopeGrants: {},
    }),
  );

  assert.deepEqual(context.modules.workShifts, { visible: true });
  assert.equal(context.modules.kpi.visible, false);
});

test("TalentGroup-only manager context exposes Talent Group KPI only", async () => {
  const service = createService({
    profile: activeProfile(),
    talentGroupAssignments: [talentGroupAssignment("tg-live")],
  });
  const context = await service.getContext(managerActor());

  assert.equal(context.modules.kpi.visible, true);
  assert.equal(context.modules.kpi.unitKpiVisible, false);
  assert.equal(context.modules.kpi.talentGroupKpiVisible, true);
  assert.equal(context.scopes.talentGroups[0]?.talentGroupId, "tg-live");
  assert.equal(context.scopes.talentGroups[0]?.name, "Live Talent");
});

test("dual manager context exposes both KPI tabs", async () => {
  const service = createService({
    profile: activeProfile(),
    orgUnitAssignments: [orgUnitAssignment("ou-production", "UNIT_MANAGER")],
    talentGroupAssignments: [talentGroupAssignment("tg-live")],
  });
  const context = await service.getContext(managerActor());

  assert.equal(context.modules.kpi.visible, true);
  assert.equal(context.modules.kpi.unitKpiVisible, true);
  assert.equal(context.modules.kpi.talentGroupKpiVisible, true);
});

test("DEPARTMENT_OWNER and UNIT_OPERATOR OrgUnit scopes are read-only for KPI v1", async () => {
  const service = createService({
    profile: activeProfile(),
    orgUnitAssignments: [
      orgUnitAssignment("ou-department", "DEPARTMENT_OWNER"),
      orgUnitAssignment("ou-operator", "UNIT_OPERATOR"),
    ],
  });
  const context = await service.getContext(managerActor());

  assert.deepEqual(
    context.scopes.orgUnits.map((scope) => scope.capabilities.kpi),
    [
      {
        read: true,
        manageAllocation: false,
        enterActual: false,
        correctActual: false,
        finalize: false,
      },
      {
        read: true,
        manageAllocation: false,
        enterActual: false,
        correctActual: false,
        finalize: false,
      },
    ],
  );
});

test("direct UNIT_MANAGER assignment exposes current KPI write capabilities when permissions allow", async () => {
  const service = createService({
    profile: activeProfile(),
    orgUnitAssignments: [orgUnitAssignment("ou-production", "UNIT_MANAGER")],
  });
  const context = await service.getContext(managerActor());

  assert.deepEqual(context.scopes.orgUnits[0]?.capabilities.kpi, {
    read: true,
    manageAllocation: true,
    enterActual: true,
    correctActual: true,
    finalize: false,
  });
});

test("role/capability without assignment does not expose module data", async () => {
  const service = createService({ profile: activeProfile() });
  const context = await service.getContext(managerActor({ roles: ["TEAM_MANAGER"] }));

  assert.equal(context.modules.kpi.visible, false);
  assert.equal(context.scopes.orgUnits.length, 0);
  assert.equal(context.scopes.talentGroups.length, 0);
  assert.deepEqual(context.readiness.reasons, ["NO_MANAGED_SCOPE_ASSIGNED"]);
});

test("terminated linked EmploymentProfile fail-closes manager workspace context", async () => {
  const service = createService({
    profile: activeProfile({ employmentStatus: "TERMINATED" }),
    orgUnitAssignments: [orgUnitAssignment("ou-production", "UNIT_MANAGER")],
    talentGroupAssignments: [talentGroupAssignment("tg-live")],
  });
  const context = await service.getContext(managerActor());

  assert.equal(context.modules.kpi.visible, false);
  assert.equal(context.scopes.orgUnits.length, 0);
  assert.equal(context.scopes.talentGroups.length, 0);
  assert.deepEqual(context.readiness.reasons, [
    "EMPLOYMENT_PROFILE_NOT_ACTIVE_OR_ON_LEAVE",
  ]);
});

test("manager workspace context requires no new scope literals", async () => {
  const actor = managerActor();
  assert.deepEqual(actor.scopeGrants.kpi, ["managedGroup"]);
});

test("manager WorkSchedule unions exact OrgUnit and eligible TalentGroup members, dedupes, and fails closed", async () => {
  let capturedInput: WorkShiftListReadInput | undefined;
  const service = createWorkScheduleService({
    orgUnitAssignments: [orgUnitAssignment("ou-direct", "UNIT_MANAGER", { includeDescendants: true })],
    talentGroupAssignments: [talentGroupAssignment("tg-live")],
    orgUnitProfiles: [managedProfile("ep-org"), managedProfile("ep-both"), managedProfile("ep-inactive", "SUSPENDED")],
    talentGroupProfiles: [
      managedTalentGroupResolution(managedProfile("ep-group")),
      managedTalentGroupResolution(managedProfile("ep-both")),
      managedTalentGroupResolution(managedProfile("ep-removed"), "REMOVED"),
    ],
    onList(input) {
      capturedInput = input;
      return [
        managerShift("shift-org", "ep-org"),
        managerShift("shift-group", "ep-group", "ROSTER_GENERATED"),
        managerShift("shift-both", "ep-both"),
        managerShift("shift-unmanaged", "ep-unmanaged"),
      ];
    },
  });

  const result = await service.listWorkShifts(
    managerActor({ permissions: ["workSchedule.read"], scopeGrants: {} }),
    { month: "2026-06" },
  );

  assert.deepEqual(capturedInput?.scopeEmploymentProfileIds, ["ep-both", "ep-group", "ep-org"]);
  assert.equal(capturedInput?.status, "ACTIVE");
  assert.equal(capturedInput?.subjectKind, "EMPLOYMENT_PROFILE");
  assert.deepEqual(result.items.map((item) => item.workShiftId), [
    "shift-org",
    "shift-group",
    "shift-both",
  ]);
  assert.equal(result.meta.managedMemberCount, 3);
  assert.equal(result.meta.representedMemberCount, 3);
});

test("manager WorkSchedule reporting-manager relationship alone grants no access and no mutations", async () => {
  let repositoryCalled = false;
  const service = createWorkScheduleService({
    onList() {
      repositoryCalled = true;
      return [];
    },
  });

  const result = await service.listWorkShifts(
    managerActor({ permissions: ["workSchedule.read"], scopeGrants: {} }),
    {},
  );

  assert.equal(repositoryCalled, false);
  assert.deepEqual(result.items, []);
  assert.equal("createWorkShift" in service, false);
  assert.equal("cancelWorkShift" in service, false);
});

function createService(input: {
  readonly profile: EmploymentProfileRecord | null;
  readonly orgUnitAssignments?: readonly OrgUnitManagerAssignment[];
  readonly talentGroupAssignments?: readonly TalentGroupManagerAssignment[];
}): ManagerWorkspaceAdminService {
  return new ManagerWorkspaceAdminService(
    {
      async findNonArchivedByLinkedUserId() {
        return input.profile;
      },
    },
    {
      async listSubjectRefs(subjects) {
        return new Map(
          subjects.map((subject) => [
            `${subject.subjectType}:${subject.subjectId}`,
            subject.subjectType === "ORG_UNIT"
              ? {
                  id: subject.subjectId,
                  code: subject.subjectId.toUpperCase(),
                  name:
                    subject.subjectId === "ou-production"
                      ? "Production Unit"
                      : subject.subjectId,
                  displayName:
                    subject.subjectId === "ou-production"
                      ? "Production Unit"
                      : subject.subjectId,
                  status: "ACTIVE",
                }
              : {
                  id: subject.subjectId,
                  code: subject.subjectId.toUpperCase(),
                  name:
                    subject.subjectId === "tg-live" ? "Live Talent" : subject.subjectId,
                  displayName:
                    subject.subjectId === "tg-live" ? "Live Talent" : subject.subjectId,
                  status: "ACTIVE",
                },
          ]),
        );
      },
    },
    {
      async listActiveAssignmentsByManagerEmploymentProfile() {
        return input.talentGroupAssignments ?? [];
      },
    },
    {
      async listActiveByManagerEmploymentProfileId() {
        return input.orgUnitAssignments ?? [];
      },
    },
    () => now,
  );
}

function managerActor(
  overrides: Partial<ConstructorParameters<typeof Actor>[0]> = {},
): Actor {
  return new Actor({
    id: "user-manager",
    type: "admin",
    context: "ADMIN",
    roles: [],
    permissions: [
      "kpi.read",
      "kpi.readProgress",
      "kpi.enterActual",
      "kpi.correctActual",
    ],
    scopeGrants: {
      kpi: ["managedGroup"],
    },
    isActive: true,
    ...overrides,
  });
}

function activeProfile(
  overrides: Partial<EmploymentProfileRecord> = {},
): EmploymentProfileRecord {
  return {
    id: "ep-manager",
    employeeCode: "EP-MGR-001",
    legalName: "Mina Manager",
    normalizedLegalName: "mina manager",
    displayName: "Mina Manager",
    normalizedDisplayName: "mina manager",
    employmentKind: "EMPLOYEE",
    jobTitle: "Manager",
    titleDescription: null,
    externalRef: null,
    orgUnitId: "ou-home",
    managerEmploymentProfileId: null,
    recruiterEmploymentProfileId: null,
    hrOwnerEmploymentProfileId: null,
    onboardingOwnerEmploymentProfileId: null,
    sourcedByEmploymentProfileId: null,
    linkedUserId: "user-manager",
    employmentStatus: "ACTIVE",
    contractStatus: "ACTIVE",
    employmentStartDate: now,
    employmentEndDate: null,
    hiredAt: null,
    onboardedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function orgUnitAssignment(
  orgUnitId: string,
  role: OrgUnitManagerAssignment["role"],
  overrides: Partial<OrgUnitManagerAssignment> = {},
): OrgUnitManagerAssignment {
  return {
    id: `assign-${orgUnitId}-${role}`,
    orgUnitId,
    managerEmploymentProfileId: "ep-manager",
    role,
    includeDescendants: false,
    actionMask: [],
    effectiveFrom: now - 1000,
    effectiveTo: null,
    status: "ACTIVE",
    isPrimary: false,
    createdAt: now,
    createdByActorId: "user-admin",
    updatedAt: now,
    updatedByActorId: "user-admin",
    ...overrides,
  };
}

function talentGroupAssignment(
  groupId: string,
  overrides: Partial<TalentGroupManagerAssignment> = {},
): TalentGroupManagerAssignment {
  return {
    id: `assign-${groupId}`,
    groupId,
    managerEmploymentProfileId: "ep-manager",
    role: "MANAGER",
    effectiveFrom: now - 1000,
    effectiveTo: null,
    status: "ACTIVE",
    isPrimary: false,
    createdAt: now,
    createdByActorId: "user-admin",
    updatedAt: now,
    updatedByActorId: "user-admin",
    ...overrides,
  };
}

function createWorkScheduleService(input: {
  readonly orgUnitAssignments?: readonly OrgUnitManagerAssignment[];
  readonly talentGroupAssignments?: readonly TalentGroupManagerAssignment[];
  readonly orgUnitProfiles?: readonly WorkScheduleReferencedEmploymentProfile[];
  readonly talentGroupProfiles?: readonly ReturnType<typeof managedTalentGroupResolution>[];
  readonly onList?: (input: WorkShiftListReadInput) => ReturnType<typeof managerShift>[];
}): ManagerWorkspaceWorkScheduleAdminService {
  return new ManagerWorkspaceWorkScheduleAdminService(
    {
      async findNonArchivedByLinkedUserId() {
        return activeProfile();
      },
    },
    {
      async listByOrgUnitId() {
        return input.orgUnitProfiles ?? [];
      },
      async listTalentGroupMemberEmploymentProfileResolutions() {
        return input.talentGroupProfiles ?? [];
      },
    },
    {
      async listActiveAssignmentsByManagerEmploymentProfile() {
        return input.talentGroupAssignments ?? [];
      },
    },
    {
      async listActiveByManagerEmploymentProfileId() {
        return input.orgUnitAssignments ?? [];
      },
    },
    {
      async listWorkShifts(readInput) {
        return { items: input.onList?.(readInput) ?? [] };
      },
    },
    () => now,
  );
}

function managedProfile(
  id: string,
  employmentStatus: WorkScheduleReferencedEmploymentProfile["employmentStatus"] = "ACTIVE",
): WorkScheduleReferencedEmploymentProfile {
  return {
    id,
    employmentStatus,
    orgUnitId: "ou-direct",
    managerEmploymentProfileId: id === "ep-reporting-only" ? "ep-manager" : null,
    linkedUserId: null,
    ref: {
      id,
      code: id.toUpperCase(),
      displayName: `Display ${id}`,
      status: employmentStatus,
    },
  };
}

function managedTalentGroupResolution(
  employmentProfile: WorkScheduleReferencedEmploymentProfile,
  membershipStatus = "ACTIVE",
) {
  return {
    memberId: `member-${employmentProfile.id}`,
    groupId: "tg-live",
    talentId: `talent-${employmentProfile.id}`,
    membershipStatus,
    talentOperationalStatus: "ACTIVE",
    linkedEmploymentProfileId: employmentProfile.id,
    employmentProfile,
  };
}

function managerShift(
  id: string,
  employmentProfileId: string,
  sourceType: "MANUAL" | "ROSTER_GENERATED" = "MANUAL",
) {
  return {
    id,
    shiftCode: id.toUpperCase(),
    title: `Shift ${id}`,
    subjectKind: "EMPLOYMENT_PROFILE" as const,
    subjectEmploymentProfileId: employmentProfileId,
    subjectTalentId: null,
    subjectTalentGroupId: null,
    status: "ACTIVE" as const,
    shiftStartAt: now,
    shiftEndAt: now + 3_600_000,
    sourceType,
    sourceRosterId: sourceType === "ROSTER_GENERATED" ? "roster-1" : null,
    sourceRosterMonth: sourceType === "ROSTER_GENERATED" ? "2026-06" : null,
    sourceRosterTargetType: sourceType === "ROSTER_GENERATED" ? ("TALENT_GROUP" as const) : null,
    sourceRosterTargetId: sourceType === "ROSTER_GENERATED" ? "tg-live" : null,
    sourceRosterTargetMode: sourceType === "ROSTER_GENERATED" ? ("EXACT_ONLY" as const) : null,
    sourceRosterLocalDate: sourceType === "ROSTER_GENERATED" ? "2026-06-06" : null,
    sourceRosterSlotKey: sourceType === "ROSTER_GENERATED" ? "slot-1" : null,
    createdAt: now,
  };
}
