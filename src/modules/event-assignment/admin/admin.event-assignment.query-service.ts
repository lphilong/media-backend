import { Actor } from "@core/actor/actor";
import { SystemInvariantError } from "@core/error/system-error";
import { Permission } from "@core/permission/permission.enum";
import { PermissionGuard } from "@core/permission/permission.guard";
import { PermissionResolver } from "@core/permission/permission.resolver";
import {
  EventAssignmentNotFoundError,
  EventAssignmentPermissionScopeError,
  EventAssignmentValidationError,
} from "@modules/event-assignment/domain/event-assignment.errors";
import {
  EVENT_ASSIGNMENT_KINDS,
  EVENT_SORT_DIRECTIONS,
  EVENT_SORT_FIELDS,
  EVENT_STATUSES,
  EventAssignmentKind,
  EventSortDirection,
  EventSortField,
  EventStatus,
} from "@modules/event-assignment/domain/event-assignment.types";
import {
  EventAssignmentReadRepository,
  EventByAssignmentListReadInput,
} from "@modules/event-assignment/read/event-assignment.read-repository";
import {
  GetEventDetailQuery,
  GetEventDetailResult,
  ListEventAssignmentsQuery,
  ListEventAssignmentsResult,
  ListStudioBookingsQuery,
  ListStudioBookingsResult,
  ListEventsByAssignmentQuery,
  ListEventsByAssignmentResult,
  ListEventsByPlatformQuery,
  ListEventsByPlatformResult,
  ListEventsByResourceQuery,
  ListEventsByResourceResult,
  ListEventsQuery,
  ListEventsResult,
} from "@modules/event-assignment/shared/event-assignment.contracts";
import { requireAdminObjectScopeAuthority } from "@modules/role/domain/admin-object-scope-authority";
import { StructuredScopeAuthorityService } from "@modules/role/domain/structured-scope-authority";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

interface ParsedAssignmentFilter {
  readonly assignmentKind?: EventAssignmentKind;
  readonly assignmentEmploymentProfileId?: string;
  readonly assignmentTalentId?: string;
  readonly assignmentTalentGroupId?: string;
}

interface ParsedExactAssignment {
  readonly assignmentKind: EventAssignmentKind;
  readonly assignmentEmploymentProfileId: string | null;
  readonly assignmentTalentId: string | null;
  readonly assignmentTalentGroupId: string | null;
}

interface ParsedWindowFilter {
  readonly windowStartAt?: number;
  readonly windowEndAt?: number;
}

interface ParsedEventTargetFilters {
  readonly eventOverlapStartAt?: number;
  readonly eventOverlapEndAt?: number;
  readonly eventStartFromAt?: number;
  readonly eventStartToAt?: number;
}

const ACTIVE_EVENT_STATUSES: readonly EventStatus[] = [
  "PLANNED",
  "CONFIRMED",
] as const;

type EventAssignmentReadScope = {
  readonly kind: "global";
};

export class EventAssignmentAdminQueryService {
  constructor(
    private readonly readRepository: EventAssignmentReadRepository,
    private readonly structuredAuthority: StructuredScopeAuthorityService = createMissingStructuredAuthority(),
  ) {}

