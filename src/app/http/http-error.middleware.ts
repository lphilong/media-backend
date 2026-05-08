import crypto from "crypto";
import {
  Request,
  Response,
  NextFunction,
} from "express";
import { mapToHttpError } from "./http-error.map";
import { SystemInvariantError } from "@core/error/system-error";
import { BaseAppError } from "@core/errors/base.error";
import { incrementHttpErrorCounter } from "@infra/metrics/prometheus.registry";
import {
  createStructuredLogger,
  StructuredLogger,
} from "@infra/logger.adapter";
import { getTraceIdOrThrow } from "@core/trace/trace.context";
import { getActor } from "@core/actor/actor-context";
import { getContext } from "@core/context/context.middleware";
import { env } from "@config/env";
import { createHttpErrorResponse } from "./http-error-response.contract";
import { HttpErrorResponse, HttpError } from "./http-error.types";

/**
 * Global HTTP error handler.
 * MUST be registered last.
 */
type HttpErrorLogClassification =
  | "INVARIANT"
  | "APPLICATION"
  | "UNKNOWN";

type HttpErrorMetricClassification =
  | "invariant"
  | "application"
  | "unknown";

function classifyHttpError(err: unknown): {
  readonly metric: HttpErrorMetricClassification;
  readonly log: HttpErrorLogClassification;
} {
  if (err instanceof SystemInvariantError) {
    return {
      metric: "invariant",
      log: "INVARIANT",
    };
  }

  if (err instanceof BaseAppError) {
    return {
      metric: "application",
      log: "APPLICATION",
    };
  }

  return {
    metric: "unknown",
    log: "UNKNOWN",
  };
}

function resolveTraceId(req: Request): string {
  try {
    return getTraceIdOrThrow();
  } catch {
    // Error boundary must remain non-throwing; continue with inbound headers or generated trace id.
  }

  const traceIdHeader = readHeaderValue(
    req.headers["x-trace-id"],
  );
  if (traceIdHeader) {
    return traceIdHeader;
  }

  const requestIdHeader = readHeaderValue(
    req.headers["x-request-id"],
  );
  if (requestIdHeader) {
    return requestIdHeader;
  }

  return crypto.randomUUID();
}

function resolveRequestIdForWire(
  req: Request,
): string | undefined {
  const requestIdHeader = readHeaderValue(
    req.headers["x-request-id"],
  );

  if (requestIdHeader) {
    return requestIdHeader;
  }

  const traceIdHeader = readHeaderValue(
    req.headers["x-trace-id"],
  );

  if (traceIdHeader) {
    return traceIdHeader;
  }

  try {
    return getTraceIdOrThrow();
  } catch {
    return undefined;
  }
}

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

function resolveErrorCode(
  err: unknown,
  mappedCode: string,
): string {
  if (err instanceof SystemInvariantError) {
    return err.code;
  }

  if (err instanceof BaseAppError) {
    return err.code;
  }

  return mappedCode;
}

function createErrorBoundaryLogMetadata(params: {
  req: Request;
  err: unknown;
  httpCode: string;
  httpStatus: number;
  classification: HttpErrorLogClassification;
}): Readonly<Record<string, unknown>> {
  const metadata: Record<string, unknown> = {
    errorCode: resolveErrorCode(
      params.err,
      params.httpCode,
    ),
    httpCode: params.httpCode,
    httpStatus: params.httpStatus,
    method: params.req.method,
    path: params.req.originalUrl ?? params.req.path,
    classification: params.classification,
  };

  if (params.err instanceof Error && params.err.stack) {
    metadata["stack"] = params.err.stack;
  }

  return metadata;
}

function resolveLogActorContext(req: Request): {
  readonly actorId: string;
  readonly context: string;
} {
  try {
    const actor = getActor(req);

    if (
      actor &&
      typeof actor.id === "string" &&
      actor.id.trim().length > 0 &&
      typeof actor.context === "string" &&
      actor.context.trim().length > 0
    ) {
      return {
        actorId: actor.id,
        context: actor.context,
      };
    }
  } catch {
    // Continue to context fallback.
  }

  try {
    const context = getContext(req);

    if (
      typeof context === "string" &&
      context.trim().length > 0
    ) {
      return {
        actorId: "SYSTEM",
        context,
      };
    }
  } catch {
    // Continue to SYSTEM fallback.
  }

  return {
    actorId: "SYSTEM",
    context: "SYSTEM",
  };
}

function createCanonicalErrorPayload(params: {
  readonly req: Request;
  readonly httpError: HttpError;
}): HttpErrorResponse {
  return createHttpErrorResponse({
    error: params.httpError,
    requestId: resolveRequestIdForWire(params.req),
    includeRequestId: env.HTTP_ERROR_INCLUDE_REQUEST_ID,
  });
}

export function createHttpErrorMiddleware(
  logger: StructuredLogger = createStructuredLogger(),
) {
  return function httpErrorMiddleware(
    err: unknown,
    req: Request,
    res: Response,
    _next: NextFunction,
  ) {
    const httpError = mapToHttpError(err);
    const classification = classifyHttpError(err);
    const traceId = resolveTraceId(req);
    const logActorContext =
      resolveLogActorContext(req);

    const responsePayload =
      createCanonicalErrorPayload({
        req,
        httpError,
      });

    try {
      logger.error({
        traceId,
        actorId: logActorContext.actorId,
        context: logActorContext.context,
        operation: "http.error.boundary",
        status: "FAILED",
        timestamp: Date.now(),
        metadata: createErrorBoundaryLogMetadata({
          req,
          err,
          httpCode: httpError.code,
          httpStatus: httpError.status,
          classification: classification.log,
        }),
      });
    } catch {
      // Never throw from boundary logging path.
    }

    const metricClassification =
      classification.metric;

    try {
      incrementHttpErrorCounter({
        runtime: "http",
        status: httpError.status,
        code: httpError.code,
        classification: metricClassification,
      });
    } catch {
      // Never throw from boundary metric path.
    }

    if (res.headersSent) {
      return;
    }

    try {
      res.status(httpError.status).json(responsePayload);
    } catch {
      if (res.headersSent) {
        return;
      }

      try {
        const fallbackPayload =
          createCanonicalErrorPayload({
            req,
            httpError: new HttpError(
              500,
              "INTERNAL_ERROR",
              "Unexpected error",
            ),
          });

        res.status(500).json(fallbackPayload);
      } catch {
        // Never throw from boundary response finalization path.
      }
    }
  };
}

export const httpErrorMiddleware =
  createHttpErrorMiddleware();
