import {
  MigrationDescriptor,
  MigrationRegistry,
  plannedAction,
  sanitizedIdentity,
} from "./migration-program";
import {
  classifyRoleTemplateDrift,
  PersistedRoleIntegrityInput,
} from "@modules/role/domain/role-template-integrity";
import {
  LEGACY_ROLE_TEMPLATE_CODES,
  RoleTemplateDefinition,
} from "@modules/role/domain/role-template.catalog";
import { buildRoleAssignmentScopeFingerprint, RoleAssignmentScopeGrant } from "@modules/role/domain/role-assignment-scope";

const V = 1;

export interface RoleDriftPlannerRecord extends PersistedRoleIntegrityInput {
  readonly id: string;
  readonly activeAccountCount: number;
  readonly template: RoleTemplateDefinition | null;
}

export const roleDriftPlanner: MigrationDescriptor<readonly RoleDriftPlannerRecord[]> = {
  id: "RISK001_ROLE_DRIFT",
  version: V,
  dependencies: [],
  recordClass: "ROLE",
  plan: (records = []) =>
    records.map((record) => {
      const drift = classifyRoleTemplateDrift({
        role: record,
        template: record.template,
        legacyCodes: new Set<string>(LEGACY_ROLE_TEMPLATE_CODES),
      });
      const decision = roleDriftPlanningDecision(record, drift);
      return plannedAction({
        migrationId: "RISK001_ROLE_DRIFT",
        migrationVersion: V,
        recordClass: "ROLE",
        sanitizedRecordIdentity: sanitizedIdentity(
          drift.classification === "LEGACY_COMPATIBILITY_ROLE"
            ? "LEGACY_ROLE"
            : "ROLE",
          record.id,
        ),
        currentStateSummary: {
          classification: drift.classification,
          activeAccountCount: record.activeAccountCount,
          missingPermissionCount: drift.missingPermissions.length,
          extraPermissionCount: drift.extraPermissions.length,
          versionMatched: drift.versionMatched,
          sourceFingerprint: drift.sourceFingerprint,
          persistedPermissionFingerprint: drift.persistedPermissionFingerprint,
        },
        proposedAction: decision.proposedAction,
        preconditions: decision.preconditions,
        dependencyChecks: ["active assignments", "permission expansion/reduction", "break-glass intent"],
        expectedEffect: decision.expectedEffect,
        reasonCode: drift.classification,
        classification: decision.classification,
        requiredApproval: decision.requiredApproval,
        sourceRemovalDependency: "Role compatibility source remains until zero active dependencies and post-migration validation",
        before: record,
        plannedAfter: decision.plannedAfter,
      });
    }),
};

