import assert from "node:assert/strict";
import test from "node:test";
import { ClientSession } from "mongodb";
import { Actor } from "@core/actor/actor";
import {
  AuthoritativeAdminMutationBridge,
  AuthoritativeMutationControls,
} from "@core/application/authoritative-admin-mutation.bridge";
import { Permission } from "@core/permission/permission.enum";
import { bindTraceId } from "@core/trace/trace.context";
import { EmploymentProfileAdminQueryService } from "@modules/employment-profile/admin/admin.employment-profile.query-service";
import { EmploymentProfileAdminService } from "@modules/employment-profile/admin/admin.employment-profile.service";
import {
  EmploymentProfilePermissionScopeError,
  EmploymentProfileValidationError,
} from "@modules/employment-profile/domain/employment-profile.errors";
import { EmploymentProfileRecord } from "@modules/employment-profile/domain/employment-profile.types";
import { OrgUnitAdminQueryService } from "@modules/org-unit/admin/admin.org-unit.query-service";
import { OrgUnitAdminService } from "@modules/org-unit/admin/admin.org-unit.service";
import { OrgUnitResponsibilityAdminService } from "@modules/org-unit/admin/admin.org-unit-responsibility.service";
import {
  OrgUnitPermissionScopeError,
  OrgUnitValidationError,
} from "@modules/org-unit/domain/org-unit.errors";
import { OrgUnitRecord } from "@modules/org-unit/domain/org-unit.types";
import { RoleAssignmentScopeGrant } from "@modules/role/domain/role-assignment-scope";
import { StructuredScopeAuthorityService } from "@modules/role/domain/structured-scope-authority";
import { TalentGroupAdminQueryService } from "@modules/talent-group/admin/admin.talent-group.query-service";
import { TalentGroupAdminService } from "@modules/talent-group/admin/admin.talent-group.service";
import { TalentGroupPermissionScopeError } from "@modules/talent-group/domain/talent-group.errors";
import {
  TalentGroupMemberRecord,
  TalentGroupRecord,
} from "@modules/talent-group/domain/talent-group.types";

const NOW = 1_800_000_000_000;
const mutationBridge: AuthoritativeAdminMutationBridge = {
  async execute(_input, mutate) {
    return mutate(
      undefined as unknown as ClientSession,
      {
        markAuthSecurityTruthChanged() {},
        markExplicitNoOpSuccess() {},
      } satisfies AuthoritativeMutationControls,
    );
  },
};
const audit = { async record() {} } as never;
const sequence = {
  async allocateNext() {
    return 1;
  },
  async ensureAtLeast() {},
} as never;

