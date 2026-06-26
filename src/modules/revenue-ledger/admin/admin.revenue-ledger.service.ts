import crypto from "crypto";
import {
  ClientSession,
  MongoServerError,
} from "mongodb";
import { Actor } from "@core/actor/actor";
import {
  AuthoritativeAdminMutationBridge,
  AuthoritativeMutationControls,
} from "@core/application/authoritative-admin-mutation.bridge";
import { AuthoritativeAdminMutationIdentity } from "@core/application/authoritative-admin-mutation.permission-map";
import { AuditGuard } from "@core/audit/audit.guard";
import { utcMonthBucketFromTimestamp } from "@core/business-code/business-code-bucket";
import {
  BusinessCodeSequenceRepository,
  formatBusinessCode,
} from "@core/business-code/business-code-sequence.repository";
import { SystemInvariantError } from "@core/error/system-error";
import { BaseAppError } from "@core/errors/base.error";
import { Permission } from "@core/permission/permission.enum";
import { PermissionContract } from "@core/permission/permission.contract";
import { PermissionGuard } from "@core/permission/permission.guard";
import { PermissionResolver } from "@core/permission/permission.resolver";
import { getTraceIdOrThrow } from "@core/trace/trace.context";
import {
  createStructuredLogger,
  StructuredLogger,
} from "@infra/logger.adapter";
import { EventStatus } from "@modules/event-assignment/domain/event-assignment.types";
import {
  RevenueLedgerCommissionReadonlyAccess,
} from "@modules/revenue-ledger/domain/revenue-ledger-commission-readonly-access";
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
import { buildRevenueLedgerCodePolicy } from "@modules/revenue-ledger/domain/revenue-ledger-code-policy";
import { RevenueLedgerPlatformAccountReadonlyAccess } from "@modules/revenue-ledger/domain/revenue-ledger-platform-account-readonly-access";
import {
  RevenueEntryRepository,
} from "@modules/revenue-ledger/domain/revenue-ledger.repository";
import { RevenueLedgerTalentReadonlyAccess } from "@modules/revenue-ledger/domain/revenue-ledger-talent-readonly-access";
import {
  financePeriodMonthFromTimestamp,
  requireFinancePeriodAuthority,
} from "@modules/role/domain/finance-scope-authority";
import { StructuredScopeAuthorityService } from "@modules/role/domain/structured-scope-authority";
import {
  REVENUE_ENTRY_KINDS,
  REVENUE_ENTRY_SOURCES,
  RevenueEntry,
  RevenueEntryMutationView,
  RevenueEntrySource,
  RevenueKind,
} from "@modules/revenue-ledger/domain/revenue-ledger.types";
import {
  ArchiveRevenueEntryCommand,
  CreateRevenueEntryCommand,
  FinalizeRevenueEntryCommand,
  ReconcileRevenueEntryCommand,
  RevenueEntryMutationResult,
  UpdateRevenueEntryDraftCoreCommand,
  VoidRevenueEntryCommand,
} from "@modules/revenue-ledger/shared/revenue-ledger.contracts";

const EVENT_STATUSES_ALLOWED_FOR_ATTRIBUTION =
  new Set<EventStatus>([
    "PLANNED",
    "CONFIRMED",
    "COMPLETED",
  ]);

type RevenueLedgerMutationFailureClassification =
  | "validation"
  | "conflict"
  | "not_found"
  | "state_error"
  | "invalid_talent_reference"
  | "invalid_platform_attribution"
  | "invalid_event_attribution"
  | "invalid_currency_code"
  | "invalid_revenue_amount"
  | "permission_scope"
  | "invariant"
  | "unknown";

interface NormalizedCreateCommand {
  readonly revenueEntryCode: string | undefined;
  readonly title: string;
  readonly normalizedTitle: string;
  readonly subjectTalentId: string;
  readonly attributionPlatformAccountId: string | null;
  readonly attributionEventId: string | null;
  readonly revenueKind: RevenueKind;
  readonly entrySource: RevenueEntrySource;
  readonly currencyCode: string;
  readonly recognizedAmount: number;
  readonly recognizedAt: number;
  readonly description: string | null;
  readonly externalRef: string | null;
}

interface NormalizedUpdateDraftCoreCommand {
  readonly revenueEntryId: string;
  readonly title?: string;
  readonly normalizedTitle?: string;
  readonly description?: string | null;
  readonly externalRef?: string | null;
  readonly subjectTalentId?: string;
  readonly attributionPlatformAccountId?: string | null;
  readonly attributionEventId?: string | null;
  readonly revenueKind?: RevenueKind;
  readonly currencyCode?: string;
  readonly recognizedAmount?: number;
  readonly recognizedAt?: number;
}

interface NormalizedLifecycleCommand {
  readonly revenueEntryId: string;
}

interface NormalizedReconcileCommand
  extends NormalizedLifecycleCommand {
  readonly reconciliationReference:
    | string
    | null
    | undefined;
}

interface RevenueEntryCandidateState {
  readonly subjectTalentId: string;
  readonly attributionPlatformAccountId: string | null;
  readonly attributionEventId: string | null;
  readonly revenueKind: RevenueKind;
  readonly entrySource: RevenueEntrySource;
  readonly currencyCode: string;
  readonly recognizedAmount: number;
  readonly recognizedAt: number;
}

interface DraftCorePatchBuildResult {
  readonly update: {
    title?: string;
    normalizedTitle?: string;
    description?: string | null;
    externalRef?: string | null;
    subjectTalentId?: string;
    attributionPlatformAccountId?: string | null;
    attributionEventId?: string | null;
    revenueKind?: RevenueKind;
    currencyCode?: string;
    recognizedAmount?: number;
    recognizedAt?: number;
  };
  readonly candidate: RevenueEntryCandidateState;
  readonly changedFields: readonly string[];
}

export class RevenueLedgerAdminService {
  constructor(
    private readonly repository: RevenueEntryRepository,
    private readonly codeSequenceRepository: BusinessCodeSequenceRepository,
    private readonly talentReadonlyAccess: RevenueLedgerTalentReadonlyAccess,
    private readonly platformAccountReadonlyAccess: RevenueLedgerPlatformAccountReadonlyAccess,
    private readonly eventReadonlyAccess: RevenueLedgerEventReadonlyAccess,
    private readonly commissionReadonlyAccess: RevenueLedgerCommissionReadonlyAccess,
    private readonly audit: AuditGuard,
    private readonly mutationBridge: AuthoritativeAdminMutationBridge,
    private readonly structuredAuthority?: StructuredScopeAuthorityService,
    private readonly logger: StructuredLogger = createStructuredLogger(),
  ) {}

