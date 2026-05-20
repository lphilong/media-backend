import assert from "node:assert/strict";
import { test } from "node:test";
import { Actor } from "@core/actor/actor";
import { Permission } from "@core/permission/permission.enum";
import { NativeMongoCommissionReadRepository } from "@infra/mongo/commission/commission.read-repository";
import { CommissionAdminQueryService } from "@modules/commission/admin/admin.commission.query-service";
import { CommissionValidationError } from "@modules/commission/domain/commission.errors";
import type { CommissionReadRepository } from "@modules/commission/read/commission.read-repository";
import {
  CommissionAdminRuleDetailExposure,
  CommissionAdminRuleListExposure,
  CommissionAdminSettlementByBeneficiaryListExposure,
  CommissionAdminSettlementByRevenueEntryListExposure,
  CommissionAdminSettlementBySubjectTalentListExposure,
  CommissionAdminSettlementDetailExposure,
  CommissionAdminSettlementListExposure,
} from "@modules/commission/shared/commission.exposure";

function createActor(): Actor {
  return new Actor({
    id: "admin-user-1",
    type: "admin",
    context: "ADMIN",
    roles: [],
    permissions: [
      Permission.COMMISSION_SETTLEMENT_READ,
      Permission.COMMISSION_RULE_READ,
    ],
    scopeGrants: {
      commission: ["global"],
    },
    isActive: true,
  });
}

function createServiceCapture(): {
  readonly service: CommissionAdminQueryService;
  capturedSettlementInput: unknown;
  capturedRuleInput: unknown;
} {
  const capture: {
    capturedSettlementInput: unknown;
    capturedRuleInput: unknown;
  } = {
    capturedSettlementInput: undefined,
    capturedRuleInput: undefined,
  };
  const repository: CommissionReadRepository = {
    async listCommissionRules(input) {
      capture.capturedRuleInput = input;
      return { items: [] };
    },
    async listCommissionRulesByBeneficiary() {
      return { items: [] };
    },
    async listCommissionRulesByContract() {
      return { items: [] };
    },
    async getCommissionRuleDetail() {
      return null;
    },
    async listCommissionSettlements(input) {
      capture.capturedSettlementInput = input;
      return { items: [] };
    },
    async listCommissionSettlementsByBeneficiary() {
      return { items: [] };
    },
    async listCommissionSettlementsBySubjectTalent() {
      return { items: [] };
    },
    async listCommissionSettlementsByRevenueEntry() {
      return { items: [] };
    },
    async listCommissionSettlementLines() {
      return [];
    },
    async getCommissionSettlementDetail() {
      return null;
    },
  };

  return {
    service: new CommissionAdminQueryService(repository),
    get capturedSettlementInput() {
      return capture.capturedSettlementInput;
    },
    get capturedRuleInput() {
      return capture.capturedRuleInput;
    },
  };
}

function decodeCursor(cursor: string): Record<string, unknown> {
  return JSON.parse(
    Buffer.from(cursor, "base64url").toString("utf8"),
  ) as Record<string, unknown>;
}

test("Commission Settlement target filters parse additive timestamps with existing status and settlement-period window filters", async () => {
  const capture = createServiceCapture();

  await capture.service.listCommissionSettlements(
    createActor(),
    {
      status: "FINALIZED",
      windowStartAt: "1000",
      windowEndAt: "2000",
      createdBeforeAt: "3000",
      finalizedFromAt: "4000",
      finalizedToAt: "5000",
      search: "settlement",
      limit: "10",
    },
  );

  assert.deepEqual(capture.capturedSettlementInput, {
    status: "FINALIZED",
    settlementKindSnapshot: undefined,
    beneficiaryKindSnapshot: undefined,
    beneficiaryEmploymentProfileIdSnapshot: undefined,
    beneficiaryTalentIdSnapshot: undefined,
    subjectTalentId: undefined,
    sourceRuleId: undefined,
    containsRevenueEntryId: undefined,
    settlementCurrencyCode: undefined,
    windowStartAt: 1000,
    windowEndAt: 2000,
    createdBeforeAt: 3000,
    finalizedFromAt: 4000,
    finalizedToAt: 5000,
    limit: 10,
    cursor: undefined,
    search: "settlement",
    sortField: undefined,
    sortDirection: undefined,
  });
});