test("EmploymentProfile mutations retain exact managedOrgUnit authority while sensitive Admin detail is global-only", async () => {
  const records = new Map<string, EmploymentProfileRecord>([
    ["ep-1", employmentProfile("ep-1", "org-1", "manager-existing")],
  ]);
  const allowed = authority({
    permissions: [
      Permission.EMPLOYMENT_PROFILE_READ,
      Permission.EMPLOYMENT_PROFILE_CREATE,
      Permission.EMPLOYMENT_PROFILE_UPDATE,
      Permission.EMPLOYMENT_PROFILE_MANAGE_MANAGER_ASSIGNMENT,
      Permission.EMPLOYMENT_PROFILE_MANAGE_LIFECYCLE,
    ],
    grants: [{ scopeType: "managedOrgUnit", targetId: "org-1" }],
  });
  const denied = authority({
    permissions: [
      Permission.EMPLOYMENT_PROFILE_READ,
      Permission.EMPLOYMENT_PROFILE_CREATE,
      Permission.EMPLOYMENT_PROFILE_UPDATE,
      Permission.EMPLOYMENT_PROFILE_MANAGE_MANAGER_ASSIGNMENT,
      Permission.EMPLOYMENT_PROFILE_MANAGE_LIFECYCLE,
    ],
    grants: [{ scopeType: "managedOrgUnit", targetId: "org-other" }],
  });
  const actor = adminActor([
    Permission.EMPLOYMENT_PROFILE_READ,
    Permission.EMPLOYMENT_PROFILE_CREATE,
    Permission.EMPLOYMENT_PROFILE_UPDATE,
    Permission.EMPLOYMENT_PROFILE_MANAGE_MANAGER_ASSIGNMENT,
    Permission.EMPLOYMENT_PROFILE_MANAGE_LIFECYCLE,
  ]);

  const query = new EmploymentProfileAdminQueryService(
    {
      async getEmploymentProfileDetail(id: string) {
        return records.get(id) ?? null;
      },
    } as never,
    allowed,
  );
  await assert.rejects(
    query.getEmploymentProfileDetail(actor, {
      employmentProfileId: "ep-1",
    }),
    EmploymentProfilePermissionScopeError,
  );
  await assert.rejects(
    new EmploymentProfileAdminQueryService(
      {
        async getEmploymentProfileDetail(id: string) {
          return records.get(id) ?? null;
        },
      } as never,
      denied,
    ).getEmploymentProfileDetail(actor, { employmentProfileId: "ep-1" }),
    EmploymentProfilePermissionScopeError,
  );

  const allowedService = employmentService(records, allowed);
  await runWithTrace(() =>
    allowedService.createEmploymentProfile(actor, {
      employeeCode: "EP-NEW",
      legalName: "New Person",
      displayName: "New Person",
      employmentKind: "EMPLOYEE",
      jobTitle: "Operator",
      orgUnitId: "org-1",
      contractStatus: "ACTIVE",
      employmentStartDate: "2026-01-01",
    }),
  );
  assert.ok(
    [...records.values()].some((record) => record.employeeCode === "EP-NEW"),
  );

  await runWithTrace(() =>
    allowedService.updateEmploymentProfileCore(actor, {
      employmentProfileId: "ep-1",
      displayName: "Updated Person",
    }),
  );
  await assert.rejects(
    runWithTrace(() =>
      allowedService.assignEmploymentProfileManager(actor, {
        employmentProfileId: "ep-1",
        newManagerEmploymentProfileId: null,
      }),
    ),
    EmploymentProfileValidationError,
  );
  await runWithTrace(() =>
    allowedService.placeEmploymentProfileOnLeave(actor, {
      employmentProfileId: "ep-1",
    }),
  );

  const deniedService = employmentService(records, denied);
  await assert.rejects(
    runWithTrace(() =>
      deniedService.updateEmploymentProfileCore(actor, {
        employmentProfileId: "ep-1",
        displayName: "Denied Update",
      }),
    ),
    EmploymentProfilePermissionScopeError,
  );
  await assert.rejects(
    runWithTrace(() =>
      deniedService.createEmploymentProfile(actor, {
        employeeCode: "EP-DENIED",
        legalName: "Denied Person",
        displayName: "Denied Person",
        employmentKind: "EMPLOYEE",
        jobTitle: "Operator",
        orgUnitId: "org-1",
        contractStatus: "ACTIVE",
        employmentStartDate: "2026-01-01",
      }),
    ),
    EmploymentProfilePermissionScopeError,
  );
  await assert.rejects(
    runWithTrace(() =>
      deniedService.assignEmploymentProfileManager(actor, {
        employmentProfileId: "ep-1",
        newManagerEmploymentProfileId: "manager-existing",
      }),
    ),
    EmploymentProfileValidationError,
  );
  await assert.rejects(
    runWithTrace(() =>
      deniedService.placeEmploymentProfileOnLeave(actor, {
        employmentProfileId: "ep-1",
      }),
    ),
    EmploymentProfilePermissionScopeError,
  );
});

test("EmploymentProfile termination, contract status, and OrgUnit reassignment remain deferred", async () => {
  const records = new Map<string, EmploymentProfileRecord>([
    ["ep-terminate", employmentProfile("ep-terminate", "org-1", null)],
    ["ep-contract", employmentProfile("ep-contract", "org-1", null)],
    ["ep-move", employmentProfile("ep-move", "org-1", null)],
    ["ep-link", employmentProfile("ep-link", "org-1", null)],
  ]);
  const actor = adminActor([
    Permission.EMPLOYMENT_PROFILE_MANAGE_LIFECYCLE,
    Permission.EMPLOYMENT_PROFILE_UPDATE,
    Permission.EMPLOYMENT_PROFILE_MANAGE_ORG_ASSIGNMENT,
    Permission.EMPLOYMENT_PROFILE_MANAGE_USER_LINKAGE,
  ]);
  const service = employmentService(
    records,
    authority({
      permissions: [
        Permission.EMPLOYMENT_PROFILE_MANAGE_LIFECYCLE,
        Permission.EMPLOYMENT_PROFILE_UPDATE,
        Permission.EMPLOYMENT_PROFILE_MANAGE_ORG_ASSIGNMENT,
        Permission.EMPLOYMENT_PROFILE_MANAGE_USER_LINKAGE,
      ],
      grants: [{ scopeType: "managedOrgUnit", targetId: "org-other" }],
    }),
  );

  const terminated = await runWithTrace(() =>
    service.terminateEmploymentProfile(actor, {
      employmentProfileId: "ep-terminate",
      employmentEndDate: "2026-01-02",
    }),
  );
  assert.equal(terminated.contractStatus, "TERMINATED");

  const contractUpdated = await runWithTrace(() =>
    service.updateEmploymentProfileContractStatus(actor, {
      employmentProfileId: "ep-contract",
      newContractStatus: "EXPIRED",
    }),
  );
  assert.equal(contractUpdated.contractStatus, "EXPIRED");

  const reassigned = await runWithTrace(() =>
    service.assignEmploymentProfileOrgUnit(actor, {
      employmentProfileId: "ep-move",
      newOrgUnitId: "org-2",
    }),
  );
  assert.equal(reassigned.orgUnitId, "org-2");

  const linked = await runWithTrace(() =>
    service.linkEmploymentProfileUser(actor, {
      employmentProfileId: "ep-link",
      linkedUserId: "user-1",
    }),
  );
  assert.equal(linked.linkedUserId, "user-1");
  const unlinked = await runWithTrace(() =>
    service.unlinkEmploymentProfileUser(actor, {
      employmentProfileId: "ep-link",
    }),
  );
  assert.equal(unlinked.linkedUserId, null);
});

