import {
  KPI_ACTUAL_SOURCES,
  KPI_ALLOCATION_STATUSES,
  KPI_METRIC_CODES,
  KPI_METRIC_UNITS,
  KPI_PLAN_CURRENCIES,
  KPI_PLAN_STATUSES,
  KPI_ROLLUP_METHODS,
  KPI_SUBJECT_TYPES,
} from "./kpi.types";
import {
  KPI_ACTUAL_AGGREGATION_METHODS,
  KPI_ACTUAL_CAPTURE_MODES,
  KPI_ACTUAL_EVIDENCE_MODES,
  KPI_ACTUAL_LIFECYCLE_STATUSES,
  KPI_ACTUAL_REVIEW_MODES,
} from "./kpi-actual-policy";
import {
  KPI_ALLOCATION_LIFECYCLE_STATUSES,
  KPI_ALLOCATION_MODES,
  KPI_PLAN_LIFECYCLE_STATUSES,
} from "./kpi-allocation-lifecycle";

/**
 * Pure persisted-record assessment owner for RISK-001.  It deliberately
 * assesses only projected persisted evidence; it does not derive or repair it.
 */
export const RISK001_KPI_PERSISTED_CONTRACT_VERSION =
  "RISK001-KPI-PERSISTED-CONTRACT-2026-07-V1" as const;

export const KPI_PERSISTED_FAMILIES = [
  "PLAN", "METRIC", "ALLOCATION", "ACTUAL", "CORRECTION",
  "ALLOCATION_OPERATION", "SLOT_EXCUSE",
] as const;
export type KpiPersistedFamily = (typeof KPI_PERSISTED_FAMILIES)[number];

export type KpiPersistedClassification =
  | "CURRENT_CANONICAL"
  | "STALE_DETERMINISTIC_MIGRATION"
  | "REBUILDABLE_TEST_DATA"
  | "DEPENDENCY_FREE_ARCHIVE_CANDIDATE"
  | "HISTORICAL_UNKNOWN"
  | "MANUAL_REVIEW_REQUIRED"
  | "PRESERVE_DUE_TO_DEPENDENCY"
  | "INVALID_OR_ORPHANED";

export interface KpiPersistedFamilyMatrix {
  readonly family: KpiPersistedFamily;
  readonly supportedStatusValues: readonly string[];
  readonly supportedLifecycleValues: readonly string[];
  readonly allowedStatusLifecyclePairs: readonly string[];
  readonly contradictoryPairs: readonly string[];
  readonly alwaysRequiredFields: readonly string[];
  readonly stateRequiredFields: Readonly<Record<string, readonly string[]>>;
  readonly optionalFields: readonly string[];
  readonly forbiddenInStateEvidence: Readonly<Record<string, readonly string[]>>;
  readonly actorCheckerReviewerRequirements: Readonly<Record<string, readonly string[]>>;
  readonly timestampRequirements: Readonly<Record<string, readonly string[]>>;
  readonly versionRequirements: readonly string[];
  readonly snapshotRequirements: readonly string[];
  readonly parentDependencyRequirements: readonly string[];
  readonly historicalLineageRequirements: readonly string[];
  readonly conservativeOutcomes: readonly KpiPersistedClassification[];
}

const allOutcomes: readonly KpiPersistedClassification[] = Object.freeze([
  "CURRENT_CANONICAL", "STALE_DETERMINISTIC_MIGRATION", "REBUILDABLE_TEST_DATA",
  "DEPENDENCY_FREE_ARCHIVE_CANDIDATE", "HISTORICAL_UNKNOWN", "MANUAL_REVIEW_REQUIRED",
  "PRESERVE_DUE_TO_DEPENDENCY", "INVALID_OR_ORPHANED",
]);
const planPairs = ["DRAFT:DRAFT", "PUBLISHED:RELEASED_FOR_ALLOCATION", "PUBLISHED:ACTIVE", "FINALIZED:FINALIZED", "ARCHIVED:ARCHIVED"] as const;
const allocationPairs = ["DRAFT:DRAFT", "PENDING_APPROVAL:SUBMITTED", "PENDING_APPROVAL:CHANGES_REQUESTED", "APPROVED:APPROVED", "PUBLISHED:PUBLISHED", "REJECTED:CHANGES_REQUESTED", "CLOSED:SUPERSEDED", "DRAFT:CORRECTED"] as const;

