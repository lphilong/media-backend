import { Request } from "express";
import { readCommand } from "@app/base/command.middleware";
import { SecureController } from "@app/base/secure-controller.base";
import {
  PresentationResult,
  toPlainObject,
} from "@app/base/presentation-result.types";
import { Actor } from "@core/actor/actor";
import { ContextType } from "@core/context/context.types";
import { SystemInvariantError } from "@core/error/system-error";
import {
  ManagerWorkspaceAdminService,
  ManagerWorkspaceContextView,
} from "./admin.manager-workspace.service";
import {
  ManagedGroupListView,
  ManagedGroupView,
  ManagedMemberListView,
  ManagedMemberView,
  ManagerWorkspaceGroupAdminService,
} from "./admin.manager-workspace-group.service";
import {
  ManagerWorkspaceWorkScheduleAdminService,
  ManagerWorkShiftListView,
  ManagerWeeklyScheduleView,
} from "./admin.manager-workspace-work-schedule.service";
import { WorkScheduleValidationError } from "@modules/work-schedule/domain/work-schedule.errors";
import {
  WorkScheduleRequestBatchView,
  WorkScheduleRequestBatchListItemView,
} from "@modules/work-schedule/domain/work-schedule.types";
import {
  ListWorkScheduleRequestBatchesResult,
  SubmitWorkScheduleRequestBatchCommand,
} from "@modules/work-schedule/shared/work-schedule.contracts";
import { WorkScheduleRequestBatchAdminService } from "@modules/work-schedule/admin/admin.work-schedule-request-batch.service";
import {
  ManagerAvailabilityTargetMembersView,
  WorkScheduleAvailabilityBatchAdminService,
} from "@modules/work-schedule/admin/admin.work-schedule-availability-batch.service";
import { WorkScheduleAvailabilityBatchView } from "@modules/work-schedule/domain/work-schedule-availability.types";
import {
  ListWorkScheduleAvailabilityBatchesResult,
  SubmitWorkScheduleAvailabilityBatchCommand,
} from "@modules/work-schedule/shared/work-schedule-availability.contracts";
import {
  exposeManagerAvailabilityBatch,
  exposeManagerAvailabilityListItem,
} from "@modules/work-schedule/shared/work-schedule-availability.exposure";
import { ManagerEventSummaryView } from "@modules/event-assignment/domain/event-assignment.types";
import { ManagerWorkspaceEventAdminService } from "./admin.manager-workspace-event.service";
import {
  ManagerPlatformEarningBatchListResult,
  ManagerPlatformEarningBatchView,
  ManagerPlatformEarningLineListResult,
  ManagerPlatformEarningLineView,
  ManagerPlatformEarningScopeView,
  ManagerWorkspaceRevenueAdminService,
} from "./admin.manager-workspace-revenue.service";

