import assert from "node:assert/strict";
import { test } from "node:test";
import { MongoServerError, type ClientSession } from "mongodb";
import type { Request } from "express";
import { bindCommand } from "@app/base/command.middleware";
import { Actor } from "@core/actor/actor";
import type {
  AuthoritativeAdminMutationBridge,
  AuthoritativeMutationControls,
} from "@core/application/authoritative-admin-mutation.bridge";
import type { AuditGuard } from "@core/audit/audit.guard";
import type {
  BusinessCodePolicy,
  BusinessCodeSequenceRepository,
} from "@core/business-code/business-code-sequence.repository";
import { parseGeneratedBusinessCodeSequence } from "@core/business-code/business-code-sequence.repository";
import { Permission } from "@core/permission/permission.enum";
import { bindTraceId } from "@core/trace/trace.context";
import { COMMISSION_RULE_UNIQ_CODE_INDEX_NAME, COMMISSION_SETTLEMENT_UNIQ_CODE_INDEX_NAME } from "@infra/mongo/commission/commission.index";
import { CommissionAdminController } from "@modules/commission/admin/admin.commission.controller";
import { CommissionAdminService } from "@modules/commission/admin/admin.commission.service";
import { CommissionConflictError, CommissionValidationError } from "@modules/commission/domain/commission.errors";
import type {
  CommissionBeneficiaryKind,
  CommissionRule,
  CommissionRuleStatus,
  CommissionSettlement,
  CommissionSettlementLine,
  CommissionSettlementStatus,
} from "@modules/commission/domain/commission.types";
import {
  CommissionAdminRuleMutationExposure,
  CommissionAdminSettlementMutationExposure,
} from "@modules/commission/shared/commission.exposure";

const mutationBridge: AuthoritativeAdminMutationBridge = {
  async execute(_params, mutate) {
    const controls: AuthoritativeMutationControls = {
      markAuthSecurityTruthChanged() {},
      markExplicitNoOpSuccess() {},
    };
    return mutate({} as ClientSession, controls);
  },
};

const audit = {
  async record() {},
} as unknown as AuditGuard;

const logger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
} as never;

class MemoryBusinessCodeSequenceRepository
  implements BusinessCodeSequenceRepository
{
  readonly values = new Map<string, number>();

  async allocateNext(
    moduleKey: string,
    bucket: string,
  ): Promise<number> {
    const key = `${moduleKey}:${bucket}`;
    const next = (this.values.get(key) ?? 0) + 1;
    this.values.set(key, next);
    return next;
  }

  async ensureAtLeast(
    moduleKey: string,
    bucket: string,
    minimumValue: number,
  ): Promise<void> {
    const key = `${moduleKey}:${bucket}`;
    const current = this.values.get(key) ?? 0;

    if (minimumValue > current) {
      this.values.set(key, minimumValue);
    }
  }
}

class CommissionControllerHarness extends CommissionAdminController {
  async invoke(req: Request, actor: Actor): Promise<unknown> {
    return this.handle(req, actor, "ADMIN");
  }
}

