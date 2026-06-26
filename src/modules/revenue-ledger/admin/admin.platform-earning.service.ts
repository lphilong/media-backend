import crypto from "crypto";
import { ClientSession } from "mongodb";
import { Actor } from "@core/actor/actor";
import {
  AuthoritativeAdminMutationBridge,
  AuthoritativeMutationControls,
} from "@core/application/authoritative-admin-mutation.bridge";
import { AuthoritativeAdminMutationIdentity } from "@core/application/authoritative-admin-mutation.permission-map";
import { AuditGuard } from "@core/audit/audit.guard";
import {
  BusinessCodeSequenceRepository,
  formatBusinessCode,
} from "@core/business-code/business-code-sequence.repository";
import { Permission } from "@core/permission/permission.enum";
import { PermissionContract } from "@core/permission/permission.contract";
import { PermissionGuard } from "@core/permission/permission.guard";
import { PermissionResolver } from "@core/permission/permission.resolver";
import { getTraceIdOrThrow } from "@core/trace/trace.context";
import { EventStatus } from "@modules/event-assignment/domain/event-assignment.types";
import {
  PlatformEarningBatch,
  PlatformEarningLine,
  PlatformEarningRepository,
} from "@modules/revenue-ledger/domain/platform-earning.repository";
import { RevenueLedgerEventReadonlyAccess } from "@modules/revenue-ledger/domain/revenue-ledger-event-readonly-access";
import {
  RevenueLedgerConflictError,
  RevenueLedgerInvalidCurrencyCodeError,
  RevenueLedgerInvalidEventAttributionError,
  RevenueLedgerInvalidPlatformAttributionError,
  RevenueLedgerInvalidRevenueAmountError,
  RevenueLedgerInvalidTalentReferenceError,
  RevenueLedgerNotFoundError,
  RevenueLedgerPermissionScopeError,
  RevenueLedgerStateError,
  RevenueLedgerValidationError,
} from "@modules/revenue-ledger/domain/revenue-ledger.errors";
import { RevenueLedgerPlatformAccountReadonlyAccess } from "@modules/revenue-ledger/domain/revenue-ledger-platform-account-readonly-access";
import { RevenueEntryRepository } from "@modules/revenue-ledger/domain/revenue-ledger.repository";
import { RevenueLedgerTalentReadonlyAccess } from "@modules/revenue-ledger/domain/revenue-ledger-talent-readonly-access";
import {
  PLATFORM_EARNING_BATCH_STATUSES,
  PLATFORM_EARNING_SOURCE_TYPES,
  PlatformEarningBatchStatus,
  PlatformEarningSourceType,
  RevenueCommissionableBasisSnapshot,
  RevenueConversionSnapshot,
  RevenueEntry,
  RevenuePlatformCutSnapshot,
  RevenueSourceSummarySnapshot,
} from "@modules/revenue-ledger/domain/revenue-ledger.types";
import {
  hasFinanceGlobalAuthority,
  requireFinancePeriodAuthority,
} from "@modules/role/domain/finance-scope-authority";
import { StructuredScopeAuthorityService } from "@modules/role/domain/structured-scope-authority";
import {
  ApprovePlatformEarningBatchCommand,
  CreatePlatformEarningBatchCommand,
  CreateRevenueEntryFromPlatformEarningBatchCommand,
  CreateRevenueEntryFromPlatformEarningBatchResult,
  ListPlatformEarningBatchesQuery,
  ListPlatformEarningBatchesResult,
  ListPlatformEarningLinesQuery,
  ListPlatformEarningLinesResult,
  PlatformEarningBatchLifecycleCommand,
  PlatformEarningBatchMutationResult,
  PlatformEarningLineMutationResult,
  RejectPlatformEarningBatchCommand,
  UpdatePlatformEarningBatchCommand,
  UpdatePlatformEarningLineCommand,
  UpsertPlatformEarningLineCommand,
  VoidPlatformEarningBatchCommand,
} from "@modules/revenue-ledger/shared/platform-earning.contracts";

const EVENT_STATUSES_ALLOWED_FOR_SOURCE_DETAIL =
  new Set<EventStatus>([
    "PLANNED",
    "CONFIRMED",
    "COMPLETED",
  ]);

interface NormalizedApprovePlatformEarningBatchCommand {
  readonly batchId: string;
  readonly targetCurrency: string;
  readonly appliedRate: number;
  readonly rateType: string;
  readonly rateEffectiveFrom: number | null;
  readonly rateEffectiveTo: number | null;
  readonly platformCutRate: number;
  readonly companyShareRate: number;
  readonly conversionRuleRef: string | null;
  readonly platformCutRuleRef: string | null;
  readonly sourceNote: string | null;
}

interface NormalizedCreateRevenueEntryFromBatchCommand {
  readonly batchId: string;
  readonly revenueEntryCode: string | null;
  readonly title: string | null;
  readonly subjectTalentId: string | null;
  readonly recognizedAt: number | null;
  readonly description: string | null;
  readonly externalRef: string | null;
}

export class PlatformEarningAdminService {
  constructor(
    private readonly platformEarningRepository: PlatformEarningRepository,
    private readonly revenueEntryRepository: RevenueEntryRepository,
    private readonly codeSequenceRepository: BusinessCodeSequenceRepository,
    private readonly talentReadonlyAccess: RevenueLedgerTalentReadonlyAccess,
    private readonly platformAccountReadonlyAccess: RevenueLedgerPlatformAccountReadonlyAccess,
    private readonly eventReadonlyAccess: RevenueLedgerEventReadonlyAccess,
    private readonly audit: AuditGuard,
    private readonly mutationBridge: AuthoritativeAdminMutationBridge,
    private readonly structuredAuthority: StructuredScopeAuthorityService,
  ) {}

