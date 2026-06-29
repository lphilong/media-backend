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
  KpiAllocationStatusCount,
  KpiAllocationStatus,
  KpiActualCorrection,
  KpiActualEntry,
  KpiActualPolicySnapshot,
  KpiActualSlotExcuse,
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

const MARCH_2026_START_AT = Date.UTC(2026, 2, 1, -7, 0, 0, 0);
const MARCH_2026_END_AT = Date.UTC(2026, 3, 1, -7, 0, 0, 0) - 1;
const APRIL_2026_START_AT = Date.UTC(2026, 3, 1, -7, 0, 0, 0);
const APRIL_2026_END_AT = Date.UTC(2026, 4, 1, -7, 0, 0, 0) - 1;
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
        planCode: "KPI-000001",
        title: "Official own KPI",
        periodMonth: "2026-05",
        periodStartAt: MAY_2026_START_AT,
        periodEndAt: MAY_2026_END_AT,
        officialStatus: "OFFICIAL_PUBLISHED",
        isCurrentPeriod: true,
        isPreviousPeriod: false,
        isReadOnly: true,
        lastUpdatedAt: 31,
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
        actualEntryStatusSummary: {
          expectedEntryCount: 62,
          enteredEntryCount: 3,
          enteredZeroCount: 1,
          pendingEntryCount: 2,
          overdueEntryCount: 23,
          excusedEntryCount: 1,
          notRequiredEntryCount: 1,
          notDueEntryCount: 32,
        },
      },
    ]);
    assert.deepEqual(body.data.current, body.data.items[0]);
    assert.equal(body.data.latestPrevious.kpiPlanId, "plan-previous-published");
    assert.equal(body.data.latestPrevious.isCurrentPeriod, false);
    assert.equal(body.data.latestPrevious.isPreviousPeriod, true);
    assert.deepEqual(body.data.latestPrevious.actualEntryStatusSummary, {
      expectedEntryCount: 60,
      enteredEntryCount: 1,
      enteredZeroCount: 0,
      pendingEntryCount: 0,
      overdueEntryCount: 58,
      excusedEntryCount: 1,
      notRequiredEntryCount: 0,
      notDueEntryCount: 0,
    });
    assert.deepEqual(
      body.data.history.map((item: { kpiPlanId: string }) => item.kpiPlanId),
      ["plan-previous-published", "plan-previous-finalized"],
    );
    const finalizedHistoryItem = body.data.history.find(
      (item: { kpiPlanId: string }) =>
        item.kpiPlanId === "plan-previous-finalized",
    );
    assert.equal(finalizedHistoryItem?.officialStatus, "OFFICIAL_FINALIZED");
    assert.deepEqual(finalizedHistoryItem?.actualEntryStatusSummary, {
      expectedEntryCount: 62,
      enteredEntryCount: 1,
      enteredZeroCount: 1,
      pendingEntryCount: 0,
      overdueEntryCount: 61,
      excusedEntryCount: 0,
      notRequiredEntryCount: 0,
      notDueEntryCount: 0,
    });
    assert.deepEqual(harness.kpi.listInputs, [
      {
        status: "PUBLISHED",
        memberTalentId: "talent-staff",
        memberEmploymentProfileId: "ep-staff",
        limit: 100,
      },
      {
        status: "PUBLISHED",
        memberEmploymentProfileId: "ep-staff",
        limit: 100,
      },
    ]);
    assert.deepEqual(harness.kpi.listPlanByIdsInputs, [
      [
        "plan-official",
        "plan-previous-published",
        "plan-previous-finalized",
        "plan-future",
        "plan-draft",
      ],
    ]);
    assert.deepEqual(harness.kpi.findPlanByIdInputs, []);
    assert.deepEqual(harness.actuals.listPlanIdInputs, []);
    assert.deepEqual(harness.actuals.listPlanIdsInputs, [
      ["plan-official", "plan-previous-published", "plan-previous-finalized"],
    ]);
    assert.deepEqual(harness.kpi.listActualSlotExcusePlanIdsInputs, [
      ["plan-official", "plan-previous-published", "plan-previous-finalized"],
    ]);

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
      "plan-forged-org-current",
      "plan-forged-org-previous",
      "plan-forged-org-finalized",
      "Forged ORG_UNIT",
      "ORG_UNIT",
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
      "createdByActorId",
      "updatedByActorId",
      "manager-secret",
      "canMarkExcused",
      "canUnmarkExcused",
      "canDirectEdit",
      "canEnterActual",
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

