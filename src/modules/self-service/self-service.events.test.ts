import assert from "node:assert/strict";
import { createServer, Server } from "node:http";
import { AddressInfo } from "node:net";
import { test } from "node:test";
import express from "express";
import { ClientSession } from "mongodb";
import { createHttpErrorMiddleware } from "@app/http/http-error.middleware";
import { contextMiddleware } from "@core/context/context.middleware.adapter";
import { Actor } from "@core/actor/actor";
import { bindActor } from "@core/actor/actor-context";
import { Permission } from "@core/permission/permission.enum";
import { ROLE_TEMPLATE_CATALOG } from "@modules/role/domain/role-template.catalog";
import { EmploymentProfileRepository } from "@modules/employment-profile/domain/employment-profile.repository";
import {
  EmploymentProfileRecord,
  EmploymentStatus,
} from "@modules/employment-profile/domain/employment-profile.types";
import {
  EventAssignmentListItemView,
  EventAssignmentRecord,
  EventByAssignmentListItemView,
  EventByPlatformListItemView,
  EventByResourceListItemView,
  EventDetailView,
  EventListItemView,
  EventRecord,
} from "@modules/event-assignment/domain/event-assignment.types";
import {
  EventAssignmentReadRepository,
  EventByAssignmentListReadInput,
} from "@modules/event-assignment/read/event-assignment.read-repository";
import { TalentRepository } from "@modules/talent/domain/talent.repository";
import {
  TalentOperationalStatus,
  TalentRecord,
} from "@modules/talent/domain/talent.types";
import { SelfServiceCurrentPersonController } from "./self-service.current-person.controller";
import { SelfServiceCurrentPersonService } from "./self-service.current-person.service";
import { SelfServiceEventsController } from "./self-service.events.controller";
import { SelfServiceEventsService } from "./self-service.events.service";
import { selfServiceRoutes } from "./self-service.routes";
import { SelfServiceIdentityResolver } from "./shared/self-service.identity-resolver";
import { SelfServiceWorkShiftsController } from "./self-service.work-shifts.controller";
import { SelfServiceWorkShiftsService } from "./self-service.work-shifts.service";
import {
  WorkShiftByResourceListItemView,
  WorkShiftBySubjectListItemView,
  WorkShiftDetailView,
  WorkShiftListItemView,
} from "@modules/work-schedule/domain/work-schedule.types";
import {
  WorkShiftListReadInput,
  WorkShiftReadRepository,
} from "@modules/work-schedule/read/work-schedule.read-repository";
import { UserReadRepository } from "@modules/user/read/user.read-repository";
import { UserMutationRepository } from "@modules/user/domain/user.repository";
import {
  UserDetailView,
  UserListItemView,
} from "@modules/user/domain/user.types";
import { SelfServiceAccountPreferencesController } from "./self-service.account-preferences.controller";
import { SelfServiceAccountPreferencesService } from "./self-service.account-preferences.service";

const EVENTS_NOW = 3_000;
const RECENT_PAST_DAYS = 30;
const UPCOMING_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1_000;

