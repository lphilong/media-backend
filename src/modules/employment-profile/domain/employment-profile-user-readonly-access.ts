import { ClientSession } from "mongodb";
import { UserAccountStatus } from "@modules/user/domain/user.types";

export interface EmploymentProfileReferencedUser {
  readonly id: string;
  readonly accountStatus: UserAccountStatus;
}

export interface EmploymentProfileUserReadonlyAccess {
  findById(
    userId: string,
    session?: ClientSession,
  ): Promise<EmploymentProfileReferencedUser | null>;
}
