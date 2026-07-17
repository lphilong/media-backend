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
  /** Batch B reconciliation metadata.  A catalog-only record deliberately has
   * no persisted role fields; it is still an assessable, non-executable row. */
  readonly sourceKind?: "CATALOG_ONLY" | "PERSISTED";
  readonly persistedState?: string | null;
  readonly reconciliationIssues?: readonly string[];
}

export const roleDriftPlanner: MigrationDescriptor<readonly RoleDriftPlannerRecord[]> = {
  id: "RISK001_ROLE_DRIFT",
  version: V,
  dependencies: [],
  recordClass: "ROLE",
  plan: (records = []) =>
    records.map((record) => {
      const reconciliationIssues = record.reconciliationIssues ?? [];
      const reconciliationReason = record.sourceKind === "CATALOG_ONLY"
        ? "CANONICAL_ROLE_MISSING_FROM_PERSISTENCE"
        : record.persistedState !== undefined && record.persistedState !== "ACTIVE"
          ? "PERSISTED_CANONICAL_ROLE_INACTIVE"
          : reconciliationIssues[0];
      if (reconciliationReason) {
        return plannedAction({
          migrationId: "RISK001_ROLE_DRIFT", migrationVersion: V, recordClass: "ROLE",
          sanitizedRecordIdentity: sanitizedIdentity("ROLE", record.id),
          currentStateSummary: {
            reconciliationReason, sourceKind: record.sourceKind ?? "PERSISTED",
            persistedState: record.persistedState ?? null,
            activeAccountCount: record.activeAccountCount,
            reconciliationIssues: [...reconciliationIssues].sort(),
          },
          proposedAction: "MANUAL_REVIEW_NO_ROLE_MUTATION",
          preconditions: ["independent source audit passes", "Owner-reviewed role disposition"],
          dependencyChecks: ["canonical catalog", "persisted role identity", "active assignments"],
          expectedEffect: "Assessment only; no role is created, activated, renamed, retired, or deleted",
          reasonCode: reconciliationReason,
          classification: "AMBIGUOUS_MANUAL_REVIEW", requiredApproval: "OWNER",
          sourceRemovalDependency: "Role source remains unchanged until Owner-approved migration planning and post-migration audit",
          before: record,
          plannedAfter: { authorityMutation: "NONE", manualDecisionRequired: true },
        });
      }
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
  readonly dependencyDimensions?: readonly LegacyDependencyDimension[];
}

export interface LegacyDependencyDimension {
  readonly id: string;
  readonly reasonCode: string;
  readonly status: "CLEAR" | "BLOCKED" | "UNRESOLVED" | "NOT_APPLICABLE";
  readonly evidenceIds: readonly string[];
}

export const legacyRolePlanner: MigrationDescriptor<readonly LegacyRoleRecord[]> = {
  id: "RISK001_LEGACY_ROLE_RETIREMENT",
  version: V,
  dependencies: ["RISK001_ROLE_DRIFT"],
  recordClass: "LEGACY_ROLE",
  plan: (records = []) => records.map((record) => {
    if (!LEGACY_ROLE_TEMPLATE_CODES.includes(record.code as never)) {
      return plannedAction({
        migrationId: "RISK001_LEGACY_ROLE_RETIREMENT", migrationVersion: V, recordClass: "LEGACY_ROLE",
        sanitizedRecordIdentity: sanitizedIdentity("LEGACY_ROLE", record.id),
        currentStateSummary: { code: record.code, legacyApplicability: "NOT_LEGACY_NOT_APPLICABLE" },
        proposedAction: "NONE", preconditions: [], dependencyChecks: [],
        expectedEffect: "Not a legacy Role; no retirement assessment applies",
        reasonCode: "NOT_LEGACY_NOT_APPLICABLE", classification: "NO_MIGRATION_REQUIRED", requiredApproval: "NONE",
        sourceRemovalDependency: "NOT_APPLICABLE", before: record, plannedAfter: { authorityMutation: "NONE" },
      });
    }
    const dimensions = record.dependencyDimensions ?? legacyFallbackDimensions(record);
    const unresolved = dimensions.filter((dimension) => dimension.status === "UNRESOLVED");
    const blocked = dimensions.filter((dimension) => dimension.status === "BLOCKED");
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
      effectivePermissionCount: record.effectivePermissions.length, dependencyCount,
      dependencyDimensions: dimensions.map((dimension) => ({ id: dimension.id, reasonCode: dimension.reasonCode, status: dimension.status, evidenceCount: dimension.evidenceIds.length })),
    },
    proposedAction: unresolved.length > 0 || blocked.length > 0
      ? "PRESERVE_LEGACY_ROLE_FOR_MANUAL_REVIEW"
      : "REVIEW_READY_FOR_FUTURE_RETIREMENT_PLANNING",
    preconditions: ["all required dependency dimensions are source-resolved", "replacement authority and effective access equivalence proven"],
    dependencyChecks: dimensions.map((dimension) => `${dimension.id}:${dimension.reasonCode}:${dimension.status}`),
    expectedEffect: "Require an Owner decision before any legacy authority change",
    reasonCode: unresolved.length > 0 ? "LEGACY_ROLE_UNRESOLVED_DEPENDENCY" : blocked.length > 0
      ? "LEGACY_ROLE_BLOCKED_BY_DEPENDENCY" : "LEGACY_ROLE_READY_FOR_FUTURE_RETIREMENT_PLANNING",
    classification: unresolved.length > 0 ? "AMBIGUOUS_MANUAL_REVIEW" : blocked.length > 0
      ? "UNMIGRATABLE_WITHOUT_OWNER_DECISION" : "DETERMINISTIC_WITH_PRECONDITION", requiredApproval: "OWNER",
    sourceRemovalDependency: "Remove source only after dependency count is zero and post-migration audit passes",
    before: record, plannedAfter: {
      authorityMutation: "NONE",
      manualDecisionRequired: true,
      reviewedReplacementCandidates: record.replacementRoleCodes,
      retirementProposed: false, dependencyDimensions: dimensions,
    },
  }); }),
};

