import type { ClientSession } from "mongodb";
import type {
  AssignmentLifecycleLineageRecord,
  AssignmentReviewCycleRecord,
  GraceExceptionRecord,
  SuspensionEvidenceRecord,
} from "./access-lifecycle-policy";
import type {
  BreakGlassActivationRecord,
  BreakGlassRequestRecord,
} from "./break-glass";
import type { GovernancePrincipalRecord } from "./governance-principal";

export interface BreakGlassExpiryEvidenceRecord {
  readonly transitionId: string;
  readonly activationId: string;
  readonly deadline: number;
  readonly materializedAt: number;
  readonly jobIdentity: string;
}

export interface GeneratedAccessPrerequisiteRecord {
  readonly prerequisiteId: string;
  readonly targetUserId: string;
  readonly sourceRoleAssignmentIds: readonly string[];
  readonly kind: "ACCOUNT_CONTEXT" | "RESPONSIBILITY";
  readonly value: string;
}

export interface AccessAuthorityReconciliationRepository {
  addSuccessorSource(
    predecessorAssignmentId: string,
    successorAssignmentId: string,
    session: ClientSession,
  ): Promise<void>;
  listActivePrerequisitesBySource(
    assignmentId: string,
    session: ClientSession,
  ): Promise<readonly GeneratedAccessPrerequisiteRecord[]>;
  countActiveAssignments(
    assignmentIds: readonly string[],
    session: ClientSession,
  ): Promise<number>;
  revokeGeneratedAccountContext(
    record: GeneratedAccessPrerequisiteRecord,
    now: number,
    session: ClientSession,
  ): Promise<boolean>;
  revokeGeneratedResponsibility(
    record: GeneratedAccessPrerequisiteRecord,
    actorId: string,
    now: number,
    session: ClientSession,
  ): Promise<boolean>;
  markPrerequisiteRevoked(
    prerequisiteId: string,
    now: number,
    session: ClientSession,
  ): Promise<boolean>;
  countActiveBundleChildren(
    bundleAssignmentId: string,
    session: ClientSession,
  ): Promise<number>;
  revokeBundleParent(
    bundleAssignmentId: string,
    actorId: string,
    now: number,
    session: ClientSession,
  ): Promise<void>;
}

export interface GovernancePrincipalRepository {
  findActivePrimaryOwner(
    session?: ClientSession,
  ): Promise<GovernancePrincipalRecord | null>;
  findEffectiveByUserId(
    userId: string,
    now: number,
    session?: ClientSession,
  ): Promise<readonly GovernancePrincipalRecord[]>;
  insert(
    record: GovernancePrincipalRecord,
    session: ClientSession,
  ): Promise<GovernancePrincipalRecord>;
}

export interface AccessLifecycleRepository {
  findCurrentReviewCycle(
    assignmentId: string,
    session?: ClientSession,
  ): Promise<AssignmentReviewCycleRecord | null>;
  findReviewCycleById(
    cycleId: string,
    session?: ClientSession,
  ): Promise<AssignmentReviewCycleRecord | null>;
  insertReviewCycle(
    record: AssignmentReviewCycleRecord,
    session: ClientSession,
  ): Promise<AssignmentReviewCycleRecord>;
  insertGraceException(
    record: GraceExceptionRecord,
    session: ClientSession,
  ): Promise<GraceExceptionRecord>;
  insertLineage(
    record: AssignmentLifecycleLineageRecord,
    session: ClientSession,
  ): Promise<AssignmentLifecycleLineageRecord>;
  findLineageByIdempotencyKey(
    idempotencyKey: string,
    session?: ClientSession,
  ): Promise<AssignmentLifecycleLineageRecord | null>;
  insertSuspension(
    record: SuspensionEvidenceRecord,
    session: ClientSession,
  ): Promise<SuspensionEvidenceRecord>;
  listDueAssignmentIds(
    now: number,
    limit: number,
    session?: ClientSession,
  ): Promise<readonly string[]>;
  listDueLifecycleTransitionCandidates(
    input: { readonly now: number; readonly limit: number },
    session?: ClientSession,
  ): Promise<readonly DueLifecycleTransitionCandidate[]>;
}

export interface DueLifecycleTransitionCandidate {
  readonly assignmentId: string;
  readonly cycleId: string;
  readonly candidateDeadline: number;
  readonly currentRiskTier: "HIGH" | "LOW";
  readonly roleId: string;
  readonly transitionReason:
    | "ASSIGNMENT_EXPIRY"
    | "REVIEW_DEADLINE_UNRESOLVABLE"
    | "REVIEW_AUTHORITY_END"
    | "MALFORMED_SUCCESSOR";
  readonly cycleMatchRequired: boolean;
}

export interface BreakGlassRepository {
  findRequestById(
    requestId: string,
    session?: ClientSession,
  ): Promise<BreakGlassRequestRecord | null>;
  findRequestByIdempotencyKey(
    idempotencyKey: string,
    session?: ClientSession,
  ): Promise<BreakGlassRequestRecord | null>;
  insertRequest(
    record: BreakGlassRequestRecord,
    session: ClientSession,
  ): Promise<BreakGlassRequestRecord>;
  replaceRequestIfStatus(
    record: BreakGlassRequestRecord,
    expectedStatus: BreakGlassRequestRecord["status"],
    session: ClientSession,
  ): Promise<BreakGlassRequestRecord | null>;
  findActivationById(
    activationId: string,
    session?: ClientSession,
  ): Promise<BreakGlassActivationRecord | null>;
  findActivationByRequestId(
    requestId: string,
    session?: ClientSession,
  ): Promise<BreakGlassActivationRecord | null>;
  insertActivation(
    record: BreakGlassActivationRecord,
    session: ClientSession,
  ): Promise<BreakGlassActivationRecord>;
  replaceActivationIfStatus(
    record: BreakGlassActivationRecord,
    expectedStatus: BreakGlassActivationRecord["status"],
    session: ClientSession,
  ): Promise<BreakGlassActivationRecord | null>;
  listEffectiveByUserId(
    userId: string,
    now: number,
    session?: ClientSession,
  ): Promise<readonly BreakGlassActivationRecord[]>;
  listDueActivationIds(
    now: number,
    limit: number,
    session?: ClientSession,
  ): Promise<readonly string[]>;
  listPendingReviewActivationIds(
    now: number,
    limit: number,
    session?: ClientSession,
  ): Promise<readonly string[]>;
  insertExpiryEvidence(
    record: BreakGlassExpiryEvidenceRecord,
    session: ClientSession,
  ): Promise<BreakGlassExpiryEvidenceRecord>;
}
