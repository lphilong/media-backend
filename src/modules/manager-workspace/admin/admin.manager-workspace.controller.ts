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
import {
  ManagerWorkspaceWorkScheduleAdminService,
  ManagerWorkShiftListView,
} from "./admin.manager-workspace-work-schedule.service";

type ManagerWorkspaceCommand =
  | "MANAGER_WORKSPACE_CONTEXT"
  | "MANAGER_WORKSPACE_LIST_WORK_SHIFTS";

export class ManagerWorkspaceAdminController extends SecureController {
  constructor(
    private readonly service: ManagerWorkspaceAdminService,
    private readonly workScheduleService: ManagerWorkspaceWorkScheduleAdminService,
  ) {
    super();
  }

  protected async handle(
    req: Request,
    actor: Actor,
    _context: ContextType,
  ): Promise<ManagerWorkspaceContextView | ManagerWorkShiftListView> {
    const command = readCommand<ManagerWorkspaceCommand>(req);
    if (command === "MANAGER_WORKSPACE_CONTEXT") {
      return this.service.getContext(actor);
    }

    if (command === "MANAGER_WORKSPACE_LIST_WORK_SHIFTS") {
      return this.workScheduleService.listWorkShifts(actor, {
        month: readOptionalQuery(req, "month"),
        sourceType: readOptionalQuery(req, "sourceType"),
        search: readOptionalQuery(req, "search"),
        cursor: readOptionalQuery(req, "cursor"),
      });
    }

    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      "Manager workspace command missing",
    );
  }

  protected async present(
    result: ManagerWorkspaceContextView | ManagerWorkShiftListView,
    _req: Request,
    _actor: Actor,
    _context: ContextType,
  ): Promise<PresentationResult> {
    return {
      data: toPlainObject(result, "managerWorkspaceContext"),
    };
  }
}

function readOptionalQuery(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}
