import { Actor } from "@core/actor/actor";
import { SystemInvariantError } from "@core/error/system-error";
import { Permission } from "@core/permission/permission.enum";
import { PermissionContract } from "@core/permission/permission.contract";
import { PermissionResolver } from "@core/permission/permission.resolver";

export const SYSTEM_ACCESS_DEADLINE_WORKER_ACTOR_ID =
  "SYSTEM_ACCESS_DEADLINE_WORKER";
export const ACCESS_DEADLINE_SYSTEM_WORKER_ID =
  "access.deadline-materializer";

export const AUTHORITATIVE_SYSTEM_MUTATION_IDENTITIES = [
  "role.assignment.deadline-suspend",
  "break-glass.deadline-expire",
] as const;
export type AuthoritativeSystemMutationIdentity =
  (typeof AUTHORITATIVE_SYSTEM_MUTATION_IDENTITIES)[number];

export type AuthoritativeSystemMutationCommand =
  | Readonly<{
      kind: "ROLE_ASSIGNMENT_DEADLINE_SUSPEND";
      assignmentId: string;
      candidateCycleId: string;
      candidateDeadline: number;
      transitionId: string;
    }>
  | Readonly<{
      kind: "BREAK_GLASS_DEADLINE_EXPIRE";
      activationId: string;
      candidateDeadline: number;
      transitionId: string;
    }>;

const invocationCapabilities = new WeakSet<object>();

export interface RegisteredSystemWorkerInvocation {
  readonly workerId: typeof ACCESS_DEADLINE_SYSTEM_WORKER_ID;
  readonly jobIdentity: string;
  readonly actor: Actor;
}

/**
 * Runtime capability issuer. The system-worker registrar is the sole production
 * caller. The WeakSet brand makes plain-object/direct service invocation fail
 * closed at the authoritative mutation boundary.
 */
export function issueAccessDeadlineWorkerInvocationForRegistrar(
  jobIdentity: string,
): RegisteredSystemWorkerInvocation {
  assertNonEmpty(jobIdentity, "System worker job identity is required");
  const invocation = Object.freeze({
    workerId: ACCESS_DEADLINE_SYSTEM_WORKER_ID,
    jobIdentity,
    actor: new Actor({
      id: SYSTEM_ACCESS_DEADLINE_WORKER_ACTOR_ID,
      type: "system",
      context: "SYSTEM",
      roles: [],
      permissions: [],
      accountContexts: [],
      isActive: true,
    }),
  });
  invocationCapabilities.add(invocation);
  return invocation;
}

export function assertRegisteredSystemWorkerInvocation(
  invocation: RegisteredSystemWorkerInvocation,
): void {
  if (
    typeof invocation !== "object" ||
    invocation === null ||
    !invocationCapabilities.has(invocation) ||
    invocation.workerId !== ACCESS_DEADLINE_SYSTEM_WORKER_ID ||
    typeof invocation.jobIdentity !== "string" ||
    invocation.jobIdentity.trim().length === 0 ||
    invocation.actor.id !== SYSTEM_ACCESS_DEADLINE_WORKER_ACTOR_ID ||
    invocation.actor.type !== "system" ||
    invocation.actor.context !== "SYSTEM" ||
    !invocation.actor.isActive
  ) {
    throw new SystemInvariantError(
      "PERMISSION_DENIED",
      "Authoritative SYSTEM mutation requires a registered access deadline worker invocation",
    );
  }
}

export function assertAuthoritativeSystemMutationBoundary(params: {
  readonly actor: Actor;
  readonly invocation: RegisteredSystemWorkerInvocation;
  readonly mutationIdentity: AuthoritativeSystemMutationIdentity;
  readonly command: AuthoritativeSystemMutationCommand;
}): PermissionContract {
  assertRegisteredSystemWorkerInvocation(params.invocation);
  if (
    params.actor !== params.invocation.actor ||
    params.actor.id !== SYSTEM_ACCESS_DEADLINE_WORKER_ACTOR_ID ||
    params.actor.type !== "system" ||
    params.actor.context !== "SYSTEM" ||
    !params.actor.isActive
  ) {
    throw new SystemInvariantError(
      "PERMISSION_DENIED",
      "Authoritative SYSTEM mutation actor does not match the registered canonical worker identity",
    );
  }

  const expectedKind =
    params.mutationIdentity === "role.assignment.deadline-suspend"
      ? "ROLE_ASSIGNMENT_DEADLINE_SUSPEND"
      : params.mutationIdentity === "break-glass.deadline-expire"
        ? "BREAK_GLASS_DEADLINE_EXPIRE"
        : null;
  if (expectedKind === null || params.command.kind !== expectedKind) {
    throw new SystemInvariantError(
      "PERMISSION_DENIED",
      "Authoritative SYSTEM mutation identity is not whitelisted for the supplied deadline command",
    );
  }

  assertFiniteDeadline(params.command.candidateDeadline);
  assertNonEmpty(params.command.transitionId, "System transition identity is required");
  if (params.command.kind === "ROLE_ASSIGNMENT_DEADLINE_SUSPEND") {
    assertNonEmpty(params.command.assignmentId, "Assignment id is required");
    assertNonEmpty(params.command.candidateCycleId, "Review cycle id is required");
  } else {
    assertNonEmpty(params.command.activationId, "Activation id is required");
  }

  return PermissionResolver.resolve(
    params.mutationIdentity === "role.assignment.deadline-suspend"
      ? Permission.ROLE_ASSIGNMENT_REVIEW
      : Permission.BREAK_GLASS_ACTIVATE,
  );
}

function assertNonEmpty(value: string, message: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new SystemInvariantError("SYSTEM_INVARIANT_VIOLATION", message);
  }
}

function assertFiniteDeadline(value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      "System deadline command requires a positive finite candidate deadline",
    );
  }
}
