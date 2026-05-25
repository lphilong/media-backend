import { Request } from "express";
import { readCommand } from "@app/base/command.middleware";
import { SecureController } from "@app/base/secure-controller.base";
import { PresentationResult } from "@app/base/presentation-result.types";
import { getPresenterRegistryFromRequest } from "@app/presenter/presenter.runtime-access";
import { Actor } from "@core/actor/actor";
import { ContextType } from "@core/context/context.types";
import { SystemInvariantError } from "@core/error/system-error";
import { KpiValidationError } from "@modules/kpi/domain/kpi.errors";
import {
  GetKpiPlanDetailQuery,
  GetKpiActualDailyGridQuery,
  GetKpiProgressQuery,
  ListKpiActualCorrectionsQuery,
  GetMyKpiProgressQuery,
  ListKpiAllocationsQuery,
  ListKpiPlansQuery,
} from "@modules/kpi/shared/kpi.contracts";
import {
  KPI_ADMIN_ACTUAL_GRID_PRESENTER_KEY,
  KPI_ADMIN_ALLOCATION_LIST_PRESENTER_KEY,
  KPI_ADMIN_CORRECTION_LIST_PRESENTER_KEY,
  KPI_ADMIN_DETAIL_PRESENTER_KEY,
  KPI_ADMIN_LIST_PRESENTER_KEY,
  KPI_ADMIN_PROGRESS_PRESENTER_KEY,
} from "@modules/kpi/shared/kpi.presenter-keys";
import { KpiAdminService } from "./admin.kpi.service";

type KpiQueryCommand =
  | "KPI_PLAN_LIST"
  | "KPI_ALLOCATION_LIST"
  | "KPI_PLAN_GET_DETAIL"
  | "KPI_PLAN_ACTUAL_DAILY_GRID"
  | "KPI_ACTUAL_CORRECTION_LIST"
  | "KPI_PLAN_PROGRESS"
  | "KPI_MY_PROGRESS";

const LIST_KPI_PLANS_QUERY_FIELDS = [
  "subjectType",
  "subjectId",
  "groupId",
  "periodMonth",
  "status",
  "metricCode",
  "search",
  "limit",
  "sortBy",
  "sortDirection",
] as const;
const LIST_KPI_ALLOCATIONS_QUERY_FIELDS = [
  "status",
  "kpiPlanId",
  "groupId",
  "limit",
] as const;

const GET_KPI_PLAN_DETAIL_QUERY_FIELDS: readonly string[] = Object.freeze([]);
const GET_KPI_ACTUAL_DAILY_GRID_QUERY_FIELDS = ["actualDate"] as const;
const LIST_KPI_ACTUAL_CORRECTIONS_QUERY_FIELDS: readonly string[] =
  Object.freeze([]);
const GET_KPI_PLAN_PROGRESS_QUERY_FIELDS: readonly string[] = Object.freeze([]);
const GET_MY_KPI_PROGRESS_QUERY_FIELDS = ["planId"] as const;

export class KpiAdminQueryController extends SecureController {
  constructor(private readonly service: KpiAdminService) {
    super();
  }

  protected async handle(
    req: Request,
    actor: Actor,
    _context: ContextType,
  ): Promise<unknown> {
    const command = readCommand<KpiQueryCommand>(req);
    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "KPI query command missing",
      );
    }

    switch (command) {
      case "KPI_PLAN_LIST":
        return this.service.listKpiPlans(actor, parseListKpiPlansQuery(req));
      case "KPI_ALLOCATION_LIST":
        return this.service.listKpiAllocations(
          actor,
          parseListKpiAllocationsQuery(req),
        );
      case "KPI_PLAN_GET_DETAIL":
        return this.service.getKpiPlanDetail(
          actor,
          parseGetKpiPlanDetailQuery(req),
        );
      case "KPI_PLAN_ACTUAL_DAILY_GRID":
        return this.service.getKpiActualDailyGrid(
          actor,
          parseGetKpiActualDailyGridQuery(req),
        );
      case "KPI_ACTUAL_CORRECTION_LIST":
        return this.service.listKpiActualCorrections(
          actor,
          parseListKpiActualCorrectionsQuery(req),
        );
      case "KPI_PLAN_PROGRESS":
        return this.service.getKpiProgress(
          actor,
          parseGetKpiProgressQuery(req),
        );
      case "KPI_MY_PROGRESS":
        return this.service.getMyKpiProgress(
          actor,
          parseGetMyKpiProgressQuery(req),
        );
      default:
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          `Unsupported KPI query command: ${command}`,
        );
    }
  }

  protected async present(
    result: unknown,
    req: Request,
    _actor: Actor,
    context: ContextType,
  ): Promise<PresentationResult> {
    const command = readCommand<KpiQueryCommand>(req);
    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "KPI query command missing",
      );
    }
    const registry = getPresenterRegistryFromRequest(req);
    const key = resolvePresenterKey(command);
    return registry
      .get<unknown, PresentationResult>(key)
      .present(result, context);
  }
}

