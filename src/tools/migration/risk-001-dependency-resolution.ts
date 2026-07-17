import type { MigrationClassification, PlannedMigrationAction } from "./migration-program";
import type { Risk001AssessmentAreaId } from "./risk-001-completed-run-contract";

export const RISK001_DEPENDENCY_CONTRACT_VERSION =
  "risk-001-dependency-contract/v3-7-propagating-1-advisory";

export type Risk001PropagationMode = "RECORD_LEVEL" | "ADVISORY_ONLY";

export interface Risk001DependencyEdge {
  readonly edgeId: string;
  readonly upstreamArea: Risk001AssessmentAreaId;
  readonly downstreamArea: Risk001AssessmentAreaId;
  readonly upstreamKey: string | null;
  readonly downstreamKey: string | null;
  readonly propagationMode: Risk001PropagationMode;
  readonly transitiveAllowed: false;
  readonly areaWide: false;
}

export const RISK001_DEPENDENCY_EDGES: readonly Risk001DependencyEdge[] = Object.freeze([
  { edgeId: "R001-EDGE-01", upstreamArea: "RISK001_ROLE_DRIFT", downstreamArea: "RISK001_LEGACY_ROLE_RETIREMENT", upstreamKey: "roleId", downstreamKey: "roleId", propagationMode: "RECORD_LEVEL", transitiveAllowed: false, areaWide: false },
  { edgeId: "R001-EDGE-02", upstreamArea: "RISK001_LEGACY_ROLE_RETIREMENT", downstreamArea: "RISK001_BUNDLE_CONSISTENCY", upstreamKey: "roleId", downstreamKey: "relatedRoleIds", propagationMode: "RECORD_LEVEL", transitiveAllowed: false, areaWide: false },
  { edgeId: "R001-EDGE-03", upstreamArea: "RISK001_ROLE_DRIFT", downstreamArea: "RISK001_SCOPE_FINGERPRINT", upstreamKey: "roleId", downstreamKey: "roleId", propagationMode: "RECORD_LEVEL", transitiveAllowed: false, areaWide: false },
  { edgeId: "R001-EDGE-04", upstreamArea: "RISK001_ROLE_DRIFT", downstreamArea: "RISK001_ACCOUNT_CONTEXT_READINESS", upstreamKey: "roleId", downstreamKey: "activeRoleIds", propagationMode: "RECORD_LEVEL", transitiveAllowed: false, areaWide: false },
  { edgeId: "R001-EDGE-05", upstreamArea: "RISK001_ACCOUNT_CONTEXT_READINESS", downstreamArea: "RISK001_TALENT_IDENTITY_READINESS", upstreamKey: "userId", downstreamKey: "linkedUserId", propagationMode: "RECORD_LEVEL", transitiveAllowed: false, areaWide: false },
  { edgeId: "R001-EDGE-06", upstreamArea: "RISK001_SCOPE_FINGERPRINT", downstreamArea: "RISK001_COARSE_KPI_SCOPE", upstreamKey: "assignmentId", downstreamKey: "assignmentId", propagationMode: "RECORD_LEVEL", transitiveAllowed: false, areaWide: false },
  { edgeId: "R001-EDGE-07", upstreamArea: "RISK001_COARSE_KPI_SCOPE", downstreamArea: "RISK001_STALE_KPI_DATA", upstreamKey: null, downstreamKey: null, propagationMode: "ADVISORY_ONLY", transitiveAllowed: false, areaWide: false },
  { edgeId: "R001-EDGE-08", upstreamArea: "RISK001_TALENT_IDENTITY_READINESS", downstreamArea: "RISK001_STALE_KPI_DATA", upstreamKey: "talentId", downstreamKey: "relatedTalentIds", propagationMode: "RECORD_LEVEL", transitiveAllowed: false, areaWide: false },
]);

export interface Risk001DependencyRecord {
  readonly areaId: Risk001AssessmentAreaId;
  /** Internal only; never included in completed-run output. */
  readonly sourceRecordId: string;
  readonly sanitizedRecordId: string;
  readonly relationKeys: Readonly<Record<string, readonly string[]>>;
  readonly action: PlannedMigrationAction;
}

export interface Risk001PropagatedBlocker {
  readonly edgeId: string;
  readonly upstreamArea: Risk001AssessmentAreaId;
  readonly upstreamRecordId: string;
  readonly upstreamBlockerId: string;
  readonly downstreamArea: Risk001AssessmentAreaId;
  readonly downstreamRecordId: string;
  readonly directOrTransitive: "DIRECT";
  readonly propagationPath: readonly string[];
  readonly reasonCode: string;
}

