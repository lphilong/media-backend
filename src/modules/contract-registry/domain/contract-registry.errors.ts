import { DomainError } from "@core/errors/domain.error";

export class ContractRegistryValidationError extends DomainError {
  constructor(message: string) {
    super(
      "CONTRACT_REGISTRY_VALIDATION_ERROR",
      message,
      "Invalid contract registry payload",
      400,
    );
  }
}

export class ContractRegistryNotFoundError extends DomainError {
  constructor(contractRecordId: string) {
    super(
      "CONTRACT_REGISTRY_NOT_FOUND",
      `Contract record not found: ${contractRecordId}`,
      "Contract record not found",
      404,
    );
  }
}

export class ContractRegistryConflictError extends DomainError {
  constructor(message: string) {
    super(
      "CONTRACT_REGISTRY_CONFLICT_ERROR",
      message,
      "Contract registry conflict",
      409,
    );
  }
}

export class ContractRegistryStateError extends DomainError {
  constructor(message: string) {
    super(
      "CONTRACT_REGISTRY_STATE_ERROR",
      message,
      "Invalid contract registry state",
      409,
    );
  }
}

export class ContractRegistryInvalidLinkedEntityReferenceError extends DomainError {
  constructor(message: string) {
    super(
      "CONTRACT_REGISTRY_INVALID_LINKED_ENTITY_REFERENCE",
      message,
      "Contract linked entity reference is invalid",
      409,
    );
  }
}

export class ContractRegistryInvalidOwnerReferenceError extends DomainError {
  constructor(message: string) {
    super(
      "CONTRACT_REGISTRY_INVALID_OWNER_REFERENCE",
      message,
      "Contract owner reference is invalid",
      409,
    );
  }
}

export class ContractRegistryInvalidFileReferenceMetadataError extends DomainError {
  constructor(message: string) {
    super(
      "CONTRACT_REGISTRY_INVALID_FILE_REFERENCE_METADATA",
      message,
      "Contract file reference metadata is invalid",
      409,
    );
  }
}

export class ContractRegistryPermissionScopeError extends DomainError {
  constructor(message: string) {
    super(
      "CONTRACT_REGISTRY_PERMISSION_SCOPE_ERROR",
      message,
      "Permission or scope denied",
      403,
    );
  }
}
