import { Request } from "express";
import { readCommand } from "@app/base/command.middleware";
import { SecureController } from "@app/base/secure-controller.base";
import { PresentationResult } from "@app/base/presentation-result.types";
import { getPresenterRegistryFromRequest } from "@app/presenter/presenter.runtime-access";
import { Actor } from "@core/actor/actor";
import { ContextType } from "@core/context/context.types";
import { SystemInvariantError } from "@core/error/system-error";
import { WorkScheduleValidationError } from "@modules/work-schedule/domain/work-schedule.errors";
import { WORK_PATTERN_ADMIN_MUTATION_PRESENTER_KEY } from "@modules/work-schedule/shared/work-schedule.presenter-keys";
import {
  CreateWorkPatternCommand,
  UpdateWorkPatternCommand,
  WorkPatternLifecycleCommand,
} from "@modules/work-schedule/shared/work-schedule.contracts";
import { WorkPatternAdminService } from "./admin.work-pattern.service";

type WorkPatternMutationCommand =
  | "WORK_PATTERN_CREATE"
  | "WORK_PATTERN_UPDATE"
  | "WORK_PATTERN_ACTIVATE"
  | "WORK_PATTERN_ARCHIVE";

const CREATE_WORK_PATTERN_BODY_FIELDS: readonly string[] =
  Object.freeze([
    "patternCode",
    "name",
    "timezone",
    "startLocalTime",
    "workingMinutes",
    "breakMinutes",
    "workingDays",
    "description",
    "externalRef",
  ]);

const UPDATE_WORK_PATTERN_BODY_FIELDS: readonly string[] =
  Object.freeze([
    "name",
    "timezone",
    "startLocalTime",
    "workingMinutes",
    "breakMinutes",
    "workingDays",
    "description",
    "externalRef",
  ]);

export class WorkPatternAdminController extends SecureController {
  constructor(
    private readonly service: WorkPatternAdminService,
  ) {
    super();
  }

  protected async handle(
    req: Request,
    actor: Actor,
    _context: ContextType,
  ): Promise<unknown> {
    const command =
      readCommand<WorkPatternMutationCommand>(req);

    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Work pattern mutation command missing",
      );
    }

    switch (command) {
      case "WORK_PATTERN_CREATE":
        return this.service.createWorkPattern(
          actor,
          parseCreateWorkPatternCommand(req),
        );

      case "WORK_PATTERN_UPDATE":
        return this.service.updateWorkPattern(
          actor,
          parseUpdateWorkPatternCommand(req),
        );

      case "WORK_PATTERN_ACTIVATE":
        return this.service.activateWorkPattern(
          actor,
          parseWorkPatternLifecycleCommand(req),
        );

      case "WORK_PATTERN_ARCHIVE":
        return this.service.archiveWorkPattern(
          actor,
          parseWorkPatternLifecycleCommand(req),
        );

      default:
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          `Unsupported work pattern mutation command: ${command}`,
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
        WORK_PATTERN_ADMIN_MUTATION_PRESENTER_KEY,
      )
      .present(result, context);
  }
}

function parseCreateWorkPatternCommand(
  req: Request,
): CreateWorkPatternCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    CREATE_WORK_PATTERN_BODY_FIELDS,
    "createWorkPattern",
  );

  return {
    patternCode:
      body.patternCode as string | null | undefined,
    name: body.name as string,
    timezone: body.timezone as string | undefined,
    startLocalTime: body.startLocalTime as string,
    workingMinutes:
      body.workingMinutes as number | undefined,
    breakMinutes:
      body.breakMinutes as number | undefined,
    workingDays:
      body.workingDays as readonly string[],
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

function parseUpdateWorkPatternCommand(
  req: Request,
): UpdateWorkPatternCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    UPDATE_WORK_PATTERN_BODY_FIELDS,
    "updateWorkPattern",
  );

  return {
    workPatternId: req.params.workPatternId,
    name: body.name as string | undefined,
    timezone: body.timezone as string | undefined,
    startLocalTime:
      body.startLocalTime as string | undefined,
    workingMinutes:
      body.workingMinutes as number | undefined,
    breakMinutes:
      body.breakMinutes as number | undefined,
    workingDays:
      body.workingDays as
        | readonly string[]
        | undefined,
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

function parseWorkPatternLifecycleCommand(
  req: Request,
): WorkPatternLifecycleCommand {
  assertNoUnexpectedFields(
    requireRecord(req.body),
    [],
    "workPatternLifecycle",
  );

  return {
    workPatternId: req.params.workPatternId,
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
