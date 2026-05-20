import {
  Collection,
  Db,
} from "mongodb";
import { BaseRepository } from "@infra/database/repository/base.repository";
import { SystemInvariantError } from "@core/error/system-error";
import { TalentKpiValidationError } from "@modules/talent-kpi/domain/talent-kpi.errors";
import {
  TalentKpiByEventListItemView,
  TalentKpiByPlatformListItemView,
  TalentKpiByTalentListItemView,
  TalentKpiMeasurementSource,
  TalentKpiMetricCode,
  TalentKpiMetricValueListItemView,
  TalentKpiRecordDetailView,
  TalentKpiRecordListItemView,
  TalentKpiRecordStatus,
  TalentKpiSortDirection,
  TalentKpiSortField,
} from "@modules/talent-kpi/domain/talent-kpi.types";
import {
  TalentKpiByEventListReadInput,
  TalentKpiByEventListReadResult,
  TalentKpiByPlatformListReadInput,
  TalentKpiByPlatformListReadResult,
  TalentKpiByTalentListReadInput,
  TalentKpiByTalentListReadResult,
  TalentKpiReadRepository,
  TalentKpiRecordListReadInput,
  TalentKpiRecordListReadResult,
} from "@modules/talent-kpi/read/talent-kpi.read-repository";
import { ReferenceSummary } from "@modules/reference-summary";

