import crypto from "node:crypto";
import { Collection, Db } from "mongodb";
import { Actor } from "@core/actor/actor";
import { AuditGuard } from "@core/audit/audit.guard";
import { AuthoritativeAdminMutationBridge } from "@core/application/authoritative-admin-mutation.bridge";
import { Permission } from "@core/permission/permission.enum";
import { PermissionResolver } from "@core/permission/permission.resolver";
import { getTraceIdOrThrow } from "@core/trace/trace.context";
import { ActorSnapshotCacheInvalidator } from "@infra/cache/actor.snapshot.cache";
import {
  GovernancePrincipalRecord,
  evaluateGovernancePrincipalEligibility,
} from "@modules/role/domain/governance-principal";
import { RoleValidationError } from "@modules/role/domain/role.errors";
import { parseAccessDecision } from "@modules/role/domain/access-governance-command";
import { GovernancePrincipalRepository } from "@modules/role/domain/access-lifecycle.repositories";
import { NativeMongoGovernancePrincipalRepository } from "@infra/mongo/role/access-lifecycle.repository";

type PrincipalDocument = Omit<GovernancePrincipalRecord, "principalId"> & { readonly _id: string };
interface UserDocument {
  readonly _id: string;
  readonly accountStatus: string;
  readonly disabledAt?: number | null;
  readonly archivedAt?: number | null;
  readonly authLinkage?: { readonly status?: string; readonly subject?: string };
}

export class GovernancePrincipalAdminService {
  private readonly principals: Collection<PrincipalDocument>;
  private readonly users: Collection<UserDocument>;
  private readonly governanceRepository: GovernancePrincipalRepository;

  constructor(
    db: Db,
    private readonly audit: AuditGuard,
    private readonly mutationBridge: AuthoritativeAdminMutationBridge,
    private readonly actorCache: ActorSnapshotCacheInvalidator,
    governanceRepository?: GovernancePrincipalRepository,
    private readonly nowProvider: () => number = Date.now,
  ) {
    this.principals = db.collection("governance_principals");
    this.users = db.collection("users");
    this.governanceRepository =
      governanceRepository ?? new NativeMongoGovernancePrincipalRepository(db);
  }

  async status(actor: Actor): Promise<Record<string, unknown>> {
    const now = this.nowProvider();
    const records = await this.principals
      .find({ status: { $in: ["PENDING", "ACTIVE"] } })
      .sort({ principalType: 1, effectiveAt: 1, _id: 1 })
      .toArray();
    const eligiblePrimary = await this.readEligiblePrimaryOwner(now);
    const statuses = await Promise.all(
      records.map(async (record) =>
        this.toEligibilityStatus(record, actor, now, eligiblePrimary?._id ?? null),
      ),
    );
    const primaryOwner =
      statuses.find(
        (item) =>
          item.principalType === "PRIMARY_OWNER" && item.status === "ACTIVE",
      ) ?? null;
    const canProposeSuccessor =
      actor.permissions.includes(Permission.OWNER_SUCCESSION_MANAGE) &&
      primaryOwner?.eligible === true &&
      records.find((record) => record._id === primaryOwner.principalId)?.userId ===
        actor.id;
    return {
      generatedAt: now,
      policy: {
        version: "owner-succession-command-policy/v2",
        timeZone: "Asia/Ho_Chi_Minh",
        effectiveAtRequired: true,
        expiresAtRequired: true,
      },
      primaryOwner,
      successors: statuses.filter(
        (item) => item.principalType === "SUCCESSOR_OWNER",
      ),
      actions: {
        canProposeSuccessor,
        proposalIneligibilityReason: canProposeSuccessor
          ? null
          : !actor.permissions.includes(Permission.OWNER_SUCCESSION_MANAGE)
            ? "OWNER_SUCCESSION_MANAGE_PERMISSION_REQUIRED"
            : "ACTIVE_PRIMARY_OWNER_MUST_PROPOSE",
      },
    };
  }

