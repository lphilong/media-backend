import { Actor } from "@core/actor/actor";
import { Permission } from "@core/permission/permission.enum";
import { PermissionGuard } from "@core/permission/permission.guard";
import { PermissionResolver } from "@core/permission/permission.resolver";
import {
  PlatformAccountNotFoundError,
  PlatformAccountPermissionScopeError,
  PlatformAccountValidationError,
} from "@modules/platform-account/domain/platform-account.errors";
import {
  PLATFORM_ACCOUNT_OPERATIONAL_STATUSES,
  PLATFORM_ACCOUNT_OWNER_KINDS,
  PLATFORM_ACCOUNT_PLATFORMS,
  PLATFORM_ACCOUNT_SORT_DIRECTIONS,
  PLATFORM_ACCOUNT_SORT_FIELDS,
  PLATFORM_ACCOUNT_SURFACE_TYPES,
  PlatformAccountOperationalStatus,
  PlatformAccountOwnerKind,
  PlatformAccountPlatform,
  PlatformAccountSortDirection,
  PlatformAccountSortField,
  PlatformAccountSurfaceType,
} from "@modules/platform-account/domain/platform-account.types";
import { PlatformAccountReadRepository } from "@modules/platform-account/read/platform-account.read-repository";
import {
  GetPlatformAccountDetailQuery,
  GetPlatformAccountDetailResult,
  ListPlatformAccountsQuery,
  ListPlatformAccountsResult,
} from "@modules/platform-account/shared/platform-account.contracts";
import { requireAdminGlobalOrObjectScopeAuthority } from "@modules/role/domain/admin-object-scope-authority";
import { StructuredScopeAuthorityService } from "@modules/role/domain/structured-scope-authority";
import { SystemInvariantError } from "@core/error/system-error";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

interface ParsedOwnerFilters {
  readonly ownerKind?: PlatformAccountOwnerKind;
  readonly ownerOrgUnitId?: string;
  readonly ownerTalentId?: string;
  readonly ownerTalentGroupId?: string;
}

export class PlatformAccountAdminQueryService {
  constructor(
    private readonly readRepository: PlatformAccountReadRepository,
    private readonly structuredAuthority: StructuredScopeAuthorityService = createMissingStructuredAuthority(),
  ) {}

  async listPlatformAccounts(
    actor: Actor,
    query: ListPlatformAccountsQuery,
  ): Promise<ListPlatformAccountsResult> {
    const permission = PermissionResolver.resolve(
      Permission.PLATFORM_ACCOUNT_READ,
    );
    PermissionGuard.assertAdminActor(actor);
    PermissionGuard.assert(actor, permission);
    const platformAccountIds = await this.resolveListPlatformAccountIds(actor);

    const ownerFilters = parseOwnerFilters(query);

    return this.readRepository.listPlatformAccounts({
      platformAccountIds,
      platform: parseOptionalPlatform(query.platform),
      platformSurfaceType: parseOptionalSurfaceType(query.platformSurfaceType),
      operationalStatus: parseOptionalOperationalStatus(
        query.operationalStatus,
      ),
      ownerKind: ownerFilters.ownerKind,
      ownerOrgUnitId: ownerFilters.ownerOrgUnitId,
      ownerTalentId: ownerFilters.ownerTalentId,
      ownerTalentGroupId: ownerFilters.ownerTalentGroupId,
      livestreamEnabled: parseOptionalBoolean(
        query.livestreamEnabled,
        "livestreamEnabled",
      ),
      contentPublishingEnabled: parseOptionalBoolean(
        query.contentPublishingEnabled,
        "contentPublishingEnabled",
      ),
      monetizationEnabled: parseOptionalBoolean(
        query.monetizationEnabled,
        "monetizationEnabled",
      ),
      limit: parseLimit(query.limit),
      cursor: parseOptionalCursor(query.cursor),
      search: parseOptionalSearch(query.search),
      sortField: parseOptionalSortField(query.sortBy),
      sortDirection: parseOptionalSortDirection(query.sortDirection),
    });
  }

  async getPlatformAccountDetail(
    actor: Actor,
    query: GetPlatformAccountDetailQuery,
  ): Promise<GetPlatformAccountDetailResult> {
    const permission = PermissionResolver.resolve(
      Permission.PLATFORM_ACCOUNT_READ,
    );
    PermissionGuard.assertAdminActor(actor);
    PermissionGuard.assert(actor, permission);

    const platformAccountId = normalizeRequiredText(
      query.platformAccountId,
      "platformAccountId",
    );
    const detail =
      await this.readRepository.getPlatformAccountDetail(platformAccountId);

    if (!detail) {
      throw new PlatformAccountNotFoundError(platformAccountId);
    }
    await this.requireAssignedPlatformAccountAuthority(
      actor,
      platformAccountId,
    );

    return detail;
  }