  async createBatch(
    actor: Actor,
    command: CreatePlatformEarningBatchCommand,
  ): Promise<PlatformEarningBatchMutationResult> {
    const operation =
      "revenue-ledger.platform-earning.create-batch";
    const permission = assertPermission(
      actor,
      Permission.REVENUE_LEDGER_PLATFORM_EARNING_SUBMIT,
    );
    const input = normalizeCreateBatchCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        platform: input.platform,
        platformAccountId: input.platformAccountId,
        periodMonth: input.periodMonth,
        sourceType: input.sourceType,
      },
      async (session) => {
        await this.requireFinanceAuthorityForPeriod(
          actor,
          Permission.REVENUE_LEDGER_PLATFORM_EARNING_SUBMIT,
          input.periodMonth,
        );
        await this.assertPlatformAccountResolvable(
          input.platformAccountId,
          session,
        );
        const batchCode =
          input.batchCode ??
          (await this.allocateGeneratedBatchCode(
            input.periodMonth,
            session,
          ));
        const now = Date.now();
        const batch =
          await this.platformEarningRepository.insertBatch(
            {
              id: crypto.randomUUID(),
              batchCode,
              platform: input.platform,
              platformAccountId:
                input.platformAccountId,
              talentGroupId: input.talentGroupId,
              sourceType: input.sourceType,
              sourceUnit: "DIAMOND",
              periodMonth: input.periodMonth,
              sourceDateFrom:
                input.sourceDateFrom,
              sourceDateTo: input.sourceDateTo,
              createdByActorId: actor.id,
              createdAt: now,
            },
            session,
          );
        await this.recordAudit(
          actor,
          permission,
          batch.id,
          operation,
          {
            status: batch.status,
            batchCode: batch.batchCode,
          },
          session,
        );
        return batch;
      },
    );
  }

  async updateBatch(
    actor: Actor,
    command: UpdatePlatformEarningBatchCommand,
  ): Promise<PlatformEarningBatchMutationResult> {
    const operation =
      "revenue-ledger.platform-earning.update-batch";
    const permission = assertPermission(
      actor,
      Permission.REVENUE_LEDGER_PLATFORM_EARNING_SUBMIT,
    );
    const input = normalizeUpdateBatchCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      { batchId: input.batchId },
      async (session) => {
        const current = await this.requireBatch(
          input.batchId,
          session,
        );
        await this.requireFinanceAuthorityForPeriod(
          actor,
          Permission.REVENUE_LEDGER_PLATFORM_EARNING_SUBMIT,
          current.periodMonth,
        );
        assertBatchStatus(
          current,
          ["DRAFT"],
          "updatePlatformEarningBatch",
        );
        const nextSourceDateFrom =
          input.sourceDateFrom ?? current.sourceDateFrom;
        const nextSourceDateTo =
          input.sourceDateTo ?? current.sourceDateTo;
        assertBatchSourceDateRangeOrder(
          nextSourceDateFrom,
          nextSourceDateTo,
        );
        await this.assertDraftBatchSourceContextEditable(
          current,
          input,
          session,
        );
        if (
          input.platformAccountId &&
          input.platformAccountId !==
            current.platformAccountId
        ) {
          await this.assertPlatformAccountResolvable(
            input.platformAccountId,
            session,
          );
        }
        const updated =
          await this.platformEarningRepository.updateDraftBatch(
            {
              ...input,
              updatedAt: Date.now(),
            },
            session,
          );
        if (!updated) {
          throw new RevenueLedgerStateError(
            `Platform earning batch is no longer DRAFT: ${input.batchId}`,
          );
        }
        return updated;
      },
    );
  }

  async addLine(
    actor: Actor,
    command: UpsertPlatformEarningLineCommand,
  ): Promise<PlatformEarningLineMutationResult> {
    const operation =
      "revenue-ledger.platform-earning.add-line";
    const permission = assertPermission(
      actor,
      Permission.REVENUE_LEDGER_PLATFORM_EARNING_SUBMIT,
    );
    const input = normalizeAddLineCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      { batchId: input.batchId },
      async (session) => {
        const batch = await this.requireBatch(
          input.batchId,
          session,
        );
        await this.requireFinanceAuthorityForPeriod(
          actor,
          Permission.REVENUE_LEDGER_PLATFORM_EARNING_SUBMIT,
          batch.periodMonth,
        );
        assertBatchStatus(
          batch,
          ["DRAFT"],
          "addPlatformEarningLine",
        );
        assertLineSourceDateWithinBatchRange(
          batch,
          input.sourceDate,
        );
        await this.assertLineReferencesValid(
          batch,
          input.memberTalentId,
          input.eventId,
          session,
        );
        const duplicateDetectionKey =
          buildDuplicateDetectionKey({
            batch,
            sourceDate: input.sourceDate,
            memberTalentId: input.memberTalentId,
            memberEmploymentProfileId:
              input.memberEmploymentProfileId,
            eventId: input.eventId,
            externalSourceRef:
              input.externalSourceRef,
          });
        await this.assertDuplicateKeyAvailable(
          duplicateDetectionKey,
          undefined,
          session,
        );
        const now = Date.now();
        const line: PlatformEarningLine = {
          id: crypto.randomUUID(),
          batchId: batch.id,
          batchStatus: batch.status,
          sourceDate: input.sourceDate,
          periodMonth: batch.periodMonth,
          platform: batch.platform,
          platformAccountId:
            batch.platformAccountId,
          talentGroupId: batch.talentGroupId,
          memberTalentId: input.memberTalentId,
          memberEmploymentProfileId:
            input.memberEmploymentProfileId,
          eventId: input.eventId,
          sourceType: batch.sourceType,
          sourceUnit: batch.sourceUnit,
          rawQuantity: input.rawQuantity,
          externalSourceRef:
            input.externalSourceRef,
          notes: input.notes,
          duplicateDetectionKey,
          correctionOfLineId:
            input.correctionOfLineId,
          replacementLineId: null,
          enteredByActorId: actor.id,
          enteredAt: now,
          submittedByActorId: null,
          submittedAt: null,
          createdAt: now,
          updatedAt: now,
        };
        const created =
          await this.platformEarningRepository.insertLine(
            line,
            session,
          );
        await this.recordAudit(
          actor,
          permission,
          batch.id,
          operation,
          {
            lineId: created.id,
            duplicateDetectionKey,
          },
          session,
        );
        return created;
      },
    );
  }

  async updateLine(
    actor: Actor,
    command: UpdatePlatformEarningLineCommand,
  ): Promise<PlatformEarningLineMutationResult> {
    const operation =
      "revenue-ledger.platform-earning.update-line";
    const permission = assertPermission(
      actor,
      Permission.REVENUE_LEDGER_PLATFORM_EARNING_SUBMIT,
    );
    const input = normalizeUpdateLineCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        batchId: input.batchId,
        lineId: input.lineId,
      },
      async (session) => {
        const batch = await this.requireBatch(
          input.batchId,
          session,
        );
        await this.requireFinanceAuthorityForPeriod(
          actor,
          Permission.REVENUE_LEDGER_PLATFORM_EARNING_SUBMIT,
          batch.periodMonth,
        );
        assertBatchStatus(
          batch,
          ["DRAFT"],
          "updatePlatformEarningLine",
        );
        const current =
          await this.platformEarningRepository.findLineById(
            input.lineId,
            session,
          );
        if (!current || current.batchId !== batch.id) {
          throw new RevenueLedgerNotFoundError(
            input.lineId,
          );
        }
        const nextMemberTalentId =
          input.memberTalentId !== undefined
            ? input.memberTalentId
            : current.memberTalentId;
        const nextEventId =
          input.eventId !== undefined
            ? input.eventId
            : current.eventId;
        const nextSourceDate =
          input.sourceDate ?? current.sourceDate;
        assertLineSourceDateWithinBatchRange(
          batch,
          nextSourceDate,
        );
        await this.assertLineReferencesValid(
          batch,
          nextMemberTalentId,
          nextEventId,
          session,
        );
        const nextDuplicateDetectionKey =
          buildDuplicateDetectionKey({
            batch,
            sourceDate: nextSourceDate,
            memberTalentId: nextMemberTalentId,
            memberEmploymentProfileId:
              input.memberEmploymentProfileId !==
              undefined
                ? input.memberEmploymentProfileId
                : current.memberEmploymentProfileId,
            eventId: nextEventId,
            externalSourceRef:
              input.externalSourceRef !== undefined
                ? input.externalSourceRef
                : current.externalSourceRef,
          });
        await this.assertDuplicateKeyAvailable(
          nextDuplicateDetectionKey,
          current.id,
          session,
        );
        const updated =
          await this.platformEarningRepository.updateDraftLine(
            {
              lineId: current.id,
              sourceDate: input.sourceDate,
              memberTalentId: input.memberTalentId,
              memberEmploymentProfileId:
                input.memberEmploymentProfileId,
              eventId: input.eventId,
              rawQuantity: input.rawQuantity,
              externalSourceRef:
                input.externalSourceRef,
              notes: input.notes,
              duplicateDetectionKey:
                nextDuplicateDetectionKey,
              updatedAt: Date.now(),
            },
            session,
          );
        if (!updated) {
          throw new RevenueLedgerStateError(
            `Platform earning line is no longer mutable: ${current.id}`,
          );
        }
        return updated;
      },
    );
  }

  async submitBatch(
    actor: Actor,
    command: PlatformEarningBatchLifecycleCommand,
  ): Promise<PlatformEarningBatchMutationResult> {
    return this.transitionBatch(
      actor,
      command.batchId,
      "revenue-ledger.platform-earning.submit",
      Permission.REVENUE_LEDGER_PLATFORM_EARNING_SUBMIT,
      ["DRAFT"],
      "SUBMITTED",
      (actorId, now) => ({
        submittedByActorId: actorId,
        submittedAt: now,
      }),
    );
  }

  async startReview(
    actor: Actor,
    command: PlatformEarningBatchLifecycleCommand,
  ): Promise<PlatformEarningBatchMutationResult> {
    return this.transitionBatch(
      actor,
      command.batchId,
      "revenue-ledger.platform-earning.start-review",
      Permission.REVENUE_LEDGER_PLATFORM_EARNING_REVIEW,
      ["SUBMITTED"],
      "UNDER_REVIEW",
      (actorId, now) => ({
        reviewedByActorId: actorId,
        reviewedAt: now,
      }),
    );
  }

  async rejectBatch(
    actor: Actor,
    command: RejectPlatformEarningBatchCommand,
  ): Promise<PlatformEarningBatchMutationResult> {
    const reason = normalizeRequiredText(
      command.reason,
      "reason",
    );
    return this.transitionBatch(
      actor,
      command.batchId,
      "revenue-ledger.platform-earning.reject",
      Permission.REVENUE_LEDGER_PLATFORM_EARNING_REVIEW,
      ["SUBMITTED", "UNDER_REVIEW"],
      "REJECTED",
      (actorId, now) => ({
        rejectedByActorId: actorId,
        rejectedAt: now,
        rejectionReason: reason,
      }),
    );
  }

  async voidBatch(
    actor: Actor,
    command: VoidPlatformEarningBatchCommand,
  ): Promise<PlatformEarningBatchMutationResult> {
    const reason = normalizeRequiredText(
      command.reason,
      "reason",
    );
    return this.transitionBatch(
      actor,
      command.batchId,
      "revenue-ledger.platform-earning.void",
      Permission.REVENUE_LEDGER_PLATFORM_EARNING_VOID,
      ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "APPROVED"],
      "VOIDED",
      (actorId, now) => ({
        voidedByActorId: actorId,
        voidedAt: now,
        voidReason: reason,
      }),
    );
  }

  async archiveBatch(
    actor: Actor,
    command: PlatformEarningBatchLifecycleCommand,
  ): Promise<PlatformEarningBatchMutationResult> {
    return this.transitionBatch(
      actor,
      command.batchId,
      "revenue-ledger.platform-earning.archive",
      Permission.REVENUE_LEDGER_PLATFORM_EARNING_REVIEW,
      ["REJECTED", "VOIDED", "APPROVED"],
      "ARCHIVED",
      (actorId, now) => ({
        archivedByActorId: actorId,
        archivedAt: now,
      }),
    );
  }

  async approveBatch(
    actor: Actor,
    command: ApprovePlatformEarningBatchCommand,
  ): Promise<PlatformEarningBatchMutationResult> {
    const operation =
      "revenue-ledger.platform-earning.approve";
    const permission = assertPermission(
      actor,
      Permission.REVENUE_LEDGER_PLATFORM_EARNING_APPROVE,
    );
    const input = normalizeApproveCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      { batchId: input.batchId },
      async (session) => {
        const batch = await this.requireBatch(
          input.batchId,
          session,
        );
        await this.requireFinanceAuthorityForPeriod(
          actor,
          Permission.REVENUE_LEDGER_PLATFORM_EARNING_APPROVE,
          batch.periodMonth,
        );
        assertBatchStatus(
          batch,
          ["UNDER_REVIEW"],
          "approvePlatformEarningBatch",
        );
        if (
          batch.submittedByActorId &&
          batch.submittedByActorId === actor.id
        ) {
          throw new RevenueLedgerPermissionScopeError(
            "Platform earning approver must be separate from source submitter",
          );
        }
        const lines =
          await this.platformEarningRepository.findLinesByBatchId(
            batch.id,
            session,
          );
        if (lines.length === 0) {
          throw new RevenueLedgerStateError(
            `Platform earning batch requires at least one source line before approval: ${batch.id}`,
          );
        }
        await this.assertSourceLinesConsistentWithBatch(
          batch,
          lines,
          session,
        );
        const sourceFingerprint =
          buildSourceFingerprint(lines);
        const now = Date.now();
        const grossConvertedAmount = roundMoney(
          batch.rawQuantityTotal * input.appliedRate,
        );
        const platformCutAmount = roundMoney(
          grossConvertedAmount *
            input.platformCutRate,
        );
        const companyNetAmount = roundMoney(
          grossConvertedAmount - platformCutAmount,
        );
        const conversionSnapshot: RevenueConversionSnapshot =
          {
            sourceUnit: batch.sourceUnit,
            rawQuantity: batch.rawQuantityTotal,
            targetCurrency: input.targetCurrency,
            appliedRate: input.appliedRate,
            rateType: input.rateType,
            rateEffectiveFrom:
              input.rateEffectiveFrom,
            rateEffectiveTo: input.rateEffectiveTo,
            grossConvertedAmount,
            ruleRef: input.conversionRuleRef,
            appliedByActorId: actor.id,
            appliedAt: now,
            sourceNote: input.sourceNote,
          };
        const platformCutSnapshot: RevenuePlatformCutSnapshot =
          {
            platformCutRate: input.platformCutRate,
            companyShareRate:
              input.companyShareRate,
            grossConvertedAmount,
            platformCutAmount,
            companyNetAmount,
            targetCurrency: input.targetCurrency,
            ruleRef: input.platformCutRuleRef,
            appliedByActorId: actor.id,
            appliedAt: now,
            sourceNote: input.sourceNote,
          };
        const commissionableBasisSnapshot: RevenueCommissionableBasisSnapshot =
          {
            basisType: "COMPANY_NET",
            amount: companyNetAmount,
            currencyCode: input.targetCurrency,
            appliedByActorId: actor.id,
            appliedAt: now,
            sourceNote: input.sourceNote,
          };
        const approved =
          await this.platformEarningRepository.approveBatch(
            {
              batchId: batch.id,
              conversionSnapshot,
              platformCutSnapshot,
              commissionableBasisSnapshot,
              companyNetAmount,
              commissionableBasisAmount:
                companyNetAmount,
              sourceFingerprint,
              approvedByActorId: actor.id,
              approvedAt: now,
              updatedAt: now,
            },
            session,
          );
        if (!approved) {
          throw new RevenueLedgerStateError(
            `approvePlatformEarningBatch failed because batch is no longer UNDER_REVIEW: ${batch.id}`,
          );
        }
        await this.recordAudit(
          actor,
          permission,
          approved.id,
          operation,
          {
            sourceLineCount:
              approved.sourceLineCount,
            companyNetAmount:
              approved.companyNetAmount,
            commissionableBasisAmount:
              approved.commissionableBasisAmount,
          },
          session,
        );
        return approved;
      },
    );
  }

  async createRevenueEntry(
    actor: Actor,
    command: CreateRevenueEntryFromPlatformEarningBatchCommand,
  ): Promise<CreateRevenueEntryFromPlatformEarningBatchResult> {
    const operation =
      "revenue-ledger.platform-earning.create-revenue-entry";
    const permission = assertPermission(
      actor,
      Permission.REVENUE_LEDGER_CREATE,
    );
    const input =
      normalizeCreateRevenueEntryFromBatchCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      { batchId: input.batchId },
      async (session) => {
        const batch = await this.requireBatch(
          input.batchId,
          session,
        );
        await this.requireFinanceAuthorityForPeriod(
          actor,
          Permission.REVENUE_LEDGER_CREATE,
          batch.periodMonth,
        );
        assertBatchStatus(
          batch,
          ["APPROVED"],
          "createRevenueEntryFromPlatformEarningBatch",
        );
        if (batch.revenueEntryId) {
          throw new RevenueLedgerConflictError(
            `Platform earning batch already linked to Revenue Entry: ${batch.revenueEntryId}`,
          );
        }
        if (
          !batch.conversionSnapshot ||
          !batch.platformCutSnapshot ||
          batch.companyNetAmount === null ||
          batch.approvedAt === null ||
          batch.approvedByActorId === null
        ) {
          throw new RevenueLedgerStateError(
            `Approved platform earning batch is missing approval snapshots: ${batch.id}`,
          );
        }
        const lines =
          await this.platformEarningRepository.findLinesByBatchId(
            batch.id,
            session,
          );
        await this.assertSourceLinesConsistentWithBatch(
          batch,
          lines,
          session,
        );
        const currentSourceFingerprint =
          buildSourceFingerprint(lines);
        if (
          batch.sourceFingerprint !==
          currentSourceFingerprint
        ) {
          throw new RevenueLedgerStateError(
            `Approved platform earning batch source fingerprint no longer matches persisted source lines: ${batch.id}`,
          );
        }
        const subjectTalentId =
          input.subjectTalentId ??
          selectSummarySubjectTalentId(lines);
        if (!subjectTalentId) {
          throw new RevenueLedgerValidationError(
            "subjectTalentId is required when approved batch has no single memberTalentId",
          );
        }
        await this.assertTalentResolvable(
          subjectTalentId,
          session,
        );
        const revenueEntryCode =
          input.revenueEntryCode ??
          (await this.allocateGeneratedRevenueEntryCode(
            batch.periodMonth,
            session,
          ));
        const now = Date.now();
        const sourceSummarySnapshot =
          buildSourceSummarySnapshot(
            batch,
            lines,
          );
        const recognizedAt =
          input.recognizedAt ?? batch.sourceDateTo;
        const entry: RevenueEntry = {
          id: crypto.randomUUID(),
          revenueEntryCode,
          title:
            input.title ??
            `Platform earnings ${batch.platform} ${batch.periodMonth}`,
          normalizedTitle: canonicalizeSearchToken(
            input.title ??
              `Platform earnings ${batch.platform} ${batch.periodMonth}`,
          ),
          subjectTalentId,
          attributionPlatformAccountId:
            batch.platformAccountId,
          attributionTalentGroupId:
            batch.talentGroupId,
          attributionEmploymentProfileId:
            selectSummaryEmploymentProfileId(lines),
          attributionEventId:
            selectSummaryEventId(lines),
          revenueKind: "PLATFORM_LIVESTREAM",
          entrySource: "PLATFORM_EARNING_BATCH",
          sourceBatchIds: [batch.id],
          sourceSummaryRef: `${batch.id}:monthly-summary`,
          sourceLineCount: batch.sourceLineCount,
          sourceSummarySnapshot,
          conversionSnapshot:
            batch.conversionSnapshot,
          platformCutSnapshot:
            batch.platformCutSnapshot,
          commissionableBasisSnapshot: {
            basisType: "COMPANY_NET",
            amount: batch.companyNetAmount,
            currencyCode:
              batch.conversionSnapshot.targetCurrency,
            appliedByActorId:
              batch.approvedByActorId,
            appliedAt: batch.approvedAt,
            sourceNote:
              batch.conversionSnapshot.sourceNote,
          },
          status: "DRAFT",
          currencyCode:
            batch.conversionSnapshot.targetCurrency,
          recognizedAmount: batch.companyNetAmount,
          recognizedAt,
          finalizedAt: null,
          reconciledAt: null,
          voidedAt: null,
          reconciliationReference: null,
          description: input.description,
          externalRef:
            input.externalRef ?? batch.batchCode,
          createdAt: now,
          updatedAt: now,
        };
        await this.revenueEntryRepository.insert(
          entry,
          session,
        );
        const linked =
          await this.platformEarningRepository.markRevenueEntryCreated(
            {
              batchId: batch.id,
              revenueEntryId: entry.id,
              revenueEntryCreatedByActorId: actor.id,
              revenueEntryCreatedAt: now,
              updatedAt: now,
            },
            session,
          );
        if (!linked) {
          throw new RevenueLedgerConflictError(
            `Platform earning batch already linked to a Revenue Entry: ${batch.id}`,
          );
        }
        await this.recordAudit(
          actor,
          permission,
          batch.id,
          operation,
          {
            revenueEntryId: entry.id,
            sourceLineCount: entry.sourceLineCount,
          },
          session,
        );
        return toRevenueEntryMutationView(entry);
      },
    );
  }

  async getBatch(
    actor: Actor,
    batchId: string,
  ): Promise<PlatformEarningBatch> {
    assertPermission(
      actor,
      Permission.REVENUE_LEDGER_READ,
    );
    const batch = await this.requireBatch(batchId);
    await this.requireFinanceAuthorityForPeriod(
      actor,
      Permission.REVENUE_LEDGER_READ,
      batch.periodMonth,
    );
    return batch;
  }

  async listBatches(
    actor: Actor,
    query: ListPlatformEarningBatchesQuery,
  ): Promise<ListPlatformEarningBatchesResult> {
    assertPermission(
      actor,
      Permission.REVENUE_LEDGER_READ,
    );
    const periodMonth = normalizeOptionalPeriodMonth(
      query.periodMonth,
    );
    await this.requireFinanceListAuthority(
      actor,
      Permission.REVENUE_LEDGER_READ,
      periodMonth,
    );
    return this.platformEarningRepository.listBatches({
      status: normalizeOptionalBatchStatus(
        query.status,
      ),
      platform: normalizeOptionalTextValue(
        query.platform,
      ),
      platformAccountId: normalizeOptionalTextValue(
        query.platformAccountId,
      ),
      talentGroupId: normalizeOptionalTextValue(
        query.talentGroupId,
      ),
      sourceType: normalizeOptionalSourceType(
        query.sourceType,
      ),
      periodMonth,
      createdBeforeAt: normalizeOptionalTimestamp(
        query.createdBeforeAt,
        "createdBeforeAt",
      ),
      limit: normalizeLimit(query.limit),
      cursor: normalizeOptionalTextValue(
        query.cursor,
      ),
    });
  }

  async listLines(
    actor: Actor,
    query: ListPlatformEarningLinesQuery,
  ): Promise<ListPlatformEarningLinesResult> {
    assertPermission(
      actor,
      Permission.REVENUE_LEDGER_READ,
    );
    const batchId = normalizeOptionalTextValue(
      query.batchId,
    );
    const periodMonth = normalizeOptionalPeriodMonth(
      query.periodMonth,
    );
    if (batchId) {
      const batch = await this.requireBatch(batchId);
      await this.requireFinanceAuthorityForPeriod(
        actor,
        Permission.REVENUE_LEDGER_READ,
        batch.periodMonth,
      );
    } else {
      await this.requireFinanceListAuthority(
        actor,
        Permission.REVENUE_LEDGER_READ,
        periodMonth,
      );
    }
    return this.platformEarningRepository.listLines({
      batchId,
      status: normalizeOptionalBatchStatus(
        query.status,
      ),
      platform: normalizeOptionalTextValue(
        query.platform,
      ),
      platformAccountId: normalizeOptionalTextValue(
        query.platformAccountId,
      ),
      talentGroupId: normalizeOptionalTextValue(
        query.talentGroupId,
      ),
      memberTalentId: normalizeOptionalTextValue(
        query.memberTalentId,
      ),
      periodMonth,
      limit: normalizeLimit(query.limit),
      cursor: normalizeOptionalTextValue(
        query.cursor,
      ),
    });
  }

  private async transitionBatch(
    actor: Actor,
    batchId: string,
    operation: AuthoritativeAdminMutationIdentity,
    permissionCode: Permission,
    fromStatuses: readonly PlatformEarningBatchStatus[],
    toStatus: PlatformEarningBatchStatus,
    metadata: (
      actorId: string,
      now: number,
    ) => Readonly<Record<string, string | number | null>>,
  ): Promise<PlatformEarningBatchMutationResult> {
    const permission = assertPermission(
      actor,
      permissionCode,
    );
    return this.executeMutation(
      actor,
      permission,
      operation,
      { batchId },
      async (session) => {
        const current = await this.requireBatch(
          batchId,
          session,
        );
        await this.requireFinanceAuthorityForPeriod(
          actor,
          permissionCode,
          current.periodMonth,
        );
        assertBatchStatus(
          current,
          fromStatuses,
          operation,
        );
        if (
          toStatus === "SUBMITTED" &&
          current.sourceLineCount <= 0
        ) {
          throw new RevenueLedgerStateError(
            `Platform earning batch requires source lines before submit: ${batchId}`,
          );
        }
        const now = Date.now();
        const updated =
          await this.platformEarningRepository.transitionBatchStatus(
            {
              batchId,
              fromStatuses,
              toStatus,
              ...metadata(actor.id, now),
              updatedAt: now,
            },
            session,
          );
        if (!updated) {
          throw new RevenueLedgerStateError(
            `Platform earning batch transition failed: ${batchId}`,
          );
        }
        await this.recordAudit(
          actor,
          permission,
          batchId,
          operation,
          {
            previousStatus: current.status,
            nextStatus: updated.status,
          },
          session,
        );
        return updated;
      },
    );
  }

  private async requireBatch(
    batchId: string,
    session?: ClientSession,
  ): Promise<PlatformEarningBatch> {
    const batch =
      await this.platformEarningRepository.findBatchById(
        normalizeRequiredText(batchId, "batchId"),
        session,
      );
    if (!batch) {
      throw new RevenueLedgerNotFoundError(batchId);
    }
    return batch;
  }

  private async requireFinanceAuthorityForPeriod(
    actor: Actor,
    permission: Permission,
    periodMonth: string,
  ): Promise<void> {
    await requireFinancePeriodAuthority({
      actor,
      permission,
      periodMonth,
      authority: this.structuredAuthority,
      error: new RevenueLedgerPermissionScopeError(
        "Revenue Ledger Platform Earnings requires financePeriod(periodMonth) or financeGlobal structured authority",
      ),
    });
  }

  private async requireFinanceListAuthority(
    actor: Actor,
    permission: Permission,
    periodMonth: string | undefined,
  ): Promise<void> {
    if (periodMonth) {
      await this.requireFinanceAuthorityForPeriod(
        actor,
        permission,
        periodMonth,
      );
      return;
    }

    if (
      await hasFinanceGlobalAuthority({
        actor,
        permission,
        authority: this.structuredAuthority,
      })
    ) {
      return;
    }

    throw new RevenueLedgerPermissionScopeError(
      "Revenue Ledger Platform Earnings list requires periodMonth filter with financePeriod authority or financeGlobal structured authority",
    );
  }

  private async assertDuplicateKeyAvailable(
    duplicateDetectionKey: string,
    allowedLineId: string | undefined,
    session: ClientSession,
  ): Promise<void> {
    const existing =
      await this.platformEarningRepository.findLineByDuplicateDetectionKey(
        duplicateDetectionKey,
        session,
      );
    if (existing && existing.id !== allowedLineId) {
      throw new RevenueLedgerConflictError(
        `Duplicate platform earning source detail detected: ${duplicateDetectionKey}`,
      );
    }
  }

  private async assertDraftBatchSourceContextEditable(
    batch: PlatformEarningBatch,
    input: UpdatePlatformEarningBatchCommand,
    session: ClientSession,
  ): Promise<void> {
    if (!hasDraftBatchSourceContextChange(batch, input)) {
      return;
    }
    const lines =
      await this.platformEarningRepository.findLinesByBatchId(
        batch.id,
        session,
      );
    if (batch.sourceLineCount > 0 || lines.length > 0) {
      throw new RevenueLedgerStateError(
        `Platform earning batch source context cannot be changed after source lines exist: ${batch.id}`,
      );
    }
  }

  private async assertSourceLinesConsistentWithBatch(
    batch: PlatformEarningBatch,
    lines: readonly PlatformEarningLine[],
    session: ClientSession,
  ): Promise<void> {
    const expectedDuplicateKeys = new Set<string>();
    let rawQuantityTotal = 0;
    for (const line of lines) {
      assertSourceLineMatchesBatchContext(batch, line);
      assertLineSourceDateWithinBatchRange(
        batch,
        line.sourceDate,
      );
      const expectedDuplicateDetectionKey =
        buildDuplicateDetectionKey({
          batch,
          sourceDate: line.sourceDate,
          memberTalentId: line.memberTalentId,
          memberEmploymentProfileId:
            line.memberEmploymentProfileId,
          eventId: line.eventId,
          externalSourceRef: line.externalSourceRef,
        });
      if (
        line.duplicateDetectionKey !==
        expectedDuplicateDetectionKey
      ) {
        throw new RevenueLedgerStateError(
          `Platform earning source line duplicate key is stale for line ${line.id}`,
        );
      }
      if (
        expectedDuplicateKeys.has(
          expectedDuplicateDetectionKey,
        )
      ) {
        throw new RevenueLedgerConflictError(
          `Duplicate platform earning source detail detected inside batch: ${expectedDuplicateDetectionKey}`,
        );
      }
      expectedDuplicateKeys.add(
        expectedDuplicateDetectionKey,
      );
      await this.assertLineReferencesValid(
        batch,
        line.memberTalentId,
        line.eventId,
        session,
      );
      rawQuantityTotal += line.rawQuantity;
    }
    if (lines.length !== batch.sourceLineCount) {
      throw new RevenueLedgerStateError(
        `Platform earning batch sourceLineCount does not match persisted source lines: ${batch.id}`,
      );
    }
    if (rawQuantityTotal !== batch.rawQuantityTotal) {
      throw new RevenueLedgerStateError(
        `Platform earning batch rawQuantityTotal does not match persisted source lines: ${batch.id}`,
      );
    }
  }

  private async assertLineReferencesValid(
    batch: PlatformEarningBatch,
    memberTalentId: string | null,
    eventId: string | null,
    session: ClientSession,
  ): Promise<void> {
    await this.assertPlatformAccountResolvable(
      batch.platformAccountId,
      session,
    );
    if (memberTalentId) {
      await this.assertTalentResolvable(
        memberTalentId,
        session,
      );
    }
    if (!eventId) {
      return;
    }
    const event = await this.eventReadonlyAccess.findById(
      eventId,
      session,
    );
    if (!event) {
      throw new RevenueLedgerInvalidEventAttributionError(
        `Attributed event does not exist: ${eventId}`,
      );
    }
    if (
      !EVENT_STATUSES_ALLOWED_FOR_SOURCE_DETAIL.has(
        event.status,
      )
    ) {
      throw new RevenueLedgerInvalidEventAttributionError(
        `Attributed event must be PLANNED, CONFIRMED, or COMPLETED: ${eventId}`,
      );
    }
    if (!event.platformAccountIds.includes(batch.platformAccountId)) {
      throw new RevenueLedgerInvalidEventAttributionError(
        `Attributed event must include platformAccountId ${batch.platformAccountId}: ${eventId}`,
      );
    }
    if (memberTalentId) {
      const hasAssignment =
        await this.eventReadonlyAccess.hasActiveTalentAssignment(
          eventId,
          memberTalentId,
          session,
        );
      if (!hasAssignment) {
        throw new RevenueLedgerInvalidEventAttributionError(
          `Attributed event must contain an ACTIVE TALENT assignment for memberTalentId ${memberTalentId}: ${eventId}`,
        );
      }
    }
  }

  private async assertTalentResolvable(
    talentId: string,
    session: ClientSession,
  ): Promise<void> {
    const talent =
      await this.talentReadonlyAccess.findById(
        talentId,
        session,
      );
    if (!talent) {
      throw new RevenueLedgerInvalidTalentReferenceError(
        `Talent does not exist: ${talentId}`,
      );
    }
  }

  private async assertPlatformAccountResolvable(
    platformAccountId: string,
    session: ClientSession,
  ): Promise<void> {
    const platformAccount =
      await this.platformAccountReadonlyAccess.findById(
        platformAccountId,
        session,
      );
    if (!platformAccount) {
      throw new RevenueLedgerInvalidPlatformAttributionError(
        `Platform account does not exist: ${platformAccountId}`,
      );
    }
  }

  private async allocateGeneratedBatchCode(
    periodMonth: string,
    session: ClientSession,
  ): Promise<string> {
    const policy = {
      moduleKey: "revenue-ledger-platform-earning-batch",
      bucket: periodMonth,
      prefix: `RLEB-${periodMonth.replace("-", "")}`,
      width: 5,
    };
    const next =
      await this.codeSequenceRepository.allocateNext(
        policy.moduleKey,
        policy.bucket,
        session,
      );
    return formatBusinessCode(policy, next);
  }

  private async allocateGeneratedRevenueEntryCode(
    periodMonth: string,
    session: ClientSession,
  ): Promise<string> {
    const policy = {
      moduleKey: "revenue-ledger",
      bucket: periodMonth,
      prefix: `RL-${periodMonth.replace("-", "")}`,
      width: 5,
    };
    const next =
      await this.codeSequenceRepository.allocateNext(
        policy.moduleKey,
        policy.bucket,
        session,
      );
    return formatBusinessCode(policy, next);
  }

  private async recordAudit(
    actor: Actor,
    permission: PermissionContract,
    targetId: string,
    mutationType: AuthoritativeAdminMutationIdentity,
    metadata: Readonly<Record<string, unknown>>,
    session: ClientSession,
  ): Promise<void> {
    await this.audit.record(
      actor,
      permission,
      targetId,
      {
        mutationType,
        targetId,
        targetType: "platform-earning-batch",
        actorId: actor.id,
        ...metadata,
      },
      session,
    );
  }

  private async executeMutation<T>(
    actor: Actor,
    permission: PermissionContract,
    operation: AuthoritativeAdminMutationIdentity,
    startMetadata: Readonly<Record<string, unknown>>,
    fn: (
      session: ClientSession,
      controls: AuthoritativeMutationControls,
    ) => Promise<T>,
  ): Promise<T> {
    const traceId = getTraceIdOrThrow();
    return this.mutationBridge.execute(
      {
        actor,
        traceId,
        requiredPermission: permission,
        mutationIdentity: operation,
        mutationTargetDescriptor:
          JSON.stringify(startMetadata),
      },
      fn,
    );
  }
}

