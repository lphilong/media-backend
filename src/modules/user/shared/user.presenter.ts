import { Presenter } from "@app/presenter/presenter.base";
import { ContextType } from "@core/context/context.types";
import { PresentationResult } from "@app/base/presentation-result.types";
import {
  UserDetailResult,
  UserListResult,
  UserMutationResult,
} from "./user.contracts";
import {
  UserAdminDetailExposure,
  UserAdminListExposure,
  UserAdminMutationExposure,
} from "./user.exposure";

export class UserAdminMutationPresenter extends Presenter<
  UserMutationResult,
  PresentationResult
> {
  present(
    input: UserMutationResult,
    _context: ContextType,
  ): PresentationResult {
    return {
      data: UserAdminMutationExposure.expose(
        input.user,
      ),
    };
  }
}

export class UserAdminListPresenter extends Presenter<
  UserListResult,
  PresentationResult
> {
  present(
    input: UserListResult,
    _context: ContextType,
  ): PresentationResult {
    const output: PresentationResult = {
      data: UserAdminListExposure.exposeMany(
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

export class UserAdminDetailPresenter extends Presenter<
  UserDetailResult,
  PresentationResult
> {
  present(
    input: UserDetailResult,
    _context: ContextType,
  ): PresentationResult {
    return {
      data: UserAdminDetailExposure.expose(input),
    };
  }
}