import crypto from "crypto";
import {
  ClientSession,
  Db,
  MongoClient,
  ReadConcern,
  ReadPreference,
  TransactionOptions,
  WriteConcern,
} from "mongodb";
import { DomainError } from "@core/errors/domain.error";
import { InfrastructureError } from "@infra/errors/infrastructure.error";
import { SystemInvariantError } from "@core/error/system-error";
import {
  AuthoritativeAdminMutationBridge,
  AuthoritativeMutationControls,
  AuthoritativeAdminMutationBridgeParams,
  assertPersistableAdminMutationEvents,
} from "@core/application/authoritative-admin-mutation.bridge";
import {
  PersistableDomainEvent,
  getCurrentDomainEventCollector,
  runWithDomainEventCollector,
} from "@system/event-bridge/domain-event.types";
import { flushDomainEvents } from "@system/event-bridge/domain-event.flush";
import { DomainEventOutboxRepository } from "@system/outbox";
import {
  createStructuredLogger,
  StructuredLogger,
} from "@infra/logger.adapter";
import {
  incrementMongoTransactionRetry,
  incrementMongoTransactionUtcr,
  observeMongoTransactionDuration,
} from "@infra/metrics/prometheus.registry";
import {
  AuditContext,
  AuditMutationAttemptProof,
  runWithAuditAttemptScope,
} from "@core/audit/audit.context";
import { AuditWriteRepository } from "@core/audit/audit.write.repository";
import { assertAudited } from "@core/audit/audit.enforcer";
import { PermissionGuard } from "@core/permission/permission.guard";
import { PermissionContract } from "@core/permission/permission.contract";
import { MongoAuditWriteRepository } from "@infra/mongo/audit/audit.write.repository";
import { resolveAuthoritativePermissionForMutationIdentity } from "@core/application/authoritative-admin-mutation.permission-map";

const TRANSACTION_OPTIONS: TransactionOptions = {
  readPreference: ReadPreference.primary,
  readConcern: new ReadConcern("snapshot"),
  writeConcern: new WriteConcern("majority"),
  maxCommitTimeMS: 5000,
};

const MAX_TRANSACTION_ATTEMPTS = 5;
const RETRY_BASE_DELAY_MS = 25;
const RETRY_MAX_DELAY_MS = 1000;
const RETRY_JITTER_MS = 25;
const AUTH_SECURITY_VERSION_COLLECTION =
  "auth_security_versions";
const AUTH_SECURITY_VERSION_DOCUMENT_ID =
  "admin.auth-security-version";

function classifyAndRethrow(err: unknown): never {
  if (
    err instanceof DomainError ||
    err instanceof InfrastructureError ||
    err instanceof SystemInvariantError
  ) {
    throw err;
  }

  if (err instanceof Error) {
    throw new InfrastructureError(
      "UNKNOWN_TRANSACTION_ERROR",
      `Unexpected transaction error: ${err.message}`,
    );
  }

  throw new InfrastructureError(
    "UNKNOWN_TRANSACTION_ERROR",
    "Unexpected non-error thrown inside transaction",
  );
}

async function bumpAuthSecurityVersionInTransaction(params: {
  readonly primaryDb: Db;
  readonly session: ClientSession;
}): Promise<void> {
  interface AuthSecurityVersionDocument {
    readonly _id: string;
    readonly version: string;
    readonly createdAt: number;
    readonly updatedAt: number;
  }

  const now = Date.now();

  await params.primaryDb
    .collection<AuthSecurityVersionDocument>(
      AUTH_SECURITY_VERSION_COLLECTION,
    )
    .updateOne(
      {
        _id: AUTH_SECURITY_VERSION_DOCUMENT_ID,
      },
      {
        $set: {
          version: crypto.randomUUID(),
          updatedAt: now,
        },
        $setOnInsert: {
          createdAt: now,
        },
      },
      {
        upsert: true,
        session: params.session,
      },
    );
}

function hasMongoErrorLabel(
  err: unknown,
  label:
    | "TransientTransactionError"
    | "UnknownTransactionCommitResult",
): boolean {
  if (typeof err !== "object" || err === null) {
    return false;
  }

  const candidate = err as {
    hasErrorLabel?: (name: string) => boolean;
  };

  return (
    typeof candidate.hasErrorLabel === "function" &&
    candidate.hasErrorLabel(label)
  );
}

