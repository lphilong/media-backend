import { Request } from "express";
import { readCommand } from "@app/base/command.middleware";
import { SecureController } from "@app/base/secure-controller.base";
import { PresentationResult } from "@app/base/presentation-result.types";
import { Actor } from "@core/actor/actor";
import { ContextType } from "@core/context/context.types";
import { SystemInvariantError } from "@core/error/system-error";
import { SelfServiceCurrentPersonService } from "./self-service.current-person.service";
import { SelfServiceCurrentPersonView } from "./domain/self-service.types";
import { SelfServiceCurrentPersonExposure } from "./shared/self-service.exposure";

type SelfServiceCurrentPersonCommand = "SELF_SERVICE_CURRENT_PERSON";

export class SelfServiceCurrentPersonController extends SecureController {
  constructor(
    private readonly service: SelfServiceCurrentPersonService,
  ) {
    super();
  }

  protected async handle(
    req: Request,
    actor: Actor,
    _context: ContextType,
  ): Promise<SelfServiceCurrentPersonView> {
    const command = readCommand<SelfServiceCurrentPersonCommand>(req);

    if (command !== "SELF_SERVICE_CURRENT_PERSON") {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Self-service current person command missing",
      );
    }

    return this.service.getCurrentPerson(actor);
  }

  protected async present(
    result: SelfServiceCurrentPersonView,
  ): Promise<PresentationResult> {
    return {
      data: SelfServiceCurrentPersonExposure.expose(result),
    };
  }
}
