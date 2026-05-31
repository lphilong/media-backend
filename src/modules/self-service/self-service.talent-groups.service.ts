import { Actor } from "@core/actor/actor";
import {
  SelfServiceTalentGroupsReadRepository,
  SelfServiceTalentGroupManagerReadModel,
  SelfServiceTalentGroupMemberReadModel,
} from "@modules/self-service/domain/self-service-talent-groups.repository";
import {
  SelfServiceTalentGroupItemView,
  SelfServiceTalentGroupListView,
} from "@modules/self-service/domain/self-service.types";
import { SelfServiceIdentityResolver } from "@modules/self-service/shared/self-service.identity-resolver";

const MAX_GROUPS = 10;
const MAX_MEMBERS_PER_GROUP = 50;
const MAX_MANAGERS_PER_GROUP = 5;

export class SelfServiceTalentGroupsService {
  constructor(
    private readonly identityResolver: SelfServiceIdentityResolver,
    private readonly talentGroupsReadRepository: SelfServiceTalentGroupsReadRepository,
    private readonly clock: () => number = Date.now,
  ) {}

  async listCurrentTalentGroups(
    actor: Actor,
  ): Promise<SelfServiceTalentGroupListView> {
    const { linkedInternalTalent } =
      await this.identityResolver.resolveEmploymentProfileWithLinkedInternalTalent(
        actor,
      );

    if (!linkedInternalTalent) {
      return emptyTalentGroupList();
    }

    const memberships =
      await this.talentGroupsReadRepository.listActiveMembershipsByTalent(
        linkedInternalTalent.id,
      );
    const visibleGroupIds = uniqueNonEmpty(
      memberships.map((membership) => membership.groupId),
    );
    const cappedVisibleGroupIds = visibleGroupIds.slice(0, MAX_GROUPS);

    if (cappedVisibleGroupIds.length === 0) {
      return emptyTalentGroupList();
    }

    const [groups, managers, members] = await Promise.all([
      this.talentGroupsReadRepository.listActiveGroupsByIds(
        cappedVisibleGroupIds,
      ),
      this.talentGroupsReadRepository.listActiveCurrentManagersByGroupIds(
        cappedVisibleGroupIds,
        this.clock(),
      ),
      this.talentGroupsReadRepository.listActiveMembersByGroupIds(
        cappedVisibleGroupIds,
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
          managers: (
            managersByGroup.get(group.id) ?? emptyGroupManagers()
          ).items,
          members: (membersByGroup.get(group.id) ?? emptyGroupMembers()).items,
          managersTruncated: (
            managersByGroup.get(group.id) ?? emptyGroupManagers()
          ).truncated,
          maxManagers: MAX_MANAGERS_PER_GROUP,
          membersTruncated:
            (membersByGroup.get(group.id) ?? emptyGroupMembers()).truncated,
          maxMembers: MAX_MEMBERS_PER_GROUP,
        }))
        .sort(
          (left, right) =>
            left.name.localeCompare(right.name) ||
            left.talentGroupCode.localeCompare(right.talentGroupCode),
        ),
      meta: {
        groupsTruncated: visibleGroupIds.length > MAX_GROUPS,
        maxGroups: MAX_GROUPS,
      },
    };
  }
}

function emptyTalentGroupList(): SelfServiceTalentGroupListView {
  return {
    items: [],
    meta: {
      groupsTruncated: false,
      maxGroups: MAX_GROUPS,
    },
  };
}

function groupManagers(
  managers: readonly SelfServiceTalentGroupManagerReadModel[],
): Map<
  string,
  {
    readonly items: SelfServiceTalentGroupItemView["managers"];
    readonly truncated: boolean;
  }
> {
  const map = new Map<
    string,
    Array<SelfServiceTalentGroupItemView["managers"][number]>
  >();

  for (const manager of [...managers].sort(compareManagers)) {
    const current = map.get(manager.groupId) ?? [];
    if (current.length < MAX_MANAGERS_PER_GROUP) {
      current.push({
        displayName: manager.displayName,
        employeeCode: manager.employeeCode,
      });
    }
    map.set(manager.groupId, current);
  }

  return new Map(
    [...map.entries()].map(([groupId, items]) => [
      groupId,
      {
        items,
        truncated:
          managers.filter((manager) => manager.groupId === groupId).length >
          MAX_MANAGERS_PER_GROUP,
      },
    ]),
  );
}

function groupMembers(
  members: readonly SelfServiceTalentGroupMemberReadModel[],
): Map<
  string,
  {
    readonly items: SelfServiceTalentGroupItemView["members"];
    readonly truncated: boolean;
  }
> {
  const map = new Map<
    string,
    Array<SelfServiceTalentGroupItemView["members"][number]>
  >();

  for (const member of [...members].sort(compareMembers)) {
    const current = map.get(member.groupId) ?? [];
    if (current.length < MAX_MEMBERS_PER_GROUP) {
      current.push({
        talentCode: member.talentCode,
        displayName: member.displayName,
        performanceAlias: member.performanceAlias,
        origin: member.origin,
      });
    }
    map.set(member.groupId, current);
  }

  return new Map(
    [...map.entries()].map(([groupId, items]) => [
      groupId,
      {
        items,
        truncated:
          members.filter((member) => member.groupId === groupId).length >
          MAX_MEMBERS_PER_GROUP,
      },
    ]),
  );
}

function emptyGroupManagers(): {
  readonly items: SelfServiceTalentGroupItemView["managers"];
  readonly truncated: boolean;
} {
  return { items: [], truncated: false };
}

function emptyGroupMembers(): {
  readonly items: SelfServiceTalentGroupItemView["members"];
  readonly truncated: boolean;
} {
  return { items: [], truncated: false };
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

function uniqueNonEmpty(values: readonly string[]): readonly string[] {
  return [
    ...new Set(
      values
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  ];
}
