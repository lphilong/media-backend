import assert from "node:assert/strict";
import test from "node:test";
import { plannedAction, stableFingerprint, type PlannedMigrationAction } from "./migration-program";
import {
  RISK001_DEPENDENCY_EDGES,
  resolveRisk001Dependencies,
  type Risk001DependencyEdge,
  type Risk001DependencyRecord,
} from "./risk-001-dependency-resolution";
import type { Risk001AssessmentAreaId } from "./risk-001-completed-run-contract";

function action(id: string, blocked: boolean): PlannedMigrationAction {
  return plannedAction({
    migrationId: id, migrationVersion: 1, recordClass: "TEST", sanitizedRecordIdentity: `TEST:${id}`,
    currentStateSummary: {}, proposedAction: blocked ? "MANUAL_REVIEW" : "NONE", preconditions: [], dependencyChecks: [],
    expectedEffect: "assessment", reasonCode: blocked ? "INVALID_SOURCE" : "EXACT_MATCH",
    classification: blocked ? "AMBIGUOUS_MANUAL_REVIEW" : "NO_MIGRATION_REQUIRED", requiredApproval: blocked ? "OWNER" : "NONE",
    sourceRemovalDependency: "NONE", before: {}, plannedAfter: {},
  });
}

function record(areaId: Risk001AssessmentAreaId, id: string, keys: Readonly<Record<string, readonly string[]>>, blocked: boolean): Risk001DependencyRecord {
  const local = action(id, blocked);
  return { areaId, sourceRecordId: id, sanitizedRecordId: `${areaId}:${id}`, relationKeys: keys, action: { ...local, migrationId: areaId, sanitizedRecordIdentity: `${areaId}:${id}` } };
}

function sevenEdgeFixture(): readonly Risk001DependencyRecord[] {
  return [
    record("RISK001_ROLE_DRIFT", "role", { roleId: ["role"] }, true),
    record("RISK001_LEGACY_ROLE_RETIREMENT", "legacy", { roleId: ["role"] }, true),
    record("RISK001_BUNDLE_CONSISTENCY", "bundle", { relatedRoleIds: ["role"] }, false),
    record("RISK001_SCOPE_FINGERPRINT", "scope", { roleId: ["role"], assignmentId: ["assignment"] }, true),
    record("RISK001_ACCOUNT_CONTEXT_READINESS", "account", { activeRoleIds: ["role"], userId: ["user"] }, true),
    record("RISK001_TALENT_IDENTITY_READINESS", "talent", { linkedUserId: ["user"], talentId: ["talent"] }, true),
    record("RISK001_COARSE_KPI_SCOPE", "coarse", { assignmentId: ["assignment"] }, true),
    record("RISK001_STALE_KPI_DATA", "stale", { relatedTalentIds: ["talent"] }, false),
  ];
}

test("RISK-001 dependency stage propagates all seven record-level edges and keeps Edge 07 advisory-only", () => {
  const result = resolveRisk001Dependencies(sevenEdgeFixture());
  assert.equal(result.propagatedBlockers.length, 7);
  assert.equal(result.totals.propagatedBlockerCount, 7);
  assert.equal(result.relatedAreaAdvisories.length, 1);
  assert.equal(result.relatedAreaAdvisories[0]?.downstreamBinding, "NONE_AVAILABLE");
  const stale = result.assessmentStates.find((item) => item.areaId === "RISK001_STALE_KPI_DATA");
  assert.equal(stale?.propagatedBlockers.some((item) => item.edgeId === "R001-EDGE-07"), false);
  assert.equal(stale?.effectiveReadiness, "BLOCKED");
  assert.equal(stale?.candidateEffectiveState, "NOT_APPLICABLE");
  assert.equal(result.propagatedBlockers.every((item) => item.directOrTransitive === "DIRECT" && item.propagationPath.length === 1), true);
});

test("RISK-001 dependency stage is order independent and fails closed for binding and cycle defects", () => {
  const first = resolveRisk001Dependencies(sevenEdgeFixture());
  const second = resolveRisk001Dependencies([...sevenEdgeFixture()].reverse());
  assert.equal(stableFingerprint(first), stableFingerprint(second));
  const missing = sevenEdgeFixture().map((item) => item.areaId === "RISK001_ROLE_DRIFT" ? { ...item, relationKeys: { roleId: [] } } : item);
  const unresolved = resolveRisk001Dependencies(missing);
  assert.equal(unresolved.unresolvedBindings.some((item) => item.edgeId === "R001-EDGE-01"), true);
  const role = unresolved.assessmentStates.find((item) => item.areaId === "RISK001_ROLE_DRIFT");
  assert.equal(role?.effectiveReadiness, "BLOCKED");
  const cyclic: Risk001DependencyEdge[] = RISK001_DEPENDENCY_EDGES.map((item) => item.edgeId === "R001-EDGE-08" ? { ...item, downstreamArea: "RISK001_ROLE_DRIFT" } : item);
  assert.throws(() => resolveRisk001Dependencies(sevenEdgeFixture(), cyclic), /cycle/u);
});
