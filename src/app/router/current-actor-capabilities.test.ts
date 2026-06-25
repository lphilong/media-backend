import assert from "node:assert/strict";
import { createServer, Server } from "node:http";
import { AddressInfo } from "node:net";
import { test } from "node:test";
import express, { Router } from "express";
import { createHttpErrorMiddleware } from "@app/http/http-error.middleware";
import {
  Auth0ActorResolver,
  createLocalMockAuthConfig,
  LOCAL_MOCK_AUTH_BEARER_TOKEN,
} from "@app/auth";
import { withCommand } from "@app/base/command.middleware";
import { createSecureRouter } from "@app/router/secure-router";
import { CurrentActorCapabilitiesController } from "./current-actor-capabilities.controller";
import { Actor } from "@core/actor/actor";
import {
  bindActor,
  getActor,
} from "@core/actor/actor-context";
import { contextMiddleware } from "@core/context/context.middleware.adapter";
import { Permission } from "@core/permission/permission.enum";
import { PermissionGuard } from "@core/permission/permission.guard";
import { PermissionResolver } from "@core/permission/permission.resolver";
import { isRoleAssignmentCurrentlyEffective } from "@modules/role/domain/role-assignment-lifecycle";

const AUTH0_OPTIONS = {
  issuerBaseURL: "https://auth.example.test/",
  audience: "media-admin-api",
};

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

function createRejectingActorResolver(
  calls: { count: number },
): Auth0ActorResolver {
  return {
    async resolve() {
      calls.count += 1;
      throw new Error("Auth0 actor resolver should not run");
    },
  } as unknown as Auth0ActorResolver;
}

function createCapabilitiesRoutes(): Router {
  const controller =
    new CurrentActorCapabilitiesController();
  return Router().get(
    "/me/capabilities",
    withCommand("CURRENT_ACTOR_CAPABILITIES"),
    controller.execute,
  );
}

function createLocalMockApp(options: {
  readonly resolverCalls: { count: number };
}): express.Express {
  const app = express();
  const adminRoutes = Router();

  adminRoutes.use(createCapabilitiesRoutes());
  adminRoutes.post("/roles", (req, res, next) => {
    try {
      const boundActor = getActor(req);
      PermissionGuard.assertAdminActor(boundActor);
      PermissionGuard.assert(
        boundActor,
        PermissionResolver.resolve(Permission.ROLE_CREATE),
      );
      res.json({ data: { created: true } });
    } catch (error) {
      next(error);
    }
  });

  app.use(
    "/admin",
    createSecureRouter({
      context: "ADMIN",
      auth0: AUTH0_OPTIONS,
      actorResolver: createRejectingActorResolver(
        options.resolverCalls,
      ),
      localMockAuth: createLocalMockAuthConfig({
        enabled: true,
        actorId: "local-capabilities-admin",
        email: "local-admin@example.test",
        permissions: [
          Permission.ROLE_LIST,
          Permission.ROLE_VIEW,
          Permission.ROLE_ASSIGN_TO_USER,
          Permission.REVENUE_LEDGER_UPDATE,
        ],
        scopeGrants: {
          workSchedule: ["self", "team"],
          eventAssignment: ["managedGroup"],
          kpi: ["global", "managedGroup", "self"],
          revenueLedger: ["global"],
          dashboardLite: ["global"],
        },
        accountContexts: ["ADMIN_CONSOLE"],
      }),
    }),
    adminRoutes,
  );

  app.use(createHttpErrorMiddleware({ error() {} } as never));

  return app;
}