function normalizeCreateBatchCommand(
  command: CreatePlatformEarningBatchCommand,
): {
  readonly batchCode: string | undefined;
  readonly platform: string;
  readonly platformAccountId: string;
  readonly talentGroupId: string | null;
  readonly sourceType: PlatformEarningSourceType;
  readonly periodMonth: string;
  readonly sourceDateFrom: number;
  readonly sourceDateTo: number;
} {
  const sourceDateFrom = normalizeTimestamp(
    command.sourceDateFrom,
    "sourceDateFrom",
  );
  const sourceDateTo = normalizeTimestamp(
    command.sourceDateTo,
    "sourceDateTo",
  );
  if (sourceDateTo < sourceDateFrom) {
    throw new RevenueLedgerValidationError(
      "sourceDateTo must be greater than or equal to sourceDateFrom",
    );
  }
  return {
    batchCode: normalizeOptionalTextValue(
      command.batchCode ?? undefined,
    ),
    platform: normalizeRequiredText(
      command.platform,
      "platform",
    ).toUpperCase(),
    platformAccountId: normalizeRequiredText(
      command.platformAccountId,
      "platformAccountId",
    ),
    talentGroupId: normalizeOptionalNullableId(
      command.talentGroupId,
      "talentGroupId",
    ),
    sourceType: normalizeSourceType(
      command.sourceType,
    ),
    periodMonth: normalizePeriodMonth(
      command.periodMonth,
    ),
    sourceDateFrom,
    sourceDateTo,
  };
}

