import { Request } from "express";
import { readCommand } from "@app/base/command.middleware";
import { SecureController } from "@app/base/secure-controller.base";
import { PresentationResult } from "@app/base/presentation-result.types";
import { getPresenterRegistryFromRequest } from "@app/presenter/presenter.runtime-access";
import { Actor } from "@core/actor/actor";
import { ContextType } from "@core/context/context.types";
import { SystemInvariantError } from "@core/error/system-error";
import { WorkScheduleValidationError } from "@modules/work-schedule/domain/work-schedule.errors";
import { MONTHLY_ROSTER_ADMIN_MUTATION_PRESENTER_KEY } from "@modules/work-schedule/shared/work-schedule.presenter-keys";
import {
  AddRosterExceptionCommand,
  ApplyAvailabilityLinesToMonthlyRosterCommand,
  CreateMonthlyRosterDraftCommand,
  MonthlyRosterLifecycleCommand,
  PublishMonthlyRosterCommand,
  RemoveRosterExceptionCommand,
  UpdateMonthlyRosterDraftCommand,
  UpdateRosterExceptionCommand,
} from "@modules/work-schedule/shared/work-schedule.contracts";
import { MonthlyRosterAdminService } from "./admin.monthly-roster.service";

type MonthlyRosterMutationCommand =
  | "MONTHLY_ROSTER_CREATE_DRAFT"
  | "MONTHLY_ROSTER_UPDATE_DRAFT"
  | "MONTHLY_ROSTER_ARCHIVE"
  | "MONTHLY_ROSTER_PUBLISH"
  | "MONTHLY_ROSTER_APPLY_AVAILABILITY_LINES"
  | "ROSTER_EXCEPTION_ADD"
  | "ROSTER_EXCEPTION_UPDATE"
  | "ROSTER_EXCEPTION_REMOVE";

const CREATE_ROSTER_BODY_FIELDS = Object.freeze([
  "rosterCode",
  "rosterMonth",
  "timezone",
  "targetType",
  "targetMode",
  "targetOrgUnitId",
  "targetTalentGroupId",
  "departmentOrgUnitId",
  "workPatternId",
  "holidayCalendarId",
  "description",
  "externalRef",
  "scope",
]);

const UPDATE_ROSTER_BODY_FIELDS = Object.freeze([
  "rosterMonth",
  "timezone",
  "targetType",
  "targetMode",
  "targetOrgUnitId",
  "targetTalentGroupId",
  "departmentOrgUnitId",
  "workPatternId",
  "holidayCalendarId",
  "description",
  "externalRef",
  "scope",
]);

const EXCEPTION_BODY_FIELDS = Object.freeze([
  "exceptionType",
  "exceptionDate",
  "subjectEmploymentProfileId",
  "title",
  "startLocalTime",
  "workingMinutes",
  "breakMinutes",
  "studioResourceIds",
  "reason",
  "sourceNote",
  "description",
  "externalRef",
  "scope",
]);

const LIFECYCLE_BODY_FIELDS = Object.freeze(["scope"]);
const PUBLISH_BODY_FIELDS = Object.freeze([
  "expectedPreviewHash",
  "idempotencyKey",
  "note",
  "scope",
]);
const APPLY_AVAILABILITY_BODY_FIELDS = Object.freeze([
  "availabilityLineIds",
  "applyNote",
  "note",
  "scope",
]);

export class MonthlyRosterAdminController extends SecureController {
  constructor(
    private readonly service: MonthlyRosterAdminService,
  ) {
    super();
  }

  protected async handle(
    req: Request,
    actor: Actor,
    _context: ContextType,
  ): Promise<unknown> {
    const command =
      readCommand<MonthlyRosterMutationCommand>(req);

    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Monthly Roster mutation command missing",
      );
    }

    switch (command) {
      case "MONTHLY_ROSTER_CREATE_DRAFT":
        return this.service.createMonthlyRosterDraft(
          actor,
          parseCreateMonthlyRosterDraftCommand(req),
        );

      case "MONTHLY_ROSTER_UPDATE_DRAFT":
        return this.service.updateMonthlyRosterDraft(
          actor,
          parseUpdateMonthlyRosterDraftCommand(req),
        );

      case "MONTHLY_ROSTER_ARCHIVE":
        return this.service.archiveMonthlyRoster(
          actor,
          parseMonthlyRosterLifecycleCommand(req),
        );

      case "MONTHLY_ROSTER_PUBLISH":
        return this.service.publishMonthlyRoster(
          actor,
          parsePublishMonthlyRosterCommand(req),
        );

      case "MONTHLY_ROSTER_APPLY_AVAILABILITY_LINES":
        return this.service.applyAvailabilityLinesToMonthlyRoster(
          actor,
          parseApplyAvailabilityLinesCommand(req),
        );

      case "ROSTER_EXCEPTION_ADD":
        return this.service.addRosterException(
          actor,
          parseAddRosterExceptionCommand(req),
        );

      case "ROSTER_EXCEPTION_UPDATE":
        return this.service.updateRosterException(
          actor,
          parseUpdateRosterExceptionCommand(req),
        );

      case "ROSTER_EXCEPTION_REMOVE":
        return this.service.removeRosterException(
          actor,
          parseRemoveRosterExceptionCommand(req),
        );

      default:
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          `Unsupported Monthly Roster mutation command: ${command}`,
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
        MONTHLY_ROSTER_ADMIN_MUTATION_PRESENTER_KEY,
      )
      .present(result, context);
  }
}

