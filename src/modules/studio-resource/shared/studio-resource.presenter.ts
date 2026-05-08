import { Presenter } from "@app/presenter/presenter.base";
import { PresentationResult } from "@app/base/presentation-result.types";
import { ContextType } from "@core/context/context.types";
import {
  GetStudioResourceDetailResult,
  ListStudioResourceAvailabilityResult,
  ListStudioResourcesResult,
  StudioResourceMutationResult,
} from "./studio-resource.contracts";
import {
  StudioResourceAdminAvailabilityListExposure,
  StudioResourceAdminDetailExposure,
  StudioResourceAdminListExposure,
  StudioResourceAdminMutationExposure,
} from "./studio-resource.exposure";

export class StudioResourceAdminMutationPresenter extends Presenter<
  StudioResourceMutationResult,
  PresentationResult
> {
  present(
    input: StudioResourceMutationResult,
    _context: ContextType,
  ): PresentationResult {
    return {
      data:
        StudioResourceAdminMutationExposure.expose(
          input,
        ),
    };
  }
}

export class StudioResourceAdminListPresenter extends Presenter<
  ListStudioResourcesResult,
  PresentationResult
> {
  present(
    input: ListStudioResourcesResult,
    _context: ContextType,
  ): PresentationResult {
    const output: PresentationResult = {
      data:
        StudioResourceAdminListExposure.exposeMany(
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

export class StudioResourceAdminAvailabilityListPresenter extends Presenter<
  ListStudioResourceAvailabilityResult,
  PresentationResult
> {
  present(
    input: ListStudioResourceAvailabilityResult,
    _context: ContextType,
  ): PresentationResult {
    const output: PresentationResult = {
      data:
        StudioResourceAdminAvailabilityListExposure.exposeMany(
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

export class StudioResourceAdminDetailPresenter extends Presenter<
  GetStudioResourceDetailResult,
  PresentationResult
> {
  present(
    input: GetStudioResourceDetailResult,
    _context: ContextType,
  ): PresentationResult {
    return {
      data:
        StudioResourceAdminDetailExposure.expose(
          input,
        ),
    };
  }
}