test("Commission Settlement target filters reject invalid timestamps and reversed finalized ranges", async () => {
  await assert.rejects(
    createServiceCapture().service.listCommissionSettlements(
      createActor(),
      {
        createdBeforeAt: "bad",
      },
    ),
    CommissionValidationError,
  );

  await assert.rejects(
    createServiceCapture().service.listCommissionSettlements(
      createActor(),
      {
        finalizedFromAt: "5000",
        finalizedToAt: "4000",
      },
    ),
    CommissionValidationError,
  );
});

test("Commission Settlement target filters build field-specific Mongo predicates and cursor signatures", async () => {
  let capturedQuery: unknown;
  let capturedSort: unknown;
  let capturedLimit: unknown;
  const repository = new NativeMongoCommissionReadRepository({
    collection(name: string) {
      if (name === "commission_settlements") {
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
                          _id: "settlement-1",
                          settlementCode: "CS-1",
                          title: "Settlement 1",
                          normalizedTitle: "settlement 1",
                          sourceRuleId: "rule-1",
                          sourceContractRecordIdSnapshot: "contract-1",
                          settlementKindSnapshot: "REVENUE_SHARE",
                          beneficiaryKindSnapshot: "TALENT",
                          beneficiaryEmploymentProfileIdSnapshot: null,
                          beneficiaryTalentIdSnapshot: "talent-1",
                          subjectTalentId: "talent-1",
                          settlementBasisSnapshot:
                            "RECOGNIZED_GROSS_REVENUE",
                          ratePercentSnapshot: 10,
                          revenueEntryIds: ["revenue-1"],
                          settlementPeriodStartAt: 1100,
                          settlementPeriodEndAt: 1900,
                          settlementCurrencyCode: "USD",
                          grossRevenueAmount: 100,
                          settlementAmount: 10,
                          status: "FINALIZED",
                          finalizedAt: 4500,
                          voidedAt: null,
                          description: null,
                          externalRef: null,
                          createdAt: 2500,
                          updatedAt: 2600,
                        },
                        {
                          _id: "settlement-2",
                          settlementCode: "CS-2",
                          title: "Settlement 2",
                          normalizedTitle: "settlement 2",
                          sourceRuleId: "rule-1",
                          sourceContractRecordIdSnapshot: "contract-1",
                          settlementKindSnapshot: "REVENUE_SHARE",
                          beneficiaryKindSnapshot: "TALENT",
                          beneficiaryEmploymentProfileIdSnapshot: null,
                          beneficiaryTalentIdSnapshot: "talent-1",
                          subjectTalentId: "talent-1",
                          settlementBasisSnapshot:
                            "RECOGNIZED_GROSS_REVENUE",
                          ratePercentSnapshot: 10,
                          revenueEntryIds: ["revenue-2"],
                          settlementPeriodStartAt: 1000,
                          settlementPeriodEndAt: 1800,
                          settlementCurrencyCode: "USD",
                          grossRevenueAmount: 110,
                          settlementAmount: 11,
                          status: "FINALIZED",
                          finalizedAt: 4600,
                          voidedAt: null,
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
      }

      return {
        find() {
          return {
            toArray: async () => [],
            sort() {
              return {
                limit() {
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

  const result = await repository.listCommissionSettlements({
    status: "FINALIZED",
    windowStartAt: 1000,
    windowEndAt: 2000,
    createdBeforeAt: 3000,
    finalizedFromAt: 4000,
    finalizedToAt: 5000,
    limit: 1,
  });

  assert.deepEqual(capturedQuery, {
    $and: [
      { status: "FINALIZED" },
      { settlementPeriodStartAt: { $lt: 2000 } },
      { settlementPeriodEndAt: { $gt: 1000 } },
      { createdAt: { $lt: 3000 } },
      { finalizedAt: { $gte: 4000 } },
      { finalizedAt: { $lt: 5000 } },
    ],
  });
  assert.deepEqual(capturedSort, {
    settlementPeriodStartAt: -1,
    settlementCode: 1,
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
});

test("Commission Rule query behavior remains unchanged", async () => {
  const capture = createServiceCapture();

  await capture.service.listCommissionRules(createActor(), {
    status: "ACTIVE",
    windowStartDate: "1735689600000",
    windowEndDate: "1735776000000",
    limit: "5",
  });

  assert.deepEqual(capture.capturedRuleInput, {
    status: "ACTIVE",
    settlementKind: undefined,
    beneficiaryKind: undefined,
    beneficiaryEmploymentProfileId: undefined,
    beneficiaryTalentId: undefined,
    sourceContractRecordId: undefined,
    appliesToRevenueKind: undefined,
    windowStartDate: 1735689600000,
    windowEndDate: 1735776000000,
    limit: 5,
    cursor: undefined,
    search: undefined,
    sortField: undefined,
    sortDirection: undefined,
  });
});

test("Commission Rule list/detail enrich beneficiary and source contract refs with batch lookups", async () => {
  const referenceFindCalls = {
    employmentProfiles: 0,
    talents: 0,
    contracts: 0,
  };
  const ruleDocument = {
    _id: "rule-1",
    ruleCode: "CRULE-1",
    title: "Rule 1",
    normalizedTitle: "rule 1",
    settlementKind: "REVENUE_SHARE",
    beneficiaryKind: "TALENT",
    beneficiaryEmploymentProfileId: null,
    beneficiaryTalentId: "talent-1",
    sourceContractRecordId: "contract-1",
    settlementBasis: "RECOGNIZED_GROSS_REVENUE",
    ratePercent: 10,
    appliesToRevenueKinds: ["PLATFORM_LIVESTREAM"],
    status: "ACTIVE",
    effectiveStartDate: 1,
    effectiveEndDate: null,
    description: null,
    externalRef: null,
    createdAt: 2,
    updatedAt: 3,
  };
  const repository = new NativeMongoCommissionReadRepository({
    collection(name: string) {
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

      if (name === "employment_profiles") {
        return {
          find() {
            referenceFindCalls.employmentProfiles += 1;
            return { toArray: async () => [] };
          },
        };
      }

      if (name === "contract_records") {
        return {
          find(_query: unknown, options: unknown) {
            referenceFindCalls.contracts += 1;
            assert.deepEqual(options, {
              projection: {
                _id: 1,
                contractCode: 1,
                title: 1,
                status: 1,
              },
            });
            return {
              toArray: async () => [
                {
                  _id: "contract-1",
                  contractCode: "CON-1",
                  title: "Contract 1",
                  status: "ACTIVE",
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
                      ruleDocument,
                      {
                        ...ruleDocument,
                        _id: "rule-2",
                        beneficiaryTalentId: "missing-talent",
                        sourceContractRecordId:
                          "missing-contract",
                      },
                    ],
                  };
                },
              };
            },
          };
        },
        findOne: async () => ruleDocument,
      };
    },
  } as never);

  const list = await repository.listCommissionRules({
    limit: 10,
  });
  const first = list.items[0];
  const second = list.items[1];

  assert.equal(first.beneficiaryTalentId, "talent-1");
  assert.deepEqual(first.beneficiaryRef, {
    id: "talent-1",
    code: "TAL-1",
    name: "Luna",
    status: "ACTIVE",
  });
  assert.deepEqual(first.sourceContractRecordRef, {
    id: "contract-1",
    code: "CON-1",
    title: "Contract 1",
    status: "ACTIVE",
  });
  assert.equal(second.beneficiaryRef, null);
  assert.equal(second.sourceContractRecordRef, null);
  assert.deepEqual(referenceFindCalls, {
    employmentProfiles: 0,
    talents: 1,
    contracts: 1,
  });

  const detail = await repository.getCommissionRuleDetail("rule-1");
  assert.equal(detail?.beneficiaryRef?.code, "TAL-1");
  assert.equal(
    CommissionAdminRuleListExposure.expose(first)
      .sourceContractRecordRef !== undefined,
    true,
  );
  assert.equal(
    CommissionAdminRuleDetailExposure.expose(detail!)
      .beneficiaryRef !== undefined,
    true,
  );
});

test("Commission Settlement list/detail enrich beneficiary, source rule, and revenue entry refs while preserving line snapshots", async () => {
  const referenceFindCalls = {
    talents: 0,
    rules: 0,
    revenueEntries: 0,
  };
  const settlementDocument = {
    _id: "settlement-1",
    settlementCode: "CS-1",
    title: "Settlement 1",
    normalizedTitle: "settlement 1",
    sourceRuleId: "rule-1",
    sourceContractRecordIdSnapshot: "contract-1",
    settlementKindSnapshot: "REVENUE_SHARE",
    beneficiaryKindSnapshot: "TALENT",
    beneficiaryEmploymentProfileIdSnapshot: null,
    beneficiaryTalentIdSnapshot: "talent-1",
    subjectTalentId: "talent-1",
    settlementBasisSnapshot: "RECOGNIZED_GROSS_REVENUE",
    ratePercentSnapshot: 10,
    revenueEntryIds: ["revenue-1", "missing-revenue"],
    settlementPeriodStartAt: 1,
    settlementPeriodEndAt: 2,
    settlementCurrencyCode: "USD",
    grossRevenueAmount: 100,
    settlementAmount: 10,
    status: "FINALIZED",
    finalizedAt: 3,
    voidedAt: null,
    description: null,
    externalRef: null,
    createdAt: 4,
    updatedAt: 5,
  };

  const repository = new NativeMongoCommissionReadRepository({
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

      if (name === "revenue_entries") {
        return {
          find(_query: unknown, options: unknown) {
            referenceFindCalls.revenueEntries += 1;
            assert.deepEqual(options, {
              projection: {
                _id: 1,
                revenueEntryCode: 1,
                title: 1,
                status: 1,
              },
            });
            return {
              toArray: async () => [
                {
                  _id: "revenue-1",
                  revenueEntryCode: "REV-1",
                  title: "Revenue 1",
                  status: "FINALIZED",
                },
              ],
            };
          },
        };
      }

      if (name === "commission_settlements") {
        return {
          find() {
            return {
              sort() {
                return {
                  limit() {
                    return {
                      toArray: async () => [settlementDocument],
                    };
                  },
                };
              },
            };
          },
          findOne: async () => settlementDocument,
        };
      }

      if (name === "commission_settlement_lines") {
        return {
          find() {
            return {
              sort() {
                return {
                  toArray: async () => [
                    {
                      _id: "line-1",
                      settlementId: "settlement-1",
                      revenueEntryId: "revenue-1",
                      revenueEntryCodeSnapshot:
                        "REV-202604-000001",
                      revenueKindSnapshot:
                        "PLATFORM_LIVESTREAM",
                      revenueCurrencyCodeSnapshot: "USD",
                      revenueRecognizedAmountSnapshot: 100,
                      revenueRecognizedAtSnapshot: 2,
                      lineSettlementAmount: 10,
                      createdAt: 4,
                      updatedAt: 5,
                    },
                  ],
                };
              },
            };
          },
        };
      }

      return {
        find(_query: unknown, options: unknown) {
          if (
            options &&
            typeof options === "object" &&
            "projection" in options
          ) {
            referenceFindCalls.rules += 1;
            assert.deepEqual(options, {
              projection: {
                _id: 1,
                ruleCode: 1,
                title: 1,
                status: 1,
              },
            });
            return {
              toArray: async () => [
                {
                  _id: "rule-1",
                  ruleCode: "CRULE-1",
                  title: "Rule 1",
                  status: "ACTIVE",
                },
              ],
            };
          }

          return {
            sort() {
              return {
                limit() {
                  return { toArray: async () => [] };
                },
              };
            },
          };
        },
        findOne: async () => null,
      };
    },
  } as never);

  const list = await repository.listCommissionSettlements({
    limit: 10,
  });
  const first = list.items[0];

  assert.deepEqual(first.beneficiaryRef, {
    id: "talent-1",
    code: "TAL-1",
    name: "Luna",
    status: "ACTIVE",
  });
  assert.deepEqual(first.sourceRuleRef, {
    id: "rule-1",
    code: "CRULE-1",
    title: "Rule 1",
    status: "ACTIVE",
  });
  assert.deepEqual(first.revenueEntryRefs, [
    {
      id: "revenue-1",
      code: "REV-1",
      title: "Revenue 1",
      status: "FINALIZED",
    },
    { id: "missing-revenue" },
  ]);
  assert.deepEqual(referenceFindCalls, {
    talents: 1,
    rules: 1,
    revenueEntries: 1,
  });

  const detail =
    await repository.getCommissionSettlementDetail(
      "settlement-1",
    );
  assert.equal(detail?.sourceRuleRef?.code, "CRULE-1");
  assert.equal(
    detail?.revenueEntryRefs?.[0]?.code,
    "REV-1",
  );

  const lines =
    await repository.listCommissionSettlementLines(
      "settlement-1",
    );
  assert.equal(
    lines[0]?.revenueEntryCodeSnapshot,
    "REV-202604-000001",
  );
  assert.equal(lines[0]?.revenueEntryId, "revenue-1");
  assert.equal(
    CommissionAdminSettlementListExposure.expose(first)
      .revenueEntryRefs !== undefined,
    true,
  );
  assert.equal(
    CommissionAdminSettlementDetailExposure.expose(detail!)
      .sourceRuleRef !== undefined,
    true,
  );
});

test("Commission Settlement related lists return full frontend list contract", async () => {
  const referenceFindCalls = {
    talents: 0,
    rules: 0,
    revenueEntries: 0,
  };
  const settlementDocument = {
    _id: "settlement-related-1",
    settlementCode: "CS-RELATED-1",
    title: "Related settlement",
    normalizedTitle: "related settlement",
    sourceRuleId: "rule-1",
    sourceContractRecordIdSnapshot: "contract-1",
    settlementKindSnapshot: "REVENUE_SHARE",
    beneficiaryKindSnapshot: "TALENT",
    beneficiaryEmploymentProfileIdSnapshot: null,
    beneficiaryTalentIdSnapshot: "talent-1",
    subjectTalentId: "talent-1",
    settlementBasisSnapshot: "RECOGNIZED_GROSS_REVENUE",
    ratePercentSnapshot: 12.5,
    revenueEntryIds: [
      "revenue-2",
      "missing-revenue",
      "revenue-1",
    ],
    settlementPeriodStartAt: 1000,
    settlementPeriodEndAt: 2000,
    settlementCurrencyCode: "USD",
    grossRevenueAmount: 400,
    settlementAmount: 50,
    status: "FINALIZED",
    finalizedAt: 2500,
    voidedAt: null,
    description: null,
    externalRef: null,
    createdAt: 900,
    updatedAt: 2600,
  };
  const repository = new NativeMongoCommissionReadRepository({
    collection(name: string) {
      if (name === "commission_settlements") {
        return {
          find() {
            return {
              sort() {
                return {
                  limit() {
                    return {
                      toArray: async () => [
                        settlementDocument,
                      ],
                    };
                  },
                };
              },
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

      if (name === "revenue_entries") {
        return {
          find(_query: unknown, options: unknown) {
            referenceFindCalls.revenueEntries += 1;
            assert.deepEqual(options, {
              projection: {
                _id: 1,
                revenueEntryCode: 1,
                title: 1,
                status: 1,
              },
            });
            return {
              toArray: async () => [
                {
                  _id: "revenue-1",
                  revenueEntryCode: "REV-1",
                  title: "Revenue 1",
                  status: "FINALIZED",
                },
                {
                  _id: "revenue-2",
                  revenueEntryCode: "REV-2",
                  title: "Revenue 2",
                  status: "FINALIZED",
                },
              ],
            };
          },
        };
      }

      if (name === "employment_profiles") {
        return {
          find() {
            throw new Error(
              "employment profile lookup should not run for talent beneficiary settlements",
            );
          },
        };
      }

      return {
        find(_query: unknown, options: unknown) {
          if (
            options &&
            typeof options === "object" &&
            "projection" in options
          ) {
            referenceFindCalls.rules += 1;
            assert.deepEqual(options, {
              projection: {
                _id: 1,
                ruleCode: 1,
                title: 1,
                status: 1,
              },
            });
            return {
              toArray: async () => [
                {
                  _id: "rule-1",
                  ruleCode: "CRULE-1",
                  title: "Rule 1",
                  status: "ACTIVE",
                },
              ],
            };
          }

          return {
            sort() {
              return {
                limit() {
                  return { toArray: async () => [] };
                },
              };
            },
          };
        },
      };
    },
  } as never);

  const bySubject =
    await repository.listCommissionSettlementsBySubjectTalent({
      subjectTalentId: "talent-1",
      limit: 10,
    });
  const bySubjectItem = bySubject.items[0]!;

  assertFullRelatedSettlementListItem(bySubjectItem);
  assert.deepEqual(referenceFindCalls, {
    talents: 1,
    rules: 1,
    revenueEntries: 1,
  });
  assert.deepEqual(
    CommissionAdminSettlementBySubjectTalentListExposure.expose(
      bySubjectItem,
    ),
    {
      id: "settlement-related-1",
      settlementCode: "CS-RELATED-1",
      title: "Related settlement",
      sourceRuleId: "rule-1",
      settlementKindSnapshot: "REVENUE_SHARE",
      beneficiaryKindSnapshot: "TALENT",
      beneficiaryEmploymentProfileIdSnapshot: null,
      beneficiaryTalentIdSnapshot: "talent-1",
      subjectTalentId: "talent-1",
      revenueEntryIds: [
        "revenue-2",
        "missing-revenue",
        "revenue-1",
      ],
      beneficiaryRef: {
        id: "talent-1",
        code: "TAL-1",
        name: "Luna",
        status: "ACTIVE",
      },
      sourceRuleRef: {
        id: "rule-1",
        code: "CRULE-1",
        title: "Rule 1",
        status: "ACTIVE",
      },
      revenueEntryRefs: [
        {
          id: "revenue-2",
          code: "REV-2",
          title: "Revenue 2",
          status: "FINALIZED",
        },
        { id: "missing-revenue" },
        {
          id: "revenue-1",
          code: "REV-1",
          title: "Revenue 1",
          status: "FINALIZED",
        },
      ],
      settlementCurrencyCode: "USD",
      grossRevenueAmount: 400,
      settlementAmount: 50,
      status: "FINALIZED",
      settlementPeriodStartAt: 1000,
      settlementPeriodEndAt: 2000,
      finalizedAt: 2500,
      createdAt: 900,
    },
  );

  const byRevenueEntry =
    await repository.listCommissionSettlementsByRevenueEntry({
      revenueEntryId: "revenue-2",
      limit: 10,
    });
  const byRevenueEntryItem = byRevenueEntry.items[0]!;

  assertFullRelatedSettlementListItem(byRevenueEntryItem);
  assert.deepEqual(referenceFindCalls, {
    talents: 2,
    rules: 2,
    revenueEntries: 2,
  });
  assert.equal(
    CommissionAdminSettlementByRevenueEntryListExposure.expose(
      byRevenueEntryItem,
    ).sourceRuleId,
    "rule-1",
  );

  const byBeneficiary =
    await repository.listCommissionSettlementsByBeneficiary({
      beneficiaryKindSnapshot: "TALENT",
      beneficiaryEmploymentProfileIdSnapshot: null,
      beneficiaryTalentIdSnapshot: "talent-1",
      limit: 10,
    });
  const byBeneficiaryItem = byBeneficiary.items[0]!;

  assertFullRelatedSettlementListItem(byBeneficiaryItem);
  assert.deepEqual(referenceFindCalls, {
    talents: 3,
    rules: 3,
    revenueEntries: 3,
  });
  assert.equal(
    CommissionAdminSettlementByBeneficiaryListExposure.expose(
      byBeneficiaryItem,
    ).sourceRuleId,
    "rule-1",
  );
});

function assertFullRelatedSettlementListItem(input: {
  readonly sourceRuleId?: string;
  readonly settlementKindSnapshot?: string;
  readonly beneficiaryKindSnapshot?: string;
  readonly beneficiaryEmploymentProfileIdSnapshot?: string | null;
  readonly beneficiaryTalentIdSnapshot?: string | null;
  readonly subjectTalentId?: string;
  readonly revenueEntryIds?: readonly string[];
  readonly beneficiaryRef?: unknown;
  readonly sourceRuleRef?: unknown;
  readonly revenueEntryRefs?: readonly unknown[];
  readonly grossRevenueAmount?: number;
  readonly finalizedAt?: number | null;
  readonly createdAt?: number;
  readonly revenueEntryRef?: unknown;
}): void {
  assert.equal(input.sourceRuleId, "rule-1");
  assert.equal(input.settlementKindSnapshot, "REVENUE_SHARE");
  assert.equal(input.beneficiaryKindSnapshot, "TALENT");
  assert.equal(
    input.beneficiaryEmploymentProfileIdSnapshot,
    null,
  );
  assert.equal(
    input.beneficiaryTalentIdSnapshot,
    "talent-1",
  );
  assert.equal(input.subjectTalentId, "talent-1");
  assert.deepEqual(input.revenueEntryIds, [
    "revenue-2",
    "missing-revenue",
    "revenue-1",
  ]);
  assert.deepEqual(input.beneficiaryRef, {
    id: "talent-1",
    code: "TAL-1",
    name: "Luna",
    status: "ACTIVE",
  });
  assert.deepEqual(input.sourceRuleRef, {
    id: "rule-1",
    code: "CRULE-1",
    title: "Rule 1",
    status: "ACTIVE",
  });
  assert.deepEqual(input.revenueEntryRefs, [
    {
      id: "revenue-2",
      code: "REV-2",
      title: "Revenue 2",
      status: "FINALIZED",
    },
    { id: "missing-revenue" },
    {
      id: "revenue-1",
      code: "REV-1",
      title: "Revenue 1",
      status: "FINALIZED",
    },
  ]);
  assert.equal(input.grossRevenueAmount, 400);
  assert.equal(input.finalizedAt, 2500);
  assert.equal(input.createdAt, 900);
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      input,
      "revenueEntryRef",
    ),
    false,
  );
}