test("GET /admin/me/capabilities returns the current materialized admin actor snapshot", async () => {
  const resolverCalls = { count: 0 };
  const { server, baseUrl } = await listen(
    createLocalMockApp({ resolverCalls }),
  );

  try {
    const response = await fetch(
      `${baseUrl}/admin/me/capabilities`,
      {
        headers: {
          authorization: `Bearer ${LOCAL_MOCK_AUTH_BEARER_TOKEN}`,
        },
      },
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(resolverCalls.count, 0);
    assert.equal(body.data.id, "local-capabilities-admin");
    assert.equal(body.data.type, "admin");
    assert.equal(body.data.context, "ADMIN");
    assert.equal(body.data.isActive, true);
    assert.deepEqual(body.data.roles, []);
    assert.deepEqual(body.data.permissions, [
      "role:list",
      "role:view",
      "role:assign_to_user",
      "revenueLedger.update",
    ]);
    assert.deepEqual(body.data.scopeGrants, {
      workSchedule: ["self", "team"],
      eventAssignment: ["managedGroup"],
      kpi: ["global", "managedGroup", "self"],
      revenueLedger: ["global"],
      dashboardLite: ["global"],
    });
    assert.deepEqual(body.data.accountContexts, ["ADMIN_CONSOLE"]);
    assert.equal(
      body.data.workspaceAvailability.primaryWorkspace,
      "ADMIN_CONSOLE",
    );
    assert.deepEqual(
      body.data.workspaceAvailability.availableWorkspaces
        .filter((workspace: { available: boolean }) => workspace.available)
        .map((workspace: { context: string }) => workspace.context),
      ["ADMIN_CONSOLE"],
    );
    assert.equal(typeof body.data.generatedAt, "string");
    assert.equal(Number.isNaN(Date.parse(body.data.generatedAt)), false);
  } finally {
    await close(server);
  }
});

test("GET /admin/me/capabilities exposes only currently effective role permissions from Auth0 materialization", async () => {
  const now = Date.now();
  const assignments = [
    {
      state: "ACTIVE" as const,
      effectiveAt: now - 1_000,
      expiresAt: now + 60_000,
      permission: Permission.USER_VIEW,
    },
    {
      state: "ACTIVE" as const,
      effectiveAt: now + 60_000,
      expiresAt: null,
      permission: Permission.ROLE_CREATE,
    },
    {
      state: "ACTIVE" as const,
      effectiveAt: now - 60_000,
      expiresAt: now,
      permission: Permission.ROLE_UPDATE,
    },
  ];
  const resolver = new Auth0ActorResolver(
    {
      async findByAuthSubject() {
        return [
          {
            userId: "lifecycle-admin",
            actorKind: "ADMIN" as const,
            accountStatus: "ACTIVE" as const,
            accountContexts: [],
            permissions: assignments
              .filter((assignment) =>
                isRoleAssignmentCurrentlyEffective(assignment, now),
              )
              .map((assignment) => assignment.permission),
            authorizationValidUntil: now + 60_000,
          },
        ];
      },
      async readAuthSecurityVersion() {
        return "v1";
      },
    },
    {
      async get() {
        return null;
      },
      async set() {},
      async del() {},
      async exists() {
        return false;
      },
    },
  );
  const app = express();
  app.use(
    "/admin",
    contextMiddleware("ADMIN"),
    async (req, _res, next) => {
      (
        req as unknown as {
          auth: { payload: { sub: string } };
        }
      ).auth = { payload: { sub: "auth0|lifecycle-admin" } };
      try {
        await resolver.resolve(req);
        next();
      } catch (error) {
        next(error);
      }
    },
    createCapabilitiesRoutes(),
  );
  app.use(createHttpErrorMiddleware({ error() {} } as never));
  const { server, baseUrl } = await listen(app);

  try {
    const response = await fetch(`${baseUrl}/admin/me/capabilities`, {
      headers: {
        "x-trace-id": "trace-current-capabilities-lifecycle",
      },
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body.data.permissions, [Permission.USER_VIEW]);
    assert.equal(body.data.workspaceAvailability.primaryWorkspace, null);
    assert.deepEqual(
      body.data.workspaceAvailability.availableWorkspaces
        .filter((workspace: { available: boolean }) => workspace.available)
        .map((workspace: { context: string }) => workspace.context),
      [],
    );
  } finally {
    await close(server);
  }
});

test("GET /admin/me/capabilities excludes sensitive auth transport fields", async () => {
  const resolverCalls = { count: 0 };
  const { server, baseUrl } = await listen(
    createLocalMockApp({ resolverCalls }),
  );

  try {
    const response = await fetch(
      `${baseUrl}/admin/me/capabilities`,
      {
        headers: {
          authorization: `Bearer ${LOCAL_MOCK_AUTH_BEARER_TOKEN}`,
        },
      },
    );
    const body = await response.json();
    const serialized = JSON.stringify(body);

    assert.equal(response.status, 200);
    assert.equal(serialized.includes(LOCAL_MOCK_AUTH_BEARER_TOKEN), false);
    assert.equal(serialized.includes("Bearer"), false);
    assert.equal(serialized.includes("auth0"), false);
    assert.equal(serialized.includes("provider"), false);
    assert.equal(serialized.includes("claims"), false);
  } finally {
    await close(server);
  }
});

test("GET /admin/me/capabilities does not mutate the bound actor", async () => {
  const app = express();
  const actor = new Actor({
    id: "admin-no-mutate",
    type: "admin",
    context: "ADMIN",
    roles: ["role-admin"],
    permissions: [Permission.USER_VIEW],
    scopeGrants: { commission: ["global"] },
    isActive: true,
  });

  app.use(
    "/admin",
    contextMiddleware("ADMIN"),
    (req, _res, next) => {
      bindActor(req, actor);
      next();
    },
    createCapabilitiesRoutes(),
  );
  app.use(createHttpErrorMiddleware({ error() {} } as never));

  const { server, baseUrl } = await listen(app);

  try {
    const response = await fetch(
      `${baseUrl}/admin/me/capabilities`,
    );
    await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(actor.roles, ["role-admin"]);
    assert.deepEqual(actor.permissions, ["user:view"]);
    assert.deepEqual(actor.scopeGrants, {
      commission: ["global"],
    });
  } finally {
    await close(server);
  }
});

test("GET /admin/me/capabilities follows the existing unauthenticated admin boundary", async () => {
  const app = express();
  const resolverCalls = { count: 0 };

  app.use(
    "/admin",
    createSecureRouter({
      context: "ADMIN",
      auth0: AUTH0_OPTIONS,
      actorResolver:
        createRejectingActorResolver(resolverCalls),
    }),
    createCapabilitiesRoutes(),
  );
  app.use(createHttpErrorMiddleware({ error() {} } as never));

  const { server, baseUrl } = await listen(app);

  try {
    const response = await fetch(
      `${baseUrl}/admin/me/capabilities`,
    );
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(resolverCalls.count, 0);
    assert.deepEqual(body, {
      error: {
        code: "UNAUTHORIZED",
        message: "Invalid authentication",
      },
    });
  } finally {
    await close(server);
  }
});

test("GET /admin/me/capabilities returns self snapshot for non-admin actors without granting action authority", async () => {
  const app = express();
  const staffActor = new Actor({
    id: "staff-actor",
    type: "staff",
    context: "ADMIN",
    roles: [],
    permissions: [Permission.ROLE_CREATE],
    scopeGrants: {},
    accountContexts: ["MANAGER_CONSOLE"],
    isActive: true,
  });

  app.use(
    "/admin",
    contextMiddleware("ADMIN"),
    (req, _res, next) => {
      bindActor(req, staffActor);
      next();
    },
    createCapabilitiesRoutes(),
  );
  app.use(createHttpErrorMiddleware({ error() {} } as never));

  const { server, baseUrl } = await listen(app);

  try {
    const response = await fetch(
      `${baseUrl}/admin/me/capabilities`,
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.data.type, "staff");
    assert.equal(
      body.data.workspaceAvailability.primaryWorkspace,
      "MANAGER_CONSOLE",
    );
  } finally {
    await close(server);
  }
});

test("GET /admin/me/capabilities derives workspace priority only from account contexts", async () => {
  const resolver = new Auth0ActorResolver(
    {
      async findByAuthSubject() {
        return [
          {
            userId: "multi-context-user",
            actorKind: "STAFF" as const,
            accountStatus: "ACTIVE" as const,
            accountContexts: [
              "STAFF_CONSOLE",
              "MANAGER_CONSOLE",
              "ADMIN_CONSOLE",
            ],
            permissions: [Permission.USER_VIEW],
          },
        ];
      },
      async readAuthSecurityVersion() {
        return "v1";
      },
    },
    {
      async get() {
        return null;
      },
      async set() {},
      async del() {},
      async exists() {
        return false;
      },
    },
  );
  const app = express();
  app.use(
    "/admin",
    contextMiddleware("ADMIN"),
    async (req, _res, next) => {
      (
        req as unknown as {
          auth: { payload: { sub: string } };
        }
      ).auth = { payload: { sub: "auth0|multi-context-user" } };
      try {
        await resolver.resolve(req);
        next();
      } catch (error) {
        next(error);
      }
    },
    createCapabilitiesRoutes(),
  );
  app.use(createHttpErrorMiddleware({ error() {} } as never));
  const { server, baseUrl } = await listen(app);

  try {
    const response = await fetch(`${baseUrl}/admin/me/capabilities`, {
      headers: {
        "x-trace-id": "trace-current-capabilities-workspace-priority",
      },
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.data.type, "staff");
    assert.deepEqual(body.data.accountContexts, [
      "STAFF_CONSOLE",
      "MANAGER_CONSOLE",
      "ADMIN_CONSOLE",
    ]);
    assert.equal(
      body.data.workspaceAvailability.primaryWorkspace,
      "ADMIN_CONSOLE",
    );
  } finally {
    await close(server);
  }
});

test("current capabilities endpoint does not change existing backend permission authority", async () => {
  const resolverCalls = { count: 0 };
  const { server, baseUrl } = await listen(
    createLocalMockApp({ resolverCalls }),
  );

  try {
    const capabilities = await fetch(
      `${baseUrl}/admin/me/capabilities`,
      {
        headers: {
          authorization: `Bearer ${LOCAL_MOCK_AUTH_BEARER_TOKEN}`,
        },
      },
    );
    assert.equal(capabilities.status, 200);

    const mutation = await fetch(`${baseUrl}/admin/roles`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${LOCAL_MOCK_AUTH_BEARER_TOKEN}`,
      },
    });
    const body = await mutation.json();

    assert.equal(mutation.status, 403);
    assert.deepEqual(body, {
      error: {
        code: "FORBIDDEN",
        message: "Permission denied",
      },
    });
  } finally {
    await close(server);
  }
});
