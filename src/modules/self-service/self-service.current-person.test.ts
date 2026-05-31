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
import { TalentRepository } from "@modules/talent/domain/talent.repository";
import {
  TalentOperationalStatus,
  TalentRecord,
} from "@modules/talent/domain/talent.types";
import { UserReadRepository } from "@modules/user/read/user.read-repository";
import {
  UpdateUserPreferencesInput,
  UserMutationRepository,
} from "@modules/user/domain/user.repository";
import {
  UserDetailView,
  UserListItemView,
  UserRecord,
} from "@modules/user/domain/user.types";
import { SelfServiceAccountPreferencesController } from "./self-service.account-preferences.controller";
import { SelfServiceAccountPreferencesService } from "./self-service.account-preferences.service";
import { SelfServiceCurrentPersonController } from "./self-service.current-person.controller";
import { SelfServiceCurrentPersonService } from "./self-service.current-person.service";
import { SelfServiceEventsController } from "./self-service.events.controller";
import { SelfServiceEventsService } from "./self-service.events.service";
import { selfServiceRoutes } from "./self-service.routes";
import { SelfServiceIdentityResolver } from "./shared/self-service.identity-resolver";
import { SelfServiceWorkShiftsController } from "./self-service.work-shifts.controller";
import { SelfServiceWorkShiftsService } from "./self-service.work-shifts.service";
import {
  EventAssignmentReadRepository,
  EventByAssignmentListReadInput,
} from "@modules/event-assignment/read/event-assignment.read-repository";
import {
  EventAssignmentListItemView,
  EventByAssignmentListItemView,
  EventByPlatformListItemView,
  EventByResourceListItemView,
  EventDetailView,
  EventListItemView,
} from "@modules/event-assignment/domain/event-assignment.types";
import {
  WorkShiftListReadInput,
  WorkShiftReadRepository,
} from "@modules/work-schedule/read/work-schedule.read-repository";
import {
  WorkShiftByResourceListItemView,
  WorkShiftBySubjectListItemView,
  WorkShiftDetailView,
  WorkShiftListItemView,
  WorkShiftStatus,
} from "@modules/work-schedule/domain/work-schedule.types";

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

test("GET /self-service/me returns linked staff safe current-person DTO", async () => {
  const harness = createHarness();
  const { server, baseUrl } = await listen(
    createSelfServiceTestApp(harness, createStaffActor("user-staff")),
  );

  try {
    const response = await fetch(`${baseUrl}/self-service/me`);
    const body = await response.json();
    const serialized = JSON.stringify(body);

    assert.equal(response.status, 200);
    assert.deepEqual(body.data, {
      employmentProfileId: "ep-staff",
      employeeCode: "EP-000777",
      displayName: "Staff Display",
      employmentStatus: "ACTIVE",
      accountEmail: "staff@example.test",
      accountStatus: "ACTIVE",
      accountLinkStatus: "LINKED",
      linkedInternalTalent: {
        talentId: "talent-staff",
        talentCode: "TAL-000777",
        displayName: "Staff Display",
        performanceAlias: "Performance Alias",
      },
      locale: "en",
      timezone: "Asia/Saigon",
    });

    for (const forbidden of [
      "legalName",
      "recruiterEmploymentProfileId",
      "hrOwnerEmploymentProfileId",
      "onboardingOwnerEmploymentProfileId",
      "sourcedByEmploymentProfileId",
      "hiredAt",
      "onboardedAt",
      "managerEmploymentProfileId",
      "linkedUserId",
      "roles",
      "auth0|staff",
      "subject",
      "setupUrl",
      "ticketUrl",
      "resetUrl",
      "temporaryPassword",
      "credential",
      "session",
      "PENDING_APPROVAL",
      "ACTIVE_ALLOCATION",
    ]) {
      assert.equal(serialized.includes(forbidden), false, forbidden);
    }
  } finally {
    await close(server);
  }
});

