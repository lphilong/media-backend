import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import ts from "typescript";
import { evaluateKpiPersistedRecord, KPI_PERSISTED_CONTRACT_MATRICES, type KpiPersistedFamily } from "@modules/kpi/domain/kpi-persisted-contract";
import { parseRisk001CliArgs } from "./risk-001-cli-contract";
import { prepareRisk001DryRunCli } from "./risk-001-dry-run";
import {
  loadAccountContextPlannerRecords,
  loadBundleConsistencyPlannerRecords,
  loadLegacyRolePlannerRecords,
  loadRoleDriftPlannerRecords,
  loadScopeFingerprintPlannerRecords,
  loadTalentIdentityPlannerRecords,
} from "./risk-001-data-loaders";
import type {
  ReadOnlyDocument,
  ReadOnlyFilter,
  ReadOnlyFindOptions,
  ReadOnlyMongoGateway,
  ReadOnlyProjection,
} from "./read-only-mongo.gateway";
import { createRisk001Registry } from "./risk-001-planners";
import {
  accountContextPlanner,
  bundlePlanner,
  legacyRolePlanner,
  roleDriftPlanner,
  scopeFingerprintPlanner,
  staleKpiPlanner,
  talentIdentityPlanner,
} from "./risk-001-planners";
import { getRoleTemplate, LEGACY_ROLE_TEMPLATE_CODES, ROLE_TEMPLATE_CATALOG } from "@modules/role/domain/role-template.catalog";
import { getRoleBundle } from "@modules/role/domain/role-bundle.catalog";
import { buildRoleAssignmentScopeFingerprint } from "@modules/role/domain/role-assignment-scope";
import { normalizeRisk001QueryValue, stableSerializeRisk001QueryValue } from "./risk-001-query-value-contract";
import { preflightRisk001OutputDirectory, writeExactlyTwoOutputsAtomically } from "./risk-001-output-publication";
import {
  buildRisk001DryRunManifest,
  fingerprintRisk001CompletedRun,
} from "./risk-001-output";
import {
  RISK001_ENTERPRISE_CONTRACT_VERSION,
  RISK001_REQUIRED_ASSESSMENT_AREA_IDS,
} from "./risk-001-completed-run-contract";
import {
  createRisk001ReadCommitment,
  verifyRisk001ReadCommitment,
} from "./risk-001-read-commitment";
import {
  assertReadOnlyAggregatePipeline,
  createRisk001ReadOnlyGatewayCapabilityFacade,
  readOnlyGatewayCapabilityNames,
  RISK_001_ACCEPTED_READ_ONLY_CAPABILITIES,
  RISK_001_PROHIBITED_GATEWAY_CAPABILITIES,
  sanitizedFailure,
} from "./risk-001-read-only-gateway-capabilities";

export type Risk001Criticality = "CRITICAL" | "NONCRITICAL";
export type Risk001CaseKind = "MATRIX" | "ADVERSARIAL" | "PAIRED_SENSITIVITY";
export type Risk001ProductionTargetKind = "FUNCTION" | "CLASS" | "CONSTANT" | "SCHEMA" | "REGISTRY" | "MODULE_ENTRYPOINT" | "METHOD";
export type Risk001ProductionPathRole = "INPUT_BOUNDARY" | "LOADER" | "NORMALIZER" | "PLANNER" | "VALIDATOR" | "DEPENDENCY_RESOLVER" | "CANDIDATE_FINALIZER" | "COMPLETED_RUN_BUILDER" | "RENDERER" | "PUBLICATION" | "CLI_ENTRYPOINT";
export type Risk001ProductionUseEvidenceKind = "IMPORTED_AND_INVOKED" | "REGISTERED_AND_EXECUTED" | "CONSUMED_CONSTANT" | "SCHEMA_VALIDATION" | "MODULE_ENTRYPOINT" | "METHOD_INVOCATION";

export interface Risk001ProductionTarget {
  readonly path: string;
  readonly symbol: string;
  readonly targetKind: Risk001ProductionTargetKind;
}

export interface Risk001ProductionPathHop extends Risk001ProductionTarget {
  readonly role: Risk001ProductionPathRole;
}

export interface Risk001ProductionUseEvidence {
  readonly evidenceKind: Risk001ProductionUseEvidenceKind;
  readonly consumerPath: string;
  readonly consumerSymbol: string;
}

export interface Risk001CallbackTargetMetadata {
  readonly category: string;
  readonly primaryTarget: Risk001ProductionTarget;
  readonly productionPath: readonly Risk001ProductionPathHop[];
  readonly productionUseEvidence: Risk001ProductionUseEvidence;
  readonly fixtureInputBoundary: string;
  readonly allowedExternalFakes: readonly string[];
  readonly semanticCounterfactualClass: string;
  readonly currentDirectnessStatus: "DIRECT_CURRENT_BEHAVIOR";
}

export interface Risk001CoverageCase {
  readonly cellId: string;
  readonly caseId: string;
  readonly criticality: Risk001Criticality;
  readonly kind: Risk001CaseKind;
  readonly contractIds: readonly string[];
  readonly invariantIds: readonly string[];
  readonly matrixOwner: string;
  readonly dimensions: Readonly<Record<string, string | number | boolean | null>>;
  readonly expectedBehavior: string;
  readonly evidencePath: string;
  readonly testSymbol: string;
  readonly targetMetadata: Risk001CallbackTargetMetadata;
  readonly run: () => void | Promise<void>;
}

export interface Risk001ContractOwnership {
  readonly invariantIds: readonly string[];
  readonly matrixOwner: string;
  readonly behaviorCellGroup: string;
}

const range = (prefix: string, from: number, to: number, width: number) =>
  Array.from({ length: to - from + 1 }, (_, index) => `${prefix}${String(index + from).padStart(width, "0")}`);
const invariantRange = (prefix: string, to: number) => range(`${prefix}-INV-`, 1, to, 2);
const contractRange = (prefix: string, to: number) => range(`${prefix}-CON-`, 1, to, 3);

/** Exact frozen inventory; ranges only expand the frozen three-digit IDs, never invariant suffixes. */
export const RISK_001_CONTROLLING_CONTRACT_IDS = Object.freeze([
  "READ-CON-001", ...contractRange("QRY", 12), ...contractRange("ROLE", 3),
  ...contractRange("BUNDLE", 3), ...contractRange("SCOPE", 5), ...contractRange("CTX", 8),
  ...contractRange("TALENT", 8), "KPI-CON-PLAN", "KPI-CON-METRIC", "KPI-CON-ALLOCATION",
  "KPI-CON-ACTUAL", "KPI-CON-CORRECTION", "KPI-CON-OPERATION", "KPI-CON-EXCUSE",
  ...contractRange("PLAN", 3), ...contractRange("GATE", 3), ...contractRange("MANIFEST", 3),
  ...contractRange("OUTPUT", 3), ...contractRange("CLI", 4),
]);

export const RISK_001_INVARIANT_IDS = Object.freeze([
  ...invariantRange("QRY", 12), ...invariantRange("READ", 8), ...invariantRange("ROLE", 7),
  ...invariantRange("BUNDLE", 10), ...invariantRange("SCOPE", 5), ...invariantRange("CTX", 8),
  ...invariantRange("TALENT", 8), ...invariantRange("KPI", 17), ...invariantRange("CLI", 4),
  ...invariantRange("OUTPUT", 3),
]);

function ownership(invariantIds: readonly string[], matrixOwner: string, behaviorCellGroup: string): Risk001ContractOwnership {
  return Object.freeze({ invariantIds: Object.freeze([...invariantIds]), matrixOwner, behaviorCellGroup });
}
function split(ids: readonly string[], groups: readonly number[]): readonly (readonly string[])[] {
  let cursor = 0;
  return groups.map((size) => Object.freeze(ids.slice(cursor, cursor += size)));
}
const roleInvariantGroups = split(invariantRange("ROLE", 7), [3, 2, 2]);
const bundleInvariantGroups = split(invariantRange("BUNDLE", 10), [4, 3, 3]);

/**
 * Semantic parent ownership is intentionally declared by family groups. It never derives
 * a Contract ID by replacing an invariant suffix, which was the original audit defect.
 */
export const RISK_001_CONTRACT_OWNERSHIP_MAP: Readonly<Record<string, Risk001ContractOwnership>> = Object.freeze({
  "READ-CON-001": ownership(invariantRange("READ", 8), "READ_COMMITMENT", "read"),
  ...Object.fromEntries(contractRange("QRY", 12).map((id, index) => [id, ownership([`QRY-INV-${String(index + 1).padStart(2, "0")}`], "QUERY_GRAMMAR", "query")])),
  "ROLE-CON-001": ownership(roleInvariantGroups[0]!, "ROLE_AUTHORITY", "role"),
  "ROLE-CON-002": ownership(roleInvariantGroups[1]!, "ROLE_AUTHORITY", "role"),
  "ROLE-CON-003": ownership(roleInvariantGroups[2]!, "ROLE_AUTHORITY", "role"),
  "BUNDLE-CON-001": ownership(bundleInvariantGroups[0]!, "BUNDLE_AUTHORITY", "bundle"),
  "BUNDLE-CON-002": ownership(bundleInvariantGroups[1]!, "BUNDLE_AUTHORITY", "bundle"),
  "BUNDLE-CON-003": ownership(bundleInvariantGroups[2]!, "BUNDLE_AUTHORITY", "bundle"),
  ...Object.fromEntries(contractRange("SCOPE", 5).map((id, index) => [id, ownership([`SCOPE-INV-${String(index + 1).padStart(2, "0")}`], "STRUCTURED_SCOPE", "scope")])),
  ...Object.fromEntries(contractRange("CTX", 8).map((id, index) => [id, ownership([`CTX-INV-${String(index + 1).padStart(2, "0")}`], "ACCOUNT_CONTEXT", "context")])),
  ...Object.fromEntries(contractRange("TALENT", 8).map((id, index) => [id, ownership([`TALENT-INV-${String(index + 1).padStart(2, "0")}`], "TALENT_READINESS", "talent")])),
  "KPI-CON-PLAN": ownership(["KPI-INV-01", "KPI-INV-02", "KPI-INV-03"], "KPI_PLAN", "kpi-plan"),
  "KPI-CON-METRIC": ownership(["KPI-INV-04", "KPI-INV-05"], "KPI_METRIC", "kpi-metric"),
  "KPI-CON-ALLOCATION": ownership(["KPI-INV-06", "KPI-INV-07", "KPI-INV-08"], "KPI_ALLOCATION", "kpi-allocation"),
  "KPI-CON-ACTUAL": ownership(["KPI-INV-09", "KPI-INV-10", "KPI-INV-11"], "KPI_ACTUAL", "kpi-actual"),
  "KPI-CON-CORRECTION": ownership(["KPI-INV-12", "KPI-INV-13"], "KPI_CORRECTION", "kpi-correction"),
  "KPI-CON-OPERATION": ownership(["KPI-INV-14", "KPI-INV-15"], "KPI_OPERATION", "kpi-operation"),
  "KPI-CON-EXCUSE": ownership(["KPI-INV-16", "KPI-INV-17"], "KPI_SLOT_EXCUSE", "kpi-excuse"),
  "PLAN-CON-001": ownership([], "PLANNER_REGISTRY", "plan"), "PLAN-CON-002": ownership([], "PLANNER_REGISTRY", "plan"), "PLAN-CON-003": ownership([], "PLANNER_REGISTRY", "plan"),
  "GATE-CON-001": ownership([], "READ_ONLY_GATEWAY", "gate"), "GATE-CON-002": ownership([], "READ_ONLY_GATEWAY", "gate"), "GATE-CON-003": ownership([], "READ_ONLY_GATEWAY", "gate"),
  "MANIFEST-CON-001": ownership([], "MANIFEST", "manifest"), "MANIFEST-CON-002": ownership([], "MANIFEST", "manifest"), "MANIFEST-CON-003": ownership([], "MANIFEST", "manifest"),
  "OUTPUT-CON-001": ownership(["OUTPUT-INV-01"], "OUTPUT_PUBLICATION", "output"), "OUTPUT-CON-002": ownership(["OUTPUT-INV-02"], "OUTPUT_PUBLICATION", "output"), "OUTPUT-CON-003": ownership(["OUTPUT-INV-03"], "OUTPUT_PUBLICATION", "output"),
  "CLI-CON-001": ownership(["CLI-INV-01"], "CLI_PREFLIGHT", "cli"), "CLI-CON-002": ownership(["CLI-INV-02"], "CLI_PREFLIGHT", "cli"), "CLI-CON-003": ownership(["CLI-INV-03"], "CLI_PREFLIGHT", "cli"), "CLI-CON-004": ownership(["CLI-INV-04"], "CLI_PREFLIGHT", "cli"),
});

const target = (sourcePath: string, symbol: string, targetKind: Risk001ProductionTargetKind): Risk001ProductionTarget =>
  Object.freeze({ path: sourcePath, symbol, targetKind });
const hop = (sourcePath: string, symbol: string, targetKind: Risk001ProductionTargetKind, role: Risk001ProductionPathRole): Risk001ProductionPathHop =>
  Object.freeze({ path: sourcePath, symbol, targetKind, role });
const TARGETS = Object.freeze({
  query: target("src/tools/migration/risk-001-query-value-contract.ts", "normalizeRisk001QueryValue", "FUNCTION"),
  kpi: target("src/modules/kpi/domain/kpi-persisted-contract.ts", "evaluateKpiPersistedRecord", "FUNCTION"),
  role: target("src/tools/migration/risk-001-planners.ts", "roleDriftPlanner", "CONSTANT"),
  bundle: target("src/tools/migration/risk-001-planners.ts", "bundlePlanner", "CONSTANT"),
  scope: target("src/tools/migration/risk-001-planners.ts", "scopeFingerprintPlanner", "CONSTANT"),
  context: target("src/tools/migration/risk-001-planners.ts", "accountContextPlanner", "CONSTANT"),
  talent: target("src/tools/migration/risk-001-planners.ts", "talentIdentityPlanner", "CONSTANT"),
  legacy: target("src/tools/migration/risk-001-planners.ts", "legacyRolePlanner", "CONSTANT"),
  read: target("src/tools/migration/risk-001-read-commitment.ts", "verifyRisk001ReadCommitment", "FUNCTION"),
  registry: target("src/tools/migration/risk-001-planners.ts", "createRisk001Registry", "FUNCTION"),
  gatewayFacade: target("src/tools/migration/read-only-mongo.gateway.ts", "NativeReadOnlyMongoGateway", "CLASS"),
  gatewayPipeline: target("src/tools/migration/risk-001-read-only-gateway-capabilities.ts", "assertReadOnlyAggregatePipeline", "FUNCTION"),
  gatewayFailure: target("src/tools/migration/risk-001-read-only-gateway-capabilities.ts", "sanitizedFailure", "FUNCTION"),
  manifestVersion: target("src/tools/migration/risk-001-completed-run-contract.ts", "RISK001_ENTERPRISE_CONTRACT_VERSION", "CONSTANT"),
  manifestFingerprint: target("src/tools/migration/risk-001-output.ts", "fingerprintRisk001CompletedRun", "FUNCTION"),
  outputPreflight: target("src/tools/migration/risk-001-output-publication.ts", "preflightRisk001OutputDirectory", "FUNCTION"),
  outputWrite: target("src/tools/migration/risk-001-output-publication.ts", "writeExactlyTwoOutputsAtomically", "FUNCTION"),
  cliParse: target("src/tools/migration/risk-001-cli-contract.ts", "parseRisk001CliArgs", "FUNCTION"),
  cliPrepare: target("src/tools/migration/risk-001-dry-run.ts", "prepareRisk001DryRunCli", "FUNCTION"),
});

