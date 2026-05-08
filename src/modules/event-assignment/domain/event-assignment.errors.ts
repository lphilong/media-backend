import { DomainError } from "@core/errors/domain.error";

export class EventAssignmentValidationError extends DomainError {
  constructor(message: string) {
    super(
      "EVENT_ASSIGNMENT_VALIDATION_ERROR",
      message,
      "Invalid event payload",
      400,
    );
  }
}

export class EventAssignmentNotFoundError extends DomainError {
  constructor(eventId: string) {
    super(
      "EVENT_ASSIGNMENT_NOT_FOUND",
      `Event not found: ${eventId}`,
      "Event not found",
      404,
    );
  }
}

export class EventAssignmentConflictError extends DomainError {
  constructor(message: string) {
    super(
      "EVENT_ASSIGNMENT_CONFLICT_ERROR",
      message,
      "Event conflict",
      409,
    );
  }
}

export class EventAssignmentStateError extends DomainError {
  constructor(message: string) {
    super(
      "EVENT_ASSIGNMENT_STATE_ERROR",
      message,
      "Invalid event state transition",
      409,
    );
  }
}

export class EventAssignmentInvalidAssignmentReferenceError extends DomainError {
  constructor(message: string) {
    super(
      "EVENT_ASSIGNMENT_INVALID_ASSIGNMENT_REFERENCE",
      message,
      "Event assignment reference is invalid",
      409,
    );
  }
}

export class EventAssignmentInvalidResourceReferenceError extends DomainError {
  constructor(message: string) {
    super(
      "EVENT_ASSIGNMENT_INVALID_RESOURCE_REFERENCE",
      message,
      "Event resource reference is invalid",
      409,
    );
  }
}

export class EventAssignmentInvalidPlatformReferenceError extends DomainError {
  constructor(message: string) {
    super(
      "EVENT_ASSIGNMENT_INVALID_PLATFORM_REFERENCE",
      message,
      "Event platform reference is invalid",
      409,
    );
  }
}

export class EventAssignmentOverlapConflictError extends DomainError {
  constructor(message: string) {
    super(
      "EVENT_ASSIGNMENT_OVERLAP_CONFLICT",
      message,
      "Event overlap conflict",
      409,
    );
  }
}

export class EventAssignmentPermissionScopeError extends DomainError {
  constructor(message: string) {
    super(
      "EVENT_ASSIGNMENT_PERMISSION_SCOPE_ERROR",
      message,
      "Permission or scope denied",
      403,
    );
  }
}
