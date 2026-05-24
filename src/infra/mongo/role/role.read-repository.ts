import { ClientSession, Collection, Db } from "mongodb";
import { BaseRepository } from "@infra/database/repository";
import { ActorScopeGrants } from "@core/actor/actor";
import { ReferenceSummary } from "@modules/reference-summary";
import { RoleValidationError } from "@modules/role/domain/role.errors";
import {
  ListRoleReadInput,
  ListRoleReadResult,
  RoleReadRepository,
} from "@modules/role/read/role.read-repository";
import {
  ListRoleAssignmentReadInput,
  ListRoleAssignmentReadResult,
  RoleAssignmentReadRepository,
} from "@modules/role/read/role-assignment.read-repository";
import {
  RoleAssignmentRuleView,
  RoleAssignmentState,
  RoleAssignmentView,
  RoleDetailView,
  RoleListItemView,
  RolePermissionMatrixView,
  RoleState,
} from "@modules/role/domain/role.types";
import { RoleUserReadonlyAccess } from "@modules/role/domain/role-user-readonly-access";
import { RoleAssignableUser } from "@modules/role/domain/role-user-readonly-access";
import { isRoleTemplateCode } from "@modules/role/domain/role-template.catalog";

interface RoleDocument {
  readonly _id: string;
  readonly code: string;
  readonly name: string;
  readonly searchCode?: string;
  readonly searchName?: string;
  readonly description: string | null;
  readonly state: RoleState;
  readonly permissions: readonly string[];
  readonly delegationBand?: "LIMITED" | "PRIVILEGED" | "FOUNDATION";
  readonly maxDelegatableBand?: "NONE" | "LIMITED" | "PRIVILEGED";
  readonly templateCode?: string;
  readonly templateVersion?: string;
  readonly templateAppliedAt?: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly activatedAt: number | null;
  readonly archivedAt: number | null;
}

