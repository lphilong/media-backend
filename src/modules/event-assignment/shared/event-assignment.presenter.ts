import { PresentationResult } from "@app/base/presentation-result.types";
import { Presenter } from "@app/presenter/presenter.base";
import { ContextType } from "@core/context/context.types";
import {
  EventMutationResult,
  GetEventDetailResult,
  ListEventAssignmentsResult,
  ListEventsByAssignmentResult,
  ListEventsByPlatformResult,
  ListEventsByResourceResult,
  ListEventsResult,
} from "./event-assignment.contracts";
import {
  EventAssignmentAdminAssignmentListExposure,
  EventAssignmentAdminByAssignmentListExposure,
  EventAssignmentAdminByPlatformListExposure,
  EventAssignmentAdminByResourceListExposure,
  EventAssignmentAdminDetailExposure,
  EventAssignmentAdminListExposure,
  EventAssignmentAdminMutationExposure,
} from "./event-assignment.exposure";

export class EventAssignmentAdminMutationPresenter extends Presenter<
  EventMutationResult,
  PresentationResult
> {
  present(
    input: EventMutationResult,
    _context: ContextType,
  ): PresentationResult {
    return {
      data:
        EventAssignmentAdminMutationExposure.expose(
          input,
        ),
    };
  }
}

export class EventAssignmentAdminListPresenter extends Presenter<
  ListEventsResult,
  PresentationResult
> {
  present(
    input: ListEventsResult,
    _context: ContextType,
  ): PresentationResult {
    const output: PresentationResult = {
      data: EventAssignmentAdminListExposure.exposeMany(
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

export class EventAssignmentAdminAssignmentListPresenter extends Presenter<
  ListEventAssignmentsResult,
  PresentationResult
> {
  present(
    input: ListEventAssignmentsResult,
    _context: ContextType,
  ): PresentationResult {
    return {
      data:
        EventAssignmentAdminAssignmentListExposure.exposeMany(
          input.items,
        ),
    };
  }
}

export class EventAssignmentAdminByAssignmentListPresenter extends Presenter<
  ListEventsByAssignmentResult,
  PresentationResult
> {
  present(
    input: ListEventsByAssignmentResult,
    _context: ContextType,
  ): PresentationResult {
    const output: PresentationResult = {
      data:
        EventAssignmentAdminByAssignmentListExposure.exposeMany(
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

export class EventAssignmentAdminByResourceListPresenter extends Presenter<
  ListEventsByResourceResult,
  PresentationResult
> {
  present(
    input: ListEventsByResourceResult,
    _context: ContextType,
  ): PresentationResult {
    const output: PresentationResult = {
      data:
        EventAssignmentAdminByResourceListExposure.exposeMany(
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

export class EventAssignmentAdminByPlatformListPresenter extends Presenter<
  ListEventsByPlatformResult,
  PresentationResult
> {
  present(
    input: ListEventsByPlatformResult,
    _context: ContextType,
  ): PresentationResult {
    const output: PresentationResult = {
      data:
        EventAssignmentAdminByPlatformListExposure.exposeMany(
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

export class EventAssignmentAdminDetailPresenter extends Presenter<
  GetEventDetailResult,
  PresentationResult
> {
  present(
    input: GetEventDetailResult,
    _context: ContextType,
  ): PresentationResult {
    return {
      data: EventAssignmentAdminDetailExposure.expose(input),
    };
  }
}
