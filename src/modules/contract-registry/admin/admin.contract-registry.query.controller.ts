import { Request } from "express";
import { readCommand } from "@app/base/command.middleware";
import { SecureController } from "@app/base/secure-controller.base";
import { PresentationResult } from "@app/base/presentation-result.types";
import { getPresenterRegistryFromRequest } from "@app/presenter/presenter.runtime-access";
import { Actor } from "@core/actor/actor";
import { ContextType } from "@core/context/context.types";
import { SystemInvariantError } from "@core/error/system-error";
import { ContractRegistryValidationError } from "@modules/contract-registry/domain/contract-registry.errors";
import {
  CONTRACT_REGISTRY_ADMIN_BY_LINKED_ENTITY_LIST_PRESENTER_KEY,
  CONTRACT_REGISTRY_ADMIN_BY_OWNER_LIST_PRESENTER_KEY,
  CONTRACT_REGISTRY_ADMIN_DETAIL_PRESENTER_KEY,
  CONTRACT_REGISTRY_ADMIN_LIST_PRESENTER_KEY,
} from "@modules/contract-registry/shared/contract-registry.presenter-keys";
import {
  GetContractRecordDetailQuery,
  ListContractRecordsByLinkedEntityQuery,
  ListContractRecordsByOwnerQuery,
  ListContractRecordsQuery,
} from "@modules/contract-registry/shared/contract-registry.contracts";
import { ContractRegistryAdminQueryService } from "./admin.contract-registry.query-service";

type ContractRegistryQueryCommand =
  | "CONTRACT_RECORD_LIST"
  | "CONTRACT_RECORD_LIST_BY_LINKED_ENTITY"
  | "CONTRACT_RECORD_LIST_BY_OWNER"
  | "CONTRACT_RECORD_GET_DETAIL";

const LIST_CONTRACT_RECORDS_QUERY_FIELDS: readonly string[] =
  Object.freeze([
    "status",
    "contractKind",
    "linkedEntityKind",
    "linkedEmploymentProfileId",
    "linkedTalentId",
    "ownerEmploymentProfileId",
    "confidentialityTier",
    "hasFileReference",
    "windowStartDate",
    "windowEndDate",
    "effectiveEndDateFrom",
    "effectiveEndDateTo",
    "limit",
    "cursor",
    "search",
    "sortBy",
    "sortDirection",
  ]);

const LIST_CONTRACT_RECORDS_BY_LINKED_ENTITY_QUERY_FIELDS: readonly string[] =
  Object.freeze([
    "linkedEntityKind",
    "linkedEmploymentProfileId",
    "linkedTalentId",
    "status",
    "windowStartDate",
    "windowEndDate",
    "limit",
    "cursor",
    "sortBy",
    "sortDirection",
  ]);

const LIST_CONTRACT_RECORDS_BY_OWNER_QUERY_FIELDS: readonly string[] =
  Object.freeze([
    "ownerEmploymentProfileId",
    "status",
    "windowStartDate",
    "windowEndDate",
    "limit",
    "cursor",
    "sortBy",
    "sortDirection",
  ]);

const GET_CONTRACT_RECORD_DETAIL_QUERY_FIELDS: readonly string[] =
  Object.freeze([]);

export class ContractRegistryAdminQueryController extends SecureController {
  constructor(
    private readonly service: ContractRegistryAdminQueryService,
  ) {
    super();
  }

  protected async handle(
    req: Request,
    actor: Actor,
    _context: ContextType,
  ): Promise<unknown> {
    const command =
      readCommand<ContractRegistryQueryCommand>(req);

    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Contract registry query command missing",
      );
    }

    switch (command) {
      case "CONTRACT_RECORD_LIST":
        return this.service.listContractRecords(
          actor,
          parseListContractRecordsQuery(req),
        );

      case "CONTRACT_RECORD_LIST_BY_LINKED_ENTITY":
        return this.service.listContractRecordsByLinkedEntity(
          actor,
          parseListContractRecordsByLinkedEntityQuery(
            req,
          ),
        );

      case "CONTRACT_RECORD_LIST_BY_OWNER":
        return this.service.listContractRecordsByOwner(
          actor,
          parseListContractRecordsByOwnerQuery(req),
        );

      case "CONTRACT_RECORD_GET_DETAIL":
        return this.service.getContractRecordDetail(
          actor,
          parseGetContractRecordDetailQuery(req),
        );

      default:
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          `Unsupported contract registry query command: ${command}`,
        );
    }
  }

  protected async present(
    result: unknown,
    req: Request,
    _actor: Actor,
    context: ContextType,
  ): Promise<PresentationResult> {
    const command =
      readCommand<ContractRegistryQueryCommand>(req);

    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Contract registry query command missing",
      );
    }

    const registry = getPresenterRegistryFromRequest(req);

    switch (command) {
      case "CONTRACT_RECORD_LIST":
        return registry
          .get<unknown, PresentationResult>(
            CONTRACT_REGISTRY_ADMIN_LIST_PRESENTER_KEY,
          )
          .present(result, context);

      case "CONTRACT_RECORD_LIST_BY_LINKED_ENTITY":
        return registry
          .get<unknown, PresentationResult>(
            CONTRACT_REGISTRY_ADMIN_BY_LINKED_ENTITY_LIST_PRESENTER_KEY,
          )
          .present(result, context);

      case "CONTRACT_RECORD_LIST_BY_OWNER":
        return registry
          .get<unknown, PresentationResult>(
            CONTRACT_REGISTRY_ADMIN_BY_OWNER_LIST_PRESENTER_KEY,
          )
          .present(result, context);

      case "CONTRACT_RECORD_GET_DETAIL":
        return registry
          .get<unknown, PresentationResult>(
            CONTRACT_REGISTRY_ADMIN_DETAIL_PRESENTER_KEY,
          )
          .present(result, context);

      default:
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          `Unsupported contract registry query command: ${command}`,
        );
    }
  }
}

