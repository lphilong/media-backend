import {
  AccountContext,
} from "@modules/account-context/domain/account-context.types";
import {
  UserAccountStatus,
  UserActorKind,
} from "@modules/user/domain/user.types";

export interface UserPersistence {
  readonly _id: string;
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
  readonly searchDisplayName: string;
  readonly searchEmail: string;
  readonly contextAccess: {
    readonly contexts: readonly ["ADMIN"];
  };
  readonly accountContexts?: readonly AccountContext[];
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
