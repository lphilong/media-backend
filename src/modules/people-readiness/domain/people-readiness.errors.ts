import { DomainError } from "@core/errors/domain.error";

export class PeopleReadinessValidationError extends DomainError {
  constructor(message: string) {
    super(
      "PEOPLE_READINESS_VALIDATION_ERROR",
      message,
      "Invalid People Readiness query payload",
      400,
    );
  }
}
