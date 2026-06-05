import { Collection, Db } from "mongodb";
import { BaseRepository } from "@infra/database/repository/base.repository";
import { ReferenceSummary } from "@modules/reference-summary";
import { WorkScheduleValidationError } from "@modules/work-schedule/domain/work-schedule.errors";
import {
  MONTHLY_ROSTER_STATUSES,
  MONTHLY_ROSTER_TARGET_ORG_UNIT_MODE,
  MONTHLY_ROSTER_TARGET_SUBJECT_KIND,
  MONTHLY_ROSTER_TIMEZONE,
  MonthlyRosterListItemView,
  MonthlyRosterStatus,
  MonthlyRosterTargetMode,
  MonthlyRosterTargetType,
  MonthlyRosterView,
  RosterExceptionRecord,
} from "@modules/work-schedule/domain/work-schedule.types";
import {
  MonthlyRosterListReadInput,
  MonthlyRosterListReadResult,
  MonthlyRosterReadRepository,
} from "@modules/work-schedule/read/work-schedule.read-repository";

interface MonthlyRosterReadDocument {
  readonly _id: string;
  readonly rosterCode: string;
  readonly normalizedRosterCode: string;
  readonly rosterMonth: string;
  readonly timezone: typeof MONTHLY_ROSTER_TIMEZONE;
  readonly targetSubjectKind: typeof MONTHLY_ROSTER_TARGET_SUBJECT_KIND;
  readonly targetOrgUnitMode: typeof MONTHLY_ROSTER_TARGET_ORG_UNIT_MODE;
  readonly targetType?: MonthlyRosterTargetType;
  readonly targetMode?: MonthlyRosterTargetMode;
  readonly targetOrgUnitId?: string | null;
  readonly targetTalentGroupId?: string | null;
  readonly departmentOrgUnitId?: string | null;
  readonly workPatternId: string;
  readonly holidayCalendarId: string;
  readonly status: MonthlyRosterStatus;
  readonly draftVersion: number;
  readonly previewHash: string | null;
  readonly lastPreviewedAt: number | null;
  readonly publishedAt: number | null;
  readonly publishedByUserId: string | null;
  readonly publishGenerationRunId: string | null;
  readonly description: string | null;
  readonly externalRef: string | null;
  readonly exceptions: readonly RosterExceptionRecord[];
  readonly archivedAt: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

interface OrgUnitReferenceReadDocument {
  readonly _id: string;
  readonly code: string;
  readonly name: string;
  readonly status: string;
}

interface TalentGroupReferenceReadDocument {
  readonly _id: string;
  readonly groupCode: string;
  readonly name: string;
  readonly status: string;
}

interface EmploymentProfileReferenceReadDocument {
  readonly _id: string;
  readonly employeeCode: string;
  readonly legalName: string;
  readonly displayName: string;
  readonly employmentStatus: string;
}

interface StudioResourceReferenceReadDocument {
  readonly _id: string;
  readonly resourceCode: string;
  readonly name: string;
  readonly operationalStatus: string;
}

interface WorkPatternReferenceReadDocument {
  readonly _id: string;
  readonly patternCode: string;
  readonly name: string;
  readonly status: string;
}

interface HolidayCalendarReferenceReadDocument {
  readonly _id: string;
  readonly calendarCode: string;
  readonly name: string;
  readonly status: string;
}

interface EncodedCursor {
  readonly queryShapeSignature: string;
  readonly createdAt: number;
  readonly monthlyRosterId: string;
}

export class NativeMongoMonthlyRosterReadRepository
  extends BaseRepository<MonthlyRosterReadDocument>
  implements MonthlyRosterReadRepository
{
  private readonly orgUnitCollection: Collection<OrgUnitReferenceReadDocument>;
  private readonly talentGroupCollection: Collection<TalentGroupReferenceReadDocument>;
  private readonly employmentProfileCollection: Collection<EmploymentProfileReferenceReadDocument>;
  private readonly studioResourceCollection: Collection<StudioResourceReferenceReadDocument>;
  private readonly workPatternCollection: Collection<WorkPatternReferenceReadDocument>;
  private readonly holidayCalendarCollection: Collection<HolidayCalendarReferenceReadDocument>;

  constructor(db: Db) {
    super(db, "work_monthly_rosters");
    this.orgUnitCollection =
      db.collection<OrgUnitReferenceReadDocument>(
        "org_units",
      );
    this.talentGroupCollection =
      db.collection<TalentGroupReferenceReadDocument>(
        "talent_groups",
      );
    this.employmentProfileCollection =
      db.collection<EmploymentProfileReferenceReadDocument>(
        "employment_profiles",
      );
    this.studioResourceCollection =
      db.collection<StudioResourceReferenceReadDocument>(
        "studio_resources",
      );
    this.workPatternCollection =
      db.collection<WorkPatternReferenceReadDocument>(
        "work_patterns",
      );
    this.holidayCalendarCollection =
      db.collection<HolidayCalendarReferenceReadDocument>(
        "work_holiday_calendars",
      );
  }

  async listMonthlyRosters(
    input: MonthlyRosterListReadInput,
  ): Promise<MonthlyRosterListReadResult> {
    const queryShapeSignature =
      buildCursorQueryShapeSignature(input);
    const cursor =
      input.cursor === undefined
        ? undefined
        : decodeCursor(
            input.cursor,
            queryShapeSignature,
          );
    const filters: Array<Record<string, unknown>> = [];

    applyStatusFilter(filters, input.status);
    applyEqualsFilter(
      filters,
      "rosterMonth",
      input.rosterMonth,
    );
    applyEqualsFilter(
      filters,
      "departmentOrgUnitId",
      input.departmentOrgUnitId,
    );
    applyEqualsFilter(
      filters,
      "targetType",
      input.targetType,
    );
    applyEqualsFilter(
      filters,
      "targetOrgUnitId",
      input.targetOrgUnitId,
    );
    applyEqualsFilter(
      filters,
      "targetTalentGroupId",
      input.targetTalentGroupId,
    );
    applyEqualsFilter(
      filters,
      "workPatternId",
      input.workPatternId,
    );
    applyEqualsFilter(
      filters,
      "holidayCalendarId",
      input.holidayCalendarId,
    );
    applySearchFilter(filters, input.search);

    if (cursor) {
      filters.push({
        $or: [
          {
            createdAt: {
              $gt: cursor.createdAt,
            },
          },
          {
            createdAt: cursor.createdAt,
            _id: {
              $gt: cursor.monthlyRosterId,
            },
          },
        ],
      });
    }

    const docs = await this.collection
      .find(buildQuery(filters))
      .sort({ createdAt: 1, _id: 1 })
      .limit(input.limit + 1)
      .toArray();
    const hasNext = docs.length > input.limit;
    const page = hasNext
      ? docs.slice(0, input.limit)
      : docs;

    const items =
      await enrichMonthlyRosterReferenceSummaries(
        page.map((document) =>
          toMonthlyRosterListItemView(document),
        ),
        {
          orgUnitCollection: this.orgUnitCollection,
          talentGroupCollection:
            this.talentGroupCollection,
          employmentProfileCollection:
            this.employmentProfileCollection,
          studioResourceCollection:
            this.studioResourceCollection,
          workPatternCollection:
            this.workPatternCollection,
          holidayCalendarCollection:
            this.holidayCalendarCollection,
        },
      );

    return {
      items,
      nextCursor:
        hasNext && page.length > 0
          ? encodeCursor({
              queryShapeSignature,
              createdAt: page[page.length - 1].createdAt,
              monthlyRosterId: page[page.length - 1]._id,
            })
          : undefined,
    };
  }

  async getMonthlyRosterDetail(
    monthlyRosterId: string,
  ): Promise<MonthlyRosterView | null> {
    const doc = await this.collection.findOne({
      _id: monthlyRosterId,
    });

    if (!doc) {
      return null;
    }

    const [detail] =
      await enrichMonthlyRosterReferenceSummaries(
        [toMonthlyRosterView(doc)],
        {
          orgUnitCollection: this.orgUnitCollection,
          talentGroupCollection:
            this.talentGroupCollection,
          employmentProfileCollection:
            this.employmentProfileCollection,
          studioResourceCollection:
            this.studioResourceCollection,
          workPatternCollection:
            this.workPatternCollection,
          holidayCalendarCollection:
            this.holidayCalendarCollection,
        },
      );

    return detail ?? null;
  }
}

function applyStatusFilter(
  filters: Array<Record<string, unknown>>,
  status: MonthlyRosterStatus | undefined,
): void {
  if (status) {
    filters.push({ status });
    return;
  }

  filters.push({
    status: {
      $ne: "ARCHIVED",
    },
  });
}

function applyEqualsFilter(
  filters: Array<Record<string, unknown>>,
  field: string,
  value: string | undefined,
): void {
  if (value !== undefined) {
    filters.push({ [field]: value });
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
    normalizedRosterCode: {
      $gte: search,
      $lt: `${search}\uffff`,
    },
  });
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

