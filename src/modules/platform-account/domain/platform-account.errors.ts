import { DomainError } from "@core/errors/domain.error";

export class PlatformAccountValidationError extends DomainError {
  constructor(message: string) {
    super(
      "PLATFORM_ACCOUNT_VALIDATION_ERROR",
      message,
      "Invalid platform account payload",
      400,
    );
  }
}

export class PlatformAccountNotFoundError extends DomainError {
  constructor(platformAccountId: string) {
    super(
      "PLATFORM_ACCOUNT_NOT_FOUND",
      `Platform account not found: ${platformAccountId}`,
      "Platform account not found",
      404,
    );
  }
}

export class PlatformAccountConflictError extends DomainError {
  constructor(message: string) {
    super(
      "PLATFORM_ACCOUNT_CONFLICT_ERROR",
      message,
      "Platform account conflict",
      409,
    );
  }
}

export class PlatformAccountStateError extends DomainError {
  constructor(message: string) {
    super(
      "PLATFORM_ACCOUNT_STATE_ERROR",
      message,
      "Invalid platform account state transition",
      409,
    );
  }
}

export class PlatformAccountInvalidOwnerReferenceError extends DomainError {
  constructor(message: string) {
    super(
      "PLATFORM_ACCOUNT_INVALID_OWNER_REFERENCE",
      message,
      "Platform account owner reference is invalid",
      409,
    );
  }
}

export class PlatformAccountInvalidPlatformIdentityError extends DomainError {
  constructor(message: string) {
    super(
      "PLATFORM_ACCOUNT_INVALID_PLATFORM_IDENTITY",
      message,
      "Platform account identity is invalid",
      400,
    );
  }
}