  async proposeSuccessor(
    actor: Actor,
    command: {
      readonly targetUserId: unknown;
      readonly effectiveAt: unknown;
      readonly expiresAt: unknown;
      readonly reason: unknown;
      readonly idempotencyKey?: unknown;
    },
  ): Promise<Record<string, unknown>> {
    const targetUserId = requiredText(command.targetUserId, "targetUserId");
    const effectiveAt = timestamp(command.effectiveAt, "effectiveAt");
    const expiresAt = timestamp(command.expiresAt, "expiresAt");
    const reason = requiredText(command.reason, "reason");
    const idempotencyKey = requiredText(command.idempotencyKey, "idempotencyKey");
    const payloadFingerprint = governanceFingerprint("PROPOSAL", {
      actorId: actor.id,
      targetUserId,
      effectiveAt,
      expiresAt,
      reason,
    });
    const existing = await this.principals.findOne({ proposalIdempotencyKey: idempotencyKey });
    if (existing) {
      return resolveGovernanceReplay(
        existing,
        "proposalPayloadFingerprint",
        payloadFingerprint,
      );
    }
    if (expiresAt <= effectiveAt) throw new RoleValidationError("expiresAt must be after effectiveAt");
    const now = this.nowProvider();
    if (effectiveAt < now) {
      throw new RoleValidationError("effectiveAt must not be in the past");
    }
    const activePrimary = await this.readEligiblePrimaryOwner(now);
    if (!activePrimary || activePrimary.userId !== actor.id) {
      return blocked(["ACTIVE_PRIMARY_OWNER_MUST_PROPOSE"]);
    }
    const user = await this.users.findOne({ _id: targetUserId });
    if (!isEligibleUser(user)) return blocked(["SUCCESSOR_USER_NOT_ELIGIBLE"]);
    const permission = PermissionResolver.resolve(Permission.OWNER_SUCCESSION_MANAGE);
    try {
      return await this.mutationBridge.execute(
      {
        actor,
        traceId: getTraceIdOrThrow(),
        requiredPermission: permission,
        mutationIdentity: "owner.succession.propose",
        mutationTargetDescriptor: "owner-succession",
      },
      async (session, controls) => {
        const now = this.nowProvider();
        const [currentPrimary, currentTarget, currentReplay] = await Promise.all([
          this.readEligiblePrimaryOwner(now, session),
          this.users.findOne({ _id: targetUserId }, { session }),
          this.principals.findOne({ proposalIdempotencyKey: idempotencyKey }, { session }),
        ]);
        if (currentReplay) {
          controls.markExplicitNoOpSuccess();
          return resolveGovernanceReplay(
            currentReplay,
            "proposalPayloadFingerprint",
            payloadFingerprint,
          );
        }
        if (
          !currentPrimary ||
          currentPrimary.userId !== actor.id ||
          !isEligibleUser(currentTarget) ||
          effectiveAt < now ||
          expiresAt <= effectiveAt
        ) {
          controls.markExplicitNoOpSuccess();
          return blocked(["STALE_SUCCESSION_PROPOSAL_ELIGIBILITY"]);
        }
        const record: PrincipalDocument = {
          _id: crypto.randomUUID(),
          userId: targetUserId,
          principalType: "SUCCESSOR_OWNER",
          status: "PENDING",
          effectiveAt,
          expiresAt,
          predecessorPrincipalId: currentPrimary._id,
          successorPrincipalId: null,
          createdBy: actor.id,
          approvedBy: "PENDING",
          reason,
          createdAt: now,
          approvedAt: 0,
          proposalIdempotencyKey: idempotencyKey,
          proposalPayloadFingerprint: payloadFingerprint,
          decisionIdempotencyKey: null,
          decisionPayloadFingerprint: null,
          activationIdempotencyKey: null,
          activationPayloadFingerprint: null,
        };
        await this.governanceRepository.insert(
          { ...record, principalId: record._id },
          session,
        );
        await this.audit.record(actor, permission, targetUserId, {
          mutationType: "owner.succession.propose",
          principalId: record._id,
          effectiveAt,
          expiresAt,
          reason,
          predecessorPrincipalId: currentPrimary._id,
          idempotencyKey,
          payloadFingerprint,
        }, session);
        return { applied: true, principal: toSafePrincipalStatus(record) };
      },
    );
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      const raced = await this.principals.findOne({ proposalIdempotencyKey: idempotencyKey });
      if (!raced) throw new RoleValidationError("GOVERNANCE_IDEMPOTENCY_RACE_UNRESOLVED");
      return resolveGovernanceReplay(
        raced,
        "proposalPayloadFingerprint",
        payloadFingerprint,
      );
    }
  }

