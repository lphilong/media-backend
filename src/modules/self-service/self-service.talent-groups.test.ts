import assert from "node:assert/strict";
import { createServer, Server } from "node:http";
import { AddressInfo } from "node:net";
import { test } from "node:test";
import express from "express";
import { withCommand } from "@app/base/command.middleware";
import { createHttpErrorMiddleware } from "@app/http/http-error.middleware";
import { Actor } from "@core/actor/actor";
import { bindActor } from "@core/actor/actor-context";
import { contextMiddleware } from "@core/context/context.middleware.adapter";
import { EmploymentProfileRepository } from "@modules/employment-profile/domain/employment-profile.repository";
import { EmploymentProfileRecord } from "@modules/employment-profile/domain/employment-profile.types";
import {
  SelfServiceTalentGroupsReadRepository,
  SelfServiceTalentGroupManagerReadModel,
  SelfServiceTalentGroupMemberReadModel,
  SelfServiceTalentGroupMembershipReadModel,
  SelfServiceTalentGroupReadModel,
} from "@modules/self-service/domain/self-service-talent-groups.repository";
import { TalentRepository } from "@modules/talent/domain/talent.repository";
import { TalentRecord } from "@modules/talent/domain/talent.types";
import { SelfServiceTalentGroupsController } from "./self-service.talent-groups.controller";
import { SelfServiceTalentGroupsService } from "./self-service.talent-groups.service";

const NOW = 50;

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

test("GET /self-service/talent-groups returns safe active groups for the current linked internal Talent", async () => {
  const harness = createHarness();
  const { server, baseUrl } = await listen(
    createSelfServiceTalentGroupsTestApp(harness, createStaffActor("user-staff")),
  );

  try {
    const response = await fetch(`${baseUrl}/self-service/talent-groups`);
    const body = await response.json();
    const serialized = JSON.stringify(body);

    assert.equal(response.status, 200);
    assert.deepEqual(body.data.items, [
      {
        talentGroupCode: "TG-ALPHA",
        name: "Alpha Team",
        status: "ACTIVE",
        managers: [
          {
            displayName: "Primary Manager",
            employeeCode: "EP-MGR-001",
          },
          {
            displayName: "Backup Manager",
          },
        ],
        members: [
          {
            talentCode: "TAL-STAFF",
            displayName: "Staff Display",
            performanceAlias: "Staff Alias",
            origin: "INTERNAL",
          },
          {
            talentCode: "TAL-GUEST",
            displayName: "Guest Display",
            performanceAlias: "Guest Alias",
            origin: "EXTERNAL",
          },
        ],
      },
      {
        talentGroupCode: "TG-BETA",
        name: "Beta Team",
        status: "ACTIVE",
        managers: [],
        members: [],
      },
    ]);
    assert.deepEqual(harness.employmentProfiles.lookupLinkedUserIds, [
      "user-staff",
    ]);
    assert.deepEqual(harness.talents.lookupEmploymentProfileIds, ["ep-staff"]);
    assert.deepEqual(harness.talentGroups.membershipTalentIds, ["talent-staff"]);
    assert.deepEqual(harness.talentGroups.groupIdBatches, [
      ["group-beta", "group-alpha"],
    ]);
    assert.deepEqual(harness.talentGroups.managerInputs, [
      {
        groupIds: ["group-beta", "group-alpha"],
        asOf: NOW,
      },
    ]);
    assert.deepEqual(harness.talentGroups.memberGroupIdBatches, [
      ["group-beta", "group-alpha"],
    ]);

    for (const forbidden of [
      "group-alpha",
      "group-beta",
      "manager-assignment-id",
      "managerEmploymentProfileId",
      "membership-id",
      "talent-staff",
      "linkedEmploymentProfileId",
      "linkedUserId",
      "legalName",
      "email",
      "phone",
      "address",
      "auth0|",
      "roles",
      "scopeGrants",
      "notes",
      "payroll",
      "finance",
      "commercial",
      "platform",
      "studio",
    ]) {
      assert.equal(serialized.includes(forbidden), false, forbidden);
    }
  } finally {
    await close(server);
  }
});

test("GET /self-service/talent-groups returns an empty result without a linked internal Talent", async () => {
  const harness = createHarness();
  const { server, baseUrl } = await listen(
    createSelfServiceTalentGroupsTestApp(
      harness,
      createStaffActor("user-external-talent"),
    ),
  );

  try {
    const response = await fetch(`${baseUrl}/self-service/talent-groups`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body.data.items, []);
    assert.deepEqual(harness.talentGroups.membershipTalentIds, []);
  } finally {
    await close(server);
  }
});

