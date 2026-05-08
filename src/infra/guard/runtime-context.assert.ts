import { SystemInvariantError } from "@core/error/system-error";

export interface WorkerRuntimeContext {
  readonly mode: "worker";
}

export function createWorkerRuntimeContext(
  appRuntime: string,
): WorkerRuntimeContext {
  if (appRuntime !== "system") {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      "Worker mode can only be entered in SYSTEM runtime",
    );
  }

  return Object.freeze({ mode: "worker" });
}

export function assertInWorker(
  runtime: WorkerRuntimeContext,
  operation: string,
): void {
  if (runtime.mode !== "worker") {
    throw new SystemInvariantError(
      "WORKER_CONTEXT_REQUIRED",
      `Worker context required: ${operation}`,
    );
  }
}

export function runWithInfraContext<T>(
  runtime: WorkerRuntimeContext,
  context: string,
  fn: () => T,
): T {
  if (context === runtime.mode) {
    return fn();
  }

  throw new SystemInvariantError(
    "SYSTEM_INVARIANT_VIOLATION",
    `Unsupported infra context: ${context}`,
  );
}
