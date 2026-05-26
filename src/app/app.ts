import express from "express";
import helmet from "helmet";
import cors from "cors";
import compression from "compression";

import { httpErrorMiddleware } from "./http/http-error.middleware";
import { createSecureRouter } from "./router/secure-router";
import { Auth0ActorResolver } from "./auth/auth0.actor.resolver";
import { createLocalMockAuthConfig } from "./auth/local-mock-auth.middleware";
import { env } from "@config/env";
import { createAdminRoutes } from "./router/admin.routes";
import { createSelfServiceRoutes } from "./router/self-service.routes";
import { InfraModule } from "@infra/infra.module";
import { httpContextMiddleware } from "./http/http-context.middleware";
import { httpTraceMiddleware } from "./http/http-trace.middleware";
import {
  bindPresenterRegistry,
  PresenterRegistryAccess,
} from "./presenter/presenter.runtime-access";
import { createHttpMetricsMiddleware } from "@infra/metrics/prometheus.registry";
import { SystemInvariantError } from "@core/error/system-error";
import { HttpError } from "./http/http-error.types";

export async function createApp(options: {
  actorResolver: Auth0ActorResolver;
  infra: InfraModule;
  presenterRegistry: PresenterRegistryAccess;
}) {
  const app = express();
  bindPresenterRegistry(app, options.presenterRegistry);

  if (env.TRUST_PROXY > 0) {
    app.set("trust proxy", env.TRUST_PROXY);
  }

  app.use(helmet());
  app.use(
    cors({
      origin:
        env.CORS_ORIGINS.length > 0
          ? env.CORS_ORIGINS
          : false,
      credentials: true,
    }),
  );
  app.use(compression());
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: false }));
  app.use(httpTraceMiddleware());
  // Business-plane app collects request metrics only.
  // Management endpoints (/metrics, /livez, /readyz) are served by a dedicated management listener.
  app.use(createHttpMetricsMiddleware("http"));

  const adminRoutes = await createAdminRoutes(options.infra);
  const selfServiceRoutes = await createSelfServiceRoutes(options.infra);

  app.use(
    "/admin",
    createSecureRouter({
      context: "ADMIN",
      auth0: {
        issuerBaseURL: requireHttpAuth0IssuerBaseUrl(),
        audience: requireHttpAuth0Audience(),
      },
      actorResolver: options.actorResolver,
      localMockAuth: createLocalMockAuthConfig({
        enabled: env.LOCAL_MOCK_AUTH_ENABLED,
        actorId: env.LOCAL_MOCK_AUTH_ACTOR_ID,
        email: env.LOCAL_MOCK_AUTH_EMAIL,
        permissions: env.LOCAL_MOCK_AUTH_PERMISSIONS,
        scopeGrants: env.LOCAL_MOCK_AUTH_SCOPE_GRANTS,
      }),
    }),
    httpContextMiddleware(),
    adminRoutes,
  );

  app.use(
    "/self-service",
    createSecureRouter({
      context: "SELF_SERVICE",
      auth0: {
        issuerBaseURL: requireHttpAuth0IssuerBaseUrl(),
        audience: requireHttpAuth0Audience(),
      },
      actorResolver: options.actorResolver,
      localMockAuth: createLocalMockAuthConfig({
        enabled: env.LOCAL_MOCK_AUTH_ENABLED,
        actorId: env.LOCAL_MOCK_AUTH_ACTOR_ID,
        email: env.LOCAL_MOCK_AUTH_EMAIL,
        permissions: env.LOCAL_MOCK_AUTH_PERMISSIONS,
        scopeGrants: env.LOCAL_MOCK_AUTH_SCOPE_GRANTS,
      }),
    }),
    httpContextMiddleware(),
    selfServiceRoutes,
  );

  app.use((_req, _res, next) => {
    next(
      new HttpError(
        404,
        "NOT_FOUND",
        "Resource not found",
      ),
    );
  });

  app.use(httpErrorMiddleware);

  return app;
}

function requireHttpAuth0IssuerBaseUrl(): string {
  if (env.APP_RUNTIME !== "http") {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      "HTTP app creation is forbidden outside APP_RUNTIME=http",
    );
  }

  if (!env.AUTH0_ISSUER_BASE_URL) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      "AUTH0_ISSUER_BASE_URL is required for HTTP runtime",
    );
  }

  return env.AUTH0_ISSUER_BASE_URL;
}

function requireHttpAuth0Audience(): string {
  if (env.APP_RUNTIME !== "http") {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      "HTTP app creation is forbidden outside APP_RUNTIME=http",
    );
  }

  if (!env.AUTH0_AUDIENCE) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      "AUTH0_AUDIENCE is required for HTTP runtime",
    );
  }

  return env.AUTH0_AUDIENCE;
}
