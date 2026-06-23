import { Actor } from "@core/actor/actor";
import { Permission } from "@core/permission/permission.enum";
import { PermissionGuard } from "@core/permission/permission.guard";
import { PermissionResolver } from "@core/permission/permission.resolver";
import { SystemInvariantError } from "@core/error/system-error";
import {
  TalentNotFoundError,
  TalentValidationError,
} from "@modules/talent/domain/talent.errors";
import {
  TALENT_COMMERCIAL_PARTICIPATION_STATUSES,
  TALENT_OPERATIONAL_STATUSES,
  TALENT_ORIGINS,
  TALENT_SORT_DIRECTIONS,
  TALENT_SORT_FIELDS,
  TalentCommercialParticipationStatus,
  TalentOperationalStatus,
  TalentOrigin,
  TalentSortDirection,
  TalentSortField,
} from "@modules/talent/domain/talent.types";
import { TalentReadRepository } from "@modules/talent/read/talent.read-repository";
import {
  GetTalentDetailQuery,
  GetTalentDetailResult,
  ListTalentsQuery,
  ListTalentsResult,
} from "@modules/talent/shared/talent.contracts";
import { requireAdminGlobalScopeAuthority } from "@modules/role/domain/admin-object-scope-authority";
import { StructuredScopeAuthorityService } from "@modules/role/domain/structured-scope-authority";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export class TalentAdminQueryService {
  constructor(
    private readonly readRepository: TalentReadRepository,
    private readonly structuredAuthority: StructuredScopeAuthorityService = createMissingStructuredAuthority(),
  ) {}

  async listTalents(
    actor: Actor,
    query: ListTalentsQuery,
  ): Promise<ListTalentsResult> {
    const permission = PermissionResolver.resolve(Permission.TALENT_READ);
    PermissionGuard.assertAdminActor(actor);
    PermissionGuard.assert(actor, permission);
    await this.requireGlobalRead(actor);

    return this.readRepository.listTalents({
      operationalStatus: parseOptionalOperationalStatus(
        query.operationalStatus,
      ),
      talentOrigin: parseOptionalTalentOrigin(query.talentOrigin),
      managerEmploymentProfileId: parseOptionalId(
        query.managerEmploymentProfileId,
        "managerEmploymentProfileId",
      ),
      hasLinkedEmploymentProfile: parseOptionalBoolean(
        query.hasLinkedEmploymentProfile,
        "hasLinkedEmploymentProfile",
      ),
      commercialParticipationStatus: parseOptionalCommercialParticipationStatus(
        query.commercialParticipationStatus,
      ),
      livestreamEligible: parseOptionalBoolean(
        query.livestreamEligible,
        "livestreamEligible",
      ),
      eventEligible: parseOptionalBoolean(query.eventEligible, "eventEligible"),
      limit: parseLimit(query.limit),
      cursor: parseOptionalCursor(query.cursor),
      search: parseOptionalSearch(query.search),
      sortField: parseOptionalSortField(query.sortBy),
      sortDirection: parseOptionalSortDirection(query.sortDirection),
    });
  }

  async getTalentDetail(
    actor: Actor,
    query: GetTalentDetailQuery,
  ): Promise<GetTalentDetailResult> {
    const permission = PermissionResolver.resolve(Permission.TALENT_READ);
    PermissionGuard.assertAdminActor(actor);
    PermissionGuard.assert(actor, permission);
    await this.requireGlobalRead(actor);

    const talentId = normalizeRequiredText(query.talentId, "talentId");

    const detail = await this.readRepository.getTalentDetail(talentId);

    if (!detail) {
      throw new TalentNotFoundError(talentId);
    }

    return detail;
  }

  private async requireGlobalRead(actor: Actor): Promise<void> {
    await requireAdminGlobalScopeAuthority({
      actor,
      permission: Permission.TALENT_READ,
      authority: this.structuredAuthority,
      error: new SystemInvariantError(
        "PERMISSION_DENIED",
        "Direct Talent Admin reads require structured global scope",
      ),
    });
  }
}

