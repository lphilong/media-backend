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
  WORK_SCHEDULE_REQUEST_BATCH_ADMIN_DETAIL_PRESENTER_KEY,
  WORK_SCHEDULE_REQUEST_BATCH_ADMIN_LIST_PRESENTER_KEY,
  WORK_SCHEDULE_REQUEST_BATCH_ADMIN_MUTATION_PRESENTER_KEY,
} from "@modules/work-schedule/shared/work-schedule.presenter-keys";
import {
  DecideWorkScheduleRequestBatchLinesCommand,
  GetWorkScheduleRequestBatchDetailQuery,
  ListWorkScheduleRequestBatchesQuery,
} from "@modules/work-schedule/shared/work-schedule.contracts";
import { WorkScheduleRequestBatchAdminService } from "./admin.work-schedule-request-batch.service";

type WorkScheduleRequestBatchCommand =
  | "WORK_SCHEDULE_REQUEST_BATCH_LIST"
  | "WORK_SCHEDULE_REQUEST_BATCH_GET_DETAIL"
  | "WORK_SCHEDULE_REQUEST_BATCH_APPROVE_LINES"
  | "WORK_SCHEDULE_REQUEST_BATCH_REJECT_LINES"
  | "WORK_SCHEDULE_REQUEST_BATCH_CANCEL_LINES";

const APPROVE_LINES_BODY_FIELDS = Object.freeze([
  "lineIds",
  "expectedRequestVersions",
  "expectedWorkShiftVersions",
  "expectedSourceGenerationRunIds",
  "idempotencyKey",
  "emergencyOverrideReason",
  "approvalNote",
]);
const REJECT_LINES_BODY_FIELDS = Object.freeze(["lineIds", "rejectionReason"]);
const CANCEL_LINES_BODY_FIELDS = Object.freeze([
  "lineIds",
  "cancellationReason",
]);

export class WorkScheduleRequestBatchAdminController extends SecureController {
  constructor(private readonly service: WorkScheduleRequestBatchAdminService) {
    super();
  }

  protected async handle(
    req: Request,
    actor: Actor,
    _context: ContextType,
  ): Promise<unknown> {
    const command = readCommand<WorkScheduleRequestBatchCommand>(req);

    switch (command) {
      case "WORK_SCHEDULE_REQUEST_BATCH_LIST":
        return this.service.listAdminBatches(actor, parseListQuery(req));
      case "WORK_SCHEDULE_REQUEST_BATCH_GET_DETAIL":
        return this.service.getAdminBatchDetail(actor, parseDetailQuery(req));
      case "WORK_SCHEDULE_REQUEST_BATCH_APPROVE_LINES":
        return this.service.approveAdminLines(
          actor,
          parseApproveLinesCommand(req),
        );
      case "WORK_SCHEDULE_REQUEST_BATCH_REJECT_LINES":
        return this.service.rejectAdminLines(
          actor,
          parseRejectLinesCommand(req),
        );
      case "WORK_SCHEDULE_REQUEST_BATCH_CANCEL_LINES":
        return this.service.cancelAdminLines(
          actor,
          parseCancelLinesCommand(req),
        );
      default:
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          "Work schedule request batch command missing",
        );
    }
  }

  protected async present(
    result: unknown,
    req: Request,
    _actor: Actor,
    context: ContextType,
  ): Promise<PresentationResult> {
    const command = readCommand<WorkScheduleRequestBatchCommand>(req);
    const presenterKey =
      command === "WORK_SCHEDULE_REQUEST_BATCH_LIST"
        ? WORK_SCHEDULE_REQUEST_BATCH_ADMIN_LIST_PRESENTER_KEY
        : command === "WORK_SCHEDULE_REQUEST_BATCH_GET_DETAIL"
          ? WORK_SCHEDULE_REQUEST_BATCH_ADMIN_DETAIL_PRESENTER_KEY
          : WORK_SCHEDULE_REQUEST_BATCH_ADMIN_MUTATION_PRESENTER_KEY;

    return getPresenterRegistryFromRequest(req)
      .get<unknown, PresentationResult>(presenterKey)
      .present(result, context);
  }
}

function parseListQuery(req: Request): ListWorkScheduleRequestBatchesQuery {
  return {
    status: req.query.status as string | undefined,
    periodMonth: req.query.periodMonth as string | undefined,
    submittedByEmploymentProfileId: req.query.submittedByEmploymentProfileId as
      string | undefined,
    limit: req.query.limit as string | undefined,
    cursor: req.query.cursor as string | undefined,
  };
}

function parseDetailQuery(
  req: Request,
): GetWorkScheduleRequestBatchDetailQuery {
  return { batchId: req.params.batchId };
}

function parseApproveLinesCommand(
  req: Request,
): DecideWorkScheduleRequestBatchLinesCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    APPROVE_LINES_BODY_FIELDS,
    "approveWorkScheduleRequestBatchLines",
  );
  return {
    batchId: req.params.batchId,
    lineIds: body.lineIds as readonly string[],
    expectedRequestVersions: body.expectedRequestVersions as Readonly<
      Record<string, number>
    >,
    expectedWorkShiftVersions: body.expectedWorkShiftVersions as Readonly<
      Record<string, number | null>
    >,
    expectedSourceGenerationRunIds:
      body.expectedSourceGenerationRunIds as Readonly<
        Record<string, string | null>
      >,
    idempotencyKey: body.idempotencyKey as string,
    emergencyOverrideReason: body.emergencyOverrideReason as
      string | null | undefined,
    approvalNote: body.approvalNote as string | null | undefined,
  };
}

function parseRejectLinesCommand(
  req: Request,
): DecideWorkScheduleRequestBatchLinesCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    REJECT_LINES_BODY_FIELDS,
    "rejectWorkScheduleRequestBatchLines",
  );
  return {
    batchId: req.params.batchId,
    lineIds: body.lineIds as readonly string[],
    expectedRequestVersions: {},
    idempotencyKey: "not-applicable-reject",
    rejectionReason: body.rejectionReason as string,
  };
}

function parseCancelLinesCommand(
  req: Request,
): DecideWorkScheduleRequestBatchLinesCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    CANCEL_LINES_BODY_FIELDS,
    "cancelWorkScheduleRequestBatchLines",
  );
  return {
    batchId: req.params.batchId,
    lineIds: body.lineIds as readonly string[],
    expectedRequestVersions: {},
    idempotencyKey: "not-applicable-cancel",
    cancellationReason: body.cancellationReason as string,
  };
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (value === undefined) {
    return {};
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new WorkScheduleValidationError(
      "Request body must be a plain object",
    );
  }
  return value as Record<string, unknown>;
}

function assertNoUnexpectedFields(
  body: Record<string, unknown>,
  allowedFields: readonly string[],
  mutationName: string,
): void {
  const unexpectedFields = Object.keys(body).filter(
    (field) => !allowedFields.includes(field),
  );
  if (unexpectedFields.length === 0) {
    return;
  }
  throw new WorkScheduleValidationError(
    `${mutationName} payload contains unsupported field(s): ${unexpectedFields.join(", ")}`,
  );
}
