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
  UserDetailView,
  UserListItemView,
} from "@modules/user/domain/user.types";
import { SelfServiceCurrentPersonController } from "./self-service.current-person.controller";
import { SelfServiceCurrentPersonService } from "./self-service.current-person.service";
import { selfServiceRoutes } from "./self-service.routes";

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
  const controller = new SelfServiceCurrentPersonController(
    new SelfServiceCurrentPersonService(
      harness.employmentProfiles,
      harness.users,
      harness.talents,
    ),
  );

  app.use(
    "/self-service",
    contextMiddleware("ADMIN"),
    (req, _res, next) => {
      bindActor(req, actor);
      next();
    },
    selfServiceRoutes(controller),
  );
  app.use(createHttpErrorMiddleware({ error() {} } as never));

  return app;
}

function createStaffActor(userId: string): Actor {
  return new Actor({
    id: userId,
    type: "staff",
    context: "ADMIN",
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

  return {
    employmentProfiles,
    users,
    talents,
    snapshot() {
      return {
        employmentProfiles: employmentProfiles.snapshot(),
        users: users.snapshot(),
        talents: talents.snapshot(),
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

class InMemoryEmploymentProfileRepository
  implements EmploymentProfileRepository
{
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

type _KeepImportedTypesUsed = ClientSession | EmploymentStatus | TalentOperationalStatus;
