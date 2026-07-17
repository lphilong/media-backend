import { RISK001_KPI_PERSISTED_CONTRACT_VERSION } from "@modules/kpi/domain/kpi-persisted-contract";
import type { QueryCountEvidence, Risk001PlannerInputLoadResult } from "./risk-001-data-loaders";
import {
  buildDryRunManifest,
  MIGRATION_CLASSIFICATIONS,
  stableFingerprint,
  sanitizedIdentity,
  type MigrationClassification,
  type MigrationManifest,
  type PlannedMigrationAction,
} from "./migration-program";
import {
  resolveRisk001Dependencies,
  type Risk001DependencyRecord,
  type Risk001DependencyResolution,
} from "./risk-001-dependency-resolution";
import { createRisk001Registry } from "./risk-001-planners";
import { Risk001SanitizedError } from "./risk-001-sanitized-error";
import {
  RISK001_ENTERPRISE_CONTRACT_VERSION,
  RISK001_QUERY_GRAMMAR_VERSION,
  RISK001_REQUIRED_ASSESSMENT_AREA_IDS,
  RISK001_SANITIZATION_CONTRACT_VERSION,
  RISK001_SOURCE_PROJECTION_CONTRACT_VERSION,
  type Risk001AssessmentAreaId,
  type Risk001LoaderOutcome,
  type Risk001PublicationState,
  type Risk001RunCompletionState,
  type Risk001SanitizationState,
} from "./risk-001-completed-run-contract";

export const RISK001_MANIFEST_SCHEMA_VERSION = "risk-001-read-only-manifest/v3";
export const RISK001_PLANNER_REGISTRY_VERSION = "risk-001-registry/v1";

export interface SourceVersionEvidence {
  readonly gitCommit: string;
  readonly workingTreeFingerprint: string;
  readonly workingTreeDirty: boolean;
}

export interface Risk001AssessmentOutcome {
  readonly areaId: Risk001AssessmentAreaId;
  readonly status: "COMPLETED";
  readonly actionCount: number;
  readonly candidateCount: number;
  readonly blockingClassificationCount: number;
  readonly dependencyCheckCount: number;
  readonly totalsByClassification: Readonly<Record<MigrationClassification, number>>;
}

export interface Risk001AggregateTotals {
  readonly loaderCount: number;
  readonly completedLoaderCount: number;
  readonly assessmentAreaCount: number;
  readonly completedAssessmentAreaCount: number;
  readonly queryEvidenceCount: number;
  readonly actionCount: number;
  readonly candidateCount: number;
  readonly dependencyCheckCount: number;
  readonly blockingClassificationCount: number;
}

/** Precomputed semantic values consumed directly by SUMMARY.md. */
export interface Risk001SummaryTotals {
  readonly verdict: "OWNER_REVIEW_REQUIRED" | "READ_ONLY_PLAN_COMPLETE";
  readonly plannerRecordCounts: Readonly<Record<Risk001AssessmentAreaId, number>>;
  readonly proposedActionCounts: Readonly<Record<string, number>>;
  readonly permissionAdditions: readonly string[];
  readonly permissionRemovals: readonly string[];
}

export interface Risk001DryRunManifest {
  readonly schemaVersion: typeof RISK001_MANIFEST_SCHEMA_VERSION;
  readonly enterpriseContractVersion: typeof RISK001_ENTERPRISE_CONTRACT_VERSION;
  readonly queryGrammarVersion: typeof RISK001_QUERY_GRAMMAR_VERSION;
  readonly sourceProjectionContractVersion: typeof RISK001_SOURCE_PROJECTION_CONTRACT_VERSION;
  readonly plannerRegistryVersion: typeof RISK001_PLANNER_REGISTRY_VERSION;
  readonly kpiPersistedContractVersion: typeof RISK001_KPI_PERSISTED_CONTRACT_VERSION;
  readonly source: SourceVersionEvidence;
  readonly databaseName: string;
  readonly executionMode: "READ_ONLY_DRY_RUN";
  readonly observedAt: string;
  readonly runLabel: string | null;
  readonly planFingerprint: string;
  readonly generatedFromFingerprint: string;
  readonly databaseAccessMode: "AUTHORIZED_READ_ONLY_VIA_ENV_DEV";
  readonly databaseWriteCapability: "STRUCTURALLY_ABSENT";
  readonly migrationExecutionStatus: "NOT_EXECUTED";
  readonly dbSecretExposure: "NONE";
  readonly runCompletionState: Risk001RunCompletionState;
  readonly loaderOutcomes: readonly Risk001LoaderOutcome[];
  readonly assessmentOutcomes: readonly Risk001AssessmentOutcome[];
  readonly publicationState: Risk001PublicationState;
  readonly sanitizationState: Risk001SanitizationState;
  readonly queryEvidence: readonly QueryCountEvidence[];
  readonly plannerOrder: readonly string[];
  readonly plannerClassifications: readonly PlannedMigrationAction[];
  readonly sanitizedSamples: Readonly<Record<string, readonly string[]>>;
  readonly totalsByPlannerAndClassification: Readonly<Record<string, Readonly<Record<string, number>>>>;
  readonly totalsByClassification: Readonly<Record<MigrationClassification, number>>;
  readonly aggregateTotals: Risk001AggregateTotals;
  readonly summaryTotals: Risk001SummaryTotals;
  readonly affectedAccountCount: number;
  readonly authorityRisk: {
    readonly expansionReviewCount: number;
    readonly reductionReviewCount: number;
  };
  readonly ownerApprovalRequirements: readonly string[];
  readonly sourceRemovalGates: readonly string[];
  readonly exceptions: readonly string[];
  readonly historicalUnknownPreservationCount: number;
  readonly dependencyResolution: Risk001DependencyResolution;
}

export interface Risk001ManifestBuildParams {
  readonly loaded: Risk001PlannerInputLoadResult;
  readonly source: SourceVersionEvidence;
  readonly databaseName: string;
  readonly observedAt: number;
  readonly runLabel?: string;
  readonly maxSamples?: number;
}

export interface Risk001CompletionGateResult {
  readonly eligible: boolean;
  readonly reasons: readonly string[];
}

export interface Risk001CompletedArtifactOperations {
  readonly buildManifest: (params: Risk001ManifestBuildParams) => Risk001DryRunManifest;
  readonly renderSummary: (manifest: Risk001DryRunManifest) => string;
}

export interface Risk001CompletedArtifacts {
  readonly manifest: Risk001DryRunManifest;
  readonly manifestText: string;
  readonly summaryText: string;
}

