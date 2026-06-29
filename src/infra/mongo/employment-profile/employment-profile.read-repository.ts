import {
  ClientSession,
  Collection,
  Db,
} from "mongodb";
import { BaseRepository } from "@infra/database/repository";
import { EmploymentProfileValidationError } from "@modules/employment-profile/domain/employment-profile.errors";
import {
  EmploymentProfileOrgUnitReadonlyAccess,
  EmploymentProfileReferencedOrgUnit,
} from "@modules/employment-profile/domain/employment-profile-org-unit-readonly-access";
import {
  EmploymentProfileReferencedUser,
  EmploymentProfileUserReadonlyAccess,
} from "@modules/employment-profile/domain/employment-profile-user-readonly-access";
import {
  EmploymentContractStatus,
  EmploymentKind,
  EmploymentProfileDetailView,
  EmploymentProfileDirectReportListItemView,
  EmploymentProfileListItemView,
  EmploymentProfileSortDirection,
  EmploymentProfileSortField,
  EmploymentStatus,
} from "@modules/employment-profile/domain/employment-profile.types";
import {
  EmploymentProfileReadRepository,
  ListDirectReportsReadInput,
  ListDirectReportsReadResult,
  ListEmploymentProfileReadInput,
  ListEmploymentProfileReadResult,
} from "@modules/employment-profile/read/employment-profile.read-repository";
import { OrgUnitStatus } from "@modules/org-unit/domain/org-unit.types";
import { UserAccountStatus } from "@modules/user/domain/user.types";
import { OrgUnitEmploymentReadonlyAccess } from "@modules/org-unit/domain/org-unit-employment-readonly-access";
import { ReferenceSummary } from "@modules/reference-summary";

