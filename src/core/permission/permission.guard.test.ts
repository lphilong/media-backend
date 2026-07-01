import assert from "node:assert/strict";
import test from "node:test";
import { Actor } from "@core/actor/actor";
import { Permission } from "./permission.enum";
import {
  deriveActorScopeGrantsFromPermissions,
  PermissionGuard,
} from "./permission.guard";
import { PermissionResolver } from "./permission.resolver";

function actor(
  overrides: Partial<ConstructorParameters<typeof Actor>[0]> = {},
): Actor {
  return new Actor({
    id: "actor-1",
    type: "admin",
    context: "ADMIN",
    roles: [],
    permissions: [],
    scopeGrants: {},
    accountContexts: [],
    isActive: true,
    ...overrides,
  });
}

test("assertAdminActor requires ADMIN_CONSOLE account context, not actor.type", () => {
  const legacyAdminType = actor({
    type: "admin",
    accountContexts: ["STAFF_CONSOLE"],
  });

  assert.throws(
    () => PermissionGuard.assertAdminActor(legacyAdminType),
    /ADMIN_CONSOLE account context/u,
  );
});

test("assertAdminActor allows STAFF actorKind compatibility type only when ADMIN_CONSOLE is present", () => {
  const adminContextActor = actor({
    type: "staff",
    permissions: [Permission.ROLE_CREATE],
    accountContexts: ["ADMIN_CONSOLE"],
  });

  PermissionGuard.assertAdminActor(adminContextActor);
  PermissionGuard.assert(
    adminContextActor,
    PermissionResolver.resolve(Permission.ROLE_CREATE),
  );
});

test("ADMIN_CONSOLE alone does not satisfy action permission checks", () => {
  const adminContextActor = actor({
    accountContexts: ["ADMIN_CONSOLE"],
    permissions: [],
  });

  PermissionGuard.assertAdminActor(adminContextActor);
  assert.throws(
    () =>
      PermissionGuard.assert(
        adminContextActor,
        PermissionResolver.resolve(Permission.ROLE_CREATE),
      ),
    /Missing permission role:create/u,
  );
});

test("WorkSchedule permissions do not derive scope grants", () => {
  const adminContextActor = actor({
    permissions: [Permission.WORK_SCHEDULE_READ],
    accountContexts: ["ADMIN_CONSOLE"],
  });

  assert.deepEqual(
    deriveActorScopeGrantsFromPermissions(adminContextActor.permissions),
    {},
  );
  assert.deepEqual(
    PermissionGuard.resolveWorkScheduleScopeGrants(adminContextActor),
    [],
  );
  assert.equal(
    PermissionGuard.hasWorkScheduleScopeGrant(adminContextActor, "team"),
    false,
  );
});

test("WorkSchedule scope grants resolve only from declared actor scope grants", () => {
  const adminContextActor = actor({
    permissions: [Permission.WORK_SCHEDULE_READ],
    scopeGrants: { workSchedule: ["team", "self"] },
    accountContexts: ["ADMIN_CONSOLE"],
  });

  assert.deepEqual(
    PermissionGuard.resolveWorkScheduleScopeGrants(adminContextActor),
    ["self", "team"],
  );
  assert.equal(
    PermissionGuard.hasWorkScheduleScopeGrant(adminContextActor, "team"),
    true,
  );
  assert.equal(
    PermissionGuard.hasWorkScheduleScopeGrant(adminContextActor, "department"),
    false,
  );
});