test("GET /self-service/kpi excludes forged ORG_UNIT plans from current and history", async () => {
  const harness = createHarness();
  const { server, baseUrl } = await listen(
    createSelfServiceKpiTestApp(harness, createStaffActor("user-staff")),
  );

  try {
    const response = await fetch(`${baseUrl}/self-service/kpi`);
    const body = await response.json();
    const currentIds = body.data.items.map(
      (item: { kpiPlanId: string }) => item.kpiPlanId,
    );
    const historyIds = body.data.history.map(
      (item: { kpiPlanId: string }) => item.kpiPlanId,
    );
    const allExposedIds = [
      ...currentIds,
      body.data.current?.kpiPlanId,
      body.data.latestPrevious?.kpiPlanId,
      ...historyIds,
    ].filter(Boolean);

    assert.equal(response.status, 200);
    assert.deepEqual(currentIds, ["plan-official"]);
    assert.equal(body.data.current.kpiPlanId, "plan-official");
    assert.equal(body.data.latestPrevious.kpiPlanId, "plan-previous-published");
    assert.deepEqual(historyIds, [
      "plan-previous-published",
      "plan-previous-finalized",
    ]);
    assert.equal(allExposedIds.includes("plan-forged-org-current"), false);
    assert.equal(allExposedIds.includes("plan-forged-org-previous"), false);
    assert.equal(allExposedIds.includes("plan-forged-org-finalized"), false);
    assert.equal(
      allExposedIds.includes("plan-org-profile-current"),
      false,
    );
    assert.deepEqual(harness.actuals.listPlanIdsInputs, [
      ["plan-official", "plan-previous-published", "plan-previous-finalized"],
    ]);
    assert.deepEqual(harness.kpi.listActualSlotExcusePlanIdsInputs, [
      ["plan-official", "plan-previous-published", "plan-previous-finalized"],
    ]);
  } finally {
    await close(server);
  }
});