  async decideSuccessor(
    actor: Actor,
    command: {
      readonly principalId: unknown;
      readonly decision: unknown;
      readonly reason: unknown;
      readonly idempotencyKey?: unknown;
    },
  ): Promise<Record<string, unknown>> {
    const principalId = requiredText(command.principalId, "principalId");
    const decision = parseAccessDecision(command.decision);
    const reason = requiredText(command.reason, "reason");
    const idempotencyKey = requiredText(command.idempotencyKey, "idempotencyKey");
    const payloadFingerprint = governanceFingerprint("DECISION", {
      actorId: actor.id,
      principalId,
      decision,
      reason,
    });
    const replay = await this.principals.findOne({ decisionIdempotencyKey: idempotencyKey });
    if (replay) {
      return resolveGovernanceReplay(
        replay,
        "decisionPayloadFingerprint",
        payloadFingerprint,
      );
    }
    const outer = await this.principals.findOne({ _id: principalId });
    if (!outer) return blocked(["SUCCESSOR_NOT_FOUND"]);
    if (actor.id === outer.userId) return blocked(["TARGET_CANNOT_APPROVE"]);
    if (actor.id === outer.createdBy) return blocked(["REQUESTER_CANNOT_APPROVE"]);
    const [outerTarget, outerReviewer] = await Promise.all([
      this.users.findOne({ _id: outer.userId }),
      this.users.findOne({ _id: actor.id }),
    ]);
    if (!isEligibleUser(outerTarget)) {
      return blocked(["SUCCESSOR_USER_NOT_ELIGIBLE"]);
    }
    if (!isEligibleUser(outerReviewer)) {
      return blocked(["GOVERNANCE_REVIEWER_NOT_ELIGIBLE"]);
    }
    const outerPrimary = await this.readEligiblePrimaryOwner(this.nowProvider());
    if (
      !outerPrimary ||
      outer.predecessorPrincipalId !== outerPrimary._id
    ) {
      return blocked(["SUCCESSOR_PREDECESSOR_NOT_CURRENT_PRIMARY"]);
    }
    const permission = PermissionResolver.resolve(Permission.OWNER_SUCCESSION_MANAGE);
    try {
      return await this.mutationBridge.execute(
      {
        actor,
        traceId: getTraceIdOrThrow(),
        requiredPermission: permission,
        mutationIdentity: "owner.succession.approve",
        mutationTargetDescriptor: `owner-succession:${principalId}`,
      },
      async (session, controls) => {
        const now = this.nowProvider();
        const currentReplay = await this.principals.findOne(
          { decisionIdempotencyKey: idempotencyKey },
          { session },
        );
        if (currentReplay) {
          controls.markExplicitNoOpSuccess();
          return resolveGovernanceReplay(
            currentReplay,
            "decisionPayloadFingerprint",
            payloadFingerprint,
          );
        }
        const [current, currentPrimary, targetUser, reviewerUser] = await Promise.all([
          this.principals.findOne(
            {
              _id: principalId,
              status: "PENDING",
              principalType: "SUCCESSOR_OWNER",
            },
            { session },
          ),
          this.readEligiblePrimaryOwner(now, session),
          this.users.findOne({ _id: outer.userId }, { session }),
          this.users.findOne({ _id: actor.id }, { session }),
        ]);
        if (
          !current ||
          !currentPrimary ||
          current.userId !== outer.userId ||
          current.predecessorPrincipalId !== currentPrimary._id ||
          current.createdBy === actor.id ||
          current.userId === actor.id ||
          !isEligibleUser(targetUser) ||
          !isEligibleUser(reviewerUser)
        ) {
          controls.markExplicitNoOpSuccess();
          return blocked(["STALE_SUCCESSION_ELIGIBILITY"]);
        }
        const updated = await this.principals.findOneAndUpdate(
          { _id: principalId, status: "PENDING", createdBy: { $ne: actor.id }, userId: { $ne: actor.id } },
          {
            $set: {
              status: decision === "APPROVED" ? "ACTIVE" : "REVOKED",
              approvedBy: actor.id,
              approvedAt: now,
              reason,
              decisionIdempotencyKey: idempotencyKey,
              decisionPayloadFingerprint: payloadFingerprint,
            },
          },
          { session, returnDocument: "after" },
        );
        if (!updated) {
          controls.markExplicitNoOpSuccess();
          return blocked(["STALE_SUCCESSOR_STATE"]);
        }
        await this.audit.record(actor, permission, current.userId, {
          mutationType: "owner.succession.approve",
          principalId,
          decision,
          reason,
          resultingState: updated.status,
          independentReviewerUserId: actor.id,
          idempotencyKey,
          payloadFingerprint,
        }, session);
        return { applied: true, principal: toSafePrincipalStatus(updated) };
      },
    );
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      const raced = await this.principals.findOne({ decisionIdempotencyKey: idempotencyKey });
      if (!raced) throw new RoleValidationError("GOVERNANCE_IDEMPOTENCY_RACE_UNRESOLVED");
      return resolveGovernanceReplay(
        raced,
        "decisionPayloadFingerprint",
        payloadFingerprint,
      );
    }
  }

