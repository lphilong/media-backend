import {
  Router,
  Request,
  Response,
  NextFunction,
} from "express";
import { ContextType } from "@core/context/context.types";
import { contextMiddleware } from "@core/context/context.middleware.adapter";
import { getActor } from "@core/actor/actor-context";
import {
  Auth0ActorResolver,
  auth0JwtMiddleware,
} from "@app/auth";
import { SystemInvariantError } from "@core/error/system-error";

function assertSecureHttpContext(
  context: ContextType,
): "ADMIN" {
  if (context === "ADMIN") {
    return context;
  }

  throw new SystemInvariantError(
    "SYSTEM_INVARIANT_VIOLATION",
    `Secure HTTP router can only be bound to ADMIN context. Received: ${context}`,
  );
}

export function createSecureRouter(options: {
  context: ContextType;
  auth0: {
    issuerBaseURL: string;
    audience: string;
  };
  actorResolver: Auth0ActorResolver;
}): Router {
  const context = assertSecureHttpContext(
    options.context,
  );

  const router = Router();

  router.use(contextMiddleware(context));

  router.use(
    auth0JwtMiddleware({
      issuerBaseURL: options.auth0.issuerBaseURL,
      audience: options.auth0.audience,
    }),
  );

  router.use(
    async (
      req: Request,
      _res: Response,
      next: NextFunction,
    ) => {
      try {
        await options.actorResolver.resolve(req);

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