test("EmploymentProfile coarse scope, reporting manager, role name, actor kind, User link, and Talent link do not authorize", async () => {
  const record = {
    ...employmentProfile("ep-1", "org-1", "manager-user"),
    linkedUserId: "admin-user",
  };
  const actor = new Actor({
    id: "admin-user",
    type: "admin",
    context: "ADMIN",
    roles: ["HR_OPERATIONS", "ORG_UNIT_MANAGER"],
    permissions: [
      Permission.EMPLOYMENT_PROFILE_READ,
      Permission.EMPLOYMENT_PROFILE_UPDATE,
    ],
    scopeGrants: { employmentProfile: ["global"] } as never,
    accountContexts: ["ADMIN_CONSOLE"],
    isActive: true,
  });
  const query = new EmploymentProfileAdminQueryService(
    {
      async getEmploymentProfileDetail() {
        return record;
      },
    } as never,
    authority({
      permissions: [
        Permission.EMPLOYMENT_PROFILE_READ,
        Permission.EMPLOYMENT_PROFILE_UPDATE,
      ],
      grants: [],
    }),
  );

  await assert.rejects(
    query.getEmploymentProfileDetail(actor, { employmentProfileId: "ep-1" }),
    EmploymentProfilePermissionScopeError,
  );
  await assert.rejects(
    runWithTrace(() =>
      employmentService(
        new Map([[record.id, record]]),
        authority({
          permissions: [Permission.EMPLOYMENT_PROFILE_UPDATE],
          grants: [],
        }),
      ).updateEmploymentProfileCore(actor, {
        employmentProfileId: "ep-1",
        displayName: "Denied coarse update",
      }),
    ),
    EmploymentProfilePermissionScopeError,
  );
});

test("TalentGroup detail, members, mutation, and manager assignment require managedTalentGroup without direct Talent authority", async () => {
  const group = talentGroup("group-1");
  const member = talentGroupMember("member-1", group.id, "talent-1");
  const permissions = [
    Permission.TALENT_GROUP_READ,
    Permission.TALENT_GROUP_UPDATE,
    Permission.TALENT_GROUP_MANAGE_MEMBERSHIP,
  ];
  const actor = adminActor(permissions);
  const allowed = authority({
    permissions,
    grants: [{ scopeType: "managedTalentGroup", targetId: group.id }],
  });
  const denied = authority({
    permissions,
    grants: [{ scopeType: "assignedEvent", targetId: "talent-1" }],
  });

  const readRepository = {
    async getTalentGroupDetail(groupId: string) {
      return groupId === group.id ? group : null;
    },
    async listTalentGroupMembers() {
      return { items: [member] };
    },
  } as never;
  const groupReadDependencies = {
    subjectReadonlyAccess: {
      async findActiveEmploymentProfileByLinkedUserId() {
        return { employmentProfileId: "manager-profile" };
      },
    },
    managedScopeReader: {
      async resolveManagedScopeByResponsibleEmploymentProfile() {
        return { talentGroupIds: [group.id] };
      },
    },
  } as never;
  const query = new TalentGroupAdminQueryService(
    readRepository,
    groupReadDependencies,
    allowed,
  );
  assert.equal(
    (await query.getTalentGroupDetail(actor, { groupId: group.id })).id,
    group.id,
  );
  assert.equal(
    (await query.listTalentGroupMembers(actor, { groupId: group.id })).items
      .length,
    1,
  );
  await assert.rejects(
    new TalentGroupAdminQueryService(
      readRepository,
      groupReadDependencies,
      denied,
    ).getTalentGroupDetail(actor, { groupId: group.id }),
    TalentGroupPermissionScopeError,
  );
  const coarseActor = new Actor({
    id: "admin-user",
    type: "admin",
    context: "ADMIN",
    roles: ["TALENT_GROUP_MANAGER"],
    permissions: [Permission.TALENT_GROUP_READ],
    scopeGrants: { talentGroup: ["global"] } as never,
    accountContexts: ["ADMIN_CONSOLE"],
    isActive: true,
  });
  await assert.rejects(
    new TalentGroupAdminQueryService(
      readRepository,
      groupReadDependencies,
      authority({
        permissions: [Permission.TALENT_GROUP_READ],
        grants: [],
      }),
    ).getTalentGroupDetail(coarseActor, { groupId: group.id }),
    TalentGroupPermissionScopeError,
  );

  const service = talentGroupService(group, member, allowed);
  await runWithTrace(() =>
    service.updateTalentGroupCore(actor, {
      groupId: group.id,
      description: "Updated",
    }),
  );
  await runWithTrace(() =>
    service.updateTalentGroupMemberLineup(actor, {
      membershipId: member.id,
      newLineupOrder: 2,
    }),
  );
});