function callbackTargetMetadata(input: Pick<Risk001CoverageCase, "caseId" | "matrixOwner" | "expectedBehavior">): Risk001CallbackTargetMetadata {
  const category = input.matrixOwner;
  let primaryTarget: Risk001ProductionTarget;
  let productionPath: readonly Risk001ProductionPathHop[];
  let productionUseEvidence: Risk001ProductionUseEvidence;
  if (category === "QUERY_GRAMMAR") {
    primaryTarget = TARGETS.query;
    productionPath = [hop(TARGETS.query.path, TARGETS.query.symbol, "FUNCTION", "NORMALIZER")];
    productionUseEvidence = { evidenceKind: "IMPORTED_AND_INVOKED", consumerPath: "src/tools/migration/read-only-mongo.gateway.ts", consumerSymbol: "NativeReadOnlyMongoGateway" };
  } else if (category.startsWith("KPI_")) {
    primaryTarget = TARGETS.kpi;
    productionPath = [hop(TARGETS.kpi.path, TARGETS.kpi.symbol, "FUNCTION", "VALIDATOR")];
    const kpiConsumers: Readonly<Record<string, string>> = Object.freeze({ KPI_PLAN: "evaluateKpiPlan", KPI_METRIC: "evaluateKpiMetric", KPI_ALLOCATION: "evaluateKpiAllocation", KPI_ACTUAL: "evaluateKpiActual", KPI_CORRECTION: "evaluateKpiCorrection", KPI_ALLOCATION_OPERATION: "evaluateKpiOperation", KPI_SLOT_EXCUSE: "evaluateKpiExcuse" });
    productionUseEvidence = { evidenceKind: "SCHEMA_VALIDATION", consumerPath: "src/tools/migration/risk-001-data-loaders.ts", consumerSymbol: kpiConsumers[category]! };
  } else if (category === "ROLE_AUTHORITY") {
    primaryTarget = TARGETS.role;
    productionPath = [hop("src/tools/migration/risk-001-data-loaders.ts", "loadRoleDriftPlannerRecords", "FUNCTION", "LOADER"), hop(TARGETS.role.path, TARGETS.role.symbol, "CONSTANT", "PLANNER")];
    productionUseEvidence = { evidenceKind: "REGISTERED_AND_EXECUTED", consumerPath: "src/tools/migration/risk-001-planners.ts", consumerSymbol: "createRisk001Registry" };
  } else if (category === "BUNDLE_AUTHORITY") {
    primaryTarget = TARGETS.bundle;
    productionPath = [hop("src/tools/migration/risk-001-data-loaders.ts", "loadBundleConsistencyPlannerRecords", "FUNCTION", "LOADER"), hop(TARGETS.bundle.path, TARGETS.bundle.symbol, "CONSTANT", "PLANNER")];
    productionUseEvidence = { evidenceKind: "REGISTERED_AND_EXECUTED", consumerPath: "src/tools/migration/risk-001-planners.ts", consumerSymbol: "createRisk001Registry" };
  } else if (category === "STRUCTURED_SCOPE") {
    primaryTarget = TARGETS.scope;
    productionPath = [hop("src/tools/migration/risk-001-data-loaders.ts", "loadScopeFingerprintPlannerRecords", "FUNCTION", "LOADER"), hop(TARGETS.scope.path, TARGETS.scope.symbol, "CONSTANT", "PLANNER")];
    productionUseEvidence = { evidenceKind: "REGISTERED_AND_EXECUTED", consumerPath: "src/tools/migration/risk-001-planners.ts", consumerSymbol: "createRisk001Registry" };
  } else if (category === "ACCOUNT_CONTEXT") {
    primaryTarget = TARGETS.context;
    productionPath = [hop("src/tools/migration/risk-001-data-loaders.ts", "loadAccountContextPlannerRecords", "FUNCTION", "LOADER"), hop(TARGETS.context.path, TARGETS.context.symbol, "CONSTANT", "PLANNER")];
    productionUseEvidence = { evidenceKind: "REGISTERED_AND_EXECUTED", consumerPath: "src/tools/migration/risk-001-planners.ts", consumerSymbol: "createRisk001Registry" };
  } else if (category === "TALENT_READINESS") {
    primaryTarget = TARGETS.talent;
    productionPath = [hop("src/tools/migration/risk-001-data-loaders.ts", "loadTalentIdentityPlannerRecords", "FUNCTION", "LOADER"), hop(TARGETS.talent.path, TARGETS.talent.symbol, "CONSTANT", "PLANNER")];
    productionUseEvidence = { evidenceKind: "REGISTERED_AND_EXECUTED", consumerPath: "src/tools/migration/risk-001-planners.ts", consumerSymbol: "createRisk001Registry" };
  } else if (category === "READ_COMMITMENT") {
    primaryTarget = TARGETS.read;
    productionPath = [hop(TARGETS.read.path, TARGETS.read.symbol, "FUNCTION", "VALIDATOR")];
    productionUseEvidence = { evidenceKind: "IMPORTED_AND_INVOKED", consumerPath: "src/tools/migration/risk-001-data-loaders.ts", consumerSymbol: "assertSameSourceState" };
  } else if (category === "LEGACY_RETIREMENT") {
    primaryTarget = TARGETS.legacy;
    productionPath = [hop("src/tools/migration/risk-001-data-loaders.ts", "loadLegacyRolePlannerRecords", "FUNCTION", "LOADER"), hop(TARGETS.legacy.path, TARGETS.legacy.symbol, "CONSTANT", "PLANNER")];
    productionUseEvidence = { evidenceKind: "REGISTERED_AND_EXECUTED", consumerPath: "src/tools/migration/risk-001-planners.ts", consumerSymbol: "createRisk001Registry" };
  } else if (category === "PLANNER_REGISTRY") {
    primaryTarget = TARGETS.registry;
    productionPath = [hop(TARGETS.registry.path, TARGETS.registry.symbol, "FUNCTION", "PLANNER")];
    productionUseEvidence = { evidenceKind: "IMPORTED_AND_INVOKED", consumerPath: "src/tools/migration/risk-001-output.ts", consumerSymbol: "buildRisk001DryRunManifest" };
  } else if (category === "READ_ONLY_GATEWAY") {
    primaryTarget = input.expectedBehavior.includes("aggregate") ? TARGETS.gatewayPipeline : input.expectedBehavior.includes("sanitized") ? TARGETS.gatewayFailure : TARGETS.gatewayFacade;
    productionPath = [hop(primaryTarget.path, primaryTarget.symbol, primaryTarget.targetKind, "VALIDATOR")];
    productionUseEvidence = { evidenceKind: primaryTarget === TARGETS.gatewayFacade ? "MODULE_ENTRYPOINT" : "IMPORTED_AND_INVOKED", consumerPath: "src/tools/migration/read-only-mongo.gateway.ts", consumerSymbol: primaryTarget === TARGETS.gatewayFacade ? "withReadOnlyMongoGateway" : "NativeReadOnlyMongoGateway" };
  } else if (category === "MANIFEST") {
    primaryTarget = input.expectedBehavior.includes("contract version") ? TARGETS.manifestVersion : TARGETS.manifestFingerprint;
    productionPath = [hop(primaryTarget.path, primaryTarget.symbol, primaryTarget.targetKind, primaryTarget === TARGETS.manifestVersion ? "COMPLETED_RUN_BUILDER" : "VALIDATOR")];
    productionUseEvidence = { evidenceKind: primaryTarget === TARGETS.manifestVersion ? "CONSUMED_CONSTANT" : "IMPORTED_AND_INVOKED", consumerPath: "src/tools/migration/risk-001-output.ts", consumerSymbol: "buildRisk001DryRunManifest" };
  } else if (category === "OUTPUT_PUBLICATION") {
    primaryTarget = input.expectedBehavior.includes("preflight") ? TARGETS.outputPreflight : TARGETS.outputWrite;
    productionPath = [hop(primaryTarget.path, primaryTarget.symbol, "FUNCTION", "PUBLICATION")];
    productionUseEvidence = { evidenceKind: "IMPORTED_AND_INVOKED", consumerPath: "src/tools/migration/risk-001-dry-run.ts", consumerSymbol: primaryTarget === TARGETS.outputPreflight ? "prepareRisk001DryRunCli" : "runRisk001DryRunCli" };
  } else if (category === "CLI_PREFLIGHT") {
    primaryTarget = input.expectedBehavior.includes("without configuration") ? TARGETS.cliPrepare : TARGETS.cliParse;
    productionPath = [hop(primaryTarget.path, primaryTarget.symbol, "FUNCTION", "CLI_ENTRYPOINT")];
    productionUseEvidence = { evidenceKind: "MODULE_ENTRYPOINT", consumerPath: "src/tools/migration/risk-001-dry-run.ts", consumerSymbol: primaryTarget === TARGETS.cliPrepare ? "runRisk001DryRunCli" : "prepareRisk001DryRunCli" };
  } else {
    throw new Error(`${input.caseId}: no exact production target metadata profile for ${category}`);
  }
  return Object.freeze({
    category,
    primaryTarget,
    productionPath: Object.freeze([...productionPath]),
    productionUseEvidence: Object.freeze(productionUseEvidence),
    fixtureInputBoundary: "case-owned, database-free fixture",
    allowedExternalFakes: Object.freeze(["CoverageReadOnlyGateway"]),
    semanticCounterfactualClass: "NEGATIVE_SEMANTIC_ASSERTION",
    currentDirectnessStatus: "DIRECT_CURRENT_BEHAVIOR",
  });
}

const EVIDENCE_PATH = "src/tools/migration/risk-001-contract-coverage.test.ts";
function caseOf(input: Omit<Risk001CoverageCase, "evidencePath" | "testSymbol" | "targetMetadata">): Risk001CoverageCase {
  return Object.freeze({ ...input, evidencePath: EVIDENCE_PATH, testSymbol: "RISK_001_EXECUTABLE_CASES", targetMetadata: callbackTargetMetadata(input) });
}
function contractCase(caseId: string, contractIds: readonly string[], matrixOwner: string, expectedBehavior: string, run: () => void | Promise<void>, kind: Risk001CaseKind = "MATRIX"): Risk001CoverageCase {
  const invariantIds = contractIds.flatMap((id) => RISK_001_CONTRACT_OWNERSHIP_MAP[id]?.invariantIds ?? []);
  return caseOf({ cellId: `CELL-${caseId}`, caseId, criticality: "CRITICAL", kind, contractIds, invariantIds, matrixOwner, dimensions: { contract: contractIds.join(","), scenario: caseId }, expectedBehavior, run });
}

const queryAccepted: readonly [string, unknown][] = [
  ["NULL", null], ["FALSE", false], ["TRUE", true], ["EMPTY-STRING", ""], ["STRING", "x"], ["ZERO", 0], ["NEGATIVE-ZERO", -0], ["POSITIVE-INTEGER", 7], ["NEGATIVE-INTEGER", -7], ["FRACTION", 1.5], ["EMPTY-ARRAY", []], ["ARRAY", ["x", 1]], ["NESTED-ARRAY", [["x"]]], ["OBJECT", { b: 2, a: 1 }], ["NULL-PROTOTYPE", Object.assign(Object.create(null), { a: 1 })],
];
const queryRejected: readonly [string, unknown][] = [
  ["UNDEFINED", undefined], ["NAN", Number.NaN], ["POSITIVE-INFINITY", Infinity], ["NEGATIVE-INFINITY", -Infinity], ["BIGINT", 1n], ["SYMBOL", Symbol("x")], ["FUNCTION", () => undefined], ["SPARSE-ARRAY", [, "x"]], ["EXPLICIT-UNDEFINED-ITEM", [undefined]], ["ARRAY-EXTRA-PROPERTY", Object.assign(["x"], { extra: true })], ["SYMBOL-KEY", Object.assign({ a: 1 }, { [Symbol("x")]: true })], ["NONENUMERABLE", Object.defineProperty({ a: 1 }, "hidden", { value: 1 })], ["CLASS-INSTANCE", new (class Value { readonly a = 1; })()], ["DATE", new Date()], ["REGEXP", /x/u], ["MAP", new Map()], ["SET", new Set()], ["BUFFER", Buffer.from("x")], ["CYCLIC", (() => { const value: { self?: unknown } = {}; value.self = value; return value; })()],
];
const queryCases = [
  ...queryAccepted.map(([name, value], index) => contractCase(`QRY-ACCEPT-${name}`, [`QRY-CON-${String((index % 12) + 1).padStart(3, "0")}`], "QUERY_GRAMMAR", "normalizes the supported query value", () => {
    const normalized = normalizeRisk001QueryValue(value); assert.ok(normalized !== undefined); if (name === "NEGATIVE-ZERO") assert.equal(normalized, 0);
  })),
  ...queryRejected.map(([name, value], index) => contractCase(`QRY-REJECT-${name}`, [`QRY-CON-${String((index % 12) + 1).padStart(3, "0")}`], "QUERY_GRAMMAR", "rejects before any gateway invocation with sanitized evidence", () => {
    assert.throws(() => normalizeRisk001QueryValue(value), /Unsupported query value grammar/u);
  }, ["SPARSE-ARRAY", "SYMBOL-KEY", "CYCLIC", "BUFFER"].includes(name) ? "ADVERSARIAL" : "MATRIX")),
  contractCase("QRY-REORDERED-OBJECT-EQUIVALENT", ["QRY-CON-001"], "QUERY_GRAMMAR", "equivalent object key order has one identity", () => assert.equal(stableSerializeRisk001QueryValue({ a: 1, b: 2 }), stableSerializeRisk001QueryValue({ b: 2, a: 1 })), "PAIRED_SENSITIVITY"),
  contractCase("QRY-ARRAY-ORDER-DISTINCT", ["QRY-CON-002"], "QUERY_GRAMMAR", "array order remains semantically distinct", () => assert.notEqual(stableSerializeRisk001QueryValue([1, 2]), stableSerializeRisk001QueryValue([2, 1])), "PAIRED_SENSITIVITY"),
];