test("GET /self-service/me ignores arbitrary person query and returns only current actor", async () => {
  const harness = createHarness();
  const { server, baseUrl } = await listen(
    createSelfServiceTestApp(harness, createStaffActor("user-staff")),
  );

  try {
    const response = await fetch(
      `${baseUrl}/self-service/me?employmentProfileId=ep-other`,
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.data.employmentProfileId, "ep-staff");
    assert.notEqual(body.data.employmentProfileId, "ep-other");
    assert.deepEqual(harness.employmentProfiles.lookupLinkedUserIds, [
      "user-staff",
    ]);
  } finally {
    await close(server);
  }
});

test("GET /self-service/me returns a safe error when no linked EmploymentProfile exists", async () => {
  const harness = createHarness();
  const { server, baseUrl } = await listen(
    createSelfServiceTestApp(harness, createStaffActor("user-unlinked")),
  );

  try {
    const response = await fetch(`${baseUrl}/self-service/me`);
    const body = await response.json();
    const serialized = JSON.stringify(body);

    assert.equal(response.status, 404);
    assert.deepEqual(body, {
      error: {
        code: "SELF_SERVICE_CURRENT_PERSON_NOT_LINKED",
        message: "No linked Employment Profile",
      },
    });
    assert.equal(serialized.includes("Staff Legal"), false);
    assert.equal(serialized.includes("user-staff"), false);
  } finally {
    await close(server);
  }
});

test("self-service current person endpoint does not mutate person, user, or talent records", async () => {
  const harness = createHarness();
  const before = harness.snapshot();
  const { server, baseUrl } = await listen(
    createSelfServiceTestApp(harness, createStaffActor("user-staff")),
  );

  try {
    const response = await fetch(`${baseUrl}/self-service/me`);
    await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(harness.snapshot(), before);
  } finally {
    await close(server);
  }
});

test("PATCH /self-service/account/preferences updates only current actor locale and timezone", async () => {
  const harness = createHarness();
  const beforeEmploymentProfiles = harness.employmentProfiles.snapshot();
  const beforeTalents = harness.talents.snapshot();
  const beforeWorkShifts = harness.workShifts.snapshot();
  const { server, baseUrl } = await listen(
    createSelfServiceTestApp(harness, createStaffActor("user-staff")),
  );

  try {
    const response = await fetch(
      `${baseUrl}/self-service/account/preferences`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          locale: "vi",
          timezone: "Asia/Ho_Chi_Minh",
        }),
      },
    );
    const body = await response.json();
    const serialized = JSON.stringify(body);

    assert.equal(response.status, 200);
    assert.equal(body.data.employmentProfileId, "ep-staff");
    assert.equal(body.data.locale, "vi");
    assert.equal(body.data.timezone, "Asia/Ho_Chi_Minh");
    assert.deepEqual(harness.users.updatedUserIds, ["user-staff"]);
    assert.equal(harness.users.getUser("user-other")?.preferences.locale, "en");

    const meResponse = await fetch(`${baseUrl}/self-service/me`);
    const meBody = await meResponse.json();

    assert.equal(meResponse.status, 200);
    assert.equal(meBody.data.locale, "vi");
    assert.equal(meBody.data.timezone, "Asia/Ho_Chi_Minh");
    assert.deepEqual(
      harness.employmentProfiles.snapshot(),
      beforeEmploymentProfiles,
    );
    assert.deepEqual(harness.talents.snapshot(), beforeTalents);
    assert.deepEqual(harness.workShifts.snapshot(), beforeWorkShifts);

    for (const forbidden of [
      "legalName",
      "linkedUserId",
      "roles",
      "permissions",
      "auth0|staff",
      "subject",
      "setupUrl",
      "ticketUrl",
      "resetUrl",
      "temporaryPassword",
      "credential",
      "session",
    ]) {
      assert.equal(serialized.includes(forbidden), false, forbidden);
    }
  } finally {
    await close(server);
  }
});

