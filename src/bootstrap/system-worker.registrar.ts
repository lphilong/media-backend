import { runWithAuditContext } from "@core/audit/audit.context";
import { SystemInvariantError } from "@core/error/system-error";
import { bindTraceId } from "@core/trace/trace.context";
import { StructuredLogger } from "@infra/logger.adapter";
import { WorkerRuntimeContext } from "@infra/guard";
import { QueueRegistry } from "@infra/queue/queue.registry";
import { DomainEventDispatcher } from "@system/event-bridge/domain-event.dispatcher";
import { DomainEventOutboxRepository } from "@system/outbox";
import { DomainEventOutboxPoller } from "@system/outbox/outbox.poller";
import {
  RunningSystemWorker,
  SystemWorkerRegistration,
} from "./system-worker.contract";

export type SystemWorkerRegistrationContext = {
  readonly logger: StructuredLogger;
  readonly runtimeContext: WorkerRuntimeContext;
  readonly queueRegistry: QueueRegistry;
  readonly outboxRepo: DomainEventOutboxRepository;
  readonly dispatcher: DomainEventDispatcher;
  readonly createOutboxPollerFn: (
    ...args: ConstructorParameters<typeof DomainEventOutboxPoller>
  ) => DomainEventOutboxPoller;
  readonly pollBatchSize: number;
  readonly pollIdleDelayMs: number;
  readonly onSystemInvariantFailure: (params: {
    readonly source: "WORKER" | "OUTBOX" | "PROCESS";
    readonly operation: string;
    readonly error: SystemInvariantError;
    readonly traceId: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
  }) => void;
};

export function getSystemWorkerRegistrations(
  context: SystemWorkerRegistrationContext,
): readonly SystemWorkerRegistration[] {
  const registrations: readonly SystemWorkerRegistration[] =
    Object.freeze([
      createOutboxPollerWorkerRegistration(context),
    ]);

  assertUniqueSystemWorkerDescriptorIds(registrations);
  return registrations;
}

