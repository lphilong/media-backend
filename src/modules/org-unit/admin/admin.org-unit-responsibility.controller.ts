import { Request } from "express";
import { readCommand } from "@app/base/command.middleware";
import { SecureController } from "@app/base/secure-controller.base";
import { PresentationResult } from "@app/base/presentation-result.types";
import { getPresenterRegistryFromRequest } from "@app/presenter/presenter.runtime-access";
import { Actor } from "@core/actor/actor";
import { ContextType } from "@core/context/context.types";
import { SystemInvariantError } from "@core/error/system-error";
import { OrgUnitValidationError } from "@modules/org-unit/domain/org-unit.errors";
import {
  ORG_UNIT_ADMIN_MUTATION_PRESENTER_KEY,
  ORG_UNIT_ADMIN_RESPONSIBILITY_LIST_PRESENTER_KEY,
} from "@modules/org-unit/shared/org-unit.presenter-keys";
import {
  CreateOrgUnitResponsibilityCommand,
  RevokeOrgUnitResponsibilityCommand,
  UpdateOrgUnitResponsibilityCommand,
} from "@modules/org-unit/shared/org-unit.contracts";
import { OrgUnitResponsibilityAdminService } from "./admin.org-unit-responsibility.service";

type OrgUnitResponsibilityCommand =
  | "ORG_UNIT_RESPONSIBILITY_LIST"
  | "ORG_UNIT_RESPONSIBILITY_CREATE"
  | "ORG_UNIT_RESPONSIBILITY_UPDATE"
  | "ORG_UNIT_RESPONSIBILITY_REVOKE";

const CREATE_RESPONSIBILITY_BODY_FIELDS: readonly string[] = Object.freeze([
  "managerEmploymentProfileId",
  "role",
  "includeDescendants",
  "effectiveFrom",
  "effectiveTo",
  "isPrimary",
]);

const UPDATE_RESPONSIBILITY_BODY_FIELDS: readonly string[] = Object.freeze([
  "role",
  "includeDescendants",
  "effectiveFrom",
  "effectiveTo",
  "isPrimary",
]);

export class OrgUnitResponsibilityAdminController extends SecureController {
  constructor(private readonly service: OrgUnitResponsibilityAdminService) {
    super();
  }

  protected async handle(
    req: Request,
    actor: Actor,
    _context: ContextType,
  ): Promise<unknown> {
    const command = readCommand<OrgUnitResponsibilityCommand>(req);
    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Org unit responsibility command missing",
      );
    }

    switch (command) {
      case "ORG_UNIT_RESPONSIBILITY_LIST":
        assertNoUnexpectedFields(
          req.query as Record<string, unknown>,
          [],
          "listOrgUnitResponsibilities",
        );
        return this.service.listResponsibilities(actor, {
          orgUnitId: req.params.orgUnitId,
        });

      case "ORG_UNIT_RESPONSIBILITY_CREATE":
        return this.service.createResponsibility(
          actor,
          parseCreateResponsibilityCommand(req),
        );

      case "ORG_UNIT_RESPONSIBILITY_UPDATE":
        return this.service.updateResponsibility(
          actor,
          parseUpdateResponsibilityCommand(req),
        );

      case "ORG_UNIT_RESPONSIBILITY_REVOKE":
        assertNoUnexpectedFields(
          requireRecord(req.body),
          ["reason"],
          "revokeOrgUnitResponsibility",
        );
        return this.service.revokeResponsibility(
          actor,
          parseRevokeResponsibilityCommand(req),
        );

      default:
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          `Unsupported org unit responsibility command: ${command}`,
        );
    }
  }

  protected async present(
    result: unknown,
    req: Request,
    _actor: Actor,
    context: ContextType,
  ): Promise<PresentationResult> {
    const command = readCommand<OrgUnitResponsibilityCommand>(req);
    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Org unit responsibility command missing",
      );
    }

    const key =
      command === "ORG_UNIT_RESPONSIBILITY_LIST"
        ? ORG_UNIT_ADMIN_RESPONSIBILITY_LIST_PRESENTER_KEY
        : ORG_UNIT_ADMIN_MUTATION_PRESENTER_KEY;

    return getPresenterRegistryFromRequest(req)
      .get<unknown, PresentationResult>(key)
      .present(result, context);
  }
}

function parseCreateResponsibilityCommand(
  req: Request,
): CreateOrgUnitResponsibilityCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    CREATE_RESPONSIBILITY_BODY_FIELDS,
    "createOrgUnitResponsibility",
  );

  return {
    orgUnitId: req.params.orgUnitId,
    managerEmploymentProfileId: body.managerEmploymentProfileId as string,
    role: body.role as string,
    includeDescendants: body.includeDescendants as boolean | undefined,
    effectiveFrom: body.effectiveFrom as number | string | null | undefined,
    effectiveTo: body.effectiveTo as number | string | null | undefined,
    isPrimary: body.isPrimary as boolean | undefined,
  };
}

function parseUpdateResponsibilityCommand(
  req: Request,
): UpdateOrgUnitResponsibilityCommand {
  const body = requireRecord(req.body);
  assertNoUnexpectedFields(
    body,
    UPDATE_RESPONSIBILITY_BODY_FIELDS,
    "updateOrgUnitResponsibility",
  );

  return {
    orgUnitId: req.params.orgUnitId,
    assignmentId: req.params.assignmentId,
    role: body.role as string | undefined,
    includeDescendants: body.includeDescendants as boolean | undefined,
    effectiveFrom: body.effectiveFrom as number | string | null | undefined,
    effectiveTo: body.effectiveTo as number | string | null | undefined,
    isPrimary: body.isPrimary as boolean | undefined,
  };
}

function parseRevokeResponsibilityCommand(
  req: Request,
): RevokeOrgUnitResponsibilityCommand {
  return {
    orgUnitId: req.params.orgUnitId,
    assignmentId: req.params.assignmentId,
    reason: requireRecord(req.body).reason as string,
  };
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (value === undefined) {
    return {};
  }
  if (!isPlainObject(value)) {
    throw new OrgUnitValidationError("Request body must be a plain object");
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertNoUnexpectedFields(
  body: Record<string, unknown>,
  allowedFields: readonly string[],
  operation: string,
): void {
  const unexpectedFields = Object.keys(body).filter(
    (field) => !allowedFields.includes(field),
  );
  if (unexpectedFields.length > 0) {
    throw new OrgUnitValidationError(
      `${operation} payload contains unsupported field(s): ${unexpectedFields.join(", ")}`,
    );
  }
}
