import {
  ClientSession,
  Collection,
  Db,
} from "mongodb";
import { BaseRepository } from "@infra/database/repository";
import {
  PlatformAccountOrgUnitReadonlyAccess,
  PlatformAccountReferencedOrgUnit,
} from "@modules/platform-account/domain/platform-account-org-unit-readonly-access";
import {
  PlatformAccountReferencedTalent,
  PlatformAccountTalentReadonlyAccess,
} from "@modules/platform-account/domain/platform-account-talent-readonly-access";
import {
  PlatformAccountReferencedTalentGroup,
  PlatformAccountTalentGroupReadonlyAccess,
} from "@modules/platform-account/domain/platform-account-talent-group-readonly-access";
import { PlatformAccountValidationError } from "@modules/platform-account/domain/platform-account.errors";
import {
  PlatformAccountDetailView,
  PlatformAccountListItemView,
  PlatformAccountOperationalStatus,
  PlatformAccountOwnerKind,
  PlatformAccountPlatform,
  PlatformAccountSortDirection,
  PlatformAccountSortField,
  PlatformAccountSurfaceType,
} from "@modules/platform-account/domain/platform-account.types";
import {
  ListPlatformAccountReadInput,
  ListPlatformAccountReadResult,
  PlatformAccountReadRepository,
} from "@modules/platform-account/read/platform-account.read-repository";
import { OrgUnitPlatformAccountReadonlyAccess } from "@modules/org-unit/domain/org-unit-platform-account-readonly-access";
import { OrgUnitStatus } from "@modules/org-unit/domain/org-unit.types";
import { TalentPlatformAccountReadonlyAccess } from "@modules/talent/domain/talent-platform-account-readonly-access";
import { TalentOperationalStatus } from "@modules/talent/domain/talent.types";
import { TalentGroupPlatformAccountReadonlyAccess } from "@modules/talent-group/domain/talent-group-platform-account-readonly-access";
import { TalentGroupStatus } from "@modules/talent-group/domain/talent-group.types";
import { ReferenceSummary } from "@modules/reference-summary";

