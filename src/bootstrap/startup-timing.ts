import { performance } from "node:perf_hooks";

import {
  StructuredLogger,
  LogEvent,
} from "@infra/logger.adapter";

const DEFAULT_SLOW_STAGE_THRESHOLD_MS = 1_000;

export interface StartupStageTimingOptions {
  readonly label: string;
  readonly logger: StructuredLogger;
  readonly traceId: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly warnAfterMs?: number;
  readonly now?: () => number;
}

function buildStageEvent(
  options: StartupStageTimingOptions,
  status: string,
  durationMs: number,
  metadata?: Readonly<Record<string, unknown>>,
): LogEvent {
  return {
    traceId: options.traceId,
    actorId: "SYSTEM",
    context: "SYSTEM",
    operation: options.label,
    status,
    timestamp: Date.now(),
    metadata: Object.freeze({
      ...(options.metadata ?? {}),
      ...(metadata ?? {}),
      durationMs,
    }),
  };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function measureStartupStage<T>(
  options: StartupStageTimingOptions,
  task: () => T | Promise<T>,
): Promise<T> {
  const readNow = options.now ?? (() => performance.now());
  const startedAt = readNow();

  try {
    const result = await task();
    const durationMs = Math.max(0, readNow() - startedAt);
    const warnAfterMs =
      options.warnAfterMs ?? DEFAULT_SLOW_STAGE_THRESHOLD_MS;
    const isSlow = durationMs >= warnAfterMs;
    const event = buildStageEvent(
      options,
      "SUCCESS",
      durationMs,
      isSlow
        ? {
            slow: true,
            slowThresholdMs: warnAfterMs,
          }
        : undefined,
    );

    if (isSlow) {
      options.logger.warn(event);
    } else {
      options.logger.info(event);
    }

    return result;
  } catch (error) {
    const durationMs = Math.max(0, readNow() - startedAt);
    options.logger.error(
      buildStageEvent(options, "FAILED", durationMs, {
        error: describeError(error),
      }),
    );
    throw error;
  }
}
