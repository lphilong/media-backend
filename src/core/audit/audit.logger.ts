import { AuditEvent } from "./audit.types";
import {
  createStructuredLogger,
  StructuredLogger,
} from "@infra/logger.adapter";
import { ClientSession } from "mongodb";

/**
 * AuditLogger interface.
 * Implementations may fail — AuditGuard decides fail-open or fail-closed.
 */
export interface AuditLogger {
  log(
    event: AuditEvent,
    session?: ClientSession,
  ): Promise<void>;
}

/**
 * Default console logger (DEV / fallback).
 */
export class ConsoleAuditLogger implements AuditLogger {
  private readonly logger: StructuredLogger;

  constructor() {
    this.logger = createStructuredLogger();
  }

  async log(
    event: AuditEvent,
    _session?: ClientSession,
  ): Promise<void> {
    this.logger.info({
      traceId: event.traceId,
      actorId: event.actorId,
      context: event.context,
      operation: "audit.record",
      status: "SUCCESS",
      timestamp: event.occurredAt,
      metadata: {
        action: event.action,
        resource: event.resource,
        resourceId: event.resourceId,
        riskLevel: event.riskLevel,
      },
    });
  }
}
