import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertSafeCoverageArtifactOutput,
  createRisk001CallbackDirectnessBaselineV2,
  createRisk001CallbackDirectnessBaselineV3,
  createRisk001CallbackDirectnessBaselineV4,
  createRisk001CallbackDirectnessBaselineV5,
  createRisk001CallbackDirectnessBaselineV6,
  generateRisk001CoverageArtifacts,
  parseCoverageArtifactArgs,
  risk001TargetBaselineSemanticPayloadSha256,
  validateRisk001RoleInactiveCounterfactualEvidence,
  validateRisk001CallbackDirectnessBaselineV4,
  validateRisk001CallbackDirectnessBaselineV5,
  validateRisk001CallbackDirectnessBaselineV6,
} from "./risk-001-contract-coverage-artifacts";
import {
  RISK_001_EXECUTABLE_CASES,
  validateRisk001CoverageTargetMetadata,
} from "./risk-001-contract-coverage.registry";

test("RISK-001 coverage artifact generator requires a bounded explicit output directory", async () => {
  assert.throws(() => parseCoverageArtifactArgs([]), /--output-dir/u);
  await assert.rejects(() => assertSafeCoverageArtifactOutput("D:/media/backend/evidence"), /outside backend/u);
  await assert.rejects(() => assertSafeCoverageArtifactOutput("D:/media/.codex-repair/risk-001-coverage-evidence-completion-v2"), /protected/u);
});