type ManagerWorkspaceCommand =
  | "MANAGER_WORKSPACE_CONTEXT"
  | "MANAGER_WORKSPACE_LIST_GROUPS"
  | "MANAGER_WORKSPACE_GET_GROUP"
  | "MANAGER_WORKSPACE_LIST_MEMBERS"
  | "MANAGER_WORKSPACE_GET_MEMBER"
  | "MANAGER_WORKSPACE_LIST_EVENTS"
  | "MANAGER_WORKSPACE_GET_EVENT"
  | "MANAGER_WORKSPACE_REVENUE_PLATFORM_EARNING_SCOPE"
  | "MANAGER_WORKSPACE_LIST_REVENUE_PLATFORM_EARNING_BATCHES"
  | "MANAGER_WORKSPACE_CREATE_REVENUE_PLATFORM_EARNING_BATCH"
  | "MANAGER_WORKSPACE_GET_REVENUE_PLATFORM_EARNING_BATCH"
  | "MANAGER_WORKSPACE_UPDATE_REVENUE_PLATFORM_EARNING_BATCH"
  | "MANAGER_WORKSPACE_LIST_REVENUE_PLATFORM_EARNING_LINES"
  | "MANAGER_WORKSPACE_ADD_REVENUE_PLATFORM_EARNING_LINE"
  | "MANAGER_WORKSPACE_UPDATE_REVENUE_PLATFORM_EARNING_LINE"
  | "MANAGER_WORKSPACE_SUBMIT_REVENUE_PLATFORM_EARNING_BATCH"
  | "MANAGER_WORKSPACE_LIST_WORK_SHIFTS"
  | "MANAGER_WORKSPACE_GET_WEEKLY_SCHEDULE"
  | "MANAGER_WORKSPACE_LIST_WORK_SCHEDULE_AVAILABILITY_MEMBERS"
  | "MANAGER_WORKSPACE_SUBMIT_WORK_SCHEDULE_REQUEST_BATCH"
  | "MANAGER_WORKSPACE_LIST_WORK_SCHEDULE_REQUEST_BATCHES"
  | "MANAGER_WORKSPACE_GET_WORK_SCHEDULE_REQUEST_BATCH"
  | "MANAGER_WORKSPACE_CANCEL_WORK_SCHEDULE_REQUEST_BATCH"
  | "MANAGER_WORKSPACE_CANCEL_WORK_SCHEDULE_REQUEST_LINE"
  | "MANAGER_WORKSPACE_SUBMIT_WORK_SCHEDULE_AVAILABILITY_BATCH"
  | "MANAGER_WORKSPACE_LIST_WORK_SCHEDULE_AVAILABILITY_BATCHES"
  | "MANAGER_WORKSPACE_GET_WORK_SCHEDULE_AVAILABILITY_BATCH"
  | "MANAGER_WORKSPACE_CANCEL_WORK_SCHEDULE_AVAILABILITY_BATCH"
  | "MANAGER_WORKSPACE_CANCEL_WORK_SCHEDULE_AVAILABILITY_LINE";

type ManagerWorkspaceResult =
  | ManagerWorkspaceContextView
  | ManagedGroupListView
  | ManagedGroupView
  | ManagedMemberListView
  | ManagedMemberView
  | ManagerWorkShiftListView
  | ManagerWeeklyScheduleView
  | WorkScheduleRequestBatchView
  | ListWorkScheduleRequestBatchesResult
  | WorkScheduleAvailabilityBatchView
  | ListWorkScheduleAvailabilityBatchesResult
  | ManagerAvailabilityTargetMembersView
  | ManagerEventSummaryView
  | ManagerPlatformEarningScopeView
  | ManagerPlatformEarningBatchView
  | ManagerPlatformEarningBatchListResult
  | ManagerPlatformEarningLineView
  | ManagerPlatformEarningLineListResult
  | { readonly items: readonly ManagerEventSummaryView[] };

const SUBMIT_BATCH_BODY_FIELDS = Object.freeze([
  "periodMonth",
  "clientToken",
  "idempotencyKey",
  "note",
  "lines",
]);
const CANCEL_BODY_FIELDS = Object.freeze(["cancellationReason"]);
const CREATE_REVENUE_BATCH_BODY_FIELDS = Object.freeze([
  "batchCode",
  "platform",
  "platformAccountId",
  "talentGroupId",
  "sourceType",
  "periodMonth",
  "sourceDateFrom",
  "sourceDateTo",
]);
const UPDATE_REVENUE_BATCH_BODY_FIELDS = Object.freeze([
  "platformAccountId",
  "talentGroupId",
  "sourceDateFrom",
  "sourceDateTo",
]);
const REVENUE_LINE_BODY_FIELDS = Object.freeze([
  "sourceDate",
  "memberTalentId",
  "memberEmploymentProfileId",
  "rawQuantity",
  "externalSourceRef",
  "notes",
]);
const SUBMIT_AVAILABILITY_BATCH_BODY_FIELDS = Object.freeze([
  "periodMonth",
  "targetType",
  "targetMode",
  "targetOrgUnitId",
  "targetTalentGroupId",
  "clientToken",
  "idempotencyKey",
  "note",
  "lines",
]);

export class ManagerWorkspaceAdminController extends SecureController {
  constructor(
    private readonly service: ManagerWorkspaceAdminService,
    private readonly workScheduleService: ManagerWorkspaceWorkScheduleAdminService,
    private readonly workScheduleRequestBatchService: WorkScheduleRequestBatchAdminService,
    private readonly workScheduleAvailabilityBatchService: WorkScheduleAvailabilityBatchAdminService,
    private readonly eventService: ManagerWorkspaceEventAdminService,
    private readonly revenueService: ManagerWorkspaceRevenueAdminService,
    private readonly groupService?: ManagerWorkspaceGroupAdminService,
  ) {
    super();
  }