test("GET /self-service/kpi returns profile-first ORG_UNIT KPI without linked internal Talent", async () => {
  const harness = createHarness();
  const { server, baseUrl } = await listen(
    createSelfServiceKpiTestApp(harness, createStaffActor("user-no-talent")),
  );

  try {
    const response = await fetch(`${baseUrl}/self-service/kpi`);
    const body = await response.json();
    const serialized = JSON.stringify(body);

    assert.equal(response.status, 200);
    assert.deepEqual(body.data.items, [
      {
        kpiPlanId: "plan-org-profile-current",
        planCode: "KPI-000001",
        title: "Official own Org Unit KPI",
        periodMonth: "2026-05",
        periodStartAt: MAY_2026_START_AT,
        periodEndAt: MAY_2026_END_AT,
        officialStatus: "OFFICIAL_PUBLISHED",
        isCurrentPeriod: true,
        isPreviousPeriod: false,
        isReadOnly: true,
        lastUpdatedAt: 55,
        metrics: [
          {
            metricCode: "REVENUE_VND",
            unit: "VND",
            targetValue: 200,
            actualValue: 50,
            progressPercent: 25,
          },
        ],
        actualEntryStatusSummary: {
          expectedEntryCount: 31,
          enteredEntryCount: 2,
          enteredZeroCount: 1,
          pendingEntryCount: 1,
          overdueEntryCount: 10,
          excusedEntryCount: 1,
          notRequiredEntryCount: 1,
          notDueEntryCount: 16,
        },
      },
    ]);
    assert.deepEqual(body.data.current, body.data.items[0]);
    assert.equal(
      body.data.latestPrevious.kpiPlanId,
      "plan-org-profile-previous-published",
    );
    assert.deepEqual(
      body.data.history.map((item: { kpiPlanId: string }) => item.kpiPlanId),
      [
        "plan-org-profile-previous-published",
        "plan-org-profile-previous-finalized",
      ],
    );
    assert.equal(
      body.data.history.find(
        (item: { kpiPlanId: string }) =>
          item.kpiPlanId === "plan-org-profile-previous-finalized",
      )?.officialStatus,
      "OFFICIAL_FINALIZED",
    );
    assert.deepEqual(harness.kpi.listInputs, [
      {
        status: "PUBLISHED",
        memberEmploymentProfileId: "ep-no-talent",
        limit: 100,
      },
    ]);
    assert.deepEqual(harness.kpi.listPlanByIdsInputs, [
      [
        "plan-org-profile-current",
        "plan-org-profile-previous-published",
        "plan-org-profile-previous-finalized",
        "plan-org-draft",
      ],
    ]);
    assert.deepEqual(harness.actuals.listPlanIdsInputs, [
      [
        "plan-org-profile-current",
        "plan-org-profile-previous-published",
        "plan-org-profile-previous-finalized",
      ],
    ]);
    assert.deepEqual(Object.keys(body.data.items[0]).sort(), [
      "actualEntryStatusSummary",
      "isCurrentPeriod",
      "isPreviousPeriod",
      "isReadOnly",
      "kpiPlanId",
      "lastUpdatedAt",
      "metrics",
      "officialStatus",
      "periodEndAt",
      "periodMonth",
      "periodStartAt",
      "planCode",
      "title",
    ]);

    for (const forbidden of [
      "memberEmploymentProfileId",
      "memberTalentId",
      "subjectId",
      "subjectType",
      "subjectRef",
      "orgUnitId",
      "managerEmploymentProfileId",
      "finalResult",
      "members",
      "allocationId",
      "actualEntryId",
      "correction",
      "correctedByActorId",
      "createdByActorId",
      "updatedByActorId",
      "plan-org-draft",
      "plan-org-other-unit",
      "plan-org-other-member",
      "plan-org-pending",
      "plan-org-rejected",
      "Other Org Unit",
      "Other member Org Unit",
      "manager note",
      "payroll",
      "commission",
      "canEnterActual",
      "canDirectEdit",
      "canMarkExcused",
      "canUnmarkExcused",
    ]) {
      assert.equal(serialized.includes(forbidden), false, forbidden);
    }
  } finally {
    await close(server);
  }
});

test("GET /self-service/kpi keeps items empty when current period is missing but returns latest previous", async () => {
  const harness = createHarness();
  const { server, baseUrl } = await listen(
    createSelfServiceKpiTestApp(
      harness,
      createStaffActor("user-staff"),
      () => Date.UTC(2026, 5, 2, 12, 0, 0, 0),
    ),
  );

  try {
    const response = await fetch(`${baseUrl}/self-service/kpi`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body.data.items, []);
    assert.equal(body.data.current, null);
    assert.equal(body.data.latestPrevious.kpiPlanId, "plan-official");
    assert.equal(body.data.latestPrevious.isCurrentPeriod, false);
    assert.equal(body.data.latestPrevious.isPreviousPeriod, true);
    assert.deepEqual(
      body.data.history.map((item: { kpiPlanId: string }) => item.kpiPlanId),
      [
        "plan-official",
        "plan-previous-published",
        "plan-previous-finalized",
      ],
    );
  } finally {
    await close(server);
  }
});

test("GET /self-service/kpi returns safe empty result without linked internal Talent or KPI allocations", async () => {
  const harness = createHarness();
  const { server, baseUrl } = await listen(
    createSelfServiceKpiTestApp(harness, createStaffActor("user-empty-profile")),
  );

  try {
    const response = await fetch(`${baseUrl}/self-service/kpi`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body.data, {
      items: [],
      current: null,
      latestPrevious: null,
      history: [],
    });
    assert.deepEqual(harness.kpi.listInputs, [
      {
        status: "PUBLISHED",
        memberEmploymentProfileId: "ep-empty-profile",
        limit: 100,
      },
    ]);
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
    assert.deepEqual(body.error, {
      code: "SELF_SERVICE_CURRENT_PERSON_NOT_LINKED",
      message: "No linked Employment Profile",
    });
    assert.deepEqual(harness.kpi.listInputs, []);
  } finally {
    await close(server);
  }
});

