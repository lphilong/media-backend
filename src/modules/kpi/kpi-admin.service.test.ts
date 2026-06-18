import assert from "node:assert/strict";
import { test } from "node:test";
import { Request } from "express";
import { bindCommand } from "@app/base/command.middleware";
import { ClientSession } from "mongodb";
import { Actor } from "@core/actor/actor";
import { AuthoritativeAdminMutationBridge } from "@core/application/authoritative-admin-mutation.bridge";
import { AuditGuard } from "@core/audit/audit.guard";
import { BusinessCodeSequenceRepository } from "@core/business-code/business-code-sequence.repository";
import { Permission } from "@core/permission/permission.enum";
import {
  KPI_ALLOCATION_ORG_UNIT_PLAN_PROFILE_UNIQ_INDEX_NAME,
  KPI_ALLOCATION_TALENT_GROUP_PLAN_MEMBER_UNIQ_INDEX_NAME,
  initKpiIndexes,
} from "@infra/mongo/kpi/kpi.index";
import { NativeMongoKpiPlanRepository } from "@infra/mongo/kpi/kpi.repository";
import { NativeMongoKpiSubjectReadonlyAccess } from "@infra/mongo/kpi/kpi.readonly-access";
import { NativeMongoOrgUnitManagerAssignmentRepository } from "@infra/mongo/kpi/org-unit-manager-assignment.repository";
import { KpiAdminController } from "@modules/kpi/admin/admin.kpi.controller";
import { KpiAdminQueryController } from "@modules/kpi/admin/admin.kpi.query.controller";
import { KpiAdminService } from "@modules/kpi/admin/admin.kpi.service";
import {
  KpiActualCorrectionExposure,
  KpiActualWorkspaceExposure,
  KpiOrgUnitAllocationExposure,
  KpiOrgUnitActualDailyGridExposure,
  KpiOrgUnitManagedMemberPickerExposure,
  KpiOrgUnitProgressExposure,
  KpiPlanDetailExposure,
  KpiPlanListExposure,
} from "@modules/kpi/shared/kpi.exposure";
import {
  KpiConflictError,
  KpiInvalidAllocationError,
  KpiNotFoundError,
  KpiPermissionScopeError,
  KpiStateError,
  KpiValidationError,
} from "@modules/kpi/domain/kpi.errors";
import { KpiActualRepository } from "@modules/kpi/domain/kpi-actual.repository";
import {
  KpiActualWorkspaceDerivedPlanSortRow,
  ListKpiPlansInput,
  KpiPlanListCursor,
  KpiPlanRepository,
  ListKpiActualWorkspaceDerivedPlansInput,
} from "@modules/kpi/domain/kpi.repository";
import {
  KpiGroupMemberLookup,
  KpiManagedMemberLookup,
  KpiOrgUnitMemberLookup,
  KpiSubjectReferenceLookup,
  KpiSubjectReadonlyAccess,
  kpiSubjectRefKey,
} from "@modules/kpi/domain/kpi-subject-readonly-access";
import { ReferenceSummary } from "@modules/reference-summary";
import { OrgUnitManagerAssignmentRepository } from "@modules/kpi/domain/org-unit-manager-assignment.repository";
import { TalentGroupManagerAssignmentRepository } from "@modules/kpi/domain/talent-group-manager-assignment.repository";
import { resolveManagedUnitAuthority } from "@modules/kpi/domain/managed-unit-authority";
import {
  StructuredScopeAuthorityAssignment,
  StructuredScopeAuthorityReader,
  StructuredScopeAuthorityService,
} from "@modules/role/domain/structured-scope-authority";
import { RoleAssignmentScopeGrant } from "@modules/role/domain/role-assignment-scope";
import { UserRoleAssignmentRecord } from "@modules/role/domain/role.types";
import {
  KpiAllocation,
  KpiAllocationStatus,
  KpiAllocationStatusCount,
  KpiActualCorrection,
  KpiActualEntry,
  KpiActualPolicySnapshot,
  KpiActualSlotExcuse,
  KpiMetricCode,
  KpiPlan,
  KpiPlanDetailView,
  KpiPlanStatus,
  KpiSubjectType,
  KpiTargetMetric,
  OrgUnitManagerAssignment,
  TalentGroupManagerAssignment,
} from "@modules/kpi/domain/kpi.types";

const MAY_2026_START_AT = Date.UTC(2026, 4, 1, -7, 0, 0, 0);
const MAY_2026_END_AT = Date.UTC(2026, 5, 1, -7, 0, 0, 0) - 1;
const JUNE_2026_START_AT = Date.UTC(2026, 5, 1, -7, 0, 0, 0);
const JUNE_2026_END_AT = Date.UTC(2026, 6, 1, -7, 0, 0, 0) - 1;
const DECEMBER_2026_START_AT = Date.UTC(2026, 11, 1, -7, 0, 0, 0);
const DECEMBER_2026_END_AT = Date.UTC(2027, 0, 1, -7, 0, 0, 0) - 1;
const MAY_5_2026_START_HCM = Date.UTC(2026, 4, 4, 17, 0, 0, 0);
const MAY_5_2026_NOON_HCM = Date.UTC(2026, 4, 5, 5, 0, 0, 0);
const MAY_6_2026_09_59_HCM = Date.UTC(2026, 4, 6, 2, 59, 0, 0);
const MAY_6_2026_10_00_HCM = Date.UTC(2026, 4, 6, 3, 0, 0, 0);
const MAY_5_2026_AFTER_LOCK_HCM = Date.UTC(2026, 4, 6, 3, 1, 0, 0);
const JUNE_1_2026_09_30_HCM = Date.UTC(2026, 5, 1, 2, 30, 0, 0);
const JUNE_1_2026_10_01_HCM = Date.UTC(2026, 5, 1, 3, 1, 0, 0);
const JUNE_1_2026_NOON_HCM = Date.UTC(2026, 5, 1, 5, 0, 0, 0);
const JULY_1_2026_09_30_HCM = Date.UTC(2026, 6, 1, 2, 30, 0, 0);
const JULY_1_2026_10_01_HCM = Date.UTC(2026, 6, 1, 3, 1, 0, 0);
const JAN_1_2027_10_00_HCM = Date.UTC(2027, 0, 1, 3, 0, 0, 0);
const JAN_1_2027_10_01_HCM = Date.UTC(2027, 0, 1, 3, 1, 0, 0);
const FEB_2028_START_AT = Date.UTC(2028, 1, 1, -7, 0, 0, 0);
const FEB_2028_END_AT = Date.UTC(2028, 2, 1, -7, 0, 0, 0) - 1;
const FEB_29_2028_NOON_HCM = Date.UTC(2028, 1, 29, 5, 0, 0, 0);

function createActor(): Actor {
  return new Actor({
    id: "admin-1",
    type: "admin",
    context: "ADMIN",
    roles: [],
    permissions: [
      Permission.KPI_READ,
      Permission.KPI_CREATE_PLAN,
      Permission.KPI_UPDATE_DRAFT,
      Permission.KPI_PUBLISH,
      Permission.KPI_MANAGE_ALLOCATION,
      Permission.KPI_ARCHIVE,
      Permission.KPI_ENTER_ACTUAL,
      Permission.KPI_CORRECT_ACTUAL,
      Permission.KPI_READ_PROGRESS,
      Permission.KPI_FINALIZE,
    ],
    scopeGrants: {
      kpi: ["global"],
    },
    isActive: true,
  });
}

function createManagerActor(): Actor {
  return new Actor({
    id: "manager-user",
    type: "staff",
    context: "ADMIN",
    roles: [],
    permissions: [
      Permission.KPI_READ,
      Permission.KPI_ENTER_ACTUAL,
      Permission.KPI_CORRECT_ACTUAL,
      Permission.KPI_READ_PROGRESS,
    ],
    scopeGrants: {
      kpi: ["managedGroup"],
    },
    isActive: true,
  });
}

function createBackofficeTeamManagerActor(): Actor {
  return new Actor({
    id: "manager-user",
    type: "admin",
    context: "ADMIN",
    roles: [],
    permissions: [
      Permission.KPI_READ,
      Permission.KPI_ENTER_ACTUAL,
      Permission.KPI_CORRECT_ACTUAL,
      Permission.KPI_READ_PROGRESS,
    ],
    scopeGrants: {
      kpi: ["managedGroup"],
    },
    isActive: true,
  });
}

function createBackofficeTeamManagerActorWithoutKpiScope(): Actor {
  return createScopedActor({
    id: "manager-user",
    permissions: [
      Permission.KPI_READ,
      Permission.KPI_ENTER_ACTUAL,
      Permission.KPI_CORRECT_ACTUAL,
      Permission.KPI_READ_PROGRESS,
    ],
  });
}

function createProgressReadOnlyBackofficeTeamManagerActor(
  params: {
    readonly id?: string;
    readonly context?: "ADMIN" | "SELF_SERVICE";
    readonly permissions?: readonly Permission[];
    readonly kpiScopes?: readonly ("global" | "managedGroup" | "self")[];
  } = {},
): Actor {
  return new Actor({
    id: params.id ?? "manager-user",
    type: "admin",
    context: params.context ?? "ADMIN",
    roles: ["TEAM_MANAGER"],
    permissions: params.permissions ?? [Permission.KPI_READ_PROGRESS],
    scopeGrants: {
      kpi: params.kpiScopes ?? ["managedGroup"],
    },
    isActive: true,
  });
}

function createManagerActorWithoutKpiScope(): Actor {
  return new Actor({
    id: "manager-user",
    type: "staff",
    context: "ADMIN",
    roles: [],
    permissions: [
      Permission.KPI_READ,
      Permission.KPI_ENTER_ACTUAL,
      Permission.KPI_CORRECT_ACTUAL,
      Permission.KPI_READ_PROGRESS,
    ],
    isActive: true,
  });
}

function createTalentActor(): Actor {
  return new Actor({
    id: "talent-user",
    type: "staff",
    context: "ADMIN",
    roles: [],
    permissions: [Permission.KPI_READ_PROGRESS],
    scopeGrants: {
      kpi: ["self"],
    },
    isActive: true,
  });
}

function createKpiReadOnlyActor(): Actor {
  return new Actor({
    id: "read-only-user",
    type: "admin",
    context: "ADMIN",
    roles: [],
    permissions: [Permission.KPI_READ, Permission.KPI_READ_PROGRESS],
    scopeGrants: {
      kpi: ["global"],
    },
    isActive: true,
  });
}

function createActorWithPermissions(
  id: string,
  permissions: readonly Permission[],
): Actor {
  return new Actor({
    id,
    type: "admin",
    context: "ADMIN",
    roles: [],
    permissions,
    scopeGrants: {
      kpi: ["global"],
    },
    isActive: true,
  });
}

function createScopedActor(params: {
  readonly id: string;
  readonly type?: "admin" | "staff";
  readonly permissions: readonly Permission[];
  readonly kpiScopes?: readonly ("global" | "managedGroup" | "self")[];
}): Actor {
  return new Actor({
    id: params.id,
    type: params.type ?? "admin",
    context: "ADMIN",
    roles: [],
    permissions: params.permissions,
    scopeGrants: params.kpiScopes ? { kpi: params.kpiScopes } : {},
    isActive: true,
  });
}

const ALL_KPI_ADMIN_PERMISSIONS: readonly Permission[] = [
  Permission.KPI_READ,
  Permission.KPI_CREATE_PLAN,
  Permission.KPI_UPDATE_DRAFT,
  Permission.KPI_PUBLISH,
  Permission.KPI_MANAGE_ALLOCATION,
  Permission.KPI_ARCHIVE,
  Permission.KPI_ENTER_ACTUAL,
  Permission.KPI_CORRECT_ACTUAL,
  Permission.KPI_READ_PROGRESS,
  Permission.KPI_FINALIZE,
];

const DEFAULT_KPI_STRUCTURED_SCOPE_GRANTS: readonly RoleAssignmentScopeGrant[] =
  [
    { scopeType: "managedTalentGroup", targetId: "group-1" },
    { scopeType: "managedTalentGroup", targetId: "group-2" },
    { scopeType: "managedTalentGroup", targetId: "group-other" },
    { scopeType: "managedTalentGroup", targetId: "missing-group" },
    { scopeType: "managedOrgUnit", targetId: "org-department-active" },
    { scopeType: "managedOrgUnit", targetId: "org-team-active" },
    { scopeType: "managedOrgUnit", targetId: "org-business-active" },
    { scopeType: "managedOrgUnit", targetId: "org-support-active" },
  ];

function createHarness(
  clock: () => number = fixedClock(),
  structuredAuthority: StructuredScopeAuthorityService =
    createDefaultKpiStructuredAuthority(clock),
): {
  readonly service: KpiAdminService;
  readonly repository: InMemoryKpiPlanRepository;
  readonly actualRepository: InMemoryKpiActualRepository;
  readonly subjectAccess: InMemoryKpiSubjectReadonlyAccess;
  readonly managerRepository: InMemoryManagerAssignmentRepository;
  readonly orgUnitManagerRepository: InMemoryOrgUnitManagerAssignmentRepository;
  readonly audit: RecordingAuditGuard;
} {
  const repository = new InMemoryKpiPlanRepository();
  const actualRepository = new InMemoryKpiActualRepository();
  repository.actualEntries = actualRepository.entries;
  const subjectAccess = new InMemoryKpiSubjectReadonlyAccess();
  const managerRepository = new InMemoryManagerAssignmentRepository();
  const orgUnitManagerRepository = new InMemoryOrgUnitManagerAssignmentRepository();
  const audit = new RecordingAuditGuard();
  const service = new KpiAdminService(
    repository,
    actualRepository,
    new InMemoryBusinessCodeSequenceRepository(),
    subjectAccess,
    managerRepository,
    orgUnitManagerRepository,
    audit as unknown as AuditGuard,
    new ImmediateMutationBridge(),
    structuredAuthority,
    clock,
  );
  return {
    service,
    repository,
    actualRepository,
    subjectAccess,
    managerRepository,
    orgUnitManagerRepository,
    audit,
  };
}

function createDefaultKpiStructuredAuthority(
  clock: () => number,
): StructuredScopeAuthorityService {
  return createKpiStructuredAuthority(
    [
      kpiStructuredRecord({
        userId: "admin-1",
        permissions: ALL_KPI_ADMIN_PERMISSIONS,
      }),
      kpiStructuredRecord({
        userId: "manager-user",
        permissions: [
          Permission.KPI_READ,
          Permission.KPI_ENTER_ACTUAL,
          Permission.KPI_CORRECT_ACTUAL,
          Permission.KPI_READ_PROGRESS,
        ],
      }),
      kpiStructuredRecord({
        userId: "read-only-user",
        permissions: [Permission.KPI_READ, Permission.KPI_READ_PROGRESS],
      }),
    ],
    clock,
  );
}

function createKpiStructuredAuthority(
  records: readonly StructuredScopeAuthorityAssignment[],
  clock: () => number = fixedClock(),
): StructuredScopeAuthorityService {
  return new StructuredScopeAuthorityService(
    {
      async listByUserId(
        userId: string,
      ): Promise<readonly StructuredScopeAuthorityAssignment[]> {
        return records.filter(
          (record) => record.assignment.userId === userId,
        );
      },
    } satisfies StructuredScopeAuthorityReader,
    clock,
  );
}

function kpiStructuredRecord(input: {
  readonly assignmentId?: string;
  readonly userId: string;
  readonly permissions: readonly Permission[];
  readonly structuredScopeGrants?: readonly RoleAssignmentScopeGrant[];
  readonly state?: UserRoleAssignmentRecord["state"];
  readonly roleState?: string;
  readonly effectiveAt?: number | null;
  readonly expiresAt?: number | null;
}): StructuredScopeAuthorityAssignment {
  const roleId = `${input.userId}-kpi-role`;
  return {
    assignment: {
      assignmentId: input.assignmentId ?? `${input.userId}-kpi-assignment`,
      roleId,
      userId: input.userId,
      structuredScopeGrants:
        input.structuredScopeGrants ?? DEFAULT_KPI_STRUCTURED_SCOPE_GRANTS,
      state: input.state ?? "ACTIVE",
      effectiveAt: input.effectiveAt ?? 1_000,
      expiresAt: input.expiresAt ?? null,
      revokedAt: input.state === "REVOKED" ? 1_001 : null,
      origin: "DIRECT",
      bundleOrigin: null,
      reason: null,
      createdAt: 1_000,
      updatedAt: 1_000,
    },
    role: {
      id: roleId,
      state: input.roleState ?? "ACTIVE",
      permissions: input.permissions,
    },
  };
}

function talentPlanCommand() {
  return {
    title: "May talent KPI",
    subjectType: "TALENT",
    subjectId: "talent-1",
    periodMonth: "2026-05",
    periodStartAt: MAY_2026_START_AT,
    periodEndAt: MAY_2026_END_AT,
    targetMetrics: [
      { metricCode: "REVENUE_VND", targetValue: 1000 },
      { metricCode: "LIVE_HOURS", targetValue: 20 },
    ],
  };
}

function groupPlanCommand() {
  return {
    title: "May group KPI",
    subjectType: "TALENT_GROUP",
    subjectId: "group-1",
    periodMonth: "2026-05",
    periodStartAt: MAY_2026_START_AT,
    periodEndAt: MAY_2026_END_AT,
    targetMetrics: [
      { metricCode: "REVENUE_VND", targetValue: 300 },
      { metricCode: "ONBOARDED_TALENT_COUNT", targetValue: 3 },
    ],
  };
}

function orgUnitPlanCommand(
  subjectId = "org-department-active",
  targetMetrics: readonly {
    readonly metricCode: string;
    readonly targetValue: number;
  }[] = [{ metricCode: "REVENUE_VND", targetValue: 300 }],
) {
  return {
    title: "May org unit KPI",
    subjectType: "ORG_UNIT",
    subjectId,
    periodMonth: "2026-05",
    periodStartAt: MAY_2026_START_AT,
    periodEndAt: MAY_2026_END_AT,
    targetMetrics,
  };
}

function buildAllocationFixture(
  overrides: Partial<KpiAllocation> = {},
): KpiAllocation {
  return {
    id: "allocation-storage-fixture",
    kpiPlanId: "kpi-plan-storage-fixture",
    subjectType: "TALENT_GROUP",
    subjectId: "group-1",
    groupId: "group-1",
    memberEmploymentProfileId: "talent-profile-1",
    memberTalentId: "talent-1",
    membershipId: "membership-talent-1",
    allocationStatus: "PUBLISHED",
    allocationStartDate: "2026-05-01",
    allocationEndDate: null,
    targetMetrics: [{ metricCode: "REVENUE_VND", targetValue: 100 }],
    snapshotMemberDisplayName: "Talent Profile 1",
    note: null,
    createdAt: MAY_2026_START_AT,
    createdByActorId: "seed",
    updatedAt: MAY_2026_START_AT,
    updatedByActorId: "seed",
    submittedAt: MAY_2026_START_AT,
    submittedByActorId: "seed",
    approvedAt: MAY_2026_START_AT,
    approvedByActorId: "seed",
    approvalNote: null,
    rejectedAt: null,
    rejectedByActorId: null,
    rejectionReason: null,
    publishedAt: MAY_2026_START_AT,
    publishedByActorId: "seed",
    closedAt: null,
    ...overrides,
  };
}

async function createPublishedGroupPlan(
  service: KpiAdminService,
): Promise<
  ReturnType<KpiAdminService["publishKpiPlan"]> extends Promise<infer T>
    ? T
    : never
> {
  const created = await service.createKpiPlan(
    createActor(),
    groupPlanCommand(),
  );
  const publishedPlan = await service.publishKpiPlan(createActor(), {
    kpiPlanId: created.id,
  });
  await withEphemeralManagerAssignment(service, "group-1", async () => {
    await service.upsertKpiAllocationDraft(createManagerActor(), {
      kpiPlanId: created.id,
      allocations: [
        {
          employmentProfileId: "talent-profile-1",
          allocationStartDate: "2026-05-01",
          targetMetrics: [
            { metricCode: "REVENUE_VND", targetValue: 100 },
            { metricCode: "ONBOARDED_TALENT_COUNT", targetValue: 1 },
          ],
        },
        {
          employmentProfileId: "talent-profile-2",
          allocationStartDate: "2026-05-01",
          targetMetrics: [
            { metricCode: "REVENUE_VND", targetValue: 200 },
            { metricCode: "ONBOARDED_TALENT_COUNT", targetValue: 2 },
          ],
        },
      ],
    });
    await service.submitKpiAllocationDraft(createManagerActor(), {
      kpiPlanId: created.id,
    });
  });
  await service.approveKpiAllocation(createActor(), {
    kpiPlanId: created.id,
  });
  return service.publishKpiAllocation(createActor(), {
    kpiPlanId: publishedPlan.id,
  });
}

async function createPublishedDiamondGroupPlan(
  service: KpiAdminService,
): Promise<
  ReturnType<KpiAdminService["publishKpiAllocation"]> extends Promise<infer T>
    ? T
    : never
> {
  const created = await service.createKpiPlan(createActor(), {
    ...groupPlanCommand(),
    targetMetrics: [
      { metricCode: "REVENUE_VND", targetValue: 300 },
      { metricCode: "TIKTOK_DIAMOND", targetValue: 1000 },
    ],
  });
  const publishedPlan = await service.publishKpiPlan(createActor(), {
    kpiPlanId: created.id,
  });
  await withEphemeralManagerAssignment(service, "group-1", async () => {
    await service.upsertKpiAllocationDraft(createManagerActor(), {
      kpiPlanId: created.id,
      allocations: [
        {
          employmentProfileId: "talent-profile-1",
          allocationStartDate: "2026-05-01",
          targetMetrics: [
            { metricCode: "REVENUE_VND", targetValue: 100 },
            { metricCode: "TIKTOK_DIAMOND", targetValue: 600 },
          ],
        },
        {
          employmentProfileId: "talent-profile-2",
          allocationStartDate: "2026-05-01",
          targetMetrics: [
            { metricCode: "REVENUE_VND", targetValue: 200 },
            { metricCode: "TIKTOK_DIAMOND", targetValue: 400 },
          ],
        },
      ],
    });
    await service.submitKpiAllocationDraft(createManagerActor(), {
      kpiPlanId: created.id,
    });
  });
  await service.approveKpiAllocation(createActor(), {
    kpiPlanId: created.id,
  });
  return service.publishKpiAllocation(createActor(), {
    kpiPlanId: publishedPlan.id,
  });
}

test("KPI allocation storage preserves TALENT_GROUP member identity", async () => {
  const { service, repository } = createHarness(() => MAY_5_2026_NOON_HCM);
  const published = await createPublishedGroupPlan(service);
  const allocation = published.allocations[0] as KpiAllocation;
  const stored = repository.allocations.find((item) => item.id === allocation.id);

  assert.ok(stored);
  assert.equal(stored.subjectType, "TALENT_GROUP");
  assert.equal(stored.subjectId, "group-1");
  assert.equal(stored.groupId, "group-1");
  assert.equal(stored.memberTalentId, "talent-1");
  assert.equal(stored.memberEmploymentProfileId, "talent-profile-1");
});

test("KPI allocation storage rejects unsafe TALENT_GROUP member identity", async () => {
  const { repository } = createHarness();

  await assert.rejects(
    repository.insertAllocations([
      buildAllocationFixture({ memberTalentId: null }),
    ]),
    KpiInvalidAllocationError,
  );
  await assert.rejects(
    repository.insertAllocations([
      buildAllocationFixture({
        memberTalentId: null,
        memberEmploymentProfileId: null,
      }),
    ]),
    KpiInvalidAllocationError,
  );
});

test("KPI allocation storage supports ORG_UNIT EmploymentProfile identity without Talent", async () => {
  const { repository } = createHarness();
  const allocation = buildAllocationFixture({
    id: "org-unit-allocation-storage",
    kpiPlanId: "org-unit-plan-storage",
    subjectType: "ORG_UNIT",
    subjectId: "org-department-active",
    groupId: null,
    memberEmploymentProfileId: "employee-profile-1",
    memberTalentId: null,
    membershipId: null,
    snapshotMemberDisplayName: "Employee Profile 1",
  });

  await repository.insertAllocations([allocation]);
  const stored = await repository.listAllocationsByPlanId(
    "org-unit-plan-storage",
  );

  assert.equal(stored.length, 1);
  assert.equal(stored[0]?.subjectType, "ORG_UNIT");
  assert.equal(stored[0]?.subjectId, "org-department-active");
  assert.equal(stored[0]?.groupId, null);
  assert.equal(stored[0]?.memberEmploymentProfileId, "employee-profile-1");
  assert.equal(stored[0]?.memberTalentId, null);
});

test("KPI allocation storage hydrates legacy rows without subject identity as TALENT_GROUP", async () => {
  const repository = new NativeMongoKpiPlanRepository({
    collection(name: string) {
      if (name !== "kpi_allocations") {
        return {};
      }
      return {
        find: () => ({
          sort: () => ({
            toArray: async () => [
              {
                _id: "legacy-allocation",
                kpiPlanId: "legacy-plan",
                groupId: "legacy-group",
                memberEmploymentProfileId: "legacy-profile",
                memberTalentId: "legacy-talent",
                membershipId: "legacy-membership",
                allocationStatus: "PUBLISHED",
                allocationStartDate: "2026-05-01",
                allocationEndDate: null,
                targetMetrics: [
                  { metricCode: "REVENUE_VND", targetValue: 100 },
                ],
                snapshotMemberDisplayName: "Legacy Talent",
                note: null,
                createdAt: MAY_2026_START_AT,
                createdByActorId: "seed",
                updatedAt: MAY_2026_START_AT,
                updatedByActorId: "seed",
                submittedAt: MAY_2026_START_AT,
                submittedByActorId: "seed",
                approvedAt: MAY_2026_START_AT,
                approvedByActorId: "seed",
                approvalNote: null,
                rejectedAt: null,
                rejectedByActorId: null,
                rejectionReason: null,
                publishedAt: MAY_2026_START_AT,
                publishedByActorId: "seed",
                closedAt: null,
              },
            ],
          }),
        }),
      };
    },
  } as never);

  const allocations = await repository.listAllocationsByPlanId("legacy-plan");

  assert.equal(allocations.length, 1);
  assert.equal(allocations[0]?.subjectType, "TALENT_GROUP");
  assert.equal(allocations[0]?.subjectId, "legacy-group");
  assert.equal(allocations[0]?.groupId, "legacy-group");
  assert.equal(allocations[0]?.memberTalentId, "legacy-talent");
  assert.equal(allocations[0]?.memberEmploymentProfileId, "legacy-profile");
});

test("KPI allocation storage rejects ORG_UNIT without EmploymentProfile identity", async () => {
  const { repository } = createHarness();

  await assert.rejects(
    repository.insertAllocations([
      buildAllocationFixture({
        subjectType: "ORG_UNIT",
        subjectId: "org-department-active",
        groupId: null,
        memberEmploymentProfileId: null,
        memberTalentId: null,
        membershipId: null,
      }),
    ]),
    KpiInvalidAllocationError,
  );
});

test("KPI allocation index source definitions use partial unique identities", async () => {
  const captured = new Map<
    string,
    {
      readonly key: unknown;
      readonly options: {
        readonly name?: string;
        readonly unique?: boolean;
        readonly partialFilterExpression?: unknown;
      };
    }[]
  >();
  const db = {
    collection(name: string) {
      return {
        createIndex: async (
          key: unknown,
          options: {
            readonly name?: string;
            readonly unique?: boolean;
            readonly partialFilterExpression?: unknown;
          },
        ) => {
          const current = captured.get(name) ?? [];
          current.push({ key, options });
          captured.set(name, current);
          return options.name ?? "";
        },
      };
    },
  };

  await initKpiIndexes(db as never);
  const allocationIndexes = captured.get("kpi_allocations") ?? [];
  const talentGroupIndex = allocationIndexes.find(
    (index) =>
      index.options.name ===
      KPI_ALLOCATION_TALENT_GROUP_PLAN_MEMBER_UNIQ_INDEX_NAME,
  );
  const orgUnitIndex = allocationIndexes.find(
    (index) =>
      index.options.name === KPI_ALLOCATION_ORG_UNIT_PLAN_PROFILE_UNIQ_INDEX_NAME,
  );

  assert.ok(talentGroupIndex);
  assert.deepEqual(talentGroupIndex.key, {
    kpiPlanId: 1,
    memberTalentId: 1,
  });
  assert.equal(talentGroupIndex.options.unique, true);
  assert.deepEqual(talentGroupIndex.options.partialFilterExpression, {
    memberTalentId: { $type: "string" },
  });
  assert.ok(orgUnitIndex);
  assert.deepEqual(orgUnitIndex.key, {
    kpiPlanId: 1,
    memberEmploymentProfileId: 1,
  });
  assert.equal(orgUnitIndex.options.unique, true);
  assert.deepEqual(orgUnitIndex.options.partialFilterExpression, {
    subjectType: "ORG_UNIT",
    memberEmploymentProfileId: { $type: "string" },
  });
  assert.equal(
    allocationIndexes.some(
      (index) => index.options.name === "uniq_kpi_allocation_plan_member",
    ),
    false,
  );
});

async function createPublishedFebruary2028GroupPlan(
  service: KpiAdminService,
): Promise<
  ReturnType<KpiAdminService["publishKpiPlan"]> extends Promise<infer T>
    ? T
    : never
> {
  const created = await service.createKpiPlan(createActor(), {
    ...groupPlanCommand(),
    title: "February 2028 group KPI",
    periodMonth: "2028-02",
    periodStartAt: FEB_2028_START_AT,
    periodEndAt: FEB_2028_END_AT,
    targetMetrics: [
      { metricCode: "REVENUE_VND", targetValue: 100 },
      { metricCode: "ONBOARDED_TALENT_COUNT", targetValue: 1 },
    ],
  });
  const publishedPlan = await service.publishKpiPlan(createActor(), {
    kpiPlanId: created.id,
  });
  await withEphemeralManagerAssignment(service, "group-1", async () => {
    await service.upsertKpiAllocationDraft(createManagerActor(), {
      kpiPlanId: created.id,
      allocations: [
        {
          employmentProfileId: "talent-profile-1",
          allocationStartDate: "2028-02-01",
          targetMetrics: [
            { metricCode: "REVENUE_VND", targetValue: 100 },
            { metricCode: "ONBOARDED_TALENT_COUNT", targetValue: 1 },
          ],
        },
      ],
    });
    await service.submitKpiAllocationDraft(createManagerActor(), {
      kpiPlanId: created.id,
    });
  });
  await service.approveKpiAllocation(createActor(), {
    kpiPlanId: created.id,
  });
  return service.publishKpiAllocation(createActor(), {
    kpiPlanId: publishedPlan.id,
  });
}

async function createPublishedJune2026GroupPlan(
  service: KpiAdminService,
): Promise<
  ReturnType<KpiAdminService["publishKpiPlan"]> extends Promise<infer T>
    ? T
    : never
> {
  const created = await service.createKpiPlan(createActor(), {
    ...groupPlanCommand(),
    title: "June 2026 group KPI",
    periodMonth: "2026-06",
    periodStartAt: JUNE_2026_START_AT,
    periodEndAt: JUNE_2026_END_AT,
  });
  const publishedPlan = await service.publishKpiPlan(createActor(), {
    kpiPlanId: created.id,
  });
  await withEphemeralManagerAssignment(service, "group-1", async () => {
    await service.upsertKpiAllocationDraft(createManagerActor(), {
      kpiPlanId: created.id,
      allocations: [
        {
          employmentProfileId: "talent-profile-1",
          allocationStartDate: "2026-06-01",
          targetMetrics: [
            { metricCode: "REVENUE_VND", targetValue: 300 },
            { metricCode: "ONBOARDED_TALENT_COUNT", targetValue: 3 },
          ],
        },
      ],
    });
    await service.submitKpiAllocationDraft(createManagerActor(), {
      kpiPlanId: created.id,
    });
  });
  await service.approveKpiAllocation(createActor(), {
    kpiPlanId: created.id,
  });
  return service.publishKpiAllocation(createActor(), {
    kpiPlanId: publishedPlan.id,
  });
}

async function createPublishedDecember2026GroupPlan(
  service: KpiAdminService,
): Promise<
  ReturnType<KpiAdminService["publishKpiPlan"]> extends Promise<infer T>
    ? T
    : never
> {
  const created = await service.createKpiPlan(createActor(), {
    ...groupPlanCommand(),
    title: "December 2026 group KPI",
    periodMonth: "2026-12",
    periodStartAt: DECEMBER_2026_START_AT,
    periodEndAt: DECEMBER_2026_END_AT,
  });
  const publishedPlan = await service.publishKpiPlan(createActor(), {
    kpiPlanId: created.id,
  });
  await withEphemeralManagerAssignment(service, "group-1", async () => {
    await service.upsertKpiAllocationDraft(createManagerActor(), {
      kpiPlanId: created.id,
      allocations: [
        {
          employmentProfileId: "talent-profile-1",
          allocationStartDate: "2026-12-01",
          targetMetrics: [
            { metricCode: "REVENUE_VND", targetValue: 300 },
            { metricCode: "ONBOARDED_TALENT_COUNT", targetValue: 3 },
          ],
        },
      ],
    });
    await service.submitKpiAllocationDraft(createManagerActor(), {
      kpiPlanId: created.id,
    });
  });
  await service.approveKpiAllocation(createActor(), {
    kpiPlanId: created.id,
  });
  return service.publishKpiAllocation(createActor(), {
    kpiPlanId: publishedPlan.id,
  });
}

async function withEphemeralManagerAssignment<T>(
  service: KpiAdminService,
  groupId: string,
  action: () => Promise<T>,
): Promise<T> {
  const managerRepository = (
    service as unknown as {
      readonly managerAssignmentRepository: InMemoryManagerAssignmentRepository;
    }
  ).managerAssignmentRepository;
  const assignment: TalentGroupManagerAssignment = {
    id: `helper-assignment-${groupId}`,
    groupId,
    managerEmploymentProfileId: "manager-profile-1",
    role: "MANAGER",
    effectiveFrom: 0,
    effectiveTo: null,
    status: "ACTIVE",
    isPrimary: true,
    createdAt: 0,
    createdByActorId: "seed",
    updatedAt: 0,
    updatedByActorId: "seed",
  };
  managerRepository.assignments.push(assignment);
  try {
    return await action();
  } finally {
    const index = managerRepository.assignments.findIndex(
      (item) => item.id === assignment.id,
    );
    if (index >= 0) {
      managerRepository.assignments.splice(index, 1);
    }
  }
}

function seedManagerAssignment(
  repository: InMemoryManagerAssignmentRepository,
  groupId = "group-1",
  effectiveFrom = MAY_2026_START_AT,
): void {
  repository.assignments.push({
    id: "assignment-1",
    groupId,
    managerEmploymentProfileId: "manager-profile-1",
    role: "MANAGER",
    effectiveFrom,
    effectiveTo: null,
    status: "ACTIVE",
    isPrimary: true,
    createdAt: MAY_2026_START_AT,
    createdByActorId: "seed",
    updatedAt: MAY_2026_START_AT,
    updatedByActorId: "seed",
  });
}

function orgUnitManagerAssignment(
  overrides: Partial<OrgUnitManagerAssignment>,
): OrgUnitManagerAssignment {
  return {
    id: "org-unit-assignment-1",
    orgUnitId: "org-unit-1",
    managerEmploymentProfileId: "manager-profile-1",
    role: "UNIT_MANAGER",
    includeDescendants: false,
    actionMask: [],
    effectiveFrom: MAY_2026_START_AT,
    effectiveTo: null,
    status: "ACTIVE",
    isPrimary: true,
    createdAt: MAY_2026_START_AT,
    createdByActorId: "seed",
    updatedAt: MAY_2026_START_AT,
    updatedByActorId: "seed",
    ...overrides,
  };
}

type OrgUnitManagerAssignmentTestDocument = Omit<
  OrgUnitManagerAssignment,
  "id"
> & {
  readonly _id: string;
};

function orgUnitManagerAssignmentDocument(
  overrides: Partial<OrgUnitManagerAssignmentTestDocument>,
): OrgUnitManagerAssignmentTestDocument {
  return {
    _id: "org-unit-assignment-1",
    orgUnitId: "org-unit-1",
    managerEmploymentProfileId: "manager-profile-1",
    role: "UNIT_MANAGER",
    includeDescendants: false,
    actionMask: [],
    effectiveFrom: MAY_2026_START_AT,
    effectiveTo: null,
    status: "ACTIVE",
    isPrimary: true,
    createdAt: MAY_2026_START_AT,
    createdByActorId: "seed",
    updatedAt: MAY_2026_START_AT,
    updatedByActorId: "seed",
    ...overrides,
  };
}

test("KPI managed unit authority adapter resolves active TalentGroup and OrgUnit assignments", async () => {
  const { subjectAccess, managerRepository, orgUnitManagerRepository } =
    createHarness(() => MAY_5_2026_NOON_HCM);
  seedManagerAssignment(managerRepository, "group-1");
  seedManagerAssignment(managerRepository, "group-2");
  seedManagerAssignment(managerRepository, "group-2");
  orgUnitManagerRepository.assignments.push(
    orgUnitManagerAssignment({
      id: "org-unit-assignment-1",
      orgUnitId: "org-unit-1",
      role: "DEPARTMENT_OWNER",
      includeDescendants: true,
      actionMask: ["READ_PROGRESS"],
    }),
    orgUnitManagerAssignment({
      id: "org-unit-assignment-2",
      orgUnitId: "org-unit-2",
      role: "UNIT_MANAGER",
    }),
    orgUnitManagerAssignment({
      id: "org-unit-assignment-duplicate",
      orgUnitId: "org-unit-2",
      role: "UNIT_OPERATOR",
      actionMask: ["ENTER_ACTUAL"],
    }),
  );

  const authority = await resolveManagedUnitAuthority(
    createManagerActor(),
    {
      subjectReadonlyAccess: subjectAccess,
      managerAssignmentRepository: managerRepository,
      orgUnitManagerAssignmentRepository: orgUnitManagerRepository,
    },
    { asOf: MAY_5_2026_NOON_HCM },
  );
  const unscopedAuthority = await resolveManagedUnitAuthority(
    createManagerActorWithoutKpiScope(),
    {
      subjectReadonlyAccess: subjectAccess,
      managerAssignmentRepository: managerRepository,
      orgUnitManagerAssignmentRepository: orgUnitManagerRepository,
    },
    { asOf: MAY_5_2026_NOON_HCM },
  );

  const orgUnitAssignments =
    await orgUnitManagerRepository.listActiveByManagerEmploymentProfileId(
      "manager-profile-1",
      MAY_5_2026_NOON_HCM,
    );

  assert.deepEqual(authority?.scope.talentGroupIds, ["group-1", "group-2"]);
  assert.deepEqual(authority?.scope.orgUnitIds, ["org-unit-1", "org-unit-2"]);
  assert.deepEqual(authority?.scope.orgUnitScopes, [
    {
      orgUnitId: "org-unit-1",
      role: "DEPARTMENT_OWNER",
      includeDescendants: true,
      actionMask: ["READ_PROGRESS"],
    },
    {
      orgUnitId: "org-unit-2",
      role: "UNIT_MANAGER",
      includeDescendants: false,
      actionMask: [],
    },
    {
      orgUnitId: "org-unit-2",
      role: "UNIT_OPERATOR",
      includeDescendants: false,
      actionMask: ["ENTER_ACTUAL"],
    },
  ]);
  assert.equal(authority?.actorEmploymentProfileId, "manager-profile-1");
  assert.equal(unscopedAuthority, null);
  assert.equal(orgUnitAssignments[0]?.includeDescendants, true);
  assert.deepEqual(orgUnitAssignments[0]?.actionMask, ["READ_PROGRESS"]);
  assert.deepEqual(
    orgUnitAssignments.map((assignment) => assignment.role),
    ["DEPARTMENT_OWNER", "UNIT_MANAGER", "UNIT_OPERATOR"],
  );
});

test("KPI managed unit authority adapter ignores inactive, expired, future, and wrong-manager OrgUnit assignments", async () => {
  const { subjectAccess, managerRepository, orgUnitManagerRepository } =
    createHarness(() => MAY_5_2026_NOON_HCM);
  seedManagerAssignment(managerRepository, "group-1");
  orgUnitManagerRepository.assignments.push(
    orgUnitManagerAssignment({ id: "active", orgUnitId: "org-unit-active" }),
    orgUnitManagerAssignment({
      id: "inactive",
      orgUnitId: "org-unit-inactive",
      status: "INACTIVE",
    }),
    orgUnitManagerAssignment({
      id: "expired",
      orgUnitId: "org-unit-expired",
      effectiveTo: MAY_5_2026_START_HCM,
    }),
    orgUnitManagerAssignment({
      id: "future",
      orgUnitId: "org-unit-future",
      effectiveFrom: JUNE_2026_START_AT,
    }),
    orgUnitManagerAssignment({
      id: "other-manager",
      orgUnitId: "org-unit-other-manager",
      managerEmploymentProfileId: "other-manager-profile",
    }),
  );

  const authority = await resolveManagedUnitAuthority(
    createManagerActor(),
    {
      subjectReadonlyAccess: subjectAccess,
      managerAssignmentRepository: managerRepository,
      orgUnitManagerAssignmentRepository: orgUnitManagerRepository,
    },
    { asOf: MAY_5_2026_NOON_HCM },
  );

  assert.deepEqual(authority?.scope.talentGroupIds, ["group-1"]);
  assert.deepEqual(authority?.scope.orgUnitIds, ["org-unit-active"]);
});

test("NativeMongo OrgUnit manager assignment repository filters active manager-role assignments", async () => {
  const asOf = MAY_5_2026_NOON_HCM;
  const documents = [
    orgUnitManagerAssignmentDocument({
      _id: "department-owner",
      orgUnitId: "org-department-owner",
      role: "DEPARTMENT_OWNER",
      includeDescendants: true,
      actionMask: ["READ_PROGRESS"],
    }),
    orgUnitManagerAssignmentDocument({
      _id: "unit-manager",
      orgUnitId: "org-unit-manager",
      role: "UNIT_MANAGER",
      actionMask: ["ALLOCATE"],
    }),
    orgUnitManagerAssignmentDocument({
      _id: "unit-operator",
      orgUnitId: "org-unit-operator",
      role: "UNIT_OPERATOR",
      includeDescendants: true,
      actionMask: ["ENTER_ACTUAL"],
    }),
    orgUnitManagerAssignmentDocument({
      _id: "same-manager-different-role",
      orgUnitId: "org-wrong-role",
      role: "UNIT_OPERATOR",
    }),
    orgUnitManagerAssignmentDocument({
      _id: "different-manager-same-role",
      orgUnitId: "org-wrong-manager",
      managerEmploymentProfileId: "other-manager-profile",
      role: "DEPARTMENT_OWNER",
    }),
    orgUnitManagerAssignmentDocument({
      _id: "inactive",
      orgUnitId: "org-inactive",
      role: "DEPARTMENT_OWNER",
      status: "INACTIVE",
    }),
    orgUnitManagerAssignmentDocument({
      _id: "removed",
      orgUnitId: "org-removed",
      role: "DEPARTMENT_OWNER",
      status: "REMOVED",
    }),
    orgUnitManagerAssignmentDocument({
      _id: "expired",
      orgUnitId: "org-expired",
      role: "DEPARTMENT_OWNER",
      effectiveTo: MAY_5_2026_START_HCM,
    }),
    orgUnitManagerAssignmentDocument({
      _id: "future",
      orgUnitId: "org-future",
      role: "DEPARTMENT_OWNER",
      effectiveFrom: JUNE_2026_START_AT,
    }),
    orgUnitManagerAssignmentDocument({
      _id: "defaults",
      orgUnitId: "org-defaults",
      role: "DEPARTMENT_OWNER",
      includeDescendants: undefined,
      actionMask: undefined,
      isPrimary: undefined,
    }),
  ];
  const queries: Record<string, unknown>[] = [];
  const repository = new NativeMongoOrgUnitManagerAssignmentRepository({
    collection(name: string) {
      assert.ok(
        ["org_unit_manager_assignments", "employment_profiles"].includes(name),
      );
      if (name === "employment_profiles") {
        return {
          findOne() {
            return Promise.resolve(null);
          },
        };
      }
      return {
        find(query: Record<string, unknown>) {
          queries.push(query);
          return {
            sort() {
              return {
                toArray() {
                  return Promise.resolve(
                    documents.filter((document) =>
                      matchesMongoActiveQuery(document, query),
                    ),
                  );
                },
              };
            },
          };
        },
      };
    },
  } as never);

  const departmentOwners =
    await repository.listActiveByManagerEmploymentProfileIdAndRole(
      "manager-profile-1",
      "DEPARTMENT_OWNER",
      asOf,
    );
  const unitManagers =
    await repository.listActiveByManagerEmploymentProfileIdAndRole(
      "manager-profile-1",
      "UNIT_MANAGER",
      asOf,
    );
  const unitOperators =
    await repository.listActiveByManagerEmploymentProfileIdAndRole(
      "manager-profile-1",
      "UNIT_OPERATOR",
      asOf,
    );

  assert.deepEqual(
    queries.map((query) => ({
      managerEmploymentProfileId: query.managerEmploymentProfileId,
      role: query.role,
      status: query.status,
      effectiveFrom: query.effectiveFrom,
      effectiveTo: query.$or,
    })),
    [
      {
        managerEmploymentProfileId: "manager-profile-1",
        role: "DEPARTMENT_OWNER",
        status: "ACTIVE",
        effectiveFrom: { $lte: asOf },
        effectiveTo: [{ effectiveTo: null }, { effectiveTo: { $gte: asOf } }],
      },
      {
        managerEmploymentProfileId: "manager-profile-1",
        role: "UNIT_MANAGER",
        status: "ACTIVE",
        effectiveFrom: { $lte: asOf },
        effectiveTo: [{ effectiveTo: null }, { effectiveTo: { $gte: asOf } }],
      },
      {
        managerEmploymentProfileId: "manager-profile-1",
        role: "UNIT_OPERATOR",
        status: "ACTIVE",
        effectiveFrom: { $lte: asOf },
        effectiveTo: [{ effectiveTo: null }, { effectiveTo: { $gte: asOf } }],
      },
    ],
  );
  assert.deepEqual(
    departmentOwners.map((assignment) => assignment.id),
    ["department-owner", "defaults"],
  );
  assert.deepEqual(unitManagers.map((assignment) => assignment.id), [
    "unit-manager",
  ]);
  assert.deepEqual(unitOperators.map((assignment) => assignment.id), [
    "unit-operator",
    "same-manager-different-role",
  ]);
  assert.equal(departmentOwners[0]?.includeDescendants, true);
  assert.deepEqual(departmentOwners[0]?.actionMask, ["READ_PROGRESS"]);
  assert.equal(departmentOwners[1]?.includeDescendants, false);
  assert.deepEqual(departmentOwners[1]?.actionMask, []);
  assert.equal(departmentOwners[1]?.isPrimary, false);
});

test("KPI managed unit authority adapter preserves active TalentGroup assignments when OrgUnit repository is absent", async () => {
  const { subjectAccess, managerRepository } = createHarness(
    () => MAY_5_2026_NOON_HCM,
  );
  seedManagerAssignment(managerRepository, "group-1");
  seedManagerAssignment(managerRepository, "group-2");
  seedManagerAssignment(managerRepository, "group-2");

  const authority = await resolveManagedUnitAuthority(
    createManagerActor(),
    {
      subjectReadonlyAccess: subjectAccess,
      managerAssignmentRepository: managerRepository,
    },
    { asOf: MAY_5_2026_NOON_HCM },
  );
  const unscopedAuthority = await resolveManagedUnitAuthority(
    createManagerActorWithoutKpiScope(),
    {
      subjectReadonlyAccess: subjectAccess,
      managerAssignmentRepository: managerRepository,
    },
    { asOf: MAY_5_2026_NOON_HCM },
  );

  assert.deepEqual(authority?.scope.talentGroupIds, ["group-1", "group-2"]);
  assert.deepEqual(authority?.scope.orgUnitIds, []);
  assert.equal(authority?.actorEmploymentProfileId, "manager-profile-1");
  assert.equal(unscopedAuthority, null);
});

test("KPI managed unit authority adapter ignores missing profile and inactive or expired TalentGroup assignments", async () => {
  const { service, managerRepository } = createHarness(
    () => MAY_5_2026_NOON_HCM,
  );
  await createPublishedGroupPlan(service);
  managerRepository.assignments.push(
    {
      id: "inactive-assignment",
      groupId: "group-1",
      managerEmploymentProfileId: "manager-profile-1",
      role: "MANAGER",
      effectiveFrom: MAY_2026_START_AT,
      effectiveTo: null,
      status: "INACTIVE",
      isPrimary: true,
      createdAt: MAY_2026_START_AT,
      createdByActorId: "seed",
      updatedAt: MAY_2026_START_AT,
      updatedByActorId: "seed",
    },
    {
      id: "expired-assignment",
      groupId: "group-1",
      managerEmploymentProfileId: "manager-profile-1",
      role: "MANAGER",
      effectiveFrom: MAY_2026_START_AT,
      effectiveTo: MAY_5_2026_START_HCM,
      status: "ACTIVE",
      isPrimary: false,
      createdAt: MAY_2026_START_AT,
      createdByActorId: "seed",
      updatedAt: MAY_2026_START_AT,
      updatedByActorId: "seed",
    },
  );

  const inactiveOrExpiredResult = await service.listKpiPlans(
    createManagerActor(),
    {},
  );
  const unlinkedResult = await service.listKpiPlans(
    createScopedActor({
      id: "unlinked-manager-user",
      permissions: [Permission.KPI_READ],
      kpiScopes: ["managedGroup"],
    }),
    {},
  );

  assert.deepEqual(inactiveOrExpiredResult.items, []);
  assert.deepEqual(unlinkedResult.items, []);
});

function replacePlanAllocationStatuses(
  repository: InMemoryKpiPlanRepository,
  kpiPlanId: string,
  statuses: readonly KpiAllocationStatus[],
): void {
  const template = repository.allocations.find(
    (allocation) => allocation.kpiPlanId === kpiPlanId,
  );
  assert.ok(template);

  const remaining = repository.allocations.filter(
    (allocation) => allocation.kpiPlanId !== kpiPlanId,
  );
  repository.allocations.length = 0;
  repository.allocations.push(
    ...remaining,
    ...statuses.map((status, index) => {
      const memberIndex = index % 2 === 0 ? "1" : "2";
      return {
        ...template,
        id: `${kpiPlanId}-${status}-${index}`,
        allocationStatus: status,
        memberTalentId: `talent-${memberIndex}`,
        memberEmploymentProfileId: `talent-profile-${memberIndex}`,
        membershipId: `membership-talent-${memberIndex}`,
      };
    }),
  );
}

function replaceStoredPlan(
  repository: InMemoryKpiPlanRepository,
  currentPlanId: string,
  replacement: Pick<KpiPlan, "id" | "planCode" | "normalizedPlanCode">,
): void {
  const index = repository.plans.findIndex((plan) => plan.id === currentPlanId);
  assert.notEqual(index, -1);
  repository.plans[index] = {
    ...(repository.plans[index] as KpiPlan),
    ...replacement,
  };
}

function seedOfficialActualEntriesForDates(
  repository: InMemoryKpiPlanRepository,
  actualRepository: InMemoryKpiActualRepository,
  kpiPlanId: string,
  actualDates: readonly string[],
  actualValue = 1,
): void {
  const plan = repository.plans.find((item) => item.id === kpiPlanId);
  assert.ok(plan);
  const allocations = repository.allocations.filter(
    (allocation) =>
      allocation.kpiPlanId === kpiPlanId &&
      allocation.subjectType === "TALENT_GROUP" &&
      allocation.groupId === plan.subjectId &&
      allocation.allocationStatus === "PUBLISHED",
  );
  for (const allocation of allocations) {
    const memberTalentId = requireTestAllocationMemberTalentId(allocation);
    const memberEmploymentProfileId =
      requireTestAllocationMemberEmploymentProfileId(allocation);
    for (const metric of allocation.targetMetrics) {
      for (const actualDate of actualDates) {
        actualRepository.entries.push({
          id: `seed-entry:${kpiPlanId}:${allocation.id}:${metric.metricCode}:${actualDate}`,
          kpiPlanId,
          allocationId: allocation.id,
          memberEmploymentProfileId,
          memberTalentId,
          metricCode: metric.metricCode,
          actualDate,
          actualValue,
          effectiveValue: actualValue,
          editCount: 0,
          correctionCount: 0,
          latestCorrectionId: null,
          createdAt: MAY_2026_START_AT,
          createdByActorId: "seed",
          updatedAt: MAY_2026_START_AT,
          updatedByActorId: "seed",
          lastEditedAt: null,
          lastEditedByActorId: null,
        });
      }
    }
  }
}

function seedOfficialActualExcusesForDate(
  repository: InMemoryKpiPlanRepository,
  kpiPlanId: string,
  actualDate: string,
): void {
  const plan = repository.plans.find((item) => item.id === kpiPlanId);
  assert.ok(plan);
  const allocations = repository.allocations.filter(
    (allocation) =>
      allocation.kpiPlanId === kpiPlanId &&
      allocation.subjectType === "TALENT_GROUP" &&
      allocation.groupId === plan.subjectId &&
      allocation.allocationStatus === "PUBLISHED",
  );
  for (const [allocationIndex, allocation] of allocations.entries()) {
    for (const [metricIndex, metric] of allocation.targetMetrics.entries()) {
      const status =
        (allocationIndex + metricIndex) % 2 === 0
          ? ("EXCUSED" as const)
          : ("NOT_REQUIRED" as const);
      repository.actualExcuses.push({
        id: `seed-excuse:${kpiPlanId}:${allocation.id}:${metric.metricCode}:${actualDate}`,
        kpiPlanId,
        allocationId: allocation.id,
        metricCode: metric.metricCode,
        actualDate,
        status,
        reasonCode:
          status === "EXCUSED" ? "MEMBER_LEAVE" : "NO_OPERATION_REQUIRED",
        reasonText:
          status === "EXCUSED" ? "Approved leave" : "No operation required",
        createdAt: MAY_2026_START_AT,
        createdByActorId: "seed",
        updatedAt: MAY_2026_START_AT,
        updatedByActorId: "seed",
        deletedAt: null,
        deletedByActorId: null,
      });
    }
  }
}

function requireTestAllocationMemberTalentId(allocation: KpiAllocation): string {
  if (
    allocation.subjectType === "TALENT_GROUP" &&
    typeof allocation.memberTalentId === "string" &&
    allocation.memberTalentId.length > 0
  ) {
    return allocation.memberTalentId;
  }
  throw new KpiInvalidAllocationError(
    "KPI test fixture requires TALENT_GROUP allocation memberTalentId",
  );
}

function requireTestAllocationMemberEmploymentProfileId(
  allocation: KpiAllocation,
): string {
  if (
    typeof allocation.memberEmploymentProfileId === "string" &&
    allocation.memberEmploymentProfileId.length > 0
  ) {
    return allocation.memberEmploymentProfileId;
  }
  throw new KpiInvalidAllocationError(
    "KPI test fixture requires allocation memberEmploymentProfileId",
  );
}

test("NativeMongoKpiSubjectReadonlyAccess derives internal group member display from linked EmploymentProfile", async () => {
  const internalTalent = {
    _id: "talent-1",
    displayName: "Stale Internal Display",
    stageName: "Stale Internal Stage",
    legalName: "Stale Internal Legal",
    displayShortName: "Stale Internal Short",
    status: "ACTIVE",
    operationalStatus: "ACTIVE",
    linkedEmploymentProfileId: "ep-binh",
  };
  const activeMembership = {
    _id: "membership-1",
    groupId: "group-1",
    talentId: "talent-1",
    membershipStatus: "ACTIVE",
  };
  const linkedEmploymentProfile = {
    _id: "ep-binh",
    linkedUserId: null,
    employmentStatus: "ACTIVE",
    displayName: "Binh Tran",
  };
  type KpiReadonlyQuery = Record<string, unknown>;
  const repository = new NativeMongoKpiSubjectReadonlyAccess({
    collection(name: string) {
      return {
        findOne(query: KpiReadonlyQuery) {
          if (name === "talent_group_members") {
            return Promise.resolve(
              query.groupId === activeMembership.groupId &&
                query.talentId === activeMembership.talentId &&
                query.membershipStatus === activeMembership.membershipStatus
                ? activeMembership
                : null,
            );
          }

          if (name === "talents") {
            return Promise.resolve(
              query._id === internalTalent._id ||
                (query.linkedEmploymentProfileId ===
                  internalTalent.linkedEmploymentProfileId &&
                  query.operationalStatus === "ACTIVE")
                ? internalTalent
                : null,
            );
          }

          if (name === "employment_profiles") {
            return Promise.resolve(
              query._id === linkedEmploymentProfile._id &&
                (query.employmentStatus === undefined ||
                  query.employmentStatus ===
                    linkedEmploymentProfile.employmentStatus)
                ? linkedEmploymentProfile
                : null,
            );
          }

          return Promise.resolve(null);
        },
      };
    },
  } as never);

  const member = await repository.findActiveGroupMember("group-1", "talent-1");
  const memberByProfile =
    await repository.findActiveGroupMemberByEmploymentProfile(
      "group-1",
      "ep-binh",
    );

  assert.equal(member?.membershipId, "membership-1");
  assert.equal(member?.employmentProfileId, "ep-binh");
  assert.equal(member?.displayName, "Binh Tran");
  assert.notEqual(member?.displayName, internalTalent.displayName);
  assert.notEqual(member?.displayName, internalTalent.stageName);
  assert.notEqual(member?.displayName, internalTalent.legalName);
  assert.notEqual(member?.displayName, internalTalent.displayShortName);
  assert.equal(memberByProfile?.membershipId, "membership-1");
  assert.equal(memberByProfile?.talentId, "talent-1");
  assert.equal(memberByProfile?.displayName, "Binh Tran");
  assert.notEqual(memberByProfile?.displayName, internalTalent.displayName);
  assert.notEqual(memberByProfile?.displayName, internalTalent.stageName);
  assert.notEqual(memberByProfile?.displayName, internalTalent.legalName);
  assert.notEqual(
    memberByProfile?.displayName,
    internalTalent.displayShortName,
  );
});

test("NativeMongoKpiSubjectReadonlyAccess filters and limits managed members after canonical active joins", async () => {
  const memberships = [
    {
      _id: "membership-suspended",
      groupId: "group-1",
      talentId: "talent-suspended",
      membershipStatus: "ACTIVE",
    },
    {
      _id: "membership-inactive",
      groupId: "group-1",
      talentId: "talent-inactive",
      membershipStatus: "ACTIVE",
    },
    {
      _id: "membership-archived",
      groupId: "group-1",
      talentId: "talent-archived",
      membershipStatus: "ACTIVE",
    },
    {
      _id: "membership-zulu",
      groupId: "group-1",
      talentId: "talent-zulu",
      membershipStatus: "ACTIVE",
    },
    {
      _id: "membership-alpha",
      groupId: "group-1",
      talentId: "talent-alpha",
      membershipStatus: "ACTIVE",
    },
    {
      _id: "membership-ordinary",
      groupId: "group-1",
      talentId: "talent-ordinary",
      membershipStatus: "ACTIVE",
    },
    {
      _id: "membership-unmanaged",
      groupId: "group-2",
      talentId: "talent-unmanaged",
      membershipStatus: "ACTIVE",
    },
  ];
  const talents = [
    {
      _id: "talent-suspended",
      talentCode: "TAL-SUSPENDED",
      talentOrigin: "INTERNAL",
      operationalStatus: "SUSPENDED",
      linkedEmploymentProfileId: "ep-suspended",
    },
    {
      _id: "talent-inactive",
      talentCode: "TAL-INACTIVE",
      talentOrigin: "INTERNAL",
      operationalStatus: "INACTIVE",
      linkedEmploymentProfileId: "ep-inactive",
    },
    {
      _id: "talent-archived",
      talentCode: "TAL-ARCHIVED",
      talentOrigin: "INTERNAL",
      operationalStatus: "ARCHIVED",
      linkedEmploymentProfileId: "ep-archived",
    },
    {
      _id: "talent-zulu",
      talentCode: "TAL-ZULU",
      talentOrigin: "INTERNAL",
      operationalStatus: "ACTIVE",
      linkedEmploymentProfileId: "ep-zulu",
    },
    {
      _id: "talent-alpha",
      talentCode: "TAL-ALPHA",
      talentOrigin: "INTERNAL",
      operationalStatus: "ACTIVE",
      linkedEmploymentProfileId: "ep-alpha",
      legalName: "Forbidden Legal Name",
      email: "forbidden@example.test",
    },
    {
      _id: "talent-ordinary",
      talentCode: "TAL-ORDINARY",
      talentOrigin: "INTERNAL",
      operationalStatus: "ACTIVE",
      linkedEmploymentProfileId: "ep-ordinary",
    },
    {
      _id: "talent-unmanaged",
      talentCode: "TAL-UNMANAGED",
      talentOrigin: "INTERNAL",
      operationalStatus: "ACTIVE",
      linkedEmploymentProfileId: "ep-unmanaged",
    },
  ];
  const profiles = [
    {
      _id: "ep-zulu",
      employeeCode: "EP-ZULU",
      linkedUserId: "forbidden-linked-user",
      employmentStatus: "ACTIVE",
      displayName: "Zulu Search Target",
    },
    {
      _id: "ep-alpha",
      employeeCode: "EP-ALPHA",
      linkedUserId: "forbidden-linked-user",
      employmentStatus: "ACTIVE",
      displayName: "Alpha Search Target",
    },
    {
      _id: "ep-ordinary",
      employeeCode: "EP-ORDINARY",
      linkedUserId: null,
      employmentStatus: "ACTIVE",
      displayName: "Ordinary Active Member",
    },
    {
      _id: "ep-unmanaged",
      employeeCode: "EP-UNMANAGED",
      linkedUserId: null,
      employmentStatus: "ACTIVE",
      displayName: "Unmanaged Member",
    },
  ];
  type KpiReadonlyQuery = Record<string, unknown>;
  let membershipLimit: number | undefined;
  const repository = new NativeMongoKpiSubjectReadonlyAccess({
    collection(name: string) {
      return {
        find(query: KpiReadonlyQuery) {
          let rows: readonly Record<string, unknown>[];
          if (name === "talent_group_members") {
            rows = memberships.filter(
              (membership) =>
                membership.groupId === query.groupId &&
                membership.membershipStatus === query.membershipStatus,
            );
          } else if (name === "talents") {
            assert.equal(query.status, undefined);
            assert.equal(query.operationalStatus, "ACTIVE");
            const ids = (query._id as { readonly $in: readonly string[] }).$in;
            rows = talents.filter(
              (talent) =>
                ids.includes(talent._id) &&
                talent.talentOrigin === query.talentOrigin &&
                talent.operationalStatus === query.operationalStatus &&
                typeof talent.linkedEmploymentProfileId === "string",
            );
          } else {
            const ids = (query._id as { readonly $in: readonly string[] }).$in;
            rows = profiles.filter(
              (profile) =>
                ids.includes(profile._id) &&
                profile.employmentStatus === query.employmentStatus,
            );
          }
          let limitedRows = rows;
          return {
            limit(limit: number) {
              membershipLimit = limit;
              limitedRows = rows.slice(0, limit);
              return this;
            },
            toArray() {
              return Promise.resolve(limitedRows);
            },
          };
        },
      };
    },
  } as never);

  const searched = await repository.listActiveInternalGroupMembers("group-1", {
    search: "search target",
    limit: 1,
  });
  const all = await repository.listActiveInternalGroupMembers("group-1", {
    limit: 20,
  });

  assert.equal(membershipLimit, undefined);
  assert.deepEqual(
    searched.map((item) => item.employmentProfileId),
    ["ep-alpha"],
  );
  assert.deepEqual(
    all.map((item) => item.employmentProfileId),
    ["ep-alpha", "ep-ordinary", "ep-zulu"],
  );
  assert.deepEqual(
    Object.keys(searched[0] ?? {}).sort(),
    [
      "displayName",
      "employeeCode",
      "employmentProfileId",
      "groupId",
      "talentCode",
      "talentId",
    ].sort(),
  );
  for (const forbiddenField of ["legalName", "email", "linkedUserId"]) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(searched[0] ?? {}, forbiddenField),
      false,
    );
  }
});

test("KPI V2 rejects TALENT create in monthly-cycle create flow", async () => {
  const { service } = createHarness();

  await assert.rejects(
    service.createKpiPlan(createActor(), talentPlanCommand()),
    /KPI create subjectType TALENT is not supported/,
  );
});

test("KPI V2 creates TALENT_GROUP draft plan with valid metrics and no allocations", async () => {
  const { service } = createHarness();

  const result = await service.createKpiPlan(createActor(), groupPlanCommand());

  assert.equal(result.status, "DRAFT");
  assert.equal(result.subjectType, "TALENT_GROUP");
  assert.equal(result.planCode, "KPI-000001");
  assert.equal(result.currencyCode, "VND");
  assert.equal(result.targetMetrics.length, 2);
  assert.equal(result.targetMetrics[0]?.actualSource, "MANUAL");
  assert.equal(result.allocations.length, 0);
});

test("KPI V2 creates and publishes TALENT_GROUP TikTok Diamond target metrics", async () => {
  const { service } = createHarness();

  const created = await service.createKpiPlan(createActor(), {
    ...groupPlanCommand(),
    targetMetrics: [{ metricCode: "TIKTOK_DIAMOND", targetValue: 1000 }],
  });
  const published = await service.publishKpiPlan(createActor(), {
    kpiPlanId: created.id,
  });

  assert.equal(created.status, "DRAFT");
  assert.equal(created.subjectType, "TALENT_GROUP");
  assert.deepEqual(
    created.targetMetrics.map((metric) => ({
      metricCode: metric.metricCode,
      targetValue: metric.targetValue,
      unit: metric.unit,
    })),
    [{ metricCode: "TIKTOK_DIAMOND", targetValue: 1000, unit: "COUNT" }],
  );
  assert.equal(published.status, "PUBLISHED");
  assert.equal(published.targetMetrics[0]?.metricCode, "TIKTOK_DIAMOND");
});

test("KPI V2 creates ORG_UNIT draft plans for active supported Org Unit types", async () => {
  const { service } = createHarness();

  const cases = [
    {
      subjectId: "org-department-active",
      expectedRef: {
        id: "org-department-active",
        code: "OU-DEP-001",
        name: "HR Department",
        displayName: "HR Department",
        status: "ACTIVE",
      },
    },
    {
      subjectId: "org-team-active",
      expectedRef: {
        id: "org-team-active",
        code: "OU-TEAM-001",
        name: "Ops Team",
        displayName: "Ops Team",
        status: "ACTIVE",
      },
    },
    {
      subjectId: "org-business-active",
      expectedRef: {
        id: "org-business-active",
        code: "OU-BU-001",
        name: "Business Unit",
        displayName: "Business Unit",
        status: "ACTIVE",
      },
    },
    {
      subjectId: "org-support-active",
      expectedRef: {
        id: "org-support-active",
        code: "OU-SUP-001",
        name: "Support Unit",
        displayName: "Support Unit",
        status: "ACTIVE",
      },
    },
  ] as const;

  for (const testCase of cases) {
    const result = await service.createKpiPlan(
      createActor(),
      orgUnitPlanCommand(testCase.subjectId),
    );

    assert.equal(result.status, "DRAFT");
    assert.equal(result.subjectType, "ORG_UNIT");
    assert.equal(result.subjectId, testCase.subjectId);
    assert.deepEqual(result.subjectRef, testCase.expectedRef);
    assert.equal(result.targetMetrics.length, 1);
    assert.equal(result.targetMetrics[0]?.metricCode, "REVENUE_VND");
    assert.equal(result.allocations.length, 0);
  }
});

test("KPI plan create requires exact structured subject authority", async () => {
  const clock = fixedClock();
  const allowedActor = createScopedActor({
    id: "org-kpi-admin",
    permissions: [Permission.KPI_CREATE_PLAN],
  });
  const deniedLegacyGlobalActor = createScopedActor({
    id: "legacy-global-kpi-admin",
    permissions: [Permission.KPI_CREATE_PLAN],
    kpiScopes: ["global"],
  });
  const deniedLegacyManagedActor = createScopedActor({
    id: "legacy-managed-kpi-admin",
    permissions: [Permission.KPI_CREATE_PLAN],
    kpiScopes: ["managedGroup"],
  });
  const noMatchingGrantActor = createScopedActor({
    id: "wrong-org-kpi-admin",
    permissions: [Permission.KPI_CREATE_PLAN],
  });
  const noRolePermissionActor = createScopedActor({
    id: "grant-without-permission-kpi-admin",
    permissions: [Permission.KPI_CREATE_PLAN],
  });
  const { service, repository } = createHarness(
    clock,
    createKpiStructuredAuthority(
      [
        kpiStructuredRecord({
          userId: "org-kpi-admin",
          permissions: [Permission.KPI_CREATE_PLAN],
          structuredScopeGrants: [
            { scopeType: "managedOrgUnit", targetId: "org-department-active" },
            { scopeType: "managedTalentGroup", targetId: "group-1" },
          ],
        }),
        kpiStructuredRecord({
          userId: "wrong-org-kpi-admin",
          permissions: [Permission.KPI_CREATE_PLAN],
          structuredScopeGrants: [
            { scopeType: "managedOrgUnit", targetId: "org-team-active" },
          ],
        }),
        kpiStructuredRecord({
          userId: "grant-without-permission-kpi-admin",
          permissions: [Permission.KPI_READ],
          structuredScopeGrants: [
            { scopeType: "managedOrgUnit", targetId: "org-department-active" },
          ],
        }),
      ],
      clock,
    ),
  );

  const orgPlan = await service.createKpiPlan(
    allowedActor,
    orgUnitPlanCommand("org-department-active"),
  );
  const groupPlan = await service.createKpiPlan(
    allowedActor,
    groupPlanCommand(),
  );

  assert.equal(orgPlan.subjectType, "ORG_UNIT");
  assert.equal(groupPlan.subjectType, "TALENT_GROUP");

  for (const actor of [deniedLegacyGlobalActor, deniedLegacyManagedActor]) {
    await assert.rejects(
      service.createKpiPlan(
        actor,
        orgUnitPlanCommand("org-department-active"),
      ),
      KpiPermissionScopeError,
    );
  }
  await assert.rejects(
    service.createKpiPlan(
      noMatchingGrantActor,
      orgUnitPlanCommand("org-department-active"),
    ),
    KpiPermissionScopeError,
  );
  await assert.rejects(
    service.createKpiPlan(
      noRolePermissionActor,
      orgUnitPlanCommand("org-department-active"),
    ),
    KpiPermissionScopeError,
  );
  assert.equal(repository.plans.length, 2);
});

test("KPI existing plan operations authorize from persisted subject", async () => {
  const clock = fixedClock();
  const exactActor = createScopedActor({
    id: "exact-org-editor",
    permissions: [
      Permission.KPI_READ,
      Permission.KPI_UPDATE_DRAFT,
      Permission.KPI_PUBLISH,
      Permission.KPI_ARCHIVE,
    ],
  });
  const wrongActor = createScopedActor({
    id: "wrong-org-editor",
    permissions: [
      Permission.KPI_READ,
      Permission.KPI_UPDATE_DRAFT,
      Permission.KPI_PUBLISH,
      Permission.KPI_ARCHIVE,
    ],
    kpiScopes: ["global"],
  });
  const { service } = createHarness(
    clock,
    createKpiStructuredAuthority(
      [
        kpiStructuredRecord({
          userId: "admin-1",
          permissions: ALL_KPI_ADMIN_PERMISSIONS,
        }),
        kpiStructuredRecord({
          userId: "exact-org-editor",
          permissions: [
            Permission.KPI_READ,
            Permission.KPI_UPDATE_DRAFT,
            Permission.KPI_PUBLISH,
            Permission.KPI_ARCHIVE,
          ],
          structuredScopeGrants: [
            { scopeType: "managedOrgUnit", targetId: "org-department-active" },
          ],
        }),
        kpiStructuredRecord({
          userId: "wrong-org-editor",
          permissions: [
            Permission.KPI_READ,
            Permission.KPI_UPDATE_DRAFT,
            Permission.KPI_PUBLISH,
            Permission.KPI_ARCHIVE,
          ],
          structuredScopeGrants: [
            { scopeType: "managedOrgUnit", targetId: "org-team-active" },
          ],
        }),
      ],
      clock,
    ),
  );
  const created = await service.createKpiPlan(
    createActor(),
    orgUnitPlanCommand("org-department-active"),
  );

  const detail = await service.getKpiPlanDetail(exactActor, {
    kpiPlanId: created.id,
  });
  const updated = await service.updateKpiDraftCore(exactActor, {
    kpiPlanId: created.id,
    title: "Persisted subject authorized",
  });

  assert.equal(detail.subjectId, "org-department-active");
  assert.equal(updated.title, "Persisted subject authorized");
  await assert.rejects(
    service.getKpiPlanDetail(wrongActor, {
      kpiPlanId: created.id,
    }),
    KpiPermissionScopeError,
  );
  await assert.rejects(
    service.archiveKpiPlan(wrongActor, { kpiPlanId: created.id }),
    KpiPermissionScopeError,
  );
});

test("KPI migrated actual and finalization paths deny legacy global without structured grant", async () => {
  const now = { value: MAY_5_2026_NOON_HCM };
  const { service } = createHarness(() => now.value);
  const published = await createPublishedGroupPlan(service);
  const allocation = published.allocations[0] as KpiAllocation;
  const legacyGlobalActor = createScopedActor({
    id: "legacy-global-all-kpi",
    permissions: ALL_KPI_ADMIN_PERMISSIONS,
    kpiScopes: ["global"],
  });

  await assert.rejects(
    service.getKpiPlanDetail(legacyGlobalActor, { kpiPlanId: published.id }),
    KpiPermissionScopeError,
  );
  await assert.rejects(
    service.createOrSetKpiActual(legacyGlobalActor, {
      kpiPlanId: published.id,
      allocationId: allocation.id,
      metricCode: "REVENUE_VND",
      actualDate: "2026-05-05",
      actualValue: 1,
    }),
    KpiPermissionScopeError,
  );

  now.value = JUNE_1_2026_NOON_HCM;
  await assert.rejects(
    service.finalizeKpiPlan(legacyGlobalActor, { kpiPlanId: published.id }),
    KpiPermissionScopeError,
  );
});

test("KPI V2 global list and detail return safe ORG_UNIT subjectRef without internals", async () => {
  const { service } = createHarness();
  const created = await service.createKpiPlan(
    createActor(),
    orgUnitPlanCommand("org-department-active"),
  );

  const list = await service.listKpiPlans(createActor(), {
    subjectType: "ORG_UNIT",
  });
  const detail = await service.getKpiPlanDetail(createActor(), {
    kpiPlanId: created.id,
  });
  const item = list.items.find((row) => row.id === created.id);

  assert.ok(item);
  assert.deepEqual(item.subjectRef, {
    id: "org-department-active",
    code: "OU-DEP-001",
    name: "HR Department",
    displayName: "HR Department",
    status: "ACTIVE",
  });
  assert.deepEqual(detail.subjectRef, item.subjectRef);
  const serialized = JSON.stringify({
    listSubjectRef: item.subjectRef,
    detailSubjectRef: detail.subjectRef,
  });
  for (const forbidden of [
    "parentOrgUnitId",
    "ancestorChain",
    "hierarchy",
    "externalRef",
    "managerEmploymentProfileIds",
    "memberEmploymentProfileIds",
    "description",
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("KPI V2 rejects create-time allocations", async () => {
  const { service } = createHarness();

  await assert.rejects(
    service.createKpiPlan(createActor(), {
      ...groupPlanCommand(),
      allocations: [],
    } as unknown as ReturnType<typeof groupPlanCommand>),
    /KPI create does not accept allocations/,
  );
});

test("KPI V2 rejects past periodMonth on create using HCM current month", async () => {
  const { service } = createHarness(() => JUNE_1_2026_NOON_HCM);

  await assert.rejects(
    service.createKpiPlan(createActor(), groupPlanCommand()),
    /KPI periodMonth 2026-05 is before the current Asia\/Ho_Chi_Minh month 2026-06/,
  );
});

test("KPI V2 accepts current periodMonth on create using HCM current month", async () => {
  const { service } = createHarness(() => JUNE_1_2026_NOON_HCM);

  const result = await service.createKpiPlan(createActor(), {
    ...groupPlanCommand(),
    periodMonth: "2026-06",
    periodStartAt: JUNE_2026_START_AT,
    periodEndAt: JUNE_2026_END_AT,
  });

  assert.equal(result.periodMonth, "2026-06");
});

test("KPI V2 rejects future-compatible subject types on create", async () => {
  const { service } = createHarness();

  await assert.rejects(
    service.createKpiPlan(createActor(), {
      ...groupPlanCommand(),
      subjectType: "EMPLOYMENT_PROFILE",
      subjectId: "employment-profile-1",
    }),
    KpiValidationError,
  );
});

test("KPI V2 rejects missing, inactive, and unsupported ORG_UNIT references", async () => {
  const { service } = createHarness();

  for (const subjectId of [
    "missing-org-unit",
    "org-inactive",
    "org-unsupported-type",
  ]) {
    await assert.rejects(
      service.createKpiPlan(createActor(), orgUnitPlanCommand(subjectId)),
      /KPI ORG_UNIT subject must reference an active supported Org Unit/,
    );
  }
});

test("KPI V2 ORG_UNIT metric allowlist permits REVENUE_VND and rejects talent-specific metrics", async () => {
  const { service } = createHarness();

  const created = await service.createKpiPlan(
    createActor(),
    orgUnitPlanCommand("org-team-active", [
      { metricCode: "REVENUE_VND", targetValue: 300 },
    ]),
  );

  assert.equal(created.targetMetrics[0]?.metricCode, "REVENUE_VND");
  for (const metricCode of [
    "CONTENT_OUTPUT_COUNT",
    "LIVE_HOURS",
    "EVENT_COMPLETION_COUNT",
    "ONBOARDED_TALENT_COUNT",
    "TIKTOK_DIAMOND",
  ]) {
    await assert.rejects(
      service.createKpiPlan(
        createActor(),
        orgUnitPlanCommand("org-team-active", [{ metricCode, targetValue: 1 }]),
      ),
      new RegExp(
        `KPI metric ${metricCode} is not allowed for subjectType ORG_UNIT`,
      ),
    );
  }

  await assert.rejects(
    service.replaceKpiTargetMetrics(createActor(), {
      kpiPlanId: created.id,
      targetMetrics: [{ metricCode: "TIKTOK_DIAMOND", targetValue: 1 }],
    }),
    /KPI metric TIKTOK_DIAMOND is not allowed for subjectType ORG_UNIT/,
  );
});

test("KPI V2 publish rejects forged ORG_UNIT draft with disallowed target metric", async () => {
  const { service, repository } = createHarness();
  const created = await service.createKpiPlan(
    createActor(),
    orgUnitPlanCommand("org-team-active", [
      { metricCode: "REVENUE_VND", targetValue: 300 },
    ]),
  );
  const targetIndex = repository.targets.findIndex(
    (target) => target.kpiPlanId === created.id,
  );
  assert.notEqual(targetIndex, -1);
  const originalTarget = repository.targets[targetIndex] as KpiTargetMetric;
  repository.targets[targetIndex] = {
    ...originalTarget,
    metricCode: "TIKTOK_DIAMOND",
    targetValue: 10,
  };

  await assert.rejects(
    service.publishKpiPlan(createActor(), { kpiPlanId: created.id }),
    /KPI metric TIKTOK_DIAMOND is not allowed for subjectType ORG_UNIT/,
  );

  const persisted = repository.plans.find((plan) => plan.id === created.id);
  assert.equal(persisted?.subjectId, "org-team-active");
  assert.equal(persisted?.status, "DRAFT");
  assert.equal(persisted?.publishedAt, null);
  assert.equal(persisted?.actualPolicySnapshot, null);
  assert.equal(
    repository.allocations.some(
      (allocation) => allocation.kpiPlanId === created.id,
    ),
    false,
  );
});

test("KPI V2 rejects ATTENDANCE_RATE and unknown metrics", async () => {
  const { service } = createHarness();

  await assert.rejects(
    service.createKpiPlan(createActor(), {
      ...groupPlanCommand(),
      targetMetrics: [{ metricCode: "ATTENDANCE_RATE", targetValue: 1 }],
    }),
    KpiValidationError,
  );
});

test("KPI V2 rejects negative and non-finite targets", async () => {
  const { service } = createHarness();

  await assert.rejects(
    service.createKpiPlan(createActor(), {
      ...groupPlanCommand(),
      targetMetrics: [{ metricCode: "REVENUE_VND", targetValue: -1 }],
    }),
    KpiValidationError,
  );
  await assert.rejects(
    service.createKpiPlan(createActor(), {
      ...groupPlanCommand(),
      targetMetrics: [{ metricCode: "REVENUE_VND", targetValue: Infinity }],
    }),
    KpiValidationError,
  );
});

test("KPI V2 rejects decimal REVENUE_VND plan target", async () => {
  const { service } = createHarness();

  await assert.rejects(
    service.createKpiPlan(createActor(), {
      ...groupPlanCommand(),
      targetMetrics: [{ metricCode: "REVENUE_VND", targetValue: 1.5 }],
    }),
    /REVENUE_VND requires an integer target value/,
  );
});

test("KPI V2 rejects decimal count plan target", async () => {
  const { service } = createHarness();

  await assert.rejects(
    service.createKpiPlan(createActor(), {
      ...groupPlanCommand(),
      targetMetrics: [{ metricCode: "CONTENT_OUTPUT_COUNT", targetValue: 1.5 }],
    }),
    /CONTENT_OUTPUT_COUNT requires an integer target value/,
  );
  await assert.rejects(
    service.createKpiPlan(createActor(), {
      ...groupPlanCommand(),
      targetMetrics: [{ metricCode: "TIKTOK_DIAMOND", targetValue: 1.5 }],
    }),
    /TIKTOK_DIAMOND requires an integer target value/,
  );
});

test("KPI V2 accepts LIVE_HOURS plan target with two decimals", async () => {
  const { service } = createHarness();

  const created = await service.createKpiPlan(createActor(), {
    ...groupPlanCommand(),
    targetMetrics: [{ metricCode: "LIVE_HOURS", targetValue: 1.25 }],
  });

  assert.equal(created.targetMetrics[0]?.targetValue, 1.25);
});

test("KPI V2 rejects LIVE_HOURS plan target with more than two decimals", async () => {
  const { service } = createHarness();

  await assert.rejects(
    service.createKpiPlan(createActor(), {
      ...groupPlanCommand(),
      targetMetrics: [{ metricCode: "LIVE_HOURS", targetValue: 1.234 }],
    }),
    /LIVE_HOURS supports at most 2 decimal places/,
  );
});

test("KPI V2 rejects numeric string plan target values", async () => {
  const { service } = createHarness();
  const formattedMoneyTarget = [
    { metricCode: "REVENUE_VND", targetValue: "1.000.000" },
  ] as unknown as ReturnType<typeof talentPlanCommand>["targetMetrics"];
  const numericStringTarget = [
    { metricCode: "REVENUE_VND", targetValue: "1000000" },
  ] as unknown as ReturnType<typeof talentPlanCommand>["targetMetrics"];

  await assert.rejects(
    service.createKpiPlan(createActor(), {
      ...groupPlanCommand(),
      targetMetrics: formattedMoneyTarget,
    }),
    /REVENUE_VND requires a finite non-negative numeric target value/,
  );
  await assert.rejects(
    service.createKpiPlan(createActor(), {
      ...groupPlanCommand(),
      targetMetrics: numericStringTarget,
    }),
    /REVENUE_VND requires a finite non-negative numeric target value/,
  );
});

test("KPI V2 rejects invalid non-monthly period window", async () => {
  const { service } = createHarness();

  await assert.rejects(
    service.createKpiPlan(createActor(), {
      ...groupPlanCommand(),
      periodEndAt: MAY_2026_END_AT - 1,
    }),
    KpiValidationError,
  );
});

test("KPI V2 update draft core works only in DRAFT", async () => {
  const { service } = createHarness();
  const created = await service.createKpiPlan(
    createActor(),
    groupPlanCommand(),
  );

  const updated = await service.updateKpiDraftCore(createActor(), {
    kpiPlanId: created.id,
    title: "Updated",
  });
  assert.equal(updated.title, "Updated");

  await service.publishKpiPlan(createActor(), { kpiPlanId: created.id });
  await assert.rejects(
    service.updateKpiDraftCore(createActor(), {
      kpiPlanId: created.id,
      title: "Late change",
    }),
    KpiStateError,
  );
});

test("KPI V2 target replacement works only in DRAFT", async () => {
  const { service } = createHarness();
  const created = await service.createKpiPlan(
    createActor(),
    groupPlanCommand(),
  );

  const replaced = await service.replaceKpiTargetMetrics(createActor(), {
    kpiPlanId: created.id,
    targetMetrics: [{ metricCode: "CONTENT_OUTPUT_COUNT", targetValue: 10 }],
  });
  assert.deepEqual(
    replaced.targetMetrics.map((metric) => metric.metricCode),
    ["CONTENT_OUTPUT_COUNT"],
  );

  await service.publishKpiPlan(createActor(), { kpiPlanId: created.id });
  await assert.rejects(
    service.replaceKpiTargetMetrics(createActor(), {
      kpiPlanId: created.id,
      targetMetrics: [{ metricCode: "LIVE_HOURS", targetValue: 4 }],
    }),
    KpiStateError,
  );
});

test("KPI V2 rejects decimal REVENUE_VND allocation target", async () => {
  const { service } = createHarness();
  const created = await service.createKpiPlan(
    createActor(),
    groupPlanCommand(),
  );

  await assert.rejects(
    service.replaceKpiAllocations(createActor(), {
      kpiPlanId: created.id,
      allocations: [
        {
          memberTalentId: "talent-1",
          allocationStartDate: "2026-05-01",
          targetMetrics: [{ metricCode: "REVENUE_VND", targetValue: 100.5 }],
        },
      ],
    }),
    /REVENUE_VND requires an integer target value/,
  );
});

test("KPI V2 rejects decimal count allocation target", async () => {
  const { service } = createHarness();
  const created = await service.createKpiPlan(
    createActor(),
    groupPlanCommand(),
  );

  await assert.rejects(
    service.replaceKpiAllocations(createActor(), {
      kpiPlanId: created.id,
      allocations: [
        {
          memberTalentId: "talent-1",
          allocationStartDate: "2026-05-01",
          targetMetrics: [
            { metricCode: "ONBOARDED_TALENT_COUNT", targetValue: 1.5 },
          ],
        },
      ],
    }),
    /ONBOARDED_TALENT_COUNT requires an integer target value/,
  );

  const diamondPlan = await service.createKpiPlan(createActor(), {
    ...groupPlanCommand(),
    targetMetrics: [{ metricCode: "TIKTOK_DIAMOND", targetValue: 10 }],
  });
  await assert.rejects(
    service.replaceKpiAllocations(createActor(), {
      kpiPlanId: diamondPlan.id,
      allocations: [
        {
          memberTalentId: "talent-1",
          allocationStartDate: "2026-05-01",
          targetMetrics: [{ metricCode: "TIKTOK_DIAMOND", targetValue: 1.5 }],
        },
      ],
    }),
    /TIKTOK_DIAMOND requires an integer target value/,
  );
});

test("KPI V2 rejects LIVE_HOURS allocation target with more than two decimals", async () => {
  const { service } = createHarness();
  const created = await service.createKpiPlan(createActor(), {
    ...groupPlanCommand(),
    targetMetrics: [{ metricCode: "LIVE_HOURS", targetValue: 1.25 }],
  });

  await assert.rejects(
    service.replaceKpiAllocations(createActor(), {
      kpiPlanId: created.id,
      allocations: [
        {
          memberTalentId: "talent-1",
          allocationStartDate: "2026-05-01",
          targetMetrics: [{ metricCode: "LIVE_HOURS", targetValue: 1.234 }],
        },
      ],
    }),
    /LIVE_HOURS supports at most 2 decimal places/,
  );
});

test("KPI V2 rejects duplicate member allocation rows in one plan", async () => {
  const { service } = createHarness();
  const created = await service.createKpiPlan(
    createActor(),
    groupPlanCommand(),
  );

  await assert.rejects(
    service.replaceKpiAllocations(createActor(), {
      kpiPlanId: created.id,
      allocations: [
        {
          memberTalentId: "talent-1",
          allocationStartDate: "2026-05-01",
          targetMetrics: [{ metricCode: "REVENUE_VND", targetValue: 100 }],
        },
        {
          memberTalentId: "talent-1",
          allocationStartDate: "2026-05-01",
          targetMetrics: [{ metricCode: "REVENUE_VND", targetValue: 200 }],
        },
      ],
    }),
    /KPI allocations duplicate memberTalentId talent-1/,
  );
});

test("KPI V2 group allocations are allowed only for TALENT_GROUP plans", async () => {
  const { service, repository } = createHarness();
  repository.plans.push(buildFutureSubjectDraftPlan("TALENT"));

  await assert.rejects(
    service.replaceKpiAllocations(createActor(), {
      kpiPlanId: "future-TALENT",
      allocations: [
        {
          memberTalentId: "talent-1",
          allocationStartDate: "2026-05-01",
          targetMetrics: [{ metricCode: "REVENUE_VND", targetValue: 1000 }],
        },
      ],
    }),
    KpiInvalidAllocationError,
  );
});

test("KPI V2 ORG_UNIT draft core, target replacement, and draft archive are planning-only", async () => {
  const { service } = createHarness();
  const created = await service.createKpiPlan(
    createActor(),
    orgUnitPlanCommand("org-department-active"),
  );

  const updated = await service.updateKpiDraftCore(createActor(), {
    kpiPlanId: created.id,
    title: "Updated org unit KPI",
    description: "Draft planning update",
  });
  const retargeted = await service.replaceKpiTargetMetrics(createActor(), {
    kpiPlanId: created.id,
    targetMetrics: [{ metricCode: "REVENUE_VND", targetValue: 450 }],
  });
  const archived = await service.archiveKpiPlan(createActor(), {
    kpiPlanId: created.id,
  });

  assert.equal(updated.title, "Updated org unit KPI");
  assert.equal(retargeted.targetMetrics[0]?.targetValue, 450);
  assert.equal(archived.status, "ARCHIVED");
  assert.equal(archived.subjectType, "ORG_UNIT");
});

test("KPI V2 ORG_UNIT official published allocations appear in Admin actual workspace", async () => {
  const { service, repository } = createHarness();
  const created = await service.createKpiPlan(
    createActor(),
    orgUnitPlanCommand("org-department-active"),
  );

  const published = await service.publishKpiPlan(createActor(), {
    kpiPlanId: created.id,
  });
  assert.equal(published.status, "PUBLISHED");
  assert.equal(published.subjectType, "ORG_UNIT");
  assert.equal(published.allocations.length, 0);
  assert.equal(
    repository.allocations.some(
      (allocation) => allocation.kpiPlanId === published.id,
    ),
    false,
  );

  const draftForAllocation = await service.createKpiPlan(
    createActor(),
    orgUnitPlanCommand("org-team-active"),
  );
  await assert.rejects(
    service.replaceKpiAllocations(createActor(), {
      kpiPlanId: draftForAllocation.id,
      allocations: [],
    }),
    /KPI allocations are allowed only for TALENT_GROUP plans/,
  );
  await assert.rejects(
    service.upsertKpiAllocationDraft(createBackofficeTeamManagerActor(), {
      kpiPlanId: published.id,
      allocations: [],
    }),
    KpiPermissionScopeError,
  );
  const emptyGrid = await service.getKpiActualDailyGrid(createActor(), {
    kpiPlanId: published.id,
    actualDate: "2026-05-01",
  });
  const emptyProgress = await service.getKpiProgress(createActor(), {
    kpiPlanId: published.id,
  });
  assert.equal(emptyGrid.subjectType, "ORG_UNIT");
  assert.deepEqual(emptyGrid.rows, []);
  assert.equal(emptyProgress.plan.subjectType, "ORG_UNIT");
  assert.deepEqual(emptyProgress.memberProgress, []);

  const forcedPublishedOrgUnit: KpiPlan = {
    ...(repository.plans.find((plan) => plan.id === published.id) as KpiPlan),
    id: "forced-published-org-unit",
    planCode: "KPI-FORCED-ORG",
    normalizedPlanCode: "kpi-forced-org",
    status: "PUBLISHED",
    actualPolicySnapshot: null,
    publishedAt: MAY_2026_START_AT,
    publishedByActorId: "seed",
  };
  repository.plans.push(forcedPublishedOrgUnit);

  const workspaceBeforeAllocation = await service.listKpiActualWorkspacePlans(
    createActor(),
    {},
  );
  assert.equal(
    workspaceBeforeAllocation.items.some(
      (item) => item.planId === forcedPublishedOrgUnit.id,
    ),
    false,
  );
  await assert.rejects(
    service.approveKpiAllocation(createActor(), {
      kpiPlanId: forcedPublishedOrgUnit.id,
    }),
    KpiStateError,
  );
  await assert.rejects(
    service.publishKpiAllocation(createActor(), {
      kpiPlanId: forcedPublishedOrgUnit.id,
    }),
    KpiInvalidAllocationError,
  );
  await assert.rejects(
    service.finalizeKpiPlan(createActor(), {
      kpiPlanId: forcedPublishedOrgUnit.id,
    }),
    KpiStateError,
  );

  await service.upsertKpiAllocationDraft(createActor(), {
    kpiPlanId: published.id,
    allocations: [
      {
        employmentProfileId: "org-profile-1",
        allocationStartDate: "2026-05-01",
        targetMetrics: [{ metricCode: "REVENUE_VND", targetValue: 300 }],
      },
    ],
  });
  await service.submitKpiAllocationDraft(createActor(), { kpiPlanId: published.id });
  await service.approveKpiAllocation(createActor(), { kpiPlanId: published.id });
  await service.publishKpiAllocation(createActor(), { kpiPlanId: published.id });
  const groupPlan = await createPublishedGroupPlan(service);

  const allWorkspace = await service.listKpiActualWorkspacePlans(createActor(), {});
  const orgOnlyWorkspace = await service.listKpiActualWorkspacePlans(createActor(), {
    subjectType: "ORG_UNIT",
  });
  const groupOnlyWorkspace = await service.listKpiActualWorkspacePlans(createActor(), {
    subjectType: "TALENT_GROUP",
  });
  const searchedWorkspace = await service.listKpiActualWorkspacePlans(createActor(), {
    search: "OU-DEP-001",
  });
  const orgDetail = await service.getKpiActualWorkspacePlanDetail(createActor(), {
    kpiPlanId: published.id,
  });

  assert.equal(
    allWorkspace.items.some((item) => item.planId === published.id),
    true,
  );
  assert.equal(
    allWorkspace.items.some((item) => item.planId === groupPlan.id),
    true,
  );
  assert.deepEqual(
    orgOnlyWorkspace.items.map((item) => item.subjectType),
    ["ORG_UNIT"],
  );
  assert.deepEqual(
    groupOnlyWorkspace.items.map((item) => item.subjectType),
    ["TALENT_GROUP"],
  );
  assert.deepEqual(
    searchedWorkspace.items.map((item) => item.planId),
    [published.id],
  );
  assert.equal(orgDetail.subjectType, "ORG_UNIT");
  assert.equal(orgDetail.members.length, 1);
  assert.equal(JSON.stringify(orgDetail).includes("memberTalentId"), false);
  assert.equal(JSON.stringify(orgDetail).includes("memberEmploymentProfileId"), false);
  const managerOrgWorkspace = await service.listKpiActualWorkspacePlans(
    createManagerActor(),
    {
      subjectType: "ORG_UNIT",
    },
  );
  assert.deepEqual(managerOrgWorkspace.items, []);
});

test("KPI ORG_UNIT actual/progress/correction uses EmploymentProfile identity without Talent", async () => {
  const now = { value: MAY_5_2026_NOON_HCM };
  const { service } = createHarness(() => now.value);
  const actor = createActor();
  const created = await service.createKpiPlan(actor, orgUnitPlanCommand());
  await service.publishKpiPlan(actor, { kpiPlanId: created.id });
  await service.upsertKpiAllocationDraft(actor, {
    kpiPlanId: created.id,
    allocations: [
      {
        employmentProfileId: "org-profile-1",
        allocationStartDate: "2026-05-01",
        targetMetrics: [{ metricCode: "REVENUE_VND", targetValue: 300 }],
      },
    ],
  });
  await service.submitKpiAllocationDraft(actor, { kpiPlanId: created.id });
  await service.approveKpiAllocation(actor, { kpiPlanId: created.id });
  const published = await service.publishKpiAllocation(actor, {
    kpiPlanId: created.id,
  });
  const allocation = published.allocations[0] as KpiAllocation;

  const createdActual = await service.createOrSetKpiActual(actor, {
    kpiPlanId: created.id,
    allocationId: allocation.id,
    metricCode: "REVENUE_VND",
    actualDate: "2026-05-05",
    actualValue: 80,
  });
  const grid = await service.getKpiActualDailyGrid(actor, {
    kpiPlanId: created.id,
    actualDate: "2026-05-05",
  });
  const progress = await service.getKpiProgress(actor, { kpiPlanId: created.id });

  assert.equal(createdActual.actualEntry.memberEmploymentProfileId, "org-profile-1");
  assert.equal(createdActual.actualEntry.memberTalentId, null);
  assert.equal(grid.rows[0]?.memberEmploymentProfileId, "org-profile-1");
  assert.equal(grid.rows[0]?.memberTalentId, null);
  assert.equal(grid.rows[0]?.memberDisplayName, "Org Profile 1");
  assert.equal(progress.memberProgress[0]?.memberEmploymentProfileId, "org-profile-1");
  assert.equal(progress.memberProgress[0]?.memberTalentId, null);
  assert.equal(progress.memberProgress[0]?.actualValue, 80);

  const updated = await service.updateKpiActualDirect(actor, {
    kpiPlanId: created.id,
    actualEntryId: createdActual.actualEntry.id,
    actualValue: 90,
  });
  assert.equal(updated.actualEntry.actualValue, 90);
  assert.equal(updated.actualEntry.effectiveValue, 90);

  now.value = MAY_5_2026_AFTER_LOCK_HCM;
  const corrected = await service.correctKpiActual(actor, {
    kpiPlanId: created.id,
    actualEntryId: createdActual.actualEntry.id,
    correctedValue: 110,
    reason: "post cutoff correction",
  });
  const history = await service.listKpiActualCorrections(actor, {
    kpiPlanId: created.id,
    actualEntryId: createdActual.actualEntry.id,
  });

  assert.equal(corrected.actualEntry.actualValue, 90);
  assert.equal(corrected.actualEntry.effectiveValue, 110);
  assert.equal(corrected.correction.memberEmploymentProfileId, "org-profile-1");
  assert.equal(corrected.correction.memberTalentId, null);
  assert.equal(history.items.length, 1);
  assert.equal(history.items[0]?.memberEmploymentProfileId, "org-profile-1");
});

test("KPI ORG_UNIT correction succeeds after zero update and cleared exceptions while active and finalized blockers remain", async () => {
  const now = { value: MAY_5_2026_NOON_HCM };
  const { service, repository } = createHarness(() => now.value);
  const actor = createActor();
  const created = await service.createKpiPlan(actor, orgUnitPlanCommand());
  await service.publishKpiPlan(actor, { kpiPlanId: created.id });
  await service.upsertKpiAllocationDraft(actor, {
    kpiPlanId: created.id,
    allocations: [
      {
        employmentProfileId: "org-profile-1",
        allocationStartDate: "2026-05-01",
        targetMetrics: [{ metricCode: "REVENUE_VND", targetValue: 300 }],
      },
    ],
  });
  await service.submitKpiAllocationDraft(actor, { kpiPlanId: created.id });
  await service.approveKpiAllocation(actor, { kpiPlanId: created.id });
  const published = await service.publishKpiAllocation(actor, {
    kpiPlanId: created.id,
  });
  const allocation = published.allocations[0] as KpiAllocation;

  const actual = await service.createOrSetKpiOrgUnitActual(actor, {
    kpiPlanId: created.id,
    allocationId: allocation.id,
    metricCode: "REVENUE_VND",
    actualDate: "2026-05-05",
    actualValue: 80,
  });
  const zero = await service.updateKpiOrgUnitActualDirect(actor, {
    kpiPlanId: created.id,
    actualEntryId: actual.actualEntry.id,
    actualValue: 0,
  });
  assert.equal(zero.actualEntry.actualValue, 0);
  assert.equal(zero.actualEntry.effectiveValue, 0);

  const excused = await service.markKpiOrgUnitActualExcuse(actor, {
    kpiPlanId: created.id,
    allocationId: allocation.id,
    metricCode: "REVENUE_VND",
    actualDate: "2026-05-06",
    status: "EXCUSED",
    reasonCode: "MEMBER_LEAVE",
    reasonText: "Approved leave",
  });
  const excusedId = repository.actualExcuses.find(
    (item) => item.kpiPlanId === excused.id && item.actualDate === "2026-05-06",
  )?.id;
  assert.ok(excusedId);
  await service.removeKpiOrgUnitActualExcuse(actor, {
    kpiPlanId: created.id,
    excuseId: excusedId,
  });

  const notRequired = await service.markKpiOrgUnitActualExcuse(actor, {
    kpiPlanId: created.id,
    allocationId: allocation.id,
    metricCode: "REVENUE_VND",
    actualDate: "2026-05-07",
    status: "NOT_REQUIRED",
    reasonCode: "NO_OPERATION_REQUIRED",
    reasonText: "No operation required",
  });
  const notRequiredId = repository.actualExcuses.find(
    (item) =>
      item.kpiPlanId === notRequired.id && item.actualDate === "2026-05-07",
  )?.id;
  assert.ok(notRequiredId);
  await service.removeKpiOrgUnitActualExcuse(actor, {
    kpiPlanId: created.id,
    excuseId: notRequiredId,
  });

  repository.actualExcuses.push({
    id: "stale-active-excuse-on-zero-actual",
    kpiPlanId: created.id,
    allocationId: allocation.id,
    metricCode: "REVENUE_VND",
    actualDate: "2026-05-05",
    status: "EXCUSED",
    reasonCode: "OTHER",
    reasonText: "Stale active blocker",
    createdAt: now.value,
    createdByActorId: actor.id,
    updatedAt: now.value,
    updatedByActorId: actor.id,
    deletedAt: null,
    deletedByActorId: null,
  });

  now.value = MAY_5_2026_AFTER_LOCK_HCM;
  await assert.rejects(
    service.correctKpiOrgUnitActual(actor, {
      kpiPlanId: created.id,
      actualEntryId: actual.actualEntry.id,
      correctedValue: 120,
      reason: "blocked while active exception exists",
    }),
    KpiConflictError,
  );
  await service.removeKpiOrgUnitActualExcuse(actor, {
    kpiPlanId: created.id,
    excuseId: "stale-active-excuse-on-zero-actual",
  });

  const corrected = await service.correctKpiOrgUnitActual(actor, {
    kpiPlanId: created.id,
    actualEntryId: actual.actualEntry.id,
    correctedValue: 120,
    reason: "eligible correction after cleared exceptions",
  });
  const history = await service.listKpiOrgUnitActualCorrections(actor, {
    kpiPlanId: created.id,
    actualEntryId: actual.actualEntry.id,
  });
  const exposedCorrection = KpiActualCorrectionExposure.expose(
    corrected.correction,
  );

  assert.equal(corrected.actualEntry.actualValue, 0);
  assert.equal(corrected.actualEntry.effectiveValue, 120);
  assert.equal(corrected.correction.memberEmploymentProfileId, "org-profile-1");
  assert.equal(history.items.length, 1);
  assert.equal("memberEmploymentProfileId" in exposedCorrection, false);

  now.value = JUNE_1_2026_NOON_HCM;
  await service.finalizeKpiPlan(actor, { kpiPlanId: created.id });
  await assert.rejects(
    service.correctKpiOrgUnitActual(actor, {
      kpiPlanId: created.id,
      actualEntryId: actual.actualEntry.id,
      correctedValue: 130,
      reason: "finalized blocker",
    }),
    KpiStateError,
  );
});

test("KPI V2 manager-scoped ORG_UNIT read shows only assigned published plans", async () => {
  const { service, orgUnitManagerRepository } = createHarness(
    () => MAY_5_2026_NOON_HCM,
  );
  const direct = await service.publishKpiPlan(createActor(), {
    kpiPlanId: (
      await service.createKpiPlan(
        createActor(),
        orgUnitPlanCommand("org-department-active"),
      )
    ).id,
  });
  const draft = await service.createKpiPlan(
    createActor(),
    orgUnitPlanCommand("org-department-active", [
      { metricCode: "REVENUE_VND", targetValue: 750 },
    ]),
  );
  const unrelated = await service.publishKpiPlan(createActor(), {
    kpiPlanId: (
      await service.createKpiPlan(
        createActor(),
        orgUnitPlanCommand("org-team-active"),
      )
    ).id,
  });
  orgUnitManagerRepository.assignments.push(
    orgUnitManagerAssignment({
      id: "org-unit-active-manager-assignment",
      orgUnitId: "org-department-active",
      role: "UNIT_MANAGER",
    }),
  );

  const list = await service.listKpiPlans(createManagerActor(), {
    subjectType: "ORG_UNIT",
  });
  const draftList = await service.listKpiPlans(createManagerActor(), {
    subjectType: "ORG_UNIT",
    status: "DRAFT",
  });
  const matchingSearch = await service.listKpiPlans(createManagerActor(), {
    subjectType: "ORG_UNIT",
    search: "OU-DEP-001",
  });
  const hiddenSearch = await service.listKpiPlans(createManagerActor(), {
    subjectType: "ORG_UNIT",
    search: "Ops Team",
  });
  const detail = await service.getKpiPlanDetail(createManagerActor(), {
    kpiPlanId: direct.id,
  });

  assert.deepEqual(
    list.items.map((item) => item.id),
    [direct.id],
  );
  assert.deepEqual(draftList.items, []);
  assert.deepEqual(
    matchingSearch.items.map((item) => item.id),
    [direct.id],
  );
  assert.deepEqual(hiddenSearch.items, []);
  assert.equal(detail.id, direct.id);
  assert.equal(detail.subjectType, "ORG_UNIT");
  assert.equal(detail.subjectRef?.displayName, "HR Department");
  assert.deepEqual(detail.allocations, []);
  await assert.rejects(
    service.getKpiPlanDetail(createManagerActor(), {
      kpiPlanId: draft.id,
    }),
    KpiPermissionScopeError,
  );
  await assert.rejects(
    service.getKpiPlanDetail(createManagerActor(), {
      kpiPlanId: unrelated.id,
    }),
    KpiPermissionScopeError,
  );
  await assert.rejects(
    service.listKpiPlans(createManagerActorWithoutKpiScope(), {
      subjectType: "ORG_UNIT",
    }),
    KpiPermissionScopeError,
  );
  const progress = await service.getKpiProgress(
    createBackofficeTeamManagerActor(),
    {
      kpiPlanId: direct.id,
    },
  );
  assert.equal(progress.plan.subjectType, "ORG_UNIT");
  assert.deepEqual(progress.memberProgress, []);
  await assert.rejects(
    service.getKpiActualWorkspacePlanDetail(createBackofficeTeamManagerActor(), {
      kpiPlanId: direct.id,
    }),
    KpiPermissionScopeError,
  );
  const grid = await service.getKpiActualDailyGrid(
    createBackofficeTeamManagerActor(),
    {
      kpiPlanId: direct.id,
      actualDate: "2026-05-05",
    },
  );
  assert.equal(grid.subjectType, "ORG_UNIT");
  assert.deepEqual(grid.rows, []);
});

test("KPI V2 manager-scoped ORG_UNIT descendants require includeDescendants", async () => {
  for (const role of [
    "DEPARTMENT_OWNER",
    "UNIT_MANAGER",
    "UNIT_OPERATOR",
  ] as const) {
    const { service, orgUnitManagerRepository } = createHarness(
      () => MAY_5_2026_NOON_HCM,
    );
    const descendant = await service.publishKpiPlan(createActor(), {
      kpiPlanId: (
        await service.createKpiPlan(
          createActor(),
          orgUnitPlanCommand("org-department-active"),
        )
      ).id,
    });
    orgUnitManagerRepository.assignments.push(
      orgUnitManagerAssignment({
        id: `${role}-no-descendants`,
        orgUnitId: "org-business-active",
        role,
        includeDescendants: false,
      }),
    );

    const hidden = await service.listKpiPlans(createManagerActor(), {
      subjectType: "ORG_UNIT",
    });
    assert.deepEqual(hidden.items, [], `${role} should not see descendants`);

    orgUnitManagerRepository.assignments.length = 0;
    orgUnitManagerRepository.assignments.push(
      orgUnitManagerAssignment({
        id: `${role}-with-descendants`,
        orgUnitId: "org-business-active",
        role,
        includeDescendants: true,
      }),
    );
    const visible = await service.listKpiPlans(createManagerActor(), {
      subjectType: "ORG_UNIT",
    });
    const detail = await service.getKpiPlanDetail(createManagerActor(), {
      kpiPlanId: descendant.id,
    });

    assert.deepEqual(
      visible.items.map((item) => item.id),
      [descendant.id],
      `${role} should see active descendants when explicitly included`,
    );
    assert.equal(detail.id, descendant.id);
    assert.equal(detail.subjectRef?.displayName, "HR Department");
  }
});

test("KPI ORG_UNIT allocations stay out of default TalentGroup DTO paths", async () => {
  const { service } = createHarness(() => MAY_5_2026_NOON_HCM);
  const actor = createActor();
  const created = await service.createKpiPlan(actor, orgUnitPlanCommand());
  await service.publishKpiPlan(actor, { kpiPlanId: created.id });
  await service.upsertKpiAllocationDraft(actor, {
    kpiPlanId: created.id,
    allocations: [
      {
        employmentProfileId: "org-profile-1",
        allocationStartDate: "2026-05-01",
        targetMetrics: [{ metricCode: "REVENUE_VND", targetValue: 300 }],
      },
    ],
  });

  const defaultList = await service.listKpiAllocations(actor, {
    kpiPlanId: created.id,
  });
  const detail = await service.getKpiPlanDetail(actor, {
    kpiPlanId: created.id,
  });
  const exposedDetail = KpiPlanDetailExposure.expose(detail);
  const explicitOrgList = await service.listKpiOrgUnitAllocations(actor, {
    kpiPlanId: created.id,
  });
  const exposedOrgList = KpiOrgUnitAllocationExposure.exposeMany(
    explicitOrgList.items,
  );

  assert.deepEqual(defaultList.items, []);
  assert.equal(detail.allocations.length, 1);
  assert.deepEqual(exposedDetail.allocations, []);
  assert.equal(
    explicitOrgList.items[0]?.memberEmploymentProfileId,
    "org-profile-1",
  );
  assert.equal(explicitOrgList.items[0]?.memberTalentId, null);
  assert.equal(explicitOrgList.items[0]?.groupId, null);
  assert.equal(exposedOrgList[0]?.memberEmploymentProfileId, "org-profile-1");
  assert.equal("subjectType" in (exposedOrgList[0] ?? {}), false);
  assert.equal("subjectId" in (exposedOrgList[0] ?? {}), false);
});

test("KPI global admin can run ORG_UNIT allocation lifecycle with EmploymentProfile identity", async () => {
  const { service, repository } = createHarness(() => MAY_5_2026_NOON_HCM);
  const actor = createActor();
  const created = await service.createKpiPlan(actor, orgUnitPlanCommand());
  await service.publishKpiPlan(actor, { kpiPlanId: created.id });

  const draft = await service.upsertKpiAllocationDraft(actor, {
    kpiPlanId: created.id,
    allocations: [
      {
        employmentProfileId: "org-profile-1",
        allocationStartDate: "2026-05-01",
        targetMetrics: [{ metricCode: "REVENUE_VND", targetValue: 300 }],
        note: "Direct org member",
      },
    ],
  });
  assert.equal(draft.allocations[0]?.allocationStatus, "DRAFT");
  assert.equal(draft.allocations[0]?.subjectType, "ORG_UNIT");
  assert.equal(draft.allocations[0]?.subjectId, "org-department-active");
  assert.equal(
    draft.allocations[0]?.memberEmploymentProfileId,
    "org-profile-1",
  );
  assert.equal(draft.allocations[0]?.memberTalentId, null);

  const submitted = await service.submitKpiAllocationDraft(actor, {
    kpiPlanId: created.id,
  });
  assert.equal(submitted.allocations[0]?.allocationStatus, "PENDING_APPROVAL");

  const rejected = await service.rejectKpiAllocation(actor, {
    kpiPlanId: created.id,
    rejectionReason: "Revise",
  });
  assert.equal(rejected.allocations[0]?.allocationStatus, "REJECTED");

  for (let index = 0; index < repository.allocations.length; index += 1) {
    const allocation = repository.allocations[index] as KpiAllocation;
    if (allocation.kpiPlanId === created.id) {
      repository.allocations[index] = {
        ...allocation,
        allocationStatus: "PENDING_APPROVAL",
      };
    }
  }
  const approved = await service.approveKpiAllocation(actor, {
    kpiPlanId: created.id,
  });
  assert.equal(approved.allocations[0]?.allocationStatus, "APPROVED");

  const published = await service.publishKpiAllocation(actor, {
    kpiPlanId: created.id,
  });
  const stored = repository.allocations.find(
    (allocation) => allocation.kpiPlanId === created.id,
  );
  assert.equal(published.allocations[0]?.allocationStatus, "PUBLISHED");
  assert.equal(stored?.subjectType, "ORG_UNIT");
  assert.equal(stored?.subjectId, "org-department-active");
  assert.equal(stored?.memberEmploymentProfileId, "org-profile-1");
  assert.equal(stored?.memberTalentId, null);
  assert.equal(stored?.groupId, null);
});

test("KPI ORG_UNIT allocation validates direct EmploymentProfile eligibility and metrics", async () => {
  const { service } = createHarness(() => MAY_5_2026_NOON_HCM);
  const actor = createActor();
  const created = await service.createKpiPlan(actor, orgUnitPlanCommand());
  await service.publishKpiPlan(actor, { kpiPlanId: created.id });

  const members = await service.listKpiOrgUnitManagedMembers(actor, {
    kpiPlanId: created.id,
    limit: 20,
  });
  assert.deepEqual(
    members.items.map((item) => item.employmentProfileId),
    ["org-profile-1", "org-profile-on-leave"],
  );
  assert.ok(members.items.every((item) => !("talentId" in item)));

  for (const employmentProfileId of [
    "org-profile-inactive",
    "org-profile-descendant",
    "unknown-profile",
  ]) {
    await assert.rejects(
      service.upsertKpiAllocationDraft(actor, {
        kpiPlanId: created.id,
        allocations: [
          {
            employmentProfileId,
            allocationStartDate: "2026-05-01",
            targetMetrics: [{ metricCode: "REVENUE_VND", targetValue: 300 }],
          },
        ],
      }),
      KpiInvalidAllocationError,
    );
  }
  await assert.rejects(
    service.upsertKpiAllocationDraft(actor, {
      kpiPlanId: created.id,
      allocations: [
        {
          employmentProfileId: "org-profile-1",
          allocationStartDate: "2026-05-01",
          targetMetrics: [{ metricCode: "LIVE_HOURS", targetValue: 300 }],
        },
      ],
    }),
    KpiInvalidAllocationError,
  );
});

test("KPI ORG_UNIT explicit query route contracts expose EmploymentProfile-safe DTOs", async () => {
  const { service } = createHarness(() => MAY_5_2026_NOON_HCM);
  const actor = createActor();
  const controller = new KpiAdminQueryController(service) as unknown as {
    handle(req: Request, actor: Actor, context: "ADMIN"): Promise<unknown>;
    present(
      result: unknown,
      req: Request,
      actor: Actor,
      context: "ADMIN",
    ): Promise<{ readonly data: unknown }>;
  };
  const created = await service.createKpiPlan(actor, orgUnitPlanCommand());
  await service.publishKpiPlan(actor, { kpiPlanId: created.id });
  await service.upsertKpiAllocationDraft(actor, {
    kpiPlanId: created.id,
    allocations: [
      {
        employmentProfileId: "org-profile-1",
        allocationStartDate: "2026-05-01",
        targetMetrics: [{ metricCode: "REVENUE_VND", targetValue: 300 }],
      },
    ],
  });
  await service.submitKpiAllocationDraft(actor, { kpiPlanId: created.id });
  await service.approveKpiAllocation(actor, { kpiPlanId: created.id });
  const published = await service.publishKpiAllocation(actor, {
    kpiPlanId: created.id,
  });
  const allocation = published.allocations[0] as KpiAllocation;
  await service.createOrSetKpiActual(actor, {
    kpiPlanId: created.id,
    allocationId: allocation.id,
    metricCode: "REVENUE_VND",
    actualDate: "2026-05-05",
    actualValue: 80,
  });

  const call = async (command: string, query: Record<string, unknown> = {}) => {
    const req = {
      query,
      params: { kpiPlanId: created.id },
    } as unknown as Request;
    bindCommand(req, command);
    const result = await controller.handle(req, actor, "ADMIN");
    return controller.present(result, req, actor, "ADMIN");
  };

  const allocationResponse = await call("KPI_PLAN_ORG_UNIT_ALLOCATION_LIST");
  const allocationItem = (
    allocationResponse.data as readonly Record<string, unknown>[]
  )[0];
  assert.equal(allocationItem?.memberEmploymentProfileId, "org-profile-1");
  assert.equal(allocationItem?.memberTalentId, null);
  assert.equal(allocationItem?.groupId, null);
  assert.equal("subjectType" in (allocationItem ?? {}), false);
  assert.equal("subjectId" in (allocationItem ?? {}), false);

  const memberResponse = await call("KPI_PLAN_ORG_UNIT_MANAGED_MEMBER_LIST");
  const memberItem = (
    memberResponse.data as readonly Record<string, unknown>[]
  )[0];
  assert.equal(memberItem?.employmentProfileId, "org-profile-1");
  assert.equal(memberItem?.displayName, "Org Profile 1");
  assert.equal("talentId" in (memberItem ?? {}), false);
  const orgMembers = await service.listKpiOrgUnitManagedMembers(actor, {
    kpiPlanId: created.id,
  });
  assert.deepEqual(
    KpiOrgUnitManagedMemberPickerExposure.exposeMany(orgMembers.items),
    memberResponse.data,
  );

  const progressResponse = await call("KPI_PLAN_ORG_UNIT_PROGRESS");
  const progress = progressResponse.data as {
    readonly memberProgress: readonly Record<string, unknown>[];
  };
  assert.equal(
    progress.memberProgress[0]?.memberEmploymentProfileId,
    "org-profile-1",
  );
  assert.equal(progress.memberProgress[0]?.memberTalentId, null);
  assert.deepEqual(
    KpiOrgUnitProgressExposure.expose(
      await service.getKpiOrgUnitProgress(actor, { kpiPlanId: created.id }),
    ),
    progressResponse.data,
  );

  const gridResponse = await call("KPI_PLAN_ORG_UNIT_ACTUAL_DAILY_GRID", {
    actualDate: "2026-05-05",
  });
  const grid = gridResponse.data as {
    readonly rows: readonly Record<string, unknown>[];
  };
  assert.equal(grid.rows[0]?.memberEmploymentProfileId, "org-profile-1");
  assert.equal(grid.rows[0]?.memberTalentId, null);
  assert.deepEqual(
    KpiOrgUnitActualDailyGridExposure.expose(
      await service.getKpiOrgUnitActualDailyGrid(actor, {
        kpiPlanId: created.id,
        actualDate: "2026-05-05",
      }),
    ),
    gridResponse.data,
  );

  await assert.rejects(
    call("KPI_PLAN_ORG_UNIT_ALLOCATION_LIST", { unexpected: "x" }),
    KpiValidationError,
  );
  const groupPlan = await createPublishedGroupPlan(service);
  const groupReq = {
    query: {},
    params: { kpiPlanId: groupPlan.id },
  } as unknown as Request;
  bindCommand(groupReq, "KPI_PLAN_ORG_UNIT_PROGRESS");
  await assert.rejects(
    controller.handle(groupReq, actor, "ADMIN"),
    KpiPermissionScopeError,
  );
});

test("KPI ORG_UNIT explicit mutation route contract returns profile identity without broadening correction DTO", async () => {
  const now = { value: MAY_5_2026_NOON_HCM };
  const { service } = createHarness(() => now.value);
  const actor = createActor();
  const controller = new KpiAdminController(service) as unknown as {
    handle(req: Request, actor: Actor, context: "ADMIN"): Promise<unknown>;
    present(
      result: unknown,
      req: Request,
      actor: Actor,
      context: "ADMIN",
    ): Promise<{ readonly data: unknown }>;
  };
  const created = await service.createKpiPlan(actor, orgUnitPlanCommand());
  await service.publishKpiPlan(actor, { kpiPlanId: created.id });
  await service.upsertKpiAllocationDraft(actor, {
    kpiPlanId: created.id,
    allocations: [
      {
        employmentProfileId: "org-profile-1",
        allocationStartDate: "2026-05-01",
        targetMetrics: [{ metricCode: "REVENUE_VND", targetValue: 300 }],
      },
    ],
  });
  await service.submitKpiAllocationDraft(actor, { kpiPlanId: created.id });
  await service.approveKpiAllocation(actor, { kpiPlanId: created.id });
  const published = await service.publishKpiAllocation(actor, {
    kpiPlanId: created.id,
  });
  const allocation = published.allocations[0] as KpiAllocation;

  const createReq = {
    body: {
      allocationId: allocation.id,
      metricCode: "REVENUE_VND",
      actualDate: "2026-05-05",
      actualValue: 80,
    },
    params: { kpiPlanId: created.id },
  } as unknown as Request;
  bindCommand(createReq, "KPI_ORG_UNIT_ACTUAL_CREATE");
  const createdResponse = await controller.present(
    await controller.handle(createReq, actor, "ADMIN"),
    createReq,
    actor,
    "ADMIN",
  );
  const actual = createdResponse.data as Record<string, unknown>;
  assert.equal(actual.memberEmploymentProfileId, "org-profile-1");
  assert.equal(actual.memberTalentId, null);

  const updateReq = {
    body: { actualValue: 90 },
    params: { kpiPlanId: created.id, actualEntryId: actual.id },
  } as unknown as Request;
  bindCommand(updateReq, "KPI_ORG_UNIT_ACTUAL_UPDATE");
  const updateResponse = await controller.present(
    await controller.handle(updateReq, actor, "ADMIN"),
    updateReq,
    actor,
    "ADMIN",
  );
  assert.equal(
    (updateResponse.data as Record<string, unknown>).memberEmploymentProfileId,
    "org-profile-1",
  );

  now.value = MAY_5_2026_AFTER_LOCK_HCM;
  const correctionReq = {
    body: { correctedValue: 110, reason: "post cutoff correction" },
    params: { kpiPlanId: created.id, actualEntryId: actual.id },
  } as unknown as Request;
  bindCommand(correctionReq, "KPI_ORG_UNIT_ACTUAL_CORRECT");
  const correctionResponse = await controller.present(
    await controller.handle(correctionReq, actor, "ADMIN"),
    correctionReq,
    actor,
    "ADMIN",
  );
  const correctionPayload = correctionResponse.data as {
    readonly actualEntry: Record<string, unknown>;
    readonly correction: Record<string, unknown>;
  };
  assert.equal(
    correctionPayload.actualEntry.memberEmploymentProfileId,
    "org-profile-1",
  );
  assert.equal("memberEmploymentProfileId" in correctionPayload.correction, false);

  const groupPlan = await createPublishedGroupPlan(service);
  const groupReq = {
    body: {
      allocationId: "not-used",
      metricCode: "REVENUE_VND",
      actualDate: "2026-05-05",
      actualValue: 1,
    },
    params: { kpiPlanId: groupPlan.id },
  } as unknown as Request;
  bindCommand(groupReq, "KPI_ORG_UNIT_ACTUAL_CREATE");
  await assert.rejects(
    controller.handle(groupReq, actor, "ADMIN"),
    KpiPermissionScopeError,
  );
});

test("KPI ORG_UNIT explicit excuse and correction-history route contracts stay ORG_UNIT-scoped", async () => {
  const now = { value: MAY_5_2026_NOON_HCM };
  const { service, repository } = createHarness(() => now.value);
  const actor = createActor();
  const mutationController = new KpiAdminController(service) as unknown as {
    handle(req: Request, actor: Actor, context: "ADMIN"): Promise<unknown>;
    present(
      result: unknown,
      req: Request,
      actor: Actor,
      context: "ADMIN",
    ): Promise<{ readonly data: unknown }>;
  };
  const queryController = new KpiAdminQueryController(service) as unknown as {
    handle(req: Request, actor: Actor, context: "ADMIN"): Promise<unknown>;
    present(
      result: unknown,
      req: Request,
      actor: Actor,
      context: "ADMIN",
    ): Promise<{ readonly data: unknown }>;
  };

  const created = await service.createKpiPlan(actor, orgUnitPlanCommand());
  await service.publishKpiPlan(actor, { kpiPlanId: created.id });
  await service.upsertKpiAllocationDraft(actor, {
    kpiPlanId: created.id,
    allocations: [
      {
        employmentProfileId: "org-profile-1",
        allocationStartDate: "2026-05-01",
        targetMetrics: [{ metricCode: "REVENUE_VND", targetValue: 300 }],
      },
    ],
  });
  await service.submitKpiAllocationDraft(actor, { kpiPlanId: created.id });
  await service.approveKpiAllocation(actor, { kpiPlanId: created.id });
  const published = await service.publishKpiAllocation(actor, {
    kpiPlanId: created.id,
  });
  const allocation = published.allocations[0] as KpiAllocation;
  assert.equal(allocation.memberEmploymentProfileId, "org-profile-1");
  assert.equal(allocation.memberTalentId, null);

  const markReq = {
    body: {
      allocationId: allocation.id,
      metricCode: "REVENUE_VND",
      actualDate: "2026-05-05",
      status: "EXCUSED",
      reasonCode: "OTHER",
      reasonText: "Blocked by approved operating exception",
    },
    params: { kpiPlanId: created.id },
  } as unknown as Request;
  bindCommand(markReq, "KPI_ORG_UNIT_ACTUAL_EXCUSE_MARK");
  const markResponse = await mutationController.present(
    await mutationController.handle(markReq, actor, "ADMIN"),
    markReq,
    actor,
    "ADMIN",
  );
  const markedPlan = markResponse.data as {
    readonly subjectType: string;
    readonly allocations: readonly unknown[];
  };
  assert.equal(markedPlan.subjectType, "ORG_UNIT");
  assert.deepEqual(markedPlan.allocations, []);
  const markedExcuse = repository.actualExcuses[0];
  assert.ok(markedExcuse);
  assert.equal(markedExcuse.kpiPlanId, created.id);
  assert.equal(markedExcuse.allocationId, allocation.id);

  const excusedGrid = await service.getKpiOrgUnitActualDailyGrid(actor, {
    kpiPlanId: created.id,
    actualDate: "2026-05-05",
  });
  assert.equal(excusedGrid.rows[0]?.memberEmploymentProfileId, "org-profile-1");
  assert.equal(
    excusedGrid.rows[0]?.metrics[0]?.actualExcuse?.id,
    markedExcuse.id,
  );

  const removeReq = {
    body: {},
    params: { kpiPlanId: created.id, excuseId: markedExcuse.id },
  } as unknown as Request;
  bindCommand(removeReq, "KPI_ORG_UNIT_ACTUAL_EXCUSE_REMOVE");
  const removeResponse = await mutationController.present(
    await mutationController.handle(removeReq, actor, "ADMIN"),
    removeReq,
    actor,
    "ADMIN",
  );
  assert.equal(
    (removeResponse.data as Record<string, unknown>).subjectType,
    "ORG_UNIT",
  );
  assert.ok(repository.actualExcuses[0]?.deletedAt);

  const createdActual = await service.createOrSetKpiOrgUnitActual(actor, {
    kpiPlanId: created.id,
    allocationId: allocation.id,
    metricCode: "REVENUE_VND",
    actualDate: "2026-05-05",
    actualValue: 90,
  });
  now.value = MAY_5_2026_AFTER_LOCK_HCM;
  await service.correctKpiOrgUnitActual(actor, {
    kpiPlanId: created.id,
    actualEntryId: createdActual.actualEntry.id,
    correctedValue: 110,
    reason: "post cutoff correction",
  });

  const historyReq = {
    query: {},
    params: {
      kpiPlanId: created.id,
      actualEntryId: createdActual.actualEntry.id,
    },
  } as unknown as Request;
  bindCommand(historyReq, "KPI_ORG_UNIT_ACTUAL_CORRECTION_LIST");
  const historyResponse = await queryController.present(
    await queryController.handle(historyReq, actor, "ADMIN"),
    historyReq,
    actor,
    "ADMIN",
  );
  const history = historyResponse.data as readonly Record<string, unknown>[];
  assert.equal(history.length, 1);
  assert.equal(history[0]?.actualEntryId, createdActual.actualEntry.id);
  assert.equal("memberEmploymentProfileId" in (history[0] ?? {}), false);
  assert.equal("memberTalentId" in (history[0] ?? {}), false);
  assert.equal("correctedByActorId" in (history[0] ?? {}), false);

  const finalizedExcuse = await service.markKpiOrgUnitActualExcuse(actor, {
    kpiPlanId: created.id,
    allocationId: allocation.id,
    metricCode: "REVENUE_VND",
    actualDate: "2026-05-06",
    status: "NOT_REQUIRED",
    reasonCode: "NO_OPERATION_REQUIRED",
    reasonText: "No operation required",
  });
  const activeExcuse = repository.actualExcuses.find(
    (excuse) =>
      excuse.kpiPlanId === finalizedExcuse.id && excuse.deletedAt === null,
  );
  assert.ok(activeExcuse);
  const groupPlan = await createPublishedGroupPlan(service);
  now.value = JUNE_1_2026_NOON_HCM;
  await service.finalizeKpiPlan(actor, { kpiPlanId: created.id });
  const finalizedRemoveReq = {
    body: {},
    params: { kpiPlanId: created.id, excuseId: activeExcuse.id },
  } as unknown as Request;
  bindCommand(finalizedRemoveReq, "KPI_ORG_UNIT_ACTUAL_EXCUSE_REMOVE");
  await assert.rejects(
    mutationController.handle(finalizedRemoveReq, actor, "ADMIN"),
    KpiStateError,
  );

  const groupMarkReq = {
    body: {
      allocationId: "not-used",
      metricCode: "REVENUE_VND",
      actualDate: "2026-05-05",
      status: "EXCUSED",
      reasonCode: "OTHER",
      reasonText: "not used",
    },
    params: { kpiPlanId: groupPlan.id },
  } as unknown as Request;
  bindCommand(groupMarkReq, "KPI_ORG_UNIT_ACTUAL_EXCUSE_MARK");
  await assert.rejects(
    mutationController.handle(groupMarkReq, actor, "ADMIN"),
    KpiPermissionScopeError,
  );

  const groupRemoveReq = {
    body: {},
    params: { kpiPlanId: groupPlan.id, excuseId: "not-used" },
  } as unknown as Request;
  bindCommand(groupRemoveReq, "KPI_ORG_UNIT_ACTUAL_EXCUSE_REMOVE");
  await assert.rejects(
    mutationController.handle(groupRemoveReq, actor, "ADMIN"),
    KpiPermissionScopeError,
  );

  const groupHistoryReq = {
    query: {},
    params: { kpiPlanId: groupPlan.id, actualEntryId: "not-used" },
  } as unknown as Request;
  bindCommand(groupHistoryReq, "KPI_ORG_UNIT_ACTUAL_CORRECTION_LIST");
  await assert.rejects(
    queryController.handle(groupHistoryReq, actor, "ADMIN"),
    KpiPermissionScopeError,
  );
});

test("KPI UNIT_MANAGER direct assignment can draft ORG_UNIT allocation while broader roles cannot", async () => {
  const { service, orgUnitManagerRepository } = createHarness(
    () => MAY_5_2026_NOON_HCM,
  );
  const actor = createActor();
  const managerActor = createBackofficeTeamManagerActor();
  const created = await service.createKpiPlan(actor, orgUnitPlanCommand());
  await service.publishKpiPlan(actor, { kpiPlanId: created.id });

  orgUnitManagerRepository.assignments.push(
    orgUnitManagerAssignment({
      orgUnitId: "org-department-active",
      role: "UNIT_MANAGER",
      includeDescendants: false,
      actionMask: ["ALLOCATE"],
    }),
  );
  const draft = await service.upsertKpiAllocationDraft(managerActor, {
    kpiPlanId: created.id,
    allocations: [
      {
        employmentProfileId: "org-profile-1",
        allocationStartDate: "2026-05-01",
        targetMetrics: [{ metricCode: "REVENUE_VND", targetValue: 300 }],
      },
    ],
  });
  assert.equal(draft.allocations[0]?.createdByActorId, "manager-user");
  await service.submitKpiAllocationDraft(managerActor, { kpiPlanId: created.id });

  for (const role of ["DEPARTMENT_OWNER", "UNIT_OPERATOR"] as const) {
    orgUnitManagerRepository.assignments.length = 0;
    orgUnitManagerRepository.assignments.push(
      orgUnitManagerAssignment({
        orgUnitId: "org-department-active",
        role,
        includeDescendants: true,
        actionMask: ["ALLOCATE"],
      }),
    );
    await assert.rejects(
      service.upsertKpiAllocationDraft(managerActor, {
        kpiPlanId: created.id,
        allocations: [
          {
            employmentProfileId: "org-profile-1",
            allocationStartDate: "2026-05-01",
            targetMetrics: [{ metricCode: "REVENUE_VND", targetValue: 300 }],
          },
        ],
      }),
      KpiPermissionScopeError,
    );
  }
});

test("KPI managed ORG_UNIT picker excludes current manager and draft rejects self allocation", async () => {
  const { service, subjectAccess, orgUnitManagerRepository } = createHarness(
    () => MAY_5_2026_NOON_HCM,
  );
  const actor = createActor();
  const managerActor = createBackofficeTeamManagerActor();
  const created = await service.createKpiPlan(actor, orgUnitPlanCommand());
  await service.publishKpiPlan(actor, { kpiPlanId: created.id });
  subjectAccess.orgUnitProfiles.set("manager-profile-1", {
    employmentProfileId: "manager-profile-1",
    employeeCode: "EP-MGR-001",
    displayName: "Manager Profile",
    orgUnitId: "org-department-active",
    employmentStatus: "ACTIVE",
  });
  orgUnitManagerRepository.assignments.push(
    orgUnitManagerAssignment({
      orgUnitId: "org-department-active",
      role: "UNIT_MANAGER",
    }),
  );

  const members = await service.listKpiOrgUnitManagedMembers(managerActor, {
    kpiPlanId: created.id,
    limit: 20,
  });
  assert.deepEqual(
    members.items.map((item) => item.employmentProfileId),
    ["org-profile-1", "org-profile-on-leave"],
  );

  await assert.rejects(
    service.upsertKpiAllocationDraft(managerActor, {
      kpiPlanId: created.id,
      allocations: [
        {
          employmentProfileId: "manager-profile-1",
          allocationStartDate: "2026-05-01",
          targetMetrics: [{ metricCode: "REVENUE_VND", targetValue: 300 }],
        },
      ],
    }),
    KpiInvalidAllocationError,
  );

  const draft = await service.upsertKpiAllocationDraft(managerActor, {
    kpiPlanId: created.id,
    allocations: [
      {
        employmentProfileId: "org-profile-1",
        allocationStartDate: "2026-05-01",
        targetMetrics: [{ metricCode: "REVENUE_VND", targetValue: 300 }],
      },
    ],
  });
  assert.equal(draft.allocations[0]?.memberEmploymentProfileId, "org-profile-1");
});

test("KPI managed ORG_UNIT submit rejects stored self draft while global path remains unchanged", async () => {
  const { service, subjectAccess, orgUnitManagerRepository } = createHarness(
    () => MAY_5_2026_NOON_HCM,
  );
  const actor = createActor();
  const managerActor = createBackofficeTeamManagerActor();
  const created = await service.createKpiPlan(actor, orgUnitPlanCommand());
  await service.publishKpiPlan(actor, { kpiPlanId: created.id });
  subjectAccess.orgUnitProfiles.set("manager-profile-1", {
    employmentProfileId: "manager-profile-1",
    employeeCode: "EP-MGR-001",
    displayName: "Manager Profile",
    orgUnitId: "org-department-active",
    employmentStatus: "ACTIVE",
  });
  orgUnitManagerRepository.assignments.push(
    orgUnitManagerAssignment({
      orgUnitId: "org-department-active",
      role: "UNIT_MANAGER",
    }),
  );

  const draft = await service.upsertKpiAllocationDraft(actor, {
    kpiPlanId: created.id,
    allocations: [
      {
        employmentProfileId: "manager-profile-1",
        allocationStartDate: "2026-05-01",
        targetMetrics: [{ metricCode: "REVENUE_VND", targetValue: 300 }],
      },
    ],
  });
  assert.equal(draft.allocations[0]?.memberEmploymentProfileId, "manager-profile-1");

  await assert.rejects(
    service.submitKpiAllocationDraft(managerActor, { kpiPlanId: created.id }),
    KpiInvalidAllocationError,
  );

  const submitted = await service.submitKpiAllocationDraft(actor, {
    kpiPlanId: created.id,
  });
  assert.equal(submitted.allocations[0]?.allocationStatus, "PENDING_APPROVAL");
});

test("KPI UNIT_MANAGER ORG_UNIT allocation write requires exact direct active assignment", async () => {
  const denialCases = [
    {
      name: "exact assignment with includeDescendants",
      planOrgUnitId: "org-department-active",
      assignment: orgUnitManagerAssignment({
        id: "unit-manager-exact-descendants-denial",
        orgUnitId: "org-department-active",
        role: "UNIT_MANAGER",
        includeDescendants: true,
        actionMask: ["ALLOCATE"],
      }),
    },
    {
      name: "descendant with includeDescendants",
      planOrgUnitId: "org-department-active",
      assignment: orgUnitManagerAssignment({
        id: "unit-manager-descendant-denial",
        orgUnitId: "org-business-active",
        role: "UNIT_MANAGER",
        includeDescendants: true,
        actionMask: ["ALLOCATE"],
      }),
    },
    {
      name: "unrelated org unit",
      planOrgUnitId: "org-team-active",
      assignment: orgUnitManagerAssignment({
        id: "unit-manager-unrelated-denial",
        orgUnitId: "org-department-active",
        role: "UNIT_MANAGER",
        actionMask: ["ALLOCATE"],
      }),
    },
    {
      name: "inactive assignment",
      planOrgUnitId: "org-department-active",
      assignment: orgUnitManagerAssignment({
        id: "unit-manager-inactive-denial",
        orgUnitId: "org-department-active",
        role: "UNIT_MANAGER",
        status: "INACTIVE",
      }),
    },
    {
      name: "expired assignment",
      planOrgUnitId: "org-department-active",
      assignment: orgUnitManagerAssignment({
        id: "unit-manager-expired-denial",
        orgUnitId: "org-department-active",
        role: "UNIT_MANAGER",
        effectiveTo: MAY_5_2026_START_HCM,
      }),
    },
    {
      name: "future-effective assignment",
      planOrgUnitId: "org-department-active",
      assignment: orgUnitManagerAssignment({
        id: "unit-manager-future-denial",
        orgUnitId: "org-department-active",
        role: "UNIT_MANAGER",
        effectiveFrom: JUNE_2026_START_AT,
      }),
    },
  ] as const;

  for (const testCase of denialCases) {
    const { service, repository, orgUnitManagerRepository } = createHarness(
      () => MAY_5_2026_NOON_HCM,
    );
    const created = await service.createKpiPlan(
      createActor(),
      orgUnitPlanCommand(testCase.planOrgUnitId),
    );
    await service.publishKpiPlan(createActor(), { kpiPlanId: created.id });
    orgUnitManagerRepository.assignments.push(testCase.assignment);

    await assert.rejects(
      service.upsertKpiAllocationDraft(createBackofficeTeamManagerActor(), {
        kpiPlanId: created.id,
        allocations: [
          {
            employmentProfileId:
              testCase.planOrgUnitId === "org-team-active"
                ? "org-profile-descendant"
                : "org-profile-1",
            allocationStartDate: "2026-05-01",
            targetMetrics: [{ metricCode: "REVENUE_VND", targetValue: 300 }],
          },
        ],
      }),
      KpiPermissionScopeError,
      testCase.name,
    );
    assert.equal(
      repository.allocations.some(
        (allocation) => allocation.kpiPlanId === created.id,
      ),
      false,
      testCase.name,
    );
  }
});

test("KPI ORG_UNIT allocation write denies missing managed scope or linked manager profile", async () => {
  const denialCases = [
    {
      name: "missing kpi.managedGroup",
      actor: createBackofficeTeamManagerActorWithoutKpiScope(),
    },
    {
      name: "missing linked active EmploymentProfile",
      actor: createScopedActor({
        id: "unlinked-manager-user",
        permissions: [
          Permission.KPI_READ,
          Permission.KPI_ENTER_ACTUAL,
          Permission.KPI_CORRECT_ACTUAL,
          Permission.KPI_READ_PROGRESS,
        ],
        kpiScopes: ["managedGroup"],
      }),
    },
  ] as const;

  for (const testCase of denialCases) {
    const { service, repository, orgUnitManagerRepository } = createHarness(
      () => MAY_5_2026_NOON_HCM,
    );
    const created = await service.createKpiPlan(
      createActor(),
      orgUnitPlanCommand(),
    );
    await service.publishKpiPlan(createActor(), { kpiPlanId: created.id });
    orgUnitManagerRepository.assignments.push(
      orgUnitManagerAssignment({
        orgUnitId: "org-department-active",
        role: "UNIT_MANAGER",
      }),
    );

    await assert.rejects(
      service.upsertKpiAllocationDraft(testCase.actor, {
        kpiPlanId: created.id,
        allocations: [
          {
            employmentProfileId: "org-profile-1",
            allocationStartDate: "2026-05-01",
            targetMetrics: [{ metricCode: "REVENUE_VND", targetValue: 300 }],
          },
        ],
      }),
      KpiPermissionScopeError,
      testCase.name,
    );
    assert.equal(
      repository.allocations.some(
        (allocation) => allocation.kpiPlanId === created.id,
      ),
      false,
      testCase.name,
    );
  }
});

test("KPI ORG_UNIT allocation draft rejects missing EmploymentProfile identity without side effects", async () => {
  const { service, repository, orgUnitManagerRepository } = createHarness(
    () => MAY_5_2026_NOON_HCM,
  );
  const created = await service.createKpiPlan(createActor(), orgUnitPlanCommand());
  await service.publishKpiPlan(createActor(), { kpiPlanId: created.id });
  orgUnitManagerRepository.assignments.push(
    orgUnitManagerAssignment({
      orgUnitId: "org-department-active",
      role: "UNIT_MANAGER",
    }),
  );

  await assert.rejects(
    service.upsertKpiAllocationDraft(createBackofficeTeamManagerActor(), {
      kpiPlanId: created.id,
      allocations: [
        {
          allocationStartDate: "2026-05-01",
          targetMetrics: [{ metricCode: "REVENUE_VND", targetValue: 300 }],
        } as never,
      ],
    }),
    KpiValidationError,
  );
  assert.equal(
    repository.allocations.some(
      (allocation) => allocation.kpiPlanId === created.id,
    ),
    false,
  );
});

test("KPI ORG_UNIT allocation draft upserts duplicate EmploymentProfile rows by replacement", async () => {
  const { service, repository } = createHarness(() => MAY_5_2026_NOON_HCM);
  const actor = createActor();
  const created = await service.createKpiPlan(actor, orgUnitPlanCommand());
  await service.publishKpiPlan(actor, { kpiPlanId: created.id });

  await service.upsertKpiAllocationDraft(actor, {
    kpiPlanId: created.id,
    allocations: [
      {
        employmentProfileId: "org-profile-1",
        allocationStartDate: "2026-05-01",
        targetMetrics: [{ metricCode: "REVENUE_VND", targetValue: 100 }],
        note: "Initial draft",
      },
    ],
  });
  const updated = await service.upsertKpiAllocationDraft(actor, {
    kpiPlanId: created.id,
    allocations: [
      {
        employmentProfileId: "org-profile-1",
        allocationStartDate: "2026-05-01",
        targetMetrics: [{ metricCode: "REVENUE_VND", targetValue: 300 }],
        note: "Updated draft",
      },
    ],
  });

  const stored = repository.allocations.filter(
    (allocation) =>
      allocation.kpiPlanId === created.id &&
      allocation.memberEmploymentProfileId === "org-profile-1",
  );
  assert.equal(stored.length, 1);
  assert.equal(updated.allocations.length, 1);
  assert.equal(updated.allocations[0]?.targetMetrics[0]?.targetValue, 300);
  assert.equal(updated.allocations[0]?.note, "Updated draft");
  assert.equal(stored[0]?.targetMetrics[0]?.targetValue, 300);
  assert.equal(stored[0]?.note, "Updated draft");
});

test("KPI ORG_UNIT published allocation enables actuals and excuses with EmploymentProfile identity", async () => {
  const { service, repository } = createHarness(() => MAY_5_2026_NOON_HCM);
  const actor = createActor();
  const created = await service.createKpiPlan(actor, orgUnitPlanCommand());
  await service.publishKpiPlan(actor, { kpiPlanId: created.id });
  const draft = await service.upsertKpiAllocationDraft(actor, {
    kpiPlanId: created.id,
    allocations: [
      {
        employmentProfileId: "org-profile-1",
        allocationStartDate: "2026-05-01",
        targetMetrics: [{ metricCode: "REVENUE_VND", targetValue: 300 }],
      },
    ],
  });
  await service.submitKpiAllocationDraft(actor, { kpiPlanId: created.id });
  await service.approveKpiAllocation(actor, { kpiPlanId: created.id });
  const published = await service.publishKpiAllocation(actor, {
    kpiPlanId: created.id,
  });
  const allocation = published.allocations[0] as KpiAllocation;

  const emptyProgress = await service.getKpiProgress(actor, {
    kpiPlanId: created.id,
  });
  const emptyGrid = await service.getKpiActualDailyGrid(actor, {
    kpiPlanId: created.id,
    actualDate: "2026-05-05",
  });
  assert.equal(emptyProgress.plan.subjectType, "ORG_UNIT");
  assert.deepEqual(emptyProgress.memberProgress, [
    {
      allocationId: allocation.id,
      memberEmploymentProfileId: "org-profile-1",
      memberTalentId: null,
      metricCode: "REVENUE_VND",
      targetValue: 300,
      actualValue: 0,
      progressPercent: 0,
      actualEntryCount: 0,
      missingEntryCount: 31,
    },
  ]);
  assert.equal(emptyGrid.subjectType, "ORG_UNIT");
  assert.equal(emptyGrid.rows[0]?.memberEmploymentProfileId, "org-profile-1");
  assert.equal(emptyGrid.rows[0]?.memberTalentId, null);

  await service.markKpiActualExcuse(actor, {
    kpiPlanId: created.id,
    allocationId: allocation.id,
    metricCode: "REVENUE_VND",
    actualDate: "2026-05-05",
    status: "EXCUSED",
    reasonCode: "OTHER",
    reasonText: "Blocked",
  });
  const excusedGrid = await service.getKpiActualDailyGrid(actor, {
    kpiPlanId: created.id,
    actualDate: "2026-05-05",
  });
  assert.equal(
    excusedGrid.rows[0]?.metrics[0]?.dailyActualStatus,
    "EXCUSED",
  );
  await assert.rejects(
    service.createOrSetKpiActual(actor, {
      kpiPlanId: created.id,
      allocationId: allocation.id,
      metricCode: "REVENUE_VND",
      actualDate: "2026-05-05",
      actualValue: 1,
    }),
    KpiConflictError,
  );
  await service.removeKpiActualExcuse(actor, {
    kpiPlanId: created.id,
    excuseId: repository.actualExcuses[0]?.id,
  });

  const actual = await service.createOrSetKpiActual(actor, {
    kpiPlanId: created.id,
    allocationId: allocation.id,
    metricCode: "REVENUE_VND",
    actualDate: "2026-05-05",
    actualValue: 1,
  });
  assert.equal(actual.actualEntry.memberEmploymentProfileId, "org-profile-1");
  assert.equal(actual.actualEntry.memberTalentId, null);
  await assert.rejects(
    service.markKpiActualExcuse(actor, {
      kpiPlanId: created.id,
      allocationId: allocation.id,
      metricCode: "REVENUE_VND",
      actualDate: "2026-05-05",
      status: "NOT_REQUIRED",
      reasonCode: "NO_OPERATION_REQUIRED",
      reasonText: "No operation",
    }),
    KpiConflictError,
  );
  await assert.rejects(
    service.finalizeKpiPlan(actor, { kpiPlanId: created.id }),
    KpiStateError,
  );
  assert.equal(draft.allocations[0]?.memberTalentId, null);
});

test("KPI ORG_UNIT finalize writes finalResult from EmploymentProfile actuals without member identifiers", async () => {
  const now = { value: MAY_5_2026_NOON_HCM };
  const { service, repository } = createHarness(() => now.value);
  const actor = createActor();
  const created = await service.createKpiPlan(actor, orgUnitPlanCommand());
  const publishedPlan = await service.publishKpiPlan(actor, {
    kpiPlanId: created.id,
  });
  await service.upsertKpiAllocationDraft(actor, {
    kpiPlanId: created.id,
    allocations: [
      {
        employmentProfileId: "org-profile-1",
        allocationStartDate: "2026-05-01",
        targetMetrics: [{ metricCode: "REVENUE_VND", targetValue: 300 }],
      },
    ],
  });
  await service.submitKpiAllocationDraft(actor, { kpiPlanId: created.id });
  await service.approveKpiAllocation(actor, { kpiPlanId: created.id });
  const publishedAllocation = await service.publishKpiAllocation(actor, {
    kpiPlanId: created.id,
  });
  const allocation = publishedAllocation.allocations[0] as KpiAllocation;
  await service.createOrSetKpiActual(actor, {
    kpiPlanId: created.id,
    allocationId: allocation.id,
    metricCode: "REVENUE_VND",
    actualDate: "2026-05-05",
    actualValue: 100,
  });

  now.value = JUNE_1_2026_NOON_HCM;
  const finalized = await service.finalizeKpiPlan(actor, {
    kpiPlanId: created.id,
  });
  const snapshot = (await repository.findPlanById(created.id))?.finalResult;

  assert.equal(finalized.status, "FINALIZED");
  assert.ok(snapshot);
  assert.equal(snapshot.planId, publishedPlan.id);
  assert.equal(snapshot.subjectType, "ORG_UNIT");
  assert.equal(snapshot.subjectId, "org-department-active");
  assert.deepEqual(snapshot.revenue, {
    metricCode: "REVENUE_VND",
    planTargetValue: 300,
    operationalTargetValue: 300,
    actualValue: 100,
    achievementPercent: (100 / 300) * 100,
    targetMismatch: false,
  });
  assert.equal(snapshot.members.length, 1);
  assert.deepEqual(snapshot.members[0]?.revenue, {
    metricCode: "REVENUE_VND",
    targetValue: 300,
    actualValue: 100,
    achievementPercent: (100 / 300) * 100,
  });
  assert.equal(snapshot.members[0]?.memberDisplayName, "Org Profile 1");
  assert.equal(JSON.stringify(snapshot).includes("memberTalentId"), false);
  assert.equal(
    JSON.stringify(snapshot).includes("memberEmploymentProfileId"),
    false,
  );
  await assert.rejects(
    service.finalizeKpiPlan(actor, { kpiPlanId: created.id }),
    KpiStateError,
  );
  assert.deepEqual(
    (await repository.findPlanById(created.id))?.finalResult,
    snapshot,
  );
});

test("KPI ORG_UNIT finalized finalResult route is manager-readable and scoped", async () => {
  const now = { value: MAY_5_2026_NOON_HCM };
  const { service, orgUnitManagerRepository } = createHarness(() => now.value);
  const actor = createActor();
  const controller = new KpiAdminQueryController(service) as unknown as {
    handle(req: Request, actor: Actor, context: "ADMIN"): Promise<unknown>;
    present(
      result: unknown,
      req: Request,
      actor: Actor,
      context: "ADMIN",
    ): Promise<{ readonly data: unknown }>;
  };
  const created = await service.createKpiPlan(actor, orgUnitPlanCommand());
  await service.publishKpiPlan(actor, { kpiPlanId: created.id });
  await service.upsertKpiAllocationDraft(actor, {
    kpiPlanId: created.id,
    allocations: [
      {
        employmentProfileId: "org-profile-1",
        allocationStartDate: "2026-05-01",
        targetMetrics: [{ metricCode: "REVENUE_VND", targetValue: 300 }],
      },
    ],
  });
  await service.submitKpiAllocationDraft(actor, { kpiPlanId: created.id });
  await service.approveKpiAllocation(actor, { kpiPlanId: created.id });
  const publishedAllocation = await service.publishKpiAllocation(actor, {
    kpiPlanId: created.id,
  });
  const allocation = publishedAllocation.allocations[0] as KpiAllocation;
  await service.createOrSetKpiActual(actor, {
    kpiPlanId: created.id,
    allocationId: allocation.id,
    metricCode: "REVENUE_VND",
    actualDate: "2026-05-05",
    actualValue: 100,
  });
  now.value = JUNE_1_2026_NOON_HCM;
  const finalized = await service.finalizeKpiPlan(actor, {
    kpiPlanId: created.id,
  });
  orgUnitManagerRepository.assignments.push(
    orgUnitManagerAssignment({
      orgUnitId: "org-department-active",
      role: "UNIT_OPERATOR",
    }),
  );

  const req = {
    query: {},
    params: { kpiPlanId: finalized.id },
  } as unknown as Request;
  bindCommand(req, "KPI_PLAN_ORG_UNIT_FINAL_RESULT");
  const response = await controller.present(
    await controller.handle(req, createManagerActor(), "ADMIN"),
    req,
    createManagerActor(),
    "ADMIN",
  );
  const detail = response.data as {
    readonly status: string;
    readonly subjectType: string;
    readonly allocations: readonly unknown[];
    readonly finalResult: Record<string, unknown>;
  };
  assert.equal(detail.status, "FINALIZED");
  assert.equal(detail.subjectType, "ORG_UNIT");
  assert.deepEqual(detail.allocations, []);
  assert.equal(detail.finalResult.subjectType, "ORG_UNIT");
  assert.equal(JSON.stringify(detail.finalResult).includes("memberTalentId"), false);
  assert.equal(
    JSON.stringify(detail.finalResult).includes("memberEmploymentProfileId"),
    false,
  );

  orgUnitManagerRepository.assignments.length = 0;
  orgUnitManagerRepository.assignments.push(
    orgUnitManagerAssignment({
      orgUnitId: "org-team-active",
      role: "UNIT_MANAGER",
    }),
  );
  await assert.rejects(
    controller.handle(req, createManagerActor(), "ADMIN"),
    KpiPermissionScopeError,
  );

  now.value = MAY_5_2026_NOON_HCM;
  const draft = await service.createKpiPlan(actor, orgUnitPlanCommand());
  const draftReq = {
    query: {},
    params: { kpiPlanId: draft.id },
  } as unknown as Request;
  bindCommand(draftReq, "KPI_PLAN_ORG_UNIT_FINAL_RESULT");
  await assert.rejects(
    controller.handle(draftReq, createActor(), "ADMIN"),
    KpiPermissionScopeError,
  );

  const groupPlan = await createPublishedGroupPlan(service);
  const groupReq = {
    query: {},
    params: { kpiPlanId: groupPlan.id },
  } as unknown as Request;
  bindCommand(groupReq, "KPI_PLAN_ORG_UNIT_FINAL_RESULT");
  await assert.rejects(
    controller.handle(groupReq, createActor(), "ADMIN"),
    KpiPermissionScopeError,
  );
});

test("KPI V2 global list remains compatible with existing TALENT plan while detail fails closed", async () => {
  const { service, repository } = createHarness();
  repository.plans.push(buildFutureSubjectDraftPlan("TALENT"));

  const result = await service.listKpiPlans(createActor(), {
    subjectType: "TALENT",
  });

  assert.deepEqual(
    result.items.map((item) => item.id),
    ["future-TALENT"],
  );
  assert.equal(result.items[0]?.subjectRef, null);
  await assert.rejects(
    service.getKpiPlanDetail(createActor(), {
      kpiPlanId: "future-TALENT",
    }),
    KpiPermissionScopeError,
  );
});

test("KPI V2 global list and detail return safe TALENT_GROUP subjectRef", async () => {
  const { service, subjectAccess } = createHarness(() => MAY_5_2026_NOON_HCM);
  const plan = await createPublishedGroupPlan(service);
  subjectAccess.listSubjectRefsCallCount = 0;
  subjectAccess.listSubjectRefsSubjects.length = 0;

  const result = await service.listKpiPlans(createActor(), {});
  const detail = await service.getKpiPlanDetail(createActor(), {
    kpiPlanId: plan.id,
  });
  const item = result.items.find((row) => row.id === plan.id);

  assert.ok(item);
  assert.deepEqual(item.subjectRef, {
    id: "group-1",
    code: "TG-000001",
    name: "Creator Team",
    displayName: "Creator Team",
    status: "ACTIVE",
  });
  assert.deepEqual(detail.subjectRef, item.subjectRef);
  assert.equal(subjectAccess.listSubjectRefsCallCount, 2);
  assert.deepEqual(
    subjectAccess.listSubjectRefsSubjects.map(
      (subject) => `${subject.subjectType}:${subject.subjectId}`,
    ),
    ["TALENT_GROUP:group-1", "TALENT_GROUP:group-1"],
  );
});

test("KPI V2 global list and detail safely omit missing subjectRef", async () => {
  const { service, repository } = createHarness();
  const missingSubjectPlan: KpiPlan = {
    ...buildFutureSubjectDraftPlan("TALENT_GROUP"),
    id: "missing-subject-plan",
    planCode: "KPI-MISSING",
    subjectId: "missing-group",
  };
  repository.plans.push(missingSubjectPlan);

  const result = await service.listKpiPlans(createActor(), {});
  const detail = await service.getKpiPlanDetail(createActor(), {
    kpiPlanId: missingSubjectPlan.id,
  });

  assert.equal(result.items[0]?.id, missingSubjectPlan.id);
  assert.equal(result.items[0]?.subjectRef, null);
  assert.equal(detail.subjectRef, null);
});

test("KPI V2 global TALENT list subjectRef uses safe display fields only while detail fails closed", async () => {
  const { service, repository } = createHarness();
  const talentPlan: KpiPlan = {
    ...buildFutureSubjectDraftPlan("TALENT"),
    id: "legacy-talent-plan",
    planCode: "KPI-TALENT-LEGACY",
    subjectId: "talent-1",
  };
  repository.plans.push(talentPlan);

  const result = await service.listKpiPlans(createActor(), {
    subjectType: "TALENT",
  });

  assert.deepEqual(result.items[0]?.subjectRef, {
    id: "talent-1",
    code: "TAL-000001",
    displayName: "Talent Profile 1",
    status: "ACTIVE",
  });
  await assert.rejects(
    service.getKpiPlanDetail(createActor(), {
      kpiPlanId: talentPlan.id,
    }),
    KpiPermissionScopeError,
  );
  for (const forbiddenField of [
    "legalName",
    "displayShortName",
    "linkedEmploymentProfileId",
    "email",
    "memberTalentId",
  ]) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        result.items[0]?.subjectRef ?? {},
        forbiddenField,
      ),
      false,
    );
  }
});

test("KPI V2 publish TALENT_GROUP plan freezes target and moves to PUBLISHED", async () => {
  const { service } = createHarness();
  const created = await service.createKpiPlan(
    createActor(),
    groupPlanCommand(),
  );

  const published = await service.publishKpiPlan(createActor(), {
    kpiPlanId: created.id,
  });

  assert.equal(published.status, "PUBLISHED");
  assert.equal(published.publishedAt, 1_700_000_000_000);
  await assert.rejects(
    service.replaceKpiTargetMetrics(createActor(), {
      kpiPlanId: created.id,
      targetMetrics: [{ metricCode: "REVENUE_VND", targetValue: 1 }],
    }),
    KpiStateError,
  );
});

test("KPI V2 allocation publish rejects allocation totals that do not match", async () => {
  const { service } = createHarness();
  const created = await service.createKpiPlan(
    createActor(),
    groupPlanCommand(),
  );
  await service.publishKpiPlan(createActor(), { kpiPlanId: created.id });
  await withEphemeralManagerAssignment(service, "group-1", async () => {
    await service.upsertKpiAllocationDraft(createManagerActor(), {
      kpiPlanId: created.id,
      allocations: [
        {
          employmentProfileId: "talent-profile-1",
          allocationStartDate: "2026-05-01",
          targetMetrics: [
            { metricCode: "REVENUE_VND", targetValue: 100 },
            { metricCode: "ONBOARDED_TALENT_COUNT", targetValue: 1 },
          ],
        },
        {
          employmentProfileId: "talent-profile-2",
          allocationStartDate: "2026-05-01",
          targetMetrics: [
            { metricCode: "REVENUE_VND", targetValue: 100 },
            { metricCode: "ONBOARDED_TALENT_COUNT", targetValue: 1 },
          ],
        },
      ],
    });
    await service.submitKpiAllocationDraft(createManagerActor(), {
      kpiPlanId: created.id,
    });
  });
  await service.approveKpiAllocation(createActor(), {
    kpiPlanId: created.id,
  });

  await assert.rejects(
    service.publishKpiAllocation(createActor(), { kpiPlanId: created.id }),
    KpiInvalidAllocationError,
  );
});

test("KPI V2 allocation publish makes valid allocations official without child plans", async () => {
  const { service, repository } = createHarness();
  const created = await service.createKpiPlan(
    createActor(),
    groupPlanCommand(),
  );
  await service.publishKpiPlan(createActor(), { kpiPlanId: created.id });
  await withEphemeralManagerAssignment(service, "group-1", async () => {
    await service.upsertKpiAllocationDraft(createManagerActor(), {
      kpiPlanId: created.id,
      allocations: [
        {
          employmentProfileId: "talent-profile-1",
          allocationStartDate: "2026-05-01",
          targetMetrics: [
            { metricCode: "REVENUE_VND", targetValue: 100 },
            { metricCode: "ONBOARDED_TALENT_COUNT", targetValue: 1 },
          ],
        },
        {
          employmentProfileId: "talent-profile-2",
          allocationStartDate: "2026-05-01",
          targetMetrics: [
            { metricCode: "REVENUE_VND", targetValue: 200 },
            { metricCode: "ONBOARDED_TALENT_COUNT", targetValue: 2 },
          ],
        },
      ],
    });
    await service.submitKpiAllocationDraft(createManagerActor(), {
      kpiPlanId: created.id,
    });
  });
  await service.approveKpiAllocation(createActor(), {
    kpiPlanId: created.id,
  });

  const published = await service.publishKpiAllocation(createActor(), {
    kpiPlanId: created.id,
  });

  assert.equal(published.status, "PUBLISHED");
  assert.deepEqual(
    published.allocations.map((allocation) => allocation.allocationStatus),
    ["PUBLISHED", "PUBLISHED"],
  );
  assert.equal(repository.plans.length, 1);
  assert.equal(
    repository.plans.some((plan) => plan.subjectId === "talent-1"),
    false,
  );
});

test("KPI V2 published plan rejects draft-core, target, and allocation mutation", async () => {
  const { service } = createHarness();
  const created = await service.createKpiPlan(
    createActor(),
    groupPlanCommand(),
  );
  await service.publishKpiPlan(createActor(), { kpiPlanId: created.id });

  await assert.rejects(
    service.updateKpiDraftCore(createActor(), {
      kpiPlanId: created.id,
      title: "No",
    }),
    KpiStateError,
  );
  await assert.rejects(
    service.replaceKpiTargetMetrics(createActor(), {
      kpiPlanId: created.id,
      targetMetrics: [{ metricCode: "REVENUE_VND", targetValue: 1 }],
    }),
    KpiStateError,
  );
  await assert.rejects(
    service.replaceKpiAllocations(createActor(), {
      kpiPlanId: created.id,
      allocations: [],
    }),
    KpiStateError,
  );
});

test("KPI managed member picker lists only active managed group members with safe fields", async () => {
  const { service, managerRepository } = createHarness();
  const plan = await createPublishedGroupPlan(service);
  seedManagerAssignment(managerRepository, "group-1", 0);

  const result = await service.listKpiManagedMembers(
    createBackofficeTeamManagerActor(),
    {
      kpiPlanId: plan.id,
      limit: 20,
    },
  );

  assert.deepEqual(
    result.items.map((item) => item.employmentProfileId),
    ["talent-profile-1", "talent-profile-2"],
  );
  assert.deepEqual(
    Object.keys(result.items[0] ?? {}).sort(),
    [
      "displayName",
      "employeeCode",
      "employmentProfileId",
      "groupId",
      "talentCode",
      "talentId",
    ].sort(),
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(result.items[0] ?? {}, "linkedUserId"),
    false,
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(result.items[0] ?? {}, "legalName"),
    false,
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(result.items[0] ?? {}, "email"),
    false,
  );
});

test("KPI managed member picker denies unmanaged, non-group, non-published, and unscoped callers", async () => {
  const { service, repository, managerRepository } = createHarness();
  const published = await createPublishedGroupPlan(service);
  seedManagerAssignment(managerRepository, "group-1", 0);
  const draft = await service.createKpiPlan(createActor(), groupPlanCommand());
  const talentPlan = {
    ...buildFutureSubjectDraftPlan("TALENT"),
    status: "PUBLISHED" as const,
    publishedAt: MAY_5_2026_NOON_HCM,
    publishedByActorId: "admin-1",
  };
  repository.plans.push(
    {
      ...published,
      id: "unmanaged-group-plan",
      subjectId: "group-2",
    },
    talentPlan,
  );

  await assert.rejects(
    service.listKpiManagedMembers(createManagerActorWithoutKpiScope(), {
      kpiPlanId: published.id,
      limit: 20,
    }),
    KpiPermissionScopeError,
  );
  await assert.rejects(
    service.listKpiManagedMembers(createActor(), {
      kpiPlanId: published.id,
      limit: 20,
    }),
    KpiPermissionScopeError,
  );
  await assert.rejects(
    service.listKpiManagedMembers(
      createScopedActor({
        id: "manager-user",
        permissions: [Permission.KPI_READ, Permission.KPI_ENTER_ACTUAL],
      }),
      {
        kpiPlanId: published.id,
        limit: 20,
      },
    ),
    KpiPermissionScopeError,
  );
  await assert.rejects(
    service.listKpiManagedMembers(
      createScopedActor({
        id: "unlinked-manager-user",
        permissions: [Permission.KPI_READ, Permission.KPI_ENTER_ACTUAL],
        kpiScopes: ["managedGroup"],
      }),
      {
        kpiPlanId: published.id,
        limit: 20,
      },
    ),
    KpiPermissionScopeError,
  );
  await assert.rejects(
    service.listKpiManagedMembers(createBackofficeTeamManagerActor(), {
      kpiPlanId: "unmanaged-group-plan",
      limit: 20,
    }),
    KpiPermissionScopeError,
  );
  await assert.rejects(
    service.listKpiManagedMembers(createBackofficeTeamManagerActor(), {
      kpiPlanId: draft.id,
      limit: 20,
    }),
    KpiStateError,
  );
  await assert.rejects(
    service.listKpiManagedMembers(createBackofficeTeamManagerActor(), {
      kpiPlanId: talentPlan.id,
      limit: 20,
    }),
    KpiInvalidAllocationError,
  );
});

test("KPI managed member picker denies linked admin manager without active assignment", async () => {
  const { service } = createHarness();
  const published = await createPublishedGroupPlan(service);

  await assert.rejects(
    service.listKpiManagedMembers(createBackofficeTeamManagerActor(), {
      kpiPlanId: published.id,
      limit: 20,
    }),
    KpiPermissionScopeError,
  );
});

test("KPI V2 archive sets archivedAt", async () => {
  const { service } = createHarness();
  const created = await service.createKpiPlan(
    createActor(),
    groupPlanCommand(),
  );

  const archived = await service.archiveKpiPlan(createActor(), {
    kpiPlanId: created.id,
  });

  assert.equal(archived.status, "ARCHIVED");
  assert.equal(archived.archivedAt, 1_700_000_000_000);
  assert.equal(archived.archivedByActorId, "admin-1");
});

test("KPI V2 actual policy snapshot and actual lifecycle are enforced", async () => {
  const now = { value: MAY_5_2026_NOON_HCM };
  const { service, audit, repository } = createHarness(() => now.value);
  const published = await createPublishedGroupPlan(service);
  const allocation = published.allocations[0] as KpiAllocation;

  assert.equal(published.actualPolicySnapshot?.timezone, "Asia/Ho_Chi_Minh");
  assert.equal(published.actualPolicySnapshot?.entryOpenLocalTime, "00:00");
  assert.equal(published.actualPolicySnapshot?.entryLockLocalTime, "10:00");
  assert.equal(published.actualPolicySnapshot?.maxDirectEditsPerEntry, 3);

  const created = await service.createOrSetKpiActual(createActor(), {
    kpiPlanId: published.id,
    allocationId: allocation.id,
    metricCode: "REVENUE_VND",
    actualDate: "2026-05-05",
    actualValue: 80,
  });
  assert.equal(created.actualEntry.effectiveValue, 80);
  assert.equal(created.actualEntry.editCount, 0);

  let entry = created.actualEntry;
  for (const value of [81, 82, 83]) {
    entry = (
      await service.updateKpiActualDirect(createActor(), {
        kpiPlanId: published.id,
        actualEntryId: entry.id,
        actualValue: value,
      })
    ).actualEntry;
  }
  assert.equal(entry.editCount, 3);
  await assert.rejects(
    service.updateKpiActualDirect(createActor(), {
      kpiPlanId: published.id,
      actualEntryId: entry.id,
      actualValue: 84,
    }),
    KpiStateError,
  );

  now.value = MAY_5_2026_AFTER_LOCK_HCM;
  await assert.rejects(
    service.updateKpiActualDirect(createActor(), {
      kpiPlanId: published.id,
      actualEntryId: entry.id,
      actualValue: 85,
    }),
    KpiStateError,
  );
  await assert.rejects(
    service.correctKpiActual(createActor(), {
      kpiPlanId: published.id,
      actualEntryId: entry.id,
      correctedValue: 90,
      reason: "",
    }),
    KpiValidationError,
  );
  const corrected = await service.correctKpiActual(createActor(), {
    kpiPlanId: published.id,
    actualEntryId: entry.id,
    correctedValue: 90,
    reason: "late replacement",
  });
  assert.equal(corrected.correction.previousValue, 83);
  assert.equal(corrected.actualEntry.effectiveValue, 90);

  now.value = JUNE_1_2026_NOON_HCM;
  const finalized = await service.finalizeKpiPlan(createActor(), {
    kpiPlanId: published.id,
  });
  assert.equal(finalized.status, "FINALIZED");
  assert.equal(
    (await repository.findPlanById(published.id))?.status,
    "FINALIZED",
  );
  await assert.rejects(
    service.correctKpiActual(createActor(), {
      kpiPlanId: published.id,
      actualEntryId: entry.id,
      correctedValue: 91,
      reason: "too late",
    }),
    KpiStateError,
  );
  assert.equal(
    audit.records.some(
      (record) => record.metadata?.mutationType === "kpi.correct-actual",
    ),
    true,
  );
});

test("KPI V2 actual validation rejects invalid state, dates, and numeric values", async () => {
  const now = { value: MAY_5_2026_NOON_HCM };
  const { service } = createHarness(() => now.value);
  const draft = await service.createKpiPlan(createActor(), groupPlanCommand());

  await assert.rejects(
    service.createOrSetKpiActual(createActor(), {
      kpiPlanId: draft.id,
      allocationId: "missing",
      metricCode: "REVENUE_VND",
      actualDate: "2026-05-05",
      actualValue: 1,
    }),
    KpiStateError,
  );

  const published = await createPublishedGroupPlan(service);
  const allocation = published.allocations[0] as KpiAllocation;
  await assert.rejects(
    service.createOrSetKpiActual(createActor(), {
      kpiPlanId: published.id,
      allocationId: "missing",
      metricCode: "REVENUE_VND",
      actualDate: "2026-05-05",
      actualValue: 1,
    }),
    KpiInvalidAllocationError,
  );
  await assert.rejects(
    service.createOrSetKpiActual(createActor(), {
      kpiPlanId: published.id,
      allocationId: allocation.id,
      metricCode: "REVENUE_VND",
      actualDate: "2026-06-01",
      actualValue: 1,
    }),
    KpiValidationError,
  );
  await assert.rejects(
    service.createOrSetKpiActual(createActor(), {
      kpiPlanId: published.id,
      allocationId: allocation.id,
      metricCode: "REVENUE_VND",
      actualDate: "2026-05-05",
      actualValue: "1000000" as unknown as number,
    }),
    KpiValidationError,
  );
  await assert.rejects(
    service.createOrSetKpiActual(createActor(), {
      kpiPlanId: published.id,
      allocationId: allocation.id,
      metricCode: "REVENUE_VND",
      actualDate: "2026-05-05",
      actualValue: 1.5,
    }),
    KpiValidationError,
  );
});

test("KPI V2 actualDate requires strict YYYY-MM-DD calendar dates", async () => {
  const { service } = createHarness(() => MAY_5_2026_NOON_HCM);
  const published = await createPublishedGroupPlan(service);
  const allocation = published.allocations[0] as KpiAllocation;

  for (const actualDate of [
    "2026-04-31",
    "2026-02-29",
    "2026-13-01",
    "2026-01-00",
    "16-05-2026",
    "16/05/2026",
    "16-5-2026",
  ]) {
    await assert.rejects(
      service.createOrSetKpiActual(createActor(), {
        kpiPlanId: published.id,
        allocationId: allocation.id,
        metricCode: "REVENUE_VND",
        actualDate,
        actualValue: 1,
      }),
      KpiValidationError,
    );
  }
});

test("KPI V2 actualDate accepts leap day in YYYY-MM-DD within plan window", async () => {
  const { service } = createHarness(() => FEB_29_2028_NOON_HCM);
  const published = await createPublishedFebruary2028GroupPlan(service);
  const allocation = published.allocations[0] as KpiAllocation;

  const result = await service.createOrSetKpiActual(createActor(), {
    kpiPlanId: published.id,
    allocationId: allocation.id,
    metricCode: "REVENUE_VND",
    actualDate: "2028-02-29",
    actualValue: 100,
  });

  assert.equal(result.actualEntry.actualDate, "2028-02-29");
  assert.equal(result.actualEntry.effectiveValue, 100);
});

test("KPI V2 direct actual window allows D 00:00 through D+1 10:00 inclusive", async () => {
  const now = { value: MAY_5_2026_START_HCM };
  const { service } = createHarness(() => now.value);
  const published = await createPublishedGroupPlan(service);
  const allocation = published.allocations[0] as KpiAllocation;

  const created = await service.createOrSetKpiActual(createActor(), {
    kpiPlanId: published.id,
    allocationId: allocation.id,
    metricCode: "REVENUE_VND",
    actualDate: "2026-05-05",
    actualValue: 80,
  });
  assert.equal(created.actualEntry.effectiveValue, 80);

  for (const allowedNow of [MAY_6_2026_09_59_HCM, MAY_6_2026_10_00_HCM]) {
    now.value = allowedNow;
    const retry = await service.createOrSetKpiActual(createActor(), {
      kpiPlanId: published.id,
      allocationId: allocation.id,
      metricCode: "REVENUE_VND",
      actualDate: "2026-05-05",
      actualValue: 80,
    });
    assert.equal(retry.actualEntry.id, created.actualEntry.id);
  }

  now.value = MAY_5_2026_AFTER_LOCK_HCM;
  await assert.rejects(
    service.createOrSetKpiActual(createActor(), {
      kpiPlanId: published.id,
      allocationId: allocation.id,
      metricCode: "REVENUE_VND",
      actualDate: "2026-05-05",
      actualValue: 80,
    }),
    KpiStateError,
  );
});

test("KPI V2 month-end actual remains in original period until D+1 10:00", async () => {
  const now = { value: Date.UTC(2026, 5, 15, 5, 0, 0, 0) };
  const { service } = createHarness(() => now.value);
  const published = await createPublishedJune2026GroupPlan(service);
  const allocation = published.allocations[0] as KpiAllocation;

  now.value = JULY_1_2026_09_30_HCM;
  const created = await service.createOrSetKpiActual(createActor(), {
    kpiPlanId: published.id,
    allocationId: allocation.id,
    metricCode: "REVENUE_VND",
    actualDate: "2026-06-30",
    actualValue: 100,
  });
  assert.equal(created.actualEntry.actualDate, "2026-06-30");
  assert.equal(
    (await service.getKpiPlanDetail(createActor(), { kpiPlanId: published.id }))
      .periodMonth,
    "2026-06",
  );

  now.value = JULY_1_2026_10_01_HCM;
  await assert.rejects(
    service.updateKpiActualDirect(createActor(), {
      kpiPlanId: published.id,
      actualEntryId: created.actualEntry.id,
      actualValue: 101,
    }),
    KpiStateError,
  );
});

test("KPI V2 year-end direct actual window crosses into next year", async () => {
  const now = { value: Date.UTC(2026, 11, 15, 5, 0, 0, 0) };
  const { service } = createHarness(() => now.value);
  const published = await createPublishedDecember2026GroupPlan(service);
  const allocation = published.allocations[0] as KpiAllocation;

  now.value = JAN_1_2027_10_00_HCM;
  const created = await service.createOrSetKpiActual(createActor(), {
    kpiPlanId: published.id,
    allocationId: allocation.id,
    metricCode: "REVENUE_VND",
    actualDate: "2026-12-31",
    actualValue: 100,
  });
  assert.equal(created.actualEntry.effectiveValue, 100);

  now.value = JAN_1_2027_10_01_HCM;
  await assert.rejects(
    service.updateKpiActualDirect(createActor(), {
      kpiPlanId: published.id,
      actualEntryId: created.actualEntry.id,
      actualValue: 101,
    }),
    KpiStateError,
  );
});

test("KPI V2 duplicate POST is idempotent only inside the direct window", async () => {
  const now = { value: MAY_5_2026_NOON_HCM };
  const { service, audit, actualRepository } = createHarness(() => now.value);
  const published = await createPublishedGroupPlan(service);
  const allocation = published.allocations[0] as KpiAllocation;
  const created = await service.createOrSetKpiActual(createActor(), {
    kpiPlanId: published.id,
    allocationId: allocation.id,
    metricCode: "REVENUE_VND",
    actualDate: "2026-05-05",
    actualValue: 80,
  });
  const auditCountAfterCreate = audit.records.length;
  now.value = MAY_5_2026_AFTER_LOCK_HCM;

  await assert.rejects(
    service.createOrSetKpiActual(createActor(), {
      kpiPlanId: published.id,
      allocationId: allocation.id,
      metricCode: "REVENUE_VND",
      actualDate: "2026-05-05",
      actualValue: 80,
    }),
    KpiStateError,
  );

  await assert.rejects(
    service.createOrSetKpiActual(createActor(), {
      kpiPlanId: published.id,
      allocationId: allocation.id,
      metricCode: "REVENUE_VND",
      actualDate: "2026-05-05",
      actualValue: 81,
    }),
    KpiStateError,
  );

  const stored = await actualRepository.findEntryById(created.actualEntry.id);
  assert.equal(stored?.effectiveValue, 80);
  assert.equal(stored?.editCount, 0);
  assert.equal(audit.records.length, auditCountAfterCreate);

  now.value = MAY_5_2026_NOON_HCM;
  const patched = await service.updateKpiActualDirect(createActor(), {
    kpiPlanId: published.id,
    actualEntryId: created.actualEntry.id,
    actualValue: 81,
  });
  assert.equal(patched.actualEntry.effectiveValue, 81);
  assert.equal(patched.actualEntry.editCount, 1);
});

test("KPI V2 progress sums effective values, can exceed 100%, and tracks missing entries", async () => {
  const now = { value: MAY_5_2026_NOON_HCM };
  const { service } = createHarness(() => now.value);
  const published = await createPublishedGroupPlan(service);
  const [first, second] = published.allocations as readonly KpiAllocation[];
  const firstActual = await service.createOrSetKpiActual(createActor(), {
    kpiPlanId: published.id,
    allocationId: first.id,
    metricCode: "REVENUE_VND",
    actualDate: "2026-05-05",
    actualValue: 120,
  });
  await service.createOrSetKpiActual(createActor(), {
    kpiPlanId: published.id,
    allocationId: second.id,
    metricCode: "REVENUE_VND",
    actualDate: "2026-05-05",
    actualValue: 250,
  });
  now.value = MAY_5_2026_AFTER_LOCK_HCM;
  await service.correctKpiActual(createActor(), {
    kpiPlanId: published.id,
    actualEntryId: firstActual.actualEntry.id,
    correctedValue: 150,
    reason: "replacement correction",
  });

  const progress = await service.getKpiProgress(createActor(), {
    kpiPlanId: published.id,
  });
  const revenueTotal = progress.groupTotals.find(
    (metric) => metric.metricCode === "REVENUE_VND",
  );

  assert.equal(revenueTotal?.actualValue, 400);
  assert.equal(revenueTotal?.progressPercent, (400 / 300) * 100);
  assert.equal(progress.memberProgress[0]?.actualEntryCount, 1);
  assert.equal(progress.memberProgress[0]?.missingEntryCount, 30);
});

test("KPI V2 treats TikTok Diamond as supporting operational count, not revenue", async () => {
  const now = { value: MAY_5_2026_NOON_HCM };
  const { service, repository } = createHarness(() => now.value);
  const published = await createPublishedDiamondGroupPlan(service);
  const [first, second] = published.allocations as readonly KpiAllocation[];

  await assert.rejects(
    service.createOrSetKpiActual(createActor(), {
      kpiPlanId: published.id,
      allocationId: first.id,
      metricCode: "TIKTOK_DIAMOND",
      actualDate: "2026-05-05",
      actualValue: 1.5,
    }),
    /TIKTOK_DIAMOND requires an integer actual value/,
  );

  const firstActual = await service.createOrSetKpiActual(createActor(), {
    kpiPlanId: published.id,
    allocationId: first.id,
    metricCode: "TIKTOK_DIAMOND",
    actualDate: "2026-05-05",
    actualValue: 500,
  });
  await service.createOrSetKpiActual(createActor(), {
    kpiPlanId: published.id,
    allocationId: second.id,
    metricCode: "TIKTOK_DIAMOND",
    actualDate: "2026-05-05",
    actualValue: 300,
  });

  now.value = MAY_5_2026_AFTER_LOCK_HCM;
  await assert.rejects(
    service.correctKpiActual(createActor(), {
      kpiPlanId: published.id,
      actualEntryId: firstActual.actualEntry.id,
      correctedValue: 540.5,
      reason: "Diamond correction must stay integer",
    }),
    /TIKTOK_DIAMOND requires an integer actual value/,
  );
  await service.correctKpiActual(createActor(), {
    kpiPlanId: published.id,
    actualEntryId: firstActual.actualEntry.id,
    correctedValue: 540,
    reason: "Diamond operational correction",
  });

  const progress = await service.getKpiProgress(createActor(), {
    kpiPlanId: published.id,
  });
  const diamondTotal = progress.groupTotals.find(
    (metric) => metric.metricCode === "TIKTOK_DIAMOND",
  );
  assert.equal(diamondTotal?.targetValue, 1000);
  assert.equal(diamondTotal?.actualValue, 840);
  assert.equal(diamondTotal?.progressPercent, 84);

  const workspaceDetail = await service.getKpiActualWorkspacePlanDetail(
    createActor(),
    { kpiPlanId: published.id },
  );
  assert.equal(workspaceDetail.revenue.metricCode, "REVENUE_VND");
  assert.equal(workspaceDetail.revenue.actualValue, 0);
  assert.deepEqual(workspaceDetail.supportingMetrics, [
    {
      metricCode: "TIKTOK_DIAMOND",
      targetValue: 1000,
      actualValue: 840,
      achievementPercent: 84,
    },
  ]);

  now.value = JUNE_1_2026_NOON_HCM;
  await service.finalizeKpiPlan(createActor(), { kpiPlanId: published.id });
  const snapshot = (await repository.findPlanById(published.id))?.finalResult;
  assert.ok(snapshot);
  assert.equal(snapshot.revenue.metricCode, "REVENUE_VND");
  assert.equal(snapshot.revenue.actualValue, 0);
  assert.deepEqual(snapshot.supportingMetrics, [
    {
      metricCode: "TIKTOK_DIAMOND",
      targetValue: 1000,
      actualValue: 840,
      achievementPercent: 84,
    },
  ]);
  assert.equal(
    snapshot.members[0]?.supportingMetrics.some(
      (metric) => metric.metricCode === "TIKTOK_DIAMOND",
    ),
    true,
  );
  for (const forbidden of ["payroll", "payout", "commission", "settlement"]) {
    assert.equal(JSON.stringify(snapshot).includes(forbidden), false);
  }
});

test("KPI V2 daily actual grid rejects missing actualDate", async () => {
  const { service } = createHarness();
  const published = await createPublishedGroupPlan(service);

  await assert.rejects(
    service.getKpiActualDailyGrid(createActor(), {
      kpiPlanId: published.id,
    }),
    KpiValidationError,
  );
});

test("KPI V2 daily actual grid rejects legacy DD-MM-YYYY actualDate", async () => {
  const { service } = createHarness();
  const published = await createPublishedGroupPlan(service);

  await assert.rejects(
    service.getKpiActualDailyGrid(createActor(), {
      kpiPlanId: published.id,
      actualDate: "05-05-2026",
    }),
    KpiValidationError,
  );
});

test("KPI V2 daily actual grid rejects invalid calendar actualDate", async () => {
  const { service } = createHarness();
  const published = await createPublishedGroupPlan(service);

  await assert.rejects(
    service.getKpiActualDailyGrid(createActor(), {
      kpiPlanId: published.id,
      actualDate: "2026-02-31",
    }),
    KpiValidationError,
  );
});

test("KPI V2 daily actual grid rejects actualDate outside plan period", async () => {
  const { service } = createHarness();
  const published = await createPublishedGroupPlan(service);

  await assert.rejects(
    service.getKpiActualDailyGrid(createActor(), {
      kpiPlanId: published.id,
      actualDate: "2026-06-01",
    }),
    KpiValidationError,
  );
});

test("KPI V2 daily actual grid returns missing cells with zero effective value", async () => {
  const { service, audit } = createHarness(() => MAY_5_2026_NOON_HCM);
  const published = await createPublishedGroupPlan(service);
  const auditCount = audit.records.length;

  const grid = await service.getKpiActualDailyGrid(createActor(), {
    kpiPlanId: published.id,
    actualDate: "2026-05-05",
  });

  assert.equal(grid.kpiPlanId, published.id);
  assert.equal(grid.actualDate, "2026-05-05");
  assert.equal(grid.editability.isDirectEditOpen, true);
  assert.equal(grid.rows.length, 2);
  assert.equal(grid.rows[0]?.metrics[0]?.actualEntryId, null);
  assert.equal(grid.rows[0]?.metrics[0]?.actualValue, null);
  assert.equal(grid.rows[0]?.metrics[0]?.effectiveValue, 0);
  assert.equal(grid.rows[0]?.metrics[0]?.hasEntry, false);
  assert.equal(grid.rows[0]?.metrics[0]?.editCount, 0);
  assert.equal(grid.rows[0]?.metrics[0]?.dailyActualStatus, "DUE_OPEN");
  assert.equal(grid.rows[0]?.metrics[0]?.actualExcuse, null);
  assert.equal(grid.rows[0]?.metrics[0]?.canMarkExcused, true);
  assert.equal(grid.rows[0]?.metrics[0]?.canUnmarkExcused, false);
  assert.equal(audit.records.length, auditCount);
});

test("KPI daily actual status distinguishes timing and entered values", async () => {
  const now = { value: MAY_5_2026_NOON_HCM };
  const { service } = createHarness(() => now.value);
  const published = await createPublishedGroupPlan(service);
  const [first, second] = published.allocations as readonly [
    KpiAllocation,
    KpiAllocation,
  ];

  let grid = await service.getKpiActualDailyGrid(createActor(), {
    kpiPlanId: published.id,
    actualDate: "2026-05-06",
  });
  assert.equal(grid.rows[0]?.metrics[0]?.dailyActualStatus, "NOT_DUE");

  grid = await service.getKpiActualDailyGrid(createActor(), {
    kpiPlanId: published.id,
    actualDate: "2026-05-05",
  });
  assert.equal(grid.rows[0]?.metrics[0]?.dailyActualStatus, "DUE_OPEN");

  now.value = MAY_6_2026_10_00_HCM;
  grid = await service.getKpiActualDailyGrid(createActor(), {
    kpiPlanId: published.id,
    actualDate: "2026-05-05",
  });
  assert.equal(grid.rows[0]?.metrics[0]?.dailyActualStatus, "DUE_OPEN");

  now.value = MAY_5_2026_AFTER_LOCK_HCM;
  grid = await service.getKpiActualDailyGrid(createActor(), {
    kpiPlanId: published.id,
    actualDate: "2026-05-05",
  });
  assert.equal(grid.rows[0]?.metrics[0]?.dailyActualStatus, "OVERDUE");

  now.value = MAY_5_2026_NOON_HCM;
  await service.createOrSetKpiActual(createActor(), {
    kpiPlanId: published.id,
    allocationId: first.id,
    metricCode: "REVENUE_VND",
    actualDate: "2026-05-05",
    actualValue: 10,
  });
  await service.createOrSetKpiActual(createActor(), {
    kpiPlanId: published.id,
    allocationId: second.id,
    metricCode: "REVENUE_VND",
    actualDate: "2026-05-05",
    actualValue: 0,
  });

  grid = await service.getKpiActualDailyGrid(createActor(), {
    kpiPlanId: published.id,
    actualDate: "2026-05-05",
  });
  assert.equal(grid.rows[0]?.metrics[0]?.dailyActualStatus, "ENTERED");
  assert.equal(grid.rows[1]?.metrics[0]?.dailyActualStatus, "ENTERED_ZERO");

  const detail = await service.getKpiActualWorkspacePlanDetail(createActor(), {
    kpiPlanId: published.id,
  });
  assert.equal(detail.actualEntryStatusSummary.expectedEntryCount, 124);
  assert.equal(detail.actualEntryStatusSummary.enteredEntryCount, 2);
  assert.equal(detail.actualEntryStatusSummary.enteredZeroCount, 1);
  assert.equal(detail.actualEntryStatusSummary.overdueEntryCount, 16);
  assert.equal(detail.actualEntryStatusSummary.pendingEntryCount, 2);
  assert.equal(detail.actualEntryStatusSummary.notDueEntryCount, 104);
});

test("KPI V2 daily actual grid returns existing actual entry identity and effective value", async () => {
  const { service } = createHarness(() => MAY_5_2026_NOON_HCM);
  const published = await createPublishedGroupPlan(service);
  const allocation = published.allocations[0] as KpiAllocation;
  const created = await service.createOrSetKpiActual(createActor(), {
    kpiPlanId: published.id,
    allocationId: allocation.id,
    metricCode: "REVENUE_VND",
    actualDate: "2026-05-05",
    actualValue: 80,
  });
  await service.updateKpiActualDirect(createActor(), {
    kpiPlanId: published.id,
    actualEntryId: created.actualEntry.id,
    actualValue: 83,
  });

  const grid = await service.getKpiActualDailyGrid(createActor(), {
    kpiPlanId: published.id,
    actualDate: "2026-05-05",
  });
  const cell = grid.rows[0]?.metrics.find(
    (metric) => metric.metricCode === "REVENUE_VND",
  );

  assert.equal(cell?.actualEntryId, created.actualEntry.id);
  assert.equal(cell?.actualValue, 83);
  assert.equal(cell?.effectiveValue, 83);
  assert.equal(cell?.hasEntry, true);
  assert.equal(cell?.editCount, 1);
  assert.equal(cell?.dailyActualStatus, "ENTERED");
  assert.equal(cell?.canMarkExcused, false);
});

test("KPI actual excuses mark, unmark, summarize, and block ambiguous actuals", async () => {
  const now = { value: MAY_5_2026_AFTER_LOCK_HCM };
  const { service, repository, managerRepository, audit } = createHarness(
    () => now.value,
  );
  const published = await createPublishedGroupPlan(service);
  const [first, second] = published.allocations as readonly [
    KpiAllocation,
    KpiAllocation,
  ];
  seedManagerAssignment(managerRepository);
  const managerActor = createBackofficeTeamManagerActor();

  await service.markKpiActualExcuse(managerActor, {
    kpiPlanId: published.id,
    allocationId: first.id,
    metricCode: "REVENUE_VND",
    actualDate: "2026-05-05",
    status: "EXCUSED",
    reasonCode: "MEMBER_LEAVE",
    reasonText: "Approved leave",
  });
  await service.markKpiActualExcuse(createActor(), {
    kpiPlanId: published.id,
    allocationId: second.id,
    metricCode: "ONBOARDED_TALENT_COUNT",
    actualDate: "2026-05-05",
    status: "NOT_REQUIRED",
    reasonCode: "NO_OPERATION_REQUIRED",
    reasonText: "No onboarding scheduled",
  });

  let grid = await service.getKpiActualDailyGrid(createActor(), {
    kpiPlanId: published.id,
    actualDate: "2026-05-05",
  });
  const excusedCell = grid.rows[0]?.metrics.find(
    (metric) => metric.metricCode === "REVENUE_VND",
  );
  const notRequiredCell = grid.rows[1]?.metrics.find(
    (metric) => metric.metricCode === "ONBOARDED_TALENT_COUNT",
  );
  assert.equal(excusedCell?.dailyActualStatus, "EXCUSED");
  assert.equal(excusedCell?.actualExcuse?.reasonCode, "MEMBER_LEAVE");
  assert.equal(excusedCell?.canDirectEdit, false);
  assert.equal(excusedCell?.canMarkExcused, false);
  assert.equal(excusedCell?.canUnmarkExcused, true);
  assert.equal(excusedCell?.disabledReason, "ACTUAL_EXCUSED");
  assert.equal(notRequiredCell?.dailyActualStatus, "NOT_REQUIRED");
  assert.equal(
    notRequiredCell?.actualExcuse?.reasonText,
    "No onboarding scheduled",
  );

  const detail = await service.getKpiActualWorkspacePlanDetail(createActor(), {
    kpiPlanId: published.id,
  });
  assert.equal(detail.actualEntryStatusSummary.excusedEntryCount, 1);
  assert.equal(detail.actualEntryStatusSummary.notRequiredEntryCount, 1);
  assert.equal(detail.actualEntryStatusSummary.overdueEntryCount, 18);

  now.value = MAY_5_2026_NOON_HCM;
  await assert.rejects(
    service.createOrSetKpiActual(createActor(), {
      kpiPlanId: published.id,
      allocationId: first.id,
      metricCode: "REVENUE_VND",
      actualDate: "2026-05-05",
      actualValue: 80,
    }),
    KpiConflictError,
  );

  const excuseId = repository.actualExcuses.find(
    (excuse) =>
      excuse.kpiPlanId === published.id &&
      excuse.allocationId === first.id &&
      excuse.metricCode === "REVENUE_VND",
  )?.id;
  assert.ok(excuseId);
  await service.removeKpiActualExcuse(createActor(), {
    kpiPlanId: published.id,
    excuseId,
  });
  const created = await service.createOrSetKpiActual(createActor(), {
    kpiPlanId: published.id,
    allocationId: first.id,
    metricCode: "REVENUE_VND",
    actualDate: "2026-05-05",
    actualValue: 80,
  });
  await assert.rejects(
    service.markKpiActualExcuse(createActor(), {
      kpiPlanId: published.id,
      allocationId: first.id,
      metricCode: "REVENUE_VND",
      actualDate: "2026-05-05",
      status: "EXCUSED",
      reasonCode: "MEMBER_LEAVE",
      reasonText: "Already entered",
    }),
    KpiConflictError,
  );
  assert.equal(created.actualEntry.effectiveValue, 80);

  grid = await service.getKpiActualDailyGrid(createActor(), {
    kpiPlanId: published.id,
    actualDate: "2026-05-05",
  });
  assert.equal(grid.rows[0]?.metrics[0]?.dailyActualStatus, "ENTERED");
  assert.ok(
    audit.records.some(
      (record) =>
        record.permissionCode === Permission.KPI_ENTER_ACTUAL &&
        record.resourceId === published.id &&
        record.metadata?.mutationType === "kpi.mark-actual-excuse",
    ),
  );
  assert.ok(
    audit.records.some(
      (record) =>
        record.permissionCode === Permission.KPI_ENTER_ACTUAL &&
        record.resourceId === published.id &&
        record.metadata?.mutationType === "kpi.remove-actual-excuse",
    ),
  );
});

test("KPI actual excuses validate authority, slot shape, lifecycle, and body fields", async () => {
  const { service, repository, managerRepository } = createHarness(
    () => MAY_5_2026_NOON_HCM,
  );
  const draft = await service.createKpiPlan(createActor(), groupPlanCommand());
  const published = await createPublishedGroupPlan(service);
  const allocation = published.allocations[0] as KpiAllocation;
  const controller = new KpiAdminController(service) as unknown as {
    handle(req: Request, actor: Actor, context: "ADMIN"): Promise<unknown>;
  };

  await assert.rejects(
    service.markKpiActualExcuse(createActor(), {
      kpiPlanId: draft.id,
      allocationId: allocation.id,
      metricCode: "REVENUE_VND",
      actualDate: "2026-05-05",
      status: "EXCUSED",
      reasonCode: "MEMBER_LEAVE",
      reasonText: "Draft plan",
    }),
    KpiStateError,
  );
  await assert.rejects(
    service.markKpiActualExcuse(createBackofficeTeamManagerActor(), {
      kpiPlanId: published.id,
      allocationId: allocation.id,
      metricCode: "REVENUE_VND",
      actualDate: "2026-05-05",
      status: "EXCUSED",
      reasonCode: "MEMBER_LEAVE",
      reasonText: "No assignment",
    }),
    KpiPermissionScopeError,
  );

  seedManagerAssignment(managerRepository);
  await assert.rejects(
    service.markKpiActualExcuse(createManagerActorWithoutKpiScope(), {
      kpiPlanId: published.id,
      allocationId: allocation.id,
      metricCode: "REVENUE_VND",
      actualDate: "2026-05-05",
      status: "EXCUSED",
      reasonCode: "MEMBER_LEAVE",
      reasonText: "No scope",
    }),
    KpiPermissionScopeError,
  );
  await assert.rejects(
    service.markKpiActualExcuse(createActor(), {
      kpiPlanId: published.id,
      allocationId: allocation.id,
      metricCode: "LIVE_HOURS",
      actualDate: "2026-05-05",
      status: "EXCUSED",
      reasonCode: "MEMBER_LEAVE",
      reasonText: "Not targeted",
    }),
    KpiInvalidAllocationError,
  );
  await assert.rejects(
    service.markKpiActualExcuse(createActor(), {
      kpiPlanId: published.id,
      allocationId: allocation.id,
      metricCode: "REVENUE_VND",
      actualDate: "2026-06-01",
      status: "EXCUSED",
      reasonCode: "MEMBER_LEAVE",
      reasonText: "Outside",
    }),
    KpiValidationError,
  );

  replacePlanAllocationStatuses(repository, published.id, ["DRAFT"]);
  const draftAllocation = repository.allocations.find(
    (item) => item.kpiPlanId === published.id,
  );
  assert.ok(draftAllocation);
  await assert.rejects(
    service.markKpiActualExcuse(createActor(), {
      kpiPlanId: published.id,
      allocationId: draftAllocation.id,
      metricCode: "REVENUE_VND",
      actualDate: "2026-05-05",
      status: "EXCUSED",
      reasonCode: "MEMBER_LEAVE",
      reasonText: "Draft allocation",
    }),
    KpiInvalidAllocationError,
  );

  const req = {
    body: {
      allocationId: allocation.id,
      metricCode: "REVENUE_VND",
      actualDate: "2026-05-05",
      status: "EXCUSED",
      reasonCode: "MEMBER_LEAVE",
      reasonText: "Unknown field",
      unsupported: true,
    },
    params: { kpiPlanId: published.id },
  } as unknown as Request;
  bindCommand(req, "KPI_ACTUAL_EXCUSE_MARK");
  await assert.rejects(
    controller.handle(req, createActor(), "ADMIN"),
    KpiValidationError,
  );
});

test("KPI V2 daily actual grid includes correction summary after correction", async () => {
  const now = { value: MAY_5_2026_NOON_HCM };
  const { service } = createHarness(() => now.value);
  const published = await createPublishedGroupPlan(service);
  const allocation = published.allocations[0] as KpiAllocation;
  const created = await service.createOrSetKpiActual(createActor(), {
    kpiPlanId: published.id,
    allocationId: allocation.id,
    metricCode: "REVENUE_VND",
    actualDate: "2026-05-05",
    actualValue: 80,
  });
  now.value = MAY_5_2026_AFTER_LOCK_HCM;
  const corrected = await service.correctKpiActual(createActor(), {
    kpiPlanId: published.id,
    actualEntryId: created.actualEntry.id,
    correctedValue: 90,
    reason: "late correction",
  });

  const grid = await service.getKpiActualDailyGrid(createActor(), {
    kpiPlanId: published.id,
    actualDate: "2026-05-05",
  });
  const cell = grid.rows[0]?.metrics.find(
    (metric) => metric.metricCode === "REVENUE_VND",
  );

  assert.equal(cell?.effectiveValue, 90);
  assert.equal(cell?.correctionCount, 1);
  assert.equal(cell?.latestCorrectionId, corrected.correction.id);
  assert.equal(cell?.requiresCorrection, true);
});

test("KPI V2 daily actual grid editability is false for FINALIZED plan", async () => {
  const now = { value: MAY_5_2026_NOON_HCM };
  const { service } = createHarness(() => now.value);
  const published = await createPublishedGroupPlan(service);
  now.value = JUNE_1_2026_NOON_HCM;
  await service.finalizeKpiPlan(createActor(), { kpiPlanId: published.id });

  const grid = await service.getKpiActualDailyGrid(createActor(), {
    kpiPlanId: published.id,
    actualDate: "2026-05-05",
  });

  assert.equal(grid.editability.isDirectEditOpen, false);
  assert.equal(grid.editability.isPlanFinalized, true);
  assert.equal(grid.editability.disabledReason, "PLAN_FINALIZED");
});

test("KPI V2 backoffice TEAM_MANAGER may read actual grid for managed published group", async () => {
  const { service, managerRepository } = createHarness(
    () => MAY_5_2026_NOON_HCM,
  );
  const published = await createPublishedGroupPlan(service);
  seedManagerAssignment(managerRepository);

  const grid = await service.getKpiActualDailyGrid(
    createProgressReadOnlyBackofficeTeamManagerActor(),
    {
      kpiPlanId: published.id,
      actualDate: "2026-05-05",
    },
  );

  assert.equal(grid.rows.length, 2);
  assert.deepEqual(Object.keys(grid).sort(), [
    "actualDate",
    "editability",
    "kpiPlanId",
    "planCode",
    "policy",
    "rows",
    "status",
    "subjectId",
    "subjectType",
    "targetMetrics",
  ]);
});

test("KPI V2 manager needs managedGroup scope in addition to group mapping", async () => {
  const { service, managerRepository } = createHarness(
    () => MAY_5_2026_NOON_HCM,
  );
  const published = await createPublishedGroupPlan(service);
  seedManagerAssignment(managerRepository);

  await assert.rejects(
    service.getKpiActualDailyGrid(createManagerActorWithoutKpiScope(), {
      kpiPlanId: published.id,
      actualDate: "2026-05-05",
    }),
    KpiPermissionScopeError,
  );
});

test("KPI V2 actual grid fails closed for manager without group mapping", async () => {
  const { service } = createHarness(() => MAY_5_2026_NOON_HCM);
  const published = await createPublishedGroupPlan(service);

  await assert.rejects(
    service.getKpiActualDailyGrid(createManagerActor(), {
      kpiPlanId: published.id,
      actualDate: "2026-05-05",
    }),
    KpiPermissionScopeError,
  );
});

test("KPI actual grid managed read denies missing permission, scope, profile, assignment, lifecycle, subject, and unmanaged group", async () => {
  const { service, repository, managerRepository } = createHarness(
    () => MAY_5_2026_NOON_HCM,
  );
  const published = await createPublishedGroupPlan(service);
  const draft = await service.createKpiPlan(createActor(), groupPlanCommand());
  const talentPlan: KpiPlan = {
    ...published,
    id: "managed-grid-talent-plan",
    subjectType: "TALENT",
    subjectId: "talent-1",
  };
  repository.plans.push(talentPlan);

  const readGrid = (actor: Actor, kpiPlanId = published.id) =>
    service.getKpiActualDailyGrid(actor, {
      kpiPlanId,
      actualDate: "2026-05-05",
    });

  seedManagerAssignment(managerRepository);

  await assert.rejects(
    readGrid(
      createProgressReadOnlyBackofficeTeamManagerActor({ permissions: [] }),
    ),
    /Missing permission kpi.readProgress/u,
  );
  await assert.rejects(
    readGrid(
      createProgressReadOnlyBackofficeTeamManagerActor({
        kpiScopes: [],
      }),
    ),
    KpiPermissionScopeError,
  );
  await assert.rejects(
    readGrid(
      createProgressReadOnlyBackofficeTeamManagerActor({
        id: "unlinked-manager-user",
      }),
    ),
    KpiPermissionScopeError,
  );

  managerRepository.assignments.length = 0;
  await assert.rejects(
    readGrid(createProgressReadOnlyBackofficeTeamManagerActor()),
    KpiPermissionScopeError,
  );

  seedManagerAssignment(managerRepository, "group-2");
  await assert.rejects(
    readGrid(createProgressReadOnlyBackofficeTeamManagerActor()),
    KpiPermissionScopeError,
  );

  managerRepository.assignments.length = 0;
  seedManagerAssignment(managerRepository);
  await assert.rejects(
    readGrid(createProgressReadOnlyBackofficeTeamManagerActor(), draft.id),
    KpiPermissionScopeError,
  );
  await assert.rejects(
    readGrid(createProgressReadOnlyBackofficeTeamManagerActor(), talentPlan.id),
    KpiPermissionScopeError,
  );
});

test("KPI V2 manager cannot read progress for unmanaged talent group", async () => {
  const { service, managerRepository } = createHarness(
    () => MAY_5_2026_NOON_HCM,
  );
  const published = await createPublishedGroupPlan(service);
  seedManagerAssignment(managerRepository, "group-2");

  await assert.rejects(
    service.getKpiProgress(createManagerActor(), {
      kpiPlanId: published.id,
    }),
    KpiPermissionScopeError,
  );
});

test("KPI managed-group progress allows read-only backoffice TEAM_MANAGER under strict authority", async () => {
  const { service, managerRepository } = createHarness(
    () => MAY_5_2026_NOON_HCM,
  );
  const published = await createPublishedGroupPlan(service);
  seedManagerAssignment(managerRepository);

  const progress = await service.getKpiProgress(
    createProgressReadOnlyBackofficeTeamManagerActor(),
    { kpiPlanId: published.id },
  );

  assert.ok(progress.memberProgress.length > 0);
});

test("KPI managed-group progress denies missing permission, scope, profile, assignment, lifecycle, subject, and ADMIN context", async () => {
  const { service, repository, managerRepository } = createHarness(
    () => MAY_5_2026_NOON_HCM,
  );
  const published = await createPublishedGroupPlan(service);
  const draft = await service.createKpiPlan(createActor(), groupPlanCommand());
  const talentPlan: KpiPlan = {
    ...published,
    id: "managed-progress-talent-plan",
    planCode: "KPI-202605-999998",
    subjectType: "TALENT",
    subjectId: "talent-1",
  };
  const unmanagedPlan: KpiPlan = {
    ...published,
    id: "managed-progress-unmanaged-plan",
    planCode: "KPI-202605-999999",
    subjectId: "group-2",
  };
  repository.plans.push(talentPlan, unmanagedPlan);
  const readProgress = { kpiPlanId: published.id };

  await assert.rejects(
    service.getKpiProgress(
      createProgressReadOnlyBackofficeTeamManagerActor({ permissions: [] }),
      readProgress,
    ),
    /Missing permission kpi.readProgress/u,
  );
  await assert.rejects(
    service.getKpiProgress(
      createProgressReadOnlyBackofficeTeamManagerActor({ kpiScopes: [] }),
      readProgress,
    ),
    KpiPermissionScopeError,
  );
  await assert.rejects(
    service.getKpiProgress(
      createProgressReadOnlyBackofficeTeamManagerActor({
        id: "unlinked-manager-user",
      }),
      readProgress,
    ),
    KpiPermissionScopeError,
  );
  await assert.rejects(
    service.getKpiProgress(
      createProgressReadOnlyBackofficeTeamManagerActor(),
      readProgress,
    ),
    KpiPermissionScopeError,
  );

  seedManagerAssignment(managerRepository);

  await assert.rejects(
    service.getKpiProgress(createProgressReadOnlyBackofficeTeamManagerActor(), {
      kpiPlanId: unmanagedPlan.id,
    }),
    KpiPermissionScopeError,
  );
  await assert.rejects(
    service.getKpiProgress(createProgressReadOnlyBackofficeTeamManagerActor(), {
      kpiPlanId: draft.id,
    }),
    KpiPermissionScopeError,
  );
  await assert.rejects(
    service.getKpiProgress(createProgressReadOnlyBackofficeTeamManagerActor(), {
      kpiPlanId: talentPlan.id,
    }),
    KpiPermissionScopeError,
  );
  await assert.rejects(
    service.getKpiProgress(
      createProgressReadOnlyBackofficeTeamManagerActor({
        context: "SELF_SERVICE",
      }),
      readProgress,
    ),
    /Permission kpi.readProgress not allowed in SELF_SERVICE/u,
  );
});

test("KPI global progress remains available and excludes every nonofficial allocation status", async () => {
  const { service, repository } = createHarness(() => MAY_5_2026_NOON_HCM);
  const published = await createPublishedGroupPlan(service);
  replacePlanAllocationStatuses(repository, published.id, [
    "DRAFT",
    "PENDING_APPROVAL",
    "APPROVED",
    "PUBLISHED",
    "REJECTED",
    "ACTIVE",
    "CLOSED",
    "CANCELLED",
  ]);

  const progress = await service.getKpiProgress(createActor(), {
    kpiPlanId: published.id,
  });

  assert.ok(progress.memberProgress.length > 0);
  assert.ok(
    progress.memberProgress.every((item) =>
      item.allocationId.includes("-PUBLISHED-"),
    ),
  );
});

test("KPI read-progress manager can read actual grid and managed correction history but not mutate actuals", async () => {
  const { service, managerRepository } = createHarness(
    () => MAY_5_2026_NOON_HCM,
  );
  const published = await createPublishedGroupPlan(service);
  const allocation = published.allocations[0] as KpiAllocation;
  seedManagerAssignment(managerRepository);
  const managerActor = createProgressReadOnlyBackofficeTeamManagerActor();
  const actual = await service.createOrSetKpiActual(createActor(), {
    kpiPlanId: published.id,
    allocationId: allocation.id,
    metricCode: "REVENUE_VND",
    actualDate: "2026-05-05",
    actualValue: 80,
  });

  await assert.rejects(
    service.createOrSetKpiActual(managerActor, {
      kpiPlanId: published.id,
      allocationId: allocation.id,
      metricCode: "REVENUE_VND",
      actualDate: "2026-05-05",
      actualValue: 90,
    }),
    /Missing permission kpi.enterActual/u,
  );
  const grid = await service.getKpiActualDailyGrid(managerActor, {
    kpiPlanId: published.id,
    actualDate: "2026-05-05",
  });
  assert.equal(grid.rows.length, 2);
  const history = await service.listKpiActualCorrections(managerActor, {
    kpiPlanId: published.id,
    actualEntryId: actual.actualEntry.id,
  });
  assert.deepEqual(history.items, []);
});

test("KPI V2 global list plans still works", async () => {
  const { service } = createHarness();
  const draft = await service.createKpiPlan(createActor(), groupPlanCommand());

  const result = await service.listKpiPlans(createActor(), {});
  const detail = await service.getKpiPlanDetail(createActor(), {
    kpiPlanId: draft.id,
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.status, "DRAFT");
  assert.equal(detail.status, "DRAFT");
});

test("KPI V2 global list preserves same-period planCode ordering", async () => {
  const { service, repository } = createHarness();
  const alpha = await service.createKpiPlan(createActor(), groupPlanCommand());
  const zulu = await service.createKpiPlan(createActor(), {
    ...groupPlanCommand(),
    title: "May group KPI zulu",
  });

  replaceStoredPlan(repository, alpha.id, {
    id: "same-period-id-b",
    planCode: "KPI-ALPHA",
    normalizedPlanCode: "kpi-alpha",
  });
  replaceStoredPlan(repository, zulu.id, {
    id: "same-period-id-a",
    planCode: "KPI-ZULU",
    normalizedPlanCode: "kpi-zulu",
  });

  const result = await service.listKpiPlans(createActor(), {
    periodMonth: "2026-05",
    sortBy: "periodMonth",
    sortDirection: "DESC",
  });

  assert.deepEqual(
    result.items.map((item) => item.id),
    ["same-period-id-b", "same-period-id-a"],
  );
});

test("KPI V2 global list includes allocation workflow summaries from batched allocation counts", async () => {
  const { service, repository } = createHarness(() => MAY_5_2026_NOON_HCM);
  const zeroAllocationPlan = await service.createKpiPlan(
    createActor(),
    groupPlanCommand(),
  );
  const summaryPlan = await createPublishedGroupPlan(service);
  replacePlanAllocationStatuses(repository, summaryPlan.id, [
    "DRAFT",
    "PENDING_APPROVAL",
    "APPROVED",
    "PUBLISHED",
    "REJECTED",
    "ACTIVE",
    "CLOSED",
    "CANCELLED",
  ]);
  repository.countAllocationsByPlanIdsCallCount = 0;
  repository.listAllocationsByPlanIdCallCount = 0;

  const result = await service.listKpiPlans(createActor(), {});
  const summaryItem = result.items.find((item) => item.id === summaryPlan.id);
  const zeroItem = result.items.find(
    (item) => item.id === zeroAllocationPlan.id,
  );

  assert.ok(summaryItem);
  assert.ok(zeroItem);
  assert.equal(repository.countAllocationsByPlanIdsCallCount, 1);
  assert.equal(repository.listAllocationsByPlanIdCallCount, 0);
  assert.equal(
    Object.prototype.hasOwnProperty.call(summaryItem, "allocationStatus"),
    false,
  );
  assert.deepEqual(summaryItem.allocationWorkflowSummary, {
    total: 8,
    byStatus: {
      draft: 1,
      pendingApproval: 1,
      approved: 1,
      published: 1,
      rejected: 1,
      active: 1,
      closed: 1,
      cancelled: 1,
    },
    hasDraft: true,
    hasPendingApproval: true,
    hasApproved: true,
    hasPublished: true,
    hasRejected: true,
    hasLegacyActive: true,
    officialPublishedCount: 1,
  });
  assert.deepEqual(zeroItem.allocationWorkflowSummary, {
    total: 0,
    byStatus: {
      draft: 0,
      pendingApproval: 0,
      approved: 0,
      published: 0,
      rejected: 0,
      active: 0,
      closed: 0,
      cancelled: 0,
    },
    hasDraft: false,
    hasPendingApproval: false,
    hasApproved: false,
    hasPublished: false,
    hasRejected: false,
    hasLegacyActive: false,
    officialPublishedCount: 0,
  });
  assert.deepEqual(
    KpiPlanListExposure.expose(summaryItem).allocationWorkflowSummary,
    summaryItem.allocationWorkflowSummary,
  );
});

test("KPI V2 managedGroup list returns only published managed talent-group plans", async () => {
  const { service, repository, managerRepository, subjectAccess } =
    createHarness(() => MAY_5_2026_NOON_HCM);
  const managed = await createPublishedGroupPlan(service);
  repository.plans.push(
    {
      ...managed,
      id: "managed-draft-plan",
      planCode: "KPI-202605-999995",
      status: "DRAFT",
      publishedAt: null,
      publishedByActorId: null,
    },
    {
      ...managed,
      id: "managed-finalized-plan",
      planCode: "KPI-202605-999996",
      status: "FINALIZED",
    },
    {
      ...managed,
      id: "managed-archived-plan",
      planCode: "KPI-202605-999997",
      status: "ARCHIVED",
    },
    {
      ...managed,
      id: "managed-talent-plan",
      planCode: "KPI-202605-999998",
      subjectType: "TALENT",
      subjectId: "talent-1",
    },
    {
      ...managed,
      id: "unmanaged-plan",
      planCode: "KPI-202605-999999",
      subjectId: "group-2",
      createdAt: managed.createdAt + 1,
      updatedAt: managed.updatedAt + 1,
    },
  );
  seedManagerAssignment(managerRepository, "group-1");
  subjectAccess.listSubjectRefsSubjects.length = 0;

  const result = await service.listKpiPlans(createManagerActor(), {});
  const draftResult = await service.listKpiPlans(createManagerActor(), {
    status: "DRAFT",
  });

  assert.deepEqual(
    result.items.map((item) => item.id),
    [managed.id],
  );
  assert.equal(result.items[0]?.subjectRef?.displayName, "Creator Team");
  assert.deepEqual(
    subjectAccess.listSubjectRefsSubjects.map(
      (subject) => `${subject.subjectType}:${subject.subjectId}`,
    ),
    ["TALENT_GROUP:group-1"],
  );
  assert.deepEqual(draftResult.items, []);
});

test("KPI V2 managedGroup list summarizes only visible plans without member details", async () => {
  const { service, repository, managerRepository, subjectAccess } =
    createHarness(() => MAY_5_2026_NOON_HCM);
  const managed = await createPublishedGroupPlan(service);
  const hiddenPlan = {
    ...managed,
    id: "hidden-summary-plan",
    planCode: "KPI-202605-999997",
    subjectId: "group-2",
  };
  repository.plans.push(hiddenPlan);
  const templateAllocation = repository.allocations.find(
    (allocation) => allocation.kpiPlanId === managed.id,
  );
  assert.ok(templateAllocation);
  repository.allocations.push({
    ...templateAllocation,
    id: "hidden-summary-allocation",
    kpiPlanId: hiddenPlan.id,
    subjectId: hiddenPlan.subjectId,
    groupId: hiddenPlan.subjectId,
    allocationStatus: "REJECTED",
  });
  seedManagerAssignment(managerRepository, "group-1");
  repository.countAllocationsByPlanIdsCallCount = 0;
  subjectAccess.listSubjectRefsSubjects.length = 0;

  const result = await service.listKpiPlans(createManagerActor(), {});

  assert.deepEqual(
    result.items.map((item) => item.id),
    [managed.id],
  );
  assert.equal(repository.countAllocationsByPlanIdsCallCount, 1);
  assert.equal(result.items[0]?.subjectRef?.displayName, "Creator Team");
  assert.deepEqual(
    subjectAccess.listSubjectRefsSubjects.map(
      (subject) => `${subject.subjectType}:${subject.subjectId}`,
    ),
    ["TALENT_GROUP:group-1"],
  );
  assert.equal(result.items[0]?.allocationWorkflowSummary.total, 2);
  assert.equal(
    result.items[0]?.allocationWorkflowSummary.byStatus.published,
    2,
  );
  assert.equal(result.items[0]?.allocationWorkflowSummary.byStatus.rejected, 0);
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      result.items[0]?.allocationWorkflowSummary,
      "memberTalentId",
    ),
    false,
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      result.items[0]?.allocationWorkflowSummary,
      "allocations",
    ),
    false,
  );
});

test("KPI V2 managedGroup list returns empty without active manager assignment", async () => {
  const { service } = createHarness(() => MAY_5_2026_NOON_HCM);
  await createPublishedGroupPlan(service);

  const result = await service.listKpiPlans(createManagerActor(), {});

  assert.deepEqual(result.items, []);
});

test("KPI V2 managedGroup detail allows managed plan", async () => {
  const { service, managerRepository, subjectAccess } = createHarness(
    () => MAY_5_2026_NOON_HCM,
  );
  const managed = await createPublishedGroupPlan(service);
  seedManagerAssignment(managerRepository, "group-1");
  subjectAccess.listSubjectRefsSubjects.length = 0;

  const detail = await service.getKpiPlanDetail(createManagerActor(), {
    kpiPlanId: managed.id,
  });

  assert.equal(detail.id, managed.id);
  assert.equal(detail.subjectRef?.displayName, "Creator Team");
  assert.deepEqual(
    subjectAccess.listSubjectRefsSubjects.map(
      (subject) => `${subject.subjectType}:${subject.subjectId}`,
    ),
    ["TALENT_GROUP:group-1"],
  );
});

test("KPI V2 managedGroup detail denies unmanaged plan", async () => {
  const { service, repository, managerRepository, subjectAccess } =
    createHarness(() => MAY_5_2026_NOON_HCM);
  const managed = await createPublishedGroupPlan(service);
  const unmanagedPlan: KpiPlan = {
    ...managed,
    id: "unmanaged-plan",
    planCode: "KPI-202605-999999",
    subjectId: "group-2",
    createdAt: managed.createdAt + 1,
    updatedAt: managed.updatedAt + 1,
  };
  repository.plans.push(unmanagedPlan);
  seedManagerAssignment(managerRepository, "group-1");
  subjectAccess.listSubjectRefsSubjects.length = 0;

  await assert.rejects(
    service.getKpiPlanDetail(createManagerActor(), {
      kpiPlanId: unmanagedPlan.id,
    }),
    KpiPermissionScopeError,
  );
  assert.deepEqual(subjectAccess.listSubjectRefsSubjects, []);
});

test("KPI V2 managedGroup detail denies non-published and non-group plans", async () => {
  const { service, repository, managerRepository } = createHarness(
    () => MAY_5_2026_NOON_HCM,
  );
  const managed = await createPublishedGroupPlan(service);
  const hiddenPlans: readonly KpiPlan[] = [
    {
      ...managed,
      id: "managed-draft-plan",
      planCode: "KPI-202605-999995",
      status: "DRAFT",
      publishedAt: null,
      publishedByActorId: null,
    },
    {
      ...managed,
      id: "managed-finalized-plan",
      planCode: "KPI-202605-999996",
      status: "FINALIZED",
    },
    {
      ...managed,
      id: "managed-archived-plan",
      planCode: "KPI-202605-999997",
      status: "ARCHIVED",
    },
    {
      ...managed,
      id: "managed-talent-plan",
      planCode: "KPI-202605-999998",
      subjectType: "TALENT",
      subjectId: "talent-1",
    },
  ];
  repository.plans.push(...hiddenPlans);
  seedManagerAssignment(managerRepository, "group-1");

  for (const plan of hiddenPlans) {
    await assert.rejects(
      service.getKpiPlanDetail(createManagerActor(), {
        kpiPlanId: plan.id,
      }),
      KpiPermissionScopeError,
    );
  }
});

test("KPI V2 talent with self scope can read own progress but not full grid", async () => {
  const { service } = createHarness(() => MAY_5_2026_NOON_HCM);
  const published = await createPublishedGroupPlan(service);

  const progress = await service.getMyKpiProgress(createTalentActor(), {
    kpiPlanId: published.id,
  });

  assert.deepEqual(
    Array.from(
      new Set(progress.memberProgress.map((member) => member.memberTalentId)),
    ),
    ["talent-1"],
  );
  await assert.rejects(
    service.getKpiActualDailyGrid(createTalentActor(), {
      kpiPlanId: published.id,
      actualDate: "2026-05-05",
    }),
    KpiPermissionScopeError,
  );
});

test("KPI V2 read-only KPI roles cannot mutate actuals", async () => {
  const { service } = createHarness(() => MAY_5_2026_NOON_HCM);
  const published = await createPublishedGroupPlan(service);
  const allocation = published.allocations[0] as KpiAllocation;

  await assert.rejects(
    service.createOrSetKpiActual(createKpiReadOnlyActor(), {
      kpiPlanId: published.id,
      allocationId: allocation.id,
      metricCode: "REVENUE_VND",
      actualDate: "2026-05-05",
      actualValue: 80,
    }),
    /Missing permission kpi.enterActual/u,
  );
});

test("KPI V2 correction history rejects actual entry outside plan", async () => {
  const { service } = createHarness(() => MAY_5_2026_NOON_HCM);
  const firstPlan = await createPublishedGroupPlan(service);
  const firstAllocation = firstPlan.allocations[0] as KpiAllocation;
  const created = await service.createOrSetKpiActual(createActor(), {
    kpiPlanId: firstPlan.id,
    allocationId: firstAllocation.id,
    metricCode: "REVENUE_VND",
    actualDate: "2026-05-05",
    actualValue: 80,
  });
  const secondPlan = await createPublishedGroupPlan(service);

  await assert.rejects(
    service.listKpiActualCorrections(createActor(), {
      kpiPlanId: secondPlan.id,
      actualEntryId: created.actualEntry.id,
    }),
    KpiNotFoundError,
  );
});

test("KPI V2 correction history returns corrections ordered by correctedAt", async () => {
  const now = { value: MAY_5_2026_NOON_HCM };
  const { service, audit } = createHarness(() => now.value);
  const published = await createPublishedGroupPlan(service);
  const allocation = published.allocations[0] as KpiAllocation;
  const created = await service.createOrSetKpiActual(createActor(), {
    kpiPlanId: published.id,
    allocationId: allocation.id,
    metricCode: "REVENUE_VND",
    actualDate: "2026-05-05",
    actualValue: 80,
  });
  now.value = MAY_5_2026_AFTER_LOCK_HCM + 2;
  const second = await service.correctKpiActual(createActor(), {
    kpiPlanId: published.id,
    actualEntryId: created.actualEntry.id,
    correctedValue: 90,
    reason: "second",
  });
  now.value -= 1;
  const first = await service.correctKpiActual(createActor(), {
    kpiPlanId: published.id,
    actualEntryId: created.actualEntry.id,
    correctedValue: 85,
    reason: "first",
  });
  const auditCount = audit.records.length;

  const history = await service.listKpiActualCorrections(createActor(), {
    kpiPlanId: published.id,
    actualEntryId: created.actualEntry.id,
  });

  assert.deepEqual(
    history.items.map((item) => item.id),
    [first.correction.id, second.correction.id],
  );
  assert.equal(audit.records.length, auditCount);
});

test("KPI correction rejects the direct-edit window through exact cutoff and allows repeated post-cutoff audit corrections", async () => {
  const now = { value: MAY_5_2026_NOON_HCM };
  const { service } = createHarness(() => now.value);
  const published = await createPublishedGroupPlan(service);
  const allocation = published.allocations[0] as KpiAllocation;
  const created = await service.createOrSetKpiActual(createActor(), {
    kpiPlanId: published.id,
    allocationId: allocation.id,
    metricCode: "REVENUE_VND",
    actualDate: "2026-05-05",
    actualValue: 80,
  });

  await assert.rejects(
    service.correctKpiActual(createKpiReadOnlyActor(), {
      kpiPlanId: published.id,
      actualEntryId: created.actualEntry.id,
      correctedValue: 90,
      reason: "global permission required",
    }),
    /Missing permission kpi.correctActual/u,
  );
  await assert.rejects(
    service.correctKpiActual(createActor(), {
      kpiPlanId: published.id,
      actualEntryId: created.actualEntry.id,
      correctedValue: 90,
      reason: "too early",
    }),
    /only after the direct edit window closes/u,
  );
  now.value = MAY_6_2026_10_00_HCM;
  await assert.rejects(
    service.correctKpiActual(createActor(), {
      kpiPlanId: published.id,
      actualEntryId: created.actualEntry.id,
      correctedValue: 90,
      reason: "still too early",
    }),
    /only after the direct edit window closes/u,
  );
  now.value = MAY_5_2026_AFTER_LOCK_HCM;
  await assert.rejects(
    service.correctKpiActual(createActor(), {
      kpiPlanId: published.id,
      actualEntryId: created.actualEntry.id,
      correctedValue: Number.NaN,
      reason: "invalid numeric value",
    }),
    KpiValidationError,
  );
  const first = await service.correctKpiActual(createActor(), {
    kpiPlanId: published.id,
    actualEntryId: created.actualEntry.id,
    correctedValue: 90,
    reason: "first post-cutoff correction",
  });
  const second = await service.correctKpiActual(createActor(), {
    kpiPlanId: published.id,
    actualEntryId: created.actualEntry.id,
    correctedValue: 95,
    reason: "second post-cutoff correction",
  });

  assert.equal(first.actualEntry.actualValue, 80);
  assert.equal(first.actualEntry.effectiveValue, 90);
  assert.equal(second.correction.previousValue, 90);
  assert.equal(second.actualEntry.actualValue, 80);
  assert.equal(second.actualEntry.effectiveValue, 95);
  assert.equal(second.actualEntry.correctionCount, 2);
});

test("KPI backoffice TEAM_MANAGER can correct and read managed history only under strict managed authority", async () => {
  const now = { value: MAY_5_2026_NOON_HCM };
  const { service, managerRepository } = createHarness(() => now.value);
  const published = await createPublishedGroupPlan(service);
  const allocation = published.allocations[0] as KpiAllocation;
  const created = await service.createOrSetKpiActual(createActor(), {
    kpiPlanId: published.id,
    allocationId: allocation.id,
    metricCode: "REVENUE_VND",
    actualDate: "2026-05-05",
    actualValue: 80,
  });
  now.value = MAY_5_2026_AFTER_LOCK_HCM;
  seedManagerAssignment(managerRepository);
  const manager = createBackofficeTeamManagerActor();

  const corrected = await service.correctKpiActual(manager, {
    kpiPlanId: published.id,
    actualEntryId: created.actualEntry.id,
    correctedValue: 90,
    reason: "managed correction",
  });
  const managedHistory = await service.listKpiActualCorrections(manager, {
    kpiPlanId: published.id,
    actualEntryId: created.actualEntry.id,
  });
  const globalHistory = await service.listKpiActualCorrections(createActor(), {
    kpiPlanId: published.id,
    actualEntryId: created.actualEntry.id,
  });
  const exposed = KpiActualCorrectionExposure.expose(corrected.correction);

  assert.deepEqual(managedHistory.items, globalHistory.items);
  assert.equal(managedHistory.items[0]?.id, corrected.correction.id);
  assert.equal(
    Object.prototype.hasOwnProperty.call(exposed, "correctedByActorId"),
    false,
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(exposed, "memberTalentId"),
    false,
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(exposed, "memberEmploymentProfileId"),
    false,
  );

  managerRepository.assignments.length = 0;
  seedManagerAssignment(managerRepository, "group-2");
  await assert.rejects(
    service.correctKpiActual(manager, {
      kpiPlanId: published.id,
      actualEntryId: created.actualEntry.id,
      correctedValue: 91,
      reason: "unmanaged correction",
    }),
    KpiPermissionScopeError,
  );
  await assert.rejects(
    service.listKpiActualCorrections(manager, {
      kpiPlanId: published.id,
      actualEntryId: created.actualEntry.id,
    }),
    KpiPermissionScopeError,
  );
  await assert.rejects(
    service.correctKpiActual(
      createScopedActor({
        id: "manager-user",
        permissions: [Permission.KPI_CORRECT_ACTUAL],
      }),
      {
        kpiPlanId: published.id,
        actualEntryId: created.actualEntry.id,
        correctedValue: 91,
        reason: "missing managed scope",
      },
    ),
    KpiPermissionScopeError,
  );
  await assert.rejects(
    service.correctKpiActual(
      createScopedActor({
        id: "unlinked-manager-user",
        permissions: [Permission.KPI_CORRECT_ACTUAL],
        kpiScopes: ["managedGroup"],
      }),
      {
        kpiPlanId: published.id,
        actualEntryId: created.actualEntry.id,
        correctedValue: 91,
        reason: "missing linked profile",
      },
    ),
    KpiPermissionScopeError,
  );
  await assert.rejects(
    service.correctKpiActual(
      createProgressReadOnlyBackofficeTeamManagerActor(),
      {
        kpiPlanId: published.id,
        actualEntryId: created.actualEntry.id,
        correctedValue: 91,
        reason: "missing permission",
      },
    ),
    /Missing permission kpi.correctActual/u,
  );
});

test("KPI correction rejects stale entry mismatches, invalid allocation state, and active excuse conflicts", async () => {
  const now = { value: MAY_5_2026_NOON_HCM };
  const { service, repository, actualRepository } = createHarness(
    () => now.value,
  );
  const published = await createPublishedGroupPlan(service);
  const [allocation, otherAllocation] = published.allocations as readonly [
    KpiAllocation,
    KpiAllocation,
  ];
  const created = await service.createOrSetKpiActual(createActor(), {
    kpiPlanId: published.id,
    allocationId: allocation.id,
    metricCode: "REVENUE_VND",
    actualDate: "2026-05-05",
    actualValue: 80,
  });
  now.value = MAY_5_2026_AFTER_LOCK_HCM;
  const entryIndex = actualRepository.entries.findIndex(
    (entry) => entry.id === created.actualEntry.id,
  );
  const allocationIndex = repository.allocations.findIndex(
    (item) => item.id === allocation.id,
  );
  assert.notEqual(entryIndex, -1);
  assert.notEqual(allocationIndex, -1);
  const originalEntry = actualRepository.entries[entryIndex] as KpiActualEntry;
  const originalAllocation = repository.allocations[
    allocationIndex
  ] as KpiAllocation;
  const correct = () =>
    service.correctKpiActual(createActor(), {
      kpiPlanId: published.id,
      actualEntryId: created.actualEntry.id,
      correctedValue: 90,
      reason: "validated correction",
    });

  actualRepository.entries[entryIndex] = {
    ...originalEntry,
    actualDate: "2026-06-01",
  };
  await assert.rejects(correct(), KpiValidationError);
  actualRepository.entries[entryIndex] = {
    ...originalEntry,
    memberTalentId: "talent-other",
  };
  await assert.rejects(correct(), KpiInvalidAllocationError);
  actualRepository.entries[entryIndex] = {
    ...originalEntry,
    allocationId: otherAllocation.id,
  };
  await assert.rejects(correct(), KpiInvalidAllocationError);
  actualRepository.entries[entryIndex] = {
    ...originalEntry,
    metricCode: "LIVE_HOURS",
  };
  await assert.rejects(correct(), KpiInvalidAllocationError);
  actualRepository.entries[entryIndex] = originalEntry;
  repository.allocations[allocationIndex] = {
    ...originalAllocation,
    groupId: "group-2",
  };
  await assert.rejects(correct(), KpiInvalidAllocationError);
  repository.allocations[allocationIndex] = {
    ...originalAllocation,
    allocationStatus: "DRAFT",
  };
  await assert.rejects(correct(), KpiInvalidAllocationError);
  repository.allocations[allocationIndex] = originalAllocation;

  repository.actualExcuses.push({
    id: "conflicting-excuse",
    kpiPlanId: published.id,
    allocationId: allocation.id,
    metricCode: "REVENUE_VND",
    actualDate: "2026-05-05",
    status: "EXCUSED",
    reasonCode: "MEMBER_LEAVE",
    reasonText: "Approved leave",
    createdAt: MAY_5_2026_NOON_HCM,
    createdByActorId: "manager-user",
    updatedAt: MAY_5_2026_NOON_HCM,
    updatedByActorId: "manager-user",
    deletedAt: null,
    deletedByActorId: null,
  });
  await assert.rejects(correct(), KpiConflictError);
  repository.actualExcuses[0] = {
    ...repository.actualExcuses[0]!,
    status: "NOT_REQUIRED",
    reasonCode: "NO_OPERATION_REQUIRED",
  };
  await assert.rejects(correct(), KpiConflictError);
  await service.removeKpiActualExcuse(createActor(), {
    kpiPlanId: published.id,
    excuseId: "conflicting-excuse",
  });
  const corrected = await correct();
  assert.equal(corrected.actualEntry.effectiveValue, 90);
});

test("KPI V2 list plans searches by planCode", async () => {
  const { service } = createHarness();
  const first = await service.createKpiPlan(createActor(), groupPlanCommand());
  await service.createKpiPlan(createActor(), {
    ...groupPlanCommand(),
    periodMonth: "2026-06",
    periodStartAt: JUNE_2026_START_AT,
    periodEndAt: JUNE_2026_END_AT,
    title: "Other KPI",
  });

  const result = await service.listKpiPlans(createActor(), {
    search: first.planCode,
  });

  assert.deepEqual(
    result.items.map((item) => item.id),
    [first.id],
  );
});

test("KPI V2 list plans searches by title", async () => {
  const { service } = createHarness();
  const first = await service.createKpiPlan(createActor(), {
    ...groupPlanCommand(),
    title: "North creator payout KPI",
  });
  await service.createKpiPlan(createActor(), {
    ...groupPlanCommand(),
    periodMonth: "2026-06",
    periodStartAt: JUNE_2026_START_AT,
    periodEndAt: JUNE_2026_END_AT,
    title: "Other KPI",
  });

  const result = await service.listKpiPlans(createActor(), {
    search: "creator payout",
  });

  assert.deepEqual(
    result.items.map((item) => item.id),
    [first.id],
  );
});

test("KPI V2 finalize rejects before period end", async () => {
  const { service } = createHarness(() => MAY_5_2026_NOON_HCM);
  const published = await createPublishedGroupPlan(service);

  await assert.rejects(
    service.finalizeKpiPlan(createActor(), { kpiPlanId: published.id }),
    KpiStateError,
  );
});

test("KPI V2 manual finalize rejects during closing window and allows after D+1 10:00", async () => {
  const now = { value: MAY_5_2026_NOON_HCM };
  const { service } = createHarness(() => now.value);
  const published = await createPublishedGroupPlan(service);
  const allocation = published.allocations[0] as KpiAllocation;
  const actual = await service.createOrSetKpiActual(createActor(), {
    kpiPlanId: published.id,
    allocationId: allocation.id,
    metricCode: "REVENUE_VND",
    actualDate: "2026-05-05",
    actualValue: 80,
  });

  now.value = JUNE_1_2026_09_30_HCM;
  await assert.rejects(
    service.finalizeKpiPlan(createActor(), { kpiPlanId: published.id }),
    KpiStateError,
  );

  now.value = JUNE_1_2026_10_01_HCM;
  const finalized = await service.finalizeKpiPlan(createActor(), {
    kpiPlanId: published.id,
  });
  assert.equal(finalized.status, "FINALIZED");

  await assert.rejects(
    service.updateKpiActualDirect(createActor(), {
      kpiPlanId: published.id,
      actualEntryId: actual.actualEntry.id,
      actualValue: 81,
    }),
    KpiStateError,
  );
  await assert.rejects(
    service.createOrSetKpiActual(createActor(), {
      kpiPlanId: published.id,
      allocationId: allocation.id,
      metricCode: "ONBOARDED_TALENT_COUNT",
      actualDate: "2026-05-05",
      actualValue: 0,
    }),
    KpiStateError,
  );
});

test("KPI V2 finalize persists operational final result snapshot", async () => {
  const now = { value: MAY_5_2026_NOON_HCM };
  const { service, repository, actualRepository } = createHarness(
    () => now.value,
  );
  const published = await createPublishedGroupPlan(service);
  const firstIndex = repository.allocations.findIndex(
    (allocation) =>
      allocation.kpiPlanId === published.id &&
      allocation.memberTalentId === "talent-1",
  );
  const secondAllocation = repository.allocations.find(
    (allocation) =>
      allocation.kpiPlanId === published.id &&
      allocation.memberTalentId === "talent-2",
  );
  assert.notEqual(firstIndex, -1);
  const firstAllocation = repository.allocations[firstIndex] as KpiAllocation;
  assert.ok(secondAllocation);
  repository.allocations[firstIndex] = {
    ...firstAllocation,
    targetMetrics: firstAllocation.targetMetrics.map((metric) =>
      metric.metricCode === "REVENUE_VND"
        ? { ...metric, targetValue: 150 }
        : metric,
    ),
  };
  const updatedFirstAllocation = repository.allocations[
    firstIndex
  ] as KpiAllocation;

  const created = await service.createOrSetKpiActual(createActor(), {
    kpiPlanId: published.id,
    allocationId: updatedFirstAllocation.id,
    metricCode: "REVENUE_VND",
    actualDate: "2026-05-05",
    actualValue: 80,
  });
  await service.createOrSetKpiActual(createActor(), {
    kpiPlanId: published.id,
    allocationId: secondAllocation.id,
    metricCode: "REVENUE_VND",
    actualDate: "2026-05-05",
    actualValue: 0,
  });

  now.value = MAY_5_2026_AFTER_LOCK_HCM;
  await service.correctKpiActual(createActor(), {
    kpiPlanId: published.id,
    actualEntryId: created.actualEntry.id,
    correctedValue: 90,
    reason: "final close correction",
  });
  await service.markKpiActualExcuse(createActor(), {
    kpiPlanId: published.id,
    allocationId: updatedFirstAllocation.id,
    metricCode: "ONBOARDED_TALENT_COUNT",
    actualDate: "2026-05-06",
    status: "EXCUSED",
    reasonCode: "MEMBER_LEAVE",
    reasonText: "Approved leave before close",
  });
  await service.markKpiActualExcuse(createActor(), {
    kpiPlanId: published.id,
    allocationId: secondAllocation.id,
    metricCode: "ONBOARDED_TALENT_COUNT",
    actualDate: "2026-05-06",
    status: "NOT_REQUIRED",
    reasonCode: "NO_OPERATION_REQUIRED",
    reasonText: "No operation required before close",
  });

  const nonPublishedAllocation: KpiAllocation = {
    ...updatedFirstAllocation,
    id: "allocation-non-published-final-snapshot",
    allocationStatus: "APPROVED",
    targetMetrics: [{ metricCode: "REVENUE_VND", targetValue: 700 }],
  };
  const wrongGroupAllocation: KpiAllocation = {
    ...updatedFirstAllocation,
    id: "allocation-wrong-group-final-snapshot",
    subjectId: "group-other",
    groupId: "group-other",
    targetMetrics: [{ metricCode: "REVENUE_VND", targetValue: 500 }],
  };
  repository.allocations.push(nonPublishedAllocation, wrongGroupAllocation);
  actualRepository.entries.push(
    {
      ...created.actualEntry,
      id: "actual-non-published-final-snapshot",
      allocationId: nonPublishedAllocation.id,
      memberTalentId: requireTestAllocationMemberTalentId(
        nonPublishedAllocation,
      ),
      actualDate: "2026-05-05",
      actualValue: 700,
      effectiveValue: 700,
    },
    {
      ...created.actualEntry,
      id: "actual-wrong-group-final-snapshot",
      allocationId: wrongGroupAllocation.id,
      memberTalentId: requireTestAllocationMemberTalentId(
        wrongGroupAllocation,
      ),
      actualDate: "2026-05-05",
      actualValue: 500,
      effectiveValue: 500,
    },
    {
      ...created.actualEntry,
      id: "actual-out-of-period-final-snapshot",
      actualDate: "2026-06-01",
      actualValue: 999,
      effectiveValue: 999,
    },
    {
      ...created.actualEntry,
      id: "actual-unsupported-final-snapshot",
      metricCode: "UNSUPPORTED_METRIC" as KpiMetricCode,
      actualValue: 999,
      effectiveValue: 999,
    },
  );

  now.value = JUNE_1_2026_NOON_HCM;
  const finalized = await service.finalizeKpiPlan(createActor(), {
    kpiPlanId: published.id,
  });
  const stored = await repository.findPlanById(published.id);
  const snapshot = stored?.finalResult;

  assert.equal(finalized.status, "FINALIZED");
  assert.ok(snapshot);
  assert.equal(snapshot.snapshotVersion, 1);
  assert.equal(snapshot.planId, published.id);
  assert.equal(snapshot.planCode, published.planCode);
  assert.equal(snapshot.periodMonth, "2026-05");
  assert.equal(snapshot.subjectType, "TALENT_GROUP");
  assert.equal(snapshot.subjectId, "group-1");
  assert.equal(snapshot.finalizedAt, JUNE_1_2026_NOON_HCM);
  assert.equal(snapshot.finalizedByActorId, "admin-1");
  assert.deepEqual(snapshot.revenue, {
    metricCode: "REVENUE_VND",
    planTargetValue: 300,
    operationalTargetValue: 350,
    actualValue: 90,
    achievementPercent: (90 / 350) * 100,
    targetMismatch: true,
  });
  assert.deepEqual(snapshot.allocationCoverage, {
    publishedAllocationCount: 3,
    totalAllocationCount: 4,
    isAllExistingAllocationsPublished: false,
  });
  assert.deepEqual(snapshot.actualEntryStatusSummary, {
    expectedEntryCount: 124,
    enteredEntryCount: 2,
    enteredZeroCount: 1,
    pendingEntryCount: 0,
    overdueEntryCount: 120,
    excusedEntryCount: 1,
    notRequiredEntryCount: 1,
    notDueEntryCount: 0,
  });
  assert.deepEqual(snapshot.supportingMetrics, [
    {
      metricCode: "ONBOARDED_TALENT_COUNT",
      targetValue: 3,
      actualValue: 0,
      achievementPercent: 0,
    },
  ]);
  assert.equal(snapshot.members.length, 2);
  assert.deepEqual(
    snapshot.members.map((member) => ({
      allocationId: member.allocationId,
      memberDisplayName: member.memberDisplayName,
      allocationStatus: member.allocationStatus,
      revenue: member.revenue,
      actualEntryStatusSummary: member.actualEntryStatusSummary,
    })),
    [
      {
        allocationId: updatedFirstAllocation.id,
        memberDisplayName: "talent-profile-1",
        allocationStatus: "PUBLISHED",
        revenue: {
          metricCode: "REVENUE_VND",
          targetValue: 150,
          actualValue: 90,
          achievementPercent: 60,
        },
        actualEntryStatusSummary: {
          expectedEntryCount: 62,
          enteredEntryCount: 1,
          enteredZeroCount: 0,
          pendingEntryCount: 0,
          overdueEntryCount: 60,
          excusedEntryCount: 1,
          notRequiredEntryCount: 0,
          notDueEntryCount: 0,
        },
      },
      {
        allocationId: secondAllocation.id,
        memberDisplayName: "talent-profile-2",
        allocationStatus: "PUBLISHED",
        revenue: {
          metricCode: "REVENUE_VND",
          targetValue: 200,
          actualValue: 0,
          achievementPercent: 0,
        },
        actualEntryStatusSummary: {
          expectedEntryCount: 62,
          enteredEntryCount: 1,
          enteredZeroCount: 1,
          pendingEntryCount: 0,
          overdueEntryCount: 60,
          excusedEntryCount: 0,
          notRequiredEntryCount: 1,
          notDueEntryCount: 0,
        },
      },
    ],
  );

  const serializedSnapshot = JSON.stringify(snapshot);
  for (const forbidden of [
    "finalScore",
    "rank",
    "payroll",
    "payout",
    "settlement",
    "commission",
    "accounting",
    "tax",
    "ERP",
    "memberTalentId",
    "memberEmploymentProfileId",
  ]) {
    assert.equal(serializedSnapshot.includes(forbidden), false, forbidden);
  }
  const exposedPlanDetail = KpiPlanDetailExposure.expose(finalized);
  const exposedFinalResult = exposedPlanDetail.finalResult as Record<
    string,
    unknown
  >;
  assert.ok(exposedFinalResult);
  assert.equal(exposedFinalResult.snapshotVersion, 1);
  assert.equal(exposedFinalResult.finalizedAt, JUNE_1_2026_NOON_HCM);
  assert.equal("finalizedByActorId" in exposedFinalResult, false);
  assert.equal("memberTalentId" in exposedFinalResult, false);
  assert.equal("memberEmploymentProfileId" in exposedFinalResult, false);

  const listedPlans = await service.listKpiPlans(createActor(), {
    search: published.planCode,
  });
  const listedPlan = listedPlans.items[0];
  assert.ok(listedPlan);
  const exposedPlanListItem = KpiPlanListExposure.expose(listedPlan);
  assert.equal("finalResult" in exposedPlanListItem, false);

  const exposedWorkspaceDetail = KpiActualWorkspaceExposure.exposeDetail(
    await service.getKpiActualWorkspacePlanDetail(createActor(), {
      kpiPlanId: published.id,
    }),
  );
  assert.deepEqual(exposedWorkspaceDetail.finalResult, exposedFinalResult);

  await assert.rejects(
    service.finalizeKpiPlan(createActor(), { kpiPlanId: published.id }),
    KpiStateError,
  );
  assert.deepEqual(
    (await repository.findPlanById(published.id))?.finalResult,
    snapshot,
  );
});

test("KPI V2 backoffice TEAM_MANAGER may create, direct-update, and post-cutoff correct managed actuals", async () => {
  const now = { value: MAY_5_2026_NOON_HCM };
  const { service, managerRepository } = createHarness(() => now.value);
  const published = await createPublishedGroupPlan(service);
  const allocation = published.allocations[0] as KpiAllocation;
  seedManagerAssignment(managerRepository);
  const managerActor = createBackofficeTeamManagerActor();

  const result = await service.createOrSetKpiActual(managerActor, {
    kpiPlanId: published.id,
    allocationId: allocation.id,
    metricCode: "REVENUE_VND",
    actualDate: "2026-05-05",
    actualValue: 0,
  });
  const updated = await service.updateKpiActualDirect(managerActor, {
    kpiPlanId: published.id,
    actualEntryId: result.actualEntry.id,
    actualValue: 80,
  });

  assert.equal(result.actualEntry.memberTalentId, allocation.memberTalentId);
  assert.equal(result.actualEntry.actualValue, 0);
  assert.equal(
    Object.prototype.hasOwnProperty.call(result.actualEntry, "actualValue"),
    true,
  );
  assert.equal(updated.actualEntry.effectiveValue, 80);
  assert.equal(updated.actualEntry.editCount, 1);
  now.value = MAY_5_2026_AFTER_LOCK_HCM;
  const corrected = await service.correctKpiActual(managerActor, {
    kpiPlanId: published.id,
    actualEntryId: result.actualEntry.id,
    correctedValue: 90,
    reason: "manager correction",
  });
  assert.equal(corrected.actualEntry.effectiveValue, 90);
  assert.equal(corrected.actualEntry.actualValue, 80);
});

test("KPI managed actual entry denies cutoff, unmanaged, non-published allocation, lifecycle, and permission gaps", async () => {
  const now = { value: MAY_5_2026_NOON_HCM };
  const { service, repository, managerRepository } = createHarness(
    () => now.value,
  );
  const published = await createPublishedGroupPlan(service);
  const allocation = published.allocations[0] as KpiAllocation;
  const managerActor = createBackofficeTeamManagerActor();
  seedManagerAssignment(managerRepository);

  now.value = MAY_5_2026_AFTER_LOCK_HCM;
  await assert.rejects(
    service.createOrSetKpiActual(managerActor, {
      kpiPlanId: published.id,
      allocationId: allocation.id,
      metricCode: "REVENUE_VND",
      actualDate: "2026-05-05",
      actualValue: 80,
    }),
    KpiStateError,
  );

  now.value = MAY_5_2026_NOON_HCM;
  managerRepository.assignments.length = 0;
  seedManagerAssignment(managerRepository, "group-2");
  await assert.rejects(
    service.createOrSetKpiActual(managerActor, {
      kpiPlanId: published.id,
      allocationId: allocation.id,
      metricCode: "REVENUE_VND",
      actualDate: "2026-05-05",
      actualValue: 80,
    }),
    KpiPermissionScopeError,
  );

  managerRepository.assignments.length = 0;
  seedManagerAssignment(managerRepository);
  replacePlanAllocationStatuses(repository, published.id, ["DRAFT"]);
  const draftAllocation = repository.allocations.find(
    (item) => item.kpiPlanId === published.id,
  );
  assert.ok(draftAllocation);
  await assert.rejects(
    service.createOrSetKpiActual(managerActor, {
      kpiPlanId: published.id,
      allocationId: draftAllocation.id,
      metricCode: "REVENUE_VND",
      actualDate: "2026-05-05",
      actualValue: 80,
    }),
    KpiInvalidAllocationError,
  );

  const draftPlan = await service.createKpiPlan(
    createActor(),
    groupPlanCommand(),
  );
  await assert.rejects(
    service.createOrSetKpiActual(managerActor, {
      kpiPlanId: draftPlan.id,
      allocationId: allocation.id,
      metricCode: "REVENUE_VND",
      actualDate: "2026-05-05",
      actualValue: 80,
    }),
    KpiStateError,
  );

  await assert.rejects(
    service.createOrSetKpiActual(
      createProgressReadOnlyBackofficeTeamManagerActor(),
      {
        kpiPlanId: published.id,
        allocationId: allocation.id,
        metricCode: "REVENUE_VND",
        actualDate: "2026-05-05",
        actualValue: 80,
      },
    ),
    /Missing permission kpi.enterActual/u,
  );
});

test("KPI allocation approval foundation supports manager draft submit and admin approve publish", async () => {
  const { service, managerRepository, audit } = createHarness(
    () => MAY_5_2026_NOON_HCM,
  );
  const managerActor = createBackofficeTeamManagerActor();
  const created = await service.createKpiPlan(
    createActor(),
    groupPlanCommand(),
  );
  await service.publishKpiPlan(createActor(), { kpiPlanId: created.id });
  seedManagerAssignment(managerRepository);

  const draft = await service.upsertKpiAllocationDraft(managerActor, {
    kpiPlanId: created.id,
    allocations: [
      {
        employmentProfileId: "talent-profile-1",
        allocationStartDate: "2026-05-01",
        targetMetrics: [
          { metricCode: "REVENUE_VND", targetValue: 100 },
          { metricCode: "ONBOARDED_TALENT_COUNT", targetValue: 1 },
        ],
        note: "Primary host",
      },
      {
        employmentProfileId: "talent-profile-2",
        allocationStartDate: "2026-05-01",
        targetMetrics: [
          { metricCode: "REVENUE_VND", targetValue: 200 },
          { metricCode: "ONBOARDED_TALENT_COUNT", targetValue: 2 },
        ],
      },
    ],
  });
  assert.deepEqual(
    draft.allocations.map((allocation) => allocation.allocationStatus),
    ["DRAFT", "DRAFT"],
  );
  assert.equal(
    draft.allocations[0]?.memberEmploymentProfileId,
    "talent-profile-1",
  );
  assert.equal(draft.allocations[0]?.createdByActorId, "manager-user");

  const editedDraft = await service.upsertKpiAllocationDraft(managerActor, {
    kpiPlanId: created.id,
    allocations: [
      {
        employmentProfileId: "talent-profile-1",
        allocationStartDate: "2026-05-01",
        targetMetrics: [
          { metricCode: "REVENUE_VND", targetValue: 120 },
          { metricCode: "ONBOARDED_TALENT_COUNT", targetValue: 1 },
        ],
        note: "Edited primary host",
      },
      {
        employmentProfileId: "talent-profile-2",
        allocationStartDate: "2026-05-01",
        targetMetrics: [
          { metricCode: "REVENUE_VND", targetValue: 180 },
          { metricCode: "ONBOARDED_TALENT_COUNT", targetValue: 2 },
        ],
      },
    ],
  });
  assert.equal(
    editedDraft.allocations[0]?.targetMetrics.find(
      (metric) => metric.metricCode === "REVENUE_VND",
    )?.targetValue,
    120,
  );

  const submitted = await service.submitKpiAllocationDraft(managerActor, {
    kpiPlanId: created.id,
  });
  assert.equal(submitted.allocations[0]?.allocationStatus, "PENDING_APPROVAL");
  assert.equal(submitted.allocations[0]?.submittedByActorId, "manager-user");

  await assert.rejects(
    service.approveKpiAllocation(managerActor, {
      kpiPlanId: created.id,
    }),
    /Missing permission kpi.manageAllocation/u,
  );
  await assert.rejects(
    service.publishKpiAllocation(managerActor, {
      kpiPlanId: created.id,
    }),
    /Missing permission kpi.publish/u,
  );

  const approved = await service.approveKpiAllocation(createActor(), {
    kpiPlanId: created.id,
    approvalNote: "Approved for May",
  });
  assert.equal(approved.allocations[0]?.allocationStatus, "APPROVED");
  assert.equal(approved.allocations[0]?.approvedByActorId, "admin-1");
  assert.equal(approved.allocations[0]?.approvalNote, "Approved for May");

  const published = await service.publishKpiAllocation(createActor(), {
    kpiPlanId: created.id,
  });
  assert.equal(published.allocations[0]?.allocationStatus, "PUBLISHED");
  assert.equal(published.allocations[0]?.publishedByActorId, "admin-1");
  assert.ok(
    audit.records.some(
      (record) => record.metadata?.mutationType === "kpi.allocation.publish",
    ),
  );
});

test("KPI allocation approve and reject cannot mutate pending rows after plan FINALIZED", async () => {
  const now = { value: MAY_5_2026_NOON_HCM };
  const { service, managerRepository } = createHarness(() => now.value);
  const managerActor = createBackofficeTeamManagerActor();
  const created = await service.createKpiPlan(
    createActor(),
    groupPlanCommand(),
  );
  await service.publishKpiPlan(createActor(), { kpiPlanId: created.id });
  seedManagerAssignment(managerRepository);
  await service.upsertKpiAllocationDraft(managerActor, {
    kpiPlanId: created.id,
    allocations: [
      {
        employmentProfileId: "talent-profile-1",
        allocationStartDate: "2026-05-01",
        targetMetrics: [
          { metricCode: "REVENUE_VND", targetValue: 100 },
          { metricCode: "ONBOARDED_TALENT_COUNT", targetValue: 1 },
        ],
      },
    ],
  });
  await service.submitKpiAllocationDraft(managerActor, {
    kpiPlanId: created.id,
  });
  now.value = JUNE_1_2026_NOON_HCM;
  await service.finalizeKpiPlan(createActor(), { kpiPlanId: created.id });

  await assert.rejects(
    service.approveKpiAllocation(createActor(), { kpiPlanId: created.id }),
    KpiStateError,
  );
  await assert.rejects(
    service.rejectKpiAllocation(createActor(), {
      kpiPlanId: created.id,
      rejectionReason: "Must remain locked",
    }),
    KpiStateError,
  );
});

test("KPI allocation approval denies draft and submit to read/global/non-manager actors", async () => {
  const { service, managerRepository } = createHarness(
    () => MAY_5_2026_NOON_HCM,
  );
  const created = await service.createKpiPlan(
    createActor(),
    groupPlanCommand(),
  );
  await service.publishKpiPlan(createActor(), { kpiPlanId: created.id });
  seedManagerAssignment(managerRepository);
  await service.upsertKpiAllocationDraft(createManagerActor(), {
    kpiPlanId: created.id,
    allocations: [
      {
        employmentProfileId: "talent-profile-1",
        allocationStartDate: "2026-05-01",
        targetMetrics: [
          { metricCode: "REVENUE_VND", targetValue: 300 },
          { metricCode: "ONBOARDED_TALENT_COUNT", targetValue: 3 },
        ],
      },
    ],
  });

  const deniedActors: readonly Actor[] = [
    createScopedActor({
      id: "hr-user",
      permissions: [Permission.KPI_READ, Permission.KPI_READ_PROGRESS],
      kpiScopes: ["global"],
    }),
    createScopedActor({
      id: "finance-user",
      permissions: [Permission.KPI_READ, Permission.KPI_READ_PROGRESS],
      kpiScopes: ["global"],
    }),
    createScopedActor({
      id: "viewer-user",
      permissions: [Permission.KPI_READ],
      kpiScopes: ["global"],
    }),
    createScopedActor({
      id: "manager-user",
      permissions: [Permission.KPI_READ, Permission.KPI_ENTER_ACTUAL],
    }),
    createScopedActor({
      id: "unlinked-admin-manager-user",
      permissions: [Permission.KPI_READ, Permission.KPI_ENTER_ACTUAL],
      kpiScopes: ["managedGroup"],
    }),
    createScopedActor({
      id: "talent-user",
      type: "staff",
      permissions: [Permission.KPI_READ_PROGRESS],
      kpiScopes: ["self"],
    }),
    createScopedActor({
      id: "unmanaged-manager-user",
      type: "staff",
      permissions: [
        Permission.KPI_READ,
        Permission.KPI_READ_PROGRESS,
        Permission.KPI_ENTER_ACTUAL,
        Permission.KPI_CORRECT_ACTUAL,
      ],
      kpiScopes: ["managedGroup"],
    }),
    createScopedActor({
      id: "global-read-user",
      permissions: [Permission.KPI_READ, Permission.KPI_READ_PROGRESS],
      kpiScopes: ["global"],
    }),
    createScopedActor({
      id: "global-enter-actual-user",
      permissions: [
        Permission.KPI_READ,
        Permission.KPI_READ_PROGRESS,
        Permission.KPI_ENTER_ACTUAL,
      ],
      kpiScopes: ["global"],
    }),
  ];

  for (const actor of deniedActors) {
    await assert.rejects(
      service.upsertKpiAllocationDraft(actor, {
        kpiPlanId: created.id,
        allocations: [
          {
            employmentProfileId: "talent-profile-1",
            allocationStartDate: "2026-05-01",
            targetMetrics: [
              { metricCode: "REVENUE_VND", targetValue: 300 },
              { metricCode: "ONBOARDED_TALENT_COUNT", targetValue: 3 },
            ],
          },
        ],
      }),
    );
    await assert.rejects(
      service.submitKpiAllocationDraft(actor, { kpiPlanId: created.id }),
    );
  }
});

test("KPI allocation draft and submit deny linked admin manager without active assignment", async () => {
  const { service } = createHarness(() => MAY_5_2026_NOON_HCM);
  const created = await service.createKpiPlan(
    createActor(),
    groupPlanCommand(),
  );
  await service.publishKpiPlan(createActor(), { kpiPlanId: created.id });
  const managerActor = createBackofficeTeamManagerActor();

  await assert.rejects(
    service.upsertKpiAllocationDraft(managerActor, {
      kpiPlanId: created.id,
      allocations: [
        {
          employmentProfileId: "talent-profile-1",
          allocationStartDate: "2026-05-01",
          targetMetrics: [
            { metricCode: "REVENUE_VND", targetValue: 300 },
            { metricCode: "ONBOARDED_TALENT_COUNT", targetValue: 3 },
          ],
        },
      ],
    }),
    KpiPermissionScopeError,
  );
  await assert.rejects(
    service.submitKpiAllocationDraft(managerActor, { kpiPlanId: created.id }),
    KpiPermissionScopeError,
  );
});

test("KPI allocation approval rejects unmanaged or direct Talent-style draft targets", async () => {
  const { service, managerRepository } = createHarness(
    () => MAY_5_2026_NOON_HCM,
  );
  const created = await service.createKpiPlan(
    createActor(),
    groupPlanCommand(),
  );
  await service.publishKpiPlan(createActor(), { kpiPlanId: created.id });
  seedManagerAssignment(managerRepository);

  await assert.rejects(
    service.upsertKpiAllocationDraft(createManagerActor(), {
      kpiPlanId: created.id,
      allocations: [
        {
          employmentProfileId: "unmanaged-profile",
          allocationStartDate: "2026-05-01",
          targetMetrics: [
            { metricCode: "REVENUE_VND", targetValue: 300 },
            { metricCode: "ONBOARDED_TALENT_COUNT", targetValue: 3 },
          ],
        },
      ],
    }),
    KpiInvalidAllocationError,
  );

  await assert.rejects(
    service.upsertKpiAllocationDraft(createManagerActor(), {
      kpiPlanId: created.id,
      allocations: [
        {
          memberTalentId: "talent-1",
          allocationStartDate: "2026-05-01",
          targetMetrics: [
            { metricCode: "REVENUE_VND", targetValue: 300 },
            { metricCode: "ONBOARDED_TALENT_COUNT", targetValue: 3 },
          ],
        } as never,
      ],
    }),
    KpiValidationError,
  );
});

test("KPI allocation approval denies non-admin publisher roles and ignores non-published allocations in progress", async () => {
  const { service, managerRepository } = createHarness(
    () => MAY_5_2026_NOON_HCM,
  );
  const created = await service.createKpiPlan(
    createActor(),
    groupPlanCommand(),
  );
  await service.publishKpiPlan(createActor(), { kpiPlanId: created.id });
  seedManagerAssignment(managerRepository);
  await service.upsertKpiAllocationDraft(createManagerActor(), {
    kpiPlanId: created.id,
    allocations: [
      {
        employmentProfileId: "talent-profile-1",
        allocationStartDate: "2026-05-01",
        targetMetrics: [
          { metricCode: "REVENUE_VND", targetValue: 300 },
          { metricCode: "ONBOARDED_TALENT_COUNT", targetValue: 3 },
        ],
      },
    ],
  });

  const draftProgress = await service.getKpiProgress(createActor(), {
    kpiPlanId: created.id,
  });
  assert.equal(draftProgress.memberProgress.length, 0);

  for (const actor of [
    createKpiReadOnlyActor(),
    createActorWithPermissions("hr-user", [
      Permission.KPI_READ,
      Permission.KPI_READ_PROGRESS,
    ]),
    createActorWithPermissions("ops-user", [Permission.KPI_READ]),
    createActorWithPermissions("finance-user", [
      Permission.KPI_READ,
      Permission.KPI_READ_PROGRESS,
    ]),
  ]) {
    await assert.rejects(
      service.approveKpiAllocation(actor, { kpiPlanId: created.id }),
      /Missing permission kpi.manageAllocation/u,
    );
    await assert.rejects(
      service.publishKpiAllocation(actor, { kpiPlanId: created.id }),
      /Missing permission kpi.publish/u,
    );
  }

  await service.submitKpiAllocationDraft(createManagerActor(), {
    kpiPlanId: created.id,
  });
  await service.approveKpiAllocation(createActor(), { kpiPlanId: created.id });
  const approvedProgress = await service.getKpiProgress(createActor(), {
    kpiPlanId: created.id,
  });
  assert.equal(approvedProgress.memberProgress.length, 0);

  await service.publishKpiAllocation(createActor(), { kpiPlanId: created.id });
  const publishedProgress = await service.getKpiProgress(createActor(), {
    kpiPlanId: created.id,
  });
  assert.equal(publishedProgress.memberProgress.length, 2);
});

test("KPI V2 create plan mutation records audit proof", async () => {
  const { service, audit } = createHarness();

  const created = await service.createKpiPlan(
    createActor(),
    groupPlanCommand(),
  );

  assertAuditRecord(audit, {
    operation: "kpi.create-plan",
    resourceId: created.id,
    permissionCode: Permission.KPI_CREATE_PLAN,
  });
});

test("KPI V2 update draft-core mutation records audit proof", async () => {
  const { service, audit } = createHarness();
  const created = await service.createKpiPlan(
    createActor(),
    groupPlanCommand(),
  );

  await service.updateKpiDraftCore(createActor(), {
    kpiPlanId: created.id,
    title: "Updated",
  });

  assertAuditRecord(audit, {
    operation: "kpi.update-draft-core",
    resourceId: created.id,
    permissionCode: Permission.KPI_UPDATE_DRAFT,
  });
});

test("KPI V2 replace target metrics mutation records audit proof", async () => {
  const { service, audit } = createHarness();
  const created = await service.createKpiPlan(
    createActor(),
    groupPlanCommand(),
  );

  await service.replaceKpiTargetMetrics(createActor(), {
    kpiPlanId: created.id,
    targetMetrics: [{ metricCode: "CONTENT_OUTPUT_COUNT", targetValue: 10 }],
  });

  assertAuditRecord(audit, {
    operation: "kpi.replace-target-metrics",
    resourceId: created.id,
    permissionCode: Permission.KPI_UPDATE_DRAFT,
  });
});

test("KPI V2 replace allocations mutation records audit proof", async () => {
  const { service, audit } = createHarness();
  const created = await service.createKpiPlan(
    createActor(),
    groupPlanCommand(),
  );

  await service.replaceKpiAllocations(createActor(), {
    kpiPlanId: created.id,
    allocations: [
      {
        memberTalentId: "talent-1",
        allocationStartDate: "2026-05-01",
        targetMetrics: [
          { metricCode: "REVENUE_VND", targetValue: 300 },
          { metricCode: "ONBOARDED_TALENT_COUNT", targetValue: 3 },
        ],
      },
    ],
  });

  assertAuditRecord(audit, {
    operation: "kpi.replace-allocations",
    resourceId: created.id,
    permissionCode: Permission.KPI_MANAGE_ALLOCATION,
  });
});

test("KPI V2 publish mutation records audit proof", async () => {
  const { service, audit } = createHarness();
  const created = await service.createKpiPlan(
    createActor(),
    groupPlanCommand(),
  );

  await service.publishKpiPlan(createActor(), { kpiPlanId: created.id });

  assertAuditRecord(audit, {
    operation: "kpi.publish",
    resourceId: created.id,
    permissionCode: Permission.KPI_PUBLISH,
  });
});

test("KPI V2 archive mutation records audit proof", async () => {
  const { service, audit } = createHarness();
  const created = await service.createKpiPlan(
    createActor(),
    groupPlanCommand(),
  );

  await service.archiveKpiPlan(createActor(), { kpiPlanId: created.id });

  assertAuditRecord(audit, {
    operation: "kpi.archive",
    resourceId: created.id,
    permissionCode: Permission.KPI_ARCHIVE,
  });
});

test("KPI V2 rejects unknown nested target metric keys", async () => {
  const { service } = createHarness();
  const targetMetrics = [
    {
      metricCode: "REVENUE_VND",
      targetValue: 1000,
      unsupported: true,
    },
  ] as unknown as ReturnType<typeof talentPlanCommand>["targetMetrics"];

  await assert.rejects(
    service.createKpiPlan(createActor(), {
      ...groupPlanCommand(),
      targetMetrics,
    }),
    KpiValidationError,
  );
});

test("KPI V2 rejects unknown allocation row keys", async () => {
  const { service } = createHarness();
  const created = await service.createKpiPlan(
    createActor(),
    groupPlanCommand(),
  );
  const allocations = [
    {
      memberTalentId: "talent-1",
      allocationStartDate: "2026-05-01",
      targetMetrics: [{ metricCode: "REVENUE_VND", targetValue: 300 }],
      unsupported: true,
    },
  ] as unknown as Parameters<
    KpiAdminService["replaceKpiAllocations"]
  >[1]["allocations"];

  await assert.rejects(
    service.replaceKpiAllocations(createActor(), {
      kpiPlanId: created.id,
      allocations,
    }),
    KpiValidationError,
  );
});

test("KPI V2 rejects unknown allocation target metric keys", async () => {
  const { service } = createHarness();
  const created = await service.createKpiPlan(
    createActor(),
    groupPlanCommand(),
  );
  const allocations = [
    {
      memberTalentId: "talent-1",
      allocationStartDate: "2026-05-01",
      targetMetrics: [
        {
          metricCode: "REVENUE_VND",
          targetValue: 300,
          unsupported: true,
        },
      ],
    },
  ] as unknown as Parameters<
    KpiAdminService["replaceKpiAllocations"]
  >[1]["allocations"];

  await assert.rejects(
    service.replaceKpiAllocations(createActor(), {
      kpiPlanId: created.id,
      allocations,
    }),
    KpiValidationError,
  );
});

for (const subjectType of ["EMPLOYMENT_PROFILE"] as const) {
  test(`KPI V2 publish rejects future-compatible ${subjectType} draft already present in repository`, async () => {
    const { service, repository } = createHarness();
    repository.plans.push(buildFutureSubjectDraftPlan(subjectType));

    await assert.rejects(
      service.publishKpiPlan(createActor(), {
        kpiPlanId: `future-${subjectType}`,
      }),
      KpiValidationError,
    );
  });
}

test("KPI actual workspace exposes correction-aware revenue, coverage, limited missing signal, and member detail", async () => {
  const now = { value: MAY_5_2026_NOON_HCM };
  const { service, repository, actualRepository } = createHarness(
    () => now.value,
  );
  const published = await createPublishedGroupPlan(service);
  const [first, second] = published.allocations as readonly [
    KpiAllocation,
    KpiAllocation,
  ];
  const created = await service.createOrSetKpiActual(createActor(), {
    kpiPlanId: published.id,
    allocationId: first.id,
    metricCode: "REVENUE_VND",
    actualDate: "2026-05-05",
    actualValue: 80,
  });
  await service.createOrSetKpiActual(createActor(), {
    kpiPlanId: published.id,
    allocationId: second.id,
    metricCode: "REVENUE_VND",
    actualDate: "2026-05-05",
    actualValue: 100,
  });
  await service.createOrSetKpiActual(createActor(), {
    kpiPlanId: published.id,
    allocationId: first.id,
    metricCode: "ONBOARDED_TALENT_COUNT",
    actualDate: "2026-05-05",
    actualValue: 1,
  });
  now.value = MAY_5_2026_AFTER_LOCK_HCM;
  await service.correctKpiActual(createActor(), {
    kpiPlanId: published.id,
    actualEntryId: created.actualEntry.id,
    correctedValue: 90,
    reason: "approved correction",
  });
  now.value = MAY_5_2026_NOON_HCM;

  const persistedUnsupportedMetricCode =
    "LEGACY_UNSUPPORTED_METRIC" as unknown as KpiMetricCode;
  const firstIndex = repository.allocations.findIndex(
    (allocation) => allocation.id === first.id,
  );
  assert.notEqual(firstIndex, -1);
  repository.allocations[firstIndex] = {
    ...repository.allocations[firstIndex]!,
    targetMetrics: [
      { metricCode: "REVENUE_VND", targetValue: 90 },
      { metricCode: "ONBOARDED_TALENT_COUNT", targetValue: 1 },
      { metricCode: persistedUnsupportedMetricCode, targetValue: 7 },
    ],
  };
  repository.allocations.push({
    ...first,
    id: "draft-coverage-gap",
    allocationStatus: "DRAFT",
  });
  actualRepository.entries.push(
    {
      ...created.actualEntry,
      id: "draft-actual-ignored",
      allocationId: "draft-coverage-gap",
      effectiveValue: 999,
    },
    {
      ...created.actualEntry,
      id: "out-of-period-actual-ignored",
      actualDate: "2026-06-01",
      effectiveValue: 999,
    },
    {
      ...created.actualEntry,
      id: "unsupported-metric-actual-ignored",
      metricCode: persistedUnsupportedMetricCode,
      actualValue: 777,
      effectiveValue: 777,
    },
  );

  const result = await service.listKpiActualWorkspacePlans(createActor(), {
    periodMonth: "2026-05",
    groupId: "group-1",
    search: "may group",
    sortBy: "planCode",
    sortDirection: "ASC",
  });
  const item = result.items[0];
  assert.ok(item);
  assert.equal(item.planId, published.id);
  assert.deepEqual(item.revenue, {
    metricCode: "REVENUE_VND",
    operationalTargetValue: 290,
    planTargetValue: 300,
    actualValue: 190,
    achievementPercent: (190 / 290) * 100,
    targetSource: "ALLOCATED",
    targetMismatch: true,
  });
  assert.deepEqual(item.allocationCoverage, {
    publishedAllocationCount: 2,
    totalAllocationCount: 3,
    isAllExistingAllocationsPublished: false,
  });
  assert.deepEqual(item.supportingMetrics, [
    {
      metricCode: "ONBOARDED_TALENT_COUNT",
      targetValue: 3,
      actualValue: 1,
      achievementPercent: (1 / 3) * 100,
    },
  ]);
  assert.deepEqual(item.missingSignal, {
    count: 121,
    semantics: "CALENDAR_DAY_METRIC_SLOT_LIMITED",
  });
  assert.deepEqual(item.actualEntryStatusSummary, {
    expectedEntryCount: 124,
    enteredEntryCount: 3,
    enteredZeroCount: 0,
    pendingEntryCount: 1,
    overdueEntryCount: 16,
    excusedEntryCount: 0,
    notRequiredEntryCount: 0,
    notDueEntryCount: 104,
  });
  assert.equal(item.actionHints.canReadActualGrid, true);
  assert.equal(item.actionHints.canEnterActual, true);

  const detail = await service.getKpiActualWorkspacePlanDetail(createActor(), {
    kpiPlanId: published.id,
  });
  assert.equal(detail.members.length, 2);
  assert.equal(detail.members[0]?.allocationStatus, "PUBLISHED");
  assert.equal(detail.members[0]?.allocationId, first.id);
  assert.equal(
    detail.members[0]?.memberDisplayName,
    first.snapshotMemberDisplayName,
  );
  assert.equal("memberTalentId" in detail.members[0]!, false);
  assert.equal("memberEmploymentProfileId" in detail.members[0]!, false);
  assert.equal(detail.members[0]?.revenue.actualValue, 90);
  assert.equal(detail.members[0]?.revenue.achievementPercent, 100);
  assert.deepEqual(detail.members[0]?.supportingMetrics, [
    {
      metricCode: "ONBOARDED_TALENT_COUNT",
      targetValue: 1,
      actualValue: 1,
      achievementPercent: 100,
    },
  ]);
  assert.equal(
    JSON.stringify(detail).includes(persistedUnsupportedMetricCode),
    false,
  );
  const exposedDetail = KpiActualWorkspaceExposure.exposeDetail(detail);
  assert.equal(exposedDetail.finalResult, null);
  const exposedMember = (
    exposedDetail.members as readonly Record<string, unknown>[]
  )[0];
  assert.ok(exposedMember);
  assert.equal(exposedMember.allocationId, first.id);
  assert.equal(
    exposedMember.memberDisplayName,
    first.snapshotMemberDisplayName,
  );
  assert.deepEqual(exposedDetail.actualEntryStatusSummary, {
    expectedEntryCount: 124,
    enteredEntryCount: 3,
    enteredZeroCount: 0,
    pendingEntryCount: 1,
    overdueEntryCount: 16,
    excusedEntryCount: 0,
    notRequiredEntryCount: 0,
    notDueEntryCount: 104,
  });
  assert.equal(
    (
      exposedMember.actualEntryStatusSummary as {
        readonly enteredEntryCount: number;
      }
    ).enteredEntryCount,
    2,
  );
  assert.equal("memberTalentId" in exposedMember, false);
  assert.equal("memberEmploymentProfileId" in exposedMember, false);
  assert.equal(JSON.stringify(exposedDetail).includes("overdueCount"), false);
});

test("KPI actual workspace keeps zero-allocation group plan visible as coverage gap", async () => {
  const { service } = createHarness(() => MAY_5_2026_NOON_HCM);
  const created = await service.createKpiPlan(
    createActor(),
    groupPlanCommand(),
  );
  const published = await service.publishKpiPlan(createActor(), {
    kpiPlanId: created.id,
  });

  const result = await service.listKpiActualWorkspacePlans(createActor(), {});
  const item = result.items.find(
    (candidate) => candidate.planId === published.id,
  );
  assert.ok(item);
  assert.deepEqual(item.revenue, {
    metricCode: "REVENUE_VND",
    operationalTargetValue: 0,
    planTargetValue: 300,
    actualValue: 0,
    achievementPercent: null,
    targetSource: "ALLOCATED",
    targetMismatch: true,
  });
  assert.deepEqual(item.allocationCoverage, {
    publishedAllocationCount: 0,
    totalAllocationCount: 0,
    isAllExistingAllocationsPublished: false,
  });
});

test("KPI actual workspace supports base plan search and periodMonth/planCode sorting", async () => {
  const { service } = createHarness();
  const first = await service.createKpiPlan(createActor(), groupPlanCommand());
  const second = await service.createKpiPlan(createActor(), {
    ...groupPlanCommand(),
    title: "May group KPI second",
  });

  const result = await service.listKpiActualWorkspacePlans(createActor(), {
    periodMonth: "2026-05",
    subjectId: "group-1",
    search: "may group kpi",
    sortBy: "planCode",
    sortDirection: "DESC",
  });
  assert.deepEqual(
    result.items.map((item) => item.planId),
    [second.id, first.id],
  );
  await service.listKpiActualWorkspacePlans(createActor(), {
    sortBy: "achievementPercent",
  });
  await service.listKpiActualWorkspacePlans(createActor(), {
    sortBy: "revenueActual",
  });
  await assert.rejects(
    service.listKpiActualWorkspacePlans(createActor(), {
      sortBy: "missingSignal",
    }),
    KpiValidationError,
  );
});

test("KPI actual workspace sorts revenueActual before cursor and page selection", async () => {
  const now = { value: MAY_5_2026_NOON_HCM };
  const { service, actualRepository, repository } = createHarness(
    () => now.value,
  );
  const low = await createPublishedGroupPlan(service);
  const mid = await createPublishedGroupPlan(service);
  const tie = await createPublishedGroupPlan(service);
  const high = await createPublishedGroupPlan(service);

  const setRevenue = async (
    plan: KpiPlanDetailView,
    value: number,
  ): Promise<void> => {
    const allocation = plan.allocations[0] as KpiAllocation;
    await service.createOrSetKpiActual(createActor(), {
      kpiPlanId: plan.id,
      allocationId: allocation.id,
      metricCode: "REVENUE_VND",
      actualDate: "2026-05-05",
      actualValue: value,
    });
  };
  await setRevenue(low, 10);
  await setRevenue(mid, 20);
  await setRevenue(tie, 20);
  await setRevenue(high, 30);

  const lowAllocation = low.allocations[0] as KpiAllocation;
  const draftAllocation = {
    ...lowAllocation,
    id: "derived-draft-allocation",
    allocationStatus: "DRAFT" as const,
  };
  repository.allocations.push(draftAllocation);
  actualRepository.entries.push(
    {
      ...actualRepository.entries[0]!,
      id: "derived-draft-actual-ignored",
      allocationId: draftAllocation.id,
      effectiveValue: 999,
    },
    {
      ...actualRepository.entries[0]!,
      id: "derived-out-of-period-actual-ignored",
      kpiPlanId: low.id,
      allocationId: lowAllocation.id,
      actualDate: "2026-06-01",
      effectiveValue: 999,
    },
    {
      ...actualRepository.entries[0]!,
      id: "derived-member-mismatch-actual-ignored",
      kpiPlanId: low.id,
      allocationId: lowAllocation.id,
      memberTalentId: "other-member",
      effectiveValue: 999,
    },
    {
      ...actualRepository.entries[0]!,
      id: "derived-unsupported-metric-actual-ignored",
      kpiPlanId: low.id,
      allocationId: lowAllocation.id,
      metricCode: "LIVE_HOURS",
      effectiveValue: 999,
    },
  );

  const tieOrdered = [mid, tie].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const expectedAsc = [low, ...tieOrdered, high].map((plan) => plan.id);
  const expectedDesc = [high, ...tieOrdered, low].map((plan) => plan.id);
  const firstPage = await service.listKpiActualWorkspacePlans(createActor(), {
    sortBy: "revenueActual",
    sortDirection: "ASC",
    limit: 2,
  });
  const secondPage = await service.listKpiActualWorkspacePlans(createActor(), {
    sortBy: "revenueActual",
    sortDirection: "ASC",
    limit: 3,
    cursor: firstPage.nextCursor,
  });
  const desc = await service.listKpiActualWorkspacePlans(createActor(), {
    sortBy: "revenueActual",
    sortDirection: "DESC",
    limit: 10,
  });

  assert.ok(firstPage.nextCursor);
  assert.deepEqual(
    [...firstPage.items, ...secondPage.items].map((item) => item.planId),
    expectedAsc,
  );
  assert.deepEqual(
    desc.items.map((item) => item.planId),
    expectedDesc,
  );
  assert.equal(firstPage.items[0]?.revenue.actualValue, 10);
});

test("KPI actual workspace sorts achievementPercent with nulls last both directions", async () => {
  const { service } = createHarness(() => MAY_5_2026_NOON_HCM);
  const nullPlan = await service.publishKpiPlan(createActor(), {
    kpiPlanId: (await service.createKpiPlan(createActor(), groupPlanCommand()))
      .id,
  });
  const low = await createPublishedGroupPlan(service);
  const high = await createPublishedGroupPlan(service);

  const setRevenue = async (
    plan: KpiPlanDetailView,
    value: number,
  ): Promise<void> => {
    const allocation = plan.allocations[0] as KpiAllocation;
    await service.createOrSetKpiActual(createActor(), {
      kpiPlanId: plan.id,
      allocationId: allocation.id,
      metricCode: "REVENUE_VND",
      actualDate: "2026-05-05",
      actualValue: value,
    });
  };
  await setRevenue(low, 30);
  await setRevenue(high, 90);

  const ascFirst = await service.listKpiActualWorkspacePlans(createActor(), {
    sortBy: "achievementPercent",
    sortDirection: "ASC",
    limit: 1,
  });
  const ascSecond = await service.listKpiActualWorkspacePlans(createActor(), {
    sortBy: "achievementPercent",
    sortDirection: "ASC",
    limit: 10,
    cursor: ascFirst.nextCursor,
  });
  const desc = await service.listKpiActualWorkspacePlans(createActor(), {
    sortBy: "achievementPercent",
    sortDirection: "DESC",
    limit: 10,
  });

  assert.ok(ascFirst.nextCursor);
  assert.deepEqual(
    [...ascFirst.items, ...ascSecond.items].map((item) => item.planId),
    [low.id, high.id, nullPlan.id],
  );
  assert.deepEqual(
    desc.items.map((item) => item.planId),
    [high.id, low.id, nullPlan.id],
  );
  assert.equal(
    desc.items.find((item) => item.planId === nullPlan.id)?.revenue
      .achievementPercent,
    null,
  );
});

test("KPI managed actual workspace derived sort does not leak hidden plans or cursors", async () => {
  const { service, repository, actualRepository, managerRepository } =
    createHarness(() => MAY_5_2026_NOON_HCM);
  const managed = await createPublishedGroupPlan(service);
  const hidden: KpiPlan = {
    ...managed,
    id: "hidden-derived-sort-plan",
    planCode: "KPI-HIDDEN-DERIVED",
    normalizedPlanCode: "kpi-hidden-derived",
    subjectId: "group-2",
  };
  const managedAllocation = managed.allocations[0] as KpiAllocation;
  repository.plans.push(hidden);
  repository.allocations.push({
    ...managedAllocation,
    id: "hidden-derived-sort-allocation",
    kpiPlanId: hidden.id,
    subjectId: hidden.subjectId,
    groupId: hidden.subjectId,
    targetMetrics: [{ metricCode: "REVENUE_VND", targetValue: 100 }],
  });
  await service.createOrSetKpiActual(createActor(), {
    kpiPlanId: managed.id,
    allocationId: managedAllocation.id,
    metricCode: "REVENUE_VND",
    actualDate: "2026-05-05",
    actualValue: 10,
  });
  actualRepository.entries.push({
    ...actualRepository.entries[0]!,
    id: "hidden-derived-sort-actual",
    kpiPlanId: hidden.id,
    allocationId: "hidden-derived-sort-allocation",
    effectiveValue: 999,
  });
  seedManagerAssignment(managerRepository, "group-1");

  const result = await service.listKpiActualWorkspacePlans(
    createProgressReadOnlyBackofficeTeamManagerActor(),
    { sortBy: "revenueActual", sortDirection: "DESC" },
  );
  const globalCursor = (
    await service.listKpiActualWorkspacePlans(createActor(), {
      sortBy: "revenueActual",
      sortDirection: "DESC",
      limit: 1,
    })
  ).nextCursor;

  assert.deepEqual(
    result.items.map((item) => item.planId),
    [managed.id],
  );
  assert.equal(JSON.stringify(result).includes(hidden.id), false);
  assert.equal(JSON.stringify(result).includes("999"), false);
  assert.ok(globalCursor);
  await assert.rejects(
    service.listKpiActualWorkspacePlans(
      createProgressReadOnlyBackofficeTeamManagerActor(),
      {
        sortBy: "revenueActual",
        sortDirection: "DESC",
        cursor: globalCursor,
      },
    ),
    KpiValidationError,
  );
});

test("KPI actual workspace cursor pages periodMonth sort with planId tiebreaker", async () => {
  const { service } = createHarness();
  const plans = [
    await service.createKpiPlan(createActor(), groupPlanCommand()),
    await service.createKpiPlan(createActor(), {
      ...groupPlanCommand(),
      title: "May group KPI B",
    }),
    await service.createKpiPlan(createActor(), {
      ...groupPlanCommand(),
      title: "May group KPI C",
    }),
  ];
  const expected = [...plans]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((plan) => plan.id);

  const firstPage = await service.listKpiActualWorkspacePlans(createActor(), {
    limit: 2,
    sortBy: "periodMonth",
    sortDirection: "ASC",
  });
  assert.deepEqual(
    firstPage.items.map((item) => item.planId),
    expected.slice(0, 2),
  );
  assert.ok(firstPage.nextCursor);

  const secondPage = await service.listKpiActualWorkspacePlans(createActor(), {
    limit: 2,
    sortBy: "periodMonth",
    sortDirection: "ASC",
    cursor: firstPage.nextCursor,
  });
  assert.deepEqual(
    secondPage.items.map((item) => item.planId),
    expected.slice(2),
  );
  assert.equal(secondPage.nextCursor, undefined);
});

test("KPI actual workspace cursor pages planCode sort with planId tiebreaker", async () => {
  const { service, repository } = createHarness();
  const plans = [
    await service.createKpiPlan(createActor(), groupPlanCommand()),
    await service.createKpiPlan(createActor(), {
      ...groupPlanCommand(),
      title: "May group KPI B",
    }),
    await service.createKpiPlan(createActor(), {
      ...groupPlanCommand(),
      title: "May group KPI C",
    }),
  ];
  for (const plan of plans) {
    const index = repository.plans.findIndex((item) => item.id === plan.id);
    assert.notEqual(index, -1);
    repository.plans[index] = {
      ...(repository.plans[index] as KpiPlan),
      planCode: "KPI-TIE",
      normalizedPlanCode: "kpi-tie",
    };
  }
  const expected = [...plans]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((plan) => plan.id);

  const firstPage = await service.listKpiActualWorkspacePlans(createActor(), {
    limit: 1,
    sortBy: "planCode",
    sortDirection: "ASC",
  });
  const secondPage = await service.listKpiActualWorkspacePlans(createActor(), {
    limit: 2,
    sortBy: "planCode",
    sortDirection: "ASC",
    cursor: firstPage.nextCursor,
  });

  assert.ok(firstPage.nextCursor);
  assert.deepEqual(
    [...firstPage.items, ...secondPage.items].map((item) => item.planId),
    expected,
  );
});

test("KPI actual workspace rejects malformed and mismatched cursors", async () => {
  const { service } = createHarness();
  await service.createKpiPlan(createActor(), groupPlanCommand());
  await service.createKpiPlan(createActor(), {
    ...groupPlanCommand(),
    title: "May group KPI B",
  });

  await assert.rejects(
    service.listKpiActualWorkspacePlans(createActor(), {
      cursor: "not-a-valid-cursor",
    }),
    KpiValidationError,
  );

  const firstPage = await service.listKpiActualWorkspacePlans(createActor(), {
    limit: 1,
    sortBy: "planCode",
    sortDirection: "ASC",
  });
  assert.ok(firstPage.nextCursor);
  await assert.rejects(
    service.listKpiActualWorkspacePlans(createActor(), {
      limit: 1,
      sortBy: "periodMonth",
      sortDirection: "ASC",
      cursor: firstPage.nextCursor,
    }),
    KpiValidationError,
  );
  const unsupportedSortCursor = Buffer.from(
    JSON.stringify({
      version: 1,
      queryKey: "{}",
      sortBy: "createdAt",
      sortDirection: "ASC",
      lastPlanCode: "KPI-000001",
      lastPlanId: "plan-1",
    }),
    "utf8",
  ).toString("base64url");
  await assert.rejects(
    service.listKpiActualWorkspacePlans(createActor(), {
      cursor: unsupportedSortCursor,
    }),
    KpiValidationError,
  );
});

test("KPI actual workspace searches authorized group code and name before pagination", async () => {
  const { service, repository } = createHarness();
  const groupPlan = await service.createKpiPlan(createActor(), {
    ...groupPlanCommand(),
    title: "No textual match",
  });
  const titlePlan = await service.createKpiPlan(createActor(), {
    ...groupPlanCommand(),
    title: "Hidden launch title",
  });
  const hiddenGroupPlan: KpiPlan = {
    ...titlePlan,
    id: "hidden-group-search-plan",
    planCode: "KPI-HIDDEN-GROUP-SEARCH",
    normalizedPlanCode: "kpi-hidden-group-search",
    title: "No title match either",
    normalizedTitle: "no title match either",
    subjectId: "group-2",
  };
  repository.plans.push(hiddenGroupPlan);

  const byCode = await service.listKpiActualWorkspacePlans(createActor(), {
    search: "tg-000001",
  });
  assert.ok(byCode.items.some((item) => item.planId === groupPlan.id));

  const byName = await service.listKpiActualWorkspacePlans(createActor(), {
    search: "creator team",
  });
  assert.ok(byName.items.some((item) => item.planId === groupPlan.id));

  const combined = await service.listKpiActualWorkspacePlans(createActor(), {
    search: "hidden",
    sortBy: "planCode",
    sortDirection: "ASC",
  });
  assert.ok(combined.items.some((item) => item.planId === titlePlan.id));
  assert.ok(combined.items.some((item) => item.planId === hiddenGroupPlan.id));
});

test("KPI managed actual workspace group search does not leak unmanaged group matches", async () => {
  const { service, repository, managerRepository } = createHarness();
  const managed = await createPublishedGroupPlan(service);
  const hiddenPlan: KpiPlan = {
    ...managed,
    id: "hidden-group-search-plan",
    planCode: "KPI-HIDDEN-GROUP-SEARCH",
    normalizedPlanCode: "kpi-hidden-group-search",
    title: "No hidden title match",
    normalizedTitle: "no hidden title match",
    subjectId: "group-2",
  };
  repository.plans.push(hiddenPlan);
  seedManagerAssignment(managerRepository, "group-1");

  const result = await service.listKpiActualWorkspacePlans(
    createProgressReadOnlyBackofficeTeamManagerActor(),
    { search: "hidden team" },
  );

  assert.deepEqual(result.items, []);
  assert.equal(JSON.stringify(result).includes(hiddenPlan.id), false);
});

test("KPI actual workspace allocation-row coverage filter applies before page finalization", async () => {
  const { service } = createHarness();
  const zeroAllocationPlan = await service.createKpiPlan(
    createActor(),
    groupPlanCommand(),
  );
  await service.publishKpiPlan(createActor(), {
    kpiPlanId: zeroAllocationPlan.id,
  });
  const completePlan = await createPublishedGroupPlan(service);

  const complete = await service.listKpiActualWorkspacePlans(createActor(), {
    allocationCoverage: "complete",
    limit: 1,
    sortBy: "planCode",
    sortDirection: "ASC",
  });
  assert.deepEqual(
    complete.items.map((item) => item.planId),
    [completePlan.id],
  );

  const incomplete = await service.listKpiActualWorkspacePlans(createActor(), {
    allocationCoverage: "incomplete",
    sortBy: "planCode",
    sortDirection: "ASC",
  });
  assert.ok(
    incomplete.items.some((item) => item.planId === zeroAllocationPlan.id),
  );
  assert.equal(
    incomplete.items.some((item) => item.planId === completePlan.id),
    false,
  );

  await assert.rejects(
    service.listKpiActualWorkspacePlans(createActor(), {
      allocationCoverage: "achievement",
    }),
    KpiValidationError,
  );
});

test("KPI managed actual workspace coverage filter does not leak hidden plans", async () => {
  const { service, repository, managerRepository } = createHarness();
  const managed = await createPublishedGroupPlan(service);
  const hiddenIncomplete: KpiPlan = {
    ...managed,
    id: "hidden-incomplete-coverage-plan",
    planCode: "KPI-HIDDEN-INCOMPLETE",
    normalizedPlanCode: "kpi-hidden-incomplete",
    subjectId: "group-2",
  };
  repository.plans.push(hiddenIncomplete);
  seedManagerAssignment(managerRepository, "group-1");

  const result = await service.listKpiActualWorkspacePlans(
    createProgressReadOnlyBackofficeTeamManagerActor(),
    { allocationCoverage: "incomplete" },
  );

  assert.deepEqual(result.items, []);
  assert.equal(JSON.stringify(result).includes(hiddenIncomplete.id), false);
});

test("KPI managed actual workspace prevents hidden group summary and detail leakage", async () => {
  const { service, repository, actualRepository, managerRepository } =
    createHarness(() => MAY_5_2026_NOON_HCM);
  const managed = await createPublishedGroupPlan(service);
  const templateAllocation = repository.allocations.find(
    (allocation) => allocation.kpiPlanId === managed.id,
  );
  assert.ok(templateAllocation);
  const visibleAllocationIndex = repository.allocations.findIndex(
    (allocation) => allocation.id === templateAllocation.id,
  );
  assert.notEqual(visibleAllocationIndex, -1);
  repository.allocations[visibleAllocationIndex] = {
    ...templateAllocation,
    targetMetrics: [
      ...templateAllocation.targetMetrics,
      { metricCode: "TIKTOK_DIAMOND", targetValue: 999 },
    ],
  };
  const visibleAllocation = repository.allocations[
    visibleAllocationIndex
  ] as KpiAllocation;
  const hiddenPlan: KpiPlan = {
    ...managed,
    id: "hidden-workspace-plan",
    planCode: "KPI-HIDDEN-WORKSPACE",
    subjectId: "group-2",
  };
  repository.plans.push(hiddenPlan);
  repository.allocations.push({
    ...templateAllocation,
    id: "hidden-workspace-allocation",
    kpiPlanId: hiddenPlan.id,
    subjectId: hiddenPlan.subjectId,
    groupId: hiddenPlan.subjectId,
    targetMetrics: [{ metricCode: "REVENUE_VND", targetValue: 999 }],
  });
  repository.allocations.push({
    ...templateAllocation,
    id: "cross-group-workspace-allocation",
    kpiPlanId: managed.id,
    subjectId: hiddenPlan.subjectId,
    groupId: hiddenPlan.subjectId,
    snapshotMemberDisplayName: "hidden cross-group member",
  });
  actualRepository.entries.push(
    {
      id: "visible-workspace-diamond-actual",
      kpiPlanId: managed.id,
      allocationId: visibleAllocation.id,
      memberEmploymentProfileId:
        requireTestAllocationMemberEmploymentProfileId(visibleAllocation),
      memberTalentId: requireTestAllocationMemberTalentId(visibleAllocation),
      metricCode: "TIKTOK_DIAMOND",
      actualDate: "2026-05-05",
      actualValue: 999,
      effectiveValue: 999,
      editCount: 0,
      correctionCount: 0,
      latestCorrectionId: null,
      createdAt: MAY_5_2026_NOON_HCM,
      createdByActorId: "manager-user",
      updatedAt: MAY_5_2026_NOON_HCM,
      updatedByActorId: "manager-user",
      lastEditedAt: null,
      lastEditedByActorId: null,
    },
    {
      id: "hidden-workspace-actual",
      kpiPlanId: hiddenPlan.id,
      allocationId: "hidden-workspace-allocation",
      memberEmploymentProfileId:
        requireTestAllocationMemberEmploymentProfileId(templateAllocation),
      memberTalentId: requireTestAllocationMemberTalentId(templateAllocation),
      metricCode: "REVENUE_VND",
      actualDate: "2026-05-05",
      actualValue: 999,
      effectiveValue: 999,
      editCount: 0,
      correctionCount: 0,
      latestCorrectionId: null,
      createdAt: MAY_5_2026_NOON_HCM,
      createdByActorId: "hidden",
      updatedAt: MAY_5_2026_NOON_HCM,
      updatedByActorId: "hidden",
      lastEditedAt: null,
      lastEditedByActorId: null,
    },
  );
  seedManagerAssignment(managerRepository, "group-1");

  const result = await service.listKpiActualWorkspacePlans(
    createProgressReadOnlyBackofficeTeamManagerActor(),
    {},
  );
  assert.deepEqual(
    result.items.map((item) => item.planId),
    [managed.id],
  );
  const serializedResult = JSON.stringify(result);
  assert.equal(serializedResult.includes("999"), true);
  for (const hiddenValue of [
    hiddenPlan.id,
    hiddenPlan.planCode,
    hiddenPlan.subjectId,
    "TG-000002",
    "Hidden Team",
    "hidden-workspace-allocation",
    "hidden-workspace-actual",
    "hidden cross-group member",
  ]) {
    assert.equal(serializedResult.includes(hiddenValue), false, hiddenValue);
  }
  const detail = await service.getKpiActualWorkspacePlanDetail(
    createProgressReadOnlyBackofficeTeamManagerActor(),
    { kpiPlanId: managed.id },
  );
  const serializedDetail = JSON.stringify(detail);
  assert.equal(serializedDetail.includes("999"), true);
  assert.equal(
    detail.members.some(
      (member) => member.allocationId === "cross-group-workspace-allocation",
    ),
    false,
  );
  for (const hiddenValue of [
    hiddenPlan.id,
    hiddenPlan.planCode,
    hiddenPlan.subjectId,
    "TG-000002",
    "Hidden Team",
    "hidden-workspace-allocation",
    "hidden-workspace-actual",
    "hidden cross-group member",
  ]) {
    assert.equal(serializedDetail.includes(hiddenValue), false, hiddenValue);
  }
  await assert.rejects(
    service.getKpiActualWorkspacePlanDetail(
      createProgressReadOnlyBackofficeTeamManagerActor(),
      { kpiPlanId: hiddenPlan.id },
    ),
    KpiPermissionScopeError,
  );
});

test("KPI actual workspace status booleans use accepted daily status AND semantics", async () => {
  const { service, repository, actualRepository } = createHarness(
    () => MAY_5_2026_NOON_HCM,
  );
  const both = await createPublishedGroupPlan(service);
  const overdueOnly = await createPublishedGroupPlan(service);
  const pendingOnly = await createPublishedGroupPlan(service);
  const neither = await createPublishedGroupPlan(service);

  seedOfficialActualEntriesForDates(
    repository,
    actualRepository,
    overdueOnly.id,
    ["2026-05-05"],
  );
  seedOfficialActualEntriesForDates(
    repository,
    actualRepository,
    pendingOnly.id,
    ["2026-05-01", "2026-05-02", "2026-05-03", "2026-05-04"],
  );
  seedOfficialActualEntriesForDates(
    repository,
    actualRepository,
    neither.id,
    ["2026-05-01", "2026-05-02", "2026-05-03", "2026-05-04", "2026-05-05"],
    0,
  );

  const listIds = async (
    hasOverdueActuals: boolean,
    hasPendingActuals: boolean,
  ) =>
    (
      await service.listKpiActualWorkspacePlans(createActor(), {
        hasOverdueActuals,
        hasPendingActuals,
        sortBy: "planCode",
        sortDirection: "ASC",
      })
    ).items.map((item) => item.planId);

  assert.deepEqual(await listIds(true, true), [both.id]);
  assert.deepEqual(await listIds(true, false), [overdueOnly.id]);
  assert.deepEqual(await listIds(false, true), [pendingOnly.id]);
  assert.deepEqual(await listIds(false, false), [neither.id]);
});

test("KPI actual workspace status booleans ignore future, EXCUSED, and NOT_REQUIRED slots", async () => {
  const now = { value: MAY_5_2026_AFTER_LOCK_HCM };
  const { service, repository, actualRepository } = createHarness(
    () => now.value,
  );
  const exempted = await createPublishedGroupPlan(service);
  const future = await createPublishedJune2026GroupPlan(service);
  seedOfficialActualEntriesForDates(repository, actualRepository, exempted.id, [
    "2026-05-01",
    "2026-05-02",
    "2026-05-03",
    "2026-05-04",
  ]);
  seedOfficialActualExcusesForDate(repository, exempted.id, "2026-05-05");
  seedOfficialActualExcusesForDate(repository, exempted.id, "2026-05-06");

  const neither = await service.listKpiActualWorkspacePlans(createActor(), {
    hasOverdueActuals: false,
    hasPendingActuals: false,
    sortBy: "planCode",
    sortDirection: "ASC",
  });
  assert.deepEqual(
    neither.items.map((item) => item.planId),
    [exempted.id, future.id],
  );
  assert.deepEqual(
    (
      await service.listKpiActualWorkspacePlans(createActor(), {
        hasOverdueActuals: true,
      })
    ).items,
    [],
  );
  assert.deepEqual(
    (
      await service.listKpiActualWorkspacePlans(createActor(), {
        hasPendingActuals: true,
      })
    ).items,
    [],
  );
});

test("KPI actual workspace status booleans respect the D+1 10:00 HCM cutoff", async () => {
  const now = { value: MAY_6_2026_10_00_HCM };
  const { service, repository, actualRepository } = createHarness(
    () => now.value,
  );
  const plan = await createPublishedGroupPlan(service);
  seedOfficialActualEntriesForDates(repository, actualRepository, plan.id, [
    "2026-05-01",
    "2026-05-02",
    "2026-05-03",
    "2026-05-04",
  ]);

  assert.deepEqual(
    (
      await service.listKpiActualWorkspacePlans(createActor(), {
        hasPendingActuals: true,
        hasOverdueActuals: false,
      })
    ).items.map((item) => item.planId),
    [plan.id],
  );

  now.value = MAY_5_2026_AFTER_LOCK_HCM;
  assert.deepEqual(
    (
      await service.listKpiActualWorkspacePlans(createActor(), {
        hasOverdueActuals: true,
      })
    ).items.map((item) => item.planId),
    [plan.id],
  );
});

test("KPI actual workspace applies status booleans before pagination and validates cursor shape", async () => {
  const { service } = createHarness(() => MAY_5_2026_NOON_HCM);
  const skipped = await service.createKpiPlan(
    createActor(),
    groupPlanCommand(),
  );
  await service.publishKpiPlan(createActor(), { kpiPlanId: skipped.id });
  const firstMatch = await createPublishedGroupPlan(service);
  const secondMatch = await createPublishedGroupPlan(service);

  const firstPage = await service.listKpiActualWorkspacePlans(createActor(), {
    hasPendingActuals: true,
    limit: 1,
    sortBy: "planCode",
    sortDirection: "ASC",
  });
  assert.deepEqual(
    firstPage.items.map((item) => item.planId),
    [firstMatch.id],
  );
  assert.ok(firstPage.nextCursor);

  const secondPage = await service.listKpiActualWorkspacePlans(createActor(), {
    hasPendingActuals: true,
    limit: 1,
    sortBy: "planCode",
    sortDirection: "ASC",
    cursor: firstPage.nextCursor,
  });
  assert.deepEqual(
    secondPage.items.map((item) => item.planId),
    [secondMatch.id],
  );
  assert.equal(secondPage.nextCursor, undefined);

  await assert.rejects(
    service.listKpiActualWorkspacePlans(createActor(), {
      hasPendingActuals: false,
      limit: 1,
      sortBy: "planCode",
      sortDirection: "ASC",
      cursor: firstPage.nextCursor,
    }),
    KpiValidationError,
  );
});

test("KPI actual workspace status booleans compose with search, coverage, and derived sorts", async () => {
  const { service } = createHarness(() => MAY_5_2026_NOON_HCM);
  const plan = await createPublishedGroupPlan(service);

  const queries = [
    {
      hasPendingActuals: true,
      search: plan.planCode.toLowerCase(),
    },
    {
      hasPendingActuals: true,
      allocationCoverage: "complete" as const,
    },
    {
      hasPendingActuals: true,
      sortBy: "revenueActual" as const,
    },
    {
      hasPendingActuals: true,
      sortBy: "achievementPercent" as const,
    },
  ];
  for (const query of queries) {
    assert.deepEqual(
      (
        await service.listKpiActualWorkspacePlans(createActor(), query)
      ).items.map((item) => item.planId),
      [plan.id],
    );
  }
});

test("KPI actual workspace applies status booleans before derived-sort pagination", async () => {
  const { service } = createHarness(() => MAY_5_2026_NOON_HCM);
  const skipped = await service.createKpiPlan(
    createActor(),
    groupPlanCommand(),
  );
  await service.publishKpiPlan(createActor(), { kpiPlanId: skipped.id });
  const matching = [
    await createPublishedGroupPlan(service),
    await createPublishedGroupPlan(service),
  ];

  const firstPage = await service.listKpiActualWorkspacePlans(createActor(), {
    hasPendingActuals: true,
    limit: 1,
    sortBy: "revenueActual",
    sortDirection: "ASC",
  });
  assert.ok(firstPage.nextCursor);
  const secondPage = await service.listKpiActualWorkspacePlans(createActor(), {
    hasPendingActuals: true,
    limit: 1,
    sortBy: "revenueActual",
    sortDirection: "ASC",
    cursor: firstPage.nextCursor,
  });
  assert.deepEqual(
    [...firstPage.items, ...secondPage.items].map((item) => item.planId).sort(),
    matching.map((plan) => plan.id).sort(),
  );
  assert.equal(secondPage.nextCursor, undefined);
});

test("KPI managed actual workspace status booleans ignore hidden group and wrong-group allocation status", async () => {
  const { service, repository, actualRepository, managerRepository } =
    createHarness(() => MAY_5_2026_NOON_HCM);
  const managed = await createPublishedGroupPlan(service);
  seedOfficialActualEntriesForDates(repository, actualRepository, managed.id, [
    "2026-05-01",
    "2026-05-02",
    "2026-05-03",
    "2026-05-04",
  ]);
  const managedAllocations = repository.allocations.filter(
    (allocation) => allocation.kpiPlanId === managed.id,
  );
  const hiddenPlan: KpiPlan = {
    ...managed,
    id: "hidden-status-filter-plan",
    planCode: "KPI-HIDDEN-STATUS",
    normalizedPlanCode: "kpi-hidden-status",
    subjectId: "group-2",
  };
  repository.plans.push(hiddenPlan);
  repository.allocations.push(
    ...managedAllocations.map((allocation) => ({
      ...allocation,
      id: `hidden:${allocation.id}`,
      kpiPlanId: hiddenPlan.id,
      subjectId: "group-2",
      groupId: "group-2",
    })),
    {
      ...(managedAllocations[0] as KpiAllocation),
      id: "wrong-group-visible-plan-allocation",
      subjectId: "group-2",
      groupId: "group-2",
      memberTalentId: "hidden-talent",
    },
  );
  seedManagerAssignment(managerRepository, "group-1");

  const actor = createProgressReadOnlyBackofficeTeamManagerActor();
  assert.deepEqual(
    (
      await service.listKpiActualWorkspacePlans(actor, {
        hasOverdueActuals: true,
      })
    ).items,
    [],
  );
  assert.deepEqual(
    (
      await service.listKpiActualWorkspacePlans(actor, {
        hasPendingActuals: true,
      })
    ).items.map((item) => item.planId),
    [managed.id],
  );
  assert.deepEqual(
    (
      await service.listKpiActualWorkspacePlans(createActor(), {
        hasOverdueActuals: true,
      })
    ).items.map((item) => item.planId),
    [hiddenPlan.id],
  );
});

test("KPI actual workspace status boolean contract is strict", async () => {
  const { service } = createHarness(() => MAY_5_2026_NOON_HCM);
  await createPublishedGroupPlan(service);

  for (const value of ["", "TRUE", "1", 1]) {
    await assert.rejects(
      service.listKpiActualWorkspacePlans(createActor(), {
        hasOverdueActuals: value as string,
      }),
      KpiValidationError,
    );
  }
  for (const sortBy of ["actualEntryStatus", "overdueEntryCount"]) {
    await assert.rejects(
      service.listKpiActualWorkspacePlans(createActor(), { sortBy }),
      KpiValidationError,
    );
  }
});

test("KPI actual workspace query controller rejects unknown list fields and reads visible detail", async () => {
  const { service } = createHarness(() => MAY_5_2026_NOON_HCM);
  const published = await createPublishedGroupPlan(service);
  const controller = new KpiAdminQueryController(service) as unknown as {
    handle(req: Request, actor: Actor, context: "ADMIN"): Promise<unknown>;
  };

  for (const field of [
    "unsupported",
    "actualEntryStatus",
    "overdueCountMin",
    "pendingCountMin",
  ]) {
    await assert.rejects(async () => {
      const req = {
        query: { [field]: "true" },
        params: {},
      } as unknown as Request;
      bindCommand(req, "KPI_ACTUAL_WORKSPACE_PLAN_LIST");
      await controller.handle(req, createActor(), "ADMIN");
    }, KpiValidationError);
  }

  const listReq = {
    query: { hasOverdueActuals: "true", hasPendingActuals: "true" },
    params: {},
  } as unknown as Request;
  bindCommand(listReq, "KPI_ACTUAL_WORKSPACE_PLAN_LIST");
  assert.deepEqual(
    (
      (await controller.handle(listReq, createActor(), "ADMIN")) as {
        readonly items: readonly { readonly planId: string }[];
      }
    ).items.map((item) => item.planId),
    [published.id],
  );

  const req = {
    query: {},
    params: { kpiPlanId: published.id },
  } as unknown as Request;
  bindCommand(req, "KPI_ACTUAL_WORKSPACE_PLAN_GET_DETAIL");
  const detail = await controller.handle(req, createActor(), "ADMIN");
  assert.equal((detail as { readonly planId: string }).planId, published.id);
  await assert.rejects(
    service.getKpiActualWorkspacePlanDetail(createActor(), {
      kpiPlanId: "missing-workspace-plan",
    }),
    KpiNotFoundError,
  );
});

test("KPI V2 controller rejects unknown create payload keys", async () => {
  const { service } = createHarness();
  const controller = new KpiAdminController(service) as unknown as {
    handle(req: Request, actor: Actor, context: "ADMIN"): Promise<unknown>;
  };

  await assert.rejects(async () => {
    const req = {
      body: { ...groupPlanCommand(), unexpected: true },
      params: {},
    } as Request;
    bindCommand(req, "KPI_PLAN_CREATE");
    await controller.handle(req, createActor(), "ADMIN");
  }, KpiValidationError);
});

interface RecordedAudit {
  readonly actorId: string;
  readonly permissionCode: string;
  readonly resourceId?: string;
  readonly metadata?: Record<string, unknown>;
}

class RecordingAuditGuard {
  readonly records: RecordedAudit[] = [];

  async record(
    actor: Parameters<AuditGuard["record"]>[0],
    permission: Parameters<AuditGuard["record"]>[1],
    resourceId?: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    this.records.push({
      actorId: actor.id,
      permissionCode: permission.code,
      resourceId,
      metadata,
    });
  }
}

function assertAuditRecord(
  audit: RecordingAuditGuard,
  expected: {
    readonly operation: string;
    readonly resourceId: string;
    readonly permissionCode: Permission;
  },
): void {
  const record = audit.records[audit.records.length - 1];
  assert.ok(record);
  assert.equal(record.actorId, "admin-1");
  assert.equal(record.permissionCode, expected.permissionCode);
  assert.equal(record.resourceId, expected.resourceId);
  assert.equal(record.metadata?.mutationType, expected.operation);
  assert.equal(record.metadata?.targetId, expected.resourceId);
  assert.equal(record.metadata?.targetType, "kpi-plan");
  assert.equal(record.metadata?.actorId, "admin-1");
}

class ImmediateMutationBridge implements AuthoritativeAdminMutationBridge {
  async execute<T>(
    _params: Parameters<AuthoritativeAdminMutationBridge["execute"]>[0],
    mutate: Parameters<AuthoritativeAdminMutationBridge["execute"]>[1],
  ): Promise<T> {
    return mutate({} as ClientSession, {
      markAuthSecurityTruthChanged() {},
      markExplicitNoOpSuccess() {},
    }) as Promise<T>;
  }
}

function buildFutureSubjectDraftPlan(subjectType: KpiSubjectType): KpiPlan {
  return {
    id: `future-${subjectType}`,
    planCode: `KPI-${subjectType}`,
    normalizedPlanCode: `kpi-${subjectType.toLocaleLowerCase("en-US")}`,
    title: "Future subject KPI",
    normalizedTitle: "future subject kpi",
    description: null,
    subjectType,
    subjectId: `future-subject-${subjectType}`,
    status: "DRAFT",
    currencyCode: "VND",
    periodMonth: "2026-05",
    periodStartAt: MAY_2026_START_AT,
    periodEndAt: MAY_2026_END_AT,
    timezone: "Asia/Ho_Chi_Minh",
    actualPolicySnapshot: null,
    publishedAt: null,
    publishedByActorId: null,
    finalizedAt: null,
    finalizedByActorId: null,
    archivedAt: null,
    archivedByActorId: null,
    createdAt: 1_700_000_000_000,
    createdByActorId: "seed",
    updatedAt: 1_700_000_000_000,
    updatedByActorId: "seed",
    externalRef: null,
  };
}

class InMemoryBusinessCodeSequenceRepository implements BusinessCodeSequenceRepository {
  private current = 0;

  async allocateNext(): Promise<number> {
    this.current += 1;
    return this.current;
  }

  async ensureAtLeast(
    _moduleKey: string,
    _bucket: string,
    value: number,
  ): Promise<void> {
    this.current = Math.max(this.current, value);
  }
}

class InMemoryKpiSubjectReadonlyAccess implements KpiSubjectReadonlyAccess {
  listSubjectRefsCallCount = 0;
  readonly listSubjectRefsSubjects: KpiSubjectReferenceLookup[] = [];
  readonly orgUnits = new Map<
    string,
    {
      readonly id: string;
      readonly code: string;
      readonly name: string;
      readonly type: string;
      readonly status: string;
      readonly parentOrgUnitId?: string | null;
      readonly ancestorChain?: readonly string[];
      readonly externalRef?: string | null;
      readonly managerEmploymentProfileIds?: readonly string[];
      readonly memberEmploymentProfileIds?: readonly string[];
      readonly description?: string | null;
    }
  >([
    [
      "org-department-active",
      {
        id: "org-department-active",
        code: "OU-DEP-001",
        name: "HR Department",
        type: "DEPARTMENT",
        status: "ACTIVE",
        parentOrgUnitId: "org-business-active",
        ancestorChain: ["org-business-active"],
        externalRef: "hr-external",
        managerEmploymentProfileIds: ["manager-profile-1"],
        memberEmploymentProfileIds: ["talent-profile-1"],
        description: "Sensitive HR department notes",
      },
    ],
    [
      "org-team-active",
      {
        id: "org-team-active",
        code: "OU-TEAM-001",
        name: "Ops Team",
        type: "TEAM",
        status: "ACTIVE",
      },
    ],
    [
      "org-business-active",
      {
        id: "org-business-active",
        code: "OU-BU-001",
        name: "Business Unit",
        type: "BUSINESS_UNIT",
        status: "ACTIVE",
      },
    ],
    [
      "org-support-active",
      {
        id: "org-support-active",
        code: "OU-SUP-001",
        name: "Support Unit",
        type: "SUPPORT_UNIT",
        status: "ACTIVE",
      },
    ],
    [
      "org-inactive",
      {
        id: "org-inactive",
        code: "OU-INACTIVE-001",
        name: "Inactive Unit",
        type: "DEPARTMENT",
        status: "INACTIVE",
      },
    ],
    [
      "org-unsupported-type",
      {
        id: "org-unsupported-type",
        code: "OU-LEGACY-001",
        name: "Legacy Unit",
        type: "LEGACY_UNIT",
        status: "ACTIVE",
      },
    ],
  ]);
  readonly orgUnitProfiles = new Map<
    string,
    {
      readonly employmentProfileId: string;
      readonly employeeCode: string | null;
      readonly displayName: string;
      readonly orgUnitId: string;
      readonly employmentStatus: "ACTIVE" | "ON_LEAVE" | "TERMINATED";
    }
  >([
    [
      "org-profile-1",
      {
        employmentProfileId: "org-profile-1",
        employeeCode: "EP-ORG-001",
        displayName: "Org Profile 1",
        orgUnitId: "org-department-active",
        employmentStatus: "ACTIVE",
      },
    ],
    [
      "org-profile-on-leave",
      {
        employmentProfileId: "org-profile-on-leave",
        employeeCode: "EP-ORG-002",
        displayName: "Org Profile On Leave",
        orgUnitId: "org-department-active",
        employmentStatus: "ON_LEAVE",
      },
    ],
    [
      "org-profile-inactive",
      {
        employmentProfileId: "org-profile-inactive",
        employeeCode: "EP-ORG-003",
        displayName: "Org Profile Inactive",
        orgUnitId: "org-department-active",
        employmentStatus: "TERMINATED",
      },
    ],
    [
      "org-profile-descendant",
      {
        employmentProfileId: "org-profile-descendant",
        employeeCode: "EP-ORG-004",
        displayName: "Org Profile Descendant",
        orgUnitId: "org-team-active",
        employmentStatus: "ACTIVE",
      },
    ],
  ]);

  async listSubjectRefs(
    subjects: readonly KpiSubjectReferenceLookup[],
  ): Promise<Map<string, ReferenceSummary>> {
    this.listSubjectRefsCallCount += 1;
    this.listSubjectRefsSubjects.push(...subjects);
    const refs = new Map<string, ReferenceSummary>();
    for (const subject of subjects) {
      if (subject.subjectType === "TALENT_GROUP") {
        if (subject.subjectId === "group-1") {
          refs.set(kpiSubjectRefKey(subject), {
            id: "group-1",
            code: "TG-000001",
            name: "Creator Team",
            displayName: "Creator Team",
            status: "ACTIVE",
          });
        }
        if (subject.subjectId === "group-2") {
          refs.set(kpiSubjectRefKey(subject), {
            id: "group-2",
            code: "TG-000002",
            name: "Hidden Team",
            displayName: "Hidden Team",
            status: "ACTIVE",
          });
        }
      }
      if (subject.subjectType === "TALENT") {
        if (subject.subjectId === "talent-1") {
          refs.set(kpiSubjectRefKey(subject), {
            id: "talent-1",
            code: "TAL-000001",
            displayName: "Talent Profile 1",
            status: "ACTIVE",
          });
        }
        if (subject.subjectId === "talent-2") {
          refs.set(kpiSubjectRefKey(subject), {
            id: "talent-2",
            code: "TAL-000002",
            displayName: "Talent Profile 2",
            status: "ACTIVE",
          });
        }
      }
      if (subject.subjectType === "ORG_UNIT") {
        const orgUnit = this.orgUnits.get(subject.subjectId);
        if (orgUnit) {
          refs.set(kpiSubjectRefKey(subject), {
            id: orgUnit.id,
            code: orgUnit.code,
            name: orgUnit.name,
            displayName: orgUnit.name,
            status: orgUnit.status,
          });
        }
      }
    }
    return refs;
  }

  async listTalentGroupIdsByCodeOrName(input: {
    readonly search: string;
    readonly groupIds?: readonly string[];
  }): Promise<readonly string[]> {
    const search = input.search.trim().toLocaleLowerCase("en-US");
    const allowed = input.groupIds ? new Set(input.groupIds) : null;
    return [
      { id: "group-1", code: "TG-000001", name: "Creator Team" },
      { id: "group-2", code: "TG-000002", name: "Hidden Team" },
    ]
      .filter((group) => !allowed || allowed.has(group.id))
      .filter((group) =>
        `${group.code} ${group.name}`
          .toLocaleLowerCase("en-US")
          .includes(search),
      )
      .map((group) => group.id);
  }

  async listActiveOrgUnitIdsByIds(
    orgUnitIds: readonly string[],
  ): Promise<readonly string[]> {
    const ids = new Set(orgUnitIds);
    return [...this.orgUnits.values()]
      .filter((orgUnit) => ids.has(orgUnit.id))
      .filter((orgUnit) => isSupportedActiveTestOrgUnit(orgUnit))
      .map((orgUnit) => orgUnit.id)
      .sort();
  }

  async listActiveOrgUnitDescendantIds(
    ancestorOrgUnitIds: readonly string[],
  ): Promise<readonly string[]> {
    const ancestors = new Set(ancestorOrgUnitIds);
    return [...this.orgUnits.values()]
      .filter((orgUnit) =>
        (orgUnit.ancestorChain ?? []).some((ancestorId) =>
          ancestors.has(ancestorId),
        ),
      )
      .filter((orgUnit) => isSupportedActiveTestOrgUnit(orgUnit))
      .map((orgUnit) => orgUnit.id)
      .sort();
  }

  async listActiveOrgUnitIdsByCodeOrName(input: {
    readonly search: string;
    readonly orgUnitIds?: readonly string[];
  }): Promise<readonly string[]> {
    const search = input.search.trim().toLocaleLowerCase("en-US");
    const allowed = input.orgUnitIds ? new Set(input.orgUnitIds) : null;
    return [...this.orgUnits.values()]
      .filter((orgUnit) => !allowed || allowed.has(orgUnit.id))
      .filter((orgUnit) => isSupportedActiveTestOrgUnit(orgUnit))
      .filter((orgUnit) =>
        `${orgUnit.code} ${orgUnit.name}`
          .toLocaleLowerCase("en-US")
          .includes(search),
      )
      .map((orgUnit) => orgUnit.id)
      .sort();
  }

  async hasActiveTalent(talentId: string): Promise<boolean> {
    return talentId === "talent-1" || talentId === "talent-2";
  }

  async hasActiveTalentGroup(groupId: string): Promise<boolean> {
    return groupId === "group-1";
  }

  async hasActiveOrgUnit(orgUnitId: string): Promise<boolean> {
    const orgUnit = this.orgUnits.get(orgUnitId);
    return orgUnit !== undefined && isSupportedActiveTestOrgUnit(orgUnit);
  }

  async findActiveGroupMember(
    groupId: string,
    memberTalentId: string,
  ): Promise<KpiGroupMemberLookup | null> {
    if (
      groupId !== "group-1" ||
      (memberTalentId !== "talent-1" && memberTalentId !== "talent-2")
    ) {
      return null;
    }
    return {
      membershipId: `membership-${memberTalentId}`,
      talentId: memberTalentId,
      employmentProfileId:
        memberTalentId === "talent-1" ? "talent-profile-1" : "talent-profile-2",
      displayName: memberTalentId,
    };
  }

  async findActiveGroupMemberByEmploymentProfile(
    groupId: string,
    employmentProfileId: string,
  ): Promise<KpiGroupMemberLookup | null> {
    if (groupId !== "group-1") {
      return null;
    }
    const talentId =
      employmentProfileId === "talent-profile-1"
        ? "talent-1"
        : employmentProfileId === "talent-profile-2"
          ? "talent-2"
          : null;
    if (!talentId) {
      return null;
    }
    return {
      membershipId: `membership-${talentId}`,
      talentId,
      employmentProfileId,
      displayName: employmentProfileId,
    };
  }

  async listActiveInternalGroupMembers(
    groupId: string,
    input: { readonly search?: string; readonly limit: number },
  ): Promise<readonly KpiManagedMemberLookup[]> {
    if (groupId !== "group-1") {
      return [];
    }
    const search = input.search?.toLocaleLowerCase("en-US");
    return [
      {
        employmentProfileId: "talent-profile-1",
        employeeCode: "EP-000001",
        displayName: "Talent Profile 1",
        talentId: "talent-1",
        talentCode: "TAL-000001",
        groupId,
      },
      {
        employmentProfileId: "talent-profile-2",
        employeeCode: "EP-000002",
        displayName: "Talent Profile 2",
        talentId: "talent-2",
        talentCode: "TAL-000002",
        groupId,
      },
    ]
      .filter((item) =>
        search
          ? `${item.displayName} ${item.employeeCode} ${item.talentCode}`
              .toLocaleLowerCase("en-US")
              .includes(search)
          : true,
      )
      .slice(0, input.limit);
  }

  async findActiveOrgUnitMemberByEmploymentProfile(
    orgUnitId: string,
    employmentProfileId: string,
  ): Promise<KpiOrgUnitMemberLookup | null> {
    const profile = this.orgUnitProfiles.get(employmentProfileId);
    if (
      !profile ||
      profile.orgUnitId !== orgUnitId ||
      !["ACTIVE", "ON_LEAVE"].includes(profile.employmentStatus)
    ) {
      return null;
    }
    return {
      employmentProfileId: profile.employmentProfileId,
      employeeCode: profile.employeeCode,
      displayName: profile.displayName,
      orgUnitId: profile.orgUnitId,
    };
  }

  async listActiveOrgUnitMembers(
    orgUnitId: string,
    input: { readonly search?: string; readonly limit: number },
  ): Promise<readonly KpiOrgUnitMemberLookup[]> {
    const search = input.search?.toLocaleLowerCase("en-US");
    return [...this.orgUnitProfiles.values()]
      .filter((profile) => profile.orgUnitId === orgUnitId)
      .filter((profile) => ["ACTIVE", "ON_LEAVE"].includes(profile.employmentStatus))
      .map((profile) => ({
        employmentProfileId: profile.employmentProfileId,
        employeeCode: profile.employeeCode,
        displayName: profile.displayName,
        orgUnitId: profile.orgUnitId,
      }))
      .filter((item) =>
        search
          ? `${item.displayName} ${item.employeeCode ?? ""} ${item.employmentProfileId}`
              .toLocaleLowerCase("en-US")
              .includes(search)
          : true,
      )
      .slice(0, input.limit);
  }

  async findActiveEmploymentProfileByLinkedUserId(
    linkedUserId: string,
  ): Promise<{ readonly employmentProfileId: string } | null> {
    if (linkedUserId === "manager-user") {
      return { employmentProfileId: "manager-profile-1" };
    }
    if (linkedUserId === "talent-user") {
      return { employmentProfileId: "talent-profile-1" };
    }
    return null;
  }

  async findNonArchivedTalentByLinkedEmploymentProfileId(
    linkedEmploymentProfileId: string,
  ): Promise<{ readonly talentId: string } | null> {
    if (linkedEmploymentProfileId === "talent-profile-1") {
      return { talentId: "talent-1" };
    }
    return null;
  }
}

class InMemoryKpiPlanRepository implements KpiPlanRepository {
  readonly plans: KpiPlan[] = [];
  readonly targets: KpiTargetMetric[] = [];
  readonly allocations: KpiAllocation[] = [];
  readonly actualExcuses: KpiActualSlotExcuse[] = [];
  actualEntries: KpiActualEntry[] = [];
  countAllocationsByPlanIdsCallCount = 0;
  listAllocationsByPlanIdCallCount = 0;

  async insertPlan(plan: KpiPlan): Promise<KpiPlan> {
    this.plans.push(plan);
    return plan;
  }

  async findPlanById(kpiPlanId: string): Promise<KpiPlan | null> {
    return this.plans.find((plan) => plan.id === kpiPlanId) ?? null;
  }

  async listPlansByIds(
    kpiPlanIds: readonly string[],
  ): Promise<readonly KpiPlan[]> {
    const ids = new Set(kpiPlanIds);
    return this.plans.filter((plan) => ids.has(plan.id));
  }

  async findPlanByPlanCode(planCode: string): Promise<KpiPlan | null> {
    return this.plans.find((plan) => plan.planCode === planCode) ?? null;
  }

  async findMaxGeneratedPlanCodeSequence(): Promise<number> {
    return this.plans.length;
  }

  async updateDraftCore(input: {
    readonly kpiPlanId: string;
    readonly title?: string;
    readonly normalizedTitle?: string;
    readonly description?: string | null;
    readonly currencyCode?: "VND";
    readonly periodMonth?: string;
    readonly periodStartAt?: number;
    readonly periodEndAt?: number;
    readonly timezone?: string;
    readonly externalRef?: string | null;
    readonly updatedAt: number;
    readonly updatedByActorId: string;
  }): Promise<KpiPlan | null> {
    const index = this.plans.findIndex(
      (plan) => plan.id === input.kpiPlanId && plan.status === "DRAFT",
    );
    if (index < 0) {
      return null;
    }
    const current = this.plans[index] as KpiPlan;
    const updated = {
      ...current,
      title: input.title ?? current.title,
      normalizedTitle: input.normalizedTitle ?? current.normalizedTitle,
      description:
        input.description === undefined
          ? current.description
          : input.description,
      currencyCode: input.currencyCode ?? current.currencyCode,
      periodMonth: input.periodMonth ?? current.periodMonth,
      periodStartAt: input.periodStartAt ?? current.periodStartAt,
      periodEndAt: input.periodEndAt ?? current.periodEndAt,
      timezone: input.timezone ?? current.timezone,
      externalRef:
        input.externalRef === undefined
          ? current.externalRef
          : input.externalRef,
      updatedAt: input.updatedAt,
      updatedByActorId: input.updatedByActorId,
    };
    this.plans[index] = updated;
    return updated;
  }

  async transitionStatus(input: {
    readonly kpiPlanId: string;
    readonly fromStatuses: readonly KpiPlanStatus[];
    readonly toStatus: KpiPlanStatus;
    readonly publishedAt?: number | null;
    readonly publishedByActorId?: string | null;
    readonly actualPolicySnapshot?: KpiActualPolicySnapshot | null;
    readonly finalizedAt?: number | null;
    readonly finalizedByActorId?: string | null;
    readonly finalResult?: KpiPlan["finalResult"];
    readonly archivedAt?: number | null;
    readonly archivedByActorId?: string | null;
    readonly updatedAt: number;
    readonly updatedByActorId: string;
  }): Promise<KpiPlan | null> {
    const index = this.plans.findIndex(
      (plan) =>
        plan.id === input.kpiPlanId && input.fromStatuses.includes(plan.status),
    );
    if (index < 0) {
      return null;
    }
    const current = this.plans[index] as KpiPlan;
    const updated = {
      ...current,
      status: input.toStatus,
      publishedAt:
        input.publishedAt === undefined
          ? current.publishedAt
          : input.publishedAt,
      publishedByActorId:
        input.publishedByActorId === undefined
          ? current.publishedByActorId
          : input.publishedByActorId,
      actualPolicySnapshot:
        input.actualPolicySnapshot === undefined
          ? current.actualPolicySnapshot
          : input.actualPolicySnapshot,
      finalizedAt:
        input.finalizedAt === undefined
          ? current.finalizedAt
          : input.finalizedAt,
      finalizedByActorId:
        input.finalizedByActorId === undefined
          ? current.finalizedByActorId
          : input.finalizedByActorId,
      finalResult:
        input.finalResult === undefined
          ? current.finalResult
          : input.finalResult,
      archivedAt:
        input.archivedAt === undefined ? current.archivedAt : input.archivedAt,
      archivedByActorId:
        input.archivedByActorId === undefined
          ? current.archivedByActorId
          : input.archivedByActorId,
      updatedAt: input.updatedAt,
      updatedByActorId: input.updatedByActorId,
    };
    this.plans[index] = updated;
    return updated;
  }

  async listPlans(input: ListKpiPlansInput): Promise<readonly KpiPlan[]> {
    const subjectIds = normalizeTestSubjectIdFilter(input);
    if (subjectIds === null) {
      return [];
    }
    return this.plans
      .filter((plan) => {
        if (input.subjectType && plan.subjectType !== input.subjectType) {
          return false;
        }
        if (
          input.subjectType === undefined &&
          input.subjectTypes !== undefined &&
          !input.subjectTypes.includes(plan.subjectType)
        ) {
          return false;
        }
        if (subjectIds !== undefined && !subjectIds.includes(plan.subjectId)) {
          return false;
        }
        if (input.periodMonth && plan.periodMonth !== input.periodMonth) {
          return false;
        }
        if (input.status && plan.status !== input.status) {
          return false;
        }
        if (
          input.metricCode &&
          !this.targets.some(
            (metric) =>
              metric.kpiPlanId === plan.id &&
              metric.metricCode === input.metricCode,
          )
        ) {
          return false;
        }
        if (
          (input.search || input.searchSubjectIds) &&
          !(
            (input.search &&
              (plan.normalizedPlanCode.includes(input.search) ||
                plan.normalizedTitle.includes(input.search))) ||
            (input.searchSubjectIds ?? []).includes(plan.subjectId)
          )
        ) {
          return false;
        }
        if (input.cursor && !isAfterTestPlanCursor(plan, input.cursor)) {
          return false;
        }
        return true;
      })
      .sort((left, right) => {
        const field = input.sortBy ?? "periodMonth";
        const direction = input.sortDirection === "ASC" ? 1 : -1;
        const leftValue = String(left[field]);
        const rightValue = String(right[field]);
        const fieldDiff = leftValue.localeCompare(rightValue) * direction;
        if (
          field === "periodMonth" &&
          input.actualWorkspaceCursorOrder !== true
        ) {
          return (
            fieldDiff ||
            left.planCode.localeCompare(right.planCode) ||
            left.id.localeCompare(right.id)
          );
        }
        return fieldDiff || left.id.localeCompare(right.id);
      })
      .slice(0, input.limit);
  }

  async listActualWorkspaceDerivedPlans(
    input: ListKpiActualWorkspaceDerivedPlansInput,
  ): Promise<readonly KpiActualWorkspaceDerivedPlanSortRow[]> {
    const subjectIds = normalizeTestSubjectIdFilter(input);
    if (subjectIds === null) {
      return [];
    }
    return this.plans
      .filter((plan) => {
        if (input.subjectType && plan.subjectType !== input.subjectType) {
          return false;
        }
        if (
          input.subjectType === undefined &&
          input.subjectTypes !== undefined &&
          !input.subjectTypes.includes(
            plan.subjectType as Extract<KpiSubjectType, "TALENT_GROUP" | "ORG_UNIT">,
          )
        ) {
          return false;
        }
        if (subjectIds !== undefined && !subjectIds.includes(plan.subjectId)) {
          return false;
        }
        if (input.periodMonth && plan.periodMonth !== input.periodMonth) {
          return false;
        }
        if (input.status && plan.status !== input.status) {
          return false;
        }
        if (
          (input.search || input.searchSubjectIds) &&
          !(
            (input.search &&
              (plan.normalizedPlanCode.includes(input.search) ||
                plan.normalizedTitle.includes(input.search))) ||
            (input.searchSubjectIds ?? []).includes(plan.subjectId)
          )
        ) {
          return false;
        }
        return true;
      })
      .map((plan) =>
        buildTestDerivedWorkspaceRow(
          plan,
          this.allocations,
          this.actualEntries,
        ),
      )
      .filter((row) =>
        matchesTestAllocationCoverage(
          row,
          this.allocations,
          input.allocationCoverage,
        ),
      )
      .filter(
        (row) => !input.cursor || isAfterTestDerivedCursor(row, input.cursor),
      )
      .sort((left, right) => compareTestDerivedRows(left, right, input))
      .slice(0, input.limit);
  }

  async insertTargetMetrics(
    metrics: readonly KpiTargetMetric[],
  ): Promise<readonly KpiTargetMetric[]> {
    this.targets.push(...metrics);
    return metrics;
  }

  async replaceTargetMetricsForDraftPlan(
    kpiPlanId: string,
    metrics: readonly KpiTargetMetric[],
  ): Promise<void> {
    const plan = this.plans.find((item) => item.id === kpiPlanId);
    assert.equal(plan?.status, "DRAFT");
    removeMatching(this.targets, (metric) => metric.kpiPlanId === kpiPlanId);
    this.targets.push(...metrics);
  }

  async listTargetMetricsByPlanId(
    kpiPlanId: string,
  ): Promise<readonly KpiTargetMetric[]> {
    return this.targets.filter((metric) => metric.kpiPlanId === kpiPlanId);
  }

  async listTargetMetricsByPlanIds(
    kpiPlanIds: readonly string[],
  ): Promise<readonly KpiTargetMetric[]> {
    const planIds = new Set(kpiPlanIds);
    return this.targets.filter((metric) => planIds.has(metric.kpiPlanId));
  }

  async insertAllocations(
    allocations: readonly KpiAllocation[],
  ): Promise<readonly KpiAllocation[]> {
    for (const allocation of allocations) {
      assertValidTestAllocationIdentity(allocation);
    }
    this.allocations.push(...allocations);
    return allocations;
  }

  async replaceAllocationsForDraftPlan(
    kpiPlanId: string,
    allocations: readonly KpiAllocation[],
  ): Promise<void> {
    const plan = this.plans.find((item) => item.id === kpiPlanId);
    assert.equal(plan?.status, "DRAFT");
    for (const allocation of allocations) {
      assertValidTestAllocationIdentity(allocation);
    }
    removeMatching(
      this.allocations,
      (allocation) => allocation.kpiPlanId === kpiPlanId,
    );
    this.allocations.push(...allocations);
  }

  async listAllocationsByPlanId(
    kpiPlanId: string,
  ): Promise<readonly KpiAllocation[]> {
    this.listAllocationsByPlanIdCallCount += 1;
    return this.allocations.filter(
      (allocation) => allocation.kpiPlanId === kpiPlanId,
    );
  }

  async listAllocationsByPlanIds(
    kpiPlanIds: readonly string[],
  ): Promise<readonly KpiAllocation[]> {
    const planIds = new Set(kpiPlanIds);
    return this.allocations.filter((allocation) =>
      planIds.has(allocation.kpiPlanId),
    );
  }

  async countAllocationsByPlanIds(
    kpiPlanIds: readonly string[],
  ): Promise<readonly KpiAllocationStatusCount[]> {
    this.countAllocationsByPlanIdsCallCount += 1;
    const planIds = new Set(kpiPlanIds);
    const counts = new Map<string, KpiAllocationStatusCount>();

    for (const allocation of this.allocations) {
      if (!planIds.has(allocation.kpiPlanId)) {
        continue;
      }
      const key = `${allocation.kpiPlanId}:${allocation.allocationStatus}`;
      const current = counts.get(key);
      counts.set(key, {
        kpiPlanId: allocation.kpiPlanId,
        allocationStatus: allocation.allocationStatus,
        count: (current?.count ?? 0) + 1,
      });
    }

    return Array.from(counts.values());
  }

  async listAllocations(input: {
    readonly status?: KpiAllocation["allocationStatus"];
    readonly kpiPlanId?: string;
    readonly groupId?: string;
    readonly memberTalentId?: string;
    readonly memberEmploymentProfileId?: string;
    readonly limit: number;
  }): Promise<readonly KpiAllocation[]> {
    return this.allocations
      .filter((allocation) => {
        if (input.status && allocation.allocationStatus !== input.status) {
          return false;
        }
        if (input.kpiPlanId && allocation.kpiPlanId !== input.kpiPlanId) {
          return false;
        }
        if (input.groupId && allocation.groupId !== input.groupId) {
          return false;
        }
        if (
          input.memberTalentId &&
          allocation.memberTalentId !== input.memberTalentId
        ) {
          return false;
        }
        if (
          input.memberEmploymentProfileId &&
          allocation.memberEmploymentProfileId !==
            input.memberEmploymentProfileId
        ) {
          return false;
        }
        return true;
      })
      .slice(0, input.limit);
  }

  async replaceAllocationsForPlan(input: {
    readonly kpiPlanId: string;
    readonly allowedCurrentStatuses: readonly KpiAllocation["allocationStatus"][];
    readonly allocations: readonly KpiAllocation[];
  }): Promise<void> {
    for (const allocation of input.allocations) {
      assertValidTestAllocationIdentity(allocation);
    }
    if (
      this.allocations.some(
        (allocation) =>
          allocation.kpiPlanId === input.kpiPlanId &&
          !input.allowedCurrentStatuses.includes(allocation.allocationStatus),
      )
    ) {
      throw new Error("allocation status conflict");
    }
    removeMatching(
      this.allocations,
      (allocation) => allocation.kpiPlanId === input.kpiPlanId,
    );
    this.allocations.push(...input.allocations);
  }

  async transitionAllocationsForPlan(input: {
    readonly kpiPlanId: string;
    readonly fromStatus: KpiAllocation["allocationStatus"];
    readonly toStatus: KpiAllocation["allocationStatus"];
    readonly updatedAt: number;
    readonly updatedByActorId: string;
    readonly submittedAt?: number | null;
    readonly submittedByActorId?: string | null;
    readonly approvedAt?: number | null;
    readonly approvedByActorId?: string | null;
    readonly approvalNote?: string | null;
    readonly rejectedAt?: number | null;
    readonly rejectedByActorId?: string | null;
    readonly rejectionReason?: string | null;
    readonly publishedAt?: number | null;
    readonly publishedByActorId?: string | null;
  }): Promise<number> {
    let modified = 0;
    for (let index = 0; index < this.allocations.length; index += 1) {
      const allocation = this.allocations[index] as KpiAllocation;
      if (
        allocation.kpiPlanId !== input.kpiPlanId ||
        allocation.allocationStatus !== input.fromStatus
      ) {
        continue;
      }
      this.allocations[index] = {
        ...allocation,
        allocationStatus: input.toStatus,
        updatedAt: input.updatedAt,
        updatedByActorId: input.updatedByActorId,
        submittedAt:
          input.submittedAt === undefined
            ? allocation.submittedAt
            : input.submittedAt,
        submittedByActorId:
          input.submittedByActorId === undefined
            ? allocation.submittedByActorId
            : input.submittedByActorId,
        approvedAt:
          input.approvedAt === undefined
            ? allocation.approvedAt
            : input.approvedAt,
        approvedByActorId:
          input.approvedByActorId === undefined
            ? allocation.approvedByActorId
            : input.approvedByActorId,
        approvalNote:
          input.approvalNote === undefined
            ? allocation.approvalNote
            : input.approvalNote,
        rejectedAt:
          input.rejectedAt === undefined
            ? allocation.rejectedAt
            : input.rejectedAt,
        rejectedByActorId:
          input.rejectedByActorId === undefined
            ? allocation.rejectedByActorId
            : input.rejectedByActorId,
        rejectionReason:
          input.rejectionReason === undefined
            ? allocation.rejectionReason
            : input.rejectionReason,
        publishedAt:
          input.publishedAt === undefined
            ? allocation.publishedAt
            : input.publishedAt,
        publishedByActorId:
          input.publishedByActorId === undefined
            ? allocation.publishedByActorId
            : input.publishedByActorId,
      };
      modified += 1;
    }
    return modified;
  }

  async activateAllocationsForPlan(
    kpiPlanId: string,
    publishedAt: number,
  ): Promise<void> {
    for (let index = 0; index < this.allocations.length; index += 1) {
      const allocation = this.allocations[index] as KpiAllocation;
      if (
        allocation.kpiPlanId === kpiPlanId &&
        allocation.allocationStatus === "DRAFT"
      ) {
        this.allocations[index] = {
          ...allocation,
          allocationStatus: "PUBLISHED",
          publishedAt,
          updatedAt: publishedAt,
        };
      }
    }
  }

  async findActualSlotExcuseById(
    excuseId: string,
  ): Promise<KpiActualSlotExcuse | null> {
    return this.actualExcuses.find((excuse) => excuse.id === excuseId) ?? null;
  }

  async findActiveActualSlotExcuseByIdentity(input: {
    readonly kpiPlanId: string;
    readonly allocationId: string;
    readonly metricCode: KpiMetricCode;
    readonly actualDate: string;
  }): Promise<KpiActualSlotExcuse | null> {
    return (
      this.actualExcuses.find(
        (excuse) =>
          excuse.kpiPlanId === input.kpiPlanId &&
          excuse.allocationId === input.allocationId &&
          excuse.metricCode === input.metricCode &&
          excuse.actualDate === input.actualDate &&
          excuse.deletedAt === null,
      ) ?? null
    );
  }

  async listActualSlotExcusesByPlanIds(
    kpiPlanIds: readonly string[],
  ): Promise<readonly KpiActualSlotExcuse[]> {
    const ids = new Set(kpiPlanIds);
    return this.actualExcuses.filter(
      (excuse) => ids.has(excuse.kpiPlanId) && excuse.deletedAt === null,
    );
  }

  async listActualSlotExcusesByPlanIdAndActualDate(
    kpiPlanId: string,
    actualDate: string,
  ): Promise<readonly KpiActualSlotExcuse[]> {
    return this.actualExcuses.filter(
      (excuse) =>
        excuse.kpiPlanId === kpiPlanId &&
        excuse.actualDate === actualDate &&
        excuse.deletedAt === null,
    );
  }

  async setActualSlotExcuse(input: {
    readonly kpiPlanId: string;
    readonly allocationId: string;
    readonly metricCode: KpiMetricCode;
    readonly actualDate: string;
    readonly status: "EXCUSED" | "NOT_REQUIRED";
    readonly reasonCode:
      | "MEMBER_LEAVE"
      | "SCHEDULED_OFF"
      | "HOLIDAY_OR_CLOSURE"
      | "NO_OPERATION_REQUIRED"
      | "DATA_SOURCE_UNAVAILABLE"
      | "OTHER";
    readonly reasonText: string;
    readonly actorId: string;
    readonly now: number;
  }): Promise<KpiActualSlotExcuse> {
    const index = this.actualExcuses.findIndex(
      (excuse) =>
        excuse.kpiPlanId === input.kpiPlanId &&
        excuse.allocationId === input.allocationId &&
        excuse.metricCode === input.metricCode &&
        excuse.actualDate === input.actualDate &&
        excuse.deletedAt === null,
    );
    if (index >= 0) {
      const current = this.actualExcuses[index] as KpiActualSlotExcuse;
      const updated: KpiActualSlotExcuse = {
        ...current,
        status: input.status,
        reasonCode: input.reasonCode,
        reasonText: input.reasonText,
        updatedAt: input.now,
        updatedByActorId: input.actorId,
      };
      this.actualExcuses[index] = updated;
      return updated;
    }
    const created: KpiActualSlotExcuse = {
      id: `actual-excuse-${this.actualExcuses.length + 1}`,
      kpiPlanId: input.kpiPlanId,
      allocationId: input.allocationId,
      metricCode: input.metricCode,
      actualDate: input.actualDate,
      status: input.status,
      reasonCode: input.reasonCode,
      reasonText: input.reasonText,
      createdAt: input.now,
      createdByActorId: input.actorId,
      updatedAt: input.now,
      updatedByActorId: input.actorId,
      deletedAt: null,
      deletedByActorId: null,
    };
    this.actualExcuses.push(created);
    return created;
  }

  async removeActualSlotExcuse(input: {
    readonly excuseId: string;
    readonly kpiPlanId: string;
    readonly actorId: string;
    readonly now: number;
  }): Promise<KpiActualSlotExcuse | null> {
    const index = this.actualExcuses.findIndex(
      (excuse) =>
        excuse.id === input.excuseId &&
        excuse.kpiPlanId === input.kpiPlanId &&
        excuse.deletedAt === null,
    );
    if (index < 0) {
      return null;
    }
    const current = this.actualExcuses[index] as KpiActualSlotExcuse;
    const removed: KpiActualSlotExcuse = {
      ...current,
      updatedAt: input.now,
      updatedByActorId: input.actorId,
      deletedAt: input.now,
      deletedByActorId: input.actorId,
    };
    this.actualExcuses[index] = removed;
    return removed;
  }
}

class InMemoryKpiActualRepository implements KpiActualRepository {
  readonly entries: KpiActualEntry[] = [];
  readonly corrections: KpiActualCorrection[] = [];

  async findEntryById(actualEntryId: string): Promise<KpiActualEntry | null> {
    return this.entries.find((entry) => entry.id === actualEntryId) ?? null;
  }

  async findEntryByIdentity(input: {
    readonly kpiPlanId: string;
    readonly allocationId: string;
    readonly metricCode: KpiMetricCode;
    readonly actualDate: string;
  }): Promise<KpiActualEntry | null> {
    return (
      this.entries.find(
        (entry) =>
          entry.kpiPlanId === input.kpiPlanId &&
          entry.allocationId === input.allocationId &&
          entry.metricCode === input.metricCode &&
          entry.actualDate === input.actualDate,
      ) ?? null
    );
  }

  async insertEntry(entry: KpiActualEntry): Promise<KpiActualEntry> {
    const duplicate = await this.findEntryByIdentity(entry);
    if (duplicate) {
      throw new Error("duplicate actual entry");
    }
    this.entries.push(entry);
    return entry;
  }

  async updateEntryDirect(input: {
    readonly actualEntryId: string;
    readonly actualValue: number;
    readonly updatedAt: number;
    readonly updatedByActorId: string;
    readonly maxCurrentEditCountExclusive: number;
  }): Promise<KpiActualEntry | null> {
    const index = this.entries.findIndex(
      (entry) =>
        entry.id === input.actualEntryId &&
        entry.editCount < input.maxCurrentEditCountExclusive,
    );
    if (index < 0) {
      return null;
    }
    const current = this.entries[index] as KpiActualEntry;
    const updated: KpiActualEntry = {
      ...current,
      actualValue: input.actualValue,
      effectiveValue: input.actualValue,
      editCount: current.editCount + 1,
      updatedAt: input.updatedAt,
      updatedByActorId: input.updatedByActorId,
      lastEditedAt: input.updatedAt,
      lastEditedByActorId: input.updatedByActorId,
    };
    this.entries[index] = updated;
    return updated;
  }

  async insertCorrectionAndApply(input: {
    readonly correction: KpiActualCorrection;
    readonly updatedAt: number;
    readonly updatedByActorId: string;
  }): Promise<KpiActualEntry | null> {
    const index = this.entries.findIndex(
      (entry) => entry.id === input.correction.actualEntryId,
    );
    if (index < 0) {
      return null;
    }
    this.corrections.push(input.correction);
    const current = this.entries[index] as KpiActualEntry;
    const updated: KpiActualEntry = {
      ...current,
      effectiveValue: input.correction.correctedValue,
      correctionCount: current.correctionCount + 1,
      latestCorrectionId: input.correction.id,
      updatedAt: input.updatedAt,
      updatedByActorId: input.updatedByActorId,
    };
    this.entries[index] = updated;
    return updated;
  }

  async listEntriesByPlanId(
    kpiPlanId: string,
  ): Promise<readonly KpiActualEntry[]> {
    return this.entries.filter((entry) => entry.kpiPlanId === kpiPlanId);
  }

  async listEntriesByPlanIds(
    kpiPlanIds: readonly string[],
  ): Promise<readonly KpiActualEntry[]> {
    const ids = new Set(kpiPlanIds);
    return this.entries.filter((entry) => ids.has(entry.kpiPlanId));
  }

  async listEntriesByPlanIdAndActualDate(
    kpiPlanId: string,
    actualDate: string,
  ): Promise<readonly KpiActualEntry[]> {
    return this.entries.filter(
      (entry) =>
        entry.kpiPlanId === kpiPlanId && entry.actualDate === actualDate,
    );
  }

  async listCorrectionsByActualEntryId(
    actualEntryId: string,
  ): Promise<readonly KpiActualCorrection[]> {
    return this.corrections
      .filter((correction) => correction.actualEntryId === actualEntryId)
      .sort(
        (left, right) =>
          left.correctedAt - right.correctedAt ||
          left.createdAt - right.createdAt ||
          left.id.localeCompare(right.id),
      );
  }
}

class InMemoryManagerAssignmentRepository implements TalentGroupManagerAssignmentRepository {
  readonly assignments: TalentGroupManagerAssignment[] = [];

  async insertAssignment(
    assignment: TalentGroupManagerAssignment,
  ): Promise<TalentGroupManagerAssignment> {
    this.assignments.push(assignment);
    return assignment;
  }

  async listActiveAssignmentsByGroup(
    groupId: string,
    asOf: number,
  ): Promise<readonly TalentGroupManagerAssignment[]> {
    return this.assignments.filter(
      (assignment) =>
        assignment.groupId === groupId && isActiveAt(assignment, asOf),
    );
  }

  async listActiveAssignmentsByManagerEmploymentProfile(
    managerEmploymentProfileId: string,
    asOf: number,
  ): Promise<readonly TalentGroupManagerAssignment[]> {
    return this.assignments.filter(
      (assignment) =>
        assignment.managerEmploymentProfileId === managerEmploymentProfileId &&
        isActiveAt(assignment, asOf),
    );
  }

  async findAssignmentById(
    assignmentId: string,
  ): Promise<TalentGroupManagerAssignment | null> {
    return (
      this.assignments.find((assignment) => assignment.id === assignmentId) ??
      null
    );
  }

  async revokeAssignment(input: {
    readonly assignmentId: string;
    readonly effectiveTo: number;
    readonly updatedAt: number;
    readonly updatedByActorId: string;
  }): Promise<TalentGroupManagerAssignment | null> {
    const index = this.assignments.findIndex(
      (assignment) =>
        assignment.id === input.assignmentId &&
        isActiveAt(assignment, input.effectiveTo),
    );
    if (index < 0) {
      return null;
    }
    const current = this.assignments[index] as TalentGroupManagerAssignment;
    const updated: TalentGroupManagerAssignment = {
      ...current,
      status: "INACTIVE",
      effectiveTo: input.effectiveTo,
      updatedAt: input.updatedAt,
      updatedByActorId: input.updatedByActorId,
    };
    this.assignments[index] = updated;
    return updated;
  }

  async findManagerEmploymentProfileCandidate(employmentProfileId: string) {
    return {
      id: employmentProfileId,
      employeeCode: employmentProfileId,
      displayName: employmentProfileId,
      legalName: employmentProfileId,
      employmentStatus: "ACTIVE",
      linkedUserId: null,
      linkedUserRef: null,
      linkedUserActorKind: null,
      linkedUserAccountStatus: null,
    };
  }
}

class InMemoryOrgUnitManagerAssignmentRepository
  implements OrgUnitManagerAssignmentRepository
{
  readonly assignments: OrgUnitManagerAssignment[] = [];

  async insertAssignment(
    assignment: OrgUnitManagerAssignment,
  ): Promise<OrgUnitManagerAssignment> {
    this.assignments.push(assignment);
    return assignment;
  }

  async listAssignmentsByOrgUnitId(
    orgUnitId: string,
  ): Promise<readonly OrgUnitManagerAssignment[]> {
    return this.assignments.filter(
      (assignment) => assignment.orgUnitId === orgUnitId,
    );
  }

  async listActiveByManagerEmploymentProfileId(
    managerEmploymentProfileId: string,
    asOf: number,
  ): Promise<readonly OrgUnitManagerAssignment[]> {
    return this.assignments.filter(
      (assignment) =>
        assignment.managerEmploymentProfileId ===
          managerEmploymentProfileId && isActiveAt(assignment, asOf),
    );
  }

  async listActiveByManagerEmploymentProfileIdAndRole(
    managerEmploymentProfileId: string,
    role: OrgUnitManagerAssignment["role"],
    asOf: number,
  ): Promise<readonly OrgUnitManagerAssignment[]> {
    return this.assignments.filter(
      (assignment) =>
        assignment.managerEmploymentProfileId ===
          managerEmploymentProfileId &&
        assignment.role === role &&
        isActiveAt(assignment, asOf),
    );
  }

  async listActiveByOrgUnitId(
    orgUnitId: string,
    asOf: number,
  ): Promise<readonly OrgUnitManagerAssignment[]> {
    return this.assignments.filter(
      (assignment) =>
        assignment.orgUnitId === orgUnitId && isActiveAt(assignment, asOf),
    );
  }

  async findAssignmentById(
    assignmentId: string,
  ): Promise<OrgUnitManagerAssignment | null> {
    return (
      this.assignments.find((assignment) => assignment.id === assignmentId) ??
      null
    );
  }

  async updateAssignment(input: {
    readonly assignmentId: string;
    readonly role?: OrgUnitManagerAssignment["role"];
    readonly includeDescendants?: boolean;
    readonly effectiveFrom?: number;
    readonly effectiveTo?: number | null;
    readonly isPrimary?: boolean;
    readonly updatedAt: number;
    readonly updatedByActorId: string;
  }): Promise<OrgUnitManagerAssignment | null> {
    const index = this.assignments.findIndex(
      (assignment) => assignment.id === input.assignmentId,
    );
    if (index < 0) {
      return null;
    }
    const current = this.assignments[index] as OrgUnitManagerAssignment;
    const updated: OrgUnitManagerAssignment = {
      ...current,
      role: input.role ?? current.role,
      includeDescendants:
        input.includeDescendants ?? current.includeDescendants,
      effectiveFrom: input.effectiveFrom ?? current.effectiveFrom,
      effectiveTo:
        input.effectiveTo === undefined
          ? current.effectiveTo
          : input.effectiveTo,
      isPrimary: input.isPrimary ?? current.isPrimary,
      updatedAt: input.updatedAt,
      updatedByActorId: input.updatedByActorId,
    };
    this.assignments[index] = updated;
    return updated;
  }

  async revokeAssignment(input: {
    readonly assignmentId: string;
    readonly effectiveTo: number;
    readonly updatedAt: number;
    readonly updatedByActorId: string;
  }): Promise<OrgUnitManagerAssignment | null> {
    const index = this.assignments.findIndex(
      (assignment) =>
        assignment.id === input.assignmentId &&
        isActiveAt(assignment, input.effectiveTo),
    );
    if (index < 0) {
      return null;
    }
    const current = this.assignments[index] as OrgUnitManagerAssignment;
    const updated: OrgUnitManagerAssignment = {
      ...current,
      status: "INACTIVE",
      effectiveTo: input.effectiveTo,
      updatedAt: input.updatedAt,
      updatedByActorId: input.updatedByActorId,
    };
    this.assignments[index] = updated;
    return updated;
  }

  async findManagerEmploymentProfileCandidate(employmentProfileId: string) {
    return {
      id: employmentProfileId,
      employeeCode: employmentProfileId,
      displayName: employmentProfileId,
      legalName: employmentProfileId,
      jobTitle: "Manager",
      employmentStatus: "ACTIVE",
    };
  }
}

function matchesMongoActiveQuery(
  assignment: OrgUnitManagerAssignmentTestDocument,
  query: Record<string, unknown>,
): boolean {
  const effectiveFrom = query.effectiveFrom as { readonly $lte: number };
  const effectiveToOr = query.$or as readonly [
    { readonly effectiveTo: null },
    { readonly effectiveTo: { readonly $gte: number } },
  ];
  return (
    assignment.managerEmploymentProfileId ===
      query.managerEmploymentProfileId &&
    assignment.role === query.role &&
    assignment.status === query.status &&
    assignment.effectiveFrom <= effectiveFrom.$lte &&
    (assignment.effectiveTo === effectiveToOr[0].effectiveTo ||
      (assignment.effectiveTo !== null &&
        assignment.effectiveTo >= effectiveToOr[1].effectiveTo.$gte))
  );
}

function isActiveAt(
  assignment: Pick<
    TalentGroupManagerAssignment | OrgUnitManagerAssignment,
    "status" | "effectiveFrom" | "effectiveTo"
  >,
  asOf: number,
): boolean {
  return (
    assignment.status === "ACTIVE" &&
    assignment.effectiveFrom <= asOf &&
    (assignment.effectiveTo === null || assignment.effectiveTo >= asOf)
  );
}

function isSupportedActiveTestOrgUnit(orgUnit: {
  readonly type: string;
  readonly status: string;
}): boolean {
  return (
    orgUnit.status === "ACTIVE" &&
    ["DEPARTMENT", "TEAM", "BUSINESS_UNIT", "SUPPORT_UNIT"].includes(
      orgUnit.type,
    )
  );
}

function fixedClock(): () => number {
  return () => 1_700_000_000_000;
}

function removeMatching<T>(items: T[], predicate: (item: T) => boolean): void {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index] as T)) {
      items.splice(index, 1);
    }
  }
}

function assertValidTestAllocationIdentity(allocation: KpiAllocation): void {
  if (allocation.subjectId.trim().length === 0) {
    throw new KpiInvalidAllocationError(
      "KPI allocation subjectId is required",
    );
  }
  const memberTalentId =
    typeof allocation.memberTalentId === "string" &&
    allocation.memberTalentId.trim().length > 0
      ? allocation.memberTalentId
      : null;
  const memberEmploymentProfileId =
    typeof allocation.memberEmploymentProfileId === "string" &&
    allocation.memberEmploymentProfileId.trim().length > 0
      ? allocation.memberEmploymentProfileId
      : null;
  if (!memberTalentId && !memberEmploymentProfileId) {
    throw new KpiInvalidAllocationError(
      "KPI allocation requires a member identity",
    );
  }
  if (allocation.subjectType === "TALENT_GROUP") {
    if (!memberTalentId) {
      throw new KpiInvalidAllocationError(
        "KPI TALENT_GROUP allocation requires memberTalentId",
      );
    }
    if (allocation.groupId !== allocation.subjectId) {
      throw new KpiInvalidAllocationError(
        "KPI TALENT_GROUP allocation requires groupId to match subjectId",
      );
    }
    return;
  }
  if (allocation.subjectType === "ORG_UNIT") {
    if (!memberEmploymentProfileId) {
      throw new KpiInvalidAllocationError(
        "KPI ORG_UNIT allocation requires memberEmploymentProfileId",
      );
    }
    return;
  }
  throw new KpiInvalidAllocationError(
    `KPI allocation subjectType is unsupported: ${allocation.subjectType}`,
  );
}

function normalizeTestSubjectIdFilter(input: {
  readonly subjectId?: string;
  readonly subjectIds?: readonly string[];
  readonly groupId?: string;
}): readonly string[] | undefined | null {
  const requestedIds = [
    ...new Set(
      [input.subjectId, input.groupId].filter(
        (value): value is string =>
          typeof value === "string" && value.length > 0,
      ),
    ),
  ];
  const scopedIds = [...new Set(input.subjectIds ?? [])];
  if (input.subjectIds !== undefined && scopedIds.length === 0) {
    return null;
  }
  if (requestedIds.length > 1) {
    return null;
  }
  if (requestedIds.length === 1 && scopedIds.length > 0) {
    return scopedIds.includes(requestedIds[0] as string) ? requestedIds : null;
  }
  if (requestedIds.length === 1) {
    return requestedIds;
  }
  return scopedIds.length > 0 ? scopedIds : undefined;
}

function isAfterTestPlanCursor(
  plan: KpiPlan,
  cursor: KpiPlanListCursor,
): boolean {
  const value = cursor.sortBy === "planCode" ? plan.planCode : plan.periodMonth;
  const valueDiff = value.localeCompare(cursor.value);
  if (cursor.sortDirection === "ASC" && valueDiff > 0) {
    return true;
  }
  if (cursor.sortDirection === "DESC" && valueDiff < 0) {
    return true;
  }
  return valueDiff === 0 && plan.id.localeCompare(cursor.planId) > 0;
}

function buildTestDerivedWorkspaceRow(
  plan: KpiPlan,
  allocations: readonly KpiAllocation[],
  entries: readonly KpiActualEntry[],
): KpiActualWorkspaceDerivedPlanSortRow {
  const revenueAllocations = allocations.filter(
    (allocation) =>
      allocation.kpiPlanId === plan.id &&
      allocation.allocationStatus === "PUBLISHED" &&
      ((plan.subjectType === "TALENT_GROUP" &&
        allocation.subjectType === "TALENT_GROUP" &&
        allocation.groupId === plan.subjectId &&
        typeof allocation.memberTalentId === "string" &&
        allocation.memberTalentId.length > 0) ||
        (plan.subjectType === "ORG_UNIT" &&
          allocation.subjectType === "ORG_UNIT" &&
          allocation.subjectId === plan.subjectId &&
          typeof allocation.memberEmploymentProfileId === "string" &&
          allocation.memberEmploymentProfileId.length > 0)) &&
      allocation.targetMetrics.some(
        (metric) => metric.metricCode === "REVENUE_VND",
      ),
  );
  const revenueActual = entries
    .filter((entry) => {
      const allocation = revenueAllocations.find(
        (item) => item.id === entry.allocationId,
      );
      return (
        entry.kpiPlanId === plan.id &&
        entry.metricCode === "REVENUE_VND" &&
        allocation !== undefined &&
        (allocation.subjectType === "ORG_UNIT"
          ? entry.memberEmploymentProfileId ===
            allocation.memberEmploymentProfileId
          : entry.memberTalentId === allocation.memberTalentId) &&
        isTestActualEntryWithinPlanPeriod(plan, entry.actualDate)
      );
    })
    .reduce((sum, entry) => sum + entry.effectiveValue, 0);
  const operationalTargetValue = revenueAllocations.reduce(
    (sum, allocation) =>
      sum +
      allocation.targetMetrics
        .filter((metric) => metric.metricCode === "REVENUE_VND")
        .reduce((metricSum, metric) => metricSum + metric.targetValue, 0),
    0,
  );
  const achievementPercent =
    operationalTargetValue === 0
      ? null
      : (revenueActual / operationalTargetValue) * 100;
  return {
    plan,
    revenueActual,
    achievementPercent,
    achievementNullRank: achievementPercent === null ? 1 : 0,
  };
}

function matchesTestAllocationCoverage(
  row: KpiActualWorkspaceDerivedPlanSortRow,
  allocations: readonly KpiAllocation[],
  coverage: ListKpiActualWorkspaceDerivedPlansInput["allocationCoverage"],
): boolean {
  if (coverage === undefined) {
    return true;
  }
  const planAllocations = allocations.filter(
    (allocation) => allocation.kpiPlanId === row.plan.id,
  );
  const publishedAllocationCount = planAllocations.filter(
    (allocation) => allocation.allocationStatus === "PUBLISHED",
  ).length;
  const complete =
    planAllocations.length > 0 &&
    publishedAllocationCount === planAllocations.length;
  return coverage === "complete" ? complete : !complete;
}

function isAfterTestDerivedCursor(
  row: KpiActualWorkspaceDerivedPlanSortRow,
  cursor: NonNullable<ListKpiActualWorkspaceDerivedPlansInput["cursor"]>,
): boolean {
  if (cursor.sortBy === "revenueActual") {
    const valueDiff = row.revenueActual - (cursor.revenueActual ?? 0);
    if (cursor.sortDirection === "ASC" && valueDiff > 0) {
      return true;
    }
    if (cursor.sortDirection === "DESC" && valueDiff < 0) {
      return true;
    }
    return valueDiff === 0 && row.plan.id.localeCompare(cursor.planId) > 0;
  }
  const nullRankDiff =
    row.achievementNullRank - (cursor.achievementNullRank ?? 0);
  if (nullRankDiff > 0) {
    return true;
  }
  if (nullRankDiff < 0) {
    return false;
  }
  if (row.achievementNullRank === 1) {
    return row.plan.id.localeCompare(cursor.planId) > 0;
  }
  const current = row.achievementPercent ?? 0;
  const previous = cursor.achievementPercent ?? 0;
  const valueDiff = current - previous;
  if (cursor.sortDirection === "ASC" && valueDiff > 0) {
    return true;
  }
  if (cursor.sortDirection === "DESC" && valueDiff < 0) {
    return true;
  }
  return valueDiff === 0 && row.plan.id.localeCompare(cursor.planId) > 0;
}

function compareTestDerivedRows(
  left: KpiActualWorkspaceDerivedPlanSortRow,
  right: KpiActualWorkspaceDerivedPlanSortRow,
  input: Pick<
    ListKpiActualWorkspaceDerivedPlansInput,
    "sortBy" | "sortDirection"
  >,
): number {
  const direction = input.sortDirection === "ASC" ? 1 : -1;
  if (input.sortBy === "revenueActual") {
    return (
      (left.revenueActual - right.revenueActual) * direction ||
      left.plan.id.localeCompare(right.plan.id)
    );
  }
  return (
    left.achievementNullRank - right.achievementNullRank ||
    ((left.achievementPercent ?? 0) - (right.achievementPercent ?? 0)) *
      direction ||
    left.plan.id.localeCompare(right.plan.id)
  );
}

function isTestActualEntryWithinPlanPeriod(
  plan: KpiPlan,
  actualDate: string,
): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(actualDate);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const startAt = Date.UTC(year, month - 1, day, -7, 0, 0, 0);
  const endAt = Date.UTC(year, month - 1, day + 1, -7, 0, 0, 0) - 1;
  return startAt >= plan.periodStartAt && endAt <= plan.periodEndAt;
}
