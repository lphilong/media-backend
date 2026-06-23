import assert from "node:assert/strict";
import { test } from "node:test";
import type { Request } from "express";
import { bindCommand } from "@app/base/command.middleware";
import { Actor, ActorType } from "@core/actor/actor";
import { SystemInvariantError } from "@core/error/system-error";
import { Permission } from "@core/permission/permission.enum";
import { bindTraceId } from "@core/trace/trace.context";
import { UserAdminController } from "@modules/user/admin/admin.user.controller";
import { UserQueryAdminController } from "@modules/user/admin/admin.user.query.controller";
import { UserAdminQueryService } from "@modules/user/admin/admin.user.query-service";
import { userAdminRoutes } from "@modules/user/admin/admin.user.routes";
import { UserLifecycleService } from "@modules/user/admin/admin.user.service";
import { UserValidationError } from "@modules/user/domain/user.errors";
import { AdminRoleController } from "@modules/role/admin/admin.role.controller";
import { AdminRoleQueryController } from "@modules/role/admin/admin.role.query.controller";
import { RoleAdminQueryService } from "@modules/role/admin/admin.role.query-service";
import { adminRoleRoutes } from "@modules/role/admin/admin.role.routes";
import { RoleAdminService } from "@modules/role/admin/admin.role.service";
import { RoleValidationError } from "@modules/role/domain/role.errors";

const BRIDGE_REACHED = new Error("mutation bridge reached");

const noopLogger = {
  info(): void {},
  warn(): void {},
};

const noopActorSnapshotInvalidator = {
  async invalidateAll(): Promise<void> {},
};

class UserMutationControllerHarness extends UserAdminController {
  async invoke(req: Request, actor: Actor): Promise<unknown> {
    return this.handle(req, actor, "ADMIN");
  }
}

class UserQueryControllerHarness extends UserQueryAdminController {
  async invoke(req: Request, actor: Actor): Promise<unknown> {
    return this.handle(req, actor, "ADMIN");
  }
}

class RoleMutationControllerHarness extends AdminRoleController {
  async invoke(req: Request, actor: Actor): Promise<unknown> {
    return this.handle(req, actor, "ADMIN");
  }
}

class RoleQueryControllerHarness extends AdminRoleQueryController {
  async invoke(req: Request, actor: Actor): Promise<unknown> {
    return this.handle(req, actor, "ADMIN");
  }
}

function createActor(
  type: ActorType,
  permissions: readonly string[],
): Actor {
  return new Actor({
    id: `${type}-user-1`,
    type,
    context: "ADMIN",
    roles: [],
    permissions,
    isActive: true,
  });
}

function createRequest(params: {
  readonly command: string;
  readonly params?: Record<string, string>;
  readonly query?: Record<string, unknown>;
  readonly body?: unknown;
}): Request {
  const req = {
    params: params.params ?? {},
    query: params.query ?? {},
    body: params.body,
  } as unknown as Request;

  bindCommand(req, params.command);
  return req;
}

function createBridgeProbe(): {
  readonly bridge: { execute(): Promise<never> };
  readonly getCallCount: () => number;
} {
  let callCount = 0;

  return {
    bridge: {
      async execute(): Promise<never> {
        callCount += 1;
        throw BRIDGE_REACHED;
      },
    },
    getCallCount: () => callCount,
  };
}

async function assertStaffActorDenied(
  promise: Promise<unknown>,
): Promise<void> {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof SystemInvariantError);
    assert.equal(error.code, "PERMISSION_DENIED");
    assert.match(error.message, /actor\.type admin/i);
    return true;
  });
}

async function assertUserValidationRejected(
  promise: Promise<unknown>,
): Promise<void> {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof UserValidationError);
    assert.match(
      (error as Error).message,
      /unsupported field|plain object|cannot include/i,
    );
    return true;
  });
}

async function assertRoleValidationRejected(
  promise: Promise<unknown>,
): Promise<void> {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof RoleValidationError);
    assert.match(
      (error as Error).message,
      /unsupported field|plain object|must include|must be an array/i,
    );
    return true;
  });
}