/** Finite matrices. Their provenance is the frozen Owner contract, then current domain enums/lifecycles. */
export const KPI_PERSISTED_CONTRACT_MATRICES: Readonly<Record<KpiPersistedFamily, KpiPersistedFamilyMatrix>> = Object.freeze({
  PLAN: matrix("PLAN", KPI_PLAN_STATUSES, KPI_PLAN_LIFECYCLE_STATUSES, planPairs,
    ["planCode", "subjectType", "subjectId", "status", "lifecycleStatus", "currencyCode", "periodMonth", "periodStartAt", "periodEndAt", "timezone", "createdAt", "createdByActorId", "updatedAt", "updatedByActorId"],
    { PUBLISHED: ["publishedAt", "publishedByActorId", "actualPolicySnapshot"], FINALIZED: ["publishedAt", "publishedByActorId", "actualPolicySnapshot", "finalizedAt", "finalizedByActorId", "finalResult"], ARCHIVED: ["archivedAt", "archivedByActorId"] },
    ["title", "description", "externalRef"], { DRAFT: ["publishedAt", "publishedByActorId", "finalizedAt", "finalizedByActorId", "finalResult", "archivedAt", "archivedByActorId"] },
    ["createdByActorId", "updatedByActorId", "publishedByActorId", "finalizedByActorId", "archivedByActorId"], ["createdAt", "updatedAt", "publishedAt", "finalizedAt", "archivedAt"], [], ["actualPolicySnapshot", "finalResult"], ["subjectId"], ["publication", "finalization", "archive"]),
  METRIC: matrix("METRIC", [], [], [],
    ["kpiPlanId", "metricCode", "targetValue", "targetValueExact", "allocationMode", "allocationScale", "groupRemainderExact", "unit", "rollupMethod", "actualSource", "actualCaptureMode", "actualReviewMode", "actualEvidenceMode", "actualPolicyVersion", "createdAt", "updatedAt"], {}, [], {}, {}, ["createdAt", "updatedAt"], ["actualPolicyVersion"], [], ["kpiPlanId"], ["planPolicyVersionLink"]),
  ALLOCATION: matrix("ALLOCATION", KPI_ALLOCATION_STATUSES, KPI_ALLOCATION_LIFECYCLE_STATUSES, allocationPairs,
    ["kpiPlanId", "subjectType", "subjectId", "allocationStatus", "lifecycleStatus", "allocationMode", "sourcePlanVersion", "allocationVersion", "membershipSnapshotVersion", "eligibleMemberSnapshot", "idempotencyKey", "idempotencyFingerprint", "correlationId", "allocationStartDate", "targetMetrics", "createdAt", "createdByActorId", "updatedAt", "updatedByActorId"],
    { SUBMITTED: ["submittedAt", "submittedByActorId"], CHANGES_REQUESTED: ["submittedAt", "submittedByActorId", "rejectedAt", "rejectedByActorId", "rejectionReason"], APPROVED: ["submittedAt", "submittedByActorId", "approvedAt", "approvedByActorId"], PUBLISHED: ["submittedAt", "submittedByActorId", "approvedAt", "approvedByActorId", "publishedAt", "publishedByActorId"], SUPERSEDED: ["closedAt"], CORRECTED: ["supersedesAllocationId", "correctsAllocationId", "note"] },
    ["approvalNote", "allocationEndDate", "snapshotMemberDisplayName"], { DRAFT: ["approvedAt", "approvedByActorId", "publishedAt", "publishedByActorId"] },
    ["createdByActorId", "updatedByActorId", "submittedByActorId", "approvedByActorId", "rejectedByActorId", "publishedByActorId"], ["createdAt", "updatedAt", "submittedAt", "approvedAt", "rejectedAt", "publishedAt", "closedAt"], ["sourcePlanVersion", "allocationVersion"], ["membershipSnapshotVersion", "eligibleMemberSnapshot"], ["kpiPlanId", "supersedesAllocationId", "correctsAllocationId"], ["submit", "approval", "rejection", "publication", "close", "correction"]),
  ACTUAL: matrix("ACTUAL", [], KPI_ACTUAL_LIFECYCLE_STATUSES, [],
    ["kpiPlanId", "allocationId", "metricCode", "actualDate", "actualValue", "effectiveValue", "entryVersion", "captureMode", "aggregationMethod", "reviewMode", "evidenceMode", "policyVersion", "createdAt", "createdByActorId", "updatedAt", "updatedByActorId"],
    { ACCEPTED: ["acceptedValue", "acceptedVersion"], CORRECTED: ["acceptedValue", "acceptedVersion"], LOCKED: ["acceptedValue", "acceptedVersion"] },
    ["memberEmploymentProfileId", "memberTalentId", "lastEditedAt", "lastEditedByActorId", "latestCorrectionId"], {}, ["createdByActorId", "updatedByActorId", "lastEditedByActorId"], ["createdAt", "updatedAt", "lastEditedAt"], ["entryVersion", "acceptedVersion", "policyVersion", "derivationVersion"], [], ["kpiPlanId", "allocationId", "metricCode", "latestCorrectionId"], ["acceptance", "sourceFingerprint", "acceptedInputVersions", "derivationVersion", "correction"]),
  CORRECTION: matrix("CORRECTION", [], ["CORRECTED", "UNDER_REVIEW"], [],
    ["actualEntryId", "kpiPlanId", "allocationId", "metricCode", "actualDate", "previousValue", "correctedValue", "previousEntryVersion", "replacementEntryVersion", "replacementLifecycleStatus", "requiresReview", "idempotencyKey", "payloadFingerprint", "reason", "correctedByActorId", "correctedAt", "createdAt"], {}, [], {}, { correction: ["correctedByActorId"] }, ["correctedAt", "createdAt"], ["previousEntryVersion", "replacementEntryVersion"], [], ["actualEntryId", "kpiPlanId", "allocationId"], ["reason-presence", "reviewDisposition", "predecessor/successor"]),
  ALLOCATION_OPERATION: matrix("ALLOCATION_OPERATION", ["PENDING", "COMPLETED"], [], [],
    ["kpiPlanId", "actorId", "operation", "idempotencyKey", "payloadFingerprint", "createdAt"], { COMPLETED: ["completedAt", "result"] }, [], {}, { operation: ["actorId"] }, ["createdAt", "completedAt"], [], [], ["kpiPlanId"], ["completion", "failure-if-represented", "explicit-owner-only"]),
  SLOT_EXCUSE: matrix("SLOT_EXCUSE", ["EXCUSED", "NOT_REQUIRED"], [], [],
    ["kpiPlanId", "allocationId", "metricCode", "actualDate", "status", "reasonCode", "reasonText", "createdAt", "createdByActorId", "updatedAt", "updatedByActorId"], { DELETED: ["deletedAt", "deletedByActorId"] }, [], {}, { active: ["createdByActorId", "updatedByActorId"], deleted: ["deletedByActorId"] }, ["createdAt", "updatedAt", "deletedAt"], [], [], ["kpiPlanId", "allocationId", "metricCode"], ["reason/evidence-presence", "deletion", "replacement/correction-if-represented"]),
});

