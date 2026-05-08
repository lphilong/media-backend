import { Presenter } from "@app/presenter/presenter.base";
import { ContextType } from "@core/context/context.types";
import { PresentationResult } from "@app/base/presentation-result.types";
import {
  GetRoleDetailResult,
  GetRolePermissionMatrixResult,
  ListRoleAssignmentsResult,
  ListRolesResult,
  RoleMutationResult,
} from "./role.contracts";
import {
  RoleAdminAssignmentExposure,
  RoleAdminDetailExposure,
  RoleAdminListExposure,
  RoleAdminMutationExposure,
  RoleAdminPermissionMatrixExposure,
} from "./role.exposure";

export class RoleAdminMutationPresenter extends Presenter<
  RoleMutationResult,
  PresentationResult
> {
  present(
    input: RoleMutationResult,
    _context: ContextType,
  ): PresentationResult {
    return {
      data: RoleAdminMutationExposure.expose(input),
    };
  }
}

export class RoleAdminListPresenter extends Presenter<
  ListRolesResult,
  PresentationResult
> {
  present(
    input: ListRolesResult,
    _context: ContextType,
  ): PresentationResult {
    const output: PresentationResult = {
      data: RoleAdminListExposure.exposeMany(
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

export class RoleAdminDetailPresenter extends Presenter<
  GetRoleDetailResult,
  PresentationResult
> {
  present(
    input: GetRoleDetailResult,
    _context: ContextType,
  ): PresentationResult {
    return {
      data: RoleAdminDetailExposure.expose(input),
    };
  }
}

export class RoleAdminAssignmentListPresenter extends Presenter<
  ListRoleAssignmentsResult,
  PresentationResult
> {
  present(
    input: ListRoleAssignmentsResult,
    _context: ContextType,
  ): PresentationResult {
    const output: PresentationResult = {
      data: RoleAdminAssignmentExposure.exposeMany(
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

export class RoleAdminPermissionMatrixPresenter extends Presenter<
  GetRolePermissionMatrixResult,
  PresentationResult
> {
  present(
    input: GetRolePermissionMatrixResult,
    _context: ContextType,
  ): PresentationResult {
    return {
      data: RoleAdminPermissionMatrixExposure.expose(
        input,
      ),
    };
  }
}