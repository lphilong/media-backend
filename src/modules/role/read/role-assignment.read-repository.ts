import { RoleAssignmentState } from "@modules/role/domain/role.types";
import { RoleAssignmentView } from "@modules/role/domain/role.types";

export interface ListRoleAssignmentReadInput {
  readonly roleId: string;
  readonly state?: RoleAssignmentState;
  readonly limit: number;
  readonly cursor?: string;
}

export interface ListRoleAssignmentReadResult {
  readonly items: readonly RoleAssignmentView[];
  readonly nextCursor?: string;
}

export interface RoleAssignmentReadRepository {
  listRoleAssignments(
    input: ListRoleAssignmentReadInput,
  ): Promise<ListRoleAssignmentReadResult>;
}
