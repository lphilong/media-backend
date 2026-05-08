import { ContextType } from "@core/context/context.types";
import { DomainEvent } from
  "@system/event-bridge/domain-event.types";

/**
 * Processing state for Outbox (Phase 4.2)
 */
export type OutboxStatus =
  | "PENDING"
  | "PROCESSING"
  | "RETRY"
  | "DISPATCHED"
  | "FAILED_FINAL";

/**
 * Canonical outbox envelope.
 * eventId is authoritative and generated once at transaction boundary.
 */
export interface DomainEventEnvelope {
  readonly eventId: string;
  readonly aggregateId: string;
  readonly aggregateVersion: number;
  readonly type: DomainEvent["type"];
  readonly version: number;
  readonly payload: DomainEvent["payload"];
  readonly occurredAt: number;
  readonly traceId: string;
}

/**
 * Persisted Domain Event (Outbox)
 * Enterprise-grade, retry-safe
 */
export interface DomainEventOutbox
  extends DomainEventEnvelope {
  status: OutboxStatus;

  attempts: number;
  maxAttempts: number;

  nextAttemptAt?: number;

  lockedAt?: number;
  lockedBy?: string;

  lastError?: {
    readonly message: string;
    readonly at: number;
  };

  readonly trace?: {
    readonly actorId?: string;
    readonly context?: ContextType;
    readonly requestId?: string;
  };

  readonly createdAt: number;
  readonly dispatchedAt?: number;
}
