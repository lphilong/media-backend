import assert from "node:assert/strict";
import { test } from "node:test";
import { ClientSession } from "mongodb";
import { Actor } from "@core/actor/actor";
import { AuthoritativeAdminMutationBridge } from "@core/application/authoritative-admin-mutation.bridge";
import { AuditGuard } from "@core/audit/audit.guard";
import { BusinessCodeSequenceRepository } from "@core/business-code/business-code-sequence.repository";
import { Permission } from "@core/permission/permission.enum";
import { bindTraceId } from "@core/trace/trace.context";
import { PlatformEarningAdminService } from "@modules/revenue-ledger/admin/admin.platform-earning.service";
import {
  PlatformEarningBatch,
  PlatformEarningBatchListFilters,
  PlatformEarningBatchListPage,
  PlatformEarningLine,
  PlatformEarningLineListFilters,
  PlatformEarningLineListPage,
  PlatformEarningRepository,
} from "@modules/revenue-ledger/domain/platform-earning.repository";
import {
  RevenueLedgerConflictError,
  RevenueLedgerStateError,
  RevenueLedgerValidationError,
  RevenueLedgerPermissionScopeError,
} from "@modules/revenue-ledger/domain/revenue-ledger.errors";
import { RevenueEntryRepository } from "@modules/revenue-ledger/domain/revenue-ledger.repository";
import {
  PlatformEarningBatchStatus,
  RevenueEntry,
} from "@modules/revenue-ledger/domain/revenue-ledger.types";

const SESSION = {} as ClientSession;

test("RL-1 platform earning batch creates approved snapshots and links one summary Revenue Entry", async () => {
  const harness = createHarness();
  const submitter = createActor("submitter", [
    Permission.REVENUE_LEDGER_READ,
    Permission.REVENUE_LEDGER_CREATE,
    Permission.REVENUE_LEDGER_PLATFORM_EARNING_SUBMIT,
  ]);
  const finance = createActor("finance", [
    Permission.REVENUE_LEDGER_READ,
    Permission.REVENUE_LEDGER_CREATE,
    Permission.REVENUE_LEDGER_PLATFORM_EARNING_REVIEW,
    Permission.REVENUE_LEDGER_PLATFORM_EARNING_APPROVE,
  ]);

  const batch = await withTrace(() =>
    harness.service.createBatch(submitter, {
      platform: "tiktok",
      platformAccountId: "pa-1",
      talentGroupId: "tg-1",
      sourceType: "TIKTOK_LIVESTREAM_DIAMOND",
      periodMonth: "2026-06",
      sourceDateFrom: 1_770_000_000_000,
      sourceDateTo: 1_772_500_000_000,
    }),
  );

  const line = await withTrace(() =>
    harness.service.addLine(submitter, {
      batchId: batch.id,
      sourceDate: 1_770_000_000_000,
      memberTalentId: "talent-1",
      memberEmploymentProfileId: "emp-1",
      rawQuantity: 1000,
      externalSourceRef: "tiktok-row-1",
    }),
  );

  assert.equal(line.batchStatus, "DRAFT");
  await assert.rejects(
    withTrace(() =>
      harness.service.addLine(submitter, {
        batchId: batch.id,
        sourceDate: 1_770_000_000_000,
        memberTalentId: "talent-1",
        memberEmploymentProfileId: "emp-1",
        rawQuantity: 1000,
        externalSourceRef: "tiktok-row-1",
      }),
    ),
    RevenueLedgerConflictError,
  );

  const submitted = await withTrace(() =>
    harness.service.submitBatch(submitter, {
      batchId: batch.id,
    }),
  );
  assert.equal(submitted.status, "SUBMITTED");

  await withTrace(() =>
    harness.service.startReview(finance, {
      batchId: batch.id,
    }),
  );
  const approved = await withTrace(() =>
    harness.service.approveBatch(finance, {
      batchId: batch.id,
      targetCurrency: "VND",
      appliedRate: 500,
      platformCutRate: 0.6,
      companyShareRate: 0.4,
      sourceNote: "finance review snapshot",
    }),
  );

  assert.equal(approved.status, "APPROVED");
  assert.equal(
    approved.conversionSnapshot?.grossConvertedAmount,
    500000,
  );
  assert.equal(
    approved.platformCutSnapshot?.companyNetAmount,
    200000,
  );

  const entry = await withTrace(() =>
    harness.service.createRevenueEntry(finance, {
      batchId: batch.id,
    }),
  );

  assert.equal(entry.entrySource, "PLATFORM_EARNING_BATCH");
  assert.equal(entry.status, "DRAFT");
  assert.deepEqual(entry.sourceBatchIds, [batch.id]);
  assert.equal(entry.sourceLineCount, 1);
  assert.equal(entry.sourceSummarySnapshot?.sourceLineCount, 1);
  assert.equal(entry.recognizedAmount, 200000);
  assert.equal(entry.conversionSnapshot?.appliedRate, 500);
  assert.equal(
    entry.commissionableBasisSnapshot?.basisType,
    "COMPANY_NET",
  );

  const listed = await harness.service.listLines(finance, {
    status: "APPROVED",
    limit: 1,
  });
  assert.equal(listed.items.length, 1);
  assert.equal(listed.nextCursor, undefined);

  await assert.rejects(
    withTrace(() =>
      harness.service.createRevenueEntry(finance, {
        batchId: batch.id,
      }),
    ),
    RevenueLedgerConflictError,
  );
});

