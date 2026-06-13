import { Request } from "express";
import { readCommand } from "@app/base/command.middleware";
import { SecureController } from "@app/base/secure-controller.base";
import {
  PresentationResult,
  PlainObject,
  toPlainObject,
} from "@app/base/presentation-result.types";
import { Actor } from "@core/actor/actor";
import { ContextType } from "@core/context/context.types";
import { SystemInvariantError } from "@core/error/system-error";
import { RevenueLedgerValidationError } from "@modules/revenue-ledger/domain/revenue-ledger.errors";
import {
  ApprovePlatformEarningBatchCommand,
  CreatePlatformEarningBatchCommand,
  CreateRevenueEntryFromPlatformEarningBatchCommand,
  RejectPlatformEarningBatchCommand,
  UpdatePlatformEarningBatchCommand,
  UpdatePlatformEarningLineCommand,
  UpsertPlatformEarningLineCommand,
  VoidPlatformEarningBatchCommand,
} from "@modules/revenue-ledger/shared/platform-earning.contracts";
import { PlatformEarningAdminService } from "./admin.platform-earning.service";

type PlatformEarningCommand =
  | "PLATFORM_EARNING_BATCH_CREATE"
  | "PLATFORM_EARNING_BATCH_UPDATE"
  | "PLATFORM_EARNING_LINE_ADD"
  | "PLATFORM_EARNING_LINE_UPDATE"
  | "PLATFORM_EARNING_BATCH_SUBMIT"
  | "PLATFORM_EARNING_BATCH_START_REVIEW"
  | "PLATFORM_EARNING_BATCH_APPROVE"
  | "PLATFORM_EARNING_BATCH_REJECT"
  | "PLATFORM_EARNING_BATCH_VOID"
  | "PLATFORM_EARNING_BATCH_ARCHIVE"
  | "PLATFORM_EARNING_BATCH_CREATE_REVENUE_ENTRY"
  | "PLATFORM_EARNING_BATCH_GET"
  | "PLATFORM_EARNING_BATCH_LIST"
  | "PLATFORM_EARNING_LINE_LIST";

export class PlatformEarningAdminController extends SecureController {
  constructor(
    private readonly service: PlatformEarningAdminService,
  ) {
    super();
  }

  protected async handle(
    req: Request,
    actor: Actor,
    _context: ContextType,
  ): Promise<unknown> {
    const command =
      readCommand<PlatformEarningCommand>(req);

    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Platform earning command missing",
      );
    }

    switch (command) {
      case "PLATFORM_EARNING_BATCH_CREATE":
        return this.service.createBatch(
          actor,
          readBody(req) as unknown as CreatePlatformEarningBatchCommand,
        );
      case "PLATFORM_EARNING_BATCH_UPDATE":
        return this.service.updateBatch(actor, {
          ...(readBody(req) as Record<string, unknown>),
          batchId: req.params.batchId,
        } as unknown as UpdatePlatformEarningBatchCommand);
      case "PLATFORM_EARNING_LINE_ADD":
        return this.service.addLine(actor, {
          ...(readBody(req) as Record<string, unknown>),
          batchId: req.params.batchId,
        } as unknown as UpsertPlatformEarningLineCommand);
      case "PLATFORM_EARNING_LINE_UPDATE":
        return this.service.updateLine(actor, {
          ...(readBody(req) as Record<string, unknown>),
          batchId: req.params.batchId,
          lineId: req.params.lineId,
        } as unknown as UpdatePlatformEarningLineCommand);
      case "PLATFORM_EARNING_BATCH_SUBMIT":
        return this.service.submitBatch(actor, {
          batchId: req.params.batchId,
        });
      case "PLATFORM_EARNING_BATCH_START_REVIEW":
        return this.service.startReview(actor, {
          batchId: req.params.batchId,
        });
      case "PLATFORM_EARNING_BATCH_APPROVE":
        return this.service.approveBatch(actor, {
          ...(readBody(req) as Record<string, unknown>),
          batchId: req.params.batchId,
        } as unknown as ApprovePlatformEarningBatchCommand);
      case "PLATFORM_EARNING_BATCH_REJECT":
        return this.service.rejectBatch(actor, {
          ...(readBody(req) as Record<string, unknown>),
          batchId: req.params.batchId,
        } as unknown as RejectPlatformEarningBatchCommand);
      case "PLATFORM_EARNING_BATCH_VOID":
        return this.service.voidBatch(actor, {
          ...(readBody(req) as Record<string, unknown>),
          batchId: req.params.batchId,
        } as unknown as VoidPlatformEarningBatchCommand);
      case "PLATFORM_EARNING_BATCH_ARCHIVE":
        return this.service.archiveBatch(actor, {
          batchId: req.params.batchId,
        });
      case "PLATFORM_EARNING_BATCH_CREATE_REVENUE_ENTRY":
        return this.service.createRevenueEntry(actor, {
          ...(readBody(req) as Record<string, unknown>),
          batchId: req.params.batchId,
        } as unknown as CreateRevenueEntryFromPlatformEarningBatchCommand);
      case "PLATFORM_EARNING_BATCH_GET":
        return this.service.getBatch(
          actor,
          req.params.batchId,
        );
      case "PLATFORM_EARNING_BATCH_LIST":
        return this.service.listBatches(
          actor,
          req.query,
        );
      case "PLATFORM_EARNING_LINE_LIST":
        return this.service.listLines(actor, {
          ...req.query,
          batchId: req.params.batchId,
        });
      default:
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          `Unsupported platform earning command: ${command}`,
        );
    }
  }

  protected async present(
    result: unknown,
    _req: Request,
    _actor: Actor,
    _context: ContextType,
  ): Promise<PresentationResult> {
    if (isListResult(result)) {
      return {
        data: result.items.map((item) =>
          toPlainObject(item, "platform earning item"),
        ),
        meta: toPlainObject(
          {
            nextCursor: result.nextCursor ?? null,
          },
          "platform earning list meta",
        ),
      };
    }

    return {
      data: toPlainObject(
        result,
        "platform earning result",
      ),
    };
  }
}

function readBody(req: Request): Record<string, unknown> {
  if (
    typeof req.body !== "object" ||
    req.body === null ||
    Array.isArray(req.body)
  ) {
    throw new RevenueLedgerValidationError(
      "request body must be an object",
    );
  }
  return req.body as Record<string, unknown>;
}

function isListResult(
  value: unknown,
): value is {
  readonly items: readonly PlainObject[];
  readonly nextCursor?: string;
} {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray(
      (value as { readonly items?: unknown }).items,
    )
  );
}