  async listEvents(
    actor: Actor,
    query: ListEventsQuery,
  ): Promise<ListEventsResult> {
    this.assertReadPermission(actor);
    await this.resolveReadScope(actor);

    const assignmentFilter = parseAssignmentFilter({
      assignmentKind: query.assignmentKind,
      assignmentEmploymentProfileId: query.assignmentEmploymentProfileId,
      assignmentTalentId: query.assignmentTalentId,
      assignmentTalentGroupId: query.assignmentTalentGroupId,
    });
    const window = parseWindowFilter({
      windowStartAt: query.windowStartAt,
      windowEndAt: query.windowEndAt,
    });
    const targetFilters = parseEventTargetFilters({
      eventOverlapStartAt: query.eventOverlapStartAt,
      eventOverlapEndAt: query.eventOverlapEndAt,
      eventStartFromAt: query.eventStartFromAt,
      eventStartToAt: query.eventStartToAt,
    });
    const statusFilters = parseEventStatusFilters({
      status: query.status,
      statusGroup: query.statusGroup,
    });

    return this.readRepository.listEvents({
      status: statusFilters.status,
      statuses: statusFilters.statuses,
      assignmentKind: assignmentFilter.assignmentKind,
      assignmentEmploymentProfileId:
        assignmentFilter.assignmentEmploymentProfileId,
      assignmentTalentId: assignmentFilter.assignmentTalentId,
      assignmentTalentGroupId: assignmentFilter.assignmentTalentGroupId,
      containsStudioResourceId: parseOptionalId(
        query.containsStudioResourceId,
        "containsStudioResourceId",
      ),
      containsPlatformAccountId: parseOptionalId(
        query.containsPlatformAccountId,
        "containsPlatformAccountId",
      ),
      windowStartAt: window.windowStartAt,
      windowEndAt: window.windowEndAt,
      eventOverlapStartAt: targetFilters.eventOverlapStartAt,
      eventOverlapEndAt: targetFilters.eventOverlapEndAt,
      eventStartFromAt: targetFilters.eventStartFromAt,
      eventStartToAt: targetFilters.eventStartToAt,
      limit: parseLimit(query.limit),
      cursor: parseOptionalCursor(query.cursor),
      search: parseOptionalSearch(query.search),
      sortField: parseOptionalSortField(query.sortBy),
      sortDirection: parseOptionalSortDirection(query.sortDirection),
    });
  }

  async listEventsByAssignment(
    actor: Actor,
    query: ListEventsByAssignmentQuery,
  ): Promise<ListEventsByAssignmentResult> {
    this.assertReadPermission(actor);
    await this.resolveReadScope(actor);

    const assignment = parseExactAssignment(query);
    const window = parseWindowFilter({
      windowStartAt: query.windowStartAt,
      windowEndAt: query.windowEndAt,
    });

    const readInput: EventByAssignmentListReadInput = {
      assignmentKind: assignment.assignmentKind,
      assignmentEmploymentProfileId: assignment.assignmentEmploymentProfileId,
      assignmentTalentId: assignment.assignmentTalentId,
      assignmentTalentGroupId: assignment.assignmentTalentGroupId,
      status: parseOptionalStatus(query.status),
      windowStartAt: window.windowStartAt,
      windowEndAt: window.windowEndAt,
      limit: parseLimit(query.limit),
      cursor: parseOptionalCursor(query.cursor),
      sortField: parseOptionalSortField(query.sortBy),
      sortDirection: parseOptionalSortDirection(query.sortDirection),
    };

    return this.readRepository.listEventsByAssignment(readInput);
  }

  async listEventsByResource(
    actor: Actor,
    query: ListEventsByResourceQuery,
  ): Promise<ListEventsByResourceResult> {
    this.assertReadPermission(actor);
    const studioResourceId = normalizeRequiredText(
      query.studioResourceId,
      "studioResourceId",
    );
    await this.requireAssignedStudioResourceAuthority(actor, studioResourceId);

    const window = parseWindowFilter({
      windowStartAt: query.windowStartAt,
      windowEndAt: query.windowEndAt,
    });

    return this.readRepository.listEventsByResource({
      studioResourceId,
      status: parseOptionalStatus(query.status),
      windowStartAt: window.windowStartAt,
      windowEndAt: window.windowEndAt,
      limit: parseLimit(query.limit),
      cursor: parseOptionalCursor(query.cursor),
      sortField: parseOptionalSortField(query.sortBy),
      sortDirection: parseOptionalSortDirection(query.sortDirection),
    });
  }

