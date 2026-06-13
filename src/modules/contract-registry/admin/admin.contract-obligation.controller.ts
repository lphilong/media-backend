import { Request } from "express";
import { readCommand } from "@app/base/command.middleware";
import { PresentationResult } from "@app/base/presentation-result.types";
import { SecureController } from "@app/base/secure-controller.base";
import { getPresenterRegistryFromRequest } from "@app/presenter/presenter.runtime-access";
import { Actor } from "@core/actor/actor";
import { ContextType } from "@core/context/context.types";
import { SystemInvariantError } from "@core/error/system-error";
import { ContractObligationValidationError } from "../domain/contract-registry.errors";
import {
  CONTRACT_OBLIGATION_ADMIN_DETAIL_PRESENTER_KEY,
  CONTRACT_OBLIGATION_ADMIN_LIST_PRESENTER_KEY,
  CONTRACT_OBLIGATION_ADMIN_MUTATION_PRESENTER_KEY,
} from "../shared/contract-registry.presenter-keys";
import { ContractObligationAdminQueryService } from "./admin.contract-obligation.query-service";
import { ContractObligationAdminService } from "./admin.contract-obligation.service";

type Command =
  | "CONTRACT_OBLIGATION_CREATE"
  | "CONTRACT_OBLIGATION_UPDATE"
  | "CONTRACT_OBLIGATION_OPEN"
  | "CONTRACT_OBLIGATION_DELIVER"
  | "CONTRACT_OBLIGATION_REJECT"
  | "CONTRACT_OBLIGATION_REOPEN"
  | "CONTRACT_OBLIGATION_ACCEPT"
  | "CONTRACT_OBLIGATION_CANCEL"
  | "CONTRACT_OBLIGATION_ARCHIVE"
  | "CONTRACT_OBLIGATION_LIST"
  | "CONTRACT_OBLIGATION_GET_DETAIL";

export class ContractObligationAdminController extends SecureController {
  constructor(
    private readonly service: ContractObligationAdminService,
    private readonly queryService: ContractObligationAdminQueryService,
  ) {
    super();
  }

  protected async handle(
    req: Request,
    actor: Actor,
  ): Promise<unknown> {
    const command = readCommand<Command>(req);
    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Contract obligation command missing",
      );
    }
    const body = requireRecord(req.body);

    switch (command) {
      case "CONTRACT_OBLIGATION_CREATE":
        assertFields(body, [
          "obligationType",
          "title",
          "description",
          "dueDate",
          "responsibleOwnerEmploymentProfileId",
          "evidencePolicy",
        ]);
        return this.service.create(actor, {
          contractRecordId: req.params.contractRecordId,
          obligationType: body.obligationType as string,
          title: body.title as string,
          description: body.description as string | null,
          dueDate: body.dueDate as string | null,
          responsibleOwnerEmploymentProfileId:
            body.responsibleOwnerEmploymentProfileId as string,
          evidencePolicy: body.evidencePolicy as string,
        });

      case "CONTRACT_OBLIGATION_UPDATE":
        assertFields(body, [
          "obligationType",
          "title",
          "description",
          "dueDate",
          "responsibleOwnerEmploymentProfileId",
          "evidencePolicy",
        ]);
        return this.service.update(actor, {
          obligationId: req.params.obligationId,
          obligationType: body.obligationType as string,
          title: body.title as string,
          description: body.description as string | null,
          dueDate: body.dueDate as string | null,
          responsibleOwnerEmploymentProfileId:
            body.responsibleOwnerEmploymentProfileId as string,
          evidencePolicy: body.evidencePolicy as string,
        });

      case "CONTRACT_OBLIGATION_OPEN":
        assertFields(body, []);
        return this.service.open(actor, {
          obligationId: req.params.obligationId,
        });

      case "CONTRACT_OBLIGATION_DELIVER":
        assertFields(body, [
          "deliveryNote",
          "evidenceRefs",
        ]);
        return this.service.deliver(actor, {
          obligationId: req.params.obligationId,
          deliveryNote: body.deliveryNote as string | null,
          evidenceRefs: body.evidenceRefs as never,
        });

      case "CONTRACT_OBLIGATION_REJECT":
        assertFields(body, ["reason"]);
        return this.service.reject(actor, {
          obligationId: req.params.obligationId,
          reason: body.reason as string,
        });

      case "CONTRACT_OBLIGATION_REOPEN":
        assertFields(body, ["reason"]);
        return this.service.reopen(actor, {
          obligationId: req.params.obligationId,
          reason: body.reason as string,
        });

      case "CONTRACT_OBLIGATION_ACCEPT":
        assertFields(body, ["reviewNote"]);
        return this.service.accept(actor, {
          obligationId: req.params.obligationId,
          reviewNote: body.reviewNote as string | null,
        });

      case "CONTRACT_OBLIGATION_CANCEL":
        assertFields(body, ["reason"]);
        return this.service.cancel(actor, {
          obligationId: req.params.obligationId,
          reason: body.reason as string,
        });

      case "CONTRACT_OBLIGATION_ARCHIVE":
        assertFields(body, ["reason"]);
        return this.service.archive(actor, {
          obligationId: req.params.obligationId,
          reason: body.reason as string | null,
        });

      case "CONTRACT_OBLIGATION_LIST":
        assertQueryFields(req, ["status", "limit", "cursor"]);
        return this.queryService.list(actor, {
          contractRecordId: req.params.contractRecordId,
          status: req.query.status as string,
          limit: req.query.limit as string,
          cursor: req.query.cursor as string,
        });

      case "CONTRACT_OBLIGATION_GET_DETAIL":
        assertQueryFields(req, []);
        return this.queryService.get(actor, {
          obligationId: req.params.obligationId,
        });
    }
  }

  protected async present(
    result: unknown,
    req: Request,
    _actor: Actor,
    context: ContextType,
  ): Promise<PresentationResult> {
    const command = readCommand<Command>(req);
    const key =
      command === "CONTRACT_OBLIGATION_LIST"
        ? CONTRACT_OBLIGATION_ADMIN_LIST_PRESENTER_KEY
        : command === "CONTRACT_OBLIGATION_GET_DETAIL"
          ? CONTRACT_OBLIGATION_ADMIN_DETAIL_PRESENTER_KEY
          : CONTRACT_OBLIGATION_ADMIN_MUTATION_PRESENTER_KEY;
    return getPresenterRegistryFromRequest(req)
      .get<unknown, PresentationResult>(key)
      .present(result, context);
  }
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (value === undefined) {
    return {};
  }
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new ContractObligationValidationError(
      "Request body must be a plain object",
    );
  }
  return value as Record<string, unknown>;
}

function assertFields(
  input: Record<string, unknown>,
  allowed: readonly string[],
): void {
  const unexpected = Object.keys(input).filter(
    (field) => !allowed.includes(field),
  );
  if (unexpected.length > 0) {
    throw new ContractObligationValidationError(
      `Payload contains unsupported field(s): ${unexpected.join(", ")}`,
    );
  }
}

function assertQueryFields(
  req: Request,
  allowed: readonly string[],
): void {
  const unexpected = Object.keys(req.query).filter(
    (field) => !allowed.includes(field),
  );
  if (unexpected.length > 0) {
    throw new ContractObligationValidationError(
      `Query contains unsupported field(s): ${unexpected.join(", ")}`,
    );
  }
}
