import { ClientSession } from "mongodb";

import { AuditLogger } from "./audit.logger";
import { AuditEvent } from "./audit.types";
import {
  AuditWriteRecord,
  AuditWriteRepository,
} from "@core/audit/audit.write.repository";

export class MongoAuditLogger implements AuditLogger {
  constructor(
    private readonly repo: AuditWriteRepository,
  ) {}

  async log(
    event: AuditEvent,
    session?: ClientSession,
  ): Promise<void> {
    await this.repo.append(
      toAuditWriteRecord(event),
      session,
    );
  }
}

function toAuditWriteRecord(
  event: AuditEvent,
): AuditWriteRecord {
  return {
    _id: event.id,
    actorId: event.actorId,
    actorType: event.actorType,
    context: event.context,
    action: event.action,
    resource: event.resource,
    resourceId: event.resourceId,
    riskLevel: event.riskLevel,
    traceId: event.traceId,
    ip: event.ip,
    userAgent: event.userAgent,
    occurredAt: event.occurredAt,
    metadata: event.metadata
      ? { ...event.metadata }
      : undefined,
    mutationAttemptProof: {
      ...event.mutationAttemptProof,
    },
  };
}