function createMissingStructuredAuthority(): StructuredScopeAuthorityService {
  return new StructuredScopeAuthorityService({
    async listByUserId(): Promise<never> {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Structured Talent authority is unavailable",
      );
    },
  });
}

function normalizeRequiredText(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new TalentValidationError(`${field} must be a string`);
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new TalentValidationError(`${field} is required`);
  }

  return normalized;
}

function parseOptionalId(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new TalentValidationError(`${field} must be a string`);
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function parseOptionalOperationalStatus(
  value: unknown,
): TalentOperationalStatus | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new TalentValidationError(
      `operationalStatus must be one of ${TALENT_OPERATIONAL_STATUSES.join(", ")}`,
    );
  }

  const normalized = value.trim().toUpperCase();

  if (
    TALENT_OPERATIONAL_STATUSES.includes(normalized as TalentOperationalStatus)
  ) {
    return normalized as TalentOperationalStatus;
  }

  throw new TalentValidationError(
    `operationalStatus must be one of ${TALENT_OPERATIONAL_STATUSES.join(", ")}`,
  );
}

function parseOptionalTalentOrigin(value: unknown): TalentOrigin | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new TalentValidationError(
      `talentOrigin must be one of ${TALENT_ORIGINS.join(", ")}`,
    );
  }

  const normalized = value.trim().toUpperCase();

  if (TALENT_ORIGINS.includes(normalized as TalentOrigin)) {
    return normalized as TalentOrigin;
  }

  throw new TalentValidationError(
    `talentOrigin must be one of ${TALENT_ORIGINS.join(", ")}`,
  );
}

function parseOptionalCommercialParticipationStatus(
  value: unknown,
): TalentCommercialParticipationStatus | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new TalentValidationError(
      `commercialParticipationStatus must be one of ${TALENT_COMMERCIAL_PARTICIPATION_STATUSES.join(", ")}`,
    );
  }

  const normalized = value.trim().toUpperCase();

  if (
    TALENT_COMMERCIAL_PARTICIPATION_STATUSES.includes(
      normalized as TalentCommercialParticipationStatus,
    )
  ) {
    return normalized as TalentCommercialParticipationStatus;
  }

  throw new TalentValidationError(
    `commercialParticipationStatus must be one of ${TALENT_COMMERCIAL_PARTICIPATION_STATUSES.join(", ")}`,
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
    throw new TalentValidationError(`${field} must be a boolean`);
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === "true") {
    return true;
  }

  if (normalized === "false") {
    return false;
  }

  throw new TalentValidationError(`${field} must be a boolean`);
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
    throw new TalentValidationError("limit must be a positive integer");
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
    throw new TalentValidationError(`${field} must be an integer`);
  }

  if (!Number.isInteger(numeric)) {
    throw new TalentValidationError(`${field} must be an integer`);
  }

  return numeric;
}

function parseOptionalCursor(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new TalentValidationError("cursor must be a string");
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function parseOptionalSearch(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new TalentValidationError("search must be a string");
  }

  const normalized = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  return normalized.length > 0 ? normalized : undefined;
}

function parseOptionalSortField(value: unknown): TalentSortField | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new TalentValidationError(
      `sortBy must be one of ${TALENT_SORT_FIELDS.join(", ")}`,
    );
  }

  const normalized = value.trim();

  if (TALENT_SORT_FIELDS.includes(normalized as TalentSortField)) {
    return normalized as TalentSortField;
  }

  throw new TalentValidationError(
    `sortBy must be one of ${TALENT_SORT_FIELDS.join(", ")}`,
  );
}

function parseOptionalSortDirection(
  value: unknown,
): TalentSortDirection | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new TalentValidationError(
      `sortDirection must be one of ${TALENT_SORT_DIRECTIONS.join(", ")}`,
    );
  }

  const normalized = value.trim().toUpperCase();

  if (TALENT_SORT_DIRECTIONS.includes(normalized as TalentSortDirection)) {
    return normalized as TalentSortDirection;
  }

  throw new TalentValidationError(
    `sortDirection must be one of ${TALENT_SORT_DIRECTIONS.join(", ")}`,
  );
}