  async listEventsByPlatform(
    actor: Actor,
    query: ListEventsByPlatformQuery,
  ): Promise<ListEventsByPlatformResult> {
    this.assertReadPermission(actor);
    const platformAccountId = normalizeRequiredText(
      query.platformAccountId,
      "platformAccountId",
    );
    await this.requireAssignedPlatformAccountAuthority(
      actor,
      platformAccountId,
    );

    const window = parseWindowFilter({
      windowStartAt: query.windowStartAt,
      windowEndAt: query.windowEndAt,
    });

    return this.readRepository.listEventsByPlatform({
      platformAccountId,
      status: parseOptionalStatus(query.status),
      windowStartAt: window.windowStartAt,
      windowEndAt: window.windowEndAt,
      limit: parseLimit(query.limit),
      cursor: parseOptionalCursor(query.cursor),
      sortField: parseOptionalSortField(query.sortBy),
      sortDirection: parseOptionalSortDirection(query.sortDirection),
    });
  }

  async listEventAssignments(
    actor: Actor,
    query: ListEventAssignmentsQuery,
  ): Promise<ListEventAssignmentsResult> {
    this.assertReadPermission(actor);

    const eventId = normalizeRequiredText(query.eventId, "eventId");

    const detail = await this.readRepository.getEventDetail(eventId);

    if (!detail) {
      throw new EventAssignmentNotFoundError(eventId);
    }
    await this.requireAssignedEventAuthority(actor, eventId);

    const items =
      await this.readRepository.listActiveAssignmentsForEvent(eventId);

    return {
      items,
    };
  }

  async getEventDetail(
    actor: Actor,
    query: GetEventDetailQuery,
  ): Promise<GetEventDetailResult> {
    this.assertReadPermission(actor);

    const eventId = normalizeRequiredText(query.eventId, "eventId");
    const detail = await this.readRepository.getEventDetail(eventId);

    if (!detail) {
      throw new EventAssignmentNotFoundError(eventId);
    }
    await this.requireAssignedEventAuthority(actor, eventId);

    return detail;
  }

  async listStudioBookings(
    actor: Actor,
    query: ListStudioBookingsQuery,
  ): Promise<ListStudioBookingsResult> {
    this.assertReadPermission(actor);
    const eventId = normalizeRequiredText(query.eventId, "eventId");
    const detail = await this.readRepository.getEventDetail(eventId);
    if (!detail) {
      throw new EventAssignmentNotFoundError(eventId);
    }
    await this.requireAssignedEventAuthority(actor, eventId);
    return {
      items: await this.readRepository.listStudioBookings(eventId),
    };
  }

  private assertReadPermission(actor: Actor): void {
    assertAdminActorType(actor);

    const permission = PermissionResolver.resolve(Permission.EVENT_READ);
    PermissionGuard.assert(actor, permission);
  }

  private async resolveReadScope(
    actor: Actor,
  ): Promise<EventAssignmentReadScope> {
    if (
      await this.structuredAuthority.hasAuthority({
        userId: actor.id,
        permission: Permission.EVENT_READ,
        scope: { scopeType: "global" },
      })
    ) {
      return {
        kind: "global",
      };
    }

    throw new EventAssignmentPermissionScopeError(
      "Global Admin Event routes require structured global scope",
    );
  }

  private async requireAssignedEventAuthority(
    actor: Actor,
    eventId: string,
  ): Promise<void> {
    await requireAdminObjectScopeAuthority({
      actor,
      permission: Permission.EVENT_READ,
      scope: { scopeType: "assignedEvent", targetId: eventId },
      authority: this.structuredAuthority,
      error: new EventAssignmentPermissionScopeError(
        `Event read requires assignedEvent scope: ${eventId}`,
      ),
    });
  }

  private async requireAssignedStudioResourceAuthority(
    actor: Actor,
    studioResourceId: string,
  ): Promise<void> {
    await requireAdminObjectScopeAuthority({
      actor,
      permission: Permission.EVENT_READ,
      scope: {
        scopeType: "assignedStudioResource",
        targetId: studioResourceId,
      },
      authority: this.structuredAuthority,
      error: new EventAssignmentPermissionScopeError(
        `Event resource read requires assignedStudioResource scope: ${studioResourceId}`,
      ),
    });
  }