test("Phase 2C commission modules generate, trim, preserve, retry, and keep business codes immutable", async () => {
  await bindTraceId("trace-phase-2c", async () => {
    const actor = createActor();
    const repo = new MemoryCommissionRepository();
    const service = createService(repo);

    const omittedRule = await service.createCommissionRule(
      actor,
      createRuleCommand(undefined, "omitted"),
    );
    const nullRule = await service.createCommissionRule(
      actor,
      createRuleCommand(null, "null"),
    );
    const blankRule = await service.createCommissionRule(
      actor,
      createRuleCommand("   ", "blank"),
    );
    const customRule = await service.createCommissionRule(
      actor,
      createRuleCommand("  RULE-CUSTOM  ", "custom"),
    );

    assert.equal(omittedRule.ruleCode, "CRULE-000001");
    assert.equal(nullRule.ruleCode, "CRULE-000002");
    assert.equal(blankRule.ruleCode, "CRULE-000003");
    assert.equal(customRule.ruleCode, "RULE-CUSTOM");
    assert.equal(customRule.externalRef, "RULE-CUSTOM-REF");

    await assert.rejects(
      service.createCommissionRule(
        actor,
        createRuleCommand("RULE-CUSTOM", "duplicate"),
      ),
      CommissionConflictError,
    );

    repo.failGeneratedRuleInserts(1);
    const retriedRule = await service.createCommissionRule(
      actor,
      createRuleCommand(undefined, "retry"),
    );
    assert.equal(retriedRule.ruleCode, "CRULE-000005");

    repo.failGeneratedRuleInserts(5);
    await assert.rejects(
      service.createCommissionRule(
        actor,
        createRuleCommand(undefined, "retry-exhausted"),
      ),
      CommissionConflictError,
    );

    const updatedRule =
      await service.updateCommissionRuleDraftCore(actor, {
        commissionRuleId: retriedRule.id,
        effectiveStartDate: Date.UTC(2024, 0, 2),
        effectiveEndDate: Date.UTC(2024, 11, 30),
      });
    assert.equal(updatedRule.ruleCode, retriedRule.ruleCode);
    assert.equal(
      updatedRule.effectiveStartDate,
      Date.UTC(2024, 0, 2),
    );
    assert.equal(
      updatedRule.effectiveEndDate,
      Date.UTC(2024, 11, 30),
    );

    const exposedRule =
      CommissionAdminRuleMutationExposure.expose(
        retriedRule,
      );
    assert.equal(exposedRule.ruleCode, "CRULE-000005");

    repo.seedRule(createActiveSettlementRule());

    const omittedSettlement =
      await service.createCommissionSettlement(
        actor,
        createSettlementCommand(undefined, "omitted", [
          "rev-1",
        ]),
      );
    const nullSettlement =
      await service.createCommissionSettlement(
        actor,
        createSettlementCommand(null, "null", ["rev-2"]),
      );
    const blankSettlement =
      await service.createCommissionSettlement(
        actor,
        createSettlementCommand("   ", "blank", [
          "rev-3",
        ]),
      );
    const customSettlement =
      await service.createCommissionSettlement(
        actor,
        createSettlementCommand(
          "  SETTLEMENT-CUSTOM  ",
          "custom",
          ["rev-4"],
        ),
      );

    assert.equal(
      omittedSettlement.settlementCode,
      "CS-202402-000001",
    );
    assert.equal(
      nullSettlement.settlementCode,
      "CS-202402-000002",
    );
    assert.equal(
      blankSettlement.settlementCode,
      "CS-202402-000003",
    );
    assert.equal(
      customSettlement.settlementCode,
      "SETTLEMENT-CUSTOM",
    );
    assert.equal(
      customSettlement.externalRef,
      "SETTLEMENT-CUSTOM-REF",
    );

    await assert.rejects(
      service.createCommissionSettlement(
        actor,
        createSettlementCommand(
          "SETTLEMENT-CUSTOM",
          "duplicate",
          ["rev-5"],
        ),
      ),
      CommissionConflictError,
    );

    repo.failGeneratedSettlementInserts(1);
    const retriedSettlement =
      await service.createCommissionSettlement(
        actor,
        createSettlementCommand(undefined, "retry", [
          "rev-6",
        ]),
      );
    assert.equal(
      retriedSettlement.settlementCode,
      "CS-202402-000005",
    );

    repo.failGeneratedSettlementInserts(5);
    await assert.rejects(
      service.createCommissionSettlement(
        actor,
        createSettlementCommand(
          undefined,
          "retry-exhausted",
          ["rev-7"],
        ),
      ),
      CommissionConflictError,
    );

    const periodShifted =
      await service.updateCommissionSettlementDraftCore(
        actor,
        {
          commissionSettlementId: omittedSettlement.id,
          settlementPeriodStartAt: Date.UTC(2024, 2, 1),
          settlementPeriodEndAt: Date.UTC(2024, 2, 3),
        },
      );
    assert.equal(
      periodShifted.settlementCode,
      omittedSettlement.settlementCode,
    );
    assert.equal(
      periodShifted.settlementPeriodStartAt,
      Date.UTC(2024, 2, 1),
    );

    const exposedSettlement =
      CommissionAdminSettlementMutationExposure.expose(
        retriedSettlement,
      );
    assert.equal(
      exposedSettlement.settlementCode,
      "CS-202402-000005",
    );
  });
});