function roleDriftPlanningDecision(
  record: RoleDriftPlannerRecord,
  drift: ReturnType<typeof classifyRoleTemplateDrift>,
): {
  readonly proposedAction: string;
  readonly preconditions: readonly string[];
  readonly expectedEffect: string;
  readonly classification:
    | "DETERMINISTIC_WITH_PRECONDITION"
    | "AMBIGUOUS_MANUAL_REVIEW"
    | "UNMIGRATABLE_WITHOUT_OWNER_DECISION"
    | "NO_MIGRATION_REQUIRED";
  readonly requiredApproval: "NONE" | "OWNER";
  readonly plannedAfter: Readonly<Record<string, unknown>>;
} {
  const noMutation = (reason: string) => ({
    authorityMutation: "NONE",
    manualDecisionRequired: reason,
    sourceTemplateCode: record.template?.code ?? null,
    sourceTemplateVersion: record.template?.version ?? null,
    sourceTemplateFingerprint: drift.sourceFingerprint,
    currentPersistedFingerprint: drift.persistedPermissionFingerprint,
    activeAccountImpact: record.activeAccountCount,
  });
  switch (drift.classification) {
    case "MATCHED":
      return {
        proposedAction: "NONE",
        preconditions: [],
        expectedEffect: "No authority change",
        classification: "NO_MIGRATION_REQUIRED",
        requiredApproval: "NONE",
        plannedAfter: noMutation("NOT_REQUIRED"),
      };
    case "STALE_MISSING_PERMISSIONS":
    case "STALE_EXTRA_PERMISSIONS":
    case "STALE_MIXED": {
      const approvalPreconditions = [
        "independent source audit passes",
        "exact effective-access additions and removals reviewed",
        "Owner approves active-account expansion/reduction impact",
      ];
      return {
        proposedAction: "REVIEW_EXACT_CANONICAL_ROLE_SYNC_DELTA",
        preconditions: approvalPreconditions,
        expectedEffect:
          "Apply only the reviewed canonical permission additions/removals after approval",
        classification: "DETERMINISTIC_WITH_PRECONDITION",
        requiredApproval: "OWNER",
        plannedAfter: {
          authorityMutation: "CANONICAL_PERMISSION_SYNC_AFTER_APPROVAL",
          permissionAdditions: drift.missingPermissions,
          permissionRemovals: drift.extraPermissions,
          sourceTemplateCode: record.template?.code ?? null,
          sourceTemplateVersion: record.template?.version ?? null,
          sourceTemplateFingerprint: drift.sourceFingerprint,
          currentPersistedFingerprint: drift.persistedPermissionFingerprint,
          activeAccountImpact: record.activeAccountCount,
          expansionRisk:
            drift.missingPermissions.length > 0 ? "REVIEW_REQUIRED" : "NONE",
          reductionRisk:
            drift.extraPermissions.length > 0 ? "REVIEW_REQUIRED" : "NONE",
          approvalPreconditions,
        },
      };
    }
    case "LEGACY_COMPATIBILITY_ROLE":
      return {
        proposedAction: "CROSS_REFERENCE_LEGACY_ROLE_RETIREMENT_NO_SYNC",
        preconditions: ["legacy dependency inventory reviewed"],
        expectedEffect:
          "No canonical Role sync; the legacy-retirement planner owns any approved action",
        classification:
          record.activeAccountCount > 0
            ? "UNMIGRATABLE_WITHOUT_OWNER_DECISION"
            : "AMBIGUOUS_MANUAL_REVIEW",
        requiredApproval: "OWNER",
        plannedAfter: {
          ...noMutation("LEGACY_RETIREMENT_OWNER_DECISION_REQUIRED"),
          authoritativePlanner: "RISK001_LEGACY_ROLE_RETIREMENT",
        },
      };
    case "DEFERRED_NOT_ACTIVE":
      return {
        proposedAction: "PRESERVE_DEFERRED_ROLE_STATE",
        preconditions: [],
        expectedEffect: "No authority change and no activation proposal",
        classification: "NO_MIGRATION_REQUIRED",
        requiredApproval: "NONE",
        plannedAfter: noMutation("DEFERRED_TEMPLATE_REMAINS_INACTIVE"),
      };
    case "UNKNOWN_ORPHAN":
      return {
        proposedAction: "MANUAL_ROLE_PROVENANCE_DECISION_NO_SYNC",
        preconditions: ["Owner selects a source-backed disposition"],
        expectedEffect: "No authority mutation until provenance is resolved",
        classification:
          record.activeAccountCount > 0
            ? "UNMIGRATABLE_WITHOUT_OWNER_DECISION"
            : "AMBIGUOUS_MANUAL_REVIEW",
        requiredApproval: "OWNER",
        plannedAfter: noMutation("UNKNOWN_ROLE_PROVENANCE_REQUIRES_OWNER_DECISION"),
      };
  }
}

export interface LegacyRoleRecord {
  readonly id: string;
  readonly code: string;
  readonly activeAssignmentCount: number;
  readonly bundleParentCount: number;
  readonly bundleChildCount: number;
  readonly accountContextDependencyCount: number;
  readonly effectivePermissions: readonly string[];
  readonly replacementRoleCodes: readonly string[];
}

