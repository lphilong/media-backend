import { Request } from "express";
import { readCommand } from "@app/base/command.middleware";
import { PresentationResult } from "@app/base/presentation-result.types";
import { SecureController } from "@app/base/secure-controller.base";
import { Actor } from "@core/actor/actor";
import { ContextType } from "@core/context/context.types";
import { SystemInvariantError } from "@core/error/system-error";
import { SelfServiceValidationError } from "./domain/self-service.errors";
import { SelfServiceKpiListView } from "./domain/self-service.types";
import { SelfServiceKpiExposure } from "./shared/self-service.exposure";
import { SelfServiceKpiService } from "./self-service.kpi.service";

type SelfServiceKpiCommand = "SELF_SERVICE_KPI_LIST";

export class SelfServiceKpiController extends SecureController {
  constructor(private readonly service: SelfServiceKpiService) {
    super();
  }

  protected async handle(
    req: Request,
    actor: Actor,
    _context: ContextType,
  ): Promise<SelfServiceKpiListView> {
    const command = readCommand<SelfServiceKpiCommand>(req);

    if (command !== "SELF_SERVICE_KPI_LIST") {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Self-service KPI command missing",
      );
    }

    assertNoQueryFields(req.query as Record<string, unknown>);

    return this.service.listCurrentKpi(actor);
  }

  protected async present(
    result: SelfServiceKpiListView,
  ): Promise<PresentationResult> {
    return SelfServiceKpiExposure.exposeList(result);
  }
}

function assertNoQueryFields(query: Record<string, unknown>): void {
  const fields = Object.keys(query);

  if (fields.length === 0) {
    return;
  }

  throw new SelfServiceValidationError(
    `self-service KPI query contains unsupported field(s): ${fields.join(", ")}`,
  );
}
