import {
  assertInWorker,
  WorkerRuntimeContext,
} from "@infra/guard";
import {
  DomainEventDispatcher,
  RetryableDispatchError,
} from "@system/event-bridge/domain-event.dispatcher";
import {
  DomainEventOutboxRepository,
} from "@system/outbox";
import type { DomainEventOutbox } from "./outbox.types";
import { InfrastructureError } from "@infra/errors/infrastructure.error";
import { SystemInvariantError } from "@core/error/system-error";
import { StructuredLogger } from "@infra/logger.adapter";
import { bindTraceId } from "@core/trace/trace.context";
import {
  incrementOutboxFailedFinal,
  observeOutboxDispatchDuration,
} from "@infra/metrics/prometheus.registry";

export const OUTBOX_BACKOFF_BASE_DELAY_MS = 5_000;
export const OUTBOX_BACKOFF_MAX_DELAY_MS = 5 * 60_000;

type OutboxPollerResiliencePolicy = {
  readonly isQuarantined: () => Promise<boolean>;
  readonly onSystemInvariantFailure?: (params: {
    readonly record: DomainEventOutbox;
    readonly error: SystemInvariantError;
    readonly workerId: string;
  }) => Promise<void>;
};

function computeHashRatio(seed: string): number {
  let hash = 0x811c9dc5;

  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
    hash >>>= 0;
  }

  return hash / 0xffffffff;
}

export function computeOutboxRawBackoff(
  attempts: number,
): number {
  return Math.min(
    OUTBOX_BACKOFF_BASE_DELAY_MS *
      Math.pow(2, attempts),
    OUTBOX_BACKOFF_MAX_DELAY_MS,
  );
}

export function computeOutboxJitteredBackoff(
  eventId: string,
  attempts: number,
): number {
  const raw = computeOutboxRawBackoff(attempts);
  const jitterRatio = computeHashRatio(
    `${eventId}:${attempts}`,
  );

  return Math.floor(raw / 2 + (raw / 2) * jitterRatio);
}

function toError(err: unknown): Error {
  if (err instanceof Error) return err;
  return new InfrastructureError(
    "OUTBOX_DISPATCH_UNKNOWN_ERROR",
    "Unknown dispatch error",
  );
}

export class DomainEventOutboxPoller {
  constructor(
    private readonly outboxRepo: DomainEventOutboxRepository,
    private readonly dispatcher: DomainEventDispatcher,
    private readonly logger: StructuredLogger,
    private readonly runtime: WorkerRuntimeContext,
    private readonly resilience?: OutboxPollerResiliencePolicy,
    private readonly workerId: string = `worker-${process.pid}`,
  ) {}

  async pollOnce(limit = 10): Promise<void> {
    assertInWorker(this.runtime, "outbox.poll");

    if (await this.isDispatchBlockedByQuarantine()) {
      return;
    }

    for (let i = 0; i < limit; i++) {
      const record =
        await this.outboxRepo.claimNext(this.workerId);

      if (!record) break;

      await this.processRecord(record);
    }
  }

  private async processRecord(
    record: DomainEventOutbox,
  ): Promise<void> {
    const dispatchStartedAt = Date.now();

    try {
      this.assertRecordInvariant(record);

      await bindTraceId(record.traceId, async () => {
        await this.dispatchRecord(record, dispatchStartedAt);
      });
    } catch (err) {
      if (err instanceof SystemInvariantError) {
        await this.finalizeSystemInvariantFailure(
          record,
          err,
          dispatchStartedAt,
        );
      }

      throw err;
    }
  }

