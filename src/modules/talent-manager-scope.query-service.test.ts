import assert from "node:assert/strict";
import { test } from "node:test";
import { Actor } from "@core/actor/actor";
import { SystemInvariantError } from "@core/error/system-error";
import { Permission } from "@core/permission/permission.enum";
import {
  StructuredScopeAuthorityAssignment,
  StructuredScopeAuthorityService,
} from "@modules/role/domain/structured-scope-authority";
import { RoleAssignmentScopeGrant } from "@modules/role/domain/role-assignment-scope";
import { TalentAdminQueryService } from "@modules/talent/admin/admin.talent.query-service";
import { TalentGroupAdminQueryService } from "@modules/talent-group/admin/admin.talent-group.query-service";
import { TalentGroupPermissionScopeError } from "@modules/talent-group/domain/talent-group.errors";

function createActor(permissions: readonly Permission[]): Actor {
  return new Actor({
    id: "user-manager",
    type: "admin",
    context: "ADMIN",
    accountContexts: ["ADMIN_CONSOLE"],
    roles: ["TEAM_MANAGER"],
    permissions,
    scopeGrants: {
      kpi: ["managedGroup"],
    },
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
          ? { employmentProfileId }
          : null;
      },
    },
    managedScopeReader: {
      async resolveManagedScopeByResponsibleEmploymentProfile() {
        return {
          talentGroupIds: groupIds,
          orgUnitIds: [],
          orgUnitScopes: [],
        };
      },
    },
  } as never;
}

test("TalentGroup manager list intersects structured grant with active responsibility", async () => {
  let capturedGroupIds: readonly string[] | undefined;
  const service = new TalentGroupAdminQueryService(
    {
      async listTalentGroups(input: { readonly groupIds?: readonly string[] }) {
        capturedGroupIds = input.groupIds;
        return { items: [{ id: "group-managed" }] };
      },
    } as never,
    createManagedScopeDependencies({
      groupIds: ["group-managed", "group-responsibility-only"],
    }),
    authority([
      grant(Permission.TALENT_GROUP_READ, {
        scopeType: "managedTalentGroup",
        targetId: "group-managed",
      }),
      grant(Permission.TALENT_GROUP_READ, {
        scopeType: "managedTalentGroup",
        targetId: "group-grant-only",
      }),
    ]),
  );

  const result = await service.listTalentGroups(
    createActor([Permission.TALENT_GROUP_READ]),
    {},
  );

  assert.deepEqual(capturedGroupIds, ["group-managed"]);
  assert.deepEqual(result.items.map((item) => item.id), ["group-managed"]);
});

test("TalentGroup manager detail requires both exact grant and active responsibility", async () => {
  const actor = createActor([Permission.TALENT_GROUP_READ]);
  const repository = {
    async getTalentGroupDetail(groupId: string) {
      return { id: groupId };
    },
  };
  const matching = new TalentGroupAdminQueryService(
    repository as never,
    createManagedScopeDependencies(),
    authority([
      grant(Permission.TALENT_GROUP_READ, {
        scopeType: "managedTalentGroup",
        targetId: "group-managed",
      }),
    ]),
  );

  assert.equal(
    (await matching.getTalentGroupDetail(actor, { groupId: "group-managed" })).id,
    "group-managed",
  );

  const missingResponsibility = new TalentGroupAdminQueryService(
    repository as never,
    createManagedScopeDependencies({ groupIds: [] }),
    authority([
      grant(Permission.TALENT_GROUP_READ, {
        scopeType: "managedTalentGroup",
        targetId: "group-managed",
      }),
    ]),
  );
  await assert.rejects(
    missingResponsibility.getTalentGroupDetail(actor, {
      groupId: "group-managed",
    }),
    TalentGroupPermissionScopeError,
  );

  const missingGrant = new TalentGroupAdminQueryService(
    repository as never,
    createManagedScopeDependencies(),
    authority([]),
  );
  await assert.rejects(
    missingGrant.getTalentGroupDetail(actor, { groupId: "group-managed" }),
    TalentGroupPermissionScopeError,
  );
});

test("direct Talent Admin list and detail deny scoped manager grants even for managed-group members", async () => {
  let listCalls = 0;
  let detailCalls = 0;
  const service = new TalentAdminQueryService(
    {
      async listTalents() {
        listCalls += 1;
        return { items: [{ id: "talent-managed" }] };
      },
      async hasActiveMembershipInGroups() {
        return true;
      },
      async getTalentDetail(talentId: string) {
        detailCalls += 1;
        return { id: talentId };
      },
    } as never,
    authority([
      grant(Permission.TALENT_READ, {
        scopeType: "managedTalentGroup",
        targetId: "group-managed",
      }),
    ]),
  );
  const actor = createActor([Permission.TALENT_READ]);

  await assert.rejects(
    service.listTalents(actor, {}),
    (error) => {
      assert.ok(error instanceof SystemInvariantError);
      assert.equal(error.code, "PERMISSION_DENIED");
      return true;
    },
  );
  await assert.rejects(
    service.getTalentDetail(actor, { talentId: "talent-managed" }),
    (error) => {
      assert.ok(error instanceof SystemInvariantError);
      assert.equal(error.code, "PERMISSION_DENIED");
      return true;
    },
  );
  assert.equal(listCalls, 0);
  assert.equal(detailCalls, 0);
});

test("structured-global actors retain broad Talent and TalentGroup behavior", async () => {
  let groupListWasScoped = false;
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
    createManagedScopeDependencies({ employmentProfileId: null }),
    authority([
      grant(Permission.TALENT_GROUP_READ, { scopeType: "global" }),
    ]),
  );
  const talentService = new TalentAdminQueryService(
    {
      async listTalents() {
        return { items: [{ id: "talent-any" }] };
      },
      async getTalentDetail(talentId: string) {
        return { id: talentId };
      },
    } as never,
    authority([
      grant(Permission.TALENT_READ, { scopeType: "global" }),
    ]),
  );
  const actor = createActor([
    Permission.TALENT_GROUP_READ,
    Permission.TALENT_READ,
  ]);

  assert.deepEqual(await groupService.listTalentGroups(actor, {}), {
    items: [{ id: "group-any" }],
  });
  assert.equal(
    (await groupService.getTalentGroupDetail(actor, { groupId: "group-any" }))
      .id,
    "group-any",
  );
  assert.deepEqual(await talentService.listTalents(actor, {}), {
    items: [{ id: "talent-any" }],
  });
  assert.equal(
    (await talentService.getTalentDetail(actor, { talentId: "talent-any" })).id,
    "talent-any",
  );
  assert.equal(groupListWasScoped, false);
});

function authority(
  records: readonly StructuredScopeAuthorityAssignment[],
): StructuredScopeAuthorityService {
  return new StructuredScopeAuthorityService(
    {
      async listByUserId(userId: string) {
        return userId === "user-manager" ? records : [];
      },
    },
    () => 1_000,
  );
}

function grant(
  permission: Permission,
  scope: RoleAssignmentScopeGrant,
): StructuredScopeAuthorityAssignment {
  return {
    assignment: {
      assignmentId: `${permission}:${scope.scopeType}:${scope.targetId ?? ""}`,
      roleId: `role:${permission}:${scope.scopeType}`,
      userId: "user-manager",
      structuredScopeGrants: [scope],
      state: "ACTIVE",
      effectiveAt: 0,
      expiresAt: null,
      revokedAt: null,
      reason: null,
      createdAt: 0,
      updatedAt: 0,
    },
    role: {
      id: `role:${permission}:${scope.scopeType}`,
      state: "ACTIVE",
      permissions: [permission],
    },
  };
}
