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
  readonly linkedUserId: string | null;
  readonly employmentStatus: EmploymentStatus;
  readonly contractStatus: EmploymentContractStatus;
  readonly employmentStartDate: number;
  readonly employmentEndDate: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

interface OrgUnitReferenceDocument {
  readonly _id: string;
  readonly status: OrgUnitStatus;
}

interface UserReferenceDocument {
  readonly _id: string;
  readonly accountStatus: UserAccountStatus;
  readonly disabledAt: number | null;
  readonly archivedAt: number | null;
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
  constructor(db: Db) {
    super(db, "employment_profiles");
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

    if (input.managerEmploymentProfileId) {
      queryFilters.push({
        managerEmploymentProfileId:
          input.managerEmploymentProfileId,
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

    return {
      items: page.map((doc) =>
        toEmploymentProfileListItemView(doc),
      ),
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

    return doc
      ? toEmploymentProfileDetailView(doc)
      : null;
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
    const queryFilters: Array<Record<string, unknown>> =
      [
        {
          managerEmploymentProfileId:
            input.managerEmploymentProfileId,
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

    return {
      items: page.map((doc) =>
        toEmploymentProfileDirectReportListItemView(
          doc,
        ),
      ),
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
    managerEmploymentProfileId:
      document.managerEmploymentProfileId,
    linkedUserId: document.linkedUserId,
    employmentStatus: document.employmentStatus,
    contractStatus: document.contractStatus,
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
    managerEmploymentProfileId:
      document.managerEmploymentProfileId,
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
    managerEmploymentProfileId:
      document.managerEmploymentProfileId,
    linkedUserId: document.linkedUserId,
    employmentStatus: document.employmentStatus,
    contractStatus: document.contractStatus,
    employmentStartDate:
      document.employmentStartDate,
    employmentEndDate:
      document.employmentEndDate,
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
    managerEmploymentProfileId:
      input.managerEmploymentProfileId ?? null,
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
    managerEmploymentProfileId:
      input.managerEmploymentProfileId,
    sort: sortSpec,
  });
}
