import { ClientSession, Collection, Db } from "mongodb";
import { BaseRepository } from "@infra/database/repository";
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

interface RoleDocument {
  readonly _id: string;
  readonly code: string;
  readonly name: string;
  readonly searchCode?: string;
  readonly searchName?: string;
  readonly description: string | null;
  readonly state: RoleState;
  readonly permissions: readonly string[];
  readonly delegationBand?:
    | "LIMITED"
    | "PRIVILEGED"
    | "FOUNDATION";
  readonly maxDelegatableBand?:
    | "NONE"
    | "LIMITED"
    | "PRIVILEGED";
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
  readonly state: RoleAssignmentState;
  readonly effectiveAt: number | null;
  readonly revokedAt: number | null;
  readonly reason: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

interface UserDocument {
  readonly _id: string;
  readonly accountStatus:
    | "PENDING"
    | "ACTIVE"
    | "DISABLED"
    | "ARCHIVED";
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
      db.collection<RoleAssignmentDocument>(
        "role_assignments",
      );
    this.assignmentRuleCollection =
      db.collection<RoleAssignmentRuleDocument>(
        "role_assignment_rules",
      );
  }

  async listRoles(
    input: ListRoleReadInput,
  ): Promise<ListRoleReadResult> {
    const cursor =
      input.cursor === undefined
        ? undefined
        : decodeCompositeCursor(input.cursor);
    const queryFilters: Array<Record<string, unknown>> =
      [];

    if (input.state) {
      queryFilters.push({ state: input.state });
    }

    if (input.search) {
      queryFilters.push(
        buildPrefixSearchFilter(input.search),
      );
    }

    if (cursor) {
      queryFilters.push(
        buildPageAfterFilter(cursor),
      );
    }

    const docs = await this.collection
      .find(buildQuery(queryFilters))
      .sort({ updatedAt: -1, _id: 1 })
      .limit(input.limit + 1)
      .toArray();

    const hasNext = docs.length > input.limit;
    const page = hasNext
      ? docs.slice(0, input.limit)
      : docs;

    const roleIds = page.map((doc) => doc._id);

    const assignmentCounts = await this.fetchActiveAssignmentCounts(
      roleIds,
    );

    const items: RoleListItemView[] = page.map((doc) => ({
      id: doc._id,
      code: doc.code,
      name: doc.name,
      state: doc.state,
      permissionsSummary: doc.permissions.length,
      assignmentCountSummary:
        assignmentCounts.get(doc._id) ?? 0,
      updatedAt: doc.updatedAt,
    }));

    return {
      items,
      nextCursor:
        hasNext && items.length > 0
          ? encodeCompositeCursor({
              updatedAt:
                items[items.length - 1].updatedAt,
              id: items[items.length - 1].id,
            })
          : undefined,
    };
  }

  async getRoleDetail(
    roleId: string,
  ): Promise<RoleDetailView | null> {
    const [roleDoc, assignmentRuleDocs] =
      await Promise.all([
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
      delegationBand:
        roleDoc.delegationBand ?? "LIMITED",
      maxDelegatableBand:
        roleDoc.maxDelegatableBand ?? "NONE",
      assignmentRules: assignmentRuleDocs.map(
        toRoleAssignmentRuleView,
      ),
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
      delegationBand:
        doc.delegationBand ?? "LIMITED",
      maxDelegatableBand:
        doc.maxDelegatableBand ?? "NONE",
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

    return new Map(
      rows.map((row) => [row._id, row.count]),
    );
  }
}

export class NativeMongoRoleAssignmentReadRepository
  extends BaseRepository<RoleAssignmentDocument>
  implements RoleAssignmentReadRepository
{
  constructor(db: Db) {
    super(db, "role_assignments");
  }

  async listRoleAssignments(
    input: ListRoleAssignmentReadInput,
  ): Promise<ListRoleAssignmentReadResult> {
    const cursor =
      input.cursor === undefined
        ? undefined
        : decodeCompositeCursor(input.cursor);
    const queryFilters: Array<Record<string, unknown>> =
      [{ roleId: input.roleId }];

    if (input.state) {
      queryFilters.push({ state: input.state });
    }

    if (cursor) {
      queryFilters.push(
        buildPageAfterFilter(cursor),
      );
    }

    const docs = await this.collection
      .find(buildQuery(queryFilters))
      .sort({ updatedAt: -1, _id: 1 })
      .limit(input.limit + 1)
      .toArray();

    const hasNext = docs.length > input.limit;
    const page = hasNext
      ? docs.slice(0, input.limit)
      : docs;

    const items = page.map((doc) =>
      toRoleAssignmentView(doc),
    );

    return {
      items,
      nextCursor:
        hasNext && items.length > 0
          ? encodeCompositeCursor({
              updatedAt:
                page[page.length - 1].updatedAt,
              id: page[page.length - 1]._id,
            })
          : undefined,
    };
  }
}

export class NativeMongoRoleUserReadonlyAccess
  implements RoleUserReadonlyAccess
{
  private readonly userCollection: Collection<UserDocument>;

  constructor(db: Db) {
    this.userCollection =
      db.collection<UserDocument>("users");
  }

  async isAssignableById(
    userId: string,
    session?: ClientSession,
  ): Promise<boolean> {
    const user = await this.userCollection.findOne(
      {
        _id: userId,
        accountStatus: "ACTIVE",
        disabledAt: null,
        archivedAt: null,
      },
      {
        projection: { _id: 1 },
        ...(session ? { session } : {}),
      },
    );

    return user !== null;
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

function buildPrefixSearchFilter(
  search: string,
): Record<string, unknown> {
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

function encodeCompositeCursor(
  cursor: CompositeCursor,
): string {
  return Buffer.from(
    JSON.stringify([
      cursor.updatedAt,
      cursor.id,
    ]),
    "utf8",
  ).toString("base64url");
}

function decodeCompositeCursor(
  cursor: string,
): CompositeCursor {
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

  let decodedPayload: unknown;

  try {
    decodedPayload = JSON.parse(decodedText);
  } catch {
    throw invalidCursorError();
  }

  if (
    !Array.isArray(decodedPayload) ||
    decodedPayload.length !== 2
  ) {
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
  return new RoleValidationError(
    "cursor is invalid",
  );
}

function toRoleAssignmentView(
  document: RoleAssignmentDocument,
): RoleAssignmentView {
  return {
    assignmentId: document._id,
    roleId: document.roleId,
    userId: document.userId,
    state: document.state,
    effectiveAt: document.effectiveAt,
    revokedAt: document.revokedAt,
    reason: document.reason,
  };
}
