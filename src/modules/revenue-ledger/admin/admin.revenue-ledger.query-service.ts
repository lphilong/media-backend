import { Actor } from "@core/actor/actor";
import { SystemInvariantError } from "@core/error/system-error";
import { Permission } from "@core/permission/permission.enum";
import { PermissionGuard } from "@core/permission/permission.guard";
import { PermissionResolver } from "@core/permission/permission.resolver";
import {
  RevenueLedgerNotFoundError,
  RevenueLedgerPermissionScopeError,
  RevenueLedgerValidationError,
} from "@modules/revenue-ledger/domain/revenue-ledger.errors";
import {
  REVENUE_ENTRY_KINDS,
  REVENUE_ENTRY_SORT_DIRECTIONS,
  REVENUE_ENTRY_SORT_FIELDS,
  REVENUE_ENTRY_SOURCES,
  REVENUE_ENTRY_STATUSES,
  RevenueEntrySortDirection,
  RevenueEntrySortField,
  RevenueEntrySource,
  RevenueEntryStatus,
  RevenueKind,
} from "@modules/revenue-ledger/domain/revenue-ledger.types";
import { RevenueLedgerReadRepository } from "@modules/revenue-ledger/read/revenue-ledger.read-repository";
import {
  GetRevenueEntryDetailQuery,
  GetRevenueEntryDetailResult,
  ListRevenueEntriesByEventQuery,
  ListRevenueEntriesByEventResult,
  ListRevenueEntriesByPlatformQuery,
  ListRevenueEntriesByPlatformResult,
  ListRevenueEntriesByTalentQuery,
  ListRevenueEntriesByTalentResult,
  ListRevenueEntriesQuery,
  ListRevenueEntriesResult,
} from "@modules/revenue-ledger/shared/revenue-ledger.contracts";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

interface ParsedWindowFilter {
  readonly windowStartAt?: number;
  readonly windowEndAt?: number;
}

interface ParsedTimestampRangeFilter {
  readonly fromAt?: number;
  readonly toAt?: number;
}

interface FlatListSortCoverageInput {
  readonly sortField?: RevenueEntrySortField;
  readonly status?: RevenueEntryStatus;
  readonly subjectTalentId?: string;
  readonly attributionPlatformAccountId?: string;
  readonly attributionEventId?: string;
  readonly revenueKind?: RevenueKind;
  readonly entrySource?: RevenueEntrySource;
  readonly currencyCode?: string;
  readonly windowStartAt?: number;
  readonly windowEndAt?: number;
  readonly createdBeforeAt?: number;
  readonly finalizedFromAt?: number;
  readonly finalizedToAt?: number;
  readonly reconciledFromAt?: number;
  readonly reconciledToAt?: number;
  readonly search?: string;
}

export class RevenueLedgerAdminQueryService {
  constructor(
    private readonly readRepository: RevenueLedgerReadRepository,
  ) {}

  async listRevenueEntries(
    actor: Actor,
    query: ListRevenueEntriesQuery,
  ): Promise<ListRevenueEntriesResult> {
    this.assertReadPermission(actor);
    assertGlobalScope(
      actor,
      "Revenue Ledger queries require global scope",
    );

    const window = parseWindowFilter({
      windowStartAt: query.windowStartAt,
      windowEndAt: query.windowEndAt,
    });
    const finalizedAt = parseTimestampRangeFilter(
      {
        fromAt: query.finalizedFromAt,
        toAt: query.finalizedToAt,
      },
      "finalizedFromAt",
      "finalizedToAt",
    );
    const reconciledAt = parseTimestampRangeFilter(
      {
        fromAt: query.reconciledFromAt,
        toAt: query.reconciledToAt,
      },
      "reconciledFromAt",
      "reconciledToAt",
    );
    const createdBeforeAt = parseOptionalInteger(
      query.createdBeforeAt,
      "createdBeforeAt",
    );

    const status = parseOptionalStatus(query.status);
    const subjectTalentId = parseOptionalId(
      query.subjectTalentId,
      "subjectTalentId",
    );
    const attributionPlatformAccountId =
      parseOptionalId(
        query.attributionPlatformAccountId,
        "attributionPlatformAccountId",
      );
    const attributionEventId = parseOptionalId(
      query.attributionEventId,
      "attributionEventId",
    );
    const revenueKind = parseOptionalRevenueKind(
      query.revenueKind,
    );
    const entrySource = parseOptionalEntrySource(
      query.entrySource,
    );
    const currencyCode = parseOptionalCurrencyCode(
      query.currencyCode,
    );
    const sortField = parseOptionalSortField(
      query.sortBy,
    );
    const sortDirection = parseOptionalSortDirection(
      query.sortDirection,
    );
    const search = parseOptionalSearch(query.search);

    assertFlatListSortCoverage({
      sortField,
      status,
      subjectTalentId,
      attributionPlatformAccountId,
      attributionEventId,
      revenueKind,
      entrySource,
      currencyCode,
      windowStartAt: window.windowStartAt,
      windowEndAt: window.windowEndAt,
      createdBeforeAt,
      finalizedFromAt: finalizedAt.fromAt,
      finalizedToAt: finalizedAt.toAt,
      reconciledFromAt: reconciledAt.fromAt,
      reconciledToAt: reconciledAt.toAt,
      search,
    });

    return this.readRepository.listRevenueEntries({
      status,
      subjectTalentId,
      attributionPlatformAccountId,
      attributionEventId,
      revenueKind,
      entrySource,
      currencyCode,
      windowStartAt: window.windowStartAt,
      windowEndAt: window.windowEndAt,
      createdBeforeAt,
      finalizedFromAt: finalizedAt.fromAt,
      finalizedToAt: finalizedAt.toAt,
      reconciledFromAt: reconciledAt.fromAt,
      reconciledToAt: reconciledAt.toAt,
      limit: parseLimit(query.limit),
      cursor: parseOptionalCursor(query.cursor),
      search,
      sortField,
      sortDirection,
    });
  }

