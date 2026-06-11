import { DomainError } from "@core/errors/domain.error";

export class SelfServiceCurrentPersonNotLinkedError extends DomainError {
  constructor() {
    super(
      "SELF_SERVICE_CURRENT_PERSON_NOT_LINKED",
      "Current actor is not linked to a non-archived EmploymentProfile",
      "No linked Employment Profile",
      404,
    );
  }
}

export class SelfServiceProfileNotOperationalError extends DomainError {
  constructor() {
    super(
      "SELF_SERVICE_PROFILE_NOT_OPERATIONAL",
      "Self-Service access denied because the linked EmploymentProfile is not operational",
      "Self-Service access is not available for this profile status.",
      403,
    );
  }
}

export class SelfServiceValidationError extends DomainError {
  constructor(message: string) {
    super(
      "SELF_SERVICE_VALIDATION_ERROR",
      message,
      "Invalid self-service request",
      400,
    );
  }
}