  async createRevenueEntry(
    actor: Actor,
    command: CreateRevenueEntryCommand,
  ): Promise<RevenueEntryMutationResult> {
    const operation = "revenue-ledger.create";
    const permission = this.assertPermission(
      actor,
      Permission.REVENUE_LEDGER_CREATE,
    );
    const input = normalizeCreateCommand(command);

    try {
      return await this.executeMutation(
        actor,
        permission,
        operation,
        {
          revenueEntryCode: readOptionalLogString(
            command.revenueEntryCode,
          ),
          subjectTalentId: input.subjectTalentId,
          attributionPlatformAccountId:
            input.attributionPlatformAccountId,
          attributionEventId:
            input.attributionEventId,
          revenueKind: input.revenueKind,
          entrySource: input.entrySource,
        },
        async (session) => {
          const scope = await this.requireFinanceAuthorityForTimestamp(
            actor,
            permission.code,
            input.recognizedAt,
          );

          if (input.revenueEntryCode !== undefined) {
            const existingByCode =
              await this.repository.findByRevenueEntryCode(
                input.revenueEntryCode,
                session,
              );

            if (existingByCode) {
              throw new RevenueLedgerConflictError(
                `Revenue entry code already exists: ${input.revenueEntryCode}`,
              );
            }
          }

          const candidate: RevenueEntryCandidateState = {
            subjectTalentId: input.subjectTalentId,
            attributionPlatformAccountId:
              input.attributionPlatformAccountId,
            attributionEventId:
              input.attributionEventId,
            revenueKind: input.revenueKind,
            entrySource: input.entrySource,
            currencyCode: input.currencyCode,
            recognizedAmount:
              input.recognizedAmount,
            recognizedAt: input.recognizedAt,
          };

          await this.assertCandidateStateValid(
            candidate,
            session,
          );

          let revenueEntry!: RevenueEntry;
          const maxAttempts =
            input.revenueEntryCode === undefined
              ? 5
              : 1;

          for (
            let attempt = 1;
            attempt <= maxAttempts;
            attempt += 1
          ) {
            const revenueEntryCode =
              input.revenueEntryCode ??
              (await this.allocateGeneratedCode(
                input.recognizedAt,
                session,
              ));
            const now = Date.now();
            revenueEntry = {
              id: crypto.randomUUID(),
              revenueEntryCode,
              title: input.title,
              normalizedTitle:
                input.normalizedTitle,
              subjectTalentId:
                input.subjectTalentId,
              attributionPlatformAccountId:
                input.attributionPlatformAccountId,
              attributionTalentGroupId: null,
              attributionEmploymentProfileId: null,
              attributionEventId:
                input.attributionEventId,
              revenueKind: input.revenueKind,
              entrySource: input.entrySource,
              sourceBatchIds: [],
              sourceSummaryRef: null,
              sourceLineCount: null,
              sourceSummarySnapshot: null,
              conversionSnapshot: null,
              platformCutSnapshot: null,
              commissionableBasisSnapshot: null,
              status: "DRAFT",
              currencyCode: input.currencyCode,
              recognizedAmount:
                input.recognizedAmount,
              recognizedAt: input.recognizedAt,
              finalizedAt: null,
              reconciledAt: null,
              voidedAt: null,
              reconciliationReference: null,
              description: input.description,
              externalRef: input.externalRef,
              createdAt: now,
              updatedAt: now,
            };

            try {
              await this.repository.insert(
                revenueEntry,
                session,
              );
              break;
            } catch (error) {
              if (!isDuplicateKeyError(error)) {
                throw error;
              }

              if (
                input.revenueEntryCode !== undefined
              ) {
                throw new RevenueLedgerConflictError(
                  "Revenue entry code already exists",
                );
              }

              if (attempt >= maxAttempts) {
                throw new RevenueLedgerConflictError(
                  "Generated revenue entry code conflict detected on create",
                );
              }
            }
          }

          await this.recordAudit({
            actor,
            permission,
            revenueEntryId: revenueEntry.id,
            mutationType: operation,
            metadata: {
              status: revenueEntry.status,
              revenueEntryCode:
                revenueEntry.revenueEntryCode,
              subjectTalentId:
                revenueEntry.subjectTalentId,
              attributionPlatformAccountId:
                revenueEntry.attributionPlatformAccountId,
              attributionEventId:
                revenueEntry.attributionEventId,
              revenueKind: revenueEntry.revenueKind,
              entrySource: revenueEntry.entrySource,
              currencyCode:
                revenueEntry.currencyCode,
              recognizedAmount:
                revenueEntry.recognizedAmount,
              recognizedAt:
                revenueEntry.recognizedAt,
              effectiveScope: scope,
            },
            session,
          });

          return toRevenueEntryMutationView(
            revenueEntry,
          );
        },
        (result) => ({
          revenueEntryId: result.id,
          status: result.status,
        }),
      );
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new RevenueLedgerConflictError(
          "Revenue entry code already exists",
        );
      }

      throw error;
    }
  }

  async updateRevenueEntryDraftCore(
    actor: Actor,
    command: UpdateRevenueEntryDraftCoreCommand,
  ): Promise<RevenueEntryMutationResult> {
    const operation = "revenue-ledger.update-draft-core";
    const permission = this.assertPermission(
      actor,
      Permission.REVENUE_LEDGER_UPDATE,
    );
    const input =
      normalizeUpdateDraftCoreCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        revenueEntryId: input.revenueEntryId,
      },
      async (session) => {
        const current = await this.requireRevenueEntry(
          input.revenueEntryId,
          session,
        );
        const scope = await this.requireFinanceAuthorityForTimestamp(
          actor,
          permission.code,
          current.recognizedAt,
        );

        if (current.status !== "DRAFT") {
          throw new RevenueLedgerStateError(
            `updateRevenueEntryDraftCore is allowed only while entry is DRAFT: ${current.id}`,
          );
        }

        const patch = buildDraftCorePatch(
          current,
          input,
        );
        const newPeriod = financePeriodMonthFromTimestamp(
          patch.candidate.recognizedAt,
        );
        if (newPeriod !== scope.financePeriod) {
          await this.requireFinanceAuthorityForTimestamp(
            actor,
            permission.code,
            patch.candidate.recognizedAt,
          );
        }
        await this.assertCandidateStateValid(
          patch.candidate,
          session,
        );

        const updated =
          await this.repository.updateDraftCore(
            {
              revenueEntryId: current.id,
              ...patch.update,
              updatedAt: Date.now(),
            },
            session,
          );

        if (!updated) {
          throw new RevenueLedgerStateError(
            `updateRevenueEntryDraftCore failed because entry is no longer mutable in current state: ${current.id}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          revenueEntryId: updated.id,
          mutationType: operation,
          metadata: {
            changedFields: patch.changedFields,
            revenueEntryCode:
              updated.revenueEntryCode,
            subjectTalentId:
              updated.subjectTalentId,
            attributionPlatformAccountId:
              updated.attributionPlatformAccountId,
            attributionEventId:
              updated.attributionEventId,
            revenueKind: updated.revenueKind,
            currencyCode: updated.currencyCode,
            recognizedAmount:
              updated.recognizedAmount,
            recognizedAt: updated.recognizedAt,
            ...buildDraftCoreAuditDelta(
              current,
              updated,
              patch.changedFields,
            ),
            effectiveScope: scope,
          },
          session,
        });

        return toRevenueEntryMutationView(updated);
      },
      (result) => ({
        revenueEntryId: result.id,
        status: result.status,
      }),
    );
  }

  async finalizeRevenueEntry(
    actor: Actor,
    command: FinalizeRevenueEntryCommand,
  ): Promise<RevenueEntryMutationResult> {
    const operation = "revenue-ledger.finalize";
    const permission = this.assertPermission(
      actor,
      Permission.REVENUE_LEDGER_MANAGE_LIFECYCLE,
    );
    const input = normalizeLifecycleCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        revenueEntryId: input.revenueEntryId,
      },
      async (session) => {
        const current = await this.requireRevenueEntry(
          input.revenueEntryId,
          session,
        );
        const scope = await this.requireFinanceAuthorityForTimestamp(
          actor,
          permission.code,
          current.recognizedAt,
        );

        if (current.status !== "DRAFT") {
          throw new RevenueLedgerStateError(
            `finalizeRevenueEntry is allowed only while entry is DRAFT: ${current.id}`,
          );
        }

        const candidate: RevenueEntryCandidateState = {
          subjectTalentId: current.subjectTalentId,
          attributionPlatformAccountId:
            current.attributionPlatformAccountId,
          attributionEventId:
            current.attributionEventId,
          revenueKind: current.revenueKind,
          entrySource: current.entrySource,
          currencyCode: current.currencyCode,
          recognizedAmount:
            current.recognizedAmount,
          recognizedAt: current.recognizedAt,
        };
        await this.assertCandidateStateValid(
          candidate,
          session,
        );

        const now = Date.now();
        const updated =
          await this.repository.transitionStatus(
            {
              revenueEntryId: current.id,
              fromStatuses: ["DRAFT"],
              toStatus: "FINALIZED",
              finalizedAt: now,
              updatedAt: now,
            },
            session,
          );

        if (!updated) {
          throw new RevenueLedgerStateError(
            `finalizeRevenueEntry failed because entry is no longer mutable in current state: ${current.id}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          revenueEntryId: updated.id,
          mutationType: operation,
          metadata: {
            previousStatus: current.status,
            nextStatus: updated.status,
            finalizedAt: updated.finalizedAt,
            revenueEntryCode:
              updated.revenueEntryCode,
            subjectTalentId:
              updated.subjectTalentId,
            attributionPlatformAccountId:
              updated.attributionPlatformAccountId,
            attributionEventId:
              updated.attributionEventId,
            revenueKind: updated.revenueKind,
            entrySource: updated.entrySource,
            currencyCode: updated.currencyCode,
            recognizedAmount:
              updated.recognizedAmount,
            recognizedAt: updated.recognizedAt,
            effectiveScope: scope,
          },
          session,
        });

        return toRevenueEntryMutationView(updated);
      },
      (result) => ({
        revenueEntryId: result.id,
        status: result.status,
      }),
    );
  }

  async reconcileRevenueEntry(
    actor: Actor,
    command: ReconcileRevenueEntryCommand,
  ): Promise<RevenueEntryMutationResult> {
    const operation = "revenue-ledger.reconcile";
    const permission = this.assertPermission(
      actor,
      Permission.REVENUE_LEDGER_RECONCILE,
    );
    const input = normalizeReconcileCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        revenueEntryId: input.revenueEntryId,
      },
      async (session) => {
        const current = await this.requireRevenueEntry(
          input.revenueEntryId,
          session,
        );
        const scope = await this.requireFinanceAuthorityForTimestamp(
          actor,
          permission.code,
          current.recognizedAt,
        );

        if (current.status !== "FINALIZED") {
          throw new RevenueLedgerStateError(
            `reconcileRevenueEntry is allowed only while entry is FINALIZED: ${current.id}`,
          );
        }

        const candidate: RevenueEntryCandidateState = {
          subjectTalentId: current.subjectTalentId,
          attributionPlatformAccountId:
            current.attributionPlatformAccountId,
          attributionEventId:
            current.attributionEventId,
          revenueKind: current.revenueKind,
          entrySource: current.entrySource,
          currencyCode: current.currencyCode,
          recognizedAmount:
            current.recognizedAmount,
          recognizedAt: current.recognizedAt,
        };
        await this.assertCandidateStateValid(
          candidate,
          session,
        );

        const now = Date.now();
        const updated =
          await this.repository.transitionStatus(
            {
              revenueEntryId: current.id,
              fromStatuses: ["FINALIZED"],
              toStatus: "RECONCILED",
              reconciledAt: now,
              reconciliationReference:
                input.reconciliationReference ===
                undefined
                  ? current.reconciliationReference
                  : input.reconciliationReference,
              updatedAt: now,
            },
            session,
          );

        if (!updated) {
          throw new RevenueLedgerStateError(
            `reconcileRevenueEntry failed because entry is no longer mutable in current state: ${current.id}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          revenueEntryId: updated.id,
          mutationType: operation,
          metadata: {
            previousStatus: current.status,
            nextStatus: updated.status,
            reconciledAt: updated.reconciledAt,
            revenueEntryCode:
              updated.revenueEntryCode,
            reconciliationReferenceBefore:
              current.reconciliationReference,
            reconciliationReferenceAfter:
              updated.reconciliationReference,
            effectiveScope: scope,
          },
          session,
        });

        return toRevenueEntryMutationView(updated);
      },
      (result) => ({
        revenueEntryId: result.id,
        status: result.status,
      }),
    );
  }

  async voidRevenueEntry(
    actor: Actor,
    command: VoidRevenueEntryCommand,
  ): Promise<RevenueEntryMutationResult> {
    const operation = "revenue-ledger.void";
    const permission = this.assertPermission(
      actor,
      Permission.REVENUE_LEDGER_MANAGE_LIFECYCLE,
    );
    const input = normalizeLifecycleCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        revenueEntryId: input.revenueEntryId,
      },
      async (session) => {
        const current = await this.requireRevenueEntry(
          input.revenueEntryId,
          session,
        );
        const scope = await this.requireFinanceAuthorityForTimestamp(
          actor,
          permission.code,
          current.recognizedAt,
        );

        if (current.status !== "FINALIZED") {
          throw new RevenueLedgerStateError(
            `voidRevenueEntry is allowed only while entry is FINALIZED: ${current.id}`,
          );
        }

        await this.assertNoFinalizedCommissionSettlementDependency(
          current.id,
          session,
        );

        const now = Date.now();
        const updated =
          await this.repository.transitionStatus(
            {
              revenueEntryId: current.id,
              fromStatuses: ["FINALIZED"],
              toStatus: "VOIDED",
              voidedAt: now,
              updatedAt: now,
            },
            session,
          );

        if (!updated) {
          throw new RevenueLedgerStateError(
            `voidRevenueEntry failed because entry is no longer mutable in current state: ${current.id}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          revenueEntryId: updated.id,
          mutationType: operation,
          metadata: {
            previousStatus: current.status,
            nextStatus: updated.status,
            voidedAt: updated.voidedAt,
            revenueEntryCode:
              updated.revenueEntryCode,
            effectiveScope: scope,
          },
          session,
        });

        return toRevenueEntryMutationView(updated);
      },
      (result) => ({
        revenueEntryId: result.id,
        status: result.status,
      }),
    );
  }

  async archiveRevenueEntry(
    actor: Actor,
    command: ArchiveRevenueEntryCommand,
  ): Promise<RevenueEntryMutationResult> {
    const operation = "revenue-ledger.archive";
    const permission = this.assertPermission(
      actor,
      Permission.REVENUE_LEDGER_MANAGE_LIFECYCLE,
    );
    const input = normalizeLifecycleCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        revenueEntryId: input.revenueEntryId,
      },
      async (session) => {
        const current = await this.requireRevenueEntry(
          input.revenueEntryId,
          session,
        );
        const scope = await this.requireFinanceAuthorityForTimestamp(
          actor,
          permission.code,
          current.recognizedAt,
        );

        if (
          current.status !== "DRAFT" &&
          current.status !== "RECONCILED" &&
          current.status !== "VOIDED"
        ) {
          throw new RevenueLedgerStateError(
            `archiveRevenueEntry is allowed only from DRAFT, RECONCILED, or VOIDED: ${current.id}`,
          );
        }

        const updated =
          await this.repository.transitionStatus(
            {
              revenueEntryId: current.id,
              fromStatuses: [
                "DRAFT",
                "RECONCILED",
                "VOIDED",
              ],
              toStatus: "ARCHIVED",
              updatedAt: Date.now(),
            },
            session,
          );

        if (!updated) {
          throw new RevenueLedgerStateError(
            `archiveRevenueEntry failed because entry is no longer mutable in current state: ${current.id}`,
          );
        }

        await this.recordAudit({
          actor,
          permission,
          revenueEntryId: updated.id,
          mutationType: operation,
          metadata: {
            previousStatus: current.status,
            nextStatus: updated.status,
            revenueEntryCode:
              updated.revenueEntryCode,
            effectiveScope: scope,
          },
          session,
        });

        return toRevenueEntryMutationView(updated);
      },
      (result) => ({
        revenueEntryId: result.id,
        status: result.status,
      }),
    );
  }

  private assertPermission(
    actor: Actor,
    permissionCode: Permission,
  ): PermissionContract {
    assertAdminActorType(actor);

    const permission =
      PermissionResolver.resolve(permissionCode);
    PermissionGuard.assert(actor, permission);

    return permission;
  }

  private async requireRevenueEntry(
    revenueEntryId: string,
    session: ClientSession,
  ): Promise<RevenueEntry> {
    const record = await this.repository.findById(
      revenueEntryId,
      session,
    );

    if (!record) {
      throw new RevenueLedgerNotFoundError(
        revenueEntryId,
      );
    }

    return record;
  }

  private async allocateGeneratedCode(
    recognizedAt: number,
    session: ClientSession,
  ): Promise<string> {
    const bucket =
      utcMonthBucketFromTimestamp(recognizedAt);
    const policy =
      buildRevenueLedgerCodePolicy(bucket);
    const maxExisting =
      await this.repository.findMaxGeneratedRevenueEntryCodeSequence(
        policy,
        session,
      );
    await this.codeSequenceRepository.ensureAtLeast(
      policy.moduleKey,
      policy.bucket,
      maxExisting,
      session,
    );
    const next =
      await this.codeSequenceRepository.allocateNext(
        policy.moduleKey,
        policy.bucket,
        session,
      );

    return formatBusinessCode(policy, next);
  }

  private async assertCandidateStateValid(
    candidate: RevenueEntryCandidateState,
    session: ClientSession,
  ): Promise<void> {
    const evaluationTime = Date.now();
    assertEntrySourceRule(candidate.entrySource);
    assertCurrencyCodeRule(candidate.currencyCode);
    assertRevenueAmountRule(
      candidate.recognizedAmount,
    );
    assertRecognizedAtRule(
      candidate.recognizedAt,
      evaluationTime,
    );
    assertRevenueKindCompatibilityRule(candidate);
    await this.assertSubjectTalentResolvable(
      candidate.subjectTalentId,
      session,
    );
    await this.assertPlatformAttributionResolvable(
      candidate.attributionPlatformAccountId,
      session,
    );
    await this.assertEventAttributionValid(
      candidate.attributionEventId,
      candidate.subjectTalentId,
      candidate.attributionPlatformAccountId,
      session,
    );
  }

  private async assertSubjectTalentResolvable(
    subjectTalentId: string,
    session: ClientSession,
  ): Promise<void> {
    const talent =
      await this.talentReadonlyAccess.findById(
        subjectTalentId,
        session,
      );

    if (talent) {
      return;
    }

    throw new RevenueLedgerInvalidTalentReferenceError(
      `Subject talent does not exist: ${subjectTalentId}`,
    );
  }

  private async assertPlatformAttributionResolvable(
    attributionPlatformAccountId: string | null,
    session: ClientSession,
  ): Promise<void> {
    if (!attributionPlatformAccountId) {
      return;
    }

    const platformAccount =
      await this.platformAccountReadonlyAccess.findById(
        attributionPlatformAccountId,
        session,
      );

    if (platformAccount) {
      return;
    }

    throw new RevenueLedgerInvalidPlatformAttributionError(
      `Attributed platform account does not exist: ${attributionPlatformAccountId}`,
    );
  }

  private async assertEventAttributionValid(
    attributionEventId: string | null,
    subjectTalentId: string,
    attributionPlatformAccountId: string | null,
    session: ClientSession,
  ): Promise<void> {
    if (!attributionEventId) {
      return;
    }

    const event = await this.eventReadonlyAccess.findById(
      attributionEventId,
      session,
    );

    if (!event) {
      throw new RevenueLedgerInvalidEventAttributionError(
        `Attributed event does not exist: ${attributionEventId}`,
      );
    }

    if (
      !EVENT_STATUSES_ALLOWED_FOR_ATTRIBUTION.has(
        event.status,
      )
    ) {
      throw new RevenueLedgerInvalidEventAttributionError(
        `Attributed event must be PLANNED, CONFIRMED, or COMPLETED: ${attributionEventId}`,
      );
    }

    const hasActiveTalentAssignment =
      await this.eventReadonlyAccess.hasActiveTalentAssignment(
        attributionEventId,
        subjectTalentId,
        session,
      );

    if (!hasActiveTalentAssignment) {
      throw new RevenueLedgerInvalidEventAttributionError(
        `Attributed event must contain an ACTIVE TALENT assignment for subjectTalentId ${subjectTalentId}: ${attributionEventId}`,
      );
    }

    if (
      attributionPlatformAccountId &&
      !event.platformAccountIds.includes(
        attributionPlatformAccountId,
      )
    ) {
      throw new RevenueLedgerInvalidEventAttributionError(
        `Attributed event must include platformAccountId ${attributionPlatformAccountId}: ${attributionEventId}`,
      );
    }
  }

  private async assertNoFinalizedCommissionSettlementDependency(
    revenueEntryId: string,
    session: ClientSession,
  ): Promise<void> {
    const reference =
      await this.commissionReadonlyAccess.findFinalizedSettlementReferenceByRevenueEntryId(
        revenueEntryId,
        session,
      );

    if (!reference) {
      return;
    }

    throw new RevenueLedgerConflictError(
      `voidRevenueEntry is forbidden because RevenueEntry ${revenueEntryId} is referenced by FINALIZED CommissionSettlement ${reference.commissionSettlementId}`,
    );
  }

  private async requireFinanceAuthorityForTimestamp(
    actor: Actor,
    permission: Permission,
    recognizedAt: number,
  ): Promise<{ readonly financePeriod: string }> {
    const financePeriod =
      financePeriodMonthFromTimestamp(recognizedAt);
    if (!financePeriod) {
      throw new RevenueLedgerPermissionScopeError(
        "Revenue Entry requires valid recognizedAt-derived financePeriod",
      );
    }
    if (!this.structuredAuthority) {
      throw new RevenueLedgerPermissionScopeError(
        "Revenue Entry requires structured finance authority wiring",
      );
    }

    await requireFinancePeriodAuthority({
      actor,
      permission,
      periodMonth: financePeriod,
      authority: this.structuredAuthority,
      error: new RevenueLedgerPermissionScopeError(
        "Revenue Entry requires financePeriod(YYYY-MM from recognizedAt) or financeGlobal structured authority",
      ),
    });

    return { financePeriod };
  }

  private async recordAudit(params: {
    readonly actor: Actor;
    readonly permission: PermissionContract;
    readonly revenueEntryId: string;
    readonly mutationType: AuthoritativeAdminMutationIdentity;
    readonly metadata: Readonly<Record<string, unknown>>;
    readonly session: ClientSession;
  }): Promise<void> {
    await this.audit.record(
      params.actor,
      params.permission,
      params.revenueEntryId,
      {
        mutationType: params.mutationType,
        targetId: params.revenueEntryId,
        targetType: "revenue-entry",
        actorId: params.actor.id,
        ...params.metadata,
      },
      params.session,
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
    onSuccess: (
      result: T,
    ) => Readonly<Record<string, unknown>>,
  ): Promise<T> {
    this.logMutationEvent(
      actor,
      operation,
      "mutation.start",
      startMetadata,
    );

    try {
      const traceId = getTraceIdOrThrow();
      const result = await this.mutationBridge.execute(
        {
          actor,
          traceId,
          requiredPermission: permission,
          mutationIdentity: operation,
          mutationTargetDescriptor:
            buildMutationTargetDescriptor(
              startMetadata,
            ),
        },
        async (session, controls) =>
          fn(session, controls),
      );

      this.logMutationEvent(
        actor,
        operation,
        "mutation.success",
        {
          ...startMetadata,
          ...onSuccess(result),
        },
      );

      return result;
    } catch (error) {
      this.logger.warn({
        traceId: getTraceIdOrThrow(),
        actorId: actor.id,
        context: actor.context,
        operation,
        status: "mutation.failed",
        timestamp: Date.now(),
        metadata: {
          ...startMetadata,
          classification:
            classifyRevenueLedgerMutationFailure(
              error,
            ),
          errorCode: extractErrorCode(error),
          errorMessage:
            truncateLogMessage(error),
        },
      });

      throw error;
    }
  }

  private logMutationEvent(
    actor: Actor,
    operation: AuthoritativeAdminMutationIdentity,
    status: "mutation.start" | "mutation.success",
    metadata: Readonly<Record<string, unknown>>,
  ): void {
    this.logger.info({
      traceId: getTraceIdOrThrow(),
      actorId: actor.id,
      context: actor.context,
      operation,
      status,
      timestamp: Date.now(),
      metadata,
    });
  }
}

