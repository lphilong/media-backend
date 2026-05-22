import { Presenter } from "@app/presenter/presenter.base";
import { ContextType } from "@core/context/context.types";
import { PresentationResult } from "@app/base/presentation-result.types";
import { PlainObject } from "@app/base/presentation-result.types";
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
    const output: PresentationResult = {
      data: UserAdminMutationExposure.expose(
        input.user,
      ),
    };

    const meta: PlainObject = {};

    if (input.provisioning) {
      meta.provisioning = input.provisioning;
    }

    if (input.passwordSetup) {
      meta.passwordSetup = input.passwordSetup;
    }

    if (Object.keys(meta).length > 0) {
      output.meta = meta;
    }

    return output;
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