test("PATCH /self-service/account/preferences rejects forbidden fields without mutation", async () => {
  const harness = createHarness();
  const before = harness.snapshot();
  const { server, baseUrl } = await listen(
    createSelfServiceTestApp(harness, createStaffActor("user-staff")),
  );

  try {
    const response = await fetch(
      `${baseUrl}/self-service/account/preferences`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          locale: "vi",
          userId: "user-other",
          employmentProfileId: "ep-other",
          actorId: "user-other",
          linkedUserId: "user-other",
          subject: "auth0|other",
          email: "other@example.test",
          phone: "+84000000000",
          address: "Hidden address",
          displayName: "Changed",
          legalName: "Changed Legal",
          accountStatus: "DISABLED",
          role: "SUPER_ADMIN",
          permission: "USER_WRITE",
          scope: "all",
          password: "temporary",
          auth0: { subject: "auth0|other" },
          ticketUrl: "https://example.test/ticket",
          resetUrl: "https://example.test/reset",
          setupUrl: "https://example.test/setup",
          temporaryPassword: "secret",
        }),
      },
    );
    const body = await response.json();
    const serialized = JSON.stringify(body);

    assert.equal(response.status, 400);
    assert.match(body.error.message, /Invalid self-service request/);
    assert.deepEqual(harness.snapshot(), before);
    assert.equal(serialized.includes("other@example.test"), false);
    assert.equal(serialized.includes("temporary"), false);
  } finally {
    await close(server);
  }
});

test("PATCH /self-service/account/preferences rejects unsupported locale and invalid timezone", async () => {
  const harness = createHarness();
  const before = harness.snapshot();
  const { server, baseUrl } = await listen(
    createSelfServiceTestApp(harness, createStaffActor("user-staff")),
  );

  try {
    const unsupportedLocaleResponse = await fetch(
      `${baseUrl}/self-service/account/preferences`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          locale: "fr",
          timezone: "Asia/Saigon",
        }),
      },
    );
    const unsupportedLocaleBody = await unsupportedLocaleResponse.json();

    assert.equal(unsupportedLocaleResponse.status, 400);
    assert.match(
      unsupportedLocaleBody.error.message,
      /Invalid self-service request/,
    );

    const invalidTimezoneResponse = await fetch(
      `${baseUrl}/self-service/account/preferences`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          locale: "vi",
          timezone: "Not/A_Timezone",
        }),
      },
    );
    const invalidTimezoneBody = await invalidTimezoneResponse.json();

    assert.equal(invalidTimezoneResponse.status, 400);
    assert.match(
      invalidTimezoneBody.error.message,
      /Invalid self-service request/,
    );
    assert.deepEqual(harness.snapshot(), before);
  } finally {
    await close(server);
  }
});

test("PATCH /self-service/account/preferences cannot target another user", async () => {
  const harness = createHarness();
  const before = harness.snapshot();
  const { server, baseUrl } = await listen(
    createSelfServiceTestApp(harness, createStaffActor("user-staff")),
  );

  try {
    const response = await fetch(
      `${baseUrl}/self-service/account/preferences`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: "user-other",
          locale: "vi",
          timezone: "Asia/Ho_Chi_Minh",
        }),
      },
    );

    assert.equal(response.status, 400);
    assert.deepEqual(harness.snapshot(), before);
    assert.equal(harness.users.updatedUserIds.length, 0);
  } finally {
    await close(server);
  }
});

