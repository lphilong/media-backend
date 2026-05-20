import { Actor } from "@core/actor/actor";
import { SystemInvariantError } from "@core/error/system-error";
import { Permission } from "@core/permission/permission.enum";
import { PermissionGuard } from "@core/permission/permission.guard";
import { PermissionResolver } from "@core/permission/permission.resolver";
import {
  ContractRegistryNotFoundError,
  ContractRegistryPermissionScopeError,
  ContractRegistryValidationError,
} from "@modules/contract-registry/domain/contract-registry.errors";
import {
  CONTRACT_CONFIDENTIALITY_TIERS,
  CONTRACT_KINDS,
  CONTRACT_LINKED_ENTITY_KINDS,
  CONTRACT_RECORD_SORT_DIRECTIONS,
  CONTRACT_RECORD_SORT_FIELDS,
  CONTRACT_RECORD_STATUSES,
  ContractConfidentialityTier,
  ContractKind,
  ContractLinkedEntityKind,
  ContractRecordSortDirection,
  ContractRecordSortField,
  ContractRecordStatus,
} from "@modules/contract-registry/domain/contract-registry.types";
import { ContractRegistryReadRepository } from "@modules/contract-registry/read/contract-registry.read-repository";
import {
  GetContractRecordDetailQuery,
  GetContractRecordDetailResult,
  ListContractRecordsByLinkedEntityQuery,
  ListContractRecordsByLinkedEntityResult,
  ListContractRecordsByOwnerQuery,
  ListContractRecordsByOwnerResult,
  ListContractRecordsQuery,
  ListContractRecordsResult,
} from "@modules/contract-registry/shared/contract-registry.contracts";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

interface ParsedDateWindow {
  readonly windowStartDate?: number;
  readonly windowEndDate?: number;
}

interface ParsedEffectiveEndDateRange {
  readonly effectiveEndDateFrom?: number;
  readonly effectiveEndDateTo?: number;
}

interface ParsedLinkedEntityFilter {
  readonly linkedEntityKind?: ContractLinkedEntityKind;
  readonly linkedEmploymentProfileId?: string;
  readonly linkedTalentId?: string;
}

interface ParsedExactLinkedEntityFilter {
  readonly linkedEntityKind: ContractLinkedEntityKind;
  readonly linkedEmploymentProfileId: string | null;
  readonly linkedTalentId: string | null;
}

export class ContractRegistryAdminQueryService {
  constructor(
    private readonly readRepository: ContractRegistryReadRepository,
  ) {}