interface EmploymentProfileReadDocument {
  readonly _id: string;
  readonly employeeCode: string;
  readonly legalName: string;
  readonly normalizedLegalName: string;
  readonly displayName: string;
  readonly normalizedDisplayName: string;
  readonly employmentKind: EmploymentKind;
  readonly jobTitle: string;
  readonly titleDescription: string | null;
  readonly externalRef: string | null;
  readonly orgUnitId: string;
  readonly managerEmploymentProfileId: string | null;
  readonly recruiterEmploymentProfileId?: string | null;
  readonly hrOwnerEmploymentProfileId?: string | null;
  readonly onboardingOwnerEmploymentProfileId?: string | null;
  readonly sourcedByEmploymentProfileId?: string | null;
  readonly linkedUserId: string | null;
  readonly employmentStatus: EmploymentStatus;
  readonly contractStatus: EmploymentContractStatus;
  readonly employmentStartDate: number;
  readonly employmentEndDate: number | null;
  readonly hiredAt?: number | null;
  readonly onboardedAt?: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

interface OrgUnitReferenceDocument {
  readonly _id: string;
  readonly code: string;
  readonly name: string;
  readonly status: OrgUnitStatus;
}

interface UserReferenceDocument {
  readonly _id: string;
  readonly profile: {
    readonly displayName: string;
    readonly email?: string;
  };
  readonly accountStatus: UserAccountStatus;
  readonly disabledAt: number | null;
  readonly archivedAt: number | null;
}

interface ResponsibilityAssignmentDocument {
  readonly _id: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly responsibleEmploymentProfileId: string;
  readonly responsibilityType: string;
  readonly status: string;
  readonly effectiveAt: number;
  readonly expiresAt: number | null;
}

type SortSpec =
  | {
      readonly kind: "default";
    }
  | {
      readonly kind: "field";
      readonly field: EmploymentProfileSortField;
      readonly direction: EmploymentProfileSortDirection;
    };

type EncodedCursor =
  | {
      readonly kind: "default";
      readonly scope: string;
      readonly employeeCode: string;
      readonly id: string;
    }
  | {
      readonly kind: "field";
      readonly scope: string;
      readonly field: EmploymentProfileSortField;
      readonly direction: EmploymentProfileSortDirection;
      readonly value: string | number;
      readonly id: string;
    };

export class NativeMongoEmploymentProfileReadRepository
  extends BaseRepository<EmploymentProfileReadDocument>
  implements EmploymentProfileReadRepository
{
  private readonly orgUnitCollection: Collection<OrgUnitReferenceDocument>;
  private readonly employmentProfileCollection: Collection<EmploymentProfileReadDocument>;
  private readonly userCollection: Collection<UserReferenceDocument>;
  private readonly responsibilityAssignmentCollection: Collection<ResponsibilityAssignmentDocument>;

  constructor(db: Db) {
    super(db, "employment_profiles");
    this.employmentProfileCollection =
      db.collection<EmploymentProfileReadDocument>(
        "employment_profiles",
      );
    this.orgUnitCollection =
      db.collection<OrgUnitReferenceDocument>(
        "org_units",
      );
    this.userCollection =
      db.collection<UserReferenceDocument>("users");
    this.responsibilityAssignmentCollection =
      db.collection<ResponsibilityAssignmentDocument>(
        "responsibility_assignments",
      );
  }

  async listEmploymentProfiles(
    input: ListEmploymentProfileReadInput,
  ): Promise<ListEmploymentProfileReadResult> {
    const sortSpec = toSortSpec(input);
    const cursorScope =
      buildListCursorScope(input, sortSpec);
    const cursor =
      input.cursor === undefined
        ? undefined
        : decodeCursor(
            input.cursor,
            sortSpec,
            cursorScope,
          );
    const queryFilters: Array<Record<string, unknown>> =
      [];

    if (input.employmentStatus) {
      queryFilters.push({
        employmentStatus: input.employmentStatus,
      });
    } else {
      queryFilters.push({
        employmentStatus: {
          $ne: "ARCHIVED",
        },
      });
    }

    if (input.contractStatus) {
      queryFilters.push({
        contractStatus: input.contractStatus,
      });
    }

    if (input.employmentKind) {
      queryFilters.push({
        employmentKind: input.employmentKind,
      });
    }

    if (input.orgUnitId) {
      queryFilters.push({
        orgUnitId: input.orgUnitId,
      });
    }

    if (input.hasLinkedUser === true) {
      queryFilters.push({
        linkedUserId: {
          $type: "string",
        },
      });
    } else if (input.hasLinkedUser === false) {
      queryFilters.push({
        linkedUserId: null,
      });
    }

    if (input.search) {
      queryFilters.push(
        buildSearchFilter(input.search),
      );
    }

    if (cursor) {
      queryFilters.push(
        buildPageAfterFilter(sortSpec, cursor),
      );
    }

    const docs = await this.collection
      .find(buildQuery(queryFilters))
      .sort(toSortDocument(sortSpec))
      .limit(input.limit + 1)
      .toArray();

    const hasNext = docs.length > input.limit;
    const page = hasNext
      ? docs.slice(0, input.limit)
      : docs;

    const items =
      await enrichEmploymentProfileReferenceSummaries(
        page.map((doc) =>
          toEmploymentProfileListItemView(doc),
        ),
        {
          orgUnitCollection: this.orgUnitCollection,
          employmentProfileCollection:
            this.employmentProfileCollection,
          userCollection: this.userCollection,
        },
      );

    return {
      items,
      nextCursor:
        hasNext && page.length > 0
          ? encodeCursor(
              buildCursorFromDocument(
                sortSpec,
                page[page.length - 1],
                cursorScope,
              ),
            )
          : undefined,
    };
  }

  async getEmploymentProfileDetail(
    employmentProfileId: string,
  ): Promise<EmploymentProfileDetailView | null> {
    const doc = await this.collection.findOne({
      _id: employmentProfileId,
    });

    if (!doc) {
      return null;
    }

    const [detail] =
      await enrichEmploymentProfileReferenceSummaries(
        [toEmploymentProfileDetailView(doc)],
        {
          orgUnitCollection: this.orgUnitCollection,
          employmentProfileCollection:
            this.employmentProfileCollection,
          userCollection: this.userCollection,
        },
      );

    return detail ?? null;
  }

  async listDirectReports(
    input: ListDirectReportsReadInput,
  ): Promise<ListDirectReportsReadResult> {
    const sortSpec = toSortSpec(input);
    const cursorScope = buildDirectReportsCursorScope(
      input,
      sortSpec,
    );
    const cursor =
      input.cursor === undefined
        ? undefined
        : decodeCursor(
            input.cursor,
            sortSpec,
            cursorScope,
          );
    const reportingSubjectIds =
      await this.listActiveReportingSubjectIds(input);
    if (reportingSubjectIds.length === 0) {
      return { items: [] };
    }

    const queryFilters: Array<Record<string, unknown>> =
      [
        {
          _id: {
            $in: reportingSubjectIds,
          },
        },
        {
          employmentStatus: {
            $ne: "ARCHIVED",
          },
        },
      ];

    if (cursor) {
      queryFilters.push(
        buildPageAfterFilter(sortSpec, cursor),
      );
    }

    const docs = await this.collection
      .find(buildQuery(queryFilters))
      .sort(toSortDocument(sortSpec))
      .limit(input.limit + 1)
      .toArray();

    const hasNext = docs.length > input.limit;
    const page = hasNext
      ? docs.slice(0, input.limit)
      : docs;

    const items =
      await enrichEmploymentProfileReferenceSummaries(
        page.map((doc) =>
          toEmploymentProfileDirectReportListItemView(
            doc,
          ),
        ),
        {
          orgUnitCollection: this.orgUnitCollection,
          employmentProfileCollection:
            this.employmentProfileCollection,
          userCollection: this.userCollection,
        },
      );

    return {
      items,
      nextCursor:
        hasNext && page.length > 0
          ? encodeCursor(
              buildCursorFromDocument(
                sortSpec,
                page[page.length - 1],
                cursorScope,
              ),
            )
          : undefined,
    };
  }

  private async listActiveReportingSubjectIds(
    input: Pick<
      ListDirectReportsReadInput,
      "responsibleEmploymentProfileId" | "asOf"
    >,
  ): Promise<readonly string[]> {
    const docs = await this.responsibilityAssignmentCollection
      .find(
        {
          subjectType: "EMPLOYMENT_PROFILE",
          responsibleEmploymentProfileId:
            input.responsibleEmploymentProfileId,
          responsibilityType:
            "EMPLOYMENT_REPORTING_MANAGER",
          status: "ACTIVE",
          effectiveAt: { $lte: input.asOf },
          $or: [
            { expiresAt: null },
            { expiresAt: { $gte: input.asOf } },
          ],
        },
        {
          projection: {
            subjectId: 1,
          },
        },
      )
      .sort({ subjectId: 1, _id: 1 })
      .toArray();

    return uniqueNonEmpty(docs.map((doc) => doc.subjectId));
  }
}

async function enrichEmploymentProfileReferenceSummaries<
  T extends {
    readonly orgUnitId: string;
    readonly recruiterEmploymentProfileId?: string | null;
    readonly hrOwnerEmploymentProfileId?: string | null;
    readonly onboardingOwnerEmploymentProfileId?: string | null;
    readonly sourcedByEmploymentProfileId?: string | null;
    readonly linkedUserId?: string | null;
  },
>(
  items: readonly T[],
  collections: {
    readonly orgUnitCollection: Collection<OrgUnitReferenceDocument>;
    readonly employmentProfileCollection: Collection<EmploymentProfileReadDocument>;
    readonly userCollection: Collection<UserReferenceDocument>;
  },
): Promise<
  readonly (T & {
    readonly orgUnitRef: ReferenceSummary | null;
    readonly recruiterEmploymentProfileRef?: ReferenceSummary | null;
    readonly hrOwnerEmploymentProfileRef?: ReferenceSummary | null;
    readonly onboardingOwnerEmploymentProfileRef?: ReferenceSummary | null;
    readonly sourcedByEmploymentProfileRef?: ReferenceSummary | null;
    readonly linkedUserRef?: ReferenceSummary | null;
  })[]
> {
  if (items.length === 0) {
    return items.map((item) => ({
      ...item,
      orgUnitRef: null,
      recruiterEmploymentProfileRef:
        item.recruiterEmploymentProfileId === undefined
          ? undefined
          : null,
      hrOwnerEmploymentProfileRef:
        item.hrOwnerEmploymentProfileId === undefined
          ? undefined
          : null,
      onboardingOwnerEmploymentProfileRef:
        item.onboardingOwnerEmploymentProfileId === undefined
          ? undefined
          : null,
      sourcedByEmploymentProfileRef:
        item.sourcedByEmploymentProfileId === undefined
          ? undefined
          : null,
      linkedUserRef:
        item.linkedUserId === undefined ? undefined : null,
    }));
  }

  const orgUnitIds = new Set<string>();
  const employmentProfileIds = new Set<string>();
  const linkedUserIds = new Set<string>();

  for (const item of items) {
    addRequiredReferenceId(orgUnitIds, item.orgUnitId);
    addOptionalReferenceId(
      employmentProfileIds,
      item.recruiterEmploymentProfileId ?? null,
    );
    addOptionalReferenceId(
      employmentProfileIds,
      item.hrOwnerEmploymentProfileId ?? null,
    );
    addOptionalReferenceId(
      employmentProfileIds,
      item.onboardingOwnerEmploymentProfileId ?? null,
    );
    addOptionalReferenceId(
      employmentProfileIds,
      item.sourcedByEmploymentProfileId ?? null,
    );
    addOptionalReferenceId(linkedUserIds, item.linkedUserId ?? null);
  }

  const [orgUnitRefMap, employmentProfileRefMap, userRefMap] =
    await Promise.all([
      loadOrgUnitReferenceSummaries(
        orgUnitIds,
        collections.orgUnitCollection,
      ),
      loadEmploymentProfileReferenceSummaries(
        employmentProfileIds,
        collections.employmentProfileCollection,
      ),
      loadUserReferenceSummaries(
        linkedUserIds,
        collections.userCollection,
      ),
    ]);

  return items.map((item) => ({
    ...item,
    orgUnitRef: orgUnitRefMap.get(item.orgUnitId) ?? null,
    recruiterEmploymentProfileRef:
      item.recruiterEmploymentProfileId === undefined
        ? undefined
        : item.recruiterEmploymentProfileId
          ? employmentProfileRefMap.get(item.recruiterEmploymentProfileId) ??
            null
          : null,
    hrOwnerEmploymentProfileRef:
      item.hrOwnerEmploymentProfileId === undefined
        ? undefined
        : item.hrOwnerEmploymentProfileId
          ? employmentProfileRefMap.get(item.hrOwnerEmploymentProfileId) ??
            null
          : null,
    onboardingOwnerEmploymentProfileRef:
      item.onboardingOwnerEmploymentProfileId === undefined
        ? undefined
        : item.onboardingOwnerEmploymentProfileId
          ? employmentProfileRefMap.get(
              item.onboardingOwnerEmploymentProfileId,
            ) ?? null
          : null,
    sourcedByEmploymentProfileRef:
      item.sourcedByEmploymentProfileId === undefined
        ? undefined
        : item.sourcedByEmploymentProfileId
          ? employmentProfileRefMap.get(item.sourcedByEmploymentProfileId) ??
            null
          : null,
    linkedUserRef:
      item.linkedUserId === undefined
        ? undefined
        : item.linkedUserId
          ? userRefMap.get(item.linkedUserId) ?? null
          : null,
  }));
}

async function loadOrgUnitReferenceSummaries(
  ids: ReadonlySet<string>,
  collection: Collection<OrgUnitReferenceDocument>,
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
          code: 1,
          name: 1,
          status: 1,
        },
      },
    )
    .toArray();

  return new Map(
    documents.map((document) => [
      document._id,
      toOrgUnitReferenceSummary(document),
    ]),
  );
}