function parseApplyAvailabilityLinesCommand(
  req: Request,
): ApplyAvailabilityLinesToMonthlyRosterCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    APPLY_AVAILABILITY_BODY_FIELDS,
    "applyAvailabilityLinesToMonthlyRoster",
  );

  return {
    monthlyRosterId: req.params.monthlyRosterId,
    availabilityLineIds:
      body.availabilityLineIds as readonly string[],
    applyNote:
      body.applyNote as string | null | undefined,
    note: body.note as string | null | undefined,
    scope: body.scope as string | undefined,
  };
}

function parseCreateMonthlyRosterDraftCommand(
  req: Request,
): CreateMonthlyRosterDraftCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    CREATE_ROSTER_BODY_FIELDS,
    "createMonthlyRosterDraft",
  );

  return {
    rosterCode:
      body.rosterCode as string | null | undefined,
    rosterMonth: body.rosterMonth as string,
    timezone: body.timezone as string | undefined,
    targetType: body.targetType as string,
    targetMode: body.targetMode as string | undefined,
    targetOrgUnitId:
      body.targetOrgUnitId as string | null | undefined,
    targetTalentGroupId:
      body.targetTalentGroupId as
        | string
        | null
        | undefined,
    departmentOrgUnitId:
      body.departmentOrgUnitId as string | undefined,
    workPatternId: body.workPatternId as string,
    holidayCalendarId:
      body.holidayCalendarId as string,
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
    scope: body.scope as string | undefined,
  };
}

function parseUpdateMonthlyRosterDraftCommand(
  req: Request,
): UpdateMonthlyRosterDraftCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    UPDATE_ROSTER_BODY_FIELDS,
    "updateMonthlyRosterDraft",
  );

  return {
    monthlyRosterId: req.params.monthlyRosterId,
    rosterMonth: body.rosterMonth as string | undefined,
    timezone: body.timezone as string | undefined,
    targetType: body.targetType as string | undefined,
    targetMode: body.targetMode as string | undefined,
    targetOrgUnitId:
      body.targetOrgUnitId as string | null | undefined,
    targetTalentGroupId:
      body.targetTalentGroupId as
        | string
        | null
        | undefined,
    departmentOrgUnitId:
      body.departmentOrgUnitId as
        | string
        | undefined,
    workPatternId:
      body.workPatternId as string | undefined,
    holidayCalendarId:
      body.holidayCalendarId as string | undefined,
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
    scope: body.scope as string | undefined,
  };
}

function parseMonthlyRosterLifecycleCommand(
  req: Request,
): MonthlyRosterLifecycleCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    LIFECYCLE_BODY_FIELDS,
    "monthlyRosterLifecycle",
  );

  return {
    monthlyRosterId: req.params.monthlyRosterId,
    scope: body.scope as string | undefined,
  };
}

function parsePublishMonthlyRosterCommand(
  req: Request,
): PublishMonthlyRosterCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    PUBLISH_BODY_FIELDS,
    "publishMonthlyRoster",
  );

  return {
    monthlyRosterId: req.params.monthlyRosterId,
    expectedPreviewHash:
      body.expectedPreviewHash as string | undefined,
    idempotencyKey:
      body.idempotencyKey as string | null | undefined,
    note: body.note as string | null | undefined,
    scope: body.scope as string | undefined,
  };
}

function parseAddRosterExceptionCommand(
  req: Request,
): AddRosterExceptionCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    EXCEPTION_BODY_FIELDS,
    "addRosterException",
  );

  return {
    monthlyRosterId: req.params.monthlyRosterId,
    exceptionType: body.exceptionType as string,
    exceptionDate: body.exceptionDate as string,
    subjectEmploymentProfileId:
      body.subjectEmploymentProfileId as string,
    title: body.title as string | null | undefined,
    startLocalTime:
      body.startLocalTime as string | undefined,
    workingMinutes:
      body.workingMinutes as number | undefined,
    breakMinutes:
      body.breakMinutes as number | undefined,
    studioResourceIds:
      body.studioResourceIds as
        | readonly string[]
        | undefined,
    reason:
      body.reason as string | null | undefined,
    sourceNote:
      body.sourceNote as string | null | undefined,
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
    scope: body.scope as string | undefined,
  };
}

function parseUpdateRosterExceptionCommand(
  req: Request,
): UpdateRosterExceptionCommand {
  return {
    ...parseAddRosterExceptionCommand(req),
    rosterExceptionId: req.params.rosterExceptionId,
  };
}

function parseRemoveRosterExceptionCommand(
  req: Request,
): RemoveRosterExceptionCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    LIFECYCLE_BODY_FIELDS,
    "removeRosterException",
  );

  return {
    monthlyRosterId: req.params.monthlyRosterId,
    rosterExceptionId: req.params.rosterExceptionId,
    scope: body.scope as string | undefined,
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
