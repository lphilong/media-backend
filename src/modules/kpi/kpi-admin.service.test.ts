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
import { KpiAdminController } from "@modules/kpi/admin/admin.kpi.controller";
import { KpiAdminService } from "@modules/kpi/admin/admin.kpi.service";
import { TalentGroupManagerAssignmentService } from "@modules/kpi/admin/talent-group-manager-assignment.service";
import {
  KpiConflictError,
  KpiInvalidAllocationError,
  KpiNotFoundError,
  KpiPermissionScopeError,
  KpiStateError,
  KpiValidationError,
} from "@modules/kpi/domain/kpi.errors";
import { KpiActualRepository } from "@modules/kpi/domain/kpi-actual.repository";
import { KpiPlanRepository } from "@modules/kpi/domain/kpi.repository";
import {
  KpiGroupMemberLookup,
  KpiSubjectReadonlyAccess,
} from "@modules/kpi/domain/kpi-subject-readonly-access";
import { TalentGroupManagerAssignmentRepository } from "@modules/kpi/domain/talent-group-manager-assignment.repository";
import {
  KpiAllocation,
  KpiActualCorrection,
  KpiActualEntry,
  KpiActualPolicySnapshot,
  KpiMetricCode,
  KpiPlan,
  KpiPlanStatus,
  KpiSubjectType,
  KpiTargetMetric,
  TalentGroupManagerAssignment,
} from "@modules/kpi/domain/kpi.types";

const MAY_2026_START_AT = Date.UTC(2026, 4, 1, -7, 0, 0, 0);
const MAY_2026_END_AT = Date.UTC(2026, 5, 1, -7, 0, 0, 0) - 1;
const MAY_5_2026_NOON_HCM = Date.UTC(2026, 4, 5, 5, 0, 0, 0);
const MAY_5_2026_AFTER_LOCK_HCM = Date.UTC(2026, 4, 5, 16, 30, 0, 0);
const JUNE_1_2026_NOON_HCM = Date.UTC(2026, 5, 1, 5, 0, 0, 0);
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

