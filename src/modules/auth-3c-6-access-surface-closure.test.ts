import assert from "node:assert/strict";
import test from "node:test";
import { Actor } from "@core/actor/actor";
import { Permission } from "@core/permission/permission.enum";
import { NativeMongoWorkShiftReadRepository } from "@infra/mongo/work-schedule/work-schedule.read-repository";
import { EmploymentProfileAdminQueryService } from "@modules/employment-profile/admin/admin.employment-profile.query-service";
import { EmploymentProfilePermissionScopeError } from "@modules/employment-profile/domain/employment-profile.errors";
import { EventAssignmentAdminQueryService } from "@modules/event-assignment/admin/admin.event-assignment.query-service";
import { EventAssignmentPermissionScopeError } from "@modules/event-assignment/domain/event-assignment.errors";
import { OrgUnitAdminQueryService } from "@modules/org-unit/admin/admin.org-unit.query-service";
import { OrgUnitPermissionScopeError } from "@modules/org-unit/domain/org-unit.errors";
import { PlatformAccountAdminQueryService } from "@modules/platform-account/admin/admin.platform-account.query-service";
import { StudioResourceAdminQueryService } from "@modules/studio-resource/admin/admin.studio-resource.query-service";
import { TalentAdminQueryService } from "@modules/talent/admin/admin.talent.query-service";
import { TalentGroupAdminQueryService } from "@modules/talent-group/admin/admin.talent-group.query-service";
import { WorkScheduleAdminQueryService } from "@modules/work-schedule/admin/admin.work-schedule.query-service";
import { HolidayCalendarAdminQueryService } from "@modules/work-schedule/admin/admin.holiday-calendar.query-service";
import { WorkPatternAdminQueryService } from "@modules/work-schedule/admin/admin.work-pattern.query-service";
import { WorkSchedulePermissionScopeError } from "@modules/work-schedule/domain/work-schedule.errors";
import { RoleAssignmentScopeGrant } from "@modules/role/domain/role-assignment-scope";
import {
  StructuredScopeAuthorityAssignment,
  StructuredScopeAuthorityService,
} from "@modules/role/domain/structured-scope-authority";

test("WorkShift read separates self, managed targets, roster targets, and direct Talent", async () => {
  const details = new Map<string, object>([
    ["self", shift("self", "EMPLOYMENT_PROFILE", "ep-manager")],
    ["org", shift("org", "EMPLOYMENT_PROFILE", "ep-org")],
    ["group", shift("group", "TALENT_GROUP", null, "group-1")],
    ["talent", shift("talent", "TALENT", null, null, "talent-1")],
    ["roster", {
      ...shift("roster", "EMPLOYMENT_PROFILE", "ep-org"),
      sourceType: "ROSTER_GENERATED" as const,
      sourceRosterTargetType: "TALENT_GROUP" as const,
      sourceRosterTargetId: "group-1",
    }],
    ["roster-org", {
      ...shift("roster-org", "EMPLOYMENT_PROFILE", "ep-org"),
      sourceType: "ROSTER_GENERATED" as const,
      sourceRosterTargetType: "ORG_UNIT" as const,
      sourceRosterTargetId: "org-1",
    }],
  ]);
  const readRepository = {
    async getWorkShiftDetail(id: string) { return details.get(id) ?? null; },
    async listWorkShifts() { return { items: [] }; },
    async listWorkShiftsBySubject() { return { items: [] }; },
    async listWorkShiftsByResource() { return { items: [] }; },
  };
  const profiles = {
    async findByLinkedUserId() { return profile("ep-manager", "org-manager"); },
    async findById(id: string) { return id === "ep-org" ? profile(id, "org-1") : null; },
    async listIdsByOrgUnitId() { return []; },
    async listIdsByActiveTalentGroupIds() { return []; },
  };
  const service = new WorkScheduleAdminQueryService(
    readRepository as never,
    profiles as never,
    { async listActiveAssignmentsByManagerEmploymentProfile() { return [{ groupId: "group-1" }]; } } as never,
    { async listActiveByManagerEmploymentProfileId() { return [{ orgUnitId: "org-1" }]; } } as never,
    authority([
      grant(Permission.WORK_SCHEDULE_READ, { scopeType: "self" }),
      grant(Permission.WORK_SCHEDULE_READ, { scopeType: "managedOrgUnit", targetId: "org-1" }),
      grant(Permission.WORK_SCHEDULE_READ, { scopeType: "managedTalentGroup", targetId: "group-1" }),
    ]),
  );

  for (const id of ["self", "org", "group", "roster", "roster-org"]) {
    assert.equal((await service.getWorkShiftDetail(actor(), { workShiftId: id })).id, id);
  }
  await assert.rejects(
    service.getWorkShiftDetail(actor(), { workShiftId: "talent" }),
    WorkSchedulePermissionScopeError,
  );
  await assert.rejects(
    new WorkScheduleAdminQueryService(
      readRepository as never,
      profiles as never,
      { async listActiveAssignmentsByManagerEmploymentProfile() { return []; } } as never,
      { async listActiveByManagerEmploymentProfileId() { return []; } } as never,
      authority([grant(Permission.WORK_SCHEDULE_READ, { scopeType: "managedOrgUnit", targetId: "org-other" })]),
    ).getWorkShiftDetail(actor(), { workShiftId: "org" }),
    WorkSchedulePermissionScopeError,
  );
  await assert.rejects(
    service.listWorkShifts(actor(), {}),
    WorkSchedulePermissionScopeError,
  );
});

