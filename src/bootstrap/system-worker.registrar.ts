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
import {
  RegisteredSystemWorkerInvocation,
  issueAccessDeadlineWorkerInvocationForRegistrar,
} from "@core/application/authoritative-system-mutation.policy";
import crypto from "node:crypto";

export interface AccessDeadlineWorkerRunner {
  materializeDueTransitions(
    invocation: RegisteredSystemWorkerInvocation,
  ): Promise<Record<string, unknown>>;
}

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
  readonly accessDeadlineWorker: AccessDeadlineWorkerRunner;
  readonly accessDeadlinePollDelayMs: number;
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
      createAccessDeadlineWorkerRegistration(context),
    ]);

  assertUniqueSystemWorkerDescriptorIds(registrations);
  return registrations;
}

function createAccessDeadlineWorkerRegistration(
  context: SystemWorkerRegistrationContext,
): SystemWorkerRegistration {
  const descriptor = Object.freeze({
    id: "access.deadline-materializer",
    name: "Access Deadline Materializer",
    runtime: "system" as const,
    metadata: Object.freeze({
      actorId: "SYSTEM_ACCESS_DEADLINE_WORKER",
      mutationWhitelist: Object.freeze([
        "role.assignment.deadline-suspend",
        "break-glass.deadline-expire",
      ]),
      requestTimeAuthorityRemainsCanonical: true,
      quarantinePolicy: "BLOCK_WHEN_QUARANTINED",
      jobScopePolicy: "AUDIT_CONTEXT_PER_JOB",
      pollDelayMs: context.accessDeadlinePollDelayMs,
    }),
  });
  const failurePolicy =
    Object.freeze<SystemWorkerRegistration["failurePolicy"]>({
      failureDomain: "WORKER",
      onSystemInvariantFailure: async ({
        operation,
        error,
        traceId,
        metadata,
      }): Promise<void> => {
        context.onSystemInvariantFailure({
          source: "WORKER",
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
  const jobScopePolicy: NonNullable<
    SystemWorkerRegistration["jobScopePolicy"]
  > = Object.freeze({
    mode: "AUDIT_CONTEXT_PER_JOB",
    runInScope: async <T>(params: {
      readonly jobName: string;
      readonly run: () => Promise<T>;
    }): Promise<T> => runWithAuditContext(params.run),
  });
  const observability = Object.freeze<
    NonNullable<SystemWorkerRegistration["observability"]>
  >({
    onStarted: ({ traceId }): void => {
      context.logger.info({
        traceId,
        actorId: "SYSTEM_ACCESS_DEADLINE_WORKER",
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
        actorId: "SYSTEM_ACCESS_DEADLINE_WORKER",
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
    onLoopError: ({ traceId, operation, error }): void => {
      context.logger.error({
        traceId,
        actorId: "SYSTEM_ACCESS_DEADLINE_WORKER",
        context: "SYSTEM",
        operation,
        status: "FAILED",
        timestamp: Date.now(),
        metadata: {
          failureDomain: failurePolicy.failureDomain,
          workerId: descriptor.id,
          error: error instanceof Error ? error.message : String(error),
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
      const invocation =
        issueAccessDeadlineWorkerInvocationForRegistrar(
          `${descriptor.id}-${process.pid}`,
        );
      const pollLoopPromise = (async () => {
        while (!params.shouldStop()) {
          const jobTraceId = crypto.randomUUID();
          try {
            if (!(await quarantinePolicy.isQuarantined())) {
              await jobScopePolicy.runInScope({
                jobName: descriptor.id,
                run: async () =>
                  bindTraceId(jobTraceId, async () => {
                    await context.accessDeadlineWorker.materializeDueTransitions(
                      invocation,
                    );
                  }),
              });
            }
          } catch (error) {
            if (error instanceof SystemInvariantError) {
              await failurePolicy.onSystemInvariantFailure({
                operation:
                  "access.deadline-materializer.systemInvariant.crash",
                error,
                traceId: jobTraceId,
                metadata: { workerId: descriptor.id },
              });
            } else {
              observability.onLoopError?.({
                descriptor,
                traceId: jobTraceId,
                operation: "access.deadline-materializer.loop",
                error,
              });
            }
          }
          if (!params.shouldStop()) {
            await params.sleep(context.accessDeadlinePollDelayMs);
          }
        }
      })();
      observability.onStarted?.({
        descriptor,
        traceId: params.runtimeTraceId,
      });
      return {
        descriptor,
        shutdown: async (): Promise<void> => {
          await pollLoopPromise;
          observability.onStopped?.({
            descriptor,
            traceId: params.runtimeTraceId,
          });
        },
      };
    },
  };
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