export interface Risk001RelatedAreaAdvisory {
  readonly edgeId: "R001-EDGE-07";
  readonly upstreamArea: "RISK001_COARSE_KPI_SCOPE";
  readonly upstreamRecordId: string;
  readonly upstreamReasonCode: string;
  readonly downstreamArea: "RISK001_STALE_KPI_DATA";
  readonly propagationMode: "ADVISORY_ONLY";
  readonly downstreamBinding: "NONE_AVAILABLE";
  readonly advisoryCode: "RELATED_AREA_BLOCKER_REQUIRES_REVIEW";
  readonly humanReviewRecommended: true;
  readonly semanticExplanation: "Coarse KPI scope dependency is advisory-only; no record-level binding is available.";
}

export interface Risk001UnresolvedDependencyBinding {
  readonly edgeId: string;
  readonly upstreamArea: Risk001AssessmentAreaId;
  readonly upstreamRecordId: string;
  readonly downstreamArea: Risk001AssessmentAreaId;
  readonly expectedRelationKey: string;
  readonly reasonCode: "UNRESOLVED_DEPENDENCY_BINDING";
}

export interface Risk001EffectiveAssessmentState {
  readonly areaId: Risk001AssessmentAreaId;
  readonly recordId: string;
  readonly localClassification: MigrationClassification;
  readonly localReadiness: "READY" | "BLOCKED";
  readonly localRecommendation: string;
  readonly localBlockers: readonly string[];
  readonly propagatedBlockers: readonly Risk001PropagatedBlocker[];
  readonly effectiveBlockers: readonly (string | Risk001PropagatedBlocker)[];
  readonly effectiveReadiness: "READY" | "BLOCKED";
  readonly effectiveRecommendation: string;
  readonly manualReview: "NOT_REQUIRED" | "REQUIRED";
  readonly candidatePresent: boolean;
  readonly candidateEffectiveState: "NOT_APPLICABLE" | "READY" | "BLOCKED";
  readonly executable: false;
  readonly relatedAreaAdvisories: readonly Risk001RelatedAreaAdvisory[];
}

export interface Risk001DependencyResolution {
  readonly edgeMatrixIdentity: string;
  readonly declaredEdgeCount: 8;
  readonly propagatingEdgeCount: 7;
  readonly advisoryOnlyEdgeCount: 1;
  readonly assessmentStates: readonly Risk001EffectiveAssessmentState[];
  readonly propagatedBlockers: readonly Risk001PropagatedBlocker[];
  readonly unresolvedBindings: readonly Risk001UnresolvedDependencyBinding[];
  readonly relatedAreaAdvisories: readonly Risk001RelatedAreaAdvisory[];
  readonly totals: {
    readonly localBlockerCount: number;
    readonly propagatedBlockerCount: number;
    readonly effectiveBlockerCount: number;
    readonly directBlockerCount: number;
    readonly transitiveBlockerCount: 0;
    readonly unresolvedBindingCount: number;
    readonly effectiveBlockedAssessmentCount: number;
    readonly blockedCandidateCount: number;
    readonly relatedAreaAdvisoryCount: number;
  };
}

const BLOCKING_CLASSES = new Set<MigrationClassification>([
  "AMBIGUOUS_MANUAL_REVIEW",
  "UNMIGRATABLE_WITHOUT_OWNER_DECISION",
  "HISTORICAL_UNKNOWN_PRESERVE_AS_UNKNOWN",
]);

