import { Request } from "express";
import { readCommand } from "@app/base/command.middleware";
import {
  PresentationResult,
  toPlainObject,
} from "@app/base/presentation-result.types";
import { SecureController } from "@app/base/secure-controller.base";
import { Actor } from "@core/actor/actor";
import { ContextType } from "@core/context/context.types";
import { SystemInvariantError } from "@core/error/system-error";
import { WorkScheduleValidationError } from "../domain/work-schedule.errors";
import {
  WorkScheduleAvailabilityBatchView,
} from "../domain/work-schedule-availability.types";
import {
  DecideWorkScheduleAvailabilityLinesCommand,
  ListWorkScheduleAvailabilityBatchesResult,
} from "../shared/work-schedule-availability.contracts";
import {
  exposeAdminAvailabilityBatch,
  exposeAdminAvailabilityListItem,
} from "../shared/work-schedule-availability.exposure";
import { WorkScheduleAvailabilityBatchAdminService } from "./admin.work-schedule-availability-batch.service";

type AvailabilityCommand =
  | "WORK_SCHEDULE_AVAILABILITY_BATCH_LIST"
  | "WORK_SCHEDULE_AVAILABILITY_BATCH_GET_DETAIL"
  | "WORK_SCHEDULE_AVAILABILITY_BATCH_APPROVE_LINES"
  | "WORK_SCHEDULE_AVAILABILITY_BATCH_REJECT_LINES"
  | "WORK_SCHEDULE_AVAILABILITY_BATCH_CANCEL_LINES";

type AvailabilityResult =
  | WorkScheduleAvailabilityBatchView
  | ListWorkScheduleAvailabilityBatchesResult;

export class WorkScheduleAvailabilityBatchAdminController extends SecureController {
  constructor(
    private readonly service: WorkScheduleAvailabilityBatchAdminService,
  ) {
    super();
  }

  protected async handle(
    req: Request,
    actor: Actor,
    _context: ContextType,
  ): Promise<AvailabilityResult> {
    const command = readCommand<AvailabilityCommand>(req);
    if (command === "WORK_SCHEDULE_AVAILABILITY_BATCH_LIST") {
      return this.service.listAdminBatches(actor, {
        status: readQuery(req, "status"),
        periodMonth: readQuery(req, "periodMonth"),
        targetType: readQuery(req, "targetType"),
        targetOrgUnitId: readQuery(req, "targetOrgUnitId"),
        targetTalentGroupId: readQuery(req, "targetTalentGroupId"),
        submittedByEmploymentProfileId: readQuery(
          req,
          "submittedByEmploymentProfileId",
        ),
        limit: readQuery(req, "limit"),
        cursor: readQuery(req, "cursor"),
      });
    }
    if (command === "WORK_SCHEDULE_AVAILABILITY_BATCH_GET_DETAIL") {
      return this.service.getAdminBatchDetail(actor, {
        batchId: req.params.batchId,
      });
    }
    if (command === "WORK_SCHEDULE_AVAILABILITY_BATCH_APPROVE_LINES") {
      return this.service.approveAdminLines(
        actor,
        parseDecision(req, ["lineIds", "adminDecisionNote"]),
      );
    }
    if (command === "WORK_SCHEDULE_AVAILABILITY_BATCH_REJECT_LINES") {
      return this.service.rejectAdminLines(
        actor,
        parseDecision(req, [
          "lineIds",
          "adminDecisionNote",
          "rejectionReason",
        ]),
      );
    }
    if (command === "WORK_SCHEDULE_AVAILABILITY_BATCH_CANCEL_LINES") {
      return this.service.cancelAdminLines(
        actor,
        parseDecision(req, [
          "lineIds",
          "adminDecisionNote",
          "cancellationReason",
        ]),
      );
    }
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      "WorkSchedule availability command missing",
    );
  }

  protected async present(
    result: AvailabilityResult,
    req: Request,
    _actor: Actor,
    _context: ContextType,
  ): Promise<PresentationResult> {
    const command = readCommand<AvailabilityCommand>(req);
    if (command === "WORK_SCHEDULE_AVAILABILITY_BATCH_LIST") {
      const list = result as ListWorkScheduleAvailabilityBatchesResult;
      return {
        data: toPlainObject(
          {
            items: list.items.map(exposeAdminAvailabilityListItem),
            ...(list.nextCursor ? { nextCursor: list.nextCursor } : {}),
          },
          "workScheduleAvailabilityBatchAdminList",
        ),
      };
    }
    return {
      data: toPlainObject(
        exposeAdminAvailabilityBatch(
          result as WorkScheduleAvailabilityBatchView,
        ),
        "workScheduleAvailabilityBatchAdminDetail",
      ),
    };
  }
}

function parseDecision(
  req: Request,
  allowed: readonly string[],
): DecideWorkScheduleAvailabilityLinesCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(body, allowed);
  return {
    batchId: req.params.batchId,
    lineIds: body.lineIds as readonly string[],
    adminDecisionNote: body.adminDecisionNote as string | null | undefined,
    rejectionReason: body.rejectionReason as string | null | undefined,
    cancellationReason: body.cancellationReason as string | null | undefined,
  };
}

function readQuery(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
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
  allowed: readonly string[],
): void {
  const unexpected = Object.keys(body).filter(
    (field) => !allowed.includes(field),
  );
  if (unexpected.length > 0) {
    throw new WorkScheduleValidationError(
      `Availability decision contains unsupported field(s): ${unexpected.join(", ")}`,
    );
  }
}
