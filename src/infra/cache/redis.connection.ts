import IORedis, { Redis } from "ioredis";
import crypto from "crypto";
import { RedisConfigurationError } from "../errors/redis-configuration.error";
import { InfrastructureError } from "../errors/infrastructure.error";
import {
  StructuredLogger,
  createStructuredLogger,
} from "@infra/logger.adapter";
import { env } from "@config/env";

const REDIS_DEGRADED_STATE = Symbol("REDIS_DEGRADED_STATE");
const REDIS_DEGRADED_RETRY_AFTER = 3;
const REDIS_MAX_RETRY_BUDGET = 10;
const DEFAULT_REDIS_READY_TIMEOUT_MS = 10_000;

type RedisResilienceState = {
  degraded: boolean;
  reason?: string;
  at?: number;
};

type RedisWithResilienceState = Redis & {
  [REDIS_DEGRADED_STATE]?: RedisResilienceState;
};

type RedisReadyOptions = {
  readonly timeoutMs?: number;
  readonly logger?: StructuredLogger;
  readonly traceId?: string;
};

function setRedisDegradedState(
  redis: Redis,
  degraded: boolean,
  reason?: string,
): void {
  const target = redis as RedisWithResilienceState;
  const current =
    target[REDIS_DEGRADED_STATE] ?? {
      degraded: false,
    };

  target[REDIS_DEGRADED_STATE] = {
    degraded,
    reason,
    at: Date.now(),
  };

  if (
    current.degraded === degraded &&
    current.reason === reason
  ) {
    return;
  }
}

export function isRedisConnectionDegraded(
  redis: Redis,
): boolean {
  const state = (redis as RedisWithResilienceState)[
    REDIS_DEGRADED_STATE
  ];

  return state?.degraded === true;
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutError: InfrastructureError,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(timeoutError);
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      (err) => {
        clearTimeout(timeoutId);
        reject(err);
      },
    );
  });
}

export function createRedisConnection(
  logger?: StructuredLogger,
  runtimeTraceId?: string,
): Redis {
  const effectiveLogger =
    logger ?? createStructuredLogger();
  const effectiveRuntimeTraceId =
    runtimeTraceId ?? crypto.randomUUID();
  const url = env.REDIS_URL;

  if (!url) {
    throw new RedisConfigurationError();
  }

  const logRedisEvent = (
    level: "info" | "warn" | "error",
    operation: string,
    error: InfrastructureError,
    metadata?: Readonly<Record<string, unknown>>,
  ): void => {
    effectiveLogger[level]({
      traceId: effectiveRuntimeTraceId,
      actorId: "SYSTEM",
      context: "SYSTEM",
      operation,
      status: "FAILED",
      timestamp: Date.now(),
      metadata: {
        failureDomain: "REDIS",
        reason: error.code,
        error: error.message,
        ...metadata,
      },
    });
  };

  const redis = new IORedis(url, {
    enableReadyCheck: true,
    maxRetriesPerRequest: 1,
    retryStrategy(times: number): number | null {
      if (times >= REDIS_DEGRADED_RETRY_AFTER) {
        logRedisEvent(
          "warn",
          "redis.connection.degraded",
          new InfrastructureError(
            "REDIS_CONNECTION_DEGRADED",
            "Redis connection entered degraded mode",
          ),
          { retries: times },
        );
      }

      if (times > REDIS_MAX_RETRY_BUDGET) {
        logRedisEvent(
          "error",
          "redis.connection.retryBudget",
          new InfrastructureError(
            "REDIS_RETRY_BUDGET_EXHAUSTED",
            "Redis retry budget exhausted; staying in degraded mode",
          ),
          {
            retries: times,
            retryBudget: REDIS_MAX_RETRY_BUDGET,
          },
        );

        return null;
      }

      return Math.min(2 ** times * 100, 5000);
    },
  });

  setRedisDegradedState(redis, false);

  redis.on("error", (err: Error) => {
    setRedisDegradedState(
      redis,
      true,
      "REDIS_RUNTIME_ERROR",
    );

    logRedisEvent(
      "error",
      "redis.connection.runtime",
      new InfrastructureError(
        "REDIS_RUNTIME_ERROR",
        `Redis runtime error: ${err.message}`,
      ),
    );
  });

  redis.on("reconnecting", () => {
    setRedisDegradedState(
      redis,
      true,
      "REDIS_RETRY_BUDGET_ACTIVE",
    );
  });

  redis.on("end", () => {
    setRedisDegradedState(
      redis,
      true,
      "REDIS_CONNECTION_CLOSED",
    );

    logRedisEvent(
      "error",
      "redis.connection.end",
      new InfrastructureError(
        "REDIS_CONNECTION_CLOSED",
        "Redis connection closed unexpectedly",
      ),
    );
  });

  redis.on("ready", () => {
    const wasDegraded = isRedisConnectionDegraded(redis);
    setRedisDegradedState(redis, false);

    if (wasDegraded) {
      effectiveLogger.info({
        traceId: effectiveRuntimeTraceId,
        actorId: "SYSTEM",
        context: "SYSTEM",
        operation: "redis.connection.recovered",
        status: "SUCCESS",
        timestamp: Date.now(),
        metadata: {
          failureDomain: "REDIS",
          reason: "REDIS_RECOVERED",
        },
      });
    }
  });

  return redis;
}

export async function awaitRedisReady(
  redis: Redis,
  options: RedisReadyOptions = {},
): Promise<void> {
  const timeoutMs =
    options.timeoutMs ?? DEFAULT_REDIS_READY_TIMEOUT_MS;
  const logger =
    options.logger ?? createStructuredLogger();
  const traceId = options.traceId ?? crypto.randomUUID();

  const waitForReady = async (): Promise<void> => {
    const currentStatus = (redis as Redis & {
      status?: string;
    }).status;

    if (currentStatus === "ready") {
      await redis.ping();
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const onReady = () => {
        cleanup();
        resolve();
      };

      const onError = (err: Error) => {
        cleanup();
        reject(
          new InfrastructureError(
            "REDIS_NOT_READY",
            `Redis readiness failed: ${err.message}`,
          ),
        );
      };

      const onEnd = () => {
        cleanup();
        reject(
          new InfrastructureError(
            "REDIS_NOT_READY",
            "Redis connection ended before readiness",
          ),
        );
      };

      const cleanup = () => {
        redis.removeListener("ready", onReady);
        redis.removeListener("error", onError);
        redis.removeListener("end", onEnd);
      };

      redis.once("ready", onReady);
      redis.once("error", onError);
      redis.once("end", onEnd);
    });

    await redis.ping();
  };

  try {
    await withTimeout(
      waitForReady(),
      timeoutMs,
      new InfrastructureError(
        "REDIS_READY_TIMEOUT",
        `Redis readiness timed out after ${timeoutMs}ms`,
      ),
    );

    setRedisDegradedState(redis, false);
  } catch (err) {
    const error =
      err instanceof InfrastructureError
        ? err
        : new InfrastructureError(
            "REDIS_NOT_READY",
            err instanceof Error ? err.message : String(err),
          );

    setRedisDegradedState(redis, true, error.code);

    logger.error({
      traceId,
      actorId: "SYSTEM",
      context: "SYSTEM",
      operation: "redis.connection.readiness",
      status: "FAILED",
      timestamp: Date.now(),
      metadata: {
        failureDomain: "REDIS",
        reason: error.code,
        error: error.message,
        timeoutMs,
      },
    });

    throw error;
  }
}

export async function disconnectRedis(
  redis: Redis,
): Promise<void> {
  await redis.quit();
}