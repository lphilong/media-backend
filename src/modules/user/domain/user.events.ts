import { PersistableDomainEvent } from "@system/event-bridge/domain-event.types";

type UserEventMetadata = Readonly<{
  userId: string;
  aggregateVersion: number;
  occurredAt: number;
}>;

function createUserEvent<TType extends PersistableDomainEvent["type"]>(
  params: {
    readonly type: TType;
    readonly metadata: UserEventMetadata;
    readonly payload: Extract<
      PersistableDomainEvent,
      { type: TType }
    >["payload"];
  },
): Extract<PersistableDomainEvent, { type: TType }> {
  return {
    aggregateId: params.metadata.userId,
    aggregateVersion:
      params.metadata.aggregateVersion,
    type: params.type,
    version: 1,
    occurredAt: params.metadata.occurredAt,
    payload: params.payload,
  } as Extract<
    PersistableDomainEvent,
    { type: TType }
  >;
}

export function createUserCreatedEvent(
  metadata: UserEventMetadata,
): Extract<PersistableDomainEvent, { type: "user.created" }> {
  return createUserEvent({
    type: "user.created",
    metadata,
    payload: {
      userId: metadata.userId,
    },
  });
}

export function createUserUpdatedEvent(params: {
  readonly userId: string;
  readonly changedFields: readonly string[];
  readonly aggregateVersion: number;
  readonly occurredAt: number;
}): Extract<PersistableDomainEvent, { type: "user.updated" }> {
  return createUserEvent({
    type: "user.updated",
    metadata: {
      userId: params.userId,
      aggregateVersion: params.aggregateVersion,
      occurredAt: params.occurredAt,
    },
    payload: {
      userId: params.userId,
      changedFields: [...params.changedFields],
    },
  });
}

export function createUserActivatedEvent(
  metadata: UserEventMetadata,
): Extract<PersistableDomainEvent, { type: "user.activated" }> {
  return createUserEvent({
    type: "user.activated",
    metadata,
    payload: {
      userId: metadata.userId,
      state: "ACTIVE",
    },
  });
}

export function createUserDisabledEvent(
  metadata: UserEventMetadata,
): Extract<PersistableDomainEvent, { type: "user.disabled" }> {
  return createUserEvent({
    type: "user.disabled",
    metadata,
    payload: {
      userId: metadata.userId,
      state: "DISABLED",
    },
  });
}

export function createUserArchivedEvent(
  metadata: UserEventMetadata,
): Extract<PersistableDomainEvent, { type: "user.archived" }> {
  return createUserEvent({
    type: "user.archived",
    metadata,
    payload: {
      userId: metadata.userId,
      state: "ARCHIVED",
    },
  });
}

export function createUserAuthLinkedEvent(params: {
  readonly userId: string;
  readonly provider: "auth0";
  readonly subject: string;
  readonly aggregateVersion: number;
  readonly occurredAt: number;
}): Extract<PersistableDomainEvent, { type: "user.auth-linked" }> {
  return createUserEvent({
    type: "user.auth-linked",
    metadata: {
      userId: params.userId,
      aggregateVersion: params.aggregateVersion,
      occurredAt: params.occurredAt,
    },
    payload: {
      userId: params.userId,
      provider: params.provider,
      subject: params.subject,
    },
  });
}
