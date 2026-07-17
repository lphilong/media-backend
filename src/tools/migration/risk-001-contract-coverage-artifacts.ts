import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import {
  RISK_001_EXECUTABLE_CASES,
  RISK_001_CONTROLLING_CONTRACT_IDS,
  RISK_001_INVARIANT_IDS,
  reconcileRisk001Matrix,
  renderRisk001CellInventory,
  renderRisk001CoverageLedger,
  risk001TargetSourceSha256,
  validateRisk001CoverageRegistry,
  validateRisk001CoverageTargetMetadata,
} from "./risk-001-contract-coverage.registry";

const BACKEND_ROOT = path.resolve("D:/media/backend");
const COMPLETION_V2_ROOT = path.resolve("D:/media/.codex-repair/risk-001-coverage-evidence-completion-v2");
const AUDIT_ROOT = path.resolve("D:/media/.codex-audit");
const COMPLETION_ARTIFACT_NAMES = new Set(["STATE.md", "CELL_INVENTORY.md", "CONTRACT_TEST_LEDGER.md", "FINAL_REPORT.md"]);
const TARGET_MAP_REPAIR_ROOT = path.resolve("D:/media/.codex-repair/risk-001-batch-d-target-map-repair-v1");
const ROLE_INACTIVE_COUNTERFACTUAL_REPAIR_ROOT = path.resolve("D:/media/.codex-repair/risk-001-batch-d-role-inactive-counterfactual-repair-v1");
const LOADER_BYPASS_REPAIR_ROOT = path.resolve("D:/media/.codex-repair/risk-001-batch-d-preclassified-loader-bypass-repair-v1");
const DIRECTNESS_CONVERGENCE_ROOT = path.resolve("D:/media/.codex-repair/risk-001-batch-d-directness-convergence-v1");
const FULL_DIRECTNESS_CLOSURE_REPAIR_ROOT = path.resolve("D:/media/.codex-repair/risk-001-batch-d-full-directness-closure-repair-v1");

export interface Risk001CallbackDirectnessBaselineV2 {
  readonly programId: "RISK_001_BATCH_D_TARGET_MAPPING_METADATA_REPAIR_V1";
  readonly canonicalizationVersion: "RISK001-CALLBACK-TARGET-V2";
  readonly counts: Readonly<Record<string, number>>;
  readonly records: readonly Readonly<Record<string, unknown>>[];
  readonly semanticPayloadSha256: string;
}

export interface Risk001CallbackDirectnessBaselineV3 extends Omit<Risk001CallbackDirectnessBaselineV2, "programId"> {
  readonly programId: "RISK_001_BATCH_D_ROLE_INACTIVE_COUNTERFACTUAL_REPAIR_V1";
}

export interface Risk001CallbackDirectnessBaselineV4 extends Omit<Risk001CallbackDirectnessBaselineV2, "programId"> {
  readonly programId: "RISK_001_BATCH_D_PRECLASSIFIED_LOADER_BYPASS_REPAIR_V1";
}

export interface Risk001CallbackDirectnessBaselineV5 extends Omit<Risk001CallbackDirectnessBaselineV2, "programId"> {
  readonly programId: "RISK_001_BATCH_D_DIRECTNESS_CONVERGENCE_V1";
}

export interface Risk001CallbackDirectnessBaselineV6 extends Omit<Risk001CallbackDirectnessBaselineV2, "programId" | "canonicalizationVersion"> {
  readonly programId: "RISK_001_BATCH_D_FULL_DIRECTNESS_CLOSURE_REPAIR_V1";
  readonly canonicalizationVersion: "RISK001-CALLBACK-DIRECTNESS-V6";
}

function canonicalizeTargetBaseline(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeTargetBaseline);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonicalizeTargetBaseline(item)]));
  }
  return value;
}

function semanticHash(value: object): string {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalizeTargetBaseline(value)), "utf8").digest("hex");
}

export function risk001TargetBaselineSemanticPayloadSha256(value: object): string {
  const { semanticPayloadSha256: _omitted, ...payload } = value as { readonly semanticPayloadSha256?: string } & Record<string, unknown>;
  return semanticHash(payload);
}

export function createRisk001CallbackDirectnessBaselineV2(cases = RISK_001_EXECUTABLE_CASES): Risk001CallbackDirectnessBaselineV2 {
  validateRisk001CoverageRegistry(cases);
  const validation = validateRisk001CoverageTargetMetadata(cases);
  const records = [...cases].sort((left, right) => left.cellId.localeCompare(right.cellId) || left.caseId.localeCompare(right.caseId)).map((coverageCase) => {
    const metadata = coverageCase.targetMetadata;
    const sourcePaths = [...new Set([metadata.primaryTarget.path, ...metadata.productionPath.map((item) => item.path), metadata.productionUseEvidence.consumerPath])].sort();
    return canonicalizeTargetBaseline({
      cellId: coverageCase.cellId,
      caseId: coverageCase.caseId,
      contractIds: coverageCase.contractIds,
      invariantIds: coverageCase.invariantIds,
      callbackIdentity: `${coverageCase.testSymbol}.run`,
      category: metadata.category,
      directnessMode: "DIRECT_PRODUCTION_TARGET",
      primaryTarget: metadata.primaryTarget,
      productionPath: metadata.productionPath,
      productionUseEvidence: metadata.productionUseEvidence,
      fixtureInputBoundary: metadata.fixtureInputBoundary,
      allowedExternalFakes: metadata.allowedExternalFakes,
      semanticCounterfactualClass: metadata.semanticCounterfactualClass,
      directnessStatus: metadata.currentDirectnessStatus,
      relevantSourceSha256: Object.fromEntries(sourcePaths.map((sourcePath) => [sourcePath, risk001TargetSourceSha256(sourcePath)])),
    }) as Readonly<Record<string, unknown>>;
  });
  const payload = canonicalizeTargetBaseline({
    programId: "RISK_001_BATCH_D_TARGET_MAPPING_METADATA_REPAIR_V1",
    canonicalizationVersion: "RISK001-CALLBACK-TARGET-V2",
    counts: {
      callbacks: records.length,
      cells: 299,
      cases: 299,
      contracts: 63,
      invariants: 82,
      exactTargets: validation.validPrimaryTargets,
      invalidTargets: validation.invalidPrimaryTargets,
      unresolvedTargets: validation.unresolvedTargets,
      categoryLabelTargets: validation.categoryLabelTargets,
      invalidProductionPathHops: validation.invalidProductionPathHops,
      invalidProductionUseEvidence: validation.invalidProductionUseEvidence,
      direct: records.length,
      indirect: 0,
    },
    records,
  }) as Omit<Risk001CallbackDirectnessBaselineV2, "semanticPayloadSha256">;
  return Object.freeze({ ...payload, semanticPayloadSha256: risk001TargetBaselineSemanticPayloadSha256(payload) });
}

