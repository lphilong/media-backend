import { ClientSession } from "mongodb";
import { Actor } from "@core/actor/actor";
import { SystemInvariantError } from "@core/error/system-error";
import { PermissionContract } from "@core/permission/permission.contract";
import { AuthoritativeAdminMutationIdentity } from "./authoritative-admin-mutation.permission-map";
import {
  DomainEvent,
  PersistableDomainEvent,
  isPersistableDomainEvent,
} from "@system/event-bridge/domain-event.types";

export interface AuthoritativeAdminMutationBridgeParams {
  readonly actor: Actor;
  readonly traceId: string;
  readonly requiredPermission: PermissionContract;
  readonly mutationIdentity: AuthoritativeAdminMutationIdentity;
  readonly mutationTargetDescriptor: string;
}

export interface AuthoritativeMutationControls {
  markAuthSecurityTruthChanged(): void;
  markExplicitNoOpSuccess(): void;
}

export interface AuthoritativeAdminMutationBridge {
  execute<T>(
    params: AuthoritativeAdminMutationBridgeParams,
    mutate: (
      session: ClientSession,
      controls: AuthoritativeMutationControls,
    ) => Promise<T>,
  ): Promise<T>;
}

export function assertPersistableAdminMutationEvents(
  events: readonly DomainEvent[],
): asserts events is readonly PersistableDomainEvent[] {
  for (const [index, event] of events.entries()) {
    const eventType = readDomainEventTypeForMessage(event);

    if (isPersistableDomainEvent(event)) {
      continue;
    }

    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      `Authoritative ADMIN mutation emitted non-persistable domain event at index ${index}: ${eventType}`,
    );
  }
}

function readDomainEventTypeForMessage(
  event: DomainEvent,
): string {
  return event.type;
}