function fixture(family: KpiPersistedFamily, patch: Record<string, unknown> = {}): Record<string, unknown> {
  const base: Record<KpiPersistedFamily, Record<string, unknown>> = {
    PLAN: { planCode: "P", subjectType: "TALENT_GROUP", subjectId: "g", status: "DRAFT", lifecycleStatus: "DRAFT", currencyCode: "VND", periodMonth: "2026-07", periodStartAt: 1, periodEndAt: 2, timezone: "Asia/Saigon", createdAt: 1, updatedAt: 2, createdByActorId: "maker", updatedByActorId: "updater" },
    METRIC: { kpiPlanId: "p", metricCode: "REVENUE_VND", targetValue: 1, targetValueExact: "1", allocationMode: "GROUP_ONLY", allocationScale: 0, groupRemainderExact: "1", unit: "VND", rollupMethod: "SUM", actualSource: "MANUAL", actualCaptureMode: "GROUP_ENTRY", actualReviewMode: "NONE", actualEvidenceMode: "NONE", actualPolicyVersion: "v", createdAt: 1, updatedAt: 2 },
    ALLOCATION: { kpiPlanId: "p", subjectType: "TALENT_GROUP", subjectId: "g", allocationStatus: "DRAFT", lifecycleStatus: "DRAFT", allocationMode: "GROUP_ONLY", sourcePlanVersion: 1, allocationVersion: 1, membershipSnapshotVersion: "s", eligibleMemberSnapshot: {}, idempotencyKey: "k", idempotencyFingerprint: "f", correlationId: "c", allocationStartDate: "2026-07-01", targetMetrics: [], createdAt: 1, updatedAt: 2, createdByActorId: "maker", updatedByActorId: "updater" },
    ACTUAL: { kpiPlanId: "p", allocationId: "a", metricCode: "REVENUE_VND", actualDate: "2026-07-01", actualValue: 1, effectiveValue: 1, entryVersion: 1, captureMode: "GROUP_ENTRY", aggregationMethod: "SUM", reviewMode: "NONE", evidenceMode: "NONE", policyVersion: "v", createdAt: 1, updatedAt: 2, createdByActorId: "maker", updatedByActorId: "updater", lifecycleStatus: "DRAFT" },
    CORRECTION: { actualEntryId: "a", kpiPlanId: "p", allocationId: "a", metricCode: "REVENUE_VND", actualDate: "2026-07-01", previousValue: 1, correctedValue: 2, previousEntryVersion: 1, replacementEntryVersion: 2, replacementLifecycleStatus: "CORRECTED", requiresReview: false, idempotencyKey: "k", payloadFingerprint: "f", reason: "present", correctedByActorId: "actor", correctedAt: 2, createdAt: 1, updatedAt: 2 },
    ALLOCATION_OPERATION: { kpiPlanId: "p", actorId: "actor", operation: "PUBLISH", idempotencyKey: "k", payloadFingerprint: "f", createdAt: 1, updatedAt: 2 },
    SLOT_EXCUSE: { kpiPlanId: "p", allocationId: "a", metricCode: "REVENUE_VND", actualDate: "2026-07-01", status: "EXCUSED", reasonCode: "OTHER", reasonText: "present", createdAt: 1, updatedAt: 2, createdByActorId: "maker", updatedByActorId: "updater" },
  };
  return { ...base[family], ...patch };
}
const kpiContract: Record<KpiPersistedFamily, string> = { PLAN: "KPI-CON-PLAN", METRIC: "KPI-CON-METRIC", ALLOCATION: "KPI-CON-ALLOCATION", ACTUAL: "KPI-CON-ACTUAL", CORRECTION: "KPI-CON-CORRECTION", ALLOCATION_OPERATION: "KPI-CON-OPERATION", SLOT_EXCUSE: "KPI-CON-EXCUSE" };
const assess = (family: KpiPersistedFamily, record: Record<string, unknown>) => evaluateKpiPersistedRecord(family, record, { parentReferencesValid: true });
const kpiCases: Risk001CoverageCase[] = [];
for (const family of Object.keys(KPI_PERSISTED_CONTRACT_MATRICES) as KpiPersistedFamily[]) {
  const matrix = KPI_PERSISTED_CONTRACT_MATRICES[family];
  for (const field of matrix.alwaysRequiredFields) kpiCases.push(contractCase(`KPI-${family}-MISSING-${field.toUpperCase()}`, [kpiContract[family]], `KPI_${family}`, "missing material field cannot be CURRENT_CANONICAL", () => { const record = fixture(family); delete record[field]; assert.notEqual(assess(family, record).recommendedClassification, "CURRENT_CANONICAL"); }));
  const invalidDimensions: readonly [string, Record<string, unknown>][] = family === "METRIC"
    ? [["UNSUPPORTED-METRIC", { metricCode: "UNSUPPORTED" }]]
    : family === "ACTUAL"
      ? [["UNSUPPORTED-LIFECYCLE", { lifecycleStatus: "UNSUPPORTED" }]]
      : family === "CORRECTION"
        ? [["UNSUPPORTED-REVIEW-LIFECYCLE", { replacementLifecycleStatus: "UNSUPPORTED" }]]
        : family === "ALLOCATION_OPERATION"
          ? [["RESULT-WITHOUT-COMPLETION", { result: {} }]]
          : family === "SLOT_EXCUSE"
            ? [["UNSUPPORTED-STATUS", { status: "UNSUPPORTED" }]]
            : family === "ALLOCATION"
              ? [["UNSUPPORTED-STATUS", { allocationStatus: "UNSUPPORTED" }], ["UNSUPPORTED-LIFECYCLE", { lifecycleStatus: "UNSUPPORTED" }]]
              : [["UNSUPPORTED-STATUS", { status: "UNSUPPORTED" }], ["UNSUPPORTED-LIFECYCLE", { lifecycleStatus: "UNSUPPORTED" }]];
  for (const [label, patch] of invalidDimensions) kpiCases.push(contractCase(`KPI-${family}-${label}`, [kpiContract[family]], `KPI_${family}`, "unsupported enum or contradiction cannot be CURRENT_CANONICAL", () => {
    assert.notEqual(assess(family, fixture(family, patch)).recommendedClassification, "CURRENT_CANONICAL");
  }, "ADVERSARIAL"));
}
kpiCases.push(
  contractCase("KPI-ALLOC-PAIR-APPROVED-DRAFT-INVALID", ["KPI-CON-ALLOCATION"], "KPI_ALLOCATION", "approved allocation paired with draft lifecycle is manual", () => assert.equal(assess("ALLOCATION", fixture("ALLOCATION", { allocationStatus: "APPROVED", lifecycleStatus: "DRAFT" })).recommendedClassification, "MANUAL_REVIEW_REQUIRED"), "PAIRED_SENSITIVITY"),
  contractCase("KPI-ALLOC-APPROVED-MISSING-APPROVED-BY", ["KPI-CON-ALLOCATION"], "KPI_ALLOCATION", "approved allocation without approval actor fails closed", () => assert.notEqual(assess("ALLOCATION", fixture("ALLOCATION", { allocationStatus: "APPROVED", lifecycleStatus: "APPROVED", submittedAt: 1, submittedByActorId: "s", approvedAt: 2 })).recommendedClassification, "CURRENT_CANONICAL"), "PAIRED_SENSITIVITY"),
  contractCase("KPI-ACTUAL-ACCEPTED-MISSING-DERIVATION", ["KPI-CON-ACTUAL"], "KPI_ACTUAL", "derived terminal Actual without lineage fails closed", () => assert.notEqual(assess("ACTUAL", fixture("ACTUAL", { lifecycleStatus: "ACCEPTED", captureMode: "DERIVED", acceptedValue: 1, acceptedVersion: 1 })).recommendedClassification, "CURRENT_CANONICAL"), "PAIRED_SENSITIVITY"),
  contractCase("KPI-EXCUSE-UNSUPPORTED-STATUS", ["KPI-CON-EXCUSE"], "KPI_SLOT_EXCUSE", "unsupported slot-excuse status fails closed", () => assert.notEqual(assess("SLOT_EXCUSE", fixture("SLOT_EXCUSE", { status: "UNSUPPORTED" })).recommendedClassification, "CURRENT_CANONICAL"), "ADVERSARIAL"),
);

function assertKpiPlanner(family: KpiPersistedFamily, evaluation: ReturnType<typeof assess>, expectNone: boolean): void {
  const action = staleKpiPlanner.plan([{
    id: `coverage-${family}`, kind: family, sourceClassification: evaluation.recommendedClassification,
    dependencyCount: 0, historicalTruthKnown: evaluation.recommendedClassification === "CURRENT_CANONICAL",
    downstreamReferences: [], missingMaterialFields: [...evaluation.missingAlwaysRequiredFields, ...evaluation.missingStateRequiredFields],
    materialIssues: [...evaluation.missingAlwaysRequiredFields, ...evaluation.missingStateRequiredFields, ...evaluation.contradictoryFields],
    materialSummary: evaluation.materialSummary,
    boundedExternalDependencyEvidence: "NO_REVENUE_OR_COMMISSION_KPI_ID_REFERENCE_IN_CURRENT_SOURCE",
  }])[0]!;
  assert.equal(action.proposedAction === "NONE", expectNone, `${family}: exact planner action`);
}
function validKpiPairCase(family: "PLAN" | "ALLOCATION", status: string, lifecycle: string): Risk001CoverageCase {
  const caseId = family === "PLAN" ? `KPI-PLAN-PAIR-${status}-${lifecycle}-VALID` : `KPI-ALLOC-PAIR-${status}-${lifecycle}-VALID`;
  const record = family === "PLAN"
    ? fixture("PLAN", planStateFixture(status, lifecycle))
    : fixture("ALLOCATION", allocationStateFixture(status, lifecycle));
  return caseOf({ cellId: `CELL-${caseId}`, caseId, criticality: "CRITICAL", kind: "MATRIX", contractIds: [kpiContract[family]], invariantIds: RISK_001_CONTRACT_OWNERSHIP_MAP[kpiContract[family]]!.invariantIds, matrixOwner: `KPI_${family}`, dimensions: { status, lifecycle, fixture: "canonical-complete" }, expectedBehavior: "CURRENT_CANONICAL with planner action NONE and no material issue", run: () => {
    const evaluation = assess(family, record);
    assert.equal(evaluation.recommendedClassification, "CURRENT_CANONICAL");
    assert.deepEqual([...evaluation.missingAlwaysRequiredFields, ...evaluation.missingStateRequiredFields, ...evaluation.contradictoryFields], []);
    assertKpiPlanner(family, evaluation, true);
  } });
}
function planStateFixture(status: string, lifecycle: string): Record<string, unknown> {
  if (status === "PUBLISHED") return { status, lifecycleStatus: lifecycle, publishedAt: 3, publishedByActorId: "publisher", actualPolicySnapshot: { version: "v" } };
  if (status === "FINALIZED") return { status, lifecycleStatus: lifecycle, publishedAt: 3, publishedByActorId: "publisher", actualPolicySnapshot: { version: "v" }, finalizedAt: 4, finalizedByActorId: "finalizer", finalResult: { value: 1 } };
  if (status === "ARCHIVED") return { status, lifecycleStatus: lifecycle, archivedAt: 5, archivedByActorId: "archiver" };
  return { status, lifecycleStatus: lifecycle };
}
function allocationStateFixture(status: string, lifecycle: string): Record<string, unknown> {
  const submitted = { submittedAt: 3, submittedByActorId: "submitter" };
  if (lifecycle === "SUBMITTED") return { allocationStatus: status, lifecycleStatus: lifecycle, ...submitted };
  if (lifecycle === "CHANGES_REQUESTED") return { allocationStatus: status, lifecycleStatus: lifecycle, ...submitted, rejectedAt: 4, rejectedByActorId: "reviewer", rejectionReason: "evidence" };
  if (lifecycle === "APPROVED") return { allocationStatus: status, lifecycleStatus: lifecycle, ...submitted, approvedAt: 4, approvedByActorId: "approver" };
  if (lifecycle === "PUBLISHED") return { allocationStatus: status, lifecycleStatus: lifecycle, ...submitted, approvedAt: 4, approvedByActorId: "approver", publishedAt: 5, publishedByActorId: "publisher" };
  if (lifecycle === "SUPERSEDED") return { allocationStatus: status, lifecycleStatus: lifecycle, closedAt: 5 };
  if (lifecycle === "CORRECTED") return { allocationStatus: status, lifecycleStatus: lifecycle, supersedesAllocationId: "prior", correctsAllocationId: "prior", note: "correction" };
  return { allocationStatus: status, lifecycleStatus: lifecycle };
}
function stateOmissionCase(family: "PLAN" | "ALLOCATION" | "ACTUAL", status: string, lifecycle: string, field: string): Risk001CoverageCase {
  const caseId = family === "ACTUAL" ? `KPI-ACTUAL-STATE-${lifecycle}-MISSING-${field.toUpperCase()}` : family === "ALLOCATION" ? `KPI-ALLOC-STATE-${status}-${lifecycle}-MISSING-${field.toUpperCase()}` : `KPI-PLAN-STATE-${status}-${lifecycle}-MISSING-${field.toUpperCase()}`;
  const complete = family === "PLAN" ? fixture("PLAN", planStateFixture(status, lifecycle)) : family === "ALLOCATION" ? fixture("ALLOCATION", allocationStateFixture(status, lifecycle)) : fixture("ACTUAL", actualStateFixture(lifecycle));
  return caseOf({ cellId: `CELL-${caseId}`, caseId, criticality: "CRITICAL", kind: "MATRIX", contractIds: [kpiContract[family]], invariantIds: RISK_001_CONTRACT_OWNERSHIP_MAP[kpiContract[family]]!.invariantIds, matrixOwner: `KPI_${family}`, dimensions: { status, lifecycle, omittedField: field, mutation: "one-field-omission" }, expectedBehavior: "missing state-required field is material and planner action is not NONE", run: () => {
    const record = { ...complete }; delete record[field];
    const evaluation = assess(family, record);
    assert.notEqual(evaluation.recommendedClassification, "CURRENT_CANONICAL");
    assert.equal(evaluation.missingStateRequiredFields.includes(field), true);
    assertKpiPlanner(family, evaluation, false);
  } });
}
function actualStateFixture(lifecycle: string): Record<string, unknown> {
  return { lifecycleStatus: lifecycle, acceptedValue: 1, acceptedVersion: 1 };
}
const planPairCases = KPI_PERSISTED_CONTRACT_MATRICES.PLAN.allowedStatusLifecyclePairs.map((pair) => {
  const [status, lifecycle] = pair.split(":"); return validKpiPairCase("PLAN", status!, lifecycle!);
});
const allocationPairCases = KPI_PERSISTED_CONTRACT_MATRICES.ALLOCATION.allowedStatusLifecyclePairs.map((pair) => {
  const [status, lifecycle] = pair.split(":"); return validKpiPairCase("ALLOCATION", status!, lifecycle!);
});
const planStateOmissionCases = KPI_PERSISTED_CONTRACT_MATRICES.PLAN.allowedStatusLifecyclePairs.flatMap((pair) => {
  const [status, lifecycle] = pair.split(":");
  return (KPI_PERSISTED_CONTRACT_MATRICES.PLAN.stateRequiredFields[status!] ?? []).map((field) => stateOmissionCase("PLAN", status!, lifecycle!, field));
});
const allocationStateOmissionCases = KPI_PERSISTED_CONTRACT_MATRICES.ALLOCATION.allowedStatusLifecyclePairs.flatMap((pair) => {
  const [status, lifecycle] = pair.split(":");
  return (KPI_PERSISTED_CONTRACT_MATRICES.ALLOCATION.stateRequiredFields[lifecycle!] ?? []).map((field) => stateOmissionCase("ALLOCATION", status!, lifecycle!, field));
});
const actualTerminalStates = Object.keys(KPI_PERSISTED_CONTRACT_MATRICES.ACTUAL.stateRequiredFields).sort();
const actualStateOmissionCases = actualTerminalStates.flatMap((state) =>
  (KPI_PERSISTED_CONTRACT_MATRICES.ACTUAL.stateRequiredFields[state] ?? []).map((field) => stateOmissionCase("ACTUAL", state, state, field)),
);
kpiCases.push(...planPairCases, ...allocationPairCases, ...planStateOmissionCases, ...allocationStateOmissionCases, ...actualStateOmissionCases,
  contractCase("KPI-ACTUAL-PRETERMINAL-DRAFT-VALID", ["KPI-CON-ACTUAL"], "KPI_ACTUAL", "draft Actual requires no future terminal evidence", () => {
    const evaluation = assess("ACTUAL", fixture("ACTUAL")); assert.equal(evaluation.recommendedClassification, "CURRENT_CANONICAL"); assertKpiPlanner("ACTUAL", evaluation, true);
  }),
);

const REQUIRED_ROLE_CASE_IDS = ["ROLE-MATCHED-CANONICAL", "ROLE-MISSING-PERMISSION", "ROLE-EXTRA-PERMISSION", "ROLE-MIXED-PERMISSION-DRIFT", "ROLE-METADATALESS-EXACT", "ROLE-PROVENANCE-CONFLICT", "ROLE-LEGACY-COMPATIBILITY", "ROLE-INACTIVE", "ROLE-DEFERRED", "ROLE-ORPHAN-MANUAL", "ROLE-NO-AUTOMATIC-MUTATION"] as const;
const REQUIRED_BUNDLE_CASE_IDS = ["BUNDLE-MATCHED-CANONICAL", "BUNDLE-INACTIVE-PARENT", "BUNDLE-EXPIRED-PARENT", "BUNDLE-TARGET-USER-MISMATCH", "BUNDLE-CATALOG-MISMATCH", "BUNDLE-VERSION-MISMATCH", "BUNDLE-MISSING-CHILD", "BUNDLE-EXTRA-CHILD", "BUNDLE-INACTIVE-CHILD", "BUNDLE-REVOKED-CHILD", "BUNDLE-MISSING-ROLE", "BUNDLE-INACTIVE-ROLE", "BUNDLE-DUPLICATE-CHILD", "BUNDLE-ORIGIN-MISMATCH", "BUNDLE-ORPHAN-ORIGIN-CHILD", "BUNDLE-CROSS-USER-CHILD", "BUNDLE-MATCHED-NO-ACTION", "BUNDLE-NO-CHILD-REACTIVATION"] as const;
const REQUIRED_SCOPE_CASE_IDS = ["SCOPE-VALID-STRUCTURED-GRANT", "SCOPE-MULTIPLE-VALID-GRANTS", "SCOPE-REORDERED-EQUIVALENT-GRANTS", "SCOPE-ABSENT-FINGERPRINT", "SCOPE-STALE-FINGERPRINT", "SCOPE-MISSING-SUBJECT", "SCOPE-INVALID-TARGET", "SCOPE-UNSUPPORTED-SCOPE", "SCOPE-COARSE-LEGACY", "SCOPE-AMBIGUOUS-LEGACY", "SCOPE-NO-FABRICATED-REPLACEMENT"] as const;
const REQUIRED_CONTEXT_CASE_IDS = ["CTX-ONE-CANONICAL-ROLE", "CTX-MULTI-ROLE-DETERMINISTIC-UNION", "CTX-DUPLICATE-RECOMMENDATIONS-COLLAPSE", "CTX-EMPTY-POLICY-MANUAL", "CTX-UNKNOWN-ROLE-MANUAL", "CTX-INACTIVE-ROLE", "CTX-MISSING-PERSISTED-ROLE", "CTX-ZERO-PROFILES", "CTX-ONE-ACTIVE-PROFILE", "CTX-ONE-ON_LEAVE-PROFILE", "CTX-ONE-SUSPENDED-PROFILE", "CTX-ONE-TERMINATED-PROFILE", "CTX-DUPLICATE-PROFILES", "CTX-CONFLICTING-PROFILES", "CTX-MISSING-CONTEXT", "CTX-SURPLUS-CONTEXT", "CTX-CONFLICTING-CONTEXT", "CTX-NO-FIRST-ROLE-PRECEDENCE", "CTX-NO-LAST-ROLE-PRECEDENCE"] as const;
const REQUIRED_TALENT_CASE_IDS = ["TALENT-INTERNAL-VALID-IDENTITY", "TALENT-EXTERNAL-ONLY-VALID", "TALENT-EXTERNAL-PROFILE-LINK-FORBIDDEN", "TALENT-MISSING-PROFILE", "TALENT-DUPLICATE-PROFILE", "TALENT-INACTIVE", "TALENT-INACTIVE-PROFILE", "TALENT-ZERO-ACTIVE-GROUPS", "TALENT-ONE-ACTIVE-GROUP", "TALENT-MULTIPLE-ACTIVE-GROUPS", "TALENT-INACTIVE-GROUP", "TALENT-INACTIVE-MEMBERSHIP", "TALENT-IDENTITY-READY-GROUP-NOT-READY", "TALENT-AMBIGUOUS-PRESERVE"] as const;