  async activateSuccessor(
    actor: Actor,
    command: {
      readonly principalId: unknown;
      readonly reason: unknown;
      readonly idempotencyKey?: unknown;
    },
  ): Promise<Record<string, unknown>> {
    const principalId = requiredText(command.principalId, "principalId");
    const reason = requiredText(command.reason, "reason");
    const idempotencyKey = requiredText(command.idempotencyKey, "idempotencyKey");
    const payloadFingerprint = governanceFingerprint("ACTIVATION", {
      actorId: actor.id,
      principalId,
      reason,
    });
    const replay = await this.principals.findOne({ activationIdempotencyKey: idempotencyKey });
    if (replay) {
      return resolveGovernanceReplay(
        replay,
        "activationPayloadFingerprint",
        payloadFingerprint,
      );
    }
    const outer = await this.principals.findOne({ _id: principalId });
    const now = this.nowProvider();
    if (!outer || outer.principalType !== "SUCCESSOR_OWNER" || outer.status !== "ACTIVE") {
      return blocked(["SUCCESSOR_NOT_ACTIVE"]);
    }
    if (outer.effectiveAt > now || outer.expiresAt === null || outer.expiresAt <= now) {
      return blocked(["SUCCESSOR_OUTSIDE_EFFECTIVE_WINDOW"]);
    }
    if (actor.id === outer.userId || actor.id === outer.createdBy) {
      return blocked(["INDEPENDENT_ACTIVATOR_REQUIRED"]);
    }
    if (actor.id !== outer.approvedBy) {
      return blocked(["APPROVED_REVIEWER_MUST_ACTIVATE"]);
    }
    const outerPrimary = await this.readEligiblePrimaryOwner(now);
    if (!outerPrimary || outer.predecessorPrincipalId !== outerPrimary._id) {
      return blocked(["SUCCESSOR_PREDECESSOR_NOT_CURRENT_PRIMARY"]);
    }
    const [outerSuccessorUser, outerActivatorUser] = await Promise.all([
      this.users.findOne({ _id: outer.userId }),
      this.users.findOne({ _id: actor.id }),
    ]);
    if (!isEligibleUser(outerSuccessorUser)) {
      return blocked(["SUCCESSOR_USER_NOT_ELIGIBLE"]);
    }
    if (!isEligibleUser(outerActivatorUser)) {
      return blocked(["GOVERNANCE_ACTIVATOR_NOT_ELIGIBLE"]);
    }
    const permission = PermissionResolver.resolve(Permission.OWNER_SUCCESSION_MANAGE);
    let result: Record<string, unknown>;
    try {
      result = await this.mutationBridge.execute(
      {
        actor,
        traceId: getTraceIdOrThrow(),
        requiredPermission: permission,
        mutationIdentity: "owner.succession.activate",
        mutationTargetDescriptor: `owner-succession:${principalId}`,
      },
      async (session, controls) => {
        const transactionNow = this.nowProvider();
        const currentReplay = await this.principals.findOne(
          { activationIdempotencyKey: idempotencyKey },
          { session },
        );
        if (currentReplay) {
          controls.markExplicitNoOpSuccess();
          return resolveGovernanceReplay(
            currentReplay,
            "activationPayloadFingerprint",
            payloadFingerprint,
          );
        }
        const [primary, successor, successorUser, activatorUser] =
          await Promise.all([
            this.readEligiblePrimaryOwner(transactionNow, session),
            this.principals.findOne(
              {
                _id: principalId,
                principalType: "SUCCESSOR_OWNER",
                status: "ACTIVE",
              },
              { session },
            ),
            this.users.findOne({ _id: outer.userId }, { session }),
            this.users.findOne({ _id: actor.id }, { session }),
          ]);
        if (
          !primary ||
          !successor ||
          successor.userId !== outer.userId ||
          successor.predecessorPrincipalId !== primary._id ||
          successor.approvedBy !== actor.id ||
          successor.createdBy === actor.id ||
          successor.userId === actor.id ||
          !isEligibleUser(successorUser) ||
          !isEligibleUser(activatorUser) ||
          successor.effectiveAt > transactionNow ||
          successor.expiresAt === null ||
          successor.expiresAt <= transactionNow
        ) {
          controls.markExplicitNoOpSuccess();
          return blocked(["STALE_SUCCESSION_STATE"]);
        }
        const primarySuperseded = await this.principals.updateOne(
          {
            _id: primary._id,
            status: "ACTIVE",
            principalType: "PRIMARY_OWNER",
          },
          { $set: { status: "SUPERSEDED", successorPrincipalId: successor._id } },
          { session },
        );
        if (primarySuperseded.modifiedCount !== 1) {
          throw new RoleValidationError("STALE_PRIMARY_OWNER_STATE");
        }
        const promoted = await this.principals.findOneAndUpdate(
          {
            _id: successor._id,
            status: "ACTIVE",
            principalType: "SUCCESSOR_OWNER",
            predecessorPrincipalId: primary._id,
            approvedBy: actor.id,
          },
          {
            $set: {
              principalType: "PRIMARY_OWNER",
              predecessorPrincipalId: primary._id,
              reason,
              activationIdempotencyKey: idempotencyKey,
              activationPayloadFingerprint: payloadFingerprint,
            },
          },
          { session, returnDocument: "after" },
        );
        if (!promoted) throw new RoleValidationError("STALE_SUCCESSION_STATE");
        await this.audit.record(actor, permission, successor.userId, {
          mutationType: "owner.succession.activate",
          predecessorPrincipalId: primary._id,
          successorPrincipalId: successor._id,
          reason,
          independentActivatorUserId: actor.id,
          approvedBy: successor.approvedBy,
          transactionTime: transactionNow,
          idempotencyKey,
          payloadFingerprint,
        }, session);
        controls.markAuthSecurityTruthChanged();
        return { applied: true, primaryOwner: toSafePrincipalStatus(promoted) };
      },
      );
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      const raced = await this.principals.findOne({ activationIdempotencyKey: idempotencyKey });
      if (!raced) throw new RoleValidationError("GOVERNANCE_IDEMPOTENCY_RACE_UNRESOLVED");
      result = resolveGovernanceReplay(
        raced,
        "activationPayloadFingerprint",
        payloadFingerprint,
      );
    }
    await this.actorCache.invalidateAll({
      traceId: getTraceIdOrThrow(),
      actorId: actor.id,
      context: actor.context,
      operation: "owner.succession.activate",
    });
    return result;
  }

