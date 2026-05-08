import {
  CommissionBeneficiaryKind,
  CommissionRuleByBeneficiaryListItemView,
  CommissionRuleByContractListItemView,
  CommissionRuleDetailView,
  CommissionRuleListItemView,
  CommissionRuleMutationView,
  CommissionRuleSortField,
  CommissionRuleStatus,
  CommissionSettlementByBeneficiaryListItemView,
  CommissionSettlementByRevenueEntryListItemView,
  CommissionSettlementBySubjectTalentListItemView,
  CommissionSettlementDetailView,
  CommissionSettlementKind,
  CommissionSettlementLineListItemView,
  CommissionSettlementListItemView,
  CommissionSettlementMutationView,
  CommissionSettlementSortField,
  CommissionSettlementStatus,
  CommissionSortDirection,
} from "@modules/commission/domain/commission.types";
import { RevenueKind } from "@modules/revenue-ledger/domain/revenue-ledger.types";

export interface CreateCommissionRuleCommand {
  readonly ruleCode: string;
  readonly title: string;
  readonly settlementKind: CommissionSettlementKind | string;
  readonly beneficiaryKind: CommissionBeneficiaryKind | string;
  readonly beneficiaryEmploymentProfileId?: string | null;
  readonly beneficiaryTalentId?: string | null;
  readonly sourceContractRecordId: string;
  readonly settlementBasis: string;
  readonly ratePercent: number;
  readonly appliesToRevenueKinds: readonly (RevenueKind | string)[];
  readonly effectiveStartDate: number;
  readonly effectiveEndDate?: number | null;
  readonly description?: string | null;
  readonly externalRef?: string | null;
}

export interface UpdateCommissionRuleDraftCoreCommand {
  readonly commissionRuleId: string;
  readonly title?: string;
  readonly ratePercent?: number;
  readonly appliesToRevenueKinds?: readonly (RevenueKind | string)[];
  readonly effectiveStartDate?: number;
  readonly effectiveEndDate?: number | null;
  readonly description?: string | null;
  readonly externalRef?: string | null;
}

export interface ActivateCommissionRuleCommand {
  readonly commissionRuleId: string;
}

export interface DeactivateCommissionRuleCommand {
  readonly commissionRuleId: string;
}

export interface ArchiveCommissionRuleCommand {
  readonly commissionRuleId: string;
}

export interface CreateCommissionSettlementCommand {
  readonly settlementCode: string;
  readonly title: string;
  readonly sourceRuleId: string;
  readonly settlementPeriodStartAt: number;
  readonly settlementPeriodEndAt: number;
  readonly revenueEntryIds: readonly string[];
  readonly description?: string | null;
  readonly externalRef?: string | null;
}

export interface UpdateCommissionSettlementDraftCoreCommand {
  readonly commissionSettlementId: string;
  readonly title?: string;
  readonly settlementPeriodStartAt?: number;
  readonly settlementPeriodEndAt?: number;
  readonly description?: string | null;
  readonly externalRef?: string | null;
}

export interface ReplaceCommissionSettlementRevenueEntriesCommand {
  readonly commissionSettlementId: string;
  readonly revenueEntryIds: readonly string[];
}

export interface FinalizeCommissionSettlementCommand {
  readonly commissionSettlementId: string;
}

export interface VoidCommissionSettlementCommand {
  readonly commissionSettlementId: string;
}

export interface ArchiveCommissionSettlementCommand {
  readonly commissionSettlementId: string;
}

export interface GetCommissionRuleDetailQuery {
  readonly commissionRuleId: string;
}

export interface ListCommissionRulesQuery {
  readonly status?: CommissionRuleStatus | string;
  readonly settlementKind?: CommissionSettlementKind | string;
  readonly beneficiaryKind?: CommissionBeneficiaryKind | string;
  readonly beneficiaryEmploymentProfileId?: string;
  readonly beneficiaryTalentId?: string;
  readonly sourceContractRecordId?: string;
  readonly appliesToRevenueKind?: RevenueKind | string;
  readonly windowStartDate?: number | string;
  readonly windowEndDate?: number | string;
  readonly limit?: number | string;
  readonly cursor?: string;
  readonly search?: string;
  readonly sortBy?: CommissionRuleSortField | string;
  readonly sortDirection?: CommissionSortDirection | string;
}

export interface ListCommissionRulesByBeneficiaryQuery {
  readonly beneficiaryKind: CommissionBeneficiaryKind | string;
  readonly beneficiaryEmploymentProfileId?: string;
  readonly beneficiaryTalentId?: string;
  readonly status?: CommissionRuleStatus | string;
  readonly limit?: number | string;
  readonly cursor?: string;
  readonly sortBy?: CommissionRuleSortField | string;
  readonly sortDirection?: CommissionSortDirection | string;
}

