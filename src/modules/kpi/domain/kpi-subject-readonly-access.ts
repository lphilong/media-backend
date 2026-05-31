import { ClientSession } from "mongodb";

export interface KpiGroupMemberLookup {
  readonly membershipId: string;
  readonly talentId: string;
  readonly employmentProfileId: string | null;
  readonly displayName: string | null;
}

export interface KpiManagedMemberLookup {
  readonly employmentProfileId: string;
  readonly employeeCode: string | null;
  readonly displayName: string;
  readonly talentId: string;
  readonly talentCode: string | null;
  readonly groupId: string;
}

export interface KpiActorEmploymentProfileLookup {
  readonly employmentProfileId: string;
}

export interface KpiActorTalentLookup {
  readonly talentId: string;
}

export interface KpiSubjectReadonlyAccess {
  hasActiveTalent(talentId: string, session?: ClientSession): Promise<boolean>;
  hasActiveTalentGroup(
    groupId: string,
    session?: ClientSession,
  ): Promise<boolean>;
  findActiveGroupMember(
    groupId: string,
    memberTalentId: string,
    session?: ClientSession,
  ): Promise<KpiGroupMemberLookup | null>;
  findActiveGroupMemberByEmploymentProfile(
    groupId: string,
    employmentProfileId: string,
    session?: ClientSession,
  ): Promise<KpiGroupMemberLookup | null>;
  listActiveInternalGroupMembers(
    groupId: string,
    input: {
      readonly search?: string;
      readonly limit: number;
    },
    session?: ClientSession,
  ): Promise<readonly KpiManagedMemberLookup[]>;
  findActiveEmploymentProfileByLinkedUserId(
    linkedUserId: string,
    session?: ClientSession,
  ): Promise<KpiActorEmploymentProfileLookup | null>;
  findNonArchivedTalentByLinkedEmploymentProfileId(
    linkedEmploymentProfileId: string,
    session?: ClientSession,
  ): Promise<KpiActorTalentLookup | null>;
}
