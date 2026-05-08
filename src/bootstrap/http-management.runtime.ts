import http from "http";
import { SystemInvariantError } from "@core/error/system-error";
import {
  getPrometheusContentType,
  renderPrometheusMetrics,
} from "@infra/metrics/prometheus.registry";
import { StructuredLogger } from "@infra/logger.adapter";
import { HttpError } from "@app/http/http-error.types";
import { env } from "@config/env";
import { writeCanonicalHttpErrorResponse } from "@app/http/http-error-response.contract";

export type HttpManagementPlane = {
  readonly host: string;
  readonly port: number;
  setReadiness(ready: boolean): void;
  close(): Promise<void>;
};

type HttpManagementStartParams = {
  readonly enabled: boolean;
  readonly host?: string;
  readonly port?: number;
  readonly logger: StructuredLogger;
  readonly runtimeTraceId: string;
};

function normalizePath(url: string | undefined): string {
  const raw = url ?? "/";
  const withoutQuery = raw.split("?")[0] ?? raw;
  const withoutHash =
    withoutQuery.split("#")[0] ?? withoutQuery;

  return withoutHash.length > 0 ? withoutHash : "/";
}

function writeJson(
  res: http.ServerResponse,
  statusCode: number,
  body: Readonly<Record<string, unknown>>,
): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
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

function resolveRequestId(
  req: http.IncomingMessage,
): string | undefined {
  const requestId = readHeaderValue(
    req.headers["x-request-id"],
  );
  if (requestId) {
    return requestId;
  }

  const traceId = readHeaderValue(
    req.headers["x-trace-id"],
  );
  if (traceId) {
    return traceId;
  }

  return undefined;
}

function writeCanonicalError(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  error: HttpError,
): void {
  writeCanonicalHttpErrorResponse({
    response: res,
    error,
    requestId: resolveRequestId(req),
    includeRequestId: env.HTTP_ERROR_INCLUDE_REQUEST_ID,
  });
}

function resolveHost(
  host: string | undefined,
): string {
  if (
    typeof host === "string" &&
    host.trim().length > 0
  ) {
    return host.trim();
  }

  throw new SystemInvariantError(
    "SYSTEM_INVARIANT_VIOLATION",
    "HTTP management host must be explicitly configured when enabled",
  );
}

function resolvePort(port: number | undefined): number {
  if (
    typeof port === "number" &&
    Number.isInteger(port) &&
    port > 0
  ) {
    return port;
  }

  throw new SystemInvariantError(
    "SYSTEM_INVARIANT_VIOLATION",
    "HTTP management port must be explicitly configured when enabled",
  );
}

export async function startHttpManagementPlane(
  params: HttpManagementStartParams,
): Promise<HttpManagementPlane | null> {
  if (!params.enabled) {
    return null;
  }

  const host = resolveHost(params.host);
  const port = resolvePort(params.port);

  let isReady = false;

  const server = http.createServer((req, res) => {
    const path = normalizePath(req.url);
    const method = (req.method ?? "GET").toUpperCase();

    if (method !== "GET" && method !== "HEAD") {
      writeCanonicalError(
        req,
        res,
        new HttpError(
          405,
          "METHOD_NOT_ALLOWED",
          "Method not allowed",
        ),
      );
      return;
    }

    if (path === "/livez") {
      writeJson(res, 200, { status: "ok" });
      return;
    }

    if (path === "/readyz") {
      if (isReady) {
        writeJson(res, 200, { status: "ready" });
        return;
      }

      writeJson(res, 503, { status: "not_ready" });
      return;
    }

    if (path === "/metrics") {
      void (async () => {
        try {
          const body = await renderPrometheusMetrics();
          res.statusCode = 200;
          res.setHeader(
            "Content-Type",
            getPrometheusContentType(),
          );
          res.end(body);
        } catch (error) {
          params.logger.error({
            traceId: params.runtimeTraceId,
            actorId: "SYSTEM",
            context: "SYSTEM",
            operation: "http.management.metrics.render",
            status: "FAILED",
            timestamp: Date.now(),
            metadata: {
              error:
                error instanceof Error
                  ? error.message
                  : String(error),
            },
          });
          writeCanonicalError(
            req,
            res,
            new HttpError(
              500,
              "INTERNAL_ERROR",
              "Unexpected error",
            ),
          );
        }
      })();
      return;
    }

    writeCanonicalError(
      req,
      res,
      new HttpError(
        404,
        "NOT_FOUND",
        "Resource not found",
      ),
    );
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.removeListener("listening", onListening);
      reject(error);
    };

    const onListening = () => {
      server.removeListener("error", onError);
      resolve();
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });

  return {
    host,
    port,
    setReadiness(ready: boolean): void {
      isReady = ready;
    },
    async close(): Promise<void> {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
  };
}