  private async requireAssignedPlatformAccountAuthority(
    actor: Actor,
    platformAccountId: string,
  ): Promise<void> {
    await requireAdminObjectScopeAuthority({
      actor,
      permission: Permission.EVENT_READ,
      scope: {
        scopeType: "assignedPlatformAccount",
        targetId: platformAccountId,
      },
      authority: this.structuredAuthority,
      error: new EventAssignmentPermissionScopeError(
        `Event platform read requires assignedPlatformAccount scope: ${platformAccountId}`,
      ),
    });
  }
}

function createMissingStructuredAuthority(): StructuredScopeAuthorityService {
  return new StructuredScopeAuthorityService({
    async listByUserId(): Promise<never> {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "StructuredScopeAuthorityService is required for Event reads",
      );
    },
  });
}

function normalizeRequiredText(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new EventAssignmentValidationError(`${field} must be a string`);
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new EventAssignmentValidationError(`${field} is required`);
  }

  return normalized;
}

function parseOptionalId(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new EventAssignmentValidationError(`${field} must be a string`);
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function parseOptionalStatus(value: unknown): EventStatus | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new EventAssignmentValidationError(
      `status must be one of ${EVENT_STATUSES.join(", ")}`,
    );
  }

  const normalized = value.trim().toUpperCase();

  if (EVENT_STATUSES.includes(normalized as EventStatus)) {
    return normalized as EventStatus;
  }

  throw new EventAssignmentValidationError(
    `status must be one of ${EVENT_STATUSES.join(", ")}`,
  );
}

function parseEventStatusFilters(input: {
  readonly status: unknown;
  readonly statusGroup: unknown;
}): {
  readonly status?: EventStatus;
  readonly statuses?: readonly EventStatus[];
} {
  const status = parseOptionalStatus(input.status);
  const statusGroup = parseOptionalStatusGroup(input.statusGroup);

  if (!statusGroup) {
    return { status };
  }

  if (status !== undefined && !ACTIVE_EVENT_STATUSES.includes(status)) {
    throw new EventAssignmentValidationError(
      "status is inconsistent with statusGroup ACTIVE",
    );
  }

  return {
    status,
    statuses: status === undefined ? ACTIVE_EVENT_STATUSES : undefined,
  };
}

function parseOptionalStatusGroup(value: unknown): "ACTIVE" | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new EventAssignmentValidationError("statusGroup must be ACTIVE");
  }

  const normalized = value.trim().toUpperCase();

  if (normalized === "ACTIVE") {
    return "ACTIVE";
  }

  throw new EventAssignmentValidationError("statusGroup must be ACTIVE");
}

function parseAssignmentFilter(input: {
  readonly assignmentKind: unknown;
  readonly assignmentEmploymentProfileId: unknown;
  readonly assignmentTalentId: unknown;
  readonly assignmentTalentGroupId: unknown;
}): ParsedAssignmentFilter {
  const assignmentKind = parseOptionalAssignmentKind(input.assignmentKind);
  const assignmentEmploymentProfileId = parseOptionalId(
    input.assignmentEmploymentProfileId,
    "assignmentEmploymentProfileId",
  );
  const assignmentTalentId = parseOptionalId(
    input.assignmentTalentId,
    "assignmentTalentId",
  );
  const assignmentTalentGroupId = parseOptionalId(
    input.assignmentTalentGroupId,
    "assignmentTalentGroupId",
  );
  const providedAssignmentReferences = [
    assignmentEmploymentProfileId,
    assignmentTalentId,
    assignmentTalentGroupId,
  ].filter((value) => value !== undefined);

  if (providedAssignmentReferences.length > 1) {
    throw new EventAssignmentValidationError(
      "At most one assignment reference filter may be provided",
    );
  }

  if (assignmentKind) {
    if (
      assignmentKind === "EMPLOYMENT_PROFILE" &&
      (assignmentTalentId !== undefined ||
        assignmentTalentGroupId !== undefined)
    ) {
      throw new EventAssignmentValidationError(
        "assignmentKind EMPLOYMENT_PROFILE is inconsistent with assignmentTalentId/assignmentTalentGroupId filter",
      );
    }

    if (
      assignmentKind === "TALENT" &&
      (assignmentEmploymentProfileId !== undefined ||
        assignmentTalentGroupId !== undefined)
    ) {
      throw new EventAssignmentValidationError(
        "assignmentKind TALENT is inconsistent with assignmentEmploymentProfileId/assignmentTalentGroupId filter",
      );
    }

    if (
      assignmentKind === "TALENT_GROUP" &&
      (assignmentEmploymentProfileId !== undefined ||
        assignmentTalentId !== undefined)
    ) {
      throw new EventAssignmentValidationError(
        "assignmentKind TALENT_GROUP is inconsistent with assignmentEmploymentProfileId/assignmentTalentId filter",
      );
    }
  }

  return {
    assignmentKind,
    assignmentEmploymentProfileId,
    assignmentTalentId,
    assignmentTalentGroupId,
  };
}