  private async requireAssignedPlatformAccountAuthority(
    actor: Actor,
    platformAccountId: string,
  ): Promise<void> {
    await requireAdminGlobalOrObjectScopeAuthority({
      actor,
      permission: Permission.PLATFORM_ACCOUNT_READ,
      scope: {
        scopeType: "assignedPlatformAccount",
        targetId: platformAccountId,
      },
      authority: this.structuredAuthority,
      error: new PlatformAccountPermissionScopeError(
        `Platform account read requires assignedPlatformAccount scope: ${platformAccountId}`,
      ),
    });
  }

  private async resolveListPlatformAccountIds(
    actor: Actor,
  ): Promise<readonly string[] | undefined> {
    const grants = await this.structuredAuthority.listAuthorizedScopeGrants({
      userId: actor.id,
      permission: Permission.PLATFORM_ACCOUNT_READ,
    });
    if (grants.some((grant) => grant.scopeType === "global")) {
      return undefined;
    }
    return [
      ...new Set(
        grants
          .filter((grant) => grant.scopeType === "assignedPlatformAccount")
          .map((grant) => grant.targetId)
          .filter((id): id is string => Boolean(id)),
      ),
    ].sort();
  }
}

function createMissingStructuredAuthority(): StructuredScopeAuthorityService {
  return new StructuredScopeAuthorityService({
    async listByUserId(): Promise<never> {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "StructuredScopeAuthorityService is required for Platform Account reads",
      );
    },
  });
}

function parseOwnerFilters(
  query: ListPlatformAccountsQuery,
): ParsedOwnerFilters {
  const ownerKind = parseOptionalOwnerKind(query.ownerKind);
  const ownerOrgUnitId = parseOptionalId(
    query.ownerOrgUnitId,
    "ownerOrgUnitId",
  );
  const ownerTalentId = parseOptionalId(query.ownerTalentId, "ownerTalentId");
  const ownerTalentGroupId = parseOptionalId(
    query.ownerTalentGroupId,
    "ownerTalentGroupId",
  );

  const providedOwnerFilters = [
    ownerOrgUnitId !== undefined,
    ownerTalentId !== undefined,
    ownerTalentGroupId !== undefined,
  ].filter(Boolean).length;

  if (providedOwnerFilters > 1) {
    throw new PlatformAccountValidationError(
      "At most one owner reference filter may be provided",
    );
  }

  if (ownerKind === "ORG_UNIT" && ownerTalentId !== undefined) {
    throw new PlatformAccountValidationError(
      "ownerKind=ORG_UNIT must not be combined with ownerTalentId",
    );
  }

  if (ownerKind === "ORG_UNIT" && ownerTalentGroupId !== undefined) {
    throw new PlatformAccountValidationError(
      "ownerKind=ORG_UNIT must not be combined with ownerTalentGroupId",
    );
  }

  if (ownerKind === "TALENT" && ownerOrgUnitId !== undefined) {
    throw new PlatformAccountValidationError(
      "ownerKind=TALENT must not be combined with ownerOrgUnitId",
    );
  }

  if (ownerKind === "TALENT" && ownerTalentGroupId !== undefined) {
    throw new PlatformAccountValidationError(
      "ownerKind=TALENT must not be combined with ownerTalentGroupId",
    );
  }

  if (ownerKind === "TALENT_GROUP" && ownerOrgUnitId !== undefined) {
    throw new PlatformAccountValidationError(
      "ownerKind=TALENT_GROUP must not be combined with ownerOrgUnitId",
    );
  }

  if (ownerKind === "TALENT_GROUP" && ownerTalentId !== undefined) {
    throw new PlatformAccountValidationError(
      "ownerKind=TALENT_GROUP must not be combined with ownerTalentId",
    );
  }

  if (ownerOrgUnitId) {
    return {
      ownerKind: ownerKind ?? "ORG_UNIT",
      ownerOrgUnitId,
    };
  }

  if (ownerTalentId) {
    return {
      ownerKind: ownerKind ?? "TALENT",
      ownerTalentId,
    };
  }

  if (ownerTalentGroupId) {
    return {
      ownerKind: ownerKind ?? "TALENT_GROUP",
      ownerTalentGroupId,
    };
  }

  return {
    ownerKind,
  };
}

function normalizeRequiredText(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new PlatformAccountValidationError(`${field} must be a string`);
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new PlatformAccountValidationError(`${field} is required`);
  }

  return normalized;
}

function parseOptionalId(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new PlatformAccountValidationError(`${field} must be a string`);
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new PlatformAccountValidationError(
      `${field} must not be empty when provided`,
    );
  }

  return normalized;
}