interface RoleAssignmentRuleDocument {
  readonly _id: string;
  readonly roleId: string;
  readonly code: string;
  readonly description: string | null;
  readonly state: "ACTIVE" | "INACTIVE";
  readonly conditions: Record<string, unknown> | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

interface RoleAssignmentDocument {
  readonly _id: string;
  readonly roleId: string;
  readonly userId: string;
  readonly scopeGrants?: ActorScopeGrants;
  readonly state: RoleAssignmentState;
  readonly effectiveAt: number | null;
  readonly revokedAt: number | null;
  readonly reason: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

interface UserDocument {
  readonly _id: string;
  readonly actorKind: "ADMIN" | "STAFF";
  readonly profile: {
    readonly displayName: string;
    readonly email?: string;
  };
  readonly accountStatus: "PENDING" | "ACTIVE" | "DISABLED" | "ARCHIVED";
  readonly disabledAt: number | null;
  readonly archivedAt: number | null;
}

interface CompositeCursor {
  readonly updatedAt: number;
  readonly id: string;
}

export class NativeMongoRoleReadRepository
  extends BaseRepository<RoleDocument>
  implements RoleReadRepository
{
  private readonly assignmentCollection: Collection<RoleAssignmentDocument>;
  private readonly assignmentRuleCollection: Collection<RoleAssignmentRuleDocument>;

  constructor(db: Db) {
    super(db, "roles");
    this.assignmentCollection =
      db.collection<RoleAssignmentDocument>("role_assignments");
    this.assignmentRuleCollection = db.collection<RoleAssignmentRuleDocument>(
      "role_assignment_rules",
    );
  }

  async listRoles(input: ListRoleReadInput): Promise<ListRoleReadResult> {
    const cursor =
      input.cursor === undefined
        ? undefined
        : decodeCompositeCursor(input.cursor);
    const queryFilters: Array<Record<string, unknown>> = [];

    if (input.state) {
      queryFilters.push({ state: input.state });
    }

    if (input.search) {
      queryFilters.push(buildPrefixSearchFilter(input.search));
    }

    if (cursor) {
      queryFilters.push(buildPageAfterFilter(cursor));
    }

    const docs = await this.collection
      .find(buildQuery(queryFilters))
      .sort({ updatedAt: -1, _id: 1 })
      .limit(input.limit + 1)
      .toArray();

    const hasNext = docs.length > input.limit;
    const page = hasNext ? docs.slice(0, input.limit) : docs;

    const roleIds = page.map((doc) => doc._id);

    const assignmentCounts = await this.fetchActiveAssignmentCounts(roleIds);

    const items: RoleListItemView[] = page.map((doc) => ({
      id: doc._id,
      code: doc.code,
      name: doc.name,
      state: doc.state,
      permissionsSummary: doc.permissions.length,
      assignmentCountSummary: assignmentCounts.get(doc._id) ?? 0,
      ...(typeof doc.templateCode === "string" &&
      isRoleTemplateCode(doc.templateCode)
        ? { templateCode: doc.templateCode }
        : {}),
      ...(typeof doc.templateVersion === "string"
        ? { templateVersion: doc.templateVersion }
        : {}),
      ...(typeof doc.templateAppliedAt === "number"
        ? { templateAppliedAt: doc.templateAppliedAt }
        : {}),
      updatedAt: doc.updatedAt,
    }));

    return {
      items,
      nextCursor:
        hasNext && items.length > 0
          ? encodeCompositeCursor({
              updatedAt: items[items.length - 1].updatedAt,
              id: items[items.length - 1].id,
            })
          : undefined,
    };
  }

  async getRoleDetail(roleId: string): Promise<RoleDetailView | null> {
    const [roleDoc, assignmentRuleDocs] = await Promise.all([
      this.collection.findOne({ _id: roleId }),
      this.assignmentRuleCollection
        .find({ roleId })
        .sort({ createdAt: 1, _id: 1 })
        .toArray(),
    ]);

    if (!roleDoc) {
      return null;
    }

    return {
      id: roleDoc._id,
      code: roleDoc.code,
      name: roleDoc.name,
      description: roleDoc.description,
      state: roleDoc.state,
      permissions: [...roleDoc.permissions],
      delegationBand: roleDoc.delegationBand ?? "LIMITED",
      maxDelegatableBand: roleDoc.maxDelegatableBand ?? "NONE",
      assignmentRules: assignmentRuleDocs.map(toRoleAssignmentRuleView),
      ...(typeof roleDoc.templateCode === "string" &&
      isRoleTemplateCode(roleDoc.templateCode)
        ? { templateCode: roleDoc.templateCode }
        : {}),
      ...(typeof roleDoc.templateVersion === "string"
        ? { templateVersion: roleDoc.templateVersion }
        : {}),
      ...(typeof roleDoc.templateAppliedAt === "number"
        ? {
            templateAppliedAt: roleDoc.templateAppliedAt,
          }
        : {}),
      createdAt: roleDoc.createdAt,
      updatedAt: roleDoc.updatedAt,
      activatedAt: roleDoc.activatedAt,
      archivedAt: roleDoc.archivedAt,
    };
  }

  async getRolePermissionMatrix(
    roleId: string,
  ): Promise<RolePermissionMatrixView | null> {
    const doc = await this.collection.findOne({
      _id: roleId,
    });

    if (!doc) {
      return null;
    }

    return {
      roleId: doc._id,
      roleCode: doc.code,
      roleState: doc.state,
      permissions: [...doc.permissions],
      delegationBand: doc.delegationBand ?? "LIMITED",
      maxDelegatableBand: doc.maxDelegatableBand ?? "NONE",
    };
  }

  private async fetchActiveAssignmentCounts(
    roleIds: readonly string[],
  ): Promise<Map<string, number>> {
    if (roleIds.length === 0) {
      return new Map<string, number>();
    }

    const rows = await this.assignmentCollection
      .aggregate<{
        readonly _id: string;
        readonly count: number;
      }>([
        {
          $match: {
            roleId: {
              $in: [...roleIds],
            },
            state: "ACTIVE",
          },
        },
        {
          $group: {
            _id: "$roleId",
            count: { $sum: 1 },
          },
        },
      ])
      .toArray();

    return new Map(rows.map((row) => [row._id, row.count]));
  }
}

export class NativeMongoRoleAssignmentReadRepository
  extends BaseRepository<RoleAssignmentDocument>
  implements RoleAssignmentReadRepository
{
  private readonly userCollection: Collection<UserDocument>;

  constructor(db: Db) {
    super(db, "role_assignments");
    this.userCollection = db.collection<UserDocument>("users");
  }

  async listRoleAssignments(
    input: ListRoleAssignmentReadInput,
  ): Promise<ListRoleAssignmentReadResult> {
    const cursor =
      input.cursor === undefined
        ? undefined
        : decodeCompositeCursor(input.cursor);
    const queryFilters: Array<Record<string, unknown>> = [
      { roleId: input.roleId },
    ];

    if (input.state) {
      queryFilters.push({ state: input.state });
    }

    if (cursor) {
      queryFilters.push(buildPageAfterFilter(cursor));
    }

    const docs = await this.collection
      .find(buildQuery(queryFilters))
      .sort({ updatedAt: -1, _id: 1 })
      .limit(input.limit + 1)
      .toArray();

    const hasNext = docs.length > input.limit;
    const page = hasNext ? docs.slice(0, input.limit) : docs;

    const items = await enrichRoleAssignmentUserReferenceSummaries(
      page.map((doc) => toRoleAssignmentView(doc)),
      this.userCollection,
    );

    return {
      items,
      nextCursor:
        hasNext && items.length > 0
          ? encodeCompositeCursor({
              updatedAt: page[page.length - 1].updatedAt,
              id: page[page.length - 1]._id,
            })
          : undefined,
    };
  }
}

export class NativeMongoRoleUserReadonlyAccess implements RoleUserReadonlyAccess {
  private readonly userCollection: Collection<UserDocument>;