  protected async handle(
    req: Request,
    actor: Actor,
    _context: ContextType,
  ): Promise<ManagerWorkspaceResult> {
    const command = readCommand<ManagerWorkspaceCommand>(req);
    if (command === "MANAGER_WORKSPACE_CONTEXT") {
      return this.service.getContext(actor);
    }
    if (
      command === "MANAGER_WORKSPACE_LIST_GROUPS" ||
      command === "MANAGER_WORKSPACE_GET_GROUP" ||
      command === "MANAGER_WORKSPACE_LIST_MEMBERS" ||
      command === "MANAGER_WORKSPACE_GET_MEMBER"
    ) {
      if (!this.groupService) {
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          "Manager group service is not configured",
        );
      }
      if (command === "MANAGER_WORKSPACE_LIST_GROUPS") {
        return this.groupService.listGroups(actor, {
          search: readOptionalQuery(req, "search"),
          scopeType: readOptionalQuery(req, "scopeType"),
          limit: readOptionalQuery(req, "limit"),
          cursor: readOptionalQuery(req, "cursor"),
        });
      }
      if (command === "MANAGER_WORKSPACE_GET_GROUP") {
        return this.groupService.getGroup(
          actor,
          req.params.scopeType,
          req.params.scopeId,
        );
      }
      if (command === "MANAGER_WORKSPACE_LIST_MEMBERS") {
        return this.groupService.listMembers(
          actor,
          req.params.scopeType,
          req.params.scopeId,
          {
            search: readOptionalQuery(req, "search"),
            operationalStatus: readOptionalQuery(req, "operationalStatus"),
            personKind: readOptionalQuery(req, "personKind"),
            kpiEligibility: readOptionalQuery(req, "kpiEligibility"),
            scheduleEligibility: readOptionalQuery(req, "scheduleEligibility"),
            limit: readOptionalQuery(req, "limit"),
            cursor: readOptionalQuery(req, "cursor"),
          },
        );
      }
      return this.groupService.getMember(
        actor,
        req.params.scopeType,
        req.params.scopeId,
        req.params.memberId,
      );
    }
    if (command === "MANAGER_WORKSPACE_LIST_EVENTS") {
      return this.eventService.listEvents(actor);
    }
    if (command === "MANAGER_WORKSPACE_GET_EVENT") {
      return this.eventService.getEvent(actor, req.params.eventId);
    }
    if (command === "MANAGER_WORKSPACE_REVENUE_PLATFORM_EARNING_SCOPE") {
      return this.revenueService.getScope(actor);
    }
    if (command === "MANAGER_WORKSPACE_LIST_REVENUE_PLATFORM_EARNING_BATCHES") {
      return this.revenueService.listBatches(actor, {
        status: readOptionalQuery(req, "status"),
        platform: readOptionalQuery(req, "platform"),
        platformAccountId: readOptionalQuery(req, "platformAccountId"),
        talentGroupId: readOptionalQuery(req, "talentGroupId"),
        sourceType: readOptionalQuery(req, "sourceType"),
        periodMonth: readOptionalQuery(req, "periodMonth"),
        createdBeforeAt: readOptionalQuery(req, "createdBeforeAt"),
        limit: readOptionalQuery(req, "limit"),
        cursor: readOptionalQuery(req, "cursor"),
      });
    }
    if (command === "MANAGER_WORKSPACE_CREATE_REVENUE_PLATFORM_EARNING_BATCH") {
      const body = requireRecord(req.body);
      assertNoUnexpectedFields(
        body,
        CREATE_REVENUE_BATCH_BODY_FIELDS,
        "createManagerPlatformEarningBatch",
      );
      return this.revenueService.createBatch(actor, {
        batchCode: body.batchCode as string | null | undefined,
        platform: body.platform as string,
        platformAccountId: body.platformAccountId as string,
        talentGroupId: body.talentGroupId as string | null | undefined,
        sourceType: body.sourceType as string,
        periodMonth: body.periodMonth as string,
        sourceDateFrom: body.sourceDateFrom as number,
        sourceDateTo: body.sourceDateTo as number,
      });
    }
    if (command === "MANAGER_WORKSPACE_GET_REVENUE_PLATFORM_EARNING_BATCH") {
      return this.revenueService.getBatch(actor, req.params.batchId);
    }
    if (command === "MANAGER_WORKSPACE_UPDATE_REVENUE_PLATFORM_EARNING_BATCH") {
      const body = requireRecord(req.body);
      assertNoUnexpectedFields(
        body,
        UPDATE_REVENUE_BATCH_BODY_FIELDS,
        "updateManagerPlatformEarningBatch",
      );
      return this.revenueService.updateBatch(actor, {
        batchId: req.params.batchId,
        platformAccountId: body.platformAccountId as string | undefined,
        talentGroupId: body.talentGroupId as string | null | undefined,
        sourceDateFrom: body.sourceDateFrom as number | undefined,
        sourceDateTo: body.sourceDateTo as number | undefined,
      });
    }
    if (command === "MANAGER_WORKSPACE_LIST_REVENUE_PLATFORM_EARNING_LINES") {
      return this.revenueService.listLines(actor, {
        batchId: req.params.batchId,
        limit: readOptionalQuery(req, "limit"),
        cursor: readOptionalQuery(req, "cursor"),
      });
    }
    if (command === "MANAGER_WORKSPACE_ADD_REVENUE_PLATFORM_EARNING_LINE") {
      const body = requireRecord(req.body);
      assertNoUnexpectedFields(
        body,
        REVENUE_LINE_BODY_FIELDS,
        "addManagerPlatformEarningLine",
      );
      return this.revenueService.addLine(actor, {
        batchId: req.params.batchId,
        sourceDate: body.sourceDate as number,
        memberTalentId: body.memberTalentId as string | null | undefined,
        memberEmploymentProfileId: body.memberEmploymentProfileId as
          string | null | undefined,
        rawQuantity: body.rawQuantity as number,
        externalSourceRef: body.externalSourceRef as string | null | undefined,
        notes: body.notes as string | null | undefined,
      });
    }
    if (command === "MANAGER_WORKSPACE_UPDATE_REVENUE_PLATFORM_EARNING_LINE") {
      const body = requireRecord(req.body);
      assertNoUnexpectedFields(
        body,
        REVENUE_LINE_BODY_FIELDS,
        "updateManagerPlatformEarningLine",
      );
      return this.revenueService.updateLine(actor, {
        batchId: req.params.batchId,
        lineId: req.params.lineId,
        sourceDate: body.sourceDate as number | undefined,
        memberTalentId: body.memberTalentId as string | null | undefined,
        memberEmploymentProfileId: body.memberEmploymentProfileId as
          string | null | undefined,
        rawQuantity: body.rawQuantity as number | undefined,
        externalSourceRef: body.externalSourceRef as string | null | undefined,
        notes: body.notes as string | null | undefined,
      });
    }
    if (command === "MANAGER_WORKSPACE_SUBMIT_REVENUE_PLATFORM_EARNING_BATCH") {
      return this.revenueService.submitBatch(actor, {
        batchId: req.params.batchId,
      });
    }

