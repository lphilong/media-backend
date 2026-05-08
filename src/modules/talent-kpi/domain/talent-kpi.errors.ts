import { DomainError } from "@core/errors/domain.error";

export class TalentKpiValidationError extends DomainError {
  constructor(message: string) {
    super(
      "TALENT_KPI_VALIDATION_ERROR",
      message,
      "Invalid talent KPI payload",
      400,
    );
  }
}

export class TalentKpiNotFoundError extends DomainError {
  constructor(talentKpiRecordId: string) {
    super(
      "TALENT_KPI_NOT_FOUND",
      `Talent KPI record not found: ${talentKpiRecordId}`,
      "Talent KPI record not found",
      404,
    );
  }
}

export class TalentKpiConflictError extends DomainError {
  constructor(message: string) {
    super(
      "TALENT_KPI_CONFLICT_ERROR",
      message,
      "Talent KPI conflict",
      409,
    );
  }
}

export class TalentKpiStateError extends DomainError {
  constructor(message: string) {
    super(
      "TALENT_KPI_STATE_ERROR",
      message,
      "Invalid talent KPI state transition",
      409,
    );
  }
}

export class TalentKpiInvalidTalentReferenceError extends DomainError {
  constructor(message: string) {
    super(
      "TALENT_KPI_INVALID_TALENT_REFERENCE",
      message,
      "Talent KPI subject talent reference is invalid",
      409,
    );
  }
}

export class TalentKpiInvalidPlatformAttributionError extends DomainError {
  constructor(message: string) {
    super(
      "TALENT_KPI_INVALID_PLATFORM_ATTRIBUTION",
      message,
      "Talent KPI platform attribution is invalid",
      409,
    );
  }
}

export class TalentKpiInvalidEventAttributionError extends DomainError {
  constructor(message: string) {
    super(
      "TALENT_KPI_INVALID_EVENT_ATTRIBUTION",
      message,
      "Talent KPI event attribution is invalid",
      409,
    );
  }
}

export class TalentKpiInvalidMetricValueError extends DomainError {
  constructor(message: string) {
    super(
      "TALENT_KPI_INVALID_METRIC_VALUE",
      message,
      "Talent KPI metric value is invalid",
      409,
    );
  }
}

export class TalentKpiPermissionScopeError extends DomainError {
  constructor(message: string) {
    super(
      "TALENT_KPI_PERMISSION_SCOPE_ERROR",
      message,
      "Permission or scope denied",
      403,
    );
  }
}