test("TalentGroup hardened mutations deny mismatched scope while create remains deferred", async () => {
  const group = talentGroup("group-1");
  const member = talentGroupMember("member-1", group.id, "talent-1");
  const permissions = [
    Permission.TALENT_GROUP_CREATE,
    Permission.TALENT_GROUP_UPDATE,
    Permission.TALENT_GROUP_MANAGE_LIFECYCLE,
    Permission.TALENT_GROUP_MANAGE_MEMBERSHIP,
  ];
  const actor = adminActor(permissions);
  const matching = authority({
    permissions,
    grants: [{ scopeType: "managedTalentGroup", targetId: group.id }],
  });
  const mismatched = authority({
    permissions,
    grants: [{ scopeType: "managedTalentGroup", targetId: "group-other" }],
  });

  const deactivated = await runWithTrace(() =>
    talentGroupService(group, member, matching).deactivateTalentGroup(actor, {
      groupId: group.id,
    }),
  );
  assert.ok("status" in deactivated);
  assert.equal(deactivated.status, "INACTIVE");

  await assert.rejects(
    runWithTrace(() =>
      talentGroupService(group, member, mismatched).deactivateTalentGroup(
        actor,
        { groupId: group.id },
      ),
    ),
    TalentGroupPermissionScopeError,
  );
  await assert.rejects(
    runWithTrace(() =>
      talentGroupService(group, member, mismatched).updateTalentGroupMemberLineup(
        actor,
        { membershipId: member.id, newLineupOrder: 2 },
      ),
    ),
    TalentGroupPermissionScopeError,
  );
  const coarseActor = new Actor({
    id: "admin-user",
    type: "admin",
    context: "ADMIN",
    roles: ["TALENT_GROUP_MANAGER"],
    permissions,
    scopeGrants: { talentGroup: ["global"] } as never,
    accountContexts: ["ADMIN_CONSOLE"],
    isActive: true,
  });
  await assert.rejects(
    runWithTrace(() =>
      talentGroupService(group, member, authority({ permissions, grants: [] }))
        .updateTalentGroupCore(coarseActor, {
          groupId: group.id,
          description: "Denied coarse update",
        }),
    ),
    TalentGroupPermissionScopeError,
  );

  const created = await runWithTrace(() =>
    talentGroupService(group, member, mismatched).createTalentGroup(actor, {
      groupCode: "TG-DEFERRED",
      name: "Deferred create",
      displayOrder: 2,
    }),
  );
  assert.ok("groupCode" in created);
  assert.equal(created.groupCode, "TG-DEFERRED");
});

