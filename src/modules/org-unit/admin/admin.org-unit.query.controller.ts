import { Request } from "express";
import { readCommand } from "@app/base/command.middleware";
import { SecureController } from "@app/base/secure-controller.base";
import { PresentationResult } from "@app/base/presentation-result.types";
import { getPresenterRegistryFromRequest } from "@app/presenter/presenter.runtime-access";
import { Actor } from "@core/actor/actor";
import { ContextType } from "@core/context/context.types";
import { SystemInvariantError } from "@core/error/system-error";
import { OrgUnitValidationError } from "@modules/org-unit/domain/org-unit.errors";
import {
  ORG_UNIT_ADMIN_DETAIL_PRESENTER_KEY,
  ORG_UNIT_ADMIN_LIST_PRESENTER_KEY,
} from "@modules/org-unit/shared/org-unit.presenter-keys";
import {
  GetOrgUnitDetailQuery,
  ListDirectChildrenQuery,
  ListOrgUnitsQuery,
  ListRootOrgUnitsQuery,
} from "@modules/org-unit/shared/org-unit.contracts";
import { OrgUnitAdminQueryService } from "./admin.org-unit.query-service";

type OrgUnitQueryCommand =
  | "ORG_UNIT_LIST"
  | "ORG_UNIT_GET_DETAIL"
  | "ORG_UNIT_LIST_ROOTS"
  | "ORG_UNIT_LIST_CHILDREN";

const LIST_ORG_UNITS_QUERY_FIELDS: readonly string[] =
  Object.freeze([
    "status",
    "type",
    "parentOrgUnitId",
    "rootOnly",
    "limit",
    "cursor",
    "search",
    "sortBy",
    "sortDirection",
  ]);

const LIST_ROOT_ORG_UNITS_QUERY_FIELDS: readonly string[] =
  Object.freeze(["limit", "cursor"]);

const LIST_DIRECT_CHILDREN_QUERY_FIELDS: readonly string[] =
  Object.freeze(["limit", "cursor"]);

const GET_ORG_UNIT_DETAIL_QUERY_FIELDS: readonly string[] =
  Object.freeze([]);

export class OrgUnitAdminQueryController extends SecureController {
  constructor(
    private readonly service: OrgUnitAdminQueryService,
  ) {
    super();
  }

  protected async handle(
    req: Request,
    actor: Actor,
    _context: ContextType,
  ): Promise<unknown> {
    const command = readCommand<OrgUnitQueryCommand>(req);

    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Org unit query command missing",
      );
    }

    switch (command) {
      case "ORG_UNIT_LIST":
        return this.service.listOrgUnits(
          actor,
          parseListOrgUnitsQuery(req),
        );

      case "ORG_UNIT_GET_DETAIL":
        return this.service.getOrgUnitDetail(
          actor,
          parseGetOrgUnitDetailQuery(req),
        );

      case "ORG_UNIT_LIST_ROOTS":
        return this.service.listRootOrgUnits(
          actor,
          parseListRootOrgUnitsQuery(req),
        );

      case "ORG_UNIT_LIST_CHILDREN":
        return this.service.listDirectChildren(
          actor,
          parseListDirectChildrenQuery(req),
        );

      default:
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          `Unsupported org unit query command: ${command}`,
        );
    }
  }

  protected async present(
    result: unknown,
    req: Request,
    _actor: Actor,
    context: ContextType,
  ): Promise<PresentationResult> {
    const command = readCommand<OrgUnitQueryCommand>(req);

    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Org unit query command missing",
      );
    }

    const registry = getPresenterRegistryFromRequest(req);

    switch (command) {
      case "ORG_UNIT_LIST":
      case "ORG_UNIT_LIST_ROOTS":
      case "ORG_UNIT_LIST_CHILDREN":
        return registry
          .get<unknown, PresentationResult>(
            ORG_UNIT_ADMIN_LIST_PRESENTER_KEY,
          )
          .present(result, context);

      case "ORG_UNIT_GET_DETAIL":
        return registry
          .get<unknown, PresentationResult>(
            ORG_UNIT_ADMIN_DETAIL_PRESENTER_KEY,
          )
          .present(result, context);

      default:
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          `Unsupported org unit query command: ${command}`,
        );
    }
  }
}

function parseListOrgUnitsQuery(
  req: Request,
): ListOrgUnitsQuery {
  assertNoUnexpectedQueryFields(
    req.query as Record<string, unknown>,
    LIST_ORG_UNITS_QUERY_FIELDS,
    "listOrgUnits",
  );

  return {
    status: req.query.status as string | undefined,
    type: req.query.type as string | undefined,
    parentOrgUnitId:
      req.query.parentOrgUnitId as
        | string
        | undefined,
    rootOnly:
      req.query.rootOnly as
        | string
        | undefined,
    limit: req.query.limit as string | undefined,
    cursor: req.query.cursor as string | undefined,
    search: req.query.search as string | undefined,
    sortBy: req.query.sortBy as string | undefined,
    sortDirection:
      req.query.sortDirection as
        | string
        | undefined,
  };
}

function parseGetOrgUnitDetailQuery(
  req: Request,
): GetOrgUnitDetailQuery {
  assertNoUnexpectedQueryFields(
    req.query as Record<string, unknown>,
    GET_ORG_UNIT_DETAIL_QUERY_FIELDS,
    "getOrgUnitDetail",
  );

  return {
    orgUnitId: req.params.orgUnitId,
  };
}

function parseListRootOrgUnitsQuery(
  req: Request,
): ListRootOrgUnitsQuery {
  assertNoUnexpectedQueryFields(
    req.query as Record<string, unknown>,
    LIST_ROOT_ORG_UNITS_QUERY_FIELDS,
    "listRootOrgUnits",
  );

  return {
    limit: req.query.limit as string | undefined,
    cursor: req.query.cursor as string | undefined,
  };
}

function parseListDirectChildrenQuery(
  req: Request,
): ListDirectChildrenQuery {
  assertNoUnexpectedQueryFields(
    req.query as Record<string, unknown>,
    LIST_DIRECT_CHILDREN_QUERY_FIELDS,
    "listDirectChildren",
  );

  return {
    orgUnitId: req.params.orgUnitId,
    limit: req.query.limit as string | undefined,
    cursor: req.query.cursor as string | undefined,
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

  throw new OrgUnitValidationError(
    `${queryName} query contains unsupported field(s): ${unexpectedFields.join(", ")}`,
  );
}
