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
  CONTRACT_OBLIGATION_EVENT_EVIDENCE_LINK_ADMIN_DETAIL_PRESENTER_KEY,
  CONTRACT_OBLIGATION_EVENT_EVIDENCE_LINK_ADMIN_LIST_PRESENTER_KEY,
  CONTRACT_OBLIGATION_EVENT_EVIDENCE_LINK_ADMIN_MUTATION_PRESENTER_KEY,
} from "../shared/contract-registry.presenter-keys";
import { ContractObligationEventEvidenceLinkAdminQueryService } from "./admin.contract-obligation-event-evidence-link.query-service";
import { ContractObligationEventEvidenceLinkAdminService } from "./admin.contract-obligation-event-evidence-link.service";

type Command =
  | "CONTRACT_OBLIGATION_EVENT_EVIDENCE_LINK"
  | "CONTRACT_OBLIGATION_EVENT_EVIDENCE_REMOVE"
  | "CONTRACT_OBLIGATION_EVENT_EVIDENCE_LIST"
  | "CONTRACT_OBLIGATION_EVENT_EVIDENCE_GET_DETAIL";

export class ContractObligationEventEvidenceLinkAdminController extends SecureController {
  constructor(
    private readonly service: ContractObligationEventEvidenceLinkAdminService,
    private readonly queryService: ContractObligationEventEvidenceLinkAdminQueryService,
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
        "Contract obligation event evidence link command missing",
      );
    }
    const body = requireRecord(req.body);

    switch (command) {
      case "CONTRACT_OBLIGATION_EVENT_EVIDENCE_LINK":
        assertFields(body, ["eventId", "linkReason"]);
        return this.service.link(actor, {
          contractObligationId: req.params.obligationId,
          eventId: body.eventId as string,
          linkReason: body.linkReason as string,
        });

      case "CONTRACT_OBLIGATION_EVENT_EVIDENCE_REMOVE":
        assertFields(body, ["removeReason"]);
        return this.service.remove(actor, {
          linkId: req.params.linkId,
          removeReason: body.removeReason as string,
        });

      case "CONTRACT_OBLIGATION_EVENT_EVIDENCE_LIST":
        assertQueryFields(req, ["status", "limit", "cursor"]);
        return this.queryService.list(actor, {
          contractObligationId: req.params.obligationId,
          status: req.query.status as string,
          limit: req.query.limit as string,
          cursor: req.query.cursor as string,
        });

      case "CONTRACT_OBLIGATION_EVENT_EVIDENCE_GET_DETAIL":
        assertQueryFields(req, []);
        return this.queryService.get(actor, {
          linkId: req.params.linkId,
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
      command === "CONTRACT_OBLIGATION_EVENT_EVIDENCE_LIST"
        ? CONTRACT_OBLIGATION_EVENT_EVIDENCE_LINK_ADMIN_LIST_PRESENTER_KEY
        : command ===
            "CONTRACT_OBLIGATION_EVENT_EVIDENCE_GET_DETAIL"
          ? CONTRACT_OBLIGATION_EVENT_EVIDENCE_LINK_ADMIN_DETAIL_PRESENTER_KEY
          : CONTRACT_OBLIGATION_EVENT_EVIDENCE_LINK_ADMIN_MUTATION_PRESENTER_KEY;
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
