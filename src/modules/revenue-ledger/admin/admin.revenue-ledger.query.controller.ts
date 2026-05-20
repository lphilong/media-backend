import { Request } from "express";
import { readCommand } from "@app/base/command.middleware";
import { SecureController } from "@app/base/secure-controller.base";
import { PresentationResult } from "@app/base/presentation-result.types";
import { getPresenterRegistryFromRequest } from "@app/presenter/presenter.runtime-access";
import { Actor } from "@core/actor/actor";
import { ContextType } from "@core/context/context.types";
import { SystemInvariantError } from "@core/error/system-error";
import { RevenueLedgerValidationError } from "@modules/revenue-ledger/domain/revenue-ledger.errors";
import {
  REVENUE_LEDGER_ADMIN_BY_EVENT_LIST_PRESENTER_KEY,
  REVENUE_LEDGER_ADMIN_BY_PLATFORM_LIST_PRESENTER_KEY,
  REVENUE_LEDGER_ADMIN_BY_TALENT_LIST_PRESENTER_KEY,
  REVENUE_LEDGER_ADMIN_DETAIL_PRESENTER_KEY,
  REVENUE_LEDGER_ADMIN_LIST_PRESENTER_KEY,
} from "@modules/revenue-ledger/shared/revenue-ledger.presenter-keys";
import {
  GetRevenueEntryDetailQuery,
  ListRevenueEntriesByEventQuery,
  ListRevenueEntriesByPlatformQuery,
  ListRevenueEntriesByTalentQuery,
  ListRevenueEntriesQuery,
} from "@modules/revenue-ledger/shared/revenue-ledger.contracts";
import { RevenueLedgerAdminQueryService } from "./admin.revenue-ledger.query-service";

type RevenueLedgerQueryCommand =
  | "REVENUE_ENTRY_LIST"
  | "REVENUE_ENTRY_LIST_BY_TALENT"
  | "REVENUE_ENTRY_LIST_BY_PLATFORM"
  | "REVENUE_ENTRY_LIST_BY_EVENT"
  | "REVENUE_ENTRY_GET_DETAIL";

const LIST_REVENUE_ENTRIES_QUERY_FIELDS: readonly string[] =
  Object.freeze([
    "status",
    "subjectTalentId",
    "attributionPlatformAccountId",
    "attributionEventId",
    "revenueKind",
    "entrySource",
    "currencyCode",
    "windowStartAt",
    "windowEndAt",
    "createdBeforeAt",
    "finalizedFromAt",
    "finalizedToAt",
    "reconciledFromAt",
    "reconciledToAt",
    "limit",
    "cursor",
    "search",
    "sortBy",
    "sortDirection",
  ]);

const LIST_REVENUE_ENTRIES_BY_TALENT_QUERY_FIELDS: readonly string[] =
  Object.freeze([
    "subjectTalentId",
    "status",
    "windowStartAt",
    "windowEndAt",
    "limit",
    "cursor",
    "sortBy",
    "sortDirection",
  ]);

const LIST_REVENUE_ENTRIES_BY_PLATFORM_QUERY_FIELDS: readonly string[] =
  Object.freeze([
    "attributionPlatformAccountId",
    "status",
    "windowStartAt",
    "windowEndAt",
    "limit",
    "cursor",
    "sortBy",
    "sortDirection",
  ]);

const LIST_REVENUE_ENTRIES_BY_EVENT_QUERY_FIELDS: readonly string[] =
  Object.freeze([
    "attributionEventId",
    "status",
    "windowStartAt",
    "windowEndAt",
    "limit",
    "cursor",
    "sortBy",
    "sortDirection",
  ]);

const GET_REVENUE_ENTRY_DETAIL_QUERY_FIELDS: readonly string[] =
  Object.freeze([]);

export class RevenueLedgerAdminQueryController extends SecureController {
  constructor(
    private readonly service: RevenueLedgerAdminQueryService,
  ) {
    super();
  }

  protected async handle(
    req: Request,
    actor: Actor,
    _context: ContextType,
  ): Promise<unknown> {
    const command =
      readCommand<RevenueLedgerQueryCommand>(req);

    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Revenue Ledger query command missing",
      );
    }

    switch (command) {
      case "REVENUE_ENTRY_LIST":
        return this.service.listRevenueEntries(
          actor,
          parseListRevenueEntriesQuery(req),
        );

      case "REVENUE_ENTRY_LIST_BY_TALENT":
        return this.service.listRevenueEntriesByTalent(
          actor,
          parseListRevenueEntriesByTalentQuery(req),
        );

      case "REVENUE_ENTRY_LIST_BY_PLATFORM":
        return this.service.listRevenueEntriesByPlatform(
          actor,
          parseListRevenueEntriesByPlatformQuery(req),
        );

      case "REVENUE_ENTRY_LIST_BY_EVENT":
        return this.service.listRevenueEntriesByEvent(
          actor,
          parseListRevenueEntriesByEventQuery(req),
        );

      case "REVENUE_ENTRY_GET_DETAIL":
        return this.service.getRevenueEntryDetail(
          actor,
          parseGetRevenueEntryDetailQuery(req),
        );

      default:
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          `Unsupported revenue ledger query command: ${command}`,
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
      readCommand<RevenueLedgerQueryCommand>(req);

    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Revenue Ledger query command missing",
      );
    }

    const registry = getPresenterRegistryFromRequest(req);

    switch (command) {
      case "REVENUE_ENTRY_LIST":
        return registry
          .get<unknown, PresentationResult>(
            REVENUE_LEDGER_ADMIN_LIST_PRESENTER_KEY,
          )
          .present(result, context);

      case "REVENUE_ENTRY_LIST_BY_TALENT":
        return registry
          .get<unknown, PresentationResult>(
            REVENUE_LEDGER_ADMIN_BY_TALENT_LIST_PRESENTER_KEY,
          )
          .present(result, context);

      case "REVENUE_ENTRY_LIST_BY_PLATFORM":
        return registry
          .get<unknown, PresentationResult>(
            REVENUE_LEDGER_ADMIN_BY_PLATFORM_LIST_PRESENTER_KEY,
          )
          .present(result, context);

      case "REVENUE_ENTRY_LIST_BY_EVENT":
        return registry
          .get<unknown, PresentationResult>(
            REVENUE_LEDGER_ADMIN_BY_EVENT_LIST_PRESENTER_KEY,
          )
          .present(result, context);

      case "REVENUE_ENTRY_GET_DETAIL":
        return registry
          .get<unknown, PresentationResult>(
            REVENUE_LEDGER_ADMIN_DETAIL_PRESENTER_KEY,
          )
          .present(result, context);

      default:
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          `Unsupported revenue ledger query command: ${command}`,
        );
    }
  }
}

