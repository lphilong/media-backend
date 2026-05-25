import { PresentationResult } from "@app/base/presentation-result.types";
import { Presenter } from "@app/presenter/presenter.base";
import { ContextType } from "@core/context/context.types";
import {
  GetKpiPlanDetailResult,
  GetKpiActualDailyGridResult,
  GetKpiProgressResult,
  KpiActualCorrectionResult,
  KpiActualMutationResult,
  KpiPlanMutationResult,
  ListKpiActualCorrectionsResult,
  ListKpiAllocationsResult,
  ListKpiPlansResult,
} from "./kpi.contracts";
import {
  KpiActualDailyGridExposure,
  KpiActualCorrectionExposure,
  KpiActualEntryExposure,
  KpiPlanDetailExposure,
  KpiPlanListExposure,
  KpiPlanMutationExposure,
  KpiProgressExposure,
  KpiAllocationExposure,
} from "./kpi.exposure";

export class KpiAdminMutationPresenter extends Presenter<
  KpiPlanMutationResult | KpiActualMutationResult | KpiActualCorrectionResult,
  PresentationResult
> {
  present(
    input: KpiPlanMutationResult | KpiActualMutationResult | KpiActualCorrectionResult,
    _context: ContextType,
  ): PresentationResult {
    if (isActualCorrectionResult(input)) {
      return {
        data: {
          actualEntry: KpiActualEntryExposure.expose(input.actualEntry),
          correction: KpiActualCorrectionExposure.expose(input.correction),
        },
      };
    }
    if (isActualMutationResult(input)) {
      return {
        data: KpiActualEntryExposure.expose(input.actualEntry),
      };
    }
    return { data: KpiPlanMutationExposure.expose(input) };
  }
}

export class KpiAdminListPresenter extends Presenter<
  ListKpiPlansResult,
  PresentationResult
> {
  present(
    input: ListKpiPlansResult,
    _context: ContextType,
  ): PresentationResult {
    return { data: KpiPlanListExposure.exposeMany(input.items) };
  }
}

export class KpiAdminDetailPresenter extends Presenter<
  GetKpiPlanDetailResult,
  PresentationResult
> {
  present(
    input: GetKpiPlanDetailResult,
    _context: ContextType,
  ): PresentationResult {
    return { data: KpiPlanDetailExposure.expose(input) };
  }
}

export class KpiAdminProgressPresenter extends Presenter<
  GetKpiProgressResult,
  PresentationResult
> {
  present(
    input: GetKpiProgressResult,
    _context: ContextType,
  ): PresentationResult {
    return { data: KpiProgressExposure.expose(input) };
  }
}

export class KpiAdminActualGridPresenter extends Presenter<
  GetKpiActualDailyGridResult,
  PresentationResult
> {
  present(
    input: GetKpiActualDailyGridResult,
    _context: ContextType,
  ): PresentationResult {
    return { data: KpiActualDailyGridExposure.expose(input) };
  }
}

export class KpiAdminCorrectionListPresenter extends Presenter<
  ListKpiActualCorrectionsResult,
  PresentationResult
> {
  present(
    input: ListKpiActualCorrectionsResult,
    _context: ContextType,
  ): PresentationResult {
    return {
      data: input.items.map((item) =>
        KpiActualCorrectionExposure.expose(item),
      ),
    };
  }
}

export class KpiAdminAllocationListPresenter extends Presenter<
  ListKpiAllocationsResult,
  PresentationResult
> {
  present(
    input: ListKpiAllocationsResult,
    _context: ContextType,
  ): PresentationResult {
    return {
      data: KpiAllocationExposure.exposeMany(input.items),
    };
  }
}

function isActualMutationResult(
  input: unknown,
): input is KpiActualMutationResult {
  return (
    typeof input === "object" &&
    input !== null &&
    "actualEntry" in input
  );
}

function isActualCorrectionResult(
  input: unknown,
): input is KpiActualCorrectionResult {
  return (
    isActualMutationResult(input) &&
    "correction" in input
  );
}
