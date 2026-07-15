import assert from "node:assert/strict";
import test from "node:test";
import { getRoleTemplate } from "@modules/role/domain/role-template.catalog";
import { buildRoleAssignmentScopeFingerprint } from "@modules/role/domain/role-assignment-scope";
import { buildDryRunManifest } from "./migration-program";
import {
  createRisk001Registry,
  roleDriftPlanner,
} from "./risk-001-planners";

test("RISK-001 Role planner maps all seven integrity classes conservatively", () => {
  const canonical = getRoleTemplate("TALENT_GROUP_MANAGER");
  const deferred = getRoleTemplate("COMMERCIAL_CONTRACT_OPS");
  assert.ok(canonical && deferred);
  const base = {
    code: canonical.code,
    templateCode: canonical.code,
    templateVersion: canonical.version,
    activeAccountCount: 2,
    template: canonical,
  };
  const fixtures = [
    { id: "matched", ...base, permissions: canonical.permissions },
    { id: "missing", ...base, permissions: canonical.permissions.slice(1) },
    { id: "extra", ...base, permissions: [...canonical.permissions, "legacy.extra"] },
    { id: "mixed", ...base, permissions: [...canonical.permissions.slice(1), "legacy.extra"] },
    {
      id: "legacy",
      code: "ADMIN_FULL",
      permissions: ["legacy.admin"],
      activeAccountCount: 2,
      template: null,
    },
    {
      id: "deferred",
      code: deferred.code,
      templateCode: deferred.code,
      templateVersion: deferred.version,
      permissions: deferred.permissions,
      activeAccountCount: 0,
      template: deferred,
    },
    {
      id: "unknown",
      code: "ORPHAN_ROLE",
      permissions: ["unknown.permission"],
      activeAccountCount: 1,
      template: null,
    },
  ];

  const first = roleDriftPlanner.plan(fixtures);
  const second = roleDriftPlanner.plan(fixtures);
  assert.deepEqual(first, second);
  const byReason = new Map(first.map((action) => [action.reasonCode, action]));

  assert.equal(byReason.get("MATCHED")?.classification, "NO_MIGRATION_REQUIRED");
  assert.equal(byReason.get("MATCHED")?.proposedAction, "NONE");
  for (const reason of [
    "STALE_MISSING_PERMISSIONS",
    "STALE_EXTRA_PERMISSIONS",
    "STALE_MIXED",
  ]) {
    const action = byReason.get(reason);
    assert.equal(action?.classification, "DETERMINISTIC_WITH_PRECONDITION", reason);
    assert.equal(action?.proposedAction, "REVIEW_EXACT_CANONICAL_ROLE_SYNC_DELTA");
    assert.equal(action?.requiredApproval, "OWNER");
    assert.equal(action?.plannedAfter.authorityMutation, "CANONICAL_PERMISSION_SYNC_AFTER_APPROVAL");
    assert.equal(Array.isArray(action?.plannedAfter.permissionAdditions), true);
    assert.equal(Array.isArray(action?.plannedAfter.permissionRemovals), true);
    assert.equal(action?.plannedAfter.sourceTemplateCode, canonical.code);
    assert.equal(action?.plannedAfter.sourceTemplateVersion, canonical.version);
    assert.equal(action?.plannedAfter.sourceTemplateFingerprint, canonical.permissionFingerprint);
    assert.equal(action?.plannedAfter.activeAccountImpact, 2);
  }
  assert.deepEqual(
    byReason.get("STALE_MISSING_PERMISSIONS")?.plannedAfter.permissionRemovals,
    [],
  );
  assert.deepEqual(
    byReason.get("STALE_EXTRA_PERMISSIONS")?.plannedAfter.permissionAdditions,
    [],
  );

  const legacy = byReason.get("LEGACY_COMPATIBILITY_ROLE");
  assert.equal(legacy?.classification, "UNMIGRATABLE_WITHOUT_OWNER_DECISION");
  assert.equal(legacy?.proposedAction, "CROSS_REFERENCE_LEGACY_ROLE_RETIREMENT_NO_SYNC");
  assert.equal(legacy?.plannedAfter.authorityMutation, "NONE");
  assert.equal(legacy?.plannedAfter.authoritativePlanner, "RISK001_LEGACY_ROLE_RETIREMENT");

  const deferredAction = byReason.get("DEFERRED_NOT_ACTIVE");
  assert.equal(deferredAction?.classification, "NO_MIGRATION_REQUIRED");
  assert.equal(deferredAction?.proposedAction, "PRESERVE_DEFERRED_ROLE_STATE");
  assert.equal(deferredAction?.plannedAfter.authorityMutation, "NONE");

  const unknown = byReason.get("UNKNOWN_ORPHAN");
  assert.equal(unknown?.classification, "UNMIGRATABLE_WITHOUT_OWNER_DECISION");
  assert.equal(unknown?.proposedAction, "MANUAL_ROLE_PROVENANCE_DECISION_NO_SYNC");
  assert.equal(unknown?.plannedAfter.authorityMutation, "NONE");

  assert.equal(JSON.stringify(first).includes('"id":"matched"'), false);
  assert.equal(first.every((action) => action.beforeFingerprint.length > 0), true);
  assert.equal(first.every((action) => action.plannedAfterFingerprint.length > 0), true);
});

