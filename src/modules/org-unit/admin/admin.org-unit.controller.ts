import { Request } from "express";
import { readCommand } from "@app/base/command.middleware";
import { SecureController } from "@app/base/secure-controller.base";
import { PresentationResult } from "@app/base/presentation-result.types";
import { getPresenterRegistryFromRequest } from "@app/presenter/presenter.runtime-access";
import { Actor } from "@core/actor/actor";
import { ContextType } from "@core/context/context.types";
import { SystemInvariantError } from "@core/error/system-error";
import {
  ORG_UNIT_ADMIN_MUTATION_PRESENTER_KEY,
} from "@modules/org-unit/shared/org-unit.presenter-keys";
import {
  ActivateOrgUnitCommand,
  ArchiveOrgUnitCommand,
  CreateOrgUnitCommand,
  DeactivateOrgUnitCommand,
  MoveOrgUnitCommand,
  UpdateOrgUnitProfileCommand,
} from "@modules/org-unit/shared/org-unit.contracts";
import { OrgUnitValidationError } from "@modules/org-unit/domain/org-unit.errors";
import { OrgUnitAdminService } from "./admin.org-unit.service";

type OrgUnitMutationCommand =
  | "ORG_UNIT_CREATE"
  | "ORG_UNIT_UPDATE_PROFILE"
  | "ORG_UNIT_MOVE"
  | "ORG_UNIT_ACTIVATE"
  | "ORG_UNIT_DEACTIVATE"
  | "ORG_UNIT_ARCHIVE";

export class OrgUnitAdminController extends SecureController {
  constructor(
    private readonly service: OrgUnitAdminService,
  ) {
    super();
  }

  protected async handle(
    req: Request,
    actor: Actor,
    _context: ContextType,
  ): Promise<unknown> {
    const command =
      readCommand<OrgUnitMutationCommand>(req);

    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Org unit mutation command missing",
      );
    }

    switch (command) {
      case "ORG_UNIT_CREATE":
        return this.service.createOrgUnit(
          actor,
          parseCreateOrgUnitCommand(req),
        );

      case "ORG_UNIT_UPDATE_PROFILE":
        return this.service.updateOrgUnitProfile(
          actor,
          parseUpdateOrgUnitProfileCommand(req),
        );

      case "ORG_UNIT_MOVE":
        return this.service.moveOrgUnit(
          actor,
          parseMoveOrgUnitCommand(req),
        );

      case "ORG_UNIT_ACTIVATE":
        return this.service.activateOrgUnit(
          actor,
          parseActivateOrgUnitCommand(req),
        );

      case "ORG_UNIT_DEACTIVATE":
        return this.service.deactivateOrgUnit(
          actor,
          parseDeactivateOrgUnitCommand(req),
        );

      case "ORG_UNIT_ARCHIVE":
        return this.service.archiveOrgUnit(
          actor,
          parseArchiveOrgUnitCommand(req),
        );

      default:
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          `Unsupported org unit mutation command: ${command}`,
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
        ORG_UNIT_ADMIN_MUTATION_PRESENTER_KEY,
      )
      .present(result, context);
  }
}

function parseCreateOrgUnitCommand(
  req: Request,
): CreateOrgUnitCommand {
  const body = requireRecord(req.body);
  assertAllowedBodyFields(
    body,
    [
      "code",
      "name",
      "type",
      "parentOrgUnitId",
      "description",
      "displayOrder",
      "externalRef",
    ],
    "createOrgUnit",
  );

  return {
    code: body.code as string,
    name: body.name as string,
    type: body.type as CreateOrgUnitCommand["type"],
    parentOrgUnitId:
      body.parentOrgUnitId as
        | string
        | null
        | undefined,
    description:
      body.description as
        | string
        | null
        | undefined,
    displayOrder:
      body.displayOrder as number | string,
    externalRef:
      body.externalRef as
        | string
        | null
        | undefined,
  };
}

function parseUpdateOrgUnitProfileCommand(
  req: Request,
): UpdateOrgUnitProfileCommand {
  const body = requireRecord(req.body);
  assertAllowedBodyFields(
    body,
    [
      "name",
      "description",
      "displayOrder",
      "externalRef",
    ],
    "updateOrgUnitProfile",
  );

  return {
    orgUnitId: req.params.orgUnitId,
    name: body.name as string | undefined,
    description:
      body.description as
        | string
        | null
        | undefined,
    displayOrder:
      body.displayOrder as
        | number
        | string
        | undefined,
    externalRef:
      body.externalRef as
        | string
        | null
        | undefined,
  };
}

function parseMoveOrgUnitCommand(
  req: Request,
): MoveOrgUnitCommand {
  const body = requireRecord(req.body);
  assertAllowedBodyFields(
    body,
    ["newParentOrgUnitId"],
    "moveOrgUnit",
  );

  return {
    orgUnitId: req.params.orgUnitId,
    newParentOrgUnitId:
      body.newParentOrgUnitId as
        | string
        | null,
  };
}

function parseActivateOrgUnitCommand(
  req: Request,
): ActivateOrgUnitCommand {
  assertAllowedBodyFields(
    requireRecord(req.body),
    [],
    "activateOrgUnit",
  );

  return {
    orgUnitId: req.params.orgUnitId,
  };
}

function parseDeactivateOrgUnitCommand(
  req: Request,
): DeactivateOrgUnitCommand {
  assertAllowedBodyFields(
    requireRecord(req.body),
    [],
    "deactivateOrgUnit",
  );

  return {
    orgUnitId: req.params.orgUnitId,
  };
}

function parseArchiveOrgUnitCommand(
  req: Request,
): ArchiveOrgUnitCommand {
  assertAllowedBodyFields(
    requireRecord(req.body),
    [],
    "archiveOrgUnit",
  );

  return {
    orgUnitId: req.params.orgUnitId,
  };
}

function requireRecord(
  value: unknown,
): Record<string, unknown> {
  if (value === undefined) {
    return {};
  }

  if (!isPlainObject(value)) {
    throw new OrgUnitValidationError(
      "Request body must be a plain object",
    );
  }

  return value;
}

function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return (
    prototype === Object.prototype ||
    prototype === null
  );
}

function assertAllowedBodyFields(
  body: Record<string, unknown>,
  allowedKeys: readonly string[],
  commandName: string,
): void {
  const allowed = new Set(allowedKeys);
  const unexpected = Object.keys(body).filter(
    (key) => !allowed.has(key),
  );

  if (unexpected.length === 0) {
    return;
  }

  throw new OrgUnitValidationError(
    `${commandName} contains unsupported fields: ${unexpected.join(", ")}`,
  );
}
