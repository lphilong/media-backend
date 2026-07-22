import assert from "node:assert/strict";
import test from "node:test";
import { Actor } from "@core/actor/actor";
import {
  ACCESS_DEADLINE_SYSTEM_WORKER_ID,
  SYSTEM_ACCESS_DEADLINE_WORKER_ACTOR_ID,
  assertAuthoritativeSystemMutationBoundary,
  assertRegisteredSystemWorkerInvocation,
  issueAccessDeadlineWorkerInvocationForRegistrar,
  RegisteredSystemWorkerInvocation,
} from "./authoritative-system-mutation.policy";
import { resolveAuthoritativePermissionForMutationIdentity } from "./authoritative-admin-mutation.permission-map";
import { Permission } from "@core/permission/permission.enum";
import { getSystemWorkerRegistrations } from "@bootstrap/system-worker.registrar";

test("existing ADMIN mutation identity mapping remains authoritative", () => {
  assert.equal(
    resolveAuthoritativePermissionForMutationIdentity("role.assignment.review").code,
    Permission.ROLE_ASSIGNMENT_REVIEW,
  );
});

test("SYSTEM boundary accepts only the two OD-P2-06 deadline reductions", () => {
  const invocation = issueAccessDeadlineWorkerInvocationForRegistrar("job-1");
  const assignmentPermission = assertAuthoritativeSystemMutationBoundary({
    actor: invocation.actor,
    invocation,
    mutationIdentity: "role.assignment.deadline-suspend",
    command: {
      kind: "ROLE_ASSIGNMENT_DEADLINE_SUSPEND",
      assignmentId: "assignment-1",
      candidateCycleId: "cycle-1",
      candidateDeadline: 1,
      transitionId: "transition-1",
    },
  });
  const expiryPermission = assertAuthoritativeSystemMutationBoundary({
    actor: invocation.actor,
    invocation,
    mutationIdentity: "break-glass.deadline-expire",
    command: {
      kind: "BREAK_GLASS_DEADLINE_EXPIRE",
      activationId: "activation-1",
      candidateDeadline: 1,
      transitionId: "transition-2",
    },
  });
  assert.equal(assignmentPermission.code, Permission.ROLE_ASSIGNMENT_REVIEW);
  assert.equal(expiryPermission.code, Permission.BREAK_GLASS_ACTIVATE);
  assert.equal(invocation.actor.permissions.length, 0);
});

test("SYSTEM boundary rejects non-whitelisted identities, mismatched commands, and malformed deadlines", () => {
  const invocation = issueAccessDeadlineWorkerInvocationForRegistrar("job-2");
  const base = {
    actor: invocation.actor,
    invocation,
    command: {
      kind: "ROLE_ASSIGNMENT_DEADLINE_SUSPEND" as const,
      assignmentId: "assignment-1",
      candidateCycleId: "cycle-1",
      candidateDeadline: 1,
      transitionId: "transition-1",
    },
  };
  assert.throws(
    () => assertAuthoritativeSystemMutationBoundary({
      ...base,
      mutationIdentity: "role.assignment.review" as never,
    }),
    /not whitelisted/u,
  );
  assert.throws(
    () => assertAuthoritativeSystemMutationBoundary({
      actor: invocation.actor,
      invocation,
      mutationIdentity: "break-glass.deadline-expire",
      command: base.command,
    }),
    /not whitelisted/u,
  );
  assert.throws(
    () => assertAuthoritativeSystemMutationBoundary({
      ...base,
      mutationIdentity: "role.assignment.deadline-suspend",
      command: { ...base.command, candidateDeadline: Number.NaN },
    }),
    /positive finite/u,
  );
});

test("human ADMIN and wrong SYSTEM identities cannot masquerade as the registered worker", () => {
  const invocation = issueAccessDeadlineWorkerInvocationForRegistrar("job-3");
  const command = {
    kind: "ROLE_ASSIGNMENT_DEADLINE_SUSPEND" as const,
    assignmentId: "assignment-1",
    candidateCycleId: "cycle-1",
    candidateDeadline: 1,
    transitionId: "transition-1",
  };
  const human = new Actor({
    id: SYSTEM_ACCESS_DEADLINE_WORKER_ACTOR_ID,
    type: "admin",
    context: "ADMIN",
    roles: [],
    permissions: [Permission.ROLE_ASSIGNMENT_REVIEW],
    accountContexts: ["ADMIN_CONSOLE"],
    isActive: true,
  });
  const wrongSystem = new Actor({
    id: "SYSTEM_OTHER_WORKER",
    type: "system",
    context: "SYSTEM",
    roles: [],
    permissions: [],
    accountContexts: [],
    isActive: true,
  });
  for (const actor of [human, wrongSystem]) {
    assert.throws(
      () => assertAuthoritativeSystemMutationBoundary({
        actor,
        invocation,
        mutationIdentity: "role.assignment.deadline-suspend",
        command,
      }),
      /canonical worker identity/u,
    );
  }
});

test("plain-object direct invocation is denied by the registrar capability brand", () => {
  const raw = {
    workerId: ACCESS_DEADLINE_SYSTEM_WORKER_ID,
    jobIdentity: "direct-call",
    actor: new Actor({
      id: SYSTEM_ACCESS_DEADLINE_WORKER_ACTOR_ID,
      type: "system",
      context: "SYSTEM",
      roles: [],
      permissions: [],
      accountContexts: [],
      isActive: true,
    }),
  } as const;
  assert.throws(
    () => assertRegisteredSystemWorkerInvocation(raw),
    /registered access deadline worker invocation/u,
  );
});

test("canonical registrar includes and invokes the deadline worker under SYSTEM identity", async () => {
  let stopped = false;
  let invocationSeen = false;
  const registrations = getSystemWorkerRegistrations({
    logger: { info() {}, warn() {}, error() {}, fatal() {} },
    runtimeContext: {},
    queueRegistry: { isQuarantined: async () => false },
    outboxRepo: {},
    dispatcher: {},
    createOutboxPollerFn: (() => ({})) as never,
    pollBatchSize: 10,
    pollIdleDelayMs: 10,
    accessDeadlinePollDelayMs: 10,
    accessDeadlineWorker: {
      materializeDueTransitions: async (
        invocation: RegisteredSystemWorkerInvocation,
      ) => {
        assertRegisteredSystemWorkerInvocation(invocation);
        assert.equal(invocation.actor.id, SYSTEM_ACCESS_DEADLINE_WORKER_ACTOR_ID);
        invocationSeen = true;
        stopped = true;
        return {};
      },
    },
    onSystemInvariantFailure: () => undefined,
  } as never);
  assert.deepEqual(
    registrations.map((registration) => registration.descriptor.id),
    ["outbox.poller", ACCESS_DEADLINE_SYSTEM_WORKER_ID],
  );
  const deadline = registrations[1]!;
  const running = await deadline.start({
    runtimeTraceId: "runtime-trace",
    shouldStop: () => stopped,
    sleep: async () => undefined,
  });
  await running.shutdown();
  assert.equal(invocationSeen, true);
});