export interface KpiPersistedEvaluationContext {
  readonly parentReferencesValid: boolean;
  readonly dependencyEvidence?: readonly string[];
  readonly planPolicyVersion?: string | null;
  readonly metricPolicy?: Readonly<Record<string, unknown>> | null;
  readonly predecessorExists?: boolean;
  readonly successorExists?: boolean;
  readonly latestCorrectionExists?: boolean;
}
export interface KpiPersistedEvaluation {
  readonly family: KpiPersistedFamily;
  readonly contractVersion: typeof RISK001_KPI_PERSISTED_CONTRACT_VERSION;
  readonly currentStatus: string | null;
  readonly currentLifecycle: string | null;
  readonly enumValidity: boolean;
  readonly statusLifecyclePairValidity: boolean;
  readonly missingAlwaysRequiredFields: readonly string[];
  readonly missingStateRequiredFields: readonly string[];
  readonly contradictoryFields: readonly string[];
  readonly invalidReferences: readonly string[];
  readonly dependencyEvidence: readonly string[];
  readonly lineageCompleteness: boolean;
  readonly policyVersionCompleteness: boolean;
  readonly materialSummary: Readonly<Record<string, unknown>>;
  readonly recommendedClassification: KpiPersistedClassification;
}

export function evaluateKpiPersistedRecord(
  family: KpiPersistedFamily,
  input: Readonly<object>,
  context: KpiPersistedEvaluationContext,
): KpiPersistedEvaluation {
  const record = input as Readonly<Record<string, unknown>>;
  const matrix = KPI_PERSISTED_CONTRACT_MATRICES[family];
  const status = family === "ALLOCATION_OPERATION"
    ? record.completedAt == null ? "PENDING" : "COMPLETED"
    : readText(record.status ?? record.allocationStatus);
  const lifecycle = readText(record.lifecycleStatus ?? record.replacementLifecycleStatus);
  const missingAlways = missing(record, matrix.alwaysRequiredFields);
  const requiredForState = stateFields(family, status, lifecycle, record);
  const missingState = missing(record, requiredForState);
  const contradictions = contradictionsFor(family, record, status, lifecycle, context);
  const invalidReferences = referencesFor(family, record, context);
  const enumValidity = enumValid(family, record, status, lifecycle);
  const pairValidity = pairValid(family, status, lifecycle);
  const lineageCompleteness = missingState.length === 0 && contradictions.length === 0;
  const policyVersionCompleteness = policyComplete(family, record, context);
  const dependencies = sorted(context.dependencyEvidence ?? []);
  const complete = enumValidity && pairValidity && missingAlways.length === 0 && lineageCompleteness && invalidReferences.length === 0 && policyVersionCompleteness;
  const recommendedClassification = complete ? "CURRENT_CANONICAL" : dependencies.length > 0 ? "PRESERVE_DUE_TO_DEPENDENCY" : invalidReferences.length > 0 ? "INVALID_OR_ORPHANED" : contradictions.length > 0 || !enumValidity || !pairValidity ? "MANUAL_REVIEW_REQUIRED" : "HISTORICAL_UNKNOWN";
  return Object.freeze({ family, contractVersion: RISK001_KPI_PERSISTED_CONTRACT_VERSION, currentStatus: status, currentLifecycle: lifecycle, enumValidity, statusLifecyclePairValidity: pairValidity, missingAlwaysRequiredFields: frozen(missingAlways), missingStateRequiredFields: frozen(missingState), contradictoryFields: frozen(contradictions), invalidReferences: frozen(invalidReferences), dependencyEvidence: frozen(dependencies), lineageCompleteness, policyVersionCompleteness, materialSummary: Object.freeze({ status, lifecycle, enumValidity, statusLifecyclePairValidity: pairValidity, missingAlwaysRequiredCount: missingAlways.length, missingStateRequiredCount: missingState.length, contradictionCount: contradictions.length, invalidReferenceCount: invalidReferences.length, dependencyCount: dependencies.length, lineageCompleteness, policyVersionCompleteness }), recommendedClassification });
}

