import { ClientSession } from "mongodb";
import {
  CommissionBeneficiaryKind,
  CommissionRule,
  CommissionRuleStatus,
  CommissionSettlement,
  CommissionSettlementLine,
  CommissionSettlementStatus,
} from "./commission.types";
import { RevenueKind } from "@modules/revenue-ledger/domain/revenue-ledger.types";

export interface UpdateCommissionRuleDraftCoreInput {
  readonly commissionRuleId: string;
  readonly title?: string;
  readonly normalizedTitle?: string;
  readonly ratePercent?: number;
  readonly appliesToRevenueKinds?: readonly RevenueKind[];
  readonly effectiveStartDate?: number;
  readonly effectiveEndDate?: number | null;
  readonly description?: string | null;
  readonly externalRef?: string | null;
  readonly updatedAt: number;
}

export interface TransitionCommissionRuleStatusInput {
  readonly commissionRuleId: string;
  readonly fromStatuses: readonly CommissionRuleStatus[];
  readonly toStatus: CommissionRuleStatus;
  readonly updatedAt: number;
}

export interface UpdateCommissionSettlementDraftCoreInput {
  readonly commissionSettlementId: string;
  readonly title?: string;
  readonly normalizedTitle?: string;
  readonly settlementPeriodStartAt?: number;
  readonly settlementPeriodEndAt?: number;
  readonly description?: string | null;
  readonly externalRef?: string | null;
  readonly updatedAt: number;
}

export interface UpdateCommissionSettlementDraftDerivedInput {
  readonly commissionSettlementId: string;
  readonly revenueEntryIds: readonly string[];
  readonly subjectTalentId: string;
  readonly settlementCurrencyCode: string;
  readonly grossRevenueAmount: number;
  readonly settlementAmount: number;
  readonly updatedAt: number;
}

export interface TouchCommissionSettlementDraftInput {
  readonly commissionSettlementId: string;
  readonly updatedAt: number;
}

export interface TransitionCommissionSettlementStatusInput {
  readonly commissionSettlementId: string;
  readonly fromStatuses: readonly CommissionSettlementStatus[];
  readonly toStatus: CommissionSettlementStatus;
  readonly finalizedAt?: number | null;
  readonly voidedAt?: number | null;
  readonly updatedAt: number;
}

export interface SettlementExclusivityConflictProbeInput {
  readonly beneficiaryKindSnapshot: CommissionBeneficiaryKind;
  readonly beneficiaryEmploymentProfileIdSnapshot: string | null;
  readonly beneficiaryTalentIdSnapshot: string | null;
  readonly revenueEntryIds: readonly string[];
  readonly excludeCommissionSettlementId?: string;
}

export interface SettlementExclusivityConflictProbeResult {
  readonly settlementId: string;
  readonly conflictingRevenueEntryId: string;
}

export interface CommissionRepository {
  insertRule(
    rule: CommissionRule,
    session: ClientSession,
  ): Promise<CommissionRule>;

  findRuleById(
    commissionRuleId: string,
    session?: ClientSession,
  ): Promise<CommissionRule | null>;

  findRuleByRuleCode(
    ruleCode: string,
    session?: ClientSession,
  ): Promise<CommissionRule | null>;

  updateRuleDraftCore(
    input: UpdateCommissionRuleDraftCoreInput,
    session: ClientSession,
  ): Promise<CommissionRule | null>;

  transitionRuleStatus(
    input: TransitionCommissionRuleStatusInput,
    session: ClientSession,
  ): Promise<CommissionRule | null>;

  insertSettlement(
    settlement: CommissionSettlement,
    session: ClientSession,
  ): Promise<CommissionSettlement>;

  findSettlementById(
    commissionSettlementId: string,
    session?: ClientSession,
  ): Promise<CommissionSettlement | null>;

  findSettlementBySettlementCode(
    settlementCode: string,
    session?: ClientSession,
  ): Promise<CommissionSettlement | null>;

  updateSettlementDraftCore(
    input: UpdateCommissionSettlementDraftCoreInput,
    session: ClientSession,
  ): Promise<CommissionSettlement | null>;

  updateSettlementDraftDerived(
    input: UpdateCommissionSettlementDraftDerivedInput,
    session: ClientSession,
  ): Promise<CommissionSettlement | null>;

  touchSettlementDraft(
    input: TouchCommissionSettlementDraftInput,
    session: ClientSession,
  ): Promise<CommissionSettlement | null>;

  transitionSettlementStatus(
    input: TransitionCommissionSettlementStatusInput,
    session: ClientSession,
  ): Promise<CommissionSettlement | null>;

  insertSettlementLines(
    lines: readonly CommissionSettlementLine[],
    session: ClientSession,
  ): Promise<readonly CommissionSettlementLine[]>;

  listSettlementLinesBySettlementId(
    commissionSettlementId: string,
    session?: ClientSession,
  ): Promise<readonly CommissionSettlementLine[]>;

  deleteSettlementLinesBySettlementId(
    commissionSettlementId: string,
    session: ClientSession,
  ): Promise<void>;

  findSettlementExclusivityConflict(
    input: SettlementExclusivityConflictProbeInput,
    session?: ClientSession,
  ): Promise<SettlementExclusivityConflictProbeResult | null>;
}
