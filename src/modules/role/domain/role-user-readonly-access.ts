import { ClientSession } from "mongodb";
import { ReferenceSummary } from "@modules/reference-summary";
import { UserActorKind } from "@modules/user/domain/user.types";

export interface RoleAssignableUser {
  readonly id: string;
  readonly actorKind: UserActorKind;
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
