import { ClientSession, Db } from "mongodb";
import { BaseRepository } from "@infra/database/repository/base.repository";
import {
  CreateUserInput,
  SetUserAuthLinkageInput,
  TransitionUserLifecycleInput,
  UpdateUserActorKindInput,
  UpdateUserProfileInput,
  UserMutationRepository,
} from "@modules/user/domain/user.repository";
import {
  UserRecord,
} from "@modules/user/domain/user.types";
import { UserMapper } from "./user.mapper";
import { UserPersistence } from "./user.persistence";

export class UserRepository
  extends BaseRepository<UserPersistence>
  implements UserMutationRepository
{
  constructor(db: Db) {
    super(db, "users");
  }

  async insert(
    input: CreateUserInput,
    session: ClientSession,
  ): Promise<UserRecord> {
    const doc: UserPersistence = {
      _id: input.id,
      accountStatus: input.accountStatus,
      actorKind: input.actorKind,
      authLinkage: {
        provider: input.authLinkage.provider,
        subject: input.authLinkage.subject,
        status: input.authLinkage.status ?? "LINKED",
      },
      profile: {
        displayName: input.profile.displayName,
        email: input.profile.email,
        phone: input.profile.phone,
      },
      searchDisplayName: normalizeSearchField(
        input.profile.displayName,
      ),
      searchEmail: normalizeSearchField(
        input.profile.email,
      ),
      contextAccess: {
        contexts: input.contextAccess.contexts,
      },
      preferences: {
        locale: input.preferences.locale,
        timezone: input.preferences.timezone,
      },
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
      activatedAt: input.activatedAt,
      disabledAt: input.disabledAt,
      archivedAt: input.archivedAt,
    };

    await this.collection.insertOne(
      doc,
      this.withSession(session),
    );

    return UserMapper.toDomain(doc);
  }

  async findById(
    userId: string,
    session: ClientSession,
  ): Promise<UserRecord | null> {
    const doc = await this.collection.findOne(
      { _id: userId },
      this.withSession(session),
    );

    return doc ? UserMapper.toDomain(doc) : null;
  }

  async findByAuthSubject(
    authSubject: string,
    session?: ClientSession,
  ): Promise<UserRecord | null> {
    const doc = await this.collection.findOne(
      {
        "authLinkage.provider": "auth0",
        "authLinkage.subject": authSubject,
      },
      {
        ...this.withSession(session),
        sort: { _id: 1 },
      },
    );

    return doc ? UserMapper.toDomain(doc) : null;
  }

  async findManyByAuthSubject(
    authSubject: string,
    session?: ClientSession,
  ): Promise<readonly UserRecord[]> {
    const docs = await this.collection
      .find(
        {
          "authLinkage.provider": "auth0",
          "authLinkage.subject": authSubject,
          accountStatus: { $ne: "ARCHIVED" },
        },
        this.withSession(session),
      )
      .sort({ _id: 1 })
      .toArray();

    return docs.map((doc) => UserMapper.toDomain(doc));
  }

  async findByEmail(
    email: string,
    session?: ClientSession,
  ): Promise<UserRecord | null> {
    const doc = await this.collection.findOne(
      {
        searchEmail: normalizeSearchField(email),
      },
      {
        ...this.withSession(session),
        sort: { _id: 1 },
      },
    );

    return doc ? UserMapper.toDomain(doc) : null;
  }

  async findManyByEmail(
    email: string,
    session?: ClientSession,
  ): Promise<readonly UserRecord[]> {
    const docs = await this.collection
      .find(
        {
          searchEmail: normalizeSearchField(email),
        },
        this.withSession(session),
      )
      .sort({ _id: 1 })
      .toArray();

    return docs.map((doc) => UserMapper.toDomain(doc));
  }

  async updateProfile(
    input: UpdateUserProfileInput,
    session: ClientSession,
  ): Promise<UserRecord | null> {
    const set: Record<string, unknown> = {
      updatedAt: input.updatedAt,
    };

    if (input.displayName !== undefined) {
      set["profile.displayName"] = input.displayName;
      set.searchDisplayName = normalizeSearchField(
        input.displayName,
      );
    }

    if (input.email !== undefined) {
      set["profile.email"] = input.email;
      set.searchEmail = normalizeSearchField(
        input.email,
      );
    }

    if (input.phone !== undefined) {
      set["profile.phone"] = input.phone;
    }

    if (input.locale !== undefined) {
      set["preferences.locale"] = input.locale;
    }

    if (input.timezone !== undefined) {
      set["preferences.timezone"] = input.timezone;
    }

    const updated = await this.collection.findOneAndUpdate(
      { _id: input.userId },
      {
        $set: set,
      },
      {
        ...this.withSession(session),
        returnDocument: "after",
      },
    );

    return updated ? UserMapper.toDomain(updated) : null;
  }

  async transitionLifecycle(
    input: TransitionUserLifecycleInput,
    session: ClientSession,
  ): Promise<UserRecord | null> {
    const set: Record<string, unknown> = {
      accountStatus: input.toState,
      updatedAt: input.changedAt,
    };

    if (input.toState === "ACTIVE") {
      set.activatedAt = input.changedAt;
      set.disabledAt = null;
    }

    if (input.toState === "DISABLED") {
      set.disabledAt = input.changedAt;
    }

    if (input.toState === "ARCHIVED") {
      set.archivedAt = input.changedAt;
    }

    const updated = await this.collection.findOneAndUpdate(
      {
        _id: input.userId,
        accountStatus: {
          $in: [...input.fromStates],
        },
      },
      {
        $set: set,
      },
      {
        ...this.withSession(session),
        returnDocument: "after",
      },
    );

    return updated ? UserMapper.toDomain(updated) : null;
  }

  async setAuthLinkage(
    input: SetUserAuthLinkageInput,
    session: ClientSession,
  ): Promise<UserRecord | null> {
    const set: Record<string, unknown> = {
      "authLinkage.provider": input.provider,
      "authLinkage.subject": input.subject,
      "authLinkage.status": input.status ?? "LINKED",
      updatedAt: input.updatedAt,
    };

    if (input.accountStatus !== undefined) {
      set.accountStatus = input.accountStatus;
    }

    const updated = await this.collection.findOneAndUpdate(
      { _id: input.userId },
      {
        $set: set,
      },
      {
        ...this.withSession(session),
        returnDocument: "after",
      },
    );

    return updated ? UserMapper.toDomain(updated) : null;
  }

  async updateActorKind(
    input: UpdateUserActorKindInput,
    session: ClientSession,
  ): Promise<UserRecord | null> {
    const updated = await this.collection.findOneAndUpdate(
      { _id: input.userId },
      {
        $set: {
          actorKind: input.actorKind,
          updatedAt: input.updatedAt,
        },
      },
      {
        ...this.withSession(session),
        returnDocument: "after",
      },
    );

    return updated ? UserMapper.toDomain(updated) : null;
  }
}

function normalizeSearchField(
  value: string | undefined,
): string {
  return (value ?? "").trim().toLowerCase();
}