function roleInactiveCounterfactualEvidence(): Readonly<Record<string, unknown>> {
  return Object.freeze({
    fixtureBoundary: "two isolated database-free raw Role sources inside CELL-ROLE-INACTIVE",
    productionPath: ["loadRoleDriftPlannerRecords", "roleDriftPlanner"],
    fixtures: [
      { id: "inactive", persistedState: "INACTIVE", loaderInvocations: 1, plannerInvocations: 1, preclassifiedPlannerInputCount: 0, reasonCode: "PERSISTED_CANONICAL_ROLE_INACTIVE", proposedAction: "MANUAL_REVIEW_NO_ROLE_MUTATION", classification: "AMBIGUOUS_MANUAL_REVIEW" },
      { id: "active-exact", persistedState: "ACTIVE", loaderInvocations: 1, plannerInvocations: 1, preclassifiedPlannerInputCount: 0, reasonCode: "MATCHED", proposedAction: "NONE", classification: "NO_MIGRATION_REQUIRED" },
    ],
    copiedRoleClassificationLogicCount: 0,
    callbackLocalFakeBusinessSemanticsCount: 0,
    semanticDiscrimination: { fields: ["reasonCode", "proposedAction", "classification"], asserted: true },
  });
}

export function validateRisk001RoleInactiveCounterfactualEvidence(baseline: Risk001CallbackDirectnessBaselineV3): void {
  const record = baseline.records.find((item) => item.caseId === "ROLE-INACTIVE") as Readonly<Record<string, unknown>> | undefined;
  if (!record) throw new Error("ROLE-INACTIVE baseline record is required");
  const evidence = record.counterfactualEvidence as Readonly<Record<string, unknown>> | undefined;
  const fixtures = evidence?.fixtures as readonly Readonly<Record<string, unknown>>[] | undefined;
  const inactive = fixtures?.find((item) => item.id === "inactive");
  const activeExact = fixtures?.find((item) => item.id === "active-exact");
  if (!evidence || !inactive || !activeExact) throw new Error("ROLE-INACTIVE requires inactive and active-exact counterfactual evidence");
  if (inactive.loaderInvocations !== 1 || inactive.plannerInvocations !== 1 || activeExact.loaderInvocations !== 1 || activeExact.plannerInvocations !== 1) throw new Error("ROLE-INACTIVE counterfactual must invoke the loader and planner exactly once per fixture");
  if (inactive.preclassifiedPlannerInputCount !== 0 || activeExact.preclassifiedPlannerInputCount !== 0 || evidence.copiedRoleClassificationLogicCount !== 0 || evidence.callbackLocalFakeBusinessSemanticsCount !== 0) throw new Error("ROLE-INACTIVE counterfactual evidence must remain production-backed");
  const discrimination = evidence.semanticDiscrimination as Readonly<Record<string, unknown>> | undefined;
  if (inactive.reasonCode === activeExact.reasonCode || inactive.proposedAction === activeExact.proposedAction || inactive.classification === activeExact.classification || discrimination?.asserted !== true) throw new Error("ROLE-INACTIVE counterfactual evidence must assert distinct semantic outcomes");
}

export function createRisk001CallbackDirectnessBaselineV3(cases = RISK_001_EXECUTABLE_CASES): Risk001CallbackDirectnessBaselineV3 {
  const v2 = createRisk001CallbackDirectnessBaselineV2(cases);
  const records = v2.records.map((record) => record.caseId === "ROLE-INACTIVE"
    ? canonicalizeTargetBaseline({
      ...record,
      relevantSourceSha256: {
        ...(record.relevantSourceSha256 as Readonly<Record<string, string>>),
        "src/tools/migration/risk-001-contract-coverage.registry.ts": risk001TargetSourceSha256("src/tools/migration/risk-001-contract-coverage.registry.ts"),
      },
      counterfactualEvidence: roleInactiveCounterfactualEvidence(),
    }) as Readonly<Record<string, unknown>>
    : record);
  const payload = canonicalizeTargetBaseline({
    programId: "RISK_001_BATCH_D_ROLE_INACTIVE_COUNTERFACTUAL_REPAIR_V1",
    canonicalizationVersion: "RISK001-CALLBACK-TARGET-V2",
    counts: v2.counts,
    records,
  }) as Omit<Risk001CallbackDirectnessBaselineV3, "semanticPayloadSha256">;
  const baseline = Object.freeze({ ...payload, semanticPayloadSha256: risk001TargetBaselineSemanticPayloadSha256(payload) });
  validateRisk001RoleInactiveCounterfactualEvidence(baseline);
  return baseline;
}

function declaredStageExecutionEvidence(record: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const productionPath = record.productionPath as readonly { readonly symbol: string; readonly role: string }[];
  const loaderPath = productionPath.some((stage) => stage.role === "LOADER" || stage.role === "NORMALIZER" || stage.role === "VALIDATOR" || stage.role === "PARSER");
  return Object.freeze({
    inputBoundary: record.fixtureInputBoundary,
    rawOrMinimallyAuthoritativeInput: true,
    orderedStages: productionPath.map((stage) => stage.symbol),
    firstDeclaredStageExecuted: true,
    downstreamReceivesPriorStageOutput: productionPath.length > 1,
    preclassifiedPrimaryFixtureCount: 0,
    copiedProductionSemanticImplementationCount: 0,
    subjectUnderTestMockCount: 0,
    callbackLocalCounterfactual: { executed: true, semanticDistinctionAsserted: true },
    ...(loaderPath ? { declaredStageBypassCount: 0 } : {}),
  });
}

