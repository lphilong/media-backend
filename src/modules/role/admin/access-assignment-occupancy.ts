import { ClientSession, Collection, Db } from "mongodb";
import {
  AuthoritySlotRecord,
  buildAuthoritySlotIdentity,
  resolveAuthoritySlotEffectiveHolder,
} from "@modules/role/domain/authority-slot";
import {
  RoleAssignmentScopeGrant,
  buildRoleAssignmentScopeFingerprint,
} from "@modules/role/domain/role-assignment-scope";
import { UserRoleAssignmentRecord } from "@modules/role/domain/role.types";
import { buildCurrentRoleAssignmentPolicy } from "@modules/role/domain/sensitive-access-policy";
import { resolveRoleAssignmentOperationalState } from "@modules/role/domain/role-assignment-operational-state";

interface AssignmentDocument extends Omit<
  UserRoleAssignmentRecord,
  "assignmentId"
> {
  readonly _id: string;
}

interface RoleDocument {
  readonly _id: string;
  readonly code?: string | null;
  readonly templateCode?: string | null;
  readonly state: string;
  readonly permissions: readonly string[];
}

interface AuthoritySlotDocument extends Omit<AuthoritySlotRecord, "id"> {
  readonly _id: string;
}

export interface AccessAssignmentOccupancyCandidate {
  readonly userId: string;
  readonly roleId: string;
  readonly roleCode?: string | null;
  readonly structuredScopeGrants: readonly RoleAssignmentScopeGrant[];
  readonly scopeFingerprint: string;
}

export interface AccessAssignmentOccupancyConflict {
  readonly assignmentId: string;
  readonly roleId: string;
  readonly roleCode: string | null;
  readonly scopeFingerprint: string;
  readonly lifecycleState: string;
}

/** Shared preview/apply duplicate occupancy contract. */
export async function findOperationalAssignmentOccupant(
  db: Db,
  candidate: AccessAssignmentOccupancyCandidate,
  now: number,
  session?: ClientSession,
  ignoreAssignmentIds: readonly string[] = [],
): Promise<AccessAssignmentOccupancyConflict | null> {
  const assignments = db.collection<AssignmentDocument>("role_assignments");
  const roles = db.collection<RoleDocument>("roles");
  const slots = db.collection<AuthoritySlotDocument>(
    "role_assignment_authority_slots",
  );
  const ignored = new Set(ignoreAssignmentIds);
  const slotIdentity = buildAuthoritySlotIdentity(candidate);
  const storedSlot = await slots.findOne(
    { _id: slotIdentity.id },
    session ? { session } : {},
  );

  if (storedSlot) {
    const slot: AuthoritySlotRecord = { id: storedSlot._id, ...storedSlot };
    const holder = resolveAuthoritySlotEffectiveHolder(slot, now);
    if (holder.assignmentId !== null) {
      const slotCandidateIds = [
        holder.assignmentId,
        ...(slot.scheduledSuccessorAssignmentId &&
        slot.scheduledSuccessorAssignmentId !== holder.assignmentId
          ? [slot.scheduledSuccessorAssignmentId]
          : []),
      ];
      for (const assignmentId of slotCandidateIds) {
        if (ignored.has(assignmentId)) continue;
        const occupant = await assignments.findOne(
          { _id: assignmentId },
          session ? { session } : {},
        );
        const conflict = occupant
          ? await resolveOperationalConflict(
              roles,
              occupant,
              candidate.roleCode ?? null,
              now,
              session,
            )
          : null;
        if (conflict) return conflict;
      }
    }
    return null;
  }

  const fallback = await assignments
    .find(
      {
        roleId: candidate.roleId,
        userId: candidate.userId,
        scopeFingerprint: candidate.scopeFingerprint,
        state: { $in: ["ACTIVE", "SCHEDULED", "SUSPENDED"] },
        ...(ignored.size > 0 ? { _id: { $nin: [...ignored] } } : {}),
      },
      session ? { session } : {},
    )
    .sort({ createdAt: 1, _id: 1 })
    .toArray();
  for (const occupant of fallback) {
    const conflict = await resolveOperationalConflict(
      roles,
      occupant,
      candidate.roleCode ?? null,
      now,
      session,
    );
    if (conflict) return conflict;
  }
  return null;
}

async function resolveOperationalConflict(
  roles: Collection<RoleDocument>,
  assignment: AssignmentDocument,
  roleCode: string | null,
  now: number,
  session?: ClientSession,
): Promise<AccessAssignmentOccupancyConflict | null> {
  const role = await roles.findOne(
    { _id: assignment.roleId, state: "ACTIVE" },
    session ? { session } : {},
  );
  if (!role) return null;
  const currentPolicy = buildCurrentRoleAssignmentPolicy({
    roleCode: role.code,
    roleTemplateCode: role.templateCode ?? role.code,
    permissions: role.permissions,
    structuredScopeGrants: assignment.structuredScopeGrants,
    effectiveAt: assignment.effectiveAt,
    durableReviewDeadline:
      assignment.lifecycle?.reviewDeadline ?? assignment.reviewAt,
    durableRiskTier: assignment.lifecycle?.riskTier ?? null,
    storedPermissionFingerprint:
      assignment.lifecycle?.permissionFingerprint ?? null,
    assessedAt: now,
    scopeFingerprint:
      assignment.scopeFingerprint ??
      buildRoleAssignmentScopeFingerprint(assignment.structuredScopeGrants),
  });
  const operational = resolveRoleAssignmentOperationalState(
    assignment,
    now,
    currentPolicy,
  );
  if (
    operational.state !== "OPERATIONALLY_ACTIVE" &&
    operational.state !== "FUTURE_SCHEDULED" &&
    operational.state !== "OPERATIONALLY_SUSPENDED"
  ) {
    return null;
  }
  return {
    assignmentId: assignment._id,
    roleId: assignment.roleId,
    roleCode: roleCode ?? role.code ?? null,
    scopeFingerprint: assignment.scopeFingerprint ?? "",
    lifecycleState: operational.state,
  };
}
