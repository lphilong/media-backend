import { DomainError } from "@core/errors/domain.error";

export class KpiValidationError extends DomainError {
  constructor(message: string) {
    super("KPI_VALIDATION_ERROR", message, "Invalid KPI payload", 400);
  }
}

export class KpiNotFoundError extends DomainError {
  constructor(kpiPlanId: string) {
    super(
      "KPI_PLAN_NOT_FOUND",
      `KPI plan not found: ${kpiPlanId}`,
      "KPI plan not found",
      404,
    );
  }
}
export class KpiConflictError extends DomainError {
  constructor(message: string) {
    super("KPI_CONFLICT_ERROR", message, "KPI conflict", 409);
  }
}

export class KpiStateError extends DomainError {
  constructor(message: string) {
    super(
      "KPI_STATE_ERROR",
      message,
      "Invalid KPI plan state transition",
      409,
    );
  }
}

export class KpiInvalidSubjectReferenceError extends DomainError {
  constructor(message: string) {
    super(
      "KPI_INVALID_SUBJECT_REFERENCE",
      message,
      "KPI subject reference is invalid",
      409,
    );
  }
}

export class KpiInvalidAllocationError extends DomainError {
  constructor(message: string) {
    super(
      "KPI_INVALID_ALLOCATION",
      message,
      "KPI allocation is invalid",
      409,
    );
  }
}

export class KpiPermissionScopeError extends DomainError {
  constructor(message: string) {
    super(
      "KPI_PERMISSION_SCOPE_ERROR",
      message,
      "Permission or scope denied",
      403,
    );
  }
}