test("WorkShift subject list excludes persisted roster targets outside OrgUnit manager authority", async () => {
  const service = new WorkScheduleAdminQueryService(
    {
      async listWorkShiftsBySubject() {
        return {
          items: [
            listShift("manual"),
            listShift("org-match", {
              sourceType: "ROSTER_GENERATED",
              sourceRosterTargetType: "ORG_UNIT",
              sourceRosterTargetId: "org-1",
            }),
            listShift("group-mismatch", {
              sourceType: "ROSTER_GENERATED",
              sourceRosterTargetType: "TALENT_GROUP",
              sourceRosterTargetId: "group-b",
            }),
            listShift("ambiguous", {
              sourceType: "ROSTER_GENERATED",
              sourceRosterTargetType: "ORG_UNIT",
              sourceRosterTargetId: null,
            }),
          ],
          nextCursor: "next-page",
        };
      },
    } as never,
    {
      async findByLinkedUserId() { return profile("ep-manager", "org-manager"); },
      async findById(id: string) { return id === "ep-org" ? profile(id, "org-1") : null; },
    } as never,
    { async listActiveAssignmentsByManagerEmploymentProfile() { return []; } } as never,
    { async listActiveByManagerEmploymentProfileId() { return [{ orgUnitId: "org-1" }]; } } as never,
    authority([
      grant(Permission.WORK_SCHEDULE_READ, {
        scopeType: "managedOrgUnit",
        targetId: "org-1",
      }),
    ]),
  );

  const result = await service.listWorkShiftsBySubject(actor(), {
    subjectKind: "EMPLOYMENT_PROFILE",
    subjectEmploymentProfileId: "ep-org",
  });

  assert.deepEqual(result.items.map((item) => item.id), [
    "manual",
    "org-match",
  ]);
  assert.equal(result.nextCursor, "next-page");
});

test("WorkShift subject list requires matching persisted TalentGroup roster authority", async () => {
  const service = new WorkScheduleAdminQueryService(
    {
      async listWorkShiftsBySubject() {
        return {
          items: [
            listShift("group-match", {
              sourceType: "ROSTER_GENERATED",
              sourceRosterTargetType: "TALENT_GROUP",
              sourceRosterTargetId: "group-a",
            }),
            listShift("group-mismatch", {
              sourceType: "ROSTER_GENERATED",
              sourceRosterTargetType: "TALENT_GROUP",
              sourceRosterTargetId: "group-b",
            }),
            listShift("org-mismatch", {
              sourceType: "ROSTER_GENERATED",
              sourceRosterTargetType: "ORG_UNIT",
              sourceRosterTargetId: "org-b",
            }),
          ],
        };
      },
    } as never,
    {
      async findByLinkedUserId() { return profile("ep-manager", "org-manager"); },
    } as never,
    {
      async listActiveAssignmentsByManagerEmploymentProfile() {
        return [{ groupId: "group-a" }];
      },
    } as never,
    { async listActiveByManagerEmploymentProfileId() { return []; } } as never,
    authority([
      grant(Permission.WORK_SCHEDULE_READ, {
        scopeType: "managedTalentGroup",
        targetId: "group-a",
      }),
    ]),
  );

  const result = await service.listWorkShiftsBySubject(actor(), {
    subjectKind: "TALENT_GROUP",
    subjectTalentGroupId: "group-a",
  });

  assert.deepEqual(result.items.map((item) => item.id), ["group-match"]);
});

