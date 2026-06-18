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
import { EffectiveAccessAdminService } from "./admin.effective-access.service";

export class AdminEffectiveAccessController extends SecureController {
  constructor(private readonly service: EffectiveAccessAdminService) {
    super();
  }

  protected async handle(req: Request, actor: Actor, _context: ContextType): Promise<unknown> {
    if (readCommand(req) !== "EFFECTIVE_ACCESS_GET") {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        "Effective access command missing",
      );
    }
    PermissionGuard.assertAdminActor(actor);
    PermissionGuard.assert(
      actor,
      PermissionResolver.resolve(Permission.ROLE_ASSIGNMENT_VIEW),
    );
    return this.service.getForUser(req.params.userId);
  }

  protected async present(
    result: unknown,
    _req: Request,
    _actor: Actor,
    _context: ContextType,
  ): Promise<PresentationResult> {
    return { data: toPlainObject(result, "effectiveAccess") };
  }
}
