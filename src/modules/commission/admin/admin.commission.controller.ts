import { Request } from "express";
import { readCommand } from "@app/base/command.middleware";
import { SecureController } from "@app/base/secure-controller.base";
import { PresentationResult } from "@app/base/presentation-result.types";
import { getPresenterRegistryFromRequest } from "@app/presenter/presenter.runtime-access";
import { Actor } from "@core/actor/actor";
import { ContextType } from "@core/context/context.types";
import { SystemInvariantError } from "@core/error/system-error";
import { CommissionValidationError } from "@modules/commission/domain/commission.errors";
import {
  COMMISSION_ADMIN_RULE_MUTATION_PRESENTER_KEY,
  COMMISSION_ADMIN_SETTLEMENT_MUTATION_PRESENTER_KEY,
} from "@modules/commission/shared/commission.presenter-keys";
import {
  ActivateCommissionRuleCommand,
  ArchiveCommissionRuleCommand,
  ArchiveCommissionSettlementCommand,
  CreateCommissionRuleCommand,
  CreateCommissionSettlementCommand,
  DeactivateCommissionRuleCommand,
  FinalizeCommissionSettlementCommand,
  ReplaceCommissionSettlementRevenueEntriesCommand,
  UpdateCommissionRuleDraftCoreCommand,
  UpdateCommissionSettlementDraftCoreCommand,
  VoidCommissionSettlementCommand,
} from "@modules/commission/shared/commission.contracts";
import { CommissionAdminService } from "./admin.commission.service";

type CommissionMutationCommand =
  | "COMMISSION_RULE_CREATE"
  | "COMMISSION_RULE_UPDATE_DRAFT_CORE"
  | "COMMISSION_RULE_ACTIVATE"
  | "COMMISSION_RULE_DEACTIVATE"
  | "COMMISSION_RULE_ARCHIVE"
  | "COMMISSION_SETTLEMENT_CREATE"
  | "COMMISSION_SETTLEMENT_UPDATE_DRAFT_CORE"
  | "COMMISSION_SETTLEMENT_REPLACE_REVENUE_ENTRIES"
  | "COMMISSION_SETTLEMENT_FINALIZE"
  | "COMMISSION_SETTLEMENT_VOID"
  | "COMMISSION_SETTLEMENT_ARCHIVE";

const CREATE_RULE_BODY_FIELDS: readonly string[] =
  Object.freeze([
    "ruleCode",
    "title",
    "settlementKind",
    "beneficiaryKind",
    "beneficiaryEmploymentProfileId",
    "beneficiaryTalentId",
    "sourceContractRecordId",
    "settlementBasis",
    "ratePercent",
    "appliesToRevenueKinds",
    "effectiveStartDate",
    "effectiveEndDate",
    "description",
    "externalRef",
  ]);

const UPDATE_RULE_DRAFT_CORE_BODY_FIELDS: readonly string[] =
  Object.freeze([
    "title",
    "ratePercent",
    "appliesToRevenueKinds",
    "effectiveStartDate",
    "effectiveEndDate",
    "description",
    "externalRef",
  ]);

const CREATE_SETTLEMENT_BODY_FIELDS: readonly string[] =
  Object.freeze([
    "settlementCode",
    "title",
    "sourceRuleId",
    "settlementPeriodStartAt",
    "settlementPeriodEndAt",
    "revenueEntryIds",
    "description",
    "externalRef",
  ]);

const UPDATE_SETTLEMENT_DRAFT_CORE_BODY_FIELDS: readonly string[] =
  Object.freeze([
    "title",
    "settlementPeriodStartAt",
    "settlementPeriodEndAt",
    "description",
    "externalRef",
  ]);

const REPLACE_SETTLEMENT_REVENUE_ENTRIES_BODY_FIELDS: readonly string[] =
  Object.freeze(["revenueEntryIds"]);

export class CommissionAdminController extends SecureController {
  constructor(
    private readonly service: CommissionAdminService,
  ) {
    super();
  }

