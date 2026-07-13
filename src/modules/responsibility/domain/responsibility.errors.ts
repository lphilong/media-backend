import { BaseAppError } from "@core/errors/base.error";

export class ResponsibilityValidationError extends BaseAppError {
  constructor(message: string) {
    super("RESPONSIBILITY_VALIDATION_ERROR", message, message, 400);
  }
}

export class ResponsibilityNotFoundError extends BaseAppError {
  constructor(id: string) {
    super(
      "RESPONSIBILITY_NOT_FOUND",
      `Responsibility assignment not found: ${id}`,
      "Responsibility assignment not found",
      404,
    );
  }
}

export class ResponsibilityConflictError extends BaseAppError {
  constructor(message: string) {
    super("RESPONSIBILITY_CONFLICT", message, message, 409);
  }
}

export class ResponsibilityStateError extends BaseAppError {
  constructor(message: string) {
    super("RESPONSIBILITY_STATE_ERROR", message, message, 409);
  }
}

export class ResponsibilityPermissionScopeError extends BaseAppError {
  constructor(message = "Responsibility assignment is outside the actor's structured scope") {
    super("RESPONSIBILITY_PERMISSION_SCOPE_ERROR", message, "Permission denied", 403);
  }
}
