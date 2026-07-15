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
  ArchiveKpiPlanCommand,
  ApproveKpiAllocationCommand,
  CorrectKpiActualCommand,
  CreateKpiPlanCommand,
  CreateKpiActualCommand,
  MarkKpiActualExcuseCommand,
  PublishKpiAllocationCommand,
  RejectKpiAllocationCommand,
  RemoveKpiActualExcuseCommand,
  ReplaceKpiAllocationsCommand,
  ReplaceKpiTargetMetricsCommand,
  SubmitKpiAllocationDraftCommand,
  UpdateKpiActualCommand,
  UpdateKpiDraftCoreCommand,
  UpsertKpiAllocationDraftCommand,
} from "@modules/kpi/shared/kpi.contracts";
import {
  KpiActualCorrectionExposure,
  KpiOrgUnitActualEntryExposure,
  KpiPlanDetailExposure,
} from "@modules/kpi/shared/kpi.exposure";
import { KPI_ADMIN_MUTATION_PRESENTER_KEY } from "@modules/kpi/shared/kpi.presenter-keys";
import { KpiAdminService } from "./admin.kpi.service";

type KpiMutationCommand =
  | "KPI_PLAN_CREATE"
  | "KPI_PLAN_UPDATE_DRAFT_CORE"
  | "KPI_PLAN_REPLACE_TARGET_METRICS"
  | "KPI_PLAN_REPLACE_ALLOCATIONS"
  | "KPI_ALLOCATION_DRAFT_UPSERT"
  | "KPI_ALLOCATION_SUBMIT"
  | "KPI_ALLOCATION_APPROVE"
  | "KPI_ALLOCATION_REJECT"
  | "KPI_ALLOCATION_PUBLISH"
  | "KPI_PLAN_PUBLISH"
  | "KPI_PLAN_ARCHIVE"
  | "KPI_ACTUAL_CREATE"
  | "KPI_ORG_UNIT_ACTUAL_CREATE"
  | "KPI_ACTUAL_EXCUSE_MARK"
  | "KPI_ORG_UNIT_ACTUAL_EXCUSE_MARK"
  | "KPI_ACTUAL_EXCUSE_REMOVE"
  | "KPI_ORG_UNIT_ACTUAL_EXCUSE_REMOVE"
  | "KPI_ACTUAL_UPDATE"
  | "KPI_ORG_UNIT_ACTUAL_UPDATE"
  | "KPI_ACTUAL_CORRECT"
  | "KPI_ORG_UNIT_ACTUAL_CORRECT"
  | "KPI_PLAN_FINALIZE";

const CREATE_KPI_PLAN_BODY_FIELDS = [
  "title",
  "description",
  "subjectType",
  "subjectId",
  "currencyCode",
  "periodMonth",
  "periodStartAt",
  "periodEndAt",
  "timezone",
  "targetMetrics",
  "externalRef",
] as const;

const UPDATE_KPI_DRAFT_CORE_BODY_FIELDS = [
  "title",
  "description",
  "currencyCode",
  "periodMonth",
  "periodStartAt",
  "periodEndAt",
  "timezone",
  "externalRef",
] as const;

const REPLACE_KPI_TARGET_METRICS_BODY_FIELDS = ["targetMetrics"] as const;

