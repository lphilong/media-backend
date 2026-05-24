import { DomainError } from "@core/errors/domain.error";

export class ReferenceLookupValidationError extends DomainError {
  constructor(message: string) {
    super(
      "REFERENCE_LOOKUP_VALIDATION_ERROR",
      message,
      "Invalid reference lookup request",
      400,
    );
  }
}