test("RISK-001 manifest cross-references legacy Role debt without duplicate counts or sync proposals", () => {
  const inputs = {
    RISK001_ROLE_DRIFT: [
      {
        id: "same-legacy-role",
        code: "ADMIN_FULL",
        permissions: ["legacy.admin"],
        activeAccountCount: 1,
        template: null,
      },
    ],
    RISK001_LEGACY_ROLE_RETIREMENT: [
      {
        id: "same-legacy-role",
        code: "ADMIN_FULL",
        activeAssignmentCount: 1,
        bundleParentCount: 0,
        bundleChildCount: 0,
        accountContextDependencyCount: 0,
        effectivePermissions: ["legacy.admin"],
        replacementRoleCodes: [],
      },
    ],
    RISK001_BUNDLE_CONSISTENCY: [],
    RISK001_SCOPE_FINGERPRINT: [],
    RISK001_ACCOUNT_CONTEXT_READINESS: [],
    RISK001_TALENT_IDENTITY_READINESS: [],
    RISK001_COARSE_KPI_SCOPE: [],
    RISK001_STALE_KPI_DATA: [],
  };
  const manifest = buildDryRunManifest({ registry: createRisk001Registry(), inputs });
  const legacyActions = manifest.actions.filter(
    (action) => action.sanitizedRecordIdentity.startsWith("LEGACY_ROLE:"),
  );

  assert.equal(legacyActions.length, 2);
  assert.equal(
    legacyActions.every((action) => action.plannedAfter.authorityMutation === "NONE"),
    true,
  );
  assert.equal(manifest.counts.UNMIGRATABLE_WITHOUT_OWNER_DECISION, 1);
  assert.equal(
    legacyActions.some((action) => action.proposedAction.includes("CANONICAL_ROLE_SYNC")),
    false,
  );
});

test("RISK-001 registry orders dependencies and produces deterministic sanitized dry-run output", () => {
  const template = getRoleTemplate("TALENT_GROUP_MANAGER");
  assert.ok(template);
  const grant = { scopeType: "managedTalentGroup" as const, targetId: "secret-group-id" };
  const inputs = {
    RISK001_ROLE_DRIFT: [{ id: "secret-role-id", code: template.code, templateCode: template.code, templateVersion: template.version, permissions: template.permissions.slice(1), activeAccountCount: 1, template }],
    RISK001_LEGACY_ROLE_RETIREMENT: [{ id: "legacy-secret", code: "ADMIN_FULL", activeAssignmentCount: 1, bundleParentCount: 0, bundleChildCount: 0, accountContextDependencyCount: 1, effectivePermissions: ["role:list"], replacementRoleCodes: ["OWNER_ADMIN"] }],
    RISK001_BUNDLE_CONSISTENCY: [{ parentId: "bundle-secret", status: "ACTIVE", expectedChildIds: ["child"], activeChildIds: [], revokedChildIds: ["child"], provenanceComplete: true }],
    RISK001_SCOPE_FINGERPRINT: [{ assignmentId: "assignment-secret", grants: [grant], storedFingerprint: "wrong", subjectsExist: true }],
    RISK001_ACCOUNT_CONTEXT_READINESS: [{ userId: "user-secret", activeRoleCodes: ["TALENT_GROUP_MANAGER"], currentContexts: [], recommendedContexts: ["MANAGER_CONSOLE"], eligibilityProven: false }],
    RISK001_TALENT_IDENTITY_READINESS: [{ talentId: "talent-secret", activeMembershipCount: 1, externalOnly: false, evidenceUnambiguous: false }],
    RISK001_COARSE_KPI_SCOPE: [{ assignmentId: "assignment-secret", coarseScopes: ["managedGroup"], structuredGrantCount: 1, productionCallerCount: 0 }],
    RISK001_STALE_KPI_DATA: [{ id: "kpi-secret", kind: "ACTUAL" as const, reconstructible: false, dependencyCount: 1, historicalTruthKnown: false, downstreamReferences: ["audit", "allocation"] }],
  };
  const first = buildDryRunManifest({ registry: createRisk001Registry(), inputs });
  const second = buildDryRunManifest({ registry: createRisk001Registry(), inputs });
  assert.deepEqual(first, second);
  assert.equal(first.mode, "DRY_RUN");
  assert.equal(first.writeExecutorStatus, "NOT_IMPLEMENTED_OR_NOT_ENABLED_PENDING_APPROVED_DRY_RUN");
  assert.equal(first.orderedMigrations.indexOf("RISK001_ROLE_DRIFT") < first.orderedMigrations.indexOf("RISK001_LEGACY_ROLE_RETIREMENT"), true);
  assert.equal(JSON.stringify(first).includes("secret-role-id"), false);
  assert.equal(first.actions.some((action) => action.reasonCode === "SCOPE_FINGERPRINT_REPAIR"), true);
  assert.equal(first.actions.some((action) => action.classification === "HISTORICAL_UNKNOWN_PRESERVE_AS_UNKNOWN"), true);
  assert.equal(buildRoleAssignmentScopeFingerprint([grant]).length > 0, true);
});
