import { Actor } from "@core/actor/actor";
import { EmploymentProfileRepository } from "@modules/employment-profile/domain/employment-profile.repository";
import {
  SelfServiceTalentGroupsReadRepository,
  SelfServiceTalentGroupManagerReadModel,
  SelfServiceTalentGroupMemberReadModel,
} from "@modules/self-service/domain/self-service-talent-groups.repository";
import { SelfServiceCurrentPersonNotLinkedError } from "@modules/self-service/domain/self-service.errors";
import {
  SelfServiceTalentGroupItemView,
  SelfServiceTalentGroupListView,
} from "@modules/self-service/domain/self-service.types";
import { TalentRepository } from "@modules/talent/domain/talent.repository";

export class SelfServiceTalentGroupsService {
  constructor(
    private readonly employmentProfileRepository: EmploymentProfileRepository,
    private readonly talentRepository: TalentRepository,
    private readonly talentGroupsReadRepository: SelfServiceTalentGroupsReadRepository,
    private readonly clock: () => number = Date.now,
  ) {}

  async listCurrentTalentGroups(
    actor: Actor,
  ): Promise<SelfServiceTalentGroupListView> {
    const employmentProfile =
      await this.employmentProfileRepository.findNonArchivedByLinkedUserId(
        actor.id,
      );

    if (!employmentProfile) {
      throw new SelfServiceCurrentPersonNotLinkedError();
    }

    const linkedTalent =
      await this.talentRepository.findNonArchivedByLinkedEmploymentProfileId(
        employmentProfile.id,
      );

    if (
      !linkedTalent ||
      linkedTalent.talentOrigin !== "INTERNAL" ||
      linkedTalent.linkedEmploymentProfileId !== employmentProfile.id
    ) {
      return { items: [] };
    }

    const memberships =
      await this.talentGroupsReadRepository.listActiveMembershipsByTalent(
        linkedTalent.id,
      );
    const visibleGroupIds = memberships.map((membership) => membership.groupId);

    if (visibleGroupIds.length === 0) {
      return { items: [] };
    }

    const [groups, managers, members] = await Promise.all([
      this.talentGroupsReadRepository.listActiveGroupsByIds(visibleGroupIds),
      this.talentGroupsReadRepository.listActiveCurrentManagersByGroupIds(
        visibleGroupIds,
        this.clock(),
      ),
      this.talentGroupsReadRepository.listActiveMembersByGroupIds(
        visibleGroupIds,
      ),
    ]);

    const managersByGroup = groupManagers(managers);
    const membersByGroup = groupMembers(members);

    return {
      items: groups
        .map((group): SelfServiceTalentGroupItemView => ({
          talentGroupCode: group.talentGroupCode,
          name: group.name,
          status: group.status,
          managers: managersByGroup.get(group.id) ?? [],
          members: membersByGroup.get(group.id) ?? [],
        }))
        .sort(
          (left, right) =>
            left.name.localeCompare(right.name) ||
            left.talentGroupCode.localeCompare(right.talentGroupCode),
        ),
    };
  }
}

function groupManagers(
  managers: readonly SelfServiceTalentGroupManagerReadModel[],
): Map<string, SelfServiceTalentGroupItemView["managers"]> {
  const map = new Map<
    string,
    Array<SelfServiceTalentGroupItemView["managers"][number]>
  >();

  for (const manager of [...managers].sort(compareManagers)) {
    const current = map.get(manager.groupId) ?? [];
    current.push({
      displayName: manager.displayName,
      employeeCode: manager.employeeCode,
    });
    map.set(manager.groupId, current);
  }

  return map;
}

function groupMembers(
  members: readonly SelfServiceTalentGroupMemberReadModel[],
): Map<string, SelfServiceTalentGroupItemView["members"]> {
  const map = new Map<
    string,
    Array<SelfServiceTalentGroupItemView["members"][number]>
  >();

  for (const member of [...members].sort(compareMembers)) {
    const current = map.get(member.groupId) ?? [];
    current.push({
      talentCode: member.talentCode,
      displayName: member.displayName,
      performanceAlias: member.performanceAlias,
      origin: member.origin,
    });
    map.set(member.groupId, current);
  }

  return map;
}

function compareManagers(
  left: SelfServiceTalentGroupManagerReadModel,
  right: SelfServiceTalentGroupManagerReadModel,
): number {
  if (left.groupId !== right.groupId) {
    return left.groupId.localeCompare(right.groupId);
  }

  if (left.isPrimary !== right.isPrimary) {
    return left.isPrimary ? -1 : 1;
  }

  return left.displayName.localeCompare(right.displayName);
}

function compareMembers(
  left: SelfServiceTalentGroupMemberReadModel,
  right: SelfServiceTalentGroupMemberReadModel,
): number {
  if (left.groupId !== right.groupId) {
    return left.groupId.localeCompare(right.groupId);
  }

  if (left.lineupOrder !== right.lineupOrder) {
    return left.lineupOrder - right.lineupOrder;
  }

  return left.talentCode.localeCompare(right.talentCode);
}
