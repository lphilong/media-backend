import { Db, IndexDescription } from "mongodb";
import { SystemInvariantError } from "@core/error/system-error";

export type RoleSchemaProvenance =
  | "PROVEN_FRESH_WAVE_1"
  | "RETAINED_OR_UNKNOWN_VERIFY_ONLY";

export const DEFAULT_ROLE_SCHEMA_PROVENANCE: RoleSchemaProvenance =
  "RETAINED_OR_UNKNOWN_VERIFY_ONLY";

export interface FinalRoleIndexSpec {
  readonly collection: string;
  readonly name: string;
  readonly key: Readonly<Record<string, 1 | -1>>;
  readonly unique?: true;
  readonly partialFilterExpression?: Readonly<Record<string, unknown>>;
}

export const ROLE_UNIQ_CODE_INDEX = "uniq_role_code";
export const ROLE_STATE_UPDATED_LIST_INDEX_NAME = "idx_role_state_updated";
export const ROLE_UPDATED_LIST_INDEX_NAME = "idx_role_updated";
export const ROLE_SEARCH_NAME_UPDATED_LIST_INDEX_NAME = "idx_role_search_name_updated";
export const ROLE_SEARCH_CODE_UPDATED_LIST_INDEX_NAME = "idx_role_search_code_updated";
/** Legacy-only name. It is deliberately absent from FINAL_ROLE_INDEX_SPECS. */
export const ROLE_ACTIVE_ASSIGNMENT_UNIQ_INDEX =
  "uniq_role_assignment_active_role_user_scope";
export const ROLE_ASSIGNMENT_AUTHORITY_LOOKUP_INDEX_NAME =
  "idx_role_assignment_authority_lookup_v2";
export const ROLE_ASSIGNMENT_ROLE_STATE_UPDATED_LIST_INDEX_NAME =
  "idx_role_assignment_role_state_updated";
export const AUTHORITY_SLOT_IDENTITY_INDEX_NAME =
  "uniq_role_authority_slot_identity_v1";
export const AUTHORITY_SLOT_LINEAGE_INDEX_NAME =
  "idx_role_authority_slot_lineage_v1";
export const AUTHORITY_SLOT_SUCCESSOR_INDEX_NAME =
  "idx_role_authority_slot_successor_v1";
export const AUTHORITY_SLOT_RECLAIM_INDEX_NAME =
  "idx_role_authority_slot_reclaim_v1";
export const BUNDLE_ASSIGNMENT_TARGET_STATUS_INDEX_NAME = "idx_bundle_assignment_target_status";
export const GOVERNANCE_PRIMARY_OWNER_UNIQ_INDEX_NAME = "uniq_governance_primary_owner_active";
export const GOVERNANCE_USER_WINDOW_INDEX_NAME = "idx_governance_user_status_window";
export const GOVERNANCE_PROPOSAL_IDEMPOTENCY_INDEX_NAME = "uniq_governance_proposal_idempotency";
export const GOVERNANCE_DECISION_IDEMPOTENCY_INDEX_NAME = "uniq_governance_decision_idempotency";
export const GOVERNANCE_ACTIVATION_IDEMPOTENCY_INDEX_NAME = "uniq_governance_activation_idempotency";
export const ACCESS_REVIEW_DUE_INDEX_NAME = "idx_assignment_review_due";
export const ACCESS_REVIEW_ASSIGNMENT_HISTORY_INDEX_NAME = "idx_assignment_review_history";
export const ACCESS_GRACE_CYCLE_INDEX_NAME = "idx_assignment_grace_cycle";
export const ACCESS_LINEAGE_IDEMPOTENCY_INDEX_NAME = "uniq_assignment_lineage_idempotency";
export const ACCESS_LINEAGE_PREDECESSOR_INDEX_NAME = "idx_assignment_lineage_predecessor";
export const ACCESS_SUSPENSION_ASSIGNMENT_INDEX_NAME = "idx_assignment_suspension_history";
export const ACCESS_SUCCESSOR_IDEMPOTENCY_INDEX_NAME = "uniq_assignment_successor_idempotency";
export const ACCESS_SUCCESSOR_STATUS_INDEX_NAME = "idx_assignment_successor_status";
export const GENERATED_ACCESS_PREREQUISITE_SOURCE_INDEX_NAME = "idx_generated_access_prerequisite_source";
export const BREAK_GLASS_ACTIVE_AUTHORITY_INDEX_NAME = "idx_break_glass_active_authority";
export const BREAK_GLASS_EXPIRY_INDEX_NAME = "idx_break_glass_expiry";
export const BREAK_GLASS_REVIEW_QUEUE_INDEX_NAME = "idx_break_glass_review_queue";
export const BREAK_GLASS_INCIDENT_INDEX_NAME = "idx_break_glass_incident";
export const BREAK_GLASS_IDEMPOTENCY_INDEX_NAME = "uniq_break_glass_request_idempotency";
export const ROLE_ASSIGNMENT_RULE_ROLE_LIST_INDEX_NAME = "idx_role_assignment_rule_role";
export const ROLE_ASSIGNMENT_RULE_UNIQ_CODE_INDEX = "uniq_role_assignment_rule_code";

