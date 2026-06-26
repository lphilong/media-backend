import { Actor } from "@core/actor/actor";
import { Permission } from "@core/permission/permission.enum";
import { PermissionGuard } from "@core/permission/permission.guard";
import { PermissionResolver } from "@core/permission/permission.resolver";
import {
  TalentKpiNotFoundError,
  TalentKpiPermissionScopeError,
  TalentKpiValidationError,
} from "@modules/talent-kpi/domain/talent-kpi.errors";
import {
  TALENT_KPI_MEASUREMENT_SOURCES,
  TALENT_KPI_METRIC_CODES,
  TALENT_KPI_RECORD_STATUSES,
  TALENT_KPI_SORT_DIRECTIONS,
  TALENT_KPI_SORT_FIELDS,
  TalentKpiMeasurementSource,
  TalentKpiMetricCode,
  TalentKpiRecordStatus,
  TalentKpiSortDirection,
  TalentKpiSortField,
} from "@modules/talent-kpi/domain/talent-kpi.types";
import { TalentKpiReadRepository } from "@modules/talent-kpi/read/talent-kpi.read-repository";
import {
  GetTalentKpiRecordDetailQuery,
  GetTalentKpiRecordDetailResult,
  ListTalentKpiByEventQuery,
  ListTalentKpiByEventResult,
  ListTalentKpiByPlatformQuery,
  ListTalentKpiByPlatformResult,
  ListTalentKpiByTalentQuery,
  ListTalentKpiByTalentResult,
  ListTalentKpiMetricValuesQuery,
  ListTalentKpiMetricValuesResult,
  ListTalentKpiRecordsQuery,
  ListTalentKpiRecordsResult,
} from "@modules/talent-kpi/shared/talent-kpi.contracts";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

interface ParsedWindowFilter {
  readonly windowStartAt?: number;
  readonly windowEndAt?: number;
}

interface ParsedPublishedAtFilter {
  readonly publishedFromAt?: number;
  readonly publishedToAt?: number;
}

export class TalentKpiAdminQueryService {
  constructor(
    private readonly readRepository: TalentKpiReadRepository,
  ) {}