async function loadEmploymentProfileReferenceSummaries(
  ids: ReadonlySet<string>,
  collection: Collection<EmploymentProfileReadDocument>,
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

async function loadUserReferenceSummaries(
  ids: ReadonlySet<string>,
  collection: Collection<UserReferenceDocument>,
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
          profile: 1,
          accountStatus: 1,
        },
      },
    )
    .toArray();

  return new Map(
    documents.map((document) => [
      document._id,
      toUserReferenceSummary(document),
    ]),
  );
}

function toOrgUnitReferenceSummary(
  document: OrgUnitReferenceDocument,
): ReferenceSummary {
  return {
    id: document._id,
    code: document.code,
    name: document.name,
    status: document.status,
  };
}

function toEmploymentProfileReferenceSummary(
  document: EmploymentProfileReadDocument,
): ReferenceSummary {
  return {
    id: document._id,
    code: document.employeeCode,
    displayName: document.displayName,
    name: document.legalName,
    status: document.employmentStatus,
  };
}

function toUserReferenceSummary(
  document: UserReferenceDocument,
): ReferenceSummary {
  return {
    id: document._id,
    displayName: document.profile.displayName,
    name: document.profile.email,
    status: document.accountStatus,
  };
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
  const normalized = value?.trim();

  if (normalized) {
    ids.add(normalized);
  }
}

