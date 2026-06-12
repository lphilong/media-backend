import assert from "node:assert/strict";
import { test } from "node:test";
import { Actor } from "@core/actor/actor";
import { Permission } from "@core/permission/permission.enum";
import { NativeMongoRevenueLedgerReadRepository } from "@infra/mongo/revenue-ledger/revenue-ledger.read-repository";
import { RevenueLedgerAdminQueryService } from "@modules/revenue-ledger/admin/admin.revenue-ledger.query-service";
import { RevenueLedgerValidationError } from "@modules/revenue-ledger/domain/revenue-ledger.errors";
import type { RevenueLedgerReadRepository } from "@modules/revenue-ledger/read/revenue-ledger.read-repository";
import {
  RevenueLedgerAdminDetailExposure,
  RevenueLedgerAdminListExposure,
} from "@modules/revenue-ledger/shared/revenue-ledger.exposure";

function createActor(): Actor {
  return new Actor({
    id: "admin-user-1",
    type: "admin",
    context: "ADMIN",
    roles: [],
    permissions: [Permission.REVENUE_LEDGER_READ],
    scopeGrants: {
      revenueLedger: ["global"],
    },
    isActive: true,
  });
}

function createServiceCapture(): {
  readonly service: RevenueLedgerAdminQueryService;
  capturedInput: unknown;
} {
  const capture: { capturedInput: unknown } = {
    capturedInput: undefined,
  };
  const repository: RevenueLedgerReadRepository = {
    async listRevenueEntries(input) {
      capture.capturedInput = input;
      return { items: [] };
    },
    async listRevenueEntriesByTalent() {
      return { items: [] };
    },
    async listRevenueEntriesByPlatform() {
      return { items: [] };
    },
    async listRevenueEntriesByEvent() {
      return { items: [] };
    },
    async getRevenueEntryDetail() {
      return null;
    },
  };

  return {
    service: new RevenueLedgerAdminQueryService(repository),
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

const revenueDocument = {
  _id: "rev-1",
  revenueEntryCode: "REV-1",
  title: "Revenue 1",
  normalizedTitle: "revenue 1",
  subjectTalentId: "talent-1",
  attributionPlatformAccountId: "platform-1",
  attributionEventId: "event-1",
  revenueKind: "PLATFORM_LIVESTREAM",
  entrySource: "MANUAL",
  status: "FINALIZED",
  currencyCode: "USD",
  recognizedAmount: 10,
  recognizedAt: 1500,
  finalizedAt: 4500,
  reconciledAt: null,
  voidedAt: null,
  reconciliationReference: null,
  description: null,
  externalRef: null,
  createdAt: 2500,
  updatedAt: 2600,
} as const;

test("Revenue Ledger target filters parse additive timestamps with existing status and recognizedAt window filters", async () => {
  const capture = createServiceCapture();

  await capture.service.listRevenueEntries(createActor(), {
    status: "RECONCILED",
    windowStartAt: "1000",
    windowEndAt: "2000",
    createdBeforeAt: "3000",
    finalizedFromAt: "4000",
    finalizedToAt: "5000",
    reconciledFromAt: "6000",
    reconciledToAt: "7000",
    search: "rev",
    limit: "10",
  });

  assert.deepEqual(capture.capturedInput, {
    status: "RECONCILED",
    subjectTalentId: undefined,
    attributionPlatformAccountId: undefined,
    attributionEventId: undefined,
    revenueKind: undefined,
    entrySource: undefined,
    currencyCode: undefined,
    windowStartAt: 1000,
    windowEndAt: 2000,
    createdBeforeAt: 3000,
    finalizedFromAt: 4000,
    finalizedToAt: 5000,
    reconciledFromAt: 6000,
    reconciledToAt: 7000,
    limit: 10,
    cursor: undefined,
    search: "rev",
    sortField: undefined,
    sortDirection: undefined,
  });
});

test("Revenue Ledger target filters reject invalid timestamps and reversed ranges", async () => {
  await assert.rejects(
    createServiceCapture().service.listRevenueEntries(
      createActor(),
      {
        createdBeforeAt: "bad",
      },
    ),
    RevenueLedgerValidationError,
  );

  await assert.rejects(
    createServiceCapture().service.listRevenueEntries(
      createActor(),
      {
        finalizedFromAt: "5000",
        finalizedToAt: "4000",
      },
    ),
    RevenueLedgerValidationError,
  );

  await assert.rejects(
    createServiceCapture().service.listRevenueEntries(
      createActor(),
      {
        reconciledFromAt: "7000",
        reconciledToAt: "7000",
      },
    ),
    RevenueLedgerValidationError,
  );
});

test("Revenue Ledger target filters build field-specific Mongo predicates and cursor signatures", async () => {
  let capturedQuery: unknown;
  let capturedSort: unknown;
  let capturedLimit: unknown;
  const repository = new NativeMongoRevenueLedgerReadRepository({
    collection(name: string) {
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
                        _id: "rev-1",
                        revenueEntryCode: "REV-1",
                        title: "Revenue 1",
                        normalizedTitle: "revenue 1",
                        subjectTalentId: "talent-1",
                        attributionPlatformAccountId: null,
                        attributionEventId: null,
                        revenueKind: "PLATFORM_LIVESTREAM",
                        entrySource: "MANUAL",
                        status: "RECONCILED",
                        currencyCode: "USD",
                        recognizedAmount: 10,
                        recognizedAt: 1500,
                        finalizedAt: 4500,
                        reconciledAt: 6500,
                        voidedAt: null,
                        reconciliationReference: null,
                        description: null,
                        externalRef: null,
                        createdAt: 2500,
                        updatedAt: 2600,
                      },
                      {
                        _id: "rev-2",
                        revenueEntryCode: "REV-2",
                        title: "Revenue 2",
                        normalizedTitle: "revenue 2",
                        subjectTalentId: "talent-1",
                        attributionPlatformAccountId: null,
                        attributionEventId: null,
                        revenueKind: "PLATFORM_LIVESTREAM",
                        entrySource: "MANUAL",
                        status: "RECONCILED",
                        currencyCode: "USD",
                        recognizedAmount: 11,
                        recognizedAt: 1400,
                        finalizedAt: 4600,
                        reconciledAt: 6600,
                        voidedAt: null,
                        reconciliationReference: null,
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

  const result = await repository.listRevenueEntries({
    status: "RECONCILED",
    windowStartAt: 1000,
    windowEndAt: 2000,
    createdBeforeAt: 3000,
    finalizedFromAt: 4000,
    finalizedToAt: 5000,
    reconciledFromAt: 6000,
    reconciledToAt: 7000,
    limit: 1,
  });

  assert.deepEqual(capturedQuery, {
    $and: [
      { status: "RECONCILED" },
      { recognizedAt: { $gte: 1000 } },
      { recognizedAt: { $lt: 2000 } },
      { createdAt: { $lt: 3000 } },
      { finalizedAt: { $gte: 4000 } },
      { finalizedAt: { $lt: 5000 } },
      { reconciledAt: { $gte: 6000 } },
      { reconciledAt: { $lt: 7000 } },
    ],
  });
  assert.deepEqual(capturedSort, {
    recognizedAt: -1,
    _id: 1,
  });
  assert.equal(capturedLimit, 2);

  const cursor = decodeCursor(result.nextCursor ?? "");
  const signature = JSON.parse(
    String(cursor.queryShapeSignature),
  ) as Record<string, unknown>;
  assert.equal(signature.createdBeforeAt, 3000);
  assert.equal(signature.finalizedFromAt, 4000);
  assert.equal(signature.finalizedToAt, 5000);
  assert.equal(signature.reconciledFromAt, 6000);
  assert.equal(signature.reconciledToAt, 7000);
});

test("Revenue Ledger list/detail enrich attribution refs with page-bounded batch lookups", async () => {
  const referenceFindCalls = {
    talents: 0,
    platformAccounts: 0,
    events: 0,
  };
  const repository = new NativeMongoRevenueLedgerReadRepository({
    collection(name: string) {
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
                      revenueDocument,
                      {
                        ...revenueDocument,
                        _id: "rev-2",
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
        findOne: async () => revenueDocument,
      };
    },
  } as never);

  const list = await repository.listRevenueEntries({
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
    await repository.getRevenueEntryDetail("rev-1");
  assert.equal(detail?.subjectTalentRef?.code, "TAL-1");
  assert.equal(
    detail?.attributionPlatformAccountRef?.displayName,
    "Luna TikTok",
  );
  assert.equal(detail?.attributionEventRef?.title, "Launch Event");

  assert.equal(
    RevenueLedgerAdminListExposure.expose(first)
      .subjectTalentRef !== undefined,
    true,
  );
  assert.equal(
    RevenueLedgerAdminDetailExposure.expose(detail!)
      .attributionEventRef !== undefined,
    true,
  );
});
