import { Request } from "express";
import {
  Actor,
  ActorScopeGrants,
  CommissionActorScopeGrant,
  ContractRegistryActorScopeGrant,
  DashboardLiteActorScopeGrant,
  EventAssignmentActorScopeGrant,
  RevenueLedgerActorScopeGrant,
  TalentKpiActorScopeGrant,
  WorkScheduleActorScopeGrant,
} from "@core/actor/actor";
import { bindActor } from "@core/actor/actor-context";
import { getContext } from "@core/context/context.middleware";
import { SystemInvariantError } from "@core/error/system-error";
import {
  AuthSecurityVersionReader,
} from "@core/auth/auth-security-version.repository";
import {
  createStructuredLogger,
  StructuredLogger,
} from "@infra/logger.adapter";
import { getTraceIdOrThrow } from "@core/trace/trace.context";
import { CacheAdapter } from "@infra/cache/cache.adapter";
import { CacheKey } from "@infra/cache/cache.key";
import { CacheTTL } from "@infra/cache/cache.ttl";
import {
  ActorSnapshotEnvelope,
  createActorSnapshotEnvelope,
  isActorSnapshotEnvelope,
} from "@infra/cache/actor.snapshot.cache";
import {
  UserActorResolutionFacade,
  UserAuthResolutionRepository,
} from "@modules/user/shared/user.actor-resolution.facade";
import { Auth0Claims } from "./auth0.claims.types";
import {
  ActorSnapshot,
  actorFromSnapshot,
} from "./auth0.actor.cache";

const WORK_SCHEDULE_SCOPE_GRANT_SET = new Set<
  WorkScheduleActorScopeGrant
>([
  "self",
  "team",
  "department",
  "global",
]);

const EVENT_ASSIGNMENT_SCOPE_GRANT_SET = new Set<
  EventAssignmentActorScopeGrant
>(["global"]);

const CONTRACT_REGISTRY_SCOPE_GRANT_SET = new Set<
  ContractRegistryActorScopeGrant
>(["global"]);

const TALENT_KPI_SCOPE_GRANT_SET = new Set<
  TalentKpiActorScopeGrant
>(["global"]);

const REVENUE_LEDGER_SCOPE_GRANT_SET = new Set<
  RevenueLedgerActorScopeGrant
>(["global"]);

const COMMISSION_SCOPE_GRANT_SET = new Set<
  CommissionActorScopeGrant
>(["global"]);

const DASHBOARD_LITE_SCOPE_GRANT_SET = new Set<
  DashboardLiteActorScopeGrant
>(["global"]);

export class Auth0ActorResolver {
  private readonly logger: StructuredLogger;
  private readonly facade: UserActorResolutionFacade;
  private readonly authSecurityVersionRepository: AuthSecurityVersionReader;

  constructor(
    repository: UserAuthResolutionRepository &
      AuthSecurityVersionReader,
    private readonly cache: CacheAdapter,
  ) {
    this.logger = createStructuredLogger();
    this.facade = new UserActorResolutionFacade(
      repository,
    );
    this.authSecurityVersionRepository = repository;
  }