function legacyFallbackDimensions(record: LegacyRoleRecord): readonly LegacyDependencyDimension[] {
  const count = record.activeAssignmentCount + record.bundleParentCount + record.bundleChildCount + record.accountContextDependencyCount;
  return [{ id: "legacy-fallback", reasonCode: "LEGACY_DIMENSIONS_NOT_LOADED", status: count > 0 ? "BLOCKED" : "UNRESOLVED", evidenceIds: [] }];
}

export interface BundleConsistencyRecord {
  readonly parentId: string; readonly status: string; readonly bundleCode: string;
  /** Canonical Role IDs evidenced by reconciled child assignments. */
  readonly relatedRoleIds?: readonly string[];
  readonly persistedCatalogVersion: string; readonly canonicalCatalogVersion: string | null;
  readonly expectedRoleCodes: readonly string[]; readonly persistedChildIds: readonly string[];
  readonly childRoleCodes: readonly (string | null)[]; readonly activeChildIds: readonly string[];
  readonly revokedChildIds: readonly string[]; readonly provenanceComplete: boolean;
  readonly classifications: readonly (
    | "MATCHED" | "PARENT_INACTIVE_OR_EXPIRED" | "TARGET_USER_MISMATCH"
    | "ROLE_MISSING_OR_INACTIVE" | "CATALOG_VERSION_MISMATCH"
    | "MISSING_EXPECTED_CHILD" | "EXTRA_CHILD" | "DUPLICATE_CHILD_ROLE"
    | "REVOKED_OR_INEFFECTIVE_CHILD" | "ORIGIN_MISMATCH" | "ORPHAN_CHILD_LINK"
    | "UNKNOWN_OR_MANUAL_REVIEW"
  )[];
}
export const bundlePlanner: MigrationDescriptor<readonly BundleConsistencyRecord[]> = simplePlanner(
  "RISK001_BUNDLE_CONSISTENCY", "BUNDLE", ["RISK001_LEGACY_ROLE_RETIREMENT"],
  (record) => ({
    id: record.parentId,
    summary: { status: record.status, bundleCode: record.bundleCode, expectedChildCount: record.expectedRoleCodes.length, persistedChildCount: record.persistedChildIds.length, activeChildCount: record.activeChildIds.length, revokedChildCount: record.revokedChildIds.length, classifications: record.classifications },
    action: record.classifications.length === 1 && record.classifications[0] === "MATCHED" ? "NONE" : "MANUAL_REVIEW_NO_CHILD_REACTIVATION",
    reason: record.classifications.length === 1 && record.classifications[0] === "MATCHED" ? "MATCHED" : record.classifications.join("+"),
    classification: record.classifications.length === 1 && record.classifications[0] === "MATCHED" ? "NO_MIGRATION_REQUIRED" : "AMBIGUOUS_MANUAL_REVIEW",
  }),
);