export function buildRisk001DryRunManifest(
  params: Risk001ManifestBuildParams,
): Risk001DryRunManifest {
  assertLoadedRunComplete(params.loaded);
  const plannerManifest = buildDryRunManifest({
    registry: createRisk001Registry(),
    inputs: params.loaded.inputs,
  });
  const canonicalTotals = buildCanonicalTotals(plannerManifest, params.loaded);
  const dependencyResolution = resolveRisk001Dependencies(
    buildRisk001DependencyRecords(params.loaded.inputs, plannerManifest.actions),
  );
  const assessmentOutcomes = canonicalTotals.assessmentOutcomes;
  const gate = validateRisk001RunCompletion({
    loaded: params.loaded,
    assessmentOutcomes,
  });
  if (!gate.eligible) throw incompleteRunError(gate.reasons);

  const sanitizedSamples = buildSanitizedSamples(
    plannerManifest.actions,
    params.maxSamples ?? 5,
  );
  const actions = plannerManifest.actions;
  const runCompletionState: Risk001RunCompletionState = Object.freeze({
    status: "ASSESSMENT_COMPLETE",
    completionGate: "PASSED",
    loaderState: "COMPLETE",
    plannerState: "COMPLETE",
    capturedReadVerification: "PASSED",
    paginationConsistency: "PASSED",
    requiredLoaderCount: 8,
    completedLoaderCount: 8,
    requiredAssessmentAreaCount: 8,
    completedAssessmentAreaCount: 8,
    incompleteStageCount: 0,
  });
  const publicationState: Risk001PublicationState = Object.freeze({
    protocol: "SUMMARY_THEN_MANIFEST_LAST",
    summaryPublication: "REQUIRED_BEFORE_COMPLETION_COMMIT",
    manifestPublication: "FINAL_COMPLETION_COMMIT",
    validManifestOnFailure: false,
  });
  const sanitizationState: Risk001SanitizationState = Object.freeze({
    contractVersion: RISK001_SANITIZATION_CONTRACT_VERSION,
    status: "SANITIZED",
    rawFiltersPublished: false,
    credentialsPublished: false,
    privateIdentifiersPublished: false,
    rawResultPayloadsPublished: false,
    exceptionRepresentation: "SANITIZED_CODES_ONLY",
  });
  const semanticPlan = {
    schemaVersion: RISK001_MANIFEST_SCHEMA_VERSION,
    enterpriseContractVersion: RISK001_ENTERPRISE_CONTRACT_VERSION,
    queryGrammarVersion: RISK001_QUERY_GRAMMAR_VERSION,
    sourceProjectionContractVersion: RISK001_SOURCE_PROJECTION_CONTRACT_VERSION,
    plannerRegistryVersion: RISK001_PLANNER_REGISTRY_VERSION,
    kpiPersistedContractVersion: RISK001_KPI_PERSISTED_CONTRACT_VERSION,
    source: params.source,
    databaseName: params.databaseName,
    executionMode: "READ_ONLY_DRY_RUN",
    generatedFromFingerprint: plannerManifest.generatedFromFingerprint,
    databaseAccessMode: "AUTHORIZED_READ_ONLY_VIA_ENV_DEV",
    databaseWriteCapability: "STRUCTURALLY_ABSENT",
    migrationExecutionStatus: "NOT_EXECUTED",
    dbSecretExposure: "NONE",
    runCompletionState,
    loaderOutcomes: Object.freeze(params.loaded.loaderOutcomes.map(freezeLoaderOutcome)),
    assessmentOutcomes,
    publicationState,
    sanitizationState,
    queryEvidence: Object.freeze([...params.loaded.evidence]),
    plannerOrder: plannerManifest.orderedMigrations,
    plannerClassifications: plannerManifest.actions,
    totalsByPlannerAndClassification: canonicalTotals.totalsByPlannerAndClassification,
    totalsByClassification: canonicalTotals.totalsByClassification,
    aggregateTotals: canonicalTotals.aggregateTotals,
    summaryTotals: canonicalTotals.summaryTotals,
    affectedAccountCount: params.loaded.affectedAccountCount,
    dependencyResolution,
    exceptions: Object.freeze([] as string[]),
  } as const;
  const withoutFingerprint = {
    ...semanticPlan,
    observedAt: new Date(params.observedAt).toISOString(),
    runLabel: params.runLabel ?? null,
    sanitizedSamples,
    authorityRisk: Object.freeze({
      expansionReviewCount: actions.filter((action) => action.plannedAfter.expansionRisk === "REVIEW_REQUIRED").length,
      reductionReviewCount: actions.filter((action) => action.plannedAfter.reductionRisk === "REVIEW_REQUIRED").length,
    }),
    ownerApprovalRequirements: Object.freeze(
      uniqueSorted(
        actions
          .filter((action) => action.requiredApproval === "OWNER")
          .map((action) => `${action.migrationId}:${action.reasonCode}`),
      ),
    ),
    sourceRemovalGates: Object.freeze(uniqueSorted(actions.map((action) => action.sourceRemovalDependency))),
    historicalUnknownPreservationCount: actions.filter(
      (action) => action.classification === "HISTORICAL_UNKNOWN_PRESERVE_AS_UNKNOWN",
    ).length,
  } as const;
  return Object.freeze({
    ...withoutFingerprint,
    planFingerprint: fingerprintRisk001CompletedRun(withoutFingerprint),
  });
}

export function validateRisk001RunCompletion(params: {
  readonly loaded: Risk001PlannerInputLoadResult;
  readonly assessmentOutcomes: readonly Risk001AssessmentOutcome[];
}): Risk001CompletionGateResult {
  const reasons = [...loadedRunCompletionReasons(params.loaded)];
  const assessmentIds = params.assessmentOutcomes.map((item) => item.areaId);
  if (!exactAreaSet(assessmentIds)) reasons.push("ASSESSMENT_AREA_OUTCOMES_INCOMPLETE");
  if (params.assessmentOutcomes.some((item) => item.status !== "COMPLETED")) {
    reasons.push("ASSESSMENT_AREA_FAILED");
  }
  return Object.freeze({
    eligible: reasons.length === 0,
    reasons: Object.freeze(uniqueSorted(reasons)),
  });
}

/**
 * Fingerprints only a complete, validated completed-run projection.  This is
 * deliberately stricter than the builder gate: an exported helper must not
 * turn a partial or invented manifest shape into an apparently valid hash.
 */
export function fingerprintRisk001CompletedRun(value: object): string {
  return stableFingerprint(canonicalizeRisk001CompletedRun(value));
}