function matrix(family: KpiPersistedFamily, statuses: readonly string[], lifecycles: readonly string[], pairs: readonly string[], always: readonly string[], state: Readonly<Record<string, readonly string[]>>, optional: readonly string[], forbidden: Readonly<Record<string, readonly string[]>>, actors: Readonly<Record<string, readonly string[]>> | readonly string[], timestamps: readonly string[], versions: readonly string[], snapshots: readonly string[], parents: readonly string[], history: readonly string[]): KpiPersistedFamilyMatrix {
  const actorRequirements: Readonly<Record<string, readonly string[]>> = Array.isArray(actors)
    ? { all: actors }
    : actors as Readonly<Record<string, readonly string[]>>;
  return Object.freeze({ family, supportedStatusValues: frozen(statuses), supportedLifecycleValues: frozen(lifecycles), allowedStatusLifecyclePairs: frozen(pairs), contradictoryPairs: Object.freeze([]), alwaysRequiredFields: frozen(always), stateRequiredFields: freezeRecord(state), optionalFields: frozen(optional), forbiddenInStateEvidence: freezeRecord(forbidden), actorCheckerReviewerRequirements: freezeRecord(actorRequirements), timestampRequirements: freezeRecord(Object.fromEntries(timestamps.map((field) => ["all", [field]]))), versionRequirements: frozen(versions), snapshotRequirements: frozen(snapshots), parentDependencyRequirements: frozen(parents), historicalLineageRequirements: frozen(history), conservativeOutcomes: allOutcomes });
}
function stateFields(family: KpiPersistedFamily, status: string | null, lifecycle: string | null, input: Readonly<Record<string, unknown>>): readonly string[] {
  const key = family === "PLAN" ? status ?? "" : lifecycle ?? status ?? "";
  const matrix = KPI_PERSISTED_CONTRACT_MATRICES[family];
  const fields = [...(matrix.stateRequiredFields[key] ?? [])];
  if (family === "ALLOCATION" && status === "REJECTED") fields.push("rejectedAt", "rejectedByActorId", "rejectionReason");
  if (family === "ACTUAL" && (input.captureMode === "IMPORTED_SOURCE" || input.captureMode === "DERIVED")) fields.push("sourceFingerprint");
  if (family === "ACTUAL" && input.captureMode === "DERIVED") fields.push("acceptedInputVersions", "derivationVersion");
  if (family === "ACTUAL" && Number(input.editCount ?? 0) > 0) fields.push("lastEditedAt", "lastEditedByActorId");
  if (family === "ACTUAL" && Number(input.correctionCount ?? 0) > 0) fields.push("latestCorrectionId");
  if (family === "SLOT_EXCUSE" && input.deletedAt != null) fields.push("deletedByActorId");
  return frozen(fields);
}
function enumValid(family: KpiPersistedFamily, input: Readonly<Record<string, unknown>>, status: string | null, lifecycle: string | null): boolean {
  const matrix = KPI_PERSISTED_CONTRACT_MATRICES[family];
  const member = (values: readonly string[], value: unknown) => typeof value === "string" && values.includes(value);
  if (matrix.supportedStatusValues.length && !member(matrix.supportedStatusValues, status)) return false;
  if (matrix.supportedLifecycleValues.length && !member(matrix.supportedLifecycleValues, lifecycle)) return false;
  if (family === "PLAN") return member(KPI_SUBJECT_TYPES, input.subjectType) && member(KPI_PLAN_CURRENCIES, input.currencyCode);
  if (family === "METRIC") return member(KPI_METRIC_CODES, input.metricCode) && member(KPI_METRIC_UNITS, input.unit) && member(KPI_ROLLUP_METHODS, input.rollupMethod) && member(KPI_ACTUAL_SOURCES, input.actualSource) && member(KPI_ALLOCATION_MODES, input.allocationMode) && member(KPI_ACTUAL_CAPTURE_MODES, input.actualCaptureMode) && member(KPI_ACTUAL_REVIEW_MODES, input.actualReviewMode) && member(KPI_ACTUAL_EVIDENCE_MODES, input.actualEvidenceMode);
  if (family === "ALLOCATION") return member(KPI_SUBJECT_TYPES, input.subjectType) && member(KPI_ALLOCATION_MODES, input.allocationMode);
  if (family === "ACTUAL") return member(KPI_ACTUAL_CAPTURE_MODES, input.captureMode) && member(KPI_ACTUAL_AGGREGATION_METHODS, input.aggregationMethod) && member(KPI_ACTUAL_REVIEW_MODES, input.reviewMode) && member(KPI_ACTUAL_EVIDENCE_MODES, input.evidenceMode);
  if (family === "SLOT_EXCUSE") return member(["EXCUSED", "NOT_REQUIRED"], status);
  return true;
}
function pairValid(family: KpiPersistedFamily, status: string | null, lifecycle: string | null): boolean {
  const pairs = KPI_PERSISTED_CONTRACT_MATRICES[family].allowedStatusLifecyclePairs;
  return pairs.length === 0 ? true : status !== null && lifecycle !== null && pairs.includes(`${status}:${lifecycle}`);
}
function contradictionsFor(family: KpiPersistedFamily, input: Readonly<Record<string, unknown>>, status: string | null, lifecycle: string | null, context: KpiPersistedEvaluationContext): string[] {
  const issues: string[] = [];
  if (family === "PLAN" && lifecycle === "DRAFT" && anyPresent(input, ["publishedAt", "publishedByActorId", "finalizedAt", "finalizedByActorId", "finalResult", "archivedAt", "archivedByActorId"])) issues.push("DRAFT_TERMINAL_EVIDENCE_PRESENT");
  if (family === "ALLOCATION" && lifecycle === "DRAFT" && anyPresent(input, ["approvedAt", "approvedByActorId", "publishedAt", "publishedByActorId"])) issues.push("DRAFT_TERMINAL_EVIDENCE_PRESENT");
  if (family === "ALLOCATION" && lifecycle === "SUPERSEDED" && context.successorExists === false) issues.push("MISSING_ALLOCATION_SUCCESSOR_LINK");
  if (family === "ALLOCATION" && lifecycle === "CORRECTED" && context.predecessorExists === false) issues.push("BROKEN_ALLOCATION_PREDECESSOR_LINK");
  if (family === "ACTUAL" && input.latestCorrectionId != null && context.latestCorrectionExists === false) issues.push("BROKEN_LATEST_CORRECTION_LINK");
  if (family === "ACTUAL" && context.metricPolicy && ["captureMode", "aggregationMethod", "reviewMode", "evidenceMode", "policyVersion"].some((field) => input[field] !== context.metricPolicy?.[field])) issues.push("ACTUAL_POLICY_SNAPSHOT_MISMATCH");
  if (family === "ACTUAL" && input.captureMode === "DERIVED" && (!Array.isArray(input.acceptedInputVersions) || input.acceptedInputVersions.length === 0)) issues.push("DERIVED_ACCEPTED_INPUT_LINEAGE_EMPTY");
  if (family === "CORRECTION" && ((input.requiresReview === true && lifecycle !== "UNDER_REVIEW") || (input.requiresReview === false && lifecycle !== "CORRECTED"))) issues.push("CORRECTION_REVIEW_LINEAGE_MISMATCH");
  if (family === "ALLOCATION_OPERATION" && ((input.result != null) !== (input.completedAt != null))) issues.push("OPERATION_RESULT_LIFECYCLE_MISMATCH");
  if (family === "SLOT_EXCUSE" && status !== "EXCUSED" && status !== "NOT_REQUIRED") issues.push("EXCUSE_STATUS_UNSUPPORTED");
  return issues;
}
function referencesFor(family: KpiPersistedFamily, input: Readonly<Record<string, unknown>>, context: KpiPersistedEvaluationContext): string[] {
  const invalid = context.parentReferencesValid ? [] : ["PARENT_OR_DEPENDENCY_REFERENCE"];
  if (family === "ALLOCATION_OPERATION" && !present(input, "kpiPlanId")) invalid.push("EXPLICIT_OPERATION_OWNER_REQUIRED");
  return invalid;
}
function policyComplete(family: KpiPersistedFamily, input: Readonly<Record<string, unknown>>, context: KpiPersistedEvaluationContext): boolean {
  if (family === "METRIC") return input.actualPolicyVersion != null && (context.planPolicyVersion == null || input.actualPolicyVersion === context.planPolicyVersion);
  if (family === "ACTUAL") return ["captureMode", "aggregationMethod", "reviewMode", "evidenceMode", "policyVersion"].every((field) => present(input, field));
  return true;
}
function readText(value: unknown): string | null { return typeof value === "string" ? value : null; }
function present(input: Readonly<Record<string, unknown>>, field: string): boolean { return Object.prototype.hasOwnProperty.call(input, field) && input[field] !== null && input[field] !== undefined; }
function missing(input: Readonly<Record<string, unknown>>, fields: readonly string[]): string[] { return fields.filter((field) => !present(input, field)); }
function anyPresent(input: Readonly<Record<string, unknown>>, fields: readonly string[]): boolean { return fields.some((field) => present(input, field)); }
function frozen<T>(values: readonly T[]): readonly T[] { return Object.freeze([...new Set(values)]); }
function sorted(values: readonly string[]): readonly string[] { return Object.freeze([...new Set(values)].sort()); }
function freezeRecord(value: Readonly<Record<string, readonly string[]>>): Readonly<Record<string, readonly string[]>> { return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, fields]) => [key, frozen(fields)]))); }
