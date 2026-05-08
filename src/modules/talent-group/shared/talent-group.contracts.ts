import {
  TalentGroupByTalentListItemView,
  TalentGroupDetailView,
  TalentGroupListItemView,
  TalentGroupMemberListItemView,
  TalentGroupMemberMutationView,
  TalentGroupMutationView,
  TalentGroupSortDirection,
  TalentGroupSortField,
  TalentGroupStatus,
} from "@modules/talent-group/domain/talent-group.types";

export interface CreateTalentGroupCommand {
  readonly groupCode: string;
  readonly name: string;
  readonly shortName?: string | null;
  readonly description?: string | null;
  readonly displayOrder: number | string;
  readonly externalRef?: string | null;
}

export interface UpdateTalentGroupCoreCommand {
  readonly groupId: string;
  readonly name?: string;
  readonly shortName?: string | null;
  readonly description?: string | null;
  readonly displayOrder?: number | string;
  readonly externalRef?: string | null;
}

export interface ActivateTalentGroupCommand {
  readonly groupId: string;
}

export interface DeactivateTalentGroupCommand {
  readonly groupId: string;
}

export interface ArchiveTalentGroupCommand {
  readonly groupId: string;
}

export interface AddTalentGroupMemberCommand {
  readonly groupId: string;
  readonly talentId: string;
  readonly lineupOrder: number;
}

export interface UpdateTalentGroupMemberLineupCommand {
  readonly membershipId: string;
  readonly newLineupOrder: number;
}

export interface DeactivateTalentGroupMemberCommand {
  readonly membershipId: string;
}

export interface ReactivateTalentGroupMemberCommand {
  readonly membershipId: string;
}

export interface RemoveTalentGroupMemberCommand {
  readonly membershipId: string;
}

export interface GetTalentGroupDetailQuery {
  readonly groupId: string;
}

export interface ListTalentGroupsQuery {
  readonly status?: TalentGroupStatus | string;
  readonly containsTalentId?: string;
  readonly limit?: number | string;
  readonly cursor?: string;
  readonly search?: string;
  readonly sortBy?: TalentGroupSortField | string;
  readonly sortDirection?: TalentGroupSortDirection | string;
}

export interface ListTalentGroupMembersQuery {
  readonly groupId: string;
  readonly limit?: number | string;
  readonly cursor?: string;
}

export interface ListTalentGroupsByTalentQuery {
  readonly talentId: string;
  readonly status?: TalentGroupStatus | string;
  readonly limit?: number | string;
  readonly cursor?: string;
  readonly sortBy?: TalentGroupSortField | string;
  readonly sortDirection?: TalentGroupSortDirection | string;
}

export type TalentGroupMutationResult =
  | TalentGroupMutationView
  | TalentGroupMemberMutationView;

export type GetTalentGroupDetailResult =
  TalentGroupDetailView;

export interface ListTalentGroupsResult {
  readonly items: readonly TalentGroupListItemView[];
  readonly nextCursor?: string;
}

export interface ListTalentGroupMembersResult {
  readonly items: readonly TalentGroupMemberListItemView[];
  readonly nextCursor?: string;
}

export interface ListTalentGroupsByTalentResult {
  readonly items: readonly TalentGroupByTalentListItemView[];
  readonly nextCursor?: string;
}