export function prepareRisk001CompletedArtifacts(
  params: Risk001ManifestBuildParams,
  pretty: boolean,
  operations: Risk001CompletedArtifactOperations = Object.freeze({
    buildManifest: buildRisk001DryRunManifest,
    renderSummary: renderRisk001Summary,
  }),
): Risk001CompletedArtifacts {
  const manifest = operations.buildManifest(params);
  const summaryText = operations.renderSummary(manifest);
  const manifestText = `${JSON.stringify(manifest, null, pretty ? 2 : 0)}\n`;
  return Object.freeze({ manifest, manifestText, summaryText });
}

export function renderRisk001Summary(manifest: Risk001DryRunManifest): string {
  // Validate before presentation; rendering never derives semantic totals.
  const canonical = { ...manifest, ...canonicalizeRisk001CompletedRun(manifest) } as Risk001DryRunManifest;
  const counts = canonical.totalsByClassification;
  const summaryTotals = canonical.summaryTotals;
  const plannerCount = (plannerId: Risk001AssessmentAreaId): number =>
    summaryTotals.plannerRecordCounts[plannerId];
  const proposed = Object.entries(summaryTotals.proposedActionCounts)
    .map(([action, count]) => `- ${action}: ${count}`);
  const permissionAdditions = summaryTotals.permissionAdditions;
  const permissionRemovals = summaryTotals.permissionRemovals;
  const verdict = summaryTotals.verdict;
  manifest = canonical;
  return [
    "# RISK-001 read-only dry-run summary",
    "",
    "## 1. Dry-run verdict and completion state",
    "",
    verdict,
    `ASSESSMENT_RUN_STATUS: ${manifest.runCompletionState.status}`,
    `COMPLETION_GATE: ${manifest.runCompletionState.completionGate}`,
    `CAPTURED_READ_VERIFICATION: ${manifest.runCompletionState.capturedReadVerification}`,
    `PAGINATION_CONSISTENCY: ${manifest.runCompletionState.paginationConsistency}`,
    `INCOMPLETE_STAGE_COUNT: ${manifest.runCompletionState.incompleteStageCount}`,
    "",
    "## 2. Database access and secret-exposure status",
    "",
    `DATABASE_ACCESS_MODE: ${manifest.databaseAccessMode}`,
    `DATABASE_WRITE_CAPABILITY: ${manifest.databaseWriteCapability}`,
    `DB_SECRET_EXPOSURE: ${manifest.dbSecretExposure}`,
    `MIGRATION_EXECUTION_STATUS: ${manifest.migrationExecutionStatus}`,
    "",
    "## 3. Contract, source, and planner versions",
    "",
    `Manifest schema: ${manifest.schemaVersion}`,
    `Enterprise contract: ${manifest.enterpriseContractVersion}`,
    `Query grammar: ${manifest.queryGrammarVersion}`,
    `Source projection contract: ${manifest.sourceProjectionContractVersion}`,
    `KPI persisted contract: ${manifest.kpiPersistedContractVersion}`,
    `Planner registry: ${manifest.plannerRegistryVersion}`,
    `Git commit: ${manifest.source.gitCommit}`,
    `Working-tree fingerprint: ${manifest.source.workingTreeFingerprint}`,
    `Working tree dirty: ${manifest.source.workingTreeDirty}`,
    `Generated-input fingerprint: ${manifest.generatedFromFingerprint}`,
    `Plan fingerprint: ${manifest.planFingerprint}`,
    "",
    "## 4. Loader completion and committed source fingerprints",
    "",
    ...manifest.loaderOutcomes.map(formatLoaderOutcome),
    "",
    "## 5. Assessment area outcomes",
    "",
    ...manifest.assessmentOutcomes.map(formatAssessmentOutcome),
    "",
    "## 6. Query scope",
    "",
    ...manifest.queryEvidence.map(formatEvidence),
    "",
    "## 7. Aggregate totals",
    "",
    `- Loaders: ${manifest.aggregateTotals.completedLoaderCount}/${manifest.aggregateTotals.loaderCount}`,
    `- Assessment areas: ${manifest.aggregateTotals.completedAssessmentAreaCount}/${manifest.aggregateTotals.assessmentAreaCount}`,
    `- Query commitments: ${manifest.aggregateTotals.queryEvidenceCount}`,
    `- Planner actions: ${manifest.aggregateTotals.actionCount}`,
    `- Owner-reviewed candidates: ${manifest.aggregateTotals.candidateCount}`,
    `- Reported dependency checks: ${manifest.aggregateTotals.dependencyCheckCount}`,
    `- Blocking classifications: ${manifest.aggregateTotals.blockingClassificationCount}`,
    `- Propagated blockers: ${manifest.dependencyResolution.totals.propagatedBlockerCount}`,
    `- Effective blocked assessments: ${manifest.dependencyResolution.totals.effectiveBlockedAssessmentCount}`,
    `- Related-area advisories: ${manifest.dependencyResolution.totals.relatedAreaAdvisoryCount}`,
    "",
    "## 8. Counts by classification",
    "",
    ...Object.entries(counts).map(([classification, count]) => `- ${classification}: ${count}`),
    "",
    "## 9. Canonical Role drift summary",
    "",
    `Inspected planner records: ${plannerCount("RISK001_ROLE_DRIFT")}. Exact permission deltas are present only in sanitized planner actions.`,
    "",
    "## 10. Legacy Role retirement dependencies",
    "",
    `Inspected planner records: ${plannerCount("RISK001_LEGACY_ROLE_RETIREMENT")}. Retirement remains Owner-gated and source-removal-gated.`,
    "",
    "## 11. Bundle consistency findings",
    "",
    `Inspected planner records: ${plannerCount("RISK001_BUNDLE_CONSISTENCY")}. No child reactivation is proposed.`,
    "",
    "## 12. ScopeGrant fingerprint findings",
    "",
    `Inspected planner records: ${plannerCount("RISK001_SCOPE_FINGERPRINT")}. Canonical fingerprint planning only.`,
    "",
    "## 13. Account Context readiness findings",
    "",
    `Inspected planner records: ${plannerCount("RISK001_ACCOUNT_CONTEXT_READINESS")}. Missing eligibility is never inferred from Role labels.`,
    "",
    "## 14. Talent/EmploymentProfile readiness findings",
    "",
    `Inspected planner records: ${plannerCount("RISK001_TALENT_IDENTITY_READINESS")}. No EmploymentProfile creation or fabricated link is proposed.`,
    "",
    "## 15. Coarse KPI scope findings",
    "",
    `Inspected planner records: ${plannerCount("RISK001_COARSE_KPI_SCOPE")}. Coarse scope is inventoried as compatibility data, not current write authority.`,
    "",
    "## 16. Stale KPI Plan/metric/Allocation/Actual findings",
    "",
    `Inspected planner records: ${plannerCount("RISK001_STALE_KPI_DATA")}. Historical-unknown preservation count: ${manifest.historicalUnknownPreservationCount}. KPI Actual is not interpreted as Revenue.`,
    "",
    "## 17. Proposed adds/removes/syncs/retires/archives/deletes/rebuilds",
    "",
    `- Exact permission additions: ${permissionAdditions.length > 0 ? permissionAdditions.join(", ") : "NONE"}`,
    `- Exact permission removals: ${permissionRemovals.length > 0 ? permissionRemovals.join(", ") : "NONE"}`,
    ...(proposed.length > 0 ? proposed : ["- NONE"]),
    "",
    "## 18. Affected accounts and authority risk",
    "",
    `Sanitized unique affected-account count: ${manifest.affectedAccountCount}.`,
    `Expansion reviews: ${manifest.authorityRisk.expansionReviewCount}; reduction reviews: ${manifest.authorityRisk.reductionReviewCount}.`,
    "",
    "## 19. Manual-review and Owner-decision items",
    "",
    ...(manifest.ownerApprovalRequirements.length > 0
      ? manifest.ownerApprovalRequirements.map((item) => `- ${item}`)
      : ["- NONE"]),
    "",
    "## 20. Exceptions",
    "",
    ...(manifest.exceptions.length > 0 ? manifest.exceptions.map((item) => `- ${item}`) : ["- NONE"]),
    "",
    "## 21. Publication and sanitization state",
    "",
    `PUBLICATION_PROTOCOL: ${manifest.publicationState.protocol}`,
    `SUMMARY_PUBLICATION: ${manifest.publicationState.summaryPublication}`,
    `MANIFEST_PUBLICATION: ${manifest.publicationState.manifestPublication}`,
    `VALID_MANIFEST_ON_FAILURE: ${manifest.publicationState.validManifestOnFailure}`,
    `SANITIZATION_STATUS: ${manifest.sanitizationState.status}`,
    `SANITIZATION_CONTRACT: ${manifest.sanitizationState.contractVersion}`,
    `RAW_FILTERS_PUBLISHED: ${manifest.sanitizationState.rawFiltersPublished}`,
    `CREDENTIALS_PUBLISHED: ${manifest.sanitizationState.credentialsPublished}`,
    `PRIVATE_IDENTIFIERS_PUBLISHED: ${manifest.sanitizationState.privateIdentifiersPublished}`,
    `RAW_RESULT_PAYLOADS_PUBLISHED: ${manifest.sanitizationState.rawResultPayloadsPublished}`,
    "",
    "## 22. No-write statement",
    "",
    "No database write occurred.",
    "",
    "## 23. Exact next action",
    "",
    "Owner manifest review.",
    "",
  ].join("\n");
}

