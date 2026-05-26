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
import { getActor } from "@core/actor/actor-context";
import { assertContextType } from "@core/context/context.utils";
import { httpContextMiddleware } from "@app/http/http-context.middleware";
import { createSecureRouter } from "@app/router/secure-router";
import { Permission } from "@core/permission/permission.enum";
import { PermissionGuard } from "@core/permission/permission.guard";
import { PermissionResolver } from "@core/permission/permission.resolver";
import {
  UserActorResolutionFacade,
  type UserAuthResolutionCandidate,
} from "@modules/user/shared/user.actor-resolution.facade";

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

function createSelfServiceContextApp(options: {
  readonly resolverCalls: { count: number };
}): express.Express {
  const app = express();
  const routes = Router();

  routes.get("/actor", (req, res) => {
    const actor = getActor(req);

    res.json({
      data: {
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

  routes.get("/admin-permission-check", (req, res, next) => {
    try {
      const actor = getActor(req);
      PermissionGuard.assert(
        actor,
        PermissionResolver.resolve(Permission.USER_VIEW),
      );
      res.json({ data: { allowed: true } });
    } catch (error) {
      next(error);
    }
  });

  app.use(
    "/self-service",
    createSecureRouter({
      context: "SELF_SERVICE",
      auth0: AUTH0_OPTIONS,
      actorResolver: createRejectingActorResolver(
        options.resolverCalls,
      ),
      localMockAuth: createLocalMockAuthConfig({
        enabled: true,
        actorId: "user-staff",
        email: "staff@example.test",
        permissions: [Permission.USER_VIEW],
        scopeGrants: {
          workSchedule: ["self"],
          kpi: ["self"],
        },
      }),
    }),
    httpContextMiddleware(),
    routes,
  );

  app.use(createHttpErrorMiddleware({ error() {} } as never));

  return app;
}

test("SELF_SERVICE is a valid context value for dedicated self-service HTTP routes", async () => {
  assert.equal(assertContextType("SELF_SERVICE"), "SELF_SERVICE");

  const resolverCalls = { count: 0 };
  const { server, baseUrl } = await listen(
    createSelfServiceContextApp({ resolverCalls }),
  );

  try {
    const response = await fetch(`${baseUrl}/self-service/actor`, {
      headers: {
        authorization: `Bearer ${LOCAL_MOCK_AUTH_BEARER_TOKEN}`,
        "x-trace-id": "trace-self-service-actor",
      },
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(resolverCalls.count, 0);
    assert.deepEqual(body.data, {
      id: "user-staff",
      type: "staff",
      context: "SELF_SERVICE",
      roles: [],
      permissions: ["user:view"],
      scopeGrants: {
        workSchedule: ["self"],
        kpi: ["self"],
      },
      isActive: true,
    });
  } finally {
    await close(server);
  }
});

test("SELF_SERVICE actors do not satisfy ADMIN permission contracts", async () => {
  const resolverCalls = { count: 0 };
  const { server, baseUrl } = await listen(
    createSelfServiceContextApp({ resolverCalls }),
  );

  try {
    const response = await fetch(
      `${baseUrl}/self-service/admin-permission-check`,
      {
        headers: {
          authorization: `Bearer ${LOCAL_MOCK_AUTH_BEARER_TOKEN}`,
          "x-trace-id": "trace-self-service-admin-permission",
        },
      },
    );
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

test("auth linkage resolution preserves User id and binds actor to the requested context", async () => {
  const repository = {
    async findByAuthSubject(
      authSubject: string,
    ): Promise<readonly UserAuthResolutionCandidate[]> {
      assert.equal(authSubject, "auth0|staff");
      return [
        {
          userId: "user-staff",
          actorKind: "STAFF",
          accountStatus: "ACTIVE",
          permissions: [Permission.KPI_READ_PROGRESS],
          scopeGrants: {
            kpi: ["self"],
          },
        },
      ];
    },
  };

  const facade = new UserActorResolutionFacade(repository);
  const result = await facade.resolveByAuthLinkage({
    context: "SELF_SERVICE",
    authSubject: "auth0|staff",
  });

  assert.equal(result.actor.userId, "user-staff");
  assert.equal(result.actor.actorKind, "STAFF");
  assert.equal(result.actor.context, "SELF_SERVICE");
  assert.deepEqual(result.actor.permissions, [
    Permission.KPI_READ_PROGRESS,
  ]);
  assert.deepEqual(result.actor.scopeGrants, {
    kpi: ["self"],
  });
});