  async listRevenueEntriesByTalent(
    actor: Actor,
    query: ListRevenueEntriesByTalentQuery,
  ): Promise<ListRevenueEntriesByTalentResult> {
    this.assertReadPermission(actor);
    assertGlobalScope(
      actor,
      "Revenue Ledger queries require global scope",
    );

    const window = parseWindowFilter({
      windowStartAt: query.windowStartAt,
      windowEndAt: query.windowEndAt,
    });

    const sortField = parseOptionalSortField(
      query.sortBy,
    );
    assertSpecializedListSortCoverage(
      sortField,
      "listRevenueEntriesByTalent",
    );

    return this.readRepository.listRevenueEntriesByTalent({
      subjectTalentId: normalizeRequiredText(
        query.subjectTalentId,
        "subjectTalentId",
      ),
      status: parseOptionalStatus(query.status),
      windowStartAt: window.windowStartAt,
      windowEndAt: window.windowEndAt,
      limit: parseLimit(query.limit),
      cursor: parseOptionalCursor(query.cursor),
      sortField,
      sortDirection: parseOptionalSortDirection(
        query.sortDirection,
      ),
    });
  }

  async listRevenueEntriesByPlatform(
    actor: Actor,
    query: ListRevenueEntriesByPlatformQuery,
  ): Promise<ListRevenueEntriesByPlatformResult> {
    this.assertReadPermission(actor);
    assertGlobalScope(
      actor,
      "Revenue Ledger queries require global scope",
    );

    const window = parseWindowFilter({
      windowStartAt: query.windowStartAt,
      windowEndAt: query.windowEndAt,
    });

    const sortField = parseOptionalSortField(
      query.sortBy,
    );
    assertSpecializedListSortCoverage(
      sortField,
      "listRevenueEntriesByPlatform",
    );

    return this.readRepository.listRevenueEntriesByPlatform(
      {
        attributionPlatformAccountId:
          normalizeRequiredText(
            query.attributionPlatformAccountId,
            "attributionPlatformAccountId",
          ),
        status: parseOptionalStatus(query.status),
        windowStartAt: window.windowStartAt,
        windowEndAt: window.windowEndAt,
        limit: parseLimit(query.limit),
        cursor: parseOptionalCursor(query.cursor),
        sortField,
        sortDirection: parseOptionalSortDirection(
          query.sortDirection,
        ),
      },
    );
  }

  async listRevenueEntriesByEvent(
    actor: Actor,
    query: ListRevenueEntriesByEventQuery,
  ): Promise<ListRevenueEntriesByEventResult> {
    this.assertReadPermission(actor);
    assertGlobalScope(
      actor,
      "Revenue Ledger queries require global scope",
    );

    const window = parseWindowFilter({
      windowStartAt: query.windowStartAt,
      windowEndAt: query.windowEndAt,
    });

    const sortField = parseOptionalSortField(
      query.sortBy,
    );
    assertSpecializedListSortCoverage(
      sortField,
      "listRevenueEntriesByEvent",
    );

    return this.readRepository.listRevenueEntriesByEvent(
      {
        attributionEventId: normalizeRequiredText(
          query.attributionEventId,
          "attributionEventId",
        ),
        status: parseOptionalStatus(query.status),
        windowStartAt: window.windowStartAt,
        windowEndAt: window.windowEndAt,
        limit: parseLimit(query.limit),
        cursor: parseOptionalCursor(query.cursor),
        sortField,
        sortDirection: parseOptionalSortDirection(
          query.sortDirection,
        ),
      },
    );
  }

