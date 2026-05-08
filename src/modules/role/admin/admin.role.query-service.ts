import { Actor } from "@core/actor/actor";
import { Permission } from "@core/permission/permission.enum";
import { PermissionGuard } from "@core/permission/permission.guard";
import { PermissionResolver } from "@core/permission/permission.resolver";
import {
  RoleAssignmentState,
  ROLE_ASSIGNMENT_STATES,
  ROLE_STATES,
  RoleState,
} from "@modules/role/domain/role.types";
import {
  RoleNotFoundError,
  RoleValidationError,
} from "@modules/role/domain/role.errors";
import {
  RoleReadRepository,
} from "@modules/role/read/role.read-repository";
import {
  RoleAssignmentReadRepository,
} from "@modules/role/read/role-assignment.read-repository";
import {
  GetRoleDetailQuery,
  GetRoleDetailResult,
  GetRolePermissionMatrixResult,
  ListRoleAssignmentsQuery,
  ListRoleAssignmentsResult,
  ListRolePermissionMatrixQuery,
  ListRolesQuery,
  ListRolesResult,
} from "@modules/role/shared/role.contracts";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_SEARCH_LENGTH = 64;

export class RoleAdminQueryService {
  constructor(
    private readonly roleReadRepository: RoleReadRepository,
    private readonly roleAssignmentReadRepository: RoleAssignmentReadRepository,
  ) {}

  // Policy note: role query flows are permission-gated read paths and intentionally non-audited.
  // Mutation audit remains enforced in RoleAdminService.
  async listRoles(
    actor: Actor,
    query: ListRolesQuery,
  ): Promise<ListRolesResult> {
    const permission = PermissionResolver.resolve(
      Permission.ROLE_LIST,
    );
    PermissionGuard.assertAdminActor(actor);
    PermissionGuard.assert(actor, permission);

    return this.roleReadRepository.listRoles({
      state: parseOptionalRoleState(query.state),
      limit: parseLimit(query.limit),
      cursor: parseOptionalCursor(query.cursor),
      search: parseOptionalSearch(query.search),
    });
  }

  async getRoleDetail(
    actor: Actor,
    query: GetRoleDetailQuery,
  ): Promise<GetRoleDetailResult> {
    const permission = PermissionResolver.resolve(
      Permission.ROLE_VIEW,
    );
    PermissionGuard.assertAdminActor(actor);
    PermissionGuard.assert(actor, permission);

    const roleId = normalizeRequiredText(
      query.roleId,
      "roleId",
    );

    const detail = await this.roleReadRepository.getRoleDetail(
      roleId,
    );

    if (!detail) {
      throw new RoleNotFoundError(roleId);
    }

    return detail;
  }

  async listRoleAssignments(
    actor: Actor,
    query: ListRoleAssignmentsQuery,
  ): Promise<ListRoleAssignmentsResult> {
    const permission = PermissionResolver.resolve(
      Permission.ROLE_ASSIGNMENT_VIEW,
    );
    PermissionGuard.assertAdminActor(actor);
    PermissionGuard.assert(actor, permission);

    const roleId = normalizeRequiredText(
      query.roleId,
      "roleId",
    );

    const role =
      await this.roleReadRepository.getRolePermissionMatrix(
        roleId,
      );

    if (!role) {
      throw new RoleNotFoundError(roleId);
    }

    return this.roleAssignmentReadRepository.listRoleAssignments(
      {
        roleId,
        state: parseOptionalRoleAssignmentState(
          query.state,
        ),
        limit: parseLimit(query.limit),
        cursor: parseOptionalCursor(query.cursor),
      },
    );
  }

  async getRolePermissionMatrix(
    actor: Actor,
    query: ListRolePermissionMatrixQuery,
  ): Promise<GetRolePermissionMatrixResult> {
    const permission = PermissionResolver.resolve(
      Permission.ROLE_VIEW,
    );
    PermissionGuard.assertAdminActor(actor);
    PermissionGuard.assert(actor, permission);

    const roleId = normalizeRequiredText(
      query.roleId,
      "roleId",
    );

    const matrix =
      await this.roleReadRepository.getRolePermissionMatrix(
        roleId,
      );

    if (!matrix) {
      throw new RoleNotFoundError(roleId);
    }

    return matrix;
  }
}

function normalizeRequiredText(
  value: unknown,
  field: string,
): string {
  if (typeof value !== "string") {
    throw new RoleValidationError(
      `${field} must be a string`,
    );
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new RoleValidationError(`${field} is required`);
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
    throw new RoleValidationError(
      "search must be a string",
    );
  }

  const normalized = value.trim();

  if (normalized.length === 0) {
    return undefined;
  }

  if (normalized.length > MAX_SEARCH_LENGTH) {
    throw new RoleValidationError(
      "search must be at most 64 characters",
    );
  }

  return normalized;
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
    throw new RoleValidationError(
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
    throw new RoleValidationError(
      "cursor must be a string",
    );
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
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
    throw new RoleValidationError(
      `${field} must be a number`,
    );
  }

  if (!Number.isInteger(numeric)) {
    throw new RoleValidationError(
      `${field} must be an integer`,
    );
  }

  return numeric;
}

function parseOptionalRoleState(
  value: unknown,
): RoleState | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new RoleValidationError(
      "state must be one of DRAFT, ACTIVE, INACTIVE, ARCHIVED",
    );
  }

  const normalized = value.trim().toUpperCase();

  if (
    ROLE_STATES.includes(
      normalized as RoleState,
    )
  ) {
    return normalized as RoleState;
  }

  throw new RoleValidationError(
    "state must be one of DRAFT, ACTIVE, INACTIVE, ARCHIVED",
  );
}

function parseOptionalRoleAssignmentState(
  value: unknown,
): RoleAssignmentState | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new RoleValidationError(
      "assignment state must be one of ACTIVE, REVOKED",
    );
  }

  const normalized = value.trim().toUpperCase();

  if (
    ROLE_ASSIGNMENT_STATES.includes(
      normalized as RoleAssignmentState,
    )
  ) {
    return normalized as RoleAssignmentState;
  }

  throw new RoleValidationError(
    "assignment state must be one of ACTIVE, REVOKED",
  );
}
