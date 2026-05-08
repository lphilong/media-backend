import { SystemInvariantError } from "@core/error/system-error";

export type SystemWorkerFailureDomain =
  | "WORKER"
  | "OUTBOX";

export interface SystemWorkerDescriptor {
  readonly id: string;
  readonly name: string;
  readonly runtime: "system";
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface SystemWorkerReadinessHook {
  (): Promise<void>;
}

export interface SystemWorkerShutdownHook {
  (): Promise<void>;
}

export interface SystemWorkerFailurePolicy {
  readonly failureDomain: SystemWorkerFailureDomain;
  onSystemInvariantFailure(params: {
    readonly operation: string;
    readonly error: SystemInvariantError;
    readonly traceId: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
  }): Promise<void>;
}

export interface SystemWorkerQuarantinePolicy {
  readonly mode: "BLOCK_WHEN_QUARANTINED";
  isQuarantined(): Promise<boolean>;
}

export interface SystemWorkerJobScopePolicy {
  readonly mode: "AUDIT_CONTEXT_PER_JOB" | "NONE";
  runInScope<T>(params: {
    readonly jobName: string;
    readonly run: () => Promise<T>;
  }): Promise<T>;
}

export interface SystemWorkerObservabilityPolicy {
  onStarted?(params: {
    readonly descriptor: SystemWorkerDescriptor;
    readonly traceId: string;
  }): void;
  onStopped?(params: {
    readonly descriptor: SystemWorkerDescriptor;
    readonly traceId: string;
  }): void;
  onLoopError?(params: {
    readonly descriptor: SystemWorkerDescriptor;
    readonly traceId: string;
    readonly operation: string;
    readonly error: unknown;
  }): void;
}

export interface RunningSystemWorker {
  readonly descriptor: SystemWorkerDescriptor;
  readonly shutdown: SystemWorkerShutdownHook;
}

export interface SystemWorkerRegistration {
  readonly descriptor: SystemWorkerDescriptor;
  readonly readiness: SystemWorkerReadinessHook;
  readonly failurePolicy: SystemWorkerFailurePolicy;
  readonly quarantinePolicy?: SystemWorkerQuarantinePolicy;
  readonly jobScopePolicy?: SystemWorkerJobScopePolicy;
  readonly observability?: SystemWorkerObservabilityPolicy;
  start(params: {
    readonly runtimeTraceId: string;
    readonly shouldStop: () => boolean;
    readonly sleep: (ms: number) => Promise<void>;
  }): Promise<RunningSystemWorker>;
}