export interface ScopeFingerprintRecord {
  readonly assignmentId: string; readonly grants: readonly RoleAssignmentScopeGrant[];
  readonly roleId?: string;
  readonly storedFingerprint?: string; readonly subjectsExist: boolean;
  readonly sourceClassification?: "EXACT_STRUCTURED_MATCH" | "NO_STRUCTURED_GRANT" | "COARSE_SCOPE_ONLY" | "MALFORMED_STRUCTURED_GRANT" | "UNSUPPORTED_SCOPE_TYPE" | "AMBIGUOUS_MULTIPLE_GRANTS" | "DUPLICATE_SEMANTIC_GRANT" | "FINGERPRINT_MISMATCH" | "OBJECT_IDENTITY_MISMATCH" | "INACTIVE_OR_INEFFECTIVE_ASSIGNMENT" | "INVALID_ASSIGNMENT_SOURCE" | "INVALID_SOURCE_MANUAL_REVIEW";
  readonly assignmentState?: string;
  readonly reasonCodes?: readonly string[];
}
export const scopeFingerprintPlanner: MigrationDescriptor<readonly ScopeFingerprintRecord[]> = simplePlanner(
  "RISK001_SCOPE_FINGERPRINT", "SCOPE_GRANT", ["RISK001_ROLE_DRIFT"],
  (record) => {
    const expected = buildRoleAssignmentScopeFingerprint(record.grants);
    const sourceClassification = record.sourceClassification ?? (record.subjectsExist && record.grants.length > 0
      ? record.storedFingerprint === expected ? "EXACT_STRUCTURED_MATCH" : "FINGERPRINT_MISMATCH"
      : "INVALID_SOURCE_MANUAL_REVIEW");
    const exact = sourceClassification === "EXACT_STRUCTURED_MATCH";
    const mismatch = sourceClassification === "FINGERPRINT_MISMATCH";
    return { id: record.assignmentId, summary: { sourceClassification, assignmentState: record.assignmentState ?? "UNKNOWN", subjectsExist: record.subjectsExist, fingerprintMatched: record.storedFingerprint === expected, reasonCodes: record.reasonCodes ?? [] },
      action: exact ? "NONE" : mismatch ? "REVIEW_SCOPE_FINGERPRINT_ALIGNMENT" : "MANUAL_REVIEW_NO_SCOPE_GRANT_MUTATION",
      reason: sourceClassification,
      classification: exact ? "NO_MIGRATION_REQUIRED" : mismatch ? "DETERMINISTIC_WITH_PRECONDITION" : "AMBIGUOUS_MANUAL_REVIEW" };
  },
);

export interface AccountContextReadinessRecord { readonly userId: string; readonly activeRoleIds?: readonly string[]; readonly activeRoleCodes: readonly string[]; readonly currentContexts: readonly string[]; readonly recommendedContexts: readonly string[]; readonly operationalProfileStatuses: readonly string[]; readonly ineligibleProfileStatuses: readonly string[]; readonly linkedProfileCount: number; readonly policyOwnerKnown: boolean; readonly ambiguityReasons: readonly string[]; readonly eligibilityProven: boolean; }
export const accountContextPlanner: MigrationDescriptor<readonly AccountContextReadinessRecord[]> = simplePlanner(
  "RISK001_ACCOUNT_CONTEXT_READINESS", "ACCOUNT_CONTEXT", ["RISK001_ROLE_DRIFT"],
  (record) => ({ id: record.userId, summary: { activeRoleCount: record.activeRoleCodes.length, currentContextCount: record.currentContexts.length, missingRecommendedCount: record.recommendedContexts.filter((v) => !record.currentContexts.includes(v)).length, linkedProfileCount: record.linkedProfileCount ?? 0, operationalProfileStatuses: record.operationalProfileStatuses, ineligibleProfileStatuses: record.ineligibleProfileStatuses, policyOwnerKnown: record.policyOwnerKnown ?? false, ambiguityReasons: record.ambiguityReasons ?? [] },
    action: record.eligibilityProven ? "REVIEW_ACCOUNT_CONTEXT_ELIGIBILITY" : "PRESERVE_ACCOUNT_CONTEXT_FOR_MANUAL_REVIEW", reason: record.eligibilityProven ? "CONTEXT_PRECONDITION_PROVEN" : record.ambiguityReasons?.[0] ?? "ELIGIBILITY_NOT_PROVEN",
    classification: record.eligibilityProven ? "DETERMINISTIC_WITH_PRECONDITION" : "AMBIGUOUS_MANUAL_REVIEW" }),
);