function listRouteInventory(router: unknown): string[] {
  const layers = (
    router as {
      stack?: Array<{
        route?: {
          path: string;
          methods: Record<string, boolean>;
        };
      }>;
    }
  ).stack ?? [];

  return layers
    .flatMap((layer) => {
      if (!layer.route) {
        return [];
      }

      return Object.entries(layer.route.methods)
        .filter(([, enabled]) => enabled)
        .map(
          ([method]) =>
            `${method.toUpperCase()} ${layer.route?.path}`,
        );
    })
    .sort();
}

function createUserMutationService(
  bridge: { execute(): Promise<never> },
): UserLifecycleService {
  return new UserLifecycleService(
    {} as never,
    {} as never,
    {} as never,
    bridge as never,
    noopActorSnapshotInvalidator as never,
    {} as never,
    {} as never,
    noopLogger as never,
  );
}

function createRoleMutationService(
  bridge: { execute(): Promise<never> },
): RoleAdminService {
  return new RoleAdminService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    bridge as never,
    noopActorSnapshotInvalidator as never,
    noopLogger as never,
  );
}

test(
  "R/U-4 User admin actor boundary rejects staff and allows admin permission checks to proceed",
  async () => {
    let listCallCount = 0;
    let detailCallCount = 0;
    const queryService = new UserAdminQueryService({
      listUsers: async () => {
        listCallCount += 1;
        return { items: [] };
      },
      getUserDetail: async () => {
        detailCallCount += 1;
        return {
          id: "user-1",
        };
      },
    } as never);

    const staffReader = createActor("staff", [
      Permission.USER_VIEW,
    ]);
    const adminReader = createActor("admin", [
      Permission.USER_VIEW,
    ]);

    await assertStaffActorDenied(
      queryService.listUsers(staffReader, {}),
    );
    await assertStaffActorDenied(
      queryService.getUserDetail(staffReader, {
        userId: "user-1",
      }),
    );
    assert.equal(listCallCount, 0);
    assert.equal(detailCallCount, 0);

    assert.deepEqual(
      await queryService.listUsers(adminReader, {}),
      { items: [] },
    );
    assert.equal(listCallCount, 1);

    const bridgeProbe = createBridgeProbe();
    const mutationService = createUserMutationService(
      bridgeProbe.bridge,
    );
    const staffMutator = createActor("staff", [
      Permission.USER_CREATE,
    ]);
    const adminMutator = createActor("admin", [
      Permission.USER_CREATE,
    ]);
    const command = {
      displayName: "RU4 User",
    };

    await assertStaffActorDenied(
      mutationService.createUser(staffMutator, command),
    );
    assert.equal(bridgeProbe.getCallCount(), 0);

    await bindTraceId("trace-ru4-user-admin", async () => {
      await assert.rejects(
        mutationService.createUser(adminMutator, command),
        BRIDGE_REACHED,
      );
    });
    assert.equal(bridgeProbe.getCallCount(), 1);
  },
);

test(
  "R/U-4 Role admin actor boundary rejects staff and allows admin permission checks to proceed",
  async () => {
    let listCallCount = 0;
    let detailCallCount = 0;
    const queryService = new RoleAdminQueryService(
      {
        listRoles: async () => {
          listCallCount += 1;
          return { items: [] };
        },
        getRoleDetail: async () => {
          detailCallCount += 1;
          return {
            id: "role-1",
          };
        },
        getRolePermissionMatrix: async () => ({
          roleId: "role-1",
        }),
      } as never,
      {
        listRoleAssignments: async () => ({ items: [] }),
      } as never,
    );

    await assertStaffActorDenied(
      queryService.listRoles(
        createActor("staff", [Permission.ROLE_LIST]),
        {},
      ),
    );
    await assertStaffActorDenied(
      queryService.getRoleDetail(
        createActor("staff", [Permission.ROLE_VIEW]),
        { roleId: "role-1" },
      ),
    );
    assert.equal(listCallCount, 0);
    assert.equal(detailCallCount, 0);

    assert.deepEqual(
      await queryService.listRoles(
        createActor("admin", [Permission.ROLE_LIST]),
        {},
      ),
      { items: [] },
    );
    assert.equal(listCallCount, 1);

    const bridgeProbe = createBridgeProbe();
    const mutationService = createRoleMutationService(
      bridgeProbe.bridge,
    );
    const command = {
      name: "RU4 Role",
      code: "RU4_ROLE",
    };

    await bindTraceId("trace-ru4-role-staff", async () => {
      await assertStaffActorDenied(
        mutationService.createRole(
          createActor("staff", [Permission.ROLE_CREATE]),
          command,
        ),
      );
    });
    assert.equal(bridgeProbe.getCallCount(), 0);

    await bindTraceId("trace-ru4-role-admin", async () => {
      await assert.rejects(
        mutationService.createRole(
          createActor("admin", [Permission.ROLE_CREATE]),
          command,
        ),
        BRIDGE_REACHED,
      );
    });
    assert.equal(bridgeProbe.getCallCount(), 1);
  },
);