test("GET /self-service/work-shifts returns only current actor official EmploymentProfile shifts", async () => {
  const harness = createHarness();
  const { server, baseUrl } = await listen(
    createSelfServiceTestApp(harness, createStaffActor("user-staff")),
  );

  try {
    const response = await fetch(
      `${baseUrl}/self-service/work-shifts?employmentProfileId=ep-other&limit=10`,
    );
    const rejected = await response.json();

    assert.equal(response.status, 400);
    assert.match(rejected.error.message, /Invalid self-service request/);

    const safeResponse = await fetch(
      `${baseUrl}/self-service/work-shifts?limit=10&windowStartAt=1000&windowEndAt=4000`,
    );
    const body = await safeResponse.json();
    const serialized = JSON.stringify(body);

    assert.equal(safeResponse.status, 200);
    assert.deepEqual(body.data, [
      {
        workShiftId: "shift-own-active",
        title: "Own official filming shift",
        status: "ACTIVE",
        startsAt: 2_000,
        endsAt: 3_000,
        sourceType: "ROSTER_GENERATED",
      },
      {
        workShiftId: "shift-own-cancelled",
        title: "Own cancelled official shift",
        status: "CANCELLED",
        startsAt: 3_000,
        endsAt: 3_500,
        sourceType: "MANUAL",
      },
    ]);
    assert.deepEqual(harness.workShifts.listInputs, [
      {
        subjectKind: "EMPLOYMENT_PROFILE",
        subjectEmploymentProfileId: "ep-staff",
        status: undefined,
        windowStartAt: 1_000,
        windowEndAt: 4_000,
        limit: 10,
        cursor: undefined,
        sortField: "shiftStartAt",
        sortDirection: "ASC",
      },
    ]);

    for (const forbidden of [
      "shift-other",
      "Other official shift",
      "ep-other",
      "subjectEmploymentProfileId",
      "subjectRef",
      "studioResourceIds",
      "internal admin note",
      "externalRef",
      "approvalNote",
      "requestedByUserId",
      "managerEmploymentProfileId",
      "legalName",
      "auth0|",
      "temporaryPassword",
    ]) {
      assert.equal(serialized.includes(forbidden), false, forbidden);
    }
  } finally {
    await close(server);
  }
});