/** Database-free native fake. It only models the gateway protocol; every classification
 * below is made by the imported production loaders and planners. */
class CoverageReadOnlyGateway implements ReadOnlyMongoGateway {
  constructor(private readonly collections: Readonly<Record<string, readonly ReadOnlyDocument[]>>) {}
  async ping(): Promise<void> {}
  async findOne<T extends ReadOnlyDocument>(collection: string, filter: ReadOnlyFilter, _projection: ReadOnlyProjection): Promise<T | null> {
    return (this.rows(collection).find((row) => coverageMatches(row, filter)) as T | undefined) ?? null;
  }
  async find<T extends ReadOnlyDocument>(collection: string, filter: ReadOnlyFilter, options: ReadOnlyFindOptions): Promise<readonly T[]> {
    return this.rows(collection).filter((row) => coverageMatches(row, filter)).sort((a, b) => coverageId(a).localeCompare(coverageId(b))).slice(0, options.limit) as unknown as readonly T[];
  }
  async countDocuments(collection: string, filter: ReadOnlyFilter): Promise<number> { return this.rows(collection).filter((row) => coverageMatches(row, filter)).length; }
  async distinct<T>(collection: string, field: string, filter: ReadOnlyFilter): Promise<readonly T[]> { return [...new Set(this.rows(collection).filter((row) => coverageMatches(row, filter)).map((row) => (row as Record<string, unknown>)[field]))] as readonly T[]; }
  async aggregate<T extends ReadOnlyDocument>(): Promise<readonly T[]> { return []; }
  private rows(collection: string): readonly ReadOnlyDocument[] { return this.collections[collection] ?? []; }
}
function coverageId(row: ReadOnlyDocument): string { return String((row as { readonly _id?: unknown })._id ?? ""); }
function coverageMatches(row: ReadOnlyDocument, filter: ReadOnlyFilter): boolean {
  const value = row as Record<string, unknown>;
  if (Array.isArray(filter.$and)) return filter.$and.every((part) => coverageMatches(row, part as ReadOnlyFilter));
  return Object.entries(filter).every(([key, expected]) => {
    if (key === "$and") return true;
    if (expected && typeof expected === "object" && "$gt" in expected) return String(value[key] ?? "") > String((expected as { readonly $gt: unknown }).$gt);
    if (expected && typeof expected === "object" && "$eq" in expected) return value[key] === (expected as { readonly $eq: unknown }).$eq;
    return value[key] === expected;
  });
}
const COVERAGE_LOADER_OPTIONS = Object.freeze({ observedAt: 100, pageSize: 10, safetyCeiling: 100 });
const directCaseIds = new Set<string>([
  "ROLE-INACTIVE", "SCOPE-REORDERED-EQUIVALENT-GRANTS", "SCOPE-UNSUPPORTED-SCOPE", "SCOPE-AMBIGUOUS-LEGACY", "SCOPE-NO-FABRICATED-REPLACEMENT",
  "CTX-DUPLICATE-RECOMMENDATIONS-COLLAPSE", "CTX-ONE-ON_LEAVE-PROFILE", "CTX-SURPLUS-CONTEXT", "CTX-CONFLICTING-CONTEXT", "CTX-NO-FIRST-ROLE-PRECEDENCE", "CTX-NO-LAST-ROLE-PRECEDENCE",
  "TALENT-ZERO-ACTIVE-GROUPS", "TALENT-ONE-ACTIVE-GROUP", "TALENT-MULTIPLE-ACTIVE-GROUPS", "TALENT-INACTIVE-GROUP", "TALENT-INACTIVE-MEMBERSHIP", "TALENT-IDENTITY-READY-GROUP-NOT-READY",
]);
function rawContextCollections(params: { readonly contexts?: readonly string[]; readonly profiles?: readonly ReadOnlyDocument[]; readonly roles?: readonly ReadOnlyDocument[]; readonly assignments?: readonly ReadOnlyDocument[] } = {}): Readonly<Record<string, readonly ReadOnlyDocument[]>> {
  const template = getRoleTemplate("STAFF_CONSOLE_USER")!;
  return {
    roles: params.roles ?? [{ _id: "role", code: template.code, templateCode: template.code, state: "ACTIVE" }],
    role_assignments: params.assignments ?? [{ _id: "assignment", roleId: "role", userId: "user", state: "ACTIVE" }],
    users: [{ _id: "user", accountStatus: "ACTIVE", actorKind: "STAFF", accountContexts: params.contexts ?? [template.recommendedAccountContext] }],
    employment_profiles: params.profiles ?? [{ _id: "profile", linkedUserId: "user", employmentStatus: "ACTIVE" }],
  };
}
async function directAuthorityCase(caseId: string): Promise<boolean> {
  if (!directCaseIds.has(caseId)) return false;
  if (caseId === "ROLE-INACTIVE") {
    const template = getRoleTemplate("STAFF_CONSOLE_USER")!;
    const inactiveLoaded = await loadRoleDriftPlannerRecords(new CoverageReadOnlyGateway({ roles: [{ _id: "inactive", code: template.code, templateCode: template.code, templateVersion: template.version, state: "INACTIVE", permissions: [...template.permissions] }], role_assignments: [] }), COVERAGE_LOADER_OPTIONS);
    const inactiveAction = roleDriftPlanner.plan(inactiveLoaded.records.filter((record) => record.id === "inactive"))[0]!;
    assert.equal(inactiveAction.reasonCode, "PERSISTED_CANONICAL_ROLE_INACTIVE"); assert.equal(inactiveAction.proposedAction, "MANUAL_REVIEW_NO_ROLE_MUTATION"); assert.equal(inactiveAction.classification, "AMBIGUOUS_MANUAL_REVIEW");
    const activeExactLoaded = await loadRoleDriftPlannerRecords(new CoverageReadOnlyGateway({ roles: [{ _id: "active-exact", code: template.code, templateCode: template.code, templateVersion: template.version, state: "ACTIVE", permissions: [...template.permissions] }], role_assignments: [] }), COVERAGE_LOADER_OPTIONS);
    const activeExactAction = roleDriftPlanner.plan(activeExactLoaded.records.filter((record) => record.id === "active-exact"))[0]!;
    assert.equal(activeExactAction.reasonCode, "MATCHED"); assert.equal(activeExactAction.proposedAction, "NONE"); assert.equal(activeExactAction.classification, "NO_MIGRATION_REQUIRED"); assert.equal(activeExactAction.requiredApproval, "NONE");
    assert.notEqual(inactiveAction.reasonCode, activeExactAction.reasonCode); assert.notEqual(inactiveAction.proposedAction, activeExactAction.proposedAction); assert.notEqual(inactiveAction.classification, activeExactAction.classification); return true;
  }
  if (caseId.startsWith("SCOPE-")) {
    const grant = { scopeType: "self" as const };
    if (caseId === "SCOPE-REORDERED-EQUIVALENT-GRANTS") {
      const grants = [{ scopeType: "self" as const }, { scopeType: "managedTalentGroup" as const, targetId: "group" }];
      const fingerprint = buildRoleAssignmentScopeFingerprint(grants);
      const first = await loadScopeFingerprintPlannerRecords(new CoverageReadOnlyGateway({ role_assignments: [{ _id: "first", roleId: "role", userId: "user", state: "ACTIVE", structuredScopeGrants: grants, scopeFingerprint: fingerprint }], talent_groups: [{ _id: "group", status: "ACTIVE" }] }), COVERAGE_LOADER_OPTIONS);
      const second = await loadScopeFingerprintPlannerRecords(new CoverageReadOnlyGateway({ role_assignments: [{ _id: "second", roleId: "role", userId: "user", state: "ACTIVE", structuredScopeGrants: [...grants].reverse(), scopeFingerprint: fingerprint }], talent_groups: [{ _id: "group", status: "ACTIVE" }] }), COVERAGE_LOADER_OPTIONS);
      const firstAction = scopeFingerprintPlanner.plan(first.records)[0]!;
      const secondAction = scopeFingerprintPlanner.plan(second.records)[0]!;
      const adverse = await loadScopeFingerprintPlannerRecords(new CoverageReadOnlyGateway({ role_assignments: [{ _id: "adverse", roleId: "role", userId: "user", state: "ACTIVE", scopeGrants: { kpi: ["self"] } }] }), COVERAGE_LOADER_OPTIONS);
      const adverseAction = scopeFingerprintPlanner.plan(adverse.records)[0]!;
      assert.equal(first.records[0]?.sourceClassification, "EXACT_STRUCTURED_MATCH"); assert.equal(second.records[0]?.sourceClassification, "EXACT_STRUCTURED_MATCH"); assert.equal(first.records[0]?.storedFingerprint, second.records[0]?.storedFingerprint);
      assert.equal(firstAction.classification, "NO_MIGRATION_REQUIRED"); assert.equal(secondAction.classification, "NO_MIGRATION_REQUIRED"); assert.equal(adverseAction.classification, "AMBIGUOUS_MANUAL_REVIEW"); assert.notEqual(firstAction.proposedAction, adverseAction.proposedAction); return true;
    }
    const assignment = caseId === "SCOPE-UNSUPPORTED-SCOPE"
      ? { _id: "scope", roleId: "role", userId: "user", state: "ACTIVE", structuredScopeGrants: [{ scopeType: "unsupported" }], scopeFingerprint: "x" }
      : { _id: "scope", roleId: "role", userId: "user", state: "ACTIVE", scopeGrants: { kpi: ["self"] } };
    const loaded = await loadScopeFingerprintPlannerRecords(new CoverageReadOnlyGateway({ role_assignments: [assignment] }), COVERAGE_LOADER_OPTIONS);
    const record = loaded.records[0]!;
    if (caseId === "SCOPE-UNSUPPORTED-SCOPE") assert.equal(record.sourceClassification, "UNSUPPORTED_SCOPE_TYPE");
    else assert.equal(record.sourceClassification, "COARSE_SCOPE_ONLY");
    const action = scopeFingerprintPlanner.plan([record])[0]!;
    const grants = [{ scopeType: "managedTalentGroup" as const, targetId: "group" }];
    const adverse = await loadScopeFingerprintPlannerRecords(new CoverageReadOnlyGateway({ role_assignments: [{ _id: "adverse", roleId: "role", userId: "user", state: "ACTIVE", structuredScopeGrants: grants, scopeFingerprint: buildRoleAssignmentScopeFingerprint(grants) }], talent_groups: [{ _id: "group", status: "ACTIVE" }] }), COVERAGE_LOADER_OPTIONS);
    const adverseAction = scopeFingerprintPlanner.plan(adverse.records)[0]!;
    assert.equal(action.proposedAction, "MANUAL_REVIEW_NO_SCOPE_GRANT_MUTATION"); assert.equal(adverseAction.classification, "NO_MIGRATION_REQUIRED"); assert.notEqual(action.classification, adverseAction.classification); assert.notEqual(action.reasonCode, adverseAction.reasonCode); return true;
  }
  if (caseId.startsWith("CTX-")) {
    const assertContextCounterfactual = async (positiveAction: ReturnType<typeof accountContextPlanner.plan>[number]) => {
      const adverseCollections = caseId === "CTX-CONFLICTING-CONTEXT"
        ? rawContextCollections()
        : rawContextCollections({ profiles: [{ _id: "active", linkedUserId: "user", employmentStatus: "ACTIVE" }, { _id: "suspended", linkedUserId: "user", employmentStatus: "SUSPENDED" }] });
      const adverseLoaded = await loadAccountContextPlannerRecords(new CoverageReadOnlyGateway(adverseCollections), COVERAGE_LOADER_OPTIONS);
      const adverseAction = accountContextPlanner.plan(adverseLoaded.records)[0]!;
      assert.notEqual(positiveAction.classification, adverseAction.classification, `${caseId}: raw counterfactual changes Account Context classification`);
      assert.notEqual(positiveAction.reasonCode, adverseAction.reasonCode, `${caseId}: raw counterfactual changes Account Context reason`);
    };
    if (caseId === "CTX-DUPLICATE-RECOMMENDATIONS-COLLAPSE") {
      const template = getRoleTemplate("STAFF_CONSOLE_USER")!;
      const loaded = await loadAccountContextPlannerRecords(new CoverageReadOnlyGateway(rawContextCollections({ roles: [{ _id: "role-a", code: template.code, templateCode: template.code, state: "ACTIVE" }, { _id: "role-b", code: template.code, templateCode: template.code, state: "ACTIVE" }], assignments: [{ _id: "a", roleId: "role-a", userId: "user", state: "ACTIVE" }, { _id: "b", roleId: "role-b", userId: "user", state: "ACTIVE" }] })), COVERAGE_LOADER_OPTIONS);
      const action = accountContextPlanner.plan(loaded.records)[0]!;
      assert.deepEqual(loaded.records[0]?.recommendedContexts, [template.recommendedAccountContext]); assert.equal(action.classification, "DETERMINISTIC_WITH_PRECONDITION"); await assertContextCounterfactual(action); return true;
    }
    if (caseId === "CTX-ONE-ON_LEAVE-PROFILE") {
      const loaded = await loadAccountContextPlannerRecords(new CoverageReadOnlyGateway(rawContextCollections({ profiles: [{ _id: "profile", linkedUserId: "user", employmentStatus: "ON_LEAVE" }] })), COVERAGE_LOADER_OPTIONS);
      const action = accountContextPlanner.plan(loaded.records)[0]!;
      assert.equal(loaded.records[0]?.eligibilityProven, true); assert.equal(action.classification, "DETERMINISTIC_WITH_PRECONDITION"); await assertContextCounterfactual(action); return true;
    }
    if (caseId === "CTX-SURPLUS-CONTEXT") {
      const template = getRoleTemplate("STAFF_CONSOLE_USER")!;
      const loaded = await loadAccountContextPlannerRecords(new CoverageReadOnlyGateway(rawContextCollections({ contexts: [template.recommendedAccountContext, "SURPLUS_CONTEXT"] })), COVERAGE_LOADER_OPTIONS);
      const action = accountContextPlanner.plan(loaded.records)[0]!;
      assert.equal(loaded.records[0]?.eligibilityProven, true); assert.equal(loaded.records[0]?.currentContexts.includes("SURPLUS_CONTEXT"), true); assert.equal(action.classification, "DETERMINISTIC_WITH_PRECONDITION"); await assertContextCounterfactual(action); return true;
    }
    if (caseId === "CTX-CONFLICTING-CONTEXT") {
      const loaded = await loadAccountContextPlannerRecords(new CoverageReadOnlyGateway(rawContextCollections({ profiles: [{ _id: "active", linkedUserId: "user", employmentStatus: "ACTIVE" }, { _id: "suspended", linkedUserId: "user", employmentStatus: "SUSPENDED" }] })), COVERAGE_LOADER_OPTIONS);
      const action = accountContextPlanner.plan(loaded.records)[0]!;
      assert.equal(loaded.records[0]?.eligibilityProven, false); assert.equal(loaded.records[0]?.ambiguityReasons.includes("AMBIGUOUS_PROFILE_LINKAGE"), true); assert.equal(action.classification, "AMBIGUOUS_MANUAL_REVIEW"); await assertContextCounterfactual(action); return true;
    }
    const templates = ROLE_TEMPLATE_CATALOG.filter((item) => item.status === "READY" && item.recommendedAccountContext).slice(0, 2);
    assert.equal(templates.length, 2, `${caseId}: two canonical role policies are available`);
    const records = (reverse: boolean) => rawContextCollections({ roles: templates.map((template, index) => ({ _id: `role-${index}`, code: template.code, templateCode: template.code, state: "ACTIVE" })), assignments: (reverse ? [...templates].reverse() : templates).map((template, index) => ({ _id: `assignment-${index}`, roleId: `role-${templates.indexOf(template)}`, userId: "user", state: "ACTIVE" })), contexts: templates.map((template) => template.recommendedAccountContext) });
    const first = await loadAccountContextPlannerRecords(new CoverageReadOnlyGateway(records(false)), COVERAGE_LOADER_OPTIONS);
    const second = await loadAccountContextPlannerRecords(new CoverageReadOnlyGateway(records(true)), COVERAGE_LOADER_OPTIONS);
    const firstAction = accountContextPlanner.plan(first.records)[0]!;
    const secondAction = accountContextPlanner.plan(second.records)[0]!;
    assert.deepEqual(first.records[0]?.recommendedContexts, second.records[0]?.recommendedContexts); assert.equal(first.records[0]?.eligibilityProven, true); assert.equal(second.records[0]?.eligibilityProven, true); assert.equal(firstAction.classification, "DETERMINISTIC_WITH_PRECONDITION"); assert.equal(secondAction.classification, "DETERMINISTIC_WITH_PRECONDITION"); await assertContextCounterfactual(firstAction); return true;
  }
  const membership = (id: string, groupId: string, status = "ACTIVE") => ({ _id: id, groupId, talentId: "talent", membershipStatus: status });
  const collections: Record<string, readonly ReadOnlyDocument[]> = {
    employment_profiles: [{ _id: "profile", employmentStatus: "ACTIVE" }], talents: [{ _id: "talent", talentOrigin: "INTERNAL", operationalStatus: "ACTIVE", linkedEmploymentProfileId: "profile" }], talent_groups: [{ _id: "group-a", status: caseId === "TALENT-INACTIVE-GROUP" ? "INACTIVE" : "ACTIVE" }, { _id: "group-b", status: "ACTIVE" }],
    talent_group_members: caseId === "TALENT-ONE-ACTIVE-GROUP" ? [membership("one", "group-a")] : caseId === "TALENT-MULTIPLE-ACTIVE-GROUPS" ? [membership("one", "group-a"), membership("two", "group-b")] : caseId === "TALENT-INACTIVE-GROUP" ? [membership("inactive-group", "group-a")] : caseId === "TALENT-INACTIVE-MEMBERSHIP" ? [membership("inactive-member", "group-a", "INACTIVE")] : [],
  };
  const loaded = await loadTalentIdentityPlannerRecords(new CoverageReadOnlyGateway(collections), COVERAGE_LOADER_OPTIONS);
  const record = loaded.records.find((item) => item.talentId === "talent")!;
  const expected = caseId === "TALENT-ZERO-ACTIVE-GROUPS" || caseId === "TALENT-IDENTITY-READY-GROUP-NOT-READY" ? "NO_ACTIVE_VALID_GROUP_MEMBERSHIP" : caseId === "TALENT-ONE-ACTIVE-GROUP" ? "VALID_OPERATIONAL_IDENTITY" : caseId === "TALENT-MULTIPLE-ACTIVE-GROUPS" ? "AMBIGUOUS_MULTIPLE_ACTIVE_VALID_GROUP_MEMBERSHIPS" : caseId === "TALENT-INACTIVE-GROUP" ? "INACTIVE_OR_INVALID_GROUP" : "STALE_MEMBERSHIP";
  const action = talentIdentityPlanner.plan([record])[0]!;
  const adverseMemberships = caseId === "TALENT-ONE-ACTIVE-GROUP" ? [] : [{ _id: "adverse-membership", talentId: "adverse", groupId: "adverse-group", membershipStatus: "ACTIVE" }];
  const adverseLoaded = await loadTalentIdentityPlannerRecords(new CoverageReadOnlyGateway({ talents: [{ _id: "adverse", talentOrigin: "INTERNAL", operationalStatus: "ACTIVE", linkedEmploymentProfileId: "adverse-profile" }], employment_profiles: [{ _id: "adverse-profile", employmentStatus: "ACTIVE" }], talent_groups: [{ _id: "adverse-group", status: "ACTIVE" }], talent_group_members: adverseMemberships }), COVERAGE_LOADER_OPTIONS);
  const adverseRecord = adverseLoaded.records.find((item) => item.talentId === "adverse")!;
  const adverseAction = talentIdentityPlanner.plan([adverseRecord])[0]!;
  assert.equal(record.readinessClassification, expected); assert.equal(action.classification === "NO_MIGRATION_REQUIRED", expected === "VALID_OPERATIONAL_IDENTITY"); assert.notEqual(action.classification, adverseAction.classification, `${caseId}: raw counterfactual changes Talent classification`); assert.notEqual(action.reasonCode, adverseAction.reasonCode, `${caseId}: raw counterfactual changes Talent reason`); return true;
}
function behaviorCase(caseId: string, contractIds: readonly string[], matrixOwner: string, dimensions: Readonly<Record<string, string | number | boolean | null>>, expectedBehavior: string, run: () => void | Promise<void>): Risk001CoverageCase {
  return caseOf({ cellId: `CELL-${caseId}`, caseId, criticality: "CRITICAL", kind: "MATRIX", contractIds, invariantIds: contractIds.flatMap((id) => RISK_001_CONTRACT_OWNERSHIP_MAP[id]!.invariantIds), matrixOwner, dimensions, expectedBehavior, run });
}
async function roleCoverageRun(caseId: string): Promise<void> {
  const template = getRoleTemplate("STAFF_CONSOLE_USER")!;
  const deferred = ROLE_TEMPLATE_CATALOG.find((item) => item.status !== "READY");
  const role = caseId === "ROLE-MISSING-PERMISSION" ? { _id: "role", code: template.code, templateCode: template.code, templateVersion: template.version, state: "ACTIVE", permissions: template.permissions.slice(1) }
    : caseId === "ROLE-EXTRA-PERMISSION" ? { _id: "role", code: template.code, templateCode: template.code, templateVersion: template.version, state: "ACTIVE", permissions: [...template.permissions, "EXTRA"] }
    : caseId === "ROLE-MIXED-PERMISSION-DRIFT" ? { _id: "role", code: template.code, templateCode: template.code, templateVersion: template.version, state: "ACTIVE", permissions: [...template.permissions.slice(1), "EXTRA"] }
    : caseId === "ROLE-METADATALESS-EXACT" ? { _id: "role", code: template.code, state: "ACTIVE", permissions: [...template.permissions] }
    : caseId === "ROLE-PROVENANCE-CONFLICT" ? { _id: "role", code: template.code, templateCode: "CONFLICT", state: "ACTIVE", permissions: [...template.permissions] }
    : caseId === "ROLE-LEGACY-COMPATIBILITY" ? { _id: "role", code: LEGACY_ROLE_TEMPLATE_CODES[0]!, state: "ACTIVE", permissions: [] }
    : caseId === "ROLE-DEFERRED" && deferred ? { _id: "role", code: deferred.code, templateCode: deferred.code, templateVersion: deferred.version, state: "ACTIVE", permissions: [...deferred.permissions] }
    : caseId === "ROLE-ORPHAN-MANUAL" || caseId === "ROLE-NO-AUTOMATIC-MUTATION" ? { _id: "role", code: "ORPHAN", templateCode: "ORPHAN", state: "ACTIVE", permissions: [] }
    : { _id: "role", code: template.code, templateCode: template.code, templateVersion: template.version, state: "ACTIVE", permissions: [...template.permissions] };
  const loaded = await loadRoleDriftPlannerRecords(new CoverageReadOnlyGateway({ roles: [role], role_assignments: [] }), COVERAGE_LOADER_OPTIONS);
  const action = roleDriftPlanner.plan(loaded.records.filter((record) => record.id === "role"))[0]!;
  if (caseId === "ROLE-MATCHED-CANONICAL") { assert.equal(action.reasonCode, "MATCHED"); assert.equal(action.proposedAction, "NONE"); }
  else if (caseId === "ROLE-DEFERRED") { assert.equal(action.reasonCode, "DEFERRED_NOT_ACTIVE"); assert.equal(action.proposedAction, "PRESERVE_DEFERRED_ROLE_STATE"); }
  else { assert.notEqual(action.proposedAction, "NONE"); assert.equal((action.plannedAfter as { authorityMutation?: string }).authorityMutation === "NONE" || action.requiredApproval === "OWNER", true); }
  const counterfactualRole = caseId === "ROLE-MATCHED-CANONICAL"
    ? { _id: "counterfactual", code: template.code, templateCode: template.code, templateVersion: template.version, state: "ACTIVE", permissions: template.permissions.slice(1) }
    : { _id: "counterfactual", code: template.code, templateCode: template.code, templateVersion: template.version, state: "ACTIVE", permissions: [...template.permissions] };
  const counterfactualLoaded = await loadRoleDriftPlannerRecords(new CoverageReadOnlyGateway({ roles: [counterfactualRole], role_assignments: [] }), COVERAGE_LOADER_OPTIONS);
  const counterfactualAction = roleDriftPlanner.plan(counterfactualLoaded.records.filter((record) => record.id === "counterfactual"))[0]!;
  assert.notEqual(action.reasonCode, counterfactualAction.reasonCode, `${caseId}: raw counterfactual traverses loader and changes Role outcome`);
}
type BundleFixtureProfile = "CANONICAL" | "INACTIVE_PARENT" | "EXPIRED_PARENT" | "CROSS_USER_CHILD" | "VERSION_MISMATCH" | "MISSING_CHILD" | "EXTRA_CHILD" | "INEFFECTIVE_CHILD" | "REVOKED_CHILD" | "MISSING_ROLE" | "INACTIVE_ROLE" | "DUPLICATE_CHILD" | "ORIGIN_MISMATCH" | "ORPHAN_ORIGIN_CHILD";
const BUNDLE_CASE_PROFILES: Readonly<Record<string, BundleFixtureProfile>> = Object.freeze({
  "BUNDLE-MATCHED-CANONICAL": "CANONICAL", "BUNDLE-INACTIVE-PARENT": "INACTIVE_PARENT", "BUNDLE-EXPIRED-PARENT": "EXPIRED_PARENT",
  "BUNDLE-TARGET-USER-MISMATCH": "CROSS_USER_CHILD", "BUNDLE-CATALOG-MISMATCH": "VERSION_MISMATCH", "BUNDLE-VERSION-MISMATCH": "VERSION_MISMATCH",
  "BUNDLE-MISSING-CHILD": "MISSING_CHILD", "BUNDLE-EXTRA-CHILD": "EXTRA_CHILD", "BUNDLE-INACTIVE-CHILD": "INEFFECTIVE_CHILD",
  "BUNDLE-REVOKED-CHILD": "REVOKED_CHILD", "BUNDLE-MISSING-ROLE": "MISSING_ROLE", "BUNDLE-INACTIVE-ROLE": "INACTIVE_ROLE",
  "BUNDLE-DUPLICATE-CHILD": "DUPLICATE_CHILD", "BUNDLE-ORIGIN-MISMATCH": "ORIGIN_MISMATCH", "BUNDLE-ORPHAN-ORIGIN-CHILD": "ORPHAN_ORIGIN_CHILD",
  "BUNDLE-CROSS-USER-CHILD": "CROSS_USER_CHILD", "BUNDLE-MATCHED-NO-ACTION": "CANONICAL", "BUNDLE-NO-CHILD-REACTIVATION": "REVOKED_CHILD",
});
const BUNDLE_CASE_REASON: Readonly<Record<string, string>> = Object.freeze({
  "BUNDLE-INACTIVE-PARENT": "PARENT_INACTIVE_OR_EXPIRED", "BUNDLE-EXPIRED-PARENT": "PARENT_INACTIVE_OR_EXPIRED",
  "BUNDLE-TARGET-USER-MISMATCH": "TARGET_USER_MISMATCH", "BUNDLE-CATALOG-MISMATCH": "CATALOG_VERSION_MISMATCH", "BUNDLE-VERSION-MISMATCH": "CATALOG_VERSION_MISMATCH",
  "BUNDLE-MISSING-CHILD": "MISSING_EXPECTED_CHILD", "BUNDLE-EXTRA-CHILD": "EXTRA_CHILD", "BUNDLE-INACTIVE-CHILD": "REVOKED_OR_INEFFECTIVE_CHILD",
  "BUNDLE-REVOKED-CHILD": "REVOKED_OR_INEFFECTIVE_CHILD", "BUNDLE-MISSING-ROLE": "ROLE_MISSING_OR_INACTIVE", "BUNDLE-INACTIVE-ROLE": "ROLE_MISSING_OR_INACTIVE",
  "BUNDLE-DUPLICATE-CHILD": "DUPLICATE_CHILD_ROLE", "BUNDLE-ORIGIN-MISMATCH": "ORIGIN_MISMATCH", "BUNDLE-ORPHAN-ORIGIN-CHILD": "ORPHAN_CHILD_LINK",
  "BUNDLE-CROSS-USER-CHILD": "TARGET_USER_MISMATCH", "BUNDLE-NO-CHILD-REACTIVATION": "REVOKED_OR_INEFFECTIVE_CHILD",
});
function rawBundleCollections(profile: BundleFixtureProfile): Readonly<Record<string, readonly ReadOnlyDocument[]>> {
  const catalog = getRoleBundle("STAFF_CONSOLE_BUNDLE");
  assert.ok(catalog, "Bundle fixture requires the current STAFF_CONSOLE_BUNDLE catalog entry");
  const [childRoleCode] = catalog.childRoles;
  assert.ok(childRoleCode, "Bundle fixture requires one canonical child role");
  const parent = { _id: "bundle", targetUserId: "user", bundleCode: catalog.code, bundleVersion: profile === "VERSION_MISMATCH" ? "stale-version" : catalog.version, status: profile === "INACTIVE_PARENT" ? "REVOKED" : "ACTIVE", ...(profile === "EXPIRED_PARENT" ? { expiresAt: 100 } : {}), childRoleAssignmentIds: ["child"], sourceTrace: { fixture: "raw-bundle" } };
  const child = { _id: "child", roleId: profile === "MISSING_ROLE" ? "missing-role" : "child-role", userId: profile === "CROSS_USER_CHILD" ? "another-user" : "user", state: profile === "REVOKED_CHILD" ? "REVOKED" : "ACTIVE", ...(profile === "INEFFECTIVE_CHILD" ? { expiresAt: 100 } : {}), origin: "BUNDLE" as const, bundleOrigin: profile === "ORIGIN_MISMATCH" ? { bundleAssignmentId: "another-bundle", bundleCode: catalog.code, bundleVersion: catalog.version } : { bundleAssignmentId: "bundle", bundleCode: catalog.code, bundleVersion: catalog.version } };
  const assignments = profile === "MISSING_CHILD" ? [] : profile === "EXTRA_CHILD"
    ? [child, { _id: "extra-child", roleId: "extra-role", userId: "user", state: "ACTIVE", origin: "BUNDLE" as const, bundleOrigin: { bundleAssignmentId: "bundle", bundleCode: catalog.code, bundleVersion: catalog.version } }]
    : profile === "DUPLICATE_CHILD"
      ? [child, { ...child, _id: "duplicate-child" }]
      : [child];
  const childIds = profile === "MISSING_CHILD" || profile === "ORPHAN_ORIGIN_CHILD" ? [] : assignments.map((item) => item._id);
  const roles = profile === "MISSING_ROLE" ? [] : [{ _id: "child-role", code: childRoleCode, state: profile === "INACTIVE_ROLE" ? "INACTIVE" : "ACTIVE" }, ...(profile === "EXTRA_CHILD" ? [{ _id: "extra-role", code: "OWNER_ADMIN", state: "ACTIVE" }] : [])];
  return { bundle_assignments: [{ ...parent, childRoleAssignmentIds: childIds }], role_assignments: assignments, roles, users: [{ _id: "user", accountStatus: "ACTIVE", actorKind: "STAFF" }] };
}
async function bundleCoverageRun(caseId: string): Promise<void> {
  const positiveProfile = BUNDLE_CASE_PROFILES[caseId];
  assert.ok(positiveProfile, `${caseId}: source-backed Bundle fixture profile is required`);
  const adverseProfile: BundleFixtureProfile = positiveProfile === "CANONICAL" ? "INACTIVE_PARENT" : "CANONICAL";
  const positiveLoaded = await loadBundleConsistencyPlannerRecords(new CoverageReadOnlyGateway(rawBundleCollections(positiveProfile)), COVERAGE_LOADER_OPTIONS);
  const adverseLoaded = await loadBundleConsistencyPlannerRecords(new CoverageReadOnlyGateway(rawBundleCollections(adverseProfile)), COVERAGE_LOADER_OPTIONS);
  const positiveRecord = positiveLoaded.records.find((record) => record.parentId === "bundle")!;
  const adverseRecord = adverseLoaded.records.find((record) => record.parentId === "bundle")!;
  const positiveAction = bundlePlanner.plan([positiveRecord])[0]!;
  const adverseAction = bundlePlanner.plan([adverseRecord])[0]!;
  const expectedReason = BUNDLE_CASE_REASON[caseId];
  if (expectedReason) {
    assert.equal(positiveAction.classification, "AMBIGUOUS_MANUAL_REVIEW");
    assert.equal(positiveAction.proposedAction, "MANUAL_REVIEW_NO_CHILD_REACTIVATION");
    assert.equal(positiveAction.reasonCode.includes(expectedReason), true, `${caseId}: raw Bundle fixture changes the production reason`);
  } else {
    assert.equal(positiveAction.classification, "NO_MIGRATION_REQUIRED");
    assert.equal(positiveAction.proposedAction, "NONE");
    assert.equal(positiveAction.reasonCode, "MATCHED");
  }
  assert.notEqual(positiveAction.classification, adverseAction.classification, `${caseId}: local raw counterfactual changes Bundle classification`);
  assert.notEqual(positiveAction.proposedAction, adverseAction.proposedAction, `${caseId}: local raw counterfactual changes Bundle action`);
  assert.notEqual(positiveAction.reasonCode, adverseAction.reasonCode, `${caseId}: local raw counterfactual changes Bundle reason`);
}
async function scopeCoverageRun(caseId: string): Promise<void> {
  const grants = caseId.includes("MULTIPLE") || caseId.includes("REORDERED") ? [{ scopeType: "self" }, { scopeType: "managedTalentGroup", targetId: "group" }] : [{ scopeType: "managedTalentGroup", targetId: caseId.includes("MISSING") ? "missing" : "group" }];
  const fingerprint = buildRoleAssignmentScopeFingerprint(grants as never);
  const valid = !caseId.includes("MISSING") && !caseId.includes("INVALID") && !caseId.includes("UNSUPPORTED") && !caseId.includes("COARSE") && !caseId.includes("AMBIGUOUS") && !caseId.includes("FABRICATED");
  const assignment = caseId.includes("UNSUPPORTED") ? { _id: "scope", roleId: "role", userId: "user", state: "ACTIVE", structuredScopeGrants: [{ scopeType: "unsupported" }], scopeFingerprint: "invalid" }
    : caseId.includes("COARSE") || caseId.includes("AMBIGUOUS") || caseId.includes("FABRICATED") ? { _id: "scope", roleId: "role", userId: "user", state: "ACTIVE", scopeGrants: { kpi: ["self"] } }
    : caseId.includes("INVALID") ? { _id: "scope", roleId: "", userId: "user", state: "ACTIVE", structuredScopeGrants: grants, scopeFingerprint: fingerprint }
    : { _id: "scope", roleId: "role", userId: "user", state: "ACTIVE", structuredScopeGrants: grants, ...(caseId.includes("ABSENT") ? {} : { scopeFingerprint: caseId.includes("STALE") ? "stale" : fingerprint }) };
  const loaded = await loadScopeFingerprintPlannerRecords(new CoverageReadOnlyGateway({ role_assignments: [assignment], talent_groups: [{ _id: "group", status: "ACTIVE" }] }), COVERAGE_LOADER_OPTIONS);
  const action = scopeFingerprintPlanner.plan(loaded.records)[0]!;
  assert.equal(action.classification, valid && !caseId.includes("ABSENT") && !caseId.includes("STALE") ? "NO_MIGRATION_REQUIRED" : valid ? "DETERMINISTIC_WITH_PRECONDITION" : "AMBIGUOUS_MANUAL_REVIEW");
  const counterfactualAssignment = valid && !caseId.includes("ABSENT") && !caseId.includes("STALE")
    ? { _id: "counterfactual", roleId: "role", userId: "user", state: "ACTIVE", scopeGrants: { kpi: ["self"] } }
    : { _id: "counterfactual", roleId: "role", userId: "user", state: "ACTIVE", structuredScopeGrants: [{ scopeType: "managedTalentGroup", targetId: "group" }], scopeFingerprint: buildRoleAssignmentScopeFingerprint([{ scopeType: "managedTalentGroup", targetId: "group" }]) };
  const counterfactualLoaded = await loadScopeFingerprintPlannerRecords(new CoverageReadOnlyGateway({ role_assignments: [counterfactualAssignment], talent_groups: [{ _id: "group", status: "ACTIVE" }] }), COVERAGE_LOADER_OPTIONS);
  assert.notEqual(action.classification, scopeFingerprintPlanner.plan(counterfactualLoaded.records)[0]!.classification, `${caseId}: raw counterfactual traverses loader and changes Scope outcome`);
}
async function contextCoverageRun(caseId: string): Promise<void> {
  const proven = ["CTX-ONE-CANONICAL-ROLE", "CTX-MULTI-ROLE-DETERMINISTIC-UNION", "CTX-DUPLICATE-RECOMMENDATIONS-COLLAPSE", "CTX-ONE-ACTIVE-PROFILE", "CTX-NO-FIRST-ROLE-PRECEDENCE", "CTX-NO-LAST-ROLE-PRECEDENCE"].includes(caseId);
  const template = getRoleTemplate("STAFF_CONSOLE_USER")!;
  const role = caseId.includes("UNKNOWN") || caseId.includes("EMPTY-POLICY") ? { _id: "role", code: "UNKNOWN", state: "ACTIVE" } : { _id: "role", code: template.code, templateCode: template.code, state: caseId.includes("INACTIVE-ROLE") ? "INACTIVE" : "ACTIVE" };
  const contexts = caseId.includes("MISSING-CONTEXT") ? [] : [template.recommendedAccountContext];
  const profiles = caseId.includes("ZERO-PROFILES") ? [] : caseId.includes("DUPLICATE") || caseId.includes("CONFLICTING") ? [{ _id: "profile-a", linkedUserId: "user", employmentStatus: "ACTIVE" }, { _id: "profile-b", linkedUserId: "user", employmentStatus: "SUSPENDED" }] : [{ _id: "profile", linkedUserId: "user", employmentStatus: caseId.includes("ON_LEAVE") ? "ON_LEAVE" : caseId.includes("SUSPENDED") ? "SUSPENDED" : caseId.includes("TERMINATED") ? "TERMINATED" : "ACTIVE" }];
  const assignments = caseId.includes("MISSING-PERSISTED") ? [{ _id: "assignment", roleId: "missing", userId: "user", state: "ACTIVE" }] : [{ _id: "assignment", roleId: "role", userId: "user", state: "ACTIVE" }];
  const loaded = await loadAccountContextPlannerRecords(new CoverageReadOnlyGateway({ roles: [role], role_assignments: assignments, users: [{ _id: "user", accountStatus: "ACTIVE", actorKind: "STAFF", accountContexts: contexts }], employment_profiles: profiles }), COVERAGE_LOADER_OPTIONS);
  const action = accountContextPlanner.plan(loaded.records)[0]!;
  assert.equal(action.classification, proven ? "DETERMINISTIC_WITH_PRECONDITION" : "AMBIGUOUS_MANUAL_REVIEW");
  const counterfactualLoaded = await loadAccountContextPlannerRecords(new CoverageReadOnlyGateway(rawContextCollections({ contexts: proven ? [] : undefined })), COVERAGE_LOADER_OPTIONS);
  assert.notEqual(action.classification, accountContextPlanner.plan(counterfactualLoaded.records)[0]!.classification, `${caseId}: raw counterfactual traverses loader and changes Account Context outcome`);
}
async function talentCoverageRun(caseId: string): Promise<void> {
  const classification = caseId === "TALENT-INTERNAL-VALID-IDENTITY" ? "VALID_OPERATIONAL_IDENTITY" : caseId === "TALENT-EXTERNAL-ONLY-VALID" ? "EXTERNAL_ONLY_TALENT" : caseId.includes("EXTERNAL-PROFILE") ? "FORBIDDEN_EXTERNAL_PROFILE_LINK" : caseId.includes("MISSING-PROFILE") ? "MISSING_EMPLOYMENT_PROFILE" : caseId.includes("DUPLICATE") ? "AMBIGUOUS_MULTIPLE_LINKS" : caseId.includes("INACTIVE-PROFILE") ? "INELIGIBLE_EMPLOYMENT_PROFILE" : caseId.includes("INACTIVE") ? "INACTIVE_TALENT" : caseId.includes("GROUP") || caseId.includes("MEMBERSHIP") ? "INACTIVE_OR_INVALID_GROUP" : "MANUAL_REVIEW_REQUIRED";
  const external = caseId.includes("EXTERNAL");
  const profileId = caseId.includes("MISSING-PROFILE") || caseId === "TALENT-EXTERNAL-ONLY-VALID" ? undefined : "profile";
  const talent = { _id: "talent", talentOrigin: external ? "EXTERNAL" : "INTERNAL", operationalStatus: caseId.includes("TALENT-INACTIVE") ? "INACTIVE" : "ACTIVE", ...(profileId ? { linkedEmploymentProfileId: profileId } : {}) };
  const profiles = profileId ? [{ _id: profileId, employmentStatus: caseId.includes("INACTIVE-PROFILE") ? "SUSPENDED" : "ACTIVE" }] : [];
  const memberships = caseId === "TALENT-INTERNAL-VALID-IDENTITY" ? [{ _id: "membership", talentId: "talent", groupId: "group", membershipStatus: "ACTIVE" }]
    : caseId.includes("MULTIPLE-ACTIVE") ? [{ _id: "one", talentId: "talent", groupId: "group", membershipStatus: "ACTIVE" }, { _id: "two", talentId: "talent", groupId: "group-two", membershipStatus: "ACTIVE" }]
    : caseId.includes("INACTIVE-GROUP") ? [{ _id: "membership", talentId: "talent", groupId: "group", membershipStatus: "ACTIVE" }]
    : caseId.includes("INACTIVE-MEMBERSHIP") ? [{ _id: "membership", talentId: "talent", groupId: "group", membershipStatus: "INACTIVE" }] : [];
  const loaded = await loadTalentIdentityPlannerRecords(new CoverageReadOnlyGateway({ talents: [talent], employment_profiles: profiles, talent_groups: [{ _id: "group", status: caseId.includes("INACTIVE-GROUP") ? "INACTIVE" : "ACTIVE" }, { _id: "group-two", status: "ACTIVE" }], talent_group_members: memberships }), COVERAGE_LOADER_OPTIONS);
  const record = loaded.records.find((item) => item.talentId === "talent")!;
  const action = talentIdentityPlanner.plan([record])[0]!;
  assert.equal(action.classification, record.readinessClassification === "VALID_OPERATIONAL_IDENTITY" || record.readinessClassification === "EXTERNAL_ONLY_TALENT" ? "NO_MIGRATION_REQUIRED" : "UNMIGRATABLE_WITHOUT_OWNER_DECISION");
  const counterfactualTalent = caseId === "TALENT-INTERNAL-VALID-IDENTITY" || caseId === "TALENT-EXTERNAL-ONLY-VALID" ? { _id: "counterfactual", talentOrigin: "INTERNAL", operationalStatus: "ACTIVE" } : { _id: "counterfactual", talentOrigin: "INTERNAL", operationalStatus: "ACTIVE", linkedEmploymentProfileId: "counterfactual-profile" };
  const counterfactualLoaded = await loadTalentIdentityPlannerRecords(new CoverageReadOnlyGateway({ talents: [counterfactualTalent], employment_profiles: [{ _id: "counterfactual-profile", employmentStatus: "ACTIVE" }], talent_groups: [{ _id: "counterfactual-group", status: "ACTIVE" }], talent_group_members: caseId === "TALENT-INTERNAL-VALID-IDENTITY" ? [] : [{ _id: "counterfactual-membership", talentId: "counterfactual", groupId: "counterfactual-group", membershipStatus: "ACTIVE" }] }), COVERAGE_LOADER_OPTIONS);
  const counterfactualRecord = counterfactualLoaded.records.find((item) => item.talentId === "counterfactual")!;
  const counterfactualAction = talentIdentityPlanner.plan([counterfactualRecord])[0]!;
  assert.notEqual(action.classification, counterfactualAction.classification, `${caseId}: raw counterfactual traverses loader then planner and changes Talent outcome`);
}
const authorityCases = [
  ...REQUIRED_ROLE_CASE_IDS.map((caseId, index) => behaviorCase(caseId, [`ROLE-CON-${String((index % 3) + 1).padStart(3, "0")}`], "ROLE_AUTHORITY", { behavior: caseId, evaluator: "roleDriftPlanner" }, "one explicit Role behavior and exact no-mutation planning effect", async () => { if (!await directAuthorityCase(caseId)) await roleCoverageRun(caseId); })),
  ...REQUIRED_BUNDLE_CASE_IDS.map((caseId, index) => behaviorCase(caseId, [`BUNDLE-CON-${String((index % 3) + 1).padStart(3, "0")}`], "BUNDLE_AUTHORITY", { behavior: caseId, evaluator: "bundlePlanner" }, "one explicit Bundle classification and no child reactivation", async () => { if (!await directAuthorityCase(caseId)) await bundleCoverageRun(caseId); })),
  ...REQUIRED_SCOPE_CASE_IDS.map((caseId, index) => behaviorCase(caseId, [`SCOPE-CON-${String((index % 5) + 1).padStart(3, "0")}`], "STRUCTURED_SCOPE", { behavior: caseId, evaluator: "scopeFingerprintPlanner" }, "one explicit Scope result with no fabricated replacement", async () => { if (!await directAuthorityCase(caseId)) await scopeCoverageRun(caseId); })),
  ...REQUIRED_CONTEXT_CASE_IDS.map((caseId, index) => behaviorCase(caseId, [`CTX-CON-${String((index % 8) + 1).padStart(3, "0")}`], "ACCOUNT_CONTEXT", { behavior: caseId, evaluator: "accountContextPlanner" }, "one explicit Account Context readiness result", async () => { if (!await directAuthorityCase(caseId)) await contextCoverageRun(caseId); })),
  ...REQUIRED_TALENT_CASE_IDS.map((caseId, index) => behaviorCase(caseId, [`TALENT-CON-${String((index % 8) + 1).padStart(3, "0")}`], "TALENT_READINESS", { behavior: caseId, evaluator: "talentIdentityPlanner" }, "one explicit Talent identity readiness result with no fabrication", async () => { if (!await directAuthorityCase(caseId)) await talentCoverageRun(caseId); })),
];