test("RL-1 source submitter cannot approve own submitted batch even with finance permission", async () => {
  const harness = createHarness();
  const actor = createActor("same-actor", [
    Permission.REVENUE_LEDGER_READ,
    Permission.REVENUE_LEDGER_PLATFORM_EARNING_SUBMIT,
    Permission.REVENUE_LEDGER_PLATFORM_EARNING_REVIEW,
    Permission.REVENUE_LEDGER_PLATFORM_EARNING_APPROVE,
  ]);
  const batch = await withTrace(() =>
    harness.service.createBatch(actor, {
      platform: "tiktok",
      platformAccountId: "pa-1",
      sourceType: "TIKTOK_LIVESTREAM_DIAMOND",
      periodMonth: "2026-06",
      sourceDateFrom: 1,
      sourceDateTo: 2,
    }),
  );
  await withTrace(() =>
    harness.service.addLine(actor, {
      batchId: batch.id,
      sourceDate: 1,
      memberTalentId: "talent-1",
      rawQuantity: 50,
      externalSourceRef: "own-row",
    }),
  );
  await withTrace(() =>
    harness.service.submitBatch(actor, {
      batchId: batch.id,
    }),
  );
  await withTrace(() =>
    harness.service.startReview(actor, {
      batchId: batch.id,
    }),
  );

  await assert.rejects(
    withTrace(() =>
      harness.service.approveBatch(actor, {
        batchId: batch.id,
        targetCurrency: "VND",
        appliedRate: 500,
        platformCutRate: 0.6,
        companyShareRate: 0.4,
      }),
    ),
    RevenueLedgerPermissionScopeError,
  );
});

test("RL-1R rejects batch source context update after source lines exist", async () => {
  const harness = createHarness();
  const submitter = createActor("submitter", [
    Permission.REVENUE_LEDGER_READ,
    Permission.REVENUE_LEDGER_PLATFORM_EARNING_SUBMIT,
  ]);
  const batch = await createDraftBatchWithLine(
    harness,
    submitter,
  );

  await assert.rejects(
    withTrace(() =>
      harness.service.updateBatch(submitter, {
        batchId: batch.id,
        platformAccountId: "pa-2",
      }),
    ),
    RevenueLedgerStateError,
  );
});

test("RL-1R rejects batch date range update after source lines exist", async () => {
  const harness = createHarness();
  const submitter = createActor("submitter", [
    Permission.REVENUE_LEDGER_READ,
    Permission.REVENUE_LEDGER_PLATFORM_EARNING_SUBMIT,
  ]);
  const batch = await createDraftBatchWithLine(
    harness,
    submitter,
  );

  await assert.rejects(
    withTrace(() =>
      harness.service.updateBatch(submitter, {
        batchId: batch.id,
        sourceDateTo: 1_770_000_000_100,
      }),
    ),
    RevenueLedgerStateError,
  );
});

