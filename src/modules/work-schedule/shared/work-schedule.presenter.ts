import { Presenter } from "@app/presenter/presenter.base";
import {
  PresentationResult,
  toPlainObject,
} from "@app/base/presentation-result.types";
import { ContextType } from "@core/context/context.types";
import {
  GetHolidayCalendarDetailResult,
  GetWorkScheduleRequestDetailResult,
  GetWorkScheduleRequestBatchDetailResult,
  GetWorkShiftDetailResult,
  GetWorkPatternDetailResult,
  ListHolidayCalendarsResult,
  GetMonthlyRosterDetailResult,
  ListMonthlyRostersResult,
  ListWorkScheduleRequestsResult,
  ListWorkScheduleRequestBatchesResult,
  PreviewMonthlyRosterResult,
  ListWorkPatternsResult,
  ListWorkShiftsByResourceResult,
  ListWorkShiftsBySubjectResult,
  ListWorkShiftsResult,
  WorkShiftMutationResult,
  WorkScheduleRequestMutationResult,
  WorkScheduleRequestBatchMutationResult,
  WorkPatternMutationResult,
  HolidayCalendarMutationResult,
  MonthlyRosterMutationResult,
  PublishMonthlyRosterResult,
} from "./work-schedule.contracts";
import {
  WorkScheduleAdminByResourceListExposure,
  WorkScheduleAdminBySubjectListExposure,
  WorkScheduleAdminDetailExposure,
  WorkScheduleAdminListExposure,
  WorkScheduleAdminMutationExposure,
  WorkScheduleRequestAdminExposure,
  WorkScheduleRequestBatchAdminExposure,
  WorkPatternAdminExposure,
  HolidayCalendarAdminExposure,
  MonthlyRosterAdminExposure,
  MonthlyRosterPreviewAdminExposure,
} from "./work-schedule.exposure";

export class WorkScheduleAdminMutationPresenter extends Presenter<
  WorkShiftMutationResult,
  PresentationResult
> {
  present(
    input: WorkShiftMutationResult,
    _context: ContextType,
  ): PresentationResult {
    return {
      data:
        WorkScheduleAdminMutationExposure.expose(
          input,
        ),
    };
  }
}

export class WorkScheduleAdminListPresenter extends Presenter<
  ListWorkShiftsResult,
  PresentationResult
