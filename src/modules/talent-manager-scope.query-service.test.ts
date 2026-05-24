import assert from "node:assert/strict";
import { test } from "node:test";
import { Actor } from "@core/actor/actor";
import { SystemInvariantError } from "@core/error/system-error";
import { Permission } from "@core/permission/permission.enum";
import { TalentAdminQueryService } from "@modules/talent/admin/admin.talent.query-service";
import { TalentGroupAdminQueryService } from "@modules/talent-group/admin/admin.talent-group.query-service";

function createActor(params: {
  readonly id?: string;
  readonly permissions: readonly Permission[];
  readonly kpiScopes?: readonly ("global" | "managedGroup" | "self")[];
}): Actor {
  return new Actor({
    id: params.id ?? "user-manager",
    type: "admin",
    context: "ADMIN",
    roles: [],
    permissions: params.permissions,
    scopeGrants: params.kpiScopes
      ? {
          kpi: params.kpiScopes,
        }
      : undefined,
    isActive: true,
  });
}

function createManagedScopeDependencies(params?: {
  readonly employmentProfileId?: string | null;
  readonly groupIds?: readonly string[];
}) {
  const employmentProfileId =
    params && "employmentProfileId" in params
      ? params.employmentProfileId
      : "ep-manager";
  const groupIds = params?.groupIds ?? ["group-managed"];

  return {
    subjectReadonlyAccess: {
      async findActiveEmploymentProfileByLinkedUserId() {
        return employmentProfileId
          ? {
              employmentProfileId,
            }
          : null;
      },
    },
    managerAssignmentRepository: {
      async listActiveAssignmentsByManagerEmploymentProfile() {
        return groupIds.map((groupId) => ({
          groupId,
        }));
      },
    },
  } as never;
}

test("TEAM_MANAGER scoped TalentGroup list uses only active managed group ids", async () => {
  let capturedGroupIds: readonly string[] | undefined;
  const service = new TalentGroupAdminQueryService(
    {
      async listTalentGroups(input: { readonly groupIds?: readonly string[] }) {
        capturedGroupIds = input.groupIds;
        return {
          items: [{ id: "group-managed" }],
        };
      },
    } as never,
    createManagedScopeDependencies(),
  );

  const result = await service.listTalentGroups(
    createActor({
      permissions: [Permission.TALENT_GROUP_READ],
      kpiScopes: ["managedGroup"],
    }),
    {},
  );

  assert.deepEqual(capturedGroupIds, ["group-managed"]);
  assert.deepEqual(result.items.map((item) => item.id), ["group-managed"]);
});

test("TEAM_MANAGER TalentGroup detail allows managed group and denies unmanaged group", async () => {
  const service = new TalentGroupAdminQueryService(
    {
      async getTalentGroupDetail(groupId: string) {
        return {
          id: groupId,
        };
      },
    } as never,
    createManagedScopeDependencies(),
  );
  const actor = createActor({
    permissions: [Permission.TALENT_GROUP_READ],
    kpiScopes: ["managedGroup"],
  });

  assert.equal(
    (await service.getTalentGroupDetail(actor, { groupId: "group-managed" })).id,
    "group-managed",
  );
  await assert.rejects(
    service.getTalentGroupDetail(actor, { groupId: "group-other" }),
    (error) => {
      assert.ok(error instanceof SystemInvariantError);
      assert.equal(error.code, "PERMISSION_DENIED");
      return true;
    },
  );
});

test("TEAM_MANAGER Talent list is constrained to active members of managed groups", async () => {
  let capturedGroupIds: readonly string[] | undefined;
  const service = new TalentAdminQueryService(
    {
      async listTalents(input: {
        readonly activeMemberOfGroupIds?: readonly string[];
      }) {
        capturedGroupIds = input.activeMemberOfGroupIds;
        return {
          items: [{ id: "talent-managed" }],
        };
      },
    } as never,
    createManagedScopeDependencies(),
  );

  const result = await service.listTalents(
    createActor({
      permissions: [Permission.TALENT_READ],
      kpiScopes: ["managedGroup"],
    }),
    {},
  );

  assert.deepEqual(capturedGroupIds, ["group-managed"]);
  assert.deepEqual(result.items.map((item) => item.id), ["talent-managed"]);
});

