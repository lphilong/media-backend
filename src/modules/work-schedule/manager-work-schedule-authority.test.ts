import assert from "node:assert/strict";
import { test } from "node:test";
import { Actor } from "@core/actor/actor";
import { Permission } from "@core/permission/permission.enum";
import type { UserRoleAssignmentRecord } from "@modules/role/domain/role.types";
import {
  StructuredScopeAuthorityService,
  type StructuredScopeAuthorityAssignment,
} from "@modules/role/domain/structured-scope-authority";
import type { ResponsibilityManagedScopeReader } from "@modules/responsibility/domain/responsibility-managed-scope";
import {
  assertManagerWorkSchedulePermission,
  resolveManagerWorkScheduleTargetAuthority,
} from "./admin/manager-work-schedule-authority";

const NOW = Date.parse("2026-06-06T00:00:00+07:00");

test("Manager WorkSchedule permission requires active MANAGER_CONSOLE and the operation permission", () => {
  assert.doesNotThrow(() =>
    assertManagerWorkSchedulePermission(
      managerActor(),
      Permission.WORK_SCHEDULE_READ,
    ),
  );
  assert.throws(() =>
    assertManagerWorkSchedulePermission(
      managerActor({ accountContexts: [] }),
      Permission.WORK_SCHEDULE_READ,
    ),
  );
  assert.throws(() =>
    assertManagerWorkSchedulePermission(
      managerActor({ accountContexts: ["ADMIN_CONSOLE"] }),
      Permission.WORK_SCHEDULE_READ,
    ),
  );
  assert.throws(() =>
    assertManagerWorkSchedulePermission(
      managerActor({ permissions: [] }),
      Permission.WORK_SCHEDULE_READ,
    ),
  );
  assert.throws(() =>
    assertManagerWorkSchedulePermission(
      managerActor({ isActive: false }),
      Permission.WORK_SCHEDULE_READ,
    ),
  );
});

test("Manager WorkSchedule target authority intersects exact central responsibility and structured scope", async () => {
  const cases = [
    {
      name: "exact OrgUnit succeeds",
      responsibilities: responsibilityReader(["org-a"], []),
      grants: [{ scopeType: "managedOrgUnit", targetId: "org-a" }] as const,
      expectedOrgUnits: ["org-a"],
      expectedTalentGroups: [],
    },
    {
      name: "exact TalentGroup succeeds",
      responsibilities: responsibilityReader([], ["group-a"]),
      grants: [{ scopeType: "managedTalentGroup", targetId: "group-a" }] as const,
      expectedOrgUnits: [],
      expectedTalentGroups: ["group-a"],
    },
    {
      name: "permission and scope without responsibility fail",
      responsibilities: responsibilityReader([], []),
      grants: [{ scopeType: "managedOrgUnit", targetId: "org-a" }] as const,
      expectedOrgUnits: [],
      expectedTalentGroups: [],
    },
    {
      name: "responsibility without ScopeGrant fails",
      responsibilities: responsibilityReader(["org-a"], ["group-a"]),
      grants: [] as const,
      expectedOrgUnits: [],
      expectedTalentGroups: [],
    },
    {
      name: "correct responsibility with wrong scope fails",
      responsibilities: responsibilityReader(["org-a"], []),
      grants: [{ scopeType: "managedOrgUnit", targetId: "org-b" }] as const,
      expectedOrgUnits: [],
      expectedTalentGroups: [],
    },
    {
      name: "correct scope with wrong responsibility fails",
      responsibilities: responsibilityReader(["org-b"], []),
      grants: [{ scopeType: "managedOrgUnit", targetId: "org-a" }] as const,
      expectedOrgUnits: [],
      expectedTalentGroups: [],
    },
    {
      name: "descendant-expanded OrgUnit without exact responsibility fails",
      responsibilities: responsibilityReader(["org-a"], [], ["org-a", "org-child"]),
      grants: [{ scopeType: "managedOrgUnit", targetId: "org-child" }] as const,
      expectedOrgUnits: [],
      expectedTalentGroups: [],
    },
  ];

  for (const scenario of cases) {
    const result = await resolveManagerWorkScheduleTargetAuthority({
      actor: managerActor(),
      managerEmploymentProfileId: "ep-manager",
      permission: Permission.WORK_SCHEDULE_READ,
      managedScopeReader: scenario.responsibilities,
      structuredAuthority: authority(scenario.grants),
      asOf: NOW,
    });
    assert.deepEqual([...result.orgUnitIds], scenario.expectedOrgUnits, scenario.name);
    assert.deepEqual(
      [...result.talentGroupIds],
      scenario.expectedTalentGroups,
      scenario.name,
    );
  }
});

function managerActor(overrides?: {
  readonly accountContexts?: readonly ("ADMIN_CONSOLE" | "MANAGER_CONSOLE")[];
  readonly permissions?: readonly Permission[];
  readonly isActive?: boolean;
}): Actor {
  return new Actor({
    id: "manager-user",
    type: "admin",
    context: "ADMIN",
    accountContexts: overrides?.accountContexts ?? ["MANAGER_CONSOLE"],
    roles: ["ORG_UNIT_MANAGER"],
    permissions: overrides?.permissions ?? [Permission.WORK_SCHEDULE_READ],
    scopeGrants: { workSchedule: ["team"] },
    isActive: overrides?.isActive ?? true,
  });
}

function responsibilityReader(
  exactOrgUnitIds: readonly string[],
  talentGroupIds: readonly string[],
  expandedOrgUnitIds: readonly string[] = exactOrgUnitIds,
): ResponsibilityManagedScopeReader {
  return {
    async resolveManagedScopeByResponsibleEmploymentProfile() {
      return {
        orgUnitIds: expandedOrgUnitIds,
        talentGroupIds,
        orgUnitScopes: exactOrgUnitIds.map((orgUnitId) => ({
          orgUnitId,
          role: "UNIT_MANAGER",
          includeDescendants: expandedOrgUnitIds.length > exactOrgUnitIds.length,
          actionMask: [],
          isPrimary: true,
        })),
      };
    },
  };
}

function authority(
  grants: UserRoleAssignmentRecord["structuredScopeGrants"],
): StructuredScopeAuthorityService {
  const record: StructuredScopeAuthorityAssignment = {
    assignment: {
      assignmentId: "assignment",
      roleId: "role",
      userId: "manager-user",
      structuredScopeGrants: grants,
      state: "ACTIVE",
      effectiveAt: NOW - 1,
      expiresAt: null,
      revokedAt: null,
      origin: "DIRECT",
      bundleOrigin: null,
      reason: null,
      createdAt: NOW - 1,
      updatedAt: NOW - 1,
    },
    role: {
      id: "role",
      state: "ACTIVE",
      permissions: [Permission.WORK_SCHEDULE_READ],
    },
  };
  return new StructuredScopeAuthorityService(
    { async listByUserId() { return [record]; } },
    () => NOW,
  );
}
