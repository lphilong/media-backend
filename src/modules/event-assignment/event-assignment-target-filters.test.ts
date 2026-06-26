import assert from "node:assert/strict";
import { test } from "node:test";
import { Actor } from "@core/actor/actor";
import { Permission } from "@core/permission/permission.enum";
import { EventAssignmentAdminQueryService } from "@modules/event-assignment/admin/admin.event-assignment.query-service";
import {
  EventAssignmentPermissionScopeError,
  EventAssignmentValidationError,
} from "@modules/event-assignment/domain/event-assignment.errors";
import {
  StructuredScopeAuthorityAssignment,
  StructuredScopeAuthorityService,
} from "@modules/role/domain/structured-scope-authority";
import type { EventAssignmentReadRepository } from "@modules/event-assignment/read/event-assignment.read-repository";
import {
  EventAssignmentAdminAssignmentListExposure,
  EventAssignmentAdminDetailExposure,
} from "@modules/event-assignment/shared/event-assignment.exposure";
import { NativeMongoEventAssignmentReadRepository } from "@infra/mongo/event-assignment/event-assignment.read-repository";

function managedAssignment(groupId: string) {
  return {
    id: `manager-assignment-${groupId}`,
    groupId,
    managerEmploymentProfileId: "ep-manager",
    role: "MANAGER" as const,
    effectiveFrom: 1,
    effectiveTo: null,
    status: "ACTIVE" as const,
    isPrimary: true,
    createdAt: 1,
    createdByActorId: "actor",
    updatedAt: 1,
    updatedByActorId: "actor",
  };
}

function createActor(): Actor {
  return new Actor({
    id: "admin-user-1",
    type: "admin",
    context: "ADMIN",
    accountContexts: ["ADMIN_CONSOLE"],
    roles: [],
    permissions: [Permission.EVENT_READ],
    scopeGrants: {
      eventAssignment: ["global"],
    },
    isActive: true,
  });
}

function createManagedGroupActor(): Actor {
  return new Actor({
    id: "manager-user-1",
    type: "admin",
    context: "ADMIN",
    accountContexts: ["ADMIN_CONSOLE"],
    roles: [],
    permissions: [Permission.EVENT_READ],
    scopeGrants: {
      eventAssignment: ["managedGroup"],
    },
    isActive: true,
  });
}

function createExactScopedActor(): Actor {
  return new Actor({
    id: "admin-user-1",
    type: "admin",
    context: "ADMIN",
    accountContexts: ["ADMIN_CONSOLE"],
    roles: [],
    permissions: [Permission.EVENT_READ],
    scopeGrants: {},
    isActive: true,
  });
}

function createServiceCapture(): {
  readonly service: EventAssignmentAdminQueryService;
  capturedInput: unknown;
} {
  const capture: { capturedInput: unknown } = {
    capturedInput: undefined,
  };
  const repository: EventAssignmentReadRepository = {
    async listEvents(input) {
      capture.capturedInput = input;
      return { items: [] };
    },
    async listEventsByAssignment() {
      return { items: [] };
    },
    async listEventsByResource() {
      return { items: [] };
    },
    async listEventsByPlatform() {
      return { items: [] };
    },
    async listActiveAssignmentsForEvent() {
      return [];
    },
    async getEventDetail() {
      return null;
    },
    async eventHasManagedGroupAssignment() {
      return false;
    },
    async listManagerEventSummaries() {
      return [];
    },
    async getManagerEventSummary() {
      return null;
    },
    async listStudioBookings() {
      return [];
    },
  };

  return {
    service: new EventAssignmentAdminQueryService(
      repository,
      structuredAuthority([
        assignment(["event.read"], [{ scopeType: "global" }]),
      ]),
    ),
    get capturedInput() {
      return capture.capturedInput;
    },
  };
}

