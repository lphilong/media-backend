import assert from "node:assert/strict";
import test from "node:test";
import { Actor } from "@core/actor/actor";
import { Permission } from "@core/permission/permission.enum";
import {
  EmploymentProfileListItemView,
  EmploymentProfileRecord,
} from "@modules/employment-profile/domain/employment-profile.types";
import { ResponsibilityManagedScope } from "@modules/responsibility/domain/responsibility-managed-scope";
import {
  StructuredScopeAuthorityAssignment,
  StructuredScopeAuthorityService,
} from "@modules/role/domain/structured-scope-authority";
import { TalentGroupMemberRecord } from "@modules/talent-group/domain/talent-group.types";
import { TalentListItemView } from "@modules/talent/domain/talent.types";
import { ManagerWorkspaceScopeNotFoundError } from "./manager-workspace.errors";
import { ManagerWorkspaceGroupAdminService } from "./admin/admin.manager-workspace-group.service";

const now = Date.parse("2026-06-15T00:00:00+07:00");

test("managed-group reads require exact responsibility and structured scope", async () => {
  const service = createService({
    scope: {
      orgUnitIds: ["ou-exact", "ou-parent"],
      orgUnitScopes: [orgScope("ou-exact", false), orgScope("ou-parent", true)],
      talentGroupIds: ["tg-exact"],
    },
    authority: [
      grant(Permission.MANAGER_GROUP_READ, "managedOrgUnit", "ou-exact"),
      grant(Permission.MANAGER_MEMBER_READ, "managedOrgUnit", "ou-exact"),
      grant(Permission.MANAGER_GROUP_READ, "managedTalentGroup", "tg-exact"),
      grant(Permission.MANAGER_MEMBER_READ, "managedTalentGroup", "tg-exact"),
    ],
  });
  const groups = await service.listGroups(managerActor(), {});
  assert.deepEqual(
    groups.items.map((item) => `${item.scopeType}:${item.scopeId}`),
    ["ORG_UNIT:ou-exact", "TALENT_GROUP:tg-exact"],
  );
  assert.equal(
    groups.items.some((item) => item.scopeId === "ou-parent"),
    false,
  );
  await assert.rejects(
    service.getGroup(managerActor(), "ORG_UNIT", "ou-other"),
    ManagerWorkspaceScopeNotFoundError,
  );
  await assert.rejects(
    service.getGroup(managerActor(), "ORG_UNIT", "ou-missing"),
    ManagerWorkspaceScopeNotFoundError,
  );
});

test("member reads require the separate member permission", async () => {
  const service = createService({
    scope: scopeForOrg("ou-exact"),
    authority: [
      grant(Permission.MANAGER_GROUP_READ, "managedOrgUnit", "ou-exact"),
    ],
  });
  await assert.rejects(
    service.listMembers(
      managerActor({ permissions: [Permission.MANAGER_GROUP_READ] }),
      "ORG_UNIT",
      "ou-exact",
      {},
    ),
    /Missing permission managerWorkspace\.member\.read/u,
  );
});

