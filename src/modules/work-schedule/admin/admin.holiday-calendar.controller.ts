import { Request } from "express";
import { readCommand } from "@app/base/command.middleware";
import { SecureController } from "@app/base/secure-controller.base";
import { PresentationResult } from "@app/base/presentation-result.types";
import { getPresenterRegistryFromRequest } from "@app/presenter/presenter.runtime-access";
import { Actor } from "@core/actor/actor";
import { ContextType } from "@core/context/context.types";
import { SystemInvariantError } from "@core/error/system-error";
import { WorkScheduleValidationError } from "@modules/work-schedule/domain/work-schedule.errors";
import { HOLIDAY_CALENDAR_ADMIN_MUTATION_PRESENTER_KEY } from "@modules/work-schedule/shared/work-schedule.presenter-keys";
import {
  AddHolidayCalendarEntryCommand,
  CreateHolidayCalendarCommand,
  HolidayCalendarLifecycleCommand,
  RemoveHolidayCalendarEntryCommand,
  UpdateHolidayCalendarCommand,
  UpdateHolidayCalendarEntryCommand,
} from "@modules/work-schedule/shared/work-schedule.contracts";
import { HolidayCalendarAdminService } from "./admin.holiday-calendar.service";

type HolidayCalendarMutationCommand =
  | "HOLIDAY_CALENDAR_CREATE"
  | "HOLIDAY_CALENDAR_UPDATE"
  | "HOLIDAY_CALENDAR_ACTIVATE"
  | "HOLIDAY_CALENDAR_ARCHIVE"
  | "HOLIDAY_CALENDAR_ENTRY_ADD"
  | "HOLIDAY_CALENDAR_ENTRY_UPDATE"
  | "HOLIDAY_CALENDAR_ENTRY_REMOVE";

const CREATE_HOLIDAY_CALENDAR_BODY_FIELDS: readonly string[] =
  Object.freeze([
    "calendarCode",
    "name",
    "scopeType",
    "timezone",
    "description",
    "externalRef",
  ]);

const UPDATE_HOLIDAY_CALENDAR_BODY_FIELDS: readonly string[] =
  Object.freeze([
    "name",
    "description",
    "externalRef",
  ]);

const HOLIDAY_CALENDAR_ENTRY_BODY_FIELDS: readonly string[] =
  Object.freeze([
    "date",
    "entryType",
    "name",
    "description",
    "externalRef",
  ]);

export class HolidayCalendarAdminController extends SecureController {
  constructor(
    private readonly service: HolidayCalendarAdminService,
  ) {
    super();
  }

  protected async handle(
    req: Request,
    actor: Actor,
    _context: ContextType,
  ): Promise<unknown> {
    const command =
      readCommand<HolidayCalendarMutationCommand>(req);

    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Holiday calendar mutation command missing",
      );
    }

    switch (command) {
      case "HOLIDAY_CALENDAR_CREATE":
        return this.service.createHolidayCalendar(
          actor,
          parseCreateHolidayCalendarCommand(req),
        );

      case "HOLIDAY_CALENDAR_UPDATE":
        return this.service.updateHolidayCalendar(
          actor,
          parseUpdateHolidayCalendarCommand(req),
        );

      case "HOLIDAY_CALENDAR_ACTIVATE":
        return this.service.activateHolidayCalendar(
          actor,
          parseHolidayCalendarLifecycleCommand(req),
        );

      case "HOLIDAY_CALENDAR_ARCHIVE":
        return this.service.archiveHolidayCalendar(
          actor,
          parseHolidayCalendarLifecycleCommand(req),
        );

      case "HOLIDAY_CALENDAR_ENTRY_ADD":
        return this.service.addHolidayCalendarEntry(
          actor,
          parseAddHolidayCalendarEntryCommand(req),
        );

      case "HOLIDAY_CALENDAR_ENTRY_UPDATE":
        return this.service.updateHolidayCalendarEntry(
          actor,
          parseUpdateHolidayCalendarEntryCommand(req),
        );

      case "HOLIDAY_CALENDAR_ENTRY_REMOVE":
        return this.service.removeHolidayCalendarEntry(
          actor,
          parseRemoveHolidayCalendarEntryCommand(req),
        );

      default:
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          `Unsupported holiday calendar mutation command: ${command}`,
        );
    }
  }

  protected async present(
    result: unknown,
    req: Request,
    _actor: Actor,
    context: ContextType,
  ): Promise<PresentationResult> {
    return getPresenterRegistryFromRequest(req)
      .get<unknown, PresentationResult>(
        HOLIDAY_CALENDAR_ADMIN_MUTATION_PRESENTER_KEY,
      )
      .present(result, context);
  }
}

