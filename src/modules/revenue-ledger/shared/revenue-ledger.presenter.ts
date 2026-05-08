import { PresentationResult } from "@app/base/presentation-result.types";
import { Presenter } from "@app/presenter/presenter.base";
import { ContextType } from "@core/context/context.types";
import {
  GetRevenueEntryDetailResult,
  ListRevenueEntriesByEventResult,
  ListRevenueEntriesByPlatformResult,
  ListRevenueEntriesByTalentResult,
  ListRevenueEntriesResult,
  RevenueEntryMutationResult,
} from "./revenue-ledger.contracts";
import {
  RevenueLedgerAdminByEventListExposure,
  RevenueLedgerAdminByPlatformListExposure,
  RevenueLedgerAdminByTalentListExposure,
  RevenueLedgerAdminDetailExposure,
  RevenueLedgerAdminListExposure,
  RevenueLedgerAdminMutationExposure,
} from "./revenue-ledger.exposure";

export class RevenueLedgerAdminMutationPresenter extends Presenter<
  RevenueEntryMutationResult,
  PresentationResult
> {
  present(
    input: RevenueEntryMutationResult,
    _context: ContextType,
  ): PresentationResult {
    return {
      data:
        RevenueLedgerAdminMutationExposure.expose(
          input,
        ),
    };
  }
}

export class RevenueLedgerAdminListPresenter extends Presenter<
  ListRevenueEntriesResult,
  PresentationResult
> {
  present(
    input: ListRevenueEntriesResult,
    _context: ContextType,
  ): PresentationResult {
    const output: PresentationResult = {
      data: RevenueLedgerAdminListExposure.exposeMany(
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

export class RevenueLedgerAdminByTalentListPresenter extends Presenter<
  ListRevenueEntriesByTalentResult,
  PresentationResult
> {
  present(
    input: ListRevenueEntriesByTalentResult,
    _context: ContextType,
  ): PresentationResult {
    const output: PresentationResult = {
      data:
        RevenueLedgerAdminByTalentListExposure.exposeMany(
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

export class RevenueLedgerAdminByPlatformListPresenter extends Presenter<
  ListRevenueEntriesByPlatformResult,
  PresentationResult
> {
  present(
    input: ListRevenueEntriesByPlatformResult,
    _context: ContextType,
  ): PresentationResult {
    const output: PresentationResult = {
      data:
        RevenueLedgerAdminByPlatformListExposure.exposeMany(
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

export class RevenueLedgerAdminByEventListPresenter extends Presenter<
  ListRevenueEntriesByEventResult,
  PresentationResult
> {
  present(
    input: ListRevenueEntriesByEventResult,
    _context: ContextType,
  ): PresentationResult {
    const output: PresentationResult = {
      data:
        RevenueLedgerAdminByEventListExposure.exposeMany(
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

export class RevenueLedgerAdminDetailPresenter extends Presenter<
  GetRevenueEntryDetailResult,
  PresentationResult
> {
  present(
    input: GetRevenueEntryDetailResult,
    _context: ContextType,
  ): PresentationResult {
    return {
      data: RevenueLedgerAdminDetailExposure.expose(
        input,
      ),
    };
  }
}
