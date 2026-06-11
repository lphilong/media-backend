import { DomainError } from "@core/errors/domain.error";

export class EmploymentTermsValidationError extends DomainError {
  constructor(message: string) {
    super("EMPLOYMENT_TERMS_VALIDATION_ERROR", message, "Invalid employment terms payload", 400);
  }
}

export class EmploymentTermsNotFoundError extends DomainError {
  constructor(id: string) {
    super("EMPLOYMENT_TERMS_NOT_FOUND", `Employment terms not found: ${id}`, "Employment terms not found", 404);
  }
}

export class EmploymentTermsConflictError extends DomainError {
  constructor(message: string) {
    super("EMPLOYMENT_TERMS_CONFLICT", message, "Employment terms conflict", 409);
  }
}

export class EmploymentTermsStateError extends DomainError {
  constructor(message: string) {
    super("EMPLOYMENT_TERMS_STATE_ERROR", message, "Invalid employment terms state transition", 409);
  }
}