test("Phase 2C settlement code bucket uses settlementPeriodStartAt UTC month and keeps derived settlement state backend-owned", async () => {
  await bindTraceId("trace-phase-2c-derived", async () => {
    const actor = createActor();
    const repo = new MemoryCommissionRepository();
    repo.seedRule(createActiveSettlementRule());
    const service = createService(repo);

    const created = await service.createCommissionSettlement(
      actor,
      {
        ...createSettlementCommand(undefined, "derived", [
          "rev-1",
        ]),
        settlementPeriodStartAt: Date.UTC(
          2024,
          1,
          29,
          23,
          30,
        ),
        settlementPeriodEndAt: Date.UTC(
          2024,
          2,
          2,
        ),
      },
    );

    assert.equal(created.settlementCode, "CS-202402-000001");
    assert.deepEqual(created.revenueEntryIds, ["rev-1"]);
    assert.equal(created.sourceRuleId, "rule-active");
    assert.equal(
      created.sourceContractRecordIdSnapshot,
      "contract-1",
    );
    assert.equal(
      created.beneficiaryEmploymentProfileIdSnapshot,
      "ep-1",
    );
    assert.equal(created.settlementCurrencyCode, "USD");
    assert.equal(created.grossRevenueAmount, 100);
    assert.equal(created.settlementAmount, 10);

    const initialLines =
      await repo.listSettlementLinesBySettlementId(created.id);
    assert.deepEqual(initialLines, [
      {
        id: initialLines[0]?.id,
        settlementId: created.id,
        revenueEntryId: "rev-1",
        revenueEntryCodeSnapshot: "REV-1",
        revenueKindSnapshot: "PLATFORM_CONTENT",
        revenueCurrencyCodeSnapshot: "USD",
        revenueRecognizedAmountSnapshot: 100,
        revenueRecognizedAtSnapshot: Date.UTC(
          2024,
          2,
          1,
          12,
        ),
        lineSettlementAmount: 10,
        createdAt: initialLines[0]?.createdAt,
        updatedAt: initialLines[0]?.updatedAt,
      },
    ]);

    const replaced =
      await service.replaceCommissionSettlementRevenueEntries(
        actor,
        {
          commissionSettlementId: created.id,
          revenueEntryIds: ["rev-2"],
        },
      );
    assert.deepEqual(replaced.revenueEntryIds, ["rev-2"]);
    assert.equal(replaced.grossRevenueAmount, 50);
    assert.equal(replaced.settlementAmount, 5);
    assert.equal(
      replaced.settlementCode,
      created.settlementCode,
    );

    const replacedLines =
      await repo.listSettlementLinesBySettlementId(created.id);
    assert.equal(replacedLines.length, 1);
    assert.equal(
      replacedLines[0]?.revenueEntryCodeSnapshot,
      "REV-2",
    );
    assert.equal(
      replacedLines[0]?.revenueRecognizedAmountSnapshot,
      50,
    );
    assert.equal(
      replacedLines[0]?.lineSettlementAmount,
      5,
    );
  });
});

