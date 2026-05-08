import { Request } from "express";
import { readCommand } from "@app/base/command.middleware";
import { SecureController } from "@app/base/secure-controller.base";
import { PresentationResult } from "@app/base/presentation-result.types";
import { getPresenterRegistryFromRequest } from "@app/presenter/presenter.runtime-access";
import { Actor } from "@core/actor/actor";
import { ContextType } from "@core/context/context.types";
import { SystemInvariantError } from "@core/error/system-error";
import { WorkScheduleValidationError } from "@modules/work-schedule/domain/work-schedule.errors";
import {
  HOLIDAY_CALENDAR_ADMIN_DETAIL_PRESENTER_KEY,
  HOLIDAY_CALENDAR_ADMIN_LIST_PRESENTER_KEY,
} from "@modules/work-schedule/shared/work-schedule.presenter-keys";
import {
  GetHolidayCalendarDetailQuery,
  ListHolidayCalendarsQuery,
} from "@modules/work-schedule/shared/work-schedule.contracts";
import { HolidayCalendarAdminQueryService } from "./admin.holiday-calendar.query-service";

type HolidayCalendarQueryCommand =
  | "HOLIDAY_CALENDAR_LIST"
  | "HOLIDAY_CALENDAR_GET_DETAIL";

const LIST_HOLIDAY_CALENDARS_QUERY_FIELDS: readonly string[] =
  Object.freeze([
    "status",
    "limit",
    "cursor",
    "search",
  ]);

const GET_HOLIDAY_CALENDAR_DETAIL_QUERY_FIELDS: readonly string[] =
  Object.freeze([]);

export class HolidayCalendarAdminQueryController extends SecureController {
  constructor(
    private readonly service: HolidayCalendarAdminQueryService,
  ) {
    super();
  }

  protected async handle(
    req: Request,
    actor: Actor,
    _context: ContextType,
  ): Promise<unknown> {
    const command =
      readCommand<HolidayCalendarQueryCommand>(req);

    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Holiday calendar query command missing",
      );
    }

    switch (command) {
      case "HOLIDAY_CALENDAR_LIST":
        return this.service.listHolidayCalendars(
          actor,
          parseListHolidayCalendarsQuery(req),
        );

      case "HOLIDAY_CALENDAR_GET_DETAIL":
        return this.service.getHolidayCalendarDetail(
          actor,
          parseGetHolidayCalendarDetailQuery(req),
        );

      default:
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          `Unsupported holiday calendar query command: ${command}`,
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
      readCommand<HolidayCalendarQueryCommand>(req);

    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Holiday calendar query command missing",
      );
    }

    const registry = getPresenterRegistryFromRequest(req);

    switch (command) {
      case "HOLIDAY_CALENDAR_LIST":
        return registry
          .get<unknown, PresentationResult>(
            HOLIDAY_CALENDAR_ADMIN_LIST_PRESENTER_KEY,
          )
          .present(result, context);

      case "HOLIDAY_CALENDAR_GET_DETAIL":
        return registry
          .get<unknown, PresentationResult>(
            HOLIDAY_CALENDAR_ADMIN_DETAIL_PRESENTER_KEY,
          )
          .present(result, context);

      default:
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          `Unsupported holiday calendar query command: ${command}`,
        );
    }
  }
}

function parseListHolidayCalendarsQuery(
  req: Request,
): ListHolidayCalendarsQuery {
  assertNoUnexpectedQueryFields(
    req.query as Record<string, unknown>,
    LIST_HOLIDAY_CALENDARS_QUERY_FIELDS,
    "listHolidayCalendars",
  );

  return {
    status: req.query.status as string | undefined,
    limit: req.query.limit as string | undefined,
    cursor: req.query.cursor as string | undefined,
    search: req.query.search as string | undefined,
  };
}

function parseGetHolidayCalendarDetailQuery(
  req: Request,
): GetHolidayCalendarDetailQuery {
  assertNoUnexpectedQueryFields(
    req.query as Record<string, unknown>,
    GET_HOLIDAY_CALENDAR_DETAIL_QUERY_FIELDS,
    "getHolidayCalendarDetail",
  );

  return {
    holidayCalendarId: req.params.holidayCalendarId,
  };
}

function assertNoUnexpectedQueryFields(
  query: Record<string, unknown>,
  allowedFields: readonly string[],
  queryName: string,
): void {
  const unexpectedFields = Object.keys(query).filter(
    (field) => !allowedFields.includes(field),
  );

  if (unexpectedFields.length === 0) {
    return;
  }

  throw new WorkScheduleValidationError(
    `${queryName} query contains unsupported field(s): ${unexpectedFields.join(", ")}`,
  );
}
