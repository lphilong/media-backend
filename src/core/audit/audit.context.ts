import { AsyncLocalStorage } from "node:async_hooks";
import { SystemInvariantError } from "../error/system-error";

export interface AuditMutationAttemptProof {
  readonly attemptId: string;
  readonly actorId: string;
  readonly permissionCode: string;
  readonly mutationIdentity: string;
  readonly targetDescriptor: string;
}

type AuditAttemptStore = {
  readonly expectedProof: AuditMutationAttemptProof;
};

type AuditStore = {
  currentAttempt: AuditAttemptStore | null;
};

const auditAls = new AsyncLocalStorage<AuditStore>();

/**
 * Execution boundary initializer.
 * Must be applied per HTTP request and per worker job.
 */
export function runWithAuditContext<T>(fn: () => T): T {
  return auditAls.run(
    {
      currentAttempt: null,
    },
    fn,
  );
}

export async function runWithAuditAttemptScope<T>(
  expectedProof: AuditMutationAttemptProof,
  fn: () => Promise<T>,
): Promise<T> {
  const store = getStoreOrThrow();

  if (store.currentAttempt !== null) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      "Nested authoritative audit attempt scope is forbidden",
    );
  }

  assertAuditMutationAttemptProof(expectedProof);

  store.currentAttempt = {
    expectedProof: Object.freeze({
      ...expectedProof,
    }),
  };

  try {
    return await fn();
  } finally {
    store.currentAttempt = null;
  }
}

function getStoreOrThrow(): AuditStore {
  const store = auditAls.getStore();
  if (!store) {
    throw new SystemInvariantError(
      "AUDIT_CONTEXT_MISSING",
      "AuditContext store is missing. Ensure runWithAuditContext() is applied at the execution boundary.",
    );
  }
  return store;
}

function getAttemptStoreOrThrow(): AuditAttemptStore {
  const store = getStoreOrThrow();

  if (!store.currentAttempt) {
    throw new SystemInvariantError(
      "AUDIT_ATTEMPT_CONTEXT_MISSING",
      "Authoritative mutation audit attempt scope is missing.",
    );
  }

  return store.currentAttempt;
}

function assertAuditMutationAttemptProof(
  proof: AuditMutationAttemptProof,
): void {
  assertNonEmptyString(
    proof.attemptId,
    "Audit proof attemptId is required",
  );
  assertNonEmptyString(
    proof.actorId,
    "Audit proof actorId is required",
  );
  assertNonEmptyString(
    proof.permissionCode,
    "Audit proof permissionCode is required",
  );
  assertNonEmptyString(
    proof.mutationIdentity,
    "Audit proof mutationIdentity is required",
  );
  assertNonEmptyString(
    proof.targetDescriptor,
    "Audit proof targetDescriptor is required",
  );
}

function assertNonEmptyString(
  value: string,
  message: string,
): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      message,
    );
  }
}

/**
 * AuditContext is a thin wrapper over AsyncLocalStorage store.
 * Request/job scope is initialized at the execution boundary.
 * Authoritative mutation attempt scope is initialized per bridge attempt.
 */
export class AuditContext {
  assertScope(): void {
    getStoreOrThrow();
  }

  assertAttemptScope(): void {
    getAttemptStoreOrThrow();
  }

  readExpectedProofInCurrentAttempt(): AuditMutationAttemptProof {
    const attemptStore = getAttemptStoreOrThrow();
    return attemptStore.expectedProof;
  }
}