    if (command === "MANAGER_WORKSPACE_LIST_WORK_SHIFTS") {
      return this.workScheduleService.listWorkShifts(actor, {
        month: readOptionalQuery(req, "month"),
        sourceType: readOptionalQuery(req, "sourceType"),
        search: readOptionalQuery(req, "search"),
        cursor: readOptionalQuery(req, "cursor"),
      });
    }
    if (command === "MANAGER_WORKSPACE_GET_WEEKLY_SCHEDULE") {
      return this.workScheduleService.getWeeklySchedule(actor, {
        scopeType: readOptionalQuery(req, "scopeType"),
        scopeId: readOptionalQuery(req, "scopeId"),
        weekStart: readOptionalQuery(req, "weekStart"),
        search: readOptionalQuery(req, "search"),
        status: readOptionalQuery(req, "status"),
        conflict: readOptionalQuery(req, "conflict"),
        request: readOptionalQuery(req, "request"),
        cursor: readOptionalQuery(req, "cursor"),
      });
    }

    if (
      command === "MANAGER_WORKSPACE_LIST_WORK_SCHEDULE_AVAILABILITY_MEMBERS"
    ) {
      return this.workScheduleAvailabilityBatchService.listManagerTargetMembers(
        actor,
        {
          targetType: readOptionalQuery(req, "targetType"),
          targetId: readOptionalQuery(req, "targetId"),
        },
      );
    }