  async getRevenueEntryDetail(
    actor: Actor,
    query: GetRevenueEntryDetailQuery,
  ): Promise<GetRevenueEntryDetailResult> {
    this.assertReadPermission(actor);
    assertGlobalScope(
      actor,
      "Revenue Ledger queries require global scope",
    );

    const revenueEntryId = normalizeRequiredText(
      query.revenueEntryId,
      "revenueEntryId",
    );
    const detail =
      await this.readRepository.getRevenueEntryDetail(
        revenueEntryId,
      );

    if (!detail) {
      throw new RevenueLedgerNotFoundError(
        revenueEntryId,
      );
    }

    return detail;
  }

  private assertReadPermission(actor: Actor): void {
    assertAdminActorType(actor);

    const permission = PermissionResolver.resolve(
      Permission.REVENUE_LEDGER_READ,
    );
    PermissionGuard.assert(actor, permission);
  }
}

function parseTimestampRangeFilter(
  input: {
    readonly fromAt: unknown;
    readonly toAt: unknown;
  },
  fromField: string,
  toField: string,
): ParsedTimestampRangeFilter {
  const fromAt = parseOptionalInteger(
    input.fromAt,
    fromField,
  );
  const toAt = parseOptionalInteger(
    input.toAt,
    toField,
  );

  if (
    fromAt !== undefined &&
    toAt !== undefined &&
    toAt <= fromAt
  ) {
    throw new RevenueLedgerValidationError(
      `${toField} must be strictly greater than ${fromField}`,
    );
  }

  return {
    fromAt,
    toAt,
  };
}

function normalizeRequiredText(
  value: unknown,
  field: string,
): string {
  if (typeof value !== "string") {
    throw new RevenueLedgerValidationError(
      `${field} must be a string`,
    );
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new RevenueLedgerValidationError(
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
    throw new RevenueLedgerValidationError(
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
): RevenueEntryStatus | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new RevenueLedgerValidationError(
      `status must be one of ${REVENUE_ENTRY_STATUSES.join(", ")}`,
    );
  }

  const normalized = value.trim().toUpperCase();

  if (
    REVENUE_ENTRY_STATUSES.includes(
      normalized as RevenueEntryStatus,
    )
  ) {
    return normalized as RevenueEntryStatus;
  }

  throw new RevenueLedgerValidationError(
    `status must be one of ${REVENUE_ENTRY_STATUSES.join(", ")}`,
  );
}

function parseOptionalRevenueKind(
  value: unknown,
): RevenueKind | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new RevenueLedgerValidationError(
      `revenueKind must be one of ${REVENUE_ENTRY_KINDS.join(", ")}`,
    );
  }

  const normalized = value.trim().toUpperCase();

  if (
    REVENUE_ENTRY_KINDS.includes(
      normalized as RevenueKind,
    )
  ) {
    return normalized as RevenueKind;
  }

  throw new RevenueLedgerValidationError(
    `revenueKind must be one of ${REVENUE_ENTRY_KINDS.join(", ")}`,
  );
}

function parseOptionalEntrySource(
  value: unknown,
): RevenueEntrySource | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new RevenueLedgerValidationError(
      `entrySource must be one of ${REVENUE_ENTRY_SOURCES.join(", ")}`,
    );
  }

  const normalized = value.trim().toUpperCase();

  if (
    REVENUE_ENTRY_SOURCES.includes(
      normalized as RevenueEntrySource,
    )
  ) {
    return normalized as RevenueEntrySource;
  }

  throw new RevenueLedgerValidationError(
    `entrySource must be one of ${REVENUE_ENTRY_SOURCES.join(", ")}`,
  );
}

function parseOptionalCurrencyCode(
  value: unknown,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new RevenueLedgerValidationError(
      "currencyCode must be a string",
    );
  }

  const normalized = value.trim().toUpperCase();

  if (!normalized) {
    return undefined;
  }

  if (!/^[A-Z]{3}$/u.test(normalized)) {
    throw new RevenueLedgerValidationError(
      "currencyCode must be exactly 3 uppercase letters",
    );
  }

  return normalized;
}