export interface TalentIdentityReadinessRecord {
  readonly talentId: string; readonly employmentProfileId?: string;
  readonly linkedUserId?: string;
  readonly activeMembershipCount: number; readonly operationalMembershipCount: number;
  readonly malformedMembershipCount?: number; readonly unresolvedMembershipCount?: number;
  readonly duplicateMembershipCount?: number; readonly membershipReasonCodes?: readonly string[];
  readonly externalOnly: boolean; readonly evidenceUnambiguous: boolean;
  readonly talentOperationalStatus: string; readonly employmentProfileStatus: string | null;
  readonly readinessClassification:
    | "VALID_OPERATIONAL_IDENTITY" | "EXTERNAL_ONLY_TALENT" | "FORBIDDEN_EXTERNAL_PROFILE_LINK"
    | "MISSING_EMPLOYMENT_PROFILE" | "AMBIGUOUS_MULTIPLE_LINKS" | "INACTIVE_TALENT"
    | "INELIGIBLE_EMPLOYMENT_PROFILE" | "INACTIVE_OR_INVALID_GROUP" | "STALE_MEMBERSHIP"
    | "NO_ACTIVE_VALID_GROUP_MEMBERSHIP" | "AMBIGUOUS_MULTIPLE_ACTIVE_VALID_GROUP_MEMBERSHIPS"
    | "MALFORMED_RELEVANT_MEMBERSHIP" | "UNRESOLVED_MEMBERSHIP_SUBJECT"
    | "MANUAL_REVIEW_REQUIRED";
}
export const talentIdentityPlanner: MigrationDescriptor<readonly TalentIdentityReadinessRecord[]> = simplePlanner(
  "RISK001_TALENT_IDENTITY_READINESS", "TALENT_IDENTITY", ["RISK001_ACCOUNT_CONTEXT_READINESS"],
  (record) => ({ id: record.talentId, summary: { linkedEmploymentProfile: Boolean(record.employmentProfileId), activeMembershipCount: record.activeMembershipCount, operationalMembershipCount: record.operationalMembershipCount, malformedMembershipCount: record.malformedMembershipCount ?? 0, unresolvedMembershipCount: record.unresolvedMembershipCount ?? 0, duplicateMembershipCount: record.duplicateMembershipCount ?? 0, membershipReasonCodes: record.membershipReasonCodes ?? [], groupCardinality: record.operationalMembershipCount, externalOnly: record.externalOnly, readinessClassification: record.readinessClassification, localBlocker: record.readinessClassification === "VALID_OPERATIONAL_IDENTITY" || record.readinessClassification === "EXTERNAL_ONLY_TALENT" ? null : "TALENT_GROUP_READINESS_BLOCKER" },
    action: record.readinessClassification === "EXTERNAL_ONLY_TALENT" ? "PRESERVE_EXTERNAL_ONLY_TALENT" : record.readinessClassification === "VALID_OPERATIONAL_IDENTITY" ? "NONE" : "MANUAL_REVIEW_NO_LINK_OR_PROFILE_FABRICATION",
    reason: record.readinessClassification,
    classification: record.readinessClassification === "EXTERNAL_ONLY_TALENT" || record.readinessClassification === "VALID_OPERATIONAL_IDENTITY" ? "NO_MIGRATION_REQUIRED" : "UNMIGRATABLE_WITHOUT_OWNER_DECISION" }),
);

