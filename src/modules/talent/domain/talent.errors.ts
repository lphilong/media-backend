import { DomainError } from "@core/errors/domain.error";

export class TalentValidationError extends DomainError {
  constructor(message: string) {
    super(
      "TALENT_VALIDATION_ERROR",
      message,
      "Invalid talent payload",
      400,
    );
  }
}

export class TalentNotFoundError extends DomainError {
  constructor(talentId: string) {
    super(
      "TALENT_NOT_FOUND",
      `Talent not found: ${talentId}`,
      "Talent not found",
      404,
    );
  }
}

export class TalentConflictError extends DomainError {
  constructor(message: string) {
    super(
      "TALENT_CONFLICT_ERROR",
      message,
      "Talent conflict",
      409,
    );
  }
}

export class TalentStateError extends DomainError {
  constructor(message: string) {
    super(
      "TALENT_STATE_ERROR",
      message,
      "Invalid talent state transition",
      409,
    );
  }
}

export class TalentInvalidEmploymentLinkageError extends DomainError {
  constructor(message: string) {
    super(
      "TALENT_INVALID_EMPLOYMENT_LINKAGE",
      message,
      "Talent employment linkage is invalid",
      409,
    );
  }
}

export class TalentInvalidManagerLinkageError extends DomainError {
  constructor(message: string) {
    super(
      "TALENT_INVALID_MANAGER_LINKAGE",
      message,
      "Talent manager linkage is invalid",
      409,
    );
  }
}
