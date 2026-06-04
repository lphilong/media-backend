import { Request } from "express";
import { readCommand } from "@app/base/command.middleware";
import { SecureController } from "@app/base/secure-controller.base";
import { PresentationResult } from "@app/base/presentation-result.types";
import { getPresenterRegistryFromRequest } from "@app/presenter/presenter.runtime-access";
import { Actor } from "@core/actor/actor";
import { ContextType } from "@core/context/context.types";
import { SystemInvariantError } from "@core/error/system-error";
import {
  GetUserDetailQuery,
  ListUsersQuery,
} from "@modules/user/shared/user.contracts";
import { UserValidationError } from "@modules/user/domain/user.errors";
import {
  USER_ADMIN_DETAIL_PRESENTER_KEY,
  USER_ADMIN_LIST_PRESENTER_KEY,
} from "@modules/user/shared/user.presenter-keys";
import { UserAdminQueryService } from "./admin.user.query-service";

type UserQueryCommand =
  | "USER_LIST"
  | "USER_GET_DETAIL";

const LIST_USERS_QUERY_FIELDS: readonly string[] =
  Object.freeze([
    "state",
    "actorKind",
    "hasEmploymentProfile",
    "cursor",
    "limit",
    "search",
  ]);

const GET_USER_DETAIL_QUERY_FIELDS: readonly string[] =
  Object.freeze([]);

export class UserQueryAdminController extends SecureController {
  constructor(
    private readonly service: UserAdminQueryService,
  ) {
    super();
  }

  protected async handle(
    req: Request,
    actor: Actor,
    _context: ContextType,
  ): Promise<unknown> {
    const command = readCommand<UserQueryCommand>(req);

    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "User query command missing",
      );
    }

    switch (command) {
      case "USER_LIST":
        return this.service.listUsers(
          actor,
          parseListUsersQuery(req),
        );

      case "USER_GET_DETAIL":
        return this.service.getUserDetail(
          actor,
          parseGetUserDetailQuery(req),
        );

      default:
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          `Unsupported user query command: ${command}`,
        );
    }
  }

  protected async present(
    result: unknown,
    req: Request,
    _actor: Actor,
    context: ContextType,
  ): Promise<PresentationResult> {
    const command = readCommand<UserQueryCommand>(req);

    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "User query command missing",
      );
    }

    const registry =
      getPresenterRegistryFromRequest(req);

    switch (command) {
      case "USER_LIST":
        return registry
          .get<unknown, PresentationResult>(
            USER_ADMIN_LIST_PRESENTER_KEY,
          )
          .present(result, context);

      case "USER_GET_DETAIL":
        return registry
          .get<unknown, PresentationResult>(
            USER_ADMIN_DETAIL_PRESENTER_KEY,
          )
          .present(result, context);

      default:
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          `Unsupported user query command: ${command}`,
        );
    }
  }
}

function parseListUsersQuery(
  req: Request,
): ListUsersQuery {
  assertNoUnexpectedQueryFields(
    readQueryRecord(req),
    LIST_USERS_QUERY_FIELDS,
    "USER_LIST",
  );

  return {
    state: req.query.state as string | undefined,
    actorKind: req.query.actorKind as
      | string
      | undefined,
    hasEmploymentProfile: req.query
      .hasEmploymentProfile as string | undefined,
    cursor: req.query.cursor as string | undefined,
    limit: req.query.limit as string | undefined,
    search: req.query.search as string | undefined,
  };
}

function parseGetUserDetailQuery(
  req: Request,
): GetUserDetailQuery {
  assertNoUnexpectedQueryFields(
    readQueryRecord(req),
    GET_USER_DETAIL_QUERY_FIELDS,
    "USER_GET_DETAIL",
  );

  return {
    userId: req.params.userId,
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
  command: UserQueryCommand,
): void {
  const unexpectedFields = Object.keys(query).filter(
    (field) => !allowedFields.includes(field),
  );

  if (unexpectedFields.length === 0) {
    return;
  }

  unexpectedFields.sort();

  throw new UserValidationError(
    `${command} query contains unsupported field(s): ${unexpectedFields.join(", ")}`,
  );
}