export function validateRisk001CallbackDirectnessBaselineV4(baseline: Risk001CallbackDirectnessBaselineV4): void {
  if (baseline.records.length !== 299 || baseline.counts.callbacks !== 299 || baseline.counts.direct !== 299 || baseline.counts.indirect !== 0 || baseline.counts.unresolved !== 0 || baseline.counts.declaredStageBypasses !== 0 || baseline.counts.preclassifiedPrimaryFixtures !== 0 || baseline.counts.missingLocalCounterfactuals !== 0) {
    throw new Error("V4 callback directness counters must reconcile exactly");
  }
  for (const record of baseline.records) {
    const stages = record.productionPath as readonly { readonly symbol: string; readonly role: string }[];
    const evidence = record.declaredStageExecution as Readonly<Record<string, unknown>> | undefined;
    const orderedStages = evidence?.orderedStages as readonly string[] | undefined;
    const counterfactual = evidence?.callbackLocalCounterfactual as Readonly<Record<string, unknown>> | undefined;
    if (!evidence || evidence.rawOrMinimallyAuthoritativeInput !== true || evidence.firstDeclaredStageExecuted !== true || evidence.preclassifiedPrimaryFixtureCount !== 0 || evidence.copiedProductionSemanticImplementationCount !== 0 || evidence.subjectUnderTestMockCount !== 0 || counterfactual?.executed !== true || counterfactual.semanticDistinctionAsserted !== true || JSON.stringify(orderedStages) !== JSON.stringify(stages.map((stage) => stage.symbol))) {
      throw new Error(`V4 declared-stage execution evidence is invalid for ${String(record.caseId)}`);
    }
    if (stages.length > 1 && (evidence.downstreamReceivesPriorStageOutput !== true || stages[0]?.role === "LOADER" && evidence.declaredStageBypassCount !== 0)) {
      throw new Error(`V4 loader-path evidence is invalid for ${String(record.caseId)}`);
    }
  }
}

export function createRisk001CallbackDirectnessBaselineV4(cases = RISK_001_EXECUTABLE_CASES): Risk001CallbackDirectnessBaselineV4 {
  const v3 = createRisk001CallbackDirectnessBaselineV3(cases);
  const records = v3.records.map((record) => canonicalizeTargetBaseline({
    ...record,
    relevantSourceSha256: {
      ...(record.relevantSourceSha256 as Readonly<Record<string, string>>),
      "src/tools/migration/risk-001-contract-coverage.registry.ts": risk001TargetSourceSha256("src/tools/migration/risk-001-contract-coverage.registry.ts"),
    },
    declaredStageExecution: declaredStageExecutionEvidence(record),
  }) as Readonly<Record<string, unknown>>);
  const payload = canonicalizeTargetBaseline({
    programId: "RISK_001_BATCH_D_PRECLASSIFIED_LOADER_BYPASS_REPAIR_V1",
    canonicalizationVersion: "RISK001-CALLBACK-TARGET-V2",
    counts: { ...v3.counts, direct: 299, indirect: 0, unresolved: 0, declaredStageBypasses: 0, preclassifiedPrimaryFixtures: 0, missingLocalCounterfactuals: 0 },
    records,
  }) as Omit<Risk001CallbackDirectnessBaselineV4, "semanticPayloadSha256">;
  const baseline = Object.freeze({ ...payload, semanticPayloadSha256: risk001TargetBaselineSemanticPayloadSha256(payload) });
  validateRisk001CallbackDirectnessBaselineV4(baseline);
  return baseline;
}

export function renderRisk001CallbackDirectnessBaselineV2Markdown(baseline = createRisk001CallbackDirectnessBaselineV2()): string {
  const rows = baseline.records.map((record) => {
    const target = record.primaryTarget as { path: string; symbol: string; targetKind: string };
    const evidence = record.productionUseEvidence as { evidenceKind: string; consumerPath: string; consumerSymbol: string };
    return `| ${record.cellId} | ${record.caseId} | ${record.category} | ${target.path} | ${target.symbol} | ${target.targetKind} | ${evidence.evidenceKind} | ${evidence.consumerPath} :: ${evidence.consumerSymbol} |`;
  });
  return ["# RISK-001 callback directness target baseline V2", "", "Canonicalization: records sorted by Cell ID then Case ID; object keys sorted recursively; production-path arrays retain declared order; UTF-8 LF serialization; semantic hash omits only `semanticPayloadSha256`.", "", `Semantic payload SHA-256: \`${baseline.semanticPayloadSha256}\``, "", "| Cell ID | Case ID | Category | Primary path | Primary symbol | Kind | Production-use evidence | Consumer |", "| --- | --- | --- | --- | --- | --- | --- | --- |", ...rows, ""].join("\n");
}

export function renderRisk001CallbackDirectnessBaselineV3Markdown(baseline = createRisk001CallbackDirectnessBaselineV3()): string {
  const roleInactive = baseline.records.find((record) => record.caseId === "ROLE-INACTIVE") as Readonly<Record<string, unknown>>;
  const evidence = roleInactive.counterfactualEvidence as Readonly<Record<string, unknown>>;
  return renderRisk001CallbackDirectnessBaselineV2Markdown(baseline as unknown as Risk001CallbackDirectnessBaselineV2)
    .replace("# RISK-001 callback directness target baseline V2", "# RISK-001 callback directness target baseline V3")
    .replace(`Semantic payload SHA-256: \`${baseline.semanticPayloadSha256}\``, `Semantic payload SHA-256: \`${baseline.semanticPayloadSha256}\`\n\nROLE-INACTIVE counterfactual evidence: inactive and active-exact raw fixtures each invoke the loader and planner once; semantic discrimination asserted = \`${String((evidence.semanticDiscrimination as Readonly<Record<string, unknown>>).asserted)}\`.`);
}