test("GET /self-service/talent-groups returns an empty result without active memberships", async () => {
  const harness = createHarness();
  const { server, baseUrl } = await listen(
    createSelfServiceTalentGroupsTestApp(
      harness,
      createStaffActor("user-no-membership"),
    ),
  );

  try {
    const response = await fetch(`${baseUrl}/self-service/talent-groups`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body.data.items, []);
    assert.deepEqual(harness.talentGroups.membershipTalentIds, [
      "talent-no-membership",
    ]);
    assert.deepEqual(harness.talentGroups.groupIdBatches, []);
    assert.deepEqual(harness.talentGroups.managerInputs, []);
    assert.deepEqual(harness.talentGroups.memberGroupIdBatches, []);
  } finally {
    await close(server);
  }
});

test("GET /self-service/talent-groups returns a safe error when actor is not linked", async () => {
  const harness = createHarness();
  const { server, baseUrl } = await listen(
    createSelfServiceTalentGroupsTestApp(
      harness,
      createStaffActor("user-unlinked"),
    ),
  );

  try {
    const response = await fetch(`${baseUrl}/self-service/talent-groups`);
    const body = await response.json();

    assert.equal(response.status, 404);
    assert.deepEqual(body, {
      error: {
        code: "SELF_SERVICE_CURRENT_PERSON_NOT_LINKED",
        message: "No linked Employment Profile",
      },
    });
    assert.deepEqual(harness.talents.lookupEmploymentProfileIds, []);
    assert.deepEqual(harness.talentGroups.membershipTalentIds, []);
  } finally {
    await close(server);
  }
});

test("GET /self-service/talent-groups rejects every client-supplied query field", async () => {
  const harness = createHarness();
  const { server, baseUrl } = await listen(
    createSelfServiceTalentGroupsTestApp(harness, createStaffActor("user-staff")),
  );

  try {
    const response = await fetch(
      `${baseUrl}/self-service/talent-groups?groupId=group-other&talentId=talent-other&status=ACTIVE`,
    );
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.match(body.error.message, /Invalid self-service request/);
    assert.deepEqual(harness.employmentProfiles.lookupLinkedUserIds, []);
    assert.deepEqual(harness.talents.lookupEmploymentProfileIds, []);
    assert.deepEqual(harness.talentGroups.membershipTalentIds, []);
  } finally {
    await close(server);
  }
});

test("self-service talent groups endpoint is GET/read-only", async () => {
  const harness = createHarness();
  const { server, baseUrl } = await listen(
    createSelfServiceTalentGroupsTestApp(harness, createStaffActor("user-staff")),
  );

  try {
    const postResponse = await fetch(`${baseUrl}/self-service/talent-groups`, {
      method: "POST",
    });

    assert.equal(postResponse.status, 404);
    assert.deepEqual(harness.employmentProfiles.lookupLinkedUserIds, []);
    assert.deepEqual(harness.talents.lookupEmploymentProfileIds, []);
    assert.deepEqual(harness.talentGroups.membershipTalentIds, []);
  } finally {
    await close(server);
  }
});

function createSelfServiceTalentGroupsTestApp(
  harness: SelfServiceTalentGroupsHarness,
  actor: Actor,
): express.Express {
  const app = express();
  const controller = new SelfServiceTalentGroupsController(
    new SelfServiceTalentGroupsService(
      harness.employmentProfiles,
      harness.talents,
      harness.talentGroups,
      () => NOW,
    ),
  );

  app.get(
    "/self-service/talent-groups",
    contextMiddleware("SELF_SERVICE"),
    (req, _res, next) => {
      bindActor(req, actor);
      next();
    },
    withCommand("SELF_SERVICE_TALENT_GROUPS_LIST"),
    controller.execute,
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
    permissions: [],
    scopeGrants: {},
    isActive: true,
  });
}

interface SelfServiceTalentGroupsHarness {
  readonly employmentProfiles: TrackedEmploymentProfileRepository;
  readonly talents: TrackedTalentRepository;
  readonly talentGroups: InMemorySelfServiceTalentGroupsReadRepository;
}

function createHarness(): SelfServiceTalentGroupsHarness {
  return {
    employmentProfiles: createEmploymentProfileRepository([
      {
        id: "ep-staff",
        linkedUserId: "user-staff",
      },
      {
        id: "ep-external-talent",
        linkedUserId: "user-external-talent",
      },
      {
        id: "ep-no-membership",
        linkedUserId: "user-no-membership",
      },
    ]),
    talents: createTalentRepository([
      {
        id: "talent-staff",
        linkedEmploymentProfileId: "ep-staff",
        talentOrigin: "INTERNAL",
      },
      {
        id: "talent-external",
        linkedEmploymentProfileId: "ep-external-talent",
        talentOrigin: "EXTERNAL",
      },
      {
        id: "talent-no-membership",
        linkedEmploymentProfileId: "ep-no-membership",
        talentOrigin: "INTERNAL",
      },
    ]),
    talentGroups: new InMemorySelfServiceTalentGroupsReadRepository(),
  };
}