function normalizeUpdateBatchCommand(
  command: UpdatePlatformEarningBatchCommand,
): UpdatePlatformEarningBatchCommand {
  const sourceDateFrom = normalizeOptionalTimestamp(
    command.sourceDateFrom,
    "sourceDateFrom",
  );
  const sourceDateTo = normalizeOptionalTimestamp(
    command.sourceDateTo,
    "sourceDateTo",
  );
  return {
    batchId: normalizeRequiredText(
      command.batchId,
      "batchId",
    ),
    platformAccountId: normalizeOptionalTextValue(
      command.platformAccountId,
    ),
    talentGroupId: normalizeOptionalNullableId(
      command.talentGroupId,
      "talentGroupId",
    ),
    sourceDateFrom,
    sourceDateTo,
  };
}

function normalizeAddLineCommand(
  command: UpsertPlatformEarningLineCommand,
): Required<
  Omit<UpsertPlatformEarningLineCommand, "lineId">
> {
  return {
    batchId: normalizeRequiredText(
      command.batchId,
      "batchId",
    ),
    sourceDate: normalizeTimestamp(
      command.sourceDate,
      "sourceDate",
    ),
    memberTalentId: normalizeOptionalNullableId(
      command.memberTalentId,
      "memberTalentId",
    ),
    memberEmploymentProfileId:
      normalizeOptionalNullableId(
        command.memberEmploymentProfileId,
        "memberEmploymentProfileId",
      ),
    eventId: normalizeOptionalNullableId(
      command.eventId,
      "eventId",
    ),
    rawQuantity: normalizeRawQuantity(
      command.rawQuantity,
    ),
    externalSourceRef: normalizeOptionalNullableText(
      command.externalSourceRef,
      "externalSourceRef",
    ),
    notes: normalizeOptionalNullableText(
      command.notes,
      "notes",
    ),
    correctionOfLineId: normalizeOptionalNullableId(
      command.correctionOfLineId,
      "correctionOfLineId",
    ),
  };
}

