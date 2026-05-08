import { Actor } from "@core/actor/actor";
import { Permission } from "@core/permission/permission.enum";
import { PermissionGuard } from "@core/permission/permission.guard";
import { PermissionResolver } from "@core/permission/permission.resolver";
import {
  TalentGroupNotFoundError,
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

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_SEARCH_LENGTH = 64;

export class TalentGroupAdminQueryService {
  constructor(
    private readonly readRepository: TalentGroupReadRepository,
  ) {}

  async listTalentGroups(
    actor: Actor,
    query: ListTalentGroupsQuery,
  ): Promise<ListTalentGroupsResult> {
    const permission = PermissionResolver.resolve(
      Permission.TALENT_GROUP_READ,
    );
    PermissionGuard.assertAdminActor(actor);
    PermissionGuard.assert(actor, permission);

    return this.readRepository.listTalentGroups({
      status: parseOptionalStatus(query.status),
      containsTalentId: parseOptionalId(
        query.containsTalentId,
        "containsTalentId",
      ),
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

  async getTalentGroupDetail(
    actor: Actor,
    query: GetTalentGroupDetailQuery,
  ): Promise<GetTalentGroupDetailResult> {
    const permission = PermissionResolver.resolve(
      Permission.TALENT_GROUP_READ,
    );
    PermissionGuard.assertAdminActor(actor);
    PermissionGuard.assert(actor, permission);

    const groupId = normalizeRequiredText(
      query.groupId,
      "groupId",
    );
    const detail =
      await this.readRepository.getTalentGroupDetail(
        groupId,
      );

    if (!detail) {
      throw new TalentGroupNotFoundError(groupId);
    }

    return detail;
  }

  async listTalentGroupMembers(
    actor: Actor,
    query: ListTalentGroupMembersQuery,
  ): Promise<ListTalentGroupMembersResult> {
    const permission = PermissionResolver.resolve(
      Permission.TALENT_GROUP_READ,
    );
    PermissionGuard.assertAdminActor(actor);
    PermissionGuard.assert(actor, permission);

    const groupId = normalizeRequiredText(
      query.groupId,
      "groupId",
    );
    const group =
      await this.readRepository.getTalentGroupDetail(
        groupId,
      );

    if (!group) {
      throw new TalentGroupNotFoundError(groupId);
    }

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
    const permission = PermissionResolver.resolve(
      Permission.TALENT_GROUP_READ,
    );
    PermissionGuard.assertAdminActor(actor);
    PermissionGuard.assert(actor, permission);

    return this.readRepository.listTalentGroupsByTalent({
      talentId: normalizeRequiredText(
        query.talentId,
        "talentId",
      ),
      status: parseOptionalStatus(query.status),
      limit: parseLimit(query.limit),
      cursor: parseOptionalCursor(query.cursor),
      sortField: parseOptionalSortField(
        query.sortBy,
      ),
      sortDirection: parseOptionalSortDirection(
        query.sortDirection,
      ),
    });
  }
}

function normalizeRequiredText(
  value: unknown,
  field: string,
): string {
  if (typeof value !== "string") {
    throw new TalentGroupValidationError(
      `${field} must be a string`,
    );
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new TalentGroupValidationError(
      `${field} is required`,
    );
  }

  return normalized;
}

function parseOptionalId(
  value: unknown,
  field: string,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new TalentGroupValidationError(
      `${field} must be a string`,
    );
  }

  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new TalentGroupValidationError(
      `${field} must not be empty`,
    );
  }

  return normalized;
}

function parseOptionalStatus(
  value: unknown,
): TalentGroupStatus | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new TalentGroupValidationError(
      `status must be one of ${TALENT_GROUP_STATUSES.join(", ")}`,
    );
  }

  const normalized = value.trim().toUpperCase();

  if (
    TALENT_GROUP_STATUSES.includes(
      normalized as TalentGroupStatus,
    )
  ) {
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
    throw new TalentGroupValidationError(
      "limit must be a positive integer",
    );
  }

  return Math.min(numeric, MAX_LIMIT);
}

function parseOptionalCursor(
  value: unknown,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new TalentGroupValidationError(
      "cursor must be a string",
    );
  }

  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new TalentGroupValidationError(
      "cursor must not be empty",
    );
  }

  return normalized;
}

function parseOptionalSearch(
  value: unknown,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new TalentGroupValidationError(
      "search must be a string",
    );
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

  if (
    TALENT_GROUP_SORT_FIELDS.includes(
      normalized as TalentGroupSortField,
    )
  ) {
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
      throw new TalentGroupValidationError(
        `${field} must be an integer`,
      );
    }

    return value;
  }

  if (typeof value !== "string") {
    throw new TalentGroupValidationError(
      `${field} must be an integer`,
    );
  }

  const normalized = value.trim();

  if (!normalized) {
    return undefined;
  }

  if (!/^-?\d+$/u.test(normalized)) {
    throw new TalentGroupValidationError(
      `${field} must be an integer`,
    );
  }

  return Number.parseInt(normalized, 10);
}
