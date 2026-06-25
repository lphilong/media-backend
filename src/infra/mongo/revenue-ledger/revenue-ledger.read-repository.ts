import {
  Collection,
  Db,
} from "mongodb";
import { BaseRepository } from "@infra/database/repository/base.repository";
import { SystemInvariantError } from "@core/error/system-error";
import { RevenueLedgerValidationError } from "@modules/revenue-ledger/domain/revenue-ledger.errors";
import {
  RevenueEntryByEventListItemView,
  RevenueEntryByPlatformListItemView,
  RevenueEntryByTalentListItemView,
  RevenueEntryDetailView,
  RevenueEntryListItemView,
  RevenueEntrySortDirection,
  RevenueEntrySortField,
  RevenueEntrySource,
  RevenueEntryStatus,
  RevenueKind,
} from "@modules/revenue-ledger/domain/revenue-ledger.types";
import {
  RevenueEntryByEventListReadInput,
  RevenueEntryByEventListReadResult,
  RevenueEntryByPlatformListReadInput,
  RevenueEntryByPlatformListReadResult,
  RevenueEntryByTalentListReadInput,
  RevenueEntryByTalentListReadResult,
  RevenueEntryListReadInput,
  RevenueEntryListReadResult,
  RevenueLedgerReadRepository,
} from "@modules/revenue-ledger/read/revenue-ledger.read-repository";
import { ReferenceSummary } from "@modules/reference-summary";

interface RevenueEntryReadDocument {
  readonly _id: string;
  readonly revenueEntryCode: string;
  readonly title: string;
  readonly normalizedTitle: string;
  readonly subjectTalentId: string;
  readonly attributionPlatformAccountId: string | null;
  readonly attributionTalentGroupId?: string | null;
  readonly attributionEmploymentProfileId?: string | null;
  readonly attributionEventId: string | null;
  readonly revenueKind: RevenueKind;
  readonly entrySource: RevenueEntrySource;
  readonly sourceBatchIds?: readonly string[];
  readonly sourceSummaryRef?: string | null;
  readonly sourceLineCount?: number | null;
  readonly sourceSummarySnapshot?: RevenueEntryDetailView["sourceSummarySnapshot"];
  readonly conversionSnapshot?: RevenueEntryDetailView["conversionSnapshot"];
  readonly platformCutSnapshot?: RevenueEntryDetailView["platformCutSnapshot"];
  readonly commissionableBasisSnapshot?: RevenueEntryDetailView["commissionableBasisSnapshot"];
  readonly status: RevenueEntryStatus;
  readonly currencyCode: string;
  readonly recognizedAmount: number;
  readonly recognizedAt: number;
  readonly finalizedAt: number | null;
  readonly reconciledAt: number | null;
  readonly voidedAt: number | null;
  readonly reconciliationReference: string | null;
  readonly description: string | null;
  readonly externalRef: string | null;
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
      readonly field: RevenueEntrySortField;
      readonly direction: RevenueEntrySortDirection;
    };

type EncodedCursor =
  | {
      readonly kind: "default";
      readonly queryShapeSignature: string;
      readonly recognizedAt: number;
      readonly id: string;
    }
  | {
      readonly kind: "field";
      readonly queryShapeSignature: string;
      readonly field: RevenueEntrySortField;
      readonly direction: RevenueEntrySortDirection;
      readonly value: string | number;
      readonly id: string;
    };

interface PageResult {
  readonly items: readonly RevenueEntryReadDocument[];
  readonly nextCursor?: string;
}