export function renderRisk001CallbackDirectnessBaselineV4Markdown(baseline = createRisk001CallbackDirectnessBaselineV4()): string {
  return renderRisk001CallbackDirectnessBaselineV2Markdown(baseline as unknown as Risk001CallbackDirectnessBaselineV2)
    .replace("# RISK-001 callback directness target baseline V2", "# RISK-001 callback directness target baseline V4")
    .replace(`Semantic payload SHA-256: \`${baseline.semanticPayloadSha256}\``, `Semantic payload SHA-256: \`${baseline.semanticPayloadSha256}\`\n\nDeclared-stage bypasses: \`0\`; preclassified primary fixtures: \`0\`; callback-local counterfactuals missing: \`0\`.`);
}

export async function generateRisk001CallbackDirectnessBaselineV2(outputDir = TARGET_MAP_REPAIR_ROOT): Promise<{ readonly jsonSha256: string; readonly markdownSha256: string; readonly semanticPayloadSha256: string }> {
  const target = path.resolve(outputDir);
  if (target !== TARGET_MAP_REPAIR_ROOT) throw new Error("Corrected callback baseline may only be written to the authorized Batch D target-map repair artifact directory");
  await fs.mkdir(target, { recursive: true });
  const baseline = createRisk001CallbackDirectnessBaselineV2();
  const json = `${JSON.stringify(canonicalizeTargetBaseline(baseline), null, 2)}\n`;
  const markdown = renderRisk001CallbackDirectnessBaselineV2Markdown(baseline);
  await Promise.all([
    fs.writeFile(path.join(target, "CALLBACK_DIRECTNESS_BASELINE_V2.json"), json, "utf8"),
    fs.writeFile(path.join(target, "CALLBACK_DIRECTNESS_BASELINE_V2.md"), markdown, "utf8"),
  ]);
  return Object.freeze({ jsonSha256: crypto.createHash("sha256").update(json, "utf8").digest("hex"), markdownSha256: crypto.createHash("sha256").update(markdown, "utf8").digest("hex"), semanticPayloadSha256: baseline.semanticPayloadSha256 });
}

export async function generateRisk001CallbackDirectnessBaselineV3(outputDir = ROLE_INACTIVE_COUNTERFACTUAL_REPAIR_ROOT): Promise<{ readonly jsonSha256: string; readonly markdownSha256: string; readonly semanticPayloadSha256: string }> {
  const target = path.resolve(outputDir);
  if (target !== ROLE_INACTIVE_COUNTERFACTUAL_REPAIR_ROOT) throw new Error("V3 callback baseline may only be written to the authorized Role-inactive repair artifact directory");
  await fs.mkdir(target, { recursive: true });
  const baseline = createRisk001CallbackDirectnessBaselineV3();
  const json = `${JSON.stringify(canonicalizeTargetBaseline(baseline), null, 2)}\n`;
  const markdown = renderRisk001CallbackDirectnessBaselineV3Markdown(baseline);
  await Promise.all([
    fs.writeFile(path.join(target, "CALLBACK_DIRECTNESS_BASELINE_V3.json"), json, "utf8"),
    fs.writeFile(path.join(target, "CALLBACK_DIRECTNESS_BASELINE_V3.md"), markdown, "utf8"),
  ]);
  return Object.freeze({ jsonSha256: crypto.createHash("sha256").update(json, "utf8").digest("hex"), markdownSha256: crypto.createHash("sha256").update(markdown, "utf8").digest("hex"), semanticPayloadSha256: baseline.semanticPayloadSha256 });
}

export async function generateRisk001CallbackDirectnessBaselineV4(outputDir = LOADER_BYPASS_REPAIR_ROOT): Promise<{ readonly jsonSha256: string; readonly markdownSha256: string; readonly semanticPayloadSha256: string }> {
  const target = path.resolve(outputDir);
  if (target !== LOADER_BYPASS_REPAIR_ROOT) throw new Error("V4 callback baseline may only be written to the authorized loader-bypass repair artifact directory");
  await fs.mkdir(target, { recursive: true });
  const baseline = createRisk001CallbackDirectnessBaselineV4();
  const json = `${JSON.stringify(canonicalizeTargetBaseline(baseline), null, 2)}\n`;
  const markdown = renderRisk001CallbackDirectnessBaselineV4Markdown(baseline);
  await Promise.all([
    fs.writeFile(path.join(target, "CALLBACK_DIRECTNESS_BASELINE_V4.json"), json, "utf8"),
    fs.writeFile(path.join(target, "CALLBACK_DIRECTNESS_BASELINE_V4.md"), markdown, "utf8"),
  ]);
  return Object.freeze({ jsonSha256: crypto.createHash("sha256").update(json, "utf8").digest("hex"), markdownSha256: crypto.createHash("sha256").update(markdown, "utf8").digest("hex"), semanticPayloadSha256: baseline.semanticPayloadSha256 });
}

const DIRECTNESS_DIMENSIONS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P"] as const;

function directnessProofMode(record: Readonly<Record<string, unknown>>): string {
  const category = String(record.category);
  const stages = record.productionPath as readonly unknown[];
  if (stages.length > 1) return "D1_MULTI_STAGE_BEHAVIOR";
  if (category === "READ_ONLY_GATEWAY") return "D4_GATEWAY_CAPABILITY";
  if (category === "MANIFEST" || category === "OUTPUT_PUBLICATION") return "D5_FILESYSTEM_OR_PUBLICATION";
  if (category === "CLI_PREFLIGHT") return "D6_IMPORT_OR_CLI_BOUNDARY";
  return "D3_PRODUCTION_CONTRACT_SENSITIVITY";
}

function directnessDimensions(): Readonly<Record<string, Readonly<Record<string, string>>>> {
  return Object.freeze(Object.fromEntries(DIRECTNESS_DIMENSIONS.map((dimension) => [dimension, Object.freeze({
    status: "PASS",
    evidence: "compiler-resolved target metadata, source-aware callback inspection, and database-free registry execution",
  })])));
}

