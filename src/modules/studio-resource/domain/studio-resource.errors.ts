import { DomainError } from "@core/errors/domain.error";

export class StudioResourceValidationError extends DomainError {
  constructor(message: string) {
    super(
      "STUDIO_RESOURCE_VALIDATION_ERROR",
      message,
      "Invalid studio resource payload",
      400,
    );
  }
}

export class StudioResourceNotFoundError extends DomainError {
  constructor(studioResourceId: string) {
    super(
      "STUDIO_RESOURCE_NOT_FOUND",
      `Studio resource not found: ${studioResourceId}`,
      "Studio resource not found",
      404,
    );
  }
}

export class StudioResourceConflictError extends DomainError {
  constructor(message: string) {
    super(
      "STUDIO_RESOURCE_CONFLICT_ERROR",
      message,
      "Studio resource conflict",
      409,
    );
  }
}

export class StudioResourceStateError extends DomainError {
  constructor(message: string) {
    super(
      "STUDIO_RESOURCE_STATE_ERROR",
      message,
      "Invalid studio resource state",
      409,
    );
  }
}

export class StudioResourceInvalidResourceShapeError extends DomainError {
  constructor(message: string) {
    super(
      "STUDIO_RESOURCE_INVALID_RESOURCE_SHAPE",
      message,
      "Studio resource shape is invalid",
      400,
    );
  }
}

export class StudioResourceInvalidOperationalStatusError extends DomainError {
  constructor(message: string) {
    super(
      "STUDIO_RESOURCE_INVALID_OPERATIONAL_STATUS",
      message,
      "Studio resource operational status is invalid",
      409,
    );
  }
}