function resolvePresenterKey(command: KpiQueryCommand): string {
  if (command === "KPI_PLAN_LIST") {
    return KPI_ADMIN_LIST_PRESENTER_KEY;
  }
  if (command === "KPI_ALLOCATION_LIST") {
    return KPI_ADMIN_ALLOCATION_LIST_PRESENTER_KEY;
  }
  if (command === "KPI_PLAN_ACTUAL_DAILY_GRID") {
    return KPI_ADMIN_ACTUAL_GRID_PRESENTER_KEY;
  }
  if (command === "KPI_ACTUAL_CORRECTION_LIST") {
    return KPI_ADMIN_CORRECTION_LIST_PRESENTER_KEY;
  }
  if (command === "KPI_PLAN_PROGRESS" || command === "KPI_MY_PROGRESS") {
    return KPI_ADMIN_PROGRESS_PRESENTER_KEY;
  }
  return KPI_ADMIN_DETAIL_PRESENTER_KEY;
}

function parseListKpiPlansQuery(req: Request): ListKpiPlansQuery {
  assertNoUnexpectedFields(
    req.query as Record<string, unknown>,
    LIST_KPI_PLANS_QUERY_FIELDS,
    "listKpiPlans",
  );
  return {
    subjectType: req.query.subjectType as string | undefined,
    subjectId: req.query.subjectId as string | undefined,
    groupId: req.query.groupId as string | undefined,
    periodMonth: req.query.periodMonth as string | undefined,
    status: req.query.status as string | undefined,
    metricCode: req.query.metricCode as string | undefined,
    search: req.query.search as string | undefined,
    limit: req.query.limit as string | undefined,
    sortBy: req.query.sortBy as string | undefined,
    sortDirection: req.query.sortDirection as string | undefined,
  };
}

function parseListKpiAllocationsQuery(req: Request): ListKpiAllocationsQuery {
  assertNoUnexpectedFields(
    req.query as Record<string, unknown>,
    LIST_KPI_ALLOCATIONS_QUERY_FIELDS,
    "listKpiAllocations",
  );
  return {
    status: req.query.status as string | undefined,
    kpiPlanId: req.query.kpiPlanId as string | undefined,
    groupId: req.query.groupId as string | undefined,
    limit: req.query.limit as string | undefined,
  };
}

function parseGetKpiPlanDetailQuery(req: Request): GetKpiPlanDetailQuery {
  assertNoUnexpectedFields(
    req.query as Record<string, unknown>,
    GET_KPI_PLAN_DETAIL_QUERY_FIELDS,
    "getKpiPlanDetail",
  );
  return { kpiPlanId: req.params.kpiPlanId };
}

function parseGetKpiActualDailyGridQuery(
  req: Request,
): GetKpiActualDailyGridQuery {
  assertNoUnexpectedFields(
    req.query as Record<string, unknown>,
    GET_KPI_ACTUAL_DAILY_GRID_QUERY_FIELDS,
    "getKpiActualDailyGrid",
  );
  return {
    kpiPlanId: req.params.kpiPlanId,
    actualDate: req.query.actualDate as string | undefined,
  };
}

function parseListKpiActualCorrectionsQuery(
  req: Request,
): ListKpiActualCorrectionsQuery {
  assertNoUnexpectedFields(
    req.query as Record<string, unknown>,
    LIST_KPI_ACTUAL_CORRECTIONS_QUERY_FIELDS,
    "listKpiActualCorrections",
  );
  return {
    kpiPlanId: req.params.kpiPlanId,
    actualEntryId: req.params.actualEntryId,
  };
}

function parseGetKpiProgressQuery(req: Request): GetKpiProgressQuery {
  assertNoUnexpectedFields(
    req.query as Record<string, unknown>,
    GET_KPI_PLAN_PROGRESS_QUERY_FIELDS,
    "getKpiProgress",
  );
  return { kpiPlanId: req.params.kpiPlanId };
}

function parseGetMyKpiProgressQuery(req: Request): GetMyKpiProgressQuery {
  assertNoUnexpectedFields(
    req.query as Record<string, unknown>,
    GET_MY_KPI_PROGRESS_QUERY_FIELDS,
    "getMyKpiProgress",
  );
  return { kpiPlanId: req.query.planId as string };
}

function assertNoUnexpectedFields(
  query: Record<string, unknown>,
  allowedFields: readonly string[],
  operation: string,
): void {
  const unexpected = Object.keys(query).filter(
    (field) => !allowedFields.includes(field),
  );
  if (unexpected.length > 0) {
    throw new KpiValidationError(
      `${operation} query contains unsupported field(s): ${unexpected.join(", ")}`,
    );
  }
}