function loadedRunCompletionReasons(loaded: Risk001PlannerInputLoadResult): string[] {
  const reasons: string[] = [];
  const inputIds = Object.keys(loaded.inputs);
  if (!exactAreaSet(inputIds)) reasons.push("PLANNER_INPUT_FAMILIES_INCOMPLETE");
  for (const areaId of RISK001_REQUIRED_ASSESSMENT_AREA_IDS) {
    const input = loaded.inputs[areaId];
    if (!Array.isArray(input)) reasons.push(`PLANNER_INPUT_MISSING:${areaId}`);
  }
  const outcomeIds = loaded.loaderOutcomes?.map((item) => item.areaId) ?? [];
  if (!exactAreaSet(outcomeIds)) reasons.push("LOADER_OUTCOMES_INCOMPLETE");
  if (loaded.loaderOutcomes?.some((item) => item.status !== "COMPLETED" || item.exceptionCount !== 0)) {
    reasons.push("LOADER_OUTCOME_FAILED");
  }
  for (const outcome of loaded.loaderOutcomes ?? []) {
    const input = loaded.inputs[outcome.areaId];
    if (!Array.isArray(input) || input.length !== outcome.recordCount) {
      reasons.push(`LOADER_RECORD_COUNT_MISMATCH:${outcome.areaId}`);
    }
  }
  const committedQueries = new Set(loaded.evidence.map((item) => item.queryIdentityFingerprint));
  const committedSources = new Set(loaded.evidence.map((item) => item.sourceStateFingerprint));
  if ((loaded.loaderOutcomes ?? []).some((outcome) =>
    outcome.queryIdentityFingerprints.some((fingerprint) => !committedQueries.has(fingerprint)) ||
    outcome.sourceStateFingerprints.some((fingerprint) => !committedSources.has(fingerprint)))) {
    reasons.push("LOADER_SOURCE_COMMITMENTS_MISMATCH");
  }
  if (loaded.exceptions.length !== 0) reasons.push("LOADER_EXCEPTIONS_PRESENT");
  if (loaded.readState?.capturedReadVerification !== "PASSED") {
    reasons.push("CAPTURED_READ_VERIFICATION_FAILED");
  }
  if (loaded.readState?.paginationConsistency !== "PASSED") {
    reasons.push("PAGINATION_CONSISTENCY_FAILED");
  }
  return uniqueSorted(reasons);
}

function assertLoadedRunComplete(loaded: Risk001PlannerInputLoadResult): void {
  const reasons = loadedRunCompletionReasons(loaded);
  if (reasons.length > 0) throw incompleteRunError(reasons);
}

function incompleteRunError(reasons: readonly string[]): Risk001SanitizedError {
  return new Risk001SanitizedError(
    "VALIDATION_FAILED",
    `Assessment run incomplete: ${uniqueSorted(reasons).join(",")}`,
  );
}

