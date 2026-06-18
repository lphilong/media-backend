import { Request } from "express";
import { readCommand } from "@app/base/command.middleware";
import { PresentationResult, toPlainObject } from "@app/base/presentation-result.types";
import { SecureController } from "@app/base/secure-controller.base";
import { Actor } from "@core/actor/actor";
import { ContextType } from "@core/context/context.types";
import { SystemInvariantError } from "@core/error/system-error";
import { Permission } from "@core/permission/permission.enum";
import { PermissionGuard } from "@core/permission/permission.guard";
import { PermissionResolver } from "@core/permission/permission.resolver";
import { RoleValidationError } from "@modules/role/domain/role.errors";
import { AssignRoleBundleCommand, RoleBundleAdminService } from "./admin.role-bundle.service";

type Command = "ROLE_BUNDLE_LIST" | "ROLE_BUNDLE_ASSIGN";

export class AdminRoleBundleController extends SecureController {
  constructor(private readonly service: RoleBundleAdminService) {
    super();
  }

  protected async handle(req: Request, actor: Actor, _context: ContextType): Promise<unknown> {
    const command = readCommand<Command>(req);
    PermissionGuard.assertAdminActor(actor);
    if (command === "ROLE_BUNDLE_LIST") {
      PermissionGuard.assert(actor, PermissionResolver.resolve(Permission.ROLE_VIEW));
      return this.service.listBundles();
    }
    if (command === "ROLE_BUNDLE_ASSIGN") {
      return this.service.assignBundle(actor, parseAssignCommand(req));
    }
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      "Role bundle command missing",
    );
  }

  protected async present(
    result: unknown,
    _req: Request,
    _actor: Actor,
    _context: ContextType,
  ): Promise<PresentationResult> {
    return {
      data: Array.isArray(result)
        ? result.map((item) => toPlainObject(item, "roleBundle"))
        : toPlainObject(result, "roleBundle"),
    };
  }
}

function parseAssignCommand(req: Request): AssignRoleBundleCommand {
  const body = isPlainObject(req.body) ? req.body : {};
  const allowed = ["userId", "reason", "structuredScopeGrants", "expiresAt", "reviewAt"];
  const unexpected = Object.keys(body).filter((key) => !allowed.includes(key));
  if (unexpected.length > 0) {
    throw new RoleValidationError(
      `ROLE_BUNDLE_ASSIGN payload contains unsupported field(s): ${unexpected.sort().join(", ")}`,
    );
  }
  return {
    bundleCode: req.params.bundleCode,
    bundleVersion: req.params.bundleVersion,
    userId: body.userId as string,
    reason: body.reason as string | null | undefined,
    structuredScopeGrants: body.structuredScopeGrants as AssignRoleBundleCommand["structuredScopeGrants"],
    expiresAt: body.expiresAt as AssignRoleBundleCommand["expiresAt"],
    reviewAt: body.reviewAt as AssignRoleBundleCommand["reviewAt"],
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
