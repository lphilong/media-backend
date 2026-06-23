import { Actor } from "@core/actor/actor";
import { Permission } from "@core/permission/permission.enum";
import { PermissionGuard } from "@core/permission/permission.guard";
import { PermissionResolver } from "@core/permission/permission.resolver";
import {
  EMPLOYMENT_CONTRACT_STATUSES,
  EMPLOYMENT_KINDS,
  EMPLOYMENT_PROFILE_SORT_DIRECTIONS,
  EMPLOYMENT_PROFILE_SORT_FIELDS,
  EMPLOYMENT_STATUSES,
  EmploymentContractStatus,
  EmploymentKind,
  EmploymentProfileSortDirection,
  EmploymentProfileSortField,
  EmploymentStatus,
} from "@modules/employment-profile/domain/employment-profile.types";
import {
  EmploymentProfileNotFoundError,
  EmploymentProfilePermissionScopeError,
  EmploymentProfileValidationError,
} from "@modules/employment-profile/domain/employment-profile.errors";
import { EmploymentProfileReadRepository } from "@modules/employment-profile/read/employment-profile.read-repository";
import {
  GetEmploymentProfileDetailQuery,
  GetEmploymentProfileDetailResult,
  ListEmploymentProfileDirectReportsQuery,
  ListEmploymentProfileDirectReportsResult,
  ListEmploymentProfilesQuery,
  ListEmploymentProfilesResult,
} from "@modules/employment-profile/shared/employment-profile.contracts";
import { requireAdminGlobalScopeAuthority } from "@modules/role/domain/admin-object-scope-authority";
import { StructuredScopeAuthorityService } from "@modules/role/domain/structured-scope-authority";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export class EmploymentProfileAdminQueryService {
  constructor(
    private readonly readRepository: EmploymentProfileReadRepository,
    private readonly structuredAuthority: StructuredScopeAuthorityService = createMissingStructuredAuthority(),
  ) {}

  async listEmploymentProfiles(
    actor: Actor,
    query: ListEmploymentProfilesQuery,
  ): Promise<ListEmploymentProfilesResult> {
    const permission = PermissionResolver.resolve(
      Permission.EMPLOYMENT_PROFILE_READ,
    );
    PermissionGuard.assertAdminActor(actor);
    PermissionGuard.assert(actor, permission);
    await requireAdminGlobalScopeAuthority({
      actor,
      permission: Permission.EMPLOYMENT_PROFILE_READ,
      authority: this.structuredAuthority,
      error: new EmploymentProfilePermissionScopeError(
        "Broad EmploymentProfile list requires structured global scope",
      ),
    });

    return this.readRepository.listEmploymentProfiles({
      employmentStatus: parseOptionalEmploymentStatus(
        query.employmentStatus,
      ),
      contractStatus: parseOptionalContractStatus(
        query.contractStatus,
      ),
      employmentKind: parseOptionalEmploymentKind(
        query.employmentKind,
      ),
      orgUnitId: parseOptionalId(
        query.orgUnitId,
        "orgUnitId",
      ),
      managerEmploymentProfileId: parseOptionalId(
        query.managerEmploymentProfileId,
        "managerEmploymentProfileId",
      ),
      hasLinkedUser: parseOptionalBoolean(
        query.hasLinkedUser,
        "hasLinkedUser",
      ),
      limit: parseLimit(query.limit),
      cursor: parseOptionalCursor(query.cursor),
      search: parseOptionalSearch(query.search),
      sortField: parseOptionalSortField(query.sortBy),
      sortDirection: parseOptionalSortDirection(
        query.sortDirection,
      ),
    });
  }

  async getEmploymentProfileDetail(
    actor: Actor,
    query: GetEmploymentProfileDetailQuery,
  ): Promise<GetEmploymentProfileDetailResult> {
    const permission = PermissionResolver.resolve(
      Permission.EMPLOYMENT_PROFILE_READ,
    );
    PermissionGuard.assertAdminActor(actor);
    PermissionGuard.assert(actor, permission);

    const employmentProfileId =
      normalizeRequiredText(
        query.employmentProfileId,
        "employmentProfileId",
      );
    const detail =
      await this.readRepository.getEmploymentProfileDetail(
        employmentProfileId,
      );

    if (!detail) {
      throw new EmploymentProfileNotFoundError(
        employmentProfileId,
      );
    }

    await requireAdminGlobalScopeAuthority({
      actor,
      permission: Permission.EMPLOYMENT_PROFILE_READ,
      authority: this.structuredAuthority,
      error: new EmploymentProfilePermissionScopeError(
        "EmploymentProfile Admin detail exposes sensitive fields and requires structured global scope",
      ),
    });

    return detail;
  }

  async listEmploymentProfileDirectReports(
    actor: Actor,
    query: ListEmploymentProfileDirectReportsQuery,
  ): Promise<ListEmploymentProfileDirectReportsResult> {
    const permission = PermissionResolver.resolve(
      Permission.EMPLOYMENT_PROFILE_READ,
    );
    PermissionGuard.assertAdminActor(actor);
    PermissionGuard.assert(actor, permission);
    await requireAdminGlobalScopeAuthority({
      actor,
      permission: Permission.EMPLOYMENT_PROFILE_READ,
      authority: this.structuredAuthority,
      error: new EmploymentProfilePermissionScopeError(
        "Direct-report projection requires structured global scope",
      ),
    });

    const employmentProfileId =
      normalizeRequiredText(
        query.employmentProfileId,
        "employmentProfileId",
      );
    const manager =
      await this.readRepository.getEmploymentProfileDetail(
        employmentProfileId,
      );

    if (!manager) {
      throw new EmploymentProfileNotFoundError(
        employmentProfileId,
      );
    }

    return this.readRepository.listDirectReports({
      managerEmploymentProfileId:
        employmentProfileId,
      limit: parseLimit(query.limit),
      cursor: parseOptionalCursor(query.cursor),
      sortField: parseOptionalSortField(query.sortBy),
      sortDirection: parseOptionalSortDirection(
        query.sortDirection,
      ),
    });
  }
}