function parseCreateHolidayCalendarCommand(
  req: Request,
): CreateHolidayCalendarCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    CREATE_HOLIDAY_CALENDAR_BODY_FIELDS,
    "createHolidayCalendar",
  );

  return {
    calendarCode:
      body.calendarCode as string | null | undefined,
    name: body.name as string,
    scopeType: body.scopeType as string | undefined,
    timezone: body.timezone as string | undefined,
    description:
      body.description as
        | string
        | null
        | undefined,
    externalRef:
      body.externalRef as
        | string
        | null
        | undefined,
  };
}

function parseUpdateHolidayCalendarCommand(
  req: Request,
): UpdateHolidayCalendarCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    UPDATE_HOLIDAY_CALENDAR_BODY_FIELDS,
    "updateHolidayCalendar",
  );

  return {
    holidayCalendarId: req.params.holidayCalendarId,
    name: body.name as string | undefined,
    description:
      body.description as
        | string
        | null
        | undefined,
    externalRef:
      body.externalRef as
        | string
        | null
        | undefined,
  };
}

function parseHolidayCalendarLifecycleCommand(
  req: Request,
): HolidayCalendarLifecycleCommand {
  assertNoUnexpectedFields(
    requireRecord(req.body),
    [],
    "holidayCalendarLifecycle",
  );

  return {
    holidayCalendarId: req.params.holidayCalendarId,
  };
}

function parseAddHolidayCalendarEntryCommand(
  req: Request,
): AddHolidayCalendarEntryCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    HOLIDAY_CALENDAR_ENTRY_BODY_FIELDS,
    "addHolidayCalendarEntry",
  );

  return {
    holidayCalendarId: req.params.holidayCalendarId,
    date: body.date as string,
    entryType: body.entryType as string,
    name: body.name as string,
    description:
      body.description as
        | string
        | null
        | undefined,
    externalRef:
      body.externalRef as
        | string
        | null
        | undefined,
  };
}

function parseUpdateHolidayCalendarEntryCommand(
  req: Request,
): UpdateHolidayCalendarEntryCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    HOLIDAY_CALENDAR_ENTRY_BODY_FIELDS,
    "updateHolidayCalendarEntry",
  );

  return {
    holidayCalendarId: req.params.holidayCalendarId,
    holidayCalendarEntryId:
      req.params.holidayCalendarEntryId,
    date: body.date as string | undefined,
    entryType: body.entryType as string | undefined,
    name: body.name as string | undefined,
    description:
      body.description as
        | string
        | null
        | undefined,
    externalRef:
      body.externalRef as
        | string
        | null
        | undefined,
  };
}

function parseRemoveHolidayCalendarEntryCommand(
  req: Request,
): RemoveHolidayCalendarEntryCommand {
  assertNoUnexpectedFields(
    requireRecord(req.body),
    [],
    "removeHolidayCalendarEntry",
  );

  return {
    holidayCalendarId: req.params.holidayCalendarId,
    holidayCalendarEntryId:
      req.params.holidayCalendarEntryId,
  };
}

function requireRecord(
  value: unknown,
): Record<string, unknown> {
  if (value === undefined) {
    return {};
  }

  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new WorkScheduleValidationError(
      "Request body must be a plain object",
    );
  }

  return value as Record<string, unknown>;
}

function assertNoUnexpectedFields(
  body: Record<string, unknown>,
  allowedFields: readonly string[],
  mutationName: string,
): void {
  const unexpectedFields = Object.keys(body).filter(
    (field) => !allowedFields.includes(field),
  );

  if (unexpectedFields.length === 0) {
    return;
  }

  throw new WorkScheduleValidationError(
    `${mutationName} payload contains unsupported field(s): ${unexpectedFields.join(", ")}`,
  );
}