test(
  "R/U-4 User request shape hardening rejects unsupported query and body keys",
  async (t) => {
    const actor = createActor("admin", [
      Permission.USER_VIEW,
      Permission.USER_CREATE,
      Permission.USER_EDIT,
      Permission.USER_ACTIVATE,
      Permission.USER_DISABLE,
      Permission.USER_ARCHIVE,
      Permission.USER_AUTH_LINKAGE_SET,
      Permission.USER_ACTOR_KIND_UPDATE,
    ]);

    await t.test("list/detail query keys", async () => {
      let serviceReached = false;
      const controller = new UserQueryControllerHarness({
        listUsers: async () => {
          serviceReached = true;
          return { items: [] };
        },
        getUserDetail: async () => {
          serviceReached = true;
          return { id: "user-1" };
        },
      } as never);

      await assertUserValidationRejected(
        controller.invoke(
          createRequest({
            command: "USER_LIST",
            query: { state: "ACTIVE", scope: "global" },
          }),
          actor,
        ),
      );
      await assertUserValidationRejected(
        controller.invoke(
          createRequest({
            command: "USER_GET_DETAIL",
            params: { userId: "user-1" },
            query: { include: "roles" },
          }),
          actor,
        ),
      );
      assert.equal(serviceReached, false);
    });

    await t.test("create/update/auth-linkage body keys", async () => {
      let serviceReached = false;
      const controller = new UserMutationControllerHarness({
        createUser: async () => {
          serviceReached = true;
          return {};
        },
        updateUser: async () => {
          serviceReached = true;
          return {};
        },
        setAuthLinkage: async () => {
          serviceReached = true;
          return {};
        },
      } as never);

      await assertUserValidationRejected(
        controller.invoke(
          createRequest({
            command: "USER_CREATE",
            body: {
              authSubject: "auth0|user",
              displayName: "User",
              scopeGrants: {},
            },
          }),
          actor,
        ),
      );
      await assertUserValidationRejected(
        controller.invoke(
          createRequest({
            command: "USER_UPDATE",
            params: { userId: "user-1" },
            body: { displayName: "User", actorKind: "ADMIN" },
          }),
          actor,
        ),
      );
      await assertUserValidationRejected(
        controller.invoke(
          createRequest({
            command: "USER_AUTH_LINKAGE_SET",
            params: { userId: "user-1" },
            body: {
              provider: "auth0",
              subject: "auth0|new",
              token: "secret",
            },
          }),
          actor,
        ),
      );
      assert.equal(serviceReached, false);
    });

    await t.test("zero-body lifecycle actions", async () => {
      let serviceReached = false;
      const controller = new UserMutationControllerHarness({
        activateUser: async () => {
          serviceReached = true;
          return {};
        },
        disableUser: async () => {
          serviceReached = true;
          return {};
        },
        archiveUser: async () => {
          serviceReached = true;
          return {};
        },
      } as never);

      for (const command of [
        "USER_ACTIVATE",
        "USER_DISABLE",
        "USER_ARCHIVE",
      ]) {
        await assertUserValidationRejected(
          controller.invoke(
            createRequest({
              command,
              params: { userId: "user-1" },
              body: { reason: "not supported" },
            }),
            actor,
          ),
        );
      }

      await assertUserValidationRejected(
        controller.invoke(
          createRequest({
            command: "USER_ACTIVATE",
            params: { userId: "user-1" },
            body: [],
          }),
          actor,
        ),
      );
      assert.equal(serviceReached, false);
    });
  },
);

