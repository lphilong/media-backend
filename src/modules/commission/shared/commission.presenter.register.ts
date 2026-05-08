import { PresenterRegistryWriter } from "@app/presenter/presenter.runtime-access";
import {
  COMMISSION_ADMIN_RULE_BY_BENEFICIARY_LIST_PRESENTER_KEY,
  COMMISSION_ADMIN_RULE_BY_CONTRACT_LIST_PRESENTER_KEY,
  COMMISSION_ADMIN_RULE_DETAIL_PRESENTER_KEY,
  COMMISSION_ADMIN_RULE_LIST_PRESENTER_KEY,
  COMMISSION_ADMIN_RULE_MUTATION_PRESENTER_KEY,
  COMMISSION_ADMIN_SETTLEMENT_BY_BENEFICIARY_LIST_PRESENTER_KEY,
  COMMISSION_ADMIN_SETTLEMENT_BY_REVENUE_ENTRY_LIST_PRESENTER_KEY,
  COMMISSION_ADMIN_SETTLEMENT_BY_SUBJECT_TALENT_LIST_PRESENTER_KEY,
  COMMISSION_ADMIN_SETTLEMENT_DETAIL_PRESENTER_KEY,
  COMMISSION_ADMIN_SETTLEMENT_LINE_LIST_PRESENTER_KEY,
  COMMISSION_ADMIN_SETTLEMENT_LIST_PRESENTER_KEY,
  COMMISSION_ADMIN_SETTLEMENT_MUTATION_PRESENTER_KEY,
} from "./commission.presenter-keys";
import {
  CommissionAdminRuleByBeneficiaryListPresenter,
  CommissionAdminRuleByContractListPresenter,
  CommissionAdminRuleDetailPresenter,
  CommissionAdminRuleListPresenter,
  CommissionAdminRuleMutationPresenter,
  CommissionAdminSettlementByBeneficiaryListPresenter,
  CommissionAdminSettlementByRevenueEntryListPresenter,
  CommissionAdminSettlementBySubjectTalentListPresenter,
  CommissionAdminSettlementDetailPresenter,
  CommissionAdminSettlementLineListPresenter,
  CommissionAdminSettlementListPresenter,
  CommissionAdminSettlementMutationPresenter,
} from "./commission.presenter";

export function registerPresenters(
  registry: PresenterRegistryWriter,
): void {
  registry.register(
    COMMISSION_ADMIN_RULE_MUTATION_PRESENTER_KEY,
    new CommissionAdminRuleMutationPresenter(),
  );

  registry.register(
    COMMISSION_ADMIN_RULE_LIST_PRESENTER_KEY,
    new CommissionAdminRuleListPresenter(),
  );

  registry.register(
    COMMISSION_ADMIN_RULE_BY_BENEFICIARY_LIST_PRESENTER_KEY,
    new CommissionAdminRuleByBeneficiaryListPresenter(),
  );

  registry.register(
    COMMISSION_ADMIN_RULE_BY_CONTRACT_LIST_PRESENTER_KEY,
    new CommissionAdminRuleByContractListPresenter(),
  );

  registry.register(
    COMMISSION_ADMIN_RULE_DETAIL_PRESENTER_KEY,
    new CommissionAdminRuleDetailPresenter(),
  );

  registry.register(
    COMMISSION_ADMIN_SETTLEMENT_MUTATION_PRESENTER_KEY,
    new CommissionAdminSettlementMutationPresenter(),
  );

  registry.register(
    COMMISSION_ADMIN_SETTLEMENT_LIST_PRESENTER_KEY,
    new CommissionAdminSettlementListPresenter(),
  );

  registry.register(
    COMMISSION_ADMIN_SETTLEMENT_BY_BENEFICIARY_LIST_PRESENTER_KEY,
    new CommissionAdminSettlementByBeneficiaryListPresenter(),
  );

  registry.register(
    COMMISSION_ADMIN_SETTLEMENT_BY_SUBJECT_TALENT_LIST_PRESENTER_KEY,
    new CommissionAdminSettlementBySubjectTalentListPresenter(),
  );

  registry.register(
    COMMISSION_ADMIN_SETTLEMENT_BY_REVENUE_ENTRY_LIST_PRESENTER_KEY,
    new CommissionAdminSettlementByRevenueEntryListPresenter(),
  );

  registry.register(
    COMMISSION_ADMIN_SETTLEMENT_LINE_LIST_PRESENTER_KEY,
    new CommissionAdminSettlementLineListPresenter(),
  );

  registry.register(
    COMMISSION_ADMIN_SETTLEMENT_DETAIL_PRESENTER_KEY,
    new CommissionAdminSettlementDetailPresenter(),
  );
}