  protected async handle(
    req: Request,
    actor: Actor,
    _context: ContextType,
  ): Promise<unknown> {
    const command =
      readCommand<CommissionMutationCommand>(req);

    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Commission mutation command missing",
      );
    }

    switch (command) {
      case "COMMISSION_RULE_CREATE":
        return this.service.createCommissionRule(
          actor,
          parseCreateRuleCommand(req),
        );

      case "COMMISSION_RULE_UPDATE_DRAFT_CORE":
        return this.service.updateCommissionRuleDraftCore(
          actor,
          parseUpdateRuleDraftCoreCommand(req),
        );

      case "COMMISSION_RULE_ACTIVATE":
        return this.service.activateCommissionRule(
          actor,
          parseActivateRuleCommand(req),
        );

      case "COMMISSION_RULE_DEACTIVATE":
        return this.service.deactivateCommissionRule(
          actor,
          parseDeactivateRuleCommand(req),
        );

      case "COMMISSION_RULE_ARCHIVE":
        return this.service.archiveCommissionRule(
          actor,
          parseArchiveRuleCommand(req),
        );

      case "COMMISSION_SETTLEMENT_CREATE":
        return this.service.createCommissionSettlement(
          actor,
          parseCreateSettlementCommand(req),
        );

      case "COMMISSION_SETTLEMENT_UPDATE_DRAFT_CORE":
        return this.service.updateCommissionSettlementDraftCore(
          actor,
          parseUpdateSettlementDraftCoreCommand(req),
        );

      case "COMMISSION_SETTLEMENT_REPLACE_REVENUE_ENTRIES":
        return this.service.replaceCommissionSettlementRevenueEntries(
          actor,
          parseReplaceSettlementRevenueEntriesCommand(req),
        );

      case "COMMISSION_SETTLEMENT_FINALIZE":
        return this.service.finalizeCommissionSettlement(
          actor,
          parseFinalizeSettlementCommand(req),
        );

      case "COMMISSION_SETTLEMENT_VOID":
        return this.service.voidCommissionSettlement(
          actor,
          parseVoidSettlementCommand(req),
        );

      case "COMMISSION_SETTLEMENT_ARCHIVE":
        return this.service.archiveCommissionSettlement(
          actor,
          parseArchiveSettlementCommand(req),
        );

      default:
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          `Unsupported commission mutation command: ${command}`,
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
      readCommand<CommissionMutationCommand>(req);

    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Commission mutation command missing",
      );
    }

    const presenterKey = isRuleMutationCommand(command)
      ? COMMISSION_ADMIN_RULE_MUTATION_PRESENTER_KEY
      : COMMISSION_ADMIN_SETTLEMENT_MUTATION_PRESENTER_KEY;

    return getPresenterRegistryFromRequest(req)
      .get<unknown, PresentationResult>(presenterKey)
      .present(result, context);
  }
}

function isRuleMutationCommand(
  command: CommissionMutationCommand,
): boolean {
  return (
    command === "COMMISSION_RULE_CREATE" ||
    command === "COMMISSION_RULE_UPDATE_DRAFT_CORE" ||
    command === "COMMISSION_RULE_ACTIVATE" ||
    command === "COMMISSION_RULE_DEACTIVATE" ||
    command === "COMMISSION_RULE_ARCHIVE"
  );
}

function parseCreateRuleCommand(
  req: Request,
): CreateCommissionRuleCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    CREATE_RULE_BODY_FIELDS,
    "createCommissionRule",
  );

  return {
    ruleCode: body.ruleCode as
      | string
      | null
      | undefined,
    title: body.title as string,
    settlementKind: body.settlementKind as string,
    beneficiaryKind: body.beneficiaryKind as string,
    beneficiaryEmploymentProfileId:
      body.beneficiaryEmploymentProfileId as
        | string
        | null
        | undefined,
    beneficiaryTalentId:
      body.beneficiaryTalentId as
        | string
        | null
        | undefined,
    sourceContractRecordId:
      body.sourceContractRecordId as string,
    settlementBasis: body.settlementBasis as string,
    ratePercent: body.ratePercent as number,
    appliesToRevenueKinds:
      body.appliesToRevenueKinds as readonly string[],
    effectiveStartDate:
      body.effectiveStartDate as number,
    effectiveEndDate:
      body.effectiveEndDate as
        | number
        | null
        | undefined,
    description: body.description as
      | string
      | null
      | undefined,
    externalRef: body.externalRef as
      | string
      | null
      | undefined,
  };
}

