import crypto from "crypto";
import { SystemInvariantError } from "@core/error/system-error";
import {
  createStructuredLogger,
  StructuredLogger,
} from "@infra/logger.adapter";
import { CacheAdapter } from "./cache.adapter";
import { CacheKey } from "./cache.key";
import { CacheTTL } from "./cache.ttl";

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
  private readonly logger: StructuredLogger;

  constructor(
    private readonly cache: CacheAdapter,
    logger: StructuredLogger = createStructuredLogger(),
  ) {
    this.logger = logger;
  }

  async invalidateAll(params: {
    readonly traceId: string;
    readonly actorId: string;
    readonly context: string;
    readonly operation: string;
  }): Promise<void> {
    const versionKey =
      CacheKey.actorSnapshotVersion();
    const nextVersion =
      createActorSnapshotVersionToken();

    try {
      await this.cache.set(versionKey, nextVersion, {
        ttlSeconds: CacheTTL.ACTOR_SNAPSHOT_VERSION,
      });
    } catch (error) {
      this.logger.warn({
        traceId: params.traceId,
        actorId: params.actorId,
        context: params.context,
        operation: `${params.operation}.actor-snapshot.invalidate`,
        status: "FAILED_NON_AUTHORITATIVE",
        timestamp: Date.now(),
        metadata: {
          error:
            error instanceof Error
              ? error.message
              : String(error),
          retryHint:
            "Actor snapshot freshness self-heals on next authoritative actor resolution",
        },
      });
    }
  }
}

function createActorSnapshotVersionToken(): string {
  const token = crypto.randomUUID();
  assertVersion(token);
  return token;
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