function isTransientTransactionError(err: unknown): boolean {
  return hasMongoErrorLabel(err, "TransientTransactionError");
}

function isUnknownTransactionCommitResult(
  err: unknown,
): boolean {
  return hasMongoErrorLabel(
    err,
    "UnknownTransactionCommitResult",
  );
}

function computeRetryDelayMs(attempt: number): number {
  const exponential = Math.min(
    RETRY_BASE_DELAY_MS * 2 ** (attempt - 1),
    RETRY_MAX_DELAY_MS,
  );
  return (
    exponential +
    crypto.randomInt(0, RETRY_JITTER_MS + 1)
  );
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function hasActiveCollectorScope(): boolean {
  try {
    getCurrentDomainEventCollector();
    return true;
  } catch (error) {
    if (
      error instanceof SystemInvariantError &&
      error.code === "DOMAIN_EVENT_CONTEXT_MISSING"
    ) {
      return false;
    }

    throw error;
  }
}

function assertNoNestedExecution(): void {
  if (hasActiveCollectorScope()) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      "Nested authoritative ADMIN mutation bridge execution is forbidden",
    );
  }
}

function assertAdminMutationParams(
  params: AuthoritativeAdminMutationBridgeParams,
): asserts params is AuthoritativeAdminMutationBridgeParams {
  if (
    typeof params.actor !== "object" ||
    params.actor === null ||
    typeof params.actor.id !== "string" ||
    params.actor.id.trim().length === 0
  ) {
    throw new SystemInvariantError(
      "HTTP_ACTOR_ID_MISSING",
      "Authoritative ADMIN mutation requires actor",
    );
  }

  if (!params.traceId) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      "Authoritative ADMIN mutation requires traceId",
    );
  }

  if (params.actor.context !== "ADMIN") {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      `Authoritative ADMIN mutation bridge rejects non-ADMIN context: ${params.actor.context}`,
    );
  }

  if (
    typeof params.requiredPermission !== "object" ||
    params.requiredPermission === null ||
    typeof params.requiredPermission.code !== "string" ||
    params.requiredPermission.code.trim().length === 0
  ) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      "Authoritative ADMIN mutation requires requiredPermission",
    );
  }

  if (
    typeof params.mutationIdentity !== "string" ||
    params.mutationIdentity.trim().length === 0
  ) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      "Authoritative ADMIN mutation requires mutationIdentity",
    );
  }

  if (
    typeof params.mutationTargetDescriptor !== "string" ||
    params.mutationTargetDescriptor.trim().length === 0
  ) {
    throw new SystemInvariantError(
      "SYSTEM_INVARIANT_VIOLATION",
      "Authoritative ADMIN mutation requires mutationTargetDescriptor",
    );
  }
}

function assertBoundaryAuthorization(
  params: AuthoritativeAdminMutationBridgeParams,
): PermissionContract {
  const authoritativePermission =
    resolveAuthoritativePermissionForMutationIdentity(
      params.mutationIdentity,
    );

  if (
    params.requiredPermission.code !==
    authoritativePermission.code
  ) {
    throw new SystemInvariantError(
      "PERMISSION_DENIED",
      `Mutation ${params.mutationIdentity} requires permission ${authoritativePermission.code}. Received ${params.requiredPermission.code}`,
    );
  }

  PermissionGuard.assert(
    params.actor,
    authoritativePermission,
  );

  return authoritativePermission;
}

function createAttemptAuditProof(params: {
  readonly attemptId: string;
  readonly bridgeParams: AuthoritativeAdminMutationBridgeParams;
  readonly authoritativePermission: PermissionContract;
}): AuditMutationAttemptProof {
  return Object.freeze({
    attemptId: params.attemptId,
    actorId: params.bridgeParams.actor.id,
    permissionCode: params.authoritativePermission.code,
    mutationIdentity:
      params.bridgeParams.mutationIdentity,
    targetDescriptor:
      params.bridgeParams.mutationTargetDescriptor,
  });
}