function normalizeCreateCommand(
  command: CreateRevenueEntryCommand,
): NormalizedCreateCommand {
  const title = normalizeRequiredText(
    command.title,
    "title",
  );

  return {
    revenueEntryCode: normalizeOptionalCreateCode(
      command.revenueEntryCode,
      "revenueEntryCode",
    ),
    title,
    normalizedTitle: canonicalizeSearchToken(title),
    subjectTalentId: normalizeRequiredText(
      command.subjectTalentId,
      "subjectTalentId",
    ),
    attributionPlatformAccountId:
      normalizeOptionalNullableId(
        command.attributionPlatformAccountId,
        "attributionPlatformAccountId",
        {
          missingAsNull: true,
        },
      ) ?? null,
    attributionEventId: normalizeOptionalNullableId(
      command.attributionEventId,
      "attributionEventId",
      {
        missingAsNull: true,
      },
    ) ?? null,
    revenueKind: normalizeRevenueKind(
      command.revenueKind,
    ),
    entrySource: normalizeEntrySource(
      command.entrySource,
    ),
    currencyCode: normalizeCurrencyCode(
      command.currencyCode,
      "currencyCode",
    ),
    recognizedAmount: normalizeRecognizedAmount(
      command.recognizedAmount,
      "recognizedAmount",
    ),
    recognizedAt: normalizeTimestamp(
      command.recognizedAt,
      "recognizedAt",
    ),
    description: normalizeOptionalNullableText(
      command.description,
      "description",
      {
        missingAsNull: true,
      },
    ) ?? null,
    externalRef: normalizeOptionalNullableText(
      command.externalRef,
      "externalRef",
      {
        missingAsNull: true,
      },
    ) ?? null,
  };
}

