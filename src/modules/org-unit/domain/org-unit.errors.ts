import { DomainError } from "@core/errors/domain.error";

export class OrgUnitValidationError extends DomainError {
  constructor(message: string) {
    super(
      "ORG_UNIT_VALIDATION_ERROR",
      message,
      "Invalid org unit payload",
      400,
    );
  }
}

export class OrgUnitNotFoundError extends DomainError {
  constructor(orgUnitId: string) {
    super(
      "ORG_UNIT_NOT_FOUND",
      `Org unit not found: ${orgUnitId}`,
      "Org unit not found",
      404,
    );
  }
}

export class OrgUnitConflictError extends DomainError {
  constructor(message: string) {
    super(
      "ORG_UNIT_CONFLICT_ERROR",
      message,
      "Org unit conflict",
      409,
    );
  }
}

export class OrgUnitStateError extends DomainError {
  constructor(message: string) {
    super(
      "ORG_UNIT_STATE_ERROR",
      message,
      "Invalid org unit state transition",
      409,
    );
  }
}

export class OrgUnitHierarchyCycleError extends DomainError {
  constructor(message: string) {
    super(
      "ORG_UNIT_HIERARCHY_CYCLE_ERROR",
      message,
      "Org unit hierarchy cycle detected",
      409,
    );
  }
}

export class OrgUnitParentStateError extends DomainError {
  constructor(message: string) {
    super(
      "ORG_UNIT_PARENT_STATE_ERROR",
      message,
      "Parent org unit state is invalid",
      409,
    );
  }
}

export class OrgUnitPermissionScopeError extends DomainError {
  constructor(message: string) {
    super(
      "ORG_UNIT_PERMISSION_SCOPE_ERROR",
      message,
      "Permission or scope denied",
      403,
    );
  }
}
