import { PresentationResult } from "@app/base/presentation-result.types";
import { Presenter } from "@app/presenter/presenter.base";
import { ContextType } from "@core/context/context.types";
import {
  GetTalentKpiRecordDetailResult,
  ListTalentKpiByEventResult,
  ListTalentKpiByPlatformResult,
  ListTalentKpiByTalentResult,
  ListTalentKpiMetricValuesResult,
  ListTalentKpiRecordsResult,
  TalentKpiRecordMutationResult,
} from "./talent-kpi.contracts";
import {
  TalentKpiAdminByEventListExposure,
  TalentKpiAdminByPlatformListExposure,
  TalentKpiAdminByTalentListExposure,
  TalentKpiAdminDetailExposure,
  TalentKpiAdminListExposure,
  TalentKpiAdminMetricListExposure,
  TalentKpiAdminMutationExposure,
} from "./talent-kpi.exposure";

export class TalentKpiAdminMutationPresenter extends Presenter<
  TalentKpiRecordMutationResult,
  PresentationResult
> {
  present(
    input: TalentKpiRecordMutationResult,
    _context: ContextType,
  ): PresentationResult {
    return {
      data: TalentKpiAdminMutationExposure.expose(
        input,
      ),
    };
  }
}

export class TalentKpiAdminListPresenter extends Presenter<
  ListTalentKpiRecordsResult,
  PresentationResult
> {
  present(
    input: ListTalentKpiRecordsResult,
    _context: ContextType,
  ): PresentationResult {
    const output: PresentationResult = {
      data: TalentKpiAdminListExposure.exposeMany(
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

export class TalentKpiAdminMetricListPresenter extends Presenter<
  ListTalentKpiMetricValuesResult,
  PresentationResult
> {
  present(
    input: ListTalentKpiMetricValuesResult,
    _context: ContextType,
  ): PresentationResult {
    return {
      data:
        TalentKpiAdminMetricListExposure.exposeMany(
          input.items,
        ),
    };
  }
}

export class TalentKpiAdminByTalentListPresenter extends Presenter<
  ListTalentKpiByTalentResult,
  PresentationResult
> {
  present(
    input: ListTalentKpiByTalentResult,
    _context: ContextType,
  ): PresentationResult {
    const output: PresentationResult = {
      data:
        TalentKpiAdminByTalentListExposure.exposeMany(
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

export class TalentKpiAdminByPlatformListPresenter extends Presenter<
  ListTalentKpiByPlatformResult,
  PresentationResult
> {
  present(
    input: ListTalentKpiByPlatformResult,
    _context: ContextType,
  ): PresentationResult {
    const output: PresentationResult = {
      data:
        TalentKpiAdminByPlatformListExposure.exposeMany(
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

export class TalentKpiAdminByEventListPresenter extends Presenter<
  ListTalentKpiByEventResult,
  PresentationResult
> {
  present(
    input: ListTalentKpiByEventResult,
    _context: ContextType,
  ): PresentationResult {
    const output: PresentationResult = {
      data:
        TalentKpiAdminByEventListExposure.exposeMany(
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

export class TalentKpiAdminDetailPresenter extends Presenter<
  GetTalentKpiRecordDetailResult,
  PresentationResult
> {
  present(
    input: GetTalentKpiRecordDetailResult,
    _context: ContextType,
  ): PresentationResult {
    return {
      data: TalentKpiAdminDetailExposure.expose(
        input,
      ),
    };
  }
}
