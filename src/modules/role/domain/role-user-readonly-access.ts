import { ClientSession } from "mongodb";

export interface RoleUserReadonlyAccess {
  isAssignableById(
    userId: string,
    session?: ClientSession,
  ): Promise<boolean>;
}
