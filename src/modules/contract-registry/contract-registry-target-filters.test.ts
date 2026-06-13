import assert from "node:assert/strict";
import { test } from "node:test";
import { ClientSession } from "mongodb";
import { Actor } from "@core/actor/actor";
import type {
  AuthoritativeAdminMutationBridge,
  AuthoritativeMutationControls,
} from "@core/application/authoritative-admin-mutation.bridge";
import type { AuditGuard } from "@core/audit/audit.guard";
import type { BusinessCodeSequenceRepository } from "@core/business-code/business-code-sequence.repository";
import { Permission } from "@core/permission/permission.enum";
import { bindTraceId } from "@core/trace/trace.context";
import { ContractRegistryAdminService } from "@modules/contract-registry/admin/admin.contract-registry.service";
import type { ContractRegistryEmploymentProfileReadonlyAccess } from "@modules/contract-registry/domain/contract-registry-employment-profile-readonly-access";
import { ContractRegistryAdminQueryService } from "@modules/contract-registry/admin/admin.contract-registry.query-service";
import { ContractRegistryValidationError } from "@modules/contract-registry/domain/contract-registry.errors";
import type { ContractRegistryRepository } from "@modules/contract-registry/domain/contract-registry.repository";
import type { ContractRegistryTalentReadonlyAccess } from "@modules/contract-registry/domain/contract-registry-talent-readonly-access";
import {
  ContractKind,
  ContractRecord,
  getContractBoundaryMetadata,
} from "@modules/contract-registry/domain/contract-registry.types";
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

