import {
  UserAccountStatus,
  UserDetailView,
  UserListItemView,
} from "@modules/user/domain/user.types";

export interface ListUserReadInput {
  readonly state?: UserAccountStatus;
  readonly hasEmploymentProfile?: boolean;
  readonly limit: number;
  readonly cursor?: string;
  readonly search?: string;
}

export interface ListUserReadResult {
  readonly items: readonly UserListItemView[];
  readonly nextCursor?: string;
}

export interface UserReadRepository {
  listUsers(
    input: ListUserReadInput,
  ): Promise<ListUserReadResult>;

  getUserDetail(
    userId: string,
  ): Promise<UserDetailView | null>;
}