const REPLACE_KPI_ALLOCATIONS_BODY_FIELDS = ["allocations"] as const;
const ALLOCATION_VERSION_BODY_FIELDS = [
  "expectedPlanVersion",
  "expectedAllocationVersion",
  "expectedMembershipSnapshotVersion",
  "idempotencyKey",
] as const;
const UPSERT_KPI_ALLOCATION_DRAFT_BODY_FIELDS = [
  "allocations",
  ...ALLOCATION_VERSION_BODY_FIELDS,
] as const;
const SUBMIT_KPI_ALLOCATION_BODY_FIELDS = [
  ...ALLOCATION_VERSION_BODY_FIELDS,
  "reason",
] as const;
const APPROVE_KPI_ALLOCATION_BODY_FIELDS = [
  "approvalNote",
  ...ALLOCATION_VERSION_BODY_FIELDS,
] as const;
const REJECT_KPI_ALLOCATION_BODY_FIELDS = [
  "rejectionReason",
  ...ALLOCATION_VERSION_BODY_FIELDS,
] as const;
const PUBLISH_KPI_ALLOCATION_BODY_FIELDS = [
  ...ALLOCATION_VERSION_BODY_FIELDS,
] as const;
const CREATE_KPI_ACTUAL_BODY_FIELDS = [
  "allocationId",
  "metricCode",
  "actualDate",
  "actualValue",
  "evidenceRef",
  "sourceFingerprint",
] as const;
const MARK_KPI_ACTUAL_EXCUSE_BODY_FIELDS = [
  "allocationId",
  "metricCode",
  "actualDate",
  "status",
  "reasonCode",
  "reasonText",
] as const;
const UPDATE_KPI_ACTUAL_BODY_FIELDS = ["actualValue"] as const;
const CORRECT_KPI_ACTUAL_BODY_FIELDS = [
  "correctedValue",
  "reason",
  "expectedEntryVersion",
  "idempotencyKey",
] as const;

export class KpiAdminController extends SecureController {
  constructor(private readonly service: KpiAdminService) {
    super();
  }