function normalizeOptionalCreateCode(
  value: unknown,
  field: string,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new RevenueLedgerValidationError(
      `${field} must be a string`,
    );
  }

  const normalized = value.trim();
  return normalized.length > 0
    ? normalized
    : undefined;
}

function normalizeUpdateDraftCoreCommand(
  command: UpdateRevenueEntryDraftCoreCommand,
): NormalizedUpdateDraftCoreCommand {
  const title = normalizeOptionalText(
    command.title,
    "title",
  );

  return {
    revenueEntryId: normalizeRequiredText(
      command.revenueEntryId,
      "revenueEntryId",
    ),
    title,
    normalizedTitle:
      title === undefined
        ? undefined
        : canonicalizeSearchToken(title),
    description: normalizeOptionalNullableText(
      command.description,
      "description",
      {
        missingAsUndefined: true,
      },
    ),
    externalRef: normalizeOptionalNullableText(
      command.externalRef,
      "externalRef",
      {
        missingAsUndefined: true,
      },
    ),
    subjectTalentId: normalizeOptionalText(
      command.subjectTalentId,
      "subjectTalentId",
    ),
    attributionPlatformAccountId:
      normalizeOptionalNullableId(
        command.attributionPlatformAccountId,
        "attributionPlatformAccountId",
        {
          missingAsUndefined: true,
        },
      ),
    attributionEventId: normalizeOptionalNullableId(
      command.attributionEventId,
      "attributionEventId",
      {
        missingAsUndefined: true,
      },
    ),
    revenueKind:
      command.revenueKind === undefined
        ? undefined
        : normalizeRevenueKind(
            command.revenueKind,
          ),
    currencyCode:
      command.currencyCode === undefined
        ? undefined
        : normalizeCurrencyCode(
            command.currencyCode,
            "currencyCode",
          ),
    recognizedAmount:
      command.recognizedAmount === undefined
        ? undefined
        : normalizeRecognizedAmount(
            command.recognizedAmount,
            "recognizedAmount",
          ),
    recognizedAt: normalizeOptionalTimestamp(
      command.recognizedAt,
      "recognizedAt",
    ),
  };
}

