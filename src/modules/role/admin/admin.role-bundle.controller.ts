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
import { RoleBundleAdminService } from "./admin.role-bundle.service";

type Command = "ROLE_BUNDLE_LIST";

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