function exactAreaSet(values: readonly string[]): boolean {
  const actual = [...values].sort();
  const expected = [...RISK001_REQUIRED_ASSESSMENT_AREA_IDS].sort();
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function buildCanonicalTotals(
  plannerManifest: MigrationManifest,
  loaded: Risk001PlannerInputLoadResult,
): Readonly<{
  assessmentOutcomes: readonly Risk001AssessmentOutcome[];
  totalsByPlannerAndClassification: Readonly<Record<string, Readonly<Record<string, number>>>>;
  totalsByClassification: Readonly<Record<MigrationClassification, number>>;
  aggregateTotals: Risk001AggregateTotals;
  summaryTotals: Risk001SummaryTotals;
}> {
  const actions = plannerManifest.actions;
  const assessmentOutcomes = buildAssessmentOutcomes(plannerManifest);
  const totalsByPlannerAndClassification = buildPlannerTotals(actions);
  const totalsByClassification = plannerManifest.counts;
  const aggregateTotals = buildAggregateTotals(
    loaded.loaderOutcomes,
    assessmentOutcomes,
    loaded.evidence,
    actions,
  );
  const plannerRecordCounts = Object.freeze(Object.fromEntries(
    assessmentOutcomes.map((outcome) => [outcome.areaId, outcome.actionCount]),
  ) as Record<Risk001AssessmentAreaId, number>);
  const proposedActionCounts: Record<string, number> = {};
  const permissionAdditions = new Set<string>();
  const permissionRemovals = new Set<string>();
  for (const action of actions) {
    if (action.proposedAction !== "NONE") {
      proposedActionCounts[action.proposedAction] = (proposedActionCounts[action.proposedAction] ?? 0) + 1;
    }
    for (const value of Array.isArray(action.plannedAfter.permissionAdditions) ? action.plannedAfter.permissionAdditions : []) {
      if (typeof value === "string") permissionAdditions.add(value);
    }
    for (const value of Array.isArray(action.plannedAfter.permissionRemovals) ? action.plannedAfter.permissionRemovals : []) {
      if (typeof value === "string") permissionRemovals.add(value);
    }
  }
  const summaryTotals: Risk001SummaryTotals = Object.freeze({
    verdict: totalsByClassification.UNMIGRATABLE_WITHOUT_OWNER_DECISION > 0 ||
      totalsByClassification.AMBIGUOUS_MANUAL_REVIEW > 0
      ? "OWNER_REVIEW_REQUIRED"
      : "READ_ONLY_PLAN_COMPLETE",
    plannerRecordCounts,
    proposedActionCounts: Object.freeze(Object.fromEntries(
      Object.entries(proposedActionCounts).sort(([left], [right]) => left.localeCompare(right)),
    )),
    permissionAdditions: Object.freeze([...permissionAdditions].sort((left, right) => left.localeCompare(right))),
    permissionRemovals: Object.freeze([...permissionRemovals].sort((left, right) => left.localeCompare(right))),
  });
  return Object.freeze({ assessmentOutcomes, totalsByPlannerAndClassification, totalsByClassification, aggregateTotals, summaryTotals });
}

const COMPLETED_RUN_DISPLAY_KEYS = new Set(["observedAt", "runLabel", "sanitizedSamples", "planFingerprint"]);
const COMPLETED_RUN_SEMANTIC_KEYS = new Set([
  "schemaVersion", "enterpriseContractVersion", "queryGrammarVersion", "sourceProjectionContractVersion",
  "plannerRegistryVersion", "kpiPersistedContractVersion", "source", "databaseName", "executionMode",
  "generatedFromFingerprint", "databaseAccessMode", "databaseWriteCapability", "migrationExecutionStatus",
  "dbSecretExposure", "runCompletionState", "loaderOutcomes", "assessmentOutcomes", "publicationState",
  "sanitizationState", "queryEvidence", "plannerOrder", "plannerClassifications",
  "totalsByPlannerAndClassification", "totalsByClassification", "aggregateTotals", "summaryTotals",
  "affectedAccountCount", "authorityRisk", "ownerApprovalRequirements", "sourceRemovalGates", "exceptions",
  "historicalUnknownPreservationCount", "dependencyResolution",
]);
const SEMANTIC_SET_ARRAY_FIELDS = new Set([
  "dependencyChecks", "preconditions", "dependencies", "blockers", "blockerCodes", "candidates", "candidateIds",
  "permissionAdditions", "permissionRemovals", "replacementRoleCodes", "queryIdentityFingerprints", "sourceStateFingerprints",
]);

function canonicalizeRisk001CompletedRun(value: object): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) throw completedRunValidationError("COMPLETED_RUN_NOT_OBJECT");
  const keys = Object.keys(value);
  for (const key of keys) {
    if (!COMPLETED_RUN_SEMANTIC_KEYS.has(key) && !COMPLETED_RUN_DISPLAY_KEYS.has(key)) {
      throw completedRunValidationError(`COMPLETED_RUN_UNKNOWN_FIELD:${key}`);
    }
  }
  for (const key of COMPLETED_RUN_SEMANTIC_KEYS) {
    if (!(key in value) || value[key] === undefined) throw completedRunValidationError(`COMPLETED_RUN_MISSING:${key}`);
  }
  const loaderOutcomes = canonicalizeUniqueSet(value.loaderOutcomes, "loaderOutcomes", (item) => readString(item, "areaId"));
  const assessmentOutcomes = canonicalizeUniqueSet(value.assessmentOutcomes, "assessmentOutcomes", (item) => readString(item, "areaId"));
  if (!exactAreaSet(loaderOutcomes.map((item) => readString(item, "areaId")))) throw completedRunValidationError("LOADER_OUTCOMES_INCOMPLETE");
  if (!exactAreaSet(assessmentOutcomes.map((item) => readString(item, "areaId")))) throw completedRunValidationError("ASSESSMENT_OUTCOMES_INCOMPLETE");
  for (const outcome of loaderOutcomes) {
    if (outcome.status !== "COMPLETED") throw completedRunValidationError("LOADER_OUTCOME_INCOMPLETE");
    outcome.queryIdentityFingerprints = canonicalizeUniqueStrings(outcome.queryIdentityFingerprints, "loader query identity");
    outcome.sourceStateFingerprints = canonicalizeUniqueStrings(outcome.sourceStateFingerprints, "loader source state");
  }
  for (const outcome of assessmentOutcomes) {
    if (outcome.status !== "COMPLETED") throw completedRunValidationError("ASSESSMENT_OUTCOME_INCOMPLETE");
  }
  const plannerClassifications = canonicalizeUniqueSet(
    value.plannerClassifications,
    "plannerClassifications",
    (item) => `${readString(item, "migrationId")}|${readString(item, "sanitizedRecordIdentity")}|${readString(item, "reasonCode")}`,
  ).map(canonicalizePlannedAction);
  const canonical = {
    ...value,
    loaderOutcomes,
    assessmentOutcomes,
    queryEvidence: canonicalizeUniqueSet(value.queryEvidence, "queryEvidence", (item) =>
      `${readString(item, "collection")}|${readString(item, "queryIdentityFingerprint")}|${readString(item, "sourceStateFingerprint")}`),
    plannerClassifications,
    ownerApprovalRequirements: canonicalizeUniqueStrings(value.ownerApprovalRequirements, "owner approval requirement"),
    sourceRemovalGates: canonicalizeUniqueStrings(value.sourceRemovalGates, "source removal gate"),
    exceptions: canonicalizeUniqueStrings(value.exceptions, "exception"),
    dependencyResolution: canonicalizeDependencyResolution(value.dependencyResolution),
  };
  validateCompletionFamilies(canonical as unknown as Risk001DryRunManifest);
  validateCanonicalTotals(canonical as unknown as Risk001DryRunManifest);
  const {
    observedAt: _observedAt,
    runLabel: _runLabel,
    sanitizedSamples: _sanitizedSamples,
    planFingerprint: _planFingerprint,
    ...semantic
  } = canonical as Record<string, unknown>;
  return semantic;
}

