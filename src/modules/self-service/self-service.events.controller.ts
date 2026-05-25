import { Request } from "express";
import { readCommand } from "@app/base/command.middleware";
import { PresentationResult } from "@app/base/presentation-result.types";
import { SecureController } from "@app/base/secure-controller.base";
import { Actor } from "@core/actor/actor";
import { ContextType } from "@core/context/context.types";
import { SystemInvariantError } from "@core/error/system-error";
import {
  EVENT_STATUSES,
  EventStatus,
} from "@modules/event-assignment/domain/event-assignment.types";
import { SelfServiceValidationError } from "./domain/self-service.errors";
import {
  SelfServiceEventListQuery,
  SelfServiceEventListView,
} from "./domain/self-service.types";
import { SelfServiceEventExposure } from "./shared/self-service.exposure";
import { SelfServiceEventsService } from "./self-service.events.service";

type SelfServiceEventsCommand = "SELF_SERVICE_EVENTS_LIST";

const QUERY_FIELDS: readonly string[] = Object.freeze([
  "status",
  "windowStartAt",
  "windowEndAt",
  "limit",
]);

export class SelfServiceEventsController extends SecureController {
  constructor(private readonly service: SelfServiceEventsService) {
    super();
  }

  protected async handle(
    req: Request,
    actor: Actor,
    _context: ContextType,
  ): Promise<SelfServiceEventListView> {
    const command = readCommand<SelfServiceEventsCommand>(req);

    if (command !== "SELF_SERVICE_EVENTS_LIST") {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Self-service events command missing",
      );
    }

    return this.service.listCurrentEvents(actor, parseEventsQuery(req));
  }

  protected async present(
    result: SelfServiceEventListView,
  ): Promise<PresentationResult> {
    return SelfServiceEventExposure.exposeList(result);
  }
}

function parseEventsQuery(req: Request): SelfServiceEventListQuery {
  assertNoUnexpectedQueryFields(req.query as Record<string, unknown>);

  return {
    status: parseOptionalStatus(req.query.status),
    windowStartAt: parseOptionalInteger(
      req.query.windowStartAt,
      "windowStartAt",
    ),
    windowEndAt: parseOptionalInteger(
      req.query.windowEndAt,
      "windowEndAt",
    ),
    limit: parseOptionalLimit(req.query.limit),
  };
}

function assertNoUnexpectedQueryFields(
  query: Record<string, unknown>,
): void {
  const unexpectedFields = Object.keys(query).filter(
    (field) => !QUERY_FIELDS.includes(field),
  );

  if (unexpectedFields.length === 0) {
    return;
  }

  throw new SelfServiceValidationError(
    `self-service events query contains unsupported field(s): ${unexpectedFields.join(", ")}`,
  );
}

function parseOptionalStatus(value: unknown): EventStatus | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new SelfServiceValidationError(
      `status must be one of ${EVENT_STATUSES.join(", ")}`,
    );
  }

  const normalized = value.trim().toUpperCase();

  if (EVENT_STATUSES.includes(normalized as EventStatus)) {
    return normalized as EventStatus;
  }

  throw new SelfServiceValidationError(
    `status must be one of ${EVENT_STATUSES.join(", ")}`,
  );
}

function parseOptionalInteger(
  value: unknown,
  field: string,
): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string" && typeof value !== "number") {
    throw new SelfServiceValidationError(`${field} must be an integer`);
  }

  if (typeof value === "string" && value.trim() === "") {
    return undefined;
  }

  const numeric = Number(value);

  if (!Number.isInteger(numeric)) {
    throw new SelfServiceValidationError(`${field} must be an integer`);
  }

  return numeric;
}

function parseOptionalLimit(value: unknown): number | undefined {
  const numeric = parseOptionalInteger(value, "limit");

  if (numeric === undefined) {
    return undefined;
  }

  if (numeric <= 0) {
    throw new SelfServiceValidationError(
      "limit must be a positive integer",
    );
  }

  return numeric;
}