function parseExactAssignment(
  query: ListEventsByAssignmentQuery,
): ParsedExactAssignment {
  const assignmentKind = parseRequiredAssignmentKind(query.assignmentKind);
  const assignmentEmploymentProfileId = parseOptionalId(
    query.assignmentEmploymentProfileId,
    "assignmentEmploymentProfileId",
  );
  const assignmentTalentId = parseOptionalId(
    query.assignmentTalentId,
    "assignmentTalentId",
  );
  const assignmentTalentGroupId = parseOptionalId(
    query.assignmentTalentGroupId,
    "assignmentTalentGroupId",
  );

  if (
    assignmentKind === "EMPLOYMENT_PROFILE" &&
    assignmentEmploymentProfileId &&
    !assignmentTalentId &&
    !assignmentTalentGroupId
  ) {
    return {
      assignmentKind,
      assignmentEmploymentProfileId,
      assignmentTalentId: null,
      assignmentTalentGroupId: null,
    };
  }

  if (
    assignmentKind === "TALENT" &&
    assignmentTalentId &&
    !assignmentEmploymentProfileId &&
    !assignmentTalentGroupId
  ) {
    return {
      assignmentKind,
      assignmentEmploymentProfileId: null,
      assignmentTalentId,
      assignmentTalentGroupId: null,
    };
  }

  if (
    assignmentKind === "TALENT_GROUP" &&
    assignmentTalentGroupId &&
    !assignmentEmploymentProfileId &&
    !assignmentTalentId
  ) {
    return {
      assignmentKind,
      assignmentEmploymentProfileId: null,
      assignmentTalentId: null,
      assignmentTalentGroupId,
    };
  }

  throw new EventAssignmentValidationError(
    "listEventsByAssignment requires exactly one assignment reference matching assignmentKind",
  );
}

function parseOptionalAssignmentKind(
  value: unknown,
): EventAssignmentKind | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  return parseRequiredAssignmentKind(value);
}

function parseRequiredAssignmentKind(value: unknown): EventAssignmentKind {
  if (typeof value !== "string") {
    throw new EventAssignmentValidationError(
      `assignmentKind must be one of ${EVENT_ASSIGNMENT_KINDS.join(", ")}`,
    );
  }

  const normalized = value.trim().toUpperCase();

  if (EVENT_ASSIGNMENT_KINDS.includes(normalized as EventAssignmentKind)) {
    return normalized as EventAssignmentKind;
  }

  throw new EventAssignmentValidationError(
    `assignmentKind must be one of ${EVENT_ASSIGNMENT_KINDS.join(", ")}`,
  );
}

function parseWindowFilter(input: {
  readonly windowStartAt: unknown;
  readonly windowEndAt: unknown;
}): ParsedWindowFilter {
  const windowStartAt = parseOptionalTimestamp(
    input.windowStartAt,
    "windowStartAt",
  );
  const windowEndAt = parseOptionalTimestamp(input.windowEndAt, "windowEndAt");

  if (
    windowStartAt !== undefined &&
    windowEndAt !== undefined &&
    windowEndAt <= windowStartAt
  ) {
    throw new EventAssignmentValidationError(
      "windowEndAt must be strictly later than windowStartAt",
    );
  }

  return {
    windowStartAt,
    windowEndAt,
  };
}

