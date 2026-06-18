import { Actor } from "@core/actor/actor";
import { SystemInvariantError } from "@core/error/system-error";
import { Permission } from "@core/permission/permission.enum";
import { PermissionGuard } from "@core/permission/permission.guard";
import { PermissionResolver } from "@core/permission/permission.resolver";
import {
  StudioResourceInvalidOperationalStatusError,
  StudioResourceNotFoundError,
  StudioResourcePermissionScopeError,
  StudioResourceValidationError,
} from "@modules/studio-resource/domain/studio-resource.errors";
import {
  STUDIO_RESOURCE_CLASSES,
  STUDIO_RESOURCE_OPERATIONAL_STATUSES,
  STUDIO_RESOURCE_SORT_DIRECTIONS,
  STUDIO_RESOURCE_SORT_FIELDS,
  StudioResourceClass,
  StudioResourceOperationalStatus,
  StudioResourceSortDirection,
  StudioResourceSortField,
} from "@modules/studio-resource/domain/studio-resource.types";
import { StudioResourceReadRepository } from "@modules/studio-resource/read/studio-resource.read-repository";
import {
  GetStudioResourceDetailQuery,
  GetStudioResourceDetailResult,
  ListStudioResourceAvailabilityQuery,
  ListStudioResourceAvailabilityResult,
  ListStudioResourcesQuery,
  ListStudioResourcesResult,
} from "@modules/studio-resource/shared/studio-resource.contracts";
import { requireAdminObjectScopeAuthority } from "@modules/role/domain/admin-object-scope-authority";
import { StructuredScopeAuthorityService } from "@modules/role/domain/structured-scope-authority";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export class StudioResourceAdminQueryService {
  constructor(
    private readonly readRepository: StudioResourceReadRepository,
    private readonly structuredAuthority: StructuredScopeAuthorityService = createMissingStructuredAuthority(),
  ) {}

  async listStudioResources(
    actor: Actor,
    query: ListStudioResourcesQuery,
  ): Promise<ListStudioResourcesResult> {
    this.assertReadPermission(actor);

    return this.readRepository.listStudioResources({
      resourceClass: parseOptionalResourceClass(query.resourceClass),
      operationalStatus: parseOptionalOperationalStatus(
        query.operationalStatus,
      ),
      hasMaxOccupancy: parseOptionalBoolean(
        query.hasMaxOccupancy,
        "hasMaxOccupancy",
      ),
      limit: parseLimit(query.limit),
      cursor: parseOptionalCursor(query.cursor),
      search: parseOptionalSearch(query.search),
      sortField: parseOptionalSortField(query.sortBy),
      sortDirection: parseOptionalSortDirection(query.sortDirection),
    });
  }

  async listStudioResourceAvailability(
    actor: Actor,
    query: ListStudioResourceAvailabilityQuery,
  ): Promise<ListStudioResourceAvailabilityResult> {
    this.assertReadPermission(actor);

    return this.readRepository.listStudioResourceAvailability({
      resourceClass: parseOptionalResourceClass(query.resourceClass),
      operationalStatus: parseOptionalOperationalStatus(
        query.operationalStatus,
      ),
      hasMaxOccupancy: parseOptionalBoolean(
        query.hasMaxOccupancy,
        "hasMaxOccupancy",
      ),
      limit: parseLimit(query.limit),
      cursor: parseOptionalCursor(query.cursor),
      search: parseOptionalSearch(query.search),
      sortField: parseOptionalSortField(query.sortBy),
      sortDirection: parseOptionalSortDirection(query.sortDirection),
    });
  }

  async getStudioResourceDetail(
    actor: Actor,
    query: GetStudioResourceDetailQuery,
  ): Promise<GetStudioResourceDetailResult> {
    this.assertReadPermission(actor);

    const studioResourceId = normalizeRequiredText(
      query.studioResourceId,
      "studioResourceId",
    );
    const detail =
      await this.readRepository.getStudioResourceDetail(studioResourceId);

    if (!detail) {
      throw new StudioResourceNotFoundError(studioResourceId);
    }
    await this.requireAssignedStudioResourceAuthority(actor, studioResourceId);

    return detail;
  }

  private assertReadPermission(actor: Actor): void {
    assertAdminActorType(actor);

    const permission = PermissionResolver.resolve(
      Permission.STUDIO_RESOURCE_READ,
    );
    PermissionGuard.assert(actor, permission);
  }

  private async requireAssignedStudioResourceAuthority(
    actor: Actor,
    studioResourceId: string,
  ): Promise<void> {
    await requireAdminObjectScopeAuthority({
      actor,
      permission: Permission.STUDIO_RESOURCE_READ,
      scope: {
        scopeType: "assignedStudioResource",
        targetId: studioResourceId,
      },
      authority: this.structuredAuthority,
      error: new StudioResourcePermissionScopeError(
        `Studio resource read requires assignedStudioResource scope: ${studioResourceId}`,
      ),
    });
  }
}