test("Event Assignment target filters parse statusGroup and timestamp ranges without changing status/window inputs", async () => {
  const capture = createServiceCapture();

  await capture.service.listEvents(createActor(), {
    status: "PLANNED",
    statusGroup: "ACTIVE",
    windowStartAt: "1000",
    windowEndAt: "2000",
    eventOverlapStartAt: "3000",
    eventOverlapEndAt: "4000",
    eventStartFromAt: "5000",
    eventStartToAt: "6000",
    limit: "10",
  });

  assert.deepEqual(capture.capturedInput, {
    status: "PLANNED",
    statuses: undefined,
    assignmentKind: undefined,
    assignmentEmploymentProfileId: undefined,
    assignmentTalentId: undefined,
    assignmentTalentGroupId: undefined,
    containsStudioResourceId: undefined,
    containsPlatformAccountId: undefined,
    windowStartAt: 1000,
    windowEndAt: 2000,
    eventOverlapStartAt: 3000,
    eventOverlapEndAt: 4000,
    eventStartFromAt: 5000,
    eventStartToAt: 6000,
    limit: 10,
    cursor: undefined,
    search: undefined,
    sortField: undefined,
    sortDirection: undefined,
  });
});

test("Event Assignment statusGroup ACTIVE expands exactly to planned and confirmed", async () => {
  const capture = createServiceCapture();

  await capture.service.listEvents(createActor(), {
    statusGroup: "active",
  });

  assert.deepEqual(
    (capture.capturedInput as { statuses?: readonly string[] }).statuses,
    ["PLANNED", "CONFIRMED"],
  );
});

test("Event Assignment statusGroup rejects unsupported and conflicting status combinations", async () => {
  await assert.rejects(
    createServiceCapture().service.listEvents(createActor(), {
      statusGroup: "DONE",
    }),
    EventAssignmentValidationError,
  );

  await assert.rejects(
    createServiceCapture().service.listEvents(createActor(), {
      statusGroup: "ACTIVE",
      status: "COMPLETED",
    }),
    EventAssignmentValidationError,
  );
});

test("manager-only scope cannot use global Admin Event routes", async () => {
  const service = createServiceCapture().service;
  await assert.rejects(
    service.listEvents(createManagedGroupActor(), {}),
    EventAssignmentPermissionScopeError,
  );
});

test("exact Event detail and assignment reads require assignedEvent scope", async () => {
  const repository = createReadRepository({
    getEventDetail: async () => ({ id: "event-1" }) as never,
  });
  const service = new EventAssignmentAdminQueryService(
    repository,
    structuredAuthority([
      assignment(
        ["event.read"],
        [{ scopeType: "assignedEvent", targetId: "event-1" }],
      ),
    ]),
  );

  assert.equal(
    (
      await service.getEventDetail(createExactScopedActor(), {
        eventId: "event-1",
      })
    ).id,
    "event-1",
  );
  assert.deepEqual(
    await service.listEventAssignments(createExactScopedActor(), {
      eventId: "event-1",
    }),
    { items: [] },
  );

  const denied = new EventAssignmentAdminQueryService(
    repository,
    structuredAuthority([
      assignment(
        ["event.read"],
        [{ scopeType: "assignedEvent", targetId: "event-other" }],
      ),
    ]),
  );

  await assert.rejects(
    denied.getEventDetail(createActor(), {
      eventId: "event-1",
    }),
    EventAssignmentPermissionScopeError,
  );
});

test("exact Event resource and platform lists require matching operational object scope", async () => {
  const repository = createReadRepository();
  const service = new EventAssignmentAdminQueryService(
    repository,
    structuredAuthority([
      assignment(
        ["event.read"],
        [
          { scopeType: "assignedStudioResource", targetId: "studio-1" },
          { scopeType: "assignedPlatformAccount", targetId: "platform-1" },
        ],
      ),
    ]),
  );

  assert.deepEqual(
    await service.listEventsByResource(createExactScopedActor(), {
      studioResourceId: "studio-1",
    }),
    { items: [] },
  );
  assert.deepEqual(
    await service.listEventsByPlatform(createExactScopedActor(), {
      platformAccountId: "platform-1",
    }),
    { items: [] },
  );

  await assert.rejects(
    service.listEventsByResource(createActor(), {
      studioResourceId: "studio-other",
    }),
    EventAssignmentPermissionScopeError,
  );
  await assert.rejects(
    service.listEventsByPlatform(createActor(), {
      platformAccountId: "platform-other",
    }),
    EventAssignmentPermissionScopeError,
  );
});