test("GET /self-service/work-shifts can filter current actor shifts by safe status only", async () => {
  const harness = createHarness();
  const { server, baseUrl } = await listen(
    createSelfServiceTestApp(harness, createStaffActor("user-staff")),
  );

  try {
    const response = await fetch(
      `${baseUrl}/self-service/work-shifts?status=ACTIVE`,
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(
      body.data.map(
        (item: { readonly workShiftId: string }) => item.workShiftId,
      ),
      ["shift-own-active"],
    );
    assert.equal(
      harness.workShifts.listInputs[0]?.subjectEmploymentProfileId,
      "ep-staff",
    );
    assert.equal(harness.workShifts.listInputs[0]?.status, "ACTIVE");
  } finally {
    await close(server);
  }
});

test("GET /self-service/work-shifts returns a safe error when no linked EmploymentProfile exists", async () => {
  const harness = createHarness();
  const { server, baseUrl } = await listen(
    createSelfServiceTestApp(harness, createStaffActor("user-unlinked")),
  );

  try {
    const response = await fetch(`${baseUrl}/self-service/work-shifts`);
    const body = await response.json();
    const serialized = JSON.stringify(body);

    assert.equal(response.status, 404);
    assert.deepEqual(body, {
      error: {
        code: "SELF_SERVICE_CURRENT_PERSON_NOT_LINKED",
        message: "No linked Employment Profile",
      },
    });
    assert.equal(serialized.includes("Staff Legal"), false);
    assert.equal(serialized.includes("shift-own-active"), false);
    assert.deepEqual(harness.workShifts.listInputs, []);
  } finally {
    await close(server);
  }
});

test("self-service work shifts endpoint is read-only and does not expose mutation routes", async () => {
  const harness = createHarness();
  const before = harness.snapshot();
  const { server, baseUrl } = await listen(
    createSelfServiceTestApp(harness, createStaffActor("user-staff")),
  );

  try {
    const getResponse = await fetch(`${baseUrl}/self-service/work-shifts`);
    await getResponse.json();
    assert.equal(getResponse.status, 200);
    assert.deepEqual(harness.snapshot(), before);

    const postResponse = await fetch(`${baseUrl}/self-service/work-shifts`, {
      method: "POST",
    });
    assert.equal(postResponse.status, 404);
    assert.deepEqual(harness.snapshot(), before);
  } finally {
    await close(server);
  }
});

test("self-service foundation does not change TALENT_STAFF_SELF role template permissions or scopes", () => {
  const template = ROLE_TEMPLATE_CATALOG.find(
    (candidate) => candidate.code === "TALENT_STAFF_SELF",
  );

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
});

function createSelfServiceTestApp(
  harness: SelfServiceHarness,
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
  const controller = new SelfServiceCurrentPersonController(
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
      new EmptyEventAssignmentReadRepository(),
    ),
  );
  const accountPreferencesController =
    new SelfServiceAccountPreferencesController(
      new SelfServiceAccountPreferencesService(
        identityResolver,
        harness.users,
        currentPersonService,
        () => 10,
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
      controller,
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

interface SelfServiceHarness {
  readonly employmentProfiles: InMemoryEmploymentProfileRepository;
  readonly users: InMemoryUserReadRepository;
  readonly talents: InMemoryTalentRepository;
  readonly workShifts: InMemoryWorkShiftReadRepository;
  snapshot(): unknown;
}

function createHarness(): SelfServiceHarness {
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
  ]);
  const users = new InMemoryUserReadRepository([
    userDetail({
      id: "user-staff",
      email: "staff@example.test",
      authSubject: "auth0|staff",
    }),
    userDetail({
      id: "user-other",
      email: "other@example.test",
      authSubject: "auth0|other",
    }),
  ]);
  const talents = new InMemoryTalentRepository([
    talentRecord({
      id: "talent-staff",
      linkedEmploymentProfileId: "ep-staff",
      talentCode: "TAL-000777",
      stageName: "Performance Alias",
      legalName: "Legacy Talent Legal",
      displayShortName: "Legacy Talent Short",
    }),
  ]);
  const workShifts = new InMemoryWorkShiftReadRepository([
    workShiftListItem({
      id: "shift-own-active",
      title: "Own official filming shift",
      subjectEmploymentProfileId: "ep-staff",
      status: "ACTIVE",
      shiftStartAt: 2_000,
      shiftEndAt: 3_000,
      sourceType: "ROSTER_GENERATED",
    }),
    workShiftListItem({
      id: "shift-own-cancelled",
      title: "Own cancelled official shift",
      subjectEmploymentProfileId: "ep-staff",
      status: "CANCELLED",
      shiftStartAt: 3_000,
      shiftEndAt: 3_500,
      sourceType: "MANUAL",
    }),
    workShiftListItem({
      id: "shift-own-archived",
      title: "Own archived shift",
      subjectEmploymentProfileId: "ep-staff",
      status: "ARCHIVED",
      shiftStartAt: 2_500,
      shiftEndAt: 2_900,
      sourceType: "MANUAL",
    }),
    workShiftListItem({
      id: "shift-other",
      title: "Other official shift",
      subjectEmploymentProfileId: "ep-other",
      status: "ACTIVE",
      shiftStartAt: 2_100,
      shiftEndAt: 3_200,
      sourceType: "MANUAL",
    }),
  ]);

  return {
    employmentProfiles,
    users,
    talents,
    workShifts,
    snapshot() {
      return {
        employmentProfiles: employmentProfiles.snapshot(),
        users: users.snapshot(),
        talents: talents.snapshot(),
        workShifts: workShifts.snapshot(),
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

function workShiftListItem(
  overrides: Partial<WorkShiftListItemView>,
): WorkShiftListItemView {
  return {
    id: "shift-1",
    shiftCode: "WS-000001",
    title: "Shift",
    subjectKind: "EMPLOYMENT_PROFILE",
    subjectEmploymentProfileId: "ep-staff",
    subjectTalentId: null,
    subjectTalentGroupId: null,
    subjectRef: {
      id: "ep-staff",
      displayName: "Staff Display",
      name: "Staff Legal",
    },
    status: "ACTIVE",
    shiftStartAt: 1_000,
    shiftEndAt: 2_000,
    sourceType: "MANUAL",
    sourceRosterId: null,
    sourceRosterRef: null,
    sourceRosterMonth: null,
    sourceRosterLocalDate: null,
    sourceRosterSlotKey: null,
    createdAt: 1,
    ...overrides,
  };
}

class InMemoryEmploymentProfileRepository implements EmploymentProfileRepository {
  readonly lookupLinkedUserIds: string[] = [];

  constructor(private readonly records: EmploymentProfileRecord[]) {}

  snapshot(): readonly EmploymentProfileRecord[] {
    return this.records.map((record) => ({ ...record }));
  }

  async findNonArchivedByLinkedUserId(
    linkedUserId: string,
  ): Promise<EmploymentProfileRecord | null> {
    this.lookupLinkedUserIds.push(linkedUserId);
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

class InMemoryUserReadRepository
  implements UserReadRepository, UserMutationRepository
{
  readonly updatedUserIds: string[] = [];

  constructor(private readonly records: UserDetailView[]) {}

  snapshot(): readonly UserDetailView[] {
    return this.records.map((record) => ({
      ...record,
      authLinkage: { ...record.authLinkage },
      profile: { ...record.profile },
      contextAccess: { ...record.contextAccess },
      preferences: { ...record.preferences },
    }));
  }

  getUser(userId: string): UserDetailView | null {
    return this.records.find((record) => record.id === userId) ?? null;
  }

  async getUserDetail(userId: string): Promise<UserDetailView | null> {
    return this.records.find((record) => record.id === userId) ?? null;
  }

  async listUsers(): Promise<{
    readonly items: readonly UserListItemView[];
  }> {
    throw new Error("Not implemented");
  }

  async updatePreferences(
    input: UpdateUserPreferencesInput,
  ): Promise<UserRecord | null> {
    const record = this.records.find(
      (candidate) =>
        candidate.id === input.userId && candidate.accountStatus !== "ARCHIVED",
    );

    if (!record) {
      return null;
    }

    this.updatedUserIds.push(input.userId);

    const mutable = record as {
      preferences: UserDetailView["preferences"];
      updatedAt: number;
    };

    mutable.preferences = {
      ...record.preferences,
      locale: input.locale ?? record.preferences.locale,
      timezone: input.timezone ?? record.preferences.timezone,
    };
    mutable.updatedAt = input.updatedAt;

    return record as unknown as UserRecord;
  }

  async insert(): Promise<UserRecord> {
    throw new Error("Not implemented");
  }

  async findById(): Promise<UserRecord | null> {
    throw new Error("Not implemented");
  }

  async findByAuthSubject(): Promise<UserRecord | null> {
    throw new Error("Not implemented");
  }

  async findByEmail(): Promise<UserRecord | null> {
    throw new Error("Not implemented");
  }

  async updateProfile(): Promise<UserRecord | null> {
    throw new Error("Not implemented");
  }

  async transitionLifecycle(): Promise<UserRecord | null> {
    throw new Error("Not implemented");
  }

  async setAuthLinkage(): Promise<UserRecord | null> {
    throw new Error("Not implemented");
  }

  async updateActorKind(): Promise<UserRecord | null> {
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
  readonly listInputs: WorkShiftListReadInput[] = [];

  constructor(private readonly records: WorkShiftListItemView[]) {}

  snapshot(): readonly WorkShiftListItemView[] {
    return this.records.map((record) => ({ ...record }));
  }

  async listWorkShifts(input: WorkShiftListReadInput): Promise<{
    readonly items: readonly WorkShiftListItemView[];
    readonly nextCursor?: string;
  }> {
    this.listInputs.push({ ...input });

    let items = this.records.filter(
      (record) =>
        record.subjectKind === input.subjectKind &&
        record.subjectEmploymentProfileId === input.subjectEmploymentProfileId,
    );

    if (input.status) {
      items = items.filter((record) => record.status === input.status);
    } else {
      items = items.filter((record) => record.status !== "ARCHIVED");
    }

    if (input.windowStartAt !== undefined) {
      items = items.filter(
        (record) => record.shiftEndAt > (input.windowStartAt as number),
      );
    }

    if (input.windowEndAt !== undefined) {
      items = items.filter(
        (record) => record.shiftStartAt < (input.windowEndAt as number),
      );
    }

    return {
      items: items.slice(0, input.limit),
    };
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

class EmptyEventAssignmentReadRepository implements EventAssignmentReadRepository {
  async listEventsByAssignment(
    _input: EventByAssignmentListReadInput,
  ): Promise<{
    readonly items: readonly EventByAssignmentListItemView[];
  }> {
    return { items: [] };
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
}

type _KeepImportedTypesUsed =
  | ClientSession
  | EmploymentStatus
  | TalentOperationalStatus
  | WorkShiftStatus;