  private async dispatchRecord(
    record: DomainEventOutbox,
    dispatchStartedAt: number,
  ): Promise<void> {
    try {
      this.logger.info({
        traceId: record.traceId,
        actorId: record.trace?.actorId ?? "SYSTEM",
        context: record.trace?.context ?? "SYSTEM",
        operation: "outbox.poller.dispatch",
        status: "STARTED",
        timestamp: Date.now(),
        metadata: {
          eventId: record.eventId,
          workerId: this.workerId,
          attempts: record.attempts,
        },
      });

      await this.dispatcher.dispatch([record]);

      await this.outboxRepo.markDispatched(
        record.eventId,
        this.workerId,
      );

      observeOutboxDispatchDuration({
        runtime: "system",
        durationMs: Date.now() - dispatchStartedAt,
        result: "success",
      });

      this.logger.info({
        traceId: record.traceId,
        actorId: record.trace?.actorId ?? "SYSTEM",
        context: record.trace?.context ?? "SYSTEM",
        operation: "outbox.poller.dispatch",
        status: "DISPATCHED",
        timestamp: Date.now(),
        metadata: {
          eventId: record.eventId,
          workerId: this.workerId,
        },
      });
    } catch (err: unknown) {
      if (err instanceof SystemInvariantError) {
        throw err;
      }

      const error = toError(err);

      if (
        err instanceof RetryableDispatchError &&
        record.attempts + 1 < record.maxAttempts
      ) {
        const delay = computeOutboxJitteredBackoff(
          record.eventId,
          record.attempts,
        );

        await this.outboxRepo.markRetry(
          record,
          this.workerId,
          error,
          Date.now() + delay,
        );

        observeOutboxDispatchDuration({
          runtime: "system",
          durationMs: Date.now() - dispatchStartedAt,
          result: "retry",
        });

        this.logger.warn({
          traceId: record.traceId,
          actorId: record.trace?.actorId ?? "SYSTEM",
          context: record.trace?.context ?? "SYSTEM",
          operation: "outbox.poller.dispatch",
          status: "RETRY_SCHEDULED",
          timestamp: Date.now(),
          metadata: {
            eventId: record.eventId,
            workerId: this.workerId,
            attempt: record.attempts + 1,
            backoffMs: delay,
            error: error.message,
          },
        });
        return;
      }

      await this.outboxRepo.markFailedFinal(
        record,
        this.workerId,
        error,
      );

      observeOutboxDispatchDuration({
        runtime: "system",
        durationMs: Date.now() - dispatchStartedAt,
        result: "failed_final",
      });
      incrementOutboxFailedFinal({
        runtime: "system",
      });

      this.logger.error({
        traceId: record.traceId,
        actorId: record.trace?.actorId ?? "SYSTEM",
        context: record.trace?.context ?? "SYSTEM",
        operation: "outbox.poller.dispatch",
        status: "FAILED_FINAL",
        timestamp: Date.now(),
        metadata: {
          eventId: record.eventId,
          workerId: this.workerId,
          attempt: record.attempts + 1,
          error: error.message,
        },
      });
    }
  }

  private assertRecordInvariant(
    record: DomainEventOutbox,
  ): void {
    if (!record.eventId) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Outbox record missing authoritative eventId",
      );
    }

    if (!record.traceId) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Outbox record missing traceId",
      );
    }
  }

  private async finalizeSystemInvariantFailure(
    record: DomainEventOutbox,
    error: SystemInvariantError,
    dispatchStartedAt: number,
  ): Promise<void> {
    let finalizationError: unknown;

    try {
      await this.outboxRepo.markFailedFinal(
        record,
        this.workerId,
        error,
      );

      observeOutboxDispatchDuration({
        runtime: "system",
        durationMs: Date.now() - dispatchStartedAt,
        result: "failed_final",
      });
      incrementOutboxFailedFinal({
        runtime: "system",
      });

      this.logger.fatal({
        traceId: record.traceId || "SYSTEM",
        actorId: record.trace?.actorId ?? "SYSTEM",
        context: record.trace?.context ?? "SYSTEM",
        operation: "outbox.poller.dispatch",
        status: "FAILED_INVARIANT_FINAL",
        timestamp: Date.now(),
        metadata: {
          eventId: record.eventId || "UNKNOWN",
          workerId: this.workerId,
          attempt: record.attempts + 1,
          error: error.message,
          reason: error.code,
        },
      });
    } catch (err) {
      finalizationError = err;
      this.logger.fatal({
        traceId: record.traceId || "SYSTEM",
        actorId: record.trace?.actorId ?? "SYSTEM",
        context: record.trace?.context ?? "SYSTEM",
        operation: "outbox.poller.dispatch.finalize",
        status: "FAILED",
        timestamp: Date.now(),
        metadata: {
          eventId: record.eventId || "UNKNOWN",
          workerId: this.workerId,
          reason: "INVARIANT_FINALIZATION_FAILED",
          error:
            err instanceof Error ? err.message : String(err),
        },
      });
    }

    if (this.resilience?.onSystemInvariantFailure) {
      await this.resilience.onSystemInvariantFailure({
        record,
        error,
        workerId: this.workerId,
      });
    }

    if (finalizationError !== undefined) {
      throw finalizationError;
    }
  }

  private async isDispatchBlockedByQuarantine(): Promise<boolean> {
    if (!this.resilience) {
      return false;
    }

    try {
      const quarantined =
        await this.resilience.isQuarantined();

      if (quarantined) {
        this.logger.warn({
          traceId: "SYSTEM",
          actorId: "SYSTEM",
          context: "SYSTEM",
          operation: "outbox.poller.quarantine",
          status: "DEFERRED",
          timestamp: Date.now(),
          metadata: {
            reason: "QUARANTINED",
            workerId: this.workerId,
          },
        });
      }

      return quarantined;
    } catch (err) {
      this.logger.error({
        traceId: "SYSTEM",
        actorId: "SYSTEM",
        context: "SYSTEM",
        operation: "outbox.poller.quarantine",
        status: "FAILED",
        timestamp: Date.now(),
        metadata: {
          reason: "QUARANTINE_STATE_UNAVAILABLE",
          workerId: this.workerId,
          error:
            err instanceof Error ? err.message : String(err),
        },
      });
      return true;
    }
  }
}