test("Phase 2C commission controllers keep business codes immutable and derived settlement fields read-only", async () => {
  const controller = new CommissionControllerHarness({
    updateCommissionRuleDraftCore: async () => {
      throw new Error("service should not be called");
    },
    updateCommissionSettlementDraftCore: async () => {
      throw new Error("service should not be called");
    },
    createCommissionSettlement: async () => {
      throw new Error("service should not be called");
    },
  } as never);
  const actor = createActor();

  async function assertRejected(params: {
    readonly command: string;
    readonly body: Record<string, unknown>;
    readonly params?: Record<string, string>;
  }): Promise<void> {
    const req = {
      body: params.body,
      params: params.params ?? {},
      query: {},
    } as unknown as Request;
    bindCommand(req, params.command);

    await assert.rejects(
      controller.invoke(req, actor),
      CommissionValidationError,
    );
  }

  await assertRejected({
    command: "COMMISSION_RULE_UPDATE_DRAFT_CORE",
    params: { commissionRuleId: "rule-1" },
    body: {
      title: "Updated",
      ruleCode: "RULE-NEW",
    },
  });
  await assertRejected({
    command: "COMMISSION_SETTLEMENT_UPDATE_DRAFT_CORE",
    params: { commissionSettlementId: "settlement-1" },
    body: {
      title: "Updated",
      settlementCode: "SETTLEMENT-NEW",
    },
  });
  await assertRejected({
    command: "COMMISSION_SETTLEMENT_CREATE",
    body: {
      ...createSettlementCommand(undefined, "readonly", [
        "rev-1",
      ]),
      grossRevenueAmount: 999,
      settlementAmount: 999,
      settlementCurrencyCode: "EUR",
      subjectTalentId: "talent-overridden",
    },
  });
});

test("Phase 2C commission code unique indexes remain declared", () => {
  assert.equal(
    COMMISSION_RULE_UNIQ_CODE_INDEX_NAME,
    "uniq_commission_rule_rule_code",
  );
  assert.equal(
    COMMISSION_SETTLEMENT_UNIQ_CODE_INDEX_NAME,
    "uniq_commission_settlement_settlement_code",
  );
});

function createService(
  repo: MemoryCommissionRepository,
): CommissionAdminService {
  return new CommissionAdminService(
    repo as never,
    new MemoryBusinessCodeSequenceRepository(),
    {
      async findById() {
        return {
          id: "ep-1",
          employmentStatus: "ACTIVE",
        };
      },
    } as never,
    {
      async findById(talentId: string) {
        return {
          id: talentId,
          operationalStatus: "ACTIVE",
        };
      },
    } as never,
    {
      async findById() {
        return {
          id: "contract-1",
          contractKind: "EMPLOYMENT",
          linkedEntityKind: "EMPLOYMENT_PROFILE",
          linkedEmploymentProfileId: "ep-1",
          linkedTalentId: null,
          status: "ACTIVE",
          effectiveStartDate: Date.UTC(2024, 0, 1),
          effectiveEndDate: Date.UTC(2024, 11, 31),
        };
      },
    } as never,
    {
      async findByIds(ids: readonly string[]) {
        return ids.map((id) => revenueEntryById(id));
      },
    } as never,
    audit,
    mutationBridge,
    logger,
  );
}

function createActor(): Actor {
  return new Actor({
    id: "admin-user-1",
    type: "admin",
    context: "ADMIN",
    roles: [],
    permissions: [
      Permission.COMMISSION_RULE_CREATE,
      Permission.COMMISSION_RULE_UPDATE,
      Permission.COMMISSION_SETTLEMENT_CREATE,
      Permission.COMMISSION_SETTLEMENT_UPDATE,
    ],
    scopeGrants: {
      commission: ["global"],
    },
    accountContexts: ["ADMIN_CONSOLE"],
    isActive: true,
  });
}

function createRuleCommand(
  ruleCode: string | null | undefined,
  suffix: string,
) {
  return {
    ruleCode,
    title: `Rule ${suffix}`,
    settlementKind: "COMMISSION",
    beneficiaryKind: "EMPLOYMENT_PROFILE",
    beneficiaryEmploymentProfileId: "ep-1",
    beneficiaryTalentId: null,
    sourceContractRecordId: "contract-1",
    settlementBasis: "RECOGNIZED_GROSS_REVENUE",
    ratePercent: 10,
    appliesToRevenueKinds: ["PLATFORM_CONTENT"],
    effectiveStartDate: Date.UTC(2024, 0, 1),
    effectiveEndDate: Date.UTC(2024, 11, 31),
    description: null,
    externalRef:
      suffix === "custom" ? "RULE-CUSTOM-REF" : null,
  };
}

