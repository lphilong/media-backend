import { DomainError } from "@core/errors/domain.error";

export class RevenueLedgerValidationError extends DomainError {
  constructor(message: string) {
    super(
      "REVENUE_LEDGER_VALIDATION_ERROR",
      message,
      "Invalid revenue ledger payload",
      400,
    );
  }
}

export class RevenueLedgerNotFoundError extends DomainError {
  constructor(revenueEntryId: string) {
    super(
      "REVENUE_LEDGER_NOT_FOUND",
      `Revenue entry not found: ${revenueEntryId}`,
      "Revenue entry not found",
      404,
    );
  }
}

export class RevenueLedgerConflictError extends DomainError {
  constructor(message: string) {
    super(
      "REVENUE_LEDGER_CONFLICT_ERROR",
      message,
      "Revenue ledger conflict",
      409,
    );
  }
}

export class RevenueLedgerStateError extends DomainError {
  constructor(message: string) {
    super(
      "REVENUE_LEDGER_STATE_ERROR",
      message,
      "Invalid revenue entry state transition",
      409,
    );
  }
}

export class RevenueLedgerInvalidTalentReferenceError extends DomainError {
  constructor(message: string) {
    super(
      "REVENUE_LEDGER_INVALID_TALENT_REFERENCE",
      message,
      "Revenue ledger subject talent reference is invalid",
      409,
    );
  }
}

export class RevenueLedgerInvalidPlatformAttributionError extends DomainError {
  constructor(message: string) {
    super(
      "REVENUE_LEDGER_INVALID_PLATFORM_ATTRIBUTION",
      message,
      "Revenue ledger platform attribution is invalid",
      409,
    );
  }
}

export class RevenueLedgerInvalidEventAttributionError extends DomainError {
  constructor(message: string) {
    super(
      "REVENUE_LEDGER_INVALID_EVENT_ATTRIBUTION",
      message,
      "Revenue ledger event attribution is invalid",
      409,
    );
  }
}

export class RevenueLedgerInvalidCurrencyCodeError extends DomainError {
  constructor(message: string) {
    super(
      "REVENUE_LEDGER_INVALID_CURRENCY_CODE",
      message,
      "Revenue ledger currency code is invalid",
      409,
    );
  }
}

export class RevenueLedgerInvalidRevenueAmountError extends DomainError {
  constructor(message: string) {
    super(
      "REVENUE_LEDGER_INVALID_REVENUE_AMOUNT",
      message,
      "Revenue ledger recognized amount is invalid",
      409,
    );
  }
}

export class RevenueLedgerPermissionScopeError extends DomainError {
  constructor(message: string) {
    super(
      "REVENUE_LEDGER_PERMISSION_SCOPE_ERROR",
      message,
      "Permission or scope denied",
      403,
    );
  }
}
