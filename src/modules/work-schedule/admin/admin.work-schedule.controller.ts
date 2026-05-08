import { Request } from "express";
import { readCommand } from "@app/base/command.middleware";
import { SecureController } from "@app/base/secure-controller.base";
import { PresentationResult } from "@app/base/presentation-result.types";
import { getPresenterRegistryFromRequest } from "@app/presenter/presenter.runtime-access";
import { Actor } from "@core/actor/actor";
import { ContextType } from "@core/context/context.types";
import { SystemInvariantError } from "@core/error/system-error";
import { WorkScheduleValidationError } from "@modules/work-schedule/domain/work-schedule.errors";
import { WORK_SCHEDULE_ADMIN_MUTATION_PRESENTER_KEY } from "@modules/work-schedule/shared/work-schedule.presenter-keys";
import {
  ArchiveWorkShiftCommand,
  CancelWorkShiftCommand,
  CreateWorkShiftCommand,
  ReassignWorkShiftSubjectCommand,
  RescheduleWorkShiftCommand,
  UpdateWorkShiftCoreCommand,
  UpdateWorkShiftResourcesCommand,
} from "@modules/work-schedule/shared/work-schedule.contracts";
import { WorkScheduleAdminService } from "./admin.work-schedule.service";

type WorkScheduleMutationCommand =
  | "WORK_SHIFT_CREATE"
  | "WORK_SHIFT_UPDATE_CORE"
  | "WORK_SHIFT_RESCHEDULE"
  | "WORK_SHIFT_REASSIGN_SUBJECT"
  | "WORK_SHIFT_UPDATE_RESOURCES"
  | "WORK_SHIFT_CANCEL"
  | "WORK_SHIFT_ARCHIVE";

const CREATE_WORK_SHIFT_BODY_FIELDS: readonly string[] =
  Object.freeze([
    "shiftCode",
    "title",
    "subjectKind",
    "subjectEmploymentProfileId",
    "subjectTalentId",
    "subjectTalentGroupId",
    "studioResourceIds",
    "shiftStartAt",
    "shiftEndAt",
    "description",
    "externalRef",
  ]);

const UPDATE_WORK_SHIFT_CORE_BODY_FIELDS: readonly string[] =
  Object.freeze([
    "title",
    "description",
    "externalRef",
  ]);

const RESCHEDULE_WORK_SHIFT_BODY_FIELDS: readonly string[] =
  Object.freeze([
    "newShiftStartAt",
    "newShiftEndAt",
  ]);

const REASSIGN_WORK_SHIFT_SUBJECT_BODY_FIELDS: readonly string[] =
  Object.freeze([
    "newSubjectKind",
    "newSubjectEmploymentProfileId",
    "newSubjectTalentId",
    "newSubjectTalentGroupId",
  ]);

const UPDATE_WORK_SHIFT_RESOURCES_BODY_FIELDS: readonly string[] =
  Object.freeze(["newStudioResourceIds"]);

export class WorkScheduleAdminController extends SecureController {
  constructor(
    private readonly service: WorkScheduleAdminService,
  ) {
    super();
  }

  protected async handle(
    req: Request,
    actor: Actor,
    _context: ContextType,
  ): Promise<unknown> {
    const command =
      readCommand<WorkScheduleMutationCommand>(req);

    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Work schedule mutation command missing",
      );
    }

    switch (command) {
      case "WORK_SHIFT_CREATE":
        return this.service.createWorkShift(
          actor,
          parseCreateWorkShiftCommand(req),
        );

      case "WORK_SHIFT_UPDATE_CORE":
        return this.service.updateWorkShiftCore(
          actor,
          parseUpdateWorkShiftCoreCommand(req),
        );

      case "WORK_SHIFT_RESCHEDULE":
        return this.service.rescheduleWorkShift(
          actor,
          parseRescheduleWorkShiftCommand(req),
        );

      case "WORK_SHIFT_REASSIGN_SUBJECT":
        return this.service.reassignWorkShiftSubject(
          actor,
          parseReassignWorkShiftSubjectCommand(req),
        );

      case "WORK_SHIFT_UPDATE_RESOURCES":
        return this.service.updateWorkShiftResources(
          actor,
          parseUpdateWorkShiftResourcesCommand(req),
        );

      case "WORK_SHIFT_CANCEL":
        return this.service.cancelWorkShift(
          actor,
          parseCancelWorkShiftCommand(req),
        );

      case "WORK_SHIFT_ARCHIVE":
        return this.service.archiveWorkShift(
          actor,
          parseArchiveWorkShiftCommand(req),
        );

      default:
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          `Unsupported work schedule mutation command: ${command}`,
        );
    }
  }

  protected async present(
    result: unknown,
    req: Request,
    _actor: Actor,
    context: ContextType,
  ): Promise<PresentationResult> {
    return getPresenterRegistryFromRequest(req)
      .get<unknown, PresentationResult>(
        WORK_SCHEDULE_ADMIN_MUTATION_PRESENTER_KEY,
      )
      .present(result, context);
  }
}

