import { DomainError } from "@core/errors/domain.error";

export class EmploymentProfileValidationError extends DomainError {
  constructor(message: string) {
    super(
      "EMPLOYMENT_PROFILE_VALIDATION_ERROR",
      message,
      "Invalid employment profile payload",
      400,
    );
  }
}

export class EmploymentProfileNotFoundError extends DomainError {
  constructor(employmentProfileId: string) {
    super(
      "EMPLOYMENT_PROFILE_NOT_FOUND",
      `Employment profile not found: ${employmentProfileId}`,
      "Employment profile not found",
      404,
    );
  }
}

export class EmploymentProfileConflictError extends DomainError {
  constructor(message: string) {
    super(
      "EMPLOYMENT_PROFILE_CONFLICT_ERROR",
      message,
      "Employment profile conflict",
      409,
    );
  }
}

export class EmploymentProfileStateError extends DomainError {
  constructor(message: string) {
    super(
      "EMPLOYMENT_PROFILE_STATE_ERROR",
      message,
      "Invalid employment profile state transition",
      409,
    );
  }
}

export class EmploymentProfileManagerCycleError extends DomainError {
  constructor(message: string) {
    super(
      "EMPLOYMENT_PROFILE_MANAGER_CYCLE_ERROR",
      message,
      "Employment profile manager cycle detected",
      409,
    );
  }
}

export class EmploymentProfileInvalidUserLinkageError extends DomainError {
  constructor(message: string) {
    super(
      "EMPLOYMENT_PROFILE_INVALID_USER_LINKAGE",
      message,
      "Employment profile user linkage is invalid",
      409,
    );
  }
}

export class EmploymentProfileInvalidOrgAssignmentError extends DomainError {
  constructor(message: string) {
    super(
      "EMPLOYMENT_PROFILE_INVALID_ORG_ASSIGNMENT",
      message,
      "Employment profile org assignment is invalid",
      409,
    );
  }
}

export class EmploymentProfilePermissionScopeError extends DomainError {
  constructor(message: string) {
    super(
      "EMPLOYMENT_PROFILE_PERMISSION_SCOPE_ERROR",
      message,
      "Permission or scope denied",
      403,
    );
  }
}
