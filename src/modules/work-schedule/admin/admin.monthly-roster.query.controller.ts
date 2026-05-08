import { Request } from "express";
import { readCommand } from "@app/base/command.middleware";
import { SecureController } from "@app/base/secure-controller.base";
import { PresentationResult } from "@app/base/presentation-result.types";
import { getPresenterRegistryFromRequest } from "@app/presenter/presenter.runtime-access";
import { Actor } from "@core/actor/actor";
import { ContextType } from "@core/context/context.types";
import { SystemInvariantError } from "@core/error/system-error";
import {
  MONTHLY_ROSTER_ADMIN_DETAIL_PRESENTER_KEY,
  MONTHLY_ROSTER_ADMIN_LIST_PRESENTER_KEY,
  MONTHLY_ROSTER_ADMIN_PREVIEW_PRESENTER_KEY,
} from "@modules/work-schedule/shared/work-schedule.presenter-keys";
import {
  GetMonthlyRosterDetailQuery,
  ListMonthlyRostersQuery,
  PreviewMonthlyRosterQuery,
} from "@modules/work-schedule/shared/work-schedule.contracts";
import { MonthlyRosterAdminQueryService } from "./admin.monthly-roster.query-service";

type MonthlyRosterQueryCommand =
  | "MONTHLY_ROSTER_LIST"
  | "MONTHLY_ROSTER_GET_DETAIL"
  | "MONTHLY_ROSTER_PREVIEW";

export class MonthlyRosterAdminQueryController extends SecureController {
  constructor(
    private readonly service: MonthlyRosterAdminQueryService,
  ) {
    super();
  }

  protected async handle(
    req: Request,
    actor: Actor,
    _context: ContextType,
  ): Promise<unknown> {
    const command =
      readCommand<MonthlyRosterQueryCommand>(req);

    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Monthly Roster query command missing",
      );
    }

    switch (command) {
      case "MONTHLY_ROSTER_LIST":
        return this.service.listMonthlyRosters(
          actor,
          parseListMonthlyRostersQuery(req),
        );

      case "MONTHLY_ROSTER_GET_DETAIL":
        return this.service.getMonthlyRosterDetail(
          actor,
          parseGetMonthlyRosterDetailQuery(req),
        );

      case "MONTHLY_ROSTER_PREVIEW":
        return this.service.previewMonthlyRoster(
          actor,
          parsePreviewMonthlyRosterQuery(req),
        );

      default:
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          `Unsupported Monthly Roster query command: ${command}`,
        );
    }
  }

  protected async present(
    result: unknown,
    req: Request,
    _actor: Actor,
    context: ContextType,
  ): Promise<PresentationResult> {
    const command =
      readCommand<MonthlyRosterQueryCommand>(req);
    const key = presenterKeyForCommand(command);

    return getPresenterRegistryFromRequest(req)
      .get<unknown, PresentationResult>(key)
      .present(result, context);
  }
}

function parseListMonthlyRostersQuery(
  req: Request,
): ListMonthlyRostersQuery {
  return {
    status: req.query.status as string | undefined,
    rosterMonth:
      req.query.rosterMonth as string | undefined,
    departmentOrgUnitId:
      req.query.departmentOrgUnitId as
        | string
        | undefined,
    workPatternId:
      req.query.workPatternId as string | undefined,
    holidayCalendarId:
      req.query.holidayCalendarId as
        | string
        | undefined,
    limit: req.query.limit as string | undefined,
    cursor: req.query.cursor as string | undefined,
    search: req.query.search as string | undefined,
    scope: req.query.scope as string | undefined,
  };
}

function parseGetMonthlyRosterDetailQuery(
  req: Request,
): GetMonthlyRosterDetailQuery {
  return {
    monthlyRosterId: req.params.monthlyRosterId,
    scope: req.query.scope as string | undefined,
  };
}

function parsePreviewMonthlyRosterQuery(
  req: Request,
): PreviewMonthlyRosterQuery {
  return {
    monthlyRosterId: req.params.monthlyRosterId,
    scope: req.query.scope as string | undefined,
  };
}

function presenterKeyForCommand(
  command: MonthlyRosterQueryCommand | undefined,
): string {
  switch (command) {
    case "MONTHLY_ROSTER_LIST":
      return MONTHLY_ROSTER_ADMIN_LIST_PRESENTER_KEY;

    case "MONTHLY_ROSTER_PREVIEW":
      return MONTHLY_ROSTER_ADMIN_PREVIEW_PRESENTER_KEY;

    case "MONTHLY_ROSTER_GET_DETAIL":
    default:
      return MONTHLY_ROSTER_ADMIN_DETAIL_PRESENTER_KEY;
  }
}
