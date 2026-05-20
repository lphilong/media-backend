import { Request } from "express";
import { readCommand } from "@app/base/command.middleware";
import { SecureController } from "@app/base/secure-controller.base";
import { PresentationResult } from "@app/base/presentation-result.types";
import { getPresenterRegistryFromRequest } from "@app/presenter/presenter.runtime-access";
import { Actor } from "@core/actor/actor";
import { ContextType } from "@core/context/context.types";
import { SystemInvariantError } from "@core/error/system-error";
import { TalentKpiValidationError } from "@modules/talent-kpi/domain/talent-kpi.errors";
import {
  TALENT_KPI_ADMIN_BY_EVENT_LIST_PRESENTER_KEY,
  TALENT_KPI_ADMIN_BY_PLATFORM_LIST_PRESENTER_KEY,
  TALENT_KPI_ADMIN_BY_TALENT_LIST_PRESENTER_KEY,
  TALENT_KPI_ADMIN_DETAIL_PRESENTER_KEY,
  TALENT_KPI_ADMIN_LIST_PRESENTER_KEY,
  TALENT_KPI_ADMIN_METRIC_LIST_PRESENTER_KEY,
} from "@modules/talent-kpi/shared/talent-kpi.presenter-keys";
import {
  GetTalentKpiRecordDetailQuery,
  ListTalentKpiByEventQuery,
  ListTalentKpiByPlatformQuery,
  ListTalentKpiByTalentQuery,
  ListTalentKpiMetricValuesQuery,
  ListTalentKpiRecordsQuery,
} from "@modules/talent-kpi/shared/talent-kpi.contracts";
import { TalentKpiAdminQueryService } from "./admin.talent-kpi.query-service";

type TalentKpiQueryCommand =
  | "TALENT_KPI_RECORD_LIST"
  | "TALENT_KPI_RECORD_LIST_BY_TALENT"
  | "TALENT_KPI_RECORD_LIST_BY_PLATFORM"
  | "TALENT_KPI_RECORD_LIST_BY_EVENT"
  | "TALENT_KPI_RECORD_LIST_METRICS"
  | "TALENT_KPI_RECORD_GET_DETAIL";

const LIST_TALENT_KPI_RECORDS_QUERY_FIELDS: readonly string[] =
  Object.freeze([
    "status",
    "subjectTalentId",
    "attributionPlatformAccountId",
    "attributionEventId",
    "measurementSource",
    "containsMetricCode",
    "windowStartAt",
    "windowEndAt",
    "createdBeforeAt",
    "publishedFromAt",
    "publishedToAt",
    "limit",
    "cursor",
    "search",
    "sortBy",
    "sortDirection",
  ]);

const LIST_TALENT_KPI_BY_TALENT_QUERY_FIELDS: readonly string[] =
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

const LIST_TALENT_KPI_BY_PLATFORM_QUERY_FIELDS: readonly string[] =
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

const LIST_TALENT_KPI_BY_EVENT_QUERY_FIELDS: readonly string[] =
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

const LIST_TALENT_KPI_METRICS_QUERY_FIELDS: readonly string[] =
  Object.freeze([]);

const GET_TALENT_KPI_DETAIL_QUERY_FIELDS: readonly string[] =
  Object.freeze([]);

export class TalentKpiAdminQueryController extends SecureController {
  constructor(
    private readonly service: TalentKpiAdminQueryService,
  ) {
    super();
  }