function createSettlementCommand(
  settlementCode: string | null | undefined,
  suffix: string,
  revenueEntryIds: readonly string[],
) {
  return {
    settlementCode,
    title: `Settlement ${suffix}`,
    sourceRuleId: "rule-active",
    settlementPeriodStartAt: Date.UTC(
      2024,
      1,
      29,
      23,
      30,
    ),
    settlementPeriodEndAt: Date.UTC(2024, 2, 2),
    revenueEntryIds,
    description: null,
    externalRef:
      suffix === "custom"
        ? "SETTLEMENT-CUSTOM-REF"
        : null,
  };
}

function createActiveSettlementRule(): CommissionRule {
  return {
    id: "rule-active",
    ruleCode: "CRULE-ACTIVE",
    title: "Active rule",
    normalizedTitle: "active rule",
    settlementKind: "COMMISSION",
    beneficiaryKind: "EMPLOYMENT_PROFILE",
    beneficiaryEmploymentProfileId: "ep-1",
    beneficiaryTalentId: null,
    sourceContractRecordId: "contract-1",
    settlementBasis: "RECOGNIZED_GROSS_REVENUE",
    ratePercent: 10,
    appliesToRevenueKinds: ["PLATFORM_CONTENT"],
    status: "ACTIVE",
    effectiveStartDate: Date.UTC(2024, 0, 1),
    effectiveEndDate: Date.UTC(2024, 11, 31),
    description: null,
    externalRef: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

function revenueEntryById(id: string) {
  const amountById = new Map([
    ["rev-1", 100],
    ["rev-2", 50],
    ["rev-3", 75],
    ["rev-4", 125],
    ["rev-5", 150],
    ["rev-6", 175],
    ["rev-7", 200],
  ]);
  const amount = amountById.get(id);

  if (amount === undefined) {
    throw new Error(`Unknown revenue entry id ${id}`);
  }

  return {
    id,
    revenueEntryCode: id.toUpperCase(),
    status: "FINALIZED" as const,
    subjectTalentId: "talent-1",
    revenueKind: "PLATFORM_CONTENT" as const,
    currencyCode: "USD",
    recognizedAmount: amount,
    recognizedAt: Date.UTC(2024, 2, 1, 12),
  };
}

function duplicateKey(): MongoServerError {
  return new MongoServerError({
    message: "duplicate key",
    code: 11000,
  });
}

function maxGenerated(
  records: readonly string[],
  policy: Pick<BusinessCodePolicy, "prefix" | "width">,
): number {
  return records.reduce((max, code) => {
    const sequence =
      parseGeneratedBusinessCodeSequence(code, policy);
    return sequence === null
      ? max
      : Math.max(max, sequence);
  }, 0);
}

class MemoryCommissionRepository {
  readonly rules: CommissionRule[] = [];
  readonly settlements: CommissionSettlement[] = [];
  readonly lines: CommissionSettlementLine[] = [];
  private generatedRuleInsertFailures = 0;
  private generatedSettlementInsertFailures = 0;

  seedRule(rule: CommissionRule): void {
    this.rules.push(rule);
  }

  failGeneratedRuleInserts(count: number): void {
    this.generatedRuleInsertFailures = count;
  }

  failGeneratedSettlementInserts(count: number): void {
    this.generatedSettlementInsertFailures = count;
  }

  async insertRule(rule: CommissionRule): Promise<CommissionRule> {
    if (
      /^CRULE-\d{6}$/u.test(rule.ruleCode) &&
      this.generatedRuleInsertFailures > 0
    ) {
      this.generatedRuleInsertFailures -= 1;
      throw duplicateKey();
    }

    if (
      this.rules.some(
        (item) => item.ruleCode === rule.ruleCode,
      )
    ) {
      throw duplicateKey();
    }

    this.rules.push(rule);
    return rule;
  }

  async findRuleById(id: string): Promise<CommissionRule | null> {
    return this.rules.find((item) => item.id === id) ?? null;
  }

  async findRuleByRuleCode(
    ruleCode: string,
  ): Promise<CommissionRule | null> {
    return (
      this.rules.find((item) => item.ruleCode === ruleCode) ??
      null
    );
  }

  async findMaxGeneratedRuleCodeSequence(
    policy: Pick<BusinessCodePolicy, "prefix" | "width">,
  ): Promise<number> {
    return maxGenerated(
      this.rules.map((item) => item.ruleCode),
      policy,
    );
  }

  async updateRuleDraftCore(input: {
    readonly commissionRuleId: string;
    readonly effectiveStartDate?: number;
    readonly effectiveEndDate?: number | null;
    readonly updatedAt: number;
  }): Promise<CommissionRule | null> {
    const rule = await this.findRuleById(
      input.commissionRuleId,
    );

    if (!rule) {
      return null;
    }

    Object.assign(rule, {
      effectiveStartDate:
        input.effectiveStartDate ??
        rule.effectiveStartDate,
      effectiveEndDate:
        input.effectiveEndDate === undefined
          ? rule.effectiveEndDate
          : input.effectiveEndDate,
      updatedAt: input.updatedAt,
    });
    return rule;
  }

  async transitionRuleStatus(input: {
    readonly commissionRuleId: string;
    readonly fromStatuses: readonly CommissionRuleStatus[];
    readonly toStatus: CommissionRuleStatus;
    readonly updatedAt: number;
  }): Promise<CommissionRule | null> {
    const rule = await this.findRuleById(
      input.commissionRuleId,
    );

    if (!rule || !input.fromStatuses.includes(rule.status)) {
      return null;
    }

    Object.assign(rule, {
      status: input.toStatus,
      updatedAt: input.updatedAt,
    });
    return rule;
  }

  async insertSettlement(
    settlement: CommissionSettlement,
  ): Promise<CommissionSettlement> {
    if (
      /^CS-\d{6}-\d{6}$/u.test(
        settlement.settlementCode,
      ) &&
      this.generatedSettlementInsertFailures > 0
    ) {
      this.generatedSettlementInsertFailures -= 1;
      throw duplicateKey();
    }

    if (
      this.settlements.some(
        (item) =>
          item.settlementCode ===
          settlement.settlementCode,
      )
    ) {
      throw duplicateKey();
    }

    this.settlements.push(settlement);
    return settlement;
  }

  async findSettlementById(
    id: string,
  ): Promise<CommissionSettlement | null> {
    return (
      this.settlements.find((item) => item.id === id) ??
      null
    );
  }

  async findSettlementBySettlementCode(
    settlementCode: string,
  ): Promise<CommissionSettlement | null> {
    return (
      this.settlements.find(
        (item) =>
          item.settlementCode === settlementCode,
      ) ?? null
    );
  }

  async findMaxGeneratedSettlementCodeSequence(
    policy: Pick<BusinessCodePolicy, "prefix" | "width">,
  ): Promise<number> {
    return maxGenerated(
      this.settlements.map(
        (item) => item.settlementCode,
      ),
      policy,
    );
  }

  async updateSettlementDraftCore(input: {
    readonly commissionSettlementId: string;
    readonly settlementPeriodStartAt?: number;
    readonly settlementPeriodEndAt?: number;
    readonly updatedAt: number;
  }): Promise<CommissionSettlement | null> {
    const settlement = await this.findSettlementById(
      input.commissionSettlementId,
    );

    if (!settlement) {
      return null;
    }

    Object.assign(settlement, {
      settlementPeriodStartAt:
        input.settlementPeriodStartAt ??
        settlement.settlementPeriodStartAt,
      settlementPeriodEndAt:
        input.settlementPeriodEndAt ??
        settlement.settlementPeriodEndAt,
      updatedAt: input.updatedAt,
    });
    return settlement;
  }

  async updateSettlementDraftDerived(input: {
    readonly commissionSettlementId: string;
    readonly revenueEntryIds: readonly string[];
    readonly subjectTalentId: string;
    readonly settlementCurrencyCode: string;
    readonly grossRevenueAmount: number;
    readonly settlementAmount: number;
    readonly updatedAt: number;
  }): Promise<CommissionSettlement | null> {
    const settlement = await this.findSettlementById(
      input.commissionSettlementId,
    );

    if (!settlement) {
      return null;
    }

    Object.assign(settlement, {
      revenueEntryIds: [...input.revenueEntryIds],
      subjectTalentId: input.subjectTalentId,
      settlementCurrencyCode:
        input.settlementCurrencyCode,
      grossRevenueAmount: input.grossRevenueAmount,
      settlementAmount: input.settlementAmount,
      updatedAt: input.updatedAt,
    });
    return settlement;
  }

  async touchSettlementDraft(input: {
    readonly commissionSettlementId: string;
    readonly updatedAt: number;
  }): Promise<CommissionSettlement | null> {
    const settlement = await this.findSettlementById(
      input.commissionSettlementId,
    );

    if (!settlement) {
      return null;
    }

    Object.assign(settlement, {
      updatedAt: input.updatedAt,
    });
    return settlement;
  }

  async transitionSettlementStatus(input: {
    readonly commissionSettlementId: string;
    readonly fromStatuses: readonly CommissionSettlementStatus[];
    readonly toStatus: CommissionSettlementStatus;
    readonly finalizedAt?: number | null;
    readonly voidedAt?: number | null;
    readonly updatedAt: number;
  }): Promise<CommissionSettlement | null> {
    const settlement = await this.findSettlementById(
      input.commissionSettlementId,
    );

    if (
      !settlement ||
      !input.fromStatuses.includes(settlement.status)
    ) {
      return null;
    }

    Object.assign(settlement, {
      status: input.toStatus,
      finalizedAt:
        input.finalizedAt === undefined
          ? settlement.finalizedAt
          : input.finalizedAt,
      voidedAt:
        input.voidedAt === undefined
          ? settlement.voidedAt
          : input.voidedAt,
      updatedAt: input.updatedAt,
    });
    return settlement;
  }

  async insertSettlementLines(
    lines: readonly CommissionSettlementLine[],
  ): Promise<readonly CommissionSettlementLine[]> {
    this.lines.push(...lines);
    return lines;
  }

  async listSettlementLinesBySettlementId(
    settlementId: string,
  ): Promise<readonly CommissionSettlementLine[]> {
    return this.lines.filter(
      (line) => line.settlementId === settlementId,
    );
  }

  async deleteSettlementLinesBySettlementId(
    settlementId: string,
  ): Promise<void> {
    for (let index = this.lines.length - 1; index >= 0; index -= 1) {
      if (this.lines[index]?.settlementId === settlementId) {
        this.lines.splice(index, 1);
      }
    }
  }

  async findSettlementExclusivityConflict(input: {
    readonly beneficiaryKindSnapshot: CommissionBeneficiaryKind;
    readonly beneficiaryEmploymentProfileIdSnapshot: string | null;
    readonly beneficiaryTalentIdSnapshot: string | null;
    readonly revenueEntryIds: readonly string[];
    readonly excludeCommissionSettlementId?: string;
  }): Promise<{
    readonly settlementId: string;
    readonly conflictingRevenueEntryId: string;
  } | null> {
    const probed = new Set(input.revenueEntryIds);
    const settlement = this.settlements.find((item) => {
      if (
        item.id ===
        input.excludeCommissionSettlementId
      ) {
        return false;
      }

      if (
        item.status === "VOIDED" ||
        item.status === "ARCHIVED"
      ) {
        return false;
      }

      return (
        item.beneficiaryKindSnapshot ===
          input.beneficiaryKindSnapshot &&
        item.beneficiaryEmploymentProfileIdSnapshot ===
          input.beneficiaryEmploymentProfileIdSnapshot &&
        item.beneficiaryTalentIdSnapshot ===
          input.beneficiaryTalentIdSnapshot &&
        item.revenueEntryIds.some((id) => probed.has(id))
      );
    });

    if (!settlement) {
      return null;
    }

    const conflictingRevenueEntryId =
      settlement.revenueEntryIds.find((id) =>
        probed.has(id),
      );

    return conflictingRevenueEntryId
      ? {
          settlementId: settlement.id,
          conflictingRevenueEntryId,
        }
      : null;
  }
}