export const legacyRolePlanner: MigrationDescriptor<readonly LegacyRoleRecord[]> = {
  id: "RISK001_LEGACY_ROLE_RETIREMENT",
  version: V,
  dependencies: ["RISK001_ROLE_DRIFT"],
  recordClass: "LEGACY_ROLE",
  plan: (records = []) => records.map((record) => {
    const dependencyCount =
      record.activeAssignmentCount +
      record.bundleParentCount +
      record.bundleChildCount +
      record.accountContextDependencyCount;
    return plannedAction({
    migrationId: "RISK001_LEGACY_ROLE_RETIREMENT", migrationVersion: V,
    recordClass: "LEGACY_ROLE", sanitizedRecordIdentity: sanitizedIdentity("LEGACY_ROLE", record.id),
    currentStateSummary: {
      code: record.code, activeAssignmentCount: record.activeAssignmentCount,
      bundleParentCount: record.bundleParentCount, bundleChildCount: record.bundleChildCount,
      accountContextDependencyCount: record.accountContextDependencyCount,
      effectivePermissionCount: record.effectivePermissions.length,
      dependencyCount,
    },
    proposedAction: "REVIEW_REPLACEMENT_THEN_RETIRE_PERSISTED_DEPENDENCIES",
    preconditions: ["replacement authority proven", "effective union preserved or approved reduction"],
    dependencyChecks: ["assignments", "bundle parents/children", "Account Context", "compatibility readers"],
    expectedEffect: "Require an Owner decision before any legacy authority change",
    reasonCode: "LEGACY_ROLE_ACTIVE_DEPENDENCY_INVENTORY",
    classification: dependencyCount > 0
      ? "UNMIGRATABLE_WITHOUT_OWNER_DECISION"
      : "AMBIGUOUS_MANUAL_REVIEW", requiredApproval: "OWNER",
    sourceRemovalDependency: "Remove source only after dependency count is zero and post-migration audit passes",
    before: record, plannedAfter: {
      authorityMutation: "NONE",
      manualDecisionRequired: true,
      reviewedReplacementCandidates: record.replacementRoleCodes,
      retirementProposed: false,
    },
  }); }),
};

export interface BundleConsistencyRecord {
  readonly parentId: string; readonly status: string;
  readonly expectedChildIds: readonly string[]; readonly activeChildIds: readonly string[];
  readonly revokedChildIds: readonly string[]; readonly provenanceComplete: boolean;
}
export const bundlePlanner: MigrationDescriptor<readonly BundleConsistencyRecord[]> = simplePlanner(
  "RISK001_BUNDLE_CONSISTENCY", "BUNDLE", ["RISK001_LEGACY_ROLE_RETIREMENT"],
  (record) => ({
    id: record.parentId,
    summary: { status: record.status, expectedChildCount: record.expectedChildIds.length, activeChildCount: record.activeChildIds.length, revokedChildCount: record.revokedChildIds.length },
    action: record.provenanceComplete ? "PLAN_PARENT_RETIREMENT_OR_EXACT_CHILD_RECONCILIATION" : "MANUAL_REVIEW_NO_CHILD_REACTIVATION",
    reason: record.provenanceComplete ? "BUNDLE_CHILD_MISMATCH" : "BUNDLE_PROVENANCE_INCOMPLETE",
    classification: record.provenanceComplete ? "DETERMINISTIC_WITH_PRECONDITION" : "AMBIGUOUS_MANUAL_REVIEW",
  }),
);

export interface ScopeFingerprintRecord { readonly assignmentId: string; readonly grants: readonly RoleAssignmentScopeGrant[]; readonly storedFingerprint?: string; readonly subjectsExist: boolean; }
export const scopeFingerprintPlanner: MigrationDescriptor<readonly ScopeFingerprintRecord[]> = simplePlanner(
  "RISK001_SCOPE_FINGERPRINT", "SCOPE_GRANT", ["RISK001_ROLE_DRIFT"],
  (record) => {
    const expected = buildRoleAssignmentScopeFingerprint(record.grants);
    const valid = record.subjectsExist && record.grants.length > 0;
    return { id: record.assignmentId, summary: { subjectsExist: record.subjectsExist, fingerprintMatched: record.storedFingerprint === expected },
      action: valid && record.storedFingerprint !== expected ? "SET_CANONICAL_SCOPE_FINGERPRINT" : "NONE_OR_MANUAL_REVIEW",
      reason: !valid ? "SCOPE_SUBJECT_AMBIGUOUS" : record.storedFingerprint === expected ? "SCOPE_FINGERPRINT_MATCHED" : "SCOPE_FINGERPRINT_REPAIR",
      classification: !valid ? "AMBIGUOUS_MANUAL_REVIEW" : record.storedFingerprint === expected ? "NO_MIGRATION_REQUIRED" : "DETERMINISTIC_AUTO_MIGRATION" };
  },
);

