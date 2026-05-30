import { TalentOrigin } from "@modules/talent/domain/talent.types";

export interface SelfServiceTalentGroupMembershipReadModel {
  readonly groupId: string;
  readonly lineupOrder: number;
  readonly joinedAt: number;
}

export interface SelfServiceTalentGroupReadModel {
  readonly id: string;
  readonly talentGroupCode: string;
  readonly name: string;
  readonly status: "ACTIVE";
  readonly displayOrder: number;
}

export interface SelfServiceTalentGroupManagerReadModel {
  readonly groupId: string;
  readonly displayName: string;
  readonly employeeCode?: string;
  readonly isPrimary: boolean;
}

export interface SelfServiceTalentGroupMemberReadModel {
  readonly groupId: string;
  readonly talentCode: string;
  readonly displayName: string;
  readonly performanceAlias?: string;
  readonly origin: TalentOrigin;
  readonly lineupOrder: number;
}

export interface SelfServiceTalentGroupsReadRepository {
  listActiveMembershipsByTalent(
    talentId: string,
  ): Promise<readonly SelfServiceTalentGroupMembershipReadModel[]>;

  listActiveGroupsByIds(
    groupIds: readonly string[],
  ): Promise<readonly SelfServiceTalentGroupReadModel[]>;

  listActiveCurrentManagersByGroupIds(
    groupIds: readonly string[],
    asOf: number,
  ): Promise<readonly SelfServiceTalentGroupManagerReadModel[]>;

  listActiveMembersByGroupIds(
    groupIds: readonly string[],
  ): Promise<readonly SelfServiceTalentGroupMemberReadModel[]>;
}
