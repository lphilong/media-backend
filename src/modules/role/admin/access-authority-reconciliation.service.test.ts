import assert from "node:assert/strict";
import test from "node:test";
import type { ClientSession, Db } from "mongodb";
import type {
  AccessAuthorityReconciliationRepository,
  GeneratedAccessPrerequisiteRecord,
} from "../domain/access-lifecycle.repositories";
import { AccessAuthorityReconciliationService } from "./access-authority-reconciliation.service";

class ReconciliationRepositoryFake
  implements AccessAuthorityReconciliationRepository
{
  records: GeneratedAccessPrerequisiteRecord[] = [];
  activeAssignmentCount = 0;
  accountContextRevocations: string[] = [];
  responsibilityRevocations: string[] = [];
  prerequisiteRevocations: string[] = [];
  sourceTransfers: string[] = [];
  activeBundleChildren = 0;
  bundleRevocations: string[] = [];
  failPrerequisiteMark = false;

  async addSuccessorSource(predecessor: string, successor: string): Promise<void> {
    this.sourceTransfers.push(`${predecessor}->${successor}`);
  }
  async listActivePrerequisitesBySource(): Promise<readonly GeneratedAccessPrerequisiteRecord[]> {
    return this.records;
  }
  async countActiveAssignments(): Promise<number> {
    return this.activeAssignmentCount;
  }
  async revokeGeneratedAccountContext(record: GeneratedAccessPrerequisiteRecord): Promise<boolean> {
    this.accountContextRevocations.push(record.value);
    return true;
  }
  async revokeGeneratedResponsibility(record: GeneratedAccessPrerequisiteRecord): Promise<boolean> {
    this.responsibilityRevocations.push(record.value);
    return true;
  }
  async markPrerequisiteRevoked(prerequisiteId: string): Promise<boolean> {
    if (this.failPrerequisiteMark) return false;
    this.prerequisiteRevocations.push(prerequisiteId);
    return true;
  }
  async countActiveBundleChildren(): Promise<number> {
    return this.activeBundleChildren;
  }
  async revokeBundleParent(bundleAssignmentId: string): Promise<void> {
    this.bundleRevocations.push(bundleAssignmentId);
  }
}

const session = {} as ClientSession;

test("generated prerequisite is preserved while another active source remains", async () => {
  const repository = new ReconciliationRepositoryFake();
  repository.records = [prerequisite("ACCOUNT_CONTEXT", "ADMIN_CONSOLE")];
  repository.activeAssignmentCount = 1;
  const service = createService(repository);
  await service.reconcileReducedAssignment("assignment-1", "system", 1, session);
  assert.deepEqual(repository.accountContextRevocations, []);
  assert.deepEqual(repository.prerequisiteRevocations, []);
});

test("generated Account Context and Responsibility are removed only after their last source", async () => {
  const repository = new ReconciliationRepositoryFake();
  repository.records = [
    prerequisite("ACCOUNT_CONTEXT", "ADMIN_CONSOLE"),
    prerequisite("RESPONSIBILITY", "responsibility-1", "prerequisite-2"),
  ];
  const service = createService(repository);
  await service.reconcileReducedAssignment("assignment-1", "system", 1, session);
  assert.deepEqual(repository.accountContextRevocations, ["ADMIN_CONSOLE"]);
  assert.deepEqual(repository.responsibilityRevocations, ["responsibility-1"]);
  assert.deepEqual(repository.prerequisiteRevocations, ["prerequisite-1", "prerequisite-2"]);
});

test("pre-P2 unlinked records are not guessed or deleted", async () => {
  const repository = new ReconciliationRepositoryFake();
  const service = createService(repository);
  await service.reconcileReducedAssignment("legacy-unlinked", "system", 1, session);
  assert.deepEqual(repository.accountContextRevocations, []);
  assert.deepEqual(repository.responsibilityRevocations, []);
});

test("bundle parent follows active children and source transfer remains explicit", async () => {
  const repository = new ReconciliationRepositoryFake();
  const service = createService(repository);
  await service.transferSource("old", "new", session);
  repository.activeBundleChildren = 1;
  await service.reconcileBundleParent("bundle-1", "system", 1, session);
  repository.activeBundleChildren = 0;
  await service.reconcileBundleParent("bundle-1", "system", 2, session);
  assert.deepEqual(repository.sourceTransfers, ["old->new"]);
  assert.deepEqual(repository.bundleRevocations, ["bundle-1"]);
});

test("failed required reconciliation follow-up throws for transaction rollback", async () => {
  const repository = new ReconciliationRepositoryFake();
  repository.records = [prerequisite("ACCOUNT_CONTEXT", "ADMIN_CONSOLE")];
  repository.failPrerequisiteMark = true;
  const service = createService(repository);
  await assert.rejects(
    service.reconcileReducedAssignment("assignment-1", "system", 1, session),
    /state changed during reconciliation/u,
  );
});

function createService(
  repository: AccessAuthorityReconciliationRepository,
): AccessAuthorityReconciliationService {
  return new AccessAuthorityReconciliationService({} as Db, repository);
}

function prerequisite(
  kind: GeneratedAccessPrerequisiteRecord["kind"],
  value: string,
  prerequisiteId = "prerequisite-1",
): GeneratedAccessPrerequisiteRecord {
  return {
    prerequisiteId,
    targetUserId: "target",
    sourceRoleAssignmentIds: ["assignment-1", "assignment-2"],
    kind,
    value,
  };
}
