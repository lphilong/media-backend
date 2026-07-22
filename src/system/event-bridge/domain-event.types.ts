import { AsyncLocalStorage } from "node:async_hooks";
import { SystemInvariantError } from "@core/error/system-error";

export interface DomainEventEnvelopeMetadata {
  readonly aggregateId: string;
  readonly aggregateVersion: number;
  readonly version: number;
  readonly occurredAt: number;
}

type AuthoritativeDomainEvent<TType extends string, TPayload> = Readonly<
  DomainEventEnvelopeMetadata & {
    type: TType;
    payload: TPayload;
  }
>;

export type DomainEvent =
  | AuthoritativeDomainEvent<"user.created", { userId: string }>
  | AuthoritativeDomainEvent<
      "user.updated",
      {
        userId: string;
        changedFields: readonly string[];
      }
    >
  | AuthoritativeDomainEvent<
      "user.activated",
      { userId: string; state: "ACTIVE" }
    >
  | AuthoritativeDomainEvent<
      "user.disabled",
      { userId: string; state: "DISABLED" }
    >
  | AuthoritativeDomainEvent<
      "user.archived",
      { userId: string; state: "ARCHIVED" }
    >
  | AuthoritativeDomainEvent<
      "user.auth-linked",
      {
        userId: string;
        provider: "auth0";
        subject: string;
      }
    >
  | AuthoritativeDomainEvent<"role.created", { roleId: string }>
  | AuthoritativeDomainEvent<"role.updated", { roleId: string }>
  | AuthoritativeDomainEvent<
      "role.activated",
      { roleId: string; state: "ACTIVE" }
    >
  | AuthoritativeDomainEvent<
      "role.deactivated",
      { roleId: string; state: "INACTIVE" }
    >
  | AuthoritativeDomainEvent<
      "role.archived",
      { roleId: string; state: "ARCHIVED" }
    >
  | AuthoritativeDomainEvent<
      "role.permissions.updated",
      {
        roleId: string;
        permissions: readonly string[];
      }
    >
  | AuthoritativeDomainEvent<
      "role.assignment-rules.updated",
      {
        roleId: string;
        ruleIds: readonly string[];
      }
    >
  | AuthoritativeDomainEvent<
      "role.assigned-to-user",
      {
        roleId: string;
        assignmentId: string;
        userId: string;
        state: "ACTIVE";
      }
    >
  | AuthoritativeDomainEvent<
      "role.revoked-from-user",
      {
        roleId: string;
        assignmentId: string;
        userId: string;
        state: "REVOKED";
      }
    >
  | AuthoritativeDomainEvent<
      "role.assignment.deadline-suspended",
      {
        assignmentId: string;
        userId: string;
        cycleId: string;
        deadline: number;
        reason:
          | "EXPIRED"
          | "MALFORMED_SUCCESSOR"
          | "REVIEW_DEADLINE_UNRESOLVABLE"
          | "REVIEW_OVERDUE"
          | "GRACE_EXPIRED";
        transitionId: string;
      }
    >
  | AuthoritativeDomainEvent<
      "break-glass.deadline-expired",
      {
        activationId: string;
        targetUserId: string;
        deadline: number;
        transitionId: string;
      }
    >
  | AuthoritativeDomainEvent<
      "break-glass.manually-ended",
      {
        activationId: string;
        targetUserId: string;
        endedAt: number;
        endedByUserId: string;
        originalExpiresAt: number;
      }
    >;

export type PersistableDomainEvent = Extract<
  DomainEvent,
  DomainEventEnvelopeMetadata
>;

export function isPersistableDomainEvent(
  event: DomainEvent,
): event is PersistableDomainEvent {
  const candidate = event as Partial<DomainEventEnvelopeMetadata>;

  return (
    typeof candidate.aggregateId === "string" &&
    candidate.aggregateId.length > 0 &&
    Number.isInteger(candidate.aggregateVersion) &&
    (candidate.aggregateVersion ?? 0) > 0 &&
    Number.isInteger(candidate.version) &&
    (candidate.version ?? 0) > 0 &&
    Number.isInteger(candidate.occurredAt) &&
    (candidate.occurredAt ?? -1) >= 0
  );
}

export class DomainEventCollector {
  private readonly events: DomainEvent[] = [];

  emit(event: DomainEvent): void {
    this.events.push(event);
  }

  drain(): DomainEvent[] {
    return this.events.splice(0, this.events.length);
  }
}

const storage = new AsyncLocalStorage<DomainEventCollector>();

export function runWithDomainEventCollector<T>(
  fn: () => Promise<T> | T,
): Promise<T> | T {
  return storage.run(new DomainEventCollector(), fn);
}

export function getCurrentDomainEventCollector(): DomainEventCollector {
  const collector = storage.getStore();
  if (!collector) {
    throw new SystemInvariantError(
      "DOMAIN_EVENT_CONTEXT_MISSING",
      "DomainEventCollector not initialized",
    );
  }
  return collector;
}
