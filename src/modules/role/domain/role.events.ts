import { PersistableDomainEvent } from "@system/event-bridge/domain-event.types";

type RoleEventMetadata = Readonly<{
  roleId: string;
  aggregateVersion: number;
  occurredAt: number;
}>;

function createRoleEvent<TType extends PersistableDomainEvent["type"]>(
  params: {
    readonly type: TType;
    readonly metadata: RoleEventMetadata;
    readonly payload: Extract<
      PersistableDomainEvent,
      { type: TType }
    >["payload"];
  },
): Extract<PersistableDomainEvent, { type: TType }> {
  return {
    aggregateId: params.metadata.roleId,
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

export function createRoleCreatedEvent(
  metadata: RoleEventMetadata,
): Extract<PersistableDomainEvent, { type: "role.created" }> {
  return createRoleEvent({
    type: "role.created",
    metadata,
    payload: {
      roleId: metadata.roleId,
    },
  });
}

export function createRoleUpdatedEvent(
  metadata: RoleEventMetadata,
): Extract<PersistableDomainEvent, { type: "role.updated" }> {
  return createRoleEvent({
    type: "role.updated",
    metadata,
    payload: {
      roleId: metadata.roleId,
    },
  });
}

export function createRoleActivatedEvent(
  metadata: RoleEventMetadata,
): Extract<PersistableDomainEvent, { type: "role.activated" }> {
  return createRoleEvent({
    type: "role.activated",
    metadata,
    payload: {
      roleId: metadata.roleId,
      state: "ACTIVE",
    },
  });
}

export function createRoleDeactivatedEvent(
  metadata: RoleEventMetadata,
): Extract<PersistableDomainEvent, { type: "role.deactivated" }> {
  return createRoleEvent({
    type: "role.deactivated",
    metadata,
    payload: {
      roleId: metadata.roleId,
      state: "INACTIVE",
    },
  });
}

export function createRoleArchivedEvent(
  metadata: RoleEventMetadata,
): Extract<PersistableDomainEvent, { type: "role.archived" }> {
  return createRoleEvent({
    type: "role.archived",
    metadata,
    payload: {
      roleId: metadata.roleId,
      state: "ARCHIVED",
    },
  });
}

export function createRolePermissionsUpdatedEvent(params: {
  readonly roleId: string;
  readonly permissions: readonly string[];
  readonly aggregateVersion: number;
  readonly occurredAt: number;
}): Extract<
  PersistableDomainEvent,
  { type: "role.permissions.updated" }
> {
  return createRoleEvent({
    type: "role.permissions.updated",
    metadata: {
      roleId: params.roleId,
      aggregateVersion: params.aggregateVersion,
      occurredAt: params.occurredAt,
    },
    payload: {
      roleId: params.roleId,
      permissions: [...params.permissions],
    },
  });
}

export function createRoleAssignmentRulesUpdatedEvent(params: {
  readonly roleId: string;
  readonly ruleIds: readonly string[];
  readonly aggregateVersion: number;
  readonly occurredAt: number;
}): Extract<
  PersistableDomainEvent,
  { type: "role.assignment-rules.updated" }
> {
  return createRoleEvent({
    type: "role.assignment-rules.updated",
    metadata: {
      roleId: params.roleId,
      aggregateVersion: params.aggregateVersion,
      occurredAt: params.occurredAt,
    },
    payload: {
      roleId: params.roleId,
      ruleIds: [...params.ruleIds],
    },
  });
}

export function createRoleAssignedToUserEvent(params: {
  readonly roleId: string;
  readonly assignmentId: string;
  readonly userId: string;
  readonly aggregateVersion: number;
  readonly occurredAt: number;
}): Extract<
  PersistableDomainEvent,
  { type: "role.assigned-to-user" }
> {
  return createRoleEvent({
    type: "role.assigned-to-user",
    metadata: {
      roleId: params.roleId,
      aggregateVersion: params.aggregateVersion,
      occurredAt: params.occurredAt,
    },
    payload: {
      roleId: params.roleId,
      assignmentId: params.assignmentId,
      userId: params.userId,
      state: "ACTIVE",
    },
  });
}

export function createRoleRevokedFromUserEvent(params: {
  readonly roleId: string;
  readonly assignmentId: string;
  readonly userId: string;
  readonly aggregateVersion: number;
  readonly occurredAt: number;
}): Extract<
  PersistableDomainEvent,
  { type: "role.revoked-from-user" }
> {
  return createRoleEvent({
    type: "role.revoked-from-user",
    metadata: {
      roleId: params.roleId,
      aggregateVersion: params.aggregateVersion,
      occurredAt: params.occurredAt,
    },
    payload: {
      roleId: params.roleId,
      assignmentId: params.assignmentId,
      userId: params.userId,
      state: "REVOKED",
    },
  });
}