const spec = (
  collection: string,
  name: string,
  key: Record<string, 1 | -1>,
  options: Pick<FinalRoleIndexSpec, "unique" | "partialFilterExpression"> = {},
): FinalRoleIndexSpec => Object.freeze({ collection, name, key: Object.freeze(key), ...options });

export const FINAL_ROLE_INDEX_SPECS: readonly FinalRoleIndexSpec[] = Object.freeze([
  spec("roles", ROLE_UNIQ_CODE_INDEX, { code: 1 }, { unique: true }),
  spec("roles", ROLE_STATE_UPDATED_LIST_INDEX_NAME, { state: 1, updatedAt: -1, _id: 1 }),
  spec("roles", ROLE_UPDATED_LIST_INDEX_NAME, { updatedAt: -1, _id: 1 }),
  spec("roles", ROLE_SEARCH_NAME_UPDATED_LIST_INDEX_NAME, { searchName: 1, updatedAt: -1, _id: 1 }),
  spec("roles", ROLE_SEARCH_CODE_UPDATED_LIST_INDEX_NAME, { searchCode: 1, updatedAt: -1, _id: 1 }),
  spec("role_assignments", ROLE_ASSIGNMENT_AUTHORITY_LOOKUP_INDEX_NAME, { userId: 1, roleId: 1, scopeFingerprint: 1, state: 1 }),
  spec("role_assignments", ROLE_ASSIGNMENT_ROLE_STATE_UPDATED_LIST_INDEX_NAME, { roleId: 1, state: 1, updatedAt: -1, _id: 1 }),
  spec("role_assignment_authority_slots", AUTHORITY_SLOT_IDENTITY_INDEX_NAME, { userId: 1, roleId: 1, scopeFingerprint: 1 }, { unique: true }),
  spec("role_assignment_authority_slots", AUTHORITY_SLOT_LINEAGE_INDEX_NAME, { lineageId: 1, status: 1, currentAssignmentId: 1 }),
  spec("role_assignment_authority_slots", AUTHORITY_SLOT_SUCCESSOR_INDEX_NAME, { scheduledSuccessorAssignmentId: 1, status: 1 }),
  spec("role_assignment_authority_slots", AUTHORITY_SLOT_RECLAIM_INDEX_NAME, { status: 1, releaseAt: 1, _id: 1 }),
  spec("bundle_assignments", BUNDLE_ASSIGNMENT_TARGET_STATUS_INDEX_NAME, { targetUserId: 1, status: 1, assignedAt: -1, _id: 1 }),
  spec("governance_principals", GOVERNANCE_PRIMARY_OWNER_UNIQ_INDEX_NAME, { principalType: 1, status: 1 }, { unique: true, partialFilterExpression: { principalType: "PRIMARY_OWNER", status: "ACTIVE" } }),
  spec("governance_principals", GOVERNANCE_USER_WINDOW_INDEX_NAME, { userId: 1, status: 1, effectiveAt: 1, expiresAt: 1, _id: 1 }),
  spec("governance_principals", GOVERNANCE_PROPOSAL_IDEMPOTENCY_INDEX_NAME, { proposalIdempotencyKey: 1 }, { unique: true, partialFilterExpression: { proposalIdempotencyKey: { $type: "string" } } }),
  spec("governance_principals", GOVERNANCE_DECISION_IDEMPOTENCY_INDEX_NAME, { decisionIdempotencyKey: 1 }, { unique: true, partialFilterExpression: { decisionIdempotencyKey: { $type: "string" } } }),
  spec("governance_principals", GOVERNANCE_ACTIVATION_IDEMPOTENCY_INDEX_NAME, { activationIdempotencyKey: 1 }, { unique: true, partialFilterExpression: { activationIdempotencyKey: { $type: "string" } } }),
  spec("assignment_review_cycles", ACCESS_REVIEW_DUE_INDEX_NAME, { state: 1, reviewDeadline: 1, _id: 1 }),
  spec("assignment_review_cycles", ACCESS_REVIEW_ASSIGNMENT_HISTORY_INDEX_NAME, { assignmentId: 1, createdAt: -1, _id: -1 }),
  spec("assignment_grace_exceptions", ACCESS_GRACE_CYCLE_INDEX_NAME, { cycleId: 1, requestedAt: -1, _id: 1 }),
  spec("assignment_lifecycle_lineages", ACCESS_LINEAGE_IDEMPOTENCY_INDEX_NAME, { idempotencyKey: 1 }, { unique: true }),
  spec("assignment_lifecycle_lineages", ACCESS_LINEAGE_PREDECESSOR_INDEX_NAME, { predecessorAssignmentId: 1, appliedAt: -1, _id: 1 }),
  spec("assignment_suspensions", ACCESS_SUSPENSION_ASSIGNMENT_INDEX_NAME, { assignmentId: 1, materializedAt: -1, _id: 1 }),
  spec("assignment_successor_requests", ACCESS_SUCCESSOR_IDEMPOTENCY_INDEX_NAME, { idempotencyKey: 1 }, { unique: true }),
  spec("assignment_successor_requests", ACCESS_SUCCESSOR_STATUS_INDEX_NAME, { state: 1, requestedAt: 1, _id: 1 }),
  spec("generated_access_prerequisites", GENERATED_ACCESS_PREREQUISITE_SOURCE_INDEX_NAME, { sourceRoleAssignmentIds: 1, status: 1, _id: 1 }),
  spec("break_glass_activations", BREAK_GLASS_ACTIVE_AUTHORITY_INDEX_NAME, { targetUserId: 1, status: 1, permissions: 1, scopeFingerprint: 1, expiresAt: 1, _id: 1 }),
  spec("break_glass_activations", BREAK_GLASS_EXPIRY_INDEX_NAME, { status: 1, expiresAt: 1, _id: 1 }),
  spec("break_glass_activations", BREAK_GLASS_REVIEW_QUEUE_INDEX_NAME, { status: 1, reviewerUserId: 1, "independentReviewDeadline.dueAt": 1, _id: 1 }),
  spec("break_glass_requests", BREAK_GLASS_IDEMPOTENCY_INDEX_NAME, { idempotencyKey: 1 }, { unique: true }),
  spec("break_glass_requests", BREAK_GLASS_INCIDENT_INDEX_NAME, { incidentReferenceId: 1, requestedAt: -1, _id: 1 }),
  spec("role_assignment_rules", ROLE_ASSIGNMENT_RULE_ROLE_LIST_INDEX_NAME, { roleId: 1, createdAt: 1, _id: 1 }),
  spec("role_assignment_rules", ROLE_ASSIGNMENT_RULE_UNIQ_CODE_INDEX, { roleId: 1, code: 1 }, { unique: true }),
]);