test("RISK-001 coverage artifact generator renders only explicit task-local evidence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "risk-001-artifacts-"));
  const output = path.join(root, "output");
  try {
    await generateRisk001CoverageArtifacts(output);
    const files = (await fs.readdir(output)).sort();
    assert.deepEqual(files, ["CELL_INVENTORY.md", "CONTRACT_TEST_LEDGER.md", "FINAL_REPORT.md", "STATE.md"]);
    const inventory = await fs.readFile(path.join(output, "CELL_INVENTORY.md"), "utf8");
    const ledger = await fs.readFile(path.join(output, "CONTRACT_TEST_LEDGER.md"), "utf8");
    assert.equal(inventory.split("\n").filter((line) => line.startsWith("| CELL-")).length, 299);
    assert.equal(ledger.split("\n").filter((line) => line.startsWith("| CELL-")).length, 299);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("RISK-001 callback target metadata resolves all 299 exact production targets", () => {
  assert.deepEqual(validateRisk001CoverageTargetMetadata(), {
    descriptors: 299,
    validPrimaryTargets: 299,
    invalidPrimaryTargets: 0,
    unresolvedTargets: 0,
    invalidPathSymbolPairs: 0,
    categoryLabelTargets: 0,
    invalidProductionPathHops: 0,
    invalidProductionUseEvidence: 0,
    duplicateCellIds: 0,
    duplicateCaseIds: 0,
  });
  const invalid = [{ ...RISK_001_EXECUTABLE_CASES[0]!, targetMetadata: { ...RISK_001_EXECUTABLE_CASES[0]!.targetMetadata, primaryTarget: { ...RISK_001_EXECUTABLE_CASES[0]!.targetMetadata.primaryTarget, symbol: "MISSING_TARGET" } } }];
  assert.throws(() => validateRisk001CoverageTargetMetadata(invalid), /exact callback descriptor denominator|all primary targets/u);
});

test("RISK-001 corrected target baseline is canonical, deterministic, and source-sensitive", () => {
  const first = createRisk001CallbackDirectnessBaselineV2();
  const second = createRisk001CallbackDirectnessBaselineV2();
  const reordered = createRisk001CallbackDirectnessBaselineV2([...RISK_001_EXECUTABLE_CASES].reverse());
  const displayOnlyChanged = createRisk001CallbackDirectnessBaselineV2(RISK_001_EXECUTABLE_CASES.map((coverageCase) => ({ ...coverageCase, expectedBehavior: `${coverageCase.expectedBehavior} (display only)` })));
  assert.equal(first.records.length, 299);
  assert.equal(first.semanticPayloadSha256, second.semanticPayloadSha256);
  assert.equal(first.semanticPayloadSha256, reordered.semanticPayloadSha256);
  assert.equal(first.semanticPayloadSha256, displayOnlyChanged.semanticPayloadSha256);
  assert.equal(first.semanticPayloadSha256, risk001TargetBaselineSemanticPayloadSha256(first));
  const changed = { ...first, records: first.records.map((record, index) => index === 0 ? { ...record, primaryTarget: { ...(record.primaryTarget as Record<string, unknown>), symbol: "ChangedTarget" } } : record) };
  assert.notEqual(first.semanticPayloadSha256, risk001TargetBaselineSemanticPayloadSha256(changed));
});

test("RISK-001 V3 Role-inactive counterfactual baseline is deterministic and requires both production-backed fixtures", () => {
  const first = createRisk001CallbackDirectnessBaselineV3();
  const second = createRisk001CallbackDirectnessBaselineV3();
  const reordered = createRisk001CallbackDirectnessBaselineV3([...RISK_001_EXECUTABLE_CASES].reverse());
  const displayOnlyChanged = createRisk001CallbackDirectnessBaselineV3(RISK_001_EXECUTABLE_CASES.map((coverageCase) => ({ ...coverageCase, expectedBehavior: `${coverageCase.expectedBehavior} (display only)` })));
  assert.equal(first.canonicalizationVersion, "RISK001-CALLBACK-TARGET-V2");
  assert.equal(first.records.length, 299);
  assert.equal(first.semanticPayloadSha256, second.semanticPayloadSha256);
  assert.equal(first.semanticPayloadSha256, reordered.semanticPayloadSha256);
  assert.equal(first.semanticPayloadSha256, displayOnlyChanged.semanticPayloadSha256);
  const roleInactive = first.records.find((record) => record.caseId === "ROLE-INACTIVE")!;
  const evidence = roleInactive.counterfactualEvidence as { readonly fixtures: readonly { readonly id: string; readonly loaderInvocations: number; readonly plannerInvocations: number; readonly preclassifiedPlannerInputCount: number; }[] };
  assert.deepEqual(evidence.fixtures.map((fixture) => fixture.id), ["inactive", "active-exact"]);
  assert.equal(evidence.fixtures.every((fixture) => fixture.loaderInvocations === 1 && fixture.plannerInvocations === 1 && fixture.preclassifiedPlannerInputCount === 0), true);
  const evidenceChanged = { ...first, records: first.records.map((record) => record.caseId === "ROLE-INACTIVE" ? { ...record, counterfactualEvidence: { ...(record.counterfactualEvidence as Record<string, unknown>), semanticDiscrimination: { fields: ["reasonCode"], asserted: true } } } : record) };
  assert.notEqual(first.semanticPayloadSha256, risk001TargetBaselineSemanticPayloadSha256(evidenceChanged));
  const missingEvidence = { ...first, records: first.records.map((record) => record.caseId === "ROLE-INACTIVE" ? Object.fromEntries(Object.entries(record).filter(([key]) => key !== "counterfactualEvidence")) : record) };
  assert.throws(() => validateRisk001RoleInactiveCounterfactualEvidence(missingEvidence as typeof first), /requires inactive and active-exact/u);
});

test("RISK-001 V4 baseline records every callback's declared-stage execution evidence", () => {
  const first = createRisk001CallbackDirectnessBaselineV4();
  const second = createRisk001CallbackDirectnessBaselineV4();
  const reordered = createRisk001CallbackDirectnessBaselineV4([...RISK_001_EXECUTABLE_CASES].reverse());
  assert.equal(first.records.length, 299);
  assert.deepEqual(first.counts, { callbacks: 299, cells: 299, cases: 299, contracts: 63, invariants: 82, exactTargets: 299, invalidTargets: 0, unresolvedTargets: 0, categoryLabelTargets: 0, invalidProductionPathHops: 0, invalidProductionUseEvidence: 0, direct: 299, indirect: 0, unresolved: 0, declaredStageBypasses: 0, preclassifiedPrimaryFixtures: 0, missingLocalCounterfactuals: 0 });
  assert.equal(first.semanticPayloadSha256, second.semanticPayloadSha256);
  assert.equal(first.semanticPayloadSha256, reordered.semanticPayloadSha256);
  const roleMatched = first.records.find((record) => record.caseId === "ROLE-MATCHED-CANONICAL")!;
  const evidence = roleMatched.declaredStageExecution as { readonly orderedStages: readonly string[]; readonly rawOrMinimallyAuthoritativeInput: boolean; readonly callbackLocalCounterfactual: { readonly executed: boolean; readonly semanticDistinctionAsserted: boolean } };
  assert.deepEqual(evidence.orderedStages, ["loadRoleDriftPlannerRecords", "roleDriftPlanner"]);
  assert.equal(evidence.rawOrMinimallyAuthoritativeInput, true);
  assert.deepEqual(evidence.callbackLocalCounterfactual, { executed: true, semanticDistinctionAsserted: true });
  const bypassed = { ...first, records: first.records.map((record) => record.caseId === "ROLE-MATCHED-CANONICAL" ? { ...record, declaredStageExecution: { ...(record.declaredStageExecution as Record<string, unknown>), orderedStages: ["roleDriftPlanner"] } } : record) };
  assert.throws(() => validateRisk001CallbackDirectnessBaselineV4(bypassed as typeof first), /declared-stage execution evidence/u);
});

test("RISK-001 V5 baseline records complete source-backed positive and adverse traversal", () => {
  const first = createRisk001CallbackDirectnessBaselineV5();
  const second = createRisk001CallbackDirectnessBaselineV5();
  const reordered = createRisk001CallbackDirectnessBaselineV5([...RISK_001_EXECUTABLE_CASES].reverse());
  assert.equal(first.records.length, 299);
  assert.equal(first.semanticPayloadSha256, second.semanticPayloadSha256);
  assert.equal(first.semanticPayloadSha256, reordered.semanticPayloadSha256);
  const talent = first.records.find((record) => record.caseId === "TALENT-INACTIVE")!;
  const adverse = talent.adverseTraversal as { readonly actualTraversal: readonly string[]; readonly targetInvocationCount: number };
  assert.deepEqual(adverse.actualTraversal, ["loadTalentIdentityPlannerRecords", "talentIdentityPlanner"]);
  assert.equal(adverse.targetInvocationCount, 1);
  const loaderOnly = { ...first, records: first.records.map((record) => record.caseId === "TALENT-INACTIVE" ? { ...record, adverseTraversal: { ...(record.adverseTraversal as Record<string, unknown>), actualTraversal: ["loadTalentIdentityPlannerRecords"] } } : record) };
  assert.throws(() => validateRisk001CallbackDirectnessBaselineV5(loaderOnly as typeof first), /complete positive and adverse/u);
  const preclassified = { ...first, records: first.records.map((record) => record.caseId === "TALENT-INACTIVE" ? { ...record, dimensionStatuses: { ...(record.dimensionStatuses as Record<string, unknown>), G: { status: "FAIL" } } } : record) };
  assert.throws(() => validateRisk001CallbackDirectnessBaselineV5(preclassified as typeof first), /matrix evidence/u);
});

test("RISK-001 V6 baseline is deterministic and fails closed for every directness-evidence mutation", () => {
  const first = createRisk001CallbackDirectnessBaselineV6();
  const second = createRisk001CallbackDirectnessBaselineV6();
  const reordered = createRisk001CallbackDirectnessBaselineV6([...RISK_001_EXECUTABLE_CASES].reverse());
  assert.equal(first.records.length, 299);
  assert.equal(first.semanticPayloadSha256, second.semanticPayloadSha256);
  assert.equal(first.semanticPayloadSha256, reordered.semanticPayloadSha256);
  const bundle = first.records.find((record) => record.caseId === "BUNDLE-MATCHED-CANONICAL")!;
  assert.equal(bundle.proofMode, "D1_MULTI_STAGE_BEHAVIOR");
  assert.deepEqual(bundle.positiveActualTraversal, ["loadBundleConsistencyPlannerRecords", "bundlePlanner"]);
  const mutate = (field: string, value: unknown) => ({ ...first, records: first.records.map((record, index) => index === 0 ? { ...record, [field]: value } : record) });
  for (const [field, value] of [["callbackIdentity", "drift"], ["proofMode", "D3_PRODUCTION_CONTRACT_SENSITIVITY"], ["positiveFixtureBoundary", "planner-shaped"], ["positiveActualTraversal", ["bundlePlanner"]], ["callbackLocalEvidence", { callbackLocal: false }], ["sourceHashes", {}], ["dimensionStatuses", {}], ["directnessStatus", "INDIRECT"]] as const) {
    assert.throws(() => validateRisk001CallbackDirectnessBaselineV6(mutate(field, value) as typeof first), /must reconcile/u);
  }
  const bundleOmission = { ...first, records: first.records.map((record) => record.caseId === "BUNDLE-MATCHED-CANONICAL" ? { ...record, positiveActualTraversal: ["bundlePlanner"] } : record) };
  assert.throws(() => validateRisk001CallbackDirectnessBaselineV6(bundleOmission as typeof first), /must reconcile/u);
});
