import { ContextType, CONTEXT_SYMBOL } from "./context.types";
import { SystemInvariantError } from "../error/system-error";

/**
 * ContextCarrier is any object capable of holding a symbol.
 * We intentionally avoid index-signature typing to remain
 * structurally compatible with Express Request.
 */
export type ContextCarrier = object;

/**
 * Bind context to a carrier.
 * Context is immutable once bound.
 */
export function bindContext(
  carrier: ContextCarrier,
  context: ContextType,
): void {
  if (!context) {
    throw new SystemInvariantError(
      "CONTEXT_MISSING",
      "Context must be provided",
    );
  }

  const target = carrier as Record<PropertyKey, unknown>;

  if (CONTEXT_SYMBOL in target) {
    throw new SystemInvariantError(
      "CONTEXT_ALREADY_BOUND",
      "Context cannot be rebound",
    );
  }

  Object.defineProperty(target, CONTEXT_SYMBOL, {
    value: context,
    writable: false,
    enumerable: false,
    configurable: false,
  });
}

/**
 * Get context from carrier.
 * Fail-closed if missing.
 */
export function getContext(
  carrier: ContextCarrier,
): ContextType {
  const target = carrier as Record<PropertyKey, unknown>;
  const context = target[CONTEXT_SYMBOL];

  if (!context) {
    throw new SystemInvariantError(
      "CONTEXT_NOT_BOUND",
      "Context must be bound before access",
    );
  }

  return context as ContextType;
}