function canonicalizeDependencyResolution(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw completedRunValidationError("COMPLETED_RUN_INVALID:dependencyResolution");
  const states = canonicalizeUniqueSet(value.assessmentStates, "dependency assessment states", (item) => `${readString(item, "areaId")}|${readString(item, "recordId")}`)
    .map((item) => ({ ...item, localBlockers: canonicalizeUniqueStrings(item.localBlockers, "local blocker"), propagatedBlockers: canonicalizeUniqueSet(item.propagatedBlockers, "propagated blocker", blockerIdentity), effectiveBlockers: canonicalizeUniqueValues(item.effectiveBlockers, "effective blocker"), relatedAreaAdvisories: canonicalizeUniqueSet(item.relatedAreaAdvisories, "related area advisory", advisoryIdentity) }));
  return {
    ...value,
    assessmentStates: states,
    propagatedBlockers: canonicalizeUniqueSet(value.propagatedBlockers, "propagated blockers", blockerIdentity),
    unresolvedBindings: canonicalizeUniqueSet(value.unresolvedBindings, "unresolved bindings", (item) => `${readString(item, "edgeId")}|${readString(item, "upstreamRecordId")}|${readString(item, "downstreamArea")}|${readString(item, "expectedRelationKey")}`),
    relatedAreaAdvisories: canonicalizeUniqueSet(value.relatedAreaAdvisories, "related area advisories", advisoryIdentity),
  };
}

function blockerIdentity(item: Record<string, unknown>): string {
  return [readString(item, "edgeId"), readString(item, "upstreamRecordId"), readString(item, "upstreamBlockerId"), readString(item, "downstreamRecordId"), readString(item, "reasonCode")].join("|");
}

function advisoryIdentity(item: Record<string, unknown>): string {
  return [readString(item, "edgeId"), readString(item, "upstreamRecordId"), readString(item, "upstreamReasonCode"), readString(item, "propagationMode")].join("|");
}

function validateCompletionFamilies(manifest: Risk001DryRunManifest): void {
  const completion = manifest.runCompletionState;
  const publication = manifest.publicationState;
  const sanitization = manifest.sanitizationState;
  if (!isRecord(completion) || completion.status !== "ASSESSMENT_COMPLETE" || completion.completionGate !== "PASSED" ||
    completion.loaderState !== "COMPLETE" || completion.plannerState !== "COMPLETE" ||
    completion.capturedReadVerification !== "PASSED" || completion.paginationConsistency !== "PASSED" ||
    completion.requiredLoaderCount !== 8 || completion.completedLoaderCount !== 8 ||
    completion.requiredAssessmentAreaCount !== 8 || completion.completedAssessmentAreaCount !== 8 || completion.incompleteStageCount !== 0) {
    throw completedRunValidationError("COMPLETED_RUN_COMPLETION_STATE_INVALID");
  }
  if (!isRecord(publication) || publication.protocol !== "SUMMARY_THEN_MANIFEST_LAST" ||
    publication.summaryPublication !== "REQUIRED_BEFORE_COMPLETION_COMMIT" ||
    publication.manifestPublication !== "FINAL_COMPLETION_COMMIT" || publication.validManifestOnFailure !== false) {
    throw completedRunValidationError("COMPLETED_RUN_PUBLICATION_STATE_INVALID");
  }
  if (!isRecord(sanitization) || sanitization.contractVersion !== RISK001_SANITIZATION_CONTRACT_VERSION ||
    sanitization.status !== "SANITIZED" || sanitization.rawFiltersPublished !== false ||
    sanitization.credentialsPublished !== false || sanitization.privateIdentifiersPublished !== false ||
    sanitization.rawResultPayloadsPublished !== false || sanitization.exceptionRepresentation !== "SANITIZED_CODES_ONLY") {
    throw completedRunValidationError("COMPLETED_RUN_SANITIZATION_STATE_INVALID");
  }
}

function canonicalizePlannedAction(action: Record<string, unknown>): Record<string, unknown> {
  return {
    ...action,
    dependencyChecks: canonicalizeUniqueStrings(action.dependencyChecks, "dependency check"),
    preconditions: canonicalizeUniqueStrings(action.preconditions, "precondition"),
    currentStateSummary: canonicalizeNamedSemanticSets(action.currentStateSummary),
    plannedAfter: canonicalizeNamedSemanticSets(action.plannedAfter),
  };
}

function canonicalizeNamedSemanticSets(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    SEMANTIC_SET_ARRAY_FIELDS.has(key) ? canonicalizeUniqueValues(item, key) : item,
  ]));
}

function canonicalizeUniqueSet(value: unknown, label: string, key: (item: Record<string, unknown>) => string): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw completedRunValidationError(`COMPLETED_RUN_INVALID:${label}`);
  const keyed = value.map((item) => {
    if (!isRecord(item)) throw completedRunValidationError(`COMPLETED_RUN_INVALID:${label}`);
    return { item: { ...item }, key: key(item) };
  });
  if (new Set(keyed.map((item) => item.key)).size !== keyed.length) throw completedRunValidationError(`COMPLETED_RUN_DUPLICATE:${label}`);
  return keyed.sort((left, right) => left.key.localeCompare(right.key)).map((item) => item.item);
}

function canonicalizeUniqueStrings(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw completedRunValidationError(`COMPLETED_RUN_INVALID:${label}`);
  if (new Set(value).size !== value.length) throw completedRunValidationError(`COMPLETED_RUN_DUPLICATE:${label}`);
  return Object.freeze([...value].sort((left, right) => left.localeCompare(right)));
}

function canonicalizeUniqueValues(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw completedRunValidationError(`COMPLETED_RUN_INVALID:${label}`);
  const keyed = value.map((item) => ({ item, key: stableFingerprint(item) }));
  if (new Set(keyed.map((item) => item.key)).size !== keyed.length) throw completedRunValidationError(`COMPLETED_RUN_DUPLICATE:${label}`);
  return Object.freeze(keyed.sort((left, right) => left.key.localeCompare(right.key)).map((item) => item.item));
}

