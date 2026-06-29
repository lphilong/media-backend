import { Actor } from "@core/actor/actor";
import { Permission } from "@core/permission/permission.enum";
import { PermissionGuard } from "@core/permission/permission.guard";
import { PermissionResolver } from "@core/permission/permission.resolver";
import {
  ManagedGroupScopeDependencies,
} from "@modules/kpi/domain/managed-group-scope";
import {
  TalentGroupNotFoundError,
  TalentGroupPermissionScopeError,
  TalentGroupValidationError,
} from "@modules/talent-group/domain/talent-group.errors";
import {
  TALENT_GROUP_SORT_DIRECTIONS,
  TALENT_GROUP_SORT_FIELDS,
  TALENT_GROUP_STATUSES,
  TalentGroupSortDirection,
  TalentGroupSortField,
  TalentGroupStatus,
} from "@modules/talent-group/domain/talent-group.types";
import { TalentGroupReadRepository } from "@modules/talent-group/read/talent-group.read-repository";
import {
  GetTalentGroupDetailQuery,
  GetTalentGroupDetailResult,
  ListTalentGroupMembersQuery,
  ListTalentGroupMembersResult,
  ListTalentGroupsByTalentQuery,
  ListTalentGroupsByTalentResult,
  ListTalentGroupsQuery,
  ListTalentGroupsResult,
} from "@modules/talent-group/shared/talent-group.contracts";
import { requireAdminObjectScopeAuthority } from "@modules/role/domain/admin-object-scope-authority";
import { StructuredScopeAuthorityService } from "@modules/role/domain/structured-scope-authority";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_SEARCH_LENGTH = 64;

export class TalentGroupAdminQueryService {
  constructor(
    private readonly readRepository: TalentGroupReadRepository,
    private readonly managedGroupScopeDependencies?: ManagedGroupScopeDependencies,
    private readonly structuredAuthority: StructuredScopeAuthorityService = createMissingStructuredAuthority(),
  ) {}

  async listTalentGroups(
    actor: Actor,
    query: ListTalentGroupsQuery,
  ): Promise<ListTalentGroupsResult> {
    const permission = PermissionResolver.resolve(Permission.TALENT_GROUP_READ);
    PermissionGuard.assertAdminActor(actor);
    PermissionGuard.assert(actor, permission);
    const managedGroupIds = await this.resolveAuthorizedManagedGroupIds(actor);

    return this.readRepository.listTalentGroups({
      groupIds: managedGroupIds ?? undefined,
      status: parseOptionalStatus(query.status),
      containsTalentId: parseOptionalId(
        query.containsTalentId,
        "containsTalentId",
      ),
      limit: parseLimit(query.limit),
      cursor: parseOptionalCursor(query.cursor),
      search: parseOptionalSearch(query.search),
      sortField: parseOptionalSortField(query.sortBy),
      sortDirection: parseOptionalSortDirection(query.sortDirection),
    });
  }

  async getTalentGroupDetail(
    actor: Actor,
    query: GetTalentGroupDetailQuery,
  ): Promise<GetTalentGroupDetailResult> {
    const permission = PermissionResolver.resolve(Permission.TALENT_GROUP_READ);
    PermissionGuard.assertAdminActor(actor);
    PermissionGuard.assert(actor, permission);

    const groupId = normalizeRequiredText(query.groupId, "groupId");
    const detail = await this.readRepository.getTalentGroupDetail(groupId);

    if (!detail) {
      throw new TalentGroupNotFoundError(groupId);
    }

    await this.requireManagedTalentGroupAuthority(actor, groupId);

    return detail;
  }

  async listTalentGroupMembers(
    actor: Actor,
    query: ListTalentGroupMembersQuery,
  ): Promise<ListTalentGroupMembersResult> {
    const permission = PermissionResolver.resolve(Permission.TALENT_GROUP_READ);
    PermissionGuard.assertAdminActor(actor);
    PermissionGuard.assert(actor, permission);

    const groupId = normalizeRequiredText(query.groupId, "groupId");
    const group = await this.readRepository.getTalentGroupDetail(groupId);

    if (!group) {
      throw new TalentGroupNotFoundError(groupId);
    }

    await this.requireManagedTalentGroupAuthority(actor, groupId);

    return this.readRepository.listTalentGroupMembers({
      groupId,
      limit: parseLimit(query.limit),
      cursor: parseOptionalCursor(query.cursor),
    });
  }