export function resolveRisk001Dependencies(
  records: readonly Risk001DependencyRecord[],
  edges: readonly Risk001DependencyEdge[] = RISK001_DEPENDENCY_EDGES,
): Risk001DependencyResolution {
  assertDependencyContract(edges);
  const ordered = [...records].sort(recordOrder);
  const mutable = new Map<string, MutableState>();
  for (const record of ordered) mutable.set(recordKey(record), createMutableState(record));
  const unresolved: Risk001UnresolvedDependencyBinding[] = [];
  const advisories: Risk001RelatedAreaAdvisory[] = [];

  for (const edge of edges) {
    const upstream = ordered.filter((record) => record.areaId === edge.upstreamArea && isBlocking(record.action));
    if (edge.propagationMode === "ADVISORY_ONLY") {
      for (const record of upstream) advisories.push(createAdvisory(record));
      continue;
    }
    const downstream = ordered.filter((record) => record.areaId === edge.downstreamArea);
    const missingDownstreamKeys = downstream.filter((target) => relationValues(target, edge.downstreamKey).length === 0);
    for (const source of upstream) {
      const sourceKeys = relationValues(source, edge.upstreamKey);
      if (sourceKeys.length === 0) {
        addUnresolved(unresolved, edge, source);
        markBindingFailure(mutable, source);
        continue;
      }
      for (const target of missingDownstreamKeys) {
        addUnresolved(unresolved, edge, target, source);
        markBindingFailure(mutable, target);
      }
      const matches = downstream.filter((target) => intersects(sourceKeys, relationValues(target, edge.downstreamKey)));
      if (matches.length === 0) {
        addUnresolved(unresolved, edge, source);
        continue;
      }
      for (const target of matches) {
        mutable.get(recordKey(target))?.propagated.push(createBlocker(edge, source, target));
      }
    }
  }
  const canonicalAdvisories = uniqueSorted(advisories, advisoryKey);
  const canonicalUnresolved = uniqueSorted(unresolved, unresolvedKey);
  const states = ordered.map((record) => finalizeState(mutable.get(recordKey(record))!, canonicalAdvisories));
  const propagated = uniqueSorted(states.flatMap((state) => state.propagatedBlockers), blockerKey);
  const localBlockerCount = states.reduce((total, state) => total + state.localBlockers.length, 0);
  const effectiveBlockerCount = states.reduce((total, state) => total + state.effectiveBlockers.length, 0);
  return Object.freeze({
    edgeMatrixIdentity: dependencyMatrixIdentity(edges),
    declaredEdgeCount: 8,
    propagatingEdgeCount: 7,
    advisoryOnlyEdgeCount: 1,
    assessmentStates: Object.freeze(states),
    propagatedBlockers: Object.freeze(propagated),
    unresolvedBindings: Object.freeze(canonicalUnresolved),
    relatedAreaAdvisories: Object.freeze(canonicalAdvisories),
    totals: Object.freeze({
      localBlockerCount,
      propagatedBlockerCount: propagated.length,
      effectiveBlockerCount,
      directBlockerCount: propagated.length,
      transitiveBlockerCount: 0,
      unresolvedBindingCount: canonicalUnresolved.length,
      effectiveBlockedAssessmentCount: states.filter((state) => state.effectiveReadiness === "BLOCKED").length,
      blockedCandidateCount: states.filter((state) => state.candidateEffectiveState === "BLOCKED").length,
      relatedAreaAdvisoryCount: canonicalAdvisories.length,
    }),
  });
}

interface MutableState { readonly record: Risk001DependencyRecord; readonly localBlockers: string[]; readonly propagated: Risk001PropagatedBlocker[]; bindingFailure: boolean; }

function createMutableState(record: Risk001DependencyRecord): MutableState {
  return { record, localBlockers: isBlocking(record.action) ? [record.action.reasonCode] : [], propagated: [], bindingFailure: false };
}

function finalizeState(state: MutableState, advisories: readonly Risk001RelatedAreaAdvisory[]): Risk001EffectiveAssessmentState {
  const propagated = uniqueSorted(state.propagated, blockerKey);
  const localBlocked = state.localBlockers.length > 0 || state.bindingFailure;
  const effectiveBlocked = localBlocked || propagated.length > 0;
  const candidatePresent = state.record.action.proposedAction !== "NONE";
  return Object.freeze({
    areaId: state.record.areaId,
    recordId: state.record.sanitizedRecordId,
    localClassification: state.record.action.classification,
    localReadiness: localBlocked ? "BLOCKED" : "READY",
    localRecommendation: state.record.action.proposedAction,
    localBlockers: Object.freeze([...state.localBlockers].sort()),
    propagatedBlockers: Object.freeze(propagated),
    effectiveBlockers: Object.freeze([...state.localBlockers, ...propagated]),
    effectiveReadiness: effectiveBlocked ? "BLOCKED" : "READY",
    effectiveRecommendation: propagated.length > 0 || state.bindingFailure ? "BLOCKED" : state.record.action.proposedAction,
    manualReview: effectiveBlocked ? "REQUIRED" : "NOT_REQUIRED",
    candidatePresent,
    candidateEffectiveState: candidatePresent ? effectiveBlocked ? "BLOCKED" : "READY" : "NOT_APPLICABLE",
    executable: false,
    relatedAreaAdvisories: Object.freeze(advisories.filter((item) => item.upstreamRecordId === state.record.sanitizedRecordId)),
  });
}

function createBlocker(edge: Risk001DependencyEdge, source: Risk001DependencyRecord, target: Risk001DependencyRecord): Risk001PropagatedBlocker {
  return Object.freeze({ edgeId: edge.edgeId, upstreamArea: source.areaId, upstreamRecordId: source.sanitizedRecordId, upstreamBlockerId: `${source.sanitizedRecordId}:${source.action.reasonCode}`, downstreamArea: target.areaId, downstreamRecordId: target.sanitizedRecordId, directOrTransitive: "DIRECT", propagationPath: Object.freeze([edge.edgeId]), reasonCode: source.action.reasonCode });
}