function parseEventTargetFilters(input: {
  readonly eventOverlapStartAt: unknown;
  readonly eventOverlapEndAt: unknown;
  readonly eventStartFromAt: unknown;
  readonly eventStartToAt: unknown;
}): ParsedEventTargetFilters {
  const eventOverlapStartAt = parseOptionalTimestamp(
    input.eventOverlapStartAt,
    "eventOverlapStartAt",
  );
  const eventOverlapEndAt = parseOptionalTimestamp(
    input.eventOverlapEndAt,
    "eventOverlapEndAt",
  );
  const eventStartFromAt = parseOptionalTimestamp(
    input.eventStartFromAt,
    "eventStartFromAt",
  );
  const eventStartToAt = parseOptionalTimestamp(
    input.eventStartToAt,
    "eventStartToAt",
  );

  if (
    eventOverlapStartAt !== undefined &&
    eventOverlapEndAt !== undefined &&
    eventOverlapEndAt <= eventOverlapStartAt
  ) {
    throw new EventAssignmentValidationError(
      "eventOverlapEndAt must be strictly later than eventOverlapStartAt",
    );
  }

  if (
    eventStartFromAt !== undefined &&
    eventStartToAt !== undefined &&
    eventStartToAt <= eventStartFromAt
  ) {
    throw new EventAssignmentValidationError(
      "eventStartToAt must be strictly later than eventStartFromAt",
    );
  }

  return {
    eventOverlapStartAt,
    eventOverlapEndAt,
    eventStartFromAt,
    eventStartToAt,
  };
}

function parseLimit(value: unknown): number {
  if (value === undefined) {
    return DEFAULT_LIMIT;
  }

  const numeric = parseOptionalInteger(value, "limit");

  if (numeric === undefined) {
    return DEFAULT_LIMIT;
  }

  if (numeric <= 0) {
    throw new EventAssignmentValidationError(
      "limit must be a positive integer",
    );
  }

  return Math.min(numeric, MAX_LIMIT);
}

function parseOptionalInteger(
  value: unknown,
  field: string,
): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  let numeric: number;

  if (typeof value === "number") {
    numeric = value;
  } else if (typeof value === "string") {
    if (!value.trim()) {
      return undefined;
    }

    numeric = Number(value);
  } else {
    throw new EventAssignmentValidationError(`${field} must be an integer`);
  }

  if (!Number.isInteger(numeric)) {
    throw new EventAssignmentValidationError(`${field} must be an integer`);
  }

  return numeric;
}

function parseOptionalTimestamp(
  value: unknown,
  field: string,
): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const parsed = parseOptionalInteger(value, field);

  if (parsed === undefined) {
    return undefined;
  }

  return parsed;
}

function parseOptionalCursor(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new EventAssignmentValidationError("cursor must be a string");
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function parseOptionalSearch(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new EventAssignmentValidationError("search must be a string");
  }

  const normalized = value.normalize("NFKC").trim().replace(/\s+/gu, " ");

  return normalized.length > 0 ? normalized : undefined;
}

function parseOptionalSortField(value: unknown): EventSortField | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new EventAssignmentValidationError(
      `sortBy must be one of ${EVENT_SORT_FIELDS.join(", ")}`,
    );
  }

  const normalized = value.trim();

  if (EVENT_SORT_FIELDS.includes(normalized as EventSortField)) {
    return normalized as EventSortField;
  }

  throw new EventAssignmentValidationError(
    `sortBy must be one of ${EVENT_SORT_FIELDS.join(", ")}`,
  );
}

function parseOptionalSortDirection(
  value: unknown,
): EventSortDirection | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new EventAssignmentValidationError(
      `sortDirection must be one of ${EVENT_SORT_DIRECTIONS.join(", ")}`,
    );
  }

  const normalized = value.trim().toUpperCase();

  if (EVENT_SORT_DIRECTIONS.includes(normalized as EventSortDirection)) {
    return normalized as EventSortDirection;
  }

  throw new EventAssignmentValidationError(
    `sortDirection must be one of ${EVENT_SORT_DIRECTIONS.join(", ")}`,
  );
}

function assertAdminActorType(actor: Actor): void {
  PermissionGuard.assertAdminActor(actor);
}
