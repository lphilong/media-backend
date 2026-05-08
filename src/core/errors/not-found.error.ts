import { DomainError } from "./domain.error";

export class EntityNotFoundError extends DomainError {
  constructor(entity: string, id: string) {
    super(
      "ENTITY_NOT_FOUND",
      `${entity} not found: ${id}`,
      `${entity} not found`,
      404,
    );
  }
}