> {
  present(
    input: ListWorkShiftsResult,
    _context: ContextType,
  ): PresentationResult {
    const output: PresentationResult = {
      data:
        WorkScheduleAdminListExposure.exposeMany(
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

export class WorkScheduleAdminBySubjectListPresenter extends Presenter<
  ListWorkShiftsBySubjectResult,
  PresentationResult
> {
  present(
    input: ListWorkShiftsBySubjectResult,
    _context: ContextType,
  ): PresentationResult {
    const output: PresentationResult = {
      data:
        WorkScheduleAdminBySubjectListExposure.exposeMany(
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

export class WorkScheduleAdminByResourceListPresenter extends Presenter<
  ListWorkShiftsByResourceResult,
  PresentationResult
> {
  present(
    input: ListWorkShiftsByResourceResult,
    _context: ContextType,
  ): PresentationResult {
    const output: PresentationResult = {
      data:
        WorkScheduleAdminByResourceListExposure.exposeMany(
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

export class WorkScheduleAdminDetailPresenter extends Presenter<
  GetWorkShiftDetailResult,
  PresentationResult
> {
  present(
    input: GetWorkShiftDetailResult,
    _context: ContextType,
  ): PresentationResult {
    return {
      data:
        WorkScheduleAdminDetailExposure.expose(
          input,
        ),
    };
  }
}

export class WorkScheduleRequestAdminMutationPresenter extends Presenter<
  WorkScheduleRequestMutationResult,
  PresentationResult
> {
  present(
    input: WorkScheduleRequestMutationResult,
    _context: ContextType,
  ): PresentationResult {
    return {
      data:
        WorkScheduleRequestAdminExposure.expose(
          input,
        ),
    };
  }
}

export class WorkScheduleRequestAdminListPresenter extends Presenter<
  ListWorkScheduleRequestsResult,
  PresentationResult
> {
  present(
    input: ListWorkScheduleRequestsResult,
    _context: ContextType,
  ): PresentationResult {
    const output: PresentationResult = {
      data:
        WorkScheduleRequestAdminExposure.exposeMany(
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

export class WorkScheduleRequestAdminDetailPresenter extends Presenter<
  GetWorkScheduleRequestDetailResult,
  PresentationResult
> {
  present(
    input: GetWorkScheduleRequestDetailResult,
    _context: ContextType,
  ): PresentationResult {
    return {
      data:
        WorkScheduleRequestAdminExposure.expose(
          input,
        ),
    };
  }
}

export class WorkScheduleRequestBatchAdminMutationPresenter extends Presenter<
  WorkScheduleRequestBatchMutationResult,
  PresentationResult
> {
  present(
    input: WorkScheduleRequestBatchMutationResult,
    _context: ContextType,
  ): PresentationResult {
    return {
      data:
        WorkScheduleRequestBatchAdminExposure.exposeDetail(
          input,
        ),
    };
  }
}

export class WorkScheduleRequestBatchAdminListPresenter extends Presenter<
  ListWorkScheduleRequestBatchesResult,
  PresentationResult
> {
  present(
    input: ListWorkScheduleRequestBatchesResult,
    _context: ContextType,
  ): PresentationResult {
    const output: PresentationResult = {
      data:
        WorkScheduleRequestBatchAdminExposure.exposeMany(
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

export class WorkScheduleRequestBatchAdminDetailPresenter extends Presenter<
  GetWorkScheduleRequestBatchDetailResult,
  PresentationResult
> {
  present(
    input: GetWorkScheduleRequestBatchDetailResult,
    _context: ContextType,
  ): PresentationResult {
    return {
      data:
        WorkScheduleRequestBatchAdminExposure.exposeDetail(
          input,
        ),
    };
  }
}

export class WorkPatternAdminMutationPresenter extends Presenter<
  WorkPatternMutationResult,
  PresentationResult
> {
  present(
    input: WorkPatternMutationResult,
    _context: ContextType,
  ): PresentationResult {
    return {
      data: WorkPatternAdminExposure.expose(input),
    };
  }
}

export class WorkPatternAdminListPresenter extends Presenter<
  ListWorkPatternsResult,
  PresentationResult
> {
  present(
    input: ListWorkPatternsResult,
    _context: ContextType,
  ): PresentationResult {
    const output: PresentationResult = {
      data: WorkPatternAdminExposure.exposeMany(
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

export class WorkPatternAdminDetailPresenter extends Presenter<
  GetWorkPatternDetailResult,
  PresentationResult
> {
  present(
    input: GetWorkPatternDetailResult,
    _context: ContextType,
  ): PresentationResult {
    return {
      data: WorkPatternAdminExposure.expose(input),
    };
  }
}

export class HolidayCalendarAdminMutationPresenter extends Presenter<
  HolidayCalendarMutationResult,
  PresentationResult
> {
  present(
    input: HolidayCalendarMutationResult,
    _context: ContextType,
  ): PresentationResult {
    return {
      data: HolidayCalendarAdminExposure.expose(input),
    };
  }
}

export class HolidayCalendarAdminListPresenter extends Presenter<
  ListHolidayCalendarsResult,
  PresentationResult
> {
  present(
    input: ListHolidayCalendarsResult,
    _context: ContextType,
  ): PresentationResult {
    const output: PresentationResult = {
      data:
        HolidayCalendarAdminExposure.exposeMany(
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

export class HolidayCalendarAdminDetailPresenter extends Presenter<
  GetHolidayCalendarDetailResult,
  PresentationResult
> {
  present(
    input: GetHolidayCalendarDetailResult,
    _context: ContextType,
  ): PresentationResult {
    return {
      data: HolidayCalendarAdminExposure.expose(input),
    };
  }
}

export class MonthlyRosterAdminMutationPresenter extends Presenter<
  MonthlyRosterMutationResult | PublishMonthlyRosterResult,
  PresentationResult
> {
  present(
    input:
      | MonthlyRosterMutationResult
      | PublishMonthlyRosterResult,
    _context: ContextType,
  ): PresentationResult {
    if ("generatedWorkShiftCount" in input) {
      return {
        data: toPlainObject(
          input,
          "monthlyRosterPublishResult",
        ),
      };
    }

    return {
      data:
        MonthlyRosterAdminExposure.exposeDetail(
          input,
        ),
    };
  }
}

export class MonthlyRosterAdminListPresenter extends Presenter<
  ListMonthlyRostersResult,
  PresentationResult
> {
  present(
    input: ListMonthlyRostersResult,
    _context: ContextType,
  ): PresentationResult {
    const output: PresentationResult = {
      data:
        MonthlyRosterAdminExposure.exposeMany(
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

export class MonthlyRosterAdminDetailPresenter extends Presenter<
  GetMonthlyRosterDetailResult,
  PresentationResult
> {
  present(
    input: GetMonthlyRosterDetailResult,
    _context: ContextType,
  ): PresentationResult {
    return {
      data:
        MonthlyRosterAdminExposure.exposeDetail(
          input,
        ),
    };
  }
}

export class MonthlyRosterAdminPreviewPresenter extends Presenter<
  PreviewMonthlyRosterResult,
  PresentationResult
> {
  present(
    input: PreviewMonthlyRosterResult,
    _context: ContextType,
  ): PresentationResult {
    return {
      data:
        MonthlyRosterPreviewAdminExposure.expose(
          input,
        ),
    };
  }
}
