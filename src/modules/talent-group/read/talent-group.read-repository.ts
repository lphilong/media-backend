import {
  TalentGroupByTalentListItemView,
  TalentGroupDetailView,
  TalentGroupListItemView,
  TalentGroupMemberListItemView,
  TalentGroupSortDirection,
  TalentGroupSortField,
  TalentGroupStatus,
} from "@modules/talent-group/domain/talent-group.types";

export interface ListTalentGroupReadInput {
  readonly groupIds?: readonly string[];
  readonly status?: TalentGroupStatus;
  readonly containsTalentId?: string;
  readonly limit: number;
  readonly cursor?: string;
  readonly search?: string;
  readonly sortField?: TalentGroupSortField;
  readonly sortDirection?: TalentGroupSortDirection;
}

export interface ListTalentGroupReadResult {
  readonly items: readonly TalentGroupListItemView[];
  readonly nextCursor?: string;
}

export interface ListTalentGroupMembersReadInput {
  readonly groupId: string;
  readonly limit: number;
  readonly cursor?: string;
}

export interface ListTalentGroupMembersReadResult {
  readonly items: readonly TalentGroupMemberListItemView[];
  readonly nextCursor?: string;
}

export interface ListTalentGroupsByTalentReadInput {
  readonly talentId: string;
  readonly groupIds?: readonly string[];
  readonly status?: TalentGroupStatus;
  readonly limit: number;
  readonly cursor?: string;
  readonly sortField?: TalentGroupSortField;
  readonly sortDirection?: TalentGroupSortDirection;
}

export interface ListTalentGroupsByTalentReadResult {
  readonly items: readonly TalentGroupByTalentListItemView[];
  readonly nextCursor?: string;
}

export interface TalentGroupReadRepository {
  listTalentGroups(
    input: ListTalentGroupReadInput,
  ): Promise<ListTalentGroupReadResult>;

  getTalentGroupDetail(groupId: string): Promise<TalentGroupDetailView | null>;

  listTalentGroupMembers(
    input: ListTalentGroupMembersReadInput,
  ): Promise<ListTalentGroupMembersReadResult>;

  listTalentGroupsByTalent(
    input: ListTalentGroupsByTalentReadInput,
  ): Promise<ListTalentGroupsByTalentReadResult>;
}
