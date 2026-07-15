import { SystemInvariantError } from "@core/error/system-error";

export interface ActorSnapshotEnvelope<T> {
  readonly version: string;
  readonly snapshot: T;
}

export function createActorSnapshotEnvelope<T>(
  snapshot: T,
  version: string,
): ActorSnapshotEnvelope<T> {
  assertVersion(version);

  return Object.freeze({
    version,
    snapshot,
  });
}

export function isActorSnapshotEnvelope<T>(
  candidate: unknown,
): candidate is ActorSnapshotEnvelope<T> {
  if (
    typeof candidate !== "object" ||
    candidate === null
  ) {
    return false;
  }

  const record = candidate as Record<string, unknown>;

  return (
    typeof record.version === "string" &&
    record.version.trim().length > 0 &&
    "snapshot" in record
  );
}

export class ActorSnapshotCacheInvalidator {
  async invalidateAll(_params: {
    readonly traceId: string;
    readonly actorId: string;
    readonly context: string;
    readonly operation: string;
  }): Promise<void> {
    // The authoritative mutation bridge changes the DB auth security version
    // atomically. Cached envelopes are trusted only when that DB version
    // matches, so no independent Redis invalidation/version write is needed.
  }
}

function assertVersion(version: string): void {
  if (
    typeof version !== "string" ||
    version.trim().length === 0
  ) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      "Actor snapshot version must be a non-empty string",
    );
  }
}
