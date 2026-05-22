import { ClientSession } from "mongodb";

export interface KpiGroupMemberLookup {
  readonly membershipId: string;
  readonly talentId: string;
  readonly displayName: string | null;
}

export interface KpiActorEmploymentProfileLookup {
  readonly employmentProfileId: string;
}

export interface KpiActorTalentLookup {
  readonly talentId: string;
}

export interface KpiSubjectReadonlyAccess {
  hasActiveTalent(talentId: string, session?: ClientSession): Promise<boolean>;
  hasActiveTalentGroup(groupId: string, session?: ClientSession): Promise<boolean>;
  findActiveGroupMember(
    groupId: string,
    memberTalentId: string,
    session?: ClientSession,
  ): Promise<KpiGroupMemberLookup | null>;
  findActiveEmploymentProfileByLinkedUserId(
    linkedUserId: string,
    session?: ClientSession,
  ): Promise<KpiActorEmploymentProfileLookup | null>;
  findNonArchivedTalentByLinkedEmploymentProfileId(
    linkedEmploymentProfileId: string,
    session?: ClientSession,
  ): Promise<KpiActorTalentLookup | null>;
}
