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
import {
  StructuredScopeAuthorityAssignment,
  StructuredScopeAuthorityService,
} from "@modules/role/domain/structured-scope-authority";

const now = Date.UTC(2026, 5, 4, 0, 0, 0, 0);

test("manager Events use active OrgUnit and TalentGroup assignments only", async () => {
  let capturedScope: unknown;
  const service = new ManagerWorkspaceEventAdminService(
    {
      async findNonArchivedByLinkedUserId() {
        return activeProfile();
      },
    },
    managedScopeReader({
      talentGroupAssignments: [talentGroupAssignment("tg-managed")],
      orgUnitAssignments: [orgUnitAssignment("ou-managed", "UNIT_MANAGER")],
    }),
    {
      async listManagerEventSummaries(scope) {
        capturedScope = scope;
        return [];
      },
      async getManagerEventSummary() {
        return null;
      },
    },
    structuredAuthority(),
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
    managedScopeReader({
      talentGroupAssignments: [talentGroupAssignment("tg-managed")],
      orgUnitAssignments: [orgUnitAssignment("ou-managed", "UNIT_MANAGER")],
    }),
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
    structuredAuthority(),
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
    managedScopeReader({}),
    {
      async listManagerEventSummaries() {
        return [];
      },
      async getManagerEventSummary() {
        return null;
      },
    },
    structuredAuthority(),
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

test("manager Events require matching structured OrgUnit and TalentGroup scopes", async () => {
  let capturedScope: unknown;
  const service = new ManagerWorkspaceEventAdminService(
    {
      async findNonArchivedByLinkedUserId() {
        return activeProfile();
      },
    },
    managedScopeReader({
      talentGroupAssignments: [talentGroupAssignment("tg-managed")],
      orgUnitAssignments: [orgUnitAssignment("ou-managed", "UNIT_MANAGER")],
    }),
    {
      async listManagerEventSummaries(scope) {
        capturedScope = scope;
        return [];
      },
      async getManagerEventSummary() {
        return null;
      },
    },
    structuredAuthority([
      structuredAssignment({
        permission: "event.read",
        scopeType: "managedTalentGroup",
        targetId: "tg-other",
      }),
      structuredAssignment({
        permission: "event.read",
        scopeType: "managedOrgUnit",
        targetId: "ou-other",
      }),
    ]),
    () => now,
  );

  assert.deepEqual(
    (await service.listEvents(managerActor({ permissions: ["event.read"] })))
      .items,
    [],
  );
  assert.deepEqual(capturedScope, { orgUnitIds: [], talentGroupIds: [] });
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

test("manager workspace context fail-closes without MANAGER_CONSOLE account context", async () => {
  const service = createService({ profile: activeProfile() });
  const context = await service.getContext(
    managerActor({ accountContexts: ["STAFF_CONSOLE"] }),
  );

  assert.equal(context.employmentProfile, null);
  assert.equal(context.readiness.canUseManagerWorkspace, false);
  assert.deepEqual(context.readiness.reasons, [
    "MANAGER_CONSOLE_ACCOUNT_CONTEXT_MISSING",
  ]);
  assert.equal(context.modules.kpi.visible, false);
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

test("manager KPI stays unavailable without the shared operation's kpi.managedGroup prerequisite", async () => {
  const service = createService({
    profile: activeProfile(),
    orgUnitAssignments: [orgUnitAssignment("ou-production", "UNIT_MANAGER")],
  });

  const context = await service.getContext(
    managerActor({ scopeGrants: {} }),
  );

  assert.equal(context.scopes.orgUnits[0]?.capabilities.kpi.read, true);
  assert.equal(context.modules.kpi.visible, false);
  assert.equal(context.modules.kpi.unitKpiVisible, false);
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

test("business assignment without matching structured scope does not expose manager context authority", async () => {
  const service = createService({
    profile: activeProfile(),
    orgUnitAssignments: [orgUnitAssignment("ou-production", "UNIT_MANAGER")],
    talentGroupAssignments: [talentGroupAssignment("tg-live")],
    structuredAuthority: structuredAuthority([
      structuredAssignment({
        permission: "kpi.read",
        scopeType: "managedOrgUnit",
        targetId: "ou-other",
      }),
      structuredAssignment({
        permission: "kpi.read",
        scopeType: "managedTalentGroup",
        targetId: "tg-other",
      }),
    ]),
  });
  const context = await service.getContext(managerActor());

  assert.equal(context.modules.kpi.visible, false);
  assert.equal(context.scopes.orgUnits.length, 0);
  assert.equal(context.scopes.talentGroups.length, 0);
  assert.deepEqual(context.readiness.reasons, ["NO_MANAGED_SCOPE_ASSIGNED"]);
});

test("inactive actor does not gain manager context authority from role name or assignments", async () => {
  const service = createService({
    profile: activeProfile(),
    orgUnitAssignments: [orgUnitAssignment("ou-production", "UNIT_MANAGER")],
    talentGroupAssignments: [talentGroupAssignment("tg-live")],
  });
  const context = await service.getContext(
    managerActor({ isActive: false, roles: ["TEAM_MANAGER"] }),
  );

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

test("manager WorkSchedule requires exact persisted roster-target authority in addition to shared-member eligibility", async () => {
  for (const scenario of [
    {
      targetType: "ORG_UNIT" as const,
      authorizedTarget: "ou-a",
      unauthorizedTarget: "ou-b",
      input: {
        orgUnitAssignments: [orgUnitAssignment("ou-a", "UNIT_MANAGER")],
        orgUnitProfiles: [managedProfile("ep-shared")],
      },
    },
    {
      targetType: "TALENT_GROUP" as const,
      authorizedTarget: "tg-a",
      unauthorizedTarget: "tg-b",
      input: {
        talentGroupAssignments: [talentGroupAssignment("tg-a")],
        talentGroupProfiles: [
          managedTalentGroupResolution(managedProfile("ep-shared")),
        ],
      },
    },
  ]) {
    const service = createWorkScheduleService({
      ...scenario.input,
      structuredAuthority: structuredAuthority([
        structuredAssignment({
          permission: "workSchedule.read",
          scopeType:
            scenario.targetType === "ORG_UNIT"
              ? "managedOrgUnit"
              : "managedTalentGroup",
          targetId: scenario.authorizedTarget,
        }),
      ]),
      onList() {
        return [
          managerShift(
            `shift-${scenario.targetType}-unauthorized`,
            "ep-shared",
            "ROSTER_GENERATED",
            { type: scenario.targetType, id: scenario.unauthorizedTarget },
          ),
          managerShift(
            `shift-${scenario.targetType}-authorized`,
            "ep-shared",
            "ROSTER_GENERATED",
            { type: scenario.targetType, id: scenario.authorizedTarget },
          ),
          managerShift(`shift-${scenario.targetType}-manual`, "ep-shared"),
        ];
      },
    });

    const result = await service.listWorkShifts(
      managerActor({ permissions: ["workSchedule.read"], scopeGrants: {} }),
      { month: "2026-06" },
    );
    assert.deepEqual(
      result.items.map((item) => item.workShiftId),
      [
        `shift-${scenario.targetType}-authorized`,
        `shift-${scenario.targetType}-manual`,
      ],
      `${scenario.targetType} shared member cannot bridge to its unauthorized roster target`,
    );
  }
});

test("manager WorkSchedule does not treat descendant-expanded access as exact roster-target authority", async () => {
  let repositoryCalled = false;
  const service = createWorkScheduleService({
    managedScope: {
      async resolveManagedScopeByResponsibleEmploymentProfile() {
        return {
          orgUnitIds: ["ou-parent", "ou-child"],
          talentGroupIds: [],
          orgUnitScopes: [
            {
              orgUnitId: "ou-parent",
              role: "UNIT_MANAGER",
              includeDescendants: true,
              actionMask: [],
              isPrimary: true,
            },
          ],
        };
      },
    },
    structuredAuthority: structuredAuthority([
      structuredAssignment({
        permission: "workSchedule.read",
        scopeType: "managedOrgUnit",
        targetId: "ou-child",
      }),
    ]),
    onList() {
      repositoryCalled = true;
      return [];
    },
  });

  const result = await service.listWorkShifts(
    managerActor({ permissions: ["workSchedule.read"], scopeGrants: {} }),
    { month: "2026-06" },
  );

  assert.equal(repositoryCalled, false);
  assert.deepEqual(result.items, []);
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

test("manager WorkSchedule requires matching structured OrgUnit and TalentGroup scope", async () => {
  let repositoryCalled = false;
  const service = createWorkScheduleService({
    orgUnitAssignments: [orgUnitAssignment("ou-direct", "UNIT_MANAGER")],
    talentGroupAssignments: [talentGroupAssignment("tg-live")],
    orgUnitProfiles: [managedProfile("ep-org")],
    talentGroupProfiles: [
      managedTalentGroupResolution(managedProfile("ep-group")),
    ],
    structuredAuthority: structuredAuthority([
      structuredAssignment({
        permission: "workSchedule.read",
        scopeType: "managedOrgUnit",
        targetId: "ou-other",
      }),
      structuredAssignment({
        permission: "workSchedule.read",
        scopeType: "managedTalentGroup",
        targetId: "tg-other",
      }),
    ]),
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
  assert.equal(result.meta.managedMemberCount, 0);
});

function createService(input: {
  readonly profile: EmploymentProfileRecord | null;
  readonly orgUnitAssignments?: readonly OrgUnitManagerAssignment[];
  readonly talentGroupAssignments?: readonly TalentGroupManagerAssignment[];
  readonly structuredAuthority?: StructuredScopeAuthorityService;
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
    managedScopeReader(input),
    input.structuredAuthority ?? structuredAuthority(),
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
    accountContexts: ["MANAGER_CONSOLE"],
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

function managedScopeReader(input: {
  readonly orgUnitAssignments?: readonly OrgUnitManagerAssignment[];
  readonly talentGroupAssignments?: readonly TalentGroupManagerAssignment[];
}) {
  return {
    async resolveManagedScopeByResponsibleEmploymentProfile() {
      return {
        talentGroupIds: [
          ...new Set(
            (input.talentGroupAssignments ?? []).map(
              (assignment) => assignment.groupId,
            ),
          ),
        ],
        orgUnitIds: [
          ...new Set(
            (input.orgUnitAssignments ?? []).map(
              (assignment) => assignment.orgUnitId,
            ),
          ),
        ],
        orgUnitScopes: (input.orgUnitAssignments ?? []).map((assignment) => ({
          orgUnitId: assignment.orgUnitId,
          role: assignment.role,
          includeDescendants: assignment.includeDescendants,
          actionMask: assignment.actionMask,
          isPrimary: assignment.isPrimary,
        })),
      };
    },
  };
}

function createWorkScheduleService(input: {
  readonly orgUnitAssignments?: readonly OrgUnitManagerAssignment[];
  readonly talentGroupAssignments?: readonly TalentGroupManagerAssignment[];
  readonly orgUnitProfiles?: readonly WorkScheduleReferencedEmploymentProfile[];
  readonly talentGroupProfiles?: readonly ReturnType<typeof managedTalentGroupResolution>[];
  readonly onList?: (input: WorkShiftListReadInput) => ReturnType<typeof managerShift>[];
  readonly structuredAuthority?: StructuredScopeAuthorityService;
  readonly managedScope?: ReturnType<typeof managedScopeReader>;
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
    input.managedScope ?? managedScopeReader(input),
    {
      async listWorkShifts(readInput) {
        return { items: input.onList?.(readInput) ?? [] };
      },
    },
    input.structuredAuthority ?? structuredAuthority(),
    () => now,
  );
}

function structuredAuthority(
  assignments: readonly StructuredScopeAuthorityAssignment[] = [
    ...structuredAssignmentsFor("kpi.read", "managedOrgUnit", [
      "ou-production",
      "ou-department",
      "ou-operator",
    ]),
    ...structuredAssignmentsFor("kpi.readProgress", "managedOrgUnit", [
      "ou-production",
      "ou-department",
      "ou-operator",
    ]),
    structuredAssignment({
      permission: "kpi.enterActual",
      scopeType: "managedOrgUnit",
      targetId: "ou-production",
    }),
    structuredAssignment({
      permission: "kpi.correctActual",
      scopeType: "managedOrgUnit",
      targetId: "ou-production",
    }),
    ...structuredAssignmentsFor("kpi.read", "managedTalentGroup", ["tg-live"]),
    ...structuredAssignmentsFor("kpi.readProgress", "managedTalentGroup", [
      "tg-live",
    ]),
    ...structuredAssignmentsFor("kpi.enterActual", "managedTalentGroup", [
      "tg-live",
    ]),
    ...structuredAssignmentsFor("kpi.correctActual", "managedTalentGroup", [
      "tg-live",
    ]),
    structuredAssignment({
      permission: "workSchedule.read",
      scopeType: "managedOrgUnit",
      targetId: "ou-production",
    }),
    structuredAssignment({
      permission: "workSchedule.read",
      scopeType: "managedOrgUnit",
      targetId: "ou-direct",
    }),
    structuredAssignment({
      permission: "workSchedule.read",
      scopeType: "managedTalentGroup",
      targetId: "tg-live",
    }),
    structuredAssignment({
      permission: "event.read",
      scopeType: "managedOrgUnit",
      targetId: "ou-managed",
    }),
    structuredAssignment({
      permission: "event.read",
      scopeType: "managedTalentGroup",
      targetId: "tg-managed",
    }),
  ],
): StructuredScopeAuthorityService {
  return new StructuredScopeAuthorityService(
    {
      async listByUserId(userId) {
        return assignments.filter(
          (assignment) => assignment.assignment.userId === userId,
        );
      },
    },
    () => now,
  );
}

function structuredAssignmentsFor(
  permission: string,
  scopeType: "managedOrgUnit" | "managedTalentGroup",
  targetIds: readonly string[],
): readonly StructuredScopeAuthorityAssignment[] {
  return targetIds.map((targetId) =>
    structuredAssignment({ permission, scopeType, targetId }),
  );
}

function structuredAssignment(input: {
  readonly permission: string;
  readonly scopeType: "managedOrgUnit" | "managedTalentGroup";
  readonly targetId: string;
}): StructuredScopeAuthorityAssignment {
  const assignmentId = [
    "structured",
    input.permission,
    input.scopeType,
    input.targetId,
  ].join("-");
  return {
    assignment: {
      assignmentId,
      roleId: assignmentId,
      userId: "user-manager",
      structuredScopeGrants: [
        { scopeType: input.scopeType, targetId: input.targetId },
      ],
      state: "ACTIVE",
      effectiveAt: now - 1,
      expiresAt: null,
      revokedAt: null,
      origin: "DIRECT",
      bundleOrigin: null,
      reason: null,
      createdAt: now - 1,
      updatedAt: now - 1,
    },
    role: {
      id: assignmentId,
      state: "ACTIVE",
      permissions: [input.permission],
    },
  };
}

function managedProfile(
  id: string,
  employmentStatus: WorkScheduleReferencedEmploymentProfile["employmentStatus"] = "ACTIVE",
): WorkScheduleReferencedEmploymentProfile {
  return {
    id,
    employmentStatus,
    orgUnitId: "ou-direct",
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
  rosterTarget: { readonly type: "ORG_UNIT" | "TALENT_GROUP"; readonly id: string } = {
    type: "TALENT_GROUP",
    id: "tg-live",
  },
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
    sourceRosterTargetType: sourceType === "ROSTER_GENERATED" ? rosterTarget.type : null,
    sourceRosterTargetId: sourceType === "ROSTER_GENERATED" ? rosterTarget.id : null,
    sourceRosterTargetMode: sourceType === "ROSTER_GENERATED" ? ("EXACT_ONLY" as const) : null,
    sourceRosterLocalDate: sourceType === "ROSTER_GENERATED" ? "2026-06-06" : null,
    sourceRosterSlotKey: sourceType === "ROSTER_GENERATED" ? "slot-1" : null,
    createdAt: now,
  };
}