function createAdvisory(record: Risk001DependencyRecord): Risk001RelatedAreaAdvisory {
  return Object.freeze({ edgeId: "R001-EDGE-07", upstreamArea: "RISK001_COARSE_KPI_SCOPE", upstreamRecordId: record.sanitizedRecordId, upstreamReasonCode: record.action.reasonCode, downstreamArea: "RISK001_STALE_KPI_DATA", propagationMode: "ADVISORY_ONLY", downstreamBinding: "NONE_AVAILABLE", advisoryCode: "RELATED_AREA_BLOCKER_REQUIRES_REVIEW", humanReviewRecommended: true, semanticExplanation: "Coarse KPI scope dependency is advisory-only; no record-level binding is available." });
}

function addUnresolved(result: Risk001UnresolvedDependencyBinding[], edge: Risk001DependencyEdge, target: Risk001DependencyRecord, source?: Risk001DependencyRecord): void {
  result.push(Object.freeze({ edgeId: edge.edgeId, upstreamArea: source?.areaId ?? target.areaId, upstreamRecordId: source?.sanitizedRecordId ?? target.sanitizedRecordId, downstreamArea: edge.downstreamArea, expectedRelationKey: edge.downstreamKey ?? edge.upstreamKey ?? "NONE", reasonCode: "UNRESOLVED_DEPENDENCY_BINDING" }));
}

function markBindingFailure(states: Map<string, MutableState>, record: Risk001DependencyRecord): void { const state = states.get(recordKey(record)); if (state) state.bindingFailure = true; }
function relationValues(record: Risk001DependencyRecord, key: string | null): readonly string[] { return key ? (record.relationKeys[key] ?? []).filter(nonBlank).sort() : []; }
function isBlocking(action: PlannedMigrationAction): boolean { return BLOCKING_CLASSES.has(action.classification); }
function intersects(left: readonly string[], right: readonly string[]): boolean { const values = new Set(left); return right.some((value) => values.has(value)); }
function nonBlank(value: string): boolean { return value.trim().length > 0; }
function recordKey(record: Risk001DependencyRecord): string { return `${record.areaId}|${record.sourceRecordId}`; }
function recordOrder(left: Risk001DependencyRecord, right: Risk001DependencyRecord): number { return recordKey(left).localeCompare(recordKey(right)); }
function blockerKey(value: Risk001PropagatedBlocker): string { return [value.upstreamArea, value.upstreamRecordId, value.upstreamBlockerId, value.edgeId, value.downstreamArea, value.downstreamRecordId, value.reasonCode].join("|"); }
function advisoryKey(value: Risk001RelatedAreaAdvisory): string { return [value.edgeId, value.upstreamRecordId, value.upstreamReasonCode, value.propagationMode].join("|"); }
function unresolvedKey(value: Risk001UnresolvedDependencyBinding): string { return [value.edgeId, value.upstreamRecordId, value.downstreamArea, value.expectedRelationKey].join("|"); }
function uniqueSorted<T>(values: readonly T[], key: (value: T) => string): T[] { const map = new Map<string, T>(); for (const value of values) map.set(key(value), value); return [...map.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, value]) => value); }

export function dependencyMatrixIdentity(edges: readonly Risk001DependencyEdge[] = RISK001_DEPENDENCY_EDGES): string { return edges.map((edge) => [edge.edgeId, edge.upstreamArea, edge.downstreamArea, edge.propagationMode, edge.upstreamKey ?? "NONE", edge.downstreamKey ?? "NONE"].join(":")) .sort().join("|"); }

function assertDependencyContract(edges: readonly Risk001DependencyEdge[]): void {
  if (edges.length !== 8 || new Set(edges.map((edge) => edge.edgeId)).size !== 8) throw new Error("Invalid RISK-001 dependency edge matrix");
  const propagating = edges.filter((edge) => edge.propagationMode === "RECORD_LEVEL");
  const advisory = edges.filter((edge) => edge.propagationMode === "ADVISORY_ONLY");
  if (propagating.length !== 7 || advisory.length !== 1 || advisory[0]?.edgeId !== "R001-EDGE-07" || advisory[0].upstreamKey !== null || advisory[0].downstreamKey !== null) throw new Error("Invalid RISK-001 advisory dependency contract");
  const adjacency = new Map<Risk001AssessmentAreaId, Risk001AssessmentAreaId[]>();
  for (const edge of propagating) adjacency.set(edge.upstreamArea, [...(adjacency.get(edge.upstreamArea) ?? []), edge.downstreamArea]);
  const visiting = new Set<Risk001AssessmentAreaId>(); const visited = new Set<Risk001AssessmentAreaId>();
  const visit = (area: Risk001AssessmentAreaId): void => { if (visiting.has(area)) throw new Error(`RISK-001 propagation cycle: ${area}`); if (visited.has(area)) return; visiting.add(area); for (const next of adjacency.get(area) ?? []) visit(next); visiting.delete(area); visited.add(area); };
  for (const area of adjacency.keys()) visit(area);
}
