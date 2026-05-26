import {
  NextFunction,
  Request,
  RequestHandler,
  Response,
} from "express";
import { Actor, ActorScopeGrants } from "@core/actor/actor";
import { bindActor } from "@core/actor/actor-context";
import { ContextType } from "@core/context/context.types";
import {
  createStructuredLogger,
  StructuredLogger,
} from "@infra/logger.adapter";

export const LOCAL_MOCK_AUTH_BEARER_TOKEN =
  "mock-access-token";

export interface LocalMockAuthConfig {
  readonly enabled: boolean;
  readonly actorId: string;
  readonly email?: string;
  readonly permissions: readonly string[];
  readonly scopeGrants: ActorScopeGrants;
}

export const LOCAL_MOCK_AUTH_DISABLED_CONFIG: LocalMockAuthConfig =
  Object.freeze({
    enabled: false,
    actorId: "local-mock-admin-actor",
    permissions: Object.freeze([]),
    scopeGrants: Object.freeze({}),
  });

export function createLocalMockAuthConfig(params: {
  readonly enabled: boolean;
  readonly actorId: string;
  readonly email?: string;
  readonly permissions: readonly string[];
  readonly scopeGrants: ActorScopeGrants;
}): LocalMockAuthConfig {
  return Object.freeze({
    enabled: params.enabled,
    actorId: params.actorId,
    email: params.email,
    permissions: Object.freeze([...params.permissions]),
    scopeGrants: params.scopeGrants,
  });
}

export function createLocalMockAuthMiddleware(params: {
  readonly context: ContextType;
  readonly config?: LocalMockAuthConfig;
  readonly fallback: RequestHandler;
  readonly logger?: StructuredLogger;
}): RequestHandler {
  const config =
    params.config ?? LOCAL_MOCK_AUTH_DISABLED_CONFIG;
  const logger =
    params.logger ?? createStructuredLogger();

  if (config.enabled) {
    logger.warn({
      traceId: "LOCAL_MOCK_AUTH",
      actorId: config.actorId,
      context: params.context,
      operation: "auth.local-mock",
      status: "ENABLED_LOCAL_ONLY",
      timestamp: Date.now(),
    });
  }

  return (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    if (
      config.enabled &&
      isFrontendLocalMockBearer(req)
    ) {
      bindActor(
        req,
        new Actor({
          id: config.actorId,
          type:
            params.context === "SELF_SERVICE"
              ? "staff"
              : "admin",
          context: params.context,
          roles: [],
          permissions: config.permissions,
          scopeGrants: config.scopeGrants,
          trace: {
            ip: req.ip,
            userAgent: req.headers["user-agent"],
          },
          isActive: true,
        }),
      );

      next();
      return;
    }

    params.fallback(req, res, next);
  };
}

function isFrontendLocalMockBearer(req: Request): boolean {
  const authorization = req.headers.authorization;

  if (typeof authorization !== "string") {
    return false;
  }

  const parts = authorization.trim().split(/\s+/u);
  if (parts.length !== 2) {
    return false;
  }

  const [scheme, token] = parts;
  return (
    scheme?.toLowerCase() === "bearer" &&
    token === LOCAL_MOCK_AUTH_BEARER_TOKEN
  );
}