interface TalentKpiRecordReadDocument {
  readonly _id: string;
  readonly kpiRecordCode: string;
  readonly normalizedKpiRecordCode: string;
  readonly title: string;
  readonly normalizedTitle: string;
  readonly subjectTalentId: string;
  readonly attributionPlatformAccountId: string | null;
  readonly attributionEventId: string | null;
  readonly measurementSource: TalentKpiMeasurementSource;
  readonly status: TalentKpiRecordStatus;
  readonly periodStartAt: number;
  readonly periodEndAt: number;
  readonly publishedAt: number | null;
  readonly description: string | null;
  readonly externalRef: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

interface TalentKpiMetricValueReadDocument {
  readonly _id: string;
  readonly kpiRecordId: string;
  readonly metricCode: TalentKpiMetricCode;
  readonly numericValue: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

interface TalentReferenceReadDocument {
  readonly _id: string;
  readonly talentCode: string;
  readonly stageName: string;
  readonly legalName: string;
  readonly displayShortName: string | null;
  readonly operationalStatus: string;
}

interface PlatformAccountReferenceReadDocument {
  readonly _id: string;
  readonly accountCode: string;
  readonly platform: string;
  readonly displayName: string;
  readonly handle: string | null;
  readonly operationalStatus: string;
}

interface EventReferenceReadDocument {
  readonly _id: string;
  readonly eventCode: string;
  readonly title: string;
  readonly status: string;
}

type ReadViewKind =
  | "list"
  | "by-talent"
  | "by-platform"
  | "by-event";

type SortSpec =
  | {
      readonly kind: "default";
    }
  | {
      readonly kind: "field";
      readonly field: TalentKpiSortField;
      readonly direction: TalentKpiSortDirection;
    };

type EncodedCursor =
  | {
      readonly kind: "default";
      readonly queryShapeSignature: string;
      readonly periodStartAt: number;
      readonly id: string;
    }
  | {
      readonly kind: "field";
      readonly queryShapeSignature: string;
      readonly field: TalentKpiSortField;
      readonly direction: TalentKpiSortDirection;
      readonly value: string | number;
      readonly id: string;
    };

interface PageResult {
  readonly items: readonly TalentKpiRecordReadDocument[];
  readonly nextCursor?: string;
}

export class NativeMongoTalentKpiReadRepository
  extends BaseRepository<TalentKpiRecordReadDocument>
  implements TalentKpiReadRepository
{
  private readonly metricCollection: Collection<TalentKpiMetricValueReadDocument>;
  private readonly talentCollection: Collection<TalentReferenceReadDocument>;
  private readonly platformAccountCollection: Collection<PlatformAccountReferenceReadDocument>;
  private readonly eventCollection: Collection<EventReferenceReadDocument>;

  constructor(db: Db) {
    super(db, "talent_kpi_records");
    this.metricCollection =
      db.collection<TalentKpiMetricValueReadDocument>(
        "talent_kpi_metric_values",
      );
    this.talentCollection =
      db.collection<TalentReferenceReadDocument>("talents");
    this.platformAccountCollection =
      db.collection<PlatformAccountReferenceReadDocument>(
        "platform_accounts",
      );
    this.eventCollection =
      db.collection<EventReferenceReadDocument>("events");
  }

  async listTalentKpiRecords(
    input: TalentKpiRecordListReadInput,
  ): Promise<TalentKpiRecordListReadResult> {
    const page = await this.listDocuments(
      "list",
      input,
      async (filters) => {
        applyStatusFilter(filters, input.status);
        applySubjectTalentFilter(
          filters,
          input.subjectTalentId,
        );
        applyPlatformAttributionFilter(
          filters,
          input.attributionPlatformAccountId,
        );
        applyEventAttributionFilter(
          filters,
          input.attributionEventId,
        );
        applyMeasurementSourceFilter(
          filters,
          input.measurementSource,
        );
        await applyContainsMetricCodeFilter(
          filters,
          input.containsMetricCode,
          this.metricCollection,
        );
        applyWindowIntersectionFilter(filters, {
          windowStartAt: input.windowStartAt,
          windowEndAt: input.windowEndAt,
        });
        applyCreatedBeforeFilter(
          filters,
          input.createdBeforeAt,
        );
        applyTimestampRangeFilter(filters, "publishedAt", {
          fromAt: input.publishedFromAt,
          toAt: input.publishedToAt,
        });
        applySearchFilter(filters, input.search);
      },
    );

    const items = page.items.map(
      toTalentKpiRecordListItemView,
    );

    return {
      items: await enrichTalentKpiReferenceSummaries(
        items,
        {
          talentCollection: this.talentCollection,
          platformAccountCollection:
            this.platformAccountCollection,
          eventCollection: this.eventCollection,
        },
      ),
      nextCursor: page.nextCursor,
    };
  }

  async listTalentKpiRecordsByTalent(
    input: TalentKpiByTalentListReadInput,
  ): Promise<TalentKpiByTalentListReadResult> {
    const page = await this.listDocuments(
      "by-talent",
      input,
      async (filters) => {
        applyStatusFilter(filters, input.status);
        applySubjectTalentFilter(
          filters,
          input.subjectTalentId,
        );
        applyWindowIntersectionFilter(filters, {
          windowStartAt: input.windowStartAt,
          windowEndAt: input.windowEndAt,
        });
      },
    );

    return {
      items: page.items.map(
        toTalentKpiByTalentListItemView,
      ),
      nextCursor: page.nextCursor,
    };
  }

  async listTalentKpiRecordsByPlatform(
    input: TalentKpiByPlatformListReadInput,
  ): Promise<TalentKpiByPlatformListReadResult> {
    const page = await this.listDocuments(
      "by-platform",
      input,
      async (filters) => {
        applyStatusFilter(filters, input.status);
        applyPlatformAttributionFilter(
          filters,
          input.attributionPlatformAccountId,
        );
        applyWindowIntersectionFilter(filters, {
          windowStartAt: input.windowStartAt,
          windowEndAt: input.windowEndAt,
        });
      },
    );

    return {
      items: page.items.map(
        toTalentKpiByPlatformListItemView,
      ),
      nextCursor: page.nextCursor,
    };
  }

  async listTalentKpiRecordsByEvent(
    input: TalentKpiByEventListReadInput,
  ): Promise<TalentKpiByEventListReadResult> {
    const page = await this.listDocuments(
      "by-event",
      input,
      async (filters) => {
        applyStatusFilter(filters, input.status);
        applyEventAttributionFilter(
          filters,
          input.attributionEventId,
        );
        applyWindowIntersectionFilter(filters, {
          windowStartAt: input.windowStartAt,
          windowEndAt: input.windowEndAt,
        });
      },
    );

    return {
      items: page.items.map(
        toTalentKpiByEventListItemView,
      ),
      nextCursor: page.nextCursor,
    };
  }

  async listMetricValuesForRecord(
    talentKpiRecordId: string,
  ): Promise<
    readonly TalentKpiMetricValueListItemView[]
  > {
    const documents = await this.metricCollection
      .find({
        kpiRecordId: talentKpiRecordId,
      })
      .sort({
        metricCode: 1,
        _id: 1,
      })
      .toArray();

    return documents.map((document) => ({
      id: document._id,
      metricCode: document.metricCode,
      numericValue: document.numericValue,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    }));
  }

  async getTalentKpiRecordDetail(
    talentKpiRecordId: string,
  ): Promise<TalentKpiRecordDetailView | null> {
    const document = await this.collection.findOne({
      _id: talentKpiRecordId,
    });

    if (!document) {
      return null;
    }

    const [detail] =
      await enrichTalentKpiReferenceSummaries(
        [toTalentKpiRecordDetailView(document)],
        {
          talentCollection: this.talentCollection,
          platformAccountCollection:
            this.platformAccountCollection,
          eventCollection: this.eventCollection,
        },
      );

    return detail ?? null;
  }

  private async listDocuments<TInput extends {
    readonly limit: number;
    readonly cursor?: string;
    readonly sortField?: TalentKpiSortField;
    readonly sortDirection?: TalentKpiSortDirection;
  }>(
    view: ReadViewKind,
    input: TInput,
    buildFilters: (
      filters: Array<Record<string, unknown>>,
    ) => Promise<void>,
  ): Promise<PageResult> {
    const sortSpec = toSortSpec(input);
    const queryShapeSignature =
      buildCursorQueryShapeSignature(
        view,
        input,
        sortSpec,
      );
    const cursor =
      input.cursor === undefined
        ? undefined
        : decodeCursor(
            input.cursor,
            sortSpec,
            queryShapeSignature,
          );
    const queryFilters: Array<Record<string, unknown>> =
      [];

    await buildFilters(queryFilters);

    if (cursor) {
      queryFilters.push(
        buildPageAfterFilter(sortSpec, cursor),
      );
    }

    const documents = await this.collection
      .find(buildQuery(queryFilters))
      .sort(toSortDocument(sortSpec))
      .limit(input.limit + 1)
      .toArray();
    const hasNext = documents.length > input.limit;
    const page = hasNext
      ? documents.slice(0, input.limit)
      : documents;

    return {
      items: page,
      nextCursor:
        hasNext && page.length > 0
          ? encodeCursor(
              buildCursorFromDocument(
                sortSpec,
                page[page.length - 1],
                queryShapeSignature,
              ),
            )
          : undefined,
    };
  }
}

async function enrichTalentKpiReferenceSummaries<
  T extends
    | TalentKpiRecordListItemView
    | TalentKpiRecordDetailView,
>(
  items: readonly T[],
  collections: {
    readonly talentCollection: Collection<TalentReferenceReadDocument>;
    readonly platformAccountCollection: Collection<PlatformAccountReferenceReadDocument>;
    readonly eventCollection: Collection<EventReferenceReadDocument>;
  },
): Promise<readonly T[]> {
  if (items.length === 0) {
    return items;
  }

  const talentIds = new Set<string>();
  const platformAccountIds = new Set<string>();
  const eventIds = new Set<string>();

  for (const item of items) {
    talentIds.add(item.subjectTalentId);
    addOptionalReferenceId(
      platformAccountIds,
      item.attributionPlatformAccountId,
    );
    addOptionalReferenceId(
      eventIds,
      item.attributionEventId,
    );
  }

  const [talentRefMap, platformRefMap, eventRefMap] =
    await Promise.all([
      loadTalentReferenceSummaries(
        talentIds,
        collections.talentCollection,
      ),
      loadPlatformAccountReferenceSummaries(
        platformAccountIds,
        collections.platformAccountCollection,
      ),
      loadEventReferenceSummaries(
        eventIds,
        collections.eventCollection,
      ),
    ]);

  return items.map((item) => ({
    ...item,
    subjectTalentRef:
      talentRefMap.get(item.subjectTalentId) ?? null,
    attributionPlatformAccountRef:
      item.attributionPlatformAccountId
        ? platformRefMap.get(
            item.attributionPlatformAccountId,
          ) ?? null
        : null,
    attributionEventRef: item.attributionEventId
      ? eventRefMap.get(item.attributionEventId) ?? null
      : null,
  }));
}

function addOptionalReferenceId(
  ids: Set<string>,
  value: string | null,
): void {
  if (typeof value !== "string") {
    return;
  }

  const normalized = value.trim();

  if (normalized) {
    ids.add(normalized);
  }
}

async function loadTalentReferenceSummaries(
  ids: ReadonlySet<string>,
  collection: Collection<TalentReferenceReadDocument>,
): Promise<Map<string, ReferenceSummary>> {
  if (ids.size === 0) {
    return new Map();
  }

  const documents = await collection
    .find(
      {
        _id: {
          $in: [...ids],
        },
      },
      {
        projection: {
          _id: 1,
          talentCode: 1,
          stageName: 1,
          legalName: 1,
          displayShortName: 1,
          operationalStatus: 1,
        },
      },
    )
    .toArray();

  return new Map(
    documents.map((document) => [
      document._id,
      toTalentReferenceSummary(document),
    ]),
  );
}

async function loadPlatformAccountReferenceSummaries(
  ids: ReadonlySet<string>,
  collection: Collection<PlatformAccountReferenceReadDocument>,
): Promise<Map<string, ReferenceSummary>> {
  if (ids.size === 0) {
    return new Map();
  }

  const documents = await collection
    .find(
      {
        _id: {
          $in: [...ids],
        },
      },
      {
        projection: {
          _id: 1,
          accountCode: 1,
          platform: 1,
          displayName: 1,
          handle: 1,
          operationalStatus: 1,
        },
      },
    )
    .toArray();

  return new Map(
    documents.map((document) => [
      document._id,
      toPlatformAccountReferenceSummary(document),
    ]),
  );
}

async function loadEventReferenceSummaries(
  ids: ReadonlySet<string>,
  collection: Collection<EventReferenceReadDocument>,
): Promise<Map<string, ReferenceSummary>> {
  if (ids.size === 0) {
    return new Map();
  }

  const documents = await collection
    .find(
      {
        _id: {
          $in: [...ids],
        },
      },
      {
        projection: {
          _id: 1,
          eventCode: 1,
          title: 1,
          status: 1,
        },
      },
    )
    .toArray();

  return new Map(
    documents.map((document) => [
      document._id,
      toEventReferenceSummary(document),
    ]),
  );
}

function toTalentReferenceSummary(
  document: TalentReferenceReadDocument,
): ReferenceSummary {
  return {
    id: document._id,
    code: document.talentCode,
    name:
      document.displayShortName ??
      document.stageName ??
      document.legalName,
    status: document.operationalStatus,
  };
}

function toPlatformAccountReferenceSummary(
  document: PlatformAccountReferenceReadDocument,
): ReferenceSummary {
  return {
    id: document._id,
    code: document.accountCode,
    displayName: document.displayName,
    handle: document.handle ?? undefined,
    platform: document.platform,
    status: document.operationalStatus,
  };
}

function toEventReferenceSummary(
  document: EventReferenceReadDocument,
): ReferenceSummary {
  return {
    id: document._id,
    code: document.eventCode,
    title: document.title,
    status: document.status,
  };
}

function applyStatusFilter(
  filters: Array<Record<string, unknown>>,
  status: TalentKpiRecordStatus | undefined,
): void {
  if (status) {
    filters.push({
      status,
    });
    return;
  }

  filters.push({
    status: {
      $ne: "ARCHIVED",
    },
  });
}

function applySubjectTalentFilter(
  filters: Array<Record<string, unknown>>,
  subjectTalentId: string | undefined,
): void {
  if (!subjectTalentId) {
    return;
  }

  filters.push({
    subjectTalentId,
  });
}

function applyPlatformAttributionFilter(
  filters: Array<Record<string, unknown>>,
  attributionPlatformAccountId:
    | string
    | undefined,
): void {
  if (!attributionPlatformAccountId) {
    return;
  }

  filters.push({
    attributionPlatformAccountId,
  });
}

function applyEventAttributionFilter(
  filters: Array<Record<string, unknown>>,
  attributionEventId: string | undefined,
): void {
  if (!attributionEventId) {
    return;
  }

  filters.push({
    attributionEventId,
  });
}

function applyMeasurementSourceFilter(
  filters: Array<Record<string, unknown>>,
  measurementSource:
    | TalentKpiMeasurementSource
    | undefined,
): void {
  if (!measurementSource) {
    return;
  }

  filters.push({
    measurementSource,
  });
}

async function applyContainsMetricCodeFilter(
  filters: Array<Record<string, unknown>>,
  containsMetricCode:
    | TalentKpiMetricCode
    | undefined,
  metricCollection: Collection<TalentKpiMetricValueReadDocument>,
): Promise<void> {
  if (!containsMetricCode) {
    return;
  }

  const kpiRecordIds = await metricCollection.distinct(
    "kpiRecordId",
    {
      metricCode: containsMetricCode,
    },
  );

  if (kpiRecordIds.length === 0) {
    filters.push({
      _id: {
        $in: [],
      },
    });
    return;
  }

  filters.push({
    _id: {
      $in: [...kpiRecordIds],
    },
  });
}

function applyWindowIntersectionFilter(
  filters: Array<Record<string, unknown>>,
  input: {
    readonly windowStartAt?: number;
    readonly windowEndAt?: number;
  },
): void {
  if (input.windowStartAt !== undefined) {
    filters.push({
      periodEndAt: {
        $gt: input.windowStartAt,
      },
    });
  }

  if (input.windowEndAt !== undefined) {
    filters.push({
      periodStartAt: {
        $lt: input.windowEndAt,
      },
    });
  }
}

function applyCreatedBeforeFilter(
  filters: Array<Record<string, unknown>>,
  createdBeforeAt: number | undefined,
): void {
  if (createdBeforeAt === undefined) {
    return;
  }

  filters.push({
    createdAt: {
      $lt: createdBeforeAt,
    },
  });
}

function applyTimestampRangeFilter(
  filters: Array<Record<string, unknown>>,
  field: "publishedAt",
  input: {
    readonly fromAt?: number;
    readonly toAt?: number;
  },
): void {
  if (input.fromAt !== undefined) {
    filters.push({
      [field]: {
        $gte: input.fromAt,
      },
    });
  }

  if (input.toAt !== undefined) {
    filters.push({
      [field]: {
        $lt: input.toAt,
      },
    });
  }
}

function applySearchFilter(
  filters: Array<Record<string, unknown>>,
  search: string | undefined,
): void {
  if (!search) {
    return;
  }

  filters.push({
    $or: [
      {
        normalizedKpiRecordCode: search,
      },
      buildPrefixRange("normalizedTitle", search),
    ],
  });
}

function buildPrefixRange(
  field: string,
  prefix: string,
): Record<string, unknown> {
  return {
    [field]: {
      $gte: prefix,
      $lt: `${prefix}\uffff`,
    },
  };
}

function toTalentKpiRecordDetailView(
  input: TalentKpiRecordReadDocument,
): TalentKpiRecordDetailView {
  return {
    id: input._id,
    kpiRecordCode: input.kpiRecordCode,
    title: input.title,
    subjectTalentId: input.subjectTalentId,
    attributionPlatformAccountId:
      input.attributionPlatformAccountId,
    attributionEventId: input.attributionEventId,
    measurementSource: input.measurementSource,
    status: input.status,
    periodStartAt: input.periodStartAt,
    periodEndAt: input.periodEndAt,
    publishedAt: input.publishedAt,
    description: input.description,
    externalRef: input.externalRef,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

function toTalentKpiRecordListItemView(
  input: TalentKpiRecordReadDocument,
): TalentKpiRecordListItemView {
  return {
    id: input._id,
    kpiRecordCode: input.kpiRecordCode,
    title: input.title,
    subjectTalentId: input.subjectTalentId,
    attributionPlatformAccountId:
      input.attributionPlatformAccountId,
    attributionEventId: input.attributionEventId,
    measurementSource: input.measurementSource,
    status: input.status,
    periodStartAt: input.periodStartAt,
    periodEndAt: input.periodEndAt,
    publishedAt: input.publishedAt,
    createdAt: input.createdAt,
  };
}

function toTalentKpiByTalentListItemView(
  input: TalentKpiRecordReadDocument,
): TalentKpiByTalentListItemView {
  return {
    id: input._id,
    kpiRecordCode: input.kpiRecordCode,
    title: input.title,
    subjectTalentId: input.subjectTalentId,
    status: input.status,
    measurementSource: input.measurementSource,
    periodStartAt: input.periodStartAt,
    periodEndAt: input.periodEndAt,
    publishedAt: input.publishedAt,
  };
}

function toTalentKpiByPlatformListItemView(
  input: TalentKpiRecordReadDocument,
): TalentKpiByPlatformListItemView {
  return {
    id: input._id,
    kpiRecordCode: input.kpiRecordCode,
    title: input.title,
    subjectTalentId: input.subjectTalentId,
    attributionPlatformAccountId:
      requireAttributionId(
        input.attributionPlatformAccountId,
        "attributionPlatformAccountId",
        input._id,
      ),
    status: input.status,
    periodStartAt: input.periodStartAt,
    periodEndAt: input.periodEndAt,
  };
}

function toTalentKpiByEventListItemView(
  input: TalentKpiRecordReadDocument,
): TalentKpiByEventListItemView {
  return {
    id: input._id,
    kpiRecordCode: input.kpiRecordCode,
    title: input.title,
    subjectTalentId: input.subjectTalentId,
    attributionEventId: requireAttributionId(
      input.attributionEventId,
      "attributionEventId",
      input._id,
    ),
    status: input.status,
    periodStartAt: input.periodStartAt,
    periodEndAt: input.periodEndAt,
  };
}

function requireAttributionId(
  value: string | null,
  field: "attributionPlatformAccountId" | "attributionEventId",
  talentKpiRecordId: string,
): string {
  if (typeof value === "string" && value.trim()) {
    return value;
  }

  throw new SystemInvariantError(
    "SYSTEM_INVARIANT_VIOLATION",
    `Talent KPI record ${talentKpiRecordId} is missing required ${field} for specialized listing projection`,
  );
}

function toSortSpec(
  input: Pick<
    TalentKpiRecordListReadInput,
    "sortField" | "sortDirection"
  >,
): SortSpec {
  if (!input.sortField) {
    return {
      kind: "default",
    };
  }

  return {
    kind: "field",
    field: input.sortField,
    direction: input.sortDirection ?? "ASC",
  };
}

function toSortDocument(
  spec: SortSpec,
): Record<string, 1 | -1> {
  if (spec.kind === "default") {
    return {
      periodStartAt: -1,
      _id: 1,
    };
  }

  return {
    [spec.field]: toDirectionValue(spec.direction),
    _id: 1,
  };
}

function buildCursorFromDocument(
  spec: SortSpec,
  document: TalentKpiRecordReadDocument,
  queryShapeSignature: string,
): EncodedCursor {
  if (spec.kind === "default") {
    return {
      kind: "default",
      queryShapeSignature,
      periodStartAt: document.periodStartAt,
      id: document._id,
    };
  }

  return {
    kind: "field",
    queryShapeSignature,
    field: spec.field,
    direction: spec.direction,
    value: readSortFieldValue(
      document,
      spec.field,
    ),
    id: document._id,
  };
}

function buildQuery(
  filters: ReadonlyArray<Record<string, unknown>>,
): Record<string, unknown> {
  if (filters.length === 0) {
    return {};
  }

  if (filters.length === 1) {
    return filters[0] ?? {};
  }

  return {
    $and: [...filters],
  };
}

function buildPageAfterFilter(
  spec: SortSpec,
  cursor: EncodedCursor,
): Record<string, unknown> {
  if (spec.kind === "default") {
    if (cursor.kind !== "default") {
      throw invalidCursorError();
    }

    return {
      $or: [
        {
          periodStartAt: {
            $lt: cursor.periodStartAt,
          },
        },
        {
          periodStartAt: cursor.periodStartAt,
          _id: {
            $gt: cursor.id,
          },
        },
      ],
    };
  }

  if (
    cursor.kind !== "field" ||
    cursor.field !== spec.field ||
    cursor.direction !== spec.direction
  ) {
    throw invalidCursorError();
  }

  const comparisonOperator =
    spec.direction === "ASC" ? "$gt" : "$lt";

  return {
    $or: [
      {
        [spec.field]: {
          [comparisonOperator]:
            cursor.value,
        },
      },
      {
        [spec.field]: cursor.value,
        _id: {
          $gt: cursor.id,
        },
      },
    ],
  };
}

function encodeCursor(
  cursor: EncodedCursor,
): string {
  return Buffer.from(
    JSON.stringify(cursor),
    "utf8",
  ).toString("base64url");
}

function decodeCursor(
  cursor: string,
  expectedSpec: SortSpec,
  expectedQueryShapeSignature: string,
): EncodedCursor {
  const normalized = cursor.trim();

  if (!normalized) {
    throw invalidCursorError();
  }

  let decodedText: string;

  try {
    decodedText = Buffer.from(
      normalized,
      "base64url",
    ).toString("utf8");
  } catch {
    throw invalidCursorError();
  }

  let payload: unknown;

  try {
    payload = JSON.parse(decodedText);
  } catch {
    throw invalidCursorError();
  }

  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    throw invalidCursorError();
  }

  const candidate = payload as Record<string, unknown>;
  const queryShapeSignature =
    candidate.queryShapeSignature;

  if (
    typeof queryShapeSignature !== "string" ||
    queryShapeSignature !==
      expectedQueryShapeSignature
  ) {
    throw invalidCursorError();
  }

  if (expectedSpec.kind === "default") {
    if (
      candidate.kind !== "default" ||
      typeof candidate.periodStartAt !== "number" ||
      !Number.isInteger(candidate.periodStartAt) ||
      typeof candidate.id !== "string"
    ) {
      throw invalidCursorError();
    }

    const id = candidate.id.trim();

    if (!id) {
      throw invalidCursorError();
    }

    return {
      kind: "default",
      queryShapeSignature,
      periodStartAt: candidate.periodStartAt,
      id,
    };
  }

  if (
    candidate.kind !== "field" ||
    candidate.field !== expectedSpec.field ||
    candidate.direction !== expectedSpec.direction ||
    typeof candidate.id !== "string"
  ) {
    throw invalidCursorError();
  }

  const id = candidate.id.trim();

  if (!id) {
    throw invalidCursorError();
  }

  const value = candidate.value;

  if (expectedSpec.field === "kpiRecordCode") {
    if (typeof value !== "string") {
      throw invalidCursorError();
    }
  } else if (
    typeof value !== "number" ||
    !Number.isInteger(value)
  ) {
    throw invalidCursorError();
  }

  return {
    kind: "field",
    queryShapeSignature,
    field: expectedSpec.field,
    direction: expectedSpec.direction,
    value,
    id,
  };
}

function buildCursorQueryShapeSignature(
  view: ReadViewKind,
  input: unknown,
  sortSpec: SortSpec,
): string {
  switch (view) {
    case "list": {
      const typed = input as TalentKpiRecordListReadInput;

      return JSON.stringify({
        view,
        status: typed.status ?? null,
        subjectTalentId: typed.subjectTalentId ?? null,
        attributionPlatformAccountId:
          typed.attributionPlatformAccountId ??
          null,
        attributionEventId:
          typed.attributionEventId ?? null,
        measurementSource:
          typed.measurementSource ?? null,
        containsMetricCode:
          typed.containsMetricCode ?? null,
        windowStartAt: typed.windowStartAt ?? null,
        windowEndAt: typed.windowEndAt ?? null,
        createdBeforeAt: typed.createdBeforeAt ?? null,
        publishedFromAt: typed.publishedFromAt ?? null,
        publishedToAt: typed.publishedToAt ?? null,
        search: typed.search ?? null,
        sortSpec,
      });
    }

    case "by-talent": {
      const typed =
        input as TalentKpiByTalentListReadInput;

      return JSON.stringify({
        view,
        subjectTalentId: typed.subjectTalentId,
        status: typed.status ?? null,
        windowStartAt: typed.windowStartAt ?? null,
        windowEndAt: typed.windowEndAt ?? null,
        sortSpec,
      });
    }

    case "by-platform": {
      const typed =
        input as TalentKpiByPlatformListReadInput;

      return JSON.stringify({
        view,
        attributionPlatformAccountId:
          typed.attributionPlatformAccountId,
        status: typed.status ?? null,
        windowStartAt: typed.windowStartAt ?? null,
        windowEndAt: typed.windowEndAt ?? null,
        sortSpec,
      });
    }

    case "by-event": {
      const typed =
        input as TalentKpiByEventListReadInput;

      return JSON.stringify({
        view,
        attributionEventId:
          typed.attributionEventId,
        status: typed.status ?? null,
        windowStartAt: typed.windowStartAt ?? null,
        windowEndAt: typed.windowEndAt ?? null,
        sortSpec,
      });
    }
  }
}

function readSortFieldValue(
  document: TalentKpiRecordReadDocument,
  field: TalentKpiSortField,
): string | number {
  switch (field) {
    case "periodStartAt":
      return document.periodStartAt;

    case "kpiRecordCode":
      return document.kpiRecordCode;

    case "createdAt":
      return document.createdAt;
  }
}

function toDirectionValue(
  direction: TalentKpiSortDirection,
): 1 | -1 {
  return direction === "ASC" ? 1 : -1;
}

function invalidCursorError(): TalentKpiValidationError {
  return new TalentKpiValidationError(
    "cursor is invalid",
  );
}