export interface ListCommissionRulesByContractQuery {
  readonly sourceContractRecordId: string;
  readonly status?: CommissionRuleStatus | string;
  readonly limit?: number | string;
  readonly cursor?: string;
  readonly sortBy?: CommissionRuleSortField | string;
  readonly sortDirection?: CommissionSortDirection | string;
}

export interface GetCommissionSettlementDetailQuery {
  readonly commissionSettlementId: string;
}

export interface ListCommissionSettlementsQuery {
  readonly status?: CommissionSettlementStatus | string;
  readonly settlementKindSnapshot?: CommissionSettlementKind | string;
  readonly beneficiaryKindSnapshot?: CommissionBeneficiaryKind | string;
  readonly beneficiaryEmploymentProfileIdSnapshot?: string;
  readonly beneficiaryTalentIdSnapshot?: string;
  readonly subjectTalentId?: string;
  readonly sourceRuleId?: string;
  readonly containsRevenueEntryId?: string;
  readonly settlementCurrencyCode?: string;
  readonly windowStartAt?: number | string;
  readonly windowEndAt?: number | string;
  readonly limit?: number | string;
  readonly cursor?: string;
  readonly search?: string;
  readonly sortBy?: CommissionSettlementSortField | string;
  readonly sortDirection?: CommissionSortDirection | string;
}

export interface ListCommissionSettlementLinesQuery {
  readonly commissionSettlementId: string;
}

export interface ListCommissionSettlementsByBeneficiaryQuery {
  readonly beneficiaryKindSnapshot: CommissionBeneficiaryKind | string;
  readonly beneficiaryEmploymentProfileIdSnapshot?: string;
  readonly beneficiaryTalentIdSnapshot?: string;
  readonly status?: CommissionSettlementStatus | string;
  readonly windowStartAt?: number | string;
  readonly windowEndAt?: number | string;
  readonly limit?: number | string;
  readonly cursor?: string;
  readonly sortBy?: CommissionSettlementSortField | string;
  readonly sortDirection?: CommissionSortDirection | string;
}

export interface ListCommissionSettlementsBySubjectTalentQuery {
  readonly subjectTalentId: string;
  readonly status?: CommissionSettlementStatus | string;
  readonly windowStartAt?: number | string;
  readonly windowEndAt?: number | string;
  readonly limit?: number | string;
  readonly cursor?: string;
  readonly sortBy?: CommissionSettlementSortField | string;
  readonly sortDirection?: CommissionSortDirection | string;
}

export interface ListCommissionSettlementsByRevenueEntryQuery {
  readonly revenueEntryId: string;
  readonly status?: CommissionSettlementStatus | string;
  readonly windowStartAt?: number | string;
  readonly windowEndAt?: number | string;
  readonly limit?: number | string;
  readonly cursor?: string;
  readonly sortBy?: CommissionSettlementSortField | string;
  readonly sortDirection?: CommissionSortDirection | string;
}

export type CommissionRuleMutationResult =
  CommissionRuleMutationView;

export type CommissionSettlementMutationResult =
  CommissionSettlementMutationView;

export type GetCommissionRuleDetailResult =
  CommissionRuleDetailView;

export type GetCommissionSettlementDetailResult =
  CommissionSettlementDetailView;

export interface ListCommissionRulesResult {
  readonly items: readonly CommissionRuleListItemView[];
  readonly nextCursor?: string;
}

export interface ListCommissionRulesByBeneficiaryResult {
  readonly items: readonly CommissionRuleByBeneficiaryListItemView[];
  readonly nextCursor?: string;
}

export interface ListCommissionRulesByContractResult {
  readonly items: readonly CommissionRuleByContractListItemView[];
  readonly nextCursor?: string;
}

export interface ListCommissionSettlementsResult {
  readonly items: readonly CommissionSettlementListItemView[];
  readonly nextCursor?: string;
}

export interface ListCommissionSettlementLinesResult {
  readonly items: readonly CommissionSettlementLineListItemView[];
}

export interface ListCommissionSettlementsByBeneficiaryResult {
  readonly items: readonly CommissionSettlementByBeneficiaryListItemView[];
  readonly nextCursor?: string;
}

export interface ListCommissionSettlementsBySubjectTalentResult {
  readonly items: readonly CommissionSettlementBySubjectTalentListItemView[];
  readonly nextCursor?: string;
}

export interface ListCommissionSettlementsByRevenueEntryResult {
  readonly items: readonly CommissionSettlementByRevenueEntryListItemView[];
  readonly nextCursor?: string;
}
