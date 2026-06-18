import { InfrastructureError } from "@infra/errors/infrastructure.error";
import { ActorScopeGrants } from "@core/actor/actor";
import {
  UserAuthResolutionCandidate,
} from "@modules/user/shared/user.actor-resolution.facade";
import {
  UserRecord,
} from "@modules/user/domain/user.types";
import { UserPersistence } from "./user.persistence";

const STATUS_SET = new Set([
  "PENDING",
  "ACTIVE",
  "DISABLED",
  "ARCHIVED",
]);

const ACTOR_KIND_SET = new Set(["ADMIN", "STAFF"]);

export class UserMapper {
  static toDomain(doc: UserPersistence): UserRecord {
    assertStatus(doc.accountStatus);
    assertActorKind(doc.actorKind);
    assertContextAccess(doc.contextAccess.contexts);

    return {
      id: doc._id,
      accountStatus: doc.accountStatus,
      actorKind: doc.actorKind,
      authLinkage: {
        provider: "auth0",
        subject: doc.authLinkage.subject,
        status: doc.authLinkage.status ?? "LINKED",
      },
      profile: {
        displayName: doc.profile.displayName,
        email: doc.profile.email,
        phone: doc.profile.phone,
      },
      contextAccess: {
        contexts: ["ADMIN"],
      },
      preferences: {
        locale: doc.preferences.locale,
        timezone: doc.preferences.timezone,
      },
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      activatedAt: doc.activatedAt,
      disabledAt: doc.disabledAt,
      archivedAt: doc.archivedAt,
    };
  }

  static toAuthResolutionCandidate(
    doc: Pick<
      UserPersistence,
      "_id" |
      "actorKind" |
      "accountStatus"
    > & {
      readonly permissions: readonly string[];
      readonly scopeGrants?: ActorScopeGrants;
      readonly authorizationValidUntil?: number;
    },
  ): UserAuthResolutionCandidate {
    assertStatus(doc.accountStatus);
    assertActorKind(doc.actorKind);

    return {
      userId: doc._id,
      actorKind: doc.actorKind,
      accountStatus: doc.accountStatus,
      permissions: [...doc.permissions],
      scopeGrants: doc.scopeGrants,
      authorizationValidUntil: doc.authorizationValidUntil,
    };
  }
}

function assertStatus(
  value: string,
): void {
  if (STATUS_SET.has(value)) {
    return;
  }

  throw new InfrastructureError(
    "USER_PERSISTENCE_INVALID_STATUS",
    `Unsupported user accountStatus: ${value}`,
  );
}

function assertActorKind(
  value: string,
): void {
  if (ACTOR_KIND_SET.has(value)) {
    return;
  }

  throw new InfrastructureError(
    "USER_PERSISTENCE_INVALID_ACTOR_KIND",
    `Unsupported user actorKind: ${value}`,
  );
}

function assertContextAccess(
  contexts: readonly string[],
): void {
  if (contexts.length === 1 && contexts[0] === "ADMIN") {
    return;
  }

  throw new InfrastructureError(
    "USER_PERSISTENCE_INVALID_CONTEXT_ACCESS",
    "User contextAccess must contain only ADMIN",
  );
}