export class NativeMongoEmploymentProfileOrgUnitReadonlyAccess
  implements EmploymentProfileOrgUnitReadonlyAccess
{
  private readonly orgUnitCollection: Collection<OrgUnitReferenceDocument>;

  constructor(db: Db) {
    this.orgUnitCollection =
      db.collection<OrgUnitReferenceDocument>(
        "org_units",
      );
  }

  async findById(
    orgUnitId: string,
    session?: ClientSession,
  ): Promise<EmploymentProfileReferencedOrgUnit | null> {
    const doc = await this.orgUnitCollection.findOne(
      { _id: orgUnitId },
      {
        projection: {
          _id: 1,
          status: 1,
        },
        ...(session ? { session } : {}),
      },
    );

    return doc
      ? {
          id: doc._id,
          status: doc.status,
        }
      : null;
  }
}

export class NativeMongoEmploymentProfileUserReadonlyAccess
  implements EmploymentProfileUserReadonlyAccess
{
  private readonly userCollection: Collection<UserReferenceDocument>;

  constructor(db: Db) {
    this.userCollection =
      db.collection<UserReferenceDocument>("users");
  }

  async findById(
    userId: string,
    session?: ClientSession,
  ): Promise<EmploymentProfileReferencedUser | null> {
    const doc = await this.userCollection.findOne(
      {
        _id: userId,
        disabledAt: null,
        archivedAt: null,
      },
      {
        projection: {
          _id: 1,
          accountStatus: 1,
        },
        ...(session ? { session } : {}),
      },
    );

    return doc
      ? {
          id: doc._id,
          accountStatus: doc.accountStatus,
        }
      : null;
  }
}

