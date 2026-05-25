import { DomainError } from "@core/errors/domain.error";

export class SelfServiceCurrentPersonNotLinkedError extends DomainError {
  constructor() {
    super(
      "SELF_SERVICE_CURRENT_PERSON_NOT_LINKED",
      "Current actor is not linked to a non-archived EmploymentProfile",
      "No linked Employment Profile",
      404,
    );
  }
}