function createOutboxPollerWorkerRegistration(
  context: SystemWorkerRegistrationContext,
): SystemWorkerRegistration {
  const descriptor = Object.freeze({
    id: "outbox.poller",
    name: "Domain Event Outbox Poller",
    runtime: "system" as const,
    metadata: Object.freeze({
      queue: "system",
      pollBatchSize: context.pollBatchSize,
      pollIdleDelayMs: context.pollIdleDelayMs,
      quarantinePolicy: "BLOCK_WHEN_QUARANTINED",
      jobScopePolicy: "AUDIT_CONTEXT_PER_JOB",
    }),
  });

  const failurePolicy =
    Object.freeze<SystemWorkerRegistration["failurePolicy"]>({
      failureDomain: "OUTBOX",
      onSystemInvariantFailure: async ({
        operation,
        error,
        traceId,
        metadata,
      }): Promise<void> => {
        context.onSystemInvariantFailure({
          source: "OUTBOX",
          operation,
          error,
          traceId,
          metadata,
        });
      },
    });

  const quarantinePolicy: NonNullable<
    SystemWorkerRegistration["quarantinePolicy"]
  > = Object.freeze({
      mode: "BLOCK_WHEN_QUARANTINED",
      isQuarantined: async (): Promise<boolean> =>
        context.queueRegistry.isQuarantined(),
    });

  const jobScopePolicy =
    Object.freeze<SystemWorkerRegistration["jobScopePolicy"]>({
      mode: "AUDIT_CONTEXT_PER_JOB",
      runInScope: async <T>(params: {
        readonly jobName: string;
        readonly run: () => Promise<T>;
      }): Promise<T> =>
        runWithAuditContext(async () => params.run()),
    });

  const observability =
    Object.freeze<SystemWorkerRegistration["observability"]>({
      onStarted: ({ traceId }): void => {
        context.logger.info({
          traceId,
          actorId: "SYSTEM",
          context: "SYSTEM",
          operation: "system.worker.start",
          status: "SUCCESS",
          timestamp: Date.now(),
          metadata: {
            workerId: descriptor.id,
            workerName: descriptor.name,
            ...(descriptor.metadata ?? {}),
          },
        });
      },
      onStopped: ({ traceId }): void => {
        context.logger.info({
          traceId,
          actorId: "SYSTEM",
          context: "SYSTEM",
          operation: "system.worker.shutdown",
          status: "SUCCESS",
          timestamp: Date.now(),
          metadata: {
            workerId: descriptor.id,
            workerName: descriptor.name,
          },
        });
      },
      onLoopError: ({
        traceId,
        operation,
        error,
      }): void => {
        context.logger.error({
          traceId,
          actorId: "SYSTEM",
          context: "SYSTEM",
          operation,
          status: "FAILED",
          timestamp: Date.now(),
          metadata: {
            failureDomain: failurePolicy.failureDomain,
            workerId: descriptor.id,
            workerName: descriptor.name,
            error:
              error instanceof Error
                ? error.message
                : String(error),
          },
        });
      },
    });

  return {
    descriptor,
    readiness: async (): Promise<void> => {
      await quarantinePolicy.isQuarantined();
    },
    failurePolicy,
    quarantinePolicy,
    jobScopePolicy,
    observability,
    start: async (params): Promise<RunningSystemWorker> => {
      const poller = context.createOutboxPollerFn(
        context.outboxRepo,
        context.dispatcher,
        context.logger,
        context.runtimeContext,
        {
          isQuarantined: async () =>
            quarantinePolicy.isQuarantined(),
          onSystemInvariantFailure: async ({
            record,
            error,
          }) => {
            await failurePolicy.onSystemInvariantFailure({
              operation:
                "outbox.poller.systemInvariant.crash",
              error,
              traceId:
                record.traceId || params.runtimeTraceId,
              metadata: {
                eventId: record.eventId,
              },
            });
          },
        },
        `${descriptor.id}-${process.pid}`,
      );

      const pollLoopPromise = (async () => {
        while (!params.shouldStop()) {
          try {
            const pollOnce = async () =>
              bindTraceId(
                params.runtimeTraceId,
                async () =>
                  poller.pollOnce(context.pollBatchSize),
              );

            if (jobScopePolicy) {
              await jobScopePolicy.runInScope({
                jobName: descriptor.id,
                run: pollOnce,
              });
            } else {
              await pollOnce();
            }
          } catch (error) {
            if (error instanceof SystemInvariantError) {
              await failurePolicy.onSystemInvariantFailure({
                operation:
                  "outbox.poller.loop.systemInvariant.crash",
                error,
                traceId: params.runtimeTraceId,
              });
              continue;
            }

            observability?.onLoopError?.({
              descriptor,
              traceId: params.runtimeTraceId,
              operation: "outbox.poller.loop",
              error,
            });
          }

          if (!params.shouldStop()) {
            await params.sleep(context.pollIdleDelayMs);
          }
        }
      })();

      observability?.onStarted?.({
        descriptor,
        traceId: params.runtimeTraceId,
      });

      return {
        descriptor,
        shutdown: async (): Promise<void> => {
          await pollLoopPromise;
          observability?.onStopped?.({
            descriptor,
            traceId: params.runtimeTraceId,
          });
        },
      };
    },
  };
}

function assertUniqueSystemWorkerDescriptorIds(
  registrations: readonly SystemWorkerRegistration[],
): void {
  const unique = new Set<string>();

  for (const registration of registrations) {
    const workerId = registration.descriptor.id.trim();

    if (workerId.length === 0) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "System worker descriptor id must not be empty",
      );
    }

    if (unique.has(workerId)) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        `Duplicate system worker descriptor id detected: ${workerId}`,
      );
    }

    unique.add(workerId);
  }
}