test("WorkShift subject list fails closed for malformed roster-generated source metadata", async () => {
  const service = new WorkScheduleAdminQueryService(
    {
      async listWorkShiftsBySubject() {
        return {
          items: [
            listShift("roster-missing", {
              sourceType: "ROSTER_GENERATED",
            }),
            listShift("roster-type-only", {
              sourceType: "ROSTER_GENERATED",
              sourceRosterTargetType: "ORG_UNIT",
            }),
            listShift("roster-id-only", {
              sourceType: "ROSTER_GENERATED",
              sourceRosterTargetId: "org-1",
            }),
            listShift("roster-unsupported", {
              sourceType: "ROSTER_GENERATED",
              sourceRosterTargetType: "TALENT" as never,
              sourceRosterTargetId: "talent-1",
            }),
            listShift("unknown-source", {
              sourceType: "IMPORTED" as never,
            }),
            listShift("manual"),
            listShift("roster-match", {
              sourceType: "ROSTER_GENERATED",
              sourceRosterTargetType: "ORG_UNIT",
              sourceRosterTargetId: "org-1",
            }),
          ],
        };
      },
    } as never,
    {
      async findByLinkedUserId() { return profile("ep-manager", "org-manager"); },
      async findById(id: string) { return id === "ep-org" ? profile(id, "org-1") : null; },
    } as never,
    { async listActiveAssignmentsByManagerEmploymentProfile() { return []; } } as never,
    { async listActiveByManagerEmploymentProfileId() { return [{ orgUnitId: "org-1" }]; } } as never,
    authority([
      grant(Permission.WORK_SCHEDULE_READ, {
        scopeType: "managedOrgUnit",
        targetId: "org-1",
      }),
    ]),
  );

  const result = await service.listWorkShiftsBySubject(actor(), {
    subjectKind: "EMPLOYMENT_PROFILE",
    subjectEmploymentProfileId: "ep-org",
  });

  assert.deepEqual(result.items.map((item) => item.id), [
    "manual",
    "roster-match",
  ]);
});

test("WorkShift repository-to-service list preserves ambiguous persisted source metadata and fails closed", async () => {
  const repository = nativeWorkShiftRepository([
    persistedShift("ambiguous-complete", {
      sourceRosterTargetType: "ORG_UNIT",
      sourceRosterTargetId: "org-1",
    }),
    persistedShift("ambiguous-type-only", {
      sourceType: null,
      sourceRosterTargetType: "ORG_UNIT",
    }),
    persistedShift("ambiguous-id-only", {
      sourceRosterTargetId: "org-1",
    }),
    persistedShift("legacy-manual"),
    persistedShift("unknown-source", {
      sourceType: "IMPORTED",
    }),
    persistedShift("explicit-manual", {
      sourceType: "MANUAL",
    }),
    persistedShift("explicit-manual-with-roster-metadata", {
      sourceType: "MANUAL",
      sourceRosterTargetType: "ORG_UNIT",
      sourceRosterTargetId: "org-other",
    }),
    persistedShift("roster-match", {
      sourceType: "ROSTER_GENERATED",
      sourceRosterTargetType: "ORG_UNIT",
      sourceRosterTargetId: "org-1",
    }),
  ]);
  const service = scopedWorkShiftService(repository);

  const result = await service.listWorkShiftsBySubject(actor(), {
    subjectKind: "EMPLOYMENT_PROFILE",
    subjectEmploymentProfileId: "ep-org",
  });

  assert.deepEqual(result.items.map((item) => item.id), [
    "legacy-manual",
    "explicit-manual",
    "explicit-manual-with-roster-metadata",
    "roster-match",
  ]);
});

