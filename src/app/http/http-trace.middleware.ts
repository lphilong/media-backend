import crypto from "crypto";
import { Request, Response, NextFunction } from "express";
import { bindTraceId } from "@core/trace/trace.context";

function readHeaderValue(
  value: string | string[] | undefined,
): string | undefined {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized.length > 0
      ? normalized
      : undefined;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const normalized = item.trim();
      if (normalized.length > 0) {
        return normalized;
      }
    }
  }

  return undefined;
}

function resolveInboundTraceId(
  req: Request,
): string | undefined {
  const traceId = readHeaderValue(
    req.headers["x-trace-id"],
  );

  if (traceId) {
    return traceId;
  }

  return readHeaderValue(req.headers["x-request-id"]);
}

/**
 * Binds request trace context at HTTP entry before auth/context/business flow.
 * This guarantees downstream trace lookups have a deterministic value.
 */
export function httpTraceMiddleware() {
  return (
    req: Request,
    _res: Response,
    next: NextFunction,
  ) => {
    const traceId =
      resolveInboundTraceId(req) ??
      crypto.randomUUID();

    if (req.headers["x-trace-id"] === undefined) {
      req.headers["x-trace-id"] = traceId;
    }

    void bindTraceId(traceId, async () => {
      next();
    }).catch(next);
  };
}
