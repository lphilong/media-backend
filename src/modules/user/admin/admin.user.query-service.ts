import { Actor } from "@core/actor/actor";
import { Permission } from "@core/permission/permission.enum";
import { PermissionGuard } from "@core/permission/permission.guard";
import { PermissionResolver } from "@core/permission/permission.resolver";
import {
  UserNotFoundError,
  UserValidationError,
} from "@modules/user/domain/user.errors";
import {
  USER_ACCOUNT_STATUSES,
  UserAccountStatus,
} from "@modules/user/domain/user.types";
import {
  GetUserDetailQuery,
  UserDetailResult,
  ListUsersQuery,
  UserListResult,
} from "@modules/user/shared/user.contracts";
import {
  UserReadRepository,
} from "@modules/user/read/user.read-repository";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_SEARCH_LENGTH = 64;

export class UserAdminQueryService {
  constructor(
    private readonly readRepository: UserReadRepository,
  ) {}

  // Policy note: user query flows are permission-gated read paths and intentionally non-audited.
  // Mutation audit remains enforced in UserLifecycleService.
  async listUsers(
    actor: Actor,
    query: ListUsersQuery,
  ): Promise<UserListResult> {
    const permission = PermissionResolver.resolve(
      Permission.USER_VIEW,
    );
    PermissionGuard.assertAdminActor(actor);
    PermissionGuard.assert(actor, permission);

    return this.readRepository.listUsers({
      state: parseOptionalState(query.state),
      hasEmploymentProfile:
        parseOptionalBoolean(
          query.hasEmploymentProfile,
          "hasEmploymentProfile",
        ),
      cursor: parseOptionalCursor(query.cursor),
      limit: parseLimit(query.limit),
      search: parseOptionalSearch(query.search),
    });
  }

  async getUserDetail(
    actor: Actor,
    query: GetUserDetailQuery,
  ): Promise<UserDetailResult> {
    const permission = PermissionResolver.resolve(
      Permission.USER_VIEW,
    );
    PermissionGuard.assertAdminActor(actor);
    PermissionGuard.assert(actor, permission);

    const userId = normalizeRequiredText(
      query.userId,
      "userId",
    );
    const detail =
      await this.readRepository.getUserDetail(userId);

    if (!detail) {
      throw new UserNotFoundError(userId);
    }

    return detail;
  }
}

function normalizeRequiredText(
  value: unknown,
  field: string,
): string {
  if (typeof value !== "string") {
    throw new UserValidationError(
      `${field} must be a string`,
    );
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new UserValidationError(
      `${field} is required`,
    );
  }

  return normalized;
}

function parseOptionalState(
  value: unknown,
): UserAccountStatus | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new UserValidationError(
      "state must be one of PENDING, ACTIVE, DISABLED, ARCHIVED",
    );
  }

  const normalized = value.trim().toUpperCase();

  if (
    USER_ACCOUNT_STATUSES.includes(
      normalized as UserAccountStatus,
    )
  ) {
    return normalized as UserAccountStatus;
  }

  throw new UserValidationError(
    "state must be one of PENDING, ACTIVE, DISABLED, ARCHIVED",
  );
}

function parseOptionalCursor(
  value: unknown,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new UserValidationError(
      "cursor must be a string",
    );
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
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
    throw new UserValidationError(
      `${field} must be true or false`,
    );
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === "true") {
    return true;
  }

  if (normalized === "false") {
    return false;
  }

  throw new UserValidationError(
    `${field} must be true or false`,
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
    throw new UserValidationError(
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
    throw new UserValidationError(
      `${field} must be a number`,
    );
  }

  if (!Number.isInteger(numeric)) {
    throw new UserValidationError(
      `${field} must be an integer`,
    );
  }

  return numeric;
}

function parseOptionalSearch(
  value: unknown,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new UserValidationError(
      "search must be a string",
    );
  }

  const normalized = value.trim();

  if (!normalized) {
    return undefined;
  }

  if (normalized.length > MAX_SEARCH_LENGTH) {
    throw new UserValidationError(
      "search must be at most 64 characters",
    );
  }

  return normalized;
}
