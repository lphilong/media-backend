import { DomainError } from "./domain.error";

export class InvalidStateTransitionError extends DomainError {
  constructor(
    entity: string,
    from: string,
    to: string,
  ) {
    super(
      "INVALID_STATE_TRANSITION",
      `${entity} cannot transition from ${from} to ${to}`,
      "Invalid state transition",
      400,
    );
  }
}
