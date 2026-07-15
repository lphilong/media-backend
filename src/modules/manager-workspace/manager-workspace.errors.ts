import { DomainError } from "@core/errors/domain.error";

export class ManagerWorkspaceValidationError extends DomainError {
  constructor(message: string) {
    super(
      "MANAGER_WORKSPACE_VALIDATION_ERROR",
      message,
      "Invalid Manager Workspace request",
      400,
    );
  }
}

export class ManagerWorkspaceScopeNotFoundError extends DomainError {
  constructor() {
    super(
      "RESOURCE_NOT_FOUND",
      "Managed resource was not found in the actor's exact scope",
      "Managed resource not found",
      404,
    );
  }
}
