import { NextFunction, Request, Response } from "express";
import { runWithAuditContext } from "./audit.context";

export function auditScopeMiddleware(
  _req: Request,
  _res: Response,
  next: NextFunction,
): void {
  runWithAuditContext(() => {
    next();
  });
}