interface TrackedEmploymentProfileRepository
  extends EmploymentProfileRepository {
  readonly lookupLinkedUserIds: string[];
}

function createEmploymentProfileRepository(
  records: ReadonlyArray<Pick<EmploymentProfileRecord, "id" | "linkedUserId">>,
): TrackedEmploymentProfileRepository {
  const lookupLinkedUserIds: string[] = [];

  return {
    lookupLinkedUserIds,
    async findNonArchivedByLinkedUserId(
      linkedUserId: string,
    ): Promise<EmploymentProfileRecord | null> {
      lookupLinkedUserIds.push(linkedUserId);
      return (
        (records.find((record) => record.linkedUserId === linkedUserId) as
          | EmploymentProfileRecord
          | undefined) ?? null
      );
    },
  } as TrackedEmploymentProfileRepository;
}

interface TrackedTalentRepository extends TalentRepository {
  readonly lookupEmploymentProfileIds: string[];
}

function createTalentRepository(
  records: ReadonlyArray<
    Pick<
      TalentRecord,
      "id" | "linkedEmploymentProfileId" | "talentOrigin"
    >
  >,
): TrackedTalentRepository {
  const lookupEmploymentProfileIds: string[] = [];

  return {
    lookupEmploymentProfileIds,
    async findNonArchivedByLinkedEmploymentProfileId(
      linkedEmploymentProfileId: string,
    ): Promise<TalentRecord | null> {
      lookupEmploymentProfileIds.push(linkedEmploymentProfileId);
      return (
        (records.find(
          (record) =>
            record.linkedEmploymentProfileId === linkedEmploymentProfileId,
        ) as TalentRecord | undefined) ?? null
      );
    },
  } as TrackedTalentRepository;
}

class InMemorySelfServiceTalentGroupsReadRepository
  implements SelfServiceTalentGroupsReadRepository
{
  readonly membershipTalentIds: string[] = [];
  readonly groupIdBatches: string[][] = [];
  readonly managerInputs: Array<{
    readonly groupIds: readonly string[];
    readonly asOf: number;
  }> = [];
  readonly memberGroupIdBatches: string[][] = [];

  async listActiveMembershipsByTalent(
    talentId: string,
  ): Promise<readonly SelfServiceTalentGroupMembershipReadModel[]> {
    this.membershipTalentIds.push(talentId);

    return talentId === "talent-staff"
      ? [
          {
            groupId: "group-beta",
            lineupOrder: 2,
            joinedAt: 20,
          },
          {
            groupId: "group-alpha",
            lineupOrder: 1,
            joinedAt: 10,
          },
        ]
      : [];
  }

  async listActiveGroupsByIds(
    groupIds: readonly string[],
  ): Promise<readonly SelfServiceTalentGroupReadModel[]> {
    this.groupIdBatches.push([...groupIds]);

    return [
      {
        id: "group-beta",
        talentGroupCode: "TG-BETA",
        name: "Beta Team",
        status: "ACTIVE",
        displayOrder: 2,
      },
      {
        id: "group-alpha",
        talentGroupCode: "TG-ALPHA",
        name: "Alpha Team",
        status: "ACTIVE",
        displayOrder: 1,
      },
    ];
  }

  async listActiveCurrentManagersByGroupIds(
    groupIds: readonly string[],
    asOf: number,
  ): Promise<readonly SelfServiceTalentGroupManagerReadModel[]> {
    this.managerInputs.push({
      groupIds: [...groupIds],
      asOf,
    });

    return [
      {
        groupId: "group-alpha",
        displayName: "Backup Manager",
        isPrimary: false,
      },
      {
        groupId: "group-alpha",
        displayName: "Primary Manager",
        employeeCode: "EP-MGR-001",
        isPrimary: true,
      },
    ];
  }

  async listActiveMembersByGroupIds(
    groupIds: readonly string[],
  ): Promise<readonly SelfServiceTalentGroupMemberReadModel[]> {
    this.memberGroupIdBatches.push([...groupIds]);

    return [
      {
        groupId: "group-alpha",
        talentCode: "TAL-GUEST",
        displayName: "Guest Display",
        performanceAlias: "Guest Alias",
        origin: "EXTERNAL",
        lineupOrder: 2,
      },
      {
        groupId: "group-alpha",
        talentCode: "TAL-STAFF",
        displayName: "Staff Display",
        performanceAlias: "Staff Alias",
        origin: "INTERNAL",
        lineupOrder: 1,
      },
    ];
  }
}