export class RoleSchemaMigrationRequiredError extends SystemInvariantError {
  readonly migrationRequired = true;
  readonly roleSchemaContract = "role-authority-schema/v4";
  constructor(detail: string) {
    super(
      "SYSTEM_INVARIANT_VIOLATION",
      `MIGRATION_REQUIRED role-authority-schema/v4: ${detail}`,
    );
    this.name = "RoleSchemaMigrationRequiredError";
  }
}

export async function initRoleIndexes(
  db: Db,
  provenance: RoleSchemaProvenance = DEFAULT_ROLE_SCHEMA_PROVENANCE,
): Promise<void> {
  if (provenance === "RETAINED_OR_UNKNOWN_VERIFY_ONLY") return;
  if (provenance !== "PROVEN_FRESH_WAVE_1") {
    throw new RoleSchemaMigrationRequiredError("unknown database provenance");
  }
  for (const item of FINAL_ROLE_INDEX_SPECS) {
    await db.collection(item.collection).createIndex(item.key, toIndexOptions(item));
  }
}

export async function assertFinalRoleSchemaReadiness(db: Db): Promise<void> {
  const byCollection = new Map<string, readonly IndexDescription[]>();
  for (const item of FINAL_ROLE_INDEX_SPECS) {
    let indexes = byCollection.get(item.collection);
    if (!indexes) {
      indexes = await db.collection(item.collection).indexes();
      byCollection.set(item.collection, indexes);
    }
    const actual = indexes.find((candidate) => candidate.name === item.name);
    if (!actual) throw new RoleSchemaMigrationRequiredError(`missing ${item.name}`);
    if (!exactObject(actual.key, item.key)) {
      throw new RoleSchemaMigrationRequiredError(`key mismatch for ${item.name}`);
    }
    if (Boolean(actual.unique) !== Boolean(item.unique)) {
      throw new RoleSchemaMigrationRequiredError(`unique mismatch for ${item.name}`);
    }
    if (!exactObject(actual.partialFilterExpression ?? null, item.partialFilterExpression ?? null)) {
      throw new RoleSchemaMigrationRequiredError(`partial filter mismatch for ${item.name}`);
    }
  }
}

function toIndexOptions(item: FinalRoleIndexSpec): Record<string, unknown> {
  return {
    name: item.name,
    ...(item.unique ? { unique: true } : {}),
    ...(item.partialFilterExpression
      ? { partialFilterExpression: item.partialFilterExpression }
      : {}),
  };
}

function exactObject(actual: unknown, expected: unknown): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}