test("OrgUnit detail, children, profile, lifecycle, and responsibility require managedOrgUnit", async () => {
  const org = orgUnit("org-1", "ACTIVE");
  const inactive = orgUnit("org-inactive", "INACTIVE");
  const permissions = [
    Permission.ORG_UNIT_READ,
    Permission.ORG_UNIT_UPDATE,
    Permission.ORG_UNIT_MANAGE_LIFECYCLE,
  ];
  const actor = adminActor(permissions);
  const allowed = authority({
    permissions,
    grants: [
      { scopeType: "managedOrgUnit", targetId: org.id },
      { scopeType: "managedOrgUnit", targetId: inactive.id },
    ],
  });
  const denied = authority({
    permissions,
    grants: [{ scopeType: "managedOrgUnit", targetId: "org-other" }],
  });
  const readRepository = {
    async getOrgUnitDetail(id: string) {
      return id === org.id ? org : null;
    },
    async listDirectChildren() {
      return { items: [] };
    },
  } as never;
  const orgReadDependencies = {
    subjectReadonlyAccess: {
      async findActiveEmploymentProfileByLinkedUserId() {
        return { employmentProfileId: "manager-profile" };
      },
    },
    managedScopeReader: {
      async resolveManagedScopeByResponsibleEmploymentProfile() {
        return {
          orgUnitIds: [org.id, inactive.id],
          orgUnitScopes: [],
          talentGroupIds: [],
        };
      },
    },
  } as never;
  const query = new OrgUnitAdminQueryService(
    readRepository,
    allowed,
    orgReadDependencies,
  );
  assert.equal(
    (await query.getOrgUnitDetail(actor, { orgUnitId: org.id })).id,
    org.id,
  );
  assert.deepEqual(
    await query.listDirectChildren(actor, { orgUnitId: org.id }),
    { items: [] },
  );
  await assert.rejects(
    new OrgUnitAdminQueryService(
      readRepository,
      denied,
      orgReadDependencies,
    ).getOrgUnitDetail(
      actor,
      { orgUnitId: org.id },
    ),
    OrgUnitPermissionScopeError,
  );
  const coarseActor = new Actor({
    id: "admin-user",
    type: "admin",
    context: "ADMIN",
    roles: ["ORG_UNIT_MANAGER"],
    permissions: [Permission.ORG_UNIT_READ],
    scopeGrants: { orgUnit: ["global"] } as never,
    accountContexts: ["ADMIN_CONSOLE"],
    isActive: true,
  });
  await assert.rejects(
    new OrgUnitAdminQueryService(
      readRepository,
      authority({
        permissions: [Permission.ORG_UNIT_READ],
        grants: [],
      }),
      orgReadDependencies,
    ).getOrgUnitDetail(coarseActor, { orgUnitId: org.id }),
    OrgUnitPermissionScopeError,
  );

  const service = orgUnitService(org, inactive, allowed);
  await runWithTrace(() =>
    service.updateOrgUnitProfile(actor, {
      orgUnitId: org.id,
      description: "Updated",
    }),
  );
  await runWithTrace(() =>
    service.activateOrgUnit(actor, { orgUnitId: inactive.id }),
  );

  const responsibility = new OrgUnitResponsibilityAdminService(
    {
      async findById(id: string) {
        return id === org.id ? org : null;
      },
    } as never,
    {
      async listAssignmentsByOrgUnitId() {
        return [];
      },
    } as never,
    audit,
    mutationBridge,
    allowed,
    {
      async getSummaryForSubject() {
        return { items: [] };
      },
    } as never,
    () => NOW,
  );
  assert.deepEqual(
    await responsibility.listResponsibilities(actor, { orgUnitId: org.id }),
    { items: [] },
  );
  await assert.rejects(
    new OrgUnitResponsibilityAdminService(
      {
        async findById() {
          return org;
        },
      } as never,
      {} as never,
      audit,
      mutationBridge,
      allowed,
      () => NOW,
    ).listResponsibilities(actor, { orgUnitId: org.id }),
    OrgUnitValidationError,
  );
  await assert.rejects(
    new OrgUnitResponsibilityAdminService(
      {
        async findById() {
          return org;
        },
      } as never,
      {} as never,
      audit,
      mutationBridge,
      denied,
      () => NOW,
    ).listResponsibilities(actor, { orgUnitId: org.id }),
    OrgUnitPermissionScopeError,
  );
});