async function safeAbortTransaction(params: {
  readonly session: ClientSession;
  readonly logger: StructuredLogger;
  readonly traceId: string;
  readonly actorId: string;
}): Promise<void> {
  if (!params.session.inTransaction()) {
    return;
  }

  try {
    await params.session.abortTransaction();
  } catch (error) {
    params.logger.warn({
      traceId: params.traceId,
      actorId: params.actorId,
      context: "ADMIN",
      operation: "admin.authoritative-mutation.abort",
      status: "FAILED",
      timestamp: Date.now(),
      metadata: {
        error:
          error instanceof Error
            ? error.message
            : String(error),
      },
    });
  }
}

function authorOutboxEnvelope(params: {
  readonly actorId: string;
  readonly traceId: string;
  readonly event: PersistableDomainEvent;
}) {
  return {
    eventId: crypto.randomUUID(),
    aggregateId: params.event.aggregateId,
    aggregateVersion:
      params.event.aggregateVersion,
    type: params.event.type,
    version: params.event.version,
    payload: params.event.payload,
    occurredAt: params.event.occurredAt,
    traceId: params.traceId,
    trace: {
      actorId: params.actorId,
      context: "ADMIN" as const,
    },
  };
}

function logRetryVisibility(params: {
  readonly logger: StructuredLogger;
  readonly traceId: string;
  readonly actorId: string;
  readonly attempt: number;
  readonly backoffMs: number;
  readonly classification:
    | "TransientTransactionError"
    | "UnknownTransactionCommitResult";
}): void {
  params.logger.warn({
    traceId: params.traceId,
    actorId: params.actorId,
    context: "ADMIN",
    operation: "admin.authoritative-mutation.retry",
    status: "RETRY_SCHEDULED",
    timestamp: Date.now(),
    metadata: {
      attempt: params.attempt,
      backoffMs: params.backoffMs,
      classification: params.classification,
    },
  });
}