export interface AccountContextReadinessRecord { readonly userId: string; readonly activeRoleCodes: readonly string[]; readonly currentContexts: readonly string[]; readonly recommendedContexts: readonly string[]; readonly eligibilityProven: boolean; }
export const accountContextPlanner: MigrationDescriptor<readonly AccountContextReadinessRecord[]> = simplePlanner(
  "RISK001_ACCOUNT_CONTEXT_READINESS", "ACCOUNT_CONTEXT", ["RISK001_ROLE_DRIFT"],
  (record) => ({ id: record.userId, summary: { activeRoleCount: record.activeRoleCodes.length, currentContextCount: record.currentContexts.length, missingRecommendedCount: record.recommendedContexts.filter((v) => !record.currentContexts.includes(v)).length },
    action: "REVIEW_ACCOUNT_CONTEXT_ELIGIBILITY", reason: record.eligibilityProven ? "CONTEXT_PRECONDITION_PROVEN" : "ROLE_LABEL_NOT_ELIGIBILITY_PROOF",
    classification: record.eligibilityProven ? "DETERMINISTIC_WITH_PRECONDITION" : "AMBIGUOUS_MANUAL_REVIEW" }),
);

export interface TalentIdentityReadinessRecord { readonly talentId: string; readonly employmentProfileId?: string; readonly activeMembershipCount: number; readonly externalOnly: boolean; readonly evidenceUnambiguous: boolean; }
export const talentIdentityPlanner: MigrationDescriptor<readonly TalentIdentityReadinessRecord[]> = simplePlanner(
  "RISK001_TALENT_IDENTITY_READINESS", "TALENT_IDENTITY", ["RISK001_ACCOUNT_CONTEXT_READINESS"],
  (record) => ({ id: record.talentId, summary: { linkedEmploymentProfile: Boolean(record.employmentProfileId), activeMembershipCount: record.activeMembershipCount, externalOnly: record.externalOnly },
    action: record.externalOnly ? "PRESERVE_EXTERNAL_ONLY_TALENT" : "REVIEW_CREATE_RELINK_OR_REMOVE_TEST_MEMBERSHIP",
    reason: record.externalOnly ? "EXTERNAL_ONLY_TALENT" : record.evidenceUnambiguous ? "IDENTITY_EVIDENCE_AVAILABLE" : "OPERATIONAL_IDENTITY_AMBIGUOUS",
    classification: record.externalOnly ? "NO_MIGRATION_REQUIRED" : record.evidenceUnambiguous ? "DETERMINISTIC_WITH_PRECONDITION" : "UNMIGRATABLE_WITHOUT_OWNER_DECISION" }),
);

export interface CoarseKpiScopeRecord { readonly assignmentId: string; readonly coarseScopes: readonly string[]; readonly structuredGrantCount: number; readonly productionCallerCount: number; }
export const coarseKpiScopePlanner: MigrationDescriptor<readonly CoarseKpiScopeRecord[]> = simplePlanner(
  "RISK001_COARSE_KPI_SCOPE", "COARSE_KPI_SCOPE", ["RISK001_SCOPE_FINGERPRINT"],
  (record) => ({ id: record.assignmentId, summary: { coarseScopeCount: record.coarseScopes.length, structuredGrantCount: record.structuredGrantCount, productionCallerCount: record.productionCallerCount },
    action: record.structuredGrantCount > 0 && record.productionCallerCount === 0 ? "REMOVE_COARSE_SCOPE_AFTER_VALIDATION" : "PLAN_EXACT_STRUCTURED_SCOPE_TRANSITION",
    reason: "COARSE_KPI_SCOPE_RETIREMENT", classification: record.structuredGrantCount > 0 && record.productionCallerCount === 0 ? "DETERMINISTIC_WITH_PRECONDITION" : "AMBIGUOUS_MANUAL_REVIEW" }),
);

