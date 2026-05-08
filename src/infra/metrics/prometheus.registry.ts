import type { Request, RequestHandler } from "express";
import {
  Counter,
  Gauge,
  Histogram,
  Registry,
} from "prom-client";

type RuntimeLabel = "http" | "system";
type QueueLabel =
  | "dashboard"
  | "reporting"
  | "cms"
  | "finance"
  | "system";
type AdmissionOutcomeLabel =
  | "accepted"
  | "rejected"
  | "deferred";
type RetryClassification =
  | "TransientTransactionError"
  | "UnknownTransactionCommitResult";
type HttpErrorClassification =
  | "invariant"
  | "application"
  | "unknown";
type OutboxDispatchResult =
  | "success"
  | "retry"
  | "failed_final";
type QueueEnqueueResult = "success" | "failed";

const registry = new Registry();

const httpRequestDurationSeconds = new Histogram({
  name: "app_http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: [
    "runtime",
    "method",
    "route",
    "status",
  ] as const,
  buckets: [
    0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5,
  ],
  registers: [registry],
});

const httpRequestsTotal = new Counter({
  name: "app_http_requests_total",
  help: "Total HTTP requests",
  labelNames: [
    "runtime",
    "method",
    "route",
    "status",
  ] as const,
  registers: [registry],
});

const httpErrorsTotal = new Counter({
  name: "app_http_errors_total",
  help: "HTTP errors observed at canonical error boundary",
  labelNames: [
    "runtime",
    "status",
    "code",
    "classification",
  ] as const,
  registers: [registry],
});

const mongoTransactionDurationSeconds = new Histogram({
  name: "app_mongo_transaction_duration_seconds",
  help: "Mongo transaction attempt duration in seconds",
  labelNames: ["runtime", "result"] as const,
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [registry],
});

const mongoTransactionRetriesTotal = new Counter({
  name: "app_mongo_transaction_retries_total",
  help: "Mongo transaction retries by retry classification",
  labelNames: ["runtime", "classification"] as const,
  registers: [registry],
});

const mongoTransactionUtcrTotal = new Counter({
  name: "app_mongo_transaction_utcr_total",
  help: "UnknownTransactionCommitResult occurrences",
  labelNames: ["runtime"] as const,
  registers: [registry],
});

const outboxDispatchDurationSeconds = new Histogram({
  name: "app_outbox_dispatch_duration_seconds",
  help: "Outbox dispatch attempt duration in seconds",
  labelNames: ["runtime", "result"] as const,
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [registry],
});

const outboxFailedFinalTotal = new Counter({
  name: "app_outbox_failed_final_total",
  help: "Outbox events finalized as FAILED_FINAL",
  labelNames: ["runtime"] as const,
  registers: [registry],
});

const queueDepth = new Gauge({
  name: "app_queue_depth",
  help: "Current queue depth observed at authoritative gate",
  labelNames: ["queue"] as const,
  registers: [registry],
});

const queueAdmissionTotal = new Counter({
  name: "app_queue_admission_total",
  help: "Queue admission outcomes at authoritative gate",
  labelNames: ["queue", "outcome"] as const,
  registers: [registry],
});

const queueEnqueueDurationSeconds = new Histogram({
  name: "app_queue_enqueue_duration_seconds",
  help: "Queue enqueue duration in seconds",
  labelNames: ["queue", "result"] as const,
  buckets: [
    0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25,
  ],
  registers: [registry],
});

const queueEnqueueFailuresTotal = new Counter({
  name: "app_queue_enqueue_failures_total",
  help: "Queue enqueue failures",
  labelNames: ["queue"] as const,
  registers: [registry],
});

const queueJobFailuresTotal = new Counter({
  name: "app_queue_job_failures_total",
  help: "Queue job failure counters observed in runtime control points",
  labelNames: ["queue", "stage"] as const,
  registers: [registry],
});

function normalizeComposedRoute(
  baseUrl: string,
  routePath: string,
): string {
  const normalizedBase =
    baseUrl.endsWith("/") && baseUrl !== "/"
      ? baseUrl.slice(0, -1)
      : baseUrl;
  const normalizedPath = routePath.startsWith("/")
    ? routePath
    : `/${routePath}`;
  const combined = `${normalizedBase}${normalizedPath}`;
  return stripQueryAndHash(combined.length > 0 ? combined : "/");
}

