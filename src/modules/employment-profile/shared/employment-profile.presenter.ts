import { Presenter } from "@app/presenter/presenter.base";
import { ContextType } from "@core/context/context.types";
import { PresentationResult } from "@app/base/presentation-result.types";
import {
  EmploymentProfileMutationResult,
  GetEmploymentProfileDetailResult,
  ListEmploymentProfileDirectReportsResult,
  ListEmploymentProfilesResult,
} from "./employment-profile.contracts";
import {
  EmploymentProfileAdminDetailExposure,
  EmploymentProfileAdminListExposure,
  EmploymentProfileAdminMutationExposure,
} from "./employment-profile.exposure";

type EmploymentProfileListPresentationInput =
  | ListEmploymentProfilesResult
  | ListEmploymentProfileDirectReportsResult;

export class EmploymentProfileAdminMutationPresenter extends Presenter<
  EmploymentProfileMutationResult,
  PresentationResult
> {
  present(
    input: EmploymentProfileMutationResult,
    _context: ContextType,
  ): PresentationResult {
    return {
      data:
        EmploymentProfileAdminMutationExposure.expose(
          input,
        ),
    };
  }
}

export class EmploymentProfileAdminListPresenter extends Presenter<
  EmploymentProfileListPresentationInput,
  PresentationResult
> {
  present(
    input: EmploymentProfileListPresentationInput,
    _context: ContextType,
  ): PresentationResult {
    const output: PresentationResult = {
      data:
        EmploymentProfileAdminListExposure.exposeMany(
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

export class EmploymentProfileAdminDetailPresenter extends Presenter<
  GetEmploymentProfileDetailResult,
  PresentationResult
> {
  present(
    input: GetEmploymentProfileDetailResult,
    _context: ContextType,
  ): PresentationResult {
    return {
      data:
        EmploymentProfileAdminDetailExposure.expose(
          input,
        ),
    };
  }
}