test("TEAM_MANAGER Talent detail allows active managed member and denies non-member", async () => {
  const service = new TalentAdminQueryService(
    {
      async hasActiveMembershipInGroups(
        talentId: string,
        groupIds: readonly string[],
      ) {
        return talentId === "talent-managed" && groupIds.includes("group-managed");
      },
      async getTalentDetail(talentId: string) {
        return {
          id: talentId,
        };
      },
    } as never,
    createManagedScopeDependencies(),
  );
  const actor = createActor({
    permissions: [Permission.TALENT_READ],
    kpiScopes: ["managedGroup"],
  });

  assert.equal(
    (await service.getTalentDetail(actor, { talentId: "talent-managed" })).id,
    "talent-managed",
  );
  await assert.rejects(
    service.getTalentDetail(actor, { talentId: "talent-other" }),
    (error) => {
      assert.ok(error instanceof SystemInvariantError);
      assert.equal(error.code, "PERMISSION_DENIED");
      return true;
    },
  );
});

test("TEAM_MANAGER with no linked EmploymentProfile gets empty lists and denied detail", async () => {
  const groupService = new TalentGroupAdminQueryService(
    {
      async listTalentGroups(input: { readonly groupIds?: readonly string[] }) {
        assert.deepEqual(input.groupIds, []);
        return { items: [] };
      },
    } as never,
    createManagedScopeDependencies({ employmentProfileId: null }),
  );
  const talentService = new TalentAdminQueryService(
    {
      async listTalents(input: {
        readonly activeMemberOfGroupIds?: readonly string[];
      }) {
        assert.deepEqual(input.activeMemberOfGroupIds, []);
        return { items: [] };
      },
      async hasActiveMembershipInGroups() {
        return false;
      },
    } as never,
    createManagedScopeDependencies({ employmentProfileId: null }),
  );
  const groupActor = createActor({
    permissions: [Permission.TALENT_GROUP_READ],
    kpiScopes: ["managedGroup"],
  });
  const talentActor = createActor({
    permissions: [Permission.TALENT_READ],
    kpiScopes: ["managedGroup"],
  });

  assert.deepEqual(await groupService.listTalentGroups(groupActor, {}), {
    items: [],
  });
  assert.deepEqual(await talentService.listTalents(talentActor, {}), {
    items: [],
  });
  await assert.rejects(
    groupService.getTalentGroupDetail(groupActor, { groupId: "group-managed" }),
    (error) => {
      assert.ok(error instanceof SystemInvariantError);
      assert.equal(error.code, "PERMISSION_DENIED");
      return true;
    },
  );
  await assert.rejects(
    talentService.getTalentDetail(talentActor, { talentId: "talent-managed" }),
    (error) => {
      assert.ok(error instanceof SystemInvariantError);
      assert.equal(error.code, "PERMISSION_DENIED");
      return true;
    },
  );
});

test("global-read actors keep broad Talent and TalentGroup list/detail behavior", async () => {
  let groupListWasScoped = false;
  let talentListWasScoped = false;
  const groupService = new TalentGroupAdminQueryService(
    {
      async listTalentGroups(input: { readonly groupIds?: readonly string[] }) {
        groupListWasScoped = input.groupIds !== undefined;
        return { items: [{ id: "group-any" }] };
      },
      async getTalentGroupDetail(groupId: string) {
        return { id: groupId };
      },
    } as never,
    createManagedScopeDependencies(),
  );
  const talentService = new TalentAdminQueryService(
    {
      async listTalents(input: {
        readonly activeMemberOfGroupIds?: readonly string[];
      }) {
        talentListWasScoped = input.activeMemberOfGroupIds !== undefined;
        return { items: [{ id: "talent-any" }] };
      },
      async getTalentDetail(talentId: string) {
        return { id: talentId };
      },
    } as never,
    createManagedScopeDependencies(),
  );
  const adminFull = createActor({
    permissions: [Permission.TALENT_GROUP_READ, Permission.TALENT_READ],
    kpiScopes: ["global"],
  });

  assert.deepEqual(await groupService.listTalentGroups(adminFull, {}), {
    items: [{ id: "group-any" }],
  });
  assert.equal(
    (await groupService.getTalentGroupDetail(adminFull, { groupId: "group-any" }))
      .id,
    "group-any",
  );
  assert.deepEqual(await talentService.listTalents(adminFull, {}), {
    items: [{ id: "talent-any" }],
  });
  assert.equal(
    (await talentService.getTalentDetail(adminFull, { talentId: "talent-any" }))
      .id,
    "talent-any",
  );
  assert.equal(groupListWasScoped, false);
  assert.equal(talentListWasScoped, false);
});
