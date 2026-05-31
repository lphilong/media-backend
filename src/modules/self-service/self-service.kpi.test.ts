import assert from "node:assert/strict";
import { createServer, Server } from "node:http";
import { AddressInfo } from "node:net";
import { test } from "node:test";
import express from "express";
import { ClientSession } from "mongodb";
import { withCommand } from "@app/base/command.middleware";
import { createHttpErrorMiddleware } from "@app/http/http-error.middleware";
import { contextMiddleware } from "@core/context/context.middleware.adapter";
import { Actor } from "@core/actor/actor";
import { bindActor } from "@core/actor/actor-context";
import { Permission } from "@core/permission/permission.enum";
import { EmploymentProfileRepository } from "@modules/employment-profile/domain/employment-profile.repository";
import {
  EmploymentProfileRecord,
  EmploymentStatus,
} from "@modules/employment-profile/domain/employment-profile.types";
import { KpiActualRepository } from "@modules/kpi/domain/kpi-actual.repository";
import { KpiPlanRepository } from "@modules/kpi/domain/kpi.repository";
import {
  KpiAllocation,
  KpiAllocationStatus,
  KpiActualCorrection,
  KpiActualEntry,
  KpiActualPolicySnapshot,
  KpiMetricCode,
  KpiPlan,
  KpiPlanStatus,
  KpiSubjectType,
  KpiTargetMetric,
} from "@modules/kpi/domain/kpi.types";
import { ROLE_TEMPLATE_CATALOG } from "@modules/role/domain/role-template.catalog";
import { SelfServiceKpiController } from "./self-service.kpi.controller";
import { SelfServiceKpiService } from "./self-service.kpi.service";
import { SelfServiceIdentityResolver } from "./shared/self-service.identity-resolver";
import { TalentRepository } from "@modules/talent/domain/talent.repository";
import {
  TalentOperationalStatus,
  TalentRecord,
} from "@modules/talent/domain/talent.types";

const MAY_2026_START_AT = Date.UTC(2026, 4, 1, -7, 0, 0, 0);
const MAY_2026_END_AT = Date.UTC(2026, 5, 1, -7, 0, 0, 0) - 1;
const JUNE_2026_START_AT = Date.UTC(2026, 5, 1, -7, 0, 0, 0);
const JUNE_2026_END_AT = Date.UTC(2026, 6, 1, -7, 0, 0, 0) - 1;
const CURRENT_KPI_NOW = Date.UTC(2026, 4, 15, 12, 0, 0, 0);