function createMutationActor(): Actor {
  return new Actor({
    id: "admin-user-1",
    type: "admin",
    context: "ADMIN",
    roles: [],
    permissions: [
      Permission.CONTRACT_REGISTRY_CREATE,
      Permission.CONTRACT_REGISTRY_UPDATE,
      Permission.CONTRACT_REGISTRY_MANAGE_LIFECYCLE,
    ],
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
                          contractKind: "TALENT_SERVICE",
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
  assert.deepEqual(first.boundaryMetadata, {
    semanticBoundary: "LEGACY_EMPLOYMENT",
    kindClassification:
      "LEGACY_EMPLOYMENT_DEPRECATED",
    commercialLegalRegistry: false,
    commercialChainContextEligible: false,
    directRevenueSourceEligible: false,
    directCommissionSourceEligible: false,
    payrollSourceEligible: false,
    obligationAcceptanceImplemented: false,
    eventEvidenceLinkImplemented: false,
  });
  assert.deepEqual(second.boundaryMetadata, {
    semanticBoundary: "COMMERCIAL_LEGAL",
    kindClassification:
      "COMMERCIAL_LEGAL_SUPPORTED",
    commercialLegalRegistry: true,
    commercialChainContextEligible: true,
    directRevenueSourceEligible: false,
    directCommissionSourceEligible: false,
    payrollSourceEligible: false,
    obligationAcceptanceImplemented: true,
    eventEvidenceLinkImplemented: false,
  });
});

test("Contract Registry creates supported commercial/legal talent contracts with boundary metadata", async () => {
  const harness = createMutationHarness();

  const created = await withTrace(() =>
    harness.service.createContractRecord(
      createMutationActor(),
      {
        contractCode: "CTR-COM-1",
        title: "Talent campaign agreement",
        contractKind: "TALENT_SERVICE",
        linkedEntityKind: "TALENT",
        linkedTalentId: "talent-1",
        ownerEmploymentProfileId: "owner-1",
        confidentialityTier: "CONFIDENTIAL",
        effectiveStartDate: "2026-01-01",
      },
    ),
  );

  assert.equal(created.contractKind, "TALENT_SERVICE");
  assert.equal(created.status, "DRAFT");
  assert.deepEqual(created.boundaryMetadata, {
    semanticBoundary: "COMMERCIAL_LEGAL",
    kindClassification:
      "COMMERCIAL_LEGAL_SUPPORTED",
    commercialLegalRegistry: true,
    commercialChainContextEligible: true,
    directRevenueSourceEligible: false,
    directCommissionSourceEligible: false,
    payrollSourceEligible: false,
    obligationAcceptanceImplemented: true,
    eventEvidenceLinkImplemented: false,
  });
  assert.equal(harness.repository.records.length, 1);
});

test("Contract Registry rejects new EMPLOYMENT records as legacy employment semantics", async () => {
  const harness = createMutationHarness();

  await assert.rejects(
    withTrace(() =>
      harness.service.createContractRecord(
        createMutationActor(),
        {
          contractCode: "CTR-EMP-1",
          title: "Employment contract",
          contractKind: "EMPLOYMENT",
          linkedEntityKind: "EMPLOYMENT_PROFILE",
          linkedEmploymentProfileId: "employee-1",
          ownerEmploymentProfileId: "owner-1",
          confidentialityTier: "INTERNAL",
          effectiveStartDate: "2026-01-01",
        },
      ),
    ),
    (error: unknown) =>
      error instanceof ContractRegistryValidationError &&
      error.message.includes(
        "employment/labor contract semantics are legacy-deprecated",
      ),
  );
  assert.equal(harness.repository.records.length, 0);
});

test("Contract Registry keeps legacy EMPLOYMENT records readable but blocks pending-signature and activation promotion", async () => {
  const harness = createMutationHarness();
  harness.repository.records.push(
    contractRecord({
      id: "legacy-1",
      contractCode: "CTR-LEGACY-1",
      contractKind: "EMPLOYMENT",
      linkedEntityKind: "EMPLOYMENT_PROFILE",
      linkedEmploymentProfileId: "employee-1",
      linkedTalentId: null,
      status: "DRAFT",
    }),
  );

  await assert.rejects(
    withTrace(() =>
      harness.service.markContractRecordPendingSignature(
        createMutationActor(),
        {
          contractRecordId: "legacy-1",
        },
      ),
    ),
    (error: unknown) =>
      error instanceof ContractRegistryValidationError &&
      error.message.includes(
        "employment/labor contract semantics are legacy-deprecated",
      ),
  );

  await assert.rejects(
    withTrace(() =>
      harness.service.activateContractRecord(
        createMutationActor(),
        {
          contractRecordId: "legacy-1",
        },
      ),
    ),
    (error: unknown) =>
      error instanceof ContractRegistryValidationError &&
      error.message.includes(
        "employment/labor contract semantics are legacy-deprecated",
      ),
  );

  const legacy = harness.repository.records[0];
  assert.equal(legacy.status, "DRAFT");
  assert.deepEqual(
    ContractRegistryAdminDetailExposure.expose({
      ...legacy,
      linkedEmploymentProfileRef: null,
      linkedTalentRef: null,
      ownerEmploymentProfileRef: null,
      boundaryMetadata: {
        semanticBoundary: "LEGACY_EMPLOYMENT",
        kindClassification:
          "LEGACY_EMPLOYMENT_DEPRECATED",
        commercialLegalRegistry: false,
        commercialChainContextEligible: false,
        directRevenueSourceEligible: false,
        directCommissionSourceEligible: false,
        payrollSourceEligible: false,
        obligationAcceptanceImplemented: false,
        eventEvidenceLinkImplemented: false,
      },
    }).boundaryMetadata,
    {
      semanticBoundary: "LEGACY_EMPLOYMENT",
      kindClassification:
        "LEGACY_EMPLOYMENT_DEPRECATED",
      commercialLegalRegistry: false,
      commercialChainContextEligible: false,
      directRevenueSourceEligible: false,
      directCommissionSourceEligible: false,
      payrollSourceEligible: false,
      obligationAcceptanceImplemented: false,
      eventEvidenceLinkImplemented: false,
    },
  );
});

test("Contract Registry preserves legacy boundary classification after a harmless draft metadata edit", async () => {
  const harness = createMutationHarness();
  harness.repository.records.push(
    contractRecord({
      id: "legacy-edit-1",
      contractCode: "CTR-LEGACY-EDIT-1",
      contractKind: "EMPLOYMENT",
      linkedEntityKind: "EMPLOYMENT_PROFILE",
      linkedEmploymentProfileId: "employee-1",
      linkedTalentId: null,
      status: "DRAFT",
    }),
  );

  const updated = await withTrace(() =>
    harness.service.updateContractRecordDraftCore(
      createMutationActor(),
      {
        contractRecordId: "legacy-edit-1",
        title: "Updated legacy reference metadata",
        description: "Compatibility-only metadata update",
      },
    ),
  );

  assert.equal(updated.contractKind, "EMPLOYMENT");
  assert.equal(updated.linkedEntityKind, "EMPLOYMENT_PROFILE");
  assert.equal(
    updated.linkedEmploymentProfileId,
    "employee-1",
  );
  assert.equal(updated.status, "DRAFT");
  assert.deepEqual(updated.boundaryMetadata, {
    semanticBoundary: "LEGACY_EMPLOYMENT",
    kindClassification:
      "LEGACY_EMPLOYMENT_DEPRECATED",
    commercialLegalRegistry: false,
    commercialChainContextEligible: false,
    directRevenueSourceEligible: false,
    directCommissionSourceEligible: false,
    payrollSourceEligible: false,
    obligationAcceptanceImplemented: false,
    eventEvidenceLinkImplemented: false,
  });
});

test("Contract Registry boundary classification is exhaustive and fails closed for unknown runtime kinds", () => {
  const commercialKinds: readonly ContractKind[] = [
    "TALENT_SERVICE",
    "TALENT_MANAGEMENT",
  ];

  for (const contractKind of commercialKinds) {
    assert.deepEqual(
      getContractBoundaryMetadata(contractKind),
      {
        semanticBoundary: "COMMERCIAL_LEGAL",
        kindClassification:
          "COMMERCIAL_LEGAL_SUPPORTED",
        commercialLegalRegistry: true,
        commercialChainContextEligible: true,
        directRevenueSourceEligible: false,
        directCommissionSourceEligible: false,
        payrollSourceEligible: false,
        obligationAcceptanceImplemented: true,
        eventEvidenceLinkImplemented: false,
      },
    );
  }

  assert.deepEqual(
    getContractBoundaryMetadata("EMPLOYMENT"),
    {
      semanticBoundary: "LEGACY_EMPLOYMENT",
      kindClassification:
        "LEGACY_EMPLOYMENT_DEPRECATED",
      commercialLegalRegistry: false,
      commercialChainContextEligible: false,
      directRevenueSourceEligible: false,
      directCommissionSourceEligible: false,
      payrollSourceEligible: false,
      obligationAcceptanceImplemented: false,
      eventEvidenceLinkImplemented: false,
    },
  );

  assert.deepEqual(
    getContractBoundaryMetadata(
      "FUTURE_CONTRACT_KIND" as ContractKind,
    ),
    {
      semanticBoundary: "UNSUPPORTED",
      kindClassification:
        "UNSUPPORTED_CONTRACT_KIND",
      commercialLegalRegistry: false,
      commercialChainContextEligible: false,
      directRevenueSourceEligible: false,
      directCommissionSourceEligible: false,
      payrollSourceEligible: false,
      obligationAcceptanceImplemented: false,
      eventEvidenceLinkImplemented: false,
    },
  );
});

test("Contract Registry rejects attempts to morph a commercial talent draft into employment-linked semantics", async () => {
  const harness = createMutationHarness();
  harness.repository.records.push(
    contractRecord({
      id: "commercial-1",
      contractCode: "CTR-COM-1",
      contractKind: "TALENT_MANAGEMENT",
      linkedEntityKind: "TALENT",
      linkedEmploymentProfileId: null,
      linkedTalentId: "talent-1",
      status: "DRAFT",
    }),
  );

  await assert.rejects(
    withTrace(() =>
      harness.service.updateContractRecordDraftCore(
        createMutationActor(),
        {
          contractRecordId: "commercial-1",
          linkedEntityKind: "EMPLOYMENT_PROFILE",
          linkedEmploymentProfileId: "employee-1",
          linkedTalentId: null,
        },
      ),
    ),
    /contractKind TALENT_MANAGEMENT is incompatible with linkedEntityKind EMPLOYMENT_PROFILE/,
  );

  const current = harness.repository.records[0];
  assert.equal(current.linkedEntityKind, "TALENT");
  assert.equal(current.linkedTalentId, "talent-1");
});

function withTrace<T>(fn: () => Promise<T>): Promise<T> {
  return bindTraceId(
    "trace-contract-registry-cr-1a",
    fn,
  );
}

function createMutationHarness(): {
  readonly repository: InMemoryContractRegistryRepository;
  readonly service: ContractRegistryAdminService;
} {
  const repository =
    new InMemoryContractRegistryRepository();
  const service = new ContractRegistryAdminService(
    repository,
    { async hasUnresolvedByContractRecordId() { return false; } } as never,
    new InMemoryCodeSequenceRepository(),
    new StaticEmploymentProfileReadonlyAccess(),
    new StaticTalentReadonlyAccess(),
    { async record() {} } as unknown as AuditGuard,
    immediateMutationBridge,
    {
      info() {},
      warn() {},
      error() {},
      debug() {},
    } as never,
  );

  return {
    repository,
    service,
  };
}

function contractRecord(
  overrides: Partial<ContractRecord>,
): ContractRecord {
  return {
    id: "contract-1",
    contractCode: "CTR-1",
    title: "Contract",
    normalizedTitle: "contract",
    contractKind: "TALENT_SERVICE",
    linkedEntityKind: "TALENT",
    linkedEmploymentProfileId: null,
    linkedTalentId: "talent-1",
    ownerEmploymentProfileId: "owner-1",
    confidentialityTier: "INTERNAL",
    status: "DRAFT",
    effectiveStartDate: utcDate("2026-01-01"),
    effectiveEndDate: null,
    fileReferenceId: null,
    fileDisplayName: null,
    description: null,
    externalRef: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

const immediateMutationBridge: AuthoritativeAdminMutationBridge =
  {
    async execute(_params, mutate) {
      const controls: AuthoritativeMutationControls = {
        markAuthSecurityTruthChanged() {},
        markExplicitNoOpSuccess() {},
      };
      return mutate({} as ClientSession, controls);
    },
  };

class InMemoryCodeSequenceRepository
  implements BusinessCodeSequenceRepository
{
  async ensureAtLeast(): Promise<void> {}

  async allocateNext(): Promise<number> {
    return 1;
  }
}

class StaticEmploymentProfileReadonlyAccess
  implements ContractRegistryEmploymentProfileReadonlyAccess
{
  async findById(employmentProfileId: string) {
    if (
      employmentProfileId === "owner-1" ||
      employmentProfileId === "employee-1"
    ) {
      return {
        id: employmentProfileId,
        employmentStatus: "ACTIVE" as const,
      };
    }

    return null;
  }
}

class StaticTalentReadonlyAccess
  implements ContractRegistryTalentReadonlyAccess
{
  async findById(talentId: string) {
    if (talentId === "talent-1") {
      return {
        id: talentId,
        operationalStatus: "ACTIVE" as const,
      };
    }

    return null;
  }
}

class InMemoryContractRegistryRepository
  implements ContractRegistryRepository
{
  readonly records: ContractRecord[] = [];

  async insert(
    contractRecord: ContractRecord,
  ): Promise<ContractRecord> {
    this.records.push(contractRecord);
    return contractRecord;
  }

  async findById(
    contractRecordId: string,
  ): Promise<ContractRecord | null> {
    return (
      this.records.find(
        (record) => record.id === contractRecordId,
      ) ?? null
    );
  }

  async findByContractCode(
    contractCode: string,
  ): Promise<ContractRecord | null> {
    return (
      this.records.find(
        (record) =>
          record.contractCode === contractCode,
      ) ?? null
    );
  }

  async findMaxGeneratedContractCodeSequence(): Promise<number> {
    return 0;
  }

  async updateDraftCore(
    input: Parameters<
      ContractRegistryRepository["updateDraftCore"]
    >[0],
  ): Promise<ContractRecord | null> {
    const index = this.records.findIndex(
      (record) =>
        record.id === input.contractRecordId &&
        (record.status === "DRAFT" ||
          record.status === "PENDING_SIGNATURE"),
    );

    if (index < 0) {
      return null;
    }

    const updated = {
      ...this.records[index],
      ...input,
      id: this.records[index].id,
      updatedAt: input.updatedAt,
    };
    this.records[index] = updated;
    return updated;
  }

  async assignOwner(): Promise<ContractRecord | null> {
    return null;
  }

  async updateFileReference(): Promise<ContractRecord | null> {
    return null;
  }

  async transitionStatus(
    input: Parameters<
      ContractRegistryRepository["transitionStatus"]
    >[0],
  ): Promise<ContractRecord | null> {
    const index = this.records.findIndex(
      (record) =>
        record.id === input.contractRecordId &&
        input.fromStatuses.includes(record.status),
    );

    if (index < 0) {
      return null;
    }

    const updated = {
      ...this.records[index],
      status: input.toStatus,
      effectiveEndDate:
        input.effectiveEndDate ??
        this.records[index].effectiveEndDate,
      updatedAt: input.updatedAt,
    };
    this.records[index] = updated;
    return updated;
  }
}
