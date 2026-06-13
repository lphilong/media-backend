import { PresentationResult } from "@app/base/presentation-result.types";
import { Presenter } from "@app/presenter/presenter.base";
import { ContextType } from "@core/context/context.types";
import {
  ContractRecordMutationResult,
  GetContractRecordDetailResult,
  ListContractRecordsByLinkedEntityResult,
  ListContractRecordsByOwnerResult,
  ListContractRecordsResult,
} from "./contract-registry.contracts";
import {
  ContractObligationMutationResult,
  GetContractObligationDetailResult,
  ListContractObligationsResult,
} from "./contract-obligation.contracts";
import {
  ContractRegistryAdminByLinkedEntityListExposure,
  ContractRegistryAdminByOwnerListExposure,
  ContractRegistryAdminDetailExposure,
  ContractRegistryAdminListExposure,
  ContractRegistryAdminMutationExposure,
  ContractObligationAdminExposure,
} from "./contract-registry.exposure";

export class ContractRegistryAdminMutationPresenter extends Presenter<
  ContractRecordMutationResult,
  PresentationResult
> {
  present(
    input: ContractRecordMutationResult,
    _context: ContextType,
  ): PresentationResult {
    return {
      data:
        ContractRegistryAdminMutationExposure.expose(
          input,
        ),
    };
  }
}

export class ContractRegistryAdminListPresenter extends Presenter<
  ListContractRecordsResult,
  PresentationResult
> {
  present(
    input: ListContractRecordsResult,
    _context: ContextType,
  ): PresentationResult {
    const output: PresentationResult = {
      data: ContractRegistryAdminListExposure.exposeMany(
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

export class ContractRegistryAdminByLinkedEntityListPresenter extends Presenter<
  ListContractRecordsByLinkedEntityResult,
  PresentationResult
> {
  present(
    input: ListContractRecordsByLinkedEntityResult,
    _context: ContextType,
  ): PresentationResult {
    const output: PresentationResult = {
      data:
        ContractRegistryAdminByLinkedEntityListExposure.exposeMany(
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

export class ContractRegistryAdminByOwnerListPresenter extends Presenter<
  ListContractRecordsByOwnerResult,
  PresentationResult
> {
  present(
    input: ListContractRecordsByOwnerResult,
    _context: ContextType,
  ): PresentationResult {
    const output: PresentationResult = {
      data:
        ContractRegistryAdminByOwnerListExposure.exposeMany(
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

export class ContractRegistryAdminDetailPresenter extends Presenter<
  GetContractRecordDetailResult,
  PresentationResult
> {
  present(
    input: GetContractRecordDetailResult,
    _context: ContextType,
  ): PresentationResult {
    return {
      data:
        ContractRegistryAdminDetailExposure.expose(
          input,
        ),
    };
  }
}

export class ContractObligationAdminMutationPresenter extends Presenter<
  ContractObligationMutationResult,
  PresentationResult
> {
  present(
    input: ContractObligationMutationResult,
    _context: ContextType,
  ): PresentationResult {
    return {
      data: ContractObligationAdminExposure.expose(input),
    };
  }
}

export class ContractObligationAdminListPresenter extends Presenter<
  ListContractObligationsResult,
  PresentationResult
> {
  present(
    input: ListContractObligationsResult,
    _context: ContextType,
  ): PresentationResult {
    const output: PresentationResult = {
      data: ContractObligationAdminExposure.exposeMany(
        input.items,
      ),
    };
    if (input.nextCursor) {
      output.meta = { nextCursor: input.nextCursor };
    }
    return output;
  }
}

export class ContractObligationAdminDetailPresenter extends Presenter<
  GetContractObligationDetailResult,
  PresentationResult
> {
  present(
    input: GetContractObligationDetailResult,
    _context: ContextType,
  ): PresentationResult {
    return {
      data: ContractObligationAdminExposure.expose(input),
    };
  }
}
