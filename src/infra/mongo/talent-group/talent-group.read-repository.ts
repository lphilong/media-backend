import { ClientSession, Collection, Db } from "mongodb";
import { BaseRepository } from "@infra/database/repository";
import { TalentTalentGroupReadonlyAccess } from "@modules/talent/domain/talent-talent-group-readonly-access";
import { TalentGroupValidationError } from "@modules/talent-group/domain/talent-group.errors";
import {
  TalentGroupByTalentListItemView,
  TalentGroupDetailView,
  TalentGroupListItemView,
  TalentGroupMemberListItemView,
  TalentGroupMemberStatus,
  TalentGroupSortDirection,
  TalentGroupSortField,
  TalentGroupStatus,
} from "@modules/talent-group/domain/talent-group.types";
import {
  ListTalentGroupMembersReadInput,
  ListTalentGroupMembersReadResult,
  ListTalentGroupReadInput,
  ListTalentGroupReadResult,
  ListTalentGroupsByTalentReadInput,
  ListTalentGroupsByTalentReadResult,
  TalentGroupReadRepository,
} from "@modules/talent-group/read/talent-group.read-repository";
import { ReferenceSummary } from "@modules/reference-summary";
import {
  TalentOperationalStatus,
  TalentOrigin,
} from "@modules/talent/domain/talent.types";
import { deriveTalentDisplaySummary } from "@modules/talent/domain/talent-display";

