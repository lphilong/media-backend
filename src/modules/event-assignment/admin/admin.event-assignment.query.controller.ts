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
  EVENT_ASSIGNMENT_ADMIN_ASSIGNMENT_LIST_PRESENTER_KEY,
  EVENT_ASSIGNMENT_ADMIN_BY_ASSIGNMENT_LIST_PRESENTER_KEY,
  EVENT_ASSIGNMENT_ADMIN_BY_PLATFORM_LIST_PRESENTER_KEY,
  EVENT_ASSIGNMENT_ADMIN_BY_RESOURCE_LIST_PRESENTER_KEY,
  EVENT_ASSIGNMENT_ADMIN_DETAIL_PRESENTER_KEY,
  EVENT_ASSIGNMENT_ADMIN_LIST_PRESENTER_KEY,
} from "@modules/event-assignment/shared/event-assignment.presenter-keys";
import {
  GetEventDetailQuery,
  ListEventAssignmentsQuery,
  ListEventsByAssignmentQuery,
  ListEventsByPlatformQuery,
  ListEventsByResourceQuery,
  ListEventsQuery,
  ListStudioBookingsQuery,
} from "@modules/event-assignment/shared/event-assignment.contracts";
import { EventAssignmentAdminStudioBookingExposure } from "@modules/event-assignment/shared/event-assignment.exposure";
import { EventAssignmentAdminQueryService } from "./admin.event-assignment.query-service";

type EventAssignmentQueryCommand =
  | "EVENT_LIST"
  | "EVENT_LIST_BY_ASSIGNMENT"
  | "EVENT_LIST_BY_RESOURCE"
  | "EVENT_LIST_BY_PLATFORM"
  | "EVENT_ASSIGNMENT_LIST"
  | "EVENT_BOOKING_LIST"
  | "EVENT_GET_DETAIL";

const LIST_EVENTS_QUERY_FIELDS: readonly string[] =
  Object.freeze([
    "status",
    "statusGroup",
    "assignmentKind",
    "assignmentEmploymentProfileId",
    "assignmentTalentId",
    "assignmentTalentGroupId",
    "containsStudioResourceId",
    "containsPlatformAccountId",
    "windowStartAt",
    "windowEndAt",
    "eventOverlapStartAt",
    "eventOverlapEndAt",
    "eventStartFromAt",
    "eventStartToAt",
    "limit",
    "cursor",
    "search",
    "sortBy",
    "sortDirection",
  ]);

const LIST_EVENTS_BY_ASSIGNMENT_QUERY_FIELDS: readonly string[] =
  Object.freeze([
    "assignmentKind",
    "assignmentEmploymentProfileId",
    "assignmentTalentId",
    "assignmentTalentGroupId",
    "status",
    "windowStartAt",
    "windowEndAt",
    "limit",
    "cursor",
    "sortBy",
    "sortDirection",
  ]);

const LIST_EVENTS_BY_RESOURCE_QUERY_FIELDS: readonly string[] =
  Object.freeze([
    "studioResourceId",
    "status",
    "windowStartAt",
    "windowEndAt",
    "limit",
    "cursor",
    "sortBy",
    "sortDirection",
  ]);

const LIST_EVENTS_BY_PLATFORM_QUERY_FIELDS: readonly string[] =
  Object.freeze([
    "platformAccountId",
    "status",
    "windowStartAt",
    "windowEndAt",
    "limit",
    "cursor",
    "sortBy",
    "sortDirection",
  ]);

const LIST_EVENT_ASSIGNMENTS_QUERY_FIELDS: readonly string[] =
  Object.freeze([]);

const GET_EVENT_DETAIL_QUERY_FIELDS: readonly string[] =
  Object.freeze([]);

export class EventAssignmentAdminQueryController extends SecureController {
  constructor(
    private readonly service: EventAssignmentAdminQueryService,
  ) {
    super();
  }

