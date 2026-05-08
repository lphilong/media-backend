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
  WORK_SCHEDULE_ADMIN_BY_RESOURCE_LIST_PRESENTER_KEY,
  WORK_SCHEDULE_ADMIN_BY_SUBJECT_LIST_PRESENTER_KEY,
  WORK_SCHEDULE_ADMIN_DETAIL_PRESENTER_KEY,
  WORK_SCHEDULE_ADMIN_LIST_PRESENTER_KEY,
} from "@modules/work-schedule/shared/work-schedule.presenter-keys";
import {
  GetWorkShiftDetailQuery,
  ListWorkShiftsByResourceQuery,
  ListWorkShiftsBySubjectQuery,
  ListWorkShiftsQuery,
} from "@modules/work-schedule/shared/work-schedule.contracts";
import { WorkScheduleAdminQueryService } from "./admin.work-schedule.query-service";

type WorkScheduleQueryCommand =
  | "WORK_SHIFT_LIST"
  | "WORK_SHIFT_LIST_BY_SUBJECT"
  | "WORK_SHIFT_LIST_BY_RESOURCE"
  | "WORK_SHIFT_GET_DETAIL";

const LIST_WORK_SHIFTS_QUERY_FIELDS: readonly string[] =
  Object.freeze([
    "status",
    "subjectKind",
    "subjectEmploymentProfileId",
    "subjectTalentId",
    "subjectTalentGroupId",
    "containsStudioResourceId",
    "sourceType",
    "sourceRosterId",
    "sourceDepartmentOrgUnitId",
    "sourceRosterMonth",
    "windowStartAt",
    "windowEndAt",
    "limit",
    "cursor",
    "search",
    "sortBy",
    "sortDirection",
    "scope",
  ]);

const LIST_WORK_SHIFTS_BY_SUBJECT_QUERY_FIELDS: readonly string[] =
  Object.freeze([
    "subjectKind",
    "subjectEmploymentProfileId",
    "subjectTalentId",
    "subjectTalentGroupId",
    "status",
    "windowStartAt",
    "windowEndAt",
    "limit",
    "cursor",
    "sortBy",
    "sortDirection",
    "scope",
  ]);

const LIST_WORK_SHIFTS_BY_RESOURCE_QUERY_FIELDS: readonly string[] =
  Object.freeze([
    "studioResourceId",
    "status",
    "windowStartAt",
    "windowEndAt",
    "limit",
    "cursor",
    "sortBy",
    "sortDirection",
    "scope",
  ]);

const GET_WORK_SHIFT_DETAIL_QUERY_FIELDS: readonly string[] =
  Object.freeze(["scope"]);

export class WorkScheduleAdminQueryController extends SecureController {
  constructor(
    private readonly service: WorkScheduleAdminQueryService,
  ) {
    super();
  }

  protected async handle(
    req: Request,
    actor: Actor,
    _context: ContextType,
  ): Promise<unknown> {
    const command =
      readCommand<WorkScheduleQueryCommand>(req);

    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Work schedule query command missing",
      );
    }

    switch (command) {
      case "WORK_SHIFT_LIST":
        return this.service.listWorkShifts(
          actor,
          parseListWorkShiftsQuery(req),
        );

      case "WORK_SHIFT_LIST_BY_SUBJECT":
        return this.service.listWorkShiftsBySubject(
          actor,
          parseListWorkShiftsBySubjectQuery(req),
        );

      case "WORK_SHIFT_LIST_BY_RESOURCE":
        return this.service.listWorkShiftsByResource(
          actor,
          parseListWorkShiftsByResourceQuery(req),
        );

      case "WORK_SHIFT_GET_DETAIL":
        return this.service.getWorkShiftDetail(
          actor,
          parseGetWorkShiftDetailQuery(req),
        );

      default:
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          `Unsupported work schedule query command: ${command}`,
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
      readCommand<WorkScheduleQueryCommand>(req);

    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Work schedule query command missing",
      );
    }

    const registry = getPresenterRegistryFromRequest(req);

    switch (command) {
      case "WORK_SHIFT_LIST":
        return registry
          .get<unknown, PresentationResult>(
            WORK_SCHEDULE_ADMIN_LIST_PRESENTER_KEY,
          )
          .present(result, context);

      case "WORK_SHIFT_LIST_BY_SUBJECT":
        return registry
          .get<unknown, PresentationResult>(
            WORK_SCHEDULE_ADMIN_BY_SUBJECT_LIST_PRESENTER_KEY,
          )
          .present(result, context);

      case "WORK_SHIFT_LIST_BY_RESOURCE":
        return registry
          .get<unknown, PresentationResult>(
            WORK_SCHEDULE_ADMIN_BY_RESOURCE_LIST_PRESENTER_KEY,
          )
          .present(result, context);

      case "WORK_SHIFT_GET_DETAIL":
        return registry
          .get<unknown, PresentationResult>(
            WORK_SCHEDULE_ADMIN_DETAIL_PRESENTER_KEY,
          )
          .present(result, context);

      default:
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          `Unsupported work schedule query command: ${command}`,
        );
    }
  }
}

