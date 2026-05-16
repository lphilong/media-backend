import { ClientSession } from "mongodb";
import { BusinessCodePolicy } from "@core/business-code/business-code-sequence.repository";
import {
  TalentGroupMemberRecord,
  TalentGroupMemberStatus,
  TalentGroupRecord,
  TalentGroupStatus,
} from "./talent-group.types";

export interface FindLiveTalentGroupByNormalizedNameInput {
  readonly normalizedName: string;
  readonly excludeGroupId?: string;
}

export interface UpdateTalentGroupCoreInput {
  readonly groupId: string;
  readonly name?: string;
  readonly normalizedName?: string;
  readonly shortName?: string | null;
  readonly normalizedShortName?: string | null;
  readonly description?: string | null;
  readonly externalRef?: string | null;
  readonly displayOrder?: number;
  readonly updatedAt: number;
}

export interface TransitionTalentGroupStatusInput {
  readonly groupId: string;
  readonly fromStatuses: readonly TalentGroupStatus[];
  readonly toStatus: TalentGroupStatus;
  readonly updatedAt: number;
}

export interface FindLiveTalentGroupMemberByTalentInput {
  readonly groupId: string;
  readonly talentId: string;
  readonly excludeMembershipId?: string;
}

export interface FindLiveTalentGroupMemberByLineupInput {
  readonly groupId: string;
  readonly lineupOrder: number;
  readonly excludeMembershipId?: string;
}

export interface UpdateTalentGroupMemberLineupInput {
  readonly membershipId: string;
  readonly lineupOrder: number;
  readonly updatedAt: number;
}

export interface TransitionTalentGroupMemberStatusInput {
  readonly membershipId: string;
  readonly fromStatuses: readonly TalentGroupMemberStatus[];
  readonly toStatus: TalentGroupMemberStatus;
  readonly updatedAt: number;
  readonly leftAt?: number | null;
}

export interface TalentGroupRepository {
  insertGroup(
    group: TalentGroupRecord,
    session: ClientSession,
  ): Promise<TalentGroupRecord>;

  findGroupById(
    groupId: string,
    session?: ClientSession,
  ): Promise<TalentGroupRecord | null>;

  findGroupByCode(
    groupCode: string,
    session?: ClientSession,
  ): Promise<TalentGroupRecord | null>;

  findMaxGeneratedCodeSequence(
    policy: Pick<BusinessCodePolicy, "prefix" | "width">,
    session?: ClientSession,
  ): Promise<number>;

  findLiveGroupByNormalizedName(
    input: FindLiveTalentGroupByNormalizedNameInput,
    session?: ClientSession,
  ): Promise<TalentGroupRecord | null>;

  updateGroupCore(
    input: UpdateTalentGroupCoreInput,
    session: ClientSession,
  ): Promise<TalentGroupRecord | null>;

  transitionGroupStatus(
    input: TransitionTalentGroupStatusInput,
    session: ClientSession,
  ): Promise<TalentGroupRecord | null>;

  insertMember(
    member: TalentGroupMemberRecord,
    session: ClientSession,
  ): Promise<TalentGroupMemberRecord>;

  findMemberById(
    membershipId: string,
    session?: ClientSession,
  ): Promise<TalentGroupMemberRecord | null>;

  findLiveMemberByGroupAndTalent(
    input: FindLiveTalentGroupMemberByTalentInput,
    session?: ClientSession,
  ): Promise<TalentGroupMemberRecord | null>;

  findLiveMemberByGroupAndLineup(
    input: FindLiveTalentGroupMemberByLineupInput,
    session?: ClientSession,
  ): Promise<TalentGroupMemberRecord | null>;

  updateMemberLineup(
    input: UpdateTalentGroupMemberLineupInput,
    session: ClientSession,
  ): Promise<TalentGroupMemberRecord | null>;

  transitionMemberStatus(
    input: TransitionTalentGroupMemberStatusInput,
    session: ClientSession,
  ): Promise<TalentGroupMemberRecord | null>;

  hasActiveMembers(
    groupId: string,
    session?: ClientSession,
  ): Promise<boolean>;

  hasNonRemovedMembers(
    groupId: string,
    session?: ClientSession,
  ): Promise<boolean>;
}
