import {
  ClientSession,
  Collection,
  Db,
} from "mongodb";

import {
  AuditWriteRecord,
  AuditWriteRepository,
} from "@core/audit/audit.write.repository";
import type { AuditMutationAttemptProof } from "@core/audit/audit.context";
import { InfrastructureError } from "@infra/errors/infrastructure.error";

export const AUDIT_LOG_COLLECTION_NAME = "audit_logs";

type AuditWriteDocument = AuditWriteRecord;

export class MongoAuditWriteRepository
  implements AuditWriteRepository
{
  private readonly collection: Collection<AuditWriteDocument>;

  constructor(db: Db) {
    this.collection = db.collection<AuditWriteDocument>(
      AUDIT_LOG_COLLECTION_NAME,
    );
  }

  async append(
    record: AuditWriteRecord,
    session?: ClientSession,
  ): Promise<void> {
    try {
      await this.collection.insertOne(
        {
          ...record,
          metadata: record.metadata
            ? { ...record.metadata }
            : undefined,
        },
        session ? { session } : undefined,
      );
    } catch (error) {
      throw new InfrastructureError(
        "AUDIT_WRITE_FAILED",
        `Failed to persist audit record ${record._id}: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`,
      );
    }
  }

  async hasMutationAttemptProof(
    proof: AuditMutationAttemptProof,
    session?: ClientSession,
  ): Promise<boolean> {
    try {
      const match = await this.collection.findOne(
        {
          "mutationAttemptProof.attemptId":
            proof.attemptId,
          "mutationAttemptProof.actorId":
            proof.actorId,
          "mutationAttemptProof.permissionCode":
            proof.permissionCode,
          "mutationAttemptProof.mutationIdentity":
            proof.mutationIdentity,
          "mutationAttemptProof.targetDescriptor":
            proof.targetDescriptor,
        },
        {
          session,
          projection: { _id: 1 },
        },
      );

      return match !== null;
    } catch (error) {
      throw new InfrastructureError(
        "AUDIT_WRITE_FAILED",
        `Failed to verify audit mutation-attempt proof ${proof.attemptId}: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`,
      );
    }
  }
}
