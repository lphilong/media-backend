import { Actor } from "@core/actor/actor";
import { Permission } from "@core/permission/permission.enum";
import { PermissionGuard } from "@core/permission/permission.guard";
import { PermissionResolver } from "@core/permission/permission.resolver";
import {
  OrgUnitNotFoundError,
  OrgUnitValidationError,
} from "@modules/org-unit/domain/org-unit.errors";
import {
  ORG_UNIT_SORT_DIRECTIONS,
  ORG_UNIT_SORT_FIELDS,
  ORG_UNIT_STATUSES,
  ORG_UNIT_TYPES,
  OrgUnitSortDirection,
  OrgUnitSortField,
  OrgUnitStatus,
  OrgUnitType,
} from "@modules/org-unit/domain/org-unit.types";
import { OrgUnitReadRepository } from "@modules/org-unit/read/org-unit.read-repository";
import {
  GetOrgUnitDetailQuery,
  GetOrgUnitDetailResult,
  ListDirectChildrenQuery,
  ListDirectChildrenResult,
  ListOrgUnitsQuery,
  ListOrgUnitsResult,
  ListRootOrgUnitsQuery,
  ListRootOrgUnitsResult,
} from "@modules/org-unit/shared/org-unit.contracts";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export class OrgUnitAdminQueryService {
  constructor(
    private readonly readRepository: OrgUnitReadRepository,
  ) {}

  async listOrgUnits(
    actor: Actor,
    query: ListOrgUnitsQuery,
  ): Promise<ListOrgUnitsResult> {
    const permission = PermissionResolver.resolve(
      Permission.ORG_UNIT_READ,
    );
    PermissionGuard.assertAdminActor(actor);
    PermissionGuard.assert(actor, permission);

    const rootOnly = parseOptionalRootOnly(
      query.rootOnly,
    );
    const parentOrgUnitId =
      parseOptionalOrgUnitId(
        query.parentOrgUnitId,
        "parentOrgUnitId",
      );

    if (
      rootOnly === true &&
      parentOrgUnitId !== undefined
    ) {
      throw new OrgUnitValidationError(
        "rootOnly=true cannot be combined with parentOrgUnitId",
      );
    }

    return this.readRepository.listOrgUnits({
      status: parseOptionalStatus(query.status),
      type: parseOptionalType(query.type),
      parentOrgUnitId,
      rootOnly,
      limit: parseLimit(query.limit),
      cursor: parseOptionalCursor(query.cursor),
      search: parseOptionalSearch(query.search),
      sortField: parseOptionalSortField(
        query.sortBy,
      ),
      sortDirection: parseOptionalSortDirection(
        query.sortDirection,
      ),
    });
  }

  async getOrgUnitDetail(
    actor: Actor,
    query: GetOrgUnitDetailQuery,
  ): Promise<GetOrgUnitDetailResult> {
    const permission = PermissionResolver.resolve(
      Permission.ORG_UNIT_READ,
    );
    PermissionGuard.assertAdminActor(actor);
    PermissionGuard.assert(actor, permission);

    const orgUnitId = normalizeRequiredText(
      query.orgUnitId,
      "orgUnitId",
    );
    const detail =
      await this.readRepository.getOrgUnitDetail(
        orgUnitId,
      );

    if (!detail) {
      throw new OrgUnitNotFoundError(orgUnitId);
    }

    return detail;
  }

  async listRootOrgUnits(
    actor: Actor,
    query: ListRootOrgUnitsQuery,
  ): Promise<ListRootOrgUnitsResult> {
    const permission = PermissionResolver.resolve(
      Permission.ORG_UNIT_READ,
    );
    PermissionGuard.assertAdminActor(actor);
    PermissionGuard.assert(actor, permission);

    return this.readRepository.listOrgUnits({
      rootOnly: true,
      limit: parseLimit(query.limit),
      cursor: parseOptionalCursor(query.cursor),
    });
  }

  async listDirectChildren(
    actor: Actor,
    query: ListDirectChildrenQuery,
  ): Promise<ListDirectChildrenResult> {
    const permission = PermissionResolver.resolve(
      Permission.ORG_UNIT_READ,
    );
    PermissionGuard.assertAdminActor(actor);
    PermissionGuard.assert(actor, permission);

    const orgUnitId = normalizeRequiredText(
      query.orgUnitId,
      "orgUnitId",
    );
    const parent =
      await this.readRepository.getOrgUnitDetail(
        orgUnitId,
      );

    if (!parent) {
      throw new OrgUnitNotFoundError(orgUnitId);
    }

    return this.readRepository.listDirectChildren({
      parentOrgUnitId: orgUnitId,
      limit: parseLimit(query.limit),
      cursor: parseOptionalCursor(query.cursor),
    });
  }
}

