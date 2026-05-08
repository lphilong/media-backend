import { QueueAdapter } from "./queue.adapter";
import {
  QueueName,
  BaseJobPayload,
  AdmissionOutcome,
  PublishOptions,
} from "./queue.types";
import {
  buildDeterministicJobOptions,
} from "./queue.policy";
import { InfrastructureError } from "../errors/infrastructure.error";
import { QueueRegistry } from "./queue.registry";
import { SystemInvariantError } from "@core/error/system-error";
import {
  StructuredLogger,
  createStructuredLogger,
} from "@infra/logger.adapter";
import {
  incrementQueueEnqueueFailure,
  incrementQueueJobFailure,
  observeQueueEnqueueDuration,
} from "@infra/metrics/prometheus.registry";

export class BullMQQueueAdapter implements QueueAdapter {
  private readonly logger: StructuredLogger;

  constructor(
    private readonly queueRegistry: QueueRegistry,
    logger?: StructuredLogger,
  ) {
    this.logger = logger ?? createStructuredLogger();
  }

  async publish<T extends BaseJobPayload>(
    queueName: QueueName,
    jobName: string,
    payload: T,
    options?: PublishOptions,
  ): Promise<AdmissionOutcome> {
    if (!jobName) {
      throw new InfrastructureError(
        "QUEUE_JOB_NAME_MISSING",
        "Job name must be provided",
        "Invalid job configuration",
        500,
      );
    }

    if (
      options?.jobId !== undefined &&
      (typeof options.jobId !== "string" ||
        options.jobId.length === 0)
    ) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Queue publish jobId must be a non-empty string",
      );
    }

    const enqueueStartedAt = Date.now();

    try {
      const admission = await this.queueRegistry.enqueue({
        queueName,
        jobName,
        payload,
        critical: options?.critical === true,
        jobOptions: buildDeterministicJobOptions({
          jobId: options?.jobId,
          overrides: options?.jobOptions,
        }),
      });

      if (admission.outcome === "accepted") {
        observeQueueEnqueueDuration({
          queue: queueName,
          durationMs: Date.now() - enqueueStartedAt,
          result: "success",
        });
      }

      this.logAdmission(
        payload,
        options?.operation ??
          (admission.outcome === "accepted"
            ? "queue.publish"
            : "queue.publish.admission"),
        queueName,
        admission,
        admission.outcome === "accepted"
          ? "ENQUEUED"
          : this.mapAdmissionStatus(admission.outcome),
      );

      return admission;
    } catch (err) {
      if (err instanceof SystemInvariantError) {
        throw err;
      }

      const rejected: AdmissionOutcome = {
        outcome: "rejected",
        failureDomain: "QUEUE",
        reason: "QUEUE_ADD_FAILED",
      };

      incrementQueueEnqueueFailure({
        queue: queueName,
      });
      incrementQueueJobFailure({
        queue: queueName,
        stage: "enqueue",
      });
      observeQueueEnqueueDuration({
        queue: queueName,
        durationMs: Date.now() - enqueueStartedAt,
        result: "failed",
      });

      this.logAdmission(
        payload,
        options?.operation ?? "queue.publish",
        queueName,
        rejected,
        "ENQUEUE_FAILED",
      );

      return rejected;
    }
  }

  private logAdmission(
    payload: BaseJobPayload,
    operation: string,
    queueName: QueueName,
    admission: AdmissionOutcome,
    status: string,
  ): void {
    const traceId = payload.traceId ?? "SYSTEM";

    this.logger.info({
      traceId,
      actorId: payload.requestedBy ?? "SYSTEM",
      context: "SYSTEM",
      operation,
      status,
      timestamp: Date.now(),
      metadata: {
        failureDomain: admission.failureDomain,
        outcome: admission.outcome,
        queueName,
        backlog: admission.backlog,
        threshold: admission.threshold,
        reason: admission.reason,
      },
    });
  }

  private mapAdmissionStatus(
    outcome: AdmissionOutcome["outcome"],
  ): "ACCEPTED" | "DEFERRED" | "REJECTED" {
    switch (outcome) {
      case "accepted":
        return "ACCEPTED";
      case "deferred":
        return "DEFERRED";
      case "rejected":
        return "REJECTED";
      default: {
        const _never: never = outcome;
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          `Unsupported queue admission outcome: ${_never}`,
        );
      }
    }
  }
}
