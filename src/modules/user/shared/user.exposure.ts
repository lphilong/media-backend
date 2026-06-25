import {
  PlainObject,
  toPlainObject,
} from "@app/base/presentation-result.types";
import { ExposurePolicy } from "@core/exposure/exposure.policy";
import {
  UserDetailView,
  UserListItemView,
  UserRecord,
} from "@modules/user/domain/user.types";

const USER_ADMIN_LIST_FIELDS = [
  "id",
  "displayName",
  "email",
  "actorKind",
  "accountStatus",
  "authLinkage",
  "updatedAt",
] as const;

const USER_ADMIN_DETAIL_FIELDS = [
  "id",
  "accountStatus",
  "actorKind",
  "accountContexts",
  "authLinkage",
  "contextAccess",
  "preferences",
  "profile",
  "createdAt",
  "updatedAt",
  "activatedAt",
  "disabledAt",
  "archivedAt",
] as const;

function toDetailView(user: UserRecord): UserDetailView {
  return {
    id: user.id,
    accountStatus: user.accountStatus,
    actorKind: user.actorKind,
    authLinkage: {
      provider: user.authLinkage.provider,
      subject: user.authLinkage.subject,
      status: user.authLinkage.status ?? "LINKED",
    },
    contextAccess: {
      contexts: user.contextAccess.contexts,
    },
    accountContexts: user.accountContexts ?? [],
    profile: {
      displayName: user.profile.displayName,
      email: user.profile.email,
      phone: user.profile.phone,
    },
    preferences: {
      locale: user.preferences.locale,
      timezone: user.preferences.timezone,
    },
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    activatedAt: user.activatedAt,
    disabledAt: user.disabledAt,
    archivedAt: user.archivedAt,
  };
}

export const UserAdminListExposure = Object.freeze({
  expose(input: UserListItemView): PlainObject {
    return toPlainObject(
      ExposurePolicy.expose(
        {
          id: input.id,
          displayName: input.displayName,
          email: input.email,
          actorKind: input.actorKind,
          accountStatus: input.accountStatus,
          authLinkage: {
            status: input.authLinkage.status,
          },
          updatedAt: input.updatedAt,
        },
        USER_ADMIN_LIST_FIELDS,
      ),
      "UserAdminList exposure",
    );
  },

  exposeMany(items: readonly UserListItemView[]): readonly PlainObject[] {
    return items.map((item) => this.expose(item));
  },
});

export const UserAdminDetailExposure = Object.freeze({
  expose(input: UserDetailView): PlainObject {
    return toPlainObject(
      ExposurePolicy.expose(
        {
          id: input.id,
          accountStatus: input.accountStatus,
          actorKind: input.actorKind,
          authLinkage: input.authLinkage,
          contextAccess: {
            contexts: input.contextAccess.contexts.map((context) => ({
              context,
            })),
          },
          accountContexts: input.accountContexts ?? [],
          profile: input.profile,
          preferences: input.preferences,
          createdAt: input.createdAt,
          updatedAt: input.updatedAt,
          activatedAt: input.activatedAt,
          disabledAt: input.disabledAt,
          archivedAt: input.archivedAt,
        },
        USER_ADMIN_DETAIL_FIELDS,
      ),
      "UserAdminDetail exposure",
    );
  },
});

export const UserAdminMutationExposure = Object.freeze({
  expose(input: UserRecord): PlainObject {
    return UserAdminDetailExposure.expose(toDetailView(input));
  },
});
