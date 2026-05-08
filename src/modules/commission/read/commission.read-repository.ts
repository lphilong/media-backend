import {
  CommissionBeneficiaryKind,
  CommissionRuleByBeneficiaryListItemView,
  CommissionRuleByContractListItemView,
  CommissionRuleDetailView,
  CommissionRuleListItemView,
  CommissionRuleSortField,
  CommissionRuleStatus,
  CommissionSettlementByBeneficiaryListItemView,
  CommissionSettlementByRevenueEntryListItemView,
  CommissionSettlementBySubjectTalentListItemView,
  CommissionSettlementDetailView,
  CommissionSettlementKind,
  CommissionSettlementLineListItemView,
  CommissionSettlementListItemView,
  CommissionSettlementSortField,
  CommissionSettlementStatus,
  CommissionSortDirection,
} from "@modules/commission/domain/commission.types";
import { RevenueKind } from "@modules/revenue-ledger/domain/revenue-ledger.types";

export interface CommissionRuleListReadInput {
  readonly status?: CommissionRuleStatus;
  readonly settlementKind?: CommissionSettlementKind;
  readonly beneficiaryKind?: CommissionBeneficiaryKind;
  readonly beneficiaryEmploymentProfileId?: string;
  readonly beneficiaryTalentId?: string;
  readonly sourceContractRecordId?: string;
  readonly appliesToRevenueKind?: RevenueKind;
  readonly windowStartDate?: number;
  readonly windowEndDate?: number;
  readonly limit: number;
  readonly cursor?: string;
  readonly search?: string;
  readonly sortField?: CommissionRuleSortField;
  readonly sortDirection?: CommissionSortDirection;
}

export interface CommissionRuleByBeneficiaryReadInput {
  readonly beneficiaryKind: CommissionBeneficiaryKind;
  readonly beneficiaryEmploymentProfileId: string | null;
  readonly beneficiaryTalentId: string | null;
  readonly status?: CommissionRuleStatus;
  readonly limit: number;
  readonly cursor?: string;
  readonly sortField?: CommissionRuleSortField;
  readonly sortDirection?: CommissionSortDirection;
}

export interface CommissionRuleByContractReadInput {
  readonly sourceContractRecordId: string;
  readonly status?: CommissionRuleStatus;
  readonly limit: number;
  readonly cursor?: string;
  readonly sortField?: CommissionRuleSortField;
  readonly sortDirection?: CommissionSortDirection;
}

export interface CommissionSettlementListReadInput {
  readonly status?: CommissionSettlementStatus;
  readonly settlementKindSnapshot?: CommissionSettlementKind;
  readonly beneficiaryKindSnapshot?: CommissionBeneficiaryKind;
  readonly beneficiaryEmploymentProfileIdSnapshot?: string;
  readonly beneficiaryTalentIdSnapshot?: string;
  readonly subjectTalentId?: string;
  readonly sourceRuleId?: string;
  readonly containsRevenueEntryId?: string;
  readonly settlementCurrencyCode?: string;
  readonly windowStartAt?: number;
  readonly windowEndAt?: number;
  readonly limit: number;
  readonly cursor?: string;
  readonly search?: string;
  readonly sortField?: CommissionSettlementSortField;
  readonly sortDirection?: CommissionSortDirection;
}

export interface CommissionSettlementByBeneficiaryReadInput {
  readonly beneficiaryKindSnapshot: CommissionBeneficiaryKind;
  readonly beneficiaryEmploymentProfileIdSnapshot: string | null;
  readonly beneficiaryTalentIdSnapshot: string | null;
  readonly status?: CommissionSettlementStatus;
  readonly windowStartAt?: number;
  readonly windowEndAt?: number;
  readonly limit: number;
  readonly cursor?: string;
  readonly sortField?: CommissionSettlementSortField;
  readonly sortDirection?: CommissionSortDirection;
}

export interface CommissionSettlementBySubjectTalentReadInput {
  readonly subjectTalentId: string;
  readonly status?: CommissionSettlementStatus;
  readonly windowStartAt?: number;
  readonly windowEndAt?: number;
  readonly limit: number;
  readonly cursor?: string;
  readonly sortField?: CommissionSettlementSortField;
  readonly sortDirection?: CommissionSortDirection;
}

export interface CommissionSettlementByRevenueEntryReadInput {
  readonly revenueEntryId: string;
  readonly status?: CommissionSettlementStatus;
  readonly windowStartAt?: number;
  readonly windowEndAt?: number;
  readonly limit: number;
  readonly cursor?: string;
  readonly sortField?: CommissionSettlementSortField;
  readonly sortDirection?: CommissionSortDirection;
}

export interface CommissionRuleListReadResult {
  readonly items: readonly CommissionRuleListItemView[];
  readonly nextCursor?: string;
}

export interface CommissionRuleByBeneficiaryReadResult {
  readonly items: readonly CommissionRuleByBeneficiaryListItemView[];
  readonly nextCursor?: string;
}

export interface CommissionRuleByContractReadResult {
  readonly items: readonly CommissionRuleByContractListItemView[];
  readonly nextCursor?: string;
}

export interface CommissionSettlementListReadResult {
  readonly items: readonly CommissionSettlementListItemView[];
  readonly nextCursor?: string;
}

export interface CommissionSettlementByBeneficiaryReadResult {
  readonly items: readonly CommissionSettlementByBeneficiaryListItemView[];
  readonly nextCursor?: string;
}

export interface CommissionSettlementBySubjectTalentReadResult {
  readonly items: readonly CommissionSettlementBySubjectTalentListItemView[];
  readonly nextCursor?: string;
}

export interface CommissionSettlementByRevenueEntryReadResult {
  readonly items: readonly CommissionSettlementByRevenueEntryListItemView[];
  readonly nextCursor?: string;
}

export interface CommissionReadRepository {
  listCommissionRules(
    input: CommissionRuleListReadInput,
  ): Promise<CommissionRuleListReadResult>;

  listCommissionRulesByBeneficiary(
    input: CommissionRuleByBeneficiaryReadInput,
  ): Promise<CommissionRuleByBeneficiaryReadResult>;

  listCommissionRulesByContract(
    input: CommissionRuleByContractReadInput,
  ): Promise<CommissionRuleByContractReadResult>;

  getCommissionRuleDetail(
    commissionRuleId: string,
  ): Promise<CommissionRuleDetailView | null>;

  listCommissionSettlements(
    input: CommissionSettlementListReadInput,
  ): Promise<CommissionSettlementListReadResult>;

  listCommissionSettlementsByBeneficiary(
    input: CommissionSettlementByBeneficiaryReadInput,
  ): Promise<CommissionSettlementByBeneficiaryReadResult>;

  listCommissionSettlementsBySubjectTalent(
    input: CommissionSettlementBySubjectTalentReadInput,
  ): Promise<CommissionSettlementBySubjectTalentReadResult>;

  listCommissionSettlementsByRevenueEntry(
    input: CommissionSettlementByRevenueEntryReadInput,
  ): Promise<CommissionSettlementByRevenueEntryReadResult>;

  listCommissionSettlementLines(
    commissionSettlementId: string,
  ): Promise<readonly CommissionSettlementLineListItemView[]>;

  getCommissionSettlementDetail(
    commissionSettlementId: string,
  ): Promise<CommissionSettlementDetailView | null>;
}