function normalizeUpdateLineCommand(
  command: UpdatePlatformEarningLineCommand,
): UpdatePlatformEarningLineCommand {
  return {
    batchId: normalizeRequiredText(
      command.batchId,
      "batchId",
    ),
    lineId: normalizeRequiredText(
      command.lineId,
      "lineId",
    ),
    sourceDate: normalizeOptionalTimestamp(
      command.sourceDate,
      "sourceDate",
    ),
    memberTalentId: normalizeOptionalNullableId(
      command.memberTalentId,
      "memberTalentId",
    ),
    memberEmploymentProfileId:
      normalizeOptionalNullableId(
        command.memberEmploymentProfileId,
        "memberEmploymentProfileId",
      ),
    eventId: normalizeOptionalNullableId(
      command.eventId,
      "eventId",
    ),
    rawQuantity:
      command.rawQuantity === undefined
        ? undefined
        : normalizeRawQuantity(command.rawQuantity),
    externalSourceRef: normalizeOptionalNullableText(
      command.externalSourceRef,
      "externalSourceRef",
    ),
    notes: normalizeOptionalNullableText(
      command.notes,
      "notes",
    ),
  };
}

function normalizeApproveCommand(
  command: ApprovePlatformEarningBatchCommand,
): NormalizedApprovePlatformEarningBatchCommand {
  const targetCurrency = normalizeCurrencyCode(
    command.targetCurrency,
    "targetCurrency",
  );
  const appliedRate = normalizePositiveDecimal(
    command.appliedRate,
    "appliedRate",
    8,
  );
  const platformCutRate = normalizeRate(
    command.platformCutRate,
    "platformCutRate",
  );
  const companyShareRate =
    command.companyShareRate === null ||
    command.companyShareRate === undefined
      ? normalizeRate(1 - platformCutRate, "companyShareRate")
      : normalizeRate(
          command.companyShareRate,
          "companyShareRate",
        );
  if (
    Math.abs(
      platformCutRate + companyShareRate - 1,
    ) > 0.000001
  ) {
    throw new RevenueLedgerValidationError(
      "platformCutRate plus companyShareRate must equal 1",
    );
  }
  return {
    batchId: normalizeRequiredText(
      command.batchId,
      "batchId",
    ),
    targetCurrency,
    appliedRate,
    rateType:
      normalizeOptionalTextValue(
        command.rateType ?? undefined,
      ) ?? "FINANCE_APPROVED",
    rateEffectiveFrom:
      normalizeOptionalNullableTimestamp(
        command.rateEffectiveFrom,
        "rateEffectiveFrom",
      ),
    rateEffectiveTo:
      normalizeOptionalNullableTimestamp(
        command.rateEffectiveTo,
        "rateEffectiveTo",
      ),
    platformCutRate,
    companyShareRate,
    conversionRuleRef: normalizeOptionalNullableText(
      command.conversionRuleRef,
      "conversionRuleRef",
    ),
    platformCutRuleRef: normalizeOptionalNullableText(
      command.platformCutRuleRef,
      "platformCutRuleRef",
    ),
    sourceNote: normalizeOptionalNullableText(
      command.sourceNote,
      "sourceNote",
    ),
  };
}