interface TalentGroupReadDocument {
  readonly _id: string;
  readonly groupCode: string;
  readonly name: string;
  readonly normalizedName: string;
  readonly shortName: string | null;
  readonly normalizedShortName: string | null;
  readonly description: string | null;
  readonly externalRef: string | null;
  readonly status: TalentGroupStatus;
  readonly displayOrder: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

interface TalentGroupMemberReadDocument {
  readonly _id: string;
  readonly groupId: string;
  readonly talentId: string;
  readonly membershipStatus: TalentGroupMemberStatus;
  readonly lineupOrder: number;
  readonly joinedAt: number;
  readonly leftAt: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

interface TalentReferenceDocument {
  readonly _id: string;
  readonly talentCode: string;
  readonly stageName: string;
  readonly legalName: string;
  readonly displayShortName: string | null;
  readonly talentOrigin: TalentOrigin;
  readonly linkedEmploymentProfileId: string | null;
  readonly operationalStatus: TalentOperationalStatus;
}

interface EmploymentProfileReferenceDocument {
  readonly _id: string;
  readonly employeeCode: string;
  readonly legalName: string;
  readonly displayName: string;
  readonly employmentStatus: string;
}

interface TalentGroupMembershipSummary {
  readonly membershipId: string;
  readonly talentId: string;
  readonly membershipStatus: TalentGroupMemberStatus;
  readonly lineupOrder: number;
  readonly joinedAt: number;
}

type SortSpec =
  | {
      readonly kind: "default";
    }
  | {
      readonly kind: "field";
      readonly field: TalentGroupSortField;
      readonly direction: TalentGroupSortDirection;
    };

type EncodedCursor =
  | {
      readonly kind: "default";
      readonly displayOrder: number;
      readonly name: string;
      readonly id: string;
    }
  | {
      readonly kind: "field";
      readonly field: TalentGroupSortField;
      readonly direction: TalentGroupSortDirection;
      readonly value: string | number;
      readonly id: string;
    };

interface MemberCursor {
  readonly lineupOrder: number;
  readonly id: string;
}

interface CursorEnvelope<TPosition> {
  readonly queryKey: string;
  readonly position: TPosition;
}

export class NativeMongoTalentGroupReadRepository
  extends BaseRepository<TalentGroupReadDocument>
  implements TalentGroupReadRepository
{
  private readonly memberCollection: Collection<TalentGroupMemberReadDocument>;
  private readonly talentCollection: Collection<TalentReferenceDocument>;
  private readonly employmentProfileCollection: Collection<EmploymentProfileReferenceDocument>;

  constructor(db: Db) {
    super(db, "talent_groups");
    this.memberCollection = db.collection<TalentGroupMemberReadDocument>(
      "talent_group_members",
    );
    this.talentCollection = db.collection<TalentReferenceDocument>("talents");
    this.employmentProfileCollection =
      db.collection<EmploymentProfileReferenceDocument>("employment_profiles");
  }

  async listTalentGroups(
    input: ListTalentGroupReadInput,
  ): Promise<ListTalentGroupReadResult> {
    const sortSpec = toSortSpec(input);
    const queryKey = buildListTalentGroupsCursorKey(input, sortSpec);
    const cursor =
      input.cursor === undefined
        ? undefined
        : decodeCursor(input.cursor, queryKey, sortSpec);
    const queryFilters: Array<Record<string, unknown>> = [
      input.status
        ? {
            status: input.status,
          }
        : {
            status: {
              $ne: "ARCHIVED",
            },
          },
    ];

    if (input.groupIds) {
      const groupIds = [...new Set(input.groupIds)];

      if (groupIds.length === 0) {
        return {
          items: [],
        };
      }

      queryFilters.push({
        _id: {
          $in: groupIds,
        },
      });
    }

    if (input.containsTalentId) {
      const groupIds = await this.memberCollection.distinct("groupId", {
        talentId: input.containsTalentId,
        membershipStatus: {
          $ne: "REMOVED",
        },
      });

      if (groupIds.length === 0) {
        return {
          items: [],
        };
      }

      queryFilters.push({
        _id: {
          $in: groupIds,
        },
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

    return {
      items: page.map((doc) => toTalentGroupListItemView(doc)),
      nextCursor:
        hasNext && page.length > 0
          ? encodeCursor(
              queryKey,
              buildCursorFromDocument(sortSpec, page[page.length - 1]),
            )
          : undefined,
    };
  }

  async getTalentGroupDetail(
    groupId: string,
  ): Promise<TalentGroupDetailView | null> {
    const doc = await this.collection.findOne({
      _id: groupId,
    });

    return doc ? toTalentGroupDetailView(doc) : null;
  }

  async listTalentGroupMembers(
    input: ListTalentGroupMembersReadInput,
  ): Promise<ListTalentGroupMembersReadResult> {
    const queryKey = buildListTalentGroupMembersCursorKey(input);
    const cursor =
      input.cursor === undefined
        ? undefined
        : decodeMemberCursor(input.cursor, queryKey);
    const filters: Array<Record<string, unknown>> = [
      {
        groupId: input.groupId,
      },
      {
        membershipStatus: {
          $in: ["ACTIVE", "INACTIVE"],
        },
      },
    ];

    if (cursor) {
      filters.push(buildMemberPageAfterFilter(cursor));
    }

    const docs = await this.memberCollection
      .find(buildQuery(filters))
      .sort({
        lineupOrder: 1,
        _id: 1,
      })
      .limit(input.limit + 1)
      .toArray();

    const hasNext = docs.length > input.limit;
    const page = hasNext ? docs.slice(0, input.limit) : docs;

    const items = await enrichTalentGroupMemberReferenceSummaries(
      page.map((doc) => toTalentGroupMemberListItemView(doc)),
      this.talentCollection,
      this.employmentProfileCollection,
    );

    return {
      items,
      nextCursor:
        hasNext && page.length > 0
          ? encodeMemberCursor({
              queryKey,
              position: {
                lineupOrder: page[page.length - 1]?.lineupOrder ?? 0,
                id: page[page.length - 1]?._id ?? "",
              },
            })
          : undefined,
    };
  }

  async listTalentGroupsByTalent(
    input: ListTalentGroupsByTalentReadInput,
  ): Promise<ListTalentGroupsByTalentReadResult> {
    const memberships = await this.memberCollection
      .find({
        talentId: input.talentId,
        membershipStatus: {
          $in: ["ACTIVE", "INACTIVE"],
        },
      })
      .toArray();

    if (memberships.length === 0) {
      return {
        items: [],
      };
    }

    const membershipByGroupId = new Map<string, TalentGroupMembershipSummary>();

    for (const membership of memberships) {
      membershipByGroupId.set(membership.groupId, {
        membershipId: membership._id,
        talentId: membership.talentId,
        membershipStatus: membership.membershipStatus,
        lineupOrder: membership.lineupOrder,
        joinedAt: membership.joinedAt,
      });
    }

    const sortSpec = toSortSpec(input);
    const queryKey = buildListTalentGroupsByTalentCursorKey(input, sortSpec);
    const cursor =
      input.cursor === undefined
        ? undefined
        : decodeCursor(input.cursor, queryKey, sortSpec);
    const queryFilters: Array<Record<string, unknown>> = [
      {
        _id: {
          $in: [...membershipByGroupId.keys()],
        },
      },
    ];

    if (input.groupIds) {
      const groupIds = [...new Set(input.groupIds)];

      if (groupIds.length === 0) {
        return {
          items: [],
        };
      }

      queryFilters.push({
        _id: {
          $in: groupIds,
        },
      });
    }

    if (input.status) {
      queryFilters.push({
        status: input.status,
      });
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

    const items = await enrichTalentGroupMemberReferenceSummaries(
      page.map((doc) =>
        toTalentGroupByTalentListItemView(
          doc,
          membershipByGroupId.get(doc._id),
        ),
      ),
      this.talentCollection,
      this.employmentProfileCollection,
    );

    return {
      items,
      nextCursor:
        hasNext && page.length > 0
          ? encodeCursor(
              queryKey,
              buildCursorFromDocument(sortSpec, page[page.length - 1]),
            )
          : undefined,
    };
  }
}

async function enrichTalentGroupMemberReferenceSummaries<
  T extends {
    readonly talentId: string;
  },
>(
  items: readonly T[],
  collection: Collection<TalentReferenceDocument>,
  employmentProfileCollection: Collection<EmploymentProfileReferenceDocument>,
): Promise<readonly (T & { readonly talentRef: ReferenceSummary | null })[]> {
  if (items.length === 0) {
    return items.map((item) => ({
      ...item,
      talentRef: null,
    }));
  }

  const talentIds = new Set<string>();

  for (const item of items) {
    addRequiredReferenceId(talentIds, item.talentId);
  }

  const talentRefMap = await loadTalentReferenceSummaries(
    talentIds,
    collection,
    employmentProfileCollection,
  );

  return items.map((item) => ({
    ...item,
    talentRef: talentRefMap.get(item.talentId) ?? null,
  }));
}

async function loadTalentReferenceSummaries(
  ids: ReadonlySet<string>,
  collection: Collection<TalentReferenceDocument>,
  employmentProfileCollection: Collection<EmploymentProfileReferenceDocument>,
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
          talentOrigin: 1,
          linkedEmploymentProfileId: 1,
          operationalStatus: 1,
        },
      },
    )
    .toArray();

  const linkedEmploymentProfileRefMap =
    await loadEmploymentProfileReferenceSummaries(
      documents
        .map((document) => document.linkedEmploymentProfileId)
        .filter((value): value is string => typeof value === "string"),
      employmentProfileCollection,
    );

  return new Map(
    documents.map((document) => [
      document._id,
      toTalentReferenceSummary(
        document,
        document.linkedEmploymentProfileId
          ? (linkedEmploymentProfileRefMap.get(document.linkedEmploymentProfileId) ?? null)
          : null,
      ),
    ]),
  );
}

async function loadEmploymentProfileReferenceSummaries(
  ids: readonly string[],
  collection: Collection<EmploymentProfileReferenceDocument>,
): Promise<Map<string, ReferenceSummary>> {
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length === 0) {
    return new Map();
  }

  const documents = await collection
    .find(
      {
        _id: {
          $in: uniqueIds,
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
      {
        id: document._id,
        code: document.employeeCode,
        displayName: document.displayName,
        name: document.legalName,
        status: document.employmentStatus,
      },
    ]),
  );
}

function toTalentReferenceSummary(
  document: TalentReferenceDocument,
  linkedEmploymentProfile: ReferenceSummary | null,
): ReferenceSummary {
  const display = deriveTalentDisplaySummary(
    document,
    linkedEmploymentProfile,
  );

  return {
    id: document._id,
    code: document.talentCode,
    name: display.displayName,
    displayName: display.displayName,
    status: document.operationalStatus,
  };
}

function addRequiredReferenceId(ids: Set<string>, value: string): void {
  const normalized = value.trim();

  if (normalized) {
    ids.add(normalized);
  }
}

export class NativeMongoTalentTalentGroupReadonlyAccess implements TalentTalentGroupReadonlyAccess {
  private readonly memberCollection: Collection<TalentGroupMemberReadDocument>;

