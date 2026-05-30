import { Request } from "express";
import { readCommand } from "@app/base/command.middleware";
import { PresentationResult } from "@app/base/presentation-result.types";
import { SecureController } from "@app/base/secure-controller.base";
import { Actor } from "@core/actor/actor";
import { ContextType } from "@core/context/context.types";
import { SystemInvariantError } from "@core/error/system-error";
import { SelfServiceValidationError } from "./domain/self-service.errors";
import { SelfServiceTalentGroupListView } from "./domain/self-service.types";
import { SelfServiceTalentGroupExposure } from "./shared/self-service.exposure";
import { SelfServiceTalentGroupsService } from "./self-service.talent-groups.service";

type SelfServiceTalentGroupsCommand = "SELF_SERVICE_TALENT_GROUPS_LIST";

export class SelfServiceTalentGroupsController extends SecureController {
  constructor(private readonly service: SelfServiceTalentGroupsService) {
    super();
  }

  protected async handle(
    req: Request,
    actor: Actor,
    _context: ContextType,
  ): Promise<SelfServiceTalentGroupListView> {
    const command = readCommand<SelfServiceTalentGroupsCommand>(req);

    if (command !== "SELF_SERVICE_TALENT_GROUPS_LIST") {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Self-service talent groups command missing",
      );
    }

    assertNoQueryFields(req.query as Record<string, unknown>);

    return this.service.listCurrentTalentGroups(actor);
  }

  protected async present(
    result: SelfServiceTalentGroupListView,
  ): Promise<PresentationResult> {
    return SelfServiceTalentGroupExposure.exposeList(result);
  }
}

function assertNoQueryFields(query: Record<string, unknown>): void {
  const fields = Object.keys(query);

  if (fields.length === 0) {
    return;
  }

  throw new SelfServiceValidationError(
    `self-service talent groups query contains unsupported field(s): ${fields.join(", ")}`,
  );
}
