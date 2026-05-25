import { Request } from "express";
import { readCommand } from "@app/base/command.middleware";
import { SecureController } from "@app/base/secure-controller.base";
import { PresentationResult } from "@app/base/presentation-result.types";
import { Actor } from "@core/actor/actor";
import { ContextType } from "@core/context/context.types";
import { SystemInvariantError } from "@core/error/system-error";
import { SelfServiceValidationError } from "./domain/self-service.errors";
import {
  SelfServiceWorkShiftListQuery,
  SelfServiceWorkShiftListView,
} from "./domain/self-service.types";
import { SelfServiceWorkShiftExposure } from "./shared/self-service.exposure";
import { SelfServiceWorkShiftsService } from "./self-service.work-shifts.service";
import {
  WORK_SHIFT_STATUSES,
  WorkShiftStatus,
} from "@modules/work-schedule/domain/work-schedule.types";

type SelfServiceWorkShiftsCommand = "SELF_SERVICE_WORK_SHIFTS_LIST";

const QUERY_FIELDS: readonly string[] = Object.freeze([
  "status",
  "windowStartAt",
  "windowEndAt",
  "limit",
  "cursor",
]);

export class SelfServiceWorkShiftsController extends SecureController {
  constructor(private readonly service: SelfServiceWorkShiftsService) {
    super();
  }

  protected async handle(
    req: Request,
    actor: Actor,
    _context: ContextType,
  ): Promise<SelfServiceWorkShiftListView> {
    const command = readCommand<SelfServiceWorkShiftsCommand>(req);

    if (command !== "SELF_SERVICE_WORK_SHIFTS_LIST") {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Self-service work shifts command missing",
      );
    }

    return this.service.listCurrentWorkShifts(
      actor,
      parseWorkShiftsQuery(req),
    );
  }

  protected async present(
    result: SelfServiceWorkShiftListView,
  ): Promise<PresentationResult> {
    return SelfServiceWorkShiftExposure.exposeList(result);
  }
}

function parseWorkShiftsQuery(req: Request): SelfServiceWorkShiftListQuery {
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
    cursor: parseOptionalCursor(req.query.cursor),
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
    `self-service work shifts query contains unsupported field(s): ${unexpectedFields.join(", ")}`,
  );
}

function parseOptionalStatus(value: unknown): WorkShiftStatus | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new SelfServiceValidationError(
      `status must be one of ${WORK_SHIFT_STATUSES.join(", ")}`,
    );
  }

  const normalized = value.trim().toUpperCase();

  if (WORK_SHIFT_STATUSES.includes(normalized as WorkShiftStatus)) {
    return normalized as WorkShiftStatus;
  }

  throw new SelfServiceValidationError(
    `status must be one of ${WORK_SHIFT_STATUSES.join(", ")}`,
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

function parseOptionalCursor(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new SelfServiceValidationError("cursor must be a string");
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}
