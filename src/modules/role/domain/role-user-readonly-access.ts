import { ClientSession } from "mongodb";
import { ReferenceSummary } from "@modules/reference-summary";
import { AccountContext } from "@modules/account-context/domain/account-context.types";
import { UserActorKind } from "@modules/user/domain/user.types";

export interface RoleAssignableUser {
  readonly id: string;
  readonly actorKind: UserActorKind;
  readonly accountContexts: readonly AccountContext[];
  readonly ref?: ReferenceSummary | null;
}

export interface RoleUserReadonlyAccess {
  isAssignableById(
    userId: string,
    session?: ClientSession,
  ): Promise<boolean>;

  getAssignableById(
    userId: string,
    session?: ClientSession,
  ): Promise<RoleAssignableUser | null>;
}
