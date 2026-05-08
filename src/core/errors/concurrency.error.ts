import { DomainError } from "./domain.error";

export class ConcurrencyConflictError extends DomainError {
  constructor(entity: string) {
    super(
      "CONCURRENCY_CONFLICT",
      `${entity} version conflict`,
      "Resource modified by another request",
      409,
    );
  }
}
