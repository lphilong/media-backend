import { Actor } from "@core/actor/actor";
import { Permission } from "@core/permission/permission.enum";
import { PermissionGuard } from "@core/permission/permission.guard";
import { PermissionResolver } from "@core/permission/permission.resolver";
import { RoleValidationError } from "@modules/role/domain/role.errors";
import {
  getRoleTemplate,
  listRoleTemplates,
} from "@modules/role/domain/role-template.catalog";
import {
  ListRoleTemplatesResult,
  PreviewRoleTemplateCommand,
  RoleTemplatePreviewResult,
} from "@modules/role/shared/role.contracts";

export class RoleTemplateAdminService {
  listRoleTemplates(
    actor: Actor,
  ): ListRoleTemplatesResult {
    const permission = PermissionResolver.resolve(
      Permission.ROLE_LIST,
    );
    PermissionGuard.assertAdminActor(actor);
    PermissionGuard.assert(actor, permission);

    return {
      items: listRoleTemplates(),
    };
  }

  previewRoleTemplate(
    actor: Actor,
    command: PreviewRoleTemplateCommand,
  ): RoleTemplatePreviewResult {
    const permission = PermissionResolver.resolve(
      Permission.ROLE_VIEW,
    );
    PermissionGuard.assertAdminActor(actor);
    PermissionGuard.assert(actor, permission);

    const template = getRoleTemplate(
      command.templateCode,
    );
    if (!template) {
      throw new RoleValidationError(
        `Unknown role template code: ${command.templateCode}`,
      );
    }

    return {
      template,
      permissions: template.permissions.map(
        (permissionCode) => permissionCode,
      ),
      scopePlan: template.scopePlan,
      warnings: template.warnings,
      unsupportedScopeNotes: template.scopePlan
        .filter(
          (entry) =>
            entry.status === "REQUIRES_FUTURE_SCOPE",
        )
        .map((entry) => entry.note),
    };
  }
}