interface PlatformAccountReadDocument {
  readonly _id: string;
  readonly accountCode: string;
  readonly platform: PlatformAccountPlatform;
  readonly platformSurfaceType: PlatformAccountSurfaceType;
  readonly displayName: string;
  readonly normalizedDisplayName: string;
  readonly handle: string | null;
  readonly normalizedHandle: string | null;
  readonly externalPlatformId: string | null;
  readonly profileUrl: string | null;
  readonly normalizedProfileUrl: string | null;
  readonly ownerKind: PlatformAccountOwnerKind;
  readonly ownerOrgUnitId: string | null;
  readonly ownerTalentId: string | null;
  readonly ownerTalentGroupId: string | null;
  readonly operationalStatus: PlatformAccountOperationalStatus;
  readonly livestreamEnabled: boolean;
  readonly contentPublishingEnabled: boolean;
  readonly monetizationEnabled: boolean;
  readonly description: string | null;
  readonly externalRef: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

interface OrgUnitReferenceDocument {
  readonly _id: string;
  readonly code: string;
  readonly name: string;
  readonly status: OrgUnitStatus;
}

interface TalentReferenceDocument {
  readonly _id: string;
  readonly talentCode: string;
  readonly stageName: string;
  readonly legalName: string;
  readonly displayShortName: string | null;
  readonly operationalStatus: TalentOperationalStatus;
}

interface TalentGroupReferenceDocument {
  readonly _id: string;
  readonly groupCode: string;
  readonly name: string;
  readonly status: TalentGroupStatus;
}

type SortSpec =
  | {
      readonly kind: "default";
    }
  | {
      readonly kind: "field";
      readonly field: PlatformAccountSortField;
      readonly direction: PlatformAccountSortDirection;
    };

type EncodedCursor =
  | {
      readonly kind: "default";
      readonly queryShapeSignature: string;
      readonly accountCode: string;
      readonly id: string;
    }
  | {
      readonly kind: "field";
      readonly queryShapeSignature: string;
      readonly field: PlatformAccountSortField;
      readonly direction: PlatformAccountSortDirection;
      readonly value: string | number;
      readonly id: string;
    };

export class NativeMongoPlatformAccountReadRepository
  extends BaseRepository<PlatformAccountReadDocument>
  implements PlatformAccountReadRepository
{
  private readonly orgUnitCollection: Collection<OrgUnitReferenceDocument>;
  private readonly talentCollection: Collection<TalentReferenceDocument>;
  private readonly talentGroupCollection: Collection<TalentGroupReferenceDocument>;

  constructor(db: Db) {
    super(db, "platform_accounts");
    this.orgUnitCollection =
      db.collection<OrgUnitReferenceDocument>(
        "org_units",
      );
    this.talentCollection =
      db.collection<TalentReferenceDocument>(
        "talents",
      );
    this.talentGroupCollection =
      db.collection<TalentGroupReferenceDocument>(
        "talent_groups",
      );
  }

  async listPlatformAccounts(
    input: ListPlatformAccountReadInput,
  ): Promise<ListPlatformAccountReadResult> {
    const sortSpec = toSortSpec(input);
    const queryShapeSignature =
      buildCursorQueryShapeSignature(
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

    if (input.platformAccountIds) {
      queryFilters.push({ _id: { $in: [...input.platformAccountIds] } });
    }

    if (input.platform) {
      queryFilters.push({
        platform: input.platform,
      });
    }

    if (input.platformSurfaceType) {
      queryFilters.push({
        platformSurfaceType:
          input.platformSurfaceType,
      });
    }

    if (input.operationalStatus) {
      queryFilters.push({
        operationalStatus:
          input.operationalStatus,
      });
    } else {
      queryFilters.push({
        operationalStatus: {
          $ne: "ARCHIVED",
        },
      });
    }

    if (input.ownerKind) {
      queryFilters.push({
        ownerKind: input.ownerKind,
      });
    }

    if (input.ownerOrgUnitId) {
      queryFilters.push({
        ownerOrgUnitId: input.ownerOrgUnitId,
      });
    }

    if (input.ownerTalentId) {
      queryFilters.push({
        ownerTalentId: input.ownerTalentId,
      });
    }

    if (input.ownerTalentGroupId) {
      queryFilters.push({
        ownerTalentGroupId:
          input.ownerTalentGroupId,
      });
    }

    if (input.livestreamEnabled !== undefined) {
      queryFilters.push({
        livestreamEnabled:
          input.livestreamEnabled,
      });
    }

    if (
      input.contentPublishingEnabled !== undefined
    ) {
      queryFilters.push({
        contentPublishingEnabled:
          input.contentPublishingEnabled,
      });
    }

    if (input.monetizationEnabled !== undefined) {
      queryFilters.push({
        monetizationEnabled:
          input.monetizationEnabled,
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
      await enrichPlatformAccountOwnerReferenceSummaries(
        page.map((doc) =>
          toPlatformAccountListItemView(doc),
        ),
        {
          orgUnitCollection: this.orgUnitCollection,
          talentCollection: this.talentCollection,
          talentGroupCollection: this.talentGroupCollection,
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
                queryShapeSignature,
              ),
            )
          : undefined,
    };
  }

  async getPlatformAccountDetail(
    platformAccountId: string,
  ): Promise<PlatformAccountDetailView | null> {
    const doc = await this.collection.findOne({
      _id: platformAccountId,
    });

    if (!doc) {
      return null;
    }

    const [detail] =
      await enrichPlatformAccountOwnerReferenceSummaries(
        [toPlatformAccountDetailView(doc)],
        {
          orgUnitCollection: this.orgUnitCollection,
          talentCollection: this.talentCollection,
          talentGroupCollection: this.talentGroupCollection,
        },
      );

    return detail ?? null;
  }
}

async function enrichPlatformAccountOwnerReferenceSummaries<
  T extends {
    readonly ownerKind: PlatformAccountOwnerKind;
    readonly ownerOrgUnitId: string | null;
    readonly ownerTalentId: string | null;
    readonly ownerTalentGroupId: string | null;
  },
>(
  items: readonly T[],
  collections: {
    readonly orgUnitCollection: Collection<OrgUnitReferenceDocument>;
    readonly talentCollection: Collection<TalentReferenceDocument>;
    readonly talentGroupCollection: Collection<TalentGroupReferenceDocument>;
  },
): Promise<readonly (T & { readonly ownerRef: ReferenceSummary | null })[]> {
  if (items.length === 0) {
    return items.map((item) => ({
      ...item,
      ownerRef: null,
    }));
  }

  const orgUnitIds = new Set<string>();
  const talentIds = new Set<string>();
  const talentGroupIds = new Set<string>();

  for (const item of items) {
    switch (item.ownerKind) {
      case "ORG_UNIT":
        addOptionalReferenceId(orgUnitIds, item.ownerOrgUnitId);
        break;
      case "TALENT":
        addOptionalReferenceId(talentIds, item.ownerTalentId);
        break;
      case "TALENT_GROUP":
        addOptionalReferenceId(
          talentGroupIds,
          item.ownerTalentGroupId,
        );
        break;
    }
  }

  const [orgUnitRefMap, talentRefMap, talentGroupRefMap] =
    await Promise.all([
      loadOrgUnitReferenceSummaries(
        orgUnitIds,
        collections.orgUnitCollection,
      ),
      loadTalentReferenceSummaries(
        talentIds,
        collections.talentCollection,
      ),
      loadTalentGroupReferenceSummaries(
        talentGroupIds,
        collections.talentGroupCollection,
      ),
    ]);

  return items.map((item) => ({
    ...item,
    ownerRef: readPlatformAccountOwnerRef(item, {
      orgUnitRefMap,
      talentRefMap,
      talentGroupRefMap,
    }),
  }));
}

function readPlatformAccountOwnerRef(
  item: {
    readonly ownerKind: PlatformAccountOwnerKind;
    readonly ownerOrgUnitId: string | null;
    readonly ownerTalentId: string | null;
    readonly ownerTalentGroupId: string | null;
  },
  refs: {
    readonly orgUnitRefMap: ReadonlyMap<string, ReferenceSummary>;
    readonly talentRefMap: ReadonlyMap<string, ReferenceSummary>;
    readonly talentGroupRefMap: ReadonlyMap<string, ReferenceSummary>;
  },
): ReferenceSummary | null {
  switch (item.ownerKind) {
    case "ORG_UNIT":
      return item.ownerOrgUnitId
        ? refs.orgUnitRefMap.get(item.ownerOrgUnitId) ?? null
        : null;
    case "TALENT":
      return item.ownerTalentId
        ? refs.talentRefMap.get(item.ownerTalentId) ?? null
        : null;
    case "TALENT_GROUP":
      return item.ownerTalentGroupId
        ? refs.talentGroupRefMap.get(item.ownerTalentGroupId) ?? null
        : null;
  }
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

async function loadTalentReferenceSummaries(
  ids: ReadonlySet<string>,
  collection: Collection<TalentReferenceDocument>,
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

async function loadTalentGroupReferenceSummaries(
  ids: ReadonlySet<string>,
  collection: Collection<TalentGroupReferenceDocument>,
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

function toTalentReferenceSummary(
  document: TalentReferenceDocument,
): ReferenceSummary {
  return {
    id: document._id,
    code: document.talentCode,
    name: document.displayShortName ?? document.stageName ?? document.legalName,
    status: document.operationalStatus,
  };
}

function toTalentGroupReferenceSummary(
  document: TalentGroupReferenceDocument,
): ReferenceSummary {
  return {
    id: document._id,
    code: document.groupCode,
    name: document.name,
    status: document.status,
  };
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

export class NativeMongoPlatformAccountOrgUnitReadonlyAccess
  implements PlatformAccountOrgUnitReadonlyAccess
{
  private readonly collection: Collection<OrgUnitReferenceDocument>;

  constructor(db: Db) {
    this.collection =
      db.collection<OrgUnitReferenceDocument>(
        "org_units",
      );
  }

  async findById(
    orgUnitId: string,
    session?: ClientSession,
  ): Promise<PlatformAccountReferencedOrgUnit | null> {
    const doc = await this.collection.findOne(
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

export class NativeMongoPlatformAccountTalentReadonlyAccess
  implements PlatformAccountTalentReadonlyAccess
{
  private readonly collection: Collection<TalentReferenceDocument>;

  constructor(db: Db) {
    this.collection =
      db.collection<TalentReferenceDocument>(
        "talents",
      );
  }

  async findById(
    talentId: string,
    session?: ClientSession,
  ): Promise<PlatformAccountReferencedTalent | null> {
    const doc = await this.collection.findOne(
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
          operationalStatus:
            doc.operationalStatus,
        }
      : null;
  }
}

export class NativeMongoPlatformAccountTalentGroupReadonlyAccess
  implements PlatformAccountTalentGroupReadonlyAccess
{
  private readonly collection: Collection<TalentGroupReferenceDocument>;

  constructor(db: Db) {
    this.collection =
      db.collection<TalentGroupReferenceDocument>(
        "talent_groups",
      );
  }

  async findById(
    groupId: string,
    session?: ClientSession,
  ): Promise<PlatformAccountReferencedTalentGroup | null> {
    const doc = await this.collection.findOne(
      { _id: groupId },
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

abstract class BaseMongoPlatformAccountOwnershipReadonlyAccess {
  protected readonly collection: Collection<PlatformAccountReadDocument>;

  constructor(db: Db) {
    this.collection =
      db.collection<PlatformAccountReadDocument>(
        "platform_accounts",
      );
  }

  protected async hasOwnedPlatformAccounts(params: {
    readonly ownerKind: PlatformAccountOwnerKind;
    readonly ownerField:
      | "ownerOrgUnitId"
      | "ownerTalentId"
      | "ownerTalentGroupId";
    readonly ownerId: string;
    readonly activeOnly: boolean;
    readonly session?: ClientSession;
  }): Promise<boolean> {
    const doc = await this.collection.findOne(
      {
        ownerKind: params.ownerKind,
        [params.ownerField]: params.ownerId,
        operationalStatus: params.activeOnly
          ? "ACTIVE"
          : {
              $ne: "ARCHIVED",
            },
      },
      {
        projection: { _id: 1 },
        ...(params.session
          ? { session: params.session }
          : {}),
      },
    );

    return doc !== null;
  }
}

export class NativeMongoOrgUnitPlatformAccountReadonlyAccess
  extends BaseMongoPlatformAccountOwnershipReadonlyAccess
  implements OrgUnitPlatformAccountReadonlyAccess
{
  async hasActiveOwnedPlatformAccountsForOrgUnit(
    orgUnitId: string,
    session?: ClientSession,
  ): Promise<boolean> {
    return this.hasOwnedPlatformAccounts({
      ownerKind: "ORG_UNIT",
      ownerField: "ownerOrgUnitId",
      ownerId: orgUnitId,
      activeOnly: true,
      session,
    });
  }

  async hasNonArchivedOwnedPlatformAccountsForOrgUnit(
    orgUnitId: string,
    session?: ClientSession,
  ): Promise<boolean> {
    return this.hasOwnedPlatformAccounts({
      ownerKind: "ORG_UNIT",
      ownerField: "ownerOrgUnitId",
      ownerId: orgUnitId,
      activeOnly: false,
      session,
    });
  }
}

export class NativeMongoTalentPlatformAccountReadonlyAccess
  extends BaseMongoPlatformAccountOwnershipReadonlyAccess
  implements TalentPlatformAccountReadonlyAccess
{
  async hasActiveOwnedPlatformAccountsForTalent(
    talentId: string,
    session?: ClientSession,
  ): Promise<boolean> {
    return this.hasOwnedPlatformAccounts({
      ownerKind: "TALENT",
      ownerField: "ownerTalentId",
      ownerId: talentId,
      activeOnly: true,
      session,
    });
  }

  async hasNonArchivedOwnedPlatformAccountsForTalent(
    talentId: string,
    session?: ClientSession,
  ): Promise<boolean> {
    return this.hasOwnedPlatformAccounts({
      ownerKind: "TALENT",
      ownerField: "ownerTalentId",
      ownerId: talentId,
      activeOnly: false,
      session,
    });
  }
}

export class NativeMongoTalentGroupPlatformAccountReadonlyAccess
  extends BaseMongoPlatformAccountOwnershipReadonlyAccess
  implements TalentGroupPlatformAccountReadonlyAccess
{
  async hasActiveOwnedPlatformAccountsForTalentGroup(
    groupId: string,
    session?: ClientSession,
  ): Promise<boolean> {
    return this.hasOwnedPlatformAccounts({
      ownerKind: "TALENT_GROUP",
      ownerField: "ownerTalentGroupId",
      ownerId: groupId,
      activeOnly: true,
      session,
    });
  }

  async hasNonArchivedOwnedPlatformAccountsForTalentGroup(
    groupId: string,
    session?: ClientSession,
  ): Promise<boolean> {
    return this.hasOwnedPlatformAccounts({
      ownerKind: "TALENT_GROUP",
      ownerField: "ownerTalentGroupId",
      ownerId: groupId,
      activeOnly: false,
      session,
    });
  }
}

function toPlatformAccountListItemView(
  document: PlatformAccountReadDocument,
): PlatformAccountListItemView {
  return {
    id: document._id,
    accountCode: document.accountCode,
    platform: document.platform,
    platformSurfaceType:
      document.platformSurfaceType,
    displayName: document.displayName,
    handle: document.handle,
    externalPlatformId:
      document.externalPlatformId,
    profileUrl: document.profileUrl,
    ownerKind: document.ownerKind,
    ownerOrgUnitId:
      document.ownerOrgUnitId,
    ownerTalentId: document.ownerTalentId,
    ownerTalentGroupId:
      document.ownerTalentGroupId,
    operationalStatus:
      document.operationalStatus,
    livestreamEnabled:
      document.livestreamEnabled,
    contentPublishingEnabled:
      document.contentPublishingEnabled,
    monetizationEnabled:
      document.monetizationEnabled,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

function toPlatformAccountDetailView(
  document: PlatformAccountReadDocument,
): PlatformAccountDetailView {
  return {
    ...toPlatformAccountListItemView(document),
    description: document.description,
    externalRef: document.externalRef,
  };
}

function toSortSpec(
  input: Pick<
    ListPlatformAccountReadInput,
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
      accountCode: 1,
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
  document: PlatformAccountReadDocument,
  queryShapeSignature: string,
): EncodedCursor {
  if (spec.kind === "default") {
    return {
      kind: "default",
      queryShapeSignature,
      accountCode: document.accountCode,
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

function buildSearchFilter(
  search: string,
): Record<string, unknown> {
  return {
    $or: [
      buildPrefixRange(
        "accountCode",
        normalizeAccountCodePrefix(search),
      ),
      buildPrefixRange(
        "normalizedDisplayName",
        normalizeDisplayNamePrefix(search),
      ),
      buildPrefixRange(
        "normalizedHandle",
        normalizeHandlePrefix(search),
      ),
      buildPrefixRange(
        "normalizedProfileUrl",
        normalizeProfileUrlPrefix(search),
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
          accountCode: {
            $gt: cursor.accountCode,
          },
        },
        {
          accountCode: cursor.accountCode,
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

  const candidate = payload as Record<
    string,
    unknown
  >;
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
      typeof candidate.accountCode !== "string" ||
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
      accountCode: candidate.accountCode,
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
    expectedSpec.field === "accountCode" ||
    expectedSpec.field === "displayName"
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
    queryShapeSignature,
    field: expectedSpec.field,
    direction: expectedSpec.direction,
    value,
    id,
  };
}

function buildCursorQueryShapeSignature(
  input: ListPlatformAccountReadInput,
  sortSpec: SortSpec,
): string {
  return JSON.stringify({
    platformAccountIds: input.platformAccountIds
      ? [...input.platformAccountIds].sort()
      : null,
    platform: input.platform ?? null,
    platformSurfaceType:
      input.platformSurfaceType ?? null,
    operationalStatus:
      input.operationalStatus ?? null,
    ownerKind: input.ownerKind ?? null,
    ownerOrgUnitId: input.ownerOrgUnitId ?? null,
    ownerTalentId: input.ownerTalentId ?? null,
    ownerTalentGroupId:
      input.ownerTalentGroupId ?? null,
    livestreamEnabled:
      input.livestreamEnabled ?? null,
    contentPublishingEnabled:
      input.contentPublishingEnabled ?? null,
    monetizationEnabled:
      input.monetizationEnabled ?? null,
    search: input.search ?? null,
    sortSpec,
  });
}

function readSortFieldValue(
  document: PlatformAccountReadDocument,
  field: PlatformAccountSortField,
): string | number {
  switch (field) {
    case "accountCode":
      return document.accountCode;

    case "displayName":
      return document.displayName;

    case "createdAt":
      return document.createdAt;
  }
}

function toDirectionValue(
  direction: PlatformAccountSortDirection,
): 1 | -1 {
  return direction === "ASC" ? 1 : -1;
}

function normalizeAccountCodePrefix(
  value: string,
): string {
  return value.trim();
}

function normalizeDisplayNamePrefix(
  value: string,
): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();
}

function normalizeHandlePrefix(
  value: string,
): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/^@/u, "");
}

function normalizeProfileUrlPrefix(
  value: string,
): string {
  const trimmed = value.trim();
  const canonical =
    tryNormalizeAbsoluteProfileUrl(trimmed);

  return canonical ?? trimmed;
}

function tryNormalizeAbsoluteProfileUrl(
  value: string,
): string | null {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  const sourceWithoutFragment =
    stripFragment(trimmed);
  let parsed: URL;

  try {
    parsed = new URL(sourceWithoutFragment);
  } catch {
    return null;
  }

  const preservedQuery =
    extractRawQuerySegment(sourceWithoutFragment);

  parsed.protocol = parsed.protocol.toLowerCase();
  parsed.hostname = parsed.hostname.toLowerCase();

  if (isDefaultPort(parsed)) {
    parsed.port = "";
  }

  parsed.hash = "";
  parsed.search = "";
  parsed.pathname = normalizeUrlPathname(
    parsed.pathname,
  );

  return `${parsed.toString()}${preservedQuery}`;
}

function stripFragment(value: string): string {
  const fragmentIndex = value.indexOf("#");
  return fragmentIndex >= 0
    ? value.slice(0, fragmentIndex)
    : value;
}

function extractRawQuerySegment(
  value: string,
): string {
  const queryIndex = value.indexOf("?");
  return queryIndex >= 0
    ? value.slice(queryIndex)
    : "";
}

function normalizeUrlPathname(
  pathname: string,
): string {
  const withoutTrailingSlash = pathname.replace(
    /\/+$/u,
    "",
  );

  return withoutTrailingSlash.length > 0
    ? withoutTrailingSlash
    : "/";
}

function isDefaultPort(url: URL): boolean {
  return (
    (url.protocol === "http:" && url.port === "80") ||
    (url.protocol === "https:" &&
      url.port === "443")
  );
}

function invalidCursorError(): PlatformAccountValidationError {
  return new PlatformAccountValidationError(
    "cursor is invalid",
  );
}
