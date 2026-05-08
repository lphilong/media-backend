import { Request } from "express";
import { readCommand } from "@app/base/command.middleware";
import { SecureController } from "@app/base/secure-controller.base";
import { PresentationResult } from "@app/base/presentation-result.types";
import { getPresenterRegistryFromRequest } from "@app/presenter/presenter.runtime-access";
import { Actor } from "@core/actor/actor";
import { ContextType } from "@core/context/context.types";
import { SystemInvariantError } from "@core/error/system-error";
import { RevenueLedgerValidationError } from "@modules/revenue-ledger/domain/revenue-ledger.errors";
import { REVENUE_LEDGER_ADMIN_MUTATION_PRESENTER_KEY } from "@modules/revenue-ledger/shared/revenue-ledger.presenter-keys";
import {
  ArchiveRevenueEntryCommand,
  CreateRevenueEntryCommand,
  FinalizeRevenueEntryCommand,
  ReconcileRevenueEntryCommand,
  UpdateRevenueEntryDraftCoreCommand,
  VoidRevenueEntryCommand,
} from "@modules/revenue-ledger/shared/revenue-ledger.contracts";
import { RevenueLedgerAdminService } from "./admin.revenue-ledger.service";

type RevenueLedgerMutationCommand =
  | "REVENUE_ENTRY_CREATE"
  | "REVENUE_ENTRY_UPDATE_DRAFT_CORE"
  | "REVENUE_ENTRY_FINALIZE"
  | "REVENUE_ENTRY_RECONCILE"
  | "REVENUE_ENTRY_VOID"
  | "REVENUE_ENTRY_ARCHIVE";

const CREATE_REVENUE_ENTRY_BODY_FIELDS: readonly string[] =
  Object.freeze([
    "revenueEntryCode",
    "title",
    "subjectTalentId",
    "attributionPlatformAccountId",
    "attributionEventId",
    "revenueKind",
    "entrySource",
    "currencyCode",
    "recognizedAmount",
    "recognizedAt",
    "description",
    "externalRef",
  ]);

const UPDATE_REVENUE_ENTRY_DRAFT_CORE_BODY_FIELDS: readonly string[] =
  Object.freeze([
    "title",
    "description",
    "externalRef",
    "subjectTalentId",
    "attributionPlatformAccountId",
    "attributionEventId",
    "revenueKind",
    "currencyCode",
    "recognizedAmount",
    "recognizedAt",
  ]);

const RECONCILE_REVENUE_ENTRY_BODY_FIELDS: readonly string[] =
  Object.freeze(["reconciliationReference"]);

export class RevenueLedgerAdminController extends SecureController {
  constructor(
    private readonly service: RevenueLedgerAdminService,
  ) {
    super();
  }

  protected async handle(
    req: Request,
    actor: Actor,
    _context: ContextType,
  ): Promise<unknown> {
    const command =
      readCommand<RevenueLedgerMutationCommand>(req);

    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Revenue Ledger mutation command missing",
      );
    }

    switch (command) {
      case "REVENUE_ENTRY_CREATE":
        return this.service.createRevenueEntry(
          actor,
          parseCreateRevenueEntryCommand(req),
        );

      case "REVENUE_ENTRY_UPDATE_DRAFT_CORE":
        return this.service.updateRevenueEntryDraftCore(
          actor,
          parseUpdateRevenueEntryDraftCoreCommand(req),
        );

      case "REVENUE_ENTRY_FINALIZE":
        return this.service.finalizeRevenueEntry(
          actor,
          parseFinalizeRevenueEntryCommand(req),
        );

      case "REVENUE_ENTRY_RECONCILE":
        return this.service.reconcileRevenueEntry(
          actor,
          parseReconcileRevenueEntryCommand(req),
        );

      case "REVENUE_ENTRY_VOID":
        return this.service.voidRevenueEntry(
          actor,
          parseVoidRevenueEntryCommand(req),
        );

      case "REVENUE_ENTRY_ARCHIVE":
        return this.service.archiveRevenueEntry(
          actor,
          parseArchiveRevenueEntryCommand(req),
        );

      default:
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          `Unsupported revenue ledger mutation command: ${command}`,
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
        REVENUE_LEDGER_ADMIN_MUTATION_PRESENTER_KEY,
      )
      .present(result, context);
  }
}

function parseCreateRevenueEntryCommand(
  req: Request,
): CreateRevenueEntryCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    CREATE_REVENUE_ENTRY_BODY_FIELDS,
    "createRevenueEntry",
  );

  return {
    revenueEntryCode:
      body.revenueEntryCode as string,
    title: body.title as string,
    subjectTalentId: body.subjectTalentId as string,
    attributionPlatformAccountId:
      body.attributionPlatformAccountId as
        | string
        | null
        | undefined,
    attributionEventId: body.attributionEventId as
      | string
      | null
      | undefined,
    revenueKind: body.revenueKind as string,
    entrySource: body.entrySource as string,
    currencyCode: body.currencyCode as string,
    recognizedAmount:
      body.recognizedAmount as number,
    recognizedAt: body.recognizedAt as number,
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

function parseUpdateRevenueEntryDraftCoreCommand(
  req: Request,
): UpdateRevenueEntryDraftCoreCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    UPDATE_REVENUE_ENTRY_DRAFT_CORE_BODY_FIELDS,
    "updateRevenueEntryDraftCore",
  );

  return {
    revenueEntryId: req.params.revenueEntryId,
    title: body.title as string | undefined,
    description: body.description as
      | string
      | null
      | undefined,
    externalRef: body.externalRef as
      | string
      | null
      | undefined,
    subjectTalentId:
      body.subjectTalentId as string | undefined,
    attributionPlatformAccountId:
      body.attributionPlatformAccountId as
        | string
        | null
        | undefined,
    attributionEventId: body.attributionEventId as
      | string
      | null
      | undefined,
    revenueKind: body.revenueKind as
      | string
      | undefined,
    currencyCode:
      body.currencyCode as string | undefined,
    recognizedAmount:
      body.recognizedAmount as number | undefined,
    recognizedAt:
      body.recognizedAt as number | undefined,
  };
}

function parseFinalizeRevenueEntryCommand(
  req: Request,
): FinalizeRevenueEntryCommand {
  assertNoUnexpectedFields(
    requireRecord(req.body),
    [],
    "finalizeRevenueEntry",
  );

  return {
    revenueEntryId: req.params.revenueEntryId,
  };
}

function parseReconcileRevenueEntryCommand(
  req: Request,
): ReconcileRevenueEntryCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    RECONCILE_REVENUE_ENTRY_BODY_FIELDS,
    "reconcileRevenueEntry",
  );

  return {
    revenueEntryId: req.params.revenueEntryId,
    reconciliationReference:
      body.reconciliationReference as
        | string
        | null
        | undefined,
  };
}

function parseVoidRevenueEntryCommand(
  req: Request,
): VoidRevenueEntryCommand {
  assertNoUnexpectedFields(
    requireRecord(req.body),
    [],
    "voidRevenueEntry",
  );

  return {
    revenueEntryId: req.params.revenueEntryId,
  };
}

function parseArchiveRevenueEntryCommand(
  req: Request,
): ArchiveRevenueEntryCommand {
  assertNoUnexpectedFields(
    requireRecord(req.body),
    [],
    "archiveRevenueEntry",
  );

  return {
    revenueEntryId: req.params.revenueEntryId,
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
    throw new RevenueLedgerValidationError(
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

  throw new RevenueLedgerValidationError(
    `${mutationName} payload contains unsupported field(s): ${unexpectedFields.join(", ")}`,
  );
}