test("WorkShift detail fails closed for roster-generated rows with missing or partial target metadata", async () => {
  const details = new Map<string, object>([
    ["missing", {
      ...shift("missing", "EMPLOYMENT_PROFILE", "ep-org"),
      sourceType: "ROSTER_GENERATED" as const,
    }],
    ["type-only", {
      ...shift("type-only", "EMPLOYMENT_PROFILE", "ep-org"),
      sourceType: "ROSTER_GENERATED" as const,
      sourceRosterTargetType: "ORG_UNIT" as const,
    }],
    ["id-only", {
      ...shift("id-only", "EMPLOYMENT_PROFILE", "ep-org"),
      sourceType: "ROSTER_GENERATED" as const,
      sourceRosterTargetId: "org-1",
    }],
    ["unsupported", {
      ...shift("unsupported", "EMPLOYMENT_PROFILE", "ep-org"),
      sourceType: "ROSTER_GENERATED" as const,
      sourceRosterTargetType: "TALENT" as never,
      sourceRosterTargetId: "talent-1",
    }],
    ["manual", shift("manual", "EMPLOYMENT_PROFILE", "ep-org")],
  ]);
  const service = new WorkScheduleAdminQueryService(
    {
      async getWorkShiftDetail(id: string) { return details.get(id) ?? null; },
    } as never,
    {
      async findByLinkedUserId() { return profile("ep-manager", "org-manager"); },
      async findById(id: string) { return id === "ep-org" ? profile(id, "org-1") : null; },
    } as never,
    { async listActiveAssignmentsByManagerEmploymentProfile() { return []; } } as never,
    { async listActiveByManagerEmploymentProfileId() { return [{ orgUnitId: "org-1" }]; } } as never,
    authority([
      grant(Permission.WORK_SCHEDULE_READ, {
        scopeType: "managedOrgUnit",
        targetId: "org-1",
      }),
    ]),
  );

  for (const id of ["missing", "type-only", "id-only", "unsupported"]) {
    await assert.rejects(
      service.getWorkShiftDetail(actor(), { workShiftId: id }),
      WorkSchedulePermissionScopeError,
    );
  }
  assert.equal(
    (await service.getWorkShiftDetail(actor(), { workShiftId: "manual" })).id,
    "manual",
  );
});

test("WorkShift repository-to-service detail denies ambiguous and unknown persisted source metadata", async () => {
  const repository = nativeWorkShiftRepository([
    persistedShift("ambiguous-complete", {
      sourceRosterTargetType: "ORG_UNIT",
      sourceRosterTargetId: "org-1",
    }),
    persistedShift("ambiguous-type-only", {
      sourceType: null,
      sourceRosterTargetType: "ORG_UNIT",
    }),
    persistedShift("ambiguous-id-only", {
      sourceRosterTargetId: "org-1",
    }),
    persistedShift("unknown-source", {
      sourceType: "IMPORTED",
    }),
    persistedShift("roster-missing-target", {
      sourceType: "ROSTER_GENERATED",
    }),
    persistedShift("legacy-manual"),
    persistedShift("explicit-manual", {
      sourceType: "MANUAL",
    }),
    persistedShift("explicit-manual-with-roster-metadata", {
      sourceType: "MANUAL",
      sourceRosterTargetType: "ORG_UNIT",
      sourceRosterTargetId: "org-other",
    }),
  ]);
  const service = scopedWorkShiftService(repository);

  for (const id of [
    "ambiguous-complete",
    "ambiguous-type-only",
    "ambiguous-id-only",
    "unknown-source",
    "roster-missing-target",
  ]) {
    await assert.rejects(
      service.getWorkShiftDetail(actor(), { workShiftId: id }),
      WorkSchedulePermissionScopeError,
    );
  }

  for (const id of [
    "legacy-manual",
    "explicit-manual",
    "explicit-manual-with-roster-metadata",
  ]) {
    assert.equal(
      (await service.getWorkShiftDetail(actor(), { workShiftId: id })).id,
      id,
    );
  }
});