function parseListContractRecordsQuery(
  req: Request,
): ListContractRecordsQuery {
  assertNoUnexpectedQueryFields(
    req.query as Record<string, unknown>,
    LIST_CONTRACT_RECORDS_QUERY_FIELDS,
    "listContractRecords",
  );

  return {
    status: req.query.status as string | undefined,
    contractKind:
      req.query.contractKind as string | undefined,
    linkedEntityKind:
      req.query.linkedEntityKind as
        | string
        | undefined,
    linkedEmploymentProfileId:
      req.query.linkedEmploymentProfileId as
        | string
        | undefined,
    linkedTalentId:
      req.query.linkedTalentId as
        | string
        | undefined,
    ownerEmploymentProfileId:
      req.query.ownerEmploymentProfileId as
        | string
        | undefined,
    confidentialityTier:
      req.query.confidentialityTier as
        | string
        | undefined,
    hasFileReference:
      req.query.hasFileReference as
        | string
        | undefined,
    windowStartDate:
      req.query.windowStartDate as
        | string
        | undefined,
    windowEndDate:
      req.query.windowEndDate as
        | string
        | undefined,
    effectiveEndDateFrom:
      req.query.effectiveEndDateFrom as
        | string
        | undefined,
    effectiveEndDateTo:
      req.query.effectiveEndDateTo as
        | string
        | undefined,
    limit: req.query.limit as string | undefined,
    cursor: req.query.cursor as string | undefined,
    search: req.query.search as string | undefined,
    sortBy: req.query.sortBy as string | undefined,
    sortDirection:
      req.query.sortDirection as string | undefined,
  };
}

function parseListContractRecordsByLinkedEntityQuery(
  req: Request,
): ListContractRecordsByLinkedEntityQuery {
  assertNoUnexpectedQueryFields(
    req.query as Record<string, unknown>,
    LIST_CONTRACT_RECORDS_BY_LINKED_ENTITY_QUERY_FIELDS,
    "listContractRecordsByLinkedEntity",
  );

  return {
    linkedEntityKind:
      req.query.linkedEntityKind as string,
    linkedEmploymentProfileId:
      req.query.linkedEmploymentProfileId as
        | string
        | undefined,
    linkedTalentId:
      req.query.linkedTalentId as
        | string
        | undefined,
    status: req.query.status as string | undefined,
    windowStartDate:
      req.query.windowStartDate as
        | string
        | undefined,
    windowEndDate:
      req.query.windowEndDate as
        | string
        | undefined,
    limit: req.query.limit as string | undefined,
    cursor: req.query.cursor as string | undefined,
    sortBy: req.query.sortBy as string | undefined,
    sortDirection:
      req.query.sortDirection as string | undefined,
  };
}

function parseListContractRecordsByOwnerQuery(
  req: Request,
): ListContractRecordsByOwnerQuery {
  assertNoUnexpectedQueryFields(
    req.query as Record<string, unknown>,
    LIST_CONTRACT_RECORDS_BY_OWNER_QUERY_FIELDS,
    "listContractRecordsByOwner",
  );

  return {
    ownerEmploymentProfileId:
      req.query.ownerEmploymentProfileId as string,
    status: req.query.status as string | undefined,
    windowStartDate:
      req.query.windowStartDate as
        | string
        | undefined,
    windowEndDate:
      req.query.windowEndDate as
        | string
        | undefined,
    limit: req.query.limit as string | undefined,
    cursor: req.query.cursor as string | undefined,
    sortBy: req.query.sortBy as string | undefined,
    sortDirection:
      req.query.sortDirection as string | undefined,
  };
}

function parseGetContractRecordDetailQuery(
  req: Request,
): GetContractRecordDetailQuery {
  assertNoUnexpectedQueryFields(
    req.query as Record<string, unknown>,
    GET_CONTRACT_RECORD_DETAIL_QUERY_FIELDS,
    "getContractRecordDetail",
  );

  return {
    contractRecordId: req.params.contractRecordId,
  };
}

function assertNoUnexpectedQueryFields(
  query: Record<string, unknown>,
  allowedFields: readonly string[],
  queryName: string,
): void {
  const unexpectedFields = Object.keys(query).filter(
    (field) => !allowedFields.includes(field),
  );

  if (unexpectedFields.length === 0) {
    return;
  }

  throw new ContractRegistryValidationError(
    `${queryName} query contains unsupported field(s): ${unexpectedFields.join(", ")}`,
  );
}