test("RL-1R rejects invalid empty-batch date range update", async () => {
  const harness = createHarness();
  const submitter = createActor("submitter", [
    Permission.REVENUE_LEDGER_READ,
    Permission.REVENUE_LEDGER_PLATFORM_EARNING_SUBMIT,
  ]);
  const batch = await withTrace(() =>
    harness.service.createBatch(submitter, {
      platform: "tiktok",
      platformAccountId: "pa-1",
      sourceType: "TIKTOK_LIVESTREAM_DIAMOND",
      periodMonth: "2026-06",
      sourceDateFrom: 1_770_000_000_000,
      sourceDateTo: 1_772_500_000_000,
    }),
  );

  await assert.rejects(
    withTrace(() =>
      harness.service.updateBatch(submitter, {
        batchId: batch.id,
        sourceDateFrom: 1_773_000_000_000,
      }),
    ),
    RevenueLedgerValidationError,
  );
});

test("RL-1R rejects adding source line outside batch date range", async () => {
  const harness = createHarness();
  const submitter = createActor("submitter", [
    Permission.REVENUE_LEDGER_READ,
    Permission.REVENUE_LEDGER_PLATFORM_EARNING_SUBMIT,
  ]);
  const batch = await withTrace(() =>
    harness.service.createBatch(submitter, {
      platform: "tiktok",
      platformAccountId: "pa-1",
      sourceType: "TIKTOK_LIVESTREAM_DIAMOND",
      periodMonth: "2026-06",
      sourceDateFrom: 1_770_000_000_000,
      sourceDateTo: 1_772_500_000_000,
    }),
  );

  await assert.rejects(
    withTrace(() =>
      harness.service.addLine(submitter, {
        batchId: batch.id,
        sourceDate: 1_772_500_000_001,
        memberTalentId: "talent-1",
        rawQuantity: 50,
      }),
    ),
    RevenueLedgerValidationError,
  );
});

test("RL-1R rejects updating source line outside batch date range", async () => {
  const harness = createHarness();
  const submitter = createActor("submitter", [
    Permission.REVENUE_LEDGER_READ,
    Permission.REVENUE_LEDGER_PLATFORM_EARNING_SUBMIT,
  ]);
  const batch = await createDraftBatchWithLine(
    harness,
    submitter,
  );
  const [line] =
    await harness.platformRepository.findLinesByBatchId(
      batch.id,
    );

  await assert.rejects(
    withTrace(() =>
      harness.service.updateLine(submitter, {
        batchId: batch.id,
        lineId: line.id,
        sourceDate: 1_772_500_000_001,
      }),
    ),
    RevenueLedgerValidationError,
  );
});

test("RL-1R approval fails when persisted line context differs from batch", async () => {
  const harness = createHarness();
  const submitter = createActor("submitter", [
    Permission.REVENUE_LEDGER_READ,
    Permission.REVENUE_LEDGER_PLATFORM_EARNING_SUBMIT,
  ]);
  const finance = createActor("finance", [
    Permission.REVENUE_LEDGER_READ,
    Permission.REVENUE_LEDGER_PLATFORM_EARNING_REVIEW,
    Permission.REVENUE_LEDGER_PLATFORM_EARNING_APPROVE,
  ]);
  const batch = await createDraftBatchWithLine(
    harness,
    submitter,
  );
  await withTrace(() =>
    harness.service.submitBatch(submitter, {
      batchId: batch.id,
    }),
  );
  await withTrace(() =>
    harness.service.startReview(finance, {
      batchId: batch.id,
    }),
  );
  const [line] =
    await harness.platformRepository.findLinesByBatchId(
      batch.id,
    );
  harness.platformRepository.corruptLine(line.id, {
    platformAccountId: "pa-other",
  });

  await assert.rejects(
    withTrace(() =>
      harness.service.approveBatch(finance, {
        batchId: batch.id,
        targetCurrency: "VND",
        appliedRate: 500,
        platformCutRate: 0.6,
        companyShareRate: 0.4,
      }),
    ),
    RevenueLedgerStateError,
  );
  assert.equal(harness.revenueRepository.entries.size, 0);
});

