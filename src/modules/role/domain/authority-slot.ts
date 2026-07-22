import crypto from "node:crypto";
import {
  RoleAssignmentScopeGrant,
  buildRoleAssignmentScopeFingerprint,
  normalizeRoleAssignmentScopeGrants,
} from "./role-assignment-scope";
import { RoleAssignmentConflictError, RoleValidationError } from "./role.errors";

export const AUTHORITY_SLOT_SCHEMA_VERSION = 1 as const;
export const AUTHORITY_SLOT_INDEX_VERSION = "authority-slot/v1" as const;

export interface AuthoritySlotIdentity {
  readonly id: string;
  readonly userId: string;
  readonly roleId: string;
  readonly scopeFingerprint: string;
}

export interface AuthoritySlotRecord extends AuthoritySlotIdentity {
  readonly schemaVersion: typeof AUTHORITY_SLOT_SCHEMA_VERSION;
  readonly status: "RESERVED" | "RELEASED";
  readonly lineageId: string;
  readonly currentAssignmentId: string;
  readonly scheduledSuccessorAssignmentId: string | null;
  readonly successorEffectiveAt: number | null;
  readonly releaseAt: number | null;
  readonly predecessorReleaseAt: number | null;
  readonly transitionIdentity: string;
  readonly version: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface AuthoritySlotReservationCommand extends AuthoritySlotIdentity {
  readonly lineageId: string;
  readonly assignmentId: string;
  readonly predecessorAssignmentId?: string | null;
  readonly successorEffectiveAt?: number | null;
  readonly assignmentExpiresAt?: number | null;
  readonly transitionIdentity: string;
  readonly now: number;
}

export type AuthoritySlotReservationPlan =
  | { readonly kind: "INSERT"; readonly record: AuthoritySlotRecord }
  | { readonly kind: "IDEMPOTENT"; readonly record: AuthoritySlotRecord }
  | {
      readonly kind: "CAS";
      readonly expectedVersion: number;
      readonly record: AuthoritySlotRecord;
    };

export type AuthoritySlotReleaseResult =
  | "RELEASED"
  | "PROMOTED_SUCCESSOR"
  | "CLEARED_SUCCESSOR"
  | "NO_OP";

export type AuthoritySlotReleasePlan =
  | { readonly kind: "NO_OP"; readonly result: "NO_OP" }
  | {
      readonly kind: "CAS";
      readonly expectedVersion: number;
      readonly record: AuthoritySlotRecord;
      readonly result: Exclude<AuthoritySlotReleaseResult, "NO_OP">;
    };

export type AuthoritySlotScheduledReleasePlan =
  | { readonly kind: "IDEMPOTENT" }
  | {
      readonly kind: "CAS";
      readonly expectedVersion: number;
      readonly record: AuthoritySlotRecord;
    };

export function buildAuthoritySlotIdentity(params: {
  readonly userId: unknown;
  readonly roleId: unknown;
  readonly structuredScopeGrants?: unknown;
  readonly scopeFingerprint?: unknown;
}): AuthoritySlotIdentity {
  const userId = requiredText(params.userId, "userId");
  const roleId = requiredText(params.roleId, "roleId");
  const grants = normalizeRoleAssignmentScopeGrants(
    params.structuredScopeGrants,
  );
  const canonicalFingerprint = buildRoleAssignmentScopeFingerprint(grants);
  if (
    params.scopeFingerprint !== undefined &&
    params.scopeFingerprint !== null &&
    requiredText(params.scopeFingerprint, "scopeFingerprint") !==
      canonicalFingerprint
  ) {
    throw new RoleValidationError("AUTHORITY_SLOT_SCOPE_FINGERPRINT_MISMATCH");
  }
  const digest = crypto
    .createHash("sha256")
    .update(JSON.stringify([userId, roleId, canonicalFingerprint]), "utf8")
    .digest("hex");
  return Object.freeze({
    id: `authority-slot:v1:${digest}`,
    userId,
    roleId,
    scopeFingerprint: canonicalFingerprint,
  });
}

export function planAuthoritySlotReservation(
  existing: AuthoritySlotRecord | null,
  command: AuthoritySlotReservationCommand,
): AuthoritySlotReservationPlan {
  assertIdentity(command);
  const assignmentExpiresAt = optionalFiniteTimestamp(
    command.assignmentExpiresAt,
    "assignmentExpiresAt",
  );
  const base: AuthoritySlotRecord = {
    id: command.id,
    userId: command.userId,
    roleId: command.roleId,
    scopeFingerprint: command.scopeFingerprint,
    schemaVersion: AUTHORITY_SLOT_SCHEMA_VERSION,
    status: "RESERVED",
    lineageId: requiredText(command.lineageId, "lineageId"),
    currentAssignmentId:
      command.predecessorAssignmentId ?? command.assignmentId,
    scheduledSuccessorAssignmentId:
      command.predecessorAssignmentId ? command.assignmentId : null,
    successorEffectiveAt:
      command.predecessorAssignmentId
        ? finiteTimestamp(command.successorEffectiveAt, "successorEffectiveAt")
        : null,
    releaseAt: assignmentExpiresAt,
    predecessorReleaseAt: null,
    transitionIdentity: requiredText(
      command.transitionIdentity,
      "transitionIdentity",
    ),
    version: 1,
    createdAt: finiteTimestamp(command.now, "now"),
    updatedAt: finiteTimestamp(command.now, "now"),
  };
  if (!existing) return { kind: "INSERT", record: Object.freeze(base) };
  assertSlotRecord(existing);
  if (
    existing.transitionIdentity === command.transitionIdentity &&
    (existing.currentAssignmentId === command.assignmentId ||
      existing.scheduledSuccessorAssignmentId === command.assignmentId)
  ) {
    return { kind: "IDEMPOTENT", record: existing };
  }
  const sameLineageSuccessor =
    command.predecessorAssignmentId !== null &&
    command.predecessorAssignmentId !== undefined &&
    existing.status === "RESERVED" &&
    existing.lineageId === command.lineageId &&
    (existing.currentAssignmentId === command.predecessorAssignmentId ||
      (existing.scheduledSuccessorAssignmentId ===
        command.predecessorAssignmentId &&
        existing.successorEffectiveAt !== null &&
        existing.successorEffectiveAt <= command.now));
  const reclaimReleased = existing.status === "RELEASED";
  const reclaimTimedRelease =
    existing.releaseAt !== null && existing.releaseAt <= command.now;
  if (!sameLineageSuccessor && !reclaimReleased && !reclaimTimedRelease) {
    throw new RoleAssignmentConflictError("AUTHORITY_SLOT_ALREADY_RESERVED");
  }
  return {
    kind: "CAS",
    expectedVersion: existing.version,
    record: Object.freeze({
      ...base,
      predecessorReleaseAt: sameLineageSuccessor
        ? existing.releaseAt
        : null,
      createdAt: existing.createdAt,
      version: existing.version + 1,
    }),
  };
}

export function resolveAuthoritySlotEffectiveHolder(
  slot: AuthoritySlotRecord,
  now: number,
): {
  readonly assignmentId: string | null;
  readonly source:
    | "CURRENT"
    | "SCHEDULED_SUCCESSOR"
    | "RELEASED_BY_STATUS"
    | "RELEASED_BY_TIME";
} {
  finiteTimestamp(now, "now");
  assertSlotRecord(slot);
  if (slot.status === "RELEASED") {
    return { assignmentId: null, source: "RELEASED_BY_STATUS" };
  }
  if (slot.releaseAt !== null && slot.releaseAt <= now) {
    return { assignmentId: null, source: "RELEASED_BY_TIME" };
  }
  if (
    slot.scheduledSuccessorAssignmentId !== null &&
    slot.successorEffectiveAt !== null &&
    slot.successorEffectiveAt <= now
  ) {
    return {
      assignmentId: slot.scheduledSuccessorAssignmentId,
      source: "SCHEDULED_SUCCESSOR",
    };
  }
  return { assignmentId: slot.currentAssignmentId, source: "CURRENT" };
}

export function planAuthoritySlotRelease(
  existing: AuthoritySlotRecord,
  assignmentIdInput: string,
  transitionIdentityInput: string,
  nowInput: number,
): AuthoritySlotReleasePlan {
  const assignmentId = requiredText(assignmentIdInput, "assignmentId");
  const transitionIdentity = requiredText(
    transitionIdentityInput,
    "transitionIdentity",
  );
  const now = finiteTimestamp(nowInput, "now");
  const effectiveHolder = resolveAuthoritySlotEffectiveHolder(existing, now);
  if (existing.status === "RELEASED") {
    return { kind: "NO_OP", result: "NO_OP" };
  }

  const changed = (
    result: Exclude<AuthoritySlotReleaseResult, "NO_OP">,
    fields: Partial<AuthoritySlotRecord>,
  ): AuthoritySlotReleasePlan => ({
    kind: "CAS",
    expectedVersion: existing.version,
    result,
    record: Object.freeze({
      ...existing,
      ...fields,
      transitionIdentity,
      version: existing.version + 1,
      updatedAt: now,
    }),
  });

  if (existing.releaseAt !== null && existing.releaseAt <= now) {
    return changed("RELEASED", {
      status: "RELEASED",
      scheduledSuccessorAssignmentId: null,
      successorEffectiveAt: null,
      predecessorReleaseAt: null,
    });
  }

  const scheduledId = existing.scheduledSuccessorAssignmentId;
  const successorEffective =
    scheduledId !== null &&
    existing.successorEffectiveAt !== null &&
    existing.successorEffectiveAt <= now;
  if (scheduledId === assignmentId) {
    if (!successorEffective) {
      return changed("CLEARED_SUCCESSOR", {
        scheduledSuccessorAssignmentId: null,
        successorEffectiveAt: null,
        releaseAt: existing.predecessorReleaseAt,
        predecessorReleaseAt: null,
      });
    }
    return changed("RELEASED", {
      status: "RELEASED",
      currentAssignmentId: scheduledId,
      scheduledSuccessorAssignmentId: null,
      successorEffectiveAt: null,
      releaseAt: now,
      predecessorReleaseAt: null,
    });
  }
  if (existing.currentAssignmentId === assignmentId && scheduledId !== null) {
    if (successorEffective || effectiveHolder.assignmentId === scheduledId) {
      return { kind: "NO_OP", result: "NO_OP" };
    }
    return changed("PROMOTED_SUCCESSOR", {
      currentAssignmentId: scheduledId,
      scheduledSuccessorAssignmentId: null,
      successorEffectiveAt: null,
      predecessorReleaseAt: null,
    });
  }
  if (
    existing.currentAssignmentId === assignmentId &&
    effectiveHolder.assignmentId === assignmentId
  ) {
    return changed("RELEASED", {
      status: "RELEASED",
      releaseAt: now,
      predecessorReleaseAt: null,
    });
  }
  return { kind: "NO_OP", result: "NO_OP" };
}

export function planAuthoritySlotScheduledRelease(
  existing: AuthoritySlotRecord | null,
  expectedEffectiveAssignmentIdInput: string,
  requestedReleaseAtInput: number,
  transitionIdentityInput: string,
  nowInput: number,
): AuthoritySlotScheduledReleasePlan {
  const expectedEffectiveAssignmentId = requiredText(
    expectedEffectiveAssignmentIdInput,
    "expectedEffectiveAssignmentId",
  );
  const requestedReleaseAt = finiteTimestamp(
    requestedReleaseAtInput,
    "requestedReleaseAt",
  );
  const transitionIdentity = requiredText(
    transitionIdentityInput,
    "transitionIdentity",
  );
  const now = finiteTimestamp(nowInput, "now");
  if (!existing) {
    throw new RoleAssignmentConflictError("AUTHORITY_SLOT_NOT_RESERVED");
  }
  assertSlotRecord(existing);
  if (
    existing.status === "RESERVED" &&
    existing.transitionIdentity === transitionIdentity &&
    existing.releaseAt === requestedReleaseAt &&
    existing.currentAssignmentId === expectedEffectiveAssignmentId &&
    existing.scheduledSuccessorAssignmentId === null
  ) {
    return { kind: "IDEMPOTENT" };
  }
  if (existing.status !== "RESERVED") {
    throw new RoleAssignmentConflictError("AUTHORITY_SLOT_NOT_RESERVED");
  }
  if (existing.releaseAt !== null && existing.releaseAt <= now) {
    throw new RoleAssignmentConflictError("AUTHORITY_SLOT_NOT_RESERVED");
  }

  const holder = resolveAuthoritySlotEffectiveHolder(existing, now);
  if (holder.assignmentId !== expectedEffectiveAssignmentId) {
    throw new RoleAssignmentConflictError(
      "AUTHORITY_SLOT_CURRENT_ASSIGNMENT_MISMATCH",
    );
  }
  const effectiveScheduledSuccessor =
    holder.source === "SCHEDULED_SUCCESSOR" &&
    existing.scheduledSuccessorAssignmentId === expectedEffectiveAssignmentId;
  if (
    existing.scheduledSuccessorAssignmentId !== null &&
    !effectiveScheduledSuccessor
  ) {
    throw new RoleAssignmentConflictError(
      "AUTHORITY_SLOT_HAS_SCHEDULED_SUCCESSOR",
    );
  }

  return {
    kind: "CAS",
    expectedVersion: existing.version,
    record: Object.freeze({
      ...existing,
      status: "RESERVED",
      currentAssignmentId: expectedEffectiveAssignmentId,
      scheduledSuccessorAssignmentId: null,
      successorEffectiveAt: null,
      releaseAt: requestedReleaseAt,
      predecessorReleaseAt: null,
      transitionIdentity,
      version: existing.version + 1,
      updatedAt: now,
    }),
  };
}

function assertIdentity(value: AuthoritySlotIdentity): void {
  if (!value.id || !value.userId || !value.roleId || !value.scopeFingerprint) {
    throw new RoleValidationError("AUTHORITY_SLOT_IDENTITY_INVALID");
  }
}

function assertSlotRecord(value: AuthoritySlotRecord): void {
  assertIdentity(value);
  if (value.status !== "RESERVED" && value.status !== "RELEASED") {
    throw new RoleValidationError("AUTHORITY_SLOT_STATUS_INVALID");
  }
  requiredText(value.currentAssignmentId, "currentAssignmentId");
  optionalFiniteTimestamp(value.releaseAt, "releaseAt");
  optionalFiniteTimestamp(value.predecessorReleaseAt, "predecessorReleaseAt");
  optionalFiniteTimestamp(value.successorEffectiveAt, "successorEffectiveAt");
  finiteTimestamp(value.createdAt, "createdAt");
  finiteTimestamp(value.updatedAt, "updatedAt");
  if (!Number.isInteger(value.version) || value.version < 1) {
    throw new RoleValidationError("AUTHORITY_SLOT_VERSION_INVALID");
  }
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new RoleValidationError(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function finiteTimestamp(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new RoleValidationError(`${field} must be a finite timestamp`);
  }
  return value;
}

function optionalFiniteTimestamp(
  value: unknown,
  field: string,
): number | null {
  if (value === null || value === undefined) return null;
  return finiteTimestamp(value, field);
}