  async listTalentKpiRecords(
    actor: Actor,
    query: ListTalentKpiRecordsQuery,
  ): Promise<ListTalentKpiRecordsResult> {
    this.assertReadPermission(actor);
    assertGlobalScope(
      actor,
      "Talent KPI queries require global scope",
    );

    const window = parseWindowFilter({
      windowStartAt: query.windowStartAt,
      windowEndAt: query.windowEndAt,
    });
    const publishedAt = parsePublishedAtFilter({
      publishedFromAt: query.publishedFromAt,
      publishedToAt: query.publishedToAt,
    });

    return this.readRepository.listTalentKpiRecords({
      status: parseOptionalStatus(query.status),
      subjectTalentId: parseOptionalId(
        query.subjectTalentId,
        "subjectTalentId",
      ),
      attributionPlatformAccountId: parseOptionalId(
        query.attributionPlatformAccountId,
        "attributionPlatformAccountId",
      ),
      attributionEventId: parseOptionalId(
        query.attributionEventId,
        "attributionEventId",
      ),
      measurementSource:
        parseOptionalMeasurementSource(
          query.measurementSource,
        ),
      containsMetricCode: parseOptionalMetricCode(
        query.containsMetricCode,
      ),
      windowStartAt: window.windowStartAt,
      windowEndAt: window.windowEndAt,
      createdBeforeAt: parseOptionalInteger(
        query.createdBeforeAt,
        "createdBeforeAt",
      ),
      publishedFromAt: publishedAt.publishedFromAt,
      publishedToAt: publishedAt.publishedToAt,
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

  async listTalentKpiRecordsByTalent(
    actor: Actor,
    query: ListTalentKpiByTalentQuery,
  ): Promise<ListTalentKpiByTalentResult> {
    this.assertReadPermission(actor);
    assertGlobalScope(
      actor,
      "Talent KPI queries require global scope",
    );

    const window = parseWindowFilter({
      windowStartAt: query.windowStartAt,
      windowEndAt: query.windowEndAt,
    });

    return this.readRepository.listTalentKpiRecordsByTalent(
      {
        subjectTalentId: normalizeRequiredText(
          query.subjectTalentId,
          "subjectTalentId",
        ),
        status: parseOptionalStatus(query.status),
        windowStartAt: window.windowStartAt,
        windowEndAt: window.windowEndAt,
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

  async listTalentKpiRecordsByPlatform(
    actor: Actor,
    query: ListTalentKpiByPlatformQuery,
  ): Promise<ListTalentKpiByPlatformResult> {
    this.assertReadPermission(actor);
    assertGlobalScope(
      actor,
      "Talent KPI queries require global scope",
    );

    const window = parseWindowFilter({
      windowStartAt: query.windowStartAt,
      windowEndAt: query.windowEndAt,
    });

    return this.readRepository.listTalentKpiRecordsByPlatform(
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
        sortField: parseOptionalSortField(
          query.sortBy,
        ),
        sortDirection: parseOptionalSortDirection(
          query.sortDirection,
        ),
      },
    );
  }

  async listTalentKpiRecordsByEvent(
    actor: Actor,
    query: ListTalentKpiByEventQuery,
  ): Promise<ListTalentKpiByEventResult> {
    this.assertReadPermission(actor);
    assertGlobalScope(
      actor,
      "Talent KPI queries require global scope",
    );

    const window = parseWindowFilter({
      windowStartAt: query.windowStartAt,
      windowEndAt: query.windowEndAt,
    });

    return this.readRepository.listTalentKpiRecordsByEvent(
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
        sortField: parseOptionalSortField(
          query.sortBy,
        ),
        sortDirection: parseOptionalSortDirection(
          query.sortDirection,
        ),
      },
    );
  }

  async listTalentKpiMetricValues(
    actor: Actor,
    query: ListTalentKpiMetricValuesQuery,
  ): Promise<ListTalentKpiMetricValuesResult> {
    this.assertReadPermission(actor);
    assertGlobalScope(
      actor,
      "Talent KPI queries require global scope",
    );

    const talentKpiRecordId = normalizeRequiredText(
      query.talentKpiRecordId,
      "talentKpiRecordId",
    );
    const detail =
      await this.readRepository.getTalentKpiRecordDetail(
        talentKpiRecordId,
      );

    if (!detail) {
      throw new TalentKpiNotFoundError(
        talentKpiRecordId,
      );
    }

    return {
      items:
        await this.readRepository.listMetricValuesForRecord(
          talentKpiRecordId,
        ),
    };
  }

  async getTalentKpiRecordDetail(
    actor: Actor,
    query: GetTalentKpiRecordDetailQuery,
  ): Promise<GetTalentKpiRecordDetailResult> {
    this.assertReadPermission(actor);
    assertGlobalScope(
      actor,
      "Talent KPI queries require global scope",
    );

    const talentKpiRecordId = normalizeRequiredText(
      query.talentKpiRecordId,
      "talentKpiRecordId",
    );
    const detail =
      await this.readRepository.getTalentKpiRecordDetail(
        talentKpiRecordId,
      );

    if (!detail) {
      throw new TalentKpiNotFoundError(
        talentKpiRecordId,
      );
    }

    return detail;
  }

  private assertReadPermission(actor: Actor): void {
    assertAdminActorType(actor);

    const permission = PermissionResolver.resolve(
      Permission.TALENT_KPI_READ,
    );
    PermissionGuard.assert(actor, permission);
  }
}

function parsePublishedAtFilter(input: {
  readonly publishedFromAt: unknown;
  readonly publishedToAt: unknown;
}): ParsedPublishedAtFilter {
  const publishedFromAt = parseOptionalInteger(
    input.publishedFromAt,
    "publishedFromAt",
  );
  const publishedToAt = parseOptionalInteger(
    input.publishedToAt,
    "publishedToAt",
  );

  if (
    publishedFromAt !== undefined &&
    publishedToAt !== undefined &&
    publishedToAt <= publishedFromAt
  ) {
    throw new TalentKpiValidationError(
      "publishedToAt must be strictly greater than publishedFromAt",
    );
  }

  return {
    publishedFromAt,
    publishedToAt,
  };
}

function normalizeRequiredText(
  value: unknown,
  field: string,
): string {
  if (typeof value !== "string") {
    throw new TalentKpiValidationError(
      `${field} must be a string`,
    );
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new TalentKpiValidationError(
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
    throw new TalentKpiValidationError(
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
): TalentKpiRecordStatus | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new TalentKpiValidationError(
      `status must be one of ${TALENT_KPI_RECORD_STATUSES.join(", ")}`,
    );
  }

  const normalized = value.trim().toUpperCase();

  if (
    TALENT_KPI_RECORD_STATUSES.includes(
      normalized as TalentKpiRecordStatus,
    )
  ) {
    return normalized as TalentKpiRecordStatus;
  }

  throw new TalentKpiValidationError(
    `status must be one of ${TALENT_KPI_RECORD_STATUSES.join(", ")}`,
  );
}

function parseOptionalMeasurementSource(
  value: unknown,
): TalentKpiMeasurementSource | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new TalentKpiValidationError(
      `measurementSource must be one of ${TALENT_KPI_MEASUREMENT_SOURCES.join(", ")}`,
    );
  }

  const normalized = value.trim().toUpperCase();

  if (
    TALENT_KPI_MEASUREMENT_SOURCES.includes(
      normalized as TalentKpiMeasurementSource,
    )
  ) {
    return normalized as TalentKpiMeasurementSource;
  }

  throw new TalentKpiValidationError(
    `measurementSource must be one of ${TALENT_KPI_MEASUREMENT_SOURCES.join(", ")}`,
  );
}

function parseOptionalMetricCode(
  value: unknown,
): TalentKpiMetricCode | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new TalentKpiValidationError(
      `containsMetricCode must be one of ${TALENT_KPI_METRIC_CODES.join(", ")}`,
    );
  }

  const normalized = value.trim().toUpperCase();

  if (
    TALENT_KPI_METRIC_CODES.includes(
      normalized as TalentKpiMetricCode,
    )
  ) {
    return normalized as TalentKpiMetricCode;
  }

  throw new TalentKpiValidationError(
    `containsMetricCode must be one of ${TALENT_KPI_METRIC_CODES.join(", ")}`,
  );
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
    throw new TalentKpiValidationError(
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
    throw new TalentKpiValidationError(
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
    throw new TalentKpiValidationError(
      `${field} must be an integer`,
    );
  }

  if (!Number.isInteger(numeric)) {
    throw new TalentKpiValidationError(
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
    throw new TalentKpiValidationError(
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
    throw new TalentKpiValidationError(
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
): TalentKpiSortField | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new TalentKpiValidationError(
      `sortBy must be one of ${TALENT_KPI_SORT_FIELDS.join(", ")}`,
    );
  }

  const normalized = value.trim();

  if (
    TALENT_KPI_SORT_FIELDS.includes(
      normalized as TalentKpiSortField,
    )
  ) {
    return normalized as TalentKpiSortField;
  }

  throw new TalentKpiValidationError(
    `sortBy must be one of ${TALENT_KPI_SORT_FIELDS.join(", ")}`,
  );
}

function parseOptionalSortDirection(
  value: unknown,
): TalentKpiSortDirection | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new TalentKpiValidationError(
      `sortDirection must be one of ${TALENT_KPI_SORT_DIRECTIONS.join(", ")}`,
    );
  }

  const normalized = value.trim().toUpperCase();

  if (
    TALENT_KPI_SORT_DIRECTIONS.includes(
      normalized as TalentKpiSortDirection,
    )
  ) {
    return normalized as TalentKpiSortDirection;
  }

  throw new TalentKpiValidationError(
    `sortDirection must be one of ${TALENT_KPI_SORT_DIRECTIONS.join(", ")}`,
  );
}

function assertGlobalScope(
  actor: Actor,
  message: string,
): void {
  if (
    PermissionGuard.hasTalentKpiScopeGrant(
      actor,
      "global",
    )
  ) {
    return;
  }

  throw new TalentKpiPermissionScopeError(message);
}

function assertAdminActorType(
  actor: Actor,
): void {
  PermissionGuard.assertAdminActor(actor);
}