function parseOptionalPlatform(
  value: unknown,
): PlatformAccountPlatform | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new PlatformAccountValidationError(
      `platform must be one of ${PLATFORM_ACCOUNT_PLATFORMS.join(", ")}`,
    );
  }

  const normalized = value.trim().toUpperCase();

  if (
    PLATFORM_ACCOUNT_PLATFORMS.includes(normalized as PlatformAccountPlatform)
  ) {
    return normalized as PlatformAccountPlatform;
  }

  throw new PlatformAccountValidationError(
    `platform must be one of ${PLATFORM_ACCOUNT_PLATFORMS.join(", ")}`,
  );
}

function parseOptionalSurfaceType(
  value: unknown,
): PlatformAccountSurfaceType | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new PlatformAccountValidationError(
      `platformSurfaceType must be one of ${PLATFORM_ACCOUNT_SURFACE_TYPES.join(", ")}`,
    );
  }

  const normalized = value.trim().toUpperCase();

  if (
    PLATFORM_ACCOUNT_SURFACE_TYPES.includes(
      normalized as PlatformAccountSurfaceType,
    )
  ) {
    return normalized as PlatformAccountSurfaceType;
  }

  throw new PlatformAccountValidationError(
    `platformSurfaceType must be one of ${PLATFORM_ACCOUNT_SURFACE_TYPES.join(", ")}`,
  );
}

function parseOptionalOperationalStatus(
  value: unknown,
): PlatformAccountOperationalStatus | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new PlatformAccountValidationError(
      `operationalStatus must be one of ${PLATFORM_ACCOUNT_OPERATIONAL_STATUSES.join(", ")}`,
    );
  }

  const normalized = value.trim().toUpperCase();

  if (
    PLATFORM_ACCOUNT_OPERATIONAL_STATUSES.includes(
      normalized as PlatformAccountOperationalStatus,
    )
  ) {
    return normalized as PlatformAccountOperationalStatus;
  }

  throw new PlatformAccountValidationError(
    `operationalStatus must be one of ${PLATFORM_ACCOUNT_OPERATIONAL_STATUSES.join(", ")}`,
  );
}

function parseOptionalOwnerKind(
  value: unknown,
): PlatformAccountOwnerKind | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new PlatformAccountValidationError(
      `ownerKind must be one of ${PLATFORM_ACCOUNT_OWNER_KINDS.join(", ")}`,
    );
  }

  const normalized = value.trim().toUpperCase();

  if (
    PLATFORM_ACCOUNT_OWNER_KINDS.includes(
      normalized as PlatformAccountOwnerKind,
    )
  ) {
    return normalized as PlatformAccountOwnerKind;
  }

  throw new PlatformAccountValidationError(
    `ownerKind must be one of ${PLATFORM_ACCOUNT_OWNER_KINDS.join(", ")}`,
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
    throw new PlatformAccountValidationError(`${field} must be a boolean`);
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === "true") {
    return true;
  }

  if (normalized === "false") {
    return false;
  }

  throw new PlatformAccountValidationError(`${field} must be a boolean`);
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
    throw new PlatformAccountValidationError(
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
    throw new PlatformAccountValidationError(`${field} must be an integer`);
  }

  if (!Number.isInteger(numeric)) {
    throw new PlatformAccountValidationError(`${field} must be an integer`);
  }

  return numeric;
}

function parseOptionalCursor(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new PlatformAccountValidationError("cursor must be a string");
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function parseOptionalSearch(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new PlatformAccountValidationError("search must be a string");
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function parseOptionalSortField(
  value: unknown,
): PlatformAccountSortField | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new PlatformAccountValidationError(
      `sortBy must be one of ${PLATFORM_ACCOUNT_SORT_FIELDS.join(", ")}`,
    );
  }

  const normalized = value.trim();

  if (
    PLATFORM_ACCOUNT_SORT_FIELDS.includes(
      normalized as PlatformAccountSortField,
    )
  ) {
    return normalized as PlatformAccountSortField;
  }

  throw new PlatformAccountValidationError(
    `sortBy must be one of ${PLATFORM_ACCOUNT_SORT_FIELDS.join(", ")}`,
  );
}

function parseOptionalSortDirection(
  value: unknown,
): PlatformAccountSortDirection | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new PlatformAccountValidationError(
      `sortDirection must be one of ${PLATFORM_ACCOUNT_SORT_DIRECTIONS.join(", ")}`,
    );
  }

  const normalized = value.trim().toUpperCase();

  if (
    PLATFORM_ACCOUNT_SORT_DIRECTIONS.includes(
      normalized as PlatformAccountSortDirection,
    )
  ) {
    return normalized as PlatformAccountSortDirection;
  }

  throw new PlatformAccountValidationError(
    `sortDirection must be one of ${PLATFORM_ACCOUNT_SORT_DIRECTIONS.join(", ")}`,
  );
}
