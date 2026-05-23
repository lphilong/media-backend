import { ClientSession } from "mongodb";
import { UserActorKind } from "@modules/user/domain/user.types";

export interface RoleAssignableUser {
  readonly id: string;
  readonly actorKind: UserActorKind;
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
