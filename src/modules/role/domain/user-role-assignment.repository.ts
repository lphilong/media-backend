import { ClientSession } from "mongodb";
import { UserRoleAssignmentRecord } from "./role.types";

export interface UserRoleAssignmentRepository {
  insert(
    assignment: UserRoleAssignmentRecord,
    session: ClientSession,
  ): Promise<UserRoleAssignmentRecord>;

  findById(
    assignmentId: string,
    session?: ClientSession,
  ): Promise<UserRoleAssignmentRecord | null>;

  findActiveByRoleAndUser(
    roleId: string,
    userId: string,
    session?: ClientSession,
  ): Promise<UserRoleAssignmentRecord | null>;

  hasActiveAssignmentsForRole(
    roleId: string,
    session?: ClientSession,
  ): Promise<boolean>;

  revokeById(
    assignmentId: string,
    reason: string | null,
    revokedAt: number,
    session: ClientSession,
  ): Promise<UserRoleAssignmentRecord | null>;
}