  private async readEligiblePrimaryOwner(
    now: number,
    session?: import("mongodb").ClientSession,
  ): Promise<PrincipalDocument | null> {
    const storedPrincipal =
      await this.governanceRepository.findActivePrimaryOwner(session);
    const principal = storedPrincipal
      ? { ...storedPrincipal, _id: storedPrincipal.principalId }
      : null;
    if (!principal) return null;
    const user = await this.users.findOne(
      { _id: principal.userId },
      session ? { session } : {},
    );
    const eligibility = evaluateGovernancePrincipalEligibility(
      { ...principal, principalId: principal._id },
      toGovernanceUserEligibility(user),
      now,
    );
    return eligibility.eligible ? principal : null;
  }

  private async toEligibilityStatus(
    record: PrincipalDocument,
    actor: Actor,
    now: number,
    currentPrimaryPrincipalId: string | null,
  ): Promise<Record<string, unknown>> {
    const user = await this.users.findOne({ _id: record.userId });
    const eligibility = evaluateGovernancePrincipalEligibility(
      { ...record, principalId: record._id },
      toGovernanceUserEligibility(user),
      now,
    );
    const base = toSafePrincipalStatus(record, now);
    return {
      ...base,
      eligible: eligibility.eligible,
      eligibilityReasons: eligibility.blockers,
      canApproveSuccessor:
        actor.permissions.includes(Permission.OWNER_SUCCESSION_MANAGE) &&
        record.principalType === "SUCCESSOR_OWNER" &&
        record.status === "PENDING" &&
        record.predecessorPrincipalId === currentPrimaryPrincipalId &&
        actor.id !== record.userId &&
        actor.id !== record.createdBy &&
        isEligibleUser(await this.users.findOne({ _id: actor.id })),
      canActivateSuccessor:
        actor.permissions.includes(Permission.OWNER_SUCCESSION_MANAGE) &&
        record.principalType === "SUCCESSOR_OWNER" &&
        record.status === "ACTIVE" &&
        record.predecessorPrincipalId === currentPrimaryPrincipalId &&
        record.effectiveAt <= now &&
        record.expiresAt !== null &&
        record.expiresAt > now &&
        actor.id !== record.userId &&
        actor.id !== record.createdBy &&
        actor.id === record.approvedBy &&
        isEligibleUser(await this.users.findOne({ _id: actor.id })),
      ineligibilityReason: eligibility.blockers[0] ?? null,
      nextAllowedAction:
        record.status === "PENDING"
          ? "INDEPENDENT_REVIEW"
          : record.principalType === "SUCCESSOR_OWNER" &&
              record.status === "ACTIVE"
            ? "ACTIVATE_IN_EFFECTIVE_WINDOW"
            : null,
    };
  }
}