async function listen(app: express.Express): Promise<{
  readonly server: Server;
  readonly baseUrl: string;
}> {
  const server = createServer(app);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");

  return {
    server,
    baseUrl: `http://127.0.0.1:${(address as AddressInfo).port}`,
  };
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

test("GET /self-service/kpi returns only current staff own PUBLISHED KPI", async () => {
  const harness = createHarness();
  const { server, baseUrl } = await listen(
    createSelfServiceKpiTestApp(harness, createStaffActor("user-staff")),
  );

  try {
    const response = await fetch(`${baseUrl}/self-service/kpi`);
    const body = await response.json();
    const serialized = JSON.stringify(body);

    assert.equal(response.status, 200);
    assert.deepEqual(body.data.items, [
      {
        kpiPlanId: "plan-official",
        title: "Official own KPI",
        periodMonth: "2026-05",
        periodStartAt: MAY_2026_START_AT,
        periodEndAt: MAY_2026_END_AT,
        officialStatus: "OFFICIAL_PUBLISHED",
        lastUpdatedAt: 30,
        metrics: [
          {
            metricCode: "REVENUE_VND",
            unit: "VND",
            targetValue: 100,
            actualValue: 40,
            progressPercent: 40,
          },
          {
            metricCode: "LIVE_HOURS",
            unit: "HOUR",
            targetValue: 20,
            actualValue: 8,
            progressPercent: 40,
          },
        ],
      },
    ]);
    assert.deepEqual(harness.kpi.listInputs, [
      {
        status: "PUBLISHED",
        memberTalentId: "talent-staff",
        memberEmploymentProfileId: "ep-staff",
        limit: 100,
      },
    ]);
    assert.deepEqual(harness.kpi.listPlanByIdsInputs, [
      ["plan-official", "plan-future"],
    ]);
    assert.deepEqual(harness.kpi.findPlanByIdInputs, []);
    assert.deepEqual(harness.actuals.listPlanIdInputs, []);
    assert.deepEqual(harness.actuals.listPlanIdsInputs, [["plan-official"]]);

    for (const forbidden of [
      "plan-draft",
      "plan-pending",
      "plan-approved",
      "plan-rejected",
      "plan-active",
      "plan-future",
      "plan-other-member",
      "plan-unrelated-talent",
      "plan-unrelated-profile",
      "DRAFT",
      "PENDING_APPROVAL",
      "APPROVED",
      "REJECTED",
      "ACTIVE",
      "group-own",
      "memberTalentId",
      "memberEmploymentProfileId",
      "other talent actual",
      "manager note",
      "approvalNote",
      "rejectionReason",
      "submittedByActorId",
      "approvedByActorId",
      "rejectedByActorId",
      "publishedByActorId",
      "payroll",
      "bonus",
      "commission",
      "commercial",
      "finance",
    ]) {
      assert.equal(serialized.includes(forbidden), false, forbidden);
    }
  } finally {
    await close(server);
  }
});

test("GET /self-service/kpi returns safe empty result without linked internal Talent", async () => {
  const harness = createHarness();
  const { server, baseUrl } = await listen(
    createSelfServiceKpiTestApp(harness, createStaffActor("user-no-talent")),
  );

  try {
    const response = await fetch(`${baseUrl}/self-service/kpi`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body.data.items, []);
    assert.deepEqual(harness.kpi.listInputs, []);
  } finally {
    await close(server);
  }
});

test("GET /self-service/kpi returns a safe error when actor is not linked", async () => {
  const harness = createHarness();
  const { server, baseUrl } = await listen(
    createSelfServiceKpiTestApp(harness, createStaffActor("user-unlinked")),
  );

  try {
    const response = await fetch(`${baseUrl}/self-service/kpi`);
    const body = await response.json();

    assert.equal(response.status, 404);
    assert.deepEqual(body, {
      error: {
        code: "SELF_SERVICE_CURRENT_PERSON_NOT_LINKED",
        message: "No linked Employment Profile",
      },
    });
    assert.deepEqual(harness.kpi.listInputs, []);
  } finally {
    await close(server);
  }
});

test("GET /self-service/kpi rejects client-supplied subject filters", async () => {
  const harness = createHarness();
  const { server, baseUrl } = await listen(
    createSelfServiceKpiTestApp(harness, createStaffActor("user-staff")),
  );

  try {
    const response = await fetch(
      `${baseUrl}/self-service/kpi?memberTalentId=talent-other&groupId=group-other&employmentProfileId=ep-other`,
    );
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.match(body.error.message, /Invalid self-service request/);
    assert.deepEqual(harness.kpi.listInputs, []);
  } finally {
    await close(server);
  }
});

test("self-service KPI endpoint is GET/read-only and does not change role template", async () => {
  const harness = createHarness();
  const before = harness.snapshot();
  const { server, baseUrl } = await listen(
    createSelfServiceKpiTestApp(harness, createStaffActor("user-staff")),
  );

  try {
    const getResponse = await fetch(`${baseUrl}/self-service/kpi`);
    await getResponse.json();

    assert.equal(getResponse.status, 200);
    assert.deepEqual(harness.snapshot(), before);

    const postResponse = await fetch(`${baseUrl}/self-service/kpi`, {
      method: "POST",
    });
    assert.equal(postResponse.status, 404);
    assert.deepEqual(harness.snapshot(), before);

    const template = ROLE_TEMPLATE_CATALOG.find(
      (candidate) => candidate.code === "TALENT_STAFF_SELF",
    );
    assert.ok(template);
    assert.deepEqual(template.permissions, [
      Permission.WORK_SCHEDULE_READ,
      Permission.EVENT_READ,
      Permission.TALENT_KPI_READ,
      Permission.KPI_READ_PROGRESS,
      Permission.EMPLOYMENT_PROFILE_READ,
      Permission.TALENT_READ,
    ]);
    assert.deepEqual(template.recommendedScopeGrants, {
      workSchedule: ["self"],
      kpi: ["self"],
    });
  } finally {
    await close(server);
  }
});

function createSelfServiceKpiTestApp(
  harness: SelfServiceKpiHarness,
  actor: Actor,
): express.Express {
  const app = express();
  const identityResolver = new SelfServiceIdentityResolver(
    harness.employmentProfiles,
    harness.talents,
  );
  const kpiController = new SelfServiceKpiController(
    new SelfServiceKpiService(
      identityResolver,
      harness.kpi,
      harness.actuals,
      () => CURRENT_KPI_NOW,
    ),
  );

  app.get(
    "/self-service/kpi",
    contextMiddleware("SELF_SERVICE"),
    (req, _res, next) => {
      bindActor(req, actor);
      next();
    },
    withCommand("SELF_SERVICE_KPI_LIST"),
    kpiController.execute,
  );
  app.use(createHttpErrorMiddleware({ error() {} } as never));

  return app;
}

function createStaffActor(userId: string): Actor {
  return new Actor({
    id: userId,
    type: "staff",
    context: "SELF_SERVICE",
    roles: ["TALENT_STAFF_SELF"],
    permissions: [Permission.KPI_READ_PROGRESS],
    scopeGrants: {
      kpi: ["self"],
    },
    isActive: true,
  });
}

interface SelfServiceKpiHarness {
  readonly employmentProfiles: InMemoryEmploymentProfileRepository;
  readonly talents: InMemoryTalentRepository;
  readonly kpi: InMemoryKpiPlanRepository;
  readonly actuals: InMemoryKpiActualRepository;
  snapshot(): unknown;
}

function createHarness(): SelfServiceKpiHarness {
  const employmentProfiles = new InMemoryEmploymentProfileRepository([
    employmentProfileRecord({
      id: "ep-staff",
      linkedUserId: "user-staff",
    }),
    employmentProfileRecord({
      id: "ep-no-talent",
      linkedUserId: "user-no-talent",
    }),
    employmentProfileRecord({
      id: "ep-other",
      linkedUserId: "user-other",
    }),
  ]);
  const talents = new InMemoryTalentRepository([
    talentRecord({
      id: "talent-staff",
      linkedEmploymentProfileId: "ep-staff",
    }),
    talentRecord({
      id: "talent-other",
      linkedEmploymentProfileId: "ep-other",
    }),
  ]);
  const kpi = new InMemoryKpiPlanRepository(
    [
      kpiPlan({ id: "plan-official", title: "Official own KPI" }),
      kpiPlan({ id: "plan-draft", title: "Draft own KPI" }),
      kpiPlan({ id: "plan-pending", title: "Pending own KPI" }),
      kpiPlan({ id: "plan-approved", title: "Approved own KPI" }),
      kpiPlan({ id: "plan-rejected", title: "Rejected own KPI" }),
      kpiPlan({ id: "plan-active", title: "Legacy active own KPI" }),
      kpiPlan({
        id: "plan-future",
        title: "Future own KPI",
        periodMonth: "2026-06",
        periodStartAt: JUNE_2026_START_AT,
        periodEndAt: JUNE_2026_END_AT,
      }),
      kpiPlan({ id: "plan-other-member", title: "Other member KPI" }),
      kpiPlan({ id: "plan-unrelated-talent", title: "Unrelated Talent KPI" }),
      kpiPlan({ id: "plan-unrelated-profile", title: "Unrelated EmploymentProfile KPI" }),
    ],
    [
      allocation({ id: "alloc-official", kpiPlanId: "plan-official" }),
      allocation({
        id: "alloc-draft",
        kpiPlanId: "plan-draft",
        allocationStatus: "DRAFT",
      }),
      allocation({
        id: "alloc-pending",
        kpiPlanId: "plan-pending",
        allocationStatus: "PENDING_APPROVAL",
      }),
      allocation({
        id: "alloc-approved",
        kpiPlanId: "plan-approved",
        allocationStatus: "APPROVED",
      }),
      allocation({
        id: "alloc-rejected",
        kpiPlanId: "plan-rejected",
        allocationStatus: "REJECTED",
      }),
      allocation({
        id: "alloc-active",
        kpiPlanId: "plan-active",
        allocationStatus: "ACTIVE",
      }),
      allocation({
        id: "alloc-future",
        kpiPlanId: "plan-future",
      }),
      allocation({
        id: "alloc-other-member",
        kpiPlanId: "plan-other-member",
        memberTalentId: "talent-other",
        memberEmploymentProfileId: "ep-other",
      }),
      allocation({
        id: "alloc-unrelated-talent",
        kpiPlanId: "plan-unrelated-talent",
        memberTalentId: "talent-other",
        memberEmploymentProfileId: "ep-staff",
      }),
      allocation({
        id: "alloc-unrelated-profile",
        kpiPlanId: "plan-unrelated-profile",
        memberTalentId: "talent-staff",
        memberEmploymentProfileId: "ep-other",
      }),
    ],
  );
  const actuals = new InMemoryKpiActualRepository([
    actualEntry({
      id: "actual-revenue",
      allocationId: "alloc-official",
      metricCode: "REVENUE_VND",
      effectiveValue: 40,
      updatedAt: 30,
    }),
    actualEntry({
      id: "actual-hours",
      allocationId: "alloc-official",
      metricCode: "LIVE_HOURS",
      effectiveValue: 8,
      updatedAt: 29,
    }),
    actualEntry({
      id: "actual-other",
      allocationId: "alloc-other-member",
      memberTalentId: "talent-other",
      metricCode: "REVENUE_VND",
      effectiveValue: 999,
      createdByActorId: "other talent actual",
    }),
  ]);

  return {
    employmentProfiles,
    talents,
    kpi,
    actuals,
    snapshot() {
      return {
        employmentProfiles: employmentProfiles.snapshot(),
        talents: talents.snapshot(),
        kpi: kpi.snapshot(),
        actuals: actuals.snapshot(),
      };
    },
  };
}

function employmentProfileRecord(
  overrides: Partial<EmploymentProfileRecord>,
): EmploymentProfileRecord {
  return {
    id: "ep-1",
    employeeCode: "EP-000001",
    legalName: "Staff Legal",
    normalizedLegalName: "staff legal",
    displayName: "Staff Display",
    normalizedDisplayName: "staff display",
    employmentKind: "EMPLOYEE",
    jobTitle: "Staff",
    titleDescription: null,
    externalRef: null,
    orgUnitId: "ou-1",
    managerEmploymentProfileId: null,
    recruiterEmploymentProfileId: null,
    hrOwnerEmploymentProfileId: null,
    onboardingOwnerEmploymentProfileId: null,
    sourcedByEmploymentProfileId: null,
    linkedUserId: "user-1",
    employmentStatus: "ACTIVE",
    contractStatus: "ACTIVE",
    employmentStartDate: 1,
    employmentEndDate: null,
    hiredAt: null,
    onboardedAt: null,
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

function talentRecord(overrides: Partial<TalentRecord>): TalentRecord {
  return {
    id: "talent-1",
    talentCode: "TAL-000001",
    stageName: "Performance Alias",
    normalizedStageName: "performance alias",
    legalName: "Talent Legal",
    normalizedLegalName: "talent legal",
    displayShortName: null,
    normalizedDisplayShortName: null,
    talentOrigin: "INTERNAL",
    operationalStatus: "ACTIVE",
    managerEmploymentProfileId: null,
    linkedEmploymentProfileId: "ep-1",
    commercialParticipationStatus: "ELIGIBLE",
    livestreamEligible: true,
    eventEligible: true,
    externalRef: null,
    profileSummary: null,
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

function kpiPlan(overrides: Partial<KpiPlan>): KpiPlan {
  return {
    id: "plan-1",
    planCode: "KPI-000001",
    normalizedPlanCode: "kpi-000001",
    title: "KPI",
    normalizedTitle: "kpi",
    description: "manager note payroll bonus commission commercial finance",
    subjectType: "TALENT_GROUP",
    subjectId: "group-own",
    status: "PUBLISHED",
    currencyCode: "VND",
    periodMonth: "2026-05",
    periodStartAt: MAY_2026_START_AT,
    periodEndAt: MAY_2026_END_AT,
    timezone: "Asia/Ho_Chi_Minh",
    actualPolicySnapshot: null,
    publishedAt: 10,
    publishedByActorId: "admin",
    finalizedAt: null,
    finalizedByActorId: null,
    archivedAt: null,
    archivedByActorId: null,
    createdAt: 1,
    createdByActorId: "admin",
    updatedAt: 20,
    updatedByActorId: "admin",
    externalRef: null,
    ...overrides,
  };
}

function allocation(overrides: Partial<KpiAllocation>): KpiAllocation {
  return {
    id: "allocation-1",
    kpiPlanId: "plan-1",
    groupId: "group-own",
    memberEmploymentProfileId: "ep-staff",
    memberTalentId: "talent-staff",
    membershipId: "membership-staff",
    allocationStatus: "PUBLISHED",
    allocationStartDate: "2026-05-01",
    allocationEndDate: null,
    targetMetrics: [
      { metricCode: "REVENUE_VND", targetValue: 100 },
      { metricCode: "LIVE_HOURS", targetValue: 20 },
    ],
    snapshotMemberDisplayName: "Staff Display",
    note: "manager note payroll bonus commission commercial finance",
    createdAt: 1,
    createdByActorId: "manager",
    updatedAt: 20,
    updatedByActorId: "manager",
    submittedAt: 3,
    submittedByActorId: "manager",
    approvedAt: 4,
    approvedByActorId: "admin",
    approvalNote: "approvalNote secret",
    rejectedAt: null,
    rejectedByActorId: null,
    rejectionReason: null,
    publishedAt: 5,
    publishedByActorId: "admin",
    closedAt: null,
    ...overrides,
  };
}

function actualEntry(overrides: Partial<KpiActualEntry>): KpiActualEntry {
  return {
    id: "actual-1",
    kpiPlanId: "plan-official",
    allocationId: "alloc-official",
    memberTalentId: "talent-staff",
    metricCode: "REVENUE_VND",
    actualDate: "01-05-2026",
    actualValue: 1,
    effectiveValue: 1,
    editCount: 0,
    correctionCount: 0,
    latestCorrectionId: null,
    createdAt: 1,
    createdByActorId: "staff",
    updatedAt: 2,
    updatedByActorId: "staff",
    lastEditedAt: null,
    lastEditedByActorId: null,
    ...overrides,
  };
}

class InMemoryEmploymentProfileRepository
  implements EmploymentProfileRepository
{
  constructor(private readonly records: EmploymentProfileRecord[]) {}

  snapshot(): readonly EmploymentProfileRecord[] {
    return this.records.map((record) => ({ ...record }));
  }

  async findNonArchivedByLinkedUserId(
    linkedUserId: string,
  ): Promise<EmploymentProfileRecord | null> {
    return (
      this.records.find(
        (record) =>
          record.linkedUserId === linkedUserId &&
          record.employmentStatus !== "ARCHIVED",
      ) ?? null
    );
  }

  async insert(): Promise<EmploymentProfileRecord> {
    throw new Error("Not implemented");
  }

  async findById(): Promise<EmploymentProfileRecord | null> {
    throw new Error("Not implemented");
  }

  async findByEmployeeCode(): Promise<EmploymentProfileRecord | null> {
    throw new Error("Not implemented");
  }

  async findMaxGeneratedCodeSequence(): Promise<number> {
    throw new Error("Not implemented");
  }

  async updateCore(): Promise<EmploymentProfileRecord | null> {
    throw new Error("Not implemented");
  }

  async assignOrgUnit(): Promise<EmploymentProfileRecord | null> {
    throw new Error("Not implemented");
  }

  async assignManager(): Promise<EmploymentProfileRecord | null> {
    throw new Error("Not implemented");
  }

  async setLinkedUser(): Promise<EmploymentProfileRecord | null> {
    throw new Error("Not implemented");
  }

  async transitionLifecycle(): Promise<EmploymentProfileRecord | null> {
    throw new Error("Not implemented");
  }

  async updateContractStatus(): Promise<EmploymentProfileRecord | null> {
    throw new Error("Not implemented");
  }

  async hasNonArchivedDirectReports(): Promise<boolean> {
    throw new Error("Not implemented");
  }
}

class InMemoryTalentRepository implements TalentRepository {
  constructor(private readonly records: TalentRecord[]) {}

  snapshot(): readonly TalentRecord[] {
    return this.records.map((record) => ({ ...record }));
  }

  async findNonArchivedByLinkedEmploymentProfileId(
    linkedEmploymentProfileId: string,
  ): Promise<TalentRecord | null> {
    return (
      this.records.find(
        (record) =>
          record.linkedEmploymentProfileId === linkedEmploymentProfileId &&
          record.operationalStatus !== "ARCHIVED",
      ) ?? null
    );
  }

  async insert(): Promise<TalentRecord> {
    throw new Error("Not implemented");
  }

  async findById(): Promise<TalentRecord | null> {
    throw new Error("Not implemented");
  }

  async findByTalentCode(): Promise<TalentRecord | null> {
    throw new Error("Not implemented");
  }

  async findMaxGeneratedCodeSequence(): Promise<number> {
    throw new Error("Not implemented");
  }

  async updateCore(): Promise<TalentRecord | null> {
    throw new Error("Not implemented");
  }

  async assignManager(): Promise<TalentRecord | null> {
    throw new Error("Not implemented");
  }

  async setLinkedEmploymentProfile(): Promise<TalentRecord | null> {
    throw new Error("Not implemented");
  }

  async transitionOperationalStatus(): Promise<TalentRecord | null> {
    throw new Error("Not implemented");
  }

  async updateCommercialParticipation(): Promise<TalentRecord | null> {
    throw new Error("Not implemented");
  }
}

class InMemoryKpiPlanRepository implements KpiPlanRepository {
  readonly listInputs: Array<{
    readonly status?: KpiAllocationStatus;
    readonly kpiPlanId?: string;
    readonly groupId?: string;
    readonly memberTalentId?: string;
    readonly memberEmploymentProfileId?: string;
    readonly limit: number;
  }> = [];
  readonly listPlanByIdsInputs: string[][] = [];
  readonly findPlanByIdInputs: string[] = [];

  constructor(
    private readonly plans: KpiPlan[],
    private readonly allocations: KpiAllocation[],
  ) {}

  snapshot(): unknown {
    return {
      plans: this.plans.map((plan) => ({ ...plan })),
      allocations: this.allocations.map((item) => ({ ...item })),
    };
  }

  async findPlanById(kpiPlanId: string): Promise<KpiPlan | null> {
    this.findPlanByIdInputs.push(kpiPlanId);
    return this.plans.find((plan) => plan.id === kpiPlanId) ?? null;
  }

  async listPlansByIds(
    kpiPlanIds: readonly string[],
  ): Promise<readonly KpiPlan[]> {
    this.listPlanByIdsInputs.push([...kpiPlanIds]);
    const ids = new Set(kpiPlanIds);
    return this.plans.filter((plan) => ids.has(plan.id));
  }

  async listAllocations(input: {
    readonly status?: KpiAllocationStatus;
    readonly kpiPlanId?: string;
    readonly groupId?: string;
    readonly memberTalentId?: string;
    readonly memberEmploymentProfileId?: string;
    readonly limit: number;
  }): Promise<readonly KpiAllocation[]> {
    this.listInputs.push({ ...input });
    return this.allocations
      .filter((item) => !input.status || item.allocationStatus === input.status)
      .filter((item) => !input.kpiPlanId || item.kpiPlanId === input.kpiPlanId)
      .filter((item) => !input.groupId || item.groupId === input.groupId)
      .filter(
        (item) =>
          !input.memberTalentId || item.memberTalentId === input.memberTalentId,
      )
      .filter(
        (item) =>
          !input.memberEmploymentProfileId ||
          item.memberEmploymentProfileId === input.memberEmploymentProfileId,
      )
      .slice(0, input.limit);
  }

  async insertPlan(): Promise<KpiPlan> {
    throw new Error("Not implemented");
  }

  async findPlanByPlanCode(): Promise<KpiPlan | null> {
    throw new Error("Not implemented");
  }

  async findMaxGeneratedPlanCodeSequence(): Promise<number> {
    throw new Error("Not implemented");
  }

  async updateDraftCore(): Promise<KpiPlan | null> {
    throw new Error("Not implemented");
  }

  async transitionStatus(): Promise<KpiPlan | null> {
    throw new Error("Not implemented");
  }

  async listPlans(): Promise<readonly KpiPlan[]> {
    throw new Error("Not implemented");
  }

  async insertTargetMetrics(): Promise<readonly KpiTargetMetric[]> {
    throw new Error("Not implemented");
  }

  async replaceTargetMetricsForDraftPlan(): Promise<void> {
    throw new Error("Not implemented");
  }

  async listTargetMetricsByPlanId(): Promise<readonly KpiTargetMetric[]> {
    throw new Error("Not implemented");
  }

  async insertAllocations(): Promise<readonly KpiAllocation[]> {
    throw new Error("Not implemented");
  }

  async replaceAllocationsForDraftPlan(): Promise<void> {
    throw new Error("Not implemented");
  }

  async listAllocationsByPlanId(): Promise<readonly KpiAllocation[]> {
    throw new Error("Not implemented");
  }

  async replaceAllocationsForPlan(): Promise<void> {
    throw new Error("Not implemented");
  }

  async transitionAllocationsForPlan(): Promise<number> {
    throw new Error("Not implemented");
  }

  async activateAllocationsForPlan(): Promise<void> {
    throw new Error("Not implemented");
  }
}

class InMemoryKpiActualRepository implements KpiActualRepository {
  readonly listPlanIdInputs: string[] = [];
  readonly listPlanIdsInputs: string[][] = [];

  constructor(private readonly entries: KpiActualEntry[]) {}

  snapshot(): readonly KpiActualEntry[] {
    return this.entries.map((entry) => ({ ...entry }));
  }

  async listEntriesByPlanId(
    kpiPlanId: string,
  ): Promise<readonly KpiActualEntry[]> {
    this.listPlanIdInputs.push(kpiPlanId);
    return this.entries.filter((entry) => entry.kpiPlanId === kpiPlanId);
  }

  async listEntriesByPlanIds(
    kpiPlanIds: readonly string[],
  ): Promise<readonly KpiActualEntry[]> {
    this.listPlanIdsInputs.push([...kpiPlanIds]);
    const ids = new Set(kpiPlanIds);
    return this.entries.filter((entry) => ids.has(entry.kpiPlanId));
  }

  async findEntryById(): Promise<KpiActualEntry | null> {
    throw new Error("Not implemented");
  }

  async findEntryByIdentity(): Promise<KpiActualEntry | null> {
    throw new Error("Not implemented");
  }

  async insertEntry(): Promise<KpiActualEntry> {
    throw new Error("Not implemented");
  }

  async updateEntryDirect(): Promise<KpiActualEntry | null> {
    throw new Error("Not implemented");
  }

  async insertCorrectionAndApply(): Promise<KpiActualEntry | null> {
    throw new Error("Not implemented");
  }

  async listEntriesByPlanIdAndActualDate(): Promise<readonly KpiActualEntry[]> {
    throw new Error("Not implemented");
  }

  async listCorrectionsByActualEntryId(): Promise<
    readonly KpiActualCorrection[]
  > {
    throw new Error("Not implemented");
  }
}

type _KeepImportedTypesUsed =
  | ClientSession
  | EmploymentStatus
  | KpiActualPolicySnapshot
  | KpiMetricCode
  | KpiPlanStatus
  | KpiSubjectType
  | TalentOperationalStatus;
