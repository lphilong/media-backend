  import { Request, Response, NextFunction } from "express";

  import { getContext } from "@core/context/context.middleware";
  import { getActor } from "@core/actor/actor-context";
  import {
    bindTraceId,
    getTraceIdOrThrow,
  } from "@core/trace/trace.context";
  import { runWithHttpContext } from "./http.context";
  import { assertHttpContext } from "@system/event-bridge/domain-event.guard";

  /**
   * HTTP Context Middleware
   * - Must run AFTER context + actor binding
   * - Snapshot only
   * - Fail-closed
   */
  export function httpContextMiddleware() {
    return (req: Request, _res: Response, next: NextFunction) => {
      const rawContext = getContext(req);
      const context = assertHttpContext(rawContext);

      const actor = getActor(req);

      const inboundTraceId = resolveInboundTraceId(req);
      const traceId =
        inboundTraceId ?? getTraceIdOrThrow();

      void bindTraceId(traceId, async () => {
        runWithHttpContext(
          {
            context,
            actor,
          },
          next,
        );
      }).catch(next);
    };
  }

  function resolveInboundTraceId(
    req: Request,
  ): string | undefined {
    const traceIdHeader = req.headers["x-trace-id"];
    if (
      typeof traceIdHeader === "string" &&
      traceIdHeader.trim().length > 0
    ) {
      return traceIdHeader.trim();
    }

    const requestIdHeader = req.headers["x-request-id"];
    if (
      typeof requestIdHeader === "string" &&
      requestIdHeader.trim().length > 0
    ) {
      return requestIdHeader.trim();
    }

    return undefined;
  }