function toSafePrincipalStatus(
  record: PrincipalDocument,
  now = Date.now(),
): Record<string, unknown> {
  return {
    principalId: record._id,
    principalType: record.principalType,
    status: record.status,
    effectiveAt: record.effectiveAt,
    expiresAt: record.expiresAt,
    eligibleNow:
      record.status === "ACTIVE" &&
      record.effectiveAt <= now &&
      (record.expiresAt === null || record.expiresAt > now),
  };
}

function isEligibleUser(user: UserDocument | null): boolean {
  return !!(
    user &&
    user.accountStatus === "ACTIVE" &&
    !user.disabledAt &&
    !user.archivedAt &&
    user.authLinkage?.status !== "UNLINKED" &&
    user.authLinkage?.subject
  );
}

function toGovernanceUserEligibility(user: UserDocument | null) {
  return user
    ? {
        userId: user._id,
        userActive:
          user.accountStatus === "ACTIVE" &&
          !user.disabledAt &&
          !user.archivedAt,
        authLinked:
          user.authLinkage?.status !== "UNLINKED" &&
          typeof user.authLinkage?.subject === "string" &&
          user.authLinkage.subject.length > 0,
        accountEligible: user.accountStatus === "ACTIVE",
      }
    : null;
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new RoleValidationError(`${field} is required`);
  }
  return value.trim();
}

function timestamp(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new RoleValidationError(`${field} must be a finite timestamp`);
  }
  return value;
}

function governanceFingerprint(
  operation: "PROPOSAL" | "DECISION" | "ACTIVATION",
  payload: Record<string, unknown>,
): string {
  return `owner-succession:${operation.toLowerCase()}:v1:${crypto
    .createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex")}`;
}

function resolveGovernanceReplay(
  record: PrincipalDocument,
  fingerprintField:
    | "proposalPayloadFingerprint"
    | "decisionPayloadFingerprint"
    | "activationPayloadFingerprint",
  requestedFingerprint: string,
): Record<string, unknown> {
  if (record[fingerprintField] !== requestedFingerprint) {
    throw new RoleValidationError("IDEMPOTENCY_KEY_CONFLICT");
  }
  return {
    applied: false,
    replay: true,
    principal: toSafePrincipalStatus(record),
  };
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === 11000
  );
}

function blocked(blockers: readonly string[]): Record<string, unknown> {
  return { applied: false, blockers: [...blockers], auditWritten: false };
}