test("OrgUnit lifecycle and responsibilities deny mismatched scope while create and move remain deferred", async () => {
  const org = orgUnit("org-1", "ACTIVE");
  const inactive = orgUnit("org-inactive", "INACTIVE");
  const permissions = [
    Permission.ORG_UNIT_CREATE,
    Permission.ORG_UNIT_UPDATE,
    Permission.ORG_UNIT_MANAGE_LIFECYCLE,
    Permission.ORG_UNIT_MANAGE_HIERARCHY,
  ];
  const actor = adminActor(permissions);
  const matching = authority({
    permissions,
    grants: [{ scopeType: "managedOrgUnit", targetId: org.id }],
  });
  const mismatched = authority({
    permissions,
    grants: [{ scopeType: "managedOrgUnit", targetId: "org-other" }],
  });

  const deactivated = await runWithTrace(() =>
    orgUnitService(org, inactive, matching).deactivateOrgUnit(actor, {
      orgUnitId: org.id,
    }),
  );
  assert.equal(deactivated.status, "INACTIVE");
  await assert.rejects(
    runWithTrace(() =>
      orgUnitService(org, inactive, mismatched).deactivateOrgUnit(actor, {
        orgUnitId: org.id,
      }),
    ),
    OrgUnitPermissionScopeError,
  );
  const deniedResponsibility = new OrgUnitResponsibilityAdminService(
    { async findById() { return org; } } as never,
    {} as never,
    audit,
    mutationBridge,
    mismatched,
    () => NOW,
  );
  await assert.rejects(
    runWithTrace(() =>
      deniedResponsibility.createResponsibility(actor, {
        orgUnitId: org.id,
        managerEmploymentProfileId: "ep-1",
        role: "UNIT_MANAGER",
      }),
    ),
    OrgUnitPermissionScopeError,
  );
  await assert.rejects(
    runWithTrace(() =>
      deniedResponsibility.updateResponsibility(actor, {
        orgUnitId: org.id,
        assignmentId: "assignment-1",
        includeDescendants: true,
      }),
    ),
    OrgUnitPermissionScopeError,
  );
  await assert.rejects(
    runWithTrace(() =>
      deniedResponsibility.revokeResponsibility(actor, {
        orgUnitId: org.id,
        assignmentId: "assignment-1",
      }),
    ),
    OrgUnitPermissionScopeError,
  );

  const coarseActor = new Actor({
    id: "admin-user",
    type: "admin",
    context: "ADMIN",
    roles: ["ORG_UNIT_MANAGER"],
    permissions,
    scopeGrants: { orgUnit: ["global"] } as never,
    accountContexts: ["ADMIN_CONSOLE"],
    isActive: true,
  });
  await assert.rejects(
    runWithTrace(() =>
      orgUnitService(org, inactive, authority({ permissions, grants: [] }))
        .updateOrgUnitProfile(coarseActor, {
          orgUnitId: org.id,
          description: "Denied coarse update",
        }),
    ),
    OrgUnitPermissionScopeError,
  );

  const deferredService = orgUnitService(org, inactive, mismatched);
  const created = await runWithTrace(() =>
    deferredService.createOrgUnit(actor, {
      code: "OU-DEFERRED",
      name: "Deferred create",
      type: "DEPARTMENT",
      parentOrgUnitId: null,
      displayOrder: 2,
    }),
  );
  assert.ok("code" in created);
  assert.equal(created.code, "OU-DEFERRED");
  const unmoved = await runWithTrace(() =>
    deferredService.moveOrgUnit(actor, {
      orgUnitId: org.id,
      newParentOrgUnitId: null,
    }),
  );
  assert.ok("parentOrgUnitId" in unmoved);
  assert.equal(unmoved.parentOrgUnitId, null);
});

function employmentService(
  records: Map<string, EmploymentProfileRecord>,
  structuredAuthority: StructuredScopeAuthorityService,
): EmploymentProfileAdminService {
  const repository = {
    async findByEmployeeCode(code: string) {
      return [...records.values()].find((record) => record.employeeCode === code) ?? null;
    },
    async findNonArchivedByLinkedUserId(linkedUserId: string) {
      return [...records.values()].find(
        (record) => record.linkedUserId === linkedUserId,
      ) ?? null;
    },
    async findById(id: string) {
      return records.get(id) ?? null;
    },
    async insert(record: EmploymentProfileRecord) {
      records.set(record.id, record);
      return record;
    },
    async updateCore(input: Record<string, unknown>) {
      const id = String(input.employmentProfileId);
      const current = records.get(id);
      if (!current) return null;
      const updated = { ...current, ...input } as EmploymentProfileRecord;
      records.set(id, updated);
      return updated;
    },
    async assignManager(input: {
      employmentProfileId: string;
      managerEmploymentProfileId: string | null;
      updatedAt: number;
    }) {
      const current = records.get(input.employmentProfileId);
      if (!current) return null;
      const updated = {
        ...current,
        managerEmploymentProfileId: input.managerEmploymentProfileId,
        updatedAt: input.updatedAt,
      };
      records.set(updated.id, updated);
      return updated;
    },
    async assignOrgUnit(input: {
      employmentProfileId: string;
      orgUnitId: string;
      updatedAt: number;
    }) {
      const current = records.get(input.employmentProfileId);
      if (!current) return null;
      const updated = { ...current, orgUnitId: input.orgUnitId, updatedAt: input.updatedAt };
      records.set(updated.id, updated);
      return updated;
    },
    async setLinkedUser(input: {
      employmentProfileId: string;
      linkedUserId: string | null;
      updatedAt: number;
    }) {
      const current = records.get(input.employmentProfileId);
      if (!current) return null;
      const updated = { ...current, linkedUserId: input.linkedUserId, updatedAt: input.updatedAt };
      records.set(updated.id, updated);
      return updated;
    },
    async transitionLifecycle(input: {
      employmentProfileId: string;
      toStatus: EmploymentProfileRecord["employmentStatus"];
      employmentEndDate?: number | null;
      contractStatus?: EmploymentProfileRecord["contractStatus"];
      updatedAt: number;
    }) {
      const current = records.get(input.employmentProfileId);
      if (!current) return null;
      const updated = {
        ...current,
        employmentStatus: input.toStatus,
        employmentEndDate:
          input.employmentEndDate === undefined
            ? current.employmentEndDate
            : input.employmentEndDate,
        contractStatus: input.contractStatus ?? current.contractStatus,
        updatedAt: input.updatedAt,
      };
      records.set(updated.id, updated);
      return updated;
    },
    async updateContractStatus(input: {
      employmentProfileId: string;
      contractStatus: EmploymentProfileRecord["contractStatus"];
      updatedAt: number;
    }) {
      const current = records.get(input.employmentProfileId);
      if (!current) return null;
      const updated = { ...current, contractStatus: input.contractStatus, updatedAt: input.updatedAt };
      records.set(updated.id, updated);
      return updated;
    },
    async hasNonArchivedDirectReports() {
      return false;
    },
  } as never;

  return new EmploymentProfileAdminService(
    repository,
    sequence,
    {
      async findById(id: string) {
        return id === "org-1" || id === "org-2"
          ? { id, status: "ACTIVE" }
          : null;
      },
    } as never,
    {
      async findById(id: string) {
        return id === "user-1" ? { id, accountStatus: "ACTIVE" } : null;
      },
    } as never,
    {
      async hasNonArchivedTalentsManagedByEmploymentProfile() { return false; },
      async hasNonArchivedInternalTalentLinkedToEmploymentProfile() { return false; },
    } as never,
    {
      async hasLiveScheduledShiftForEmploymentProfile() {
        return false;
      },
    } as never,
    {
      async hasLiveEventBindingForEmploymentProfile() {
        return false;
      },
    } as never,
    audit,
    mutationBridge,
    structuredAuthority,
  );
}

