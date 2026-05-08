import { RevenueKind } from "@modules/revenue-ledger/domain/revenue-ledger.types";

export const COMMISSION_SETTLEMENT_KINDS = [
  "COMMISSION",
  "REVENUE_SHARE",
] as const;

export type CommissionSettlementKind =
  (typeof COMMISSION_SETTLEMENT_KINDS)[number];

export const COMMISSION_BENEFICIARY_KINDS = [
  "EMPLOYMENT_PROFILE",
  "TALENT",
] as const;

export type CommissionBeneficiaryKind =
  (typeof COMMISSION_BENEFICIARY_KINDS)[number];

export const COMMISSION_SETTLEMENT_BASES = [
  "RECOGNIZED_GROSS_REVENUE",
] as const;

export type CommissionSettlementBasis =
  (typeof COMMISSION_SETTLEMENT_BASES)[number];

export const COMMISSION_RULE_STATUSES = [
  "DRAFT",
  "ACTIVE",
  "INACTIVE",
  "ARCHIVED",
] as const;

export type CommissionRuleStatus =
  (typeof COMMISSION_RULE_STATUSES)[number];

export const COMMISSION_SETTLEMENT_STATUSES = [
  "DRAFT",
  "FINALIZED",
  "VOIDED",
  "ARCHIVED",
] as const;

export type CommissionSettlementStatus =
  (typeof COMMISSION_SETTLEMENT_STATUSES)[number];

export const COMMISSION_RULE_SORT_FIELDS = [
  "ruleCode",
  "title",
  "effectiveStartDate",
  "createdAt",
] as const;

export type CommissionRuleSortField =
  (typeof COMMISSION_RULE_SORT_FIELDS)[number];

export const COMMISSION_SETTLEMENT_SORT_FIELDS = [
  "settlementPeriodStartAt",
  "settlementCode",
  "createdAt",
  "finalizedAt",
] as const;

export type CommissionSettlementSortField =
  (typeof COMMISSION_SETTLEMENT_SORT_FIELDS)[number];

export const COMMISSION_SORT_DIRECTIONS = [
  "ASC",
  "DESC",
] as const;

export type CommissionSortDirection =
  (typeof COMMISSION_SORT_DIRECTIONS)[number];

export const COMMISSION_SCOPES = ["global"] as const;

export type CommissionScope =
  (typeof COMMISSION_SCOPES)[number];

