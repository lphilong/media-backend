import { RoleState } from "@modules/role/domain/role.types";
import {
  RoleDetailView,
  RoleListItemView,
  RolePermissionMatrixView,
} from "@modules/role/domain/role.types";

export interface ListRoleReadInput {
  readonly state?: RoleState;
  readonly limit: number;
  readonly cursor?: string;
  readonly search?: string;
}

export interface ListRoleReadResult {
  readonly items: readonly RoleListItemView[];
  readonly nextCursor?: string;
}

export interface RoleReadRepository {
  listRoles(
    input: ListRoleReadInput,
  ): Promise<ListRoleReadResult>;

  getRoleDetail(
    roleId: string,
  ): Promise<RoleDetailView | null>;

  getRolePermissionMatrix(
    roleId: string,
  ): Promise<RolePermissionMatrixView | null>;
}