  async listTalentGroupsByTalent(
    actor: Actor,
    query: ListTalentGroupsByTalentQuery,
  ): Promise<ListTalentGroupsByTalentResult> {
    const permission = PermissionResolver.resolve(Permission.TALENT_GROUP_READ);
    PermissionGuard.assertAdminActor(actor);
    PermissionGuard.assert(actor, permission);
    const managedGroupIds = await this.resolveAuthorizedManagedGroupIds(actor);

    return this.readRepository.listTalentGroupsByTalent({
      talentId: normalizeRequiredText(query.talentId, "talentId"),
      status: parseOptionalStatus(query.status),
      limit: parseLimit(query.limit),
      cursor: parseOptionalCursor(query.cursor),
      sortField: parseOptionalSortField(query.sortBy),
      sortDirection: parseOptionalSortDirection(query.sortDirection),
      groupIds: managedGroupIds ?? undefined,
    });
  }

  private async requireManagedTalentGroupAuthority(
    actor: Actor,
    groupId: string,
  ): Promise<void> {
    if (
      await this.structuredAuthority.hasAuthority({
        userId: actor.id,
        permission: Permission.TALENT_GROUP_READ,
        scope: { scopeType: "global" },
      })
    ) {
      return;
    }
    await requireAdminObjectScopeAuthority({
      actor,
      permission: Permission.TALENT_GROUP_READ,
      scope: { scopeType: "managedTalentGroup", targetId: groupId },
      authority: this.structuredAuthority,
      error: new TalentGroupPermissionScopeError(
        `Talent group read requires managedTalentGroup scope: ${groupId}`,
      ),
    });
    const dependencies = this.managedGroupScopeDependencies;
    if (!dependencies) {
      throw new TalentGroupPermissionScopeError(
        "TalentGroup manager responsibility dependencies are unavailable",
      );
    }
    const profile =
      await dependencies.subjectReadonlyAccess.findActiveEmploymentProfileByLinkedUserId(
        actor.id,
      );
    const managedScope: { readonly talentGroupIds: readonly string[] } = profile
      ? await dependencies.managedScopeReader.resolveManagedScopeByResponsibleEmploymentProfile(
          {
            responsibleEmploymentProfileId: profile.employmentProfileId,
            asOf: Date.now(),
          },
        )
      : { talentGroupIds: [] };
    if (!managedScope.talentGroupIds.includes(groupId)) {
      throw new TalentGroupPermissionScopeError(
        `Active TalentGroup manager responsibility is required: ${groupId}`,
      );
    }
  }

  private async resolveAuthorizedManagedGroupIds(
    actor: Actor,
  ): Promise<readonly string[] | null> {
    const grants = await this.structuredAuthority.listAuthorizedScopeGrants({
      userId: actor.id,
      permission: Permission.TALENT_GROUP_READ,
    });
    if (grants.some((grant) => grant.scopeType === "global")) {
      return null;
    }
    const grantedIds = new Set(
      grants
        .filter((grant) => grant.scopeType === "managedTalentGroup")
        .map((grant) => grant.targetId)
        .filter((id): id is string => Boolean(id)),
    );
    if (grantedIds.size === 0) {
      return [];
    }
    const dependencies = this.managedGroupScopeDependencies;
    if (!dependencies) {
      throw new TalentGroupPermissionScopeError(
        "TalentGroup scoped list dependencies are unavailable",
      );
    }
    const profile =
      await dependencies.subjectReadonlyAccess.findActiveEmploymentProfileByLinkedUserId(
        actor.id,
      );
    if (!profile) {
      return [];
    }
    const managedScope =
      await dependencies.managedScopeReader.resolveManagedScopeByResponsibleEmploymentProfile(
        {
          responsibleEmploymentProfileId: profile.employmentProfileId,
          asOf: Date.now(),
        },
      );
    return [...new Set(managedScope.talentGroupIds)]
      .filter((groupId) => grantedIds.has(groupId))
      .sort();
  }
}