test(
  "R/U-4 Role request shape hardening rejects unsupported query and body keys",
  async (t) => {
    const actor = createActor("admin", [
      Permission.ROLE_LIST,
      Permission.ROLE_VIEW,
      Permission.ROLE_CREATE,
      Permission.ROLE_UPDATE,
      Permission.ROLE_ACTIVATE,
      Permission.ROLE_DEACTIVATE,
      Permission.ROLE_ARCHIVE,
      Permission.ROLE_PERMISSION_ASSIGN,
      Permission.ROLE_ASSIGNMENT_RULE_SET,
      Permission.ROLE_ASSIGN_TO_USER,
      Permission.ROLE_REVOKE_FROM_USER,
      Permission.ROLE_ASSIGNMENT_VIEW,
    ]);

    await t.test("list/detail/assignment query keys", async () => {
      let serviceReached = false;
      const controller = new RoleQueryControllerHarness({
        listRoles: async () => {
          serviceReached = true;
          return { items: [] };
        },
        getRoleDetail: async () => {
          serviceReached = true;
          return { id: "role-1" };
        },
        listRoleAssignments: async () => {
          serviceReached = true;
          return { items: [] };
        },
        getRolePermissionMatrix: async () => {
          serviceReached = true;
          return { roleId: "role-1" };
        },
      } as never);

      await assertRoleValidationRejected(
        controller.invoke(
          createRequest({
            command: "ROLE_LIST",
            query: { state: "ACTIVE", scope: "global" },
          }),
          actor,
        ),
      );
      await assertRoleValidationRejected(
        controller.invoke(
          createRequest({
            command: "ROLE_GET_DETAIL",
            params: { roleId: "role-1" },
            query: { include: "assignments" },
          }),
          actor,
        ),
      );
      await assertRoleValidationRejected(
        controller.invoke(
          createRequest({
            command: "ROLE_ASSIGNMENT_LIST",
            params: { roleId: "role-1" },
            query: { userId: "user-1" },
          }),
          actor,
        ),
      );
      await assertRoleValidationRejected(
        controller.invoke(
          createRequest({
            command: "ROLE_PERMISSION_MATRIX",
            params: { roleId: "role-1" },
            query: { scopeGrants: "true" },
          }),
          actor,
        ),
      );
      assert.equal(serviceReached, false);
    });

    await t.test("mutation body keys", async () => {
      let serviceReached = false;
      const controller = new RoleMutationControllerHarness({
        createRole: async () => {
          serviceReached = true;
          return {};
        },
        updateRole: async () => {
          serviceReached = true;
          return {};
        },
        setRolePermissions: async () => {
          serviceReached = true;
          return {};
        },
        setRoleAssignmentRules: async () => {
          serviceReached = true;
          return {};
        },
        assignRoleToUser: async () => {
          serviceReached = true;
          return {};
        },
        revokeRoleFromUser: async () => {
          serviceReached = true;
          return {};
        },
      } as never);

      await assertRoleValidationRejected(
        controller.invoke(
          createRequest({
            command: "ROLE_CREATE",
            body: {
              name: "Role",
              code: "ROLE",
              scopeGrants: {},
            },
          }),
          actor,
        ),
      );
      await assertRoleValidationRejected(
        controller.invoke(
          createRequest({
            command: "ROLE_UPDATE",
            params: { roleId: "role-1" },
            body: { name: "Role", code: "NEW" },
          }),
          actor,
        ),
      );
      await assertRoleValidationRejected(
        controller.invoke(
          createRequest({
            command: "ROLE_PERMISSION_ASSIGN",
            params: { roleId: "role-1" },
            body: {
              permissions: [Permission.USER_VIEW],
              scopeGrants: {},
            },
          }),
          actor,
        ),
      );
      await assertRoleValidationRejected(
        controller.invoke(
          createRequest({
            command: "ROLE_ASSIGNMENT_RULE_SET",
            params: { roleId: "role-1" },
            body: { rules: [], extra: true },
          }),
          actor,
        ),
      );
      await assertRoleValidationRejected(
        controller.invoke(
          createRequest({
            command: "ROLE_ASSIGNMENT_RULE_SET",
            params: { roleId: "role-1" },
            body: {
              rules: [
                {
                  code: "RULE",
                  approvalWorkflowId: "approval-1",
                },
              ],
            },
          }),
          actor,
        ),
      );
      await assertRoleValidationRejected(
        controller.invoke(
          createRequest({
            command: "ROLE_ASSIGN_TO_USER",
            params: { roleId: "role-1" },
            body: {
              userId: "user-2",
              extra: true,
            },
          }),
          actor,
        ),
      );
      await assertRoleValidationRejected(
        controller.invoke(
          createRequest({
            command: "ROLE_REVOKE_FROM_USER",
            params: {
              roleId: "role-1",
              assignmentId: "assignment-1",
            },
            body: { reason: "done", userId: "user-2" },
          }),
          actor,
        ),
      );
      assert.equal(serviceReached, false);
    });

    await t.test(
      "permission replacement body contracts",
      async () => {
        let serviceReached = false;
        let capturedCommand:
          | {
              permissions: readonly string[];
            }
          | undefined;
        const controller =
          new RoleMutationControllerHarness({
            setRolePermissions: async (
              _actor: Actor,
              command: {
                permissions: readonly string[];
              },
            ) => {
              serviceReached = true;
              capturedCommand = command;
              return { ok: true };
            },
          } as never);

        for (const body of [
          undefined,
          null,
          [],
          "x",
        ]) {
          await assertRoleValidationRejected(
            controller.invoke(
              createRequest({
                command: "ROLE_PERMISSION_ASSIGN",
                params: { roleId: "role-1" },
                body,
              }),
              actor,
            ),
          );
        }

        await assertRoleValidationRejected(
          controller.invoke(
            createRequest({
              command: "ROLE_PERMISSION_ASSIGN",
              params: { roleId: "role-1" },
              body: {},
            }),
            actor,
          ),
        );
        await assertRoleValidationRejected(
          controller.invoke(
            createRequest({
              command: "ROLE_PERMISSION_ASSIGN",
              params: { roleId: "role-1" },
              body: { permissions: null },
            }),
            actor,
          ),
        );
        await assertRoleValidationRejected(
          controller.invoke(
            createRequest({
              command: "ROLE_PERMISSION_ASSIGN",
              params: { roleId: "role-1" },
              body: { permissions: "x" },
            }),
            actor,
          ),
        );
        await assertRoleValidationRejected(
          controller.invoke(
            createRequest({
              command: "ROLE_PERMISSION_ASSIGN",
              params: { roleId: "role-1" },
              body: {
                permissions: [],
                extra: true,
              },
            }),
            actor,
          ),
        );

        assert.deepEqual(
          await controller.invoke(
            createRequest({
              command: "ROLE_PERMISSION_ASSIGN",
              params: { roleId: "role-1" },
              body: { permissions: [] },
            }),
            actor,
          ),
          { ok: true },
        );
        assert.equal(serviceReached, true);
        assert.deepEqual(
          capturedCommand?.permissions,
          [],
        );
      },
    );

    await t.test(
      "assignment-rule replacement body contracts",
      async () => {
        let serviceReached = false;
        let capturedCommand:
          | {
              rules: readonly unknown[];
            }
          | undefined;
        const controller =
          new RoleMutationControllerHarness({
            setRoleAssignmentRules: async (
              _actor: Actor,
              command: {
                rules: readonly unknown[];
              },
            ) => {
              serviceReached = true;
              capturedCommand = command;
              return { ok: true };
            },
          } as never);

        for (const body of [
          undefined,
          null,
          [],
          "x",
        ]) {
          await assertRoleValidationRejected(
            controller.invoke(
              createRequest({
                command: "ROLE_ASSIGNMENT_RULE_SET",
                params: { roleId: "role-1" },
                body,
              }),
              actor,
            ),
          );
        }

        await assertRoleValidationRejected(
          controller.invoke(
            createRequest({
              command: "ROLE_ASSIGNMENT_RULE_SET",
              params: { roleId: "role-1" },
              body: {},
            }),
            actor,
          ),
        );
        await assertRoleValidationRejected(
          controller.invoke(
            createRequest({
              command: "ROLE_ASSIGNMENT_RULE_SET",
              params: { roleId: "role-1" },
              body: { rules: null },
            }),
            actor,
          ),
        );
        await assertRoleValidationRejected(
          controller.invoke(
            createRequest({
              command: "ROLE_ASSIGNMENT_RULE_SET",
              params: { roleId: "role-1" },
              body: { rules: "x" },
            }),
            actor,
          ),
        );
        await assertRoleValidationRejected(
          controller.invoke(
            createRequest({
              command: "ROLE_ASSIGNMENT_RULE_SET",
              params: { roleId: "role-1" },
              body: {
                rules: [],
                extra: true,
              },
            }),
            actor,
          ),
        );
        await assertRoleValidationRejected(
          controller.invoke(
            createRequest({
              command: "ROLE_ASSIGNMENT_RULE_SET",
              params: { roleId: "role-1" },
              body: {
                rules: [
                  {
                    code: "RULE",
                    approvalWorkflowId:
                      "approval-1",
                  },
                ],
              },
            }),
            actor,
          ),
        );

        assert.deepEqual(
          await controller.invoke(
            createRequest({
              command: "ROLE_ASSIGNMENT_RULE_SET",
              params: { roleId: "role-1" },
              body: { rules: [] },
            }),
            actor,
          ),
          { ok: true },
        );
        assert.equal(serviceReached, true);
        assert.deepEqual(capturedCommand?.rules, []);
      },
    );

    await t.test("lifecycle body contracts", async () => {
      let capturedDeactivate:
        | { reason?: string | null }
        | undefined;
      let capturedArchive:
        | { reason?: string | null }
        | undefined;
      const controller = new RoleMutationControllerHarness({
        activateRole: async () => ({}),
        deactivateRole: async (
          _actor: Actor,
          command: { reason?: string | null },
        ) => {
          capturedDeactivate = command;
          return {};
        },
        archiveRole: async (
          _actor: Actor,
          command: { reason?: string | null },
        ) => {
          capturedArchive = command;
          return {};
        },
      } as never);

      await assertRoleValidationRejected(
        controller.invoke(
          createRequest({
            command: "ROLE_ACTIVATE",
            params: { roleId: "role-1" },
            body: { reason: "not supported" },
          }),
          actor,
        ),
      );
      await assertRoleValidationRejected(
        controller.invoke(
          createRequest({
            command: "ROLE_DEACTIVATE",
            params: { roleId: "role-1" },
            body: { reason: "ok", extra: true },
          }),
          actor,
        ),
      );
      await assertRoleValidationRejected(
        controller.invoke(
          createRequest({
            command: "ROLE_ARCHIVE",
            params: { roleId: "role-1" },
            body: null,
          }),
          actor,
        ),
      );

      assert.deepEqual(
        await controller.invoke(
          createRequest({
            command: "ROLE_DEACTIVATE",
            params: { roleId: "role-1" },
            body: { reason: "maintenance" },
          }),
          actor,
        ),
        {},
      );
      assert.equal(capturedDeactivate?.reason, "maintenance");

      assert.deepEqual(
        await controller.invoke(
          createRequest({
            command: "ROLE_ARCHIVE",
            params: { roleId: "role-1" },
            body: {},
          }),
          actor,
        ),
        {},
      );
      assert.equal(capturedArchive?.reason, null);
    });

    await t.test(
      "revoke-assignment body contracts",
      async () => {
        let serviceReached = false;
        let capturedCommand:
          | {
              reason?: string | null;
            }
          | undefined;
        const controller =
          new RoleMutationControllerHarness({
            revokeRoleFromUser: async (
              _actor: Actor,
              command: {
                reason?: string | null;
              },
            ) => {
              serviceReached = true;
              capturedCommand = command;
              return { ok: true };
            },
          } as never);

        await assertRoleValidationRejected(
          controller.invoke(
            createRequest({
              command: "ROLE_REVOKE_FROM_USER",
              params: {
                roleId: "role-1",
                assignmentId: "assignment-1",
              },
              body: null,
            }),
            actor,
          ),
        );
        await assertRoleValidationRejected(
          controller.invoke(
            createRequest({
              command: "ROLE_REVOKE_FROM_USER",
              params: {
                roleId: "role-1",
                assignmentId: "assignment-1",
              },
              body: [],
            }),
            actor,
          ),
        );

        for (const body of [
          "x",
          42,
          false,
        ]) {
          await assertRoleValidationRejected(
            controller.invoke(
              createRequest({
                command: "ROLE_REVOKE_FROM_USER",
                params: {
                  roleId: "role-1",
                  assignmentId: "assignment-1",
                },
                body,
              }),
              actor,
            ),
          );
        }

        await assertRoleValidationRejected(
          controller.invoke(
            createRequest({
              command: "ROLE_REVOKE_FROM_USER",
              params: {
                roleId: "role-1",
                assignmentId: "assignment-1",
              },
              body: {
                reason: "valid reason",
                extra: true,
              },
            }),
            actor,
          ),
        );
        assert.equal(serviceReached, false);

        assert.deepEqual(
          await controller.invoke(
            createRequest({
              command: "ROLE_REVOKE_FROM_USER",
              params: {
                roleId: "role-1",
                assignmentId: "assignment-1",
              },
            }),
            actor,
          ),
          { ok: true },
        );
        assert.equal(serviceReached, true);
        assert.equal(capturedCommand?.reason, null);

        assert.deepEqual(
          await controller.invoke(
            createRequest({
              command: "ROLE_REVOKE_FROM_USER",
              params: {
                roleId: "role-1",
                assignmentId: "assignment-1",
              },
              body: {},
            }),
            actor,
          ),
          { ok: true },
        );
        assert.equal(capturedCommand?.reason, null);

        assert.deepEqual(
          await controller.invoke(
            createRequest({
              command: "ROLE_REVOKE_FROM_USER",
              params: {
                roleId: "role-1",
                assignmentId: "assignment-1",
              },
              body: { reason: "valid reason" },
            }),
            actor,
          ),
          { ok: true },
        );
        assert.equal(
          capturedCommand?.reason,
          "valid reason",
        );

        assert.deepEqual(
          await controller.invoke(
            createRequest({
              command: "ROLE_REVOKE_FROM_USER",
              params: {
                roleId: "role-1",
                assignmentId: "assignment-1",
              },
              body: { reason: null },
            }),
            actor,
          ),
          { ok: true },
        );
        assert.equal(capturedCommand?.reason, null);
      },
    );
  },
);