function parseListRevenueEntriesQuery(
  req: Request,
): ListRevenueEntriesQuery {
  assertNoUnexpectedQueryFields(
    req.query as Record<string, unknown>,
    LIST_REVENUE_ENTRIES_QUERY_FIELDS,
    "listRevenueEntries",
  );

  return {
    status: req.query.status as string | undefined,
    subjectTalentId:
      req.query.subjectTalentId as
        | string
        | undefined,
    attributionPlatformAccountId:
      req.query.attributionPlatformAccountId as
        | string
        | undefined,
    attributionEventId:
      req.query.attributionEventId as
        | string
        | undefined,
    revenueKind:
      req.query.revenueKind as string | undefined,
    entrySource:
      req.query.entrySource as string | undefined,
    currencyCode:
      req.query.currencyCode as string | undefined,
    windowStartAt:
      req.query.windowStartAt as
        | string
        | undefined,
    windowEndAt:
      req.query.windowEndAt as
        | string
        | undefined,
    createdBeforeAt:
      req.query.createdBeforeAt as
        | string
        | undefined,
    finalizedFromAt:
      req.query.finalizedFromAt as
        | string
        | undefined,
    finalizedToAt:
      req.query.finalizedToAt as
        | string
        | undefined,
    reconciledFromAt:
      req.query.reconciledFromAt as
        | string
        | undefined,
    reconciledToAt:
      req.query.reconciledToAt as
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

function parseListRevenueEntriesByTalentQuery(
  req: Request,
): ListRevenueEntriesByTalentQuery {
  assertNoUnexpectedQueryFields(
    req.query as Record<string, unknown>,
    LIST_REVENUE_ENTRIES_BY_TALENT_QUERY_FIELDS,
    "listRevenueEntriesByTalent",
  );

  return {
    subjectTalentId:
      req.query.subjectTalentId as string,
    status: req.query.status as string | undefined,
    windowStartAt:
      req.query.windowStartAt as
        | string
        | undefined,
    windowEndAt:
      req.query.windowEndAt as
        | string
        | undefined,
    limit: req.query.limit as string | undefined,
    cursor: req.query.cursor as string | undefined,
    sortBy: req.query.sortBy as string | undefined,
    sortDirection:
      req.query.sortDirection as string | undefined,
  };
}

function parseListRevenueEntriesByPlatformQuery(
  req: Request,
): ListRevenueEntriesByPlatformQuery {
  assertNoUnexpectedQueryFields(
    req.query as Record<string, unknown>,
    LIST_REVENUE_ENTRIES_BY_PLATFORM_QUERY_FIELDS,
    "listRevenueEntriesByPlatform",
  );

  return {
    attributionPlatformAccountId:
      req.query.attributionPlatformAccountId as string,
    status: req.query.status as string | undefined,
    windowStartAt:
      req.query.windowStartAt as
        | string
        | undefined,
    windowEndAt:
      req.query.windowEndAt as
        | string
        | undefined,
    limit: req.query.limit as string | undefined,
    cursor: req.query.cursor as string | undefined,
    sortBy: req.query.sortBy as string | undefined,
    sortDirection:
      req.query.sortDirection as string | undefined,
  };
}

function parseListRevenueEntriesByEventQuery(
  req: Request,
): ListRevenueEntriesByEventQuery {
  assertNoUnexpectedQueryFields(
    req.query as Record<string, unknown>,
    LIST_REVENUE_ENTRIES_BY_EVENT_QUERY_FIELDS,
    "listRevenueEntriesByEvent",
  );

  return {
    attributionEventId:
      req.query.attributionEventId as string,
    status: req.query.status as string | undefined,
    windowStartAt:
      req.query.windowStartAt as
        | string
        | undefined,
    windowEndAt:
      req.query.windowEndAt as
        | string
        | undefined,
    limit: req.query.limit as string | undefined,
    cursor: req.query.cursor as string | undefined,
    sortBy: req.query.sortBy as string | undefined,
    sortDirection:
      req.query.sortDirection as string | undefined,
  };
}

function parseGetRevenueEntryDetailQuery(
  req: Request,
): GetRevenueEntryDetailQuery {
  assertNoUnexpectedQueryFields(
    req.query as Record<string, unknown>,
    GET_REVENUE_ENTRY_DETAIL_QUERY_FIELDS,
    "getRevenueEntryDetail",
  );

  return {
    revenueEntryId: req.params.revenueEntryId,
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

  throw new RevenueLedgerValidationError(
    `${queryName} query contains unsupported field(s): ${unexpectedFields.join(", ")}`,
  );
}
