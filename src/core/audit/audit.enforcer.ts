import { SystemInvariantError } from "../error/system-error";
import { ClientSession } from "mongodb";
import { AuditMutationAttemptProof } from "./audit.context";
import { AuditWriteRepository } from "./audit.write.repository";

/**
 * Enforce that a permission-triggered mutation
 * must be accompanied by a successful audit record
 * inside the current authoritative mutation attempt.
 */
export async function assertAudited(params: {
  readonly repository: AuditWriteRepository;
  readonly proof: AuditMutationAttemptProof;
  readonly session: ClientSession;
}): Promise<void> {
  const proofExists =
    await params.repository.hasMutationAttemptProof(
      params.proof,
      params.session,
    );

  if (!proofExists) {
    throw new SystemInvariantError(
      "AUDIT_LOG_MISSING",
      `Authoritative mutation ${params.proof.mutationIdentity} missing persisted exact audit proof for current attempt ${params.proof.attemptId}`,
    );
  }
}