export class NativeMongoRevenueLedgerReadRepository
  extends BaseRepository<RevenueEntryReadDocument>
  implements RevenueLedgerReadRepository
{
  private readonly talentCollection: Collection<TalentReferenceReadDocument>;
  private readonly platformAccountCollection: Collection<PlatformAccountReferenceReadDocument>;
  private readonly eventCollection: Collection<EventReferenceReadDocument>;

  constructor(db: Db) {
    super(db, "revenue_entries");
    this.talentCollection =
      db.collection<TalentReferenceReadDocument>("talents");
    this.platformAccountCollection =
      db.collection<PlatformAccountReferenceReadDocument>(
        "platform_accounts",
      );
    this.eventCollection =
      db.collection<EventReferenceReadDocument>("events");
  }

  async listRevenueEntries(
    input: RevenueEntryListReadInput,
  ): Promise<RevenueEntryListReadResult> {
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
        applyRevenueKindFilter(
          filters,
          input.revenueKind,
        );
        applyEntrySourceFilter(
          filters,
          input.entrySource,
        );
        applyCurrencyCodeFilter(
          filters,
          input.currencyCode,
        );
        applyFinancePeriodFilter(filters, {
          financePeriodStartAt:
            input.financePeriodStartAt,
          financePeriodEndAt:
            input.financePeriodEndAt,
        });
        applyWindowFilter(filters, {
          windowStartAt: input.windowStartAt,
          windowEndAt: input.windowEndAt,
        });
        applyCreatedBeforeFilter(
          filters,
          input.createdBeforeAt,
        );
        applyTimestampRangeFilter(filters, "finalizedAt", {
          fromAt: input.finalizedFromAt,
          toAt: input.finalizedToAt,
        });
        applyTimestampRangeFilter(filters, "reconciledAt", {
          fromAt: input.reconciledFromAt,
          toAt: input.reconciledToAt,
        });
        applySearchFilter(filters, input.search);
      },
    );

    const items = page.items.map(
      toRevenueEntryListItemView,
    );

    return {
      items: await enrichRevenueEntryReferenceSummaries(
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

  async listRevenueEntriesByTalent(
    input: RevenueEntryByTalentListReadInput,
  ): Promise<RevenueEntryByTalentListReadResult> {
    const page = await this.listDocuments(
      "by-talent",
      input,
      async (filters) => {
        applyStatusFilter(filters, input.status);
        applySubjectTalentFilter(
          filters,
          input.subjectTalentId,
        );
        applyFinancePeriodFilter(filters, {
          financePeriodStartAt:
            input.financePeriodStartAt,
          financePeriodEndAt:
            input.financePeriodEndAt,
        });
        applyWindowFilter(filters, {
          windowStartAt: input.windowStartAt,
          windowEndAt: input.windowEndAt,
        });
      },
    );

    return {
      items: page.items.map(
        toRevenueEntryByTalentListItemView,
      ),
      nextCursor: page.nextCursor,
    };
  }

  async listRevenueEntriesByPlatform(
    input: RevenueEntryByPlatformListReadInput,
  ): Promise<RevenueEntryByPlatformListReadResult> {
    const page = await this.listDocuments(
      "by-platform",
      input,
      async (filters) => {
        applyStatusFilter(filters, input.status);
        applyPlatformAttributionFilter(
          filters,
          input.attributionPlatformAccountId,
        );
        applyFinancePeriodFilter(filters, {
          financePeriodStartAt:
            input.financePeriodStartAt,
          financePeriodEndAt:
            input.financePeriodEndAt,
        });
        applyWindowFilter(filters, {
          windowStartAt: input.windowStartAt,
          windowEndAt: input.windowEndAt,
        });
      },
    );

    return {
      items: page.items.map(
        toRevenueEntryByPlatformListItemView,
      ),
      nextCursor: page.nextCursor,
    };
  }

  async listRevenueEntriesByEvent(
    input: RevenueEntryByEventListReadInput,
  ): Promise<RevenueEntryByEventListReadResult> {
    const page = await this.listDocuments(
      "by-event",
      input,
      async (filters) => {
        applyStatusFilter(filters, input.status);
        applyEventAttributionFilter(
          filters,
          input.attributionEventId,
        );
        applyFinancePeriodFilter(filters, {
          financePeriodStartAt:
            input.financePeriodStartAt,
          financePeriodEndAt:
            input.financePeriodEndAt,
        });
        applyWindowFilter(filters, {
          windowStartAt: input.windowStartAt,
          windowEndAt: input.windowEndAt,
        });
      },
    );

    return {
      items: page.items.map(
        toRevenueEntryByEventListItemView,
      ),
      nextCursor: page.nextCursor,
    };
  }

  async getRevenueEntryDetail(
    revenueEntryId: string,
  ): Promise<RevenueEntryDetailView | null> {
    const document = await this.collection.findOne({
      _id: revenueEntryId,
    });

    if (!document) {
      return null;
    }

    const [detail] =
      await enrichRevenueEntryReferenceSummaries(
        [toRevenueEntryDetailView(document)],
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
    readonly sortField?: RevenueEntrySortField;
    readonly sortDirection?: RevenueEntrySortDirection;
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

async function enrichRevenueEntryReferenceSummaries<
  T extends
    | RevenueEntryListItemView
    | RevenueEntryDetailView,
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
  status: RevenueEntryStatus | undefined,
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

function applyRevenueKindFilter(
  filters: Array<Record<string, unknown>>,
  revenueKind: RevenueKind | undefined,
): void {
  if (!revenueKind) {
    return;
  }

  filters.push({
    revenueKind,
  });
}

function applyEntrySourceFilter(
  filters: Array<Record<string, unknown>>,
  entrySource: RevenueEntrySource | undefined,
): void {
  if (!entrySource) {
    return;
  }

  filters.push({
    entrySource,
  });
}

function applyCurrencyCodeFilter(
  filters: Array<Record<string, unknown>>,
  currencyCode: string | undefined,
): void {
  if (!currencyCode) {
    return;
  }

  filters.push({
    currencyCode,
  });
}

function applyFinancePeriodFilter(
  filters: Array<Record<string, unknown>>,
  input: {
    readonly financePeriodStartAt?: number;
    readonly financePeriodEndAt?: number;
  },
): void {
  if (
    input.financePeriodStartAt === undefined ||
    input.financePeriodEndAt === undefined
  ) {
    return;
  }

  filters.push({
    recognizedAt: {
      $gte: input.financePeriodStartAt,
      $lt: input.financePeriodEndAt,
    },
  });
}

function applyWindowFilter(
  filters: Array<Record<string, unknown>>,
  input: {
    readonly windowStartAt?: number;
    readonly windowEndAt?: number;
  },
): void {
  if (input.windowStartAt !== undefined) {
    filters.push({
      recognizedAt: {
        $gte: input.windowStartAt,
      },
    });
  }

  if (input.windowEndAt !== undefined) {
    filters.push({
      recognizedAt: {
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
  field: "finalizedAt" | "reconciledAt",
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
        revenueEntryCode: {
          $regex: `^${escapeRegex(search)}$`,
          $options: "i",
        },
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

function escapeRegex(value: string): string {
  return value.replace(
    /[.*+?^${}()|[\]\\]/gu,
    "\\$&",
  );
}

function toRevenueEntryDetailView(
  input: RevenueEntryReadDocument,
): RevenueEntryDetailView {
  return {
    id: input._id,
    revenueEntryCode: input.revenueEntryCode,
    title: input.title,
    subjectTalentId: input.subjectTalentId,
    attributionPlatformAccountId:
      input.attributionPlatformAccountId,
    attributionTalentGroupId:
      input.attributionTalentGroupId ?? null,
    attributionEmploymentProfileId:
      input.attributionEmploymentProfileId ?? null,
    attributionEventId: input.attributionEventId,
    revenueKind: input.revenueKind,
    entrySource: input.entrySource,
    sourceBatchIds: input.sourceBatchIds ?? [],
    sourceSummaryRef:
      input.sourceSummaryRef ?? null,
    sourceLineCount:
      input.sourceLineCount ?? null,
    sourceSummarySnapshot:
      input.sourceSummarySnapshot ?? null,
    conversionSnapshot:
      input.conversionSnapshot ?? null,
    platformCutSnapshot:
      input.platformCutSnapshot ?? null,
    commissionableBasisSnapshot:
      input.commissionableBasisSnapshot ?? null,
    status: input.status,
    currencyCode: input.currencyCode,
    recognizedAmount: input.recognizedAmount,
    recognizedAt: input.recognizedAt,
    finalizedAt: input.finalizedAt,
    reconciledAt: input.reconciledAt,
    voidedAt: input.voidedAt,
    reconciliationReference:
      input.reconciliationReference,
    description: input.description,
    externalRef: input.externalRef,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

function toRevenueEntryListItemView(
  input: RevenueEntryReadDocument,
): RevenueEntryListItemView {
  return {
    id: input._id,
    revenueEntryCode: input.revenueEntryCode,
    title: input.title,
    subjectTalentId: input.subjectTalentId,
    attributionPlatformAccountId:
      input.attributionPlatformAccountId,
    attributionTalentGroupId:
      input.attributionTalentGroupId ?? null,
    attributionEmploymentProfileId:
      input.attributionEmploymentProfileId ?? null,
    attributionEventId: input.attributionEventId,
    revenueKind: input.revenueKind,
    entrySource: input.entrySource,
    sourceBatchIds: input.sourceBatchIds ?? [],
    sourceSummaryRef:
      input.sourceSummaryRef ?? null,
    sourceLineCount:
      input.sourceLineCount ?? null,
    status: input.status,
    currencyCode: input.currencyCode,
    recognizedAmount: input.recognizedAmount,
    recognizedAt: input.recognizedAt,
    createdAt: input.createdAt,
  };
}

function toRevenueEntryByTalentListItemView(
  input: RevenueEntryReadDocument,
): RevenueEntryByTalentListItemView {
  return {
    id: input._id,
    revenueEntryCode: input.revenueEntryCode,
    title: input.title,
    subjectTalentId: input.subjectTalentId,
    revenueKind: input.revenueKind,
    status: input.status,
    currencyCode: input.currencyCode,
    recognizedAmount: input.recognizedAmount,
    recognizedAt: input.recognizedAt,
  };
}

function toRevenueEntryByPlatformListItemView(
  input: RevenueEntryReadDocument,
): RevenueEntryByPlatformListItemView {
  return {
    id: input._id,
    revenueEntryCode: input.revenueEntryCode,
    title: input.title,
    subjectTalentId: input.subjectTalentId,
    attributionPlatformAccountId:
      requireAttributionId(
        input.attributionPlatformAccountId,
        "attributionPlatformAccountId",
        input._id,
      ),
    revenueKind: input.revenueKind,
    status: input.status,
    currencyCode: input.currencyCode,
    recognizedAmount: input.recognizedAmount,
    recognizedAt: input.recognizedAt,
  };
}

function toRevenueEntryByEventListItemView(
  input: RevenueEntryReadDocument,
): RevenueEntryByEventListItemView {
  return {
    id: input._id,
    revenueEntryCode: input.revenueEntryCode,
    title: input.title,
    subjectTalentId: input.subjectTalentId,
    attributionEventId: requireAttributionId(
      input.attributionEventId,
      "attributionEventId",
      input._id,
    ),
    revenueKind: input.revenueKind,
    status: input.status,
    currencyCode: input.currencyCode,
    recognizedAmount: input.recognizedAmount,
    recognizedAt: input.recognizedAt,
  };
}

function requireAttributionId(
  value: string | null,
  field:
    | "attributionPlatformAccountId"
    | "attributionEventId",
  revenueEntryId: string,
): string {
  if (typeof value === "string" && value.trim()) {
    return value;
  }

  throw new SystemInvariantError(
    "SYSTEM_INVARIANT_VIOLATION",
    `Revenue entry ${revenueEntryId} is missing required ${field} for specialized listing projection`,
  );
}

function toSortSpec(
  input: Pick<
    RevenueEntryListReadInput,
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
      recognizedAt: -1,
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
  document: RevenueEntryReadDocument,
  queryShapeSignature: string,
): EncodedCursor {
  if (spec.kind === "default") {
    return {
      kind: "default",
      queryShapeSignature,
      recognizedAt: document.recognizedAt,
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
          recognizedAt: {
            $lt: cursor.recognizedAt,
          },
        },
        {
          recognizedAt: cursor.recognizedAt,
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
      typeof candidate.recognizedAt !== "number" ||
      !Number.isInteger(candidate.recognizedAt) ||
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
      recognizedAt: candidate.recognizedAt,
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

  if (expectedSpec.field === "revenueEntryCode") {
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
      const typed = input as RevenueEntryListReadInput;

      return JSON.stringify({
        view,
        status: typed.status ?? null,
        subjectTalentId: typed.subjectTalentId ?? null,
        attributionPlatformAccountId:
          typed.attributionPlatformAccountId ??
          null,
        attributionEventId:
          typed.attributionEventId ?? null,
        revenueKind: typed.revenueKind ?? null,
        entrySource: typed.entrySource ?? null,
        currencyCode: typed.currencyCode ?? null,
        financePeriod: typed.financePeriod ?? null,
        windowStartAt: typed.windowStartAt ?? null,
        windowEndAt: typed.windowEndAt ?? null,
        createdBeforeAt: typed.createdBeforeAt ?? null,
        finalizedFromAt: typed.finalizedFromAt ?? null,
        finalizedToAt: typed.finalizedToAt ?? null,
        reconciledFromAt: typed.reconciledFromAt ?? null,
        reconciledToAt: typed.reconciledToAt ?? null,
        search: typed.search ?? null,
        sortSpec,
      });
    }

    case "by-talent": {
      const typed =
        input as RevenueEntryByTalentListReadInput;

      return JSON.stringify({
        view,
        subjectTalentId: typed.subjectTalentId,
        status: typed.status ?? null,
        financePeriod: typed.financePeriod ?? null,
        windowStartAt: typed.windowStartAt ?? null,
        windowEndAt: typed.windowEndAt ?? null,
        sortSpec,
      });
    }

    case "by-platform": {
      const typed =
        input as RevenueEntryByPlatformListReadInput;

      return JSON.stringify({
        view,
        attributionPlatformAccountId:
          typed.attributionPlatformAccountId,
        status: typed.status ?? null,
        financePeriod: typed.financePeriod ?? null,
        windowStartAt: typed.windowStartAt ?? null,
        windowEndAt: typed.windowEndAt ?? null,
        sortSpec,
      });
    }

    case "by-event": {
      const typed =
        input as RevenueEntryByEventListReadInput;

      return JSON.stringify({
        view,
        attributionEventId: typed.attributionEventId,
        status: typed.status ?? null,
        financePeriod: typed.financePeriod ?? null,
        windowStartAt: typed.windowStartAt ?? null,
        windowEndAt: typed.windowEndAt ?? null,
        sortSpec,
      });
    }
  }
}

function readSortFieldValue(
  document: RevenueEntryReadDocument,
  field: RevenueEntrySortField,
): string | number {
  switch (field) {
    case "recognizedAt":
      return document.recognizedAt;

    case "revenueEntryCode":
      return document.revenueEntryCode;

    case "createdAt":
      return document.createdAt;
  }
}

function toDirectionValue(
  direction: RevenueEntrySortDirection,
): 1 | -1 {
  return direction === "ASC" ? 1 : -1;
}

function invalidCursorError(): RevenueLedgerValidationError {
  return new RevenueLedgerValidationError(
    "cursor is invalid",
  );
}