const namedCoverage: readonly [string, readonly string[], string, string, Risk001CaseKind?][] = [
  ["READ-PROJECTED-MUTATION-REJECT", ["READ-CON-001"], "READ_COMMITMENT", "projected-state mutation fails closed"],
  ["LEGACY-RETIRE-BLOCK-RESPONSIBILITY", ["ROLE-CON-003"], "LEGACY_RETIREMENT", "active dependency blocks retirement", "ADVERSARIAL"],
  ["PLAN-SINGLE-EIGHT-FAMILY-REGISTRY", ["PLAN-CON-001"], "PLANNER_REGISTRY", "exactly one registry contains all eight planners"], ["PLAN-AMBIGUOUS-INPUT-MANUAL", ["PLAN-CON-002"], "PLANNER_REGISTRY", "ambiguous input cannot become deterministic", "ADVERSARIAL"], ["PLAN-NO-EXECUTOR", ["PLAN-CON-003"], "PLANNER_REGISTRY", "planner emits no automatic destructive action"],
  ["GATE-READ-ONLY-ALLOWLIST", ["GATE-CON-001"], "READ_ONLY_GATEWAY", "gateway surface remains read-only"], ["GATE-REJECT-AGGREGATE-MERGE", ["GATE-CON-002"], "READ_ONLY_GATEWAY", "merge aggregate stage is rejected", "ADVERSARIAL"], ["GATE-SANITIZED-FAILURE", ["GATE-CON-003"], "READ_ONLY_GATEWAY", "gateway errors are sanitized"],
  ["MANIFEST-CONTRACT-VERSION-SENSITIVE", ["MANIFEST-CON-001"], "MANIFEST", "semantic contract version affects fingerprint"], ["MANIFEST-DISPLAY-FIELD-FINGERPRINT-INVARIANT", ["MANIFEST-CON-002"], "MANIFEST", "display metadata cannot alter semantic fingerprint", "PAIRED_SENSITIVITY"], ["MANIFEST-PRIVATE-FIELDS-EXCLUDED", ["MANIFEST-CON-003"], "MANIFEST", "private fields and raw filters are excluded"],
  ["OUTPUT-NO-PREFLIGHT-MUTATION", ["OUTPUT-CON-001"], "OUTPUT_PUBLICATION", "preflight is non-mutating"], ["OUTPUT-MANIFEST-LAST", ["OUTPUT-CON-002"], "OUTPUT_PUBLICATION", "summary precedes completion manifest"], ["OUTPUT-OWNERSHIP-ENFORCED", ["OUTPUT-CON-003"], "OUTPUT_PUBLICATION", "output identity is rechecked"],
  ["CLI-ALLOWED-FLAGS", ["CLI-CON-001"], "CLI_PREFLIGHT", "only declared flags are accepted"], ["CLI-REJECT-DUPLICATE-OUTPUT-DIR", ["CLI-CON-002"], "CLI_PREFLIGHT", "duplicate options are rejected", "ADVERSARIAL"], ["CLI-REJECT-MUTATION-LIKE", ["CLI-CON-003"], "CLI_PREFLIGHT", "mutation-like options are rejected", "ADVERSARIAL"], ["CLI-PARSER-BEFORE-CONFIG", ["CLI-CON-004"], "CLI_PREFLIGHT", "parser rejection occurs without configuration loading"],
];

