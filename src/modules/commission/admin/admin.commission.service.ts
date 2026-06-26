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
import {
  CommissionContractRegistryReadonlyAccess,
  CommissionReferencedContractRecord,
} from "@modules/commission/domain/commission-contract-registry-readonly-access";
import {
  CommissionEmploymentProfileReadonlyAccess,
  CommissionReferencedEmploymentProfile,
} from "@modules/commission/domain/commission-employment-profile-readonly-access";
import {
  CommissionConflictError,
  CommissionInvalidBeneficiaryReferenceError,
  CommissionInvalidContractRecordReferenceError,
  CommissionInvalidRateError,
  CommissionInvalidRevenueEntrySelectionError,
  CommissionNotFoundError,
  CommissionPermissionScopeError,
  CommissionSettlementExclusivityConflictError,
  CommissionStateError,
  CommissionValidationError,
} from "@modules/commission/domain/commission.errors";
import { COMMISSION_RULE_CODE_POLICY } from "@modules/commission/domain/commission-rule-code-policy";
import { buildCommissionSettlementCodePolicy } from "@modules/commission/domain/commission-settlement-code-policy";
import {
  CommissionReferencedRevenueEntry,
  CommissionRevenueLedgerReadonlyAccess,
} from "@modules/commission/domain/commission-revenue-ledger-readonly-access";
import {
  CommissionRepository,
  SettlementExclusivityConflictProbeResult,
} from "@modules/commission/domain/commission.repository";
import {
  CommissionReferencedTalent,
  CommissionTalentReadonlyAccess,
} from "@modules/commission/domain/commission-talent-readonly-access";
import {
  COMMISSION_BENEFICIARY_KINDS,
  COMMISSION_RULE_STATUSES,
  COMMISSION_SETTLEMENT_BASES,
  COMMISSION_SETTLEMENT_KINDS,
  COMMISSION_SETTLEMENT_STATUSES,
  CommissionBeneficiaryKind,
  CommissionRule,
  CommissionRuleMutationView,
  CommissionRuleStatus,
  CommissionSettlement,
  CommissionSettlementBasis,
  CommissionSettlementKind,
  CommissionSettlementLine,
  CommissionSettlementMutationView,
  CommissionSettlementStatus,
} from "@modules/commission/domain/commission.types";
import {
  ActivateCommissionRuleCommand,
  ArchiveCommissionRuleCommand,
  ArchiveCommissionSettlementCommand,
  CommissionRuleMutationResult,
  CommissionSettlementMutationResult,
  CreateCommissionRuleCommand,
  CreateCommissionSettlementCommand,
  DeactivateCommissionRuleCommand,
  FinalizeCommissionSettlementCommand,
  ReplaceCommissionSettlementRevenueEntriesCommand,
  UpdateCommissionRuleDraftCoreCommand,
  UpdateCommissionSettlementDraftCoreCommand,
  VoidCommissionSettlementCommand,
} from "@modules/commission/shared/commission.contracts";
import {
  CONTRACT_KINDS,
  ContractKind,
  ContractRecordStatus,
} from "@modules/contract-registry/domain/contract-registry.types";
import { EmploymentStatus } from "@modules/employment-profile/domain/employment-profile.types";
import {
  REVENUE_ENTRY_KINDS,
  RevenueEntryStatus,
  RevenueKind,
} from "@modules/revenue-ledger/domain/revenue-ledger.types";
import { TalentOperationalStatus } from "@modules/talent/domain/talent.types";

const RULE_MUTABLE_STATUSES = new Set<CommissionRuleStatus>([
  "DRAFT",
  "INACTIVE",
]);
const BENEFICIARY_ELIGIBLE_EMPLOYMENT_STATUSES =
  new Set<EmploymentStatus>(["ACTIVE", "ON_LEAVE"]);
const REVENUE_ENTRY_ELIGIBLE_STATUSES =
  new Set<RevenueEntryStatus>([
    "FINALIZED",
    "RECONCILED",
  ]);
const RULE_ALLOWED_SOURCE_CONTRACT_STATUSES =
  new Set<ContractRecordStatus>([
    "ACTIVE",
    "EXPIRED",
    "TERMINATED",
  ]);
const ALLOWED_TALENT_CONTRACT_KINDS =
  new Set<ContractKind>([
    "TALENT_SERVICE",
    "TALENT_MANAGEMENT",
  ]);

const OPERATION_CREATE_RULE = "commission.create-rule";
const OPERATION_UPDATE_RULE_DRAFT_CORE =
  "commission.update-rule-draft-core";
const OPERATION_ACTIVATE_RULE =
  "commission.activate-rule";
const OPERATION_DEACTIVATE_RULE =
  "commission.deactivate-rule";
const OPERATION_ARCHIVE_RULE =
  "commission.archive-rule";
const OPERATION_CREATE_SETTLEMENT =
  "commission.create-settlement";
const OPERATION_UPDATE_SETTLEMENT_DRAFT_CORE =
  "commission.update-settlement-draft-core";
const OPERATION_REPLACE_SETTLEMENT_REVENUE_ENTRIES =
  "commission.replace-settlement-revenue-entries";
const OPERATION_FINALIZE_SETTLEMENT =
  "commission.finalize-settlement";
const OPERATION_VOID_SETTLEMENT =
  "commission.void-settlement";
const OPERATION_ARCHIVE_SETTLEMENT =
  "commission.archive-settlement";

type CommissionMutationFailureClassification =
  | "validation"
  | "conflict"
  | "not_found"
  | "state_error"
  | "invalid_beneficiary_reference"
  | "invalid_contract_record_reference"
  | "invalid_revenue_entry_selection"
  | "settlement_exclusivity_conflict"
  | "invalid_rate"
  | "permission_scope"
  | "invariant"
  | "unknown";

interface NormalizedRuleBeneficiary {
  readonly beneficiaryKind: CommissionBeneficiaryKind;
  readonly beneficiaryEmploymentProfileId: string | null;
  readonly beneficiaryTalentId: string | null;
}

interface NormalizedCreateRuleCommand {
  readonly ruleCode: string | undefined;
  readonly title: string;
  readonly normalizedTitle: string;
  readonly settlementKind: CommissionSettlementKind;
  readonly beneficiary: NormalizedRuleBeneficiary;
  readonly sourceContractRecordId: string;
  readonly settlementBasis: CommissionSettlementBasis;
  readonly ratePercent: number;
  readonly appliesToRevenueKinds: readonly RevenueKind[];
  readonly effectiveStartDate: number;
  readonly effectiveEndDate: number | null;
  readonly description: string | null;
  readonly externalRef: string | null;
}

interface NormalizedUpdateRuleDraftCoreCommand {
  readonly commissionRuleId: string;
  readonly title?: string;
  readonly normalizedTitle?: string;
  readonly ratePercent?: number;
  readonly appliesToRevenueKinds?: readonly RevenueKind[];
  readonly effectiveStartDate?: number;
  readonly effectiveEndDate?: number | null;
  readonly description?: string | null;
  readonly externalRef?: string | null;
}

interface NormalizedRuleLifecycleCommand {
  readonly commissionRuleId: string;
}

interface NormalizedCreateSettlementCommand {
  readonly settlementCode: string | undefined;
  readonly title: string;
  readonly normalizedTitle: string;
  readonly sourceRuleId: string;
  readonly settlementPeriodStartAt: number;
  readonly settlementPeriodEndAt: number;
  readonly revenueEntryIds: readonly string[];
  readonly description: string | null;
  readonly externalRef: string | null;
}

interface NormalizedUpdateSettlementDraftCoreCommand {
  readonly commissionSettlementId: string;
  readonly title?: string;
  readonly normalizedTitle?: string;
  readonly settlementPeriodStartAt?: number;
  readonly settlementPeriodEndAt?: number;
  readonly description?: string | null;
  readonly externalRef?: string | null;
}

interface NormalizedReplaceSettlementRevenueEntriesCommand {
  readonly commissionSettlementId: string;
  readonly revenueEntryIds: readonly string[];
}

interface NormalizedSettlementLifecycleCommand {
  readonly commissionSettlementId: string;
}

interface RuleCandidateState {
  readonly settlementKind: CommissionSettlementKind;
  readonly beneficiary: NormalizedRuleBeneficiary;
  readonly sourceContractRecordId: string;
  readonly settlementBasis: CommissionSettlementBasis;
  readonly ratePercent: number;
  readonly appliesToRevenueKinds: readonly RevenueKind[];
  readonly effectiveStartDate: number;
  readonly effectiveEndDate: number | null;
}

interface SettlementDerivedLine {
  readonly revenueEntryId: string;
  readonly revenueEntryCodeSnapshot: string;
  readonly revenueKindSnapshot: RevenueKind;
  readonly revenueCurrencyCodeSnapshot: string;
  readonly revenueRecognizedAmountSnapshot: number;
  readonly revenueRecognizedAtSnapshot: number;
  readonly lineSettlementAmount: number;
}

interface RevenueSelectionEvaluation {
  readonly canonicalRevenueEntryIds: readonly string[];
  readonly subjectTalentId: string;
  readonly settlementCurrencyCode: string;
  readonly grossRevenueAmount: number;
  readonly settlementAmount: number;
  readonly lines: readonly SettlementDerivedLine[];
}

interface SettlementSourceSnapshot {
  readonly beneficiaryKindSnapshot: CommissionBeneficiaryKind;
  readonly beneficiaryEmploymentProfileIdSnapshot: string | null;
  readonly beneficiaryTalentIdSnapshot: string | null;
}

interface SettlementDraftCorePatchBuildResult {
  readonly update: {
    title?: string;
    normalizedTitle?: string;
    settlementPeriodStartAt?: number;
    settlementPeriodEndAt?: number;
    description?: string | null;
    externalRef?: string | null;
  };
  readonly candidateSettlementPeriodStartAt: number;
  readonly candidateSettlementPeriodEndAt: number;
  readonly changedFields: readonly string[];
}

interface RuleDraftCorePatchBuildResult {
  readonly update: {
    title?: string;
    normalizedTitle?: string;
    ratePercent?: number;
    appliesToRevenueKinds?: readonly RevenueKind[];
    effectiveStartDate?: number;
    effectiveEndDate?: number | null;
    description?: string | null;
    externalRef?: string | null;
  };
  readonly candidate: RuleCandidateState;
  readonly changedFields: readonly string[];
}

export class CommissionAdminService {
  constructor(
    private readonly repository: CommissionRepository,
    private readonly codeSequenceRepository: BusinessCodeSequenceRepository,
    private readonly employmentProfileReadonlyAccess: CommissionEmploymentProfileReadonlyAccess,
    private readonly talentReadonlyAccess: CommissionTalentReadonlyAccess,
    private readonly contractReadonlyAccess: CommissionContractRegistryReadonlyAccess,
    private readonly revenueLedgerReadonlyAccess: CommissionRevenueLedgerReadonlyAccess,
    private readonly audit: AuditGuard,
    private readonly mutationBridge: AuthoritativeAdminMutationBridge,
    private readonly logger: StructuredLogger = createStructuredLogger(),
  ) {}

