import {
  createMongoRuntime,
  closeMongoRuntime,
} from "@infra/database/mongo/mongo.client";
import crypto from "crypto";
import http from "http";
import { Db } from "mongodb";

import { QueueRegistry } from "@infra/queue/queue.registry";
import { BullMQQueueAdapter } from "@infra/queue";
import { DomainEventDispatcher } from "@system/event-bridge/domain-event.dispatcher";
import { DomainEventOutboxRepository } from "@system/outbox";
import { DomainEventOutboxPoller } from "@system/outbox/outbox.poller";
import { bootstrapDatabaseIndexes } from "@bootstrap/db-index.bootstrap";
import { Redis } from "ioredis";
import {
  awaitRedisReady,
  createRedisConnection,
  disconnectRedis,
} from "@infra/cache/redis.connection";
import { createSystemRuntimeContainer } from "./runtime-container.factory";
import {
  loadStorageConfig,
  StorageConfig,
} from "@infra/storage/storage.config";
import { StorageAdapter } from "@infra/storage/storage.adapter";
import { InfrastructureError } from "@infra/errors/infrastructure.error";
import { createStructuredLogger } from "@infra/logger.adapter";
import { createWorkerRuntimeContext } from "@infra/guard";
import { SystemInvariantError } from "@core/error/system-error";
import { env } from "@config/env";
import {
  getPrometheusContentType,
  renderPrometheusMetrics,
} from "@infra/metrics/prometheus.registry";
import { HttpError } from "@app/http/http-error.types";
import { writeCanonicalHttpErrorResponse } from "@app/http/http-error-response.contract";
import { getSystemWorkerRegistrations } from "./system-worker.registrar";
import { RunningSystemWorker } from "./system-worker.contract";
import { measureStartupStage } from "./startup-timing";
import { MongoAuthoritativeAdminMutationBridge } from "@core/application/mongo-authoritative-admin-mutation.bridge";
import { AuditGuard } from "@core/audit/audit.guard";
import { AuditContext } from "@core/audit/audit.context";
import { MongoAuditLogger } from "@core/audit/mongo.audit.logger";
import { MongoAuditWriteRepository } from "@infra/mongo/audit/audit.write.repository";
import { AccessDeadlineWorkerService } from "@modules/role/admin/admin.access-deadline-worker.service";

type RuntimeProcess = {
  readonly pid: number;
  on(
    event: string,
    listener: (...args: any[]) => void,
  ): unknown;
  exit(code?: number): unknown;
};

type RuntimeMetricsServer = Pick<
  http.Server,
  "once" | "listen" | "removeListener" | "close"
>;

type RuntimeMetricsRequestListener = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
) => void;

export type SystemRuntimeDependencies = {
  readonly processRef: RuntimeProcess;
  readonly sleepFn: (ms: number) => Promise<void>;
  readonly createMongoRuntimeFn: typeof createMongoRuntime;
  readonly closeMongoRuntimeFn: typeof closeMongoRuntime;
  readonly bootstrapDatabaseIndexesFn: typeof bootstrapDatabaseIndexes;
  readonly createRedisConnectionFn: typeof createRedisConnection;
  readonly awaitRedisReadyFn: typeof awaitRedisReady;
  readonly disconnectRedisFn: typeof disconnectRedis;
  readonly createQueueRegistryFn: (redis: Redis) => QueueRegistry;
  readonly createStorageAdapterFn: (
    config: StorageConfig,
  ) => StorageAdapter;
  readonly loadStorageConfigFn: typeof loadStorageConfig;
  readonly createRuntimeContainerFn: typeof createSystemRuntimeContainer;
  readonly createQueueAdapterFn: (
    queueRegistry: QueueRegistry,
    logger: ReturnType<typeof createStructuredLogger>,
  ) => BullMQQueueAdapter;
  readonly createDispatcherFn: (
    queueAdapter: BullMQQueueAdapter,
  ) => DomainEventDispatcher;
  readonly createOutboxRepoFn: (
    primaryDb: Db,
  ) => DomainEventOutboxRepository;
  readonly createOutboxPollerFn: (
    ...args: ConstructorParameters<typeof DomainEventOutboxPoller>
  ) => DomainEventOutboxPoller;
  readonly createMetricsServerFn: (
    listener: RuntimeMetricsRequestListener,
  ) => RuntimeMetricsServer;
};

