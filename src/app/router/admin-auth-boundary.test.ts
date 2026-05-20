import assert from "node:assert/strict";
import { createServer, Server } from "node:http";
import { AddressInfo } from "node:net";
import { test } from "node:test";
import express from "express";
import { createHttpErrorMiddleware } from "@app/http/http-error.middleware";
import { createSecureRouter } from "./secure-router";
import { Auth0ActorResolver } from "@app/auth";

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

test("GET /admin/org-units without auth returns 401 instead of 500 before admin handlers run", async () => {
  const app = express();
  let actorResolverCalled = false;
  let adminHandlerCalled = false;

  const actorResolver = {
    async resolve() {
      actorResolverCalled = true;
      throw new Error("actor resolver should not run");
    },
  } as unknown as Auth0ActorResolver;

  app.use(
    "/admin",
    createSecureRouter({
      context: "ADMIN",
      auth0: {
        issuerBaseURL: "https://auth.example.test/",
        audience: "media-admin-api",
      },
      actorResolver,
    }),
    express
      .Router()
      .get("/org-units", (_req, res) => {
        adminHandlerCalled = true;
        res.json({ data: [] });
      }),
  );

  app.use(
    createHttpErrorMiddleware({
      error() {},
    } as never),
  );

  const { server, baseUrl } = await listen(app);

  try {
    const response = await fetch(
      `${baseUrl}/admin/org-units`,
    );
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.notEqual(response.status, 500);
    assert.deepEqual(body, {
      error: {
        code: "UNAUTHORIZED",
        message: "Invalid authentication",
      },
    });
    assert.equal(actorResolverCalled, false);
    assert.equal(adminHandlerCalled, false);
  } finally {
    await close(server);
  }
});