function validateCanonicalTotals(manifest: Risk001DryRunManifest): void {
  const summary = manifest.summaryTotals;
  if (!isRecord(summary) || !isRecord(summary.plannerRecordCounts) || !isRecord(manifest.aggregateTotals)) {
    throw completedRunValidationError("COMPLETED_RUN_TOTALS_INVALID");
  }
  for (const outcome of manifest.assessmentOutcomes) {
    if (summary.plannerRecordCounts[outcome.areaId] !== outcome.actionCount) {
      throw completedRunValidationError(`COMPLETED_RUN_TOTAL_MISMATCH:${outcome.areaId}`);
    }
  }
  const aggregate = manifest.aggregateTotals;
  const sum = (field: keyof Risk001AssessmentOutcome): number => manifest.assessmentOutcomes.reduce((total, item) => total + Number(item[field]), 0);
  if (aggregate.actionCount !== sum("actionCount") || aggregate.candidateCount !== sum("candidateCount") ||
    aggregate.dependencyCheckCount !== sum("dependencyCheckCount") || aggregate.blockingClassificationCount !== sum("blockingClassificationCount") ||
    aggregate.loaderCount !== manifest.loaderOutcomes.length || aggregate.completedLoaderCount !== manifest.loaderOutcomes.length ||
    aggregate.assessmentAreaCount !== manifest.assessmentOutcomes.length || aggregate.completedAssessmentAreaCount !== manifest.assessmentOutcomes.length ||
    aggregate.queryEvidenceCount !== manifest.queryEvidence.length) {
    throw completedRunValidationError("COMPLETED_RUN_AGGREGATE_MISMATCH");
  }
  const expectedVerdict = manifest.totalsByClassification.UNMIGRATABLE_WITHOUT_OWNER_DECISION > 0 ||
    manifest.totalsByClassification.AMBIGUOUS_MANUAL_REVIEW > 0 ? "OWNER_REVIEW_REQUIRED" : "READ_ONLY_PLAN_COMPLETE";
  if (summary.verdict !== expectedVerdict) throw completedRunValidationError("COMPLETED_RUN_VERDICT_MISMATCH");
  const dependency = manifest.dependencyResolution;
  if (dependency.declaredEdgeCount !== 8 || dependency.propagatingEdgeCount !== 7 || dependency.advisoryOnlyEdgeCount !== 1 ||
    dependency.totals.propagatedBlockerCount !== dependency.propagatedBlockers.length ||
    dependency.totals.unresolvedBindingCount !== dependency.unresolvedBindings.length ||
    dependency.totals.relatedAreaAdvisoryCount !== dependency.relatedAreaAdvisories.length ||
    dependency.propagatedBlockers.some((blocker) => blocker.edgeId === "R001-EDGE-07") ||
    dependency.relatedAreaAdvisories.some((advisory) => advisory.edgeId !== "R001-EDGE-07" || advisory.downstreamBinding !== "NONE_AVAILABLE")) {
    throw completedRunValidationError("COMPLETED_RUN_DEPENDENCY_RESOLUTION_INVALID");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: Record<string, unknown>, field: string): string {
  if (typeof value[field] !== "string" || value[field].length === 0) throw completedRunValidationError(`COMPLETED_RUN_INVALID:${field}`);
  return value[field];
}

function completedRunValidationError(reason: string): Risk001SanitizedError {
  return new Risk001SanitizedError("VALIDATION_FAILED", `Completed-run validation failed: ${reason}`);
}

function buildAssessmentOutcomes(
  plannerManifest: MigrationManifest,
): readonly Risk001AssessmentOutcome[] {
  if (!exactAreaSet(plannerManifest.orderedMigrations)) {
    throw incompleteRunError(["PLANNER_RESULTS_INCOMPLETE"]);
  }
  return Object.freeze(RISK001_REQUIRED_ASSESSMENT_AREA_IDS.map((areaId) => {
    const actions = plannerManifest.actions.filter((action) => action.migrationId === areaId);
    const totalsByClassification = Object.freeze(Object.fromEntries(
      MIGRATION_CLASSIFICATIONS.map((classification) => [
        classification,
        actions.filter((action) => action.classification === classification).length,
      ]),
    ) as Record<MigrationClassification, number>);
    return Object.freeze({
      areaId,
      status: "COMPLETED" as const,
      actionCount: actions.length,
      candidateCount: actions.filter((action) => action.proposedAction !== "NONE").length,
      blockingClassificationCount: actions.filter(isBlockingClassification).length,
      dependencyCheckCount: actions.reduce((total, action) => total + action.dependencyChecks.length, 0),
      totalsByClassification,
    });
  }));
}

function buildAggregateTotals(
  loaderOutcomes: readonly Risk001LoaderOutcome[],
  assessmentOutcomes: readonly Risk001AssessmentOutcome[],
  evidence: readonly QueryCountEvidence[],
  actions: readonly PlannedMigrationAction[],
): Risk001AggregateTotals {
  return Object.freeze({
    loaderCount: loaderOutcomes.length,
    completedLoaderCount: loaderOutcomes.filter((item) => item.status === "COMPLETED").length,
    assessmentAreaCount: assessmentOutcomes.length,
    completedAssessmentAreaCount: assessmentOutcomes.filter((item) => item.status === "COMPLETED").length,
    queryEvidenceCount: evidence.length,
    actionCount: actions.length,
    candidateCount: actions.filter((action) => action.proposedAction !== "NONE").length,
    dependencyCheckCount: actions.reduce((total, action) => total + action.dependencyChecks.length, 0),
    blockingClassificationCount: actions.filter(isBlockingClassification).length,
  });
}

function isBlockingClassification(action: PlannedMigrationAction): boolean {
  return [
    "AMBIGUOUS_MANUAL_REVIEW",
    "UNMIGRATABLE_WITHOUT_OWNER_DECISION",
    "HISTORICAL_UNKNOWN_PRESERVE_AS_UNKNOWN",
  ].includes(action.classification);
}

function freezeLoaderOutcome(outcome: Risk001LoaderOutcome): Risk001LoaderOutcome {
  return Object.freeze({
    ...outcome,
    queryIdentityFingerprints: Object.freeze([...outcome.queryIdentityFingerprints]),
    sourceStateFingerprints: Object.freeze([...outcome.sourceStateFingerprints]),
  });
}

function buildSanitizedSamples(
  actions: readonly PlannedMigrationAction[],
  maxSamples: number,
): Readonly<Record<string, readonly string[]>> {
  const byPlanner = new Map<string, string[]>();
  for (const action of actions) {
    const samples = byPlanner.get(action.migrationId) ?? [];
    if (samples.length < maxSamples) {
      samples.push(action.sanitizedRecordIdentity);
      byPlanner.set(action.migrationId, samples);
    }
  }
  return Object.freeze(
    Object.fromEntries(
      [...byPlanner.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([planner, samples]) => [planner, Object.freeze(samples)]),
    ),
  );
}

function buildPlannerTotals(
  actions: readonly PlannedMigrationAction[],
): Readonly<Record<string, Readonly<Record<string, number>>>> {
  const totals: Record<string, Record<string, number>> = {};
  for (const action of actions) {
    const planner = (totals[action.migrationId] ??= {});
    planner[action.classification] = (planner[action.classification] ?? 0) + 1;
  }
  return Object.freeze(
    Object.fromEntries(
      Object.entries(totals)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([planner, counts]) => [planner, Object.freeze({ ...counts })]),
    ),
  );
}

