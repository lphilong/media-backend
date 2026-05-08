import {
  JobsOptions,
  WorkerOptions,
} from "bullmq";
import { SystemInvariantError } from "@core/error/system-error";

export const QUEUE_RETRY_BASE_DELAY_MS = 5_000;
export const QUEUE_RETRY_MAX_DELAY_MS = 5 * 60_000;

function computeHashRatio(seed: string): number {
  let hash = 0x811c9dc5;

  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
    hash >>>= 0;
  }

  return hash / 0xffffffff;
}

export function computeQueueRawBackoff(
  attemptsMade: number,
): number {
  if (!Number.isInteger(attemptsMade) || attemptsMade < 0) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      `Invalid attemptsMade for queue backoff: ${attemptsMade}`,
    );
  }

  return Math.min(
    QUEUE_RETRY_BASE_DELAY_MS *
      Math.pow(2, attemptsMade),
    QUEUE_RETRY_MAX_DELAY_MS,
  );
}

export function computeDeterministicQueueBackoff(
  jobId: string,
  attemptsMade: number,
): number {
  if (jobId.length === 0) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      "Queue backoff requires a non-empty jobId seed",
    );
  }

  const raw = computeQueueRawBackoff(attemptsMade);
  const jitterRatio = computeHashRatio(
    `${jobId}:${attemptsMade}`,
  );

  return Math.floor(raw / 2 + (raw / 2) * jitterRatio);
}

export function deterministicExponentialJitterBackoff(
  attemptsMade: number,
  type?: string,
  _err?: Error,
  job?: {
    readonly id?: string;
  },
): number {
  if (type !== "custom") {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      `Unsupported queue backoff type: ${type ?? "undefined"}`,
    );
  }

  if (!job?.id) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      "Queue backoff requires stable jobId",
    );
  }

  return computeDeterministicQueueBackoff(
    job.id,
    attemptsMade,
  );
}

export const DeterministicWorkerSettings: NonNullable<
  WorkerOptions["settings"]
> = Object.freeze({
  backoffStrategy: deterministicExponentialJitterBackoff,
});

/**
 * Default job policy — PRODUCTION SAFE
 * - Bounded Redis growth
 * - Retry with backoff
 * - Failed jobs are retained LIMITED for inspection
 */
export const DefaultJobPolicy: JobsOptions = {
  attempts: 3,
  backoff: {
    type: "custom",
    delay: QUEUE_RETRY_BASE_DELAY_MS,
  },

  /**
   * Remove completed jobs immediately
   */
  removeOnComplete: true,

  /**
   * ⚠️ IMPORTANT
   * - Do NOT keep failed jobs forever
   * - Retain last N failures only
   */
  removeOnFail: {
    count: 1000, // bounded inspection window
  },
};

export function buildDeterministicJobOptions(params: {
  readonly jobId?: string;
  readonly overrides?: JobsOptions;
}): JobsOptions {
  const overrides = params.overrides;

  if (
    overrides?.attempts !== undefined &&
    overrides.attempts !== DefaultJobPolicy.attempts
  ) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      "Queue publish cannot override retry attempts",
    );
  }

  if (overrides?.backoff !== undefined) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      "Queue publish cannot override retry backoff policy",
    );
  }

  if (
    overrides?.jobId !== undefined &&
    typeof overrides.jobId === "string" &&
    params.jobId !== undefined &&
    overrides.jobId !== params.jobId
  ) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      "Queue publish received conflicting jobId values",
    );
  }

  return {
    ...DefaultJobPolicy,
    ...(overrides ?? {}),
    attempts: DefaultJobPolicy.attempts,
    backoff: DefaultJobPolicy.backoff,
    jobId: params.jobId ?? overrides?.jobId,
  };
}
