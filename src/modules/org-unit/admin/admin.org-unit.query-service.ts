import { Actor } from "@core/actor/actor";
import { Permission } from "@core/permission/permission.enum";
import { PermissionGuard } from "@core/permission/permission.guard";
import { PermissionResolver } from "@core/permission/permission.resolver";
import {
  OrgUnitNotFoundError,
  OrgUnitPermissionScopeError,
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
import { requireAdminObjectScopeAuthority } from "@modules/role/domain/admin-object-scope-authority";
import { StructuredScopeAuthorityService } from "@modules/role/domain/structured-scope-authority";
import { KpiSubjectReadonlyAccess } from "@modules/kpi/domain/kpi-subject-readonly-access";
import { ResponsibilityManagedScopeReader } from "@modules/responsibility/domain/responsibility-managed-scope";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

interface OrgUnitScopedReadDependencies {
  readonly subjectReadonlyAccess: Pick<
    KpiSubjectReadonlyAccess,
    "findActiveEmploymentProfileByLinkedUserId"
  >;
  readonly managedScopeReader: ResponsibilityManagedScopeReader;
}

export class OrgUnitAdminQueryService {
  constructor(
    private readonly readRepository: OrgUnitReadRepository,
    private readonly structuredAuthority: StructuredScopeAuthorityService = createMissingStructuredAuthority(),
    private readonly scopedReadDependencies?: OrgUnitScopedReadDependencies,
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
    const authorizedOrgUnitIds = await this.resolveAuthorizedOrgUnitIds(actor);

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
      orgUnitIds: authorizedOrgUnitIds ?? undefined,
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

    await this.requireManagedOrgUnitAuthority(actor, orgUnitId);

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
    await this.requireGlobalTreeAuthority(actor);

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

    await this.requireManagedOrgUnitAuthority(actor, orgUnitId);
    const authorizedOrgUnitIds = await this.resolveAuthorizedOrgUnitIds(actor);
    const result = await this.readRepository.listDirectChildren({
      parentOrgUnitId: orgUnitId,
      orgUnitIds: authorizedOrgUnitIds ?? undefined,
      limit: parseLimit(query.limit),
      cursor: parseOptionalCursor(query.cursor),
    });
    if (authorizedOrgUnitIds === null) {
      return result;
    }
    const allowed = new Set(authorizedOrgUnitIds);
    return {
      items: result.items.filter((item) => allowed.has(item.id)),
      ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
    };
  }

  private async requireManagedOrgUnitAuthority(
    actor: Actor,
    orgUnitId: string,
  ): Promise<void> {
    if (
      await this.structuredAuthority.hasAuthority({
        userId: actor.id,
        permission: Permission.ORG_UNIT_READ,
        scope: { scopeType: "global" },
      })
    ) {
      return;
    }
    await requireAdminObjectScopeAuthority({
      actor,
      permission: Permission.ORG_UNIT_READ,
      scope: { scopeType: "managedOrgUnit", targetId: orgUnitId },
      authority: this.structuredAuthority,
      error: new OrgUnitPermissionScopeError(
        `Org unit read requires managedOrgUnit scope: ${orgUnitId}`,
      ),
    });
    const dependencies = this.scopedReadDependencies;
    if (!dependencies) {
      throw new OrgUnitPermissionScopeError(
        "OrgUnit manager responsibility dependencies are unavailable",
      );
    }
    const profile =
      await dependencies.subjectReadonlyAccess.findActiveEmploymentProfileByLinkedUserId(
        actor.id,
      );
    const scope = profile
      ? await dependencies.managedScopeReader.resolveManagedScopeByResponsibleEmploymentProfile(
          {
            responsibleEmploymentProfileId: profile.employmentProfileId,
            asOf: Date.now(),
          },
        )
      : { orgUnitIds: [], orgUnitScopes: [], talentGroupIds: [] };
    if (!scope.orgUnitIds.includes(orgUnitId)) {
      throw new OrgUnitPermissionScopeError(
        `Active OrgUnit manager responsibility is required: ${orgUnitId}`,
      );
    }
  }

  private async resolveAuthorizedOrgUnitIds(
    actor: Actor,
  ): Promise<readonly string[] | null> {
    const grants = await this.structuredAuthority.listAuthorizedScopeGrants({
      userId: actor.id,
      permission: Permission.ORG_UNIT_READ,
    });
    if (grants.some((grant) => grant.scopeType === "global")) {
      return null;
    }
    const grantedIds = new Set(
      grants
        .filter((grant) => grant.scopeType === "managedOrgUnit")
        .map((grant) => grant.targetId)
        .filter((id): id is string => Boolean(id)),
    );
    if (grantedIds.size === 0) {
      throw new OrgUnitPermissionScopeError(
        "OrgUnit list requires structured global or managedOrgUnit scope",
      );
    }
    const dependencies = this.scopedReadDependencies;
    if (!dependencies) {
      throw new OrgUnitPermissionScopeError(
        "OrgUnit scoped list dependencies are unavailable",
      );
    }
    const profile =
      await dependencies.subjectReadonlyAccess.findActiveEmploymentProfileByLinkedUserId(
        actor.id,
      );
    if (!profile) {
      return [];
    }
    const scope =
      await dependencies.managedScopeReader.resolveManagedScopeByResponsibleEmploymentProfile(
        {
          responsibleEmploymentProfileId: profile.employmentProfileId,
          asOf: Date.now(),
        },
      );
    return [
      ...new Set(
        scope.orgUnitIds
          .filter((orgUnitId) => grantedIds.has(orgUnitId)),
      ),
    ].sort();
  }

  private async requireGlobalTreeAuthority(actor: Actor): Promise<void> {
    const allowed = await this.structuredAuthority.hasAuthority({
      userId: actor.id,
      permission: Permission.ORG_UNIT_READ,
      scope: { scopeType: "global" },
    });
    if (!allowed) {
      throw new OrgUnitPermissionScopeError(
        "OrgUnit roots/tree require structured global scope; minimal ancestor disclosure is not implemented",
      );
    }
  }
}

function createMissingStructuredAuthority(): StructuredScopeAuthorityService {
  return new StructuredScopeAuthorityService({
    async listByUserId(): Promise<never> {
      throw new OrgUnitPermissionScopeError(
        "Structured OrgUnit authority is unavailable",
      );
    },
  });
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