export interface StaleKpiRecord { readonly id: string; readonly kind: "PLAN" | "METRIC" | "ALLOCATION" | "ACTUAL"; readonly reconstructible: boolean; readonly dependencyCount: number; readonly historicalTruthKnown: boolean; readonly downstreamReferences: readonly string[]; }
export const staleKpiPlanner: MigrationDescriptor<readonly StaleKpiRecord[]> = simplePlanner(
  "RISK001_STALE_KPI_DATA", "STALE_KPI", ["RISK001_COARSE_KPI_SCOPE", "RISK001_TALENT_IDENTITY_READINESS"],
  (record) => {
    const action = record.reconstructible ? "MIGRATE_RECONSTRUCTIBLE_FIELDS" : record.dependencyCount === 0 && record.historicalTruthKnown ? "ARCHIVE_OR_DELETE_NO_DEPENDENCY" : record.historicalTruthKnown ? "MANUAL_REVIEW_REQUIRED" : "PRESERVE_HISTORICAL_UNKNOWN";
    return { id: record.id, summary: { kind: record.kind, dependencyCount: record.dependencyCount, downstreamReferenceClasses: [...record.downstreamReferences].sort() }, action, reason: action,
      classification: record.reconstructible ? "DETERMINISTIC_WITH_PRECONDITION" : action === "PRESERVE_HISTORICAL_UNKNOWN" ? "HISTORICAL_UNKNOWN_PRESERVE_AS_UNKNOWN" : action === "ARCHIVE_OR_DELETE_NO_DEPENDENCY" ? "DETERMINISTIC_WITH_PRECONDITION" : "AMBIGUOUS_MANUAL_REVIEW" };
  },
);

export function createRisk001Registry(): MigrationRegistry {
  return new MigrationRegistry()
    .register(roleDriftPlanner).register(legacyRolePlanner).register(bundlePlanner)
    .register(scopeFingerprintPlanner).register(accountContextPlanner)
    .register(talentIdentityPlanner).register(coarseKpiScopePlanner).register(staleKpiPlanner);
}

function simplePlanner<T>(id: string, recordClass: string, dependencies: readonly string[], classify: (record: T) => { id: string; summary: Readonly<Record<string, unknown>>; action: string; reason: string; classification: "DETERMINISTIC_AUTO_MIGRATION" | "DETERMINISTIC_WITH_PRECONDITION" | "AMBIGUOUS_MANUAL_REVIEW" | "UNMIGRATABLE_WITHOUT_OWNER_DECISION" | "HISTORICAL_UNKNOWN_PRESERVE_AS_UNKNOWN" | "NO_MIGRATION_REQUIRED" }): MigrationDescriptor<readonly T[]> {
  return { id, version: V, dependencies, recordClass, plan: (records = []) => records.map((record) => {
    const decision = classify(record);
    return plannedAction({ migrationId: id, migrationVersion: V, recordClass,
      sanitizedRecordIdentity: sanitizedIdentity(recordClass, decision.id), currentStateSummary: decision.summary,
      proposedAction: decision.action, preconditions: decision.classification === "NO_MIGRATION_REQUIRED" ? [] : ["independent source audit passes", "approved dry-run manifest"],
      dependencyChecks: ["bounded record references", "audit/idempotency lineage"], expectedEffect: "Planning only; no database change",
      reasonCode: decision.reason, classification: decision.classification,
      requiredApproval: decision.classification === "NO_MIGRATION_REQUIRED" ? "NONE" : "OWNER",
      sourceRemovalDependency: "Legacy source removal remains blocked until zero dependencies and post-migration validation",
      before: decision.summary, plannedAfter: { proposedAction: decision.action },
    });
  }) };
}