function buildRisk001DependencyRecords(
  inputs: Readonly<Record<string, unknown>>,
  actions: readonly PlannedMigrationAction[],
): readonly Risk001DependencyRecord[] {
  const actionByIdentity = new Map(actions.map((action) => [`${action.migrationId}|${action.sanitizedRecordIdentity}`, action]));
  const records: Risk001DependencyRecord[] = [];
  for (const areaId of RISK001_REQUIRED_ASSESSMENT_AREA_IDS) {
    const input = inputs[areaId];
    if (!Array.isArray(input)) throw incompleteRunError([`DEPENDENCY_INPUT_MISSING:${areaId}`]);
    for (const source of input) {
      if (!isRecord(source)) throw incompleteRunError([`DEPENDENCY_INPUT_INVALID:${areaId}`]);
      const sourceRecordId = sourceRecordIdentity(areaId, source);
      const action = dependencyActionFor(areaId, sourceRecordId, actionByIdentity);
      if (!action) throw incompleteRunError([`DEPENDENCY_ACTION_MISSING:${areaId}`]);
      records.push(Object.freeze({
        areaId,
        sourceRecordId,
        sanitizedRecordId: action.sanitizedRecordIdentity,
        relationKeys: Object.freeze(relationKeysFor(areaId, source, sourceRecordId)),
        action,
      }));
    }
  }
  return Object.freeze(records);
}

function sourceRecordIdentity(areaId: Risk001AssessmentAreaId, source: Record<string, unknown>): string {
  const field = areaId === "RISK001_BUNDLE_CONSISTENCY" ? "parentId" :
    areaId === "RISK001_SCOPE_FINGERPRINT" || areaId === "RISK001_COARSE_KPI_SCOPE" ? "assignmentId" :
    areaId === "RISK001_ACCOUNT_CONTEXT_READINESS" ? "userId" :
    areaId === "RISK001_TALENT_IDENTITY_READINESS" ? "talentId" : "id";
  return readString(source, field);
}

function dependencyActionFor(
  areaId: Risk001AssessmentAreaId,
  sourceRecordId: string,
  actions: ReadonlyMap<string, PlannedMigrationAction>,
): PlannedMigrationAction | undefined {
  const recordClasses = areaId === "RISK001_ROLE_DRIFT" ? ["ROLE", "LEGACY_ROLE"] :
    areaId === "RISK001_LEGACY_ROLE_RETIREMENT" ? ["LEGACY_ROLE"] :
    areaId === "RISK001_BUNDLE_CONSISTENCY" ? ["BUNDLE"] :
    areaId === "RISK001_SCOPE_FINGERPRINT" ? ["SCOPE_GRANT"] :
    areaId === "RISK001_ACCOUNT_CONTEXT_READINESS" ? ["ACCOUNT_CONTEXT"] :
    areaId === "RISK001_TALENT_IDENTITY_READINESS" ? ["TALENT_IDENTITY"] :
    areaId === "RISK001_COARSE_KPI_SCOPE" ? ["COARSE_KPI_SCOPE"] : ["STALE_KPI"];
  return recordClasses.map((recordClass) => actions.get(`${areaId}|${sanitizedIdentity(recordClass, sourceRecordId)}`)).find((action): action is PlannedMigrationAction => Boolean(action));
}

function relationKeysFor(
  areaId: Risk001AssessmentAreaId,
  source: Record<string, unknown>,
  sourceRecordId: string,
): Readonly<Record<string, readonly string[]>> {
  const strings = (field: string): readonly string[] => Array.isArray(source[field])
    ? source[field].filter((value): value is string => typeof value === "string" && value.length > 0).sort()
    : typeof source[field] === "string" && source[field].length > 0 ? [source[field] as string] : [];
  const single = (field: string): readonly string[] => typeof source[field] === "string" && source[field].length > 0 ? [source[field] as string] : [];
  switch (areaId) {
    case "RISK001_ROLE_DRIFT": return { roleId: [sourceRecordId] };
    case "RISK001_LEGACY_ROLE_RETIREMENT": return { roleId: [sourceRecordId] };
    case "RISK001_BUNDLE_CONSISTENCY": return { relatedRoleIds: strings("relatedRoleIds") };
    case "RISK001_SCOPE_FINGERPRINT": return { roleId: single("roleId"), assignmentId: [sourceRecordId] };
    case "RISK001_ACCOUNT_CONTEXT_READINESS": return { userId: [sourceRecordId], activeRoleIds: strings("activeRoleIds") };
    case "RISK001_TALENT_IDENTITY_READINESS": return { talentId: [sourceRecordId], linkedUserId: single("linkedUserId") };
    case "RISK001_COARSE_KPI_SCOPE": return { assignmentId: [sourceRecordId] };
    case "RISK001_STALE_KPI_DATA": return { relatedTalentIds: strings("relatedTalentIds") };
  }
}

function formatEvidence(evidence: QueryCountEvidence): string {
  return `- ${evidence.collection}: ${evidence.countKind}; inspected=${evidence.inspectedCount}; matched=${evidence.matchedCount}; pageSize=${evidence.pageSize}; ceiling=${evidence.safetyCeiling}; query=${evidence.queryIdentityFingerprint}; source=${evidence.sourceStateFingerprint}`;
}

function formatLoaderOutcome(outcome: Risk001LoaderOutcome): string {
  return `- ${outcome.areaId}: status=${outcome.status}; records=${outcome.recordCount}; evidence=${outcome.evidenceCount}; exceptions=${outcome.exceptionCount}; queries=${outcome.queryIdentityFingerprints.join(",") || "NONE"}; sources=${outcome.sourceStateFingerprints.join(",") || "NONE"}`;
}

function formatAssessmentOutcome(outcome: Risk001AssessmentOutcome): string {
  return `- ${outcome.areaId}: status=${outcome.status}; actions=${outcome.actionCount}; candidates=${outcome.candidateCount}; blockers=${outcome.blockingClassificationCount}; dependencyChecks=${outcome.dependencyCheckCount}`;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