export class NativeMongoOrgUnitEmploymentReadonlyAccess
  implements OrgUnitEmploymentReadonlyAccess
{
  private readonly employmentProfileCollection: Collection<EmploymentProfileReadDocument>;

  constructor(db: Db) {
    this.employmentProfileCollection =
      db.collection<EmploymentProfileReadDocument>(
        "employment_profiles",
      );
  }

  async hasNonArchivedProfilesAssignedToOrgUnit(
    orgUnitId: string,
    session?: ClientSession,
  ): Promise<boolean> {
    const doc =
      await this.employmentProfileCollection.findOne(
        {
          orgUnitId,
          employmentStatus: {
            $ne: "ARCHIVED",
          },
        },
        {
          projection: { _id: 1 },
          ...(session ? { session } : {}),
        },
      );

    return doc !== null;
  }
}

function toEmploymentProfileListItemView(
  document: EmploymentProfileReadDocument,
): EmploymentProfileListItemView {
  return {
    id: document._id,
    employeeCode: document.employeeCode,
    displayName: document.displayName,
    legalName: document.legalName,
    employmentKind: document.employmentKind,
    jobTitle: document.jobTitle,
    orgUnitId: document.orgUnitId,
    recruiterEmploymentProfileId:
      document.recruiterEmploymentProfileId ?? null,
    hrOwnerEmploymentProfileId:
      document.hrOwnerEmploymentProfileId ?? null,
    onboardingOwnerEmploymentProfileId:
      document.onboardingOwnerEmploymentProfileId ?? null,
    sourcedByEmploymentProfileId:
      document.sourcedByEmploymentProfileId ?? null,
    linkedUserId: document.linkedUserId,
    employmentStatus: document.employmentStatus,
    contractStatus: document.contractStatus,
    hiredAt: document.hiredAt ?? null,
    onboardedAt: document.onboardedAt ?? null,
    createdAt: document.createdAt,
  };
}

function toEmploymentProfileDirectReportListItemView(
  document: EmploymentProfileReadDocument,
): EmploymentProfileDirectReportListItemView {
  return {
    id: document._id,
    employeeCode: document.employeeCode,
    displayName: document.displayName,
    employmentStatus: document.employmentStatus,
    contractStatus: document.contractStatus,
    orgUnitId: document.orgUnitId,
  };
}

function toEmploymentProfileDetailView(
  document: EmploymentProfileReadDocument,
): EmploymentProfileDetailView {
  return {
    id: document._id,
    employeeCode: document.employeeCode,
    legalName: document.legalName,
    displayName: document.displayName,
    employmentKind: document.employmentKind,
    jobTitle: document.jobTitle,
    titleDescription: document.titleDescription,
    externalRef: document.externalRef,
    orgUnitId: document.orgUnitId,
    recruiterEmploymentProfileId:
      document.recruiterEmploymentProfileId ?? null,
    hrOwnerEmploymentProfileId:
      document.hrOwnerEmploymentProfileId ?? null,
    onboardingOwnerEmploymentProfileId:
      document.onboardingOwnerEmploymentProfileId ?? null,
    sourcedByEmploymentProfileId:
      document.sourcedByEmploymentProfileId ?? null,
    linkedUserId: document.linkedUserId,
    employmentStatus: document.employmentStatus,
    contractStatus: document.contractStatus,
    employmentStartDate:
      document.employmentStartDate,
    employmentEndDate:
      document.employmentEndDate,
    hiredAt: document.hiredAt ?? null,
    onboardedAt: document.onboardedAt ?? null,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

function toSortSpec(
  input: Pick<
    ListEmploymentProfileReadInput,
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
      employeeCode: 1,
      _id: 1,
    };
  }

  const direction = toDirectionValue(
    spec.direction,
  );

  return {
    [spec.field]: direction,
    _id: direction,
  };
}

