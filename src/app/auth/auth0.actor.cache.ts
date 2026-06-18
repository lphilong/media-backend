import {
  Actor,
  ActorScopeGrants,
} from "@core/actor/actor";
import { ContextType } from "@core/context/context.types";
import {
  deriveActorScopeGrantsFromPermissions,
} from "@core/permission/permission.guard";

export interface ActorSnapshot {
  id: string;
  type: "admin" | "staff" | "customer";
  context: ContextType;
  roles: readonly string[];
  permissions: readonly string[];
  scopeGrants?: ActorScopeGrants;
  isActive: boolean;
  authorizationValidUntil?: number;
}

/**
 * Rehydrate Actor from cached snapshot.
 * ❗ Trace is NOT cached (request-specific).
 */
export function actorFromSnapshot(
  snapshot: ActorSnapshot,
  trace?: {
    ip?: string;
    userAgent?: string;
  },
): Actor {
  const scopeGrants =
    snapshot.scopeGrants ??
    deriveActorScopeGrantsFromPermissions(
      snapshot.permissions,
    );

  return new Actor({
    id: snapshot.id,
    type: snapshot.type,
    context: snapshot.context,
    roles: snapshot.roles,
    permissions: snapshot.permissions,
    scopeGrants,
    trace,
    isActive: snapshot.isActive,
  });
}
