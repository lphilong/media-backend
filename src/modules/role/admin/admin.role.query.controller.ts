import { Request } from "express";
import { readCommand } from "@app/base/command.middleware";
import { SecureController } from "@app/base/secure-controller.base";
import { PresentationResult } from "@app/base/presentation-result.types";
import { getPresenterRegistryFromRequest } from "@app/presenter/presenter.runtime-access";
import { Actor } from "@core/actor/actor";
import { ContextType } from "@core/context/context.types";
import { SystemInvariantError } from "@core/error/system-error";
import {
  ROLE_ADMIN_DETAIL_PRESENTER_KEY,
  ROLE_ADMIN_LIST_PRESENTER_KEY,
  ROLE_ADMIN_PERMISSION_MATRIX_PRESENTER_KEY,
} from "@modules/role/shared/role.presenter-keys";
import {
  GetRoleDetailQuery,
  ListRolePermissionMatrixQuery,
  ListRolesQuery,
} from "@modules/role/shared/role.contracts";
import { RoleValidationError } from "@modules/role/domain/role.errors";
import { RoleAdminQueryService } from "./admin.role.query-service";

type RoleQueryCommand =
  | "ROLE_LIST"
  | "ROLE_GET_DETAIL"
  | "ROLE_PERMISSION_MATRIX";

const LIST_ROLES_QUERY_FIELDS: readonly string[] =
  Object.freeze([
    "state",
    "cursor",
    "limit",
    "search",
  ]);

const GET_ROLE_DETAIL_QUERY_FIELDS: readonly string[] =
  Object.freeze([]);

const ROLE_PERMISSION_MATRIX_QUERY_FIELDS: readonly string[] =
  Object.freeze([]);

export class AdminRoleQueryController extends SecureController {
  constructor(
    private readonly service: RoleAdminQueryService,
  ) {
    super();
  }

  protected async handle(
    req: Request,
    actor: Actor,
    _context: ContextType,
  ): Promise<unknown> {
    const command = readCommand<RoleQueryCommand>(req);

    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Role query command missing",
      );
    }

    switch (command) {
      case "ROLE_LIST":
        return this.service.listRoles(
          actor,
          parseListRolesQuery(req),
        );

      case "ROLE_GET_DETAIL":
        return this.service.getRoleDetail(
          actor,
          parseGetRoleDetailQuery(req),
        );

      case "ROLE_PERMISSION_MATRIX":
        return this.service.getRolePermissionMatrix(
          actor,
          parseRolePermissionMatrixQuery(req),
        );

      default:
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          `Unsupported role query command: ${command}`,
        );
    }
  }

  protected async present(
    result: unknown,
    req: Request,
    _actor: Actor,
    context: ContextType,
  ): Promise<PresentationResult> {
    const command = readCommand<RoleQueryCommand>(req);

    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Role query command missing",
      );
    }

    const registry = getPresenterRegistryFromRequest(req);

    switch (command) {
      case "ROLE_LIST":
        return registry
          .get<unknown, PresentationResult>(
            ROLE_ADMIN_LIST_PRESENTER_KEY,
          )
          .present(result, context);

      case "ROLE_GET_DETAIL":
        return registry
          .get<unknown, PresentationResult>(
            ROLE_ADMIN_DETAIL_PRESENTER_KEY,
          )
          .present(result, context);

      case "ROLE_PERMISSION_MATRIX":
        return registry
          .get<unknown, PresentationResult>(
            ROLE_ADMIN_PERMISSION_MATRIX_PRESENTER_KEY,
          )
          .present(result, context);

      default:
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          `Unsupported role query command: ${command}`,
        );
    }
  }
}

function parseListRolesQuery(
  req: Request,
): ListRolesQuery {
  assertNoUnexpectedQueryFields(
    readQueryRecord(req),
    LIST_ROLES_QUERY_FIELDS,
    "ROLE_LIST",
  );

  return {
    state: req.query.state as string | undefined,
    limit: req.query.limit as string | undefined,
    cursor: req.query.cursor as string | undefined,
    search: req.query.search as string | undefined,
  };
}

function parseGetRoleDetailQuery(
  req: Request,
): GetRoleDetailQuery {
  assertNoUnexpectedQueryFields(
    readQueryRecord(req),
    GET_ROLE_DETAIL_QUERY_FIELDS,
    "ROLE_GET_DETAIL",
  );

  return {
    roleId: req.params.roleId,
  };
}

function parseRolePermissionMatrixQuery(
  req: Request,
): ListRolePermissionMatrixQuery {
  assertNoUnexpectedQueryFields(
    readQueryRecord(req),
    ROLE_PERMISSION_MATRIX_QUERY_FIELDS,
    "ROLE_PERMISSION_MATRIX",
  );

  return {
    roleId: req.params.roleId,
  };
}

function readQueryRecord(
  req: Request,
): Readonly<Record<string, unknown>> {
  return req.query as Record<string, unknown>;
}

function assertNoUnexpectedQueryFields(
  query: Readonly<Record<string, unknown>>,
  allowedFields: readonly string[],
  command: RoleQueryCommand,
): void {
  const unexpectedFields = Object.keys(query).filter(
    (field) => !allowedFields.includes(field),
  );

  if (unexpectedFields.length === 0) {
    return;
  }

  unexpectedFields.sort();

  throw new RoleValidationError(
    `${command} query contains unsupported field(s): ${unexpectedFields.join(", ")}`,
  );
}
