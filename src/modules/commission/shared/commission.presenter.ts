import { PresentationResult } from "@app/base/presentation-result.types";
import { Presenter } from "@app/presenter/presenter.base";
import { ContextType } from "@core/context/context.types";
import {
  CommissionRuleMutationResult,
  CommissionSettlementMutationResult,
  GetCommissionRuleDetailResult,
  GetCommissionSettlementDetailResult,
  ListCommissionRulesByContractResult,
  ListCommissionRulesByBeneficiaryResult,
  ListCommissionRulesResult,
  ListCommissionSettlementLinesResult,
  ListCommissionSettlementsByBeneficiaryResult,
  ListCommissionSettlementsByRevenueEntryResult,
  ListCommissionSettlementsBySubjectTalentResult,
  ListCommissionSettlementsResult,
} from "./commission.contracts";
import {
  CommissionAdminRuleByBeneficiaryListExposure,
  CommissionAdminRuleByContractListExposure,
  CommissionAdminRuleDetailExposure,
  CommissionAdminRuleListExposure,
  CommissionAdminRuleMutationExposure,
  CommissionAdminSettlementByBeneficiaryListExposure,
  CommissionAdminSettlementByRevenueEntryListExposure,
  CommissionAdminSettlementBySubjectTalentListExposure,
  CommissionAdminSettlementDetailExposure,
  CommissionAdminSettlementLineListExposure,
  CommissionAdminSettlementListExposure,
  CommissionAdminSettlementMutationExposure,
} from "./commission.exposure";

export class CommissionAdminRuleMutationPresenter extends Presenter<
  CommissionRuleMutationResult,
  PresentationResult
> {
  present(
    input: CommissionRuleMutationResult,
    _context: ContextType,
  ): PresentationResult {
    return {
      data: CommissionAdminRuleMutationExposure.expose(
        input,
      ),
    };
  }
}

export class CommissionAdminSettlementMutationPresenter extends Presenter<
  CommissionSettlementMutationResult,
  PresentationResult
> {
  present(
    input: CommissionSettlementMutationResult,
    _context: ContextType,
  ): PresentationResult {
    return {
      data:
        CommissionAdminSettlementMutationExposure.expose(
          input,
        ),
    };
  }
}

export class CommissionAdminRuleListPresenter extends Presenter<
  ListCommissionRulesResult,
  PresentationResult
> {
  present(
    input: ListCommissionRulesResult,
    _context: ContextType,
  ): PresentationResult {
    const output: PresentationResult = {
      data: CommissionAdminRuleListExposure.exposeMany(
        input.items,
      ),
    };

    if (input.nextCursor) {
      output.meta = {
        nextCursor: input.nextCursor,
      };
    }

    return output;
  }
}

export class CommissionAdminRuleByBeneficiaryListPresenter extends Presenter<
  ListCommissionRulesByBeneficiaryResult,
  PresentationResult
> {
  present(
    input: ListCommissionRulesByBeneficiaryResult,
    _context: ContextType,
  ): PresentationResult {
    const output: PresentationResult = {
      data:
        CommissionAdminRuleByBeneficiaryListExposure.exposeMany(
          input.items,
        ),
    };

    if (input.nextCursor) {
      output.meta = {
        nextCursor: input.nextCursor,
      };
    }

    return output;
  }
}

export class CommissionAdminRuleByContractListPresenter extends Presenter<
  ListCommissionRulesByContractResult,
  PresentationResult
> {
  present(
    input: ListCommissionRulesByContractResult,
    _context: ContextType,
  ): PresentationResult {
    const output: PresentationResult = {
      data:
        CommissionAdminRuleByContractListExposure.exposeMany(
          input.items,
        ),
    };

    if (input.nextCursor) {
      output.meta = {
        nextCursor: input.nextCursor,
      };
    }

    return output;
  }
}

export class CommissionAdminRuleDetailPresenter extends Presenter<
  GetCommissionRuleDetailResult,
  PresentationResult
> {
  present(
    input: GetCommissionRuleDetailResult,
    _context: ContextType,
  ): PresentationResult {
    return {
      data: CommissionAdminRuleDetailExposure.expose(
        input,
      ),
    };
  }
}

export class CommissionAdminSettlementListPresenter extends Presenter<
  ListCommissionSettlementsResult,
  PresentationResult
> {
  present(
    input: ListCommissionSettlementsResult,
    _context: ContextType,
  ): PresentationResult {
    const output: PresentationResult = {
      data:
        CommissionAdminSettlementListExposure.exposeMany(
          input.items,
        ),
    };

    if (input.nextCursor) {
      output.meta = {
        nextCursor: input.nextCursor,
      };
    }

    return output;
  }
}

export class CommissionAdminSettlementByBeneficiaryListPresenter extends Presenter<
  ListCommissionSettlementsByBeneficiaryResult,
  PresentationResult
> {
  present(
    input: ListCommissionSettlementsByBeneficiaryResult,
    _context: ContextType,
  ): PresentationResult {
    const output: PresentationResult = {
      data:
        CommissionAdminSettlementByBeneficiaryListExposure.exposeMany(
          input.items,
        ),
    };

    if (input.nextCursor) {
      output.meta = {
        nextCursor: input.nextCursor,
      };
    }

    return output;
  }
}

export class CommissionAdminSettlementBySubjectTalentListPresenter extends Presenter<
  ListCommissionSettlementsBySubjectTalentResult,
  PresentationResult
> {
  present(
    input: ListCommissionSettlementsBySubjectTalentResult,
    _context: ContextType,
  ): PresentationResult {
    const output: PresentationResult = {
      data:
        CommissionAdminSettlementBySubjectTalentListExposure.exposeMany(
          input.items,
        ),
    };

    if (input.nextCursor) {
      output.meta = {
        nextCursor: input.nextCursor,
      };
    }

    return output;
  }
}

export class CommissionAdminSettlementByRevenueEntryListPresenter extends Presenter<
  ListCommissionSettlementsByRevenueEntryResult,
  PresentationResult
> {
  present(
    input: ListCommissionSettlementsByRevenueEntryResult,
    _context: ContextType,
  ): PresentationResult {
    const output: PresentationResult = {
      data:
        CommissionAdminSettlementByRevenueEntryListExposure.exposeMany(
          input.items,
        ),
    };

    if (input.nextCursor) {
      output.meta = {
        nextCursor: input.nextCursor,
      };
    }

    return output;
  }
}

export class CommissionAdminSettlementLineListPresenter extends Presenter<
  ListCommissionSettlementLinesResult,
  PresentationResult
> {
  present(
    input: ListCommissionSettlementLinesResult,
    _context: ContextType,
  ): PresentationResult {
    return {
      data:
        CommissionAdminSettlementLineListExposure.exposeMany(
          input.items,
        ),
    };
  }
}

export class CommissionAdminSettlementDetailPresenter extends Presenter<
  GetCommissionSettlementDetailResult,
  PresentationResult
> {
  present(
    input: GetCommissionSettlementDetailResult,
    _context: ContextType,
  ): PresentationResult {
    return {
      data:
        CommissionAdminSettlementDetailExposure.expose(
          input,
        ),
    };
  }
}
