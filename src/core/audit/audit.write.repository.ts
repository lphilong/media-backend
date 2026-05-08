import { ClientSession } from "mongodb";
import { ContextType } from "@core/context/context.types";
import { RiskLevel } from "@core/permission/permission.contract";
import type { AuditMutationAttemptProof } from "@core/audit/audit.context";

export interface AuditWriteRecord {
  readonly _id: string;
  readonly actorId: string;
  readonly actorType: string;
  readonly context: ContextType;
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

export interface AuditWriteRepository {
  append(
    record: AuditWriteRecord,
    session?: ClientSession,
  ): Promise<void>;

  hasMutationAttemptProof(
    proof: AuditMutationAttemptProof,
    session?: ClientSession,
  ): Promise<boolean>;
}
