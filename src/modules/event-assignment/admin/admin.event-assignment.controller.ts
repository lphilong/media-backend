import { Request } from "express";
import { readCommand } from "@app/base/command.middleware";
import { SecureController } from "@app/base/secure-controller.base";
import { PresentationResult } from "@app/base/presentation-result.types";
import { getPresenterRegistryFromRequest } from "@app/presenter/presenter.runtime-access";
import { Actor } from "@core/actor/actor";
import { ContextType } from "@core/context/context.types";
import { SystemInvariantError } from "@core/error/system-error";
import { EventAssignmentValidationError } from "@modules/event-assignment/domain/event-assignment.errors";
import {
  EVENT_ASSIGNMENT_ADMIN_MUTATION_PRESENTER_KEY,
} from "@modules/event-assignment/shared/event-assignment.presenter-keys";
import {
  ArchiveEventCommand,
  CancelEventCommand,
  CompleteEventCommand,
  CreateEventCommand,
  ReplaceEventAssignmentsCommand,
  RescheduleEventCommand,
  StartEventCommand,
  UpdateEventCoreCommand,
  UpdateEventPlatformAccountsCommand,
  UpdateEventStudioResourcesCommand,
} from "@modules/event-assignment/shared/event-assignment.contracts";
import { EventAssignmentAdminService } from "./admin.event-assignment.service";

type EventAssignmentMutationCommand =
  | "EVENT_CREATE"
  | "EVENT_UPDATE_CORE"
  | "EVENT_RESCHEDULE"
  | "EVENT_REPLACE_ASSIGNMENTS"
  | "EVENT_UPDATE_STUDIO_RESOURCES"
  | "EVENT_UPDATE_PLATFORM_ACCOUNTS"
  | "EVENT_START"
  | "EVENT_COMPLETE"
  | "EVENT_CANCEL"
  | "EVENT_ARCHIVE";

const CREATE_EVENT_BODY_FIELDS: readonly string[] =
  Object.freeze([
    "eventCode",
    "title",
    "assignments",
    "studioResourceIds",
    "platformAccountIds",
    "eventStartAt",
    "eventEndAt",
    "description",
    "externalRef",
  ]);

const UPDATE_EVENT_CORE_BODY_FIELDS: readonly string[] =
  Object.freeze([
    "title",
    "description",
    "externalRef",
  ]);

const RESCHEDULE_EVENT_BODY_FIELDS: readonly string[] =
  Object.freeze([
    "newEventStartAt",
    "newEventEndAt",
  ]);

const REPLACE_EVENT_ASSIGNMENTS_BODY_FIELDS: readonly string[] =
  Object.freeze(["replacementAssignments"]);

const UPDATE_EVENT_STUDIO_RESOURCES_BODY_FIELDS: readonly string[] =
  Object.freeze(["newStudioResourceIds"]);

const UPDATE_EVENT_PLATFORM_ACCOUNTS_BODY_FIELDS: readonly string[] =
  Object.freeze(["newPlatformAccountIds"]);

export class EventAssignmentAdminController extends SecureController {
  constructor(
    private readonly service: EventAssignmentAdminService,
  ) {
    super();
  }

  protected async handle(
    req: Request,
    actor: Actor,
    _context: ContextType,
  ): Promise<unknown> {
    const command =
      readCommand<EventAssignmentMutationCommand>(
        req,
      );

    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Event assignment mutation command missing",
      );
    }

    switch (command) {
      case "EVENT_CREATE":
        return this.service.createEvent(
          actor,
          parseCreateEventCommand(req),
        );

      case "EVENT_UPDATE_CORE":
        return this.service.updateEventCore(
          actor,
          parseUpdateEventCoreCommand(req),
        );

      case "EVENT_RESCHEDULE":
        return this.service.rescheduleEvent(
          actor,
          parseRescheduleEventCommand(req),
        );

      case "EVENT_REPLACE_ASSIGNMENTS":
        return this.service.replaceEventAssignments(
          actor,
          parseReplaceEventAssignmentsCommand(req),
        );

      case "EVENT_UPDATE_STUDIO_RESOURCES":
        return this.service.updateEventStudioResources(
          actor,
          parseUpdateEventStudioResourcesCommand(
            req,
          ),
        );

      case "EVENT_UPDATE_PLATFORM_ACCOUNTS":
        return this.service.updateEventPlatformAccounts(
          actor,
          parseUpdateEventPlatformAccountsCommand(
            req,
          ),
        );

      case "EVENT_START":
        return this.service.startEvent(
          actor,
          parseStartEventCommand(req),
        );

      case "EVENT_COMPLETE":
        return this.service.completeEvent(
          actor,
          parseCompleteEventCommand(req),
        );

      case "EVENT_CANCEL":
        return this.service.cancelEvent(
          actor,
          parseCancelEventCommand(req),
        );

      case "EVENT_ARCHIVE":
        return this.service.archiveEvent(
          actor,
          parseArchiveEventCommand(req),
        );

      default:
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          `Unsupported event assignment mutation command: ${command}`,
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
        EVENT_ASSIGNMENT_ADMIN_MUTATION_PRESENTER_KEY,
      )
      .present(result, context);
  }
}