  protected async handle(
    req: Request,
    actor: Actor,
    _context: ContextType,
  ): Promise<unknown> {
    const command = readCommand<KpiMutationCommand>(req);
    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "KPI mutation command missing",
      );
    }

    switch (command) {
      case "KPI_PLAN_CREATE":
        return this.service.createKpiPlan(
          actor,
          parseCreateKpiPlanCommand(req),
        );
      case "KPI_PLAN_UPDATE_DRAFT_CORE":
        return this.service.updateKpiDraftCore(
          actor,
          parseUpdateKpiDraftCoreCommand(req),
        );
      case "KPI_PLAN_REPLACE_TARGET_METRICS":
        return this.service.replaceKpiTargetMetrics(
          actor,
          parseReplaceKpiTargetMetricsCommand(req),
        );
      case "KPI_PLAN_REPLACE_ALLOCATIONS":
        return this.service.replaceKpiAllocations(
          actor,
          parseReplaceKpiAllocationsCommand(req),
        );
      case "KPI_ALLOCATION_DRAFT_UPSERT":
        return this.service.upsertKpiAllocationDraft(
          actor,
          parseUpsertKpiAllocationDraftCommand(req),
        );
      case "KPI_ALLOCATION_SUBMIT":
        assertNoUnexpectedFields(
          requireRecord(req.body),
          SUBMIT_KPI_ALLOCATION_BODY_FIELDS,
          "submitKpiAllocationDraft",
        );
        const submitBody = requireRecord(req.body);
        return this.service.submitKpiAllocationDraft(actor, {
          kpiPlanId: req.params.kpiPlanId,
          ...parseAllocationVersionFields(submitBody),
          reason: submitBody.reason as string | undefined,
        } satisfies SubmitKpiAllocationDraftCommand);
      case "KPI_ALLOCATION_APPROVE":
        return this.service.approveKpiAllocation(
          actor,
          parseApproveKpiAllocationCommand(req),
        );
      case "KPI_ALLOCATION_REJECT":
        return this.service.rejectKpiAllocation(
          actor,
          parseRejectKpiAllocationCommand(req),
        );
      case "KPI_ALLOCATION_PUBLISH":
        const publishBody = requireRecord(req.body);
        assertNoUnexpectedFields(
          publishBody,
          PUBLISH_KPI_ALLOCATION_BODY_FIELDS,
          "publishKpiAllocation",
        );
        return this.service.publishKpiAllocation(actor, {
          kpiPlanId: req.params.kpiPlanId,
          ...parseAllocationVersionFields(publishBody),
        } satisfies PublishKpiAllocationCommand);
      case "KPI_PLAN_PUBLISH":
        assertNoUnexpectedFields(requireRecord(req.body), [], "publishKpiPlan");
        return this.service.publishKpiPlan(actor, {
          kpiPlanId: req.params.kpiPlanId,
        });
      case "KPI_PLAN_ARCHIVE":
        return this.service.archiveKpiPlan(
          actor,
          parseArchiveKpiPlanCommand(req),
        );
      case "KPI_ACTUAL_CREATE":
        return this.service.createOrSetKpiActual(
          actor,
          parseCreateKpiActualCommand(req),
        );
      case "KPI_ORG_UNIT_ACTUAL_CREATE":
        return this.service.createOrSetKpiOrgUnitActual(
          actor,
          parseCreateKpiActualCommand(req),
        );
      case "KPI_ACTUAL_EXCUSE_MARK":
        return this.service.markKpiActualExcuse(
          actor,
          parseMarkKpiActualExcuseCommand(req),
        );
      case "KPI_ORG_UNIT_ACTUAL_EXCUSE_MARK":
        return this.service.markKpiOrgUnitActualExcuse(
          actor,
          parseMarkKpiActualExcuseCommand(req),
        );
      case "KPI_ACTUAL_EXCUSE_REMOVE":
        assertNoUnexpectedFields(
          requireRecord(req.body),
          [],
          "removeKpiActualExcuse",
        );
        return this.service.removeKpiActualExcuse(actor, {
          kpiPlanId: req.params.kpiPlanId,
          excuseId: req.params.excuseId,
        } satisfies RemoveKpiActualExcuseCommand);
      case "KPI_ORG_UNIT_ACTUAL_EXCUSE_REMOVE":
        assertNoUnexpectedFields(
          requireRecord(req.body),
          [],
          "removeKpiOrgUnitActualExcuse",
        );
        return this.service.removeKpiOrgUnitActualExcuse(actor, {
          kpiPlanId: req.params.kpiPlanId,
          excuseId: req.params.excuseId,
        } satisfies RemoveKpiActualExcuseCommand);
      case "KPI_ACTUAL_UPDATE":
        return this.service.updateKpiActualDirect(
          actor,
          parseUpdateKpiActualCommand(req),
        );
      case "KPI_ORG_UNIT_ACTUAL_UPDATE":
        return this.service.updateKpiOrgUnitActualDirect(
          actor,
          parseUpdateKpiActualCommand(req),
        );
      case "KPI_ACTUAL_CORRECT":
        return this.service.correctKpiActual(
          actor,
          parseCorrectKpiActualCommand(req),
        );
      case "KPI_ORG_UNIT_ACTUAL_CORRECT":
        return this.service.correctKpiOrgUnitActual(
          actor,
          parseCorrectKpiActualCommand(req),
        );
      case "KPI_PLAN_FINALIZE":
        assertNoUnexpectedFields(
          requireRecord(req.body),
          [],
          "finalizeKpiPlan",
        );
        return this.service.finalizeKpiPlan(actor, {
          kpiPlanId: req.params.kpiPlanId,
        });
      default:
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          `Unsupported KPI mutation command: ${command}`,
        );
    }
  }

  protected async present(
    result: unknown,
    req: Request,
    _actor: Actor,
    context: ContextType,
  ): Promise<PresentationResult> {
    const command = readCommand<KpiMutationCommand>(req);
    if (command === "KPI_ORG_UNIT_ACTUAL_CREATE") {
      return {
        data: KpiOrgUnitActualEntryExposure.expose(
          (
            result as Awaited<
              ReturnType<KpiAdminService["createOrSetKpiOrgUnitActual"]>
            >
          ).actualEntry,
        ),
      };
    }
    if (command === "KPI_ORG_UNIT_ACTUAL_UPDATE") {
      return {
        data: KpiOrgUnitActualEntryExposure.expose(
          (
            result as Awaited<
              ReturnType<KpiAdminService["updateKpiOrgUnitActualDirect"]>
            >
          ).actualEntry,
        ),
      };
    }
    if (command === "KPI_ORG_UNIT_ACTUAL_CORRECT") {
      const input = result as Awaited<
        ReturnType<KpiAdminService["correctKpiOrgUnitActual"]>
      >;
      return {
        data: {
          actualEntry: KpiOrgUnitActualEntryExposure.expose(input.actualEntry),
          correction: KpiActualCorrectionExposure.expose(input.correction),
        },
      };
    }
    if (
      command === "KPI_ORG_UNIT_ACTUAL_EXCUSE_MARK" ||
      command === "KPI_ORG_UNIT_ACTUAL_EXCUSE_REMOVE"
    ) {
      return {
        data: KpiPlanDetailExposure.expose(
          result as
            | Awaited<ReturnType<KpiAdminService["markKpiOrgUnitActualExcuse"]>>
            | Awaited<
                ReturnType<KpiAdminService["removeKpiOrgUnitActualExcuse"]>
              >,
        ),
      };
    }
    return getPresenterRegistryFromRequest(req)
      .get<unknown, PresentationResult>(KPI_ADMIN_MUTATION_PRESENTER_KEY)
      .present(result, context);
  }
}

