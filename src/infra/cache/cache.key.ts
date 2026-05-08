import { env } from "@config/env";

/**
 * Redis key namespacing
 * Format: app:{env}:{scope}:{name}:{id}
 */
const ENV = env.NODE_ENV;
const APP = "app";

function normalizeSegment(value: string): string {
  const normalized = value.trim().toLowerCase();

  if (!normalized) {
    throw new Error("Cache key segment must not be empty");
  }

  return normalized;
}

function base(
  scope: string,
  name: string,
  id?: string,
): string {
  return [
    APP,
    ENV,
    normalizeSegment(scope),
    normalizeSegment(name),
    id,
  ]
    .filter(Boolean)
    .join(":");
}

function actorSnapshotVersionKey(): string {
  return base("auth", "actor-snapshot-version");
}

export const CacheKey = {
  rateLimit: (identifier: string) =>
    base("rate-limit", "counter", identifier),

  actorSnapshot: (context: string, sub: string) =>
    base(context, "actor-snapshot", sub),

  actorSnapshotVersion: () =>
    actorSnapshotVersionKey(),

  idempotency: (key: string) =>
    base("idempotency", "key", key),
} as const;
