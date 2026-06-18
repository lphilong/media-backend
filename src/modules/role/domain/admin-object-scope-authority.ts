import { Actor } from "@core/actor/actor";
import { Permission } from "@core/permission/permission.enum";
import { RoleAssignmentScopeGrant } from "./role-assignment-scope";
import { StructuredScopeAuthorityService } from "./structured-scope-authority";

export interface RequireAdminObjectScopeAuthorityInput {
  readonly actor: Actor;
  readonly permission: Permission;
  readonly scope: RoleAssignmentScopeGrant;
  readonly authority: StructuredScopeAuthorityService;
  readonly error: Error;
}

export async function requireAdminObjectScopeAuthority(
  input: RequireAdminObjectScopeAuthorityInput,
): Promise<void> {
  if (!input.actor.isActive) {
    throw input.error;
  }

  const allowed = await input.authority.hasAuthority({
    userId: input.actor.id,
    permission: input.permission,
    scope: input.scope,
    mode: "STRUCTURED_SCOPE_REQUIRED",
  });

  if (!allowed) {
    throw input.error;
  }
}