function stripQueryAndHash(pathname: string): string {
  const withoutQuery = pathname.split("?")[0] ?? pathname;
  const withoutHash =
    withoutQuery.split("#")[0] ?? withoutQuery;
  if (withoutHash.length === 0) {
    return "/";
  }
  return withoutHash.startsWith("/")
    ? withoutHash
    : `/${withoutHash}`;
}

function resolveRouteTemplate(req: Request): string {
  const baseUrl =
    typeof req.baseUrl === "string" ? req.baseUrl : "";
  const routePath = req.route?.path;

  if (typeof routePath === "string") {
    return normalizeComposedRoute(baseUrl, routePath);
  }

  if (Array.isArray(routePath)) {
    const firstTemplate = routePath.find(
      (part): part is string =>
        typeof part === "string" && part.length > 0,
    );
    if (firstTemplate) {
      return normalizeComposedRoute(
        baseUrl,
        firstTemplate,
      );
    }
  }

  if (req.path === "/metrics") {
    return "/metrics";
  }

  return "unmatched";
}

export function createHttpMetricsMiddleware(
  runtime: RuntimeLabel = "http",
): RequestHandler {
  return (req, res, next) => {
    const startedAt = process.hrtime.bigint();

    res.on("finish", () => {
      const durationNs =
        process.hrtime.bigint() - startedAt;
      const durationSeconds = Number(durationNs) / 1_000_000_000;
      const route = resolveRouteTemplate(req);
      const method = req.method.toUpperCase();
      const status = String(res.statusCode);

      httpRequestDurationSeconds.observe(
        { runtime, method, route, status },
        durationSeconds,
      );
      httpRequestsTotal.inc({
        runtime,
        method,
        route,
        status,
      });
    });

    next();
  };
}

export function incrementHttpErrorCounter(params: {
  runtime: RuntimeLabel;
  status: number;
  code: string;
  classification: HttpErrorClassification;
}): void {
  httpErrorsTotal.inc({
    runtime: params.runtime,
    status: String(params.status),
    code: params.code,
    classification: params.classification,
  });
}

export function observeMongoTransactionDuration(params: {
  runtime: RuntimeLabel;
  durationMs: number;
  result: "success" | "fail";
}): void {
  mongoTransactionDurationSeconds.observe(
    {
      runtime: params.runtime,
      result: params.result,
    },
    params.durationMs / 1000,
  );
}

export function incrementMongoTransactionRetry(params: {
  runtime: RuntimeLabel;
  classification: RetryClassification;
}): void {
  mongoTransactionRetriesTotal.inc({
    runtime: params.runtime,
    classification: params.classification,
  });
}

export function incrementMongoTransactionUtcr(params: {
  runtime: RuntimeLabel;
}): void {
  mongoTransactionUtcrTotal.inc({
    runtime: params.runtime,
  });
}

export function observeOutboxDispatchDuration(params: {
  runtime: RuntimeLabel;
  durationMs: number;
  result: OutboxDispatchResult;
}): void {
  outboxDispatchDurationSeconds.observe(
    {
      runtime: params.runtime,
      result: params.result,
    },
    params.durationMs / 1000,
  );
}

export function incrementOutboxFailedFinal(params: {
  runtime: RuntimeLabel;
}): void {
  outboxFailedFinalTotal.inc({ runtime: params.runtime });
}

export function setQueueDepth(params: {
  queue: QueueLabel;
  depth: number;
}): void {
  queueDepth.set({ queue: params.queue }, params.depth);
}

export function incrementQueueAdmission(params: {
  queue: QueueLabel;
  outcome: AdmissionOutcomeLabel;
}): void {
  queueAdmissionTotal.inc({
    queue: params.queue,
    outcome: params.outcome,
  });
}

export function observeQueueEnqueueDuration(params: {
  queue: QueueLabel;
  durationMs: number;
  result: QueueEnqueueResult;
}): void {
  queueEnqueueDurationSeconds.observe(
    {
      queue: params.queue,
      result: params.result,
    },
    params.durationMs / 1000,
  );
}

export function incrementQueueEnqueueFailure(params: {
  queue: QueueLabel;
}): void {
  queueEnqueueFailuresTotal.inc({
    queue: params.queue,
  });
}

export function incrementQueueJobFailure(params: {
  queue: QueueLabel;
  stage: "enqueue";
}): void {
  queueJobFailuresTotal.inc({
    queue: params.queue,
    stage: params.stage,
  });
}

export function getPrometheusContentType(): string {
  return registry.contentType;
}

export async function renderPrometheusMetrics(): Promise<string> {
  return registry.metrics();
}