  protected async handle(
    req: Request,
    actor: Actor,
    _context: ContextType,
  ): Promise<unknown> {
    const command =
      readCommand<EventAssignmentQueryCommand>(req);

    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Event assignment query command missing",
      );
    }

    switch (command) {
      case "EVENT_LIST":
        return this.service.listEvents(
          actor,
          parseListEventsQuery(req),
        );

      case "EVENT_LIST_BY_ASSIGNMENT":
        return this.service.listEventsByAssignment(
          actor,
          parseListEventsByAssignmentQuery(req),
        );

      case "EVENT_LIST_BY_RESOURCE":
        return this.service.listEventsByResource(
          actor,
          parseListEventsByResourceQuery(req),
        );

      case "EVENT_LIST_BY_PLATFORM":
        return this.service.listEventsByPlatform(
          actor,
          parseListEventsByPlatformQuery(req),
        );

      case "EVENT_ASSIGNMENT_LIST":
        return this.service.listEventAssignments(
          actor,
          parseListEventAssignmentsQuery(req),
        );

      case "EVENT_BOOKING_LIST":
        return this.service.listStudioBookings(
          actor,
          parseListStudioBookingsQuery(req),
        );

      case "EVENT_GET_DETAIL":
        return this.service.getEventDetail(
          actor,
          parseGetEventDetailQuery(req),
        );

      default:
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          `Unsupported event assignment query command: ${command}`,
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
      readCommand<EventAssignmentQueryCommand>(req);

    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Event assignment query command missing",
      );
    }

    const registry = getPresenterRegistryFromRequest(req);

    switch (command) {
      case "EVENT_LIST":
        return registry
          .get<unknown, PresentationResult>(
            EVENT_ASSIGNMENT_ADMIN_LIST_PRESENTER_KEY,
          )
          .present(result, context);

      case "EVENT_LIST_BY_ASSIGNMENT":
        return registry
          .get<unknown, PresentationResult>(
            EVENT_ASSIGNMENT_ADMIN_BY_ASSIGNMENT_LIST_PRESENTER_KEY,
          )
          .present(result, context);

      case "EVENT_LIST_BY_RESOURCE":
        return registry
          .get<unknown, PresentationResult>(
            EVENT_ASSIGNMENT_ADMIN_BY_RESOURCE_LIST_PRESENTER_KEY,
          )
          .present(result, context);

      case "EVENT_LIST_BY_PLATFORM":
        return registry
          .get<unknown, PresentationResult>(
            EVENT_ASSIGNMENT_ADMIN_BY_PLATFORM_LIST_PRESENTER_KEY,
          )
          .present(result, context);

      case "EVENT_ASSIGNMENT_LIST":
        return registry
          .get<unknown, PresentationResult>(
            EVENT_ASSIGNMENT_ADMIN_ASSIGNMENT_LIST_PRESENTER_KEY,
          )
          .present(result, context);

      case "EVENT_BOOKING_LIST":
        return {
          data: EventAssignmentAdminStudioBookingExposure.exposeMany(
            (result as { items: Parameters<
              typeof EventAssignmentAdminStudioBookingExposure.exposeMany
            >[0] }).items,
          ),
        };

      case "EVENT_GET_DETAIL":
        return registry
          .get<unknown, PresentationResult>(
            EVENT_ASSIGNMENT_ADMIN_DETAIL_PRESENTER_KEY,
          )
          .present(result, context);

      default:
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          `Unsupported event assignment query command: ${command}`,
        );
    }
  }
}

function parseListEventsQuery(
  req: Request,
): ListEventsQuery {
  assertNoUnexpectedQueryFields(
    req.query as Record<string, unknown>,
    LIST_EVENTS_QUERY_FIELDS,
    "listEvents",
  );

  return {
    status: req.query.status as string | undefined,
    statusGroup:
      req.query.statusGroup as string | undefined,
    assignmentKind:
      req.query.assignmentKind as string | undefined,
    assignmentEmploymentProfileId:
      req.query.assignmentEmploymentProfileId as
        | string
        | undefined,
    assignmentTalentId:
      req.query.assignmentTalentId as
        | string
        | undefined,
    assignmentTalentGroupId:
      req.query.assignmentTalentGroupId as
        | string
        | undefined,
    containsStudioResourceId:
      req.query.containsStudioResourceId as
        | string
        | undefined,
    containsPlatformAccountId:
      req.query.containsPlatformAccountId as
        | string
        | undefined,
    windowStartAt:
      req.query.windowStartAt as
        | string
        | undefined,
    windowEndAt: req.query.windowEndAt as
      | string
      | undefined,
    eventOverlapStartAt:
      req.query.eventOverlapStartAt as
        | string
        | undefined,
    eventOverlapEndAt:
      req.query.eventOverlapEndAt as
        | string
        | undefined,
    eventStartFromAt:
      req.query.eventStartFromAt as
        | string
        | undefined,
    eventStartToAt:
      req.query.eventStartToAt as
        | string
        | undefined,
    limit: req.query.limit as string | undefined,
    cursor: req.query.cursor as string | undefined,
    search: req.query.search as string | undefined,
    sortBy: req.query.sortBy as string | undefined,
    sortDirection:
      req.query.sortDirection as string | undefined,
  };
}

