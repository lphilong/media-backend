import { Presenter } from "@app/presenter/presenter.base";
import { PresentationResult } from "@app/base/presentation-result.types";
import { ContextType } from "@core/context/context.types";
import {
  GetPlatformAccountDetailResult,
  ListPlatformAccountsResult,
  PlatformAccountMutationResult,
} from "./platform-account.contracts";
import {
  PlatformAccountAdminDetailExposure,
  PlatformAccountAdminListExposure,
  PlatformAccountAdminMutationExposure,
} from "./platform-account.exposure";

export class PlatformAccountAdminMutationPresenter extends Presenter<
  PlatformAccountMutationResult,
  PresentationResult
> {
  present(
    input: PlatformAccountMutationResult,
    _context: ContextType,
  ): PresentationResult {
    return {
      data:
        PlatformAccountAdminMutationExposure.expose(
          input,
        ),
    };
  }
}

export class PlatformAccountAdminListPresenter extends Presenter<
  ListPlatformAccountsResult,
  PresentationResult
> {
  present(
    input: ListPlatformAccountsResult,
    _context: ContextType,
  ): PresentationResult {
    const output: PresentationResult = {
      data:
        PlatformAccountAdminListExposure.exposeMany(
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

export class PlatformAccountAdminDetailPresenter extends Presenter<
  GetPlatformAccountDetailResult,
  PresentationResult
> {
  present(
    input: GetPlatformAccountDetailResult,
    _context: ContextType,
  ): PresentationResult {
    return {
      data:
        PlatformAccountAdminDetailExposure.expose(
          input,
        ),
    };
  }
}