function buildCursorFromDocument(
  spec: SortSpec,
  document: EmploymentProfileReadDocument,
  scope: string,
): EncodedCursor {
  if (spec.kind === "default") {
    return {
      kind: "default",
      scope,
      employeeCode: document.employeeCode,
      id: document._id,
    };
  }

  return {
    kind: "field",
    scope,
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

  return { $and: [...filters] };
}

function buildSearchFilter(
  search: string,
): Record<string, unknown> {
  const normalizedNamePrefix =
    normalizeNamePrefix(search);
  const employeeCodePrefix =
    normalizeEmployeeCodePrefix(search);

  return {
    $or: [
      buildPrefixRange(
        "employeeCode",
        employeeCodePrefix,
      ),
      buildPrefixRange(
        "normalizedLegalName",
        normalizedNamePrefix,
      ),
      buildPrefixRange(
        "normalizedDisplayName",
        normalizedNamePrefix,
      ),
    ],
  };
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
          employeeCode: {
            $gt: cursor.employeeCode,
          },
        },
        {
          employeeCode: cursor.employeeCode,
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
    spec.direction === "ASC"
      ? "$gt"
      : "$lt";

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
          [comparisonOperator]: cursor.id,
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
  expectedScope: string,
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

  const candidate = payload as Record<
    string,
    unknown
  >;

  if (expectedSpec.kind === "default") {
    if (candidate.kind !== "default") {
      throw invalidCursorError();
    }

    if (
      candidate.scope !== expectedScope ||
      typeof candidate.employeeCode !== "string" ||
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
      scope: expectedScope,
      employeeCode: candidate.employeeCode,
      id,
    };
  }

  if (
    candidate.kind !== "field" ||
    candidate.scope !== expectedScope ||
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

  if (
    expectedSpec.field === "displayName" ||
    expectedSpec.field === "legalName" ||
    expectedSpec.field === "employeeCode"
  ) {
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
    scope: expectedScope,
    field: expectedSpec.field,
    direction: expectedSpec.direction,
    value,
    id,
  };
}

function readSortFieldValue(
  document: EmploymentProfileReadDocument,
  field: EmploymentProfileSortField,
): string | number {
  switch (field) {
    case "employeeCode":
      return document.employeeCode;

    case "displayName":
      return document.displayName;

    case "legalName":
      return document.legalName;

    case "createdAt":
      return document.createdAt;
  }
}

function toDirectionValue(
  direction: EmploymentProfileSortDirection,
): 1 | -1 {
  return direction === "ASC" ? 1 : -1;
}

function normalizeNamePrefix(
  value: string,
): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();
}

function normalizeEmployeeCodePrefix(
  value: string,
): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ");
}

function invalidCursorError(): EmploymentProfileValidationError {
  return new EmploymentProfileValidationError(
    "cursor is invalid",
  );
}

function buildListCursorScope(
  input: ListEmploymentProfileReadInput,
  sortSpec: SortSpec,
): string {
  return JSON.stringify({
    query: "employment-profile.list",
    employmentStatus:
      input.employmentStatus ?? null,
    contractStatus: input.contractStatus ?? null,
    employmentKind: input.employmentKind ?? null,
    orgUnitId: input.orgUnitId ?? null,
    hasLinkedUser: input.hasLinkedUser ?? null,
    search: input.search ?? null,
    sort: sortSpec,
  });
}

function buildDirectReportsCursorScope(
  input: ListDirectReportsReadInput,
  sortSpec: SortSpec,
): string {
  return JSON.stringify({
    query:
      "employment-profile.list-direct-reports",
    responsibleEmploymentProfileId:
      input.responsibleEmploymentProfileId,
    asOf: input.asOf,
    sort: sortSpec,
  });
}

function uniqueNonEmpty(values: readonly string[]): readonly string[] {
  return [
    ...new Set(
      values
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  ];
}
