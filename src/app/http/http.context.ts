import { AsyncLocalStorage } from "node:async_hooks";
import { HttpContextType } from "@core/context/context.types";
import { Actor } from "@core/actor/actor";
import { SystemInvariantError } from "@core/error/system-error";

export interface HttpContext {
  readonly context: HttpContextType;
  readonly actor?: Actor;
}

const httpContextStorage = new AsyncLocalStorage<HttpContext>();

const HTTP_CONTEXT_ALLOWED_KEYS = new Set<string>([
  "context",
  "actor",
]);

function assertHttpContextAllowList(ctx: HttpContext): void {
  const illegalKeys = Object.keys(ctx)
    .filter((key) => !HTTP_CONTEXT_ALLOWED_KEYS.has(key))
    .sort();

  if (illegalKeys.length > 0) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      `HTTP context contains forbidden ALS keys: ${illegalKeys.join(", ")}`,
    );
  }
}

function assertHttpContextType(ctx: HttpContextType): void {
  if (ctx !== "ADMIN") {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      `HTTP context must be ADMIN. Received: ${ctx}`,
    );
  }
}

export function runWithHttpContext<T>(
  ctx: HttpContext,
  fn: () => T,
): T {
  assertHttpContextAllowList(ctx);
  assertHttpContextType(ctx.context);

  return httpContextStorage.run(ctx, fn);
}

export function getCurrentHttpContext(): HttpContext {
  const ctx = httpContextStorage.getStore();
  if (!ctx) {
    throw new SystemInvariantError(
      "HTTP_CONTEXT_NOT_AVAILABLE",
      "HTTP context is not available outside HTTP runtime",
    );
  }
  return ctx;
}