function normalizeLifecycleCommand(
  command:
    | FinalizeRevenueEntryCommand
    | VoidRevenueEntryCommand
    | ArchiveRevenueEntryCommand,
): NormalizedLifecycleCommand {
  return {
    revenueEntryId: normalizeRequiredText(
      command.revenueEntryId,
      "revenueEntryId",
    ),
  };
}

function normalizeReconcileCommand(
  command: ReconcileRevenueEntryCommand,
): NormalizedReconcileCommand {
  return {
    revenueEntryId: normalizeRequiredText(
      command.revenueEntryId,
      "revenueEntryId",
    ),
    reconciliationReference:
      normalizeOptionalNullableText(
        command.reconciliationReference,
        "reconciliationReference",
        {
          missingAsUndefined: true,
        },
      ),
  };
}

function buildDraftCorePatch(
  current: RevenueEntry,
  input: NormalizedUpdateDraftCoreCommand,
): DraftCorePatchBuildResult {
  const update: DraftCorePatchBuildResult["update"] =
    {};
  const changedFields: string[] = [];

  if (
    input.title !== undefined &&
    input.title !== current.title
  ) {
    update.title = input.title;
    update.normalizedTitle = input.normalizedTitle;
    changedFields.push("title");
  }

  if (
    input.description !== undefined &&
    input.description !== current.description
  ) {
    update.description = input.description;
    changedFields.push("description");
  }

  if (
    input.externalRef !== undefined &&
    input.externalRef !== current.externalRef
  ) {
    update.externalRef = input.externalRef;
    changedFields.push("externalRef");
  }

  if (
    input.subjectTalentId !== undefined &&
    input.subjectTalentId !== current.subjectTalentId
  ) {
    update.subjectTalentId = input.subjectTalentId;
    changedFields.push("subjectTalentId");
  }

  if (
    input.attributionPlatformAccountId !== undefined &&
    input.attributionPlatformAccountId !==
      current.attributionPlatformAccountId
  ) {
    update.attributionPlatformAccountId =
      input.attributionPlatformAccountId;
    changedFields.push(
      "attributionPlatformAccountId",
    );
  }

  if (
    input.attributionEventId !== undefined &&
    input.attributionEventId !==
      current.attributionEventId
  ) {
    update.attributionEventId =
      input.attributionEventId;
    changedFields.push("attributionEventId");
  }

  if (
    input.revenueKind !== undefined &&
    input.revenueKind !== current.revenueKind
  ) {
    update.revenueKind = input.revenueKind;
    changedFields.push("revenueKind");
  }

  if (
    input.currencyCode !== undefined &&
    input.currencyCode !== current.currencyCode
  ) {
    update.currencyCode = input.currencyCode;
    changedFields.push("currencyCode");
  }

  if (
    input.recognizedAmount !== undefined &&
    input.recognizedAmount !==
      current.recognizedAmount
  ) {
    update.recognizedAmount =
      input.recognizedAmount;
    changedFields.push("recognizedAmount");
  }

  if (
    input.recognizedAt !== undefined &&
    input.recognizedAt !== current.recognizedAt
  ) {
    update.recognizedAt = input.recognizedAt;
    changedFields.push("recognizedAt");
  }

  const candidate: RevenueEntryCandidateState = {
    subjectTalentId:
      input.subjectTalentId ??
      current.subjectTalentId,
    attributionPlatformAccountId:
      input.attributionPlatformAccountId !==
      undefined
        ? input.attributionPlatformAccountId
        : current.attributionPlatformAccountId,
    attributionEventId:
      input.attributionEventId !== undefined
        ? input.attributionEventId
        : current.attributionEventId,
    revenueKind:
      input.revenueKind ?? current.revenueKind,
    entrySource: current.entrySource,
    currencyCode:
      input.currencyCode ?? current.currencyCode,
    recognizedAmount:
      input.recognizedAmount ??
      current.recognizedAmount,
    recognizedAt:
      input.recognizedAt ?? current.recognizedAt,
  };

  return {
    update,
    candidate,
    changedFields,
  };
}