test("WorkShift subject list denies direct Talent for scoped actors and preserves structured-global compatibility", async () => {
  let scopedRepositoryCalls = 0;
  const scopedService = new WorkScheduleAdminQueryService(
    {
      async listWorkShiftsBySubject() {
        scopedRepositoryCalls += 1;
        return { items: [listShift("talent-row")] };
      },
    } as never,
    {
      async findByLinkedUserId() { return profile("ep-manager", "org-manager"); },
    } as never,
    undefined,
    undefined,
    authority([
      grant(Permission.WORK_SCHEDULE_READ, {
        scopeType: "managedTalentGroup",
        targetId: "group-a",
      }),
    ]),
  );

  await assert.rejects(
    scopedService.listWorkShiftsBySubject(actor(), {
      subjectKind: "TALENT",
      subjectTalentId: "talent-1",
    }),
    WorkSchedulePermissionScopeError,
  );
  assert.equal(scopedRepositoryCalls, 0);

  const globalService = new WorkScheduleAdminQueryService(
    {
      async listWorkShiftsBySubject() {
        return {
          items: [
            listShift("global-direct-talent"),
            listShift("global-malformed-roster", {
              sourceType: "ROSTER_GENERATED",
            }),
            listShift("global-roster", {
              sourceType: "ROSTER_GENERATED",
              sourceRosterTargetType: "TALENT_GROUP",
              sourceRosterTargetId: "group-other",
            }),
          ],
        };
      },
    } as never,
    {} as never,
    undefined,
    undefined,
    authority([
      grant(Permission.WORK_SCHEDULE_READ, { scopeType: "global" }),
    ]),
  );

  const globalResult = await globalService.listWorkShiftsBySubject(actor(), {
    subjectKind: "TALENT",
    subjectTalentId: "talent-1",
  });
  assert.deepEqual(globalResult.items.map((item) => item.id), [
    "global-direct-talent",
    "global-malformed-roster",
    "global-roster",
  ]);
});

test("TalentGroup and OrgUnit broad lists intersect structured grants with active responsibility", async () => {
  let groupIds: readonly string[] | undefined;
  const groupService = new TalentGroupAdminQueryService(
    {
      async listTalentGroups(input: { groupIds?: readonly string[] }) { groupIds = input.groupIds; return { items: [] }; },
    } as never,
    {
      subjectReadonlyAccess: { async findActiveEmploymentProfileByLinkedUserId() { return { employmentProfileId: "ep-manager" }; } },
      managerAssignmentRepository: { async listActiveAssignmentsByManagerEmploymentProfile() { return [{ groupId: "group-1" }, { groupId: "group-ungranted" }]; } },
    } as never,
    authority([grant(Permission.TALENT_GROUP_READ, { scopeType: "managedTalentGroup", targetId: "group-1" })]),
  );
  await groupService.listTalentGroups(actor(), {});
  assert.deepEqual(groupIds, ["group-1"]);

  let orgUnitIds: readonly string[] | undefined;
  const orgService = new OrgUnitAdminQueryService(
    {
      async listOrgUnits(input: { orgUnitIds?: readonly string[] }) { orgUnitIds = input.orgUnitIds; return { items: [] }; },
    } as never,
    authority([grant(Permission.ORG_UNIT_READ, { scopeType: "managedOrgUnit", targetId: "org-1" })]),
    {
      subjectReadonlyAccess: { async findActiveEmploymentProfileByLinkedUserId() { return { employmentProfileId: "ep-manager" }; } },
      managerAssignmentRepository: { async listActiveByManagerEmploymentProfileId() { return [{ orgUnitId: "org-1" }, { orgUnitId: "org-ungranted" }]; } },
    } as never,
  );
  await orgService.listOrgUnits(actor(), {});
  assert.deepEqual(orgUnitIds, ["org-1"]);
  await assert.rejects(orgService.listRootOrgUnits(actor(), {}), OrgUnitPermissionScopeError);
});

