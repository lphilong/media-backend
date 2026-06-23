import { Actor } from "@core/actor/actor";
import { SystemInvariantError } from "@core/error/system-error";
import { Permission } from "@core/permission/permission.enum";
import { PermissionGuard } from "@core/permission/permission.guard";
import { PermissionResolver } from "@core/permission/permission.resolver";
import {
  WorkScheduleNotFoundError,
  WorkScheduleValidationError,
} from "@modules/work-schedule/domain/work-schedule.errors";
import {
  HOLIDAY_CALENDAR_STATUSES,
  HolidayCalendarStatus,
} from "@modules/work-schedule/domain/work-schedule.types";
import { HolidayCalendarReadRepository } from "@modules/work-schedule/read/work-schedule.read-repository";
import {
  GetHolidayCalendarDetailQuery,
  GetHolidayCalendarDetailResult,
  ListHolidayCalendarsQuery,
  ListHolidayCalendarsResult,
} from "@modules/work-schedule/shared/work-schedule.contracts";
import { requireAdminGlobalScopeAuthority } from "@modules/role/domain/admin-object-scope-authority";
import { StructuredScopeAuthorityService } from "@modules/role/domain/structured-scope-authority";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export class HolidayCalendarAdminQueryService {
  constructor(
    private readonly readRepository: HolidayCalendarReadRepository,
    private readonly structuredAuthority: StructuredScopeAuthorityService,
  ) {}

  async listHolidayCalendars(
    actor: Actor,
    query: ListHolidayCalendarsQuery,
  ): Promise<ListHolidayCalendarsResult> {
    await this.assertReadPermission(actor);

    return this.readRepository.listHolidayCalendars({
      status: parseOptionalStatus(query.status),
      limit: parseLimit(query.limit),
      cursor: parseOptionalCursor(query.cursor),
      search: parseOptionalSearch(query.search),
    });
  }

  async getHolidayCalendarDetail(
    actor: Actor,
    query: GetHolidayCalendarDetailQuery,
  ): Promise<GetHolidayCalendarDetailResult> {
    await this.assertReadPermission(actor);

    const holidayCalendarId = normalizeRequiredText(
      query.holidayCalendarId,
      "holidayCalendarId",
    );
    const detail =
      await this.readRepository.getHolidayCalendarDetail(
        holidayCalendarId,
      );

    if (!detail) {
      throw new WorkScheduleNotFoundError(
        holidayCalendarId,
      );
    }

    return detail;
  }

  private async assertReadPermission(actor: Actor): Promise<void> {
    assertAdminActorType(actor);

    const permission =
      PermissionResolver.resolve(
        Permission.WORK_SCHEDULE_READ,
      );
    PermissionGuard.assert(actor, permission);
    await requireAdminGlobalScopeAuthority({
      actor,
      permission: Permission.WORK_SCHEDULE_READ,
      authority: this.structuredAuthority,
      error: new WorkScheduleValidationError(
        "Holiday Calendar Admin reads require structured global scope",
      ),
    });
  }
}

function parseOptionalStatus(
  value: unknown,
): HolidayCalendarStatus | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new WorkScheduleValidationError(
      `status must be one of ${HOLIDAY_CALENDAR_STATUSES.join(", ")}`,
    );
  }

  const normalized = value
    .trim()
    .toUpperCase();

  if (
    HOLIDAY_CALENDAR_STATUSES.includes(
      normalized as HolidayCalendarStatus,
    )
  ) {
    return normalized as HolidayCalendarStatus;
  }

  throw new WorkScheduleValidationError(
    `status must be one of ${HOLIDAY_CALENDAR_STATUSES.join(", ")}`,
  );
}

function parseLimit(value: unknown): number {
  if (value === undefined || value === null) {
    return DEFAULT_LIMIT;
  }

  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.trim())
        : Number.NaN;

  if (
    !Number.isInteger(parsed) ||
    parsed < 1 ||
    parsed > MAX_LIMIT
  ) {
    throw new WorkScheduleValidationError(
      `limit must be an integer between 1 and ${MAX_LIMIT}`,
    );
  }

  return parsed;
}

function parseOptionalCursor(
  value: unknown,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new WorkScheduleValidationError(
      "cursor must be a string",
    );
  }

  const normalized = value.trim();

  return normalized.length > 0
    ? normalized
    : undefined;
}

function parseOptionalSearch(
  value: unknown,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new WorkScheduleValidationError(
      "search must be a string",
    );
  }

  const normalized = value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();

  return normalized.length > 0
    ? normalized
    : undefined;
}

function normalizeRequiredText(
  value: unknown,
  field: string,
): string {
  if (typeof value !== "string") {
    throw new WorkScheduleValidationError(
      `${field} must be a string`,
    );
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new WorkScheduleValidationError(
      `${field} is required`,
    );
  }

  return normalized;
}

function assertAdminActorType(
  actor: Actor,
): void {
  if (actor.type === "admin") {
    return;
  }

  throw new SystemInvariantError(
    "PERMISSION_DENIED",
    `Holiday calendar access requires actor.type admin, received ${actor.type}`,
  );
}
