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

export async function requireAdminGlobalScopeAuthority(
  input: Omit<RequireAdminObjectScopeAuthorityInput, "scope">,
): Promise<void> {
  await requireAdminObjectScopeAuthority({
    ...input,
    scope: { scopeType: "global" },
  });
}

/**
 * Read-detail continuity: a global structured grant authorizes every object
 * available from the corresponding global list; an assigned grant remains
 * exact to its object or target.
 */
export async function requireAdminGlobalOrObjectScopeAuthority(
  input: RequireAdminObjectScopeAuthorityInput,
): Promise<void> {
  if (!input.actor.isActive) {
    throw input.error;
  }

  const [hasGlobalAuthority, hasObjectAuthority] = await Promise.all([
    input.authority.hasAuthority({
      userId: input.actor.id,
      permission: input.permission,
      scope: { scopeType: "global" },
      mode: "STRUCTURED_SCOPE_REQUIRED",
    }),
    input.authority.hasAuthority({
      userId: input.actor.id,
      permission: input.permission,
      scope: input.scope,
      mode: "STRUCTURED_SCOPE_REQUIRED",
    }),
  ]);

  if (!hasGlobalAuthority && !hasObjectAuthority) {
    throw input.error;
  }
}
