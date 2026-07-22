import { ClientSession, Db } from "mongodb";
import { SystemInvariantError } from "@core/error/system-error";
import { AccessAuthorityReconciliationRepository } from "@modules/role/domain/access-lifecycle.repositories";
import { NativeMongoAccessAuthorityReconciliationRepository } from "@infra/mongo/role/access-lifecycle.repository";

/**
 * Reconciles only prerequisites that P2 created with explicit source lineage.
 * Pre-existing unlinked records are never guessed at or silently removed.
 */
export class AccessAuthorityReconciliationService {
  private readonly repository: AccessAuthorityReconciliationRepository;

  constructor(
    db: Db,
    repository?: AccessAuthorityReconciliationRepository,
  ) {
    this.repository =
      repository ?? new NativeMongoAccessAuthorityReconciliationRepository(db);
  }

  async transferSource(
    predecessorAssignmentId: string,
    successorAssignmentId: string,
    session: ClientSession,
  ): Promise<void> {
    await this.repository.addSuccessorSource(
      predecessorAssignmentId,
      successorAssignmentId,
      session,
    );
  }

  async reconcileReducedAssignment(
    assignmentId: string,
    actorId: string,
    now: number,
    session: ClientSession,
  ): Promise<void> {
    const records =
      await this.repository.listActivePrerequisitesBySource(
        assignmentId,
        session,
      );
    for (const record of records) {
      const remaining = await this.repository.countActiveAssignments(
        record.sourceRoleAssignmentIds,
        session,
      );
      if (remaining > 0) continue;

      const sourceRevoked =
        record.kind === "ACCOUNT_CONTEXT"
          ? await this.repository.revokeGeneratedAccountContext(
              record,
              now,
              session,
            )
          : await this.repository.revokeGeneratedResponsibility(
              record,
              actorId,
              now,
              session,
            );
      if (!sourceRevoked) {
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          `Generated ${record.kind} reconciliation failed for ${record.prerequisiteId}`,
        );
      }
      if (
        !(await this.repository.markPrerequisiteRevoked(
          record.prerequisiteId,
          now,
          session,
        ))
      ) {
        throw new SystemInvariantError(
          "SYSTEM_INVARIANT_VIOLATION",
          `Generated prerequisite state changed during reconciliation: ${record.prerequisiteId}`,
        );
      }
    }
  }

  async reconcileBundleParent(
    bundleAssignmentId: string | null | undefined,
    actorId: string,
    now: number,
    session: ClientSession,
  ): Promise<void> {
    if (!bundleAssignmentId) return;
    if (
      (await this.repository.countActiveBundleChildren(
        bundleAssignmentId,
        session,
      )) > 0
    ) {
      return;
    }
    await this.repository.revokeBundleParent(
      bundleAssignmentId,
      actorId,
      now,
      session,
    );
  }
}
