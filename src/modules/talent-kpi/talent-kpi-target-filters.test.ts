import assert from "node:assert/strict";
import { test } from "node:test";
import { Actor } from "@core/actor/actor";
import { Permission } from "@core/permission/permission.enum";
import { NativeMongoTalentKpiReadRepository } from "@infra/mongo/talent-kpi/talent-kpi.read-repository";
import { TalentKpiAdminQueryService } from "@modules/talent-kpi/admin/admin.talent-kpi.query-service";
import { TalentKpiValidationError } from "@modules/talent-kpi/domain/talent-kpi.errors";
import type { TalentKpiReadRepository } from "@modules/talent-kpi/read/talent-kpi.read-repository";
import {
  TalentKpiAdminDetailExposure,
  TalentKpiAdminListExposure,
} from "@modules/talent-kpi/shared/talent-kpi.exposure";

function createActor(): Actor {
  return new Actor({
    id: "admin-user-1",
    type: "admin",
    context: "ADMIN",
    accountContexts: ["ADMIN_CONSOLE"],
    roles: [],
    permissions: [Permission.TALENT_KPI_READ],
    scopeGrants: {
      talentKpi: ["global"],
    },
    isActive: true,
  });
}

function createServiceCapture(): {
  readonly service: TalentKpiAdminQueryService;
  capturedInput: unknown;
} {
  const capture: { capturedInput: unknown } = {
    capturedInput: undefined,
  };
  const repository: TalentKpiReadRepository = {
    async listTalentKpiRecords(input) {
      capture.capturedInput = input;
      return { items: [] };
    },
    async listTalentKpiRecordsByTalent() {
      return { items: [] };
    },
    async listTalentKpiRecordsByPlatform() {
      return { items: [] };
    },
    async listTalentKpiRecordsByEvent() {
      return { items: [] };
    },
    async listMetricValuesForRecord() {
      return [];
    },
    async getTalentKpiRecordDetail() {
      return null;
    },
  };

  return {
    service: new TalentKpiAdminQueryService(repository),
    get capturedInput() {
      return capture.capturedInput;
    },
  };
}

function decodeCursor(cursor: string): Record<string, unknown> {
  return JSON.parse(
    Buffer.from(cursor, "base64url").toString("utf8"),
  ) as Record<string, unknown>;
}

const kpiDocument = {
  _id: "kpi-1",
  kpiRecordCode: "KPI-1",
  normalizedKpiRecordCode: "kpi-1",
  title: "KPI 1",
  normalizedTitle: "kpi 1",
  subjectTalentId: "talent-1",
  attributionPlatformAccountId: "platform-1",
  attributionEventId: "event-1",
  measurementSource: "MANUAL",
  status: "FINALIZED",
  periodStartAt: 100,
  periodEndAt: 200,
  publishedAt: 150,
  description: null,
  externalRef: null,
  createdAt: 2500,
  updatedAt: 2600,
} as const;

test("Talent KPI target filters parse additive timestamps with existing status and KPI window filters", async () => {
  const capture = createServiceCapture();

  await capture.service.listTalentKpiRecords(createActor(), {
    status: "DRAFT",
    windowStartAt: "1000",
    windowEndAt: "2000",
    createdBeforeAt: "3000",
    publishedFromAt: "4000",
    publishedToAt: "5000",
    search: "kpi",
    limit: "10",
  });

  assert.deepEqual(capture.capturedInput, {
    status: "DRAFT",
    subjectTalentId: undefined,
    attributionPlatformAccountId: undefined,
    attributionEventId: undefined,
    measurementSource: undefined,
    containsMetricCode: undefined,
    windowStartAt: 1000,
    windowEndAt: 2000,
    createdBeforeAt: 3000,
    publishedFromAt: 4000,
    publishedToAt: 5000,
    limit: 10,
    cursor: undefined,
    search: "kpi",
    sortField: undefined,
    sortDirection: undefined,
  });
});

test("Talent KPI target filters reject invalid timestamps and reversed published ranges", async () => {
  await assert.rejects(
    createServiceCapture().service.listTalentKpiRecords(
      createActor(),
      {
        createdBeforeAt: "not-a-timestamp",
      },
    ),
    TalentKpiValidationError,
  );

  await assert.rejects(
    createServiceCapture().service.listTalentKpiRecords(
      createActor(),
      {
        publishedFromAt: "5000",
        publishedToAt: "5000",
      },
    ),
    TalentKpiValidationError,
  );
});