test(
  "R/U-4 User and Role route inventories stay bounded to current admin surfaces",
  () => {
    const noopExecute = async (): Promise<void> => {};

    const userRoutes = listRouteInventory(
      userAdminRoutes(
        {
          execute: noopExecute,
        } as never,
        {
          execute: noopExecute,
        } as never,
      ),
    );
    const roleRoutes = listRouteInventory(
      adminRoleRoutes(
        {
          execute: noopExecute,
        } as never,
        {
          execute: noopExecute,
        } as never,
      ),
    );

    assert.deepEqual(userRoutes, [
      "DELETE /:userId/auth-linkage",
      "GET /",
      "GET /:userId",
      "PATCH /:userId",
      "PATCH /:userId/actor-kind",
      "POST /",
      "POST /:userId/activate",
      "POST /:userId/archive",
      "POST /:userId/disable",
      "POST /:userId/send-password-setup",
      "POST /provision",
      "PUT /:userId/auth-linkage",
    ]);
    assert.deepEqual(roleRoutes, [
      "GET /",
      "GET /:roleId",
      "GET /:roleId/assignments",
      "GET /:roleId/permission-matrix",
      "PATCH /:roleId",
      "POST /",
      "POST /:roleId/activate",
      "POST /:roleId/archive",
      "POST /:roleId/assignments",
      "POST /:roleId/assignments/:assignmentId/revoke",
      "POST /:roleId/deactivate",
      "POST /from-template",
      "PUT /:roleId/assignment-rules",
      "PUT /:roleId/permissions",
    ]);

    for (const route of userRoutes) {
      assert.doesNotMatch(
        route,
        /scope-grant|scopeGrants/i,
      );
      assert.doesNotMatch(
        route,
        /roles|org-unit|employment|talent|platform|studio|work|event|contract|commission|revenue|dashboard/i,
      );
    }

    for (const route of roleRoutes) {
      assert.doesNotMatch(
        route,
        /scope-grant|scopeGrants/i,
      );
      assert.doesNotMatch(
        route,
        /org-unit|employment|talent|platform|studio|work|event|contract|commission|revenue|dashboard/i,
      );
    }
  },
);