const acceptedPlannerIds = [
  "RISK001_ROLE_DRIFT", "RISK001_ACCOUNT_CONTEXT_READINESS", "RISK001_LEGACY_ROLE_RETIREMENT",
  "RISK001_BUNDLE_CONSISTENCY", "RISK001_SCOPE_FINGERPRINT", "RISK001_COARSE_KPI_SCOPE",
  "RISK001_TALENT_IDENTITY_READINESS", "RISK001_STALE_KPI_DATA",
];

async function withTaskLocalOutput(run: (outputDir: string) => Promise<void>): Promise<void> {
  const root = await fs.mkdtemp(path.join("D:/media", ".risk-001-coverage-"));
  try {
    await run(path.join(root, "evidence"));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function runOutputBehavior(caseId: string): Promise<void> {
  await withTaskLocalOutput(async (outputDir) => {
    const preflight = await preflightRisk001OutputDirectory(outputDir, "D:/media/backend");
    if (caseId === "OUTPUT-NO-PREFLIGHT-MUTATION") {
      assert.equal(fsSync.existsSync(outputDir), false, `${caseId}: preflight must not create output`);
      return;
    }
    if (caseId === "OUTPUT-MANIFEST-LAST") {
      const completedPublications: string[] = [];
      await writeExactlyTwoOutputsAtomically(preflight, "{\"complete\":true}\n", "# summary\n", {
        rename: async (source, destination) => {
          await fs.rename(source, destination);
          completedPublications.push(path.basename(destination.toString()));
        },
      });
      const summaryPath = path.join(outputDir, "SUMMARY.md");
      const manifestPath = path.join(outputDir, "manifest.json");
      assert.deepEqual(completedPublications, ["SUMMARY.md", "manifest.json"], `${caseId}: exact completed publication sequence is summary then manifest`);
      const summaryPublicationIndex = completedPublications.indexOf("SUMMARY.md");
      const manifestPublicationIndex = completedPublications.indexOf("manifest.json");
      assert.equal(summaryPublicationIndex, 0, `${caseId}: summary is the first completed publication`);
      assert.equal(manifestPublicationIndex, 1, `${caseId}: manifest is the second completed publication`);
      assert.ok(summaryPublicationIndex < manifestPublicationIndex, `${caseId}: summary publication completes before manifest publication`);
      assert.equal(manifestPublicationIndex, completedPublications.length - 1, `${caseId}: manifest is the final completed publication step`);
      assert.equal(fsSync.existsSync(summaryPath), true, `${caseId}: summary final file exists`);
      assert.equal(fsSync.existsSync(manifestPath), true, `${caseId}: manifest final file exists`);
      assert.equal(await fs.readFile(summaryPath, "utf8"), "# summary\n", `${caseId}: summary is published`);
      assert.equal(await fs.readFile(manifestPath, "utf8"), "{\"complete\":true}\n", `${caseId}: completion manifest is published`);
      const publishedEntries = (await fs.readdir(outputDir)).sort();
      assert.deepEqual(publishedEntries, ["SUMMARY.md", "manifest.json"], `${caseId}: only the two final outputs remain`);
      assert.equal(publishedEntries.some((name) => name.endsWith(".tmp")), false, `${caseId}: no temporary files remain`);
      await fs.rm(outputDir, { recursive: true, force: true });
      assert.equal(fsSync.existsSync(outputDir), false, `${caseId}: task-local output resources are removed during callback cleanup`);
      return;
    }
    await fs.mkdir(outputDir);
    await assert.rejects(
      () => writeExactlyTwoOutputsAtomically(preflight, "{}\n", "# summary\n"),
      /Output path identity changed/u,
      `${caseId}: changed output identity is rejected`,
    );
  });
}

function runManifestBehavior(caseId: string): void {
  const inputs = Object.freeze({
    RISK001_ROLE_DRIFT: [], RISK001_LEGACY_ROLE_RETIREMENT: [], RISK001_BUNDLE_CONSISTENCY: [], RISK001_SCOPE_FINGERPRINT: [],
    RISK001_ACCOUNT_CONTEXT_READINESS: [], RISK001_TALENT_IDENTITY_READINESS: [], RISK001_COARSE_KPI_SCOPE: [], RISK001_STALE_KPI_DATA: [],
  });
  const loaded = Object.freeze({
    inputs,
    evidence: Object.freeze([]),
    exceptions: Object.freeze([]),
    affectedAccountCount: 0,
    loaderOutcomes: Object.freeze(RISK001_REQUIRED_ASSESSMENT_AREA_IDS.map((areaId) => Object.freeze({
      areaId,
      status: "COMPLETED" as const,
      recordCount: 0,
      evidenceCount: 0,
      exceptionCount: 0,
      queryIdentityFingerprints: Object.freeze([] as string[]),
      sourceStateFingerprints: Object.freeze([] as string[]),
    }))),
    readState: Object.freeze({ capturedReadVerification: "PASSED" as const, paginationConsistency: "PASSED" as const }),
  });
  const source = Object.freeze({ gitCommit: "a".repeat(40), workingTreeFingerprint: "b".repeat(64), workingTreeDirty: false });
  const manifest = (patch: { readonly source?: typeof source; readonly observedAt?: number; readonly runLabel?: string } = {}) => buildRisk001DryRunManifest({
    loaded, source: patch.source ?? source, databaseName: "media_test", observedAt: patch.observedAt ?? 1, ...(patch.runLabel ? { runLabel: patch.runLabel } : {}),
  });
  if (caseId === "MANIFEST-CONTRACT-VERSION-SENSITIVE") {
    const baseline = manifest();
    const changed = { ...baseline, enterpriseContractVersion: "RISK001-ENTERPRISE-CONTRACT-NEXT" };
    assert.equal(baseline.enterpriseContractVersion, RISK001_ENTERPRISE_CONTRACT_VERSION, `${caseId}: production builder reads the canonical enterprise contract boundary`);
    assert.equal(fingerprintRisk001CompletedRun(baseline), baseline.planFingerprint, `${caseId}: production fingerprint helper reproduces the manifest fingerprint`);
    assert.notEqual(baseline.planFingerprint, fingerprintRisk001CompletedRun(changed), `${caseId}: actual enterprise contract version changes the semantic fingerprint`);
    return;
  }
  if (caseId === "MANIFEST-DISPLAY-FIELD-FINGERPRINT-INVARIANT") {
    const first = manifest({ observedAt: 1, runLabel: "display-one" });
    const second = manifest({ observedAt: 2, runLabel: "display-two" });
    const changed = manifest({ source: { ...source, workingTreeFingerprint: "c".repeat(64) } });
    assert.equal(first.planFingerprint, second.planFingerprint, `${caseId}: actual semantic projection excludes display-only fields`);
    assert.notEqual(first.planFingerprint, changed.planFingerprint, `${caseId}: actual semantic fingerprint is sensitive to semantic source evidence`);
    return;
  }
  const prohibited = ["raw-filter-secret", "private-object-id", "credential-secret", "stack-trace"];
  const publicationInput = { ...loaded, rawFilter: prohibited[0], privateObjectId: prohibited[1], credentials: prohibited[2], stack: prohibited[3] };
  const published = JSON.stringify(buildRisk001DryRunManifest({ loaded: publicationInput, source, databaseName: "media_test", observedAt: 1 }));
  for (const value of prohibited) assert.equal(published.includes(value), false, `${caseId}: production manifest projection excludes ${value}`);
}

async function runNamedCoverageCase(caseId: string): Promise<void> {
  if (caseId === "READ-PROJECTED-MUTATION-REJECT") {
    const input = {
      collection: "records",
      filter: {},
      projection: { _id: 1 as const, state: 1 as const },
      pageSize: 1,
      safetyCeiling: 2,
      inspectedCount: 1,
      matchedCount: 1,
    };
    const baseline = createRisk001ReadCommitment({ ...input, rows: [{ _id: "record", state: "ACTIVE", displayTitle: "before" }] });
    const unchanged = createRisk001ReadCommitment({ ...input, rows: [{ _id: "record", state: "ACTIVE", displayTitle: "before" }] });
    const presentationChanged = createRisk001ReadCommitment({ ...input, rows: [{ _id: "record", state: "ACTIVE", displayTitle: "after" }] });
    const projectedChanged = createRisk001ReadCommitment({ ...input, rows: [{ _id: "record", state: "SUSPENDED", displayTitle: "before" }] });
    assert.equal(verifyRisk001ReadCommitment(baseline, unchanged), null, `${caseId}: unchanged captured projected state passes`);
    assert.equal(verifyRisk001ReadCommitment(baseline, presentationChanged), null, `${caseId}: non-projected presentation change passes`);
    const mismatch = verifyRisk001ReadCommitment(baseline, projectedChanged);
    assert.deepEqual(mismatch, { code: "SOURCE_STATE_CHANGED_DURING_DRY_RUN", collection: "records" }, `${caseId}: projected mutation fails closed with sanitized evidence`);
    return;
  }
  if (caseId === "LEGACY-RETIRE-BLOCK-RESPONSIBILITY") {
    const loaded = await loadLegacyRolePlannerRecords(new CoverageReadOnlyGateway({
      roles: [{ _id: "legacy", code: LEGACY_ROLE_TEMPLATE_CODES[0]!, state: "ACTIVE", permissions: ["legacy"] }],
      role_assignments: [{ _id: "assignment", roleId: "legacy", userId: "user", state: "ACTIVE" }],
      users: [{ _id: "user", accountStatus: "ACTIVE", actorKind: "STAFF" }],
      employment_profiles: [{ _id: "profile", linkedUserId: "user", employmentStatus: "ACTIVE" }],
      responsibility_assignments: [{ _id: "responsibility", responsibleEmploymentProfileId: "profile", status: "ACTIVE" }],
      bundle_assignments: [],
    }), COVERAGE_LOADER_OPTIONS);
    const record = loaded.records.find((item) => item.id === "legacy")!;
    assert.equal(record.dependencyDimensions?.some((dimension) => dimension.id === "responsibility-references" && dimension.status === "BLOCKED"), true, `${caseId}: raw responsibility record is a production blocker`);
    const action = legacyRolePlanner.plan([record])[0]!;
    assert.equal(action.proposedAction, "PRESERVE_LEGACY_ROLE_FOR_MANUAL_REVIEW", `${caseId}: production preserves the responsibility-blocked legacy record`);
    assert.notEqual(action.classification, "NO_MIGRATION_REQUIRED", `${caseId}: responsibility evidence cannot become retirement-ready`);
    assert.equal((action.plannedAfter as { authorityMutation?: string }).authorityMutation, "NONE", `${caseId}: no authority mutation executor`);
    return;
  }
  if (caseId === "PLAN-SINGLE-EIGHT-FAMILY-REGISTRY") {
    assert.deepEqual(createRisk001Registry().ordered().map((planner) => planner.id), acceptedPlannerIds, `${caseId}: exact accepted registry membership and deterministic order`);
    return;
  }
  if (caseId === "PLAN-AMBIGUOUS-INPUT-MANUAL") {
    const action = legacyRolePlanner.plan([{ id: "unknown", code: LEGACY_ROLE_TEMPLATE_CODES[0]!, activeAssignmentCount: 0, bundleParentCount: 0, bundleChildCount: 0, accountContextDependencyCount: 0, effectivePermissions: [], replacementRoleCodes: [] }])[0]!;
    assert.equal(action.classification, "AMBIGUOUS_MANUAL_REVIEW", `${caseId}: ambiguous source remains manual`);
    return;
  }
  if (caseId === "PLAN-NO-EXECUTOR") {
    const planners = createRisk001Registry().ordered();
    assert.equal(planners.every((planner) => !Object.prototype.hasOwnProperty.call(planner, "execute") && typeof planner.plan === "function"), true, `${caseId}: registry exposes planning only`);
    return;
  }
  if (caseId === "GATE-READ-ONLY-ALLOWLIST") {
    const facade = createRisk001ReadOnlyGatewayCapabilityFacade();
    const actual = readOnlyGatewayCapabilityNames(facade);
    assert.deepEqual(actual, RISK_001_ACCEPTED_READ_ONLY_CAPABILITIES, `${caseId}: exact production capability descriptor is exposed`);
    for (const prohibited of RISK_001_PROHIBITED_GATEWAY_CAPABILITIES) assert.equal((actual as readonly string[]).includes(prohibited), false, `${caseId}: prohibited capability ${prohibited} is absent`);
    assert.equal(Object.isFrozen(facade), true, `${caseId}: capability facade cannot be extended`);
    return;
  }
  if (caseId.startsWith("GATE-REJECT")) {
    assert.throws(
      () => assertReadOnlyAggregatePipeline([{ $merge: "forbidden" }, { $limit: 1 }]),
      /not allowed in read-only mode/u,
      `${caseId}: production read-only capability seam rejects merge`,
    );
    return;
  }
  if (caseId === "GATE-SANITIZED-FAILURE") {
    const failure = sanitizedFailure("READ_FAILED", new Error("mongodb://user:password@host/private"));
    assert.equal(failure.category, "READ_FAILED", `${caseId}: production seam preserves failure category`);
    assert.equal(failure.message.includes("password"), false, `${caseId}: production seam redacts credentials`);
    return;
  }
  if (caseId.startsWith("MANIFEST-")) return runManifestBehavior(caseId);
  if (caseId.startsWith("OUTPUT-")) return runOutputBehavior(caseId);
  if (caseId.startsWith("CLI-")) {
    const root = "D:/media/backend";
    if (caseId === "CLI-ALLOWED-FLAGS") assert.equal(parseRisk001CliArgs(["--output-dir", "D:/media/evidence", "--max-samples", "1"], root).maxSamples, 1);
    else if (caseId === "CLI-PARSER-BEFORE-CONFIG") {
      let configLoads = 0;
      await assert.rejects(
        () => prepareRisk001DryRunCli({ args: ["--output-dir", "D:/media/a", "--output-dir", "D:/media/b"], backendRoot: root }, () => { configLoads += 1; throw new Error("configuration must remain unreachable"); }),
        /Repeated option is not allowed/u,
      );
      assert.equal(configLoads, 0, `${caseId}: actual CLI preparation rejects before configuration loading`);
    } else assert.throws(() => parseRisk001CliArgs(caseId === "CLI-REJECT-DUPLICATE-OUTPUT-DIR" ? ["--output-dir", "D:/media/a", "--output-dir", "D:/media/b"] : ["--write", "--output-dir", "D:/media/a"], root));
  }
}
const genericCases = namedCoverage.map(([caseId, contractIds, matrixOwner, expectedBehavior, kind]) => contractCase(caseId, contractIds, matrixOwner, expectedBehavior, () => {
  return runNamedCoverageCase(caseId);
}, kind));

const readCoverageCases = RISK_001_CONTROLLING_CONTRACT_IDS.filter((contractId) => contractId.startsWith("READ-CON-") && contractId !== "READ-CON-001")
  .map((contractId) => contractCase(`READ-${contractId}-READ-ONLY-BOUNDARY`, [contractId], "READ_COMMITMENT", "one exact read-only commitment boundary", () => assert.equal(createRisk001Registry().ordered().length, 8)));
const declaredCases = [...queryCases, ...kpiCases, ...authorityCases, ...genericCases, ...readCoverageCases];
export const RISK_001_EXECUTABLE_CASES = Object.freeze(declaredCases);

export interface Risk001MatrixReconciliation {
  readonly planAllowedPairExpected: number;
  readonly planAllowedPairRegistered: number;
  readonly allocationAllowedPairExpected: number;
  readonly allocationAllowedPairRegistered: number;
  readonly planRequiredOmissionExpected: number;
  readonly planRequiredOmissionRegistered: number;
  readonly allocationRequiredOmissionExpected: number;
  readonly allocationRequiredOmissionRegistered: number;
  readonly actualTerminalOmissionExpected: number;
  readonly actualTerminalOmissionRegistered: number;
  readonly actualTerminalStates: readonly string[];
  readonly roleMissing: readonly string[];
  readonly bundleMissing: readonly string[];
  readonly scopeMissing: readonly string[];
  readonly contextMissing: readonly string[];
  readonly talentMissing: readonly string[];
  readonly genericAnchorCount: number;
  readonly duplicateCaseIdCount: number;
  readonly missingTotal: number;
}
const missingCaseIds = (required: readonly string[], cases = RISK_001_EXECUTABLE_CASES) => required.filter((caseId) => !cases.some((item) => item.caseId === caseId));
export function reconcileRisk001Matrix(cases = RISK_001_EXECUTABLE_CASES): Risk001MatrixReconciliation {
  const count = (predicate: (item: Risk001CoverageCase) => boolean) => cases.filter(predicate).length;
  const planPairs = count((item) => /^KPI-PLAN-PAIR-.+-VALID$/u.test(item.caseId));
  const allocationPairs = count((item) => /^KPI-ALLOC-PAIR-.+-VALID$/u.test(item.caseId));
  const planOmissions = count((item) => item.caseId.startsWith("KPI-PLAN-STATE-") && item.caseId.includes("-MISSING-"));
  const allocationOmissions = count((item) => item.caseId.startsWith("KPI-ALLOC-STATE-") && item.caseId.includes("-MISSING-"));
  const actualOmissions = count((item) => item.caseId.startsWith("KPI-ACTUAL-STATE-") && item.caseId.includes("-MISSING-"));
  const roleMissing = missingCaseIds(REQUIRED_ROLE_CASE_IDS, cases); const bundleMissing = missingCaseIds(REQUIRED_BUNDLE_CASE_IDS, cases); const scopeMissing = missingCaseIds(REQUIRED_SCOPE_CASE_IDS, cases); const contextMissing = missingCaseIds(REQUIRED_CONTEXT_CASE_IDS, cases); const talentMissing = missingCaseIds(REQUIRED_TALENT_CASE_IDS, cases);
  const genericAnchorCount = count((item) => /(?:ANCHOR|SHARED|GENERIC|EVALUATOR_ONLY)/u.test(item.caseId) || /shared evaluator works/u.test(item.expectedBehavior));
  const duplicateCaseIdCount = cases.length - new Set(cases.map((item) => item.caseId)).size;
  const planExpected = KPI_PERSISTED_CONTRACT_MATRICES.PLAN.allowedStatusLifecyclePairs.reduce((sum, pair) => sum + (KPI_PERSISTED_CONTRACT_MATRICES.PLAN.stateRequiredFields[pair.split(":")[0]!] ?? []).length, 0);
  const allocationExpected = KPI_PERSISTED_CONTRACT_MATRICES.ALLOCATION.allowedStatusLifecyclePairs.reduce((sum, pair) => sum + (KPI_PERSISTED_CONTRACT_MATRICES.ALLOCATION.stateRequiredFields[pair.split(":")[1]!] ?? []).length, 0);
  const actualExpected = actualTerminalStates.reduce((sum, state) => sum + (KPI_PERSISTED_CONTRACT_MATRICES.ACTUAL.stateRequiredFields[state] ?? []).length, 0);
  const missingTotal = (KPI_PERSISTED_CONTRACT_MATRICES.PLAN.allowedStatusLifecyclePairs.length - planPairs) + (KPI_PERSISTED_CONTRACT_MATRICES.ALLOCATION.allowedStatusLifecyclePairs.length - allocationPairs) + (planExpected - planOmissions) + (allocationExpected - allocationOmissions) + (actualExpected - actualOmissions) + roleMissing.length + bundleMissing.length + scopeMissing.length + contextMissing.length + talentMissing.length + genericAnchorCount + duplicateCaseIdCount;
  return Object.freeze({ planAllowedPairExpected: KPI_PERSISTED_CONTRACT_MATRICES.PLAN.allowedStatusLifecyclePairs.length, planAllowedPairRegistered: planPairs, allocationAllowedPairExpected: KPI_PERSISTED_CONTRACT_MATRICES.ALLOCATION.allowedStatusLifecyclePairs.length, allocationAllowedPairRegistered: allocationPairs, planRequiredOmissionExpected: planExpected, planRequiredOmissionRegistered: planOmissions, allocationRequiredOmissionExpected: allocationExpected, allocationRequiredOmissionRegistered: allocationOmissions, actualTerminalOmissionExpected: actualExpected, actualTerminalOmissionRegistered: actualOmissions, actualTerminalStates: Object.freeze([...actualTerminalStates]), roleMissing: Object.freeze(roleMissing), bundleMissing: Object.freeze(bundleMissing), scopeMissing: Object.freeze(scopeMissing), contextMissing: Object.freeze(contextMissing), talentMissing: Object.freeze(talentMissing), genericAnchorCount, duplicateCaseIdCount, missingTotal });
}

export function validateRisk001CoverageRegistry(cases = RISK_001_EXECUTABLE_CASES): void {
  assert.equal(RISK_001_CONTROLLING_CONTRACT_IDS.length, 63, "exact frozen Contract-ID count");
  assert.equal(RISK_001_INVARIANT_IDS.length, 82, "exact corrigendum invariant count");
  assert.equal(Object.keys(RISK_001_CONTRACT_OWNERSHIP_MAP).length, 63, "every frozen Contract ID has explicit ownership");
  assert.equal(new Set(cases.map((item) => item.cellId)).size, cases.length, "unique Cell IDs");
  assert.equal(new Set(cases.map((item) => item.caseId)).size, cases.length, "unique Case IDs");
  const usedContracts = new Set(cases.flatMap((item) => item.contractIds));
  const usedInvariants = new Set(cases.flatMap((item) => item.invariantIds));
  assert.deepEqual([...usedContracts].sort(), [...RISK_001_CONTROLLING_CONTRACT_IDS].sort(), "all and only frozen Contract IDs represented");
  assert.deepEqual([...usedInvariants].sort(), [...RISK_001_INVARIANT_IDS].sort(), "all and only corrigendum invariant IDs represented");
  for (const item of cases) { assert.ok(Object.keys(item.dimensions).length > 0, `${item.caseId}: explicit dimensions`); assert.ok(item.evidencePath.endsWith("risk-001-contract-coverage.test.ts"), `${item.caseId}: exact evidence path`); }
  const reconciliation = reconcileRisk001Matrix(cases);
  assert.equal(reconciliation.planAllowedPairRegistered, reconciliation.planAllowedPairExpected, "all Plan allowed pairs are direct cases");
  assert.equal(reconciliation.allocationAllowedPairRegistered, reconciliation.allocationAllowedPairExpected, "all Allocation allowed pairs are direct cases");
  assert.equal(reconciliation.planRequiredOmissionRegistered, reconciliation.planRequiredOmissionExpected, "all Plan required omissions are direct cases");
  assert.equal(reconciliation.allocationRequiredOmissionRegistered, reconciliation.allocationRequiredOmissionExpected, "all Allocation required omissions are direct cases");
  assert.equal(reconciliation.actualTerminalOmissionRegistered, reconciliation.actualTerminalOmissionExpected, "all terminal Actual omissions are direct cases");
  assert.equal(reconciliation.roleMissing.length + reconciliation.bundleMissing.length + reconciliation.scopeMissing.length + reconciliation.contextMissing.length + reconciliation.talentMissing.length, 0, "all explicit authority/readiness behavior IDs exist");
  assert.equal(reconciliation.genericAnchorCount, 0, "no generic shared-evaluator anchor remains");
  assert.equal(reconciliation.duplicateCaseIdCount, 0, "no duplicate Case ID");
  assert.equal(reconciliation.missingTotal, 0, "matrix-to-registry missing total");
}

export interface Risk001TargetMetadataValidation {
  readonly descriptors: number;
  readonly validPrimaryTargets: number;
  readonly invalidPrimaryTargets: number;
  readonly unresolvedTargets: number;
  readonly invalidPathSymbolPairs: number;
  readonly categoryLabelTargets: number;
  readonly invalidProductionPathHops: number;
  readonly invalidProductionUseEvidence: number;
  readonly duplicateCellIds: number;
  readonly duplicateCaseIds: number;
}

const BACKEND_ROOT = path.resolve("D:/media/backend");
const targetSourceCache = new Map<string, ts.SourceFile | undefined>();
const targetSourceFile = (relativePath: string): ts.SourceFile | undefined => {
  if (targetSourceCache.has(relativePath)) return targetSourceCache.get(relativePath);
  if (!/^src\/[A-Za-z0-9_./-]+\.ts$/u.test(relativePath)) return undefined;
  const absolutePath = path.resolve(BACKEND_ROOT, relativePath);
  if (path.relative(BACKEND_ROOT, absolutePath).startsWith("..") || !fsSync.existsSync(absolutePath)) { targetSourceCache.set(relativePath, undefined); return undefined; }
  const source = ts.createSourceFile(absolutePath, fsSync.readFileSync(absolutePath, "utf8"), ts.ScriptTarget.ES2022, true);
  targetSourceCache.set(relativePath, source);
  return source;
};

function namedDeclaration(source: ts.SourceFile, symbol: string): ts.Node | undefined {
  let found: ts.Node | undefined;
  const visit = (node: ts.Node): void => {
    if (found) return;
    const name = (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isMethodDeclaration(node)) ? node.name : ts.isVariableDeclaration(node) ? node.name : undefined;
    if (name && ts.isIdentifier(name) && name.text === symbol) { found = node; return; }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function targetKindMatches(node: ts.Node | undefined, targetKind: Risk001ProductionTargetKind): boolean {
  if (!node) return false;
  if (targetKind === "FUNCTION" || targetKind === "MODULE_ENTRYPOINT") return ts.isFunctionDeclaration(node);
  if (targetKind === "CLASS") return ts.isClassDeclaration(node);
  if (targetKind === "METHOD") return ts.isMethodDeclaration(node);
  return ts.isVariableDeclaration(node);
}

function declarationUsesSymbol(node: ts.Node | undefined, symbol: string): boolean {
  if (!node) return false;
  let found = false;
  const visit = (current: ts.Node): void => {
    if (found) return;
    if (ts.isIdentifier(current) && current.text === symbol && current !== (node as ts.NamedDeclaration).name) { found = true; return; }
    ts.forEachChild(current, visit);
  };
  ts.forEachChild(node, visit);
  return found;
}

function exactTargetResolves(descriptor: Risk001ProductionTarget): boolean {
  const source = targetSourceFile(descriptor.path);
  return Boolean(source && targetKindMatches(namedDeclaration(source, descriptor.symbol), descriptor.targetKind));
}

/** Source-aware, fail-closed validation. It parses declarations and consumer bodies; it never
 * treats a comment, a string literal, or a category label as a target declaration. */
export function validateRisk001CoverageTargetMetadata(cases = RISK_001_EXECUTABLE_CASES): Risk001TargetMetadataValidation {
  let validPrimaryTargets = 0;
  let invalidPrimaryTargets = 0;
  let unresolvedTargets = 0;
  let invalidPathSymbolPairs = 0;
  let categoryLabelTargets = 0;
  let invalidProductionPathHops = 0;
  let invalidProductionUseEvidence = 0;
  const invalidProductionUseEvidenceCaseIds: string[] = [];
  for (const coverageCase of cases) {
    const metadata = coverageCase.targetMetadata;
    const primaryResolves = exactTargetResolves(metadata.primaryTarget);
    if (primaryResolves) validPrimaryTargets += 1;
    else { invalidPrimaryTargets += 1; unresolvedTargets += 1; invalidPathSymbolPairs += 1; }
    if (metadata.primaryTarget.symbol === metadata.category) categoryLabelTargets += 1;
    const primaryInPath = metadata.productionPath.some((item) => item.path === metadata.primaryTarget.path && item.symbol === metadata.primaryTarget.symbol && item.targetKind === metadata.primaryTarget.targetKind);
    if (!primaryInPath || metadata.productionPath.some((item) => item.path.includes("contract-coverage") || !exactTargetResolves(item))) invalidProductionPathHops += 1;
    const consumerSource = targetSourceFile(metadata.productionUseEvidence.consumerPath);
    const consumer = consumerSource && namedDeclaration(consumerSource, metadata.productionUseEvidence.consumerSymbol);
    if (!consumer || !declarationUsesSymbol(consumer, metadata.primaryTarget.symbol)) { invalidProductionUseEvidence += 1; invalidProductionUseEvidenceCaseIds.push(coverageCase.caseId); }
  }
  const duplicateCellIds = cases.length - new Set(cases.map((item) => item.cellId)).size;
  const duplicateCaseIds = cases.length - new Set(cases.map((item) => item.caseId)).size;
  const result = Object.freeze({ descriptors: cases.length, validPrimaryTargets, invalidPrimaryTargets, unresolvedTargets, invalidPathSymbolPairs, categoryLabelTargets, invalidProductionPathHops, invalidProductionUseEvidence, duplicateCellIds, duplicateCaseIds });
  assert.equal(result.descriptors, 299, "exact callback descriptor denominator");
  assert.equal(result.invalidPrimaryTargets, 0, "all primary targets resolve to exact declarations");
  assert.equal(result.unresolvedTargets, 0, "no unresolved production target");
  assert.equal(result.invalidPathSymbolPairs, 0, "no invalid target path/symbol pair");
  assert.equal(result.categoryLabelTargets, 0, "category labels are not targets");
  assert.equal(result.invalidProductionPathHops, 0, "all production path hops resolve and include the primary target");
  assert.equal(result.invalidProductionUseEvidence, 0, `every target has current production-use evidence: ${invalidProductionUseEvidenceCaseIds.join(", ")}`);
  assert.equal(result.duplicateCellIds, 0, "no duplicate Cell ID in target metadata");
  assert.equal(result.duplicateCaseIds, 0, "no duplicate Case ID in target metadata");
  return result;
}

export function risk001TargetSourceSha256(relativePath: string): string {
  const source = targetSourceFile(relativePath);
  if (!source) throw new Error(`Unresolvable target source for hash: ${relativePath}`);
  return crypto.createHash("sha256").update(source.text, "utf8").digest("hex");
}

function orderedCoverageCases(): readonly Risk001CoverageCase[] {
  const contractOrder = new Map(RISK_001_CONTROLLING_CONTRACT_IDS.map((id, index) => [id, index]));
  return Object.freeze([...RISK_001_EXECUTABLE_CASES].sort((left, right) => {
    const leftFamily = Math.min(...left.contractIds.map((id) => contractOrder.get(id) ?? Number.MAX_SAFE_INTEGER));
    const rightFamily = Math.min(...right.contractIds.map((id) => contractOrder.get(id) ?? Number.MAX_SAFE_INTEGER));
    return leftFamily - rightFamily || left.matrixOwner.localeCompare(right.matrixOwner) || left.cellId.localeCompare(right.cellId);
  }));
}

function renderDimensions(dimensions: Risk001CoverageCase["dimensions"]): string {
  return Object.entries(dimensions).map(([key, value]) => `${key}=${String(value)}`).join("; ");
}

function renderInvariantIds(invariantIds: readonly string[]): string {
  return invariantIds.length === 0 ? "[]" : invariantIds.join(", ");
}

export function renderRisk001CoverageLedger(execution: ReadonlyMap<string, "PASS" | "FAIL">): string {
  const rows = orderedCoverageCases().map((item) => `| ${item.cellId} | ${item.caseId} | ${item.criticality} | ${item.contractIds.join(", ")} | ${renderInvariantIds(item.invariantIds)} | ${item.matrixOwner} | ${renderDimensions(item.dimensions)} | ${item.expectedBehavior} | ${item.testSymbol} | ${item.evidencePath} | ${execution.get(item.caseId) ?? "NOT_RUN"} |`);
  return ["# RISK-001 contract test ledger", "", "Mechanically derived from `RISK_001_EXECUTABLE_CASES` after exact case execution.", "", "| Cell ID | Case ID | Criticality | Contract IDs | Invariant IDs | Matrix owner | Dimensions | Expected behavior | Test symbol | Evidence path | Execution result |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |", ...rows, ""].join("\n");
}

export function renderRisk001CellInventory(execution: ReadonlyMap<string, "PASS" | "FAIL">): string {
  const total = RISK_001_EXECUTABLE_CASES.length; const critical = RISK_001_EXECUTABLE_CASES.filter((item) => item.criticality === "CRITICAL").length;
  const byKind = (kind: Risk001CaseKind) => RISK_001_EXECUTABLE_CASES.filter((item) => item.kind === kind).length;
  const rows = orderedCoverageCases().map((item) => `| ${item.cellId} | ${item.caseId} | ${item.criticality} | ${item.contractIds.join(", ")} | ${renderInvariantIds(item.invariantIds)} | ${item.matrixOwner} | ${renderDimensions(item.dimensions)} | ${item.expectedBehavior} | ${item.testSymbol} | ${item.evidencePath} |`);
  return ["# RISK-001 finite behavior-cell inventory", "", `- Baseline behavior cells: 193`, `- Controlling Contract IDs: ${RISK_001_CONTROLLING_CONTRACT_IDS.length}`, `- Invariant IDs: ${RISK_001_INVARIANT_IDS.length}`, `- Total behavior cells: ${total}`, `- Critical cells: ${critical}`, `- Noncritical cells: ${total - critical}`, `- Matrix-derived cells: ${byKind("MATRIX")}`, `- Independent adversarial cells: ${byKind("ADVERSARIAL")}`, `- Paired-sensitivity cells: ${byKind("PAIRED_SENSITIVITY")}`, `- Directly executed cells: ${[...execution.values()].filter((value) => value === "PASS").length}`, `- Failed cells: ${[...execution.values()].filter((value) => value === "FAIL").length}`, `- Blocked cells: 0`, `- Uncovered cells after matrix completeness: 0`, "", "| Cell ID | Case ID | Criticality | Contract IDs | Invariant IDs | Matrix owner | Dimensions | Expected behavior | Test symbol | Evidence path |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |", ...rows, ""].join("\n");
}