  async resolve(req: Request): Promise<Actor> {
    const context = getContext(req);
    const traceId = resolveTraceId(req);
    const claims = (
      req as Request & {
        auth?: {
          payload?: Auth0Claims;
        };
      }
    ).auth?.payload;
    const authSubject = claims?.sub;

    if (!authSubject) {
      this.logger.warn({
        traceId,
        actorId: "ANONYMOUS",
        context,
        operation: "auth.actor.resolve",
        status: "FAILED_MISSING_SUB",
        timestamp: Date.now(),
      });

      throw new SystemInvariantError(
        "ACTOR_INVALID_PAYLOAD",
        "Missing Auth0 sub",
      );
    }

    const cacheKey = CacheKey.actorSnapshot(
      context,
      authSubject,
    );

    const currentVersion =
      await this.readCurrentVersionOrSkipCache(
        traceId,
        authSubject,
        context,
      );

    const cached =
      currentVersion === null
        ? null
        : await this.readCachedSnapshot(
            cacheKey,
            currentVersion,
            traceId,
            authSubject,
            context,
          );

    if (cached) {
      const actor = actorFromSnapshot(cached, {
        ip: req.ip,
        userAgent: req.headers["user-agent"],
      });

      bindActor(req, actor);

      this.logger.info({
        traceId,
        actorId: actor.id,
        context,
        operation: "auth.actor.resolve",
        status: "SUCCESS",
        timestamp: Date.now(),
        metadata: {
          cacheHit: true,
          cacheTrusted: true,
        },
      });

      return actor;
    }

    try {
      const resolved =
        await this.facade.resolveByAuthLinkage({
          context,
          authSubject,
        });

      const authoritativeSnapshot: ActorSnapshot = {
        id: resolved.actor.userId,
        type: mapActorType(
          resolved.actor.actorKind,
        ),
        context,
        roles: [],
        permissions: [
          ...resolved.actor.permissions,
        ],
        scopeGrants:
          resolveResolvedActorScopeGrants(
            resolved.actor,
          ),
        isActive: true,
      };

      if (currentVersion !== null) {
        await this.updateCacheSafely(
          cacheKey,
          createActorSnapshotEnvelope(
            authoritativeSnapshot,
            currentVersion,
          ),
          traceId,
          authSubject,
          context,
        );
      } else {
        this.logCacheUpdateSkipped(
          traceId,
          authSubject,
          context,
        );
      }

      const actor = actorFromSnapshot(
        authoritativeSnapshot,
        {
          ip: req.ip,
          userAgent: req.headers["user-agent"],
        },
      );

      bindActor(req, actor);

      this.logger.info({
        traceId,
        actorId: actor.id,
        context,
        operation: "auth.actor.resolve",
        status: "SUCCESS",
        timestamp: Date.now(),
        metadata: {
          cacheHit: false,
          cacheTrusted: false,
          cacheWriteAttempted:
            currentVersion !== null,
        },
      });

      return actor;
    } catch (error) {
      this.logger.warn({
        traceId,
        actorId: authSubject,
        context,
        operation: "auth.actor.resolve",
        status: "FAIL_CLOSED",
        timestamp: Date.now(),
        metadata: {
          error:
            error instanceof Error
              ? error.message
              : String(error),
        },
      });

      throw error;
    }
  }

  private async readCurrentVersionOrSkipCache(
    traceId: string,
    actorId: string,
    context: string,
  ): Promise<string | null> {
    try {
      return await this.authSecurityVersionRepository.readAuthSecurityVersion();
    } catch (error) {
      this.logger.warn({
        traceId,
        actorId,
        context,
        operation: "auth.actor.security-version.read",
        status: "FAILED_SKIP_CACHE",
        timestamp: Date.now(),
        metadata: {
          error:
            error instanceof Error
              ? error.message
              : String(error),
        },
      });

      return null;
    }
  }

  private async readCachedSnapshot(
    cacheKey: string,
    currentVersion: string,
    traceId: string,
    actorId: string,
    context: string,
  ): Promise<ActorSnapshot | null> {
    let cached: ActorSnapshotEnvelope<ActorSnapshot> | null =
      null;

    try {
      cached =
        await this.cache.get<
          ActorSnapshotEnvelope<ActorSnapshot>
        >(cacheKey);
    } catch (error) {
      this.logger.warn({
        traceId,
        actorId,
        context,
        operation: "auth.actor.cache.read",
        status: "FAILED_FALLBACK_REPOSITORY",
        timestamp: Date.now(),
        metadata: {
          error:
            error instanceof Error
              ? error.message
              : String(error),
        },
      });

      return null;
    }

    if (!cached) {
      return null;
    }

    if (
      !isActorSnapshotEnvelope<ActorSnapshot>(cached) ||
      cached.version !== currentVersion ||
      !isTrustedActorSnapshot(
        cached.snapshot,
        context,
      )
    ) {
      this.logger.warn({
        traceId,
        actorId,
        context,
        operation: "auth.actor.cache.read",
        status: "IGNORED_INVALID_SNAPSHOT",
        timestamp: Date.now(),
        metadata: {
          versionMatched:
            isActorSnapshotEnvelope<ActorSnapshot>(cached)
              ? cached.version === currentVersion
              : false,
        },
      });

      await this.deleteCacheSafely(
        cacheKey,
        traceId,
        actorId,
        context,
      );

      return null;
    }

    return cached.snapshot;
  }

