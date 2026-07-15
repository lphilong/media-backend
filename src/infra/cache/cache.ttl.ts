/**
 * TTL POLICY (SECONDS)
 * Centralized – no magic numbers elsewhere
 */
export const CacheTTL = {
  ACTOR_SNAPSHOT: 60,

  DASHBOARD_SNAPSHOT: 60, // 30s–1m SLA
  CMS_PUBLIC_CONTENT: 300, // 5 min
  RATE_LIMIT_COUNTER: 60,
  IDEMPOTENCY_KEY: 86400, // 24h
} as const;
