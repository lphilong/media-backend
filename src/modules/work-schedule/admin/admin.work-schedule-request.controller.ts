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
  WORK_SCHEDULE_REQUEST_ADMIN_DETAIL_PRESENTER_KEY,
  WORK_SCHEDULE_REQUEST_ADMIN_LIST_PRESENTER_KEY,
  WORK_SCHEDULE_REQUEST_ADMIN_MUTATION_PRESENTER_KEY,
} from "@modules/work-schedule/shared/work-schedule.presenter-keys";
import {
  ApproveWorkScheduleRequestCommand,
  CancelWorkScheduleRequestCommand,
  CreateWorkScheduleRequestCommand,
  GetWorkScheduleRequestDetailQuery,
  ListWorkScheduleRequestsQuery,
  RejectWorkScheduleRequestCommand,
} from "@modules/work-schedule/shared/work-schedule.contracts";
import { WorkScheduleRequestAdminService } from "./admin.work-schedule-request.service";

type WorkScheduleRequestCommand =
  | "WORK_SCHEDULE_REQUEST_LIST"
  | "WORK_SCHEDULE_REQUEST_GET_DETAIL"
  | "WORK_SCHEDULE_REQUEST_CREATE"
  | "WORK_SCHEDULE_REQUEST_CANCEL"
  | "WORK_SCHEDULE_REQUEST_APPROVE"
  | "WORK_SCHEDULE_REQUEST_REJECT";

const CREATE_REQUEST_BODY_FIELDS: readonly string[] =
  Object.freeze([
    "requestType",
    "targetEmploymentProfileId",
    "targetWorkShiftId",
    "reason",
    "proposedStartAt",
    "proposedEndAt",
    "proposedTitle",
    "proposedStudioResourceIds",
    "proposedDescription",
    "proposedExternalRef",
  ]);

const APPROVE_REQUEST_BODY_FIELDS: readonly string[] =
  Object.freeze(["approvalNote"]);

const REJECT_REQUEST_BODY_FIELDS: readonly string[] =
  Object.freeze(["rejectionReason"]);

const CANCEL_REQUEST_BODY_FIELDS: readonly string[] =
  Object.freeze(["cancellationReason"]);

export class WorkScheduleRequestAdminController extends SecureController {
  constructor(
    private readonly service: WorkScheduleRequestAdminService,
  ) {
    super();
  }

  protected async handle(
    req: Request,
    actor: Actor,
    _context: ContextType,
  ): Promise<unknown> {
    const command =
      readCommand<WorkScheduleRequestCommand>(req);

    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Work schedule request command missing",
      );
    }

    switch (command) {
      case "WORK_SCHEDULE_REQUEST_LIST":
        return this.service.listRequests(
          actor,
          parseListQuery(req),
        );

      case "WORK_SCHEDULE_REQUEST_GET_DETAIL":
        return this.service.getRequestDetail(
          actor,
          parseDetailQuery(req),
        );

      case "WORK_SCHEDULE_REQUEST_CREATE":
        return this.service.createRequest(
          actor,
          parseCreateRequestCommand(req),
        );

      case "WORK_SCHEDULE_REQUEST_CANCEL":
        return this.service.cancelRequest(
          actor,
          parseCancelRequestCommand(req),
        );

      case "WORK_SCHEDULE_REQUEST_APPROVE":
        return this.service.approveRequest(
          actor,
          parseApproveRequestCommand(req),
        );

      case "WORK_SCHEDULE_REQUEST_REJECT":
        return this.service.rejectRequest(
          actor,
          parseRejectRequestCommand(req),
        );

      default:
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          `Unsupported work schedule request command: ${command}`,
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
      readCommand<WorkScheduleRequestCommand>(req);
    const presenterKey =
      command === "WORK_SCHEDULE_REQUEST_LIST"
        ? WORK_SCHEDULE_REQUEST_ADMIN_LIST_PRESENTER_KEY
        : command === "WORK_SCHEDULE_REQUEST_GET_DETAIL"
          ? WORK_SCHEDULE_REQUEST_ADMIN_DETAIL_PRESENTER_KEY
          : WORK_SCHEDULE_REQUEST_ADMIN_MUTATION_PRESENTER_KEY;

    return getPresenterRegistryFromRequest(req)
      .get<unknown, PresentationResult>(presenterKey)
      .present(result, context);
  }
}

function parseListQuery(
  req: Request,
): ListWorkScheduleRequestsQuery {
  return {
    status: req.query.status as string | undefined,
    requestType:
      req.query.requestType as string | undefined,
    targetEmploymentProfileId:
      req.query.targetEmploymentProfileId as
        | string
        | undefined,
    targetWorkShiftId:
      req.query.targetWorkShiftId as
        | string
        | undefined,
    requestedByUserId:
      req.query.requestedByUserId as
        | string
        | undefined,
    limit: req.query.limit as string | undefined,
    cursor: req.query.cursor as string | undefined,
  };
}

function parseDetailQuery(
  req: Request,
): GetWorkScheduleRequestDetailQuery {
  return {
    requestId: req.params.requestId,
  };
}

function parseCreateRequestCommand(
  req: Request,
): CreateWorkScheduleRequestCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    CREATE_REQUEST_BODY_FIELDS,
    "createWorkScheduleRequest",
  );

  return {
    requestType: body.requestType as string,
    targetEmploymentProfileId:
      body.targetEmploymentProfileId as string,
    targetWorkShiftId:
      body.targetWorkShiftId as
        | string
        | null
        | undefined,
    reason: body.reason as string,
    proposedStartAt:
      body.proposedStartAt as number | null | undefined,
    proposedEndAt:
      body.proposedEndAt as number | null | undefined,
    proposedTitle:
      body.proposedTitle as
        | string
        | null
        | undefined,
    proposedStudioResourceIds:
      body.proposedStudioResourceIds as
        | readonly string[]
        | undefined,
    proposedDescription:
      body.proposedDescription as
        | string
        | null
        | undefined,
    proposedExternalRef:
      body.proposedExternalRef as
        | string
        | null
        | undefined,
  };
}

function parseApproveRequestCommand(
  req: Request,
): ApproveWorkScheduleRequestCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    APPROVE_REQUEST_BODY_FIELDS,
    "approveWorkScheduleRequest",
  );

  return {
    requestId: req.params.requestId,
    approvalNote:
      body.approvalNote as
        | string
        | null
        | undefined,
  };
}

function parseRejectRequestCommand(
  req: Request,
): RejectWorkScheduleRequestCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    REJECT_REQUEST_BODY_FIELDS,
    "rejectWorkScheduleRequest",
  );

  return {
    requestId: req.params.requestId,
    rejectionReason:
      body.rejectionReason as string,
  };
}

function parseCancelRequestCommand(
  req: Request,
): CancelWorkScheduleRequestCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    CANCEL_REQUEST_BODY_FIELDS,
    "cancelWorkScheduleRequest",
  );

  return {
    requestId: req.params.requestId,
    cancellationReason:
      body.cancellationReason as
        | string
        | null
        | undefined,
  };
}

function requireRecord(
  value: unknown,
): Record<string, unknown> {
  if (value === undefined) {
    return {};
  }

  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
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
