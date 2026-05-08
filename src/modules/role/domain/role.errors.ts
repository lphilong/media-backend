import { DomainError } from "@core/errors/domain.error";

export class RoleValidationError extends DomainError {
  constructor(message: string) {
    super(
      "ROLE_VALIDATION_ERROR",
      message,
      "Invalid role payload",
      400,
    );
  }
}

export class RoleNotFoundError extends DomainError {
  constructor(roleId: string) {
    super(
      "ROLE_NOT_FOUND",
      `Role not found: ${roleId}`,
      "Role not found",
      404,
    );
  }
}

export class RoleStateError extends DomainError {
  constructor(message: string) {
    super(
      "ROLE_STATE_ERROR",
      message,
      "Invalid role state transition",
      409,
    );
  }
}

export class RoleConflictError extends DomainError {
  constructor(message: string) {
    super(
      "ROLE_CONFLICT_ERROR",
      message,
      "Role conflict",
      409,
    );
  }
}

export class RoleAssignmentConflictError extends DomainError {
  constructor(message: string) {
    super(
      "ROLE_ASSIGNMENT_CONFLICT_ERROR",
      message,
      "Role assignment conflict",
      409,
    );
  }
}

export class RoleAssignmentNotFoundError extends DomainError {
  constructor(assignmentId: string) {
    super(
      "ROLE_ASSIGNMENT_NOT_FOUND",
      `Role assignment not found: ${assignmentId}`,
      "Role assignment not found",
      404,
    );
  }
}

export class RoleDependencyError extends DomainError {
  constructor(message: string) {
    super(
      "ROLE_DEPENDENCY_ERROR",
      message,
      "Required dependency is unavailable",
      409,
    );
  }
}