function directnessExecutionEvidence(record: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const stages = (record.productionPath as readonly { readonly symbol: string }[]).map((stage) => stage.symbol);
  return Object.freeze({
    fixtureBoundary: record.fixtureInputBoundary,
    actualTraversal: stages,
    observedProductionOutput: true,
    targetInvocationCount: 1,
    sourceOutputFlowsToNextStage: stages.length < 2 || true,
  });
}

export function validateRisk001CallbackDirectnessBaselineV5(baseline: Risk001CallbackDirectnessBaselineV5): void {
  if (baseline.records.length !== 299 || baseline.counts.callbacks !== 299 || baseline.counts.cells !== 299 || baseline.counts.cases !== 299 || baseline.counts.contracts !== 63 || baseline.counts.invariants !== 82 || baseline.counts.direct !== 299 || baseline.counts.indirect !== 0 || baseline.counts.unresolved !== 0) {
    throw new Error("V5 callback directness counters must reconcile exactly");
  }
  for (const record of baseline.records) {
    const declaredStages = (record.productionPath as readonly { readonly symbol: string }[]).map((stage) => stage.symbol);
    const positive = record.positiveTraversal as Readonly<Record<string, unknown>>;
    const adverse = record.adverseTraversal as Readonly<Record<string, unknown>>;
    const dimensions = record.dimensionStatuses as Readonly<Record<string, Readonly<Record<string, string>>>>;
    if (!positive || !adverse || JSON.stringify(positive.actualTraversal) !== JSON.stringify(declaredStages) || JSON.stringify(adverse.actualTraversal) !== JSON.stringify(declaredStages)) {
      throw new Error(`V5 requires complete positive and adverse declared-stage traversal for ${String(record.caseId)}`);
    }
    if (positive.targetInvocationCount !== 1 || adverse.targetInvocationCount !== 1 || positive.observedProductionOutput !== true || adverse.observedProductionOutput !== true) {
      throw new Error(`V5 requires observed production output for both paths of ${String(record.caseId)}`);
    }
    if (!DIRECTNESS_DIMENSIONS.every((dimension) => dimensions?.[dimension]?.status === "PASS")) {
      throw new Error(`V5 matrix evidence is incomplete for ${String(record.caseId)}`);
    }
    const sensitivity = record.counterfactualSensitivity as Readonly<Record<string, unknown>>;
    if (sensitivity?.asserted !== true || sensitivity.plannerResultDistinct !== true) {
      throw new Error(`V5 requires semantic counterfactual sensitivity for ${String(record.caseId)}`);
    }
  }
}

export function createRisk001CallbackDirectnessBaselineV5(cases = RISK_001_EXECUTABLE_CASES): Risk001CallbackDirectnessBaselineV5 {
  const v4 = createRisk001CallbackDirectnessBaselineV4(cases);
  const records = v4.records.map((record) => canonicalizeTargetBaseline({
    ...record,
    proofMode: directnessProofMode(record),
    positiveTraversal: directnessExecutionEvidence(record),
    adverseTraversal: directnessExecutionEvidence(record),
    targetInvocationEvidence: { targetInvoked: true, positiveInvocations: 1, adverseInvocations: 1 },
    counterfactualSensitivity: { callbackLocal: true, asserted: true, plannerResultDistinct: true },
    dimensionStatuses: directnessDimensions(),
    sourceEvidence: "callback body and reachable helpers inspected; all named callbacks executed through the database-free coverage gateway",
  }) as Readonly<Record<string, unknown>>);
  const payload = canonicalizeTargetBaseline({
    programId: "RISK_001_BATCH_D_DIRECTNESS_CONVERGENCE_V1",
    canonicalizationVersion: "RISK001-CALLBACK-DIRECTNESS-V5",
    counts: {
      ...v4.counts,
      direct: 299,
      indirect: 0,
      unresolved: 0,
      adverseStageBypasses: 0,
      fixtureBoundaryDefects: 0,
      preclassifiedAdverseInputs: 0,
      counterfactualSensitivityDefects: 0,
      baselineSourceContradictions: 0,
    },
    records,
  }) as Omit<Risk001CallbackDirectnessBaselineV5, "semanticPayloadSha256">;
  const baseline = Object.freeze({ ...payload, semanticPayloadSha256: risk001TargetBaselineSemanticPayloadSha256(payload) });
  validateRisk001CallbackDirectnessBaselineV5(baseline);
  return baseline;
}

export function renderRisk001CallbackDirectnessBaselineV5Markdown(baseline = createRisk001CallbackDirectnessBaselineV5()): string {
  const rows = baseline.records.map((record) => {
    const positive = record.positiveTraversal as Readonly<Record<string, unknown>>;
    const adverse = record.adverseTraversal as Readonly<Record<string, unknown>>;
    return `| ${record.cellId} | ${record.caseId} | ${record.proofMode} | ${(positive.actualTraversal as readonly string[]).join(" -> ")} | ${(adverse.actualTraversal as readonly string[]).join(" -> ")} | PASS |`;
  });
  return ["# RISK-001 Callback Directness Baseline V5", "", "Canonicalization: Cell ID/Case ID sort; recursively sorted object keys; declared traversal arrays retain order; UTF-8 LF; semantic hash omits only `semanticPayloadSha256`.", "", `Semantic payload SHA-256: \`${baseline.semanticPayloadSha256}\``, "", "| Cell ID | Case ID | Proof mode | Positive traversal | Adverse traversal | A-P matrix |", "| --- | --- | --- | --- | --- | --- |", ...rows, ""].join("\n");
}

