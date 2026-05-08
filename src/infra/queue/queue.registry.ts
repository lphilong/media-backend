import { JobsOptions, Queue } from "bullmq";
import { Redis } from "ioredis";

import {
  AdmissionOutcome,
  BaseJobPayload,
  QueueName,
} from "./queue.types";
import { createQueue } from "./bullmq.client";
import { InfrastructureError } from "../errors/infrastructure.error";
import { isRedisConnectionDegraded } from "@infra/cache/redis.connection";
import {
  incrementQueueAdmission,
  setQueueDepth,
} from "@infra/metrics/prometheus.registry";
import { env } from "@config/env";

const DEFAULT_BACKLOG_THRESHOLD = 500;
const QUARANTINE_KEY = "resilience:queue:quarantine";
const CRASH_RATE_KEY =
  "resilience:worker:system-invariant-crash-rate";

type QuarantineState = {
  readonly reason: string;
  readonly activatedAt: number;
};

export class QueueRegistry {
  private readonly queues: Readonly<Record<QueueName, Queue>>;
  private readonly backlogThreshold: number;

  constructor(private readonly redis: Redis) {
    this.queues = Object.freeze({
      system: createQueue("system", redis),
    });

    this.backlogThreshold =
      Number.isInteger(env.QUEUE_BACKLOG_THRESHOLD) &&
      env.QUEUE_BACKLOG_THRESHOLD > 0
        ? env.QUEUE_BACKLOG_THRESHOLD
        : DEFAULT_BACKLOG_THRESHOLD;
  }

  async enqueue<T extends BaseJobPayload>(params: {
    readonly queueName: QueueName;
    readonly jobName: string;
    readonly payload: T;
    readonly critical: boolean;
    readonly jobOptions: JobsOptions;
  }): Promise<AdmissionOutcome> {
    if (!params.jobName) {
      throw new InfrastructureError(
        "QUEUE_JOB_NAME_MISSING",
        "Job name must be provided",
      );
    }

    const admission = await this.evaluateAdmission({
      queueName: params.queueName,
      critical: params.critical,
    });

    if (admission.outcome !== "accepted") {
      return admission;
    }

    const queue = this.getQueue(params.queueName);
    await queue.add(
      params.jobName,
      params.payload,
      params.jobOptions,
    );

    return admission;
  }

  private getQueue(name: QueueName): Queue {
    const queue = this.queues[name];
    if (!queue) {
      throw new InfrastructureError(
        "QUEUE_NOT_INITIALIZED",
        `Queue "${name}" is not initialized`,
      );
    }

    return queue;
  }

  async getBacklog(queueName: QueueName): Promise<number> {
    const queue = this.getQueue(queueName);
    const counts = await queue.getJobCounts(
      "waiting",
      "active",
      "delayed",
      "paused",
      "prioritized",
    );

    const backlog =
      (counts.waiting ?? 0) +
      (counts.active ?? 0) +
      (counts.delayed ?? 0) +
      (counts.paused ?? 0) +
      (counts.prioritized ?? 0);

    setQueueDepth({ queue: queueName, depth: backlog });

    return backlog;
  }

  async evaluateAdmission(params: {
    readonly queueName: QueueName;
    readonly critical: boolean;
  }): Promise<AdmissionOutcome> {
    if (params.critical) {
      return this.recordAdmission(params.queueName, {
        outcome: "accepted",
        threshold: this.backlogThreshold,
        reason: "CRITICAL_PATH",
      });
    }

    if (this.isRedisDegraded()) {
      return this.recordAdmission(params.queueName, {
        outcome: "deferred",
        failureDomain: "REDIS",
        reason: "REDIS_DEGRADED",
        threshold: this.backlogThreshold,
      });
    }

    let quarantined: boolean;
    try {
      quarantined = await this.isQuarantined();
    } catch {
      return this.recordAdmission(params.queueName, {
        outcome: "deferred",
        failureDomain: "REDIS",
        reason: "ADMISSION_STATE_UNAVAILABLE",
        threshold: this.backlogThreshold,
      });
    }

    if (quarantined) {
      return this.recordAdmission(params.queueName, {
        outcome: "deferred",
        failureDomain: "WORKER",
        reason: "QUARANTINED",
        threshold: this.backlogThreshold,
      });
    }

    let backlog: number;
    try {
      backlog = await this.getBacklog(params.queueName);
    } catch {
      return this.recordAdmission(params.queueName, {
        outcome: "deferred",
        failureDomain: "REDIS",
        reason: "BACKLOG_UNAVAILABLE",
        threshold: this.backlogThreshold,
      });
    }

    if (backlog > this.backlogThreshold) {
      return this.recordAdmission(params.queueName, {
        outcome: "rejected",
        failureDomain: "QUEUE",
        reason: "BACKLOG_THRESHOLD_EXCEEDED",
        backlog,
        threshold: this.backlogThreshold,
      });
    }

    return this.recordAdmission(params.queueName, {
      outcome: "accepted",
      backlog,
      threshold: this.backlogThreshold,
    });
  }

  private recordAdmission(
    queueName: QueueName,
    admission: AdmissionOutcome,
  ): AdmissionOutcome {
    incrementQueueAdmission({
      queue: queueName,
      outcome: admission.outcome,
    });

    return admission;
  }

  async ensureQuarantineState(): Promise<void> {
    if (await this.isQuarantined()) {
      await this.pauseAll();
    }
  }

  async enterQuarantine(reason: string): Promise<void> {
    const payload: QuarantineState = {
      reason,
      activatedAt: Date.now(),
    };

    await this.redis.set(
      QUARANTINE_KEY,
      JSON.stringify(payload),
    );
    await this.pauseAll();
  }

  async isQuarantined(): Promise<boolean> {
    const exists = await this.redis.exists(QUARANTINE_KEY);
    return exists === 1;
  }

  async recordSystemInvariantCrash(params: {
    readonly threshold: number;
    readonly windowMs: number;
  }): Promise<{
    readonly count: number;
    readonly threshold: number;
    readonly windowMs: number;
    readonly quarantined: boolean;
  }> {
    const count = await this.redis.incr(CRASH_RATE_KEY);

    if (count === 1) {
      await this.redis.pexpire(
        CRASH_RATE_KEY,
        params.windowMs,
      );
    }

    const quarantined = count >= params.threshold;

    if (quarantined) {
      await this.enterQuarantine(
        "SYSTEM_INVARIANT_CRASH_RATE_THRESHOLD",
      );
    }

    return {
      count,
      threshold: params.threshold,
      windowMs: params.windowMs,
      quarantined,
    };
  }

  isRedisDegraded(): boolean {
    return isRedisConnectionDegraded(this.redis);
  }

  getBacklogThreshold(): number {
    return this.backlogThreshold;
  }

  async closeAll(): Promise<void> {
    await Promise.all(
      Object.values(this.queues).map((queue) => queue.close()),
    );
  }

  private async pauseAll(): Promise<void> {
    await Promise.all(
      Object.values(this.queues).map((queue) =>
        queue.pause(),
      ),
    );
  }
}