function talentGroupService(
  group: TalentGroupRecord,
  member: TalentGroupMemberRecord,
  structuredAuthority: StructuredScopeAuthorityService,
): TalentGroupAdminService {
  let currentGroup = group;
  let currentMember = member;
  return new TalentGroupAdminService(
    {
      async findGroupByCode() {
        return null;
      },
      async findGroupById(id: string) {
        return id === currentGroup.id ? currentGroup : null;
      },
      async findLiveGroupByNormalizedName() {
        return null;
      },
      async updateGroupCore(input: Record<string, unknown>) {
        currentGroup = { ...currentGroup, ...input } as TalentGroupRecord;
        return currentGroup;
      },
      async insertGroup(record: TalentGroupRecord) {
        return record;
      },
      async hasActiveMembers() {
        return false;
      },
      async transitionGroupStatus(input: {
        toStatus: TalentGroupRecord["status"];
        updatedAt: number;
      }) {
        currentGroup = {
          ...currentGroup,
          status: input.toStatus,
          updatedAt: input.updatedAt,
        };
        return currentGroup;
      },
      async findMemberById(id: string) {
        return id === currentMember.id ? currentMember : null;
      },
      async findLiveMemberByGroupAndLineup() {
        return null;
      },
      async updateMemberLineup(input: {
        lineupOrder: number;
        updatedAt: number;
      }) {
        currentMember = { ...currentMember, ...input };
        return currentMember;
      },
    } as never,
    sequence,
    { async findById() { return null; } } as never,
    { async hasActiveOwnedPlatformAccountsForTalentGroup() { return false; } } as never,
    { async hasLiveScheduledShiftForTalentGroup() { return false; } } as never,
    { async hasLiveEventBindingForTalentGroup() { return false; } } as never,
    audit,
    mutationBridge,
    structuredAuthority,
  );
}