function createMissingStructuredAuthority(): StructuredScopeAuthorityService {
  return new StructuredScopeAuthorityService({
    async listByUserId(): Promise<never> {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "StructuredScopeAuthorityService is required for Studio Resource reads",
      );
    },
  });
}

function normalizeRequiredText(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new StudioResourceValidationError(`${field} must be a string`);
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new StudioResourceValidationError(`${field} is required`);
  }

  return normalized;
}

function parseOptionalResourceClass(
  value: unknown,
): StudioResourceClass | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new StudioResourceValidationError(
      `resourceClass must be one of ${STUDIO_RESOURCE_CLASSES.join(", ")}`,
    );
  }

  const normalized = value.trim().toUpperCase();

  if (STUDIO_RESOURCE_CLASSES.includes(normalized as StudioResourceClass)) {
    return normalized as StudioResourceClass;
  }

  throw new StudioResourceValidationError(
    `resourceClass must be one of ${STUDIO_RESOURCE_CLASSES.join(", ")}`,
  );
}

function parseOptionalOperationalStatus(
  value: unknown,
): StudioResourceOperationalStatus | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new StudioResourceInvalidOperationalStatusError(
      `operationalStatus must be one of ${STUDIO_RESOURCE_OPERATIONAL_STATUSES.join(", ")}`,
    );
  }

  const normalized = value.trim().toUpperCase();

  if (
    STUDIO_RESOURCE_OPERATIONAL_STATUSES.includes(
      normalized as StudioResourceOperationalStatus,
    )
  ) {
    return normalized as StudioResourceOperationalStatus;
  }

  throw new StudioResourceInvalidOperationalStatusError(
    `operationalStatus must be one of ${STUDIO_RESOURCE_OPERATIONAL_STATUSES.join(", ")}`,
  );
}

function parseOptionalBoolean(
  value: unknown,
  field: string,
): boolean | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value !== "string") {
    throw new StudioResourceValidationError(`${field} must be a boolean`);
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === "true") {
    return true;
  }

  if (normalized === "false") {
    return false;
  }

  throw new StudioResourceValidationError(`${field} must be a boolean`);
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
    throw new StudioResourceValidationError("limit must be a positive integer");
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
    throw new StudioResourceValidationError(`${field} must be an integer`);
  }

  if (!Number.isInteger(numeric)) {
    throw new StudioResourceValidationError(`${field} must be an integer`);
  }

  return numeric;
}

function parseOptionalCursor(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new StudioResourceValidationError("cursor must be a string");
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function parseOptionalSearch(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new StudioResourceValidationError("search must be a string");
  }

  const normalized = canonicalizeSearchToken(value);
  return normalized.length > 0 ? normalized : undefined;
}

function canonicalizeSearchToken(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

function assertAdminActorType(actor: Actor): void {
  if (actor.type === "admin") {
    return;
  }

  throw new SystemInvariantError(
    "PERMISSION_DENIED",
    `Studio resource access requires actor.type admin, received ${actor.type}`,
  );
}

function parseOptionalSortField(
  value: unknown,
): StudioResourceSortField | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new StudioResourceValidationError(
      `sortBy must be one of ${STUDIO_RESOURCE_SORT_FIELDS.join(", ")}`,
    );
  }

  const normalized = value.trim();

  if (
    STUDIO_RESOURCE_SORT_FIELDS.includes(normalized as StudioResourceSortField)
  ) {
    return normalized as StudioResourceSortField;
  }

  throw new StudioResourceValidationError(
    `sortBy must be one of ${STUDIO_RESOURCE_SORT_FIELDS.join(", ")}`,
  );
}

function parseOptionalSortDirection(
  value: unknown,
): StudioResourceSortDirection | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new StudioResourceValidationError(
      `sortDirection must be one of ${STUDIO_RESOURCE_SORT_DIRECTIONS.join(", ")}`,
    );
  }

  const normalized = value.trim().toUpperCase();

  if (
    STUDIO_RESOURCE_SORT_DIRECTIONS.includes(
      normalized as StudioResourceSortDirection,
    )
  ) {
    return normalized as StudioResourceSortDirection;
  }

  throw new StudioResourceValidationError(
    `sortDirection must be one of ${STUDIO_RESOURCE_SORT_DIRECTIONS.join(", ")}`,
  );
}
