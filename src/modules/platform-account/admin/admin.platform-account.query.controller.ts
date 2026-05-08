import { Request } from "express";
import { readCommand } from "@app/base/command.middleware";
import { SecureController } from "@app/base/secure-controller.base";
import { PresentationResult } from "@app/base/presentation-result.types";
import { getPresenterRegistryFromRequest } from "@app/presenter/presenter.runtime-access";
import { Actor } from "@core/actor/actor";
import { ContextType } from "@core/context/context.types";
import { SystemInvariantError } from "@core/error/system-error";
import { PlatformAccountValidationError } from "@modules/platform-account/domain/platform-account.errors";
import {
  PLATFORM_ACCOUNT_ADMIN_DETAIL_PRESENTER_KEY,
  PLATFORM_ACCOUNT_ADMIN_LIST_PRESENTER_KEY,
} from "@modules/platform-account/shared/platform-account.presenter-keys";
import {
  GetPlatformAccountDetailQuery,
  ListPlatformAccountsQuery,
} from "@modules/platform-account/shared/platform-account.contracts";
import { PlatformAccountAdminQueryService } from "./admin.platform-account.query-service";

type PlatformAccountQueryCommand =
  | "PLATFORM_ACCOUNT_LIST"
  | "PLATFORM_ACCOUNT_GET_DETAIL";

const LIST_PLATFORM_ACCOUNTS_QUERY_FIELDS: readonly string[] =
  Object.freeze([
    "platform",
    "platformSurfaceType",
    "operationalStatus",
    "ownerKind",
    "ownerOrgUnitId",
    "ownerTalentId",
    "ownerTalentGroupId",
    "livestreamEnabled",
    "contentPublishingEnabled",
    "monetizationEnabled",
    "limit",
    "cursor",
    "search",
    "sortBy",
    "sortDirection",
  ]);

const GET_PLATFORM_ACCOUNT_DETAIL_QUERY_FIELDS: readonly string[] =
  Object.freeze([]);

export class PlatformAccountAdminQueryController extends SecureController {
  constructor(
    private readonly service: PlatformAccountAdminQueryService,
  ) {
    super();
  }

  protected async handle(
    req: Request,
    actor: Actor,
    _context: ContextType,
  ): Promise<unknown> {
    const command =
      readCommand<PlatformAccountQueryCommand>(
        req,
      );

    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Platform account query command missing",
      );
    }

    switch (command) {
      case "PLATFORM_ACCOUNT_LIST":
        return this.service.listPlatformAccounts(
          actor,
          parseListPlatformAccountsQuery(req),
        );

      case "PLATFORM_ACCOUNT_GET_DETAIL":
        return this.service.getPlatformAccountDetail(
          actor,
          parseGetPlatformAccountDetailQuery(req),
        );

      default:
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          `Unsupported platform account query command: ${command}`,
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
      readCommand<PlatformAccountQueryCommand>(
        req,
      );

    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Platform account query command missing",
      );
    }

    const registry = getPresenterRegistryFromRequest(req);

    switch (command) {
      case "PLATFORM_ACCOUNT_LIST":
        return registry
          .get<unknown, PresentationResult>(
            PLATFORM_ACCOUNT_ADMIN_LIST_PRESENTER_KEY,
          )
          .present(result, context);

      case "PLATFORM_ACCOUNT_GET_DETAIL":
        return registry
          .get<unknown, PresentationResult>(
            PLATFORM_ACCOUNT_ADMIN_DETAIL_PRESENTER_KEY,
          )
          .present(result, context);

      default:
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          `Unsupported platform account query command: ${command}`,
        );
    }
  }
}

function parseListPlatformAccountsQuery(
  req: Request,
): ListPlatformAccountsQuery {
  assertNoUnexpectedQueryFields(
    req.query as Record<string, unknown>,
    LIST_PLATFORM_ACCOUNTS_QUERY_FIELDS,
    "listPlatformAccounts",
  );

  return {
    platform: req.query.platform as string | undefined,
    platformSurfaceType:
      req.query.platformSurfaceType as
        | string
        | undefined,
    operationalStatus:
      req.query.operationalStatus as
        | string
        | undefined,
    ownerKind:
      req.query.ownerKind as string | undefined,
    ownerOrgUnitId:
      req.query.ownerOrgUnitId as
        | string
        | undefined,
    ownerTalentId:
      req.query.ownerTalentId as
        | string
        | undefined,
    ownerTalentGroupId:
      req.query.ownerTalentGroupId as
        | string
        | undefined,
    livestreamEnabled:
      req.query.livestreamEnabled as
        | string
        | undefined,
    contentPublishingEnabled:
      req.query.contentPublishingEnabled as
        | string
        | undefined,
    monetizationEnabled:
      req.query.monetizationEnabled as
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

function parseGetPlatformAccountDetailQuery(
  req: Request,
): GetPlatformAccountDetailQuery {
  assertNoUnexpectedQueryFields(
    req.query as Record<string, unknown>,
    GET_PLATFORM_ACCOUNT_DETAIL_QUERY_FIELDS,
    "getPlatformAccountDetail",
  );

  return {
    platformAccountId:
      req.params.platformAccountId,
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

  throw new PlatformAccountValidationError(
    `${queryName} query contains unsupported field(s): ${unexpectedFields.join(", ")}`,
  );
}