function createReadRepository(
  overrides: Partial<EventAssignmentReadRepository> = {},
): EventAssignmentReadRepository {
  return {
    async listEvents() {
      return { items: [] };
    },
    async listEventsByAssignment() {
      return { items: [] };
    },
    async listEventsByResource() {
      return { items: [] };
    },
    async listEventsByPlatform() {
      return { items: [] };
    },
    async listActiveAssignmentsForEvent() {
      return [];
    },
    async getEventDetail() {
      return null;
    },
    async eventHasManagedGroupAssignment() {
      return false;
    },
    async listManagerEventSummaries() {
      return [];
    },
    async getManagerEventSummary() {
      return null;
    },
    async listStudioBookings() {
      return [];
    },
    ...overrides,
  };
}

function structuredAuthority(
  records: readonly StructuredScopeAuthorityAssignment[],
): StructuredScopeAuthorityService {
  return new StructuredScopeAuthorityService({
    async listByUserId(userId: string) {
      return records.filter((record) => record.assignment.userId === userId);
    },
  });
}

function assignment(
  permissions: readonly string[],
  structuredScopeGrants: StructuredScopeAuthorityAssignment["assignment"]["structuredScopeGrants"],
): StructuredScopeAuthorityAssignment {
  return {
    assignment: {
      assignmentId: "assignment-1",
      roleId: "role-1",
      userId: "admin-user-1",
      structuredScopeGrants,
      state: "ACTIVE",
      effectiveAt: 0,
      expiresAt: null,
      revokedAt: null,
      reason: null,
      createdAt: 0,
      updatedAt: 0,
    },
    role: {
      id: "role-1",
      state: "ACTIVE",
      permissions,
    },
  };
}

test("Event Assignment target filters build additive Mongo predicates and preserve window predicates", async () => {
  let capturedQuery: unknown;
  let capturedSort: unknown;
  let capturedLimit: unknown;
  const repository = new NativeMongoEventAssignmentReadRepository({
    collection(name: string) {
      if (name === "event_assignments") {
        return {
          distinct: async () => [],
        };
      }

      return {
        find(query: unknown) {
          capturedQuery = query;
          return {
            sort(sort: unknown) {
              capturedSort = sort;
              return {
                limit(limit: unknown) {
                  capturedLimit = limit;
                  return {
                    toArray: async () => [],
                  };
                },
              };
            },
          };
        },
      };
    },
  } as never);

  await repository.listEvents({
    statuses: ["PLANNED", "CONFIRMED"],
    windowStartAt: 1000,
    windowEndAt: 2000,
    eventOverlapStartAt: 3000,
    eventOverlapEndAt: 4000,
    eventStartFromAt: 5000,
    eventStartToAt: 6000,
    limit: 20,
  });

  assert.deepEqual(capturedQuery, {
    $and: [
      { status: { $in: ["PLANNED", "CONFIRMED"] } },
      { eventEndAt: { $gt: 1000 } },
      { eventStartAt: { $lt: 2000 } },
      { eventEndAt: { $gt: 3000 } },
      { eventStartAt: { $lt: 4000 } },
      { eventStartAt: { $gte: 5000 } },
      { eventStartAt: { $lt: 6000 } },
    ],
  });
  assert.deepEqual(capturedSort, {
    eventStartAt: 1,
    _id: 1,
  });
  assert.equal(capturedLimit, 21);
});