  async createCommissionRule(
    actor: Actor,
    command: CreateCommissionRuleCommand,
  ): Promise<CommissionRuleMutationResult> {
    const operation = OPERATION_CREATE_RULE;
    const permission = this.assertPermission(
      actor,
      Permission.COMMISSION_RULE_CREATE,
    );
    const input = normalizeCreateRuleCommand(command);

    try {
      return await this.executeMutation(
        actor,
        permission,
        operation,
        {
          ruleCode: readOptionalLogString(
            command.ruleCode,
          ),
          settlementKind: input.settlementKind,
          beneficiaryKind:
            input.beneficiary.beneficiaryKind,
          sourceContractRecordId:
            input.sourceContractRecordId,
        },
        async (session) => {
          const scope = resolveRequiredGlobalScope(actor);
          if (input.ruleCode !== undefined) {
            const existingByRuleCode =
              await this.repository.findRuleByRuleCode(
                input.ruleCode,
                session,
              );

            if (existingByRuleCode) {
              throw new CommissionConflictError(
                `Rule code already exists: ${input.ruleCode}`,
              );
            }
          }

          const candidate: RuleCandidateState = {
            settlementKind: input.settlementKind,
            beneficiary: input.beneficiary,
            sourceContractRecordId:
              input.sourceContractRecordId,
            settlementBasis: input.settlementBasis,
            ratePercent: input.ratePercent,
            appliesToRevenueKinds:
              input.appliesToRevenueKinds,
            effectiveStartDate:
              input.effectiveStartDate,
            effectiveEndDate: input.effectiveEndDate,
          };

          await this.assertRuleCandidateStateValid(
            candidate,
            session,
            "create",
          );

          let record!: CommissionRule;
          const maxAttempts =
            input.ruleCode === undefined ? 5 : 1;

          for (
            let attempt = 1;
            attempt <= maxAttempts;
            attempt += 1
          ) {
            const ruleCode =
              input.ruleCode ??
              (await this.allocateGeneratedRuleCode(
                session,
              ));
            const now = Date.now();
            record = {
              id: crypto.randomUUID(),
              ruleCode,
              title: input.title,
              normalizedTitle: input.normalizedTitle,
              settlementKind: input.settlementKind,
              beneficiaryKind:
                input.beneficiary.beneficiaryKind,
              beneficiaryEmploymentProfileId:
                input.beneficiary
                  .beneficiaryEmploymentProfileId,
              beneficiaryTalentId:
                input.beneficiary.beneficiaryTalentId,
              sourceContractRecordId:
                input.sourceContractRecordId,
              settlementBasis: input.settlementBasis,
              ratePercent: input.ratePercent,
              appliesToRevenueKinds: [
                ...input.appliesToRevenueKinds,
              ],
              status: "DRAFT",
              effectiveStartDate:
                input.effectiveStartDate,
              effectiveEndDate: input.effectiveEndDate,
              description: input.description,
              externalRef: input.externalRef,
              createdAt: now,
              updatedAt: now,
            };

            try {
              await this.repository.insertRule(
                record,
                session,
              );
              break;
            } catch (error) {
              if (!isDuplicateKeyError(error)) {
                throw error;
              }

              if (input.ruleCode !== undefined) {
                throw new CommissionConflictError(
                  "Rule code already exists",
                );
              }

              if (attempt >= maxAttempts) {
                throw new CommissionConflictError(
                  "Generated rule code conflict detected on create",
                );
              }
            }
          }

          await this.recordRuleAudit({
            actor,
            permission,
            commissionRuleId: record.id,
            mutationType: operation,
            metadata: {
              ruleCode: record.ruleCode,
              settlementKind: record.settlementKind,
              beneficiaryKind: record.beneficiaryKind,
              beneficiaryEmploymentProfileId:
                record.beneficiaryEmploymentProfileId,
              beneficiaryTalentId:
                record.beneficiaryTalentId,
              sourceContractRecordId:
                record.sourceContractRecordId,
              settlementBasis: record.settlementBasis,
              ratePercent: record.ratePercent,
              appliesToRevenueKinds:
                record.appliesToRevenueKinds,
              effectiveStartDate:
                record.effectiveStartDate,
              effectiveEndDate:
                record.effectiveEndDate,
              status: record.status,
              effectiveScope: scope,
            },
            session,
          });

          return toRuleMutationView(record);
        },
        (result) => ({
          commissionRuleId: result.id,
          status: result.status,
        }),
      );
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new CommissionConflictError(
          "Rule code already exists",
        );
      }

      throw error;
    }
  }

  async updateCommissionRuleDraftCore(
    actor: Actor,
    command: UpdateCommissionRuleDraftCoreCommand,
  ): Promise<CommissionRuleMutationResult> {
    const operation = OPERATION_UPDATE_RULE_DRAFT_CORE;
    const permission = this.assertPermission(
      actor,
      Permission.COMMISSION_RULE_UPDATE,
    );
    const input =
      normalizeUpdateRuleDraftCoreCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        commissionRuleId: input.commissionRuleId,
      },
      async (session) => {
        const scope = resolveRequiredGlobalScope(actor);
        const current = await this.requireRule(
          input.commissionRuleId,
          session,
        );

        if (!RULE_MUTABLE_STATUSES.has(current.status)) {
          throw new CommissionStateError(
            `updateCommissionRuleDraftCore is allowed only while rule is DRAFT or INACTIVE: ${current.id}`,
          );
        }

        const patch = buildRuleDraftCorePatch(
          current,
          input,
        );

        await this.assertRuleCandidateStateValid(
          patch.candidate,
          session,
          "update",
        );

        const updated =
          await this.repository.updateRuleDraftCore(
            {
              commissionRuleId: current.id,
              ...patch.update,
              updatedAt: Date.now(),
            },
            session,
          );

        if (!updated) {
          throw new CommissionStateError(
            `updateCommissionRuleDraftCore failed because rule is no longer mutable in current state: ${current.id}`,
          );
        }

        await this.recordRuleAudit({
          actor,
          permission,
          commissionRuleId: updated.id,
          mutationType: operation,
          metadata: {
            changedFields: patch.changedFields,
            ...buildRuleDraftCoreAuditDelta(
              current,
              updated,
              patch.changedFields,
            ),
            effectiveScope: scope,
          },
          session,
        });

        return toRuleMutationView(updated);
      },
      (result) => ({
        commissionRuleId: result.id,
        status: result.status,
      }),
    );
  }

  async activateCommissionRule(
    actor: Actor,
    command: ActivateCommissionRuleCommand,
  ): Promise<CommissionRuleMutationResult> {
    const operation = OPERATION_ACTIVATE_RULE;
    const permission = this.assertPermission(
      actor,
      Permission.COMMISSION_RULE_MANAGE_LIFECYCLE,
    );
    const input = normalizeRuleLifecycleCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        commissionRuleId: input.commissionRuleId,
      },
      async (session) => {
        const scope = resolveRequiredGlobalScope(actor);
        const current = await this.requireRule(
          input.commissionRuleId,
          session,
        );

        if (
          current.status !== "DRAFT" &&
          current.status !== "INACTIVE"
        ) {
          throw new CommissionStateError(
            `activateCommissionRule is allowed only from DRAFT or INACTIVE: ${current.id}`,
          );
        }

        const candidate: RuleCandidateState = {
          settlementKind: current.settlementKind,
          beneficiary: {
            beneficiaryKind: current.beneficiaryKind,
            beneficiaryEmploymentProfileId:
              current.beneficiaryEmploymentProfileId,
            beneficiaryTalentId:
              current.beneficiaryTalentId,
          },
          sourceContractRecordId:
            current.sourceContractRecordId,
          settlementBasis: current.settlementBasis,
          ratePercent: current.ratePercent,
          appliesToRevenueKinds:
            current.appliesToRevenueKinds,
          effectiveStartDate:
            current.effectiveStartDate,
          effectiveEndDate: current.effectiveEndDate,
        };

        await this.assertRuleCandidateStateValid(
          candidate,
          session,
          "activation",
        );

        assertRuleActivationWindowOpen(current);

        const updated =
          await this.repository.transitionRuleStatus(
            {
              commissionRuleId: current.id,
              fromStatuses: ["DRAFT", "INACTIVE"],
              toStatus: "ACTIVE",
              updatedAt: Date.now(),
            },
            session,
          );

        if (!updated) {
          throw new CommissionStateError(
            `activateCommissionRule failed because rule is no longer mutable in current state: ${current.id}`,
          );
        }

        await this.recordRuleAudit({
          actor,
          permission,
          commissionRuleId: updated.id,
          mutationType: operation,
          metadata: {
            previousStatus: current.status,
            nextStatus: updated.status,
            effectiveScope: scope,
          },
          session,
        });

        return toRuleMutationView(updated);
      },
      (result) => ({
        commissionRuleId: result.id,
        status: result.status,
      }),
    );
  }

  async deactivateCommissionRule(
    actor: Actor,
    command: DeactivateCommissionRuleCommand,
  ): Promise<CommissionRuleMutationResult> {
    const operation = OPERATION_DEACTIVATE_RULE;
    const permission = this.assertPermission(
      actor,
      Permission.COMMISSION_RULE_MANAGE_LIFECYCLE,
    );
    const input = normalizeRuleLifecycleCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        commissionRuleId: input.commissionRuleId,
      },
      async (session) => {
        const scope = resolveRequiredGlobalScope(actor);
        const current = await this.requireRule(
          input.commissionRuleId,
          session,
        );

        if (current.status !== "ACTIVE") {
          throw new CommissionStateError(
            `deactivateCommissionRule is allowed only while rule is ACTIVE: ${current.id}`,
          );
        }

        const updated =
          await this.repository.transitionRuleStatus(
            {
              commissionRuleId: current.id,
              fromStatuses: ["ACTIVE"],
              toStatus: "INACTIVE",
              updatedAt: Date.now(),
            },
            session,
          );

        if (!updated) {
          throw new CommissionStateError(
            `deactivateCommissionRule failed because rule is no longer mutable in current state: ${current.id}`,
          );
        }

        await this.recordRuleAudit({
          actor,
          permission,
          commissionRuleId: updated.id,
          mutationType: operation,
          metadata: {
            previousStatus: current.status,
            nextStatus: updated.status,
            effectiveScope: scope,
          },
          session,
        });

        return toRuleMutationView(updated);
      },
      (result) => ({
        commissionRuleId: result.id,
        status: result.status,
      }),
    );
  }

  async archiveCommissionRule(
    actor: Actor,
    command: ArchiveCommissionRuleCommand,
  ): Promise<CommissionRuleMutationResult> {
    const operation = OPERATION_ARCHIVE_RULE;
    const permission = this.assertPermission(
      actor,
      Permission.COMMISSION_RULE_MANAGE_LIFECYCLE,
    );
    const input = normalizeRuleLifecycleCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        commissionRuleId: input.commissionRuleId,
      },
      async (session) => {
        const scope = resolveRequiredGlobalScope(actor);
        const current = await this.requireRule(
          input.commissionRuleId,
          session,
        );

        if (
          current.status !== "DRAFT" &&
          current.status !== "INACTIVE"
        ) {
          throw new CommissionStateError(
            `archiveCommissionRule is allowed only from DRAFT or INACTIVE: ${current.id}`,
          );
        }

        const updated =
          await this.repository.transitionRuleStatus(
            {
              commissionRuleId: current.id,
              fromStatuses: ["DRAFT", "INACTIVE"],
              toStatus: "ARCHIVED",
              updatedAt: Date.now(),
            },
            session,
          );

        if (!updated) {
          throw new CommissionStateError(
            `archiveCommissionRule failed because rule is no longer mutable in current state: ${current.id}`,
          );
        }

        await this.recordRuleAudit({
          actor,
          permission,
          commissionRuleId: updated.id,
          mutationType: operation,
          metadata: {
            previousStatus: current.status,
            nextStatus: updated.status,
            effectiveScope: scope,
          },
          session,
        });

        return toRuleMutationView(updated);
      },
      (result) => ({
        commissionRuleId: result.id,
        status: result.status,
      }),
    );
  }

  async createCommissionSettlement(
    actor: Actor,
    command: CreateCommissionSettlementCommand,
  ): Promise<CommissionSettlementMutationResult> {
    const operation = OPERATION_CREATE_SETTLEMENT;
    const permission = this.assertPermission(
      actor,
      Permission.COMMISSION_SETTLEMENT_CREATE,
    );
    const input =
      normalizeCreateSettlementCommand(command);

    try {
      return await this.executeMutation(
        actor,
        permission,
        operation,
        {
          settlementCode: readOptionalLogString(
            command.settlementCode,
          ),
          sourceRuleId: input.sourceRuleId,
          revenueEntryCount: input.revenueEntryIds.length,
        },
        async (session) => {
          const scope = resolveRequiredGlobalScope(actor);
          if (input.settlementCode !== undefined) {
            const existingByCode =
              await this.repository.findSettlementBySettlementCode(
                input.settlementCode,
                session,
              );

            if (existingByCode) {
              throw new CommissionConflictError(
                `Settlement code already exists: ${input.settlementCode}`,
              );
            }
          }

          const sourceRule = await this.requireRule(
            input.sourceRuleId,
            session,
          );

          if (sourceRule.status !== "ACTIVE") {
            throw new CommissionStateError(
              `createCommissionSettlement requires source rule ACTIVE: ${sourceRule.id}`,
            );
          }

          assertSettlementPeriodRule(
            input.settlementPeriodStartAt,
            input.settlementPeriodEndAt,
            sourceRule,
          );

          const sourceSnapshot: SettlementSourceSnapshot = {
            beneficiaryKindSnapshot:
              sourceRule.beneficiaryKind,
            beneficiaryEmploymentProfileIdSnapshot:
              sourceRule.beneficiaryEmploymentProfileId,
            beneficiaryTalentIdSnapshot:
              sourceRule.beneficiaryTalentId,
          };

          await this.assertBeneficiarySnapshotResolvable(
            sourceSnapshot,
            session,
          );

          const evaluatedSelection =
            await this.evaluateRevenueSelection({
              sourceRule,
              sourceSnapshot,
              settlementPeriodStartAt:
                input.settlementPeriodStartAt,
              settlementPeriodEndAt:
                input.settlementPeriodEndAt,
              revenueEntryIds: input.revenueEntryIds,
              session,
            });

          let settlement!: CommissionSettlement;
          let lines!: readonly CommissionSettlementLine[];
          const maxAttempts =
            input.settlementCode === undefined ? 5 : 1;

          for (
            let attempt = 1;
            attempt <= maxAttempts;
            attempt += 1
          ) {
            const settlementCode =
              input.settlementCode ??
              (await this.allocateGeneratedSettlementCode(
                input.settlementPeriodStartAt,
                session,
              ));
            const now = Date.now();
            settlement = {
              id: crypto.randomUUID(),
              settlementCode,
              title: input.title,
              normalizedTitle: input.normalizedTitle,
              sourceRuleId: sourceRule.id,
              sourceContractRecordIdSnapshot:
                sourceRule.sourceContractRecordId,
              settlementKindSnapshot:
                sourceRule.settlementKind,
              beneficiaryKindSnapshot:
                sourceRule.beneficiaryKind,
              beneficiaryEmploymentProfileIdSnapshot:
                sourceRule.beneficiaryEmploymentProfileId,
              beneficiaryTalentIdSnapshot:
                sourceRule.beneficiaryTalentId,
              subjectTalentId:
                evaluatedSelection.subjectTalentId,
              settlementBasisSnapshot:
                sourceRule.settlementBasis,
              ratePercentSnapshot:
                sourceRule.ratePercent,
              revenueEntryIds:
                evaluatedSelection.canonicalRevenueEntryIds,
              settlementPeriodStartAt:
                input.settlementPeriodStartAt,
              settlementPeriodEndAt:
                input.settlementPeriodEndAt,
              settlementCurrencyCode:
                evaluatedSelection.settlementCurrencyCode,
              grossRevenueAmount:
                evaluatedSelection.grossRevenueAmount,
              settlementAmount:
                evaluatedSelection.settlementAmount,
              status: "DRAFT",
              finalizedAt: null,
              voidedAt: null,
              description: input.description,
              externalRef: input.externalRef,
              createdAt: now,
              updatedAt: now,
            };

            lines = evaluatedSelection.lines.map((line) => ({
              id: crypto.randomUUID(),
              settlementId: settlement.id,
              revenueEntryId: line.revenueEntryId,
              revenueEntryCodeSnapshot:
                line.revenueEntryCodeSnapshot,
              revenueKindSnapshot:
                line.revenueKindSnapshot,
              revenueCurrencyCodeSnapshot:
                line.revenueCurrencyCodeSnapshot,
              revenueRecognizedAmountSnapshot:
                line.revenueRecognizedAmountSnapshot,
              revenueRecognizedAtSnapshot:
                line.revenueRecognizedAtSnapshot,
              lineSettlementAmount:
                line.lineSettlementAmount,
              createdAt: now,
              updatedAt: now,
            }));

            try {
              await this.repository.insertSettlement(
                settlement,
                session,
              );
              await this.repository.insertSettlementLines(
                lines,
                session,
              );
              break;
            } catch (error) {
              if (!isDuplicateKeyError(error)) {
                throw error;
              }

              if (input.settlementCode !== undefined) {
                throw new CommissionConflictError(
                  "Settlement code already exists or settlement exclusivity conflict detected",
                );
              }

              if (attempt >= maxAttempts) {
                throw new CommissionConflictError(
                  "Generated settlement code conflict detected on create",
                );
              }
            }
          }

          await this.recordSettlementAudit({
            actor,
            permission,
            commissionSettlementId: settlement.id,
            mutationType: operation,
            metadata: {
              settlementCode: settlement.settlementCode,
              sourceRuleId: settlement.sourceRuleId,
              beneficiaryKindSnapshot:
                settlement.beneficiaryKindSnapshot,
              beneficiaryEmploymentProfileIdSnapshot:
                settlement.beneficiaryEmploymentProfileIdSnapshot,
              beneficiaryTalentIdSnapshot:
                settlement.beneficiaryTalentIdSnapshot,
              subjectTalentId: settlement.subjectTalentId,
              settlementCurrencyCode:
                settlement.settlementCurrencyCode,
              grossRevenueAmount:
                settlement.grossRevenueAmount,
              settlementAmount:
                settlement.settlementAmount,
              settlementPeriodStartAt:
                settlement.settlementPeriodStartAt,
              settlementPeriodEndAt:
                settlement.settlementPeriodEndAt,
              revenueEntryIds:
                settlement.revenueEntryIds,
              effectiveScope: scope,
            },
            session,
          });

          return toSettlementMutationView(settlement);
        },
        (result) => ({
          commissionSettlementId: result.id,
          status: result.status,
        }),
      );
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new CommissionConflictError(
          "Settlement code already exists or settlement exclusivity conflict detected",
        );
      }

      throw error;
    }
  }

  async updateCommissionSettlementDraftCore(
    actor: Actor,
    command: UpdateCommissionSettlementDraftCoreCommand,
  ): Promise<CommissionSettlementMutationResult> {
    const operation = OPERATION_UPDATE_SETTLEMENT_DRAFT_CORE;
    const permission = this.assertPermission(
      actor,
      Permission.COMMISSION_SETTLEMENT_UPDATE,
    );
    const input =
      normalizeUpdateSettlementDraftCoreCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        commissionSettlementId:
          input.commissionSettlementId,
      },
      async (session) => {
        const scope = resolveRequiredGlobalScope(actor);
        const current = await this.requireSettlement(
          input.commissionSettlementId,
          session,
        );

        if (current.status !== "DRAFT") {
          throw new CommissionStateError(
            `updateCommissionSettlementDraftCore is allowed only while settlement is DRAFT: ${current.id}`,
          );
        }

        const sourceRule = await this.requireRule(
          current.sourceRuleId,
          session,
        );
        const patch = buildSettlementDraftCorePatch(
          current,
          input,
        );

        assertSettlementPeriodRule(
          patch.candidateSettlementPeriodStartAt,
          patch.candidateSettlementPeriodEndAt,
          sourceRule,
        );

        const sourceSnapshot: SettlementSourceSnapshot = {
          beneficiaryKindSnapshot:
            current.beneficiaryKindSnapshot,
          beneficiaryEmploymentProfileIdSnapshot:
            current.beneficiaryEmploymentProfileIdSnapshot,
          beneficiaryTalentIdSnapshot:
            current.beneficiaryTalentIdSnapshot,
        };

        await this.assertBeneficiarySnapshotResolvable(
          sourceSnapshot,
          session,
        );

        await this.evaluateRevenueSelection({
          sourceRule,
          sourceSnapshot,
          settlementPeriodStartAt:
            patch.candidateSettlementPeriodStartAt,
          settlementPeriodEndAt:
            patch.candidateSettlementPeriodEndAt,
          revenueEntryIds: current.revenueEntryIds,
          excludeCommissionSettlementId: current.id,
          session,
        });

        const updated =
          await this.repository.updateSettlementDraftCore(
            {
              commissionSettlementId: current.id,
              ...patch.update,
              updatedAt: Date.now(),
            },
            session,
          );

        if (!updated) {
          throw new CommissionStateError(
            `updateCommissionSettlementDraftCore failed because settlement is no longer mutable in current state: ${current.id}`,
          );
        }

        await this.recordSettlementAudit({
          actor,
          permission,
          commissionSettlementId: updated.id,
          mutationType: operation,
          metadata: {
            changedFields: patch.changedFields,
            ...buildSettlementDraftCoreAuditDelta(
              current,
              updated,
              patch.changedFields,
            ),
            effectiveScope: scope,
          },
          session,
        });

        return toSettlementMutationView(updated);
      },
      (result) => ({
        commissionSettlementId: result.id,
        status: result.status,
      }),
    );
  }

  async replaceCommissionSettlementRevenueEntries(
    actor: Actor,
    command: ReplaceCommissionSettlementRevenueEntriesCommand,
  ): Promise<CommissionSettlementMutationResult> {
    const operation =
      OPERATION_REPLACE_SETTLEMENT_REVENUE_ENTRIES;
    const permission = this.assertPermission(
      actor,
      Permission.COMMISSION_SETTLEMENT_UPDATE,
    );
    const input =
      normalizeReplaceSettlementRevenueEntriesCommand(
        command,
      );

    try {
      return await this.executeMutation(
        actor,
        permission,
        operation,
        {
          commissionSettlementId:
            input.commissionSettlementId,
          replacementRevenueEntryCount:
            input.revenueEntryIds.length,
        },
        async (session, controls) => {
          const scope = resolveRequiredGlobalScope(actor);
          const current = await this.requireSettlement(
            input.commissionSettlementId,
            session,
          );

          if (current.status !== "DRAFT") {
            throw new CommissionStateError(
              `replaceCommissionSettlementRevenueEntries is allowed only while settlement is DRAFT: ${current.id}`,
            );
          }

          const sourceRule = await this.requireRule(
            current.sourceRuleId,
            session,
          );

          if (sourceRule.status !== "ACTIVE") {
            throw new CommissionStateError(
              `replaceCommissionSettlementRevenueEntries requires source rule ACTIVE: ${sourceRule.id}`,
            );
          }

          assertSettlementPeriodRule(
            current.settlementPeriodStartAt,
            current.settlementPeriodEndAt,
            sourceRule,
          );

          const sourceSnapshot: SettlementSourceSnapshot = {
            beneficiaryKindSnapshot:
              current.beneficiaryKindSnapshot,
            beneficiaryEmploymentProfileIdSnapshot:
              current.beneficiaryEmploymentProfileIdSnapshot,
            beneficiaryTalentIdSnapshot:
              current.beneficiaryTalentIdSnapshot,
          };

          await this.assertBeneficiarySnapshotResolvable(
            sourceSnapshot,
            session,
          );

          const evaluatedSelection =
            await this.evaluateRevenueSelection({
              sourceRule,
              sourceSnapshot,
              settlementPeriodStartAt:
                current.settlementPeriodStartAt,
              settlementPeriodEndAt:
                current.settlementPeriodEndAt,
              revenueEntryIds: input.revenueEntryIds,
              excludeCommissionSettlementId:
                current.id,
              session,
            });

          if (
            areCanonicalIdSetsEqual(
              current.revenueEntryIds,
              evaluatedSelection.canonicalRevenueEntryIds,
            )
          ) {
            controls.markExplicitNoOpSuccess();
            return toSettlementMutationView(current);
          }

          const now = Date.now();
          const replacementLines:
            readonly CommissionSettlementLine[] =
            evaluatedSelection.lines.map((line) => ({
              id: crypto.randomUUID(),
              settlementId: current.id,
              revenueEntryId: line.revenueEntryId,
              revenueEntryCodeSnapshot:
                line.revenueEntryCodeSnapshot,
              revenueKindSnapshot:
                line.revenueKindSnapshot,
              revenueCurrencyCodeSnapshot:
                line.revenueCurrencyCodeSnapshot,
              revenueRecognizedAmountSnapshot:
                line.revenueRecognizedAmountSnapshot,
              revenueRecognizedAtSnapshot:
                line.revenueRecognizedAtSnapshot,
              lineSettlementAmount:
                line.lineSettlementAmount,
              createdAt: now,
              updatedAt: now,
            }));

          await this.repository.deleteSettlementLinesBySettlementId(
            current.id,
            session,
          );
          await this.repository.insertSettlementLines(
            replacementLines,
            session,
          );

          const updated =
            await this.repository.updateSettlementDraftDerived(
              {
                commissionSettlementId: current.id,
                revenueEntryIds:
                  evaluatedSelection.canonicalRevenueEntryIds,
                subjectTalentId:
                  evaluatedSelection.subjectTalentId,
                settlementCurrencyCode:
                  evaluatedSelection.settlementCurrencyCode,
                grossRevenueAmount:
                  evaluatedSelection.grossRevenueAmount,
                settlementAmount:
                  evaluatedSelection.settlementAmount,
                updatedAt: now,
              },
              session,
            );

          if (!updated) {
            throw new CommissionStateError(
              `replaceCommissionSettlementRevenueEntries failed because settlement is no longer mutable in current state: ${current.id}`,
            );
          }

          await this.recordSettlementAudit({
            actor,
            permission,
            commissionSettlementId: updated.id,
            mutationType: operation,
            metadata: {
              previousRevenueEntryIds:
                current.revenueEntryIds,
              nextRevenueEntryIds:
                updated.revenueEntryIds,
              previousSubjectTalentId:
                current.subjectTalentId,
              nextSubjectTalentId:
                updated.subjectTalentId,
              previousSettlementCurrencyCode:
                current.settlementCurrencyCode,
              nextSettlementCurrencyCode:
                updated.settlementCurrencyCode,
              previousGrossRevenueAmount:
                current.grossRevenueAmount,
              nextGrossRevenueAmount:
                updated.grossRevenueAmount,
              previousSettlementAmount:
                current.settlementAmount,
              nextSettlementAmount:
                updated.settlementAmount,
              effectiveScope: scope,
            },
            session,
          });

          return toSettlementMutationView(updated);
        },
        (result) => ({
          commissionSettlementId: result.id,
          status: result.status,
        }),
      );
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new CommissionSettlementExclusivityConflictError(
          "Replacement revenue-entry set conflicts with another non-voided, non-archived settlement for the same beneficiary snapshot",
        );
      }

      throw error;
    }
  }

  async finalizeCommissionSettlement(
    actor: Actor,
    command: FinalizeCommissionSettlementCommand,
  ): Promise<CommissionSettlementMutationResult> {
    const operation = OPERATION_FINALIZE_SETTLEMENT;
    const permission = this.assertPermission(
      actor,
      Permission.COMMISSION_SETTLEMENT_MANAGE_LIFECYCLE,
    );
    const input =
      normalizeSettlementLifecycleCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        commissionSettlementId:
          input.commissionSettlementId,
      },
      async (session) => {
        const scope = resolveRequiredGlobalScope(actor);
        const current = await this.requireSettlement(
          input.commissionSettlementId,
          session,
        );

        if (current.status !== "DRAFT") {
          throw new CommissionStateError(
            `finalizeCommissionSettlement is allowed only while settlement is DRAFT: ${current.id}`,
          );
        }

        const sourceRule = await this.requireRule(
          current.sourceRuleId,
          session,
        );

        if (sourceRule.status !== "ACTIVE") {
          throw new CommissionStateError(
            `finalizeCommissionSettlement requires source rule ACTIVE: ${sourceRule.id}`,
          );
        }

        assertSettlementPeriodRule(
          current.settlementPeriodStartAt,
          current.settlementPeriodEndAt,
          sourceRule,
        );

        const sourceSnapshot: SettlementSourceSnapshot = {
          beneficiaryKindSnapshot:
            current.beneficiaryKindSnapshot,
          beneficiaryEmploymentProfileIdSnapshot:
            current.beneficiaryEmploymentProfileIdSnapshot,
          beneficiaryTalentIdSnapshot:
            current.beneficiaryTalentIdSnapshot,
        };

        await this.assertBeneficiarySnapshotResolvable(
          sourceSnapshot,
          session,
        );

        await this.evaluateRevenueSelection({
          sourceRule,
          sourceSnapshot,
          settlementPeriodStartAt:
            current.settlementPeriodStartAt,
          settlementPeriodEndAt:
            current.settlementPeriodEndAt,
          revenueEntryIds: current.revenueEntryIds,
          excludeCommissionSettlementId: current.id,
          session,
        });

        await this.assertSourceContractSnapshotResolvable(
          current.sourceContractRecordIdSnapshot,
          session,
        );

        const now = Date.now();
        const updated =
          await this.repository.transitionSettlementStatus(
            {
              commissionSettlementId: current.id,
              fromStatuses: ["DRAFT"],
              toStatus: "FINALIZED",
              finalizedAt: now,
              updatedAt: now,
            },
            session,
          );

        if (!updated) {
          throw new CommissionStateError(
            `finalizeCommissionSettlement failed because settlement is no longer mutable in current state: ${current.id}`,
          );
        }

        await this.recordSettlementAudit({
          actor,
          permission,
          commissionSettlementId: updated.id,
          mutationType: operation,
          metadata: {
            previousStatus: current.status,
            nextStatus: updated.status,
            finalizedAt: updated.finalizedAt,
            sourceRuleId: updated.sourceRuleId,
            beneficiaryKindSnapshot:
              updated.beneficiaryKindSnapshot,
            beneficiaryEmploymentProfileIdSnapshot:
              updated.beneficiaryEmploymentProfileIdSnapshot,
            beneficiaryTalentIdSnapshot:
              updated.beneficiaryTalentIdSnapshot,
            subjectTalentId: updated.subjectTalentId,
            settlementCurrencyCode:
              updated.settlementCurrencyCode,
            grossRevenueAmount:
              updated.grossRevenueAmount,
            settlementAmount: updated.settlementAmount,
            revenueEntryIds: updated.revenueEntryIds,
            effectiveScope: scope,
          },
          session,
        });

        return toSettlementMutationView(updated);
      },
      (result) => ({
        commissionSettlementId: result.id,
        status: result.status,
      }),
    );
  }

  async voidCommissionSettlement(
    actor: Actor,
    command: VoidCommissionSettlementCommand,
  ): Promise<CommissionSettlementMutationResult> {
    const operation = OPERATION_VOID_SETTLEMENT;
    const permission = this.assertPermission(
      actor,
      Permission.COMMISSION_SETTLEMENT_MANAGE_LIFECYCLE,
    );
    const input =
      normalizeSettlementLifecycleCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        commissionSettlementId:
          input.commissionSettlementId,
      },
      async (session) => {
        const scope = resolveRequiredGlobalScope(actor);
        const current = await this.requireSettlement(
          input.commissionSettlementId,
          session,
        );

        if (current.status !== "FINALIZED") {
          throw new CommissionStateError(
            `voidCommissionSettlement is allowed only while settlement is FINALIZED: ${current.id}`,
          );
        }

        const now = Date.now();
        const updated =
          await this.repository.transitionSettlementStatus(
            {
              commissionSettlementId: current.id,
              fromStatuses: ["FINALIZED"],
              toStatus: "VOIDED",
              voidedAt: now,
              updatedAt: now,
            },
            session,
          );

        if (!updated) {
          throw new CommissionStateError(
            `voidCommissionSettlement failed because settlement is no longer mutable in current state: ${current.id}`,
          );
        }

        await this.recordSettlementAudit({
          actor,
          permission,
          commissionSettlementId: updated.id,
          mutationType: operation,
          metadata: {
            previousStatus: current.status,
            nextStatus: updated.status,
            voidedAt: updated.voidedAt,
            effectiveScope: scope,
          },
          session,
        });

        return toSettlementMutationView(updated);
      },
      (result) => ({
        commissionSettlementId: result.id,
        status: result.status,
      }),
    );
  }

  async archiveCommissionSettlement(
    actor: Actor,
    command: ArchiveCommissionSettlementCommand,
  ): Promise<CommissionSettlementMutationResult> {
    const operation = OPERATION_ARCHIVE_SETTLEMENT;
    const permission = this.assertPermission(
      actor,
      Permission.COMMISSION_SETTLEMENT_MANAGE_LIFECYCLE,
    );
    const input =
      normalizeSettlementLifecycleCommand(command);

    return this.executeMutation(
      actor,
      permission,
      operation,
      {
        commissionSettlementId:
          input.commissionSettlementId,
      },
      async (session) => {
        const scope = resolveRequiredGlobalScope(actor);
        const current = await this.requireSettlement(
          input.commissionSettlementId,
          session,
        );

        if (
          current.status !== "DRAFT" &&
          current.status !== "VOIDED"
        ) {
          throw new CommissionStateError(
            `archiveCommissionSettlement is allowed only from DRAFT or VOIDED: ${current.id}`,
          );
        }

        const updated =
          await this.repository.transitionSettlementStatus(
            {
              commissionSettlementId: current.id,
              fromStatuses: ["DRAFT", "VOIDED"],
              toStatus: "ARCHIVED",
              updatedAt: Date.now(),
            },
            session,
          );

        if (!updated) {
          throw new CommissionStateError(
            `archiveCommissionSettlement failed because settlement is no longer mutable in current state: ${current.id}`,
          );
        }

        await this.recordSettlementAudit({
          actor,
          permission,
          commissionSettlementId: updated.id,
          mutationType: operation,
          metadata: {
            previousStatus: current.status,
            nextStatus: updated.status,
            effectiveScope: scope,
          },
          session,
        });

        return toSettlementMutationView(updated);
      },
      (result) => ({
        commissionSettlementId: result.id,
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

  private async requireRule(
    commissionRuleId: string,
    session: ClientSession,
  ): Promise<CommissionRule> {
    const rule = await this.repository.findRuleById(
      commissionRuleId,
      session,
    );

    if (!rule) {
      throw new CommissionNotFoundError(
        "rule",
        commissionRuleId,
      );
    }

    assertRuleStructuralInvariants(rule);
    return rule;
  }

  private async requireSettlement(
    commissionSettlementId: string,
    session: ClientSession,
  ): Promise<CommissionSettlement> {
    const settlement =
      await this.repository.findSettlementById(
        commissionSettlementId,
        session,
      );

    if (!settlement) {
      throw new CommissionNotFoundError(
        "settlement",
        commissionSettlementId,
      );
    }

    assertSettlementStructuralInvariants(settlement);
    return settlement;
  }

  private async allocateGeneratedRuleCode(
    session: ClientSession,
  ): Promise<string> {
    const maxExisting =
      await this.repository.findMaxGeneratedRuleCodeSequence(
        COMMISSION_RULE_CODE_POLICY,
        session,
      );
    await this.codeSequenceRepository.ensureAtLeast(
      COMMISSION_RULE_CODE_POLICY.moduleKey,
      COMMISSION_RULE_CODE_POLICY.bucket,
      maxExisting,
      session,
    );
    const next =
      await this.codeSequenceRepository.allocateNext(
        COMMISSION_RULE_CODE_POLICY.moduleKey,
        COMMISSION_RULE_CODE_POLICY.bucket,
        session,
      );

    return formatBusinessCode(
      COMMISSION_RULE_CODE_POLICY,
      next,
    );
  }

  private async allocateGeneratedSettlementCode(
    settlementPeriodStartAt: number,
    session: ClientSession,
  ): Promise<string> {
    const bucket = utcMonthBucketFromTimestamp(
      settlementPeriodStartAt,
    );
    const policy =
      buildCommissionSettlementCodePolicy(bucket);
    const maxExisting =
      await this.repository.findMaxGeneratedSettlementCodeSequence(
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

  private async assertRuleCandidateStateValid(
    candidate: RuleCandidateState,
    session: ClientSession,
    validationContext: "create" | "update" | "activation",
  ): Promise<void> {
    assertSettlementKindCompatibilityRule(
      candidate.settlementKind,
      candidate.beneficiary.beneficiaryKind,
    );
    assertBeneficiaryReferenceShape(
      candidate.beneficiary,
    );
    await this.assertBeneficiaryEligible(
      candidate.beneficiary,
      session,
      validationContext,
    );
    assertSettlementBasisRule(
      candidate.settlementBasis,
    );
    assertRateValidationRule(candidate.ratePercent);

    const canonicalRevenueKinds =
      canonicalizeRevenueKinds(
        candidate.appliesToRevenueKinds,
      );
    if (
      !areCanonicalRevenueKindSetsEqual(
        candidate.appliesToRevenueKinds,
        canonicalRevenueKinds,
      )
    ) {
      throw new CommissionValidationError(
        "appliesToRevenueKinds must be canonicalized in deterministic enum order",
      );
    }

    const sourceContract =
      await this.assertSourceContractReferenceValid(
        candidate,
        session,
      );

    assertRuleEffectiveWindowRule(
      candidate.effectiveStartDate,
      candidate.effectiveEndDate,
      sourceContract,
    );
  }

  private async assertSourceContractReferenceValid(
    candidate: Pick<
      RuleCandidateState,
      | "sourceContractRecordId"
      | "beneficiary"
      | "settlementKind"
      | "settlementBasis"
      | "ratePercent"
      | "appliesToRevenueKinds"
      | "effectiveStartDate"
      | "effectiveEndDate"
    >,
    session: ClientSession,
  ): Promise<CommissionReferencedContractRecord> {
    const sourceContract =
      await this.contractReadonlyAccess.findById(
        candidate.sourceContractRecordId,
        session,
      );

    if (!sourceContract) {
      throw new CommissionInvalidContractRecordReferenceError(
        `Source contract does not exist: ${candidate.sourceContractRecordId}`,
      );
    }

    if (
      !RULE_ALLOWED_SOURCE_CONTRACT_STATUSES.has(
        sourceContract.status,
      )
    ) {
      throw new CommissionInvalidContractRecordReferenceError(
        `Source contract status is not eligible: ${sourceContract.status}`,
      );
    }

    if (
      candidate.beneficiary.beneficiaryKind ===
      "EMPLOYMENT_PROFILE"
    ) {
      if (
        sourceContract.linkedEntityKind !==
          "EMPLOYMENT_PROFILE" ||
        sourceContract.contractKind !==
          "EMPLOYMENT" ||
        sourceContract.linkedEmploymentProfileId !==
          candidate.beneficiary
            .beneficiaryEmploymentProfileId
      ) {
        throw new CommissionInvalidContractRecordReferenceError(
          "Source contract is incompatible with EMPLOYMENT_PROFILE beneficiary",
        );
      }
    } else {
      if (
        sourceContract.linkedEntityKind !== "TALENT" ||
        !ALLOWED_TALENT_CONTRACT_KINDS.has(
          sourceContract.contractKind,
        ) ||
        sourceContract.linkedTalentId !==
          candidate.beneficiary.beneficiaryTalentId
      ) {
        throw new CommissionInvalidContractRecordReferenceError(
          "Source contract is incompatible with TALENT beneficiary",
        );
      }
    }

    return sourceContract;
  }

  private async assertBeneficiaryEligible(
    beneficiary: NormalizedRuleBeneficiary,
    session: ClientSession,
    validationContext:
      | "create"
      | "update"
      | "activation",
  ): Promise<void> {
    if (
      beneficiary.beneficiaryKind ===
      "EMPLOYMENT_PROFILE"
    ) {
      const employmentProfile =
        await this.employmentProfileReadonlyAccess.findById(
          beneficiary.beneficiaryEmploymentProfileId as string,
          session,
        );

      if (!employmentProfile) {
        throw new CommissionInvalidBeneficiaryReferenceError(
          "Referenced Employment Profile does not exist",
        );
      }

      if (
        !BENEFICIARY_ELIGIBLE_EMPLOYMENT_STATUSES.has(
          employmentProfile.employmentStatus,
        )
      ) {
        throw new CommissionInvalidBeneficiaryReferenceError(
          `Employment Profile beneficiary must be ACTIVE or ON_LEAVE at ${validationContext} time`,
        );
      }

      return;
    }

    const talent = await this.talentReadonlyAccess.findById(
      beneficiary.beneficiaryTalentId as string,
      session,
    );

    if (!talent) {
      throw new CommissionInvalidBeneficiaryReferenceError(
        "Referenced Talent does not exist",
      );
    }

    if (talent.operationalStatus === "ARCHIVED") {
      throw new CommissionInvalidBeneficiaryReferenceError(
        `Talent beneficiary must not be ARCHIVED at ${validationContext} time`,
      );
    }
  }

  private async assertBeneficiarySnapshotResolvable(
    snapshot: SettlementSourceSnapshot,
    session: ClientSession,
  ): Promise<void> {
    if (
      snapshot.beneficiaryKindSnapshot ===
      "EMPLOYMENT_PROFILE"
    ) {
      const employmentProfile =
        await this.employmentProfileReadonlyAccess.findById(
          snapshot.beneficiaryEmploymentProfileIdSnapshot as string,
          session,
        );

      if (!employmentProfile) {
        throw new CommissionInvalidBeneficiaryReferenceError(
          "Settlement beneficiary Employment Profile is not resolvable",
        );
      }

      return;
    }

    const talent = await this.talentReadonlyAccess.findById(
      snapshot.beneficiaryTalentIdSnapshot as string,
      session,
    );

    if (!talent) {
      throw new CommissionInvalidBeneficiaryReferenceError(
        "Settlement beneficiary Talent is not resolvable",
      );
    }
  }

  private async assertSourceContractSnapshotResolvable(
    sourceContractRecordIdSnapshot: string,
    session: ClientSession,
  ): Promise<void> {
    const contractRecord =
      await this.contractReadonlyAccess.findById(
        sourceContractRecordIdSnapshot,
        session,
      );

    if (!contractRecord) {
      throw new CommissionInvalidContractRecordReferenceError(
        "Settlement source contract snapshot is not resolvable",
      );
    }
  }

  private async evaluateRevenueSelection(params: {
    readonly sourceRule: CommissionRule;
    readonly sourceSnapshot: SettlementSourceSnapshot;
    readonly settlementPeriodStartAt: number;
    readonly settlementPeriodEndAt: number;
    readonly revenueEntryIds: readonly string[];
    readonly excludeCommissionSettlementId?: string;
    readonly session: ClientSession;
  }): Promise<RevenueSelectionEvaluation> {
    const canonicalRevenueEntryIds =
      canonicalizeRequiredNonEmptyIdSet(
        params.revenueEntryIds,
        "revenueEntryIds",
      );

    const entries =
      await this.revenueLedgerReadonlyAccess.findByIds(
        canonicalRevenueEntryIds,
        params.session,
      );

    if (entries.length !== canonicalRevenueEntryIds.length) {
      const foundIds = new Set(entries.map((entry) => entry.id));
      const missingIds = canonicalRevenueEntryIds.filter(
        (id) => !foundIds.has(id),
      );

      throw new CommissionInvalidRevenueEntrySelectionError(
        `Revenue entries are missing: ${missingIds.join(", ")}`,
      );
    }

    const appliedRevenueKinds = new Set(
      params.sourceRule.appliesToRevenueKinds,
    );

    const ruleWindow =
      toRuleEffectiveWindowBounds(params.sourceRule);

    let derivedSubjectTalentId: string | null = null;
    let derivedCurrencyCode: string | null = null;
    const lineDrafts: SettlementDerivedLine[] = [];
    let grossRevenueCents = 0;
    let settlementAmountCents = 0;

    const byId = new Map<string, CommissionReferencedRevenueEntry>();
    for (const entry of entries) {
      byId.set(entry.id, entry);
    }

    for (const revenueEntryId of canonicalRevenueEntryIds) {
      const entry = byId.get(revenueEntryId);

      if (!entry) {
        throw new CommissionInvalidRevenueEntrySelectionError(
          `Revenue entry does not exist: ${revenueEntryId}`,
        );
      }

      assertRevenueEntrySelectionStatusRule(entry);

      if (!appliedRevenueKinds.has(entry.revenueKind)) {
        throw new CommissionInvalidRevenueEntrySelectionError(
          `Revenue entry ${entry.id} has non-applicable revenueKind ${entry.revenueKind}`,
        );
      }

      if (
        entry.recognizedAt <
          params.settlementPeriodStartAt ||
        entry.recognizedAt >=
          params.settlementPeriodEndAt
      ) {
        throw new CommissionInvalidRevenueEntrySelectionError(
          `Revenue entry ${entry.id} recognizedAt is outside settlement period`,
        );
      }

      if (
        entry.recognizedAt < ruleWindow.startAt ||
        entry.recognizedAt >= ruleWindow.endAtExclusive
      ) {
        throw new CommissionInvalidRevenueEntrySelectionError(
          `Revenue entry ${entry.id} recognizedAt is outside source rule effective window`,
        );
      }

      if (!derivedSubjectTalentId) {
        derivedSubjectTalentId = entry.subjectTalentId;
      } else if (
        derivedSubjectTalentId !== entry.subjectTalentId
      ) {
        throw new CommissionInvalidRevenueEntrySelectionError(
          "All selected Revenue Entries must share the same subjectTalentId",
        );
      }

      if (!derivedCurrencyCode) {
        derivedCurrencyCode = entry.currencyCode;
      } else if (
        derivedCurrencyCode !== entry.currencyCode
      ) {
        throw new CommissionInvalidRevenueEntrySelectionError(
          "All selected Revenue Entries must share one currencyCode",
        );
      }

      const lineAmount = roundHalfUp(
        (entry.recognizedAmount *
          params.sourceRule.ratePercent) /
          100,
        2,
      );

      if (lineAmount <= 0) {
        throw new CommissionInvalidRevenueEntrySelectionError(
          `Revenue entry ${entry.id} yields non-positive lineSettlementAmount`,
        );
      }

      const lineAmountCents = toCents(lineAmount);
      const recognizedAmountCents = toCents(
        entry.recognizedAmount,
      );

      grossRevenueCents += recognizedAmountCents;
      settlementAmountCents += lineAmountCents;

      lineDrafts.push({
        revenueEntryId: entry.id,
        revenueEntryCodeSnapshot:
          entry.revenueEntryCode,
        revenueKindSnapshot: entry.revenueKind,
        revenueCurrencyCodeSnapshot:
          entry.currencyCode,
        revenueRecognizedAmountSnapshot:
          sanitizeNegativeZero(entry.recognizedAmount),
        revenueRecognizedAtSnapshot:
          entry.recognizedAt,
        lineSettlementAmount:
          sanitizeNegativeZero(lineAmount),
      });
    }

    const subjectTalentId =
      normalizeRequiredNonEmptyString(
        derivedSubjectTalentId,
        "subjectTalentId",
      );

    const subjectTalent =
      await this.talentReadonlyAccess.findById(
        subjectTalentId,
        params.session,
      );

    if (!subjectTalent) {
      throw new CommissionInvalidRevenueEntrySelectionError(
        `Derived subjectTalentId is not resolvable: ${subjectTalentId}`,
      );
    }

    if (
      params.sourceSnapshot.beneficiaryKindSnapshot ===
        "TALENT" &&
      params.sourceSnapshot
        .beneficiaryTalentIdSnapshot !==
        subjectTalentId
    ) {
      throw new CommissionInvalidRevenueEntrySelectionError(
        "When beneficiaryKindSnapshot is TALENT, subjectTalentId must equal beneficiaryTalentIdSnapshot",
      );
    }

    const exclusivityConflict =
      await this.repository.findSettlementExclusivityConflict(
        {
          beneficiaryKindSnapshot:
            params.sourceSnapshot
              .beneficiaryKindSnapshot,
          beneficiaryEmploymentProfileIdSnapshot:
            params.sourceSnapshot
              .beneficiaryEmploymentProfileIdSnapshot,
          beneficiaryTalentIdSnapshot:
            params.sourceSnapshot
              .beneficiaryTalentIdSnapshot,
          revenueEntryIds: canonicalRevenueEntryIds,
          excludeCommissionSettlementId:
            params.excludeCommissionSettlementId,
        },
        params.session,
      );

    assertNoSettlementExclusivityConflict(
      exclusivityConflict,
    );

    return {
      canonicalRevenueEntryIds,
      subjectTalentId,
      settlementCurrencyCode:
        normalizeRequiredNonEmptyString(
          derivedCurrencyCode,
          "settlementCurrencyCode",
        ),
      grossRevenueAmount:
        sanitizeNegativeZero(
          grossRevenueCents / 100,
        ),
      settlementAmount:
        sanitizeNegativeZero(
          settlementAmountCents / 100,
        ),
      lines: lineDrafts,
    };
  }

  private async recordRuleAudit(params: {
    readonly actor: Actor;
    readonly permission: PermissionContract;
    readonly commissionRuleId: string;
    readonly mutationType: AuthoritativeAdminMutationIdentity;
    readonly metadata: Readonly<Record<string, unknown>>;
    readonly session: ClientSession;
  }): Promise<void> {
    await this.audit.record(
      params.actor,
      params.permission,
      params.commissionRuleId,
      {
        mutationType: params.mutationType,
        targetId: params.commissionRuleId,
        targetType: "commission-rule",
        actorId: params.actor.id,
        ...params.metadata,
      },
      params.session,
    );
  }

  private async recordSettlementAudit(params: {
    readonly actor: Actor;
    readonly permission: PermissionContract;
    readonly commissionSettlementId: string;
    readonly mutationType: AuthoritativeAdminMutationIdentity;
    readonly metadata: Readonly<Record<string, unknown>>;
    readonly session: ClientSession;
  }): Promise<void> {
    await this.audit.record(
      params.actor,
      params.permission,
      params.commissionSettlementId,
      {
        mutationType: params.mutationType,
        targetId: params.commissionSettlementId,
        targetType: "commission-settlement",
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
            classifyCommissionMutationFailure(
              error,
            ),
          errorCode: extractErrorCode(error),
          errorMessage: truncateLogMessage(error),
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

function normalizeCreateRuleCommand(
  command: CreateCommissionRuleCommand,
): NormalizedCreateRuleCommand {
  const title = normalizeRequiredNonEmptyString(
    command.title,
    "title",
  );
  const beneficiaryKind = normalizeBeneficiaryKind(
    command.beneficiaryKind,
  );
  const beneficiary: NormalizedRuleBeneficiary = {
    beneficiaryKind,
    beneficiaryEmploymentProfileId:
      normalizeOptionalNullableId(
        command.beneficiaryEmploymentProfileId,
        "beneficiaryEmploymentProfileId",
        {
          missingAsNull: true,
        },
      ) ?? null,
    beneficiaryTalentId: normalizeOptionalNullableId(
      command.beneficiaryTalentId,
      "beneficiaryTalentId",
      {
        missingAsNull: true,
      },
    ) ?? null,
  };

  return {
    ruleCode: normalizeOptionalCreateCode(
      command.ruleCode,
      "ruleCode",
    ),
    title,
    normalizedTitle: canonicalizeSearchToken(title),
    settlementKind: normalizeSettlementKind(
      command.settlementKind,
    ),
    beneficiary,
    sourceContractRecordId:
      normalizeRequiredNonEmptyString(
        command.sourceContractRecordId,
        "sourceContractRecordId",
      ),
    settlementBasis: normalizeSettlementBasis(
      command.settlementBasis,
    ),
    ratePercent: normalizeRatePercent(
      command.ratePercent,
      "ratePercent",
    ),
    appliesToRevenueKinds: canonicalizeRevenueKinds(
      normalizeRequiredRevenueKindsSet(
        command.appliesToRevenueKinds,
        "appliesToRevenueKinds",
      ),
    ),
    effectiveStartDate:
      normalizeRequiredCanonicalCalendarDateValue(
        command.effectiveStartDate,
        "effectiveStartDate",
      ),
    effectiveEndDate:
      normalizeOptionalNullableCanonicalCalendarDateValue(
        command.effectiveEndDate,
        "effectiveEndDate",
        {
          missingAsNull: true,
        },
      ) ?? null,
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

function normalizeUpdateRuleDraftCoreCommand(
  command: UpdateCommissionRuleDraftCoreCommand,
): NormalizedUpdateRuleDraftCoreCommand {
  const title = normalizeOptionalNonEmptyString(
    command.title,
    "title",
  );

  return {
    commissionRuleId:
      normalizeRequiredNonEmptyString(
        command.commissionRuleId,
        "commissionRuleId",
      ),
    title,
    normalizedTitle:
      title === undefined
        ? undefined
        : canonicalizeSearchToken(title),
    ratePercent:
      command.ratePercent === undefined
        ? undefined
        : normalizeRatePercent(
            command.ratePercent,
            "ratePercent",
          ),
    appliesToRevenueKinds:
      command.appliesToRevenueKinds === undefined
        ? undefined
        : canonicalizeRevenueKinds(
            normalizeRequiredRevenueKindsSet(
              command.appliesToRevenueKinds,
              "appliesToRevenueKinds",
            ),
          ),
    effectiveStartDate:
      command.effectiveStartDate === undefined
        ? undefined
        : normalizeRequiredCanonicalCalendarDateValue(
            command.effectiveStartDate,
            "effectiveStartDate",
          ),
    effectiveEndDate:
      normalizeOptionalNullableCanonicalCalendarDateValue(
        command.effectiveEndDate,
        "effectiveEndDate",
        {
          missingAsUndefined: true,
        },
      ),
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
  };
}

function normalizeRuleLifecycleCommand(
  command:
    | ActivateCommissionRuleCommand
    | DeactivateCommissionRuleCommand
    | ArchiveCommissionRuleCommand,
): NormalizedRuleLifecycleCommand {
  return {
    commissionRuleId:
      normalizeRequiredNonEmptyString(
        command.commissionRuleId,
        "commissionRuleId",
      ),
  };
}

function normalizeCreateSettlementCommand(
  command: CreateCommissionSettlementCommand,
): NormalizedCreateSettlementCommand {
  const title = normalizeRequiredNonEmptyString(
    command.title,
    "title",
  );

  return {
    settlementCode:
      normalizeOptionalCreateCode(
        command.settlementCode,
        "settlementCode",
      ),
    title,
    normalizedTitle: canonicalizeSearchToken(title),
    sourceRuleId: normalizeRequiredNonEmptyString(
      command.sourceRuleId,
      "sourceRuleId",
    ),
    settlementPeriodStartAt:
      normalizeRequiredIntegerTimestamp(
        command.settlementPeriodStartAt,
        "settlementPeriodStartAt",
      ),
    settlementPeriodEndAt:
      normalizeRequiredIntegerTimestamp(
        command.settlementPeriodEndAt,
        "settlementPeriodEndAt",
      ),
    revenueEntryIds: canonicalizeRequiredNonEmptyIdSet(
      command.revenueEntryIds,
      "revenueEntryIds",
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

function normalizeUpdateSettlementDraftCoreCommand(
  command: UpdateCommissionSettlementDraftCoreCommand,
): NormalizedUpdateSettlementDraftCoreCommand {
  const title = normalizeOptionalNonEmptyString(
    command.title,
    "title",
  );

  return {
    commissionSettlementId:
      normalizeRequiredNonEmptyString(
        command.commissionSettlementId,
        "commissionSettlementId",
      ),
    title,
    normalizedTitle:
      title === undefined
        ? undefined
        : canonicalizeSearchToken(title),
    settlementPeriodStartAt:
      command.settlementPeriodStartAt === undefined
        ? undefined
        : normalizeRequiredIntegerTimestamp(
            command.settlementPeriodStartAt,
            "settlementPeriodStartAt",
          ),
    settlementPeriodEndAt:
      command.settlementPeriodEndAt === undefined
        ? undefined
        : normalizeRequiredIntegerTimestamp(
            command.settlementPeriodEndAt,
            "settlementPeriodEndAt",
          ),
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
  };
}

function normalizeReplaceSettlementRevenueEntriesCommand(
  command: ReplaceCommissionSettlementRevenueEntriesCommand,
): NormalizedReplaceSettlementRevenueEntriesCommand {
  return {
    commissionSettlementId:
      normalizeRequiredNonEmptyString(
        command.commissionSettlementId,
        "commissionSettlementId",
      ),
    revenueEntryIds: canonicalizeRequiredNonEmptyIdSet(
      command.revenueEntryIds,
      "revenueEntryIds",
    ),
  };
}

function normalizeSettlementLifecycleCommand(
  command:
    | FinalizeCommissionSettlementCommand
    | VoidCommissionSettlementCommand
    | ArchiveCommissionSettlementCommand,
): NormalizedSettlementLifecycleCommand {
  return {
    commissionSettlementId:
      normalizeRequiredNonEmptyString(
        command.commissionSettlementId,
        "commissionSettlementId",
      ),
  };
}

function buildRuleDraftCorePatch(
  current: CommissionRule,
  command: NormalizedUpdateRuleDraftCoreCommand,
): RuleDraftCorePatchBuildResult {
  const update: RuleDraftCorePatchBuildResult["update"] =
    {};
  const changedFields: string[] = [];

  if (
    command.title !== undefined &&
    command.title !== current.title
  ) {
    update.title = command.title;
    update.normalizedTitle =
      command.normalizedTitle;
    changedFields.push("title");
  }

  if (
    command.ratePercent !== undefined &&
    command.ratePercent !== current.ratePercent
  ) {
    update.ratePercent = command.ratePercent;
    changedFields.push("ratePercent");
  }

  if (
    command.appliesToRevenueKinds !== undefined &&
    !areCanonicalRevenueKindSetsEqual(
      command.appliesToRevenueKinds,
      current.appliesToRevenueKinds,
    )
  ) {
    update.appliesToRevenueKinds =
      command.appliesToRevenueKinds;
    changedFields.push("appliesToRevenueKinds");
  }

  if (
    command.effectiveStartDate !== undefined &&
    command.effectiveStartDate !==
      current.effectiveStartDate
  ) {
    update.effectiveStartDate =
      command.effectiveStartDate;
    changedFields.push("effectiveStartDate");
  }

  if (
    command.effectiveEndDate !== undefined &&
    command.effectiveEndDate !== current.effectiveEndDate
  ) {
    update.effectiveEndDate =
      command.effectiveEndDate;
    changedFields.push("effectiveEndDate");
  }

  if (
    command.description !== undefined &&
    command.description !== current.description
  ) {
    update.description = command.description;
    changedFields.push("description");
  }

  if (
    command.externalRef !== undefined &&
    command.externalRef !== current.externalRef
  ) {
    update.externalRef = command.externalRef;
    changedFields.push("externalRef");
  }

  const candidate: RuleCandidateState = {
    settlementKind: current.settlementKind,
    beneficiary: {
      beneficiaryKind: current.beneficiaryKind,
      beneficiaryEmploymentProfileId:
        current.beneficiaryEmploymentProfileId,
      beneficiaryTalentId:
        current.beneficiaryTalentId,
    },
    sourceContractRecordId:
      current.sourceContractRecordId,
    settlementBasis: current.settlementBasis,
    ratePercent:
      command.ratePercent ?? current.ratePercent,
    appliesToRevenueKinds:
      command.appliesToRevenueKinds ??
      current.appliesToRevenueKinds,
    effectiveStartDate:
      command.effectiveStartDate ??
      current.effectiveStartDate,
    effectiveEndDate:
      command.effectiveEndDate !== undefined
        ? command.effectiveEndDate
        : current.effectiveEndDate,
  };

  return {
    update,
    candidate,
    changedFields,
  };
}

function buildSettlementDraftCorePatch(
  current: CommissionSettlement,
  command: NormalizedUpdateSettlementDraftCoreCommand,
): SettlementDraftCorePatchBuildResult {
  const update: SettlementDraftCorePatchBuildResult["update"] =
    {};
  const changedFields: string[] = [];

  if (
    command.title !== undefined &&
    command.title !== current.title
  ) {
    update.title = command.title;
    update.normalizedTitle =
      command.normalizedTitle;
    changedFields.push("title");
  }

  if (
    command.settlementPeriodStartAt !== undefined &&
    command.settlementPeriodStartAt !==
      current.settlementPeriodStartAt
  ) {
    update.settlementPeriodStartAt =
      command.settlementPeriodStartAt;
    changedFields.push("settlementPeriodStartAt");
  }

  if (
    command.settlementPeriodEndAt !== undefined &&
    command.settlementPeriodEndAt !==
      current.settlementPeriodEndAt
  ) {
    update.settlementPeriodEndAt =
      command.settlementPeriodEndAt;
    changedFields.push("settlementPeriodEndAt");
  }

  if (
    command.description !== undefined &&
    command.description !== current.description
  ) {
    update.description = command.description;
    changedFields.push("description");
  }

  if (
    command.externalRef !== undefined &&
    command.externalRef !== current.externalRef
  ) {
    update.externalRef = command.externalRef;
    changedFields.push("externalRef");
  }

  return {
    update,
    candidateSettlementPeriodStartAt:
      command.settlementPeriodStartAt ??
      current.settlementPeriodStartAt,
    candidateSettlementPeriodEndAt:
      command.settlementPeriodEndAt ??
      current.settlementPeriodEndAt,
    changedFields,
  };
}

function buildRuleDraftCoreAuditDelta(
  before: CommissionRule,
  after: CommissionRule,
  changedFields: readonly string[],
): Readonly<Record<string, unknown>> {
  const changedSet = new Set(changedFields);
  const metadata: Record<string, unknown> = {};

  if (changedSet.has("title")) {
    metadata.titleBefore = before.title;
    metadata.titleAfter = after.title;
  }

  if (changedSet.has("ratePercent")) {
    metadata.ratePercentBefore = before.ratePercent;
    metadata.ratePercentAfter = after.ratePercent;
  }

  if (changedSet.has("appliesToRevenueKinds")) {
    metadata.appliesToRevenueKindsBefore =
      before.appliesToRevenueKinds;
    metadata.appliesToRevenueKindsAfter =
      after.appliesToRevenueKinds;
  }

  if (changedSet.has("effectiveStartDate")) {
    metadata.effectiveStartDateBefore =
      before.effectiveStartDate;
    metadata.effectiveStartDateAfter =
      after.effectiveStartDate;
  }

  if (changedSet.has("effectiveEndDate")) {
    metadata.effectiveEndDateBefore =
      before.effectiveEndDate;
    metadata.effectiveEndDateAfter =
      after.effectiveEndDate;
  }

  if (changedSet.has("description")) {
    metadata.descriptionBefore = before.description;
    metadata.descriptionAfter = after.description;
  }

  if (changedSet.has("externalRef")) {
    metadata.externalRefBefore = before.externalRef;
    metadata.externalRefAfter = after.externalRef;
  }

  return Object.freeze(metadata);
}

function buildSettlementDraftCoreAuditDelta(
  before: CommissionSettlement,
  after: CommissionSettlement,
  changedFields: readonly string[],
): Readonly<Record<string, unknown>> {
  const changedSet = new Set(changedFields);
  const metadata: Record<string, unknown> = {};

  if (changedSet.has("title")) {
    metadata.titleBefore = before.title;
    metadata.titleAfter = after.title;
  }

  if (changedSet.has("settlementPeriodStartAt")) {
    metadata.settlementPeriodStartAtBefore =
      before.settlementPeriodStartAt;
    metadata.settlementPeriodStartAtAfter =
      after.settlementPeriodStartAt;
  }

  if (changedSet.has("settlementPeriodEndAt")) {
    metadata.settlementPeriodEndAtBefore =
      before.settlementPeriodEndAt;
    metadata.settlementPeriodEndAtAfter =
      after.settlementPeriodEndAt;
  }

  if (changedSet.has("description")) {
    metadata.descriptionBefore = before.description;
    metadata.descriptionAfter = after.description;
  }

  if (changedSet.has("externalRef")) {
    metadata.externalRefBefore = before.externalRef;
    metadata.externalRefAfter = after.externalRef;
  }

  return Object.freeze(metadata);
}

function assertSettlementKindCompatibilityRule(
  settlementKind: CommissionSettlementKind,
  beneficiaryKind: CommissionBeneficiaryKind,
): void {
  if (
    settlementKind === "REVENUE_SHARE" &&
    beneficiaryKind !== "TALENT"
  ) {
    throw new CommissionValidationError(
      "settlementKind REVENUE_SHARE requires beneficiaryKind TALENT",
    );
  }
}

function assertBeneficiaryReferenceShape(
  beneficiary: NormalizedRuleBeneficiary,
): void {
  if (
    beneficiary.beneficiaryKind ===
    "EMPLOYMENT_PROFILE"
  ) {
    if (
      beneficiary.beneficiaryEmploymentProfileId &&
      beneficiary.beneficiaryTalentId === null
    ) {
      return;
    }

    throw new CommissionValidationError(
      "beneficiaryKind EMPLOYMENT_PROFILE requires beneficiaryEmploymentProfileId and forbids beneficiaryTalentId",
    );
  }

  if (
    beneficiary.beneficiaryKind === "TALENT" &&
    beneficiary.beneficiaryTalentId &&
    beneficiary.beneficiaryEmploymentProfileId === null
  ) {
    return;
  }

  throw new CommissionValidationError(
    "beneficiaryKind TALENT requires beneficiaryTalentId and forbids beneficiaryEmploymentProfileId",
  );
}

function assertSettlementBasisRule(
  settlementBasis: CommissionSettlementBasis,
): void {
  if (settlementBasis === "RECOGNIZED_GROSS_REVENUE") {
    return;
  }

  throw new CommissionValidationError(
    "settlementBasis must be RECOGNIZED_GROSS_REVENUE",
  );
}

function assertRateValidationRule(
  ratePercent: number,
): void {
  if (
    !Number.isFinite(ratePercent) ||
    ratePercent <= 0 ||
    ratePercent > 100
  ) {
    throw new CommissionInvalidRateError(
      "ratePercent must satisfy 0 < ratePercent <= 100",
    );
  }

  const scaled = Math.round(ratePercent * 10000) / 10000;
  if (Math.abs(ratePercent - scaled) > 1e-9) {
    throw new CommissionInvalidRateError(
      "ratePercent must have at most 4 decimal places",
    );
  }
}

function assertRuleEffectiveWindowRule(
  effectiveStartDate: number,
  effectiveEndDate: number | null,
  sourceContract: Pick<
    CommissionReferencedContractRecord,
    "effectiveStartDate" | "effectiveEndDate"
  >,
): void {
  if (
    effectiveEndDate !== null &&
    effectiveEndDate < effectiveStartDate
  ) {
    throw new CommissionValidationError(
      "effectiveEndDate must not be earlier than effectiveStartDate",
    );
  }

  if (effectiveStartDate < sourceContract.effectiveStartDate) {
    throw new CommissionInvalidContractRecordReferenceError(
      "Rule effectiveStartDate must not be earlier than source contract effectiveStartDate",
    );
  }

  if (sourceContract.effectiveEndDate !== null) {
    if (effectiveEndDate === null) {
      throw new CommissionInvalidContractRecordReferenceError(
        "Rule effectiveEndDate is required when source contract effectiveEndDate is present",
      );
    }

    if (effectiveEndDate > sourceContract.effectiveEndDate) {
      throw new CommissionInvalidContractRecordReferenceError(
        "Rule effectiveEndDate must not be later than source contract effectiveEndDate",
      );
    }
  }
}

function assertRuleActivationWindowOpen(
  rule: Pick<
    CommissionRule,
    "effectiveEndDate"
  >,
): void {
  if (rule.effectiveEndDate === null) {
    return;
  }

  const evaluationDate =
    toCanonicalUtcDateAtMidnight(Date.now());
  if (evaluationDate > rule.effectiveEndDate) {
    throw new CommissionStateError(
      "activateCommissionRule is forbidden because rule effective window is already ended",
    );
  }
}

function assertSettlementPeriodRule(
  settlementPeriodStartAt: number,
  settlementPeriodEndAt: number,
  sourceRule: Pick<
    CommissionRule,
    "effectiveStartDate" | "effectiveEndDate"
  >,
): void {
  if (settlementPeriodEndAt <= settlementPeriodStartAt) {
    throw new CommissionValidationError(
      "settlementPeriodEndAt must be strictly greater than settlementPeriodStartAt",
    );
  }

  const evaluationTime = Date.now();
  if (settlementPeriodEndAt > evaluationTime) {
    throw new CommissionValidationError(
      "settlementPeriodEndAt must not be later than evaluation time",
    );
  }

  const ruleWindow =
    toRuleEffectiveWindowBounds(sourceRule);

  if (settlementPeriodStartAt < ruleWindow.startAt) {
    throw new CommissionValidationError(
      "settlement period must fit inside source rule effective window",
    );
  }

  if (
    settlementPeriodEndAt >
    ruleWindow.endAtExclusive
  ) {
    throw new CommissionValidationError(
      "settlement period must fit inside source rule effective window",
    );
  }
}

function toRuleEffectiveWindowBounds(
  sourceRule: Pick<
    CommissionRule,
    "effectiveStartDate" | "effectiveEndDate"
  >,
): {
  readonly startAt: number;
  readonly endAtExclusive: number;
} {
  return {
    startAt: sourceRule.effectiveStartDate,
    endAtExclusive:
      sourceRule.effectiveEndDate === null
        ? Number.POSITIVE_INFINITY
        : sourceRule.effectiveEndDate +
          24 * 60 * 60 * 1000,
  };
}

function assertRevenueEntrySelectionStatusRule(
  entry: Pick<CommissionReferencedRevenueEntry, "id" | "status">,
): void {
  if (REVENUE_ENTRY_ELIGIBLE_STATUSES.has(entry.status)) {
    return;
  }

  throw new CommissionInvalidRevenueEntrySelectionError(
    `Revenue entry ${entry.id} must be FINALIZED or RECONCILED`,
  );
}

function assertNoSettlementExclusivityConflict(
  conflict: SettlementExclusivityConflictProbeResult | null,
): void {
  if (!conflict) {
    return;
  }

  throw new CommissionSettlementExclusivityConflictError(
    `Revenue entry ${conflict.conflictingRevenueEntryId} is already included in settlement ${conflict.settlementId} for the same beneficiary snapshot`,
  );
}

function canonicalizeRevenueKinds(
  revenueKinds: readonly RevenueKind[],
): readonly RevenueKind[] {
  const rank = new Map<RevenueKind, number>();
  REVENUE_ENTRY_KINDS.forEach((kind, index) => {
    rank.set(kind, index);
  });

  return [...revenueKinds].sort((left, right) => {
    const leftRank = rank.get(left);
    const rightRank = rank.get(right);

    if (
      leftRank === undefined ||
      rightRank === undefined
    ) {
      return left.localeCompare(right);
    }

    return leftRank - rightRank;
  });
}

function areCanonicalRevenueKindSetsEqual(
  left: readonly RevenueKind[],
  right: readonly RevenueKind[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) {
      return false;
    }
  }

  return true;
}

function canonicalizeRequiredNonEmptyIdSet(
  value: unknown,
  field: string,
): readonly string[] {
  if (!Array.isArray(value)) {
    throw new CommissionValidationError(
      `${field} must be an array`,
    );
  }

  if (value.length === 0) {
    throw new CommissionValidationError(
      `${field} must contain at least one id`,
    );
  }

  const unique = new Set<string>();

  for (const item of value) {
    const normalized = normalizeRequiredNonEmptyString(
      item,
      field,
    );

    if (unique.has(normalized)) {
      throw new CommissionValidationError(
        `${field} contains duplicate id ${normalized}`,
      );
    }

    unique.add(normalized);
  }

  return [...unique].sort((left, right) =>
    left.localeCompare(right),
  );
}

function areCanonicalIdSetsEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) {
      return false;
    }
  }

  return true;
}

function normalizeRequiredRevenueKindsSet(
  value: unknown,
  field: string,
): readonly RevenueKind[] {
  if (!Array.isArray(value)) {
    throw new CommissionValidationError(
      `${field} must be an array`,
    );
  }

  if (value.length === 0) {
    throw new CommissionValidationError(
      `${field} must contain at least one revenue kind`,
    );
  }

  const unique = new Set<RevenueKind>();

  for (const item of value) {
    const revenueKind = normalizeRevenueKind(
      item,
      field,
    );

    if (unique.has(revenueKind)) {
      throw new CommissionValidationError(
        `${field} contains duplicate revenue kind ${revenueKind}`,
      );
    }

    unique.add(revenueKind);
  }

  return [...unique.values()];
}

function normalizeSettlementKind(
  value: unknown,
): CommissionSettlementKind {
  if (typeof value !== "string") {
    throw new CommissionValidationError(
      `settlementKind must be one of ${COMMISSION_SETTLEMENT_KINDS.join(", ")}`,
    );
  }

  const normalized = value.trim().toUpperCase();

  if (
    COMMISSION_SETTLEMENT_KINDS.includes(
      normalized as CommissionSettlementKind,
    )
  ) {
    return normalized as CommissionSettlementKind;
  }

  throw new CommissionValidationError(
    `settlementKind must be one of ${COMMISSION_SETTLEMENT_KINDS.join(", ")}`,
  );
}

function normalizeBeneficiaryKind(
  value: unknown,
): CommissionBeneficiaryKind {
  if (typeof value !== "string") {
    throw new CommissionValidationError(
      `beneficiaryKind must be one of ${COMMISSION_BENEFICIARY_KINDS.join(", ")}`,
    );
  }

  const normalized = value.trim().toUpperCase();

  if (
    COMMISSION_BENEFICIARY_KINDS.includes(
      normalized as CommissionBeneficiaryKind,
    )
  ) {
    return normalized as CommissionBeneficiaryKind;
  }

  throw new CommissionValidationError(
    `beneficiaryKind must be one of ${COMMISSION_BENEFICIARY_KINDS.join(", ")}`,
  );
}

function normalizeSettlementBasis(
  value: unknown,
): CommissionSettlementBasis {
  if (typeof value !== "string") {
    throw new CommissionValidationError(
      `settlementBasis must be one of ${COMMISSION_SETTLEMENT_BASES.join(", ")}`,
    );
  }

  const normalized = value.trim().toUpperCase();

  if (
    COMMISSION_SETTLEMENT_BASES.includes(
      normalized as CommissionSettlementBasis,
    )
  ) {
    return normalized as CommissionSettlementBasis;
  }

  throw new CommissionValidationError(
    `settlementBasis must be one of ${COMMISSION_SETTLEMENT_BASES.join(", ")}`,
  );
}

function normalizeRevenueKind(
  value: unknown,
  field: string,
): RevenueKind {
  if (typeof value !== "string") {
    throw new CommissionValidationError(
      `${field} must contain revenue kinds from ${REVENUE_ENTRY_KINDS.join(", ")}`,
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

  throw new CommissionValidationError(
    `${field} must contain revenue kinds from ${REVENUE_ENTRY_KINDS.join(", ")}`,
  );
}

function normalizeRatePercent(
  value: unknown,
  field: string,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new CommissionInvalidRateError(
      `${field} must be a finite number`,
    );
  }

  if (value <= 0 || value > 100) {
    throw new CommissionInvalidRateError(
      `${field} must satisfy 0 < ${field} <= 100`,
    );
  }

  const rounded = Math.round(value * 10000) / 10000;

  if (Math.abs(value - rounded) > 1e-9) {
    throw new CommissionInvalidRateError(
      `${field} must have at most 4 decimal places`,
    );
  }

  return sanitizeNegativeZero(rounded);
}

function normalizeRequiredNonEmptyString(
  value: unknown,
  field: string,
): string {
  if (typeof value !== "string") {
    throw new CommissionValidationError(
      `${field} must be a string`,
    );
  }

  const normalized = value.trim();

  if (!normalized) {
    throw new CommissionValidationError(
      `${field} is required`,
    );
  }

  return normalized;
}

function normalizeOptionalCreateCode(
  value: unknown,
  field: string,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new CommissionValidationError(
      `${field} must be a string`,
    );
  }

  const normalized = value.trim();
  return normalized.length > 0
    ? normalized
    : undefined;
}

function normalizeOptionalNonEmptyString(
  value: unknown,
  field: string,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return normalizeRequiredNonEmptyString(value, field);
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

  const normalized = normalizeRequiredNonEmptyString(
    value,
    field,
  );

  return normalized;
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

  return normalizeRequiredNonEmptyString(value, field);
}

function normalizeRequiredIntegerTimestamp(
  value: unknown,
  field: string,
): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value)
  ) {
    throw new CommissionValidationError(
      `${field} must be an integer UTC timestamp`,
    );
  }

  return value;
}

function normalizeRequiredCanonicalCalendarDateValue(
  value: unknown,
  field: string,
): number {
  const timestamp = normalizeRequiredIntegerTimestamp(
    value,
    field,
  );

  if (!isCanonicalCalendarDate(timestamp)) {
    throw new CommissionValidationError(
      `${field} must be a canonical UTC calendar date timestamp at 00:00:00.000Z`,
    );
  }

  return timestamp;
}

function normalizeOptionalNullableCanonicalCalendarDateValue(
  value: unknown,
  field: string,
  options: {
    readonly missingAsNull?: boolean;
    readonly missingAsUndefined?: boolean;
  },
): number | null | undefined {
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

  return normalizeRequiredCanonicalCalendarDateValue(
    value,
    field,
  );
}

function isCanonicalCalendarDate(
  timestamp: number,
): boolean {
  const date = new Date(timestamp);

  return (
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0
  );
}

function toCanonicalUtcDateAtMidnight(
  timestamp: number,
): number {
  const date = new Date(timestamp);

  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  );
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

function toRuleMutationView(
  rule: CommissionRule,
): CommissionRuleMutationView {
  return {
    id: rule.id,
    ruleCode: rule.ruleCode,
    title: rule.title,
    settlementKind: rule.settlementKind,
    beneficiaryKind: rule.beneficiaryKind,
    beneficiaryEmploymentProfileId:
      rule.beneficiaryEmploymentProfileId,
    beneficiaryTalentId: rule.beneficiaryTalentId,
    sourceContractRecordId: rule.sourceContractRecordId,
    settlementBasis: rule.settlementBasis,
    ratePercent: rule.ratePercent,
    appliesToRevenueKinds: rule.appliesToRevenueKinds,
    status: rule.status,
    effectiveStartDate: rule.effectiveStartDate,
    effectiveEndDate: rule.effectiveEndDate,
    description: rule.description,
    externalRef: rule.externalRef,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
  };
}

function toSettlementMutationView(
  settlement: CommissionSettlement,
): CommissionSettlementMutationView {
  return {
    id: settlement.id,
    settlementCode: settlement.settlementCode,
    title: settlement.title,
    sourceRuleId: settlement.sourceRuleId,
    sourceContractRecordIdSnapshot:
      settlement.sourceContractRecordIdSnapshot,
    settlementKindSnapshot:
      settlement.settlementKindSnapshot,
    beneficiaryKindSnapshot:
      settlement.beneficiaryKindSnapshot,
    beneficiaryEmploymentProfileIdSnapshot:
      settlement.beneficiaryEmploymentProfileIdSnapshot,
    beneficiaryTalentIdSnapshot:
      settlement.beneficiaryTalentIdSnapshot,
    subjectTalentId: settlement.subjectTalentId,
    settlementBasisSnapshot:
      settlement.settlementBasisSnapshot,
    ratePercentSnapshot:
      settlement.ratePercentSnapshot,
    revenueEntryIds: settlement.revenueEntryIds,
    settlementPeriodStartAt:
      settlement.settlementPeriodStartAt,
    settlementPeriodEndAt:
      settlement.settlementPeriodEndAt,
    settlementCurrencyCode:
      settlement.settlementCurrencyCode,
    grossRevenueAmount:
      settlement.grossRevenueAmount,
    settlementAmount: settlement.settlementAmount,
    status: settlement.status,
    finalizedAt: settlement.finalizedAt,
    voidedAt: settlement.voidedAt,
    description: settlement.description,
    externalRef: settlement.externalRef,
    createdAt: settlement.createdAt,
    updatedAt: settlement.updatedAt,
  };
}

function toCents(value: number): number {
  return Math.round(value * 100);
}

function roundHalfUp(
  value: number,
  digits: number,
): number {
  const factor = 10 ** digits;
  const scaled = value * factor;
  const rounded =
    scaled >= 0
      ? Math.floor(scaled + 0.5)
      : Math.ceil(scaled - 0.5);

  return sanitizeNegativeZero(rounded / factor);
}

function sanitizeNegativeZero(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function resolveRequiredGlobalScope(
  actor: Actor,
): "global" {
  if (
    PermissionGuard.hasCommissionScopeGrant(
      actor,
      "global",
    )
  ) {
    return "global";
  }

  throw new CommissionPermissionScopeError(
    "Commission mutation requires global scope",
  );
}

function assertAdminActorType(actor: Actor): void {
  PermissionGuard.assertAdminActor(actor);
}

function assertRuleStructuralInvariants(
  rule: CommissionRule,
): void {
  if (!COMMISSION_RULE_STATUSES.includes(rule.status)) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      `Rule ${rule.id} has unsupported status ${rule.status}`,
    );
  }

  assertBeneficiaryReferenceShape({
    beneficiaryKind: rule.beneficiaryKind,
    beneficiaryEmploymentProfileId:
      rule.beneficiaryEmploymentProfileId,
    beneficiaryTalentId: rule.beneficiaryTalentId,
  });

  assertSettlementKindCompatibilityRule(
    rule.settlementKind,
    rule.beneficiaryKind,
  );
  assertSettlementBasisRule(rule.settlementBasis);
}

function assertSettlementStructuralInvariants(
  settlement: CommissionSettlement,
): void {
  if (
    !COMMISSION_SETTLEMENT_STATUSES.includes(
      settlement.status,
    )
  ) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      `Settlement ${settlement.id} has unsupported status ${settlement.status}`,
    );
  }

  if (settlement.revenueEntryIds.length === 0) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      `Settlement ${settlement.id} must contain at least one revenueEntryId`,
    );
  }

  if (
    settlement.settlementPeriodEndAt <=
    settlement.settlementPeriodStartAt
  ) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      `Settlement ${settlement.id} has invalid period range`,
    );
  }
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

function isDuplicateKeyError(
  error: unknown,
): error is MongoServerError {
  return (
    error instanceof MongoServerError &&
    error.code === 11000
  );
}

function classifyCommissionMutationFailure(
  error: unknown,
): CommissionMutationFailureClassification {
  if (error instanceof CommissionValidationError) {
    return "validation";
  }

  if (error instanceof CommissionConflictError) {
    return "conflict";
  }

  if (error instanceof CommissionNotFoundError) {
    return "not_found";
  }

  if (error instanceof CommissionStateError) {
    return "state_error";
  }

  if (
    error instanceof
    CommissionInvalidBeneficiaryReferenceError
  ) {
    return "invalid_beneficiary_reference";
  }

  if (
    error instanceof
    CommissionInvalidContractRecordReferenceError
  ) {
    return "invalid_contract_record_reference";
  }

  if (
    error instanceof
    CommissionInvalidRevenueEntrySelectionError
  ) {
    return "invalid_revenue_entry_selection";
  }

  if (
    error instanceof
    CommissionSettlementExclusivityConflictError
  ) {
    return "settlement_exclusivity_conflict";
  }

  if (error instanceof CommissionInvalidRateError) {
    return "invalid_rate";
  }

  if (
    error instanceof
    CommissionPermissionScopeError
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