async function listen(app: express.Express): Promise<{
  readonly server: Server;
  readonly baseUrl: string;
}> {
  const server = createServer(app);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");

  return {
    server,
    baseUrl: `http://127.0.0.1:${(address as AddressInfo).port}`,
  };
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

test("GET /self-service/events returns only active direct current staff event assignments", async () => {
  const harness = createHarness();
  const { server, baseUrl } = await listen(
    createSelfServiceTestApp(harness, createStaffActor("user-staff")),
  );

  try {
    const response = await fetch(`${baseUrl}/self-service/events?limit=20`);
    const body = await response.json();
    const serialized = JSON.stringify(body);

    assert.equal(response.status, 200);
    assert.deepEqual(body.data, [
      {
        eventId: "event-own-talent",
        eventCode: "EVT-SELF-TAL",
        title: "Own internal Talent event",
        status: "PLANNED",
        startsAt: 2_000,
        endsAt: 3_000,
        ownAssignmentKind: "TALENT",
        ownAssignmentStatus: "ACTIVE",
      },
      {
        eventId: "event-own-employment-profile",
        eventCode: "EVT-SELF-EP",
        title: "Own EmploymentProfile event",
        status: "CONFIRMED",
        startsAt: 4_000,
        endsAt: 5_000,
        ownAssignmentKind: "EMPLOYMENT_PROFILE",
        ownAssignmentStatus: "ACTIVE",
      },
    ]);
    assert.deepEqual(body.meta, {
      window: {
        recentPastDays: RECENT_PAST_DAYS,
        upcomingDays: UPCOMING_DAYS,
        windowStartAt: EVENTS_NOW - RECENT_PAST_DAYS * DAY_MS,
        windowEndAt: EVENTS_NOW + UPCOMING_DAYS * DAY_MS,
      },
      limit: 20,
      truncated: false,
    });
    assert.deepEqual(harness.events.listInputs, [
      {
        assignmentKind: "EMPLOYMENT_PROFILE",
        assignmentEmploymentProfileId: "ep-staff",
        assignmentTalentId: null,
        assignmentTalentGroupId: null,
        status: undefined,
        windowStartAt: EVENTS_NOW - RECENT_PAST_DAYS * DAY_MS,
        windowEndAt: EVENTS_NOW + UPCOMING_DAYS * DAY_MS,
        limit: 21,
        sortField: "eventStartAt",
        sortDirection: "ASC",
      },
      {
        assignmentKind: "TALENT",
        assignmentEmploymentProfileId: null,
        assignmentTalentId: "talent-staff",
        assignmentTalentGroupId: null,
        status: undefined,
        windowStartAt: EVENTS_NOW - RECENT_PAST_DAYS * DAY_MS,
        windowEndAt: EVENTS_NOW + UPCOMING_DAYS * DAY_MS,
        limit: 21,
        sortField: "eventStartAt",
        sortDirection: "ASC",
      },
    ]);

    for (const forbidden of [
      "EVT-GROUP",
      "Group-only event",
      "EVT-EXT",
      "External Talent event",
      "EVT-PLATFORM",
      "Platform account event",
      "EVT-REMOVED",
      "Removed own assignment event",
      "EVT-OTHER",
      "Other staff event",
      "assignmentTalentId",
      "assignmentEmploymentProfileId",
      "assignmentTalentGroupId",
      "studioResourceIds",
      "platformAccountIds",
      "platform-secret-account",
      "externalRef",
      "client budget",
      "Internal production note",
      "full roster",
      "manager only note",
      "HR attribution",
      "Other Legal",
    ]) {
      assert.equal(serialized.includes(forbidden), false, forbidden);
    }
  } finally {
    await close(server);
  }
});

test("GET /self-service/events marks the bounded response as truncated when more own events exist than the limit", async () => {
  const harness = createHarness();
  const { server, baseUrl } = await listen(
    createSelfServiceTestApp(harness, createStaffActor("user-staff")),
  );

  try {
    const response = await fetch(`${baseUrl}/self-service/events?limit=1`);
    const body = await response.json();
    const serialized = JSON.stringify(body);

    assert.equal(response.status, 200);
    assert.equal(body.data.length, 1);
    assert.deepEqual(body.data, [
      {
        eventId: "event-own-talent",
        eventCode: "EVT-SELF-TAL",
        title: "Own internal Talent event",
        status: "PLANNED",
        startsAt: 2_000,
        endsAt: 3_000,
        ownAssignmentKind: "TALENT",
        ownAssignmentStatus: "ACTIVE",
      },
    ]);
    assert.deepEqual(body.meta, {
      window: {
        recentPastDays: RECENT_PAST_DAYS,
        upcomingDays: UPCOMING_DAYS,
        windowStartAt: EVENTS_NOW - RECENT_PAST_DAYS * DAY_MS,
        windowEndAt: EVENTS_NOW + UPCOMING_DAYS * DAY_MS,
      },
      limit: 1,
      truncated: true,
    });
    assert.deepEqual(
      harness.events.listInputs.map((input) => input.limit),
      [2, 2],
    );

    for (const forbidden of [
      "assignmentTalentId",
      "assignmentEmploymentProfileId",
      "assignmentTalentGroupId",
      "studioResourceIds",
      "platform-secret-account",
      "externalRef",
      "client budget",
      "Internal production note",
    ]) {
      assert.equal(serialized.includes(forbidden), false, forbidden);
    }
  } finally {
    await close(server);
  }
});

test("GET /self-service/events de-dupes the same event assigned to current EmploymentProfile and linked internal Talent", async () => {
  const harness = createHarness({
    extraEvents: [
      eventRecord({
        id: "event-dual-direct",
        eventCode: "EVT-DUAL",
        title: "Dual direct assignment event",
        status: "PLANNED",
        eventStartAt: 1_500,
        eventEndAt: 1_900,
      }),
    ],
    extraAssignments: [
      eventAssignmentRecord({
        id: "assignment-dual-employment-profile",
        eventId: "event-dual-direct",
        assignmentKind: "EMPLOYMENT_PROFILE",
        assignmentEmploymentProfileId: "ep-staff",
      }),
      eventAssignmentRecord({
        id: "assignment-dual-talent",
        eventId: "event-dual-direct",
        assignmentKind: "TALENT",
        assignmentTalentId: "talent-staff",
      }),
    ],
  });
  const { server, baseUrl } = await listen(
    createSelfServiceTestApp(harness, createStaffActor("user-staff")),
  );

  try {
    const response = await fetch(`${baseUrl}/self-service/events?limit=20`);
    const body = await response.json();
    const eventIds = body.data.map(
      (item: { readonly eventId: string }) => item.eventId,
    );
    const dualDirectEvents = body.data.filter(
      (item: { readonly eventId: string }) =>
        item.eventId === "event-dual-direct",
    );

    assert.equal(response.status, 200);
    assert.equal(dualDirectEvents.length, 1);
    assert.deepEqual(dualDirectEvents[0], {
      eventId: "event-dual-direct",
      eventCode: "EVT-DUAL",
      title: "Dual direct assignment event",
      status: "PLANNED",
      startsAt: 1_500,
      endsAt: 1_900,
      ownAssignmentKind: "EMPLOYMENT_PROFILE",
      ownAssignmentStatus: "ACTIVE",
    });
    assert.equal(
      body.data.filter(
        (item: { readonly eventId: string }) =>
          item.eventId === "event-own-talent",
      ).length,
      1,
    );
    assert.equal(eventIds.includes("event-group-only"), false);
    assert.equal(eventIds.includes("event-removed"), false);
    assert.equal(eventIds.includes("event-other"), false);
    assert.equal(eventIds.includes("event-external"), false);
    assert.deepEqual(
      harness.events.listInputs.map((input) => input.assignmentKind),
      ["EMPLOYMENT_PROFILE", "TALENT"],
    );
  } finally {
    await close(server);
  }
});

test("GET /self-service/events can filter current staff events by safe status and window", async () => {
  const harness = createHarness();
  const { server, baseUrl } = await listen(
    createSelfServiceTestApp(harness, createStaffActor("user-staff")),
  );

  try {
    const response = await fetch(
      `${baseUrl}/self-service/events?status=PLANNED&windowStartAt=1000&windowEndAt=3500&limit=10`,
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(
      body.data.map((item: { readonly eventId: string }) => item.eventId),
      ["event-own-talent"],
    );
    assert.equal(harness.events.listInputs[0]?.status, "PLANNED");
    assert.equal(harness.events.listInputs[0]?.windowStartAt, 1_000);
    assert.equal(harness.events.listInputs[0]?.windowEndAt, 3_500);
    assert.deepEqual(body.meta.window, {
      recentPastDays: RECENT_PAST_DAYS,
      upcomingDays: UPCOMING_DAYS,
      windowStartAt: 1_000,
      windowEndAt: 3_500,
    });
    assert.equal(
      harness.events.listInputs[1]?.assignmentTalentId,
      "talent-staff",
    );
  } finally {
    await close(server);
  }
});

test("GET /self-service/events rejects client-supplied subject filters", async () => {
  const harness = createHarness();
  const { server, baseUrl } = await listen(
    createSelfServiceTestApp(harness, createStaffActor("user-staff")),
  );

  try {
    const response = await fetch(
      `${baseUrl}/self-service/events?employmentProfileId=ep-other&talentId=talent-other`,
    );
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.match(body.error.message, /Invalid self-service request/);
    assert.deepEqual(harness.events.listInputs, []);
  } finally {
    await close(server);
  }
});

test("GET /self-service/events returns a safe error when no linked EmploymentProfile exists", async () => {
  const harness = createHarness();
  const { server, baseUrl } = await listen(
    createSelfServiceTestApp(harness, createStaffActor("user-unlinked")),
  );

  try {
    const response = await fetch(`${baseUrl}/self-service/events`);
    const body = await response.json();
    const serialized = JSON.stringify(body);

    assert.equal(response.status, 404);
    assert.deepEqual(body, {
      error: {
        code: "SELF_SERVICE_CURRENT_PERSON_NOT_LINKED",
        message: "No linked Employment Profile",
      },
    });
    assert.deepEqual(harness.events.listInputs, []);
    assert.equal(serialized.includes("Staff Legal"), false);
    assert.equal(serialized.includes("EVT-SELF-TAL"), false);
  } finally {
    await close(server);
  }
});

test("GET /self-service/events denies non-operational profile before repository read", async () => {
  const harness = createHarness();
  const { server, baseUrl } = await listen(
    createSelfServiceTestApp(harness, createStaffActor("user-suspended")),
  );

  try {
    const response = await fetch(`${baseUrl}/self-service/events`);
    const body = await response.json();

    assert.equal(response.status, 403);
    assert.equal(body.error.code, "SELF_SERVICE_PROFILE_NOT_OPERATIONAL");
    assert.equal(
      body.error.message,
      "Self-Service access is not available for this profile status.",
    );
    assert.deepEqual(harness.events.listInputs, []);
  } finally {
    await close(server);
  }
});

test("self-service events endpoint is GET/read-only and does not expose mutation routes", async () => {
  const harness = createHarness();
  const before = harness.snapshot();
  const { server, baseUrl } = await listen(
    createSelfServiceTestApp(harness, createStaffActor("user-staff")),
  );

  try {
    const getResponse = await fetch(`${baseUrl}/self-service/events`);
    await getResponse.json();

    assert.equal(getResponse.status, 200);
    assert.deepEqual(harness.snapshot(), before);

    const postResponse = await fetch(`${baseUrl}/self-service/events`, {
      method: "POST",
    });
    assert.equal(postResponse.status, 404);
    assert.deepEqual(harness.snapshot(), before);
  } finally {
    await close(server);
  }
});

test("self-service events foundation does not add eventAssignment.self or role changes", () => {
  const template = ROLE_TEMPLATE_CATALOG.find(
    (candidate) => candidate.code === "TALENT_STAFF_SELF",
  );
  const serialized = JSON.stringify(template);

  assert.ok(template);
  assert.deepEqual(template.permissions, [
    Permission.WORK_SCHEDULE_READ,
    Permission.EVENT_READ,
    Permission.TALENT_KPI_READ,
    Permission.KPI_READ_PROGRESS,
    Permission.EMPLOYMENT_PROFILE_READ,
    Permission.TALENT_READ,
  ]);
  assert.deepEqual(template.recommendedScopeGrants, {
    workSchedule: ["self"],
    kpi: ["self"],
  });
  assert.equal(serialized.includes("eventAssignment.self"), false);
});

function createSelfServiceTestApp(
  harness: SelfServiceEventsHarness,
  actor: Actor,
): express.Express {
  const app = express();
  app.use(express.json());
  const identityResolver = new SelfServiceIdentityResolver(
    harness.employmentProfiles,
    harness.talents,
  );
  const currentPersonService = new SelfServiceCurrentPersonService(
    identityResolver,
    harness.users,
  );
  const currentPersonController = new SelfServiceCurrentPersonController(
    currentPersonService,
  );
  const workShiftsController = new SelfServiceWorkShiftsController(
    new SelfServiceWorkShiftsService(
      identityResolver,
      harness.workShifts,
    ),
  );
  const eventsController = new SelfServiceEventsController(
    new SelfServiceEventsService(
      identityResolver,
      harness.events,
      () => EVENTS_NOW,
    ),
  );
  const accountPreferencesController =
    new SelfServiceAccountPreferencesController(
      new SelfServiceAccountPreferencesService(
        identityResolver,
        harness.users as unknown as UserMutationRepository,
        currentPersonService,
      ),
    );

  app.use(
    "/self-service",
    contextMiddleware("SELF_SERVICE"),
    (req, _res, next) => {
      bindActor(req, actor);
      next();
    },
    selfServiceRoutes(
      currentPersonController,
      workShiftsController,
      eventsController,
      accountPreferencesController,
    ),
  );
  app.use(createHttpErrorMiddleware({ error() {} } as never));

  return app;
}

function createStaffActor(userId: string): Actor {
  return new Actor({
    id: userId,
    type: "staff",
    context: "SELF_SERVICE",
    roles: ["TALENT_STAFF_SELF"],
    permissions: [
      Permission.WORK_SCHEDULE_READ,
      Permission.EVENT_READ,
      Permission.EMPLOYMENT_PROFILE_READ,
      Permission.TALENT_READ,
      Permission.KPI_READ_PROGRESS,
    ],
    scopeGrants: {
      workSchedule: ["self"],
      kpi: ["self"],
    },
    isActive: true,
  });
}

interface SelfServiceEventsHarness {
  readonly employmentProfiles: InMemoryEmploymentProfileRepository;
  readonly users: InMemoryUserReadRepository;
  readonly talents: InMemoryTalentRepository;
  readonly workShifts: InMemoryWorkShiftReadRepository;
  readonly events: InMemoryEventAssignmentReadRepository;
  snapshot(): unknown;
}

function createHarness(options?: {
  readonly extraEvents?: readonly EventRecord[];
  readonly extraAssignments?: readonly EventAssignmentRecord[];
}): SelfServiceEventsHarness {
  const employmentProfiles = new InMemoryEmploymentProfileRepository([
    employmentProfileRecord({
      id: "ep-staff",
      linkedUserId: "user-staff",
      displayName: "Staff Display",
      legalName: "Staff Legal",
      employeeCode: "EP-000777",
    }),
    employmentProfileRecord({
      id: "ep-other",
      linkedUserId: "user-other",
      displayName: "Other Display",
      legalName: "Other Legal",
      employeeCode: "EP-000778",
    }),
    employmentProfileRecord({
      id: "ep-suspended",
      linkedUserId: "user-suspended",
      displayName: "Suspended Display",
      legalName: "Suspended Legal",
      employeeCode: "EP-000779",
      employmentStatus: "SUSPENDED",
    }),
  ]);
  const users = new InMemoryUserReadRepository([
    userDetail({
      id: "user-staff",
      email: "staff@example.test",
      authSubject: "auth0|staff",
    }),
  ]);
  const talents = new InMemoryTalentRepository([
    talentRecord({
      id: "talent-staff",
      linkedEmploymentProfileId: "ep-staff",
      talentCode: "TAL-000777",
      stageName: "Performance Alias",
    }),
    talentRecord({
      id: "talent-other",
      linkedEmploymentProfileId: "ep-other",
      talentCode: "TAL-000778",
      stageName: "Other Alias",
    }),
    talentRecord({
      id: "talent-external",
      linkedEmploymentProfileId: null,
      talentCode: "EXT-000001",
      stageName: "External Alias",
      talentOrigin: "EXTERNAL",
    }),
  ]);
  const workShifts = new InMemoryWorkShiftReadRepository();
  const events = new InMemoryEventAssignmentReadRepository(
    [
      eventRecord({
        id: "event-own-talent",
        eventCode: "EVT-SELF-TAL",
        title: "Own internal Talent event",
        status: "PLANNED",
        eventStartAt: 2_000,
        eventEndAt: 3_000,
      }),
      eventRecord({
        id: "event-own-employment-profile",
        eventCode: "EVT-SELF-EP",
        title: "Own EmploymentProfile event",
        status: "CONFIRMED",
        eventStartAt: 4_000,
        eventEndAt: 5_000,
      }),
      eventRecord({
        id: "event-group-only",
        eventCode: "EVT-GROUP",
        title: "Group-only event",
      }),
      eventRecord({
        id: "event-external",
        eventCode: "EVT-EXT",
        title: "External Talent event",
      }),
      eventRecord({
        id: "event-platform",
        eventCode: "EVT-PLATFORM",
        title: "Platform account event",
        platformAccountIds: ["platform-secret-account"],
      }),
      eventRecord({
        id: "event-removed",
        eventCode: "EVT-REMOVED",
        title: "Removed own assignment event",
      }),
      eventRecord({
        id: "event-other",
        eventCode: "EVT-OTHER",
        title: "Other staff event",
      }),
      ...(options?.extraEvents ?? []),
    ],
    [
      eventAssignmentRecord({
        id: "assignment-own-talent",
        eventId: "event-own-talent",
        assignmentKind: "TALENT",
        assignmentTalentId: "talent-staff",
      }),
      eventAssignmentRecord({
        id: "assignment-own-employment-profile",
        eventId: "event-own-employment-profile",
        assignmentKind: "EMPLOYMENT_PROFILE",
        assignmentEmploymentProfileId: "ep-staff",
      }),
      eventAssignmentRecord({
        id: "assignment-group",
        eventId: "event-group-only",
        assignmentKind: "TALENT_GROUP",
        assignmentTalentGroupId: "talent-group-staff",
      }),
      eventAssignmentRecord({
        id: "assignment-external",
        eventId: "event-external",
        assignmentKind: "TALENT",
        assignmentTalentId: "talent-external",
      }),
      eventAssignmentRecord({
        id: "assignment-removed",
        eventId: "event-removed",
        assignmentKind: "TALENT",
        assignmentTalentId: "talent-staff",
        assignmentStatus: "REMOVED",
        removedAt: 10,
      }),
      eventAssignmentRecord({
        id: "assignment-other-talent",
        eventId: "event-other",
        assignmentKind: "TALENT",
        assignmentTalentId: "talent-other",
      }),
      eventAssignmentRecord({
        id: "assignment-other-employment-profile",
        eventId: "event-other",
        assignmentKind: "EMPLOYMENT_PROFILE",
        assignmentEmploymentProfileId: "ep-other",
      }),
      ...(options?.extraAssignments ?? []),
    ],
  );

  return {
    employmentProfiles,
    users,
    talents,
    workShifts,
    events,
    snapshot() {
      return {
        employmentProfiles: employmentProfiles.snapshot(),
        users: users.snapshot(),
        talents: talents.snapshot(),
        events: events.snapshot(),
      };
    },
  };
}

function employmentProfileRecord(
  overrides: Partial<EmploymentProfileRecord>,
): EmploymentProfileRecord {
  return {
    id: "ep-1",
    employeeCode: "EP-000001",
    legalName: "Legal Name",
    normalizedLegalName: "legal name",
    displayName: "Display Name",
    normalizedDisplayName: "display name",
    employmentKind: "EMPLOYEE",
    jobTitle: "Staff",
    titleDescription: null,
    externalRef: null,
    orgUnitId: "ou-1",
    managerEmploymentProfileId: "ep-manager",
    recruiterEmploymentProfileId: "ep-recruiter",
    hrOwnerEmploymentProfileId: "ep-hr",
    onboardingOwnerEmploymentProfileId: "ep-onboarding",
    sourcedByEmploymentProfileId: "ep-source",
    linkedUserId: "user-1",
    employmentStatus: "ACTIVE",
    contractStatus: "ACTIVE",
    employmentStartDate: 1,
    employmentEndDate: null,
    hiredAt: 2,
    onboardedAt: 3,
    createdAt: 4,
    updatedAt: 5,
    ...overrides,
  };
}

function userDetail(params: {
  readonly id: string;
  readonly email: string;
  readonly authSubject: string;
}): UserDetailView {
  return {
    id: params.id,
    actorKind: "STAFF",
    accountStatus: "ACTIVE",
    authLinkage: {
      provider: "auth0",
      subject: params.authSubject,
      status: "LINKED",
    },
    profile: {
      displayName: "Staff Account",
      email: params.email,
    },
    contextAccess: {
      contexts: ["ADMIN"],
    },
    preferences: {
      locale: "en",
      timezone: "Asia/Saigon",
    },
    createdAt: 1,
    updatedAt: 2,
    activatedAt: 2,
    disabledAt: null,
    archivedAt: null,
  };
}

function talentRecord(overrides: Partial<TalentRecord>): TalentRecord {
  return {
    id: "talent-1",
    talentCode: "TAL-000001",
    stageName: "Alias",
    normalizedStageName: "alias",
    legalName: "Talent Legal",
    normalizedLegalName: "talent legal",
    displayShortName: null,
    normalizedDisplayShortName: null,
    talentOrigin: "INTERNAL",
    operationalStatus: "ACTIVE",
    managerEmploymentProfileId: null,
    linkedEmploymentProfileId: "ep-1",
    commercialParticipationStatus: "ELIGIBLE",
    livestreamEligible: true,
    eventEligible: true,
    externalRef: null,
    profileSummary: null,
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

function eventRecord(overrides: Partial<EventRecord>): EventRecord {
  return {
    id: "event-1",
    eventCode: "EVT-000001",
    title: "Event",
    normalizedTitle: "event",
    ownerEmploymentProfileId: "ep-owner",
    studioResourceIds: ["studio-private-room"],
    platformAccountIds: [],
    status: "PLANNED",
    eventStartAt: 1_000,
    eventEndAt: 2_000,
    description:
      "Internal production note with full roster, manager only note, HR attribution, and client budget",
    externalRef: "externalRef-secret",
    createdByActorId: "admin-1",
    updatedByActorId: "admin-1",
    plannedAt: 1,
    plannedByActorId: "admin-1",
    confirmedAt: null,
    confirmedByActorId: null,
    completedAt: null,
    completedByActorId: null,
    cancelledAt: null,
    cancelledByActorId: null,
    cancellationReason: null,
    lastRescheduledAt: null,
    lastRescheduledByActorId: null,
    lastRescheduleReason: null,
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

function eventAssignmentRecord(
  overrides: Partial<EventAssignmentRecord>,
): EventAssignmentRecord {
  return {
    id: "assignment-1",
    eventId: "event-1",
    assignmentKind: "TALENT",
    assignmentEmploymentProfileId: null,
    assignmentTalentId: null,
    assignmentTalentGroupId: null,
    assignmentStatus: "ACTIVE",
    createdAt: 1,
    updatedAt: 2,
    removedAt: null,
    ...overrides,
  };
}

class InMemoryEmploymentProfileRepository implements EmploymentProfileRepository {
  constructor(private readonly records: EmploymentProfileRecord[]) {}

  snapshot(): readonly EmploymentProfileRecord[] {
    return this.records.map((record) => ({ ...record }));
  }

  async findNonArchivedByLinkedUserId(
    linkedUserId: string,
  ): Promise<EmploymentProfileRecord | null> {
    return (
      this.records.find(
        (record) =>
          record.linkedUserId === linkedUserId &&
          record.employmentStatus !== "ARCHIVED",
      ) ?? null
    );
  }

  async insert(): Promise<EmploymentProfileRecord> {
    throw new Error("Not implemented");
  }

  async findById(): Promise<EmploymentProfileRecord | null> {
    throw new Error("Not implemented");
  }

  async findByEmployeeCode(): Promise<EmploymentProfileRecord | null> {
    throw new Error("Not implemented");
  }

  async findMaxGeneratedCodeSequence(): Promise<number> {
    throw new Error("Not implemented");
  }

  async updateCore(): Promise<EmploymentProfileRecord | null> {
    throw new Error("Not implemented");
  }

  async assignOrgUnit(): Promise<EmploymentProfileRecord | null> {
    throw new Error("Not implemented");
  }

  async assignManager(): Promise<EmploymentProfileRecord | null> {
    throw new Error("Not implemented");
  }

  async setLinkedUser(): Promise<EmploymentProfileRecord | null> {
    throw new Error("Not implemented");
  }

  async transitionLifecycle(): Promise<EmploymentProfileRecord | null> {
    throw new Error("Not implemented");
  }

  async updateContractStatus(): Promise<EmploymentProfileRecord | null> {
    throw new Error("Not implemented");
  }

  async hasNonArchivedDirectReports(): Promise<boolean> {
    throw new Error("Not implemented");
  }
}

class InMemoryUserReadRepository implements UserReadRepository {
  constructor(private readonly records: UserDetailView[]) {}

  snapshot(): readonly UserDetailView[] {
    return this.records.map((record) => ({ ...record }));
  }

  async getUserDetail(userId: string): Promise<UserDetailView | null> {
    return this.records.find((record) => record.id === userId) ?? null;
  }

  async listUsers(): Promise<{
    readonly items: readonly UserListItemView[];
  }> {
    throw new Error("Not implemented");
  }
}

class InMemoryTalentRepository implements TalentRepository {
  constructor(private readonly records: TalentRecord[]) {}

  snapshot(): readonly TalentRecord[] {
    return this.records.map((record) => ({ ...record }));
  }

  async findNonArchivedByLinkedEmploymentProfileId(
    linkedEmploymentProfileId: string,
  ): Promise<TalentRecord | null> {
    return (
      this.records.find(
        (record) =>
          record.linkedEmploymentProfileId === linkedEmploymentProfileId &&
          record.operationalStatus !== "ARCHIVED",
      ) ?? null
    );
  }

  async insert(): Promise<TalentRecord> {
    throw new Error("Not implemented");
  }

  async findById(): Promise<TalentRecord | null> {
    throw new Error("Not implemented");
  }

  async findByTalentCode(): Promise<TalentRecord | null> {
    throw new Error("Not implemented");
  }

  async findMaxGeneratedCodeSequence(): Promise<number> {
    throw new Error("Not implemented");
  }

  async updateCore(): Promise<TalentRecord | null> {
    throw new Error("Not implemented");
  }

  async assignManager(): Promise<TalentRecord | null> {
    throw new Error("Not implemented");
  }

  async setLinkedEmploymentProfile(): Promise<TalentRecord | null> {
    throw new Error("Not implemented");
  }

  async transitionOperationalStatus(): Promise<TalentRecord | null> {
    throw new Error("Not implemented");
  }

  async updateCommercialParticipation(): Promise<TalentRecord | null> {
    throw new Error("Not implemented");
  }
}

class InMemoryWorkShiftReadRepository implements WorkShiftReadRepository {
  async listWorkShifts(_input: WorkShiftListReadInput): Promise<{
    readonly items: readonly WorkShiftListItemView[];
  }> {
    return { items: [] };
  }

  async listWorkShiftsBySubject(): Promise<{
    readonly items: readonly WorkShiftBySubjectListItemView[];
  }> {
    throw new Error("Not implemented");
  }

  async listWorkShiftsByResource(): Promise<{
    readonly items: readonly WorkShiftByResourceListItemView[];
  }> {
    throw new Error("Not implemented");
  }

  async getWorkShiftDetail(): Promise<WorkShiftDetailView | null> {
    throw new Error("Not implemented");
  }

  async listActiveEmploymentProfileShiftsForWindow(): Promise<[]> {
    throw new Error("Not implemented");
  }
}

class InMemoryEventAssignmentReadRepository implements EventAssignmentReadRepository {
  readonly listInputs: EventByAssignmentListReadInput[] = [];

  constructor(
    private readonly events: EventRecord[],
    private readonly assignments: EventAssignmentRecord[],
  ) {}

  snapshot(): unknown {
    return {
      events: this.events.map((event) => ({ ...event })),
      assignments: this.assignments.map((assignment) => ({ ...assignment })),
    };
  }

  async listEventsByAssignment(input: EventByAssignmentListReadInput): Promise<{
    readonly items: readonly EventByAssignmentListItemView[];
  }> {
    this.listInputs.push({ ...input });

    const eventIds = new Set(
      this.assignments
        .filter((assignment) => assignment.assignmentStatus === "ACTIVE")
        .filter(
          (assignment) => assignment.assignmentKind === input.assignmentKind,
        )
        .filter((assignment) => {
          if (input.assignmentKind === "EMPLOYMENT_PROFILE") {
            return (
              assignment.assignmentEmploymentProfileId ===
              input.assignmentEmploymentProfileId
            );
          }

          if (input.assignmentKind === "TALENT") {
            return assignment.assignmentTalentId === input.assignmentTalentId;
          }

          return (
            assignment.assignmentTalentGroupId === input.assignmentTalentGroupId
          );
        })
        .map((assignment) => assignment.eventId),
    );

    let items = this.events.filter((event) => eventIds.has(event.id));

    if (input.status) {
      items = items.filter((event) => event.status === input.status);
    } else {
      items = items.filter((event) => event.status !== "ARCHIVED");
    }

    if (input.windowStartAt !== undefined) {
      items = items.filter(
        (event) => event.eventEndAt > (input.windowStartAt as number),
      );
    }

    if (input.windowEndAt !== undefined) {
      items = items.filter(
        (event) => event.eventStartAt < (input.windowEndAt as number),
      );
    }

    return {
      items: items
        .sort((left, right) => left.eventStartAt - right.eventStartAt)
        .slice(0, input.limit)
        .map((event) => ({
          id: event.id,
          eventCode: event.eventCode,
          title: event.title,
          status: event.status,
          eventStartAt: event.eventStartAt,
          eventEndAt: event.eventEndAt,
        })),
    };
  }

  async listEvents(): Promise<{
    readonly items: readonly EventListItemView[];
  }> {
    throw new Error("Not implemented");
  }

  async listEventsByResource(): Promise<{
    readonly items: readonly EventByResourceListItemView[];
  }> {
    throw new Error("Not implemented");
  }

  async listEventsByPlatform(): Promise<{
    readonly items: readonly EventByPlatformListItemView[];
  }> {
    throw new Error("Not implemented");
  }

  async listActiveAssignmentsForEvent(): Promise<
    readonly EventAssignmentListItemView[]
  > {
    throw new Error("Not implemented");
  }

  async getEventDetail(): Promise<EventDetailView | null> {
    throw new Error("Not implemented");
  }

  async eventHasManagedGroupAssignment(): Promise<boolean> {
    throw new Error("Not implemented");
  }

  async listManagerEventSummaries(): Promise<[]> {
    return [];
  }

  async getManagerEventSummary(): Promise<null> {
    return null;
  }

  async listStudioBookings(): Promise<[]> {
    return [];
  }
}

type _KeepImportedTypesUsed =
  | ClientSession
  | EmploymentStatus
  | TalentOperationalStatus;
