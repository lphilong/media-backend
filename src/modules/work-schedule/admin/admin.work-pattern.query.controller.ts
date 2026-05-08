import { Request } from "express";
import { readCommand } from "@app/base/command.middleware";
import { SecureController } from "@app/base/secure-controller.base";
import { PresentationResult } from "@app/base/presentation-result.types";
import { getPresenterRegistryFromRequest } from "@app/presenter/presenter.runtime-access";
import { Actor } from "@core/actor/actor";
import { ContextType } from "@core/context/context.types";
import { SystemInvariantError } from "@core/error/system-error";
import { WorkScheduleValidationError } from "@modules/work-schedule/domain/work-schedule.errors";
import {
  WORK_PATTERN_ADMIN_DETAIL_PRESENTER_KEY,
  WORK_PATTERN_ADMIN_LIST_PRESENTER_KEY,
} from "@modules/work-schedule/shared/work-schedule.presenter-keys";
import {
  GetWorkPatternDetailQuery,
  ListWorkPatternsQuery,
} from "@modules/work-schedule/shared/work-schedule.contracts";
import { WorkPatternAdminQueryService } from "./admin.work-pattern.query-service";

type WorkPatternQueryCommand =
  | "WORK_PATTERN_LIST"
  | "WORK_PATTERN_GET_DETAIL";

const LIST_WORK_PATTERNS_QUERY_FIELDS: readonly string[] =
  Object.freeze([
    "status",
    "limit",
    "cursor",
    "search",
  ]);

const GET_WORK_PATTERN_DETAIL_QUERY_FIELDS: readonly string[] =
  Object.freeze([]);

export class WorkPatternAdminQueryController extends SecureController {
  constructor(
    private readonly service: WorkPatternAdminQueryService,
  ) {
    super();
  }

  protected async handle(
    req: Request,
    actor: Actor,
    _context: ContextType,
  ): Promise<unknown> {
    const command =
      readCommand<WorkPatternQueryCommand>(req);

    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Work pattern query command missing",
      );
    }

    switch (command) {
      case "WORK_PATTERN_LIST":
        return this.service.listWorkPatterns(
          actor,
          parseListWorkPatternsQuery(req),
        );

      case "WORK_PATTERN_GET_DETAIL":
        return this.service.getWorkPatternDetail(
          actor,
          parseGetWorkPatternDetailQuery(req),
        );

      default:
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          `Unsupported work pattern query command: ${command}`,
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
      readCommand<WorkPatternQueryCommand>(req);

    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Work pattern query command missing",
      );
    }

    const registry = getPresenterRegistryFromRequest(req);

    switch (command) {
      case "WORK_PATTERN_LIST":
        return registry
          .get<unknown, PresentationResult>(
            WORK_PATTERN_ADMIN_LIST_PRESENTER_KEY,
          )
          .present(result, context);

      case "WORK_PATTERN_GET_DETAIL":
        return registry
          .get<unknown, PresentationResult>(
            WORK_PATTERN_ADMIN_DETAIL_PRESENTER_KEY,
          )
          .present(result, context);

      default:
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          `Unsupported work pattern query command: ${command}`,
        );
    }
  }
}

function parseListWorkPatternsQuery(
  req: Request,
): ListWorkPatternsQuery {
  assertNoUnexpectedQueryFields(
    req.query as Record<string, unknown>,
    LIST_WORK_PATTERNS_QUERY_FIELDS,
    "listWorkPatterns",
  );

  return {
    status: req.query.status as string | undefined,
    limit: req.query.limit as string | undefined,
    cursor: req.query.cursor as string | undefined,
    search: req.query.search as string | undefined,
  };
}

function parseGetWorkPatternDetailQuery(
  req: Request,
): GetWorkPatternDetailQuery {
  assertNoUnexpectedQueryFields(
    req.query as Record<string, unknown>,
    GET_WORK_PATTERN_DETAIL_QUERY_FIELDS,
    "getWorkPatternDetail",
  );

  return {
    workPatternId: req.params.workPatternId,
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

  throw new WorkScheduleValidationError(
    `${queryName} query contains unsupported field(s): ${unexpectedFields.join(", ")}`,
  );
}