export class MongoAuthoritativeAdminMutationBridge
  implements AuthoritativeAdminMutationBridge
{
  private readonly logger: StructuredLogger;
  private readonly primaryDb: Db;
  private readonly outboxRepo: DomainEventOutboxRepository;
  private readonly auditWriteRepository: AuditWriteRepository;
  private readonly auditContext = new AuditContext();

  constructor(
    private readonly client: MongoClient,
    primaryDb?: Db,
    logger: StructuredLogger = createStructuredLogger(),
  ) {
    this.logger = logger;
    this.primaryDb = primaryDb ?? client.db();
    this.outboxRepo =
      new DomainEventOutboxRepository(this.primaryDb);
    this.auditWriteRepository =
      new MongoAuditWriteRepository(this.primaryDb);
  }

  async execute<T>(
    params: AuthoritativeAdminMutationBridgeParams,
    mutate: (
      session: ClientSession,
      controls: AuthoritativeMutationControls,
    ) => Promise<T>,
  ): Promise<T> {
    assertAdminMutationParams(params);
    const authoritativePermission =
      assertBoundaryAuthorization(params);
    assertNoNestedExecution();
    this.auditContext.assertScope();

    for (
      let attempt = 1;
      attempt <= MAX_TRANSACTION_ATTEMPTS;
      attempt += 1
    ) {
      const session = this.client.startSession();
      const attemptStartedAt = Date.now();
      let result!: T;
      let persistedEventIds: string[] = [];
      let authSecurityTruthChanged = false;
      let explicitNoOpSuccess = false;
      const expectedAuditProof =
        createAttemptAuditProof({
          attemptId: crypto.randomUUID(),
          bridgeParams: params,
          authoritativePermission,
        });
      const mutationControls: AuthoritativeMutationControls =
        Object.freeze({
          markAuthSecurityTruthChanged: () => {
            authSecurityTruthChanged = true;
          },
          markExplicitNoOpSuccess: () => {
            explicitNoOpSuccess = true;
          },
        });

      try {
        await runWithAuditAttemptScope(
          expectedAuditProof,
          async () => {
            await runWithDomainEventCollector(async () => {
              session.startTransaction(
                TRANSACTION_OPTIONS,
              );

              result = await mutate(
                session,
                mutationControls,
              );

              if (
                explicitNoOpSuccess &&
                authSecurityTruthChanged
              ) {
                throw new SystemInvariantError(
                  "SYSTEM_INVARIANT_VIOLATION",
                  `Authoritative mutation ${params.mutationIdentity} cannot mark explicit no-op success while changing auth security truth`,
                );
              }

              if (authSecurityTruthChanged) {
                await bumpAuthSecurityVersionInTransaction(
                  {
                    primaryDb: this.primaryDb,
                    session,
                  },
                );
              }

              const collectedEvents =
                getCurrentDomainEventCollector().drain();

              if (explicitNoOpSuccess) {
                if (collectedEvents.length > 0) {
                  throw new SystemInvariantError(
                    "SYSTEM_INVARIANT_VIOLATION",
                    `Authoritative mutation ${params.mutationIdentity} marked explicit no-op success but emitted domain events`,
                  );
                }
              } else {
                await assertAudited({
                  repository:
                    this.auditWriteRepository,
                  proof: expectedAuditProof,
                  session,
                });
              }

              await flushDomainEvents(
                collectedEvents,
                async (events) => {
                  assertPersistableAdminMutationEvents(
                    events,
                  );
                  const persistableEvents:
                    readonly PersistableDomainEvent[] =
                    events;

                  const outboxDocs =
                    persistableEvents.map((event) =>
                      authorOutboxEnvelope({
                        actorId: params.actor.id,
                        traceId: params.traceId,
                        event,
                      }),
                    );

                  persistedEventIds = outboxDocs.map(
                    (event) => event.eventId,
                  );

                  await this.outboxRepo.insertMany(
                    outboxDocs,
                    session,
                  );
                },
              );

              await session.commitTransaction();
            });
          },
        );

        observeMongoTransactionDuration({
          runtime: "http",
          durationMs: Date.now() - attemptStartedAt,
          result: "success",
        });

        return result;
      } catch (error) {
        const transientError =
          isTransientTransactionError(error);
        const unknownCommitResult =
          isUnknownTransactionCommitResult(error);

        if (!unknownCommitResult) {
          await safeAbortTransaction({
            session,
            logger: this.logger,
            traceId: params.traceId,
            actorId: params.actor.id,
          });
        }

        if (unknownCommitResult) {
          incrementMongoTransactionUtcr({
            runtime: "http",
          });

          if (persistedEventIds.length === 0) {
            observeMongoTransactionDuration({
              runtime: "http",
              durationMs: Date.now() - attemptStartedAt,
              result: "fail",
            });
            throw new SystemInvariantError(
              "SYSTEM_INVARIANT_VIOLATION",
              "Unknown commit result detected without authoritative outbox verification artifacts",
            );
          }

          const observable =
            await this.outboxRepo.containsAll(
              persistedEventIds,
            );

          if (observable) {
            observeMongoTransactionDuration({
              runtime: "http",
              durationMs:
                Date.now() - attemptStartedAt,
              result: "success",
            });
            return result;
          }

          if (attempt < MAX_TRANSACTION_ATTEMPTS) {
            const backoffMs =
              computeRetryDelayMs(attempt);

            logRetryVisibility({
              logger: this.logger,
              traceId: params.traceId,
              actorId: params.actor.id,
              attempt,
              backoffMs,
              classification:
                "UnknownTransactionCommitResult",
            });

            incrementMongoTransactionRetry({
              runtime: "http",
              classification:
                "UnknownTransactionCommitResult",
            });
            observeMongoTransactionDuration({
              runtime: "http",
              durationMs:
                Date.now() - attemptStartedAt,
              result: "fail",
            });
            await sleep(backoffMs);
            continue;
          }
        }

        if (
          transientError &&
          attempt < MAX_TRANSACTION_ATTEMPTS
        ) {
          const backoffMs = computeRetryDelayMs(attempt);

          logRetryVisibility({
            logger: this.logger,
            traceId: params.traceId,
            actorId: params.actor.id,
            attempt,
            backoffMs,
            classification: "TransientTransactionError",
          });

          incrementMongoTransactionRetry({
            runtime: "http",
            classification:
              "TransientTransactionError",
          });
          observeMongoTransactionDuration({
            runtime: "http",
            durationMs: Date.now() - attemptStartedAt,
            result: "fail",
          });
          await sleep(backoffMs);
          continue;
        }

        observeMongoTransactionDuration({
          runtime: "http",
          durationMs: Date.now() - attemptStartedAt,
          result: "fail",
        });
        classifyAndRethrow(error);
      } finally {
        await session.endSession();
      }
    }

    throw new InfrastructureError(
      "UNKNOWN_TRANSACTION_ERROR",
      "Authoritative ADMIN mutation retry budget exhausted",
    );
  }
}