function parseUpdateRuleDraftCoreCommand(
  req: Request,
): UpdateCommissionRuleDraftCoreCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    UPDATE_RULE_DRAFT_CORE_BODY_FIELDS,
    "updateCommissionRuleDraftCore",
  );

  return {
    commissionRuleId: req.params.commissionRuleId,
    title: body.title as string | undefined,
    ratePercent: body.ratePercent as number | undefined,
    appliesToRevenueKinds:
      body.appliesToRevenueKinds as
        | readonly string[]
        | undefined,
    effectiveStartDate:
      body.effectiveStartDate as number | undefined,
    effectiveEndDate: body.effectiveEndDate as
      | number
      | null
      | undefined,
    description: body.description as
      | string
      | null
      | undefined,
    externalRef: body.externalRef as
      | string
      | null
      | undefined,
  };
}

function parseActivateRuleCommand(
  req: Request,
): ActivateCommissionRuleCommand {
  assertNoUnexpectedFields(
    requireRecord(req.body),
    [],
    "activateCommissionRule",
  );

  return {
    commissionRuleId: req.params.commissionRuleId,
  };
}

function parseDeactivateRuleCommand(
  req: Request,
): DeactivateCommissionRuleCommand {
  assertNoUnexpectedFields(
    requireRecord(req.body),
    [],
    "deactivateCommissionRule",
  );

  return {
    commissionRuleId: req.params.commissionRuleId,
  };
}

function parseArchiveRuleCommand(
  req: Request,
): ArchiveCommissionRuleCommand {
  assertNoUnexpectedFields(
    requireRecord(req.body),
    [],
    "archiveCommissionRule",
  );

  return {
    commissionRuleId: req.params.commissionRuleId,
  };
}

function parseCreateSettlementCommand(
  req: Request,
): CreateCommissionSettlementCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    CREATE_SETTLEMENT_BODY_FIELDS,
    "createCommissionSettlement",
  );

  return {
    settlementCode: body.settlementCode as
      | string
      | null
      | undefined,
    title: body.title as string,
    sourceRuleId: body.sourceRuleId as string,
    settlementPeriodStartAt:
      body.settlementPeriodStartAt as number,
    settlementPeriodEndAt:
      body.settlementPeriodEndAt as number,
    revenueEntryIds:
      body.revenueEntryIds as readonly string[],
    description: body.description as
      | string
      | null
      | undefined,
    externalRef: body.externalRef as
      | string
      | null
      | undefined,
  };
}

function parseUpdateSettlementDraftCoreCommand(
  req: Request,
): UpdateCommissionSettlementDraftCoreCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    UPDATE_SETTLEMENT_DRAFT_CORE_BODY_FIELDS,
    "updateCommissionSettlementDraftCore",
  );

  return {
    commissionSettlementId:
      req.params.commissionSettlementId,
    title: body.title as string | undefined,
    settlementPeriodStartAt:
      body.settlementPeriodStartAt as
        | number
        | undefined,
    settlementPeriodEndAt:
      body.settlementPeriodEndAt as
        | number
        | undefined,
    description: body.description as
      | string
      | null
      | undefined,
    externalRef: body.externalRef as
      | string
      | null
      | undefined,
  };
}

function parseReplaceSettlementRevenueEntriesCommand(
  req: Request,
): ReplaceCommissionSettlementRevenueEntriesCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    REPLACE_SETTLEMENT_REVENUE_ENTRIES_BODY_FIELDS,
    "replaceCommissionSettlementRevenueEntries",
  );

  return {
    commissionSettlementId:
      req.params.commissionSettlementId,
    revenueEntryIds:
      body.revenueEntryIds as readonly string[],
  };
}

function parseFinalizeSettlementCommand(
  req: Request,
): FinalizeCommissionSettlementCommand {
  assertNoUnexpectedFields(
    requireRecord(req.body),
    [],
    "finalizeCommissionSettlement",
  );

  return {
    commissionSettlementId:
      req.params.commissionSettlementId,
  };
}

function parseVoidSettlementCommand(
  req: Request,
): VoidCommissionSettlementCommand {
  assertNoUnexpectedFields(
    requireRecord(req.body),
    [],
    "voidCommissionSettlement",
  );

  return {
    commissionSettlementId:
      req.params.commissionSettlementId,
  };
}

function parseArchiveSettlementCommand(
  req: Request,
): ArchiveCommissionSettlementCommand {
  assertNoUnexpectedFields(
    requireRecord(req.body),
    [],
    "archiveCommissionSettlement",
  );

  return {
    commissionSettlementId:
      req.params.commissionSettlementId,
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
    throw new CommissionValidationError(
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

  throw new CommissionValidationError(
    `${mutationName} payload contains unsupported field(s): ${unexpectedFields.join(", ")}`,
  );
}
