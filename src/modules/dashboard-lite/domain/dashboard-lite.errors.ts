import { DomainError } from "@core/errors/domain.error";

export class DashboardLiteValidationError extends DomainError {
  constructor(message: string) {
    super(
      "DASHBOARD_LITE_VALIDATION_ERROR",
      message,
      "Invalid dashboard-lite query payload",
      400,
    );
  }
}

export class DashboardLitePermissionScopeError extends DomainError {
  constructor(message: string) {
    super(
      "DASHBOARD_LITE_PERMISSION_SCOPE_ERROR",
      message,
      "Permission or scope denied",
      403,
    );
  }
}

export class DashboardLiteReadinessError extends DomainError {
  constructor(message: string) {
    super(
      "DASHBOARD_LITE_READINESS_ERROR",
      message,
      "Dashboard-lite readiness is not satisfied",
      503,
    );
  }
}