function orgUnitService(
  org: OrgUnitRecord,
  inactive: OrgUnitRecord,
  structuredAuthority: StructuredScopeAuthorityService,
): OrgUnitAdminService {
  const records = new Map([
    [org.id, org],
    [inactive.id, inactive],
  ]);
  return new OrgUnitAdminService(
    {
      async findByCode() {
        return null;
      },
      async findById(id: string) {
        return records.get(id) ?? null;
      },
      async findLiveSiblingByNormalizedName() {
        return null;
      },
      async updateProfile(input: Record<string, unknown>) {
        const id = String(input.orgUnitId);
        const current = records.get(id);
        if (!current) return null;
        const updated = { ...current, ...input } as OrgUnitRecord;
        records.set(id, updated);
        return updated;
      },
      async insert(record: OrgUnitRecord) {
        records.set(record.id, record);
        return record;
      },
      async hasDescendantWithStatuses() {
        return false;
      },
      async transitionStatus(input: {
        orgUnitId: string;
        toStatus: OrgUnitRecord["status"];
        updatedAt: number;
      }) {
        const current = records.get(input.orgUnitId);
        if (!current) return null;
        const updated = {
          ...current,
          status: input.toStatus,
          updatedAt: input.updatedAt,
        };
        records.set(updated.id, updated);
        return updated;
      },
    } as never,
    sequence,
    { async hasNonArchivedProfilesAssignedToOrgUnit() { return false; } } as never,
    { async hasActiveOwnedPlatformAccountsForOrgUnit() { return false; } } as never,
    audit,
    mutationBridge,
    structuredAuthority,
  );
}

function authority(input: {
  readonly permissions: readonly Permission[];
  readonly grants: readonly RoleAssignmentScopeGrant[];
}): StructuredScopeAuthorityService {
  return new StructuredScopeAuthorityService({
    async listByUserId(userId: string) {
      return [
        {
          assignment: {
            assignmentId: "assignment-auth-3c-5",
            roleId: "role-auth-3c-5",
            userId,
            structuredScopeGrants: input.grants,
            state: "ACTIVE" as const,
            effectiveAt: 0,
            expiresAt: null,
            revokedAt: null,
            origin: "BUNDLE" as const,
            bundleOrigin: {
              bundleAssignmentId: "bundle-assignment",
              bundleCode: "TEST_BUNDLE",
              bundleVersion: "1",
            },
            reason: null,
            createdAt: NOW - 1,
            updatedAt: NOW - 1,
          },
          role: {
            id: "role-auth-3c-5",
            state: "ACTIVE",
            permissions: input.permissions,
          },
        },
      ];
    },
  });
}

function adminActor(permissions: readonly Permission[]): Actor {
  return new Actor({
    id: "admin-user",
    type: "admin",
    context: "ADMIN",
    roles: ["OWNER_ADMIN"],
    permissions,
    scopeGrants: {},
    accountContexts: ["ADMIN_CONSOLE"],
    isActive: true,
  });
}

function employmentProfile(
  id: string,
  orgUnitId: string,
  managerEmploymentProfileId: string | null,
): EmploymentProfileRecord {
  return {
    id,
    employeeCode: id.toUpperCase(),
    legalName: "Person Legal",
    normalizedLegalName: "person legal",
    displayName: "Person",
    normalizedDisplayName: "person",
    employmentKind: "EMPLOYEE",
    jobTitle: "Operator",
    titleDescription: null,
    externalRef: null,
    orgUnitId,
    managerEmploymentProfileId,
    recruiterEmploymentProfileId: null,
    hrOwnerEmploymentProfileId: null,
    onboardingOwnerEmploymentProfileId: null,
    sourcedByEmploymentProfileId: null,
    linkedUserId: null,
    employmentStatus: "ACTIVE",
    contractStatus: "ACTIVE",
    employmentStartDate: Date.UTC(2026, 0, 1),
    employmentEndDate: null,
    hiredAt: null,
    onboardedAt: null,
    createdAt: NOW - 1,
    updatedAt: NOW - 1,
  };
}

function talentGroup(id: string): TalentGroupRecord {
  return {
    id,
    groupCode: "TG-1",
    name: "Group",
    normalizedName: "group",
    shortName: null,
    normalizedShortName: null,
    description: null,
    externalRef: null,
    status: "ACTIVE",
    displayOrder: 1,
    createdAt: NOW - 1,
    updatedAt: NOW - 1,
  };
}

function talentGroupMember(
  id: string,
  groupId: string,
  talentId: string,
): TalentGroupMemberRecord {
  return {
    id,
    groupId,
    talentId,
    membershipStatus: "ACTIVE",
    lineupOrder: 1,
    joinedAt: NOW - 1,
    leftAt: null,
    createdAt: NOW - 1,
    updatedAt: NOW - 1,
  };
}

function orgUnit(id: string, status: OrgUnitRecord["status"]): OrgUnitRecord {
  return {
    id,
    code: id.toUpperCase(),
    searchCode: id,
    name: id,
    normalizedName: id,
    type: "DEPARTMENT",
    status,
    parentOrgUnitId: null,
    ancestorChain: [],
    depth: 0,
    displayOrder: 1,
    description: null,
    externalRef: null,
    createdAt: NOW - 1,
    updatedAt: NOW - 1,
  };
}

function runWithTrace<T>(fn: () => Promise<T>): Promise<T> {
  return bindTraceId("trace-auth-3c-5", fn);
}