function parseCreateKpiPlanCommand(req: Request): CreateKpiPlanCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(body, CREATE_KPI_PLAN_BODY_FIELDS, "createKpiPlan");
  return {
    title: body.title as string,
    description: body.description as string | null | undefined,
    subjectType: body.subjectType as string,
    subjectId: body.subjectId as string,
    currencyCode: body.currencyCode as string | undefined,
    periodMonth: body.periodMonth as string,
    periodStartAt: body.periodStartAt as number,
    periodEndAt: body.periodEndAt as number,
    timezone: body.timezone as string | undefined,
    targetMetrics: body.targetMetrics as CreateKpiPlanCommand["targetMetrics"],
    externalRef: body.externalRef as string | null | undefined,
  };
}

function parseUpdateKpiDraftCoreCommand(
  req: Request,
): UpdateKpiDraftCoreCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    UPDATE_KPI_DRAFT_CORE_BODY_FIELDS,
    "updateKpiDraftCore",
  );
  return {
    kpiPlanId: req.params.kpiPlanId,
    title: body.title as string | undefined,
    description: body.description as string | null | undefined,
    currencyCode: body.currencyCode as string | undefined,
    periodMonth: body.periodMonth as string | undefined,
    periodStartAt: body.periodStartAt as number | undefined,
    periodEndAt: body.periodEndAt as number | undefined,
    timezone: body.timezone as string | undefined,
    externalRef: body.externalRef as string | null | undefined,
  };
}

function parseReplaceKpiTargetMetricsCommand(
  req: Request,
): ReplaceKpiTargetMetricsCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    REPLACE_KPI_TARGET_METRICS_BODY_FIELDS,
    "replaceKpiTargetMetrics",
  );
  return {
    kpiPlanId: req.params.kpiPlanId,
    targetMetrics:
      body.targetMetrics as ReplaceKpiTargetMetricsCommand["targetMetrics"],
  };
}

function parseReplaceKpiAllocationsCommand(
  req: Request,
): ReplaceKpiAllocationsCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    REPLACE_KPI_ALLOCATIONS_BODY_FIELDS,
    "replaceKpiAllocations",
  );
  return {
    kpiPlanId: req.params.kpiPlanId,
    allocations:
      body.allocations as ReplaceKpiAllocationsCommand["allocations"],
  };
}

function parseUpsertKpiAllocationDraftCommand(
  req: Request,
): UpsertKpiAllocationDraftCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    UPSERT_KPI_ALLOCATION_DRAFT_BODY_FIELDS,
    "upsertKpiAllocationDraft",
  );
  return {
    kpiPlanId: req.params.kpiPlanId,
    allocations:
      body.allocations as UpsertKpiAllocationDraftCommand["allocations"],
    ...parseAllocationVersionFields(body),
  };
}

function parseApproveKpiAllocationCommand(
  req: Request,
): ApproveKpiAllocationCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    APPROVE_KPI_ALLOCATION_BODY_FIELDS,
    "approveKpiAllocation",
  );
  return {
    kpiPlanId: req.params.kpiPlanId,
    approvalNote: body.approvalNote as string | null | undefined,
    ...parseAllocationVersionFields(body),
  };
}

