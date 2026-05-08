import {
  ContextType,
  HttpContextType,
} from "@core/context/context.types";
import { SystemInvariantError } from "@core/error/system-error";

/**
 * Assert context is currently approved for the active HTTP boundary.
 * Fail-closed by design.
 */
export function assertHttpContext(
  ctx: ContextType,
): HttpContextType {
  if (ctx === "ADMIN") {
    return ctx;
  }

  throw new SystemInvariantError(
    "INVALID_SYSTEM_CONTEXT",
    `Invalid active HTTP context: ${ctx}`,
  );
}