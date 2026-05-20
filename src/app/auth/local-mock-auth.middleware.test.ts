import assert from "node:assert/strict";
import { createServer, Server } from "node:http";
import { AddressInfo } from "node:net";
import { test } from "node:test";
import express, { Router } from "express";
import { createHttpErrorMiddleware } from "@app/http/http-error.middleware";
import { createSecureRouter } from "@app/router/secure-router";
import {
  Auth0ActorResolver,
  createLocalMockAuthConfig,
} from "@app/auth";
import { getActor } from "@core/actor/actor-context";
import { Permission } from "@core/permission/permission.enum";
import { PermissionGuard } from "@core/permission/permission.guard";
import { PermissionResolver } from "@core/permission/permission.resolver";

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

function createTestApp(options: {
  readonly localMockAuth?: ReturnType<
    typeof createLocalMockAuthConfig
  >;
  readonly resolverCalls: { count: number };
}): express.Express {
  const app = express();
  const adminRoutes = Router();

  adminRoutes.get("/actor", (req, res) => {
    const actor = getActor(req);

    res.json({
      actor: {
        id: actor.id,
        type: actor.type,
        context: actor.context,
        roles: actor.roles,
        permissions: actor.permissions,
        scopeGrants: actor.scopeGrants,
        isActive: actor.isActive,
      },
    });
  });

  adminRoutes.get("/roles", (req, res, next) => {
    try {
      const actor = getActor(req);
      PermissionGuard.assertAdminActor(actor);
      PermissionGuard.assert(
        actor,
        PermissionResolver.resolve(Permission.ROLE_LIST),
      );
      res.json({ data: [] });
    } catch (error) {
      next(error);
    }
  });

  adminRoutes.post("/roles", (req, res, next) => {
    try {
      const actor = getActor(req);
      PermissionGuard.assertAdminActor(actor);
      PermissionGuard.assert(
        actor,
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
      localMockAuth: options.localMockAuth,
    }),
    adminRoutes,
  );

  app.use(
    createHttpErrorMiddleware({
      error() {},
    } as never),
  );

  return app;
}

function readOnlyLocalMockConfig() {
  return createLocalMockAuthConfig({
    enabled: true,
    actorId: "local-smoke-admin",
    email: "local-admin@example.test",
    permissions: [
      Permission.ROLE_LIST,
      Permission.ROLE_VIEW,
      Permission.ROLE_ASSIGNMENT_VIEW,
    ],
    scopeGrants: {
      workSchedule: ["self", "team", "department"],
      eventAssignment: ["global"],
      dashboardLite: ["global"],
    },
  });
}

test("frontend mock bearer returns 401 when local mock auth is disabled", async () => {
  const resolverCalls = { count: 0 };
  const { server, baseUrl } = await listen(
    createTestApp({ resolverCalls }),
  );

  try {
    const response = await fetch(`${baseUrl}/admin/actor`, {
      headers: {
        authorization: "Bearer mock-access-token",
      },
    });
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(resolverCalls.count, 0);
    assert.deepEqual(body, {
      error: {
        code: "UNAUTHORIZED",
        message: "Invalid authentication",
      },
    });
    assert.equal(
      JSON.stringify(body).includes("mock-access-token"),
      false,
    );
    assert.equal(JSON.stringify(body).includes("Bearer"), false);
  } finally {
    await close(server);
  }
});

test("enabled local mock auth binds a normal configured admin actor", async () => {
  const resolverCalls = { count: 0 };
  const { server, baseUrl } = await listen(
    createTestApp({
      resolverCalls,
      localMockAuth: readOnlyLocalMockConfig(),
    }),
  );

  try {
    const response = await fetch(`${baseUrl}/admin/actor`, {
      headers: {
        authorization: "Bearer mock-access-token",
      },
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(resolverCalls.count, 0);
    assert.deepEqual(body.actor, {
      id: "local-smoke-admin",
      type: "admin",
      context: "ADMIN",
      roles: [],
      permissions: [
        "role:list",
        "role:view",
        "role:assignment:view",
      ],
      scopeGrants: {
        workSchedule: ["self", "team", "department"],
        eventAssignment: ["global"],
        dashboardLite: ["global"],
      },
      isActive: true,
    });
    assert.notEqual(body.actor.id, "SYSTEM");
  } finally {
    await close(server);
  }
});

test("enabled local mock auth reaches protected read routes with configured permission", async () => {
  const resolverCalls = { count: 0 };
  const { server, baseUrl } = await listen(
    createTestApp({
      resolverCalls,
      localMockAuth: readOnlyLocalMockConfig(),
    }),
  );

  try {
    const response = await fetch(`${baseUrl}/admin/roles`, {
      headers: {
        authorization: "Bearer mock-access-token",
      },
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, { data: [] });
  } finally {
    await close(server);
  }
});

test("enabled local mock read-only actor remains forbidden on mutation permissions", async () => {
  const resolverCalls = { count: 0 };
  const { server, baseUrl } = await listen(
    createTestApp({
      resolverCalls,
      localMockAuth: readOnlyLocalMockConfig(),
    }),
  );

  try {
    const response = await fetch(`${baseUrl}/admin/roles`, {
      method: "POST",
      headers: {
        authorization: "Bearer mock-access-token",
      },
    });
    const body = await response.json();

    assert.equal(response.status, 403);
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

test("enabled local mock auth still rejects missing auth", async () => {
  const resolverCalls = { count: 0 };
  const { server, baseUrl } = await listen(
    createTestApp({
      resolverCalls,
      localMockAuth: readOnlyLocalMockConfig(),
    }),
  );

  try {
    const response = await fetch(`${baseUrl}/admin/actor`);
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

test("enabled local mock auth does not accept arbitrary bearer tokens", async () => {
  const resolverCalls = { count: 0 };
  const { server, baseUrl } = await listen(
    createTestApp({
      resolverCalls,
      localMockAuth: readOnlyLocalMockConfig(),
    }),
  );

  try {
    const response = await fetch(`${baseUrl}/admin/actor`, {
      headers: {
        authorization: "Bearer arbitrary-local-token",
      },
    });
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