  private async updateCacheSafely(
    cacheKey: string,
    envelope: ActorSnapshotEnvelope<ActorSnapshot>,
    traceId: string,
    actorId: string,
    context: string,
  ): Promise<void> {
    try {
      await this.cache.set(cacheKey, envelope, {
        ttlSeconds: CacheTTL.ACTOR_SNAPSHOT,
      });
    } catch (error) {
      this.logger.warn({
        traceId,
        actorId,
        context,
        operation: "auth.actor.cache.update",
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

  private logCacheUpdateSkipped(
    traceId: string,
    actorId: string,
    context: string,
  ): void {
    this.logger.warn({
      traceId,
      actorId,
      context,
      operation: "auth.actor.cache.update",
      status: "SKIPPED_CACHE_VERSION_UNAVAILABLE",
      timestamp: Date.now(),
    });
  }

  private async deleteCacheSafely(
    cacheKey: string,
    traceId: string,
    actorId: string,
    context: string,
  ): Promise<void> {
    try {
      await this.cache.del(cacheKey);
    } catch (error) {
      this.logger.warn({
        traceId,
        actorId,
        context,
        operation: "auth.actor.cache.delete",
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
}

function mapActorType(
  actorKind: "ADMIN" | "STAFF",
): "admin" | "staff" {
  return actorKind === "ADMIN"
    ? "admin"
    : "staff";
}

function isTrustedActorSnapshot(
  snapshot: unknown,
  context: string,
): snapshot is ActorSnapshot {
  if (
    typeof snapshot !== "object" ||
    snapshot === null
  ) {
    return false;
  }

  const candidate = snapshot as Record<
    string,
    unknown
  >;

  if (
    typeof candidate.id !== "string" ||
    candidate.id.trim().length === 0
  ) {
    return false;
  }

  if (
    candidate.type !== "admin" &&
    candidate.type !== "staff"
  ) {
    return false;
  }

  if (candidate.context !== context) {
    return false;
  }

  if (
    !Array.isArray(candidate.roles) ||
    !candidate.roles.every(
      (role) => typeof role === "string",
    )
  ) {
    return false;
  }

  if (
    !Array.isArray(candidate.permissions) ||
    !candidate.permissions.every(
      (permission) => typeof permission === "string",
    )
  ) {
    return false;
  }

  if (
    !isTrustedActorScopeGrants(
      candidate.scopeGrants,
    )
  ) {
    return false;
  }

  if (candidate.isActive !== true) {
    return false;
  }

  return true;
}

function resolveResolvedActorScopeGrants(
  actor: unknown,
): ActorScopeGrants | undefined {
  if (
    typeof actor !== "object" ||
    actor === null
  ) {
    return undefined;
  }

  const scopeGrants = (
    actor as {
      readonly scopeGrants?: unknown;
    }
  ).scopeGrants;

  if (scopeGrants === undefined) {
    return undefined;
  }

  if (!isTrustedActorScopeGrants(scopeGrants)) {
    throw new SystemInvariantError(
      "ACTOR_INVALID_PAYLOAD",
      "Resolved actor scope grants are invalid",
    );
  }

  return scopeGrants;
}

function isTrustedActorScopeGrants(
  scopeGrants: unknown,
): scopeGrants is ActorScopeGrants {
  if (scopeGrants === undefined) {
    return true;
  }

  if (
    typeof scopeGrants !== "object" ||
    scopeGrants === null ||
    Array.isArray(scopeGrants)
  ) {
    return false;
  }

  const candidate = scopeGrants as Record<
    string,
    unknown
  >;

  if (
    candidate.workSchedule !== undefined &&
    (!Array.isArray(candidate.workSchedule) ||
      !candidate.workSchedule.every(
        (scope) =>
          typeof scope === "string" &&
          WORK_SCHEDULE_SCOPE_GRANT_SET.has(
            scope as WorkScheduleActorScopeGrant,
          ),
      ))
  ) {
    return false;
  }

  if (
    candidate.eventAssignment !== undefined &&
    (!Array.isArray(candidate.eventAssignment) ||
      !candidate.eventAssignment.every(
        (scope) =>
          typeof scope === "string" &&
          EVENT_ASSIGNMENT_SCOPE_GRANT_SET.has(
            scope as EventAssignmentActorScopeGrant,
          ),
      ))
  ) {
    return false;
  }

  if (
    candidate.contractRegistry !== undefined &&
    (!Array.isArray(candidate.contractRegistry) ||
      !candidate.contractRegistry.every(
        (scope) =>
          typeof scope === "string" &&
          CONTRACT_REGISTRY_SCOPE_GRANT_SET.has(
            scope as ContractRegistryActorScopeGrant,
          ),
      ))
  ) {
    return false;
  }

  if (
    candidate.talentKpi !== undefined &&
    (!Array.isArray(candidate.talentKpi) ||
      !candidate.talentKpi.every(
        (scope) =>
          typeof scope === "string" &&
          TALENT_KPI_SCOPE_GRANT_SET.has(
            scope as TalentKpiActorScopeGrant,
          ),
      ))
  ) {
    return false;
  }

  if (
    candidate.revenueLedger !== undefined &&
    (!Array.isArray(candidate.revenueLedger) ||
      !candidate.revenueLedger.every(
        (scope) =>
          typeof scope === "string" &&
          REVENUE_LEDGER_SCOPE_GRANT_SET.has(
            scope as RevenueLedgerActorScopeGrant,
          ),
      ))
  ) {
    return false;
  }

  if (
    candidate.commission !== undefined &&
    (!Array.isArray(candidate.commission) ||
      !candidate.commission.every(
        (scope) =>
          typeof scope === "string" &&
          COMMISSION_SCOPE_GRANT_SET.has(
            scope as CommissionActorScopeGrant,
          ),
      ))
  ) {
    return false;
  }

  if (
    candidate.dashboardLite !== undefined &&
    (!Array.isArray(candidate.dashboardLite) ||
      !candidate.dashboardLite.every(
        (scope) =>
          typeof scope === "string" &&
          DASHBOARD_LITE_SCOPE_GRANT_SET.has(
            scope as DashboardLiteActorScopeGrant,
          ),
      ))
  ) {
    return false;
  }

  return true;
}

function resolveTraceId(req: Request): string {
  try {
    return getTraceIdOrThrow();
  } catch {
    // Actor resolution runs before http context middleware.
    // Require an upstream request trace id when runtime context is not yet bound.
  }

  const traceIdHeader = req.headers["x-trace-id"];

  if (
    typeof traceIdHeader === "string" &&
    traceIdHeader.trim().length > 0
  ) {
    return traceIdHeader.trim();
  }

  const requestIdHeader = req.headers["x-request-id"];

  if (
    typeof requestIdHeader === "string" &&
    requestIdHeader.trim().length > 0
  ) {
    return requestIdHeader.trim();
  }

  throw new SystemInvariantError(
    "SYSTEM_INVARIANT_VIOLATION",
    "TraceId context is not available",
  );
}
