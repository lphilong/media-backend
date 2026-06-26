import assert from "node:assert/strict";
import test from "node:test";
import { Actor } from "@core/actor/actor";
import { Permission } from "./permission.enum";
import { PermissionGuard } from "./permission.guard";
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
