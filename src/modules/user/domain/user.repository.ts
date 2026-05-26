import { ClientSession } from "mongodb";
import { UserAccountStatus, UserActorKind, UserRecord } from "./user.types";

export interface CreateUserInput {
  readonly id: string;
  readonly accountStatus: UserAccountStatus;
  readonly actorKind: UserActorKind;
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

export interface UpdateUserProfileInput {
  readonly userId: string;
  readonly displayName?: string;
  readonly email?: string;
  readonly phone?: string;
  readonly locale?: string;
  readonly timezone?: string;
  readonly updatedAt: number;
}

export interface UpdateUserPreferencesInput {
  readonly userId: string;
  readonly locale?: string;
  readonly timezone?: string;
  readonly updatedAt: number;
}

export interface TransitionUserLifecycleInput {
  readonly userId: string;
  readonly fromStates: readonly UserAccountStatus[];
  readonly toState: UserAccountStatus;
  readonly changedAt: number;
}

export interface SetUserAuthLinkageInput {
  readonly userId: string;
  readonly provider: "auth0";
  readonly subject: string;
  readonly status?: "LINKED" | "UNLINKED";
  readonly accountStatus?: UserAccountStatus;
  readonly updatedAt: number;
}

export interface UpdateUserActorKindInput {
  readonly userId: string;
  readonly actorKind: UserActorKind;
  readonly updatedAt: number;
}

export interface UserMutationRepository {
  insert(input: CreateUserInput, session: ClientSession): Promise<UserRecord>;

  findById(userId: string, session: ClientSession): Promise<UserRecord | null>;

  findByAuthSubject(
    authSubject: string,
    session: ClientSession,
  ): Promise<UserRecord | null>;

  findByEmail(
    email: string,
    session: ClientSession,
  ): Promise<UserRecord | null>;

  updateProfile(
    input: UpdateUserProfileInput,
    session: ClientSession,
  ): Promise<UserRecord | null>;

  updatePreferences(
    input: UpdateUserPreferencesInput,
    session?: ClientSession,
  ): Promise<UserRecord | null>;

  transitionLifecycle(
    input: TransitionUserLifecycleInput,
    session: ClientSession,
  ): Promise<UserRecord | null>;

  setAuthLinkage(
    input: SetUserAuthLinkageInput,
    session: ClientSession,
  ): Promise<UserRecord | null>;

  updateActorKind(
    input: UpdateUserActorKindInput,
    session: ClientSession,
  ): Promise<UserRecord | null>;
}
