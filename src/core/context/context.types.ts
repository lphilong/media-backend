export type ContextType =
  | "ADMIN"
  | "SELF_SERVICE"
  | "SHOP"
  | "PUBLIC"
  | "SYSTEM";

export const CONTEXTS: readonly ContextType[] = [
  "ADMIN",
  "SELF_SERVICE",
  "SHOP",
  "PUBLIC",
  "SYSTEM",
];

/**
 * Context allowed to originate HTTP DomainEvents.
 *
 * Current HTTP authority:
 * - ADMIN
 * - SELF_SERVICE
 *
 * PUBLIC and SHOP are reserved for future explicit approval and must remain
 * forbidden at the active HTTP boundary until docs/contracts/invariants are
 * intentionally updated.
 */
export type HttpContextType = "ADMIN" | "SELF_SERVICE";

export interface RequestContext {
  readonly type: ContextType;
}

/**
 * Canonical context symbol (single source of truth)
 */
export const CONTEXT_SYMBOL = Symbol.for("SECURITY_CONTEXT");