function createMissingStructuredAuthority(): StructuredScopeAuthorityService {
  return new StructuredScopeAuthorityService({
    async listByUserId(): Promise<never> {
      throw new TalentGroupPermissionScopeError(
        "Structured TalentGroup authority is unavailable",
      );
    },
  });
}

function normalizeRequiredText(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new TalentGroupValidationError(`${field} must be a string`);
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new TalentGroupValidationError(`${field} is required`);
  }

  return normalized;
}

function parseOptionalId(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new TalentGroupValidationError(`${field} must be a string`);
  }

  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new TalentGroupValidationError(`${field} must not be empty`);
  }

  return normalized;
}

function parseOptionalStatus(value: unknown): TalentGroupStatus | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new TalentGroupValidationError(
      `status must be one of ${TALENT_GROUP_STATUSES.join(", ")}`,
    );
  }

  const normalized = value.trim().toUpperCase();

  if (TALENT_GROUP_STATUSES.includes(normalized as TalentGroupStatus)) {
    return normalized as TalentGroupStatus;
  }

  throw new TalentGroupValidationError(
    `status must be one of ${TALENT_GROUP_STATUSES.join(", ")}`,
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
    throw new TalentGroupValidationError("limit must be a positive integer");
  }

  return Math.min(numeric, MAX_LIMIT);
}

function parseOptionalCursor(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new TalentGroupValidationError("cursor must be a string");
  }

  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new TalentGroupValidationError("cursor must not be empty");
  }

  return normalized;
}

function parseOptionalSearch(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new TalentGroupValidationError("search must be a string");
  }

  const normalized = value.trim();

  if (!normalized) {
    return undefined;
  }

  if (normalized.length > MAX_SEARCH_LENGTH) {
    throw new TalentGroupValidationError(
      "search must be at most 64 characters",
    );
  }

  return normalized;
}

function parseOptionalSortField(
  value: unknown,
): TalentGroupSortField | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new TalentGroupValidationError(
      `sortBy must be one of ${TALENT_GROUP_SORT_FIELDS.join(", ")}`,
    );
  }

  const normalized = value.trim();

  if (TALENT_GROUP_SORT_FIELDS.includes(normalized as TalentGroupSortField)) {
    return normalized as TalentGroupSortField;
  }

  throw new TalentGroupValidationError(
    `sortBy must be one of ${TALENT_GROUP_SORT_FIELDS.join(", ")}`,
  );
}

function parseOptionalSortDirection(
  value: unknown,
): TalentGroupSortDirection | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new TalentGroupValidationError(
      `sortDirection must be one of ${TALENT_GROUP_SORT_DIRECTIONS.join(", ")}`,
    );
  }

  const normalized = value.trim().toUpperCase();

  if (
    TALENT_GROUP_SORT_DIRECTIONS.includes(
      normalized as TalentGroupSortDirection,
    )
  ) {
    return normalized as TalentGroupSortDirection;
  }

  throw new TalentGroupValidationError(
    `sortDirection must be one of ${TALENT_GROUP_SORT_DIRECTIONS.join(", ")}`,
  );
}

function parseOptionalInteger(
  value: unknown,
  field: string,
): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      throw new TalentGroupValidationError(`${field} must be an integer`);
    }

    return value;
  }

  if (typeof value !== "string") {
    throw new TalentGroupValidationError(`${field} must be an integer`);
  }

  const normalized = value.trim();

  if (!normalized) {
    return undefined;
  }

  if (!/^-?\d+$/u.test(normalized)) {
    throw new TalentGroupValidationError(`${field} must be an integer`);
  }

  return Number.parseInt(normalized, 10);
}