function parseListEventsByAssignmentQuery(
  req: Request,
): ListEventsByAssignmentQuery {
  assertNoUnexpectedQueryFields(
    req.query as Record<string, unknown>,
    LIST_EVENTS_BY_ASSIGNMENT_QUERY_FIELDS,
    "listEventsByAssignment",
  );

  return {
    assignmentKind: req.query.assignmentKind as string,
    assignmentEmploymentProfileId:
      req.query.assignmentEmploymentProfileId as
        | string
        | undefined,
    assignmentTalentId:
      req.query.assignmentTalentId as
        | string
        | undefined,
    assignmentTalentGroupId:
      req.query.assignmentTalentGroupId as
        | string
        | undefined,
    status: req.query.status as string | undefined,
    windowStartAt:
      req.query.windowStartAt as
        | string
        | undefined,
    windowEndAt: req.query.windowEndAt as
      | string
      | undefined,
    limit: req.query.limit as string | undefined,
    cursor: req.query.cursor as string | undefined,
    sortBy: req.query.sortBy as string | undefined,
    sortDirection:
      req.query.sortDirection as string | undefined,
  };
}

function parseListEventsByResourceQuery(
  req: Request,
): ListEventsByResourceQuery {
  assertNoUnexpectedQueryFields(
    req.query as Record<string, unknown>,
    LIST_EVENTS_BY_RESOURCE_QUERY_FIELDS,
    "listEventsByResource",
  );

  return {
    studioResourceId:
      req.query.studioResourceId as string,
    status: req.query.status as string | undefined,
    windowStartAt:
      req.query.windowStartAt as
        | string
        | undefined,
    windowEndAt: req.query.windowEndAt as
      | string
      | undefined,
    limit: req.query.limit as string | undefined,
    cursor: req.query.cursor as string | undefined,
    sortBy: req.query.sortBy as string | undefined,
    sortDirection:
      req.query.sortDirection as string | undefined,
  };
}

function parseListEventsByPlatformQuery(
  req: Request,
): ListEventsByPlatformQuery {
  assertNoUnexpectedQueryFields(
    req.query as Record<string, unknown>,
    LIST_EVENTS_BY_PLATFORM_QUERY_FIELDS,
    "listEventsByPlatform",
  );

  return {
    platformAccountId:
      req.query.platformAccountId as string,
    status: req.query.status as string | undefined,
    windowStartAt:
      req.query.windowStartAt as
        | string
        | undefined,
    windowEndAt: req.query.windowEndAt as
      | string
      | undefined,
    limit: req.query.limit as string | undefined,
    cursor: req.query.cursor as string | undefined,
    sortBy: req.query.sortBy as string | undefined,
    sortDirection:
      req.query.sortDirection as string | undefined,
  };
}

function parseListEventAssignmentsQuery(
  req: Request,
): ListEventAssignmentsQuery {
  assertNoUnexpectedQueryFields(
    req.query as Record<string, unknown>,
    LIST_EVENT_ASSIGNMENTS_QUERY_FIELDS,
    "listEventAssignments",
  );

  return {
    eventId: req.params.eventId,
  };
}

function parseGetEventDetailQuery(
  req: Request,
): GetEventDetailQuery {
  assertNoUnexpectedQueryFields(
    req.query as Record<string, unknown>,
    GET_EVENT_DETAIL_QUERY_FIELDS,
    "getEventDetail",
  );

  return {
    eventId: req.params.eventId,
  };
}

function parseListStudioBookingsQuery(
  req: Request,
): ListStudioBookingsQuery {
  assertNoUnexpectedQueryFields(
    req.query as Record<string, unknown>,
    [],
    "listStudioBookings",
  );
  return { eventId: req.params.eventId };
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

  throw new EventAssignmentValidationError(
    `${queryName} query contains unsupported field(s): ${unexpectedFields.join(", ")}`,
  );
}
