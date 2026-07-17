export const RISK001_ENTERPRISE_CONTRACT_VERSION =
  "RISK001-ENTERPRISE-CONTRACT-2026-07-V1";
export const RISK001_QUERY_GRAMMAR_VERSION = "risk-001-query-grammar/v1";
export const RISK001_SOURCE_PROJECTION_CONTRACT_VERSION =
  "risk-001-source-projection-contract/v4-batch-c-dependency-relation-keys";
export const RISK001_SANITIZATION_CONTRACT_VERSION =
  "risk-001-output-sanitization/v1";
/** Frozen Batch A Owner decision: only a missing final output directory is creatable. */
export const RISK001_NESTED_NONEXISTENT_OUTPUT_POLICY =
  "REJECT_WHEN_ANY_INTERMEDIATE_PARENT_IS_MISSING" as const;

export const RISK001_REQUIRED_ASSESSMENT_AREA_IDS = Object.freeze([
  "RISK001_ROLE_DRIFT",
  "RISK001_LEGACY_ROLE_RETIREMENT",
  "RISK001_BUNDLE_CONSISTENCY",
  "RISK001_SCOPE_FINGERPRINT",
  "RISK001_ACCOUNT_CONTEXT_READINESS",
  "RISK001_TALENT_IDENTITY_READINESS",
  "RISK001_COARSE_KPI_SCOPE",
  "RISK001_STALE_KPI_DATA",
] as const);

export type Risk001AssessmentAreaId =
  (typeof RISK001_REQUIRED_ASSESSMENT_AREA_IDS)[number];

export interface Risk001LoaderOutcome {
  readonly areaId: Risk001AssessmentAreaId;
  readonly status: "COMPLETED" | "INCOMPLETE";
  readonly recordCount: number;
  readonly evidenceCount: number;
  readonly exceptionCount: number;
  readonly queryIdentityFingerprints: readonly string[];
  readonly sourceStateFingerprints: readonly string[];
}

export interface Risk001ReadCompletionState {
  readonly capturedReadVerification: "PASSED" | "FAILED";
  readonly paginationConsistency: "PASSED" | "FAILED";
}

export interface Risk001RunCompletionState {
  readonly status: "ASSESSMENT_COMPLETE";
  readonly completionGate: "PASSED";
  readonly loaderState: "COMPLETE";
  readonly plannerState: "COMPLETE";
  readonly capturedReadVerification: "PASSED";
  readonly paginationConsistency: "PASSED";
  readonly requiredLoaderCount: 8;
  readonly completedLoaderCount: 8;
  readonly requiredAssessmentAreaCount: 8;
  readonly completedAssessmentAreaCount: 8;
  readonly incompleteStageCount: 0;
}

export interface Risk001PublicationState {
  readonly protocol: "SUMMARY_THEN_MANIFEST_LAST";
  readonly summaryPublication: "REQUIRED_BEFORE_COMPLETION_COMMIT";
  readonly manifestPublication: "FINAL_COMPLETION_COMMIT";
  readonly validManifestOnFailure: false;
}

export interface Risk001SanitizationState {
  readonly contractVersion: typeof RISK001_SANITIZATION_CONTRACT_VERSION;
  readonly status: "SANITIZED";
  readonly rawFiltersPublished: false;
  readonly credentialsPublished: false;
  readonly privateIdentifiersPublished: false;
  readonly rawResultPayloadsPublished: false;
  readonly exceptionRepresentation: "SANITIZED_CODES_ONLY";
}
