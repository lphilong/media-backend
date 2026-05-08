import { Request, Response, NextFunction } from "express";
import { ContextType } from "./context.types";
import { bindContext } from "./context.middleware";

/**
 * Express middleware adapter for Core bindContext.
 * Application-layer responsibility.
 */
export function contextMiddleware(context: ContextType) {
  return (req: Request, _res: Response, next: NextFunction) => {
    bindContext(req, context);
    next();
  };
}