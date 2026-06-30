import { ContextType } from "@core/context/context.types";
import type { ActorScopeGrants } from "@core/actor/actor";
import type { AccountContext } from "@modules/account-context/domain/account-context.types";

export type UserAccountStatus = "PENDING" | "ACTIVE" | "DISABLED" | "ARCHIVED";

export type UserActorKind = "ADMIN" | "STAFF";

export const USER_ACCOUNT_STATUSES: readonly UserAccountStatus[] = [
  "PENDING",
  "ACTIVE",
  "DISABLED",
  "ARCHIVED",
];

export const USER_ACTOR_KINDS: readonly UserActorKind[] = ["ADMIN", "STAFF"];

export interface UserAuthLinkage {
  readonly provider: "auth0";
  readonly subject: string;
  readonly status?: "LINKED" | "UNLINKED";
}

export interface UserProfile {
  readonly displayName: string;
  readonly email?: string;
  readonly phone?: string;
}

export interface UserContextAccess {
  readonly contexts: readonly ["ADMIN"];
}

export interface UserPreferences {
  readonly locale?: string;
  readonly timezone?: string;
}

export interface UserRecord {
  readonly id: string;
  readonly accountStatus: UserAccountStatus;
  readonly actorKind: UserActorKind;
  readonly authLinkage: UserAuthLinkage;
  readonly profile: UserProfile;
  readonly contextAccess: UserContextAccess;
  readonly accountContexts?: readonly AccountContext[];
  readonly preferences: UserPreferences;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly activatedAt: number | null;
  readonly disabledAt: number | null;
  readonly archivedAt: number | null;
}

export interface UserDetailAuthLinkageView {
  readonly provider: "auth0";
  readonly subject: string;
  readonly status?: "LINKED" | "UNLINKED";
}

export interface UserListAuthLinkageView {
  readonly status: "LINKED" | "UNLINKED";
}

export interface UserDetailContextAccessView {
  readonly contexts: readonly ["ADMIN"];
}

export interface UserDetailProfileView {
  readonly displayName: string;
  readonly email?: string;
  readonly phone?: string;
}

export interface UserDetailPreferencesView {
  readonly locale?: string;
  readonly timezone?: string;
}

export interface UserListItemView {
  readonly id: string;
  readonly displayName: string;
  readonly email?: string;
  readonly accountStatus: UserAccountStatus;
  readonly authLinkage: UserListAuthLinkageView;
  readonly updatedAt: number;
}

export interface UserDetailView {
  readonly id: string;
  readonly accountStatus: UserAccountStatus;
  readonly authLinkage: UserDetailAuthLinkageView;
  readonly profile: UserDetailProfileView;
  readonly contextAccess: UserDetailContextAccessView;
  readonly preferences: UserDetailPreferencesView;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly activatedAt: number | null;
  readonly disabledAt: number | null;
  readonly archivedAt: number | null;
}

export interface ResolvedActorUser {
  readonly userId: string;
  readonly actorKind: UserActorKind;
  readonly accountStatus: UserAccountStatus;
  readonly permissions: readonly string[];
  readonly context: Extract<ContextType, "ADMIN" | "SELF_SERVICE">;
  readonly accountContexts: readonly AccountContext[];
  readonly scopeGrants?: ActorScopeGrants;
  readonly authorizationValidUntil?: number;
}
