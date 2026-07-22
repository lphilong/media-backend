import { QueueAdapter } from "@infra/queue";
import { DomainEvent } from "./domain-event.types";
import { DomainEventOutbox } from "@system/outbox/outbox.types";
import { SystemInvariantError } from "@core/error/system-error";

/**
 * Typed dispatcher errors
 * Poller decides retry semantics
 */
export class RetryableDispatchError extends Error {
  readonly retryable = true;
}

export class NonRetryableDispatchError extends Error {
  readonly retryable = false;
}

function toDomainEvent(record: DomainEventOutbox): DomainEvent {
  return {
    type: record.type,
    payload: record.payload,
  } as DomainEvent;
}

/**
 * SYSTEM-ONLY
 * Maps DomainEvent → async side effects
 * - Exhaustive
 * - No `any`
 * - Fail-closed
 */
export class DomainEventDispatcher {
  constructor(
    private readonly queueAdapter: QueueAdapter,
  ) {}

  async dispatch(
    records: DomainEventOutbox[],
  ): Promise<void> {
    for (const record of records) {
      if (
        typeof record.eventId !== "string" ||
        record.eventId.length === 0
      ) {
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          "Outbox event missing authoritative eventId",
        );
      }

      const event = toDomainEvent(record);

      try {
        switch (event.type) {
          /* =========================================================
             ROLE (BASELINE: OUTBOX ACK ONLY)
          ========================================================== */

          case "role.activated":
          case "role.created":
          case "role.deactivated":
          case "role.updated":
          case "role.archived":
          case "role.permissions.updated":
          case "role.assignment-rules.updated":
          case "role.assigned-to-user":
          case "role.revoked-from-user": {
            // ROLE events are authoritative outbound contracts and must stay in outbox flow.
            // Current release intentionally has no ROLE-owned async side effects here;
            // ack-only dispatch is expected, not a missing implementation.
            break;
          }

          case "role.assignment.deadline-suspended":
          case "break-glass.deadline-expired": {
            // Deadline reductions are already materialized transactionally.
            // Their outbox contracts are evidence/notification seams and are
            // intentionally ack-only until a bounded consumer is accepted.
            break;
          }

          /* =========================================================
             USER (BASELINE: OUTBOX ACK ONLY)
          ========================================================== */

          case "user.created":
          case "user.updated":
          case "user.activated":
          case "user.disabled":
          case "user.archived":
          case "user.auth-linked": {
            // USER events are authoritative outbound contracts and must stay in outbox flow.
            // Current release intentionally has no USER-owned async side effects here;
            // ack-only dispatch is expected, not a missing implementation.
            break;
          }

          /* =========================================================
             FAIL-CLOSED
          ========================================================== */

          default: {
            const _never: never = event;
            throw new NonRetryableDispatchError(
              `Unhandled DomainEvent: ${JSON.stringify(_never)}`,
            );
          }
        }
      } catch (err) {
        if (
          err instanceof NonRetryableDispatchError ||
          err instanceof SystemInvariantError
        ) {
          throw err;
        }

        throw new RetryableDispatchError(
          (err as Error).message ||
            "DomainEvent dispatch failed",
        );
      }
    }
  }
}