  async listContractRecords(
    actor: Actor,
    query: ListContractRecordsQuery,
  ): Promise<ListContractRecordsResult> {
    this.assertReadPermission(actor);
    assertGlobalScope(
      actor,
      "Contract registry queries require global scope",
    );

    const linkedEntityFilter =
      parseLinkedEntityFilter({
        linkedEntityKind: query.linkedEntityKind,
        linkedEmploymentProfileId:
          query.linkedEmploymentProfileId,
        linkedTalentId: query.linkedTalentId,
      });
    const window = parseDateWindow({
      windowStartDate: query.windowStartDate,
      windowEndDate: query.windowEndDate,
    });
    const effectiveEndDateRange =
      parseEffectiveEndDateRange({
        effectiveEndDateFrom:
          query.effectiveEndDateFrom,
        effectiveEndDateTo: query.effectiveEndDateTo,
      });

    return this.readRepository.listContractRecords({
      status: parseOptionalStatus(query.status),
      contractKind: parseOptionalContractKind(
        query.contractKind,
      ),
      linkedEntityKind:
        linkedEntityFilter.linkedEntityKind,
      linkedEmploymentProfileId:
        linkedEntityFilter.linkedEmploymentProfileId,
      linkedTalentId:
        linkedEntityFilter.linkedTalentId,
      ownerEmploymentProfileId: parseOptionalId(
        query.ownerEmploymentProfileId,
        "ownerEmploymentProfileId",
      ),
      confidentialityTier:
        parseOptionalConfidentialityTier(
          query.confidentialityTier,
        ),
      hasFileReference: parseOptionalBoolean(
        query.hasFileReference,
        "hasFileReference",
      ),
      windowStartDate: window.windowStartDate,
      windowEndDate: window.windowEndDate,
      effectiveEndDateFrom:
        effectiveEndDateRange.effectiveEndDateFrom,
      effectiveEndDateTo:
        effectiveEndDateRange.effectiveEndDateTo,
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

  async listContractRecordsByLinkedEntity(
    actor: Actor,
    query: ListContractRecordsByLinkedEntityQuery,
  ): Promise<ListContractRecordsByLinkedEntityResult> {
    this.assertReadPermission(actor);
    assertGlobalScope(
      actor,
      "Contract registry queries require global scope",
    );

    const linkedEntity =
      parseExactLinkedEntityFilter(query);
    const window = parseDateWindow({
      windowStartDate: query.windowStartDate,
      windowEndDate: query.windowEndDate,
    });

    return this.readRepository.listContractRecordsByLinkedEntity(
      {
        linkedEntityKind:
          linkedEntity.linkedEntityKind,
        linkedEmploymentProfileId:
          linkedEntity.linkedEmploymentProfileId,
        linkedTalentId:
          linkedEntity.linkedTalentId,
        status: parseOptionalStatus(query.status),
        windowStartDate: window.windowStartDate,
        windowEndDate: window.windowEndDate,
        limit: parseLimit(query.limit),
        cursor: parseOptionalCursor(query.cursor),
        sortField: parseOptionalSortField(
          query.sortBy,
        ),
        sortDirection: parseOptionalSortDirection(
          query.sortDirection,
        ),
      },
    );
  }

  async listContractRecordsByOwner(
    actor: Actor,
    query: ListContractRecordsByOwnerQuery,
  ): Promise<ListContractRecordsByOwnerResult> {
    this.assertReadPermission(actor);
    assertGlobalScope(
      actor,
      "Contract registry queries require global scope",
    );

    const window = parseDateWindow({
      windowStartDate: query.windowStartDate,
      windowEndDate: query.windowEndDate,
    });

    return this.readRepository.listContractRecordsByOwner(
      {
        ownerEmploymentProfileId: normalizeRequiredText(
          query.ownerEmploymentProfileId,
          "ownerEmploymentProfileId",
        ),
        status: parseOptionalStatus(query.status),
        windowStartDate: window.windowStartDate,
        windowEndDate: window.windowEndDate,
        limit: parseLimit(query.limit),
        cursor: parseOptionalCursor(query.cursor),
        sortField: parseOptionalSortField(
          query.sortBy,
        ),
        sortDirection: parseOptionalSortDirection(
          query.sortDirection,
        ),
      },
    );
  }

  async getContractRecordDetail(
    actor: Actor,
    query: GetContractRecordDetailQuery,
  ): Promise<GetContractRecordDetailResult> {
    this.assertReadPermission(actor);
    assertGlobalScope(
      actor,
      "Contract registry queries require global scope",
    );

    const contractRecordId = normalizeRequiredText(
      query.contractRecordId,
      "contractRecordId",
    );
    const detail =
      await this.readRepository.getContractRecordDetail(
        contractRecordId,
      );

    if (!detail) {
      throw new ContractRegistryNotFoundError(
        contractRecordId,
      );
    }

    return detail;
  }

  private assertReadPermission(actor: Actor): void {
    assertAdminActorType(actor);

    const permission = PermissionResolver.resolve(
      Permission.CONTRACT_REGISTRY_READ,
    );
    PermissionGuard.assert(actor, permission);
  }
}

function parseLinkedEntityFilter(input: {
  readonly linkedEntityKind: unknown;
  readonly linkedEmploymentProfileId: unknown;
  readonly linkedTalentId: unknown;
}): ParsedLinkedEntityFilter {
  const linkedEntityKind =
    parseOptionalLinkedEntityKind(
      input.linkedEntityKind,
    );
  const linkedEmploymentProfileId = parseOptionalId(
    input.linkedEmploymentProfileId,
    "linkedEmploymentProfileId",
  );
  const linkedTalentId = parseOptionalId(
    input.linkedTalentId,
    "linkedTalentId",
  );

  if (
    linkedEmploymentProfileId !== undefined &&
    linkedTalentId !== undefined
  ) {
    throw new ContractRegistryValidationError(
      "At most one linked entity id filter may be provided",
    );
  }

  if (
    linkedEntityKind === "EMPLOYMENT_PROFILE" &&
    linkedTalentId !== undefined
  ) {
    throw new ContractRegistryValidationError(
      "linkedEntityKind EMPLOYMENT_PROFILE is inconsistent with linkedTalentId filter",
    );
  }

  if (
    linkedEntityKind === "TALENT" &&
    linkedEmploymentProfileId !== undefined
  ) {
    throw new ContractRegistryValidationError(
      "linkedEntityKind TALENT is inconsistent with linkedEmploymentProfileId filter",
    );
  }

  return {
    linkedEntityKind,
    linkedEmploymentProfileId,
    linkedTalentId,
  };
}

function parseExactLinkedEntityFilter(
  query: ListContractRecordsByLinkedEntityQuery,
): ParsedExactLinkedEntityFilter {
  const linkedEntityKind = parseRequiredLinkedEntityKind(
    query.linkedEntityKind,
  );
  const linkedEmploymentProfileId = parseOptionalId(
    query.linkedEmploymentProfileId,
    "linkedEmploymentProfileId",
  );
  const linkedTalentId = parseOptionalId(
    query.linkedTalentId,
    "linkedTalentId",
  );

  if (
    linkedEntityKind === "EMPLOYMENT_PROFILE" &&
    linkedEmploymentProfileId &&
    !linkedTalentId
  ) {
    return {
      linkedEntityKind,
      linkedEmploymentProfileId,
      linkedTalentId: null,
    };
  }

  if (
    linkedEntityKind === "TALENT" &&
    linkedTalentId &&
    !linkedEmploymentProfileId
  ) {
    return {
      linkedEntityKind,
      linkedEmploymentProfileId: null,
      linkedTalentId,
    };
  }

  throw new ContractRegistryValidationError(
    "listContractRecordsByLinkedEntity requires exactly one linked entity id matching linkedEntityKind",
  );
}

function parseDateWindow(input: {
  readonly windowStartDate: unknown;
  readonly windowEndDate: unknown;
}): ParsedDateWindow {
  const windowStartDate = parseOptionalDate(
    input.windowStartDate,
    "windowStartDate",
  );
  const windowEndDate = parseOptionalDate(
    input.windowEndDate,
    "windowEndDate",
  );

  if (
    windowStartDate !== undefined &&
    windowEndDate !== undefined &&
    windowEndDate < windowStartDate
  ) {
    throw new ContractRegistryValidationError(
      "windowEndDate must not be earlier than windowStartDate",
    );
  }

  return {
    windowStartDate,
    windowEndDate,
  };
}

function parseEffectiveEndDateRange(input: {
  readonly effectiveEndDateFrom: unknown;
  readonly effectiveEndDateTo: unknown;
}): ParsedEffectiveEndDateRange {
  const effectiveEndDateFrom = parseOptionalDate(
    input.effectiveEndDateFrom,
    "effectiveEndDateFrom",
  );
  const effectiveEndDateTo = parseOptionalDate(
    input.effectiveEndDateTo,
    "effectiveEndDateTo",
  );

  if (
    effectiveEndDateFrom !== undefined &&
    effectiveEndDateTo !== undefined &&
    effectiveEndDateTo < effectiveEndDateFrom
  ) {
    throw new ContractRegistryValidationError(
      "effectiveEndDateTo must not be earlier than effectiveEndDateFrom",
    );
  }

  return {
    effectiveEndDateFrom,
    effectiveEndDateTo,
  };
}

function normalizeRequiredText(
  value: unknown,
  field: string,
): string {
  if (typeof value !== "string") {
    throw new ContractRegistryValidationError(
      `${field} must be a string`,
    );
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new ContractRegistryValidationError(
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
    throw new ContractRegistryValidationError(
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
): ContractRecordStatus | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new ContractRegistryValidationError(
      `status must be one of ${CONTRACT_RECORD_STATUSES.join(", ")}`,
    );
  }

  const normalized = value.trim().toUpperCase();

  if (
    CONTRACT_RECORD_STATUSES.includes(
      normalized as ContractRecordStatus,
    )
  ) {
    return normalized as ContractRecordStatus;
  }

  throw new ContractRegistryValidationError(
    `status must be one of ${CONTRACT_RECORD_STATUSES.join(", ")}`,
  );
}

function parseOptionalContractKind(
  value: unknown,
): ContractKind | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new ContractRegistryValidationError(
      `contractKind must be one of ${CONTRACT_KINDS.join(", ")}`,
    );
  }

  const normalized = value.trim().toUpperCase();

  if (
    CONTRACT_KINDS.includes(
      normalized as ContractKind,
    )
  ) {
    return normalized as ContractKind;
  }

  throw new ContractRegistryValidationError(
    `contractKind must be one of ${CONTRACT_KINDS.join(", ")}`,
  );
}

function parseOptionalLinkedEntityKind(
  value: unknown,
): ContractLinkedEntityKind | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  return parseRequiredLinkedEntityKind(value);
}

function parseRequiredLinkedEntityKind(
  value: unknown,
): ContractLinkedEntityKind {
  if (typeof value !== "string") {
    throw new ContractRegistryValidationError(
      `linkedEntityKind must be one of ${CONTRACT_LINKED_ENTITY_KINDS.join(", ")}`,
    );
  }

  const normalized = value.trim().toUpperCase();

  if (
    CONTRACT_LINKED_ENTITY_KINDS.includes(
      normalized as ContractLinkedEntityKind,
    )
  ) {
    return normalized as ContractLinkedEntityKind;
  }

  throw new ContractRegistryValidationError(
    `linkedEntityKind must be one of ${CONTRACT_LINKED_ENTITY_KINDS.join(", ")}`,
  );
}

function parseOptionalConfidentialityTier(
  value: unknown,
): ContractConfidentialityTier | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new ContractRegistryValidationError(
      `confidentialityTier must be one of ${CONTRACT_CONFIDENTIALITY_TIERS.join(", ")}`,
    );
  }

  const normalized = value.trim().toUpperCase();

  if (
    CONTRACT_CONFIDENTIALITY_TIERS.includes(
      normalized as ContractConfidentialityTier,
    )
  ) {
    return normalized as ContractConfidentialityTier;
  }

  throw new ContractRegistryValidationError(
    `confidentialityTier must be one of ${CONTRACT_CONFIDENTIALITY_TIERS.join(", ")}`,
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
    throw new ContractRegistryValidationError(
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

  throw new ContractRegistryValidationError(
    `${field} must be a boolean`,
  );
}

function parseOptionalDate(
  value: unknown,
  field: string,
): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new ContractRegistryValidationError(
      `${field} must be a canonical calendar date`,
    );
  }

  return parseCanonicalCalendarDateValue(
    value,
    field,
  );
}