function parseWindowFilter(input: {
  readonly windowStartAt: unknown;
  readonly windowEndAt: unknown;
}): ParsedWindowFilter {
  const windowStartAt = parseOptionalInteger(
    input.windowStartAt,
    "windowStartAt",
  );
  const windowEndAt = parseOptionalInteger(
    input.windowEndAt,
    "windowEndAt",
  );

  if (
    windowStartAt !== undefined &&
    windowEndAt !== undefined &&
    windowEndAt <= windowStartAt
  ) {
    throw new RevenueLedgerValidationError(
      "windowEndAt must be strictly greater than windowStartAt",
    );
  }

  return {
    windowStartAt,
    windowEndAt,
  };
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
    throw new RevenueLedgerValidationError(
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
    throw new RevenueLedgerValidationError(
      `${field} must be an integer`,
    );
  }

  if (!Number.isInteger(numeric)) {
    throw new RevenueLedgerValidationError(
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
    throw new RevenueLedgerValidationError(
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
    throw new RevenueLedgerValidationError(
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
): RevenueEntrySortField | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new RevenueLedgerValidationError(
      `sortBy must be one of ${REVENUE_ENTRY_SORT_FIELDS.join(", ")}`,
    );
  }

  const normalized = value.trim();

  if (
    REVENUE_ENTRY_SORT_FIELDS.includes(
      normalized as RevenueEntrySortField,
    )
  ) {
    return normalized as RevenueEntrySortField;
  }

  throw new RevenueLedgerValidationError(
    `sortBy must be one of ${REVENUE_ENTRY_SORT_FIELDS.join(", ")}`,
  );
}

function parseOptionalSortDirection(
  value: unknown,
): RevenueEntrySortDirection | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new RevenueLedgerValidationError(
      `sortDirection must be one of ${REVENUE_ENTRY_SORT_DIRECTIONS.join(", ")}`,
    );
  }

  const normalized = value.trim().toUpperCase();

  if (
    REVENUE_ENTRY_SORT_DIRECTIONS.includes(
      normalized as RevenueEntrySortDirection,
    )
  ) {
    return normalized as RevenueEntrySortDirection;
  }

  throw new RevenueLedgerValidationError(
    `sortDirection must be one of ${REVENUE_ENTRY_SORT_DIRECTIONS.join(", ")}`,
  );
}

function assertFlatListSortCoverage(
  input: FlatListSortCoverageInput,
): void {
  if (!isFlatListFieldSort(input.sortField)) {
    return;
  }

  const hasAdditionalFilters =
    input.subjectTalentId !== undefined ||
    input.attributionPlatformAccountId !== undefined ||
    input.attributionEventId !== undefined ||
    input.revenueKind !== undefined ||
    input.entrySource !== undefined ||
    input.currencyCode !== undefined ||
    input.windowStartAt !== undefined ||
    input.windowEndAt !== undefined ||
    input.createdBeforeAt !== undefined ||
    input.finalizedFromAt !== undefined ||
    input.finalizedToAt !== undefined ||
    input.reconciledFromAt !== undefined ||
    input.reconciledToAt !== undefined ||
    input.search !== undefined;

  if (
    hasAdditionalFilters ||
    input.status === "ARCHIVED"
  ) {
    throw new RevenueLedgerValidationError(
      `sortBy ${input.sortField} supports only flat-list sort mode with status!=ARCHIVED and no additional filters/search/window`,
    );
  }
}

function assertSpecializedListSortCoverage(
  sortField: RevenueEntrySortField | undefined,
  queryName:
    | "listRevenueEntriesByTalent"
    | "listRevenueEntriesByPlatform"
    | "listRevenueEntriesByEvent",
): void {
  if (
    sortField === undefined ||
    sortField === "recognizedAt"
  ) {
    return;
  }

  throw new RevenueLedgerValidationError(
    `${queryName} supports sortBy recognizedAt only`,
  );
}

function isFlatListFieldSort(
  sortField: RevenueEntrySortField | undefined,
): sortField is "createdAt" | "revenueEntryCode" {
  return (
    sortField === "createdAt" ||
    sortField === "revenueEntryCode"
  );
}

function assertGlobalScope(
  actor: Actor,
  message: string,
): void {
  if (
    PermissionGuard.hasRevenueLedgerScopeGrant(
      actor,
      "global",
    )
  ) {
    return;
  }

  throw new RevenueLedgerPermissionScopeError(message);
}

function assertAdminActorType(
  actor: Actor,
): void {
  if (actor.type === "admin") {
    return;
  }

  throw new SystemInvariantError(
    "PERMISSION_DENIED",
    `Revenue Ledger access requires actor.type admin, received ${actor.type}`,
  );
}
