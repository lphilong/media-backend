import { AsyncLocalStorage } from "node:async_hooks";
import { SystemInvariantError } from "@core/error/system-error";

const traceIdStorage = new AsyncLocalStorage<string>();

export function bindTraceId<T>(
  traceId: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (!traceId) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      "TraceId must be provided at runtime entry",
    );
  }

  return traceIdStorage.run(traceId, fn);
}

export function getTraceIdOrThrow(): string {
  const traceId = traceIdStorage.getStore();
  if (!traceId) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      "TraceId context is not available",
    );
  }

  return traceId;
}