test("RL-1R approval fails when persisted line date is outside batch range", async () => {
  const harness = createHarness();
  const submitter = createActor("submitter", [
    Permission.REVENUE_LEDGER_READ,
    Permission.REVENUE_LEDGER_PLATFORM_EARNING_SUBMIT,
  ]);
  const finance = createActor("finance", [
    Permission.REVENUE_LEDGER_READ,
    Permission.REVENUE_LEDGER_PLATFORM_EARNING_REVIEW,
    Permission.REVENUE_LEDGER_PLATFORM_EARNING_APPROVE,
  ]);
  const batch = await createDraftBatchWithLine(
    harness,
    submitter,
  );
  await withTrace(() =>
    harness.service.submitBatch(submitter, {
      batchId: batch.id,
    }),
  );
  await withTrace(() =>
    harness.service.startReview(finance, {
      batchId: batch.id,
    }),
  );
  const [line] =
    await harness.platformRepository.findLinesByBatchId(
      batch.id,
    );
  harness.platformRepository.corruptLine(line.id, {
    sourceDate: 1_772_500_000_001,
  });

  await assert.rejects(
    withTrace(() =>
      harness.service.approveBatch(finance, {
        batchId: batch.id,
        targetCurrency: "VND",
        appliedRate: 500,
        platformCutRate: 0.6,
        companyShareRate: 0.4,
      }),
    ),
    RevenueLedgerValidationError,
  );
  assert.equal(harness.revenueRepository.entries.size, 0);
});

test("RL-1R duplicate key cannot become stale from rejected context update", async () => {
  const harness = createHarness();
  const submitter = createActor("submitter", [
    Permission.REVENUE_LEDGER_READ,
    Permission.REVENUE_LEDGER_PLATFORM_EARNING_SUBMIT,
  ]);
  const batch = await createDraftBatchWithLine(
    harness,
    submitter,
  );

  await assert.rejects(
    withTrace(() =>
      harness.service.updateBatch(submitter, {
        batchId: batch.id,
        talentGroupId: "tg-2",
      }),
    ),
    RevenueLedgerStateError,
  );
  await assert.rejects(
    withTrace(() =>
      harness.service.addLine(submitter, {
        batchId: batch.id,
        sourceDate: 1_770_000_000_000,
        memberTalentId: "talent-1",
        memberEmploymentProfileId: "emp-1",
        rawQuantity: 1000,
        externalSourceRef: "source-row",
      }),
    ),
    RevenueLedgerConflictError,
  );
});

test("RL-1 unauthorized actor cannot approve platform earning batch", async () => {
  const harness = createHarness();
  const submitter = createActor("submitter", [
    Permission.REVENUE_LEDGER_READ,
    Permission.REVENUE_LEDGER_PLATFORM_EARNING_SUBMIT,
  ]);
  const reviewer = createActor("reviewer", [
    Permission.REVENUE_LEDGER_READ,
    Permission.REVENUE_LEDGER_PLATFORM_EARNING_REVIEW,
  ]);
  const batch = await withTrace(() =>
    harness.service.createBatch(submitter, {
      platform: "tiktok",
      platformAccountId: "pa-1",
      sourceType: "TIKTOK_LIVESTREAM_DIAMOND",
      periodMonth: "2026-06",
      sourceDateFrom: 1,
      sourceDateTo: 2,
    }),
  );
  await withTrace(() =>
    harness.service.addLine(submitter, {
      batchId: batch.id,
      sourceDate: 1,
      memberTalentId: "talent-1",
      rawQuantity: 50,
      externalSourceRef: "review-row",
    }),
  );
  await withTrace(() =>
    harness.service.submitBatch(submitter, {
      batchId: batch.id,
    }),
  );
  await withTrace(() =>
    harness.service.startReview(reviewer, {
      batchId: batch.id,
    }),
  );

  await assert.rejects(
    withTrace(() =>
      harness.service.approveBatch(reviewer, {
        batchId: batch.id,
        targetCurrency: "VND",
        appliedRate: 500,
        platformCutRate: 0.6,
        companyShareRate: 0.4,
      }),
    ),
    /Missing permission revenueLedger\.platformEarning\.approve/u,
  );
});

function createHarness(): {
  readonly service: PlatformEarningAdminService;
  readonly platformRepository: InMemoryPlatformEarningRepository;
  readonly revenueRepository: InMemoryRevenueEntryRepository;
} {
  const platformRepository =
    new InMemoryPlatformEarningRepository();
  const revenueRepository =
    new InMemoryRevenueEntryRepository();
  const service = new PlatformEarningAdminService(
    platformRepository,
    revenueRepository,
    new InMemoryBusinessCodeSequenceRepository(),
    {
      async findById(id: string) {
        return id === "talent-1"
          ? ({ id } as never)
          : null;
      },
    } as never,
    {
      async findById(id: string) {
        return id === "pa-1" ? ({ id } as never) : null;
      },
    } as never,
    {
      async findById() {
        return null;
      },
      async hasActiveTalentAssignment() {
        return false;
      },
    } as never,
    {
      async record() {
        return undefined;
      },
    } as unknown as AuditGuard,
    {
      async execute(_params, mutate) {
        return mutate(SESSION, {
          markAuthSecurityTruthChanged() {
            return undefined;
          },
          markExplicitNoOpSuccess() {
            return undefined;
          },
        });
      },
    } satisfies AuthoritativeAdminMutationBridge,
  );
  return {
    service,
    platformRepository,
    revenueRepository,
  };
}

