import crypto from "crypto";
import http from "http";
import { Socket } from "net";

import { createApp } from "@app/app";
import { Auth0ActorResolver } from "@app/auth";
import { PresenterRegistry } from "@app/presenter/presenter.registry";
import { env } from "@config/env";

import {
  createMongoRuntime,
  closeMongoRuntime,
} from "@infra/database/mongo/mongo.client";
import {
  awaitRedisReady,
  createRedisConnection,
  disconnectRedis,
} from "@infra/cache/redis.connection";

import { createInfraModule } from "@infra/infra.module";

import {
  createStorageAdapter,
  loadStorageConfig,
} from "@infra/storage";

import { MongoUserAuthRepository } from "@infra/mongo/user/user.auth.repository";
import { createHttpRuntimeContainer } from "./runtime-container.factory";
import { QueueRegistry } from "@infra/queue/queue.registry";
import { registerPresenters } from "./presenter.bootstrap";
import { createStructuredLogger } from "@infra/logger.adapter";
import { bootstrapDatabaseIndexes } from "./db-index.bootstrap";
import { InfrastructureError } from "@infra/errors/infrastructure.error";
import { startHttpManagementPlane } from "./http-management.runtime";

/* =========================================================
   CONFIG
========================================================= */

const REQUEST_TIMEOUT_MS = 30_000;
const HEADERS_TIMEOUT_MS = 35_000;
const KEEP_ALIVE_TIMEOUT_MS = 5_000;
const SHUTDOWN_TIMEOUT_MS = 30_000;
const SOCKET_DRAIN_TIMEOUT_MS = 5_000;

/* =========================================================
   HTTP RUNTIME (ENTERPRISE SAFE)
========================================================= */

