import { Db } from "mongodb";
import { BaseRepository } from "@infra/database/repository/base.repository";
import {
  ListUserReadInput,
  ListUserReadResult,
  UserReadRepository,
} from "@modules/user/read/user.read-repository";
import { UserValidationError } from "@modules/user/domain/user.errors";
import {
  UserDetailView,
  UserListItemView,
} from "@modules/user/domain/user.types";

interface UserReadDocument {
  readonly _id: string;
  readonly accountStatus: "PENDING" | "ACTIVE" | "DISABLED" | "ARCHIVED";
  readonly actorKind: "ADMIN" | "STAFF";
  readonly authLinkage: {
    readonly provider: "auth0";
    readonly subject: string;
    readonly status?: "LINKED" | "UNLINKED";
  };
  readonly profile: {
    readonly displayName: string;
    readonly email?: string;
    readonly phone?: string;
  };
  readonly searchDisplayName?: string;
  readonly searchEmail?: string;
  readonly contextAccess: {
    readonly contexts: readonly ["ADMIN"];
  };
  readonly preferences: {
    readonly locale?: string;
    readonly timezone?: string;
  };
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly activatedAt: number | null;
  readonly disabledAt: number | null;
  readonly archivedAt: number | null;
}

interface CompositeCursor {
  readonly updatedAt: number;
  readonly id: string;
}

export class MongoUserReadRepository
  extends BaseRepository<UserReadDocument>
  implements UserReadRepository
{
  constructor(db: Db) {
    super(db, "users");
  }

  async listUsers(input: ListUserReadInput): Promise<ListUserReadResult> {
    const cursor =
      input.cursor === undefined
        ? undefined
        : decodeCompositeCursor(input.cursor);
    const queryFilters: Array<Record<string, unknown>> = [];

    if (input.state) {
      queryFilters.push({
        accountStatus: input.state,
      });
    }

    if (input.actorKind) {
      queryFilters.push({
        actorKind: input.actorKind,
      });
    }

    if (input.search) {
      queryFilters.push(buildPrefixSearchFilter(input.search));
    }

    if (cursor) {
      queryFilters.push(buildPageAfterFilter(cursor));
    }

    const docs =
      input.hasEmploymentProfile === undefined
        ? await this.collection
            .find(buildQuery(queryFilters))
            .sort({ updatedAt: -1, _id: 1 })
            .limit(input.limit + 1)
            .toArray()
        : await this.collection
            .aggregate<UserReadDocument>(
              buildEmploymentProfileFilterPipeline({
                filters: queryFilters,
                hasEmploymentProfile:
                  input.hasEmploymentProfile,
                limit: input.limit + 1,
              }),
            )
            .toArray();

    const hasNext = docs.length > input.limit;
    const page = hasNext ? docs.slice(0, input.limit) : docs;

    const items = page.map((doc) => toUserListItemView(doc));

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

  async getUserDetail(userId: string): Promise<UserDetailView | null> {
    const doc = await this.collection.findOne({
      _id: userId,
    });

    if (!doc) {
      return null;
    }

    return toUserDetailView(doc);
  }
}

function buildEmploymentProfileFilterPipeline(input: {
  readonly filters: ReadonlyArray<Record<string, unknown>>;
  readonly hasEmploymentProfile: boolean;
  readonly limit: number;
}): Record<string, unknown>[] {
  return [
    { $match: buildQuery(input.filters) },
    {
      $lookup: {
        from: "employment_profiles",
        let: { userId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$linkedUserId", "$$userId"] },
                  {
                    $ne: [
                      "$employmentStatus",
                      "ARCHIVED",
                    ],
                  },
                ],
              },
            },
          },
          { $limit: 1 },
          { $project: { _id: 1 } },
        ],
        as: "employmentProfileLinks",
      },
    },
    {
      $match: input.hasEmploymentProfile
        ? { "employmentProfileLinks.0": { $exists: true } }
        : { "employmentProfileLinks.0": { $exists: false } },
    },
    { $sort: { updatedAt: -1, _id: 1 } },
    { $limit: input.limit },
    { $project: { employmentProfileLinks: 0 } },
  ];
}

function toUserListItemView(document: UserReadDocument): UserListItemView {
  return {
    id: document._id,
    displayName: document.profile.displayName,
    email: document.profile.email,
    actorKind: document.actorKind,
    accountStatus: document.accountStatus,
    authLinkage: {
      status: document.authLinkage.status ?? "LINKED",
    },
    updatedAt: document.updatedAt,
  };
}

function toUserDetailView(document: UserReadDocument): UserDetailView {
  return {
    id: document._id,
    accountStatus: document.accountStatus,
    actorKind: document.actorKind,
    authLinkage: {
      provider: document.authLinkage.provider,
      subject: document.authLinkage.subject,
      status: document.authLinkage.status ?? "LINKED",
    },
    contextAccess: {
      contexts: document.contextAccess.contexts,
    },
    profile: {
      displayName: document.profile.displayName,
      email: document.profile.email,
      phone: document.profile.phone,
    },
    preferences: {
      locale: document.preferences.locale,
      timezone: document.preferences.timezone,
    },
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    activatedAt: document.activatedAt,
    disabledAt: document.disabledAt,
    archivedAt: document.archivedAt,
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

function buildPrefixSearchFilter(search: string): Record<string, unknown> {
  const prefix = toSearchPrefix(search);

  return {
    $or: [
      buildPrefixRange("searchDisplayName", prefix),
      buildPrefixRange("searchEmail", prefix),
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

function invalidCursorError(): UserValidationError {
  return new UserValidationError("cursor is invalid");
}