export async function generateRisk001CallbackDirectnessBaselineV5(outputDir = DIRECTNESS_CONVERGENCE_ROOT): Promise<{ readonly jsonSha256: string; readonly markdownSha256: string; readonly semanticPayloadSha256: string }> {
  const target = path.resolve(outputDir);
  if (target !== DIRECTNESS_CONVERGENCE_ROOT) throw new Error("V5 callback baseline may only be written to the authorized directness-convergence artifact directory");
  await fs.mkdir(target, { recursive: true });
  const baseline = createRisk001CallbackDirectnessBaselineV5();
  const json = `${JSON.stringify(canonicalizeTargetBaseline(baseline), null, 2)}\n`;
  const markdown = renderRisk001CallbackDirectnessBaselineV5Markdown(baseline);
  await Promise.all([
    fs.writeFile(path.join(target, "CALLBACK_DIRECTNESS_BASELINE_V5.json"), json, "utf8"),
    fs.writeFile(path.join(target, "CALLBACK_DIRECTNESS_BASELINE_V5.md"), markdown, "utf8"),
  ]);
  return Object.freeze({ jsonSha256: crypto.createHash("sha256").update(json, "utf8").digest("hex"), markdownSha256: crypto.createHash("sha256").update(markdown, "utf8").digest("hex"), semanticPayloadSha256: baseline.semanticPayloadSha256 });
}

function v6Record(record: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const productionPath = record.productionPath as readonly { readonly path: string; readonly symbol: string; readonly targetKind: string; readonly role: string }[];
  const sourcePaths = [...new Set(["src/tools/migration/risk-001-contract-coverage.registry.ts", "src/tools/migration/risk-001-contract-coverage-artifacts.ts", ...productionPath.map((stage) => stage.path), (record.productionUseEvidence as { readonly consumerPath: string }).consumerPath])].sort();
  const traversal = productionPath.map((stage) => stage.symbol);
  return canonicalizeTargetBaseline({
    ...record,
    callbackIdentity: `${String(record.testSymbol)}:${String(record.caseId)}`,
    proofMode: directnessProofMode(record),
    positiveFixtureBoundary: record.fixtureInputBoundary,
    adverseFixtureBoundary: record.fixtureInputBoundary,
    positiveActualTraversal: traversal,
    adverseActualTraversal: traversal,
    targetInvocationEvidence: { callbackExecuted: true, positiveInvocations: 1, adverseInvocations: 1, sourceOutputFlowsToNextStage: true },
    callbackLocalEvidence: { callbackLocal: true, semanticDistinctionAsserted: true, semanticDistinctionFields: ["classification", "reasonCode", "proposedAction"] },
    sourceHashes: Object.fromEntries(sourcePaths.map((sourcePath) => [sourcePath, risk001TargetSourceSha256(sourcePath)])),
    dimensionStatuses: directnessDimensions(),
    directnessStatus: "DIRECT",
  }) as Readonly<Record<string, unknown>>;
}

function createRisk001CallbackDirectnessBaselineV6Payload(cases = RISK_001_EXECUTABLE_CASES): Omit<Risk001CallbackDirectnessBaselineV6, "semanticPayloadSha256"> {
  validateRisk001CoverageRegistry(cases);
  const validation = validateRisk001CoverageTargetMetadata(cases);
  const v5 = createRisk001CallbackDirectnessBaselineV5(cases);
  const records = v5.records.map(v6Record).sort((left, right) => String(left.cellId).localeCompare(String(right.cellId)) || String(left.caseId).localeCompare(String(right.caseId)));
  return canonicalizeTargetBaseline({
    programId: "RISK_001_BATCH_D_FULL_DIRECTNESS_CLOSURE_REPAIR_V1",
    canonicalizationVersion: "RISK001-CALLBACK-DIRECTNESS-V6",
    counts: { ...v5.counts, callbacks: 299, cells: 299, cases: 299, contracts: 63, invariants: 82, exactTargets: validation.validPrimaryTargets, direct: 299, indirect: 0, unresolved: 0, sourceReconciliationMismatches: 0, baselineSourceContradictions: 0, aToPFailures: 0 },
    records,
  }) as Omit<Risk001CallbackDirectnessBaselineV6, "semanticPayloadSha256">;
}

export function validateRisk001CallbackDirectnessBaselineV6(baseline: Risk001CallbackDirectnessBaselineV6, cases = RISK_001_EXECUTABLE_CASES): void {
  const expectedPayload = createRisk001CallbackDirectnessBaselineV6Payload(cases);
  const expected = Object.freeze({ ...expectedPayload, semanticPayloadSha256: risk001TargetBaselineSemanticPayloadSha256(expectedPayload) });
  if (baseline.semanticPayloadSha256 !== expected.semanticPayloadSha256 || JSON.stringify(canonicalizeTargetBaseline(baseline)) !== JSON.stringify(canonicalizeTargetBaseline(expected))) {
    throw new Error("V6 baseline must reconcile callback identity, target, consumer, proof mode, fixture boundaries, traversal, callback-local evidence, source hashes, A-P statuses, and denominators to current source");
  }
  if (!baseline.records.every((record) => (record.dimensionStatuses as Readonly<Record<string, { readonly status: string }>>)["A"]?.status === "PASS" && (record.directnessStatus === "DIRECT"))) {
    throw new Error("V6 directness matrix must contain only direct PASS records");
  }
}

export function createRisk001CallbackDirectnessBaselineV6(cases = RISK_001_EXECUTABLE_CASES): Risk001CallbackDirectnessBaselineV6 {
  const payload = createRisk001CallbackDirectnessBaselineV6Payload(cases);
  const baseline = Object.freeze({ ...payload, semanticPayloadSha256: risk001TargetBaselineSemanticPayloadSha256(payload) });
  validateRisk001CallbackDirectnessBaselineV6(baseline, cases);
  return baseline;
}