function parseListWorkShiftsQuery(
  req: Request,
): ListWorkShiftsQuery {
  assertNoUnexpectedQueryFields(
    req.query as Record<string, unknown>,
    LIST_WORK_SHIFTS_QUERY_FIELDS,
    "listWorkShifts",
  );

  return {
    status: req.query.status as string | undefined,
    subjectKind:
      req.query.subjectKind as string | undefined,
    subjectEmploymentProfileId:
      req.query.subjectEmploymentProfileId as
        | string
        | undefined,
    subjectTalentId:
      req.query.subjectTalentId as string | undefined,
    subjectTalentGroupId:
      req.query.subjectTalentGroupId as
        | string
        | undefined,
    containsStudioResourceId:
      req.query.containsStudioResourceId as
        | string
        | undefined,
    sourceType:
      req.query.sourceType as string | undefined,
    sourceRosterId:
      req.query.sourceRosterId as
        | string
        | undefined,
    sourceDepartmentOrgUnitId:
      req.query.sourceDepartmentOrgUnitId as
        | string
        | undefined,
    sourceRosterMonth:
      req.query.sourceRosterMonth as
        | string
        | undefined,
    windowStartAt:
      req.query.windowStartAt as
        | string
        | undefined,
    windowEndAt: req.query.windowEndAt as
      | string
      | undefined,
    limit: req.query.limit as string | undefined,
    cursor: req.query.cursor as string | undefined,
    search: req.query.search as string | undefined,
    sortBy: req.query.sortBy as string | undefined,
    sortDirection:
      req.query.sortDirection as string | undefined,
    scope: readRequestedScope(req),
  };
}

function parseListWorkShiftsBySubjectQuery(
  req: Request,
): ListWorkShiftsBySubjectQuery {
  assertNoUnexpectedQueryFields(
    req.query as Record<string, unknown>,
    LIST_WORK_SHIFTS_BY_SUBJECT_QUERY_FIELDS,
    "listWorkShiftsBySubject",
  );

  return {
    subjectKind: req.query.subjectKind as string,
    subjectEmploymentProfileId:
      req.query.subjectEmploymentProfileId as
        | string
        | undefined,
    subjectTalentId:
      req.query.subjectTalentId as string | undefined,
    subjectTalentGroupId:
      req.query.subjectTalentGroupId as
        | string
        | undefined,
    status: req.query.status as string | undefined,
    windowStartAt:
      req.query.windowStartAt as
        | string
        | undefined,
    windowEndAt: req.query.windowEndAt as
      | string
      | undefined,
    limit: req.query.limit as string | undefined,
    cursor: req.query.cursor as string | undefined,
    sortBy: req.query.sortBy as string | undefined,
    sortDirection:
      req.query.sortDirection as string | undefined,
    scope: readRequestedScope(req),
  };
}

function parseListWorkShiftsByResourceQuery(
  req: Request,
): ListWorkShiftsByResourceQuery {
  assertNoUnexpectedQueryFields(
    req.query as Record<string, unknown>,
    LIST_WORK_SHIFTS_BY_RESOURCE_QUERY_FIELDS,
    "listWorkShiftsByResource",
  );

  return {
    studioResourceId:
      req.query.studioResourceId as string,
    status: req.query.status as string | undefined,
    windowStartAt:
      req.query.windowStartAt as
        | string
        | undefined,
    windowEndAt: req.query.windowEndAt as
      | string
      | undefined,
    limit: req.query.limit as string | undefined,
    cursor: req.query.cursor as string | undefined,
    sortBy: req.query.sortBy as string | undefined,
    sortDirection:
      req.query.sortDirection as string | undefined,
    scope: readRequestedScope(req),
  };
}

function parseGetWorkShiftDetailQuery(
  req: Request,
): GetWorkShiftDetailQuery {
  assertNoUnexpectedQueryFields(
    req.query as Record<string, unknown>,
    GET_WORK_SHIFT_DETAIL_QUERY_FIELDS,
    "getWorkShiftDetail",
  );

  return {
    workShiftId: req.params.workShiftId,
    scope: readRequestedScope(req),
  };
}

function readRequestedScope(
  req: Request,
): string | undefined {
  return req.query.scope as string | undefined;
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