    if (command === "MANAGER_WORKSPACE_SUBMIT_WORK_SCHEDULE_REQUEST_BATCH") {
      return this.workScheduleRequestBatchService.submitManagerBatch(
        actor,
        parseSubmitBatchCommand(req),
      );
    }

    if (command === "MANAGER_WORKSPACE_LIST_WORK_SCHEDULE_REQUEST_BATCHES") {
      return this.workScheduleRequestBatchService.listManagerBatches(actor, {
        status: readOptionalQuery(req, "status"),
        periodMonth: readOptionalQuery(req, "periodMonth"),
        limit: readOptionalQuery(req, "limit"),
        cursor: readOptionalQuery(req, "cursor"),
      });
    }

    if (command === "MANAGER_WORKSPACE_GET_WORK_SCHEDULE_REQUEST_BATCH") {
      return this.workScheduleRequestBatchService.getManagerBatchDetail(actor, {
        batchId: req.params.batchId,
      });
    }

    if (command === "MANAGER_WORKSPACE_CANCEL_WORK_SCHEDULE_REQUEST_BATCH") {
      const body = requireRecord(req.body);
      assertNoUnexpectedFields(
        body,
        CANCEL_BODY_FIELDS,
        "cancelWorkScheduleRequestBatch",
      );
      return this.workScheduleRequestBatchService.cancelManagerBatch(actor, {
        batchId: req.params.batchId,
        cancellationReason: body.cancellationReason as string,
      });
    }

    if (command === "MANAGER_WORKSPACE_CANCEL_WORK_SCHEDULE_REQUEST_LINE") {
      const body = requireRecord(req.body);
      assertNoUnexpectedFields(
        body,
        CANCEL_BODY_FIELDS,
        "cancelWorkScheduleRequestLine",
      );
      return this.workScheduleRequestBatchService.cancelManagerLine(actor, {
        batchId: req.params.batchId,
        lineId: req.params.lineId,
        cancellationReason: body.cancellationReason as string,
      });
    }

    if (
      command === "MANAGER_WORKSPACE_SUBMIT_WORK_SCHEDULE_AVAILABILITY_BATCH"
    ) {
      return this.workScheduleAvailabilityBatchService.submitManagerBatch(
        actor,
        parseSubmitAvailabilityBatchCommand(req),
      );
    }

    if (
      command === "MANAGER_WORKSPACE_LIST_WORK_SCHEDULE_AVAILABILITY_BATCHES"
    ) {
      return this.workScheduleAvailabilityBatchService.listManagerBatches(
        actor,
        {
          status: readOptionalQuery(req, "status"),
          periodMonth: readOptionalQuery(req, "periodMonth"),
          targetType: readOptionalQuery(req, "targetType"),
          targetOrgUnitId: readOptionalQuery(req, "targetOrgUnitId"),
          targetTalentGroupId: readOptionalQuery(req, "targetTalentGroupId"),
          limit: readOptionalQuery(req, "limit"),
          cursor: readOptionalQuery(req, "cursor"),
        },
      );
    }

    if (command === "MANAGER_WORKSPACE_GET_WORK_SCHEDULE_AVAILABILITY_BATCH") {
      return this.workScheduleAvailabilityBatchService.getManagerBatchDetail(
        actor,
        { batchId: req.params.batchId },
      );
    }