test(
  "R/U-4 User and Role permission literals remain unchanged",
  () => {
    assert.deepEqual(
      {
        USER_VIEW: Permission.USER_VIEW,
        USER_CREATE: Permission.USER_CREATE,
        USER_EDIT: Permission.USER_EDIT,
        USER_ACTIVATE: Permission.USER_ACTIVATE,
        USER_DISABLE: Permission.USER_DISABLE,
        USER_ARCHIVE: Permission.USER_ARCHIVE,
        USER_AUTH_LINKAGE_SET:
          Permission.USER_AUTH_LINKAGE_SET,
        USER_ACTOR_KIND_UPDATE:
          Permission.USER_ACTOR_KIND_UPDATE,
      },
      {
        USER_VIEW: "user:view",
        USER_CREATE: "user:create",
        USER_EDIT: "user:edit",
        USER_ACTIVATE: "user:activate",
        USER_DISABLE: "user:disable",
        USER_ARCHIVE: "user:archive",
        USER_AUTH_LINKAGE_SET: "user:auth_linkage:set",
        USER_ACTOR_KIND_UPDATE: "user:actor_kind:update",
      },
    );

    assert.deepEqual(
      {
        ROLE_LIST: Permission.ROLE_LIST,
        ROLE_VIEW: Permission.ROLE_VIEW,
        ROLE_CREATE: Permission.ROLE_CREATE,
        ROLE_UPDATE: Permission.ROLE_UPDATE,
        ROLE_ACTIVATE: Permission.ROLE_ACTIVATE,
        ROLE_DEACTIVATE: Permission.ROLE_DEACTIVATE,
        ROLE_ARCHIVE: Permission.ROLE_ARCHIVE,
        ROLE_PERMISSION_ASSIGN:
          Permission.ROLE_PERMISSION_ASSIGN,
        ROLE_ASSIGNMENT_RULE_SET:
          Permission.ROLE_ASSIGNMENT_RULE_SET,
        ROLE_ASSIGN_TO_USER: Permission.ROLE_ASSIGN_TO_USER,
        ROLE_REVOKE_FROM_USER:
          Permission.ROLE_REVOKE_FROM_USER,
        ROLE_ASSIGNMENT_VIEW: Permission.ROLE_ASSIGNMENT_VIEW,
      },
      {
        ROLE_LIST: "role:list",
        ROLE_VIEW: "role:view",
        ROLE_CREATE: "role:create",
        ROLE_UPDATE: "role:update",
        ROLE_ACTIVATE: "role:activate",
        ROLE_DEACTIVATE: "role:deactivate",
        ROLE_ARCHIVE: "role:archive",
        ROLE_PERMISSION_ASSIGN: "role:permission:assign",
        ROLE_ASSIGNMENT_RULE_SET:
          "role:assignment_rule:set",
        ROLE_ASSIGN_TO_USER: "role:assign_to_user",
        ROLE_REVOKE_FROM_USER: "role:revoke_from_user",
        ROLE_ASSIGNMENT_VIEW: "role:assignment:view",
      },
    );
  },
);