function normalizeCreateRevenueEntryFromBatchCommand(
  command: CreateRevenueEntryFromPlatformEarningBatchCommand,
): NormalizedCreateRevenueEntryFromBatchCommand {
  return {
    batchId: normalizeRequiredText(
      command.batchId,
      "batchId",
    ),
    revenueEntryCode: normalizeOptionalNullableText(
      command.revenueEntryCode,
      "revenueEntryCode",
    ),
    title: normalizeOptionalNullableText(
      command.title,
      "title",
    ),
    subjectTalentId: normalizeOptionalNullableId(
      command.subjectTalentId,
      "subjectTalentId",
    ),
    recognizedAt: normalizeOptionalNullableTimestamp(
      command.recognizedAt,
      "recognizedAt",
    ),
    description: normalizeOptionalNullableText(
      command.description,
      "description",
    ),
    externalRef: normalizeOptionalNullableText(
      command.externalRef,
      "externalRef",
    ),
  };
}

function buildDuplicateDetectionKey(params: {
  readonly batch: PlatformEarningBatch;
  readonly sourceDate: number;
  readonly memberTalentId: string | null;
  readonly memberEmploymentProfileId: string | null;
  readonly eventId: string | null;
  readonly externalSourceRef: string | null;
}): string {
  return [
    params.batch.platform,
    params.batch.platformAccountId,
    params.batch.periodMonth,
    String(params.sourceDate),
    params.batch.sourceType,
    params.memberTalentId ?? "",
    params.memberEmploymentProfileId ?? "",
    params.eventId ?? "",
    params.externalSourceRef ?? "",
  ].join("|");
}