  constructor(db: Db) {
    this.userCollection = db.collection<UserDocument>("users");
  }

  async isAssignableById(
    userId: string,
    session?: ClientSession,
  ): Promise<boolean> {
    return (await this.getAssignableById(userId, session)) !== null;
  }

  async getAssignableById(
    userId: string,
    session?: ClientSession,
  ): Promise<RoleAssignableUser | null> {
    const user = await this.userCollection.findOne(
      {
        _id: userId,
        accountStatus: "ACTIVE",
        disabledAt: null,
        archivedAt: null,
      },
      {
        projection: {
          _id: 1,
          actorKind: 1,
          profile: 1,
          accountStatus: 1,
        },
        ...(session ? { session } : {}),
      },
    );

    return user
      ? {
          id: user._id,
          actorKind: user.actorKind,
          ref: toUserReferenceSummary(user),
        }
      : null;
  }
}

function toRoleAssignmentRuleView(
  document: RoleAssignmentRuleDocument,
): RoleAssignmentRuleView {
  return {
    id: document._id,
    code: document.code,
    description: document.description,
    state: document.state,
    conditions: document.conditions,
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

function buildPageAfterFilter(
  cursor: CompositeCursor,
): Record<string, unknown> {
  return {
    $or: [
      { updatedAt: { $lt: cursor.updatedAt } },
      {
        updatedAt: cursor.updatedAt,
        _id: { $gt: cursor.id },
      },
    ],
  };
}

function buildPrefixSearchFilter(search: string): Record<string, unknown> {
  const prefix = toSearchPrefix(search);

  return {
    $or: [
      buildPrefixRange("searchName", prefix),
      buildPrefixRange("searchCode", prefix),
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

function toSearchPrefix(search: string): string {
  return search.trim().toLowerCase();
}

function encodeCompositeCursor(cursor: CompositeCursor): string {
  return Buffer.from(
    JSON.stringify([cursor.updatedAt, cursor.id]),
    "utf8",
  ).toString("base64url");
}

function decodeCompositeCursor(cursor: string): CompositeCursor {
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

  let decodedPayload: unknown;

  try {
    decodedPayload = JSON.parse(decodedText);
  } catch {
    throw invalidCursorError();
  }

  if (!Array.isArray(decodedPayload) || decodedPayload.length !== 2) {
    throw invalidCursorError();
  }

  const [updatedAt, id] = decodedPayload;

  if (
    typeof updatedAt !== "number" ||
    !Number.isInteger(updatedAt) ||
    !Number.isFinite(updatedAt) ||
    updatedAt < 0
  ) {
    throw invalidCursorError();
  }

  if (typeof id !== "string") {
    throw invalidCursorError();
  }

  const normalizedId = id.trim();

  if (!normalizedId) {
    throw invalidCursorError();
  }

  return {
    updatedAt,
    id: normalizedId,
  };
}

function invalidCursorError(): RoleValidationError {
  return new RoleValidationError("cursor is invalid");
}

function toRoleAssignmentView(
  document: RoleAssignmentDocument,
): RoleAssignmentView {
  return {
    assignmentId: document._id,
    roleId: document.roleId,
    userId: document.userId,
    userRef: null,
    ...(document.scopeGrants ? { scopeGrants: document.scopeGrants } : {}),
    state: document.state,
    effectiveAt: document.effectiveAt,
    revokedAt: document.revokedAt,
    reason: document.reason,
  };
}

async function enrichRoleAssignmentUserReferenceSummaries<
  T extends { readonly userId: string },
>(
  items: readonly T[],
  userCollection: Collection<UserDocument>,
): Promise<readonly T[]> {
  if (items.length === 0) {
    return items;
  }

  const userIds = new Set<string>();

  for (const item of items) {
    addRequiredReferenceId(userIds, item.userId);
  }

  const userRefMap = await loadUserReferenceSummaries(userIds, userCollection);

  return items.map((item) => ({
    ...item,
    userRef: userRefMap.get(item.userId) ?? null,
  }));
}

async function loadUserReferenceSummaries(
  ids: ReadonlySet<string>,
  collection: Collection<UserDocument>,
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

function toUserReferenceSummary(document: UserDocument): ReferenceSummary {
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
