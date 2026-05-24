import { ClientSession, Collection, Db } from "mongodb";
import { BaseRepository } from "@infra/database/repository";
import { EmploymentStatus } from "@modules/employment-profile/domain/employment-profile.types";
import { EmploymentProfileTalentReadonlyAccess } from "@modules/employment-profile/domain/employment-profile-talent-readonly-access";
import { TalentValidationError } from "@modules/talent/domain/talent.errors";
import {
  TalentEmploymentProfileReadonlyAccess,
  TalentReferencedEmploymentProfile,
} from "@modules/talent/domain/talent-employment-profile-readonly-access";
import {
  TalentGroupReferencedTalent,
  TalentGroupTalentReadonlyAccess,
} from "@modules/talent/domain/talent-group-talent-readonly-access";
import {
  TalentCommercialParticipationStatus,
  TalentDetailView,
  TalentListItemView,
  TalentOperationalStatus,
  TalentOrigin,
  TalentSortDirection,
  TalentSortField,
} from "@modules/talent/domain/talent.types";
import {
  ListTalentReadInput,
  ListTalentReadResult,
  TalentReadRepository,
} from "@modules/talent/read/talent.read-repository";
import { ReferenceSummary } from "@modules/reference-summary";

interface TalentReadDocument {
  readonly _id: string;
  readonly talentCode: string;
  readonly stageName: string;
  readonly normalizedStageName: string;
  readonly legalName: string;
  readonly normalizedLegalName: string;
  readonly displayShortName: string | null;
  readonly normalizedDisplayShortName: string | null;
  readonly talentOrigin: TalentOrigin;
  readonly operationalStatus: TalentOperationalStatus;
  readonly managerEmploymentProfileId: string | null;
  readonly linkedEmploymentProfileId: string | null;
  readonly commercialParticipationStatus: TalentCommercialParticipationStatus;
  readonly livestreamEligible: boolean;
  readonly eventEligible: boolean;
  readonly externalRef: string | null;
  readonly profileSummary: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

interface EmploymentProfileReferenceDocument {
  readonly _id: string;
  readonly employeeCode: string;
  readonly legalName: string;
  readonly displayName: string;
  readonly employmentStatus: EmploymentStatus;
}

type SortSpec =
  | {
      readonly kind: "default";
    }
  | {
      readonly kind: "field";
      readonly field: TalentSortField;
      readonly direction: TalentSortDirection;
    };

type EncodedCursor =
  | {
      readonly kind: "default";
      readonly querySignature: string;
      readonly talentCode: string;
      readonly id: string;
    }
  | {
      readonly kind: "field";
      readonly querySignature: string;
      readonly field: TalentSortField;
      readonly direction: TalentSortDirection;
      readonly value: string | number;
      readonly id: string;
    };

export class NativeMongoTalentReadRepository
  extends BaseRepository<TalentReadDocument>
  implements TalentReadRepository
{
  private readonly employmentProfileCollection: Collection<EmploymentProfileReferenceDocument>;
  private readonly memberCollection: Collection<TalentGroupMemberReadDocument>;

  constructor(db: Db) {
    super(db, "talents");
    this.employmentProfileCollection =
      db.collection<EmploymentProfileReferenceDocument>("employment_profiles");
    this.memberCollection = db.collection<TalentGroupMemberReadDocument>(
      "talent_group_members",
    );
  }

  async listTalents(input: ListTalentReadInput): Promise<ListTalentReadResult> {
    const sortSpec = toSortSpec(input);
    const querySignature = buildCursorQuerySignature(input, sortSpec);
    const cursor =
      input.cursor === undefined
        ? undefined
        : decodeCursor(input.cursor, sortSpec, querySignature);
    const queryFilters: Array<Record<string, unknown>> = [];

    if (input.activeMemberOfGroupIds) {
      const groupIds = [...new Set(input.activeMemberOfGroupIds)];

      if (groupIds.length === 0) {
        return {
          items: [],
        };
      }

      const talentIds = await this.memberCollection.distinct("talentId", {
        groupId: {
          $in: groupIds,
        },
        membershipStatus: "ACTIVE",
      });

      if (talentIds.length === 0) {
        return {
          items: [],
        };
      }

      queryFilters.push({
        _id: {
          $in: talentIds,
        },
      });
    }

    if (!input.operationalStatus) {
      queryFilters.push({
        operationalStatus: {
          $ne: "ARCHIVED",
        },
      });
    }

    if (input.operationalStatus) {
      queryFilters.push({
        operationalStatus: input.operationalStatus,
      });
    }

    if (input.talentOrigin) {
      queryFilters.push({
        talentOrigin: input.talentOrigin,
      });
    }

    if (input.managerEmploymentProfileId) {
      queryFilters.push({
        managerEmploymentProfileId: input.managerEmploymentProfileId,
      });
    }

    if (input.hasLinkedEmploymentProfile === true) {
      queryFilters.push({
        linkedEmploymentProfileId: {
          $type: "string",
        },
      });
    } else if (input.hasLinkedEmploymentProfile === false) {
      queryFilters.push({
        linkedEmploymentProfileId: null,
      });
    }

    if (input.commercialParticipationStatus) {
      queryFilters.push({
        commercialParticipationStatus: input.commercialParticipationStatus,
      });
    }

    if (input.livestreamEligible !== undefined) {
      queryFilters.push({
        livestreamEligible: input.livestreamEligible,
      });
    }

    if (input.eventEligible !== undefined) {
      queryFilters.push({
        eventEligible: input.eventEligible,
      });
    }

    if (input.search) {
      queryFilters.push(buildSearchFilter(input.search));
    }

    if (cursor) {
      queryFilters.push(buildPageAfterFilter(sortSpec, cursor));
    }

    const docs = await this.collection
      .find(buildQuery(queryFilters))
      .sort(toSortDocument(sortSpec))
      .limit(input.limit + 1)
      .toArray();

    const hasNext = docs.length > input.limit;
    const page = hasNext ? docs.slice(0, input.limit) : docs;

    const items = await enrichTalentEmploymentProfileReferenceSummaries(
      page.map((doc) => toTalentListItemView(doc)),
      this.employmentProfileCollection,
    );

    return {
      items,
      nextCursor:
        hasNext && page.length > 0
          ? encodeCursor(
              buildCursorFromDocument(
                sortSpec,
                page[page.length - 1],
                querySignature,
              ),
            )
          : undefined,
    };
  }

  async getTalentDetail(talentId: string): Promise<TalentDetailView | null> {
    const doc = await this.collection.findOne({
      _id: talentId,
    });

    if (!doc) {
      return null;
    }

    const [detail] = await enrichTalentEmploymentProfileReferenceSummaries(
      [toTalentDetailView(doc)],
      this.employmentProfileCollection,
    );

    return detail ?? null;
  }

  async hasActiveMembershipInGroups(
    talentId: string,
    groupIds: readonly string[],
  ): Promise<boolean> {
    if (groupIds.length === 0) {
      return false;
    }

    const membership = await this.memberCollection.findOne(
      {
        talentId,
        groupId: {
          $in: [...new Set(groupIds)],
        },
        membershipStatus: "ACTIVE",
      },
      {
        projection: {
          _id: 1,
        },
      },
    );

    return membership !== null;
  }
}

interface TalentGroupMemberReadDocument {
  readonly _id: string;
  readonly groupId: string;
  readonly talentId: string;
  readonly membershipStatus: string;
}

async function enrichTalentEmploymentProfileReferenceSummaries<
  T extends {
    readonly managerEmploymentProfileId: string | null;
    readonly linkedEmploymentProfileId: string | null;
  },
>(
  items: readonly T[],
  collection: Collection<EmploymentProfileReferenceDocument>,
): Promise<
  readonly (T & {
    readonly managerEmploymentProfileRef: ReferenceSummary | null;
    readonly linkedEmploymentProfileRef: ReferenceSummary | null;
  })[]
> {
  if (items.length === 0) {
    return items.map((item) => ({
      ...item,
      managerEmploymentProfileRef: null,
      linkedEmploymentProfileRef: null,
    }));
  }

  const employmentProfileIds = new Set<string>();

  for (const item of items) {
    addOptionalReferenceId(
      employmentProfileIds,
      item.managerEmploymentProfileId,
    );
    addOptionalReferenceId(
      employmentProfileIds,
      item.linkedEmploymentProfileId,
    );
  }

  const employmentProfileRefMap = await loadEmploymentProfileReferenceSummaries(
    employmentProfileIds,
    collection,
  );

  return items.map((item) => ({
    ...item,
    managerEmploymentProfileRef: item.managerEmploymentProfileId
      ? (employmentProfileRefMap.get(item.managerEmploymentProfileId) ?? null)
      : null,
    linkedEmploymentProfileRef: item.linkedEmploymentProfileId
      ? (employmentProfileRefMap.get(item.linkedEmploymentProfileId) ?? null)
      : null,
  }));
}

async function loadEmploymentProfileReferenceSummaries(
  ids: ReadonlySet<string>,
  collection: Collection<EmploymentProfileReferenceDocument>,
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

function toEmploymentProfileReferenceSummary(
  document: EmploymentProfileReferenceDocument,
): ReferenceSummary {
  return {
    id: document._id,
    code: document.employeeCode,
    displayName: document.displayName,
    name: document.legalName,
    status: document.employmentStatus,
  };
}

function addOptionalReferenceId(ids: Set<string>, value: string | null): void {
  const normalized = value?.trim();

  if (normalized) {
    ids.add(normalized);
  }
}

export class NativeMongoTalentEmploymentProfileReadonlyAccess implements TalentEmploymentProfileReadonlyAccess {
  private readonly employmentProfileCollection: Collection<EmploymentProfileReferenceDocument>;

  constructor(db: Db) {
    this.employmentProfileCollection =
      db.collection<EmploymentProfileReferenceDocument>("employment_profiles");
  }

  async findById(
    employmentProfileId: string,
    session?: ClientSession,
  ): Promise<TalentReferencedEmploymentProfile | null> {
    const doc = await this.employmentProfileCollection.findOne(
      { _id: employmentProfileId },
      {
        projection: {
          _id: 1,
          employmentStatus: 1,
        },
        ...(session ? { session } : {}),
      },
    );

    return doc
      ? {
          id: doc._id,
          employmentStatus: doc.employmentStatus,
        }
      : null;
  }
}

export class NativeMongoTalentGroupTalentReadonlyAccess implements TalentGroupTalentReadonlyAccess {
  private readonly talentCollection: Collection<TalentReadDocument>;

  constructor(db: Db) {
    this.talentCollection = db.collection<TalentReadDocument>("talents");
  }

  async findById(
    talentId: string,
    session?: ClientSession,
  ): Promise<TalentGroupReferencedTalent | null> {
    const doc = await this.talentCollection.findOne(
      { _id: talentId },
      {
        projection: {
          _id: 1,
          operationalStatus: 1,
        },
        ...(session ? { session } : {}),
      },
    );

    return doc
      ? {
          id: doc._id,
          operationalStatus: doc.operationalStatus,
        }
      : null;
  }
}

export class NativeMongoEmploymentProfileTalentReadonlyAccess implements EmploymentProfileTalentReadonlyAccess {
  private readonly talentCollection: Collection<TalentReadDocument>;

  constructor(db: Db) {
    this.talentCollection = db.collection<TalentReadDocument>("talents");
  }

  async hasNonArchivedTalentsManagedByEmploymentProfile(
    employmentProfileId: string,
    session?: ClientSession,
  ): Promise<boolean> {
    const doc = await this.talentCollection.findOne(
      {
        managerEmploymentProfileId: employmentProfileId,
        operationalStatus: {
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

  async hasNonArchivedInternalTalentLinkedToEmploymentProfile(
    employmentProfileId: string,
    session?: ClientSession,
  ): Promise<boolean> {
    const doc = await this.talentCollection.findOne(
      {
        linkedEmploymentProfileId: employmentProfileId,
        talentOrigin: "INTERNAL",
        operationalStatus: {
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

function toTalentListItemView(
  document: TalentReadDocument,
): TalentListItemView {
  return {
    id: document._id,
    talentCode: document.talentCode,
    stageName: document.stageName,
    legalName: document.legalName,
    displayShortName: document.displayShortName,
    talentOrigin: document.talentOrigin,
    operationalStatus: document.operationalStatus,
    managerEmploymentProfileId: document.managerEmploymentProfileId,
    linkedEmploymentProfileId: document.linkedEmploymentProfileId,
    commercialParticipationStatus: document.commercialParticipationStatus,
    livestreamEligible: document.livestreamEligible,
    eventEligible: document.eventEligible,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

function toTalentDetailView(document: TalentReadDocument): TalentDetailView {
  return {
    ...toTalentListItemView(document),
    externalRef: document.externalRef,
    profileSummary: document.profileSummary,
  };
}

function toSortSpec(
  input: Pick<ListTalentReadInput, "sortField" | "sortDirection">,
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

function toSortDocument(spec: SortSpec): Record<string, 1 | -1> {
  if (spec.kind === "default") {
    return {
      talentCode: 1,
      _id: 1,
    };
  }

  const direction = toDirectionValue(spec.direction);

  return {
    [spec.field]: direction,
    _id: direction,
  };
}

function buildCursorFromDocument(
  spec: SortSpec,
  document: TalentReadDocument,
  querySignature: string,
): EncodedCursor {
  if (spec.kind === "default") {
    return {
      kind: "default",
      querySignature,
      talentCode: document.talentCode,
      id: document._id,
    };
  }

  return {
    kind: "field",
    querySignature,
    field: spec.field,
    direction: spec.direction,
    value: readSortFieldValue(document, spec.field),
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

function buildSearchFilter(search: string): Record<string, unknown> {
  const normalizedNamePrefix = normalizeNamePrefix(search);
  const talentCodePrefix = normalizeTalentCodePrefix(search);

  return {
    $or: [
      buildPrefixRange("talentCode", talentCodePrefix),
      buildPrefixRange("normalizedStageName", normalizedNamePrefix),
      buildPrefixRange("normalizedLegalName", normalizedNamePrefix),
      buildPrefixRange("normalizedDisplayShortName", normalizedNamePrefix),
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
          talentCode: {
            $gt: cursor.talentCode,
          },
        },
        {
          talentCode: cursor.talentCode,
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

  const comparisonOperator = spec.direction === "ASC" ? "$gt" : "$lt";

  return {
    $or: [
      {
        [spec.field]: {
          [comparisonOperator]: cursor.value,
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

function encodeCursor(cursor: EncodedCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(
  cursor: string,
  expectedSpec: SortSpec,
  expectedQuerySignature: string,
): EncodedCursor {
  const normalized = cursor.trim();

  if (!normalized) {
    throw invalidCursorError();
  }

  let decodedText: string;

  try {
    decodedText = Buffer.from(normalized, "base64url").toString("utf8");
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
    typeof candidate.querySignature !== "string" ||
    candidate.querySignature !== expectedQuerySignature
  ) {
    throw invalidCursorError();
  }

  if (expectedSpec.kind === "default") {
    if (candidate.kind !== "default") {
      throw invalidCursorError();
    }

    if (
      typeof candidate.talentCode !== "string" ||
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
      querySignature: candidate.querySignature,
      talentCode: candidate.talentCode,
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

  if (
    expectedSpec.field === "talentCode" ||
    expectedSpec.field === "stageName" ||
    expectedSpec.field === "legalName"
  ) {
    if (typeof value !== "string") {
      throw invalidCursorError();
    }
  } else if (typeof value !== "number" || !Number.isInteger(value)) {
    throw invalidCursorError();
  }

  return {
    kind: "field",
    querySignature: candidate.querySignature,
    field: expectedSpec.field,
    direction: expectedSpec.direction,
    value,
    id,
  };
}

function buildCursorQuerySignature(
  input: ListTalentReadInput,
  sortSpec: SortSpec,
): string {
  return JSON.stringify({
    operationalStatus: input.operationalStatus ?? null,
    activeMemberOfGroupIds: input.activeMemberOfGroupIds
      ? [...input.activeMemberOfGroupIds].sort()
      : null,
    talentOrigin: input.talentOrigin ?? null,
    managerEmploymentProfileId: input.managerEmploymentProfileId ?? null,
    hasLinkedEmploymentProfile: input.hasLinkedEmploymentProfile ?? null,
    commercialParticipationStatus: input.commercialParticipationStatus ?? null,
    livestreamEligible: input.livestreamEligible ?? null,
    eventEligible: input.eventEligible ?? null,
    search: input.search ?? null,
    limit: input.limit,
    sort:
      sortSpec.kind === "default"
        ? {
            kind: "default",
          }
        : {
            kind: "field",
            field: sortSpec.field,
            direction: sortSpec.direction,
          },
  });
}

function readSortFieldValue(
  document: TalentReadDocument,
  field: TalentSortField,
): string | number {
  switch (field) {
    case "talentCode":
      return document.talentCode;

    case "stageName":
      return document.stageName;

    case "legalName":
      return document.legalName;

    case "createdAt":
      return document.createdAt;
  }
}

function toDirectionValue(direction: TalentSortDirection): 1 | -1 {
  return direction === "ASC" ? 1 : -1;
}

function normalizeNamePrefix(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

function normalizeTalentCodePrefix(value: string): string {
  return value.trim();
}

function invalidCursorError(): TalentValidationError {
  return new TalentValidationError("cursor is invalid");
}