function buildSourceFingerprint(
  lines: readonly PlatformEarningLine[],
): string {
  const payload = lines
    .map((line) => ({
      duplicateDetectionKey:
        line.duplicateDetectionKey,
      rawQuantity: line.rawQuantity,
      sourceDate: line.sourceDate,
    }))
    .sort((a, b) =>
      a.duplicateDetectionKey.localeCompare(
        b.duplicateDetectionKey,
      ),
    );
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
}

function buildSourceSummarySnapshot(
  batch: PlatformEarningBatch,
  lines: readonly PlatformEarningLine[],
): RevenueSourceSummarySnapshot {
  return {
    sourceKind: "PLATFORM_EARNING_BATCH",
    sourceType: batch.sourceType,
    sourceBatchIds: [batch.id],
    sourceSummaryRef: `${batch.id}:monthly-summary`,
    sourceLineCount: batch.sourceLineCount,
    periodMonth: batch.periodMonth,
    sourceDateFrom: batch.sourceDateFrom,
    sourceDateTo: batch.sourceDateTo,
    platform: batch.platform,
    platformAccountId: batch.platformAccountId,
    talentGroupId: batch.talentGroupId,
    memberTalentIds: uniqueStrings(
      lines.map((line) => line.memberTalentId),
    ),
    memberEmploymentProfileIds: uniqueStrings(
      lines.map(
        (line) => line.memberEmploymentProfileId,
      ),
    ),
    eventIds: uniqueStrings(
      lines.map((line) => line.eventId),
    ),
    sourceUnit: batch.sourceUnit,
    rawQuantityTotal: batch.rawQuantityTotal,
    sourceFingerprint: batch.sourceFingerprint,
    approvedAt: batch.approvedAt ?? 0,
    approvedByActorId:
      batch.approvedByActorId ?? "",
  };
}

function selectSummarySubjectTalentId(
  lines: readonly PlatformEarningLine[],
): string | null {
  const ids = uniqueStrings(
    lines.map((line) => line.memberTalentId),
  );
  return ids.length === 1 ? ids[0] : null;
}

function selectSummaryEmploymentProfileId(
  lines: readonly PlatformEarningLine[],
): string | null {
  const ids = uniqueStrings(
    lines.map(
      (line) => line.memberEmploymentProfileId,
    ),
  );
  return ids.length === 1 ? ids[0] : null;
}

function selectSummaryEventId(
  lines: readonly PlatformEarningLine[],
): string | null {
  const ids = uniqueStrings(
    lines.map((line) => line.eventId),
  );
  return ids.length === 1 ? ids[0] : null;
}

function uniqueStrings(
  values: readonly (string | null)[],
): readonly string[] {
  return [...new Set(values.filter(isString))].sort();
}

function isString(value: string | null): value is string {
  return typeof value === "string" && value.length > 0;
}

function assertPermission(
  actor: Actor,
  permissionCode: Permission,
): PermissionContract {
  PermissionGuard.assertAdminActor(actor);
  const permission =
    PermissionResolver.resolve(permissionCode);
  PermissionGuard.assert(actor, permission);
  return permission;
}

function assertBatchStatus(
  batch: PlatformEarningBatch,
  allowed: readonly PlatformEarningBatchStatus[],
  operation: string,
): void {
  if (allowed.includes(batch.status)) {
    return;
  }
  throw new RevenueLedgerStateError(
    `${operation} is not allowed while batch ${batch.id} is ${batch.status}`,
  );
}

function assertBatchSourceDateRangeOrder(
  sourceDateFrom: number,
  sourceDateTo: number,
): void {
  if (sourceDateTo < sourceDateFrom) {
    throw new RevenueLedgerValidationError(
      "sourceDateTo must be greater than or equal to sourceDateFrom",
    );
  }
}

function assertLineSourceDateWithinBatchRange(
  batch: PlatformEarningBatch,
  sourceDate: number,
): void {
  if (
    sourceDate < batch.sourceDateFrom ||
    sourceDate > batch.sourceDateTo
  ) {
    throw new RevenueLedgerValidationError(
      `sourceDate must be within batch sourceDateFrom/sourceDateTo range for batch ${batch.id}`,
    );
  }
}

function hasDraftBatchSourceContextChange(
  batch: PlatformEarningBatch,
  input: UpdatePlatformEarningBatchCommand,
): boolean {
  return (
    (input.platformAccountId !== undefined &&
      input.platformAccountId !==
        batch.platformAccountId) ||
    (input.talentGroupId !== undefined &&
      input.talentGroupId !== batch.talentGroupId) ||
    (input.sourceDateFrom !== undefined &&
      input.sourceDateFrom !== batch.sourceDateFrom) ||
    (input.sourceDateTo !== undefined &&
      input.sourceDateTo !== batch.sourceDateTo)
  );
}