function createMissingStructuredAuthority(): StructuredScopeAuthorityService {
  return new StructuredScopeAuthorityService({
    async listByUserId(): Promise<never> {
      throw new EmploymentProfilePermissionScopeError(
        "Structured EmploymentProfile authority is unavailable",
      );
    },
  });
}

function normalizeRequiredText(
  value: unknown,
  field: string,
): string {
  if (typeof value !== "string") {
    throw new EmploymentProfileValidationError(
      `${field} must be a string`,
    );
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new EmploymentProfileValidationError(
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
    throw new EmploymentProfileValidationError(
      `${field} must be a string`,
    );
  }

  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new EmploymentProfileValidationError(
      `${field} must not be empty`,
    );
  }

  return normalized;
}

function parseOptionalEmploymentStatus(
  value: unknown,
): EmploymentStatus | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new EmploymentProfileValidationError(
      `employmentStatus must be one of ${EMPLOYMENT_STATUSES.join(", ")}`,
    );
  }

  const normalized = value.trim();

  if (
    EMPLOYMENT_STATUSES.includes(
      normalized as EmploymentStatus,
    )
  ) {
    return normalized as EmploymentStatus;
  }

  throw new EmploymentProfileValidationError(
    `employmentStatus must be one of ${EMPLOYMENT_STATUSES.join(", ")}`,
  );
}

function parseOptionalContractStatus(
  value: unknown,
): EmploymentContractStatus | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new EmploymentProfileValidationError(
      `contractStatus must be one of ${EMPLOYMENT_CONTRACT_STATUSES.join(", ")}`,
    );
  }

  const normalized = value.trim();

  if (
    EMPLOYMENT_CONTRACT_STATUSES.includes(
      normalized as EmploymentContractStatus,
    )
  ) {
    return normalized as EmploymentContractStatus;
  }

  throw new EmploymentProfileValidationError(
    `contractStatus must be one of ${EMPLOYMENT_CONTRACT_STATUSES.join(", ")}`,
  );
}

function parseOptionalEmploymentKind(
  value: unknown,
): EmploymentKind | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new EmploymentProfileValidationError(
      `employmentKind must be one of ${EMPLOYMENT_KINDS.join(", ")}`,
    );
  }

  const normalized = value.trim();

  if (
    EMPLOYMENT_KINDS.includes(
      normalized as EmploymentKind,
    )
  ) {
    return normalized as EmploymentKind;
  }

  throw new EmploymentProfileValidationError(
    `employmentKind must be one of ${EMPLOYMENT_KINDS.join(", ")}`,
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
    throw new EmploymentProfileValidationError(
      `${field} must be a boolean`,
    );
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === "true") {
    return true;
  }

  if (normalized === "false") {
    return false;
  }

  throw new EmploymentProfileValidationError(
    `${field} must be a boolean`,
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
    throw new EmploymentProfileValidationError(
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
      throw new EmploymentProfileValidationError(
        `${field} must be an integer`,
      );
    }

    numeric = Number(value);
  } else {
    throw new EmploymentProfileValidationError(
      `${field} must be an integer`,
    );
  }

  if (!Number.isInteger(numeric)) {
    throw new EmploymentProfileValidationError(
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
    throw new EmploymentProfileValidationError(
      "cursor must be a string",
    );
  }

  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new EmploymentProfileValidationError(
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
    throw new EmploymentProfileValidationError(
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
): EmploymentProfileSortField | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new EmploymentProfileValidationError(
      `sortBy must be one of ${EMPLOYMENT_PROFILE_SORT_FIELDS.join(", ")}`,
    );
  }

  const normalized = value.trim();

  if (
    EMPLOYMENT_PROFILE_SORT_FIELDS.includes(
      normalized as EmploymentProfileSortField,
    )
  ) {
    return normalized as EmploymentProfileSortField;
  }

  throw new EmploymentProfileValidationError(
    `sortBy must be one of ${EMPLOYMENT_PROFILE_SORT_FIELDS.join(", ")}`,
  );
}

function parseOptionalSortDirection(
  value: unknown,
): EmploymentProfileSortDirection | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new EmploymentProfileValidationError(
      `sortDirection must be one of ${EMPLOYMENT_PROFILE_SORT_DIRECTIONS.join(", ")}`,
    );
  }

  const normalized = value.trim();

  if (
    EMPLOYMENT_PROFILE_SORT_DIRECTIONS.includes(
      normalized as EmploymentProfileSortDirection,
    )
  ) {
    return normalized as EmploymentProfileSortDirection;
  }

  throw new EmploymentProfileValidationError(
    `sortDirection must be one of ${EMPLOYMENT_PROFILE_SORT_DIRECTIONS.join(", ")}`,
  );
}