async function createDraftBatchWithLine(
  harness: ReturnType<typeof createHarness>,
  actor: Actor,
): Promise<PlatformEarningBatch> {
  const batch = await withTrace(() =>
    harness.service.createBatch(actor, {
      platform: "tiktok",
      platformAccountId: "pa-1",
      talentGroupId: "tg-1",
      sourceType: "TIKTOK_LIVESTREAM_DIAMOND",
      periodMonth: "2026-06",
      sourceDateFrom: 1_770_000_000_000,
      sourceDateTo: 1_772_500_000_000,
    }),
  );
  await withTrace(() =>
    harness.service.addLine(actor, {
      batchId: batch.id,
      sourceDate: 1_770_000_000_000,
      memberTalentId: "talent-1",
      memberEmploymentProfileId: "emp-1",
      rawQuantity: 1000,
      externalSourceRef: "source-row",
    }),
  );
  return batch;
}

class InMemoryBusinessCodeSequenceRepository
  implements BusinessCodeSequenceRepository
{
  private readonly values = new Map<string, number>();

  async allocateNext(
    moduleKey: string,
    bucket: string,
  ): Promise<number> {
    const key = `${moduleKey}:${bucket}`;
    const next = (this.values.get(key) ?? 0) + 1;
    this.values.set(key, next);
    return next;
  }

  async ensureAtLeast(): Promise<void> {
    return undefined;
  }
}

class InMemoryRevenueEntryRepository
  implements RevenueEntryRepository
{
  readonly entries = new Map<string, RevenueEntry>();

  async insert(
    revenueEntry: RevenueEntry,
  ): Promise<RevenueEntry> {
    this.entries.set(revenueEntry.id, revenueEntry);
    return revenueEntry;
  }

  async findById(
    revenueEntryId: string,
  ): Promise<RevenueEntry | null> {
    return this.entries.get(revenueEntryId) ?? null;
  }

  async findByRevenueEntryCode(
    revenueEntryCode: string,
  ): Promise<RevenueEntry | null> {
    return (
      [...this.entries.values()].find(
        (entry) =>
          entry.revenueEntryCode === revenueEntryCode,
      ) ?? null
    );
  }

  async findMaxGeneratedRevenueEntryCodeSequence(): Promise<number> {
    return 0;
  }

  async updateDraftCore(): Promise<RevenueEntry | null> {
    return null;
  }

  async transitionStatus(): Promise<RevenueEntry | null> {
    return null;
  }
}