export interface CoarseKpiScopeRecord { readonly assignmentId: string; readonly coarseScopes: readonly string[]; readonly structuredGrantCount: number; readonly compatibilityOwner: string; readonly compatibilityContract: string; readonly compatibilityVersion: string; readonly consumerIds: readonly string[]; readonly productionCallerCount: number; readonly retirementBlocker: string; }
export const coarseKpiScopePlanner: MigrationDescriptor<readonly CoarseKpiScopeRecord[]> = simplePlanner(
  "RISK001_COARSE_KPI_SCOPE", "COARSE_KPI_SCOPE", ["RISK001_SCOPE_FINGERPRINT"],
  (record) => ({ id: record.assignmentId, summary: { coarseScopeCount: record.coarseScopes.length, structuredGrantCount: record.structuredGrantCount, compatibilityOwner: record.compatibilityOwner, compatibilityContract: record.compatibilityContract, compatibilityVersion: record.compatibilityVersion, consumerIds: record.consumerIds, productionCallerCount: record.consumerIds.length, retirementBlocker: record.retirementBlocker },
    action: record.structuredGrantCount > 0 && record.consumerIds.length === 0 ? "REMOVE_COARSE_SCOPE_AFTER_VALIDATION" : "PLAN_EXACT_STRUCTURED_SCOPE_TRANSITION",
    reason: "COARSE_KPI_SCOPE_RETIREMENT", classification: record.structuredGrantCount > 0 && record.consumerIds.length === 0 ? "DETERMINISTIC_WITH_PRECONDITION" : "AMBIGUOUS_MANUAL_REVIEW" }),
);

export type StaleKpiClassification = "CURRENT_CANONICAL" | "STALE_DETERMINISTIC_MIGRATION" | "DEPENDENCY_FREE_ARCHIVE_CANDIDATE" | "REBUILDABLE_TEST_DATA" | "HISTORICAL_UNKNOWN" | "MANUAL_REVIEW_REQUIRED" | "PRESERVE_DUE_TO_DEPENDENCY" | "INVALID_OR_ORPHANED";
export interface StaleKpiRecord { readonly id: string; readonly kind: "PLAN" | "METRIC" | "ALLOCATION" | "ACTUAL" | "CORRECTION" | "ALLOCATION_OPERATION" | "SLOT_EXCUSE"; readonly relatedTalentIds?: readonly string[]; readonly sourceClassification: StaleKpiClassification; readonly dependencyCount: number; readonly historicalTruthKnown: boolean; readonly downstreamReferences: readonly string[]; readonly missingMaterialFields: readonly string[]; readonly materialIssues: readonly string[]; readonly materialSummary: Readonly<Record<string, unknown>>; readonly boundedExternalDependencyEvidence: "NO_REVENUE_OR_COMMISSION_KPI_ID_REFERENCE_IN_CURRENT_SOURCE"; }
export const staleKpiPlanner: MigrationDescriptor<readonly StaleKpiRecord[]> = simplePlanner(
  "RISK001_STALE_KPI_DATA", "STALE_KPI", ["RISK001_COARSE_KPI_SCOPE", "RISK001_TALENT_IDENTITY_READINESS"],
  (record) => {
    const action = record.sourceClassification === "CURRENT_CANONICAL" ? "NONE" : record.sourceClassification === "STALE_DETERMINISTIC_MIGRATION" ? "MIGRATE_EXACT_SOURCE_BACKED_FIELDS_AFTER_APPROVAL" : record.sourceClassification === "DEPENDENCY_FREE_ARCHIVE_CANDIDATE" ? "REVIEW_ARCHIVE_CANDIDATE" : record.sourceClassification === "REBUILDABLE_TEST_DATA" ? "REBUILD_TEST_DATA_AFTER_APPROVAL" : record.sourceClassification === "PRESERVE_DUE_TO_DEPENDENCY" || record.sourceClassification === "HISTORICAL_UNKNOWN" ? "PRESERVE_RECORD" : "MANUAL_REVIEW_REQUIRED";
    return { id: record.id, summary: { kind: record.kind, sourceClassification: record.sourceClassification, dependencyCount: record.dependencyCount, downstreamReferenceClasses: [...record.downstreamReferences].sort(), missingMaterialFields: record.missingMaterialFields, materialIssues: record.materialIssues ?? [], materialSummary: record.materialSummary ?? {}, boundedExternalDependencyEvidence: record.boundedExternalDependencyEvidence }, action, reason: record.sourceClassification,
      classification: record.sourceClassification === "CURRENT_CANONICAL" ? "NO_MIGRATION_REQUIRED" : record.sourceClassification === "HISTORICAL_UNKNOWN" ? "HISTORICAL_UNKNOWN_PRESERVE_AS_UNKNOWN" : record.sourceClassification === "STALE_DETERMINISTIC_MIGRATION" || record.sourceClassification === "REBUILDABLE_TEST_DATA" ? "DETERMINISTIC_WITH_PRECONDITION" : "AMBIGUOUS_MANUAL_REVIEW" };
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