function assertSourceLineMatchesBatchContext(
  batch: PlatformEarningBatch,
  line: PlatformEarningLine,
): void {
  if (line.batchId !== batch.id) {
    throw new RevenueLedgerStateError(
      `Platform earning source line does not belong to batch ${batch.id}: ${line.id}`,
    );
  }
  if (line.batchStatus !== batch.status) {
    throw new RevenueLedgerStateError(
      `Platform earning source line status does not match batch status for line ${line.id}`,
    );
  }
  if (
    line.platform !== batch.platform ||
    line.platformAccountId !== batch.platformAccountId ||
    line.periodMonth !== batch.periodMonth ||
    line.sourceType !== batch.sourceType ||
    line.sourceUnit !== batch.sourceUnit ||
    line.talentGroupId !== batch.talentGroupId
  ) {
    throw new RevenueLedgerStateError(
      `Platform earning source line context does not match batch context for line ${line.id}`,
    );
  }
}

function normalizeRequiredText(
  value: unknown,
  field: string,
): string {
  if (typeof value !== "string") {
    throw new RevenueLedgerValidationError(
      `${field} must be a string`,
    );
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new RevenueLedgerValidationError(
      `${field} is required`,
    );
  }
  return normalized;
}

function normalizeOptionalTextValue(
  value: unknown,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return normalizeRequiredText(value, "value");
}

function normalizeOptionalNullableText(
  value: unknown,
  field: string,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return normalizeRequiredText(value, field);
}

function normalizeOptionalNullableId(
  value: unknown,
  field: string,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return normalizeRequiredText(value, field);
}

function normalizeTimestamp(
  value: unknown,
  field: string,
): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value)
  ) {
    throw new RevenueLedgerValidationError(
      `${field} must be an integer UTC timestamp`,
    );
  }
  return value;
}

function normalizeOptionalTimestamp(
  value: unknown,
  field: string,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  return normalizeTimestamp(value, field);
}

function normalizeOptionalNullableTimestamp(
  value: unknown,
  field: string,
): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  return normalizeTimestamp(value, field);
}

function normalizePeriodMonth(value: unknown): string {
  const normalized = normalizeRequiredText(
    value,
    "periodMonth",
  );
  if (!/^\d{4}-\d{2}$/u.test(normalized)) {
    throw new RevenueLedgerValidationError(
      "periodMonth must use YYYY-MM format",
    );
  }
  return normalized;
}

function normalizeOptionalPeriodMonth(
  value: unknown,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return normalizePeriodMonth(value);
}

function normalizeSourceType(
  value: unknown,
): PlatformEarningSourceType {
  if (typeof value !== "string") {
    throw new RevenueLedgerValidationError(
      `sourceType must be one of ${PLATFORM_EARNING_SOURCE_TYPES.join(", ")}`,
    );
  }
  const normalized = value.trim().toUpperCase();
  if (
    PLATFORM_EARNING_SOURCE_TYPES.includes(
      normalized as PlatformEarningSourceType,
    )
  ) {
    return normalized as PlatformEarningSourceType;
  }
  throw new RevenueLedgerValidationError(
    `sourceType must be one of ${PLATFORM_EARNING_SOURCE_TYPES.join(", ")}`,
  );
}

function normalizeOptionalSourceType(
  value: unknown,
): PlatformEarningSourceType | undefined {
  if (value === undefined) {
    return undefined;
  }
  return normalizeSourceType(value);
}

function normalizeOptionalBatchStatus(
  value: unknown,
): PlatformEarningBatchStatus | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new RevenueLedgerValidationError(
      "status must be a string",
    );
  }
  const normalized = value.trim().toUpperCase();
  if (
    PLATFORM_EARNING_BATCH_STATUSES.includes(
      normalized as PlatformEarningBatchStatus,
    )
  ) {
    return normalized as PlatformEarningBatchStatus;
  }
  throw new RevenueLedgerValidationError(
    `status must be one of ${PLATFORM_EARNING_BATCH_STATUSES.join(", ")}`,
  );
}

function normalizeRawQuantity(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value <= 0
  ) {
    throw new RevenueLedgerInvalidRevenueAmountError(
      "rawQuantity must be a positive number",
    );
  }
  if (!Number.isInteger(value)) {
    throw new RevenueLedgerInvalidRevenueAmountError(
      "rawQuantity must be an integer source quantity",
    );
  }
  return value;
}

function normalizeCurrencyCode(
  value: unknown,
  field: string,
): string {
  if (typeof value !== "string") {
    throw new RevenueLedgerInvalidCurrencyCodeError(
      `${field} must be a string`,
    );
  }
  const normalized = value.trim();
  if (!/^[A-Z]{3}$/u.test(normalized)) {
    throw new RevenueLedgerInvalidCurrencyCodeError(
      `${field} must be exactly 3 uppercase letters`,
    );
  }
  return normalized;
}

function normalizePositiveDecimal(
  value: unknown,
  field: string,
  maxDecimals: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value <= 0
  ) {
    throw new RevenueLedgerInvalidRevenueAmountError(
      `${field} must be a positive decimal`,
    );
  }
  const multiplier = 10 ** maxDecimals;
  const rounded = Math.round(value * multiplier) / multiplier;
  if (Math.abs(value - rounded) > 1e-12) {
    throw new RevenueLedgerInvalidRevenueAmountError(
      `${field} must have at most ${maxDecimals} decimal places`,
    );
  }
  return rounded;
}

function normalizeRate(
  value: unknown,
  field: string,
): number {
  const rate = normalizePositiveDecimal(
    value,
    field,
    6,
  );
  if (rate > 1) {
    throw new RevenueLedgerInvalidRevenueAmountError(
      `${field} must be between 0 and 1`,
    );
  }
  return rate;
}

function normalizeLimit(value: unknown): number {
  if (value === undefined) {
    return 50;
  }
  const parsed =
    typeof value === "string" ? Number(value) : value;
  if (
    typeof parsed !== "number" ||
    !Number.isInteger(parsed) ||
    parsed < 1 ||
    parsed > 100
  ) {
    throw new RevenueLedgerValidationError(
      "limit must be an integer between 1 and 100",
    );
  }
  return parsed;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function canonicalizeSearchToken(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();
}

function toRevenueEntryMutationView(
  record: RevenueEntry,
): CreateRevenueEntryFromPlatformEarningBatchResult {
  return {
    id: record.id,
    revenueEntryCode: record.revenueEntryCode,
    title: record.title,
    subjectTalentId: record.subjectTalentId,
    attributionPlatformAccountId:
      record.attributionPlatformAccountId,
    attributionTalentGroupId:
      record.attributionTalentGroupId,
    attributionEmploymentProfileId:
      record.attributionEmploymentProfileId,
    attributionEventId: record.attributionEventId,
    revenueKind: record.revenueKind,
    entrySource: record.entrySource,
    sourceBatchIds: record.sourceBatchIds,
    sourceSummaryRef: record.sourceSummaryRef,
    sourceLineCount: record.sourceLineCount,
    sourceSummarySnapshot:
      record.sourceSummarySnapshot,
    conversionSnapshot: record.conversionSnapshot,
    platformCutSnapshot: record.platformCutSnapshot,
    commissionableBasisSnapshot:
      record.commissionableBasisSnapshot,
    status: record.status,
    currencyCode: record.currencyCode,
    recognizedAmount: record.recognizedAmount,
    recognizedAt: record.recognizedAt,
    finalizedAt: record.finalizedAt,
    reconciledAt: record.reconciledAt,
    voidedAt: record.voidedAt,
    reconciliationReference:
      record.reconciliationReference,
    description: record.description,
    externalRef: record.externalRef,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}