test("GET /self-service/kpi allows on-leave EmploymentProfile and denies terminated EmploymentProfile with unified contract", async () => {
  const onLeaveHarness = createHarness();
  const { server: onLeaveServer, baseUrl: onLeaveBaseUrl } = await listen(
    createSelfServiceKpiTestApp(
      onLeaveHarness,
      createStaffActor("user-on-leave"),
    ),
  );

  try {
    const response = await fetch(`${onLeaveBaseUrl}/self-service/kpi`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(
      body.data.items.map((item: { kpiPlanId: string }) => item.kpiPlanId),
      ["plan-org-on-leave-current"],
    );
    assert.deepEqual(onLeaveHarness.kpi.listInputs, [
      {
        status: "PUBLISHED",
        memberEmploymentProfileId: "ep-on-leave",
        limit: 100,
      },
    ]);
  } finally {
    await close(onLeaveServer);
  }

  const terminatedHarness = createHarness();
  const { server: terminatedServer, baseUrl: terminatedBaseUrl } = await listen(
    createSelfServiceKpiTestApp(
      terminatedHarness,
      createStaffActor("user-terminated"),
    ),
  );

  try {
    const response = await fetch(`${terminatedBaseUrl}/self-service/kpi`);
    const body = await response.json();
    const serialized = JSON.stringify(body);

    assert.equal(response.status, 403);
    assert.deepEqual(body.error, {
      code: "SELF_SERVICE_PROFILE_NOT_OPERATIONAL",
      message: "Self-Service access is not available for this profile status.",
    });
    for (const forbidden of [
      "ep-terminated",
      "user-terminated",
      "plan-org-terminated-current",
      "alloc-org-terminated-current",
      "payroll",
      "commission",
    ]) {
      assert.equal(serialized.includes(forbidden), false, forbidden);
    }
    assert.deepEqual(terminatedHarness.kpi.listInputs, []);
    assert.deepEqual(terminatedHarness.actuals.listPlanIdsInputs, []);
  } finally {
    await close(terminatedServer);
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
      (candidate) => candidate.code === "STAFF_CONSOLE_USER",
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
  clock: () => number = () => CURRENT_KPI_NOW,
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
      clock,
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
      id: "ep-empty-profile",
      linkedUserId: "user-empty-profile",
      orgUnitId: "ou-empty",
    }),
    employmentProfileRecord({
      id: "ep-on-leave",
      linkedUserId: "user-on-leave",
      employmentStatus: "ON_LEAVE",
    }),
    employmentProfileRecord({
      id: "ep-terminated",
      linkedUserId: "user-terminated",
      employmentStatus: "TERMINATED",
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
      kpiPlan({ id: "plan-draft", title: "Draft own KPI", status: "DRAFT" }),
      kpiPlan({ id: "plan-pending", title: "Pending own KPI" }),
      kpiPlan({ id: "plan-approved", title: "Approved own KPI" }),
      kpiPlan({ id: "plan-rejected", title: "Rejected own KPI" }),
      kpiPlan({ id: "plan-active", title: "Legacy active own KPI" }),
      kpiPlan({
        id: "plan-previous-published",
        title: "Previous published KPI",
        periodMonth: "2026-04",
        periodStartAt: APRIL_2026_START_AT,
        periodEndAt: APRIL_2026_END_AT,
      }),
      kpiPlan({
        id: "plan-previous-finalized",
        title: "Previous finalized KPI",
        status: "FINALIZED",
        periodMonth: "2026-03",
        periodStartAt: MARCH_2026_START_AT,
        periodEndAt: MARCH_2026_END_AT,
        finalizedAt: APRIL_2026_END_AT + 1,
        finalizedByActorId: "admin",
      }),
      kpiPlan({
        id: "plan-future",
        title: "Future own KPI",
        status: "DRAFT",
        periodMonth: "2026-06",
        periodStartAt: JUNE_2026_START_AT,
        periodEndAt: JUNE_2026_END_AT,
      }),
      kpiPlan({ id: "plan-other-member", title: "Other member KPI" }),
      kpiPlan({ id: "plan-unrelated-talent", title: "Unrelated Talent KPI" }),
      kpiPlan({
        id: "plan-unrelated-profile",
        title: "Unrelated EmploymentProfile KPI",
      }),
      kpiPlan({
        id: "plan-forged-org-current",
        title: "Forged ORG_UNIT current KPI",
        subjectType: "ORG_UNIT",
        subjectId: "org-unit-forged",
      }),
      kpiPlan({
        id: "plan-forged-org-previous",
        title: "Forged ORG_UNIT previous KPI",
        subjectType: "ORG_UNIT",
        subjectId: "org-unit-forged",
        periodMonth: "2026-04",
        periodStartAt: APRIL_2026_START_AT,
        periodEndAt: APRIL_2026_END_AT,
      }),
      kpiPlan({
        id: "plan-forged-org-finalized",
        title: "Forged ORG_UNIT finalized KPI",
        subjectType: "ORG_UNIT",
        subjectId: "org-unit-forged",
        status: "FINALIZED",
        periodMonth: "2026-03",
        periodStartAt: MARCH_2026_START_AT,
        periodEndAt: MARCH_2026_END_AT,
        finalizedAt: APRIL_2026_END_AT + 1,
        finalizedByActorId: "admin",
      }),
      kpiPlan({
        id: "plan-org-profile-current",
        title: "Official own Org Unit KPI",
        subjectType: "ORG_UNIT",
        subjectId: "ou-1",
      }),
      kpiPlan({
        id: "plan-org-profile-previous-published",
        title: "Previous Org Unit KPI",
        subjectType: "ORG_UNIT",
        subjectId: "ou-1",
        periodMonth: "2026-04",
        periodStartAt: APRIL_2026_START_AT,
        periodEndAt: APRIL_2026_END_AT,
      }),
      kpiPlan({
        id: "plan-org-profile-previous-finalized",
        title: "Finalized Org Unit KPI",
        subjectType: "ORG_UNIT",
        subjectId: "ou-1",
        status: "FINALIZED",
        periodMonth: "2026-03",
        periodStartAt: MARCH_2026_START_AT,
        periodEndAt: MARCH_2026_END_AT,
        finalizedAt: APRIL_2026_END_AT + 1,
        finalizedByActorId: "admin",
      }),
      kpiPlan({
        id: "plan-org-draft",
        title: "Draft Org Unit KPI",
        subjectType: "ORG_UNIT",
        subjectId: "ou-1",
        status: "DRAFT",
      }),
      kpiPlan({
        id: "plan-org-other-unit",
        title: "Other Org Unit KPI",
        subjectType: "ORG_UNIT",
        subjectId: "ou-other",
      }),
      kpiPlan({
        id: "plan-org-other-member",
        title: "Other member Org Unit KPI",
        subjectType: "ORG_UNIT",
        subjectId: "ou-1",
      }),
      kpiPlan({
        id: "plan-org-pending",
        title: "Pending Org Unit KPI",
        subjectType: "ORG_UNIT",
        subjectId: "ou-1",
      }),
      kpiPlan({
        id: "plan-org-rejected",
        title: "Rejected Org Unit KPI",
        subjectType: "ORG_UNIT",
        subjectId: "ou-1",
      }),
      kpiPlan({
        id: "plan-org-on-leave-current",
        title: "On leave Org Unit KPI",
        subjectType: "ORG_UNIT",
        subjectId: "ou-1",
      }),
      kpiPlan({
        id: "plan-org-terminated-current",
        title: "Terminated Org Unit KPI",
        subjectType: "ORG_UNIT",
        subjectId: "ou-1",
      }),
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
        id: "alloc-previous-published",
        kpiPlanId: "plan-previous-published",
        allocationStartDate: "2026-04-01",
      }),
      allocation({
        id: "alloc-previous-finalized",
        kpiPlanId: "plan-previous-finalized",
        allocationStartDate: "2026-03-01",
      }),
      allocation({
        id: "alloc-future",
        kpiPlanId: "plan-future",
      }),
      allocation({
        id: "alloc-published-draft-plan",
        kpiPlanId: "plan-draft",
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
      allocation({
        id: "alloc-forged-org-current",
        kpiPlanId: "plan-forged-org-current",
        subjectType: "ORG_UNIT",
        subjectId: "org-unit-forged",
        groupId: null,
        memberTalentId: null,
        targetMetrics: [{ metricCode: "REVENUE_VND", targetValue: 100 }],
      }),
      allocation({
        id: "alloc-forged-org-previous",
        kpiPlanId: "plan-forged-org-previous",
        subjectType: "ORG_UNIT",
        subjectId: "org-unit-forged",
        groupId: null,
        memberTalentId: null,
        allocationStartDate: "2026-04-01",
        targetMetrics: [{ metricCode: "REVENUE_VND", targetValue: 100 }],
      }),
      allocation({
        id: "alloc-forged-org-finalized",
        kpiPlanId: "plan-forged-org-finalized",
        subjectType: "ORG_UNIT",
        subjectId: "org-unit-forged",
        groupId: null,
        memberTalentId: null,
        allocationStartDate: "2026-03-01",
        targetMetrics: [{ metricCode: "REVENUE_VND", targetValue: 100 }],
      }),
      allocation({
        id: "alloc-org-profile-current",
        kpiPlanId: "plan-org-profile-current",
        subjectType: "ORG_UNIT",
        subjectId: "ou-1",
        groupId: null,
        memberEmploymentProfileId: "ep-no-talent",
        memberTalentId: null,
        membershipId: null,
        targetMetrics: [{ metricCode: "REVENUE_VND", targetValue: 200 }],
        updatedAt: 50,
        publishedAt: 55,
      }),
      allocation({
        id: "alloc-org-profile-previous-published",
        kpiPlanId: "plan-org-profile-previous-published",
        subjectType: "ORG_UNIT",
        subjectId: "ou-1",
        groupId: null,
        memberEmploymentProfileId: "ep-no-talent",
        memberTalentId: null,
        membershipId: null,
        allocationStartDate: "2026-04-01",
        targetMetrics: [{ metricCode: "REVENUE_VND", targetValue: 150 }],
      }),
      allocation({
        id: "alloc-org-profile-previous-finalized",
        kpiPlanId: "plan-org-profile-previous-finalized",
        subjectType: "ORG_UNIT",
        subjectId: "ou-1",
        groupId: null,
        memberEmploymentProfileId: "ep-no-talent",
        memberTalentId: null,
        membershipId: null,
        allocationStartDate: "2026-03-01",
        targetMetrics: [{ metricCode: "REVENUE_VND", targetValue: 120 }],
      }),
      allocation({
        id: "alloc-org-draft-plan",
        kpiPlanId: "plan-org-draft",
        subjectType: "ORG_UNIT",
        subjectId: "ou-1",
        groupId: null,
        memberEmploymentProfileId: "ep-no-talent",
        memberTalentId: null,
        membershipId: null,
        targetMetrics: [{ metricCode: "REVENUE_VND", targetValue: 100 }],
      }),
      allocation({
        id: "alloc-org-other-unit",
        kpiPlanId: "plan-org-other-unit",
        subjectType: "ORG_UNIT",
        subjectId: "ou-other",
        groupId: null,
        memberEmploymentProfileId: "ep-no-talent",
        memberTalentId: null,
        membershipId: null,
        targetMetrics: [{ metricCode: "REVENUE_VND", targetValue: 100 }],
      }),
      allocation({
        id: "alloc-org-other-member",
        kpiPlanId: "plan-org-other-member",
        subjectType: "ORG_UNIT",
        subjectId: "ou-1",
        groupId: null,
        memberEmploymentProfileId: "ep-other",
        memberTalentId: null,
        membershipId: null,
        targetMetrics: [{ metricCode: "REVENUE_VND", targetValue: 100 }],
      }),
      allocation({
        id: "alloc-org-pending",
        kpiPlanId: "plan-org-pending",
        subjectType: "ORG_UNIT",
        subjectId: "ou-1",
        groupId: null,
        memberEmploymentProfileId: "ep-no-talent",
        memberTalentId: null,
        membershipId: null,
        allocationStatus: "PENDING_APPROVAL",
        targetMetrics: [{ metricCode: "REVENUE_VND", targetValue: 100 }],
      }),
      allocation({
        id: "alloc-org-rejected",
        kpiPlanId: "plan-org-rejected",
        subjectType: "ORG_UNIT",
        subjectId: "ou-1",
        groupId: null,
        memberEmploymentProfileId: "ep-no-talent",
        memberTalentId: null,
        membershipId: null,
        allocationStatus: "REJECTED",
        targetMetrics: [{ metricCode: "REVENUE_VND", targetValue: 100 }],
      }),
      allocation({
        id: "alloc-org-on-leave-current",
        kpiPlanId: "plan-org-on-leave-current",
        subjectType: "ORG_UNIT",
        subjectId: "ou-1",
        groupId: null,
        memberEmploymentProfileId: "ep-on-leave",
        memberTalentId: null,
        membershipId: null,
        targetMetrics: [{ metricCode: "REVENUE_VND", targetValue: 80 }],
      }),
      allocation({
        id: "alloc-org-terminated-current",
        kpiPlanId: "plan-org-terminated-current",
        subjectType: "ORG_UNIT",
        subjectId: "ou-1",
        groupId: null,
        memberEmploymentProfileId: "ep-terminated",
        memberTalentId: null,
        membershipId: null,
        targetMetrics: [{ metricCode: "REVENUE_VND", targetValue: 80 }],
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
      id: "actual-zero",
      allocationId: "alloc-official",
      metricCode: "LIVE_HOURS",
      actualDate: "04-05-2026",
      actualValue: 0,
      effectiveValue: 0,
      updatedAt: 31,
    }),
    actualEntry({
      id: "actual-previous-published",
      kpiPlanId: "plan-previous-published",
      allocationId: "alloc-previous-published",
      actualDate: "01-04-2026",
      effectiveValue: 12,
      updatedAt: 28,
    }),
    actualEntry({
      id: "actual-previous-finalized-zero",
      kpiPlanId: "plan-previous-finalized",
      allocationId: "alloc-previous-finalized",
      actualDate: "01-03-2026",
      actualValue: 0,
      effectiveValue: 0,
      updatedAt: 27,
    }),
    actualEntry({
      id: "actual-other",
      allocationId: "alloc-other-member",
      memberTalentId: "talent-other",
      metricCode: "REVENUE_VND",
      effectiveValue: 999,
      createdByActorId: "other talent actual",
    }),
    actualEntry({
      id: "actual-org-revenue",
      kpiPlanId: "plan-org-profile-current",
      allocationId: "alloc-org-profile-current",
      memberEmploymentProfileId: "ep-no-talent",
      memberTalentId: null,
      metricCode: "REVENUE_VND",
      actualDate: "01-05-2026",
      actualValue: 50,
      effectiveValue: 50,
      correctionCount: 1,
      latestCorrectionId: "correction-hidden",
      updatedAt: 54,
      updatedByActorId: "manager note",
    }),
    actualEntry({
      id: "actual-org-zero",
      kpiPlanId: "plan-org-profile-current",
      allocationId: "alloc-org-profile-current",
      memberEmploymentProfileId: "ep-no-talent",
      memberTalentId: null,
      metricCode: "REVENUE_VND",
      actualDate: "04-05-2026",
      actualValue: 0,
      effectiveValue: 0,
      updatedAt: 53,
    }),
    actualEntry({
      id: "actual-org-previous-published",
      kpiPlanId: "plan-org-profile-previous-published",
      allocationId: "alloc-org-profile-previous-published",
      memberEmploymentProfileId: "ep-no-talent",
      memberTalentId: null,
      metricCode: "REVENUE_VND",
      actualDate: "01-04-2026",
      actualValue: 90,
      effectiveValue: 90,
      updatedAt: 52,
    }),
    actualEntry({
      id: "actual-org-previous-finalized",
      kpiPlanId: "plan-org-profile-previous-finalized",
      allocationId: "alloc-org-profile-previous-finalized",
      memberEmploymentProfileId: "ep-no-talent",
      memberTalentId: null,
      metricCode: "REVENUE_VND",
      actualDate: "01-03-2026",
      actualValue: 120,
      effectiveValue: 120,
      updatedAt: 51,
    }),
  ]);
  kpi.actualExcuses.push(
    actualSlotExcuse({
      id: "excuse-current-excused",
      kpiPlanId: "plan-official",
      allocationId: "alloc-official",
      metricCode: "REVENUE_VND",
      actualDate: "02-05-2026",
      status: "EXCUSED",
    }),
    actualSlotExcuse({
      id: "excuse-current-not-required",
      kpiPlanId: "plan-official",
      allocationId: "alloc-official",
      metricCode: "LIVE_HOURS",
      actualDate: "03-05-2026",
      status: "NOT_REQUIRED",
    }),
    actualSlotExcuse({
      id: "excuse-previous",
      kpiPlanId: "plan-previous-published",
      allocationId: "alloc-previous-published",
      metricCode: "LIVE_HOURS",
      actualDate: "02-04-2026",
      status: "EXCUSED",
    }),
    actualSlotExcuse({
      id: "excuse-org-current-excused",
      kpiPlanId: "plan-org-profile-current",
      allocationId: "alloc-org-profile-current",
      metricCode: "REVENUE_VND",
      actualDate: "02-05-2026",
      status: "EXCUSED",
    }),
    actualSlotExcuse({
      id: "excuse-org-current-not-required",
      kpiPlanId: "plan-org-profile-current",
      allocationId: "alloc-org-profile-current",
      metricCode: "REVENUE_VND",
      actualDate: "03-05-2026",
      status: "NOT_REQUIRED",
    }),
  );

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
    subjectType: "TALENT_GROUP",
    subjectId: "group-own",
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
    memberEmploymentProfileId: "ep-staff",
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

function actualSlotExcuse(
  overrides: Partial<KpiActualSlotExcuse>,
): KpiActualSlotExcuse {
  return {
    id: "excuse-1",
    kpiPlanId: "plan-official",
    allocationId: "alloc-official",
    metricCode: "REVENUE_VND",
    actualDate: "02-05-2026",
    status: "EXCUSED",
    reasonCode: "MEMBER_LEAVE",
    reasonText: "Safe self-service status summary source",
    createdAt: 1,
    createdByActorId: "manager-secret",
    updatedAt: 2,
    updatedByActorId: "manager-secret",
    deletedAt: null,
    deletedByActorId: null,
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
  readonly listActualSlotExcusePlanIdsInputs: string[][] = [];
  readonly actualExcuses: KpiActualSlotExcuse[] = [];

  constructor(
    private readonly plans: KpiPlan[],
    private readonly allocations: KpiAllocation[],
  ) {}

  snapshot(): unknown {
    return {
      plans: this.plans.map((plan) => ({ ...plan })),
      allocations: this.allocations.map((item) => ({ ...item })),
      actualExcuses: this.actualExcuses.map((item) => ({ ...item })),
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

  async listActualWorkspaceDerivedPlans(): Promise<readonly never[]> {
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

  async listTargetMetricsByPlanIds(): Promise<readonly KpiTargetMetric[]> {
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

  async listAllocationsByPlanIds(): Promise<readonly KpiAllocation[]> {
    throw new Error("Not implemented");
  }

  async countAllocationsByPlanIds(): Promise<
    readonly KpiAllocationStatusCount[]
  > {
    return [];
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

  async findActualSlotExcuseById(): Promise<KpiActualSlotExcuse | null> {
    throw new Error("Not implemented");
  }

  async findActiveActualSlotExcuseByIdentity(): Promise<KpiActualSlotExcuse | null> {
    throw new Error("Not implemented");
  }

  async listActualSlotExcusesByPlanIds(
    kpiPlanIds: readonly string[],
  ): Promise<readonly KpiActualSlotExcuse[]> {
    this.listActualSlotExcusePlanIdsInputs.push([...kpiPlanIds]);
    const ids = new Set(kpiPlanIds);
    return this.actualExcuses.filter(
      (excuse) => ids.has(excuse.kpiPlanId) && excuse.deletedAt === null,
    );
  }

  async listActualSlotExcusesByPlanIdAndActualDate(): Promise<
    readonly KpiActualSlotExcuse[]
  > {
    throw new Error("Not implemented");
  }

  async setActualSlotExcuse(): Promise<KpiActualSlotExcuse> {
    throw new Error("Not implemented");
  }

  async removeActualSlotExcuse(): Promise<KpiActualSlotExcuse | null> {
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