function buildDraftCoreAuditDelta(
  before: RevenueEntry,
  after: RevenueEntry,
  changedFields: readonly string[],
): Readonly<Record<string, unknown>> {
  const changedSet = new Set(changedFields);
  const metadata: Record<string, unknown> = {};

  if (changedSet.has("title")) {
    metadata.titleBefore = before.title;
    metadata.titleAfter = after.title;
  }

  if (changedSet.has("description")) {
    metadata.descriptionBefore =
      before.description;
    metadata.descriptionAfter = after.description;
  }

  if (changedSet.has("externalRef")) {
    metadata.externalRefBefore =
      before.externalRef;
    metadata.externalRefAfter =
      after.externalRef;
  }

  if (changedSet.has("subjectTalentId")) {
    metadata.subjectTalentIdBefore =
      before.subjectTalentId;
    metadata.subjectTalentIdAfter =
      after.subjectTalentId;
  }

  if (
    changedSet.has("attributionPlatformAccountId")
  ) {
    metadata.attributionPlatformAccountIdBefore =
      before.attributionPlatformAccountId;
    metadata.attributionPlatformAccountIdAfter =
      after.attributionPlatformAccountId;
  }

  if (changedSet.has("attributionEventId")) {
    metadata.attributionEventIdBefore =
      before.attributionEventId;
    metadata.attributionEventIdAfter =
      after.attributionEventId;
  }

  if (changedSet.has("revenueKind")) {
    metadata.revenueKindBefore =
      before.revenueKind;
    metadata.revenueKindAfter =
      after.revenueKind;
  }

  if (changedSet.has("currencyCode")) {
    metadata.currencyCodeBefore =
      before.currencyCode;
    metadata.currencyCodeAfter = after.currencyCode;
  }

  if (changedSet.has("recognizedAmount")) {
    metadata.recognizedAmountBefore =
      before.recognizedAmount;
    metadata.recognizedAmountAfter =
      after.recognizedAmount;
  }

  if (changedSet.has("recognizedAt")) {
    metadata.recognizedAtBefore = before.recognizedAt;
    metadata.recognizedAtAfter = after.recognizedAt;
  }

  return Object.freeze(metadata);
}