  protected async handle(
    req: Request,
    actor: Actor,
    _context: ContextType,
  ): Promise<unknown> {
    const command =
      readCommand<TalentKpiQueryCommand>(req);

    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Talent KPI query command missing",
      );
    }

    switch (command) {
      case "TALENT_KPI_RECORD_LIST":
        return this.service.listTalentKpiRecords(
          actor,
          parseListTalentKpiRecordsQuery(req),
        );

      case "TALENT_KPI_RECORD_LIST_BY_TALENT":
        return this.service.listTalentKpiRecordsByTalent(
          actor,
          parseListTalentKpiByTalentQuery(req),
        );

      case "TALENT_KPI_RECORD_LIST_BY_PLATFORM":
        return this.service.listTalentKpiRecordsByPlatform(
          actor,
          parseListTalentKpiByPlatformQuery(req),
        );

      case "TALENT_KPI_RECORD_LIST_BY_EVENT":
        return this.service.listTalentKpiRecordsByEvent(
          actor,
          parseListTalentKpiByEventQuery(req),
        );

      case "TALENT_KPI_RECORD_LIST_METRICS":
        return this.service.listTalentKpiMetricValues(
          actor,
          parseListTalentKpiMetricValuesQuery(req),
        );

      case "TALENT_KPI_RECORD_GET_DETAIL":
        return this.service.getTalentKpiRecordDetail(
          actor,
          parseGetTalentKpiRecordDetailQuery(req),
        );

      default:
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          `Unsupported talent KPI query command: ${command}`,
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
      readCommand<TalentKpiQueryCommand>(req);

    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Talent KPI query command missing",
      );
    }

    const registry = getPresenterRegistryFromRequest(req);

    switch (command) {
      case "TALENT_KPI_RECORD_LIST":
        return registry
          .get<unknown, PresentationResult>(
            TALENT_KPI_ADMIN_LIST_PRESENTER_KEY,
          )
          .present(result, context);

      case "TALENT_KPI_RECORD_LIST_BY_TALENT":
        return registry
          .get<unknown, PresentationResult>(
            TALENT_KPI_ADMIN_BY_TALENT_LIST_PRESENTER_KEY,
          )
          .present(result, context);

      case "TALENT_KPI_RECORD_LIST_BY_PLATFORM":
        return registry
          .get<unknown, PresentationResult>(
            TALENT_KPI_ADMIN_BY_PLATFORM_LIST_PRESENTER_KEY,
          )
          .present(result, context);

      case "TALENT_KPI_RECORD_LIST_BY_EVENT":
        return registry
          .get<unknown, PresentationResult>(
            TALENT_KPI_ADMIN_BY_EVENT_LIST_PRESENTER_KEY,
          )
          .present(result, context);

      case "TALENT_KPI_RECORD_LIST_METRICS":
        return registry
          .get<unknown, PresentationResult>(
            TALENT_KPI_ADMIN_METRIC_LIST_PRESENTER_KEY,
          )
          .present(result, context);

      case "TALENT_KPI_RECORD_GET_DETAIL":
        return registry
          .get<unknown, PresentationResult>(
            TALENT_KPI_ADMIN_DETAIL_PRESENTER_KEY,
          )
          .present(result, context);

      default:
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          `Unsupported talent KPI query command: ${command}`,
        );
    }
  }
}

function parseListTalentKpiRecordsQuery(
  req: Request,
): ListTalentKpiRecordsQuery {
  assertNoUnexpectedQueryFields(
    req.query as Record<string, unknown>,
    LIST_TALENT_KPI_RECORDS_QUERY_FIELDS,
    "listTalentKpiRecords",
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
    measurementSource:
      req.query.measurementSource as
        | string
        | undefined,
    containsMetricCode:
      req.query.containsMetricCode as
        | string
        | undefined,
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
    publishedFromAt:
      req.query.publishedFromAt as
        | string
        | undefined,
    publishedToAt:
      req.query.publishedToAt as
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

function parseListTalentKpiByTalentQuery(
  req: Request,
): ListTalentKpiByTalentQuery {
  assertNoUnexpectedQueryFields(
    req.query as Record<string, unknown>,
    LIST_TALENT_KPI_BY_TALENT_QUERY_FIELDS,
    "listTalentKpiByTalent",
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

function parseListTalentKpiByPlatformQuery(
  req: Request,
): ListTalentKpiByPlatformQuery {
  assertNoUnexpectedQueryFields(
    req.query as Record<string, unknown>,
    LIST_TALENT_KPI_BY_PLATFORM_QUERY_FIELDS,
    "listTalentKpiByPlatform",
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

function parseListTalentKpiByEventQuery(
  req: Request,
): ListTalentKpiByEventQuery {
  assertNoUnexpectedQueryFields(
    req.query as Record<string, unknown>,
    LIST_TALENT_KPI_BY_EVENT_QUERY_FIELDS,
    "listTalentKpiByEvent",
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

function parseListTalentKpiMetricValuesQuery(
  req: Request,
): ListTalentKpiMetricValuesQuery {
  assertNoUnexpectedQueryFields(
    req.query as Record<string, unknown>,
    LIST_TALENT_KPI_METRICS_QUERY_FIELDS,
    "listTalentKpiMetricValues",
  );

  return {
    talentKpiRecordId: req.params.talentKpiRecordId,
  };
}

function parseGetTalentKpiRecordDetailQuery(
  req: Request,
): GetTalentKpiRecordDetailQuery {
  assertNoUnexpectedQueryFields(
    req.query as Record<string, unknown>,
    GET_TALENT_KPI_DETAIL_QUERY_FIELDS,
    "getTalentKpiRecordDetail",
  );

  return {
    talentKpiRecordId: req.params.talentKpiRecordId,
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

  throw new TalentKpiValidationError(
    `${queryName} query contains unsupported field(s): ${unexpectedFields.join(", ")}`,
  );
}
