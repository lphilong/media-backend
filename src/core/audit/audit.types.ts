import { ContextType } from "../context/context.types";
import { RiskLevel } from "../permission/permission.contract";
import type { AuditMutationAttemptProof } from "./audit.context";

/**
 * Who did what, where, when, with what risk.
 * Immutable historical snapshot.
 */
export interface AuditEvent {
  readonly id: string;
  readonly actorId: string;
  readonly actorType: string;
  readonly context: ContextType;

  // Snapshot values – NOT enum
  readonly action: string;
  readonly resource: string;
  readonly resourceId?: string;

  readonly riskLevel: RiskLevel;
  readonly traceId: string;

  readonly ip?: string;
  readonly userAgent?: string;

  readonly occurredAt: number;
  readonly metadata?: Record<string, unknown>;
  readonly mutationAttemptProof: AuditMutationAttemptProof;
}