    if (
      command === "MANAGER_WORKSPACE_CANCEL_WORK_SCHEDULE_AVAILABILITY_BATCH" ||
      command === "MANAGER_WORKSPACE_CANCEL_WORK_SCHEDULE_AVAILABILITY_LINE"
    ) {
      const body = requireRecord(req.body);
      assertNoUnexpectedFields(
        body,
        CANCEL_BODY_FIELDS,
        "cancelWorkScheduleAvailability",
      );
      if (
        command === "MANAGER_WORKSPACE_CANCEL_WORK_SCHEDULE_AVAILABILITY_BATCH"
      ) {
        return this.workScheduleAvailabilityBatchService.cancelManagerBatch(
          actor,
          {
            batchId: req.params.batchId,
            cancellationReason: body.cancellationReason as string,
          },
        );
      }
      return this.workScheduleAvailabilityBatchService.cancelManagerLine(
        actor,
        {
          batchId: req.params.batchId,
          lineId: req.params.lineId,
          cancellationReason: body.cancellationReason as string,
        },
      );
    }

    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      "Manager workspace command missing",
    );
  }

  protected async present(
    result: ManagerWorkspaceResult,
    req: Request,
    _actor: Actor,
    _context: ContextType,
  ): Promise<PresentationResult> {
    const command = readCommand<ManagerWorkspaceCommand>(req);
    if (
      command === "MANAGER_WORKSPACE_LIST_GROUPS" ||
      command === "MANAGER_WORKSPACE_GET_GROUP" ||
      command === "MANAGER_WORKSPACE_LIST_MEMBERS" ||
      command === "MANAGER_WORKSPACE_GET_MEMBER"
    ) {
      return {
        data: toPlainObject(result, "managerWorkspaceManagedGroupRead"),
      };
    }
    if (command === "MANAGER_WORKSPACE_GET_WEEKLY_SCHEDULE") {
      return {
        data: toPlainObject(result, "managerWorkspaceWeeklySchedule"),
      };
    }
    if (command === "MANAGER_WORKSPACE_LIST_WORK_SCHEDULE_REQUEST_BATCHES") {
      return {
        data: toPlainObject(
          {
            items: (result as ListWorkScheduleRequestBatchesResult).items.map(
              exposeManagerBatchListItem,
            ),
            ...((result as ListWorkScheduleRequestBatchesResult).nextCursor
              ? {
                  nextCursor: (result as ListWorkScheduleRequestBatchesResult)
                    .nextCursor,
                }
              : {}),
          },
          "managerWorkspaceWorkScheduleRequestBatchList",
        ),
      };
    }
    if (
      command === "MANAGER_WORKSPACE_LIST_REVENUE_PLATFORM_EARNING_BATCHES" ||
      command === "MANAGER_WORKSPACE_LIST_REVENUE_PLATFORM_EARNING_LINES" ||
      command === "MANAGER_WORKSPACE_REVENUE_PLATFORM_EARNING_SCOPE"
    ) {
      return {
        data: toPlainObject(
          result,
          "managerWorkspaceRevenuePlatformEarningList",
        ),
      };
    }
    if (
      command === "MANAGER_WORKSPACE_CREATE_REVENUE_PLATFORM_EARNING_BATCH" ||
      command === "MANAGER_WORKSPACE_GET_REVENUE_PLATFORM_EARNING_BATCH" ||
      command === "MANAGER_WORKSPACE_UPDATE_REVENUE_PLATFORM_EARNING_BATCH" ||
      command === "MANAGER_WORKSPACE_SUBMIT_REVENUE_PLATFORM_EARNING_BATCH" ||
      command === "MANAGER_WORKSPACE_ADD_REVENUE_PLATFORM_EARNING_LINE" ||
      command === "MANAGER_WORKSPACE_UPDATE_REVENUE_PLATFORM_EARNING_LINE"
    ) {
      return {
        data: toPlainObject(
          result,
          "managerWorkspaceRevenuePlatformEarningMutation",
        ),
      };
    }
    if (
      command === "MANAGER_WORKSPACE_LIST_WORK_SCHEDULE_AVAILABILITY_BATCHES"
    ) {
      const list = result as ListWorkScheduleAvailabilityBatchesResult;
      return {
        data: toPlainObject(
          {
            items: list.items.map(exposeManagerAvailabilityListItem),
            ...(list.nextCursor ? { nextCursor: list.nextCursor } : {}),
          },
          "managerWorkspaceWorkScheduleAvailabilityBatchList",
        ),
      };
    }
    if (
      command === "MANAGER_WORKSPACE_SUBMIT_WORK_SCHEDULE_AVAILABILITY_BATCH" ||
      command === "MANAGER_WORKSPACE_GET_WORK_SCHEDULE_AVAILABILITY_BATCH" ||
      command === "MANAGER_WORKSPACE_CANCEL_WORK_SCHEDULE_AVAILABILITY_BATCH" ||
      command === "MANAGER_WORKSPACE_CANCEL_WORK_SCHEDULE_AVAILABILITY_LINE"
    ) {
      return {
        data: toPlainObject(
          exposeManagerAvailabilityBatch(
            result as WorkScheduleAvailabilityBatchView,
          ),
          "managerWorkspaceWorkScheduleAvailabilityBatch",
        ),
      };
    }
    if (
      command === "MANAGER_WORKSPACE_SUBMIT_WORK_SCHEDULE_REQUEST_BATCH" ||
      command === "MANAGER_WORKSPACE_GET_WORK_SCHEDULE_REQUEST_BATCH" ||
      command === "MANAGER_WORKSPACE_CANCEL_WORK_SCHEDULE_REQUEST_BATCH" ||
      command === "MANAGER_WORKSPACE_CANCEL_WORK_SCHEDULE_REQUEST_LINE"
    ) {
      return {
        data: toPlainObject(
          exposeManagerBatch(result as WorkScheduleRequestBatchView),
          "managerWorkspaceWorkScheduleRequestBatch",
        ),
      };
    }

    return {
      data: toPlainObject(result, "managerWorkspaceContext"),
    };
  }
}