function parseRejectKpiAllocationCommand(
  req: Request,
): RejectKpiAllocationCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    REJECT_KPI_ALLOCATION_BODY_FIELDS,
    "rejectKpiAllocation",
  );
  return {
    kpiPlanId: req.params.kpiPlanId,
    rejectionReason: body.rejectionReason as string,
    ...parseAllocationVersionFields(body),
  };
}

function parseAllocationVersionFields(body: Record<string, unknown>) {
  return {
    expectedPlanVersion: requireNonNegativeInteger(
      body.expectedPlanVersion,
      "expectedPlanVersion",
    ),
    expectedAllocationVersion: requireNonNegativeInteger(
      body.expectedAllocationVersion,
      "expectedAllocationVersion",
    ),
    expectedMembershipSnapshotVersion: requireNonEmptyString(
      body.expectedMembershipSnapshotVersion,
      "expectedMembershipSnapshotVersion",
    ),
    idempotencyKey: requireNonEmptyString(
      body.idempotencyKey,
      "idempotencyKey",
    ),
  };
}

function requireNonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new KpiValidationError(
      `${field} must be a non-negative safe integer`,
    );
  }
  return value as number;
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new KpiValidationError(`${field} is required`);
  }
  return value.trim();
}

function parseArchiveKpiPlanCommand(req: Request): ArchiveKpiPlanCommand {
  assertNoUnexpectedFields(requireRecord(req.body), [], "archiveKpiPlan");
  return { kpiPlanId: req.params.kpiPlanId };
}

function parseCreateKpiActualCommand(req: Request): CreateKpiActualCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    CREATE_KPI_ACTUAL_BODY_FIELDS,
    "createKpiActual",
  );
  return {
    kpiPlanId: req.params.kpiPlanId,
    allocationId: body.allocationId as string,
    metricCode: body.metricCode as string,
    actualDate: body.actualDate as string,
    actualValue: body.actualValue as number,
    evidenceRef: body.evidenceRef as string | null | undefined,
    sourceFingerprint: body.sourceFingerprint as string | null | undefined,
  };
}

function parseMarkKpiActualExcuseCommand(
  req: Request,
): MarkKpiActualExcuseCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    MARK_KPI_ACTUAL_EXCUSE_BODY_FIELDS,
    "markKpiActualExcuse",
  );
  return {
    kpiPlanId: req.params.kpiPlanId,
    allocationId: body.allocationId as string,
    metricCode: body.metricCode as string,
    actualDate: body.actualDate as string,
    status: body.status as string,
    reasonCode: body.reasonCode as string,
    reasonText: body.reasonText as string,
  };
}

function parseUpdateKpiActualCommand(req: Request): UpdateKpiActualCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    UPDATE_KPI_ACTUAL_BODY_FIELDS,
    "updateKpiActual",
  );
  return {
    kpiPlanId: req.params.kpiPlanId,
    actualEntryId: req.params.actualEntryId,
    actualValue: body.actualValue as number,
  };
}

function parseCorrectKpiActualCommand(req: Request): CorrectKpiActualCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    CORRECT_KPI_ACTUAL_BODY_FIELDS,
    "correctKpiActual",
  );
  return {
    kpiPlanId: req.params.kpiPlanId,
    actualEntryId: req.params.actualEntryId,
    correctedValue: body.correctedValue as number,
    reason: body.reason as string,
    expectedEntryVersion: requireNonNegativeInteger(
      body.expectedEntryVersion,
      "expectedEntryVersion",
    ),
    idempotencyKey: requireNonEmptyString(
      body.idempotencyKey,
      "idempotencyKey",
    ),
  };
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (value === undefined) {
    return {};
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new KpiValidationError("Request body must be a plain object");
  }
  return value as Record<string, unknown>;
}

function assertNoUnexpectedFields(
  body: Record<string, unknown>,
  allowedFields: readonly string[],
  operation: string,
): void {
  const unexpected = Object.keys(body).filter(
    (field) => !allowedFields.includes(field),
  );
  if (unexpected.length > 0) {
    throw new KpiValidationError(
      `${operation} payload contains unsupported field(s): ${unexpected.join(", ")}`,
    );
  }
}