function createStorageAdapterRuntime(
  config: StorageConfig,
): StorageAdapter {
  const module = require("@infra/storage/storage.provider") as {
    createStorageAdapter: (
      input: StorageConfig,
    ) => StorageAdapter;
  };

  return module.createStorageAdapter(config);
}

const defaultSystemRuntimeDependencies: SystemRuntimeDependencies = {
  processRef: process,
  sleepFn: sleep,
  createMongoRuntimeFn: createMongoRuntime,
  closeMongoRuntimeFn: closeMongoRuntime,
  bootstrapDatabaseIndexesFn: bootstrapDatabaseIndexes,
  createRedisConnectionFn: createRedisConnection,
  awaitRedisReadyFn: awaitRedisReady,
  disconnectRedisFn: disconnectRedis,
  createQueueRegistryFn: (redis) => new QueueRegistry(redis),
  createStorageAdapterFn: createStorageAdapterRuntime,
  loadStorageConfigFn: loadStorageConfig,
  createRuntimeContainerFn: createSystemRuntimeContainer,
  createQueueAdapterFn: (queueRegistry, logger) =>
    new BullMQQueueAdapter(queueRegistry, logger),
  createDispatcherFn: (queueAdapter) =>
    new DomainEventDispatcher(queueAdapter),
  createOutboxRepoFn: (primaryDb) =>
    new DomainEventOutboxRepository(primaryDb),
  createOutboxPollerFn: (...args) =>
    new DomainEventOutboxPoller(...args),
  createMetricsServerFn: (listener) => http.createServer(listener),
};

/* =========================================================
   CONFIG
========================================================= */

const POLL_BATCH_SIZE = 20;
const POLL_IDLE_DELAY_MS = 500;
const ACCESS_DEADLINE_POLL_DELAY_MS = 30_000;
const SHUTDOWN_TIMEOUT_MS = 30_000;
const CRASH_RATE_WINDOW_MS = env.WORKER_CRASH_WINDOW_MS;
const CRASH_RATE_THRESHOLD = env.WORKER_CRASH_THRESHOLD;
const SYSTEM_METRICS_PORT = env.SYSTEM_METRICS_PORT;
const SYSTEM_METRICS_HOST = "127.0.0.1";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readHeaderValue(
  value: string | string[] | undefined,
): string | undefined {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized.length > 0
      ? normalized
      : undefined;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const normalized = item.trim();
      if (normalized.length > 0) {
        return normalized;
      }
    }
  }

  return undefined;
}

function resolveRequestId(
  req: http.IncomingMessage,
): string | undefined {
  const requestId = readHeaderValue(
    req.headers["x-request-id"],
  );
  if (requestId) {
    return requestId;
  }

  const traceId = readHeaderValue(
    req.headers["x-trace-id"],
  );
  if (traceId) {
    return traceId;
  }

  return undefined;
}

function writeCanonicalError(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  error: HttpError,
): void {
  writeCanonicalHttpErrorResponse({
    response: res,
    error,
    requestId: resolveRequestId(req),
    includeRequestId: env.HTTP_ERROR_INCLUDE_REQUEST_ID,
  });
}

/* =========================================================
   SYSTEM RUNTIME (ENTERPRISE SAFE)
========================================================= */

export async function startSystemRuntime(
  overrides: Partial<SystemRuntimeDependencies> = {},
): Promise<void> {
  const deps: SystemRuntimeDependencies = {
    ...defaultSystemRuntimeDependencies,
    ...overrides,
  };

  const runtimeContext = createWorkerRuntimeContext(
    env.APP_RUNTIME,
  );

  /* 1️⃣ Infrastructure bootstrap */
  const logger = createStructuredLogger();
  const runtimeTraceId = crypto.randomUUID();

  await measureStartupStage(
    {
      label: "startup.total",
      logger,
      traceId: runtimeTraceId,
      metadata: {
        runtime: "system",
      },
    },
    () =>
      startSystemRuntimeWithTiming({
        deps,
        runtimeContext,
        logger,
        runtimeTraceId,
      }),
  );
}