function parseCanonicalCalendarDateValue(
  value: string,
  field: string,
): number {
  const normalized = value.trim();

  if (!normalized) {
    throw new ContractRegistryValidationError(
      `${field} must be a canonical calendar date`,
    );
  }

  const match =
    /^(\d{4})-(\d{2})-(\d{2})$/u.exec(
      normalized,
    );

  if (!match) {
    throw new ContractRegistryValidationError(
      `${field} must be a canonical calendar date`,
    );
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utcMidnight = Date.UTC(
    year,
    month - 1,
    day,
  );
  const normalizedDate = new Date(utcMidnight);

  if (
    normalizedDate.getUTCFullYear() !== year ||
    normalizedDate.getUTCMonth() !== month - 1 ||
    normalizedDate.getUTCDate() !== day
  ) {
    throw new ContractRegistryValidationError(
      `${field} must be a canonical calendar date`,
    );
  }

  return utcMidnight;
}

function parseLimit(value: unknown): number {
  if (value === undefined || value === null) {
    return DEFAULT_LIMIT;
  }

  const parsed = parseOptionalInteger(value, "limit");

  if (parsed === undefined) {
    return DEFAULT_LIMIT;
  }

  if (parsed <= 0) {
    throw new ContractRegistryValidationError(
      "limit must be a positive integer",
    );
  }

  return Math.min(parsed, MAX_LIMIT);
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
    throw new ContractRegistryValidationError(
      `${field} must be an integer`,
    );
  }

  if (!Number.isInteger(numeric)) {
    throw new ContractRegistryValidationError(
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
    throw new ContractRegistryValidationError(
      "cursor must be a string",
    );
  }

  const normalized = value.trim();
  return normalized.length > 0
    ? normalized
    : undefined;
}

function parseOptionalSearch(
  value: unknown,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new ContractRegistryValidationError(
      "search must be a string",
    );
  }

  const normalized = value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();

  return normalized.length > 0
    ? normalized
    : undefined;
}