test("Studio and Platform lists filter exact assigned IDs while global grants preserve broad lists", async () => {
  let studioIds: readonly string[] | undefined;
  const studio = new StudioResourceAdminQueryService(
    {
      async listStudioResources(input: { studioResourceIds?: readonly string[] }) { studioIds = input.studioResourceIds; return { items: [] }; },
      async listStudioResourceAvailability(input: { studioResourceIds?: readonly string[] }) { studioIds = input.studioResourceIds; return { items: [] }; },
    } as never,
    authority([grant(Permission.STUDIO_RESOURCE_READ, { scopeType: "assignedStudioResource", targetId: "studio-1" })]),
  );
  await studio.listStudioResources(actor(), {});
  assert.deepEqual(studioIds, ["studio-1"]);

  let platformIds: readonly string[] | undefined;
  const platform = new PlatformAccountAdminQueryService(
    { async listPlatformAccounts(input: { platformAccountIds?: readonly string[] }) { platformIds = input.platformAccountIds; return { items: [] }; } } as never,
    authority([grant(Permission.PLATFORM_ACCOUNT_READ, { scopeType: "assignedPlatformAccount", targetId: "platform-1" })]),
  );
  await platform.listPlatformAccounts(actor(), {});
  assert.deepEqual(platformIds, ["platform-1"]);

  const globalStudio = new StudioResourceAdminQueryService(
    { async listStudioResources(input: { studioResourceIds?: readonly string[] }) { studioIds = input.studioResourceIds; return { items: [] }; } } as never,
    authority([grant(Permission.STUDIO_RESOURCE_READ, { scopeType: "global" })]),
  );
  await globalStudio.listStudioResources(actor(), {});
  assert.equal(studioIds, undefined);
});

test("sensitive People, direct Talent, broad Event, Work Pattern, and Holiday surfaces require structured global", async () => {
  const scoped = authority([
    grant(Permission.EMPLOYMENT_PROFILE_READ, { scopeType: "managedOrgUnit", targetId: "org-1" }),
    grant(Permission.TALENT_READ, { scopeType: "managedTalentGroup", targetId: "group-1" }),
    grant(Permission.EVENT_READ, { scopeType: "assignedEvent", targetId: "event-1" }),
    grant(Permission.WORK_SCHEDULE_READ, { scopeType: "managedOrgUnit", targetId: "org-1" }),
  ]);
  const employment = new EmploymentProfileAdminQueryService({} as never, scoped);
  await assert.rejects(employment.listEmploymentProfiles(actor(), {}), EmploymentProfilePermissionScopeError);
  await assert.rejects(employment.listEmploymentProfileDirectReports(actor(), { employmentProfileId: "ep-manager" }), EmploymentProfilePermissionScopeError);
  await assert.rejects(new TalentAdminQueryService({} as never, scoped).listTalents(actor(), {}));
  await assert.rejects(new EventAssignmentAdminQueryService({} as never, scoped).listEvents(actor(), {}), EventAssignmentPermissionScopeError);
  await assert.rejects(new WorkPatternAdminQueryService({} as never, scoped).listWorkPatterns(actor(), {}));
  await assert.rejects(new HolidayCalendarAdminQueryService({} as never, scoped).listHolidayCalendars(actor(), {}));

  const global = authority([
    grant(Permission.WORK_SCHEDULE_READ, { scopeType: "global" }),
  ]);
  const workPatterns = new WorkPatternAdminQueryService(
    {
      async listWorkPatterns() {
        return { items: [{ id: "pattern-1" }] };
      },
    } as never,
    global,
  );
  const holidayCalendars = new HolidayCalendarAdminQueryService(
    {
      async listHolidayCalendars() {
        return { items: [{ id: "calendar-1" }] };
      },
    } as never,
    global,
  );
  assert.deepEqual(await workPatterns.listWorkPatterns(actor(), {}), {
    items: [{ id: "pattern-1" }],
  });
  assert.deepEqual(await holidayCalendars.listHolidayCalendars(actor(), {}), {
    items: [{ id: "calendar-1" }],
  });
});

function actor(): Actor {
  return new Actor({
    id: "admin-1",
    type: "admin",
    context: "ADMIN",
    roles: ["MANAGER"],
    permissions: Object.values(Permission),
    scopeGrants: { workSchedule: ["global"], eventAssignment: ["global"], kpi: ["managedGroup"] },
    isActive: true,
  });
}

function authority(records: readonly StructuredScopeAuthorityAssignment[]): StructuredScopeAuthorityService {
  return new StructuredScopeAuthorityService({ async listByUserId() { return records; } }, () => 1_000);
}

