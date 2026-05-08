import { DomainError } from "@core/errors/domain.error";

export class CommissionValidationError extends DomainError {
  constructor(message: string) {
    super(
      "COMMISSION_VALIDATION_ERROR",
      message,
      "Invalid commission payload",
      400,
    );
  }
}

export class CommissionNotFoundError extends DomainError {
  constructor(entity: "rule" | "settlement", id: string) {
    super(
      "COMMISSION_NOT_FOUND",
      `${entity} not found: ${id}`,
      "Commission record not found",
      404,
    );
  }
}

export class CommissionConflictError extends DomainError {
  constructor(message: string) {
    super(
      "COMMISSION_CONFLICT_ERROR",
      message,
      "Commission conflict",
      409,
    );
  }
}

export class CommissionStateError extends DomainError {
  constructor(message: string) {
    super(
      "COMMISSION_STATE_ERROR",
      message,
      "Invalid commission state transition",
      409,
    );
  }
}

export class CommissionInvalidBeneficiaryReferenceError extends DomainError {
  constructor(message: string) {
    super(
      "COMMISSION_INVALID_BENEFICIARY_REFERENCE",
      message,
      "Commission beneficiary reference is invalid",
      409,
    );
  }
}

export class CommissionInvalidContractRecordReferenceError extends DomainError {
  constructor(message: string) {
    super(
      "COMMISSION_INVALID_CONTRACT_RECORD_REFERENCE",
      message,
      "Commission source contract reference is invalid",
      409,
    );
  }
}

export class CommissionInvalidRevenueEntrySelectionError extends DomainError {
  constructor(message: string) {
    super(
      "COMMISSION_INVALID_REVENUE_ENTRY_SELECTION",
      message,
      "Commission revenue entry selection is invalid",
      409,
    );
  }
}

export class CommissionSettlementExclusivityConflictError extends DomainError {
  constructor(message: string) {
    super(
      "COMMISSION_SETTLEMENT_EXCLUSIVITY_CONFLICT",
      message,
      "Commission settlement exclusivity conflict",
      409,
    );
  }
}

export class CommissionInvalidRateError extends DomainError {
  constructor(message: string) {
    super(
      "COMMISSION_INVALID_RATE",
      message,
      "Commission rate is invalid",
      409,
    );
  }
}

export class CommissionPermissionScopeError extends DomainError {
  constructor(message: string) {
    super(
      "COMMISSION_PERMISSION_SCOPE_ERROR",
      message,
      "Permission or scope denied",
      403,
    );
  }
}
