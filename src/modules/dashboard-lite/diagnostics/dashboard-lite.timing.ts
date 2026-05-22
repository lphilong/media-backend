import { performance } from "node:perf_hooks";

import { LogEvent, StructuredLogger } from "@infra/logger.adapter";

export const DASHBOARD_LITE_STAGE_WARN_AFTER_MS = 250;
export const DASHBOARD_LITE_MONGO_OPERATION_WARN_AFTER_MS = 100;

export interface DashboardLiteTimingContext {
  readonly traceId: string;
  readonly actorId: string;
  readonly context: string;
}

export interface DashboardLiteTimingOptions<T> {
  readonly operation: string;
  readonly logger: StructuredLogger;
  readonly timingContext: DashboardLiteTimingContext;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly warnAfterMs?: number;
  readonly now?: () => number;
  readonly resultMetadata?: (result: T) => Readonly<Record<string, unknown>>;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildEvent<T>(
  options: DashboardLiteTimingOptions<T>,
  status: "SUCCESS" | "FAILED",
  durationMs: number,
  metadata?: Readonly<Record<string, unknown>>,
): LogEvent {
  const slowThresholdMs =
    options.warnAfterMs ?? DASHBOARD_LITE_STAGE_WARN_AFTER_MS;

  return {
    traceId: options.timingContext.traceId,
    actorId: options.timingContext.actorId,
    context: options.timingContext.context,
    operation: options.operation,
    status,
    timestamp: Date.now(),
    metadata: Object.freeze({
      ...(options.metadata ?? {}),
      ...(metadata ?? {}),
      durationMs,
      slow: durationMs >= slowThresholdMs,
      slowThresholdMs,
    }),
  };
}

export async function measureDashboardLiteStage<T>(
  options: DashboardLiteTimingOptions<T>,
  task: () => T | Promise<T>,
): Promise<T> {
  const readNow = options.now ?? (() => performance.now());
  const startedAt = readNow();

  try {
    const result = await task();
    const durationMs = Math.max(0, readNow() - startedAt);
    const event = buildEvent(
      options,
      "SUCCESS",
      durationMs,
      options.resultMetadata?.(result),
    );

    if (event.metadata?.slow === true) {
      options.logger.warn(event);
    } else {
      options.logger.info(event);
    }

    return result;
  } catch (error) {
    const durationMs = Math.max(0, readNow() - startedAt);
    options.logger.error(
      buildEvent(options, "FAILED", durationMs, {
        error: describeError(error),
      }),
    );
    throw error;
  }
}
