import { ContextType } from "./context.types";
import { SystemInvariantError } from "../error/system-error";

export function assertContextType(value: string): ContextType {
  if (
    value === "ADMIN" ||
    value === "SELF_SERVICE" ||
    value === "SHOP" ||
    value === "PUBLIC" ||
    value === "SYSTEM"
  ) {
    return value;
  }

  throw new SystemInvariantError(
    "CONTEXT_INVALID",
    `Invalid context value: ${value}`
  );
}
