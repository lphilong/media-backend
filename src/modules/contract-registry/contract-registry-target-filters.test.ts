import assert from "node:assert/strict";
import { test } from "node:test";
import { Actor } from "@core/actor/actor";
import { Permission } from "@core/permission/permission.enum";
import { ContractRegistryAdminQueryService } from "@modules/contract-registry/admin/admin.contract-registry.query-service";
import { ContractRegistryValidationError } from "@modules/contract-registry/domain/contract-registry.errors";
import type { ContractRegistryReadRepository } from "@modules/contract-registry/read/contract-registry.read-repository";
import {
  ContractRegistryAdminDetailExposure,
  ContractRegistryAdminListExposure,
} from "@modules/contract-registry/shared/contract-registry.exposure";
import { NativeMongoContractRegistryReadRepository } from "@infra/mongo/contract-registry/contract-registry.read-repository";

function createActor(): Actor {
  return new Actor({
    id: "admin-user-1",
    type: "admin",
    context: "ADMIN",
    roles: [],
    permissions: [Permission.CONTRACT_REGISTRY_READ],
    scopeGrants: {
      contractRegistry: ["global"],
    },
    isActive: true,
  });
}

function utcDate(value: string): number {
  return Date.parse(`${value}T00:00:00.000Z`);
}

function createServiceCapture(): {
  readonly service: ContractRegistryAdminQueryService;
  capturedInput: unknown;
} {
  const capture: { capturedInput: unknown } = {
    capturedInput: undefined,
  };
  const repository: ContractRegistryReadRepository = {
    async listContractRecords(input) {
      capture.capturedInput = input;
      return { items: [] };
    },
    async listContractRecordsByLinkedEntity() {
      return { items: [] };
    },
    async listContractRecordsByOwner() {
      return { items: [] };
    },
    async getContractRecordDetail() {
      return null;
    },
  };

  return {
    service: new ContractRegistryAdminQueryService(
      repository,
    ),
    get capturedInput() {
      return capture.capturedInput;
    },
  };
}

test("Contract Registry parses effectiveEndDateFrom/To as canonical date-only filters with existing status/window filters", async () => {
  const capture = createServiceCapture();

  await capture.service.listContractRecords(createActor(), {
    status: "ACTIVE",
    windowStartDate: "2026-01-01",
    windowEndDate: "2026-12-31",
    effectiveEndDateFrom: "2026-05-01",
    effectiveEndDateTo: "2026-05-31",
    limit: "10",
  });

  assert.deepEqual(capture.capturedInput, {
    status: "ACTIVE",
    contractKind: undefined,
    linkedEntityKind: undefined,
    linkedEmploymentProfileId: undefined,
    linkedTalentId: undefined,
    ownerEmploymentProfileId: undefined,
    confidentialityTier: undefined,
    hasFileReference: undefined,
    windowStartDate: utcDate("2026-01-01"),
    windowEndDate: utcDate("2026-12-31"),
    effectiveEndDateFrom: utcDate("2026-05-01"),
    effectiveEndDateTo: utcDate("2026-05-31"),
    limit: 10,
    cursor: undefined,
    search: undefined,
    sortField: undefined,
    sortDirection: undefined,
  });
});

test("Contract Registry rejects invalid effectiveEndDate date-only values and reversed ranges", async () => {
  await assert.rejects(
    createServiceCapture().service.listContractRecords(
      createActor(),
      {
        effectiveEndDateFrom: "2026-02-30",
      },
    ),
    ContractRegistryValidationError,
  );

  await assert.rejects(
    createServiceCapture().service.listContractRecords(
      createActor(),
      {
        effectiveEndDateFrom: "2026-06-01",
        effectiveEndDateTo: "2026-05-01",
      },
    ),
    ContractRegistryValidationError,
  );
});

