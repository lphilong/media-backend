import {
  Actor,
  ActorScopeGrants,
} from "@core/actor/actor";
import { ContextType } from "@core/context/context.types";
import { AccountContext } from "@modules/account-context/domain/account-context.types";

export interface ActorSnapshot {
  id: string;
  type: "admin" | "staff" | "customer";
  context: ContextType;
  roles: readonly string[];
  permissions: readonly string[];
  scopeGrants?: ActorScopeGrants;
  accountContexts?: readonly AccountContext[];
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
  const scopeGrants = snapshot.scopeGrants ?? {};

  return new Actor({
    id: snapshot.id,
    type: snapshot.type,
    context: snapshot.context,
    roles: snapshot.roles,
    permissions: snapshot.permissions,
    scopeGrants,
    accountContexts: snapshot.accountContexts,
    trace,
    isActive: snapshot.isActive,
    authorizationValidUntil: snapshot.authorizationValidUntil,
  });
}