function readOptionalQuery(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

function parseSubmitBatchCommand(
  req: Request,
): SubmitWorkScheduleRequestBatchCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    SUBMIT_BATCH_BODY_FIELDS,
    "submitWorkScheduleRequestBatch",
  );
  return {
    periodMonth: body.periodMonth as string,
    clientToken: body.clientToken as string | null | undefined,
    idempotencyKey: body.idempotencyKey as string | null | undefined,
    note: body.note as string | null | undefined,
    lines: body.lines as SubmitWorkScheduleRequestBatchCommand["lines"],
  };
}

function parseSubmitAvailabilityBatchCommand(
  req: Request,
): SubmitWorkScheduleAvailabilityBatchCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    SUBMIT_AVAILABILITY_BATCH_BODY_FIELDS,
    "submitWorkScheduleAvailabilityBatch",
  );
  return {
    periodMonth: body.periodMonth as string,
    targetType: body.targetType as string,
    targetMode: body.targetMode as string | null | undefined,
    targetOrgUnitId: body.targetOrgUnitId as string | null | undefined,
    targetTalentGroupId: body.targetTalentGroupId as string | null | undefined,
    clientToken: body.clientToken as string | null | undefined,
    idempotencyKey: body.idempotencyKey as string | null | undefined,
    note: body.note as string | null | undefined,
    lines: body.lines as SubmitWorkScheduleAvailabilityBatchCommand["lines"],
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

function exposeManagerBatchListItem(
  input: WorkScheduleRequestBatchListItemView,
) {
  return {
    id: input.id,
    batchCode: input.batchCode,
    status: input.status,
    periodMonth: input.periodMonth,
    scopeSummary: input.scopeSummary,
    note: input.note,
    lineCounts: input.lineCounts,
    clientToken: input.clientToken,
    submittedAt: input.submittedAt,
    cancelledAt: input.cancelledAt,
    resolvedAt: input.resolvedAt,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

function exposeManagerBatch(input: WorkScheduleRequestBatchView) {
  return {
    ...exposeManagerBatchListItem(input),
    lines: input.lines.map((line) => ({
      id: line.id,
      lineNo: line.lineNo,
      requestType: line.requestType,
      status: line.status,
      member: {
        employmentProfileId: line.memberEmploymentProfileId,
        displayName:
          line.memberEmploymentProfileRef?.displayName ??
          line.memberEmploymentProfileRef?.title ??
          line.memberEmploymentProfileId,
        employeeCode: line.memberEmploymentProfileRef?.code,
      },
      workShiftId: line.workShiftId,
      workShiftRef: line.workShiftRef ?? null,
      requestedStartAt: line.requestedStartAt,
      requestedEndAt: line.requestedEndAt,
      timezone: line.timezone,
      title: line.title,
      description: line.description,
      externalRef: line.externalRef,
      reason: line.reason,
      approvalNote: line.approvalNote,
      rejectionReason: line.rejectionReason,
      cancellationReason: line.cancellationReason,
      failureReason: line.failureReason,
      appliedWorkShiftId: line.appliedWorkShiftId,
      appliedWorkShiftRef: line.appliedWorkShiftRef ?? null,
      createdAt: line.createdAt,
      updatedAt: line.updatedAt,
      approvedAt: line.approvedAt,
      rejectedAt: line.rejectedAt,
      cancelledAt: line.cancelledAt,
      failedAt: line.failedAt,
    })),
  };
}