export interface CommissionRule {
  readonly id: string;
  readonly ruleCode: string;
  readonly title: string;
  readonly normalizedTitle: string;
  readonly settlementKind: CommissionSettlementKind;
  readonly beneficiaryKind: CommissionBeneficiaryKind;
  readonly beneficiaryEmploymentProfileId: string | null;
  readonly beneficiaryTalentId: string | null;
  readonly sourceContractRecordId: string;
  readonly settlementBasis: CommissionSettlementBasis;
  readonly ratePercent: number;
  readonly appliesToRevenueKinds: readonly RevenueKind[];
  readonly status: CommissionRuleStatus;
  readonly effectiveStartDate: number;
  readonly effectiveEndDate: number | null;
  readonly description: string | null;
  readonly externalRef: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface CommissionSettlement {
  readonly id: string;
  readonly settlementCode: string;
  readonly title: string;
  readonly normalizedTitle: string;
  readonly sourceRuleId: string;
  readonly sourceContractRecordIdSnapshot: string;
  readonly settlementKindSnapshot: CommissionSettlementKind;
  readonly beneficiaryKindSnapshot: CommissionBeneficiaryKind;
  readonly beneficiaryEmploymentProfileIdSnapshot: string | null;
  readonly beneficiaryTalentIdSnapshot: string | null;
  readonly subjectTalentId: string;
  readonly settlementBasisSnapshot: CommissionSettlementBasis;
  readonly ratePercentSnapshot: number;
  readonly revenueEntryIds: readonly string[];
  readonly settlementPeriodStartAt: number;
  readonly settlementPeriodEndAt: number;
  readonly settlementCurrencyCode: string;
  readonly grossRevenueAmount: number;
  readonly settlementAmount: number;
  readonly status: CommissionSettlementStatus;
  readonly finalizedAt: number | null;
  readonly voidedAt: number | null;
  readonly description: string | null;
  readonly externalRef: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface CommissionSettlementLine {
  readonly id: string;
  readonly settlementId: string;
  readonly revenueEntryId: string;
  readonly revenueEntryCodeSnapshot: string;
  readonly revenueKindSnapshot: RevenueKind;
  readonly revenueCurrencyCodeSnapshot: string;
  readonly revenueRecognizedAmountSnapshot: number;
  readonly revenueRecognizedAtSnapshot: number;
  readonly lineSettlementAmount: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface CommissionRuleDetailView {
  readonly id: string;
  readonly ruleCode: string;
  readonly title: string;
  readonly settlementKind: CommissionSettlementKind;
  readonly beneficiaryKind: CommissionBeneficiaryKind;
  readonly beneficiaryEmploymentProfileId: string | null;
  readonly beneficiaryTalentId: string | null;
  readonly sourceContractRecordId: string;
  readonly settlementBasis: CommissionSettlementBasis;
  readonly ratePercent: number;
  readonly appliesToRevenueKinds: readonly RevenueKind[];
  readonly status: CommissionRuleStatus;
  readonly effectiveStartDate: number;
  readonly effectiveEndDate: number | null;
  readonly description: string | null;
  readonly externalRef: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface CommissionRuleListItemView {
  readonly id: string;
  readonly ruleCode: string;
  readonly title: string;
  readonly settlementKind: CommissionSettlementKind;
  readonly beneficiaryKind: CommissionBeneficiaryKind;
  readonly beneficiaryEmploymentProfileId: string | null;
  readonly beneficiaryTalentId: string | null;
  readonly sourceContractRecordId: string;
  readonly ratePercent: number;
  readonly status: CommissionRuleStatus;
  readonly effectiveStartDate: number;
  readonly effectiveEndDate: number | null;
  readonly createdAt: number;
}

export interface CommissionRuleByBeneficiaryListItemView
  extends CommissionRuleListItemView {}

export interface CommissionRuleByContractListItemView
  extends CommissionRuleListItemView {}

export interface CommissionSettlementDetailView {
  readonly id: string;
  readonly settlementCode: string;
  readonly title: string;
  readonly sourceRuleId: string;
  readonly sourceContractRecordIdSnapshot: string;
  readonly settlementKindSnapshot: CommissionSettlementKind;
  readonly beneficiaryKindSnapshot: CommissionBeneficiaryKind;
  readonly beneficiaryEmploymentProfileIdSnapshot: string | null;
  readonly beneficiaryTalentIdSnapshot: string | null;
  readonly subjectTalentId: string;
  readonly settlementBasisSnapshot: CommissionSettlementBasis;
  readonly ratePercentSnapshot: number;
  readonly revenueEntryIds: readonly string[];
  readonly settlementPeriodStartAt: number;
  readonly settlementPeriodEndAt: number;
  readonly settlementCurrencyCode: string;
  readonly grossRevenueAmount: number;
  readonly settlementAmount: number;
  readonly status: CommissionSettlementStatus;
  readonly finalizedAt: number | null;
  readonly voidedAt: number | null;
  readonly description: string | null;
  readonly externalRef: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface CommissionSettlementListItemView {
  readonly id: string;
  readonly settlementCode: string;
  readonly title: string;
  readonly sourceRuleId: string;
  readonly settlementKindSnapshot: CommissionSettlementKind;
  readonly beneficiaryKindSnapshot: CommissionBeneficiaryKind;
  readonly beneficiaryEmploymentProfileIdSnapshot: string | null;
  readonly beneficiaryTalentIdSnapshot: string | null;
  readonly subjectTalentId: string;
  readonly settlementCurrencyCode: string;
  readonly grossRevenueAmount: number;
  readonly settlementAmount: number;
  readonly status: CommissionSettlementStatus;
  readonly settlementPeriodStartAt: number;
  readonly settlementPeriodEndAt: number;
  readonly finalizedAt: number | null;
  readonly createdAt: number;
}

export interface CommissionSettlementLineListItemView {
  readonly id: string;
  readonly revenueEntryId: string;
  readonly revenueEntryCodeSnapshot: string;
  readonly revenueKindSnapshot: RevenueKind;
  readonly revenueCurrencyCodeSnapshot: string;
  readonly revenueRecognizedAmountSnapshot: number;
  readonly revenueRecognizedAtSnapshot: number;
  readonly lineSettlementAmount: number;
}

export interface CommissionSettlementByBeneficiaryListItemView {
  readonly id: string;
  readonly settlementCode: string;
  readonly title: string;
  readonly beneficiaryKindSnapshot: CommissionBeneficiaryKind;
  readonly beneficiaryEmploymentProfileIdSnapshot: string | null;
  readonly beneficiaryTalentIdSnapshot: string | null;
  readonly subjectTalentId: string;
  readonly settlementCurrencyCode: string;
  readonly settlementAmount: number;
  readonly status: CommissionSettlementStatus;
  readonly settlementPeriodStartAt: number;
  readonly settlementPeriodEndAt: number;
}

export interface CommissionSettlementBySubjectTalentListItemView {
  readonly id: string;
  readonly settlementCode: string;
  readonly title: string;
  readonly subjectTalentId: string;
  readonly settlementCurrencyCode: string;
  readonly grossRevenueAmount: number;
  readonly settlementAmount: number;
  readonly status: CommissionSettlementStatus;
  readonly settlementPeriodStartAt: number;
  readonly settlementPeriodEndAt: number;
}

export interface CommissionSettlementByRevenueEntryListItemView {
  readonly id: string;
  readonly settlementCode: string;
  readonly title: string;
  readonly subjectTalentId: string;
  readonly settlementCurrencyCode: string;
  readonly settlementAmount: number;
  readonly status: CommissionSettlementStatus;
  readonly settlementPeriodStartAt: number;
  readonly settlementPeriodEndAt: number;
}

export interface CommissionRuleMutationView
  extends CommissionRuleDetailView {}

export interface CommissionSettlementMutationView
  extends CommissionSettlementDetailView {}
