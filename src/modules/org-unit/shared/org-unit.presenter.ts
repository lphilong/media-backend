import { Presenter } from "@app/presenter/presenter.base";
import { ContextType } from "@core/context/context.types";
import { PresentationResult } from "@app/base/presentation-result.types";
import {
  GetOrgUnitDetailResult,
  ListDirectChildrenResult,
  ListOrgUnitsResult,
  ListOrgUnitResponsibilitiesResult,
  ListRootOrgUnitsResult,
  OrgUnitMutationResult,
} from "./org-unit.contracts";
import {
  OrgUnitAdminDetailExposure,
  OrgUnitAdminListExposure,
  OrgUnitAdminMutationExposure,
  OrgUnitResponsibilityExposure,
} from "./org-unit.exposure";

type OrgUnitListPresentationInput =
  | ListOrgUnitsResult
  | ListRootOrgUnitsResult
  | ListDirectChildrenResult;

export class OrgUnitAdminMutationPresenter extends Presenter<
  OrgUnitMutationResult,
  PresentationResult
> {
  present(
    input: OrgUnitMutationResult,
    _context: ContextType,
  ): PresentationResult {
    return {
      data: OrgUnitAdminMutationExposure.expose(
        input,
      ),
    };
  }
}

export class OrgUnitAdminListPresenter extends Presenter<
  OrgUnitListPresentationInput,
  PresentationResult
> {
  present(
    input: OrgUnitListPresentationInput,
    _context: ContextType,
  ): PresentationResult {
    const output: PresentationResult = {
      data: OrgUnitAdminListExposure.exposeMany(
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

export class OrgUnitAdminDetailPresenter extends Presenter<
  GetOrgUnitDetailResult,
  PresentationResult
> {
  present(
    input: GetOrgUnitDetailResult,
    _context: ContextType,
  ): PresentationResult {
    return {
      data: OrgUnitAdminDetailExposure.expose(input),
    };
  }
}

export class OrgUnitResponsibilityListPresenter extends Presenter<
  ListOrgUnitResponsibilitiesResult,
  PresentationResult
> {
  present(
    input: ListOrgUnitResponsibilitiesResult,
    _context: ContextType,
  ): PresentationResult {
    return {
      data: OrgUnitResponsibilityExposure.exposeMany(input.items),
    };
  }
}
