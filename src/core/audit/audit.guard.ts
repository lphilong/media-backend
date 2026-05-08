import { v4 as uuidv4 } from "uuid";
import { Actor } from "../actor/actor";
import { PermissionContract } from "../permission/permission.contract";
import { deriveAuditContract } from "./audit.contract";
import { AuditEvent } from "./audit.types";
import { AuditLogger } from "./audit.logger";
import { assertContextType } from "../context/context.utils";
import { SystemInvariantError } from "../error/system-error";
import { AuditContext } from "./audit.context";
import { ClientSession } from "mongodb";
import { getTraceIdOrThrow } from "@core/trace/trace.context";

export class AuditGuard {
  constructor(
    private readonly logger: AuditLogger,
    private readonly context: AuditContext,
  ) {
    if (!logger) {
      throw new SystemInvariantError(
        "AUDIT_LOG_FAILED",
        "AuditLogger must be provided",
      );
    }
  }

  async record(
    actor: Actor,
    permission: PermissionContract,
    resourceId?: string,
    metadata?: Record<string, unknown>,
    session?: ClientSession,
  ): Promise<void> {
    const audit = deriveAuditContract(permission);
    const metadataWithoutReservedKeys =
      sanitizeMetadata(metadata);

    this.context.assertScope();
    this.context.assertAttemptScope();

    const expectedProof =
      this.context.readExpectedProofInCurrentAttempt();
    assertCanonicalMutationIdentity(
      expectedProof.mutationIdentity,
      metadataWithoutReservedKeys,
    );

    if (expectedProof.actorId !== actor.id) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        `Audit actor mismatch for current authoritative attempt. Expected ${expectedProof.actorId}, received ${actor.id}`,
      );
    }

    if (expectedProof.permissionCode !== permission.code) {
      throw new SystemInvariantError(
        "SYSTEM_INVARIANT_VIOLATION",
        `Audit permission mismatch for current authoritative attempt. Expected ${expectedProof.permissionCode}, received ${permission.code}`,
      );
    }

    const event: AuditEvent = Object.freeze({
      id: uuidv4(),
      actorId: actor.id,
      actorType: actor.type,
      context: assertContextType(actor.context),

      action: audit.action,
      resource: audit.resource,
      resourceId,

      riskLevel: permission.riskLevel,
      traceId: getTraceIdOrThrow(),

      ip: actor.trace?.ip,
      userAgent: actor.trace?.userAgent,

      occurredAt: Date.now(),
      metadata: metadataWithoutReservedKeys,
      mutationAttemptProof: expectedProof,
    });

    try {
      await this.logger.log(event, session);
    } catch (error) {
      throw new SystemInvariantError(
        "AUDIT_LOG_FAILED",
        `Audit logging failed for ${permission.code} (risk: ${permission.riskLevel})`,
      );
    }
  }
}

function sanitizeMetadata(
  metadata?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!metadata) {
    return undefined;
  }

  const sanitized = Object.fromEntries(
    Object.entries(metadata).filter(
      ([key]) => key !== "traceId" && key !== "requestId",
    ),
  );

  return Object.keys(sanitized).length > 0
    ? sanitized
    : undefined;
}

function assertCanonicalMutationIdentity(
  mutationIdentity: string,
  metadata?: Record<string, unknown>,
): void {
  if (!metadata) {
    return;
  }

  const metadataMutationType = metadata.mutationType;

  if (metadataMutationType === undefined) {
    return;
  }

  if (typeof metadataMutationType !== "string") {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      "Audit metadata mutationType must be a string when provided",
    );
  }

  if (metadataMutationType === mutationIdentity) {
    return;
  }

  throw new SystemInvariantError(
    "SYSTEM_INVARIANT_VIOLATION",
    `Audit metadata mutationType mismatch. Expected ${mutationIdentity}, received ${metadataMutationType}`,
  );
}