test("Event Assignment read repository enriches assignment subject refs and event detail refs with batch lookups", async () => {
  const referenceFindCalls = {
    employmentProfiles: 0,
    talents: 0,
    talentGroups: 0,
    studioResources: 0,
    platformAccounts: 0,
  };
  const referenceFindOptions: Record<string, unknown> = {};
  const eventDocument = {
    _id: "event-1",
    eventCode: "EVT-1",
    title: "Launch Event",
    normalizedTitle: "launch event",
    studioResourceIds: ["studio-2", "missing-studio", "studio-1"],
    platformAccountIds: ["platform-2", "missing-platform", "platform-1"],
    status: "PLANNED",
    eventStartAt: 100,
    eventEndAt: 200,
    description: null,
    externalRef: null,
    createdAt: 1,
    updatedAt: 2,
  };
  const assignmentDocuments = [
    {
      _id: "assignment-1",
      eventId: "event-1",
      assignmentKind: "EMPLOYMENT_PROFILE",
      assignmentEmploymentProfileId: "ep-1",
      assignmentTalentId: null,
      assignmentTalentGroupId: null,
      assignmentStatus: "ACTIVE",
      createdAt: 10,
    },
    {
      _id: "assignment-2",
      eventId: "event-1",
      assignmentKind: "TALENT",
      assignmentEmploymentProfileId: null,
      assignmentTalentId: "talent-1",
      assignmentTalentGroupId: null,
      assignmentStatus: "ACTIVE",
      createdAt: 11,
    },
    {
      _id: "assignment-3",
      eventId: "event-1",
      assignmentKind: "TALENT_GROUP",
      assignmentEmploymentProfileId: null,
      assignmentTalentId: null,
      assignmentTalentGroupId: "group-1",
      assignmentStatus: "ACTIVE",
      createdAt: 12,
    },
  ];
  const repository = new NativeMongoEventAssignmentReadRepository({
    collection(name: string) {
      if (name === "event_assignments") {
        return {
          find() {
            return {
              toArray: async () => assignmentDocuments,
            };
          },
          distinct: async () => [],
        };
      }

      if (name === "employment_profiles") {
        return {
          find(_query: unknown, options: unknown) {
            referenceFindCalls.employmentProfiles += 1;
            referenceFindOptions.employmentProfiles = options;
            return {
              toArray: async () => [
                {
                  _id: "ep-1",
                  employeeCode: "EMP-1",
                  legalName: "Alice Legal",
                  displayName: "Alice",
                  employmentStatus: "ACTIVE",
                },
                {
                  _id: "ep-binh",
                  employeeCode: "EMP-2",
                  legalName: "Binh Tran Legal",
                  displayName: "Binh Tran",
                  employmentStatus: "ACTIVE",
                },
              ],
            };
          },
        };
      }

      if (name === "talents") {
        return {
          find(_query: unknown, options: unknown) {
            referenceFindCalls.talents += 1;
            referenceFindOptions.talents = options;
            return {
              toArray: async () => [
                {
                  _id: "talent-1",
                  talentCode: "TAL-1",
                  stageName: "Stale Internal Stage",
                  legalName: "Stale Internal Legal",
                  displayShortName: "Stale Internal Short",
                  talentOrigin: "INTERNAL",
                  linkedEmploymentProfileId: "ep-binh",
                  operationalStatus: "ACTIVE",
                },
              ],
            };
          },
        };
      }

      if (name === "talent_groups") {
        return {
          find(_query: unknown, options: unknown) {
            referenceFindCalls.talentGroups += 1;
            referenceFindOptions.talentGroups = options;
            return {
              toArray: async () => [
                {
                  _id: "group-1",
                  groupCode: "GRP-1",
                  name: "Prime Crew",
                  status: "ACTIVE",
                },
              ],
            };
          },
        };
      }

      if (name === "studio_resources") {
        return {
          find(_query: unknown, options: unknown) {
            referenceFindCalls.studioResources += 1;
            referenceFindOptions.studioResources = options;
            return {
              toArray: async () => [
                {
                  _id: "studio-1",
                  resourceCode: "SR-1",
                  name: "Main Studio",
                  resourceClass: "SPACE",
                  operationalStatus: "ACTIVE",
                },
                {
                  _id: "studio-2",
                  resourceCode: "SR-2",
                  name: "Podcast Booth",
                  resourceClass: "SPACE",
                  operationalStatus: "ACTIVE",
                },
              ],
            };
          },
        };
      }

      if (name === "platform_accounts") {
        return {
          find(_query: unknown, options: unknown) {
            referenceFindCalls.platformAccounts += 1;
            referenceFindOptions.platformAccounts = options;
            return {
              toArray: async () => [
                {
                  _id: "platform-1",
                  accountCode: "PA-1",
                  platform: "TIKTOK",
                  displayName: "Alice Live",
                  handle: "@alice",
                  operationalStatus: "ACTIVE",
                },
                {
                  _id: "platform-2",
                  accountCode: "PA-2",
                  platform: "YOUTUBE",
                  displayName: "Prime Channel",
                  handle: null,
                  operationalStatus: "ACTIVE",
                },
              ],
            };
          },
        };
      }

      return {
        find() {
          return {
            sort() {
              return {
                limit() {
                  return {
                    toArray: async () => [],
                  };
                },
              };
            },
          };
        },
        findOne: async () => eventDocument,
      };
    },
  } as never);

  const assignments = await repository.listActiveAssignmentsForEvent("event-1");

  assert.equal(assignments[0].assignmentEmploymentProfileId, "ep-1");
  assert.deepEqual(assignments[0].assignmentSubjectRef, {
    id: "ep-1",
    code: "EMP-1",
    displayName: "Alice",
    name: "Alice Legal",
    status: "ACTIVE",
  });
  assert.equal(assignments[1].assignmentTalentId, "talent-1");
  assert.deepEqual(assignments[1].assignmentSubjectRef, {
    id: "talent-1",
    code: "TAL-1",
    name: "Binh Tran",
    displayName: "Binh Tran",
    status: "ACTIVE",
  });
  assert.notEqual(
    assignments[1].assignmentSubjectRef?.displayName,
    "Stale Internal Stage",
  );
  assert.notEqual(
    assignments[1].assignmentSubjectRef?.displayName,
    "Stale Internal Legal",
  );
  assert.notEqual(
    assignments[1].assignmentSubjectRef?.displayName,
    "Stale Internal Short",
  );
  assert.deepEqual(assignments[2].assignmentSubjectRef, {
    id: "group-1",
    code: "GRP-1",
    name: "Prime Crew",
    status: "ACTIVE",
  });

  const detail = await repository.getEventDetail("event-1");
  assert.equal(detail?.studioResourceIds[1], "missing-studio");
  assert.deepEqual(detail?.studioResourceRefs, [
    {
      id: "studio-2",
      code: "SR-2",
      name: "Podcast Booth",
      status: "ACTIVE",
    },
    { id: "missing-studio" },
    {
      id: "studio-1",
      code: "SR-1",
      name: "Main Studio",
      status: "ACTIVE",
    },
  ]);
  assert.equal(detail?.platformAccountIds[1], "missing-platform");
  assert.deepEqual(detail?.platformAccountRefs, [
    {
      id: "platform-2",
      code: "PA-2",
      displayName: "Prime Channel",
      platform: "YOUTUBE",
      status: "ACTIVE",
    },
    { id: "missing-platform" },
    {
      id: "platform-1",
      code: "PA-1",
      displayName: "Alice Live",
      handle: "@alice",
      platform: "TIKTOK",
      status: "ACTIVE",
    },
  ]);
  assert.deepEqual(referenceFindCalls, {
    employmentProfiles: 2,
    talents: 1,
    talentGroups: 1,
    studioResources: 1,
    platformAccounts: 1,
  });
  assert.deepEqual(referenceFindOptions.studioResources, {
    projection: {
      _id: 1,
      resourceCode: 1,
      name: 1,
      resourceClass: 1,
      operationalStatus: 1,
    },
  });
  assert.deepEqual(referenceFindOptions.platformAccounts, {
    projection: {
      _id: 1,
      accountCode: 1,
      platform: 1,
      displayName: 1,
      handle: 1,
      operationalStatus: 1,
    },
  });
  assert.equal(
    EventAssignmentAdminAssignmentListExposure.expose(assignments[0])
      .assignmentSubjectRef !== undefined,
    true,
  );
  assert.equal(
    EventAssignmentAdminDetailExposure.expose(detail!).studioResourceRefs !==
      undefined,
    true,
  );
});