function parseCreateWorkShiftCommand(
  req: Request,
): CreateWorkShiftCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    CREATE_WORK_SHIFT_BODY_FIELDS,
    "createWorkShift",
  );

  return {
    shiftCode: body.shiftCode as string,
    title: body.title as string,
    subjectKind: body.subjectKind as string,
    subjectEmploymentProfileId:
      body.subjectEmploymentProfileId as
        | string
        | null
        | undefined,
    subjectTalentId:
      body.subjectTalentId as
        | string
        | null
        | undefined,
    subjectTalentGroupId:
      body.subjectTalentGroupId as
        | string
        | null
        | undefined,
    studioResourceIds:
      body.studioResourceIds as
        | readonly string[]
        | undefined,
    shiftStartAt: body.shiftStartAt as number,
    shiftEndAt: body.shiftEndAt as number,
    description:
      body.description as
        | string
        | null
        | undefined,
    externalRef:
      body.externalRef as
        | string
        | null
        | undefined,
    scope: readRequestedScope(req),
  };
}

function parseUpdateWorkShiftCoreCommand(
  req: Request,
): UpdateWorkShiftCoreCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    UPDATE_WORK_SHIFT_CORE_BODY_FIELDS,
    "updateWorkShiftCore",
  );

  return {
    workShiftId: req.params.workShiftId,
    title: body.title as string | undefined,
    description:
      body.description as
        | string
        | null
        | undefined,
    externalRef:
      body.externalRef as
        | string
        | null
        | undefined,
    scope: readRequestedScope(req),
  };
}

function parseRescheduleWorkShiftCommand(
  req: Request,
): RescheduleWorkShiftCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    RESCHEDULE_WORK_SHIFT_BODY_FIELDS,
    "rescheduleWorkShift",
  );

  return {
    workShiftId: req.params.workShiftId,
    newShiftStartAt: body.newShiftStartAt as number,
    newShiftEndAt: body.newShiftEndAt as number,
    scope: readRequestedScope(req),
  };
}

function parseReassignWorkShiftSubjectCommand(
  req: Request,
): ReassignWorkShiftSubjectCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    REASSIGN_WORK_SHIFT_SUBJECT_BODY_FIELDS,
    "reassignWorkShiftSubject",
  );

  return {
    workShiftId: req.params.workShiftId,
    newSubjectKind: body.newSubjectKind as string,
    newSubjectEmploymentProfileId:
      body.newSubjectEmploymentProfileId as
        | string
        | null
        | undefined,
    newSubjectTalentId:
      body.newSubjectTalentId as
        | string
        | null
        | undefined,
    newSubjectTalentGroupId:
      body.newSubjectTalentGroupId as
        | string
        | null
        | undefined,
    scope: readRequestedScope(req),
  };
}

function parseUpdateWorkShiftResourcesCommand(
  req: Request,
): UpdateWorkShiftResourcesCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    UPDATE_WORK_SHIFT_RESOURCES_BODY_FIELDS,
    "updateWorkShiftResources",
  );

  return {
    workShiftId: req.params.workShiftId,
    newStudioResourceIds:
      body.newStudioResourceIds as readonly string[],
    scope: readRequestedScope(req),
  };
}

function parseCancelWorkShiftCommand(
  req: Request,
): CancelWorkShiftCommand {
  assertNoUnexpectedFields(
    requireRecord(req.body),
    [],
    "cancelWorkShift",
  );

  return {
    workShiftId: req.params.workShiftId,
    scope: readRequestedScope(req),
  };
}

function parseArchiveWorkShiftCommand(
  req: Request,
): ArchiveWorkShiftCommand {
  assertNoUnexpectedFields(
    requireRecord(req.body),
    [],
    "archiveWorkShift",
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