  return { $and: [...filters] };
}

function toMonthlyRosterListItemView(
  document: MonthlyRosterReadDocument,
): MonthlyRosterListItemView {
  const targetType = document.targetType ?? "ORG_UNIT";
  const targetMode =
    document.targetMode ?? document.targetOrgUnitMode;
  const targetOrgUnitId =
    document.targetOrgUnitId ??
    document.departmentOrgUnitId ??
    null;
  const targetTalentGroupId =
    document.targetTalentGroupId ?? null;
  const departmentOrgUnitId =
    document.departmentOrgUnitId ??
    (targetType === "ORG_UNIT" ? targetOrgUnitId : null);

  return {
    monthlyRosterId: document._id,
    rosterCode: document.rosterCode,
    rosterMonth: document.rosterMonth,
    timezone: document.timezone,
    targetSubjectKind: document.targetSubjectKind,
    targetOrgUnitMode: document.targetOrgUnitMode,
    targetType,
    targetMode,
    targetOrgUnitId,
    targetTalentGroupId,
    departmentOrgUnitId,
    workPatternId: document.workPatternId,
    holidayCalendarId: document.holidayCalendarId,
    status: document.status,
    draftVersion: document.draftVersion,
    exceptionCount: document.exceptions.filter(
      (exception) => exception.status === "ACTIVE",
    ).length,
    description: document.description,
    externalRef: document.externalRef,
    archivedAt: document.archivedAt,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

function toMonthlyRosterView(
  document: MonthlyRosterReadDocument,
): MonthlyRosterView {
  return {
    ...toMonthlyRosterListItemView(document),
    previewHash: document.previewHash,
    lastPreviewedAt: document.lastPreviewedAt,
    publishedAt: document.publishedAt,
    publishedByUserId: document.publishedByUserId,
    publishGenerationRunId:
      document.publishGenerationRunId,
    exceptions: document.exceptions.map((exception) => ({
      ...exception,
      studioResourceIds: [
        ...exception.studioResourceIds,
      ],
    })),
  };
}

async function enrichMonthlyRosterReferenceSummaries<
  T extends {
    readonly targetType?: MonthlyRosterTargetType;
    readonly targetOrgUnitId?: string | null;
    readonly targetTalentGroupId?: string | null;
    readonly departmentOrgUnitId?: string | null;
    readonly workPatternId: string;
    readonly holidayCalendarId: string;
    readonly exceptions?: readonly RosterExceptionRecord[];
  },
>(
  items: readonly T[],
  collections: {
    readonly orgUnitCollection: Collection<OrgUnitReferenceReadDocument>;
    readonly talentGroupCollection: Collection<TalentGroupReferenceReadDocument>;
    readonly employmentProfileCollection: Collection<EmploymentProfileReferenceReadDocument>;
    readonly studioResourceCollection: Collection<StudioResourceReferenceReadDocument>;
    readonly workPatternCollection: Collection<WorkPatternReferenceReadDocument>;
    readonly holidayCalendarCollection: Collection<HolidayCalendarReferenceReadDocument>;
  },
): Promise<readonly T[]> {
  if (items.length === 0) {
    return items;
  }

  const orgUnitIds = new Set<string>();
  const talentGroupIds = new Set<string>();
  const employmentProfileIds = new Set<string>();
  const studioResourceIds = new Set<string>();
  const workPatternIds = new Set<string>();
  const holidayCalendarIds = new Set<string>();

  for (const item of items) {
    addOptionalReferenceId(orgUnitIds, item.departmentOrgUnitId ?? null);
    addOptionalReferenceId(orgUnitIds, item.targetOrgUnitId ?? null);
    addOptionalReferenceId(
      talentGroupIds,
      item.targetTalentGroupId ?? null,
    );
    addRequiredReferenceId(workPatternIds, item.workPatternId);
    addRequiredReferenceId(holidayCalendarIds, item.holidayCalendarId);

    for (const exception of item.exceptions ?? []) {
      addRequiredReferenceId(
        employmentProfileIds,
        exception.subjectEmploymentProfileId,
      );

      for (const studioResourceId of exception.studioResourceIds) {
        addRequiredReferenceId(studioResourceIds, studioResourceId);
      }
    }
  }

  const [
    orgUnitRefMap,
    talentGroupRefMap,
    employmentProfileRefMap,
    studioResourceRefMap,
    workPatternRefMap,
    holidayCalendarRefMap,
  ] = await Promise.all([
    loadOrgUnitReferenceSummaries(orgUnitIds, collections.orgUnitCollection),
    loadTalentGroupReferenceSummaries(
      talentGroupIds,
      collections.talentGroupCollection,
    ),
    loadEmploymentProfileReferenceSummaries(
      employmentProfileIds,
      collections.employmentProfileCollection,
    ),
    loadStudioResourceReferenceSummaries(
      studioResourceIds,
      collections.studioResourceCollection,
    ),
    loadWorkPatternReferenceSummaries(
      workPatternIds,
      collections.workPatternCollection,
    ),
    loadHolidayCalendarReferenceSummaries(
      holidayCalendarIds,
      collections.holidayCalendarCollection,
    ),
  ]);

  return items.map((item) => {
    const targetOrgUnitRef = item.targetOrgUnitId
      ? (orgUnitRefMap.get(item.targetOrgUnitId) ?? null)
      : null;
    const targetTalentGroupRef = item.targetTalentGroupId
      ? (talentGroupRefMap.get(item.targetTalentGroupId) ??
        null)
      : null;

    return {
      ...item,
      targetOrgUnitRef,
      targetTalentGroupRef,
      targetRef:
        item.targetType === "TALENT_GROUP"
          ? targetTalentGroupRef
          : targetOrgUnitRef,
      departmentOrgUnitRef: item.departmentOrgUnitId
        ? (orgUnitRefMap.get(item.departmentOrgUnitId) ??
          null)
        : null,
      workPatternRef:
        workPatternRefMap.get(item.workPatternId) ?? null,
      holidayCalendarRef:
        holidayCalendarRefMap.get(item.holidayCalendarId) ??
        null,
      ...(item.exceptions
        ? {
            exceptions: item.exceptions.map((exception) => ({
              ...exception,
              subjectEmploymentProfileRef:
                employmentProfileRefMap.get(
                  exception.subjectEmploymentProfileId,
                ) ?? null,
              studioResourceRefs: exception.studioResourceIds.map(
                (id) =>
                  studioResourceRefMap.get(id) ??
                  toFallbackReferenceSummary(id),
              ),
            })),
          }
        : {}),
    };
  });
}

async function loadOrgUnitReferenceSummaries(
  ids: ReadonlySet<string>,
  collection: Collection<OrgUnitReferenceReadDocument>,
): Promise<Map<string, ReferenceSummary>> {
  if (ids.size === 0) {
    return new Map();
  }

  const documents = await collection
    .find(
      { _id: { $in: [...ids] } },
      { projection: { _id: 1, code: 1, name: 1, status: 1 } },
    )
    .toArray();

  return new Map(
    documents.map((document) => [
      document._id,
      toOrgUnitReferenceSummary(document),
    ]),
  );
}

async function loadTalentGroupReferenceSummaries(
  ids: ReadonlySet<string>,
  collection: Collection<TalentGroupReferenceReadDocument>,
): Promise<Map<string, ReferenceSummary>> {
  if (ids.size === 0) {
    return new Map();
  }

  const documents = await collection
    .find(
      { _id: { $in: [...ids] } },
      {
        projection: {
          _id: 1,
          groupCode: 1,
          name: 1,
          status: 1,
        },
      },
    )
    .toArray();

  return new Map(
    documents.map((document) => [
      document._id,
      toTalentGroupReferenceSummary(document),
    ]),
  );
}

async function loadEmploymentProfileReferenceSummaries(
  ids: ReadonlySet<string>,
  collection: Collection<EmploymentProfileReferenceReadDocument>,
): Promise<Map<string, ReferenceSummary>> {
  if (ids.size === 0) {
    return new Map();
  }

  const documents = await collection
    .find(
      { _id: { $in: [...ids] } },
      {
        projection: {
          _id: 1,
          employeeCode: 1,
          legalName: 1,
          displayName: 1,
          employmentStatus: 1,
        },
      },
    )
    .toArray();

  return new Map(
    documents.map((document) => [
      document._id,
      toEmploymentProfileReferenceSummary(document),
    ]),
  );
}

async function loadStudioResourceReferenceSummaries(
  ids: ReadonlySet<string>,
  collection: Collection<StudioResourceReferenceReadDocument>,
): Promise<Map<string, ReferenceSummary>> {
  if (ids.size === 0) {
    return new Map();
  }

  const documents = await collection
    .find(
      { _id: { $in: [...ids] } },
      {
        projection: {
          _id: 1,
          resourceCode: 1,
          name: 1,
          operationalStatus: 1,
        },
      },
    )
    .toArray();

  return new Map(
    documents.map((document) => [
      document._id,
      toStudioResourceReferenceSummary(document),
    ]),
  );
}

async function loadWorkPatternReferenceSummaries(
  ids: ReadonlySet<string>,
  collection: Collection<WorkPatternReferenceReadDocument>,
): Promise<Map<string, ReferenceSummary>> {
  if (ids.size === 0) {
    return new Map();
  }

  const documents = await collection
    .find(
      { _id: { $in: [...ids] } },
      {
        projection: {
          _id: 1,
          patternCode: 1,
          name: 1,
          status: 1,
        },
      },
    )
    .toArray();

  return new Map(
    documents.map((document) => [
      document._id,
      toWorkPatternReferenceSummary(document),
    ]),
  );
}

async function loadHolidayCalendarReferenceSummaries(
  ids: ReadonlySet<string>,
  collection: Collection<HolidayCalendarReferenceReadDocument>,
): Promise<Map<string, ReferenceSummary>> {
  if (ids.size === 0) {
    return new Map();
  }

  const documents = await collection
    .find(
      { _id: { $in: [...ids] } },
      {
        projection: {
          _id: 1,
          calendarCode: 1,
          name: 1,
          status: 1,
        },
      },
    )
    .toArray();

  return new Map(
    documents.map((document) => [
      document._id,
      toHolidayCalendarReferenceSummary(document),
    ]),
  );
}

function addRequiredReferenceId(ids: Set<string>, value: string): void {
  const normalized = value.trim();

  if (normalized) {
    ids.add(normalized);
  }
}

function addOptionalReferenceId(
  ids: Set<string>,
  value: string | null,
): void {
  if (value === null) {
    return;
  }

  addRequiredReferenceId(ids, value);
}

function toFallbackReferenceSummary(id: string): ReferenceSummary {
  return { id };
}

function toOrgUnitReferenceSummary(
  document: OrgUnitReferenceReadDocument,
): ReferenceSummary {
  return {
    id: document._id,
    code: document.code,
    name: document.name,
    status: document.status,
  };
}

function toTalentGroupReferenceSummary(
  document: TalentGroupReferenceReadDocument,
): ReferenceSummary {
  return {
    id: document._id,
    code: document.groupCode,
    name: document.name,
    status: document.status,
  };
}

function toEmploymentProfileReferenceSummary(
  document: EmploymentProfileReferenceReadDocument,
): ReferenceSummary {
  return {
    id: document._id,
    code: document.employeeCode,
    displayName: document.displayName,
    name: document.legalName,
    status: document.employmentStatus,
  };
}

function toStudioResourceReferenceSummary(
  document: StudioResourceReferenceReadDocument,
): ReferenceSummary {
  return {
    id: document._id,
    code: document.resourceCode,
    name: document.name,
    status: document.operationalStatus,
  };
}

function toWorkPatternReferenceSummary(
  document: WorkPatternReferenceReadDocument,
): ReferenceSummary {
  return {
    id: document._id,
    code: document.patternCode,
    name: document.name,
    status: document.status,
  };
}

function toHolidayCalendarReferenceSummary(
  document: HolidayCalendarReferenceReadDocument,
): ReferenceSummary {
  return {
    id: document._id,
    code: document.calendarCode,
    name: document.name,
    status: document.status,
  };
}

function encodeCursor(cursor: EncodedCursor): string {
  return Buffer.from(
    JSON.stringify(cursor),
    "utf8",
  ).toString("base64url");
}

function decodeCursor(
  cursor: string,
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

  if (
    candidate.queryShapeSignature !==
      expectedQueryShapeSignature ||
    typeof candidate.createdAt !== "number" ||
    !Number.isInteger(candidate.createdAt) ||
    typeof candidate.monthlyRosterId !== "string" ||
    !candidate.monthlyRosterId.trim()
  ) {
    throw invalidCursorError();
  }

  return {
    queryShapeSignature: expectedQueryShapeSignature,
    createdAt: candidate.createdAt,
    monthlyRosterId:
      candidate.monthlyRosterId.trim(),
  };
}

function buildCursorQueryShapeSignature(
  input: MonthlyRosterListReadInput,
): string {
  return JSON.stringify({
    status: input.status ?? null,
    rosterMonth: input.rosterMonth ?? null,
    targetType: input.targetType ?? null,
    targetOrgUnitId: input.targetOrgUnitId ?? null,
    targetTalentGroupId:
      input.targetTalentGroupId ?? null,
    departmentOrgUnitId:
      input.departmentOrgUnitId ?? null,
    workPatternId: input.workPatternId ?? null,
    holidayCalendarId:
      input.holidayCalendarId ?? null,
    search: input.search ?? null,
  });
}

function invalidCursorError(): WorkScheduleValidationError {
  return new WorkScheduleValidationError(
    "cursor is invalid",
  );
}
