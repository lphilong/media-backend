import { Request } from "express";
import { readCommand } from "@app/base/command.middleware";
import { SecureController } from "@app/base/secure-controller.base";
import { PresentationResult } from "@app/base/presentation-result.types";
import { getPresenterRegistryFromRequest } from "@app/presenter/presenter.runtime-access";
import { Actor } from "@core/actor/actor";
import { ContextType } from "@core/context/context.types";
import { SystemInvariantError } from "@core/error/system-error";
import { TalentKpiValidationError } from "@modules/talent-kpi/domain/talent-kpi.errors";
import { TALENT_KPI_ADMIN_MUTATION_PRESENTER_KEY } from "@modules/talent-kpi/shared/talent-kpi.presenter-keys";
import {
  ArchiveTalentKpiRecordCommand,
  CreateTalentKpiRecordCommand,
  FinalizeTalentKpiRecordCommand,
  ReplaceTalentKpiMetricsCommand,
  UpdateTalentKpiDraftCoreCommand,
} from "@modules/talent-kpi/shared/talent-kpi.contracts";
import { TalentKpiAdminService } from "./admin.talent-kpi.service";

type TalentKpiMutationCommand =
  | "TALENT_KPI_RECORD_CREATE"
  | "TALENT_KPI_RECORD_UPDATE_DRAFT_CORE"
  | "TALENT_KPI_RECORD_REPLACE_METRICS"
  | "TALENT_KPI_RECORD_FINALIZE"
  | "TALENT_KPI_RECORD_ARCHIVE";

const CREATE_TALENT_KPI_RECORD_BODY_FIELDS: readonly string[] =
  Object.freeze([
    "kpiRecordCode",
    "title",
    "subjectTalentId",
    "attributionPlatformAccountId",
    "attributionEventId",
    "measurementSource",
    "periodStartAt",
    "periodEndAt",
    "metrics",
    "description",
    "externalRef",
  ]);

const UPDATE_TALENT_KPI_DRAFT_CORE_BODY_FIELDS: readonly string[] =
  Object.freeze([
    "title",
    "subjectTalentId",
    "attributionPlatformAccountId",
    "attributionEventId",
    "periodStartAt",
    "periodEndAt",
    "description",
    "externalRef",
  ]);

const REPLACE_TALENT_KPI_METRICS_BODY_FIELDS: readonly string[] =
  Object.freeze(["metrics"]);

export class TalentKpiAdminController extends SecureController {
  constructor(
    private readonly service: TalentKpiAdminService,
  ) {
    super();
  }

  protected async handle(
    req: Request,
    actor: Actor,
    _context: ContextType,
  ): Promise<unknown> {
    const command =
      readCommand<TalentKpiMutationCommand>(req);

    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Talent KPI mutation command missing",
      );
    }

    switch (command) {
      case "TALENT_KPI_RECORD_CREATE":
        return this.service.createTalentKpiRecord(
          actor,
          parseCreateTalentKpiRecordCommand(req),
        );

      case "TALENT_KPI_RECORD_UPDATE_DRAFT_CORE":
        return this.service.updateTalentKpiDraftCore(
          actor,
          parseUpdateTalentKpiDraftCoreCommand(req),
        );

      case "TALENT_KPI_RECORD_REPLACE_METRICS":
        return this.service.replaceTalentKpiMetrics(
          actor,
          parseReplaceTalentKpiMetricsCommand(req),
        );

      case "TALENT_KPI_RECORD_FINALIZE":
        return this.service.finalizeTalentKpiRecord(
          actor,
          parseFinalizeTalentKpiRecordCommand(req),
        );

      case "TALENT_KPI_RECORD_ARCHIVE":
        return this.service.archiveTalentKpiRecord(
          actor,
          parseArchiveTalentKpiRecordCommand(req),
        );

      default:
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          `Unsupported talent KPI mutation command: ${command}`,
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
        TALENT_KPI_ADMIN_MUTATION_PRESENTER_KEY,
      )
      .present(result, context);
  }
}

function parseCreateTalentKpiRecordCommand(
  req: Request,
): CreateTalentKpiRecordCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    CREATE_TALENT_KPI_RECORD_BODY_FIELDS,
    "createTalentKpiRecord",
  );

  return {
    kpiRecordCode: body.kpiRecordCode as string,
    title: body.title as string,
    subjectTalentId: body.subjectTalentId as string,
    attributionPlatformAccountId:
      body.attributionPlatformAccountId as
        | string
        | null
        | undefined,
    attributionEventId:
      body.attributionEventId as
        | string
        | null
        | undefined,
    measurementSource:
      body.measurementSource as string,
    periodStartAt: body.periodStartAt as number,
    periodEndAt: body.periodEndAt as number,
    metrics:
      body.metrics as CreateTalentKpiRecordCommand["metrics"],
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
  };
}

function parseUpdateTalentKpiDraftCoreCommand(
  req: Request,
): UpdateTalentKpiDraftCoreCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    UPDATE_TALENT_KPI_DRAFT_CORE_BODY_FIELDS,
    "updateTalentKpiDraftCore",
  );

  return {
    talentKpiRecordId: req.params.talentKpiRecordId,
    title: body.title as string | undefined,
    subjectTalentId:
      body.subjectTalentId as string | undefined,
    attributionPlatformAccountId:
      body.attributionPlatformAccountId as
        | string
        | null
        | undefined,
    attributionEventId:
      body.attributionEventId as
        | string
        | null
        | undefined,
    periodStartAt:
      body.periodStartAt as number | undefined,
    periodEndAt:
      body.periodEndAt as number | undefined,
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
  };
}

function parseReplaceTalentKpiMetricsCommand(
  req: Request,
): ReplaceTalentKpiMetricsCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    REPLACE_TALENT_KPI_METRICS_BODY_FIELDS,
    "replaceTalentKpiMetrics",
  );

  return {
    talentKpiRecordId: req.params.talentKpiRecordId,
    metrics:
      body.metrics as ReplaceTalentKpiMetricsCommand["metrics"],
  };
}

function parseFinalizeTalentKpiRecordCommand(
  req: Request,
): FinalizeTalentKpiRecordCommand {
  assertNoUnexpectedFields(
    requireRecord(req.body),
    [],
    "finalizeTalentKpiRecord",
  );

  return {
    talentKpiRecordId: req.params.talentKpiRecordId,
  };
}

function parseArchiveTalentKpiRecordCommand(
  req: Request,
): ArchiveTalentKpiRecordCommand {
  assertNoUnexpectedFields(
    requireRecord(req.body),
    [],
    "archiveTalentKpiRecord",
  );

  return {
    talentKpiRecordId: req.params.talentKpiRecordId,
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
    throw new TalentKpiValidationError(
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

  throw new TalentKpiValidationError(
    `${mutationName} payload contains unsupported field(s): ${unexpectedFields.join(", ")}`,
  );
}