function grant(permission: Permission, scope: RoleAssignmentScopeGrant): StructuredScopeAuthorityAssignment {
  return {
    assignment: {
      assignmentId: `${permission}:${scope.scopeType}:${scope.targetId ?? ""}`,
      roleId: `role:${permission}:${scope.scopeType}`,
      userId: "admin-1",
      structuredScopeGrants: [scope],
      state: "ACTIVE",
      effectiveAt: 0,
      expiresAt: null,
      revokedAt: null,
      reason: null,
      createdAt: 0,
      updatedAt: 0,
    },
    role: { id: `role:${permission}:${scope.scopeType}`, state: "ACTIVE", permissions: [permission] },
  };
}

function profile(id: string, orgUnitId: string) {
  return { id, orgUnitId, employmentStatus: "ACTIVE" };
}

function shift(
  id: string,
  subjectKind: "EMPLOYMENT_PROFILE" | "TALENT_GROUP" | "TALENT",
  subjectEmploymentProfileId: string | null,
  subjectTalentGroupId: string | null = null,
  subjectTalentId: string | null = null,
) {
  return {
    id,
    subjectKind,
    subjectEmploymentProfileId,
    subjectTalentGroupId,
    subjectTalentId,
    sourceType: "MANUAL" as const,
    sourceRosterTargetType: null,
    sourceRosterTargetId: null,
  };
}

function listShift(
  id: string,
  source: {
    readonly sourceType?: string | null;
    readonly sourceRosterTargetType?: "ORG_UNIT" | "TALENT_GROUP" | null;
    readonly sourceRosterTargetId?: string | null;
  } = {},
) {
  return {
    id,
    shiftCode: id,
    title: id,
    subjectKind: "EMPLOYMENT_PROFILE" as const,
    status: "ACTIVE" as const,
    shiftStartAt: 1,
    shiftEndAt: 2,
    sourceType:
      "sourceType" in source
        ? source.sourceType
        : "MANUAL",
    sourceRosterTargetType: source.sourceRosterTargetType ?? null,
    sourceRosterTargetId: source.sourceRosterTargetId ?? null,
  };
}

function persistedShift(
  id: string,
  source: {
    readonly sourceType?: string | null;
    readonly sourceRosterTargetType?: string | null;
    readonly sourceRosterTargetId?: string | null;
  } = {},
) {
  return {
    _id: id,
    shiftCode: id,
    normalizedShiftCode: id,
    title: id,
    normalizedTitle: id,
    subjectKind: "EMPLOYMENT_PROFILE",
    subjectEmploymentProfileId: "ep-org",
    subjectTalentId: null,
    subjectTalentGroupId: null,
    studioResourceIds: [],
    status: "ACTIVE",
    shiftStartAt: 1,
    shiftEndAt: 2,
    description: null,
    externalRef: null,
    ...source,
    createdAt: 1,
    updatedAt: 1,
  };
}

function nativeWorkShiftRepository(
  documents: readonly ReturnType<typeof persistedShift>[],
): NativeMongoWorkShiftReadRepository {
  return new NativeMongoWorkShiftReadRepository({
    collection(collectionName: string) {
      if (collectionName === "work_shifts") {
        return {
          find() {
            return {
              sort() {
                return {
                  limit() {
                    return {
                      toArray: async () => [...documents],
                    };
                  },
                };
              },
            };
          },
          findOne: async (query: { readonly _id: string }) =>
            documents.find((document) => document._id === query._id) ?? null,
        };
      }

      return {
        find() {
          return {
            toArray: async () => [],
          };
        },
      };
    },
  } as never);
}

function scopedWorkShiftService(
  repository: NativeMongoWorkShiftReadRepository,
): WorkScheduleAdminQueryService {
  return new WorkScheduleAdminQueryService(
    repository,
    {
      async findByLinkedUserId() {
        return profile("ep-manager", "org-manager");
      },
      async findById(id: string) {
        return id === "ep-org" ? profile(id, "org-1") : null;
      },
    } as never,
    {
      async listActiveAssignmentsByManagerEmploymentProfile() {
        return [];
      },
    } as never,
    {
      async listActiveByManagerEmploymentProfileId() {
        return [{ orgUnitId: "org-1" }];
      },
    } as never,
    authority([
      grant(Permission.WORK_SCHEDULE_READ, {
        scopeType: "managedOrgUnit",
        targetId: "org-1",
      }),
    ]),
  );
}
