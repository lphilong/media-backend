import type { JobsOptions } from "bullmq";

export type QueueName = "system";

export interface BaseJobPayload {
  traceId?: string;
  requestedBy?: string; // actorId if exists
}

export type AdmissionDecision =
  | "accepted"
  | "rejected"
  | "deferred";

export type AdmissionFailureDomain =
  | "REDIS"
  | "QUEUE"
  | "WORKER"
  | "SYSTEM";

export interface AdmissionOutcome {
  readonly outcome: AdmissionDecision;
  readonly reason?: string;
  readonly failureDomain?: AdmissionFailureDomain;
  readonly backlog?: number;
  readonly threshold?: number;
}

export interface PublishOptions {
  readonly critical?: boolean;
  readonly operation?: string;
  /**
   * Stable deterministic job identity for dedupe/idempotency.
   * Must be non-empty when provided.
   */
  readonly jobId?: string;
  /**
   * Extra BullMQ job options that are merged on top of DefaultJobPolicy.
   * Intended for deterministic runtime scheduling (e.g. repeat jobs).
   */
  readonly jobOptions?: JobsOptions;
}
