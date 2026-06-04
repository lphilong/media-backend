import { Request } from "express";
import { readCommand } from "@app/base/command.middleware";
import { SecureController } from "@app/base/secure-controller.base";
import {
  PresentationResult,
  toPlainObject,
} from "@app/base/presentation-result.types";
import { Actor } from "@core/actor/actor";
import { ContextType } from "@core/context/context.types";
import { SystemInvariantError } from "@core/error/system-error";
import {
  ManagerWorkspaceAdminService,
  ManagerWorkspaceContextView,
} from "./admin.manager-workspace.service";

type ManagerWorkspaceCommand = "MANAGER_WORKSPACE_CONTEXT";

export class ManagerWorkspaceAdminController extends SecureController {
  constructor(private readonly service: ManagerWorkspaceAdminService) {
    super();
  }

  protected async handle(
    req: Request,
    actor: Actor,
    _context: ContextType,
  ): Promise<ManagerWorkspaceContextView> {
    const command = readCommand<ManagerWorkspaceCommand>(req);
    if (command !== "MANAGER_WORKSPACE_CONTEXT") {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Manager workspace command missing",
      );
    }

    return this.service.getContext(actor);
  }

  protected async present(
    result: ManagerWorkspaceContextView,
    _req: Request,
    _actor: Actor,
    _context: ContextType,
  ): Promise<PresentationResult> {
    return {
      data: toPlainObject(result, "managerWorkspaceContext"),
    };
  }
}