function parseOptionalSortField(
  value: unknown,
): ContractRecordSortField | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new ContractRegistryValidationError(
      `sortBy must be one of ${CONTRACT_RECORD_SORT_FIELDS.join(", ")}`,
    );
  }

  const normalized = value.trim();

  if (
    CONTRACT_RECORD_SORT_FIELDS.includes(
      normalized as ContractRecordSortField,
    )
  ) {
    return normalized as ContractRecordSortField;
  }

  throw new ContractRegistryValidationError(
    `sortBy must be one of ${CONTRACT_RECORD_SORT_FIELDS.join(", ")}`,
  );
}

function parseOptionalSortDirection(
  value: unknown,
): ContractRecordSortDirection | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new ContractRegistryValidationError(
      `sortDirection must be one of ${CONTRACT_RECORD_SORT_DIRECTIONS.join(", ")}`,
    );
  }

  const normalized = value.trim().toUpperCase();

  if (
    CONTRACT_RECORD_SORT_DIRECTIONS.includes(
      normalized as ContractRecordSortDirection,
    )
  ) {
    return normalized as ContractRecordSortDirection;
  }

  throw new ContractRegistryValidationError(
    `sortDirection must be one of ${CONTRACT_RECORD_SORT_DIRECTIONS.join(", ")}`,
  );
}

function assertGlobalScope(
  actor: Actor,
  message: string,
): void {
  if (
    PermissionGuard.hasContractRegistryScopeGrant(
      actor,
      "global",
    )
  ) {
    return;
  }

  throw new ContractRegistryPermissionScopeError(
    message,
  );
}

function assertAdminActorType(
  actor: Actor,
): void {
  if (actor.type === "admin") {
    return;
  }

  throw new SystemInvariantError(
    "PERMISSION_DENIED",
    `Contract registry access requires actor.type admin, received ${actor.type}`,
  );
}