async function startSystemRuntimeWithTiming(params: {
  readonly deps: SystemRuntimeDependencies;
  readonly runtimeContext: ReturnType<
    typeof createWorkerRuntimeContext
  >;
  readonly logger: ReturnType<typeof createStructuredLogger>;
  readonly runtimeTraceId: string;
}): Promise<void> {
  const { deps, runtimeContext, logger, runtimeTraceId } =
    params;

  const mongo = await measureStartupStage(
    {
      label: "startup.mongoRuntime",
      logger,
      traceId: runtimeTraceId,
      metadata: {
        runtime: "system",
      },
    },
    () => deps.createMongoRuntimeFn(),
  );
  const primaryDb = mongo.primaryDb;

  await measureStartupStage(
    {
      label: "startup.indexBootstrap",
      logger,
      traceId: runtimeTraceId,
      metadata: {
        runtime: "system",
        skipped: env.SKIP_DB_INDEX_BOOTSTRAP,
      },
    },
    () =>
      deps.bootstrapDatabaseIndexesFn(primaryDb, {
        skip: env.SKIP_DB_INDEX_BOOTSTRAP,
        logger,
        traceId: runtimeTraceId,
      }),
  );

  const redis = await measureStartupStage(
    {
      label: "startup.redisConnection",
      logger,
      traceId: runtimeTraceId,
      metadata: {
        runtime: "system",
      },
    },
    () => deps.createRedisConnectionFn(logger, runtimeTraceId),
  );
  await measureStartupStage(
    {
      label: "startup.redisReady",
      logger,
      traceId: runtimeTraceId,
      metadata: {
        runtime: "system",
      },
    },
    () =>
      deps.awaitRedisReadyFn(redis, {
        logger,
        traceId: runtimeTraceId,
      }),
  );

  const storage = deps.createStorageAdapterFn(
    deps.loadStorageConfigFn(),
  );
  const queueRegistry = deps.createQueueRegistryFn(redis);

  const container = deps.createRuntimeContainerFn({
    primaryDb,
    redis,
    storage,
    queueRegistry,
    logger,
  });

  const queueAdapter = deps.createQueueAdapterFn(
    container.queueRegistry,
    container.logger,
  );

  await container.queueRegistry.ensureQuarantineState();

  /* 2️⃣ Domain async wiring */

  const dispatcher = deps.createDispatcherFn(queueAdapter);

  const outboxRepo = deps.createOutboxRepoFn(primaryDb);
  const systemMutationBridge =
    new MongoAuthoritativeAdminMutationBridge(
      mongo.client,
      primaryDb,
      container.logger,
    );
  const systemAuditGuard = new AuditGuard(
    new MongoAuditLogger(new MongoAuditWriteRepository(primaryDb)),
    new AuditContext(),
  );
  const accessDeadlineWorker = new AccessDeadlineWorkerService(
    primaryDb,
    systemAuditGuard,
    systemMutationBridge,
  );

  const metricsServer = deps.createMetricsServerFn(
    (
      req: http.IncomingMessage,
      res: http.ServerResponse,
    ) => {
      const path = (req.url ?? "").split("?")[0];
      const method = (req.method ?? "GET").toUpperCase();

      if (path !== "/metrics") {
        writeCanonicalError(
          req,
          res,
          new HttpError(
            404,
            "NOT_FOUND",
            "Resource not found",
          ),
        );
        return;
      }

      if (method !== "GET" && method !== "HEAD") {
        writeCanonicalError(
          req,
          res,
          new HttpError(
            405,
            "METHOD_NOT_ALLOWED",
            "Method not allowed",
          ),
        );
        return;
      }

      void (async () => {
        try {
          const body = await renderPrometheusMetrics();
          res.statusCode = 200;
          res.setHeader(
            "Content-Type",
            getPrometheusContentType(),
          );
          res.end(body);
        } catch (err) {
          container.logger.error({
            traceId: runtimeTraceId,
            actorId: "SYSTEM",
            context: "SYSTEM",
            operation: "system.metrics.render",
            status: "FAILED",
            timestamp: Date.now(),
            metadata: {
              error:
                err instanceof Error
                  ? err.message
                  : String(err),
            },
          });
          writeCanonicalError(
            req,
            res,
            new HttpError(
              500,
              "INTERNAL_ERROR",
              "Unexpected error",
            ),
          );
        }
      })();
    },
  );

  await measureStartupStage(
    {
      label: "startup.managementListen",
      logger,
      traceId: runtimeTraceId,
      metadata: {
        runtime: "system",
        enabled: true,
        host: SYSTEM_METRICS_HOST,
        port: SYSTEM_METRICS_PORT,
        endpoints: ["/metrics"],
      },
    },
    () =>
      new Promise<void>((resolve, reject) => {
        metricsServer.once("error", reject);
        metricsServer.listen(
          SYSTEM_METRICS_PORT,
          SYSTEM_METRICS_HOST,
          () => {
            metricsServer.removeListener("error", reject);
            resolve();
          },
        );
      }),
  );

  /* 3️⃣ Start workers */

  const runningWorkers: RunningSystemWorker[] = [];
  let shutdownRequested = false;
  let fatalExitInitiated = false;

  const handleSystemInvariantCrash = (params: {
    readonly source: "WORKER" | "OUTBOX" | "PROCESS";
    readonly operation: string;
    readonly error: SystemInvariantError;
    readonly traceId: string;
    readonly workerName?: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
  }): void => {
    if (fatalExitInitiated) {
      return;
    }
    fatalExitInitiated = true;
    shutdownRequested = true;

    void (async () => {
      container.logger.fatal({
        traceId: params.traceId,
        actorId: "SYSTEM",
        context: "SYSTEM",
        operation: params.operation,
        status: "FAILED",
        timestamp: Date.now(),
        metadata: {
          failureDomain: params.source,
          workerName: params.workerName,
          reason: params.error.code,
          error: params.error.message,
          ...(params.metadata ?? {}),
        },
      });

      const crashRate =
        await container.queueRegistry.recordSystemInvariantCrash(
          {
            threshold: CRASH_RATE_THRESHOLD,
            windowMs: CRASH_RATE_WINDOW_MS,
          },
        );

      if (crashRate.quarantined) {
        container.logger.fatal({
          traceId: params.traceId,
          actorId: "SYSTEM",
          context: "SYSTEM",
          operation: "resilience.quarantine.activate",
          status: "FAILED",
          timestamp: Date.now(),
          metadata: {
            failureDomain: params.source,
            reason:
              "SYSTEM_INVARIANT_CRASH_RATE_THRESHOLD",
            crashCount: crashRate.count,
            threshold: crashRate.threshold,
            windowMs: crashRate.windowMs,
          },
        });
      }

      deps.processRef.exit(1);
    })().catch((err) => {
      container.logger.fatal({
        traceId: runtimeTraceId,
        actorId: "SYSTEM",
        context: "SYSTEM",
        operation: "worker.systemInvariant.crash.handler",
        status: "FAILED",
        timestamp: Date.now(),
        metadata: {
          failureDomain: params.source,
          reason: "CRASH_HANDLER_FAILURE",
          error:
            err instanceof Error
              ? err.message
              : String(err),
        },
      });

      deps.processRef.exit(1);
    });
  };

  const workerRegistrations =
    getSystemWorkerRegistrations({
      logger: container.logger,
      runtimeContext,
      queueRegistry: container.queueRegistry,
      outboxRepo,
      dispatcher,
      createOutboxPollerFn: deps.createOutboxPollerFn,
      pollBatchSize: POLL_BATCH_SIZE,
      pollIdleDelayMs: POLL_IDLE_DELAY_MS,
      accessDeadlineWorker,
      accessDeadlinePollDelayMs: ACCESS_DEADLINE_POLL_DELAY_MS,
      onSystemInvariantFailure: handleSystemInvariantCrash,
    });

  try {
    for (const workerRegistration of workerRegistrations) {
      await workerRegistration.readiness();

      const runningWorker = await workerRegistration.start({
        runtimeTraceId,
        shouldStop: () =>
          shutdownRequested || fatalExitInitiated,
        sleep: deps.sleepFn,
      });

      runningWorkers.push(runningWorker);
    }
  } catch (error) {
    shutdownRequested = true;
    await Promise.allSettled(
      runningWorkers.map((worker) => worker.shutdown()),
    );
    throw error;
  }

  const startedWorkers = runningWorkers.map((worker) =>
    Object.freeze({
      id: worker.descriptor.id,
      name: worker.descriptor.name,
      runtime: worker.descriptor.runtime,
      metadata: worker.descriptor.metadata,
    }),
  );

  /* 5️⃣ Graceful shutdown orchestration */

  async function gracefulShutdown(signal: string): Promise<void> {
    if (shutdownRequested) return;
    shutdownRequested = true;

    container.logger.warn({
      traceId: runtimeTraceId,
      actorId: "SYSTEM",
      context: "SYSTEM",
      operation: "system.runtime.shutdown.requested",
      status: "IN_PROGRESS",
      timestamp: Date.now(),
      metadata: { signal },
    });

    const shutdownTask = async () => {
      await Promise.all(
        runningWorkers.map((worker) => worker.shutdown()),
      );

      await new Promise<void>((resolve, reject) => {
        metricsServer.close((err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        });
      });

      await container.queueRegistry.closeAll();
      await deps.disconnectRedisFn(container.redis);
      await deps.closeMongoRuntimeFn(mongo);
    };

    try {
      await Promise.race([
        shutdownTask(),
        new Promise((_, reject) =>
          setTimeout(
            () =>
              reject(
                new InfrastructureError(
                  "SYSTEM_SHUTDOWN_TIMEOUT",
                  "Shutdown timeout exceeded",
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
        operation: "system.runtime.shutdown",
        status: "SUCCESS",
        timestamp: Date.now(),
      });
      deps.processRef.exit(0);
    } catch (err) {
      container.logger.fatal({
        traceId: runtimeTraceId,
        actorId: "SYSTEM",
        context: "SYSTEM",
        operation: "system.runtime.shutdown",
        status: "FAILED",
        timestamp: Date.now(),
        metadata: {
          error:
            err instanceof Error
              ? err.message
              : String(err),
        },
      });
      deps.processRef.exit(1);
    }
  }

  deps.processRef.on("SIGTERM", () =>
    gracefulShutdown("SIGTERM"),
  );
  deps.processRef.on("SIGINT", () =>
    gracefulShutdown("SIGINT"),
  );

  deps.processRef.on("uncaughtException", (err) => {
    if (err instanceof SystemInvariantError) {
      handleSystemInvariantCrash({
        source: "PROCESS",
        operation:
          "process.systemInvariant.uncaughtException",
        error: err,
        traceId: runtimeTraceId,
      });
      return;
    }

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
    deps.processRef.exit(1);
  });

  deps.processRef.on("unhandledRejection", (reason) => {
    if (reason instanceof SystemInvariantError) {
      handleSystemInvariantCrash({
        source: "PROCESS",
        operation:
          "process.systemInvariant.unhandledRejection",
        error: reason,
        traceId: runtimeTraceId,
      });
      return;
    }

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
    deps.processRef.exit(1);
  });

  container.logger.info({
    traceId: runtimeTraceId,
    actorId: "SYSTEM",
    context: "SYSTEM",
    operation: "system.runtime.start",
    status: "SUCCESS",
    timestamp: Date.now(),
    metadata: {
      metricsHost: SYSTEM_METRICS_HOST,
      metricsPort: SYSTEM_METRICS_PORT,
      metricsEndpoint: "/metrics",
      workers: startedWorkers,
    },
  });
}
