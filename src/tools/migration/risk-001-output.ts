import type { MigrationClassification, PlannedMigrationAction } from "./migration-program";
import { buildDryRunManifest, stableFingerprint } from "./migration-program";
import type { QueryCountEvidence, Risk001PlannerInputLoadResult } from "./risk-001-data-loaders";
import { createRisk001Registry } from "./risk-001-planners";

export const RISK001_MANIFEST_SCHEMA_VERSION = "risk-001-read-only-manifest/v1";
export const RISK001_PLANNER_REGISTRY_VERSION = "risk-001-registry/v1";

export interface SourceVersionEvidence {
  readonly gitCommit: string;
  readonly workingTreeFingerprint: string;
  readonly workingTreeDirty: boolean;
}

export interface Risk001DryRunManifest {
  readonly schemaVersion: typeof RISK001_MANIFEST_SCHEMA_VERSION;
  readonly plannerRegistryVersion: typeof RISK001_PLANNER_REGISTRY_VERSION;
  readonly source: SourceVersionEvidence;
  readonly databaseName: string;
  readonly executionMode: "READ_ONLY_DRY_RUN";
  readonly observedAt: string;
  readonly runLabel: string | null;
  readonly planFingerprint: string;
  readonly databaseAccessMode: "AUTHORIZED_READ_ONLY_VIA_ENV_DEV";
  readonly databaseWriteCapability: "STRUCTURALLY_ABSENT";
  readonly migrationExecutionStatus: "NOT_EXECUTED";
  readonly dbSecretExposure: "NONE";
  readonly queryEvidence: readonly QueryCountEvidence[];
  readonly plannerOrder: readonly string[];
  readonly plannerClassifications: readonly PlannedMigrationAction[];
  readonly sanitizedSamples: Readonly<Record<string, readonly string[]>>;
  readonly totalsByPlannerAndClassification: Readonly<Record<string, Readonly<Record<string, number>>>>;
  readonly totalsByClassification: Readonly<Record<MigrationClassification, number>>;
  readonly affectedAccountCount: number;
  readonly authorityRisk: {
    readonly expansionReviewCount: number;
    readonly reductionReviewCount: number;
  };
  readonly ownerApprovalRequirements: readonly string[];
  readonly sourceRemovalGates: readonly string[];
  readonly exceptions: readonly string[];
  readonly historicalUnknownPreservationCount: number;
}

