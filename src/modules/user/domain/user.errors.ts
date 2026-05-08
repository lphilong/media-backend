import { DomainError } from "@core/errors/domain.error";
import { UserAccountStatus } from "./user.types";

export class UserValidationError extends DomainError {
  constructor(message: string) {
    super(
      "USER_VALIDATION_ERROR",
      message,
      "Invalid user payload",
      400,
    );
  }
}

export class UserStateError extends DomainError {
  constructor(message: string) {
    super(
      "USER_STATE_ERROR",
      message,
      "Invalid user lifecycle transition",
      409,
    );
  }
}

export class UserConflictError extends DomainError {
  constructor(message: string) {
    super(
      "USER_CONFLICT_ERROR",
      message,
      "User conflict",
      409,
    );
  }
}

export class UserNotFoundError extends DomainError {
  constructor(id: string) {
    super(
      "USER_NOT_FOUND",
      `User not found: ${id}`,
      "User not found",
      404,
    );
  }
}

export class UserDependencyError extends DomainError {
  constructor(message: string) {
    super(
      "USER_DEPENDENCY_ERROR",
      message,
      "Required dependency is unavailable",
      409,
    );
  }
}

export class UserDuplicateAuthLinkageError extends UserConflictError {
  constructor(authSubject: string) {
    super(
      `Duplicate auth linkage for subject: ${authSubject}`,
    );
  }
}

export class UserInvalidStateTransitionError extends UserStateError {
  constructor(from: UserAccountStatus, to: UserAccountStatus) {
    super(
      `User cannot transition from ${from} to ${to}`,
    );
  }
}

export class UserArchivedEditForbiddenError extends UserStateError {
  constructor(id: string) {
    super(
      `User is archived and cannot be edited: ${id}`,
    );
  }
}

export class UserInactiveActorResolutionError extends DomainError {
  constructor(reason: string) {
    super(
      "USER_INACTIVE_ACTOR_RESOLUTION",
      `Actor resolution denied: ${reason}`,
      "Access denied",
      403,
    );
  }
}