function normalizeRequiredText(
  value: unknown,
  field: string,
): string {
  if (typeof value !== "string") {
    throw new OrgUnitValidationError(
      `${field} must be a string`,
    );
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new OrgUnitValidationError(
      `${field} is required`,
    );
  }

  return normalized;
}

function parseOptionalOrgUnitId(
  value: unknown,
  field: string,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new OrgUnitValidationError(
      `${field} must be a string`,
    );
  }

  const normalized = value.trim();
  return normalized.length > 0
    ? normalized
    : undefined;
}

function parseOptionalStatus(
  value: unknown,
): OrgUnitStatus | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new OrgUnitValidationError(
      `status must be one of ${ORG_UNIT_STATUSES.join(", ")}`,
    );
  }

  const normalized = value.trim().toUpperCase();

  if (
    ORG_UNIT_STATUSES.includes(
      normalized as OrgUnitStatus,
    )
  ) {
    return normalized as OrgUnitStatus;
  }

  throw new OrgUnitValidationError(
    `status must be one of ${ORG_UNIT_STATUSES.join(", ")}`,
  );
}

function parseOptionalType(
  value: unknown,
): OrgUnitType | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new OrgUnitValidationError(
      `type must be one of ${ORG_UNIT_TYPES.join(", ")}`,
    );
  }

  const normalized = value.trim().toUpperCase();

  if (
    ORG_UNIT_TYPES.includes(
      normalized as OrgUnitType,
    )
  ) {
    return normalized as OrgUnitType;
  }

  throw new OrgUnitValidationError(
    `type must be one of ${ORG_UNIT_TYPES.join(", ")}`,
  );
}

function parseOptionalRootOnly(
  value: unknown,
): boolean | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value !== "string") {
    throw new OrgUnitValidationError(
      "rootOnly must be a boolean",
    );
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === "true") {
    return true;
  }

  if (normalized === "false") {
    return false;
  }

  throw new OrgUnitValidationError(
    "rootOnly must be a boolean",
  );
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
    throw new OrgUnitValidationError(
      "limit must be a positive integer",
    );
  }

  return Math.min(numeric, MAX_LIMIT);
}

function parseOptionalInteger(
  value: unknown,
  field: string,
): number | undefined {
  if (value === undefined) {
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
    throw new OrgUnitValidationError(
      `${field} must be a number`,
    );
  }

  if (!Number.isInteger(numeric)) {
    throw new OrgUnitValidationError(
      `${field} must be an integer`,
    );
  }

  return numeric;
}

function parseOptionalCursor(
  value: unknown,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new OrgUnitValidationError(
      "cursor must be a string",
    );
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function parseOptionalSearch(
  value: unknown,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new OrgUnitValidationError(
      "search must be a string",
    );
  }

  const normalized = value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ");
  return normalized.length > 0 ? normalized : undefined;
}

function parseOptionalSortField(
  value: unknown,
): OrgUnitSortField | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new OrgUnitValidationError(
      `sortBy must be one of ${ORG_UNIT_SORT_FIELDS.join(", ")}`,
    );
  }

  const normalized = value.trim();

  if (
    ORG_UNIT_SORT_FIELDS.includes(
      normalized as OrgUnitSortField,
    )
  ) {
    return normalized as OrgUnitSortField;
  }

  throw new OrgUnitValidationError(
    `sortBy must be one of ${ORG_UNIT_SORT_FIELDS.join(", ")}`,
  );
}

function parseOptionalSortDirection(
  value: unknown,
): OrgUnitSortDirection | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new OrgUnitValidationError(
      `sortDirection must be one of ${ORG_UNIT_SORT_DIRECTIONS.join(", ")}`,
    );
  }

  const normalized = value.trim().toUpperCase();

  if (
    ORG_UNIT_SORT_DIRECTIONS.includes(
      normalized as OrgUnitSortDirection,
    )
  ) {
    return normalized as OrgUnitSortDirection;
  }

  throw new OrgUnitValidationError(
    `sortDirection must be one of ${ORG_UNIT_SORT_DIRECTIONS.join(", ")}`,
  );
}
