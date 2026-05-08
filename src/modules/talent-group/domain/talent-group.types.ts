export const TALENT_GROUP_STATUSES = [
  "ACTIVE",
  "INACTIVE",
  "ARCHIVED",
] as const;

export type TalentGroupStatus =
  (typeof TALENT_GROUP_STATUSES)[number];

export const TALENT_GROUP_MEMBER_STATUSES = [
  "ACTIVE",
  "INACTIVE",
  "REMOVED",
] as const;

export type TalentGroupMemberStatus =
  (typeof TALENT_GROUP_MEMBER_STATUSES)[number];

export const TALENT_GROUP_SORT_FIELDS = [
  "groupCode",
  "name",
  "createdAt",
  "displayOrder",
] as const;

export type TalentGroupSortField =
  (typeof TALENT_GROUP_SORT_FIELDS)[number];

export const TALENT_GROUP_SORT_DIRECTIONS = [
  "ASC",
  "DESC",
] as const;

export type TalentGroupSortDirection =
  (typeof TALENT_GROUP_SORT_DIRECTIONS)[number];

export interface TalentGroupRecord {
  readonly id: string;
  readonly groupCode: string;
  readonly name: string;
  readonly normalizedName: string;
  readonly shortName: string | null;
  readonly normalizedShortName: string | null;
  readonly description: string | null;
  readonly externalRef: string | null;
  readonly status: TalentGroupStatus;
  readonly displayOrder: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface TalentGroupMemberRecord {
  readonly id: string;
  readonly groupId: string;
  readonly talentId: string;
  readonly membershipStatus: TalentGroupMemberStatus;
  readonly lineupOrder: number;
  readonly joinedAt: number;
  readonly leftAt: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface TalentGroupListItemView {
  readonly id: string;
  readonly groupCode: string;
  readonly name: string;
  readonly shortName: string | null;
  readonly status: TalentGroupStatus;
  readonly displayOrder: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface TalentGroupDetailView
  extends TalentGroupListItemView {
  readonly description: string | null;
  readonly externalRef: string | null;
}

export interface TalentGroupMutationView
  extends TalentGroupDetailView {}

export interface TalentGroupMemberListItemView {
  readonly id: string;
  readonly groupId: string;
  readonly talentId: string;
  readonly membershipStatus: TalentGroupMemberStatus;
  readonly lineupOrder: number;
  readonly joinedAt: number;
  readonly leftAt: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface TalentGroupMemberMutationView
  extends TalentGroupMemberListItemView {}

export interface TalentGroupByTalentListItemView {
  readonly groupId: string;
  readonly id: string;
  readonly groupCode: string;
  readonly name: string;
  readonly shortName: string | null;
  readonly status: TalentGroupStatus;
  readonly displayOrder: number;
  readonly membershipId: string;
  readonly talentId: string;
  readonly membershipStatus: TalentGroupMemberStatus;
  readonly lineupOrder: number;
  readonly joinedAt: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}
