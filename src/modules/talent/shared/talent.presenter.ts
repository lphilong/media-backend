import { Presenter } from "@app/presenter/presenter.base";
import { ContextType } from "@core/context/context.types";
import { PresentationResult } from "@app/base/presentation-result.types";
import {
  GetTalentDetailResult,
  ListTalentsResult,
  TalentMutationResult,
} from "./talent.contracts";
import {
  TalentAdminDetailExposure,
  TalentAdminListExposure,
  TalentAdminMutationExposure,
} from "./talent.exposure";

export class TalentAdminMutationPresenter extends Presenter<
  TalentMutationResult,
  PresentationResult
> {
  present(
    input: TalentMutationResult,
    _context: ContextType,
  ): PresentationResult {
    return {
      data: TalentAdminMutationExposure.expose(
        input,
      ),
    };
  }
}

export class TalentAdminListPresenter extends Presenter<
  ListTalentsResult,
  PresentationResult
> {
  present(
    input: ListTalentsResult,
    _context: ContextType,
  ): PresentationResult {
    const output: PresentationResult = {
      data: TalentAdminListExposure.exposeMany(
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

export class TalentAdminDetailPresenter extends Presenter<
  GetTalentDetailResult,
  PresentationResult
> {
  present(
    input: GetTalentDetailResult,
    _context: ContextType,
  ): PresentationResult {
    return {
      data: TalentAdminDetailExposure.expose(
        input,
      ),
    };
  }
}