test("managed members use EmploymentProfile identity and privacy-safe fields", async () => {
  const internal = profile("ep-member", "ou-exact", "Member One");
  const service = createService({
    scope: scopeForOrg("ou-exact"),
    profiles: [internal],
    authority: orgReadGrants("ou-exact"),
  });
  const result = await service.listMembers(
    managerActor(),
    "ORG_UNIT",
    "ou-exact",
    {},
  );
  assert.equal(result.items[0]?.operationalMemberId, "ep-member");
  assert.equal(result.items[0]?.personKind, "INTERNAL");
  assert.deepEqual(result.items[0]?.eligibility, {
    kpi: false,
    schedule: false,
    actualEntry: false,
    mutation: false,
  });
  assert.deepEqual(result.items[0]?.readinessReasonCodes, [
    "KPI_SOURCE_NOT_RESOLVED",
    "SCHEDULE_SOURCE_NOT_RESOLVED",
  ]);
  assert.equal(
    (
      await service.listMembers(managerActor(), "ORG_UNIT", "ou-exact", {
        personKind: "INTERNAL",
        kpiEligibility: "INELIGIBLE",
        scheduleEligibility: "INELIGIBLE",
      })
    ).items.length,
    1,
  );
  assert.equal(
    (
      await service.listMembers(managerActor(), "ORG_UNIT", "ou-exact", {
        kpiEligibility: "ELIGIBLE",
      })
    ).items.length,
    0,
  );
  const serialized = JSON.stringify(result.items[0]);
  for (const forbidden of [
    "linkedUserId",
    "legalName",
    "email",
    "phone",
    "salary",
    "contractStatus",
    "managerEmploymentProfileId",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("external-only Talent remains visible without a fabricated operational target", async () => {
  const talent = talentListItem("talent-external", null);
  const membership = groupMembership(
    "membership-external",
    talent.id,
    "tg-exact",
  );
  const service = createService({
    scope: { orgUnitIds: [], orgUnitScopes: [], talentGroupIds: ["tg-exact"] },
    talents: [talent],
    memberships: [membership],
    authority: talentGroupReadGrants("tg-exact"),
  });
  const result = await service.listMembers(
    managerActor(),
    "TALENT_GROUP",
    "tg-exact",
    {},
  );
  const member = result.items[0];
  assert.equal(member?.personKind, "EXTERNAL_ONLY");
  assert.equal(member?.operationalMemberId, null);
  assert.deepEqual(member?.eligibility, {
    kpi: false,
    schedule: false,
    actualEntry: false,
    mutation: false,
  });
  assert.equal(member?.navigation.memberRef, null);
  assert.equal(member?.trace.talentId, "talent-external");
  assert.equal(member?.trace.membershipId, "membership-external");
});

test("group list provides bounded search, filters, honest cursors, and no-assignment readiness", async () => {
  const scope: ResponsibilityManagedScope = {
    orgUnitIds: ["ou-a", "ou-b"],
    orgUnitScopes: [orgScope("ou-a", false), orgScope("ou-b", false)],
    talentGroupIds: ["tg-a"],
  };
  const authority = [
    ...orgReadGrants("ou-a"),
    ...orgReadGrants("ou-b"),
    ...talentGroupReadGrants("tg-a"),
  ];
  const service = createService({ scope, authority });
  const first = await service.listGroups(managerActor(), { limit: "1" });
  assert.equal(first.items.length, 1);
  assert.ok(first.nextCursor);
  const second = await service.listGroups(managerActor(), {
    limit: "1",
    cursor: first.nextCursor,
  });
  assert.equal(second.items.length, 1);
  assert.notEqual(second.items[0]?.scopeId, first.items[0]?.scopeId);
  const filtered = await service.listGroups(managerActor(), {
    scopeType: "TALENT_GROUP",
    search: "TG-A",
  });
  assert.deepEqual(
    filtered.items.map((item) => item.scopeId),
    ["tg-a"],
  );

  const empty = createService({
    scope: { orgUnitIds: [], orgUnitScopes: [], talentGroupIds: [] },
    authority: [],
  });
  const readiness = await empty.listGroups(managerActor(), {});
  assert.deepEqual(readiness.items, []);
  assert.deepEqual(readiness.readiness, {
    hasAssignedScope: false,
    reasonCodes: ["NO_MANAGER_RESPONSIBILITY_ASSIGNED"],
  });
  await assert.rejects(
    service.listGroups(managerActor(), { limit: "101" }),
    /limit must be between 1 and 100/u,
  );
});

function createService(input: {
  readonly scope: ResponsibilityManagedScope;
  readonly authority: readonly StructuredScopeAuthorityAssignment[];
  readonly profiles?: readonly EmploymentProfileRecord[];
  readonly talents?: readonly TalentListItemView[];
  readonly memberships?: readonly TalentGroupMemberRecord[];
}): ManagerWorkspaceGroupAdminService {
  const manager = profile("ep-manager", "ou-manager", "Manager");
  const profiles = input.profiles ?? [];
  const talents = input.talents ?? [];
  const memberships = input.memberships ?? [];
  return new ManagerWorkspaceGroupAdminService(
    {
      async findNonArchivedByLinkedUserId(userId) {
        return userId === "user-manager" ? manager : null;
      },
      async findById(id) {
        return profiles.find((item) => item.id === id) ?? null;
      },
    },
    {
      async listEmploymentProfiles(query) {
        const items = profiles
          .filter(
            (item) => !query.orgUnitId || item.orgUnitId === query.orgUnitId,
          )
          .map(toListItem);
        return { items, nextCursor: undefined };
      },
      async getEmploymentProfileDetail(id) {
        return profiles.find((item) => item.id === id) ?? null;
      },
    },
    {
      async getOrgUnitDetail(id) {
        if (!input.scope.orgUnitIds.includes(id)) return null;
        return {
          id,
          code: id.toUpperCase(),
          name: `Org ${id}`,
          type: "TEAM",
          status: "ACTIVE",
          description: null,
          externalRef: null,
          parentOrgUnitId: null,
          depth: 0,
          displayOrder: 0,
          createdAt: now,
          updatedAt: now,
          hierarchy: { id, parentOrgUnitId: null, depth: 0, ancestorChain: [] },
        };
      },
    },
    {
      async findMemberById(id) {
        return memberships.find((item) => item.id === id) ?? null;
      },
    },
    {
      async getTalentGroupDetail(id) {
        if (!input.scope.talentGroupIds.includes(id)) return null;
        return {
          id,
          groupCode: id.toUpperCase(),
          name: `Talent ${id}`,
          shortName: null,
          status: "ACTIVE",
          displayOrder: 0,
          createdAt: now,
          updatedAt: now,
          description: null,
          externalRef: null,
        };
      },
    },
    {
      async findById(id) {
        const item = talents.find((talent) => talent.id === id);
        return item
          ? {
              id: item.id,
              talentCode: item.talentCode,
              stageName: item.stageName,
              normalizedStageName: item.stageName.toLowerCase(),
              legalName: item.legalName,
              normalizedLegalName: item.legalName.toLowerCase(),
              displayShortName: item.displayShortName,
              normalizedDisplayShortName:
                item.displayShortName?.toLowerCase() ?? null,
              talentOrigin: item.talentOrigin,
              operationalStatus: item.operationalStatus,
              managerEmploymentProfileId: null,
              linkedEmploymentProfileId: item.linkedEmploymentProfileId,
              commercialParticipationStatus: item.commercialParticipationStatus,
              livestreamEligible: item.livestreamEligible,
              eventEligible: item.eventEligible,
              externalRef: null,
              profileSummary: null,
              createdAt: item.createdAt,
              updatedAt: item.updatedAt,
            }
          : null;
      },
    },
    {
      async listTalents() {
        return { items: talents, nextCursor: undefined };
      },
    },
    {
      async findActiveGroupMember(groupId, talentId) {
        const item = memberships.find(
          (member) =>
            member.groupId === groupId && member.talentId === talentId,
        );
        const talent = talents.find((candidate) => candidate.id === talentId);
        return item
          ? {
              membershipId: item.id,
              talentId: item.talentId,
              employmentProfileId: talent?.linkedEmploymentProfileId ?? null,
              displayName: talent?.displayName ?? null,
            }
          : null;
      },
      async findActiveGroupMemberByEmploymentProfile(
        groupId,
        employmentProfileId,
      ) {
        const talent = talents.find(
          (item) => item.linkedEmploymentProfileId === employmentProfileId,
        );
        const item = talent
          ? memberships.find(
              (member) =>
                member.groupId === groupId && member.talentId === talent.id,
            )
          : undefined;
        return item && talent
          ? {
              membershipId: item.id,
              talentId: item.talentId,
              employmentProfileId: talent.linkedEmploymentProfileId,
              displayName: talent.displayName,
            }
          : null;
      },
    },
    {
      async resolveManagedScopeByResponsibleEmploymentProfile() {
        return input.scope;
      },
    },
    new StructuredScopeAuthorityService(
      {
        async listByUserId(userId) {
          return userId === "user-manager" ? input.authority : [];
        },
      },
      () => now,
    ),
    () => now,
  );
}

function managerActor(
  overrides: Partial<ConstructorParameters<typeof Actor>[0]> = {},
): Actor {
  return new Actor({
    id: "user-manager",
    type: "admin",
    context: "ADMIN",
    roles: [],
    permissions: [
      Permission.MANAGER_GROUP_READ,
      Permission.MANAGER_MEMBER_READ,
    ],
    scopeGrants: {},
    accountContexts: ["MANAGER_CONSOLE"],
    isActive: true,
    ...overrides,
  });
}

function profile(
  id: string,
  orgUnitId: string,
  displayName: string,
): EmploymentProfileRecord {
  return {
    id,
    employeeCode: id.toUpperCase(),
    legalName: `${displayName} Legal`,
    normalizedLegalName: `${displayName} legal`.toLowerCase(),
    displayName,
    normalizedDisplayName: displayName.toLowerCase(),
    employmentKind: "EMPLOYEE",
    jobTitle: "Operator",
    titleDescription: null,
    externalRef: null,
    orgUnitId,
    managerEmploymentProfileId: null,
    recruiterEmploymentProfileId: null,
    hrOwnerEmploymentProfileId: null,
    onboardingOwnerEmploymentProfileId: null,
    sourcedByEmploymentProfileId: null,
    linkedUserId: id === "ep-manager" ? "user-manager" : null,
    employmentStatus: "ACTIVE",
    contractStatus: "ACTIVE",
    employmentStartDate: now - 1,
    employmentEndDate: null,
    hiredAt: now - 1,
    onboardedAt: now - 1,
    createdAt: now - 1,
    updatedAt: now,
  };
}

function toListItem(
  item: EmploymentProfileRecord,
): EmploymentProfileListItemView {
  return item;
}

function talentListItem(
  id: string,
  linkedEmploymentProfileId: string | null,
): TalentListItemView {
  return {
    id,
    talentCode: id.toUpperCase(),
    displayName: "External Talent",
    performanceAlias: null,
    stageName: "External Talent",
    legalName: "Private Legal Name",
    displayShortName: null,
    talentOrigin: "EXTERNAL",
    operationalStatus: "ACTIVE",
    linkedEmploymentProfileId,
    commercialParticipationStatus: "ELIGIBLE",
    livestreamEligible: true,
    eventEligible: true,
    createdAt: now - 1,
    updatedAt: now,
  };
}

function groupMembership(
  id: string,
  talentId: string,
  groupId: string,
): TalentGroupMemberRecord {
  return {
    id,
    groupId,
    talentId,
    membershipStatus: "ACTIVE",
    lineupOrder: 0,
    joinedAt: now - 1,
    leftAt: null,
    createdAt: now - 1,
    updatedAt: now,
  };
}

function scopeForOrg(orgUnitId: string): ResponsibilityManagedScope {
  return {
    orgUnitIds: [orgUnitId],
    orgUnitScopes: [orgScope(orgUnitId, false)],
    talentGroupIds: [],
  };
}

function orgScope(orgUnitId: string, includeDescendants: boolean) {
  return {
    orgUnitId,
    role: "UNIT_MANAGER",
    includeDescendants,
    actionMask: [],
    isPrimary: true,
  };
}

function orgReadGrants(
  orgUnitId: string,
): readonly StructuredScopeAuthorityAssignment[] {
  return [
    grant(Permission.MANAGER_GROUP_READ, "managedOrgUnit", orgUnitId),
    grant(Permission.MANAGER_MEMBER_READ, "managedOrgUnit", orgUnitId),
  ];
}

function talentGroupReadGrants(
  talentGroupId: string,
): readonly StructuredScopeAuthorityAssignment[] {
  return [
    grant(Permission.MANAGER_GROUP_READ, "managedTalentGroup", talentGroupId),
    grant(Permission.MANAGER_MEMBER_READ, "managedTalentGroup", talentGroupId),
  ];
}

function grant(
  permission: Permission,
  scopeType: "managedOrgUnit" | "managedTalentGroup",
  targetId: string,
): StructuredScopeAuthorityAssignment {
  const id = `${permission}:${scopeType}:${targetId}`;
  return {
    assignment: {
      assignmentId: id,
      roleId: id,
      userId: "user-manager",
      structuredScopeGrants: [{ scopeType, targetId }],
      state: "ACTIVE",
      effectiveAt: now - 1,
      expiresAt: null,
      revokedAt: null,
      origin: "DIRECT",
      bundleOrigin: null,
      reason: null,
      createdAt: now - 1,
      updatedAt: now,
    },
    role: { id, state: "ACTIVE", permissions: [permission] },
  };
}