function toRevenueEntryMutationView(
  record: RevenueEntry,
): RevenueEntryMutationView {
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

function normalizeOptionalText(
  value: unknown,
  field: string,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return normalizeRequiredText(value, field);
}

function normalizeOptionalNullableId(
  value: unknown,
  field: string,
  options: {
    readonly missingAsNull?: boolean;
    readonly missingAsUndefined?: boolean;
  },
): string | null | undefined {
  if (value === undefined) {
    if (options.missingAsUndefined) {
      return undefined;
    }

    if (options.missingAsNull) {
      return null;
    }
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new RevenueLedgerValidationError(
      `${field} must be a string or null`,
    );
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new RevenueLedgerValidationError(
      `${field} must not be empty`,
    );
  }

  return normalized;
}

function normalizeOptionalNullableText(
  value: unknown,
  field: string,
  options: {
    readonly missingAsNull?: boolean;
    readonly missingAsUndefined?: boolean;
  },
): string | null | undefined {
  if (value === undefined) {
    if (options.missingAsUndefined) {
      return undefined;
    }

    if (options.missingAsNull) {
      return null;
    }
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new RevenueLedgerValidationError(
      `${field} must be a string or null`,
    );
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new RevenueLedgerValidationError(
      `${field} must not be empty`,
    );
  }

  return normalized;
}

function normalizeRevenueKind(
  value: unknown,
): RevenueKind {
  if (typeof value !== "string") {
    throw new RevenueLedgerValidationError(
      `revenueKind must be one of ${REVENUE_ENTRY_KINDS.join(", ")}`,
    );
  }

  const normalized = value.trim().toUpperCase();

  if (
    REVENUE_ENTRY_KINDS.includes(
      normalized as RevenueKind,
    )
  ) {
    return normalized as RevenueKind;
  }

  throw new RevenueLedgerValidationError(
    `revenueKind must be one of ${REVENUE_ENTRY_KINDS.join(", ")}`,
  );
}

function normalizeEntrySource(
  value: unknown,
): RevenueEntrySource {
  if (typeof value !== "string") {
    throw new RevenueLedgerValidationError(
      `entrySource must be one of ${REVENUE_ENTRY_SOURCES.join(", ")}`,
    );
  }

  const normalized = value.trim().toUpperCase();

  if (
    REVENUE_ENTRY_SOURCES.includes(
      normalized as RevenueEntrySource,
    )
  ) {
    return normalized as RevenueEntrySource;
  }

  throw new RevenueLedgerValidationError(
    `entrySource must be one of ${REVENUE_ENTRY_SOURCES.join(", ")}`,
  );
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

  if (!normalized) {
    throw new RevenueLedgerInvalidCurrencyCodeError(
      `${field} is required`,
    );
  }

  if (!/^[A-Z]{3}$/u.test(normalized)) {
    throw new RevenueLedgerInvalidCurrencyCodeError(
      `${field} must be exactly 3 uppercase letters`,
    );
  }

  return normalized;
}

function normalizeRecognizedAmount(
  value: unknown,
  field: string,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value)
  ) {
    throw new RevenueLedgerInvalidRevenueAmountError(
      `${field} must be a finite number`,
    );
  }

  if (value <= 0) {
    throw new RevenueLedgerInvalidRevenueAmountError(
      `${field} must be a positive decimal amount`,
    );
  }

  const rounded = Math.round(value * 100) / 100;

  if (Math.abs(value - rounded) > 1e-9) {
    throw new RevenueLedgerInvalidRevenueAmountError(
      `${field} must have at most 2 decimal places`,
    );
  }

  if (rounded <= 0) {
    throw new RevenueLedgerInvalidRevenueAmountError(
      `${field} must be greater than zero`,
    );
  }

  return sanitizeNegativeZero(rounded);
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