class InMemoryPlatformEarningRepository
  implements PlatformEarningRepository
{
  private readonly batches = new Map<
    string,
    PlatformEarningBatch
  >();
  private readonly lines = new Map<
    string,
    PlatformEarningLine
  >();

  async insertBatch(input: {
    readonly id: string;
    readonly batchCode: string;
    readonly platform: string;
    readonly platformAccountId: string;
    readonly talentGroupId: string | null;
    readonly sourceType: "TIKTOK_LIVESTREAM_DIAMOND";
    readonly sourceUnit: "DIAMOND";
    readonly periodMonth: string;
    readonly sourceDateFrom: number;
    readonly sourceDateTo: number;
    readonly createdByActorId: string;
    readonly createdAt: number;
  }): Promise<PlatformEarningBatch> {
    const batch: PlatformEarningBatch = {
      ...input,
      status: "DRAFT",
      sourceLineCount: 0,
      rawQuantityTotal: 0,
      conversionSnapshot: null,
      platformCutSnapshot: null,
      companyNetAmount: null,
      commissionableBasisAmount: null,
      submittedByActorId: null,
      submittedAt: null,
      reviewedByActorId: null,
      reviewedAt: null,
      approvedByActorId: null,
      approvedAt: null,
      rejectedByActorId: null,
      rejectedAt: null,
      rejectionReason: null,
      voidedByActorId: null,
      voidedAt: null,
      voidReason: null,
      archivedByActorId: null,
      archivedAt: null,
      sourceFingerprint: null,
      revenueEntryId: null,
      revenueEntryCreatedByActorId: null,
      revenueEntryCreatedAt: null,
      updatedAt: input.createdAt,
    };
    this.batches.set(batch.id, batch);
    return batch;
  }

  async findBatchById(
    batchId: string,
  ): Promise<PlatformEarningBatch | null> {
    return this.batches.get(batchId) ?? null;
  }

  async listBatches(
    filters: PlatformEarningBatchListFilters,
  ): Promise<PlatformEarningBatchListPage> {
    return page(
      [...this.batches.values()].filter((batch) =>
        !filters.status || batch.status === filters.status
          ? true
          : false,
      ),
      filters.limit,
    );
  }

  async updateDraftBatch(input: {
    readonly batchId: string;
    readonly platformAccountId?: string;
    readonly talentGroupId?: string | null;
    readonly sourceDateFrom?: number;
    readonly sourceDateTo?: number;
    readonly updatedAt: number;
  }): Promise<PlatformEarningBatch | null> {
    const batch = this.batches.get(input.batchId);
    if (!batch || batch.status !== "DRAFT") {
      return null;
    }
    const updated: PlatformEarningBatch = {
      ...batch,
      platformAccountId:
        input.platformAccountId ??
        batch.platformAccountId,
      talentGroupId:
        input.talentGroupId !== undefined
          ? input.talentGroupId
          : batch.talentGroupId,
      sourceDateFrom:
        input.sourceDateFrom ?? batch.sourceDateFrom,
      sourceDateTo:
        input.sourceDateTo ?? batch.sourceDateTo,
      updatedAt: input.updatedAt,
    };
    this.batches.set(updated.id, updated);
    return updated;
  }

  async transitionBatchStatus(input: {
    readonly batchId: string;
    readonly fromStatuses: readonly PlatformEarningBatchStatus[];
    readonly toStatus: PlatformEarningBatchStatus;
    readonly updatedAt: number;
    readonly [key: string]: unknown;
  }): Promise<PlatformEarningBatch | null> {
    const batch = this.batches.get(input.batchId);
    if (!batch || !input.fromStatuses.includes(batch.status)) {
      return null;
    }
    const updated = {
      ...batch,
      ...input,
      id: batch.id,
      status: input.toStatus,
    } as PlatformEarningBatch;
    this.batches.set(updated.id, updated);
    this.syncLineStatus(updated.id, updated.status);
    return updated;
  }

  async approveBatch(input: {
    readonly batchId: string;
    readonly conversionSnapshot: PlatformEarningBatch["conversionSnapshot"];
    readonly platformCutSnapshot: PlatformEarningBatch["platformCutSnapshot"];
    readonly companyNetAmount: number;
    readonly commissionableBasisAmount: number;
    readonly sourceFingerprint: string;
    readonly approvedByActorId: string;
    readonly approvedAt: number;
    readonly updatedAt: number;
  }): Promise<PlatformEarningBatch | null> {
    const batch = this.batches.get(input.batchId);
    if (!batch || batch.status !== "UNDER_REVIEW") {
      return null;
    }
    const updated: PlatformEarningBatch = {
      ...batch,
      ...input,
      status: "APPROVED",
    };
    this.batches.set(updated.id, updated);
    this.syncLineStatus(updated.id, "APPROVED");
    return updated;
  }

  async markRevenueEntryCreated(input: {
    readonly batchId: string;
    readonly revenueEntryId: string;
    readonly revenueEntryCreatedByActorId: string;
    readonly revenueEntryCreatedAt: number;
    readonly updatedAt: number;
  }): Promise<PlatformEarningBatch | null> {
    const batch = this.batches.get(input.batchId);
    if (!batch || batch.status !== "APPROVED" || batch.revenueEntryId) {
      return null;
    }
    const updated: PlatformEarningBatch = {
      ...batch,
      ...input,
    };
    this.batches.set(updated.id, updated);
    return updated;
  }

  async insertLine(
    line: PlatformEarningLine,
  ): Promise<PlatformEarningLine> {
    this.lines.set(line.id, line);
    this.recalculate(line.batchId);
    return line;
  }

  async findLineById(
    lineId: string,
  ): Promise<PlatformEarningLine | null> {
    return this.lines.get(lineId) ?? null;
  }

  async findLineByDuplicateDetectionKey(
    duplicateDetectionKey: string,
  ): Promise<PlatformEarningLine | null> {
    return (
      [...this.lines.values()].find(
        (line) =>
          line.duplicateDetectionKey ===
          duplicateDetectionKey,
      ) ?? null
    );
  }

  async updateDraftLine(input: {
    readonly lineId: string;
    readonly sourceDate?: number;
    readonly memberTalentId?: string | null;
    readonly memberEmploymentProfileId?: string | null;
    readonly eventId?: string | null;
    readonly rawQuantity?: number;
    readonly externalSourceRef?: string | null;
    readonly notes?: string | null;
    readonly duplicateDetectionKey?: string;
    readonly updatedAt: number;
  }): Promise<PlatformEarningLine | null> {
    const line = this.lines.get(input.lineId);
    if (!line || line.batchStatus !== "DRAFT") {
      return null;
    }
    const updated: PlatformEarningLine = {
      ...line,
      sourceDate: input.sourceDate ?? line.sourceDate,
      memberTalentId:
        input.memberTalentId !== undefined
          ? input.memberTalentId
          : line.memberTalentId,
      memberEmploymentProfileId:
        input.memberEmploymentProfileId !== undefined
          ? input.memberEmploymentProfileId
          : line.memberEmploymentProfileId,
      eventId:
        input.eventId !== undefined
          ? input.eventId
          : line.eventId,
      rawQuantity:
        input.rawQuantity ?? line.rawQuantity,
      externalSourceRef:
        input.externalSourceRef !== undefined
          ? input.externalSourceRef
          : line.externalSourceRef,
      notes:
        input.notes !== undefined
          ? input.notes
          : line.notes,
      duplicateDetectionKey:
        input.duplicateDetectionKey ??
        line.duplicateDetectionKey,
      updatedAt: input.updatedAt,
    };
    this.lines.set(updated.id, updated);
    this.recalculate(updated.batchId);
    return updated;
  }

  async listLines(
    filters: PlatformEarningLineListFilters,
  ): Promise<PlatformEarningLineListPage> {
    const items = [...this.lines.values()].filter(
      (line) =>
        (!filters.status ||
          line.batchStatus === filters.status) &&
        (!filters.batchId ||
          line.batchId === filters.batchId),
    );
    return page(items, filters.limit);
  }

  async findLinesByBatchId(
    batchId: string,
  ): Promise<readonly PlatformEarningLine[]> {
    return [...this.lines.values()].filter(
      (line) => line.batchId === batchId,
    );
  }

  corruptLine(
    lineId: string,
    patch: Partial<PlatformEarningLine>,
  ): void {
    const line = this.lines.get(lineId);
    if (!line) return;
    this.lines.set(lineId, {
      ...line,
      ...patch,
    });
  }

  private recalculate(batchId: string): void {
    const batch = this.batches.get(batchId);
    if (!batch) return;
    const lines = [...this.lines.values()].filter(
      (line) => line.batchId === batchId,
    );
    this.batches.set(batch.id, {
      ...batch,
      sourceLineCount: lines.length,
      rawQuantityTotal: lines.reduce(
        (sum, line) => sum + line.rawQuantity,
        0,
      ),
    });
  }

  private syncLineStatus(
    batchId: string,
    status: PlatformEarningBatchStatus,
  ): void {
    for (const line of this.lines.values()) {
      if (line.batchId !== batchId) continue;
      this.lines.set(line.id, {
        ...line,
        batchStatus: status,
      });
    }
  }
}

function page<T extends { readonly id: string }>(
  items: readonly T[],
  limit: number,
): { readonly items: readonly T[]; readonly nextCursor?: string } {
  const sorted = [...items].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  const selected = sorted.slice(0, limit);
  return {
    items: selected,
    nextCursor:
      sorted.length > limit
        ? selected[selected.length - 1]?.id
        : undefined,
  };
}

function createActor(
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
      revenueLedger: ["global"],
    },
    isActive: true,
  });
}

function withTrace<T>(fn: () => Promise<T>): Promise<T> {
  return bindTraceId(
    `rl-1-test-${Math.random().toString(36).slice(2)}`,
    fn,
  );
}