test("Talent KPI target filters build exclusive created and inclusive/exclusive published Mongo predicates", async () => {
  let capturedQuery: unknown;
  let capturedSort: unknown;
  let capturedLimit: unknown;
  const repository = new NativeMongoTalentKpiReadRepository({
    collection(name: string) {
      if (name === "talent_kpi_metric_values") {
        return {
          distinct: async () => [],
        };
      }

      if (
        name === "talents" ||
        name === "platform_accounts" ||
        name === "events"
      ) {
        return {
          find() {
            return {
              toArray: async () => [],
            };
          },
        };
      }

      return {
        find(query: unknown) {
          capturedQuery = query;
          return {
            sort(sort: unknown) {
              capturedSort = sort;
              return {
                limit(limit: unknown) {
                  capturedLimit = limit;
                  return {
                    toArray: async () => [
                      {
                        _id: "kpi-1",
                        kpiRecordCode: "KPI-1",
                        normalizedKpiRecordCode: "kpi-1",
                        title: "KPI 1",
                        normalizedTitle: "kpi 1",
                        subjectTalentId: "talent-1",
                        attributionPlatformAccountId: null,
                        attributionEventId: null,
                        measurementSource: "MANUAL",
                        status: "FINALIZED",
                        periodStartAt: 100,
                        periodEndAt: 200,
                        publishedAt: 4500,
                        description: null,
                        externalRef: null,
                        createdAt: 2500,
                        updatedAt: 2600,
                      },
                      {
                        _id: "kpi-2",
                        kpiRecordCode: "KPI-2",
                        normalizedKpiRecordCode: "kpi-2",
                        title: "KPI 2",
                        normalizedTitle: "kpi 2",
                        subjectTalentId: "talent-1",
                        attributionPlatformAccountId: null,
                        attributionEventId: null,
                        measurementSource: "MANUAL",
                        status: "FINALIZED",
                        periodStartAt: 90,
                        periodEndAt: 190,
                        publishedAt: 4600,
                        description: null,
                        externalRef: null,
                        createdAt: 2400,
                        updatedAt: 2500,
                      },
                    ],
                  };
                },
              };
            },
          };
        },
      };
    },
  } as never);

  const result = await repository.listTalentKpiRecords({
    status: "FINALIZED",
    windowStartAt: 1000,
    windowEndAt: 2000,
    createdBeforeAt: 3000,
    publishedFromAt: 4000,
    publishedToAt: 5000,
    limit: 1,
  });

  assert.deepEqual(capturedQuery, {
    $and: [
      { status: "FINALIZED" },
      { periodEndAt: { $gt: 1000 } },
      { periodStartAt: { $lt: 2000 } },
      { createdAt: { $lt: 3000 } },
      { publishedAt: { $gte: 4000 } },
      { publishedAt: { $lt: 5000 } },
    ],
  });
  assert.deepEqual(capturedSort, {
    periodStartAt: -1,
    _id: 1,
  });
  assert.equal(capturedLimit, 2);

  const cursor = decodeCursor(result.nextCursor ?? "");
  const signature = JSON.parse(
    String(cursor.queryShapeSignature),
  ) as Record<string, unknown>;
  assert.equal(signature.createdBeforeAt, 3000);
  assert.equal(signature.publishedFromAt, 4000);
  assert.equal(signature.publishedToAt, 5000);
}
);

test("Talent KPI list/detail enrich attribution refs with page-bounded batch lookups", async () => {
  const referenceFindCalls = {
    talents: 0,
    platformAccounts: 0,
    events: 0,
  };
  const repository = new NativeMongoTalentKpiReadRepository({
    collection(name: string) {
      if (name === "talent_kpi_metric_values") {
        return {
          distinct: async () => [],
        };
      }

      if (name === "talents") {
        return {
          find() {
            referenceFindCalls.talents += 1;
            return {
              toArray: async () => [
                {
                  _id: "talent-1",
                  talentCode: "TAL-1",
                  stageName: "Luna",
                  legalName: "Luna Legal",
                  displayShortName: "Luna",
                  operationalStatus: "ACTIVE",
                },
              ],
            };
          },
        };
      }

      if (name === "platform_accounts") {
        return {
          find() {
            referenceFindCalls.platformAccounts += 1;
            return {
              toArray: async () => [
                {
                  _id: "platform-1",
                  accountCode: "PA-1",
                  platform: "TIKTOK",
                  displayName: "Luna TikTok",
                  handle: "@luna",
                  operationalStatus: "ACTIVE",
                },
              ],
            };
          },
        };
      }

      if (name === "events") {
        return {
          find() {
            referenceFindCalls.events += 1;
            return {
              toArray: async () => [
                {
                  _id: "event-1",
                  eventCode: "EVT-1",
                  title: "Launch Event",
                  status: "PLANNED",
                },
              ],
            };
          },
        };
      }

      return {
        find() {
          return {
            sort() {
              return {
                limit() {
                  return {
                    toArray: async () => [
                      kpiDocument,
                      {
                        ...kpiDocument,
                        _id: "kpi-2",
                        attributionPlatformAccountId:
                          "missing-platform",
                        attributionEventId: null,
                      },
                    ],
                  };
                },
              };
            },
          };
        },
        findOne: async () => kpiDocument,
      };
    },
  } as never);

  const list = await repository.listTalentKpiRecords({
    limit: 10,
  });
  const first = list.items[0];
  const second = list.items[1];

  assert.equal(first.subjectTalentId, "talent-1");
  assert.deepEqual(first.subjectTalentRef, {
    id: "talent-1",
    code: "TAL-1",
    name: "Luna",
    status: "ACTIVE",
  });
  assert.deepEqual(first.attributionPlatformAccountRef, {
    id: "platform-1",
    code: "PA-1",
    displayName: "Luna TikTok",
    handle: "@luna",
    platform: "TIKTOK",
    status: "ACTIVE",
  });
  assert.deepEqual(first.attributionEventRef, {
    id: "event-1",
    code: "EVT-1",
    title: "Launch Event",
    status: "PLANNED",
  });
  assert.equal(
    second.attributionPlatformAccountRef,
    null,
  );
  assert.equal(second.attributionEventRef, null);
  assert.deepEqual(referenceFindCalls, {
    talents: 1,
    platformAccounts: 1,
    events: 1,
  });

  const detail =
    await repository.getTalentKpiRecordDetail("kpi-1");
  assert.equal(detail?.subjectTalentRef?.code, "TAL-1");
  assert.equal(
    detail?.attributionPlatformAccountRef?.displayName,
    "Luna TikTok",
  );
  assert.equal(detail?.attributionEventRef?.title, "Launch Event");

  assert.equal(
    TalentKpiAdminListExposure.expose(first)
      .subjectTalentRef !== undefined,
    true,
  );
  assert.equal(
    TalentKpiAdminDetailExposure.expose(detail!)
      .attributionEventRef !== undefined,
    true,
  );
});