function parseCreateEventCommand(
  req: Request,
): CreateEventCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    CREATE_EVENT_BODY_FIELDS,
    "createEvent",
  );

  return {
    eventCode: body.eventCode as string,
    title: body.title as string,
    assignments:
      body.assignments as CreateEventCommand["assignments"],
    studioResourceIds:
      body.studioResourceIds as
        | readonly string[]
        | undefined,
    platformAccountIds:
      body.platformAccountIds as
        | readonly string[]
        | undefined,
    eventStartAt: body.eventStartAt as number,
    eventEndAt: body.eventEndAt as number,
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

function parseUpdateEventCoreCommand(
  req: Request,
): UpdateEventCoreCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    UPDATE_EVENT_CORE_BODY_FIELDS,
    "updateEventCore",
  );

  return {
    eventId: req.params.eventId,
    title: body.title as string | undefined,
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

function parseRescheduleEventCommand(
  req: Request,
): RescheduleEventCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    RESCHEDULE_EVENT_BODY_FIELDS,
    "rescheduleEvent",
  );

  return {
    eventId: req.params.eventId,
    newEventStartAt: body.newEventStartAt as number,
    newEventEndAt: body.newEventEndAt as number,
  };
}

function parseReplaceEventAssignmentsCommand(
  req: Request,
): ReplaceEventAssignmentsCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    REPLACE_EVENT_ASSIGNMENTS_BODY_FIELDS,
    "replaceEventAssignments",
  );

  return {
    eventId: req.params.eventId,
    replacementAssignments:
      body.replacementAssignments as ReplaceEventAssignmentsCommand["replacementAssignments"],
  };
}

function parseUpdateEventStudioResourcesCommand(
  req: Request,
): UpdateEventStudioResourcesCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    UPDATE_EVENT_STUDIO_RESOURCES_BODY_FIELDS,
    "updateEventStudioResources",
  );

  return {
    eventId: req.params.eventId,
    newStudioResourceIds:
      body.newStudioResourceIds as readonly string[],
  };
}

function parseUpdateEventPlatformAccountsCommand(
  req: Request,
): UpdateEventPlatformAccountsCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    UPDATE_EVENT_PLATFORM_ACCOUNTS_BODY_FIELDS,
    "updateEventPlatformAccounts",
  );

  return {
    eventId: req.params.eventId,
    newPlatformAccountIds:
      body.newPlatformAccountIds as readonly string[],
  };
}

function parseStartEventCommand(
  req: Request,
): StartEventCommand {
  assertNoUnexpectedFields(
    requireRecord(req.body),
    [],
    "startEvent",
  );

  return {
    eventId: req.params.eventId,
  };
}

function parseCompleteEventCommand(
  req: Request,
): CompleteEventCommand {
  assertNoUnexpectedFields(
    requireRecord(req.body),
    [],
    "completeEvent",
  );

  return {
    eventId: req.params.eventId,
  };
}

function parseCancelEventCommand(
  req: Request,
): CancelEventCommand {
  assertNoUnexpectedFields(
    requireRecord(req.body),
    [],
    "cancelEvent",
  );

  return {
    eventId: req.params.eventId,
  };
}

function parseArchiveEventCommand(
  req: Request,
): ArchiveEventCommand {
  assertNoUnexpectedFields(
    requireRecord(req.body),
    [],
    "archiveEvent",
  );

  return {
    eventId: req.params.eventId,
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
    throw new EventAssignmentValidationError(
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

  throw new EventAssignmentValidationError(
    `${mutationName} payload contains unsupported field(s): ${unexpectedFields.join(", ")}`,
  );
}