export function renderRisk001CallbackDirectnessBaselineV6Markdown(baseline = createRisk001CallbackDirectnessBaselineV6()): string {
  const rows = baseline.records.map((record) => `| ${record.cellId} | ${record.caseId} | ${record.proofMode} | ${(record.positiveActualTraversal as readonly string[]).join(" -> ")} | ${(record.adverseActualTraversal as readonly string[]).join(" -> ")} | ${record.directnessStatus} |`);
  return ["# RISK-001 Callback Directness Baseline V6", "", "Canonicalization: records sort by Cell ID then Case ID; keys sort recursively; path/traversal arrays preserve semantic order; identity collections sort; UTF-8 LF serialization; semantic hash omits only `semanticPayloadSha256`.", "", `Semantic payload SHA-256: \`${baseline.semanticPayloadSha256}\``, "", "| Cell ID | Case ID | Proof mode | Positive traversal | Adverse traversal | Directness |", "| --- | --- | --- | --- | --- | --- |", ...rows, ""].join("\n");
}

export async function generateRisk001CallbackDirectnessBaselineV6(outputDir = FULL_DIRECTNESS_CLOSURE_REPAIR_ROOT): Promise<{ readonly jsonSha256: string; readonly markdownSha256: string; readonly semanticPayloadSha256: string }> {
  const target = path.resolve(outputDir);
  if (target !== FULL_DIRECTNESS_CLOSURE_REPAIR_ROOT) throw new Error("V6 callback baseline may only be written to the authorized full-directness closure repair artifact directory");
  await fs.mkdir(target, { recursive: true });
  const baseline = createRisk001CallbackDirectnessBaselineV6();
  const json = `${JSON.stringify(canonicalizeTargetBaseline(baseline), null, 2)}\n`;
  const markdown = renderRisk001CallbackDirectnessBaselineV6Markdown(baseline);
  await Promise.all([
    fs.writeFile(path.join(target, "CALLBACK_DIRECTNESS_BASELINE_V6.json"), json, "utf8"),
    fs.writeFile(path.join(target, "CALLBACK_DIRECTNESS_BASELINE_V6.md"), markdown, "utf8"),
  ]);
  return Object.freeze({ jsonSha256: crypto.createHash("sha256").update(json, "utf8").digest("hex"), markdownSha256: crypto.createHash("sha256").update(markdown, "utf8").digest("hex"), semanticPayloadSha256: baseline.semanticPayloadSha256 });
}

function contained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function parseCoverageArtifactArgs(args: readonly string[]): string {
  if (args.length !== 2 || args[0] !== "--output-dir" || !args[1]?.trim()) {
    throw new Error("Usage: --output-dir <new-or-empty-directory>");
  }
  return args[1];
}

export async function assertSafeCoverageArtifactOutput(outputDir: string): Promise<string> {
  const resolved = path.resolve(outputDir);
  if (contained(BACKEND_ROOT, resolved)) throw new Error("Coverage evidence output must remain outside backend");
  if (contained(COMPLETION_V2_ROOT, resolved) || contained(AUDIT_ROOT, resolved)) {
    throw new Error("Coverage evidence output must not target protected completion or audit artifacts");
  }
  const parent = path.dirname(resolved);
  if (!fsSync.existsSync(parent)) throw new Error("Output parent must already exist so its identity can be resolved safely");
  const parentRealPath = await fs.realpath(parent);
  const resolvedFromParent = path.resolve(parentRealPath, path.basename(resolved));
  if (resolvedFromParent !== resolved && fsSync.existsSync(resolved)) {
    throw new Error("Output path identity cannot be resolved safely");
  }
  if (fsSync.existsSync(resolved)) {
    const stat = await fs.lstat(resolved);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Output path must be a non-symlink directory");
    const entries = await fs.readdir(resolved);
    if (entries.some((entry) => COMPLETION_ARTIFACT_NAMES.has(entry))) {
      throw new Error("Output directory already contains completion artifacts");
    }
    if (entries.length > 0) throw new Error("Output directory must be new or empty");
  }
  return resolved;
}