  constructor(db: Db) {
    this.memberCollection = db.collection<TalentGroupMemberReadDocument>(
      "talent_group_members",
    );
  }

  async hasActiveMembershipsForTalent(
    talentId: string,
    session?: ClientSession,
  ): Promise<boolean> {
    const doc = await this.memberCollection.findOne(
      {
        talentId,
        membershipStatus: "ACTIVE",
      },
      {
        projection: { _id: 1 },
        ...(session ? { session } : {}),
      },
    );

    return doc !== null;
  }

  async hasNonRemovedMembershipsForTalent(
    talentId: string,
    session?: ClientSession,
  ): Promise<boolean> {
    const doc = await this.memberCollection.findOne(
      {
        talentId,
        membershipStatus: {
          $ne: "REMOVED",
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

function toTalentGroupListItemView(
  doc: TalentGroupReadDocument,
): TalentGroupListItemView {
  return {
    id: doc._id,
    groupCode: doc.groupCode,
    name: doc.name,
    shortName: doc.shortName,
    status: doc.status,
    displayOrder: doc.displayOrder,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function toTalentGroupDetailView(
  doc: TalentGroupReadDocument,
): TalentGroupDetailView {
  return {
    ...toTalentGroupListItemView(doc),
    description: doc.description,
    externalRef: doc.externalRef,
  };
}

function toTalentGroupMemberListItemView(
  doc: TalentGroupMemberReadDocument,
): TalentGroupMemberListItemView {
  return {
    id: doc._id,
    groupId: doc.groupId,
    talentId: doc.talentId,
    membershipStatus: doc.membershipStatus,
    lineupOrder: doc.lineupOrder,
    joinedAt: doc.joinedAt,
    leftAt: doc.leftAt,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function toTalentGroupByTalentListItemView(
  doc: TalentGroupReadDocument,
  membership: TalentGroupMembershipSummary | undefined,
): TalentGroupByTalentListItemView {
  if (!membership) {
    throw new TalentGroupValidationError(
      "Talent group membership projection is inconsistent",
    );
  }

  return {
    groupId: doc._id,
    id: doc._id,
    groupCode: doc.groupCode,
    name: doc.name,
    shortName: doc.shortName,
    status: doc.status,
    displayOrder: doc.displayOrder,
    membershipId: membership.membershipId,
    talentId: membership.talentId,
    membershipStatus: membership.membershipStatus,
    lineupOrder: membership.lineupOrder,
    joinedAt: membership.joinedAt,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function toSortSpec(
  input: Pick<ListTalentGroupReadInput, "sortField" | "sortDirection">,
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
      displayOrder: 1,
      name: 1,
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
  doc: TalentGroupReadDocument,
): EncodedCursor {
  if (spec.kind === "default") {
    return {
      kind: "default",
      displayOrder: doc.displayOrder,
      name: doc.name,
      id: doc._id,
    };
  }

  return {
    kind: "field",
    field: spec.field,
    direction: spec.direction,
    value: readSortFieldValue(doc, spec.field),
    id: doc._id,
  };
}

function buildListTalentGroupsCursorKey(
  input: ListTalentGroupReadInput,
  sortSpec: SortSpec,
): string {
  return JSON.stringify({
    surface: "listTalentGroups",
    groupIds: input.groupIds ? [...input.groupIds].sort() : null,
    status: input.status ?? null,
    containsTalentId: input.containsTalentId ?? null,
    search: input.search ?? null,
    sort: toCursorSortShape(sortSpec),
  });
}

function buildListTalentGroupsByTalentCursorKey(
  input: ListTalentGroupsByTalentReadInput,
  sortSpec: SortSpec,
): string {
  return JSON.stringify({
    surface: "listTalentGroupsByTalent",
    talentId: input.talentId,
    groupIds: input.groupIds ? [...input.groupIds].sort() : null,
    status: input.status ?? null,
    sort: toCursorSortShape(sortSpec),
  });
}

function buildListTalentGroupMembersCursorKey(
  input: ListTalentGroupMembersReadInput,
): string {
  return JSON.stringify({
    surface: "listTalentGroupMembers",
    groupId: input.groupId,
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

  return {
    $and: [...filters],
  };
}

function buildSearchFilter(search: string): Record<string, unknown> {
  const normalizedNamePrefix = normalizeNamePrefix(search);
  const groupCodePrefix = normalizeGroupCodePrefix(search);

  return {
    $or: [
      buildPrefixRange("groupCode", groupCodePrefix),
      buildPrefixRange("normalizedName", normalizedNamePrefix),
      buildPrefixRange("normalizedShortName", normalizedNamePrefix),
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
          displayOrder: {
            $gt: cursor.displayOrder,
          },
        },
        {
          displayOrder: cursor.displayOrder,
          name: {
            $gt: cursor.name,
          },
        },
        {
          displayOrder: cursor.displayOrder,
          name: cursor.name,
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

function encodeCursor(queryKey: string, cursor: EncodedCursor): string {
  return Buffer.from(
    JSON.stringify({
      queryKey,
      position: cursor,
    } satisfies CursorEnvelope<EncodedCursor>),
    "utf8",
  ).toString("base64url");
}

function decodeCursor(
  cursor: string,
  expectedQueryKey: string,
  expectedSpec: SortSpec,
): EncodedCursor {
  const candidate = decodeCursorEnvelope(cursor);

  if (candidate.queryKey !== expectedQueryKey) {
    throw invalidCursorError();
  }

  const position = candidate.position;

  if (expectedSpec.kind === "default") {
    if (!isRecord(position) || position.kind !== "default") {
      throw invalidCursorError();
    }

    if (
      typeof position.displayOrder !== "number" ||
      !Number.isInteger(position.displayOrder) ||
      typeof position.name !== "string" ||
      typeof position.id !== "string"
    ) {
      throw invalidCursorError();
    }

    const id = position.id.trim();

    if (!id) {
      throw invalidCursorError();
    }

    return {
      kind: "default",
      displayOrder: position.displayOrder,
      name: position.name,
      id,
    };
  }

  if (
    !isRecord(position) ||
    position.kind !== "field" ||
    position.field !== expectedSpec.field ||
    position.direction !== expectedSpec.direction ||
    typeof position.id !== "string"
  ) {
    throw invalidCursorError();
  }

  const id = position.id.trim();

  if (!id) {
    throw invalidCursorError();
  }

  const value = position.value;

  if (expectedSpec.field === "groupCode" || expectedSpec.field === "name") {
    if (typeof value !== "string") {
      throw invalidCursorError();
    }
  } else if (typeof value !== "number" || !Number.isInteger(value)) {
    throw invalidCursorError();
  }

  return {
    kind: "field",
    field: expectedSpec.field,
    direction: expectedSpec.direction,
    value,
    id,
  };
}

function buildMemberPageAfterFilter(
  cursor: MemberCursor,
): Record<string, unknown> {
  return {
    $or: [
      {
        lineupOrder: {
          $gt: cursor.lineupOrder,
        },
      },
      {
        lineupOrder: cursor.lineupOrder,
        _id: {
          $gt: cursor.id,
        },
      },
    ],
  };
}

function encodeMemberCursor(cursor: CursorEnvelope<MemberCursor>): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeMemberCursor(
  cursor: string,
  expectedQueryKey: string,
): MemberCursor {
  const envelope = decodeCursorEnvelope(cursor);

  if (envelope.queryKey !== expectedQueryKey) {
    throw invalidCursorError();
  }

  if (!isRecord(envelope.position)) {
    throw invalidCursorError();
  }

  const candidate = envelope.position;

  if (
    typeof candidate.lineupOrder !== "number" ||
    !Number.isInteger(candidate.lineupOrder) ||
    typeof candidate.id !== "string"
  ) {
    throw invalidCursorError();
  }

  const id = candidate.id.trim();

  if (!id) {
    throw invalidCursorError();
  }

  return {
    lineupOrder: candidate.lineupOrder,
    id,
  };
}

function readSortFieldValue(
  doc: TalentGroupReadDocument,
  field: TalentGroupSortField,
): string | number {
  switch (field) {
    case "groupCode":
      return doc.groupCode;

    case "name":
      return doc.name;

    case "createdAt":
      return doc.createdAt;

    case "displayOrder":
      return doc.displayOrder;
  }
}

function toDirectionValue(direction: TalentGroupSortDirection): 1 | -1 {
  return direction === "ASC" ? 1 : -1;
}

function toCursorSortShape(spec: SortSpec): Record<string, unknown> {
  if (spec.kind === "default") {
    return {
      kind: "default",
    };
  }

  return {
    kind: "field",
    field: spec.field,
    direction: spec.direction,
  };
}

function decodeCursorEnvelope(cursor: string): CursorEnvelope<unknown> {
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

  if (!isRecord(payload)) {
    throw invalidCursorError();
  }

  if (
    typeof payload.queryKey !== "string" ||
    payload.queryKey.length === 0 ||
    !("position" in payload)
  ) {
    throw invalidCursorError();
  }

  return {
    queryKey: payload.queryKey,
    position: payload.position,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeNamePrefix(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

function normalizeGroupCodePrefix(value: string): string {
  return value.trim();
}

function invalidCursorError(): TalentGroupValidationError {
  return new TalentGroupValidationError("cursor is invalid");
}
