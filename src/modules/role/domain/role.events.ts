import { PersistableDomainEvent } from "@system/event-bridge/domain-event.types";

type RoleEventMetadata = Readonly<{
  roleId: string;
  aggregateVersion: number;
  occurredAt: number;
}>;

function createRoleEvent<TType extends PersistableDomainEvent["type"]>(params: {
  readonly type: TType;
  readonly metadata: RoleEventMetadata;
  readonly payload: Extract<PersistableDomainEvent, { type: TType }>["payload"];
}): Extract<PersistableDomainEvent, { type: TType }> {
  return {
    aggregateId: params.metadata.roleId,
    aggregateVersion: params.metadata.aggregateVersion,
    type: params.type,
    version: 1,
    occurredAt: params.metadata.occurredAt,
    payload: params.payload,
  } as Extract<PersistableDomainEvent, { type: TType }>;
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
}): Extract<PersistableDomainEvent, { type: "role.permissions.updated" }> {
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
}): Extract<PersistableDomainEvent, { type: "role.assignment-rules.updated" }> {
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
}): Extract<PersistableDomainEvent, { type: "role.assigned-to-user" }> {
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
}): Extract<PersistableDomainEvent, { type: "role.revoked-from-user" }> {
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

export function createRoleAssignmentDeadlineSuspendedEvent(params: {
  readonly assignmentId: string;
  readonly userId: string;
  readonly cycleId: string;
  readonly deadline: number;
  readonly reason:
    | "EXPIRED"
    | "MALFORMED_SUCCESSOR"
    | "REVIEW_DEADLINE_UNRESOLVABLE"
    | "REVIEW_OVERDUE"
    | "GRACE_EXPIRED";
  readonly transitionId: string;
  readonly occurredAt: number;
}): Extract<
  PersistableDomainEvent,
  { type: "role.assignment.deadline-suspended" }
> {
  return {
    aggregateId: params.assignmentId,
    aggregateVersion: params.occurredAt,
    type: "role.assignment.deadline-suspended",
    version: 1,
    occurredAt: params.occurredAt,
    payload: {
      assignmentId: params.assignmentId,
      userId: params.userId,
      cycleId: params.cycleId,
      deadline: params.deadline,
      reason: params.reason,
      transitionId: params.transitionId,
    },
  };
}

export function createBreakGlassDeadlineExpiredEvent(params: {
  readonly activationId: string;
  readonly targetUserId: string;
  readonly deadline: number;
  readonly transitionId: string;
  readonly occurredAt: number;
}): Extract<PersistableDomainEvent, { type: "break-glass.deadline-expired" }> {
  return {
    aggregateId: params.activationId,
    aggregateVersion: params.occurredAt,
    type: "break-glass.deadline-expired",
    version: 1,
    occurredAt: params.occurredAt,
    payload: {
      activationId: params.activationId,
      targetUserId: params.targetUserId,
      deadline: params.deadline,
      transitionId: params.transitionId,
    },
  };
}

export function createBreakGlassManuallyEndedEvent(params: {
  readonly activationId: string;
  readonly targetUserId: string;
  readonly endedAt: number;
  readonly endedByUserId: string;
  readonly originalExpiresAt: number;
}): Extract<PersistableDomainEvent, { type: "break-glass.manually-ended" }> {
  return {
    aggregateId: params.activationId,
    aggregateVersion: params.endedAt,
    type: "break-glass.manually-ended",
    version: 1,
    occurredAt: params.endedAt,
    payload: {
      activationId: params.activationId,
      targetUserId: params.targetUserId,
      endedAt: params.endedAt,
      endedByUserId: params.endedByUserId,
      originalExpiresAt: params.originalExpiresAt,
    },
  };
}