export async function startHttpRuntime(): Promise<void> {
  /* 1️⃣ Infrastructure bootstrap */
  const logger = createStructuredLogger();
  const runtimeTraceId = crypto.randomUUID();

  const mongo = await createMongoRuntime();
  await bootstrapDatabaseIndexes(mongo.primaryDb);

  const redis = createRedisConnection(
    logger,
    runtimeTraceId,
  );
  await awaitRedisReady(redis, {
    logger,
    traceId: runtimeTraceId,
  });

  const storage = createStorageAdapter(loadStorageConfig());
  const presenterRegistry = new PresenterRegistry();
  registerPresenters(presenterRegistry);
  const queueRegistry = new QueueRegistry(redis);
  presenterRegistry.freeze();

  const container = createHttpRuntimeContainer({
    primaryDb: mongo.primaryDb,
    redis,
    storage,
    presenterRegistry,
    queueRegistry,
    logger,
  });

  const infra = createInfraModule({
    redis: container.redis,
    primaryDb: container.primaryDb,
    mongoClient: mongo.client,
    queueRegistry: container.queueRegistry,
    storage: container.storage,
  });

  /* 2️⃣ Domain dependencies */

  const userAuthRepository =
    new MongoUserAuthRepository(container.primaryDb);

  /* 3️⃣ Create Express app */

  const app = await createApp({
    actorResolver: new Auth0ActorResolver(
      userAuthRepository,
      infra.cacheAdapter,
    ),
    infra,
    presenterRegistry: container.presenterRegistry,
  });

  /* 4️⃣ Create and harden HTTP server */

  const server = http.createServer(app);
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  server.headersTimeout = HEADERS_TIMEOUT_MS;
  server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;

  const sockets = new Set<Socket>();
  let shutdownRequested = false;
  let exitCode = 0;
  const managementPlane = await startHttpManagementPlane({
    enabled: env.HTTP_MANAGEMENT_ENABLED,
    host: env.HTTP_MANAGEMENT_HOST,
    port: env.HTTP_MANAGEMENT_PORT,
    logger: container.logger,
    runtimeTraceId,
  });

  if (managementPlane) {
    managementPlane.setReadiness(false);
  }

  server.on("connection", (socket) => {
    sockets.add(socket);

    socket.on("close", () => {
      sockets.delete(socket);
    });

    if (shutdownRequested) {
      socket.destroy();
    }
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => {
      server.removeListener("listening", onListening);
      reject(err);
    };

    const onListening = () => {
      server.removeListener("error", onError);
      resolve();
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(env.PORT, env.HTTP_BIND_HOST);
  });

  if (managementPlane) {
    managementPlane.setReadiness(true);
  }

  container.logger.info({
    traceId: runtimeTraceId,
    actorId: "SYSTEM",
    context: "SYSTEM",
    operation: "http.runtime.start",
    status: "SUCCESS",
    timestamp: Date.now(),
    metadata: {
      host: env.HTTP_BIND_HOST,
      port: env.PORT,
      managementPlane: managementPlane
        ? {
            enabled: true,
            host: managementPlane.host,
            port: managementPlane.port,
            endpoints: ["/livez", "/readyz", "/metrics"],
          }
        : {
            enabled: false,
          },
      adminBusinessPlane: {
        basePath: "/admin",
        managementEndpointsMounted: false,
      },
    },
  });

  async function closeServer(): Promise<void> {
    const closePromise = new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });

    for (const socket of sockets) {
      socket.end();
    }

    const forceCloseTimer = setTimeout(() => {
      for (const socket of sockets) {
        socket.destroy();
      }
    }, SOCKET_DRAIN_TIMEOUT_MS);

    if (typeof forceCloseTimer.unref === "function") {
      forceCloseTimer.unref();
    }

    try {
      await closePromise;
    } finally {
      clearTimeout(forceCloseTimer);
    }
  }

  async function gracefulShutdown(
    signal: string,
    requestedExitCode: number,
  ): Promise<void> {
    if (requestedExitCode > exitCode) {
      exitCode = requestedExitCode;
    }

    if (shutdownRequested) {
      return;
    }

    shutdownRequested = true;
    if (managementPlane) {
      managementPlane.setReadiness(false);
    }

    container.logger.warn({
      traceId: runtimeTraceId,
      actorId: "SYSTEM",
      context: "SYSTEM",
      operation: "http.runtime.shutdown.requested",
      status: "IN_PROGRESS",
      timestamp: Date.now(),
      metadata: { signal },
    });

    const shutdownTask = async () => {
      const teardownErrors: string[] = [];

      const captureFailure = (
        label: string,
        err: unknown,
      ): void => {
        teardownErrors.push(
          `${label}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      };

      try {
        await closeServer();
      } catch (err) {
        captureFailure("server", err);
      }

      try {
        if (managementPlane) {
          await managementPlane.close();
        }
      } catch (err) {
        captureFailure("managementPlane", err);
      }

      try {
        await container.queueRegistry.closeAll();
      } catch (err) {
        captureFailure("queueRegistry", err);
      }

      try {
        await disconnectRedis(container.redis);
      } catch (err) {
        captureFailure("redis", err);
      }

      try {
        await closeMongoRuntime(mongo);
      } catch (err) {
        captureFailure("mongo", err);
      }

      if (teardownErrors.length > 0) {
        throw new InfrastructureError(
          "HTTP_RUNTIME_SHUTDOWN_FAILED",
          teardownErrors.join(" | "),
        );
      }
    };

    try {
      await Promise.race([
        shutdownTask(),
        new Promise((_, reject) =>
          setTimeout(
            () =>
              reject(
                new InfrastructureError(
                  "HTTP_RUNTIME_SHUTDOWN_TIMEOUT",
                  "HTTP shutdown timeout exceeded",
                ),
              ),
            SHUTDOWN_TIMEOUT_MS,
          ),
        ),
      ]);

      container.logger.info({
        traceId: runtimeTraceId,
        actorId: "SYSTEM",
        context: "SYSTEM",
        operation: "http.runtime.shutdown",
        status: "SUCCESS",
        timestamp: Date.now(),
      });
      process.exit(exitCode);
    } catch (err) {
      container.logger.fatal({
        traceId: runtimeTraceId,
        actorId: "SYSTEM",
        context: "SYSTEM",
        operation: "http.runtime.shutdown",
        status: "FAILED",
        timestamp: Date.now(),
        metadata: {
          error:
            err instanceof Error ? err.message : String(err),
        },
      });
      process.exit(1);
    }
  }

  process.on("SIGTERM", () => {
    void gracefulShutdown("SIGTERM", 0);
  });

  process.on("SIGINT", () => {
    void gracefulShutdown("SIGINT", 0);
  });

  process.on("uncaughtException", (err) => {
    container.logger.fatal({
      traceId: runtimeTraceId,
      actorId: "SYSTEM",
      context: "SYSTEM",
      operation: "process.uncaughtException",
      status: "FAILED",
      timestamp: Date.now(),
      metadata: {
        failureDomain: "PROCESS",
        error:
          err instanceof Error ? err.message : String(err),
      },
    });

    void gracefulShutdown("uncaughtException", 1);
  });

  process.on("unhandledRejection", (reason) => {
    container.logger.fatal({
      traceId: runtimeTraceId,
      actorId: "SYSTEM",
      context: "SYSTEM",
      operation: "process.unhandledRejection",
      status: "FAILED",
      timestamp: Date.now(),
      metadata: {
        failureDomain: "PROCESS",
        error:
          reason instanceof Error
            ? reason.message
            : String(reason),
      },
    });

    void gracefulShutdown("unhandledRejection", 1);
  });
}