test("Contract Registry effective-end range builds inclusive direct-field predicates and excludes null end dates", async () => {
  let capturedQuery: unknown;
  let capturedSort: unknown;
  let capturedLimit: unknown;
  const repository =
    new NativeMongoContractRegistryReadRepository({
      collection() {
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
                      toArray: async () => [],
                    };
                  },
                };
              },
            };
          },
        };
      },
    } as never);

  await repository.listContractRecords({
    status: "ACTIVE",
    windowStartDate: utcDate("2026-01-01"),
    windowEndDate: utcDate("2026-12-31"),
    effectiveEndDateFrom: utcDate("2026-05-01"),
    effectiveEndDateTo: utcDate("2026-05-31"),
    limit: 20,
  });

  assert.deepEqual(capturedQuery, {
    $and: [
      { status: "ACTIVE" },
      {
        $or: [
          { effectiveEndDate: null },
          {
            effectiveEndDate: {
              $gte: utcDate("2026-01-01"),
            },
          },
        ],
      },
      {
        effectiveStartDate: {
          $lte: utcDate("2026-12-31"),
        },
      },
      {
        effectiveEndDate: {
          $gte: utcDate("2026-05-01"),
          $lte: utcDate("2026-05-31"),
        },
      },
    ],
  });
  assert.deepEqual(capturedSort, {
    effectiveStartDate: -1,
    contractCode: 1,
    _id: 1,
  });
  assert.equal(capturedLimit, 21);
});

test("Contract Registry list/detail enrich linked and owner refs with page-bounded batch lookups", async () => {
  const referenceFindCalls = {
    employmentProfiles: 0,
    talents: 0,
  };
  const contractDocument = {
    _id: "contract-1",
    contractCode: "CON-1",
    normalizedContractCode: "con-1",
    title: "Contract 1",
    normalizedTitle: "contract 1",
    contractKind: "EMPLOYMENT",
    linkedEntityKind: "EMPLOYMENT_PROFILE",
    linkedEmploymentProfileId: "ep-1",
    linkedTalentId: null,
    ownerEmploymentProfileId: "ep-missing",
    confidentialityTier: "INTERNAL",
    status: "ACTIVE",
    effectiveStartDate: utcDate("2026-01-01"),
    effectiveEndDate: null,
    fileReferenceId: null,
    fileDisplayName: null,
    description: null,
    externalRef: null,
    createdAt: 1,
    updatedAt: 2,
  };
  const repository =
    new NativeMongoContractRegistryReadRepository({
      collection(name: string) {
        if (name === "employment_profiles") {
          return {
            find(_query: unknown, options: unknown) {
              referenceFindCalls.employmentProfiles += 1;
              assert.deepEqual(options, {
                projection: {
                  _id: 1,
                  employeeCode: 1,
                  legalName: 1,
                  displayName: 1,
                  employmentStatus: 1,
                },
              });
              return {
                toArray: async () => [
                  {
                    _id: "ep-1",
                    employeeCode: "EMP-1",
                    legalName: "Alice Legal",
                    displayName: "Alice",
                    employmentStatus: "ACTIVE",
                  },
                ],
              };
            },
          };
        }

        if (name === "talents") {
          return {
            find(_query: unknown, options: unknown) {
              referenceFindCalls.talents += 1;
              assert.deepEqual(options, {
                projection: {
                  _id: 1,
                  talentCode: 1,
                  stageName: 1,
                  legalName: 1,
                  displayShortName: 1,
                  operationalStatus: 1,
                },
              });
              return {
                toArray: async () => [],
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
                        contractDocument,
                        {
                          ...contractDocument,
                          _id: "contract-2",
                          linkedEntityKind: "TALENT",
                          linkedEmploymentProfileId: null,
                          linkedTalentId: "talent-missing",
                        },
                      ],
                    };
                  },
                };
              },
            };
          },
          findOne: async () => contractDocument,
        };
      },
    } as never);

  const list = await repository.listContractRecords({
    limit: 10,
  });
  const first = list.items[0];
  const second = list.items[1];

  assert.equal(first.linkedEmploymentProfileId, "ep-1");
  assert.deepEqual(first.linkedEmploymentProfileRef, {
    id: "ep-1",
    code: "EMP-1",
    name: "Alice",
    status: "ACTIVE",
  });
  assert.equal(first.ownerEmploymentProfileRef, null);
  assert.equal(second.linkedTalentRef, null);
  assert.deepEqual(referenceFindCalls, {
    employmentProfiles: 1,
    talents: 1,
  });

  const detail =
    await repository.getContractRecordDetail("contract-1");
  assert.equal(detail?.linkedEmploymentProfileRef?.code, "EMP-1");
  assert.equal(detail?.ownerEmploymentProfileRef, null);
  assert.equal(
    ContractRegistryAdminListExposure.expose(first)
      .linkedEmploymentProfileRef !== undefined,
    true,
  );
  assert.equal(
    ContractRegistryAdminDetailExposure.expose(detail!)
      .ownerEmploymentProfileRef !== undefined,
    true,
  );
});
