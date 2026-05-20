import { Request } from "express";
import { readCommand } from "@app/base/command.middleware";
import { SecureController } from "@app/base/secure-controller.base";
import { PresentationResult } from "@app/base/presentation-result.types";
import { getPresenterRegistryFromRequest } from "@app/presenter/presenter.runtime-access";
import { Actor } from "@core/actor/actor";
import { ContextType } from "@core/context/context.types";
import { SystemInvariantError } from "@core/error/system-error";
import { RoleValidationError } from "@modules/role/domain/role.errors";
import {
  ROLE_TEMPLATE_ADMIN_LIST_PRESENTER_KEY,
  ROLE_TEMPLATE_ADMIN_PREVIEW_PRESENTER_KEY,
} from "@modules/role/shared/role.presenter-keys";
import { RoleTemplateAdminService } from "./admin.role-template.service";

type RoleTemplateCommand =
  | "ROLE_TEMPLATE_LIST"
  | "ROLE_TEMPLATE_PREVIEW";

const ROLE_TEMPLATE_PREVIEW_BODY_FIELDS: readonly string[] =
  Object.freeze([]);

export class AdminRoleTemplateController extends SecureController {
  constructor(
    private readonly service: RoleTemplateAdminService,
  ) {
    super();
  }

  protected async handle(
    req: Request,
    actor: Actor,
    _context: ContextType,
  ): Promise<unknown> {
    const command =
      readCommand<RoleTemplateCommand>(req);

    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Role template command missing",
      );
    }

    switch (command) {
      case "ROLE_TEMPLATE_LIST":
        return this.service.listRoleTemplates(actor);

      case "ROLE_TEMPLATE_PREVIEW":
        assertNoUnexpectedFields(
          requirePlainObjectBodyForPreview(req.body),
          ROLE_TEMPLATE_PREVIEW_BODY_FIELDS,
          command,
        );
        return this.service.previewRoleTemplate(actor, {
          templateCode: req.params.templateCode,
        });

      default:
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          `Unsupported role template command: ${command}`,
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
      readCommand<RoleTemplateCommand>(req);

    if (!command) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Role template command missing",
      );
    }

    const registry = getPresenterRegistryFromRequest(req);

    switch (command) {
      case "ROLE_TEMPLATE_LIST":
        return registry
          .get<unknown, PresentationResult>(
            ROLE_TEMPLATE_ADMIN_LIST_PRESENTER_KEY,
          )
          .present(result, context);

      case "ROLE_TEMPLATE_PREVIEW":
        return registry
          .get<unknown, PresentationResult>(
            ROLE_TEMPLATE_ADMIN_PREVIEW_PRESENTER_KEY,
          )
          .present(result, context);

      default:
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          `Unsupported role template command: ${command}`,
        );
    }
  }
}

function requirePlainObjectBodyForPreview(
  value: unknown,
): Record<string, unknown> {
  if (value === undefined) {
    return {};
  }

  if (!isPlainObject(value)) {
    throw new RoleValidationError(
      "Request body for ROLE_TEMPLATE_PREVIEW must be a plain object",
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

function assertNoUnexpectedFields(
  body: Readonly<Record<string, unknown>>,
  allowedFields: readonly string[],
  command: RoleTemplateCommand,
): void {
  const unexpectedFields = Object.keys(body).filter(
    (field) => !allowedFields.includes(field),
  );

  if (unexpectedFields.length === 0) {
    return;
  }

  unexpectedFields.sort();

  throw new RoleValidationError(
    `${command} payload contains unsupported field(s): ${unexpectedFields.join(", ")}`,
  );
}
