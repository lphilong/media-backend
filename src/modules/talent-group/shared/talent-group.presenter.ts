import { Presenter } from "@app/presenter/presenter.base";
import { ContextType } from "@core/context/context.types";
import { PresentationResult } from "@app/base/presentation-result.types";
import {
  TalentGroupMemberMutationView,
  TalentGroupMutationView,
} from "@modules/talent-group/domain/talent-group.types";
import {
  GetTalentGroupDetailResult,
  ListTalentGroupMembersResult,
  ListTalentGroupsByTalentResult,
  ListTalentGroupsResult,
  TalentGroupMutationResult,
} from "./talent-group.contracts";
import {
  TalentGroupAdminDetailExposure,
  TalentGroupAdminListExposure,
  TalentGroupAdminMutationExposure,
  TalentGroupByTalentExposure,
  TalentGroupMemberExposure,
} from "./talent-group.exposure";

export class TalentGroupAdminMutationPresenter extends Presenter<
  TalentGroupMutationResult,
  PresentationResult
> {
  present(
    input: TalentGroupMutationResult,
    _context: ContextType,
  ): PresentationResult {
    return {
      data: isTalentGroupMemberMutationView(input)
        ? TalentGroupMemberExposure.expose(input)
        : TalentGroupAdminMutationExposure.expose(
            input,
          ),
    };
  }
}

export class TalentGroupAdminListPresenter extends Presenter<
  ListTalentGroupsResult,
  PresentationResult
> {
  present(
    input: ListTalentGroupsResult,
    _context: ContextType,
  ): PresentationResult {
    const output: PresentationResult = {
      data: TalentGroupAdminListExposure.exposeMany(
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

export class TalentGroupAdminDetailPresenter extends Presenter<
  GetTalentGroupDetailResult,
  PresentationResult
> {
  present(
    input: GetTalentGroupDetailResult,
    _context: ContextType,
  ): PresentationResult {
    return {
      data: TalentGroupAdminDetailExposure.expose(
        input,
      ),
    };
  }
}

export class TalentGroupAdminMemberListPresenter extends Presenter<
  ListTalentGroupMembersResult,
  PresentationResult
> {
  present(
    input: ListTalentGroupMembersResult,
    _context: ContextType,
  ): PresentationResult {
    const output: PresentationResult = {
      data: TalentGroupMemberExposure.exposeMany(
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

export class TalentGroupAdminByTalentListPresenter extends Presenter<
  ListTalentGroupsByTalentResult,
  PresentationResult
> {
  present(
    input: ListTalentGroupsByTalentResult,
    _context: ContextType,
  ): PresentationResult {
    const output: PresentationResult = {
      data: TalentGroupByTalentExposure.exposeMany(
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

function isTalentGroupMemberMutationView(
  input: TalentGroupMutationResult,
): input is TalentGroupMemberMutationView {
  return (
    typeof input === "object" &&
    input !== null &&
    "membershipStatus" in input
  );
}
