import {
  Router,
  Request,
  Response,
  NextFunction,
} from "express";
import { ContextType } from "@core/context/context.types";
import { contextMiddleware } from "@core/context/context.middleware.adapter";
import {
  getActor,
  hasActor,
} from "@core/actor/actor-context";
import {
  Auth0ActorResolver,
  auth0JwtMiddleware,
  createLocalMockAuthMiddleware,
} from "@app/auth";
import type { LocalMockAuthConfig } from "@app/auth";
import { SystemInvariantError } from "@core/error/system-error";

function assertSecureHttpContext(
  context: ContextType,
): "ADMIN" | "SELF_SERVICE" {
  if (context === "ADMIN" || context === "SELF_SERVICE") {
    return context;
  }

  throw new SystemInvariantError(
    "SYSTEM_INVARIANT_VIOLATION",
    `Secure HTTP router can only be bound to ADMIN or SELF_SERVICE context. Received: ${context}`,
  );
}

export function createSecureRouter(options: {
  context: ContextType;
  auth0: {
    issuerBaseURL: string;
    audience: string;
  };
  actorResolver: Auth0ActorResolver;
  localMockAuth?: LocalMockAuthConfig;
}): Router {
  const context = assertSecureHttpContext(
    options.context,
  );

  const router = Router();

  router.use(contextMiddleware(context));

  const jwtMiddleware = auth0JwtMiddleware({
    issuerBaseURL: options.auth0.issuerBaseURL,
    audience: options.auth0.audience,
  });

  router.use(
    createLocalMockAuthMiddleware({
      context,
      config: options.localMockAuth,
      fallback: jwtMiddleware,
    }),
  );

  router.use(
    async (
      req: Request,
      _res: Response,
      next: NextFunction,
    ) => {
      try {
        if (!hasActor(req)) {
          await options.actorResolver.resolve(req);
        }

        // Fail-closed guarantee
        getActor(req);

        next();
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