function createHarness(clock: () => number = fixedClock()): {
  readonly service: KpiAdminService;
  readonly repository: InMemoryKpiPlanRepository;
  readonly actualRepository: InMemoryKpiActualRepository;
  readonly subjectAccess: InMemoryKpiSubjectReadonlyAccess;
  readonly managerRepository: InMemoryManagerAssignmentRepository;
  readonly audit: RecordingAuditGuard;
} {
  const repository = new InMemoryKpiPlanRepository();
  const actualRepository = new InMemoryKpiActualRepository();
  const subjectAccess = new InMemoryKpiSubjectReadonlyAccess();
  const managerRepository = new InMemoryManagerAssignmentRepository();
  const audit = new RecordingAuditGuard();
  const service = new KpiAdminService(
    repository,
    actualRepository,
    new InMemoryBusinessCodeSequenceRepository(),
    subjectAccess,
    managerRepository,
    audit as unknown as AuditGuard,
    new ImmediateMutationBridge(),
    clock,
  );
  return {
    service,
    repository,
    actualRepository,
    subjectAccess,
    managerRepository,
    audit,
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
): void {
  repository.assignments.push({
    id: "assignment-1",
    groupId,
    managerEmploymentProfileId: "manager-profile-1",
    role: "MANAGER",
    effectiveFrom: MAY_2026_START_AT,
    effectiveTo: null,
    status: "ACTIVE",
    isPrimary: true,
    createdAt: MAY_2026_START_AT,
    createdByActorId: "seed",
    updatedAt: MAY_2026_START_AT,
    updatedByActorId: "seed",
  });
}

test("KPI V2 creates TALENT draft plan with valid target metrics", async () => {
  const { service } = createHarness();

  const result = await service.createKpiPlan(
    createActor(),
    talentPlanCommand(),
  );

  assert.equal(result.status, "DRAFT");
  assert.equal(result.subjectType, "TALENT");
  assert.equal(result.planCode, "KPI-000001");
  assert.equal(result.currencyCode, "VND");
  assert.equal(result.targetMetrics.length, 2);
  assert.equal(result.targetMetrics[0]?.actualSource, "MANUAL");
  assert.equal(result.allocations.length, 0);
});

test("KPI V2 creates TALENT_GROUP draft plan with valid metrics", async () => {
  const { service } = createHarness();

  const result = await service.createKpiPlan(createActor(), groupPlanCommand());

  assert.equal(result.subjectType, "TALENT_GROUP");
  assert.equal(result.targetMetrics.length, 2);
});

test("KPI V2 rejects metrics not allowed for subject type", async () => {
  const { service } = createHarness();

  await assert.rejects(
    service.createKpiPlan(createActor(), {
      ...talentPlanCommand(),
      targetMetrics: [{ metricCode: "ONBOARDED_TALENT_COUNT", targetValue: 1 }],
    }),
    KpiValidationError,
  );
});

test("KPI V2 rejects ATTENDANCE_RATE and unknown metrics", async () => {
  const { service } = createHarness();

  await assert.rejects(
    service.createKpiPlan(createActor(), {
      ...talentPlanCommand(),
      targetMetrics: [{ metricCode: "ATTENDANCE_RATE", targetValue: 1 }],
    }),
    KpiValidationError,
  );
});

test("KPI V2 rejects negative and non-finite targets", async () => {
  const { service } = createHarness();

  await assert.rejects(
    service.createKpiPlan(createActor(), {
      ...talentPlanCommand(),
      targetMetrics: [{ metricCode: "REVENUE_VND", targetValue: -1 }],
    }),
    KpiValidationError,
  );
  await assert.rejects(
    service.createKpiPlan(createActor(), {
      ...talentPlanCommand(),
      targetMetrics: [{ metricCode: "REVENUE_VND", targetValue: Infinity }],
    }),
    KpiValidationError,
  );
});

test("KPI V2 rejects decimal REVENUE_VND plan target", async () => {
  const { service } = createHarness();

  await assert.rejects(
    service.createKpiPlan(createActor(), {
      ...talentPlanCommand(),
      targetMetrics: [{ metricCode: "REVENUE_VND", targetValue: 1.5 }],
    }),
    /REVENUE_VND requires an integer target value/,
  );
});

test("KPI V2 rejects decimal count plan target", async () => {
  const { service } = createHarness();

  await assert.rejects(
    service.createKpiPlan(createActor(), {
      ...talentPlanCommand(),
      targetMetrics: [{ metricCode: "CONTENT_OUTPUT_COUNT", targetValue: 1.5 }],
    }),
    /CONTENT_OUTPUT_COUNT requires an integer target value/,
  );
});

test("KPI V2 accepts LIVE_HOURS plan target with two decimals", async () => {
  const { service } = createHarness();

  const created = await service.createKpiPlan(createActor(), {
    ...talentPlanCommand(),
    targetMetrics: [{ metricCode: "LIVE_HOURS", targetValue: 1.25 }],
  });

  assert.equal(created.targetMetrics[0]?.targetValue, 1.25);
});

test("KPI V2 rejects LIVE_HOURS plan target with more than two decimals", async () => {
  const { service } = createHarness();

  await assert.rejects(
    service.createKpiPlan(createActor(), {
      ...talentPlanCommand(),
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
      ...talentPlanCommand(),
      targetMetrics: formattedMoneyTarget,
    }),
    /REVENUE_VND requires a finite non-negative numeric target value/,
  );
  await assert.rejects(
    service.createKpiPlan(createActor(), {
      ...talentPlanCommand(),
      targetMetrics: numericStringTarget,
    }),
    /REVENUE_VND requires a finite non-negative numeric target value/,
  );
});

test("KPI V2 rejects invalid non-monthly period window", async () => {
  const { service } = createHarness();

  await assert.rejects(
    service.createKpiPlan(createActor(), {
      ...talentPlanCommand(),
      periodEndAt: MAY_2026_END_AT - 1,
    }),
    KpiValidationError,
  );
});

test("KPI V2 update draft core works only in DRAFT", async () => {
  const { service } = createHarness();
  const created = await service.createKpiPlan(
    createActor(),
    talentPlanCommand(),
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
    talentPlanCommand(),
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
  const { service } = createHarness();
  const created = await service.createKpiPlan(
    createActor(),
    talentPlanCommand(),
  );

  await assert.rejects(
    service.replaceKpiAllocations(createActor(), {
      kpiPlanId: created.id,
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

test("KPI V2 publish TALENT plan freezes target and moves to PUBLISHED", async () => {
  const { service } = createHarness();
  const created = await service.createKpiPlan(
    createActor(),
    talentPlanCommand(),
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
    talentPlanCommand(),
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

test("KPI V2 archive sets archivedAt", async () => {
  const { service } = createHarness();
  const created = await service.createKpiPlan(
    createActor(),
    talentPlanCommand(),
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
  assert.equal(published.actualPolicySnapshot?.entryOpenLocalTime, "06:00");
  assert.equal(published.actualPolicySnapshot?.entryLockLocalTime, "23:00");
  assert.equal(published.actualPolicySnapshot?.maxDirectEditsPerEntry, 3);

  const created = await service.createOrSetKpiActual(createActor(), {
    kpiPlanId: published.id,
    allocationId: allocation.id,
    metricCode: "REVENUE_VND",
    actualDate: "05-05-2026",
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
      actualDate: "05-05-2026",
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
      actualDate: "05-05-2026",
      actualValue: 1,
    }),
    KpiInvalidAllocationError,
  );
  await assert.rejects(
    service.createOrSetKpiActual(createActor(), {
      kpiPlanId: published.id,
      allocationId: allocation.id,
      metricCode: "REVENUE_VND",
      actualDate: "01-06-2026",
      actualValue: 1,
    }),
    KpiValidationError,
  );
  await assert.rejects(
    service.createOrSetKpiActual(createActor(), {
      kpiPlanId: published.id,
      allocationId: allocation.id,
      metricCode: "REVENUE_VND",
      actualDate: "05-05-2026",
      actualValue: "1000000" as unknown as number,
    }),
    KpiValidationError,
  );
  await assert.rejects(
    service.createOrSetKpiActual(createActor(), {
      kpiPlanId: published.id,
      allocationId: allocation.id,
      metricCode: "REVENUE_VND",
      actualDate: "05-05-2026",
      actualValue: 1.5,
    }),
    KpiValidationError,
  );
});

test("KPI V2 actualDate requires strict DD-MM-YYYY calendar dates", async () => {
  const { service } = createHarness(() => MAY_5_2026_NOON_HCM);
  const published = await createPublishedGroupPlan(service);
  const allocation = published.allocations[0] as KpiAllocation;

  for (const actualDate of [
    "31-04-2026",
    "29-02-2026",
    "01-13-2026",
    "00-01-2026",
    "2026-05-16",
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

test("KPI V2 actualDate accepts leap day in DD-MM-YYYY within plan window", async () => {
  const { service } = createHarness(() => FEB_29_2028_NOON_HCM);
  const published = await createPublishedFebruary2028GroupPlan(service);
  const allocation = published.allocations[0] as KpiAllocation;

  const result = await service.createOrSetKpiActual(createActor(), {
    kpiPlanId: published.id,
    allocationId: allocation.id,
    metricCode: "REVENUE_VND",
    actualDate: "29-02-2028",
    actualValue: 100,
  });

  assert.equal(result.actualEntry.actualDate, "29-02-2028");
  assert.equal(result.actualEntry.effectiveValue, 100);
});

test("KPI V2 duplicate POST is idempotent only for the same value", async () => {
  const now = { value: MAY_5_2026_NOON_HCM };
  const { service, audit, actualRepository } = createHarness(() => now.value);
  const published = await createPublishedGroupPlan(service);
  const allocation = published.allocations[0] as KpiAllocation;
  const created = await service.createOrSetKpiActual(createActor(), {
    kpiPlanId: published.id,
    allocationId: allocation.id,
    metricCode: "REVENUE_VND",
    actualDate: "05-05-2026",
    actualValue: 80,
  });
  const auditCountAfterCreate = audit.records.length;
  now.value = MAY_5_2026_AFTER_LOCK_HCM;

  const retry = await service.createOrSetKpiActual(createActor(), {
    kpiPlanId: published.id,
    allocationId: allocation.id,
    metricCode: "REVENUE_VND",
    actualDate: "05-05-2026",
    actualValue: 80,
  });

  assert.equal(retry.actualEntry.id, created.actualEntry.id);
  assert.equal(retry.actualEntry.effectiveValue, 80);
  assert.equal(retry.actualEntry.editCount, 0);
  assert.equal(retry.actualEntry.updatedAt, created.actualEntry.updatedAt);
  assert.equal(audit.records.length, auditCountAfterCreate);

  await assert.rejects(
    service.createOrSetKpiActual(createActor(), {
      kpiPlanId: published.id,
      allocationId: allocation.id,
      metricCode: "REVENUE_VND",
      actualDate: "05-05-2026",
      actualValue: 81,
    }),
    KpiConflictError,
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
    actualDate: "05-05-2026",
    actualValue: 120,
  });
  await service.createOrSetKpiActual(createActor(), {
    kpiPlanId: published.id,
    allocationId: second.id,
    metricCode: "REVENUE_VND",
    actualDate: "05-05-2026",
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

test("KPI V2 daily actual grid rejects YYYY-MM-DD actualDate", async () => {
  const { service } = createHarness();
  const published = await createPublishedGroupPlan(service);

  await assert.rejects(
    service.getKpiActualDailyGrid(createActor(), {
      kpiPlanId: published.id,
      actualDate: "2026-05-05",
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
      actualDate: "31-02-2026",
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
      actualDate: "01-06-2026",
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
    actualDate: "05-05-2026",
  });

  assert.equal(grid.kpiPlanId, published.id);
  assert.equal(grid.actualDate, "05-05-2026");
  assert.equal(grid.editability.isDirectEditOpen, true);
  assert.equal(grid.rows.length, 2);
  assert.equal(grid.rows[0]?.metrics[0]?.actualEntryId, null);
  assert.equal(grid.rows[0]?.metrics[0]?.actualValue, null);
  assert.equal(grid.rows[0]?.metrics[0]?.effectiveValue, 0);
  assert.equal(grid.rows[0]?.metrics[0]?.hasEntry, false);
  assert.equal(grid.rows[0]?.metrics[0]?.editCount, 0);
  assert.equal(audit.records.length, auditCount);
});

test("KPI V2 daily actual grid returns existing actual entry identity and effective value", async () => {
  const { service } = createHarness(() => MAY_5_2026_NOON_HCM);
  const published = await createPublishedGroupPlan(service);
  const allocation = published.allocations[0] as KpiAllocation;
  const created = await service.createOrSetKpiActual(createActor(), {
    kpiPlanId: published.id,
    allocationId: allocation.id,
    metricCode: "REVENUE_VND",
    actualDate: "05-05-2026",
    actualValue: 80,
  });
  await service.updateKpiActualDirect(createActor(), {
    kpiPlanId: published.id,
    actualEntryId: created.actualEntry.id,
    actualValue: 83,
  });

  const grid = await service.getKpiActualDailyGrid(createActor(), {
    kpiPlanId: published.id,
    actualDate: "05-05-2026",
  });
  const cell = grid.rows[0]?.metrics.find(
    (metric) => metric.metricCode === "REVENUE_VND",
  );

  assert.equal(cell?.actualEntryId, created.actualEntry.id);
  assert.equal(cell?.actualValue, 83);
  assert.equal(cell?.effectiveValue, 83);
  assert.equal(cell?.hasEntry, true);
  assert.equal(cell?.editCount, 1);
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
    actualDate: "05-05-2026",
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
    actualDate: "05-05-2026",
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
    actualDate: "05-05-2026",
  });

  assert.equal(grid.editability.isDirectEditOpen, false);
  assert.equal(grid.editability.isPlanFinalized, true);
  assert.equal(grid.editability.disabledReason, "PLAN_FINALIZED");
});

test("KPI V2 manager may read actual grid for managed talent group", async () => {
  const { service, managerRepository } = createHarness(
    () => MAY_5_2026_NOON_HCM,
  );
  const published = await createPublishedGroupPlan(service);
  seedManagerAssignment(managerRepository);

  const grid = await service.getKpiActualDailyGrid(createManagerActor(), {
    kpiPlanId: published.id,
    actualDate: "05-05-2026",
  });

  assert.equal(grid.rows.length, 2);
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
      actualDate: "05-05-2026",
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
      actualDate: "05-05-2026",
    }),
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

test("KPI V2 global list plans still works", async () => {
  const { service } = createHarness();
  await service.createKpiPlan(createActor(), talentPlanCommand());

  const result = await service.listKpiPlans(createActor(), {});

  assert.equal(result.items.length, 1);
});

test("KPI V2 managedGroup list returns only managed talent-group plans", async () => {
  const { service, repository, managerRepository } = createHarness(
    () => MAY_5_2026_NOON_HCM,
  );
  const managed = await createPublishedGroupPlan(service);
  repository.plans.push({
    ...managed,
    id: "unmanaged-plan",
    planCode: "KPI-202605-999999",
    subjectId: "group-2",
    createdAt: managed.createdAt + 1,
    updatedAt: managed.updatedAt + 1,
  });
  seedManagerAssignment(managerRepository, "group-1");

  const result = await service.listKpiPlans(createManagerActor(), {});

  assert.deepEqual(
    result.items.map((item) => item.id),
    [managed.id],
  );
});

test("KPI V2 managedGroup list returns empty without active manager assignment", async () => {
  const { service } = createHarness(() => MAY_5_2026_NOON_HCM);
  await createPublishedGroupPlan(service);

  const result = await service.listKpiPlans(createManagerActor(), {});

  assert.deepEqual(result.items, []);
});

test("KPI V2 managedGroup detail allows managed plan", async () => {
  const { service, managerRepository } = createHarness(
    () => MAY_5_2026_NOON_HCM,
  );
  const managed = await createPublishedGroupPlan(service);
  seedManagerAssignment(managerRepository, "group-1");

  const detail = await service.getKpiPlanDetail(createManagerActor(), {
    kpiPlanId: managed.id,
  });

  assert.equal(detail.id, managed.id);
});

test("KPI V2 managedGroup detail denies unmanaged plan", async () => {
  const { service, repository, managerRepository } = createHarness(
    () => MAY_5_2026_NOON_HCM,
  );
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

  await assert.rejects(
    service.getKpiPlanDetail(createManagerActor(), {
      kpiPlanId: unmanagedPlan.id,
    }),
    KpiPermissionScopeError,
  );
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
      actualDate: "05-05-2026",
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
      actualDate: "05-05-2026",
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
    actualDate: "05-05-2026",
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
    actualDate: "05-05-2026",
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

test("KPI V2 list plans searches by planCode", async () => {
  const { service } = createHarness();
  const first = await service.createKpiPlan(createActor(), talentPlanCommand());
  await service.createKpiPlan(createActor(), {
    ...talentPlanCommand(),
    subjectId: "talent-2",
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
    ...talentPlanCommand(),
    title: "North creator payout KPI",
  });
  await service.createKpiPlan(createActor(), {
    ...talentPlanCommand(),
    subjectId: "talent-2",
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

test("KPI V2 manager may enter actual for managed talent group", async () => {
  const { service, managerRepository } = createHarness(
    () => MAY_5_2026_NOON_HCM,
  );
  const published = await createPublishedGroupPlan(service);
  const allocation = published.allocations[0] as KpiAllocation;
  managerRepository.assignments.push({
    id: "assignment-1",
    groupId: "group-1",
    managerEmploymentProfileId: "manager-profile-1",
    role: "MANAGER",
    effectiveFrom: MAY_2026_START_AT,
    effectiveTo: null,
    status: "ACTIVE",
    isPrimary: true,
    createdAt: MAY_2026_START_AT,
    createdByActorId: "seed",
    updatedAt: MAY_2026_START_AT,
    updatedByActorId: "seed",
  });

  const result = await service.createOrSetKpiActual(createManagerActor(), {
    kpiPlanId: published.id,
    allocationId: allocation.id,
    metricCode: "REVENUE_VND",
    actualDate: "05-05-2026",
    actualValue: 80,
  });

  assert.equal(result.actualEntry.memberTalentId, allocation.memberTalentId);
});

test("KPI allocation approval foundation supports manager draft submit and admin approve publish", async () => {
  const { service, managerRepository, audit } = createHarness(
    () => MAY_5_2026_NOON_HCM,
  );
  const created = await service.createKpiPlan(createActor(), groupPlanCommand());
  await service.publishKpiPlan(createActor(), { kpiPlanId: created.id });
  seedManagerAssignment(managerRepository);

  const draft = await service.upsertKpiAllocationDraft(createManagerActor(), {
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
  assert.equal(draft.allocations[0]?.memberEmploymentProfileId, "talent-profile-1");
  assert.equal(draft.allocations[0]?.createdByActorId, "manager-user");

  const editedDraft = await service.upsertKpiAllocationDraft(createManagerActor(), {
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

  const submitted = await service.submitKpiAllocationDraft(createManagerActor(), {
    kpiPlanId: created.id,
  });
  assert.equal(submitted.allocations[0]?.allocationStatus, "PENDING_APPROVAL");
  assert.equal(submitted.allocations[0]?.submittedByActorId, "manager-user");

  await assert.rejects(
    service.approveKpiAllocation(createManagerActor(), { kpiPlanId: created.id }),
    /KPI V2 admin operations require ADMIN actor context/u,
  );
  await assert.rejects(
    service.publishKpiAllocation(createManagerActor(), { kpiPlanId: created.id }),
    /KPI V2 admin operations require ADMIN actor context/u,
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

test("KPI allocation approval denies draft and submit to read/global/non-manager actors", async () => {
  const { service, managerRepository } = createHarness(
    () => MAY_5_2026_NOON_HCM,
  );
  const created = await service.createKpiPlan(createActor(), groupPlanCommand());
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

test("KPI allocation approval rejects unmanaged or direct Talent-style draft targets", async () => {
  const { service, managerRepository } = createHarness(
    () => MAY_5_2026_NOON_HCM,
  );
  const created = await service.createKpiPlan(createActor(), groupPlanCommand());
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
  const created = await service.createKpiPlan(createActor(), groupPlanCommand());
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
    createActorWithPermissions("hr-user", [Permission.KPI_READ, Permission.KPI_READ_PROGRESS]),
    createActorWithPermissions("ops-user", [Permission.KPI_READ]),
    createActorWithPermissions("finance-user", [Permission.KPI_READ, Permission.KPI_READ_PROGRESS]),
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
    talentPlanCommand(),
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
    talentPlanCommand(),
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
    talentPlanCommand(),
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
    talentPlanCommand(),
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
    talentPlanCommand(),
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
      ...talentPlanCommand(),
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

for (const subjectType of ["EMPLOYMENT_PROFILE", "ORG_UNIT"] as const) {
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

test("KPI V2 controller rejects unknown create payload keys", async () => {
  const { service } = createHarness();
  const controller = new KpiAdminController(service) as unknown as {
    handle(req: Request, actor: Actor, context: "ADMIN"): Promise<unknown>;
  };

  await assert.rejects(async () => {
    const req = {
      body: { ...talentPlanCommand(), unexpected: true },
      params: {},
    } as Request;
    bindCommand(req, "KPI_PLAN_CREATE");
    await controller.handle(req, createActor(), "ADMIN");
  }, KpiValidationError);
});

test("Talent group manager assignment supports multiple active managers and optional primary", async () => {
  const repository = new InMemoryManagerAssignmentRepository();
  const service = new TalentGroupManagerAssignmentService(
    repository,
    fixedClock(),
  );

  await service.createAssignment(createActor(), {
    groupId: "group-1",
    managerEmploymentProfileId: "ep-1",
    role: "OWNER",
    effectiveFrom: 1000,
    isPrimary: true,
  });
  await service.createAssignment(createActor(), {
    groupId: "group-1",
    managerEmploymentProfileId: "ep-2",
    role: "MANAGER",
    effectiveFrom: 1000,
  });

  const active = await service.listActiveByGroup("group-1", 2000);
  assert.equal(active.length, 2);
  assert.equal(active.filter((assignment) => assignment.isPrimary).length, 1);
  const byManager = await service.listActiveByManagerEmploymentProfile(
    "ep-2",
    2000,
  );
  assert.equal(byManager.length, 1);
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
  async hasActiveTalent(talentId: string): Promise<boolean> {
    return talentId === "talent-1" || talentId === "talent-2";
  }

  async hasActiveTalentGroup(groupId: string): Promise<boolean> {
    return groupId === "group-1";
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

  async insertPlan(plan: KpiPlan): Promise<KpiPlan> {
    this.plans.push(plan);
    return plan;
  }

  async findPlanById(kpiPlanId: string): Promise<KpiPlan | null> {
    return this.plans.find((plan) => plan.id === kpiPlanId) ?? null;
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

  async listPlans(input: {
    readonly subjectType?: KpiSubjectType;
    readonly subjectId?: string;
    readonly groupId?: string;
    readonly periodMonth?: string;
    readonly status?: KpiPlanStatus;
    readonly metricCode?: KpiMetricCode;
    readonly search?: string;
    readonly limit: number;
    readonly sortBy?: "periodMonth" | "planCode" | "createdAt";
    readonly sortDirection?: "ASC" | "DESC";
  }): Promise<readonly KpiPlan[]> {
    return this.plans
      .filter((plan) => {
        if (input.subjectType && plan.subjectType !== input.subjectType) {
          return false;
        }
        if (input.subjectId && plan.subjectId !== input.subjectId) {
          return false;
        }
        if (input.groupId && plan.subjectId !== input.groupId) {
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
          input.search &&
          !plan.normalizedPlanCode.includes(input.search) &&
          !plan.normalizedTitle.includes(input.search)
        ) {
          return false;
        }
        return true;
      })
      .sort((left, right) => {
        const field = input.sortBy ?? "periodMonth";
        const direction = input.sortDirection === "ASC" ? 1 : -1;
        const leftValue = String(left[field]);
        const rightValue = String(right[field]);
        return leftValue.localeCompare(rightValue) * direction;
      })
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

  async insertAllocations(
    allocations: readonly KpiAllocation[],
  ): Promise<readonly KpiAllocation[]> {
    this.allocations.push(...allocations);
    return allocations;
  }

  async replaceAllocationsForDraftPlan(
    kpiPlanId: string,
    allocations: readonly KpiAllocation[],
  ): Promise<void> {
    const plan = this.plans.find((item) => item.id === kpiPlanId);
    assert.equal(plan?.status, "DRAFT");
    removeMatching(
      this.allocations,
      (allocation) => allocation.kpiPlanId === kpiPlanId,
    );
    this.allocations.push(...allocations);
  }

  async listAllocationsByPlanId(
    kpiPlanId: string,
  ): Promise<readonly KpiAllocation[]> {
    return this.allocations.filter(
      (allocation) => allocation.kpiPlanId === kpiPlanId,
    );
  }

  async listAllocations(input: {
    readonly status?: KpiAllocation["allocationStatus"];
    readonly kpiPlanId?: string;
    readonly groupId?: string;
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
        return true;
      })
      .slice(0, input.limit);
  }

  async replaceAllocationsForPlan(input: {
    readonly kpiPlanId: string;
    readonly allowedCurrentStatuses: readonly KpiAllocation["allocationStatus"][];
    readonly allocations: readonly KpiAllocation[];
  }): Promise<void> {
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

function isActiveAt(
  assignment: TalentGroupManagerAssignment,
  asOf: number,
): boolean {
  return (
    assignment.status === "ACTIVE" &&
    assignment.effectiveFrom <= asOf &&
    (assignment.effectiveTo === null || assignment.effectiveTo >= asOf)
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