export function buildRisk001DryRunManifest(params: {
  readonly loaded: Risk001PlannerInputLoadResult;
  readonly source: SourceVersionEvidence;
  readonly databaseName: string;
  readonly observedAt: number;
  readonly runLabel?: string;
  readonly maxSamples?: number;
}): Risk001DryRunManifest {
  const plannerManifest = buildDryRunManifest({
    registry: createRisk001Registry(),
    inputs: params.loaded.inputs,
  });
  const totalsByPlannerAndClassification = buildPlannerTotals(plannerManifest.actions);
  const sanitizedSamples = buildSanitizedSamples(
    plannerManifest.actions,
    params.maxSamples ?? 5,
  );
  const deterministicBody = {
    schemaVersion: RISK001_MANIFEST_SCHEMA_VERSION,
    plannerRegistryVersion: RISK001_PLANNER_REGISTRY_VERSION,
    source: params.source,
    databaseName: params.databaseName,
    executionMode: "READ_ONLY_DRY_RUN",
    runLabel: params.runLabel ?? null,
    generatedFromFingerprint: plannerManifest.generatedFromFingerprint,
    queryEvidence: params.loaded.evidence,
    plannerOrder: plannerManifest.orderedMigrations,
    plannerClassifications: plannerManifest.actions,
    sanitizedSamples,
    totalsByPlannerAndClassification,
    totalsByClassification: plannerManifest.counts,
    affectedAccountCount: params.loaded.affectedAccountCount,
    exceptions: params.loaded.exceptions,
  } as const;
  const actions = plannerManifest.actions;
  return Object.freeze({
    ...deterministicBody,
    observedAt: new Date(params.observedAt).toISOString(),
    planFingerprint: stableFingerprint(deterministicBody),
    databaseAccessMode: "AUTHORIZED_READ_ONLY_VIA_ENV_DEV",
    databaseWriteCapability: "STRUCTURALLY_ABSENT",
    migrationExecutionStatus: "NOT_EXECUTED",
    dbSecretExposure: "NONE",
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

export function renderRisk001Summary(manifest: Risk001DryRunManifest): string {
  const counts = manifest.totalsByClassification;
  const actions = manifest.plannerClassifications;
  const proposed = proposedActionCounts(actions);
  const permissionAdditions = permissionDelta(actions, "permissionAdditions");
  const permissionRemovals = permissionDelta(actions, "permissionRemovals");
  const plannerCount = (plannerId: string): number =>
    actions.filter((action) => action.migrationId === plannerId).length;
  const verdict =
    manifest.exceptions.length > 0 ||
    counts.UNMIGRATABLE_WITHOUT_OWNER_DECISION > 0 ||
    counts.AMBIGUOUS_MANUAL_REVIEW > 0
      ? "OWNER_REVIEW_REQUIRED"
      : "READ_ONLY_PLAN_COMPLETE";
  return [
    "# RISK-001 read-only dry-run summary",
    "",
    "## 1. Dry-run verdict",
    "",
    verdict,
    "",
    "## 2. Database access and secret-exposure status",
    "",
    `DATABASE_ACCESS_MODE: ${manifest.databaseAccessMode}`,
    `DATABASE_WRITE_CAPABILITY: ${manifest.databaseWriteCapability}`,
    `DB_SECRET_EXPOSURE: ${manifest.dbSecretExposure}`,
    "",
    "## 3. Source and planner versions",
    "",
    `Git commit: ${manifest.source.gitCommit}`,
    `Working-tree fingerprint: ${manifest.source.workingTreeFingerprint}`,
    `Planner registry: ${manifest.plannerRegistryVersion}`,
    `Plan fingerprint: ${manifest.planFingerprint}`,
    "",
    "## 4. Query scope",
    "",
    ...manifest.queryEvidence.map(formatEvidence),
    "",
    "## 5. Counts by classification",
    "",
    ...Object.entries(counts).map(([classification, count]) => `- ${classification}: ${count}`),
    "",
    "## 6. Canonical Role drift summary",
    "",
    `Inspected planner records: ${plannerCount("RISK001_ROLE_DRIFT")}. Exact permission deltas are present only in sanitized planner actions.`,
    "",
    "## 7. Legacy Role retirement dependencies",
    "",
    `Inspected planner records: ${plannerCount("RISK001_LEGACY_ROLE_RETIREMENT")}. Retirement remains Owner-gated and source-removal-gated.`,
    "",
    "## 8. Bundle consistency findings",
    "",
    `Inspected planner records: ${plannerCount("RISK001_BUNDLE_CONSISTENCY")}. No child reactivation is proposed.`,
    "",
    "## 9. ScopeGrant fingerprint findings",
    "",
    `Inspected planner records: ${plannerCount("RISK001_SCOPE_FINGERPRINT")}. Canonical fingerprint planning only.`,
    "",
    "## 10. Account Context readiness findings",
    "",
    `Inspected planner records: ${plannerCount("RISK001_ACCOUNT_CONTEXT_READINESS")}. Missing eligibility is never inferred from Role labels.`,
    "",
    "## 11. Talent/EmploymentProfile readiness findings",
    "",
    `Inspected planner records: ${plannerCount("RISK001_TALENT_IDENTITY_READINESS")}. No EmploymentProfile creation or fabricated link is proposed.`,
    "",
    "## 12. Coarse KPI scope findings",
    "",
    `Inspected planner records: ${plannerCount("RISK001_COARSE_KPI_SCOPE")}. Coarse scope is inventoried as compatibility data, not current write authority.`,
    "",
    "## 13. Stale KPI Plan/metric/Allocation/Actual findings",
    "",
    `Inspected planner records: ${plannerCount("RISK001_STALE_KPI_DATA")}. Historical-unknown preservation count: ${manifest.historicalUnknownPreservationCount}. KPI Actual is not interpreted as Revenue.`,
    "",
    "## 14. Proposed adds/removes/syncs/retires/archives/deletes/rebuilds",
    "",
    `- Exact permission additions: ${permissionAdditions.length > 0 ? permissionAdditions.join(", ") : "NONE"}`,
    `- Exact permission removals: ${permissionRemovals.length > 0 ? permissionRemovals.join(", ") : "NONE"}`,
    ...(proposed.length > 0 ? proposed : ["- NONE"]),
    "",
    "## 15. Affected accounts",
    "",
    `Sanitized unique affected-account count: ${manifest.affectedAccountCount}.`,
    "",
    "## 16. Authority expansion/reduction risks",
    "",
    `Expansion reviews: ${manifest.authorityRisk.expansionReviewCount}; reduction reviews: ${manifest.authorityRisk.reductionReviewCount}.`,
    "",
    "## 17. Manual-review and Owner-decision items",
    "",
    ...(manifest.ownerApprovalRequirements.length > 0
      ? manifest.ownerApprovalRequirements.map((item) => `- ${item}`)
      : ["- NONE"]),
    "",
    "## 18. Exceptions",
    "",
    ...(manifest.exceptions.length > 0 ? manifest.exceptions.map((item) => `- ${item}`) : ["- NONE"]),
    "",
    "## 19. No-write statement",
    "",
    "No database write occurred.",
    "",
    "## 20. Exact next action",
    "",
    "Owner manifest review.",
    "",
  ].join("\n");
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

function proposedActionCounts(actions: readonly PlannedMigrationAction[]): string[] {
  const counts = new Map<string, number>();
  for (const action of actions) {
    if (action.proposedAction === "NONE") continue;
    counts.set(action.proposedAction, (counts.get(action.proposedAction) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([action, count]) => `- ${action}: ${count}`);
}

function permissionDelta(
  actions: readonly PlannedMigrationAction[],
  field: "permissionAdditions" | "permissionRemovals",
): string[] {
  return uniqueSorted(
    actions.flatMap((action) => {
      const value = action.plannedAfter[field];
      return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string")
        : [];
    }),
  );
}

function formatEvidence(evidence: QueryCountEvidence): string {
  return `- ${evidence.collection}: ${evidence.countKind}; inspected=${evidence.inspectedCount}; matched=${evidence.matchedCount}; pageSize=${evidence.pageSize}; ceiling=${evidence.safetyCeiling}`;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