function sanitizeNegativeZero(
  value: number,
): number {
  return Object.is(value, -0) ? 0 : value;
}

function assertEntrySourceRule(
  entrySource: RevenueEntrySource,
): void {
  if (entrySource === "MANUAL") {
    return;
  }

  throw new RevenueLedgerValidationError(
    "entrySource must be MANUAL",
  );
}

function assertCurrencyCodeRule(
  currencyCode: string,
): void {
  if (/^[A-Z]{3}$/u.test(currencyCode)) {
    return;
  }

  throw new RevenueLedgerInvalidCurrencyCodeError(
    "currencyCode must be exactly 3 uppercase letters",
  );
}

function assertRevenueAmountRule(
  recognizedAmount: number,
): void {
  if (
    !Number.isFinite(recognizedAmount) ||
    recognizedAmount <= 0
  ) {
    throw new RevenueLedgerInvalidRevenueAmountError(
      "recognizedAmount must be a positive decimal amount",
    );
  }

  const rounded =
    Math.round(recognizedAmount * 100) / 100;

  if (
    Math.abs(recognizedAmount - rounded) > 1e-9
  ) {
    throw new RevenueLedgerInvalidRevenueAmountError(
      "recognizedAmount must have at most 2 decimal places",
    );
  }
}

function assertRecognizedAtRule(
  recognizedAt: number,
  evaluationTime: number,
): void {
  if (recognizedAt > evaluationTime) {
    throw new RevenueLedgerValidationError(
      "recognizedAt must not be later than evaluation time",
    );
  }
}

function assertRevenueKindCompatibilityRule(
  candidate: RevenueEntryCandidateState,
): void {
  if (
    (candidate.revenueKind ===
      "PLATFORM_LIVESTREAM" ||
      candidate.revenueKind ===
        "PLATFORM_CONTENT") &&
    candidate.attributionPlatformAccountId ===
      null
  ) {
    throw new RevenueLedgerValidationError(
      `revenueKind ${candidate.revenueKind} requires attributionPlatformAccountId`,
    );
  }

  if (
    candidate.revenueKind ===
      "EVENT_OPERATIONAL" &&
    candidate.attributionEventId === null
  ) {
    throw new RevenueLedgerValidationError(
      "revenueKind EVENT_OPERATIONAL requires attributionEventId",
    );
  }
}

function canonicalizeSearchToken(
  value: string,
): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();
}

function assertAdminActorType(
  actor: Actor,
): void {
  PermissionGuard.assertAdminActor(actor);
}

function isDuplicateKeyError(
  error: unknown,
): error is MongoServerError {
  return (
    error instanceof MongoServerError &&
    error.code === 11000
  );
}

function buildMutationTargetDescriptor(
  metadata: Readonly<Record<string, unknown>>,
): string {
  const encoded = JSON.stringify(metadata);

  if (
    typeof encoded === "string" &&
    encoded.length > 2
  ) {
    return encoded;
  }

  return "target:unspecified";
}

function classifyRevenueLedgerMutationFailure(
  error: unknown,
): RevenueLedgerMutationFailureClassification {
  if (
    error instanceof RevenueLedgerValidationError
  ) {
    return "validation";
  }

  if (error instanceof RevenueLedgerConflictError) {
    return "conflict";
  }

  if (error instanceof RevenueLedgerNotFoundError) {
    return "not_found";
  }

  if (error instanceof RevenueLedgerStateError) {
    return "state_error";
  }

  if (
    error instanceof
    RevenueLedgerInvalidTalentReferenceError
  ) {
    return "invalid_talent_reference";
  }

  if (
    error instanceof
    RevenueLedgerInvalidPlatformAttributionError
  ) {
    return "invalid_platform_attribution";
  }

  if (
    error instanceof
    RevenueLedgerInvalidEventAttributionError
  ) {
    return "invalid_event_attribution";
  }

  if (
    error instanceof
    RevenueLedgerInvalidCurrencyCodeError
  ) {
    return "invalid_currency_code";
  }

  if (
    error instanceof
    RevenueLedgerInvalidRevenueAmountError
  ) {
    return "invalid_revenue_amount";
  }

  if (
    error instanceof
    RevenueLedgerPermissionScopeError
  ) {
    return "permission_scope";
  }

  if (error instanceof SystemInvariantError) {
    return "invariant";
  }

  return "unknown";
}

function extractErrorCode(
  error: unknown,
): string | undefined {
  if (error instanceof BaseAppError) {
    return error.code;
  }

  if (error instanceof SystemInvariantError) {
    return error.code;
  }

  return undefined;
}

function truncateLogMessage(
  error: unknown,
): string {
  const raw =
    error instanceof Error
      ? error.message
      : String(error);

  if (raw.length <= 256) {
    return raw;
  }

  return `${raw.slice(0, 253)}...`;
}

function readOptionalLogString(
  value: unknown,
): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0
    ? normalized
    : undefined;
}