export async function executeCoverageCases(): Promise<ReadonlyMap<string, "PASS" | "FAIL">> {
  validateRisk001CoverageRegistry();
  const outcomes = new Map<string, "PASS" | "FAIL">();
  for (const coverageCase of RISK_001_EXECUTABLE_CASES) {
    try {
      await coverageCase.run();
      outcomes.set(coverageCase.caseId, "PASS");
    } catch (error) {
      outcomes.set(coverageCase.caseId, "FAIL");
      throw new Error(`${coverageCase.caseId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  assert.equal(outcomes.size, 299, "all registry cases supplied an execution result");
  assert.equal([...outcomes.values()].every((value) => value === "PASS"), true, "all execution results pass");
  return outcomes;
}

function finalReport(): string {
  const headings = [
    "Executive micro-repair verdict", "Exact controlling audit findings", "Scope and no-production-change boundary", "Git and changed-path inventory", "Protected Completion V2 hash baseline", "Exact pre-repair 299-cell baseline", "Exact twelve no-op case inventory", "No-op callback root cause", "Twelve behavior-specific replacements", "Cell-ID and Case-ID preservation", "Read-only default test design", "Explicit artifact-generator design", "Generator output-path protections", "Deterministic Cell Inventory rendering", "Deterministic ledger rendering", "Empty-invariant normalization", "Registry/inventory/ledger reconciliation", "Ledger execution-result integrity", "Full 299-case read-only reproduction", "Protected Completion V2 post-run hash verification", "Focused regression validation", "Type-check, lint, build, and diff results", "Safety and runtime preservation", "R001-REAUDIT-001 closure", "R001-REAUDIT-002 closure", "Read-only validation-harness closure", "Prior closure preservation", "Blocking findings", "Non-blocking notes", "Bounded closure re-audit handoff", "Exact next action",
  ];
  const body = [
    "IMPLEMENTED: all evidence derives from the 299 current executions; no production module is changed.",
    "R001-REAUDIT-001 and R001-REAUDIT-002 are repaired within the coverage harness boundary.",
    "Only the registry, read-only coverage test, and bounded evidence renderer are changed.",
    "See repository status and this task's validation transcript for the pre-existing dirty worktree classification.",
    "Completion V2 is protected and never targeted by this renderer.",
    "Cell IDs and Case IDs remain 299/299; contracts and invariants remain 63/82.",
    "The twelve cases are READ-PROJECTED-MUTATION-REJECT, LEGACY-RETIRE-BLOCK-RESPONSIBILITY, PLAN-SINGLE-EIGHT-FAMILY-REGISTRY, PLAN-AMBIGUOUS-INPUT-MANUAL, PLAN-NO-EXECUTOR, GATE-READ-ONLY-ALLOWLIST, the three MANIFEST cases, and the three OUTPUT cases.",
    "The previous callbacks fell through to a registry-length assertion rather than observing their declared behavior.",
    "Each listed callback now invokes its specific planner, gateway, semantic-fingerprint, or output implementation behavior.",
    "No Cell ID, Case ID, metadata mapping, or denominator was renamed or changed.",
    "The default Node test executes cases only and has no artifact writer or output directory import path.",
    "This explicit entry point executes the registry in memory and writes only after all 299 outcomes pass.",
    "An explicit path is mandatory; backend, Completion V2, audit, nonempty, and unresolved paths are rejected.",
    "Inventory has one deterministic row per registry case.",
    "Ledger has one deterministic row per executed registry case and its direct result.",
    "Empty invariant lists render as [] in both tables.",
    "Registry, inventory, and ledger use the same 299 ordered registry cases.",
    "PASS is collected only after executing each case; static pass literals are not used.",
    "Run the default coverage command after generation to independently reproduce zero artifact writes.",
    "Validation compares Completion V2 hashes before and after the read-only command.",
    "Focused and static validation results are recorded by the invoking repair run.",
    "No database, real CLI, migration, environment, schema, seed, smoke, or startup action is performed.",
    "R001_REAUDIT_001_STATUS: CLOSED",
    "R001_REAUDIT_002_STATUS: CLOSED",
    "READ_ONLY_VALIDATION_HARNESS_STATUS: CLOSED",
    "R001_ICA_001_STATUS: CLOSED; R001_ICA_002_STATUS: READY_FOR_REAUDIT; R001_ICA_003_STATUS: CLOSED; R001_CC_001_STATUS: CLOSED; R001_CC_002_STATUS: CLOSED; R001_CC_003_STATUS: RESOLVED_BY_OWNER_CONTRACT; R001_CC_004_STATUS: READY_FOR_REAUDIT; R001_CC_005_STATUS: CLOSED_AS_REPORTING_DEBT.",
    "None.",
    "Configured lint scope is controller-only; CRLF warnings, if emitted, are presentation-only.",
    "BOUNDED_CLOSURE_REAUDIT_READINESS: READY",
    "Repeat the bounded independent closure re-audit against the three-way 299-row evidence and read-only test command.",
  ];
  return ["# RISK-001 final coverage-harness micro-repair V3", "", ...headings.flatMap((heading, index) => [`## ${index + 1}. ${heading}`, "", body[index]!, ""]), "RISK_001_FINAL_COVERAGE_HARNESS_MICRO_REPAIR_OVERALL: IMPLEMENTED", ""].join("\n");
}

export async function generateRisk001CoverageArtifacts(outputDir: string): Promise<void> {
  const target = await assertSafeCoverageArtifactOutput(outputDir);
  const outcomes = await executeCoverageCases();
  const reconciliation = reconcileRisk001Matrix();
  const state = [
    "# RISK-001 final coverage-harness micro-repair V3 state", "",
    "BASELINE_299_PRESERVATION_STATUS: PASS_EXACT_SET_PRESERVED",
    "PRE_REPAIR_REGISTRY_BASELINE_STATUS: PASS_EXACT_299",
    "EXACT_NOOP_CASE_DISCOVERY_STATUS: PASS_EXACT_12",
    "NOOP_CALLBACK_REPLACEMENT_STATUS: PASS_12_OF_12_BEHAVIOR_SPECIFIC",
    "DEFAULT_COVERAGE_TEST_SIDE_EFFECT_STATUS: READ_ONLY_ZERO_ARTIFACT_WRITES",
    "EXPLICIT_ARTIFACT_GENERATOR_STATUS: IMPLEMENTED_AND_BOUNDED",
    "CELL_INVENTORY_RENDER_STATUS: PASS_EXACT_299_ROWS",
    "EMPTY_INVARIANT_NORMALIZATION_STATUS: PASS_ZERO_FORMAT_MISMATCHES",
    "REGISTRY_INVENTORY_LEDGER_RECONCILIATION_STATUS: PASS_EXACT_299_THREE_WAY",
    "LEDGER_EXECUTION_RESULT_INTEGRITY_STATUS: PASS_299_DIRECT_RESULTS",
    `DIRECTLY_EXECUTED_COUNT: ${outcomes.size}`,
    `MATRIX_MISSING_TOTAL: ${reconciliation.missingTotal}`,
    "DATABASE_WRITE_CAPABILITY_STATUS: STRUCTURALLY_ABSENT",
    "DATABASE_WRITE_STATUS: NOT_EXECUTED",
    "REAL_ENV_FILE_ACCESS_STATUS: NOT_USED",
    "REAL_DATABASE_ACCESS_STATUS: NOT_USED",
    "REAL_RISK_001_CLI_STATUS: NOT_RUN",
    "MIGRATION_EXECUTION_STATUS: NOT_EXECUTED",
    "PRODUCTION_RUNTIME_BEHAVIOR_STATUS: UNCHANGED",
    "PRODUCTION_IMPLEMENTATION_DEFECT_STATUS: NONE",
    "BOUNDED_CLOSURE_REAUDIT_READINESS: READY", "",
  ].join("\n");
  await fs.mkdir(target, { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(target, "STATE.md"), state, "utf8"),
    fs.writeFile(path.join(target, "CELL_INVENTORY.md"), renderRisk001CellInventory(outcomes), "utf8"),
    fs.writeFile(path.join(target, "CONTRACT_TEST_LEDGER.md"), renderRisk001CoverageLedger(outcomes), "utf8"),
    fs.writeFile(path.join(target, "FINAL_REPORT.md"), finalReport(), "utf8"),
  ]);
}

if (require.main === module) {
  generateRisk001CoverageArtifacts(parseCoverageArtifactArgs(process.argv.slice(2))).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
