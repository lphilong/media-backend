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
  CancelStudioBookingCommand,
  CancelEventCommand,
  ConfirmEventCommand,
  ConfirmStudioBookingCommand,
  CompleteEventCommand,
  CreateStudioBookingCommand,
  CreateEventCommand,
  PlanEventCommand,
  ReleaseStudioBookingCommand,
  ReplaceEventAssignmentsCommand,
  RescheduleEventCommand,
  UpdateEventCoreCommand,
  UpdateEventPlatformAccountsCommand,
} from "@modules/event-assignment/shared/event-assignment.contracts";
import { EventAssignmentAdminStudioBookingExposure } from "@modules/event-assignment/shared/event-assignment.exposure";
import { EventAssignmentAdminService } from "./admin.event-assignment.service";

type EventAssignmentMutationCommand =
  | "EVENT_CREATE"
  | "EVENT_UPDATE_CORE"
  | "EVENT_RESCHEDULE"
  | "EVENT_REPLACE_ASSIGNMENTS"
  | "EVENT_UPDATE_PLATFORM_ACCOUNTS"
  | "EVENT_BOOKING_CREATE"
  | "EVENT_BOOKING_CONFIRM"
  | "EVENT_BOOKING_RELEASE"
  | "EVENT_BOOKING_CANCEL"
  | "EVENT_PLAN"
  | "EVENT_CONFIRM"
  | "EVENT_COMPLETE"
  | "EVENT_CANCEL"
  | "EVENT_ARCHIVE";

const CREATE_EVENT_BODY_FIELDS: readonly string[] =
  Object.freeze([
    "eventCode",
    "title",
    "ownerEmploymentProfileId",
    "status",
    "assignments",
    "platformAccountIds",
    "eventStartAt",
    "eventEndAt",
    "description",
    "externalRef",
  ]);

const UPDATE_EVENT_CORE_BODY_FIELDS: readonly string[] =
  Object.freeze([
    "title",
    "ownerEmploymentProfileId",
    "description",
    "externalRef",
  ]);

const RESCHEDULE_EVENT_BODY_FIELDS: readonly string[] =
  Object.freeze([
    "newEventStartAt",
    "newEventEndAt",
    "reason",
  ]);

const REPLACE_EVENT_ASSIGNMENTS_BODY_FIELDS: readonly string[] =
  Object.freeze(["replacementAssignments"]);

const UPDATE_EVENT_PLATFORM_ACCOUNTS_BODY_FIELDS: readonly string[] =
  Object.freeze(["newPlatformAccountIds"]);

const CREATE_STUDIO_BOOKING_BODY_FIELDS: readonly string[] = Object.freeze([
  "studioResourceId",
  "bookingStartAt",
  "bookingEndAt",
  "status",
]);

const REASON_BODY_FIELDS: readonly string[] = Object.freeze(["reason"]);

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

      case "EVENT_UPDATE_PLATFORM_ACCOUNTS":
        return this.service.updateEventPlatformAccounts(
          actor,
          parseUpdateEventPlatformAccountsCommand(
            req,
          ),
        );

      case "EVENT_BOOKING_CREATE":
        return this.service.createStudioBooking(
          actor,
          parseCreateStudioBookingCommand(req),
        );

      case "EVENT_BOOKING_CONFIRM":
        return this.service.confirmStudioBooking(
          actor,
          parseConfirmStudioBookingCommand(req),
        );

      case "EVENT_BOOKING_RELEASE":
        return this.service.releaseStudioBooking(
          actor,
          parseReleaseStudioBookingCommand(req),
        );

      case "EVENT_BOOKING_CANCEL":
        return this.service.cancelStudioBooking(
          actor,
          parseCancelStudioBookingCommand(req),
        );

      case "EVENT_PLAN":
        return this.service.planEvent(
          actor,
          parsePlanEventCommand(req),
        );

      case "EVENT_CONFIRM":
        return this.service.confirmEvent(
          actor,
          parseConfirmEventCommand(req),
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
    const command = readCommand<EventAssignmentMutationCommand>(req);
    if (command?.startsWith("EVENT_BOOKING_")) {
      return {
        data: EventAssignmentAdminStudioBookingExposure.expose(
          result as Parameters<
            typeof EventAssignmentAdminStudioBookingExposure.expose
          >[0],
        ),
      };
    }
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
    ownerEmploymentProfileId:
      body.ownerEmploymentProfileId as string,
    status: body.status as CreateEventCommand["status"],
    assignments:
      body.assignments as CreateEventCommand["assignments"],
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
    ownerEmploymentProfileId:
      body.ownerEmploymentProfileId as string | undefined,
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
    reason: body.reason as string,
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

function parseCreateStudioBookingCommand(
  req: Request,
): CreateStudioBookingCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    CREATE_STUDIO_BOOKING_BODY_FIELDS,
    "createStudioBooking",
  );

  return {
    eventId: req.params.eventId,
    studioResourceId: body.studioResourceId as string,
    bookingStartAt: body.bookingStartAt as number,
    bookingEndAt: body.bookingEndAt as number,
    status: body.status as CreateStudioBookingCommand["status"],
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

function parsePlanEventCommand(
  req: Request,
): PlanEventCommand {
  assertNoUnexpectedFields(
    requireRecord(req.body),
    [],
    "planEvent",
  );

  return {
    eventId: req.params.eventId,
  };
}

function parseConfirmEventCommand(
  req: Request,
): ConfirmEventCommand {
  assertNoUnexpectedFields(requireRecord(req.body), [], "confirmEvent");
  return { eventId: req.params.eventId };
}

function parseConfirmStudioBookingCommand(
  req: Request,
): ConfirmStudioBookingCommand {
  assertNoUnexpectedFields(requireRecord(req.body), [], "confirmStudioBooking");
  return {
    eventId: req.params.eventId,
    bookingId: req.params.bookingId,
  };
}

function parseReleaseStudioBookingCommand(
  req: Request,
): ReleaseStudioBookingCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(body, REASON_BODY_FIELDS, "releaseStudioBooking");
  return {
    eventId: req.params.eventId,
    bookingId: req.params.bookingId,
    reason: body.reason as string,
  };
}

function parseCancelStudioBookingCommand(
  req: Request,
): CancelStudioBookingCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(body, REASON_BODY_FIELDS, "cancelStudioBooking");
  return {
    eventId: req.params.eventId,
    bookingId: req.params.bookingId,
    reason: body.reason as string,
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
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(body, REASON_BODY_FIELDS, "cancelEvent");

  return {
    eventId: req.params.eventId,
    reason: body.reason as string,
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
