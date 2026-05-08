import { DomainEvent } from "./domain-event.types";

/**
 * FlushHook is HTTP-only:
 * - Used to persist DomainEvents into Outbox
 * - MUST NOT dispatch or enqueue
 */
export type DomainEventFlushHook = (
  events: DomainEvent[],
) => Promise<void> | void;

export function flushDomainEvents(
  events: DomainEvent[],
  hook: DomainEventFlushHook,
): Promise<void> | void {
  return hook(events